# MeetingGuard AI architecture (stage 2: core services)

The source of truth for types and contracts is the code in `src/core/`. This document explains how the pieces fit together. If the two ever disagree, the code wins; fix the document.

- `src/core/types.ts`: domain types, zod schemas and pure builders
- `src/core/aiContract.ts`: the callable contract shared with `/functions`
- `src/core/contracts.ts`: service interfaces, module map, navigation params, lifecycle
- `src/core/identifiers.ts`: every persistent id, key and path
- `src/core/events.ts`: the typed event bus
- `src/core/errors.ts`, `src/core/logger.ts`, `src/core/time.ts`, `src/core/legacy.ts`
- `src/core/conformance.ts`: compile-time checks that every module exports what the contracts promise

## 1. Layers

```
L7  entry / UI     index.js, App.js, src/navigation, src/screens, src/components/alerts,
                   src/services/alerts/tasks.ts (headless), src/pages (stage 3), legacy shims
L6  session        src/services/auth (barrel): sessionManager, AuthProvider, useAuth
L5  ai             src/services/ai
L4  calendar       src/services/calendar          alerts engine   src/services/alerts
L3  identity       src/services/auth/authService.ts (Google/Firebase identity + Google tokens)
L2  data           src/services/data (repositories, cache, outbox, React hooks)
L1  config, i18n   src/config/firebase.ts, src/config/env.ts, src/i18n, src/utils/format.ts
L0  core           src/core/* (pure TypeScript + zod; no React Native, Expo or Firebase)
```

These rules prevent import cycles:

- A module imports only from its own layer or lower layers.
- Areas talk to each other only through public entry points (`MODULES` in `contracts.ts`), never through internal files.
- Calendar and ai import `src/services/auth/authService` and never the auth barrel, because the barrel pulls in the session manager.
- The alerts engine never imports `alerts/tasks.ts`.
- Upward notifications go through `appEvents`: data emits `meetings:changed`, and calendar, alerts and i18n react to it.

## 2. Module map and ownership

| Area | Public entry (exports) | Owner |
|---|---|---|
| core | `src/core/*` | architect |
| data | `src/services/data` (`dataService`, `meetingRepository`, `preferencesRepository`, `notesRepository`, `userRepository`, `migrationService`, `DataProvider`, `useMeetings`, `useMeeting`, `usePreferences`, `useNotes`, `useEntitlement`, `useSyncState`); `src/config/firebase.ts` | data |
| auth | `src/services/auth/authService.ts` (`authService`); `src/services/auth` (`authService`, `sessionManager`, `AuthProvider`, `useAuth`); `src/contexts/AuthContext.jsx` re-exports these and **stays `.jsx`** because screens import it with the extension | auth |
| calendar | `src/services/calendar` (`googleCalendarService`, `deviceCalendarService`, `calendarSyncEngine`, `useCalendarStatus`) | calendar |
| alerts | `src/services/alerts` (`alertEngine`, `computeAlertPlan`, `usePendingAlerts`); `src/services/alerts/tasks.ts` (`registerBackgroundTasks`, `unregisterBackgroundTasks`, plus the module-scope task definitions); `src/components/alerts` (`AlertHost`) | alerts |
| i18n + navigation | `src/i18n` (`i18n`, `initI18n`, `t`, `getLanguage`, `setLanguage`, `SUPPORTED_LANGUAGES`, `I18N_NAMESPACES`, `I18nProvider`, `useT`, `useLanguage`); `src/utils/format.ts`; `src/navigation` (`navigationRef`, `navigate`, `openDeepLink`, `isNavigationReady`, `linking`, `RootNavigator`, `ROUTES`); `src/screens/onboarding` | i18n-nav |
| ai | `src/services/ai` (`assistantClient`, `actionExecutor`, `useAssistant`) | ai |
| functions | `functions/src/index.ts` (`assistant`, `deleteAccount`); `functions/src/shared/aiContract.ts` is a **verbatim** copy of `src/core/aiContract.ts`, and CI diffs the two; `firestore.rules`, `firestore.indexes.json`, `firebase.json` | functions |

## 3. Data model (summary; `types.ts` has the details)

**Meeting**

| Field | Description |
|---|---|
| `id` | Firestore doc id. Must match `[A-Za-z0-9_-]{1,128}`, with no `:`. |
| `userId`, `title`, `description` | `description` is `''` when empty. |
| `startAt` | UTC ISO string from `toISOString()`. |
| `durationMinutes` | Default 60. |
| `timezone` | IANA zone. |
| `allDay` | For all-day meetings, `startAt` is local midnight in `timezone`. |
| `date`, `time` | Derived wall-clock values in `timezone`. |
| `location` | `{ type physical\|virtual\|hybrid, address, virtualUrl }` or null. |
| `conference` | `{ provider zoom\|teams\|google_meet\|other, url, password }` or null. |
| `participants[]` | `{ email, name, status }`. |
| `source` | `manual\|ai_chat\|whatsapp\|google\|device`. |
| `confidence` | 0-100 or null. |
| `language` | `en\|es`. |
| `preparationTips[]` | |
| `customAlertTimes` | Minutes-before offsets, or null to use the preference defaults. |
| `alertIntensity` | Override of the preference, or null. |
| `notes` | |
| `status` | `scheduled\|cancelled`. |
| `external` | `{ googleEventId, googleCalendarId, googleEtag, googleUpdatedAt, deviceEventId, deviceCalendarId }` |
| `createdAt`, `updatedAt` | |
| `deletedAt` | Tombstone for soft delete. A tombstone keeps only what sync needs (ids, source, status, time slot, external refs, timestamps): title becomes `TOMBSTONE_TITLE`, and description, notes, participants, conference, location, tips and alert settings are cleared (`tombstoneMeeting` / `scrubMeetingContent`). Tombstones older than `TOMBSTONE_RETENTION_DAYS` (60) are hard-deleted, and older content-carrying tombstones are scrubbed, once per session after the first server snapshot. |

Storage rules:

- Optional values are stored as `null`, never as missing or `undefined`.
- Instants are stored as ISO strings, never as Firestore Timestamps.
- Every write goes through `buildMeeting` or `applyMeetingPatch`, so the derived fields cannot drift.
- Reads go through `parseMeetingDoc`, which fills defaults for older documents and returns null for invalid ones (log the id and skip it).

**Preferences** has one document per user. Fields:

- `language`, `timezone`
- `alertEnabled` (master switch), `alertIntensity` (`max|medium|light`), `alertSoundType` (`voice_and_sound|voice_only|sound_only`), `alertVolume` (0-1), `vibrationEnabled`
- `defaultAlertTimes` (default `[15,5,0]`), `snoozeMinutes`, `followUpEnabled`
- `use24HourClock` (null means the locale default), `onboardingCompleted`
- `googleCalendarSyncEnabled`, `deviceCalendarImportIds[]`, `deviceCalendarExportId`
- `updatedAt`

Reads use `mergePreferences`, which merges field by field so one bad field never resets the rest (the old bug #19). Google tokens are **never** stored.

**Other entities:**

- **UserProfile**: `uid`, `email`, `displayName`, `photoURL`, timestamps, `legacyMigratedAt`. It has **no** plan, role or subscription fields (`SERVER_OWNED_PROFILE_KEYS`).
- **Entitlement**: `{ plan free|pro|premium, status, expiresAt, source, updatedAt }`. It is server-owned and read-only on the client. A missing document means free. `effectivePlan()` downgrades expired plans.
- **Note**: `title`, `content`, `category` (`general|work|ideas|personal`), `meetingId`, `pinned`. Notes are hard-deleted.

## 4. Firestore layout and rules intent

| Path | Content | Client access |
|---|---|---|
| `users/{uid}` | UserProfile | owner read and write; writes that contain any `SERVER_OWNED_PROFILE_KEYS` key are rejected |
| `users/{uid}/meetings/{id}` | MeetingDoc | owner read and write; `userId == uid`; type and size checks on `title`, `startAt`, `durationMinutes`, `source`; every alert-time element an int in [0, 10080]; string lists (`preparationTips`) join-checked for type and total size (participant maps cannot be iterated in rules: the assistant bounds what it loads) |
| `users/{uid}/notes/{id}` | Note (without id) | owner read and write |
| `users/{uid}/settings/preferences` | Preferences | owner read and write; only doc id `preferences` |
| `entitlements/{uid}` | Entitlement | owner read; **no client write** |
| `usage/{uid}/days/{yyyy-mm-dd}` (UTC day) | `{ count, updatedAt }` | owner read; **no client write** |
| everything else | | deny |

The indexes used are single-field only (`startAt`), so `firestore.indexes.json` can stay empty unless the functions add composite queries.

## 5. Session lifecycle (the auth area owns `sessionManager`)

**Start.** This runs when the Firebase user is restored or signs in; `AuthProvider` calls `sessionManager.init()` on mount.

1. `await dataService.startSession(uid, { mode: 'foreground', user })`. This loads the `mg:{uid}:*` cache, attaches the listeners, flushes the outbox, and in the background runs `ensureProfile` and `migrateLegacyLocalData`. It does not wait for the network.
2. `appEvents.emit('session:started', { uid, restored })`. The alerts tasks module registers the background tasks when it sees this event.
3. `calendarSyncEngine.start(uid)`, not awaited.
4. `alertEngine.startSession(uid)`, not awaited. It reconciles.

**End.** This runs on `sessionManager.signOut()`, `deleteAccount()`, or when auth is lost.

1. `alertEngine.endSession()` cancels every `mg:*` notification and stops audio and speech.
2. `calendarSyncEngine.stop()`.
3. `dataService.endSession({ wipeLocal: true })` detaches the listeners and deletes every `mg:{uid}:*` key.
4. `authService.signOutProviders()` signs out of GoogleSignin and Firebase. This step is skipped when auth was lost.
5. `appEvents.emit('session:ended', { uid, reason })`.

`signOut()` throws `AppError('pending_writes')` when the outbox is not empty, unless called with `{ force: true }`. The UI asks the user to confirm first. For `deleteAccount()`, the order is: the `deleteAccount` callable, then `revokeGoogleAccess()`, then the End steps above.

**Headless runs** (the background task and the notification action task) use `sessionManager.withHeadlessSession(fn)`. It works as follows:

- It waits for `authService.authReady()`.
- If nobody is signed in, it returns null.
- Otherwise it ensures a data session (starting one in `'headless'` mode if none is active; this mode attaches no listeners and never ends the session) and runs `fn(uid)`.

**Onboarding gate.** When `usePreferences().isLoaded` is true and `onboardingCompleted` is false, the app shows the Onboarding stack. `isLoaded` means the preferences came from the server or from this device's cache. The data layer's 8-second fallback (defaults, so non-gating readers such as alerts are not blocked) does **not** set it: an existing user on a slow network keeps the splash instead of being sent through onboarding with default settings. The steps are:

1. Language
2. Calendars
3. Alerts, including the notification permission and the exact-alarm settings on Android 12+
4. AI intro
5. Guided first meeting

The last step sets `onboardingCompleted: true`.

## 6. Alert pipeline (alerts area)

```
meetings:changed / preferences:changed / language:changed / session start / foreground / background task
  -> alertEngine.reconcile(reason)            (serialized + debounced)
     meetings = meetingRepository.list() (or getCachedUpcoming in headless)
     plan     = computeAlertPlan(meetings, prefs, now, { budget: 60 - activeSnoozes })   (pure)
     render   = t('alerts:...') title/body in the current language, data = AlertNotificationData
     diff     = getAllScheduledNotificationsAsync() vs plan by identifier + data.hash
     cancel stale mg:* ids (keep valid snoozes); schedule missing/changed ones
```

**Planner rules** (`ComputeAlertPlan` in `contracts.ts`):

- `alertEnabled` is the master switch.
- A meeting is eligible when `deletedAt` is null, `status` is `scheduled`, `allDay` is false, and the fire time is in the future and within 14 days.
- Offsets come from `customAlertTimes`, falling back to `defaultAlertTimes`.
- Intensity comes from the meeting override, falling back to the preference.
- The follow-up fires at meeting end + 5 minutes when `followUpEnabled` is on.
- Budget: alerts first (earliest first); follow-ups only use the space the alerts leave. When the
  alerts alone do not fit, one slot is reserved for the refill reminder `mg:refill` ("open
  MeetingGuard to keep your alerts up to date"), which fires an hour before the last scheduled
  alert (at least 30 minutes from now). Opening the app reconciles (every foreground does).
- A scheduled notification that is due within 2 seconds and still planned is kept as it is (too
  late to reschedule; cancelling it would lose the alert).

**Identifiers:**

- `mg:{meetingId}:{offsetMin}` for alerts
- `mg:{meetingId}:followup` for the follow-up
- `mg:{meetingId}:snooze` for a snooze
- `mg:refill` for the refill reminder (not tied to a meeting; managed outside the diff)

**Android channels** (they are immutable, so bump `-vN` to change one). Each exists with and without
vibration (`Preferences.vibrationEnabled` picks the channel; an app cannot change a channel's
vibration). Lock-screen visibility is PRIVATE everywhere, so the user's "hide sensitive content"
setting applies. The v1 channels are deleted at start and their notifications rescheduled.

| Channel (with / without vibration) | Settings |
|---|---|
| `mg-alert-max-v2` / `mg-alert-max-novib-v2` | importance MAX, `bypassDnd` (effective only once the user allows "Override Do Not Disturb" on the channel: `openAlarmChannelSettings()`), custom alarm `.wav`, ALARM audio usage, strong vibration |
| `mg-alert-medium-v2` / `mg-alert-medium-novib-v2` | importance HIGH, chime |
| `mg-alert-light-v2` / `mg-alert-light-novib-v2` | importance DEFAULT, chime |
| `mg-followup-v2` / `mg-followup-novib-v2` | importance DEFAULT, system sound (also used by `mg:refill`) |

MAX and MEDIUM notifications are sticky (Android `ongoing`: "minimizable, not dismissible"); the
tap, Open and Snooze actions and the tray sweep remove them. The OS notification always plays the
channel sound, also with `alertSoundType: 'voice_only'` (the voice readout needs the app in the
foreground); the alert settings screen says so.

Create the channels **before** requesting permission.

**Categories and actions:**

- `mg-alert` has the actions `mg-open` (opens the app), `mg-snooze` (background, `Preferences.snoozeMinutes`) and `mg-snooze-<minutes>` (background, a second longer snooze; the minutes are encoded in the id). Navigation never routes an action id that starts with `mg-snooze`.
- `mg-followup` has the action `mg-assistant`.
- Button titles are localized and registered at every start.

**What happens on taps and deliveries:**

| Event | Handled by | Result |
|---|---|---|
| Tap (default action, `mg-open` or `mg-assistant`) | Navigation `linking` (routing) + alert engine (acknowledges the delivery and removes the sticky tray copy; at cold start from `getLastNotificationResponse()`) | Routes to `data.url` (`meetingguardai://meeting/{id}` or `meetingguardai://assistant?followup={id}`) |
| `mg-snooze` in the foreground | Response listener | Snooze |
| `mg-snooze` in the background (Android) | `BACKGROUND_TASKS.notificationResponse` (restores the persisted language and passes the signed-in uid, so the snooze uses the user's language and snooze length) | Snooze |
| Notification received while foregrounded, or the in-app timer fires | `alertEngine` | Emits an `ActiveAlert` |

`AlertHost` renders the active alerts:

- **MAX:** full-screen modal that needs an explicit action. It plays the bundled sound on a loop with a volume ramp (expo-audio), reads the alert aloud in the UI language (expo-speech), vibrates (never when vibration is off, haptics included), and runs an auto-snooze countdown.
- **MEDIUM:** persistent banner that can be minimized, with a pulse.
- **LIGHT:** toast that can be dismissed after 3 seconds.

Alerts that have already fired or been acknowledged are recorded in `mg:{uid}:alerts.state` so they never fire again. Handled notification responses (ids only, at most 50) are kept device-wide in `GLOBAL_STORAGE_KEYS.alertResponses` (`mg:device:alerts.responses`), so a snooze delivered to both the Android background task and the foreground listener (or a cold start) runs once. Outbox acknowledgements (`meetings:changed` with reason `synced`) do not trigger a reconcile.

**Platform limits and background refresh:**

- iOS keeps 64 pending notifications and Android allows about 500 alarms, so the budget is 60 in total.
- `SCHEDULE_EXACT_ALARM` is declared. `openExactAlarmSettings()` opens the setting through expo-intent-launcher. There is no JS API to check it, so reconcile again after the user returns (AppState active).
- There is no full-screen intent.
- expo-background-task (`mg-background-refresh`, every 60 minutes or more) restores the persisted language (`initI18n`), calls `withHeadlessSession`, then `calendarSyncEngine.syncNow({ headless: true })`, then `alertEngine.reconcile('background')`. Without an alert session the notification text follows `prefs.language`. It only refreshes the rolling window. Delivery itself never depends on it.
- The notification-response task is registered on Android only (iOS delivers action responses to the listener).

## 7. Calendar sync pipeline (calendar area)

**Google, on the device:**

- **Tokens.** `authService.getGoogleAccessToken({ requireCalendar: true })` wraps `GoogleSignin.getTokens()`; the native SDK refreshes the token. There is no client secret and tokens are never persisted. A 401 triggers `invalidateGoogleAccessToken` and one retry.
- **Scope.** `https://www.googleapis.com/auth/calendar.events`, requested incrementally with `addScopes`.
- **Push.** The engine listens to `meetings:changed` and pushes only local writes with origin `user` or `ai`.
  - Inserts use the deterministic id `googleEventIdForMeeting(id)`, which is `mgev` + base32hex. A 409 response triggers get + patch.
  - Updates use patch and deletes use delete.
  - `sendUpdates: 'all'` is set when the meeting has participants.
  - `createMeetLink(meetingId)` adds `conferenceData.createRequest` (with `conferenceDataVersion=1`) and stores the `hangoutLink`.
  - The engine writes the external refs back with origin `calendar_google`, which it then ignores (loop prevention).
  - Local changes are written to the persisted push queue in `mg:{uid}:calendar.google` as soon as the event arrives (the 2-second debounce only delays the network flush), so a meeting created just before the app is killed still reaches Google. Failed pushes stay queued and are retried.
- **Pull.**
  - `events.list` on the primary calendar with `singleEvents=true` and the stored `syncToken`.
  - A full sync covers -30 to +180 days (`CALENDAR_SYNC_WINDOW`; with `singleEvents=true` every daily series becomes one document per occurrence). A 410 response triggers a full resync.
  - Results go to `meetingRepository.upsertExternal` with provider `google`. Cancelled events become tombstones.
  - Events whose id decodes with `meetingIdFromGoogleEventId`, or that match `external.googleEventId`, update the existing meeting and keep its source.
  - Conflicts: the engine never sends an upsert for a meeting whose local push is still queued (the local change wins and is pushed). Otherwise a Google change is applied whenever Google's `updated` is newer than the stored `external.googleUpdatedAt`; `meeting.updatedAt` is **not** compared for provider `google`, because it also moves for MeetingGuard-only edits (alert times, notes) and ref write-backs. Device imports keep last-writer-wins on `updatedAt`.

**Device calendars** (expo-calendar **new object API**; never the root legacy functions, which throw):

- Import from `prefs.deviceCalendarImportIds`, with provider `device`. Calendars flagged `isGoogleAccount` are skipped while Google sync is on, to avoid duplicates.
- **Device-scoped ids.** Device calendar and event ids are stored as `d{deviceKey}.{rawId}`, where `deviceKey` is a random per-install key kept in `GLOBAL_STORAGE_KEYS.deviceCalendarKey` (`mg:device.calendarKey`, survives sign-out). Android ids are small integers that collide across phones, so without the prefix one device could edit another device's events. Ids of other devices are ignored. This applies to `DeviceCalendarInfo.id`, `prefs.deviceCalendarImportIds`, `prefs.deviceCalendarExportId` and `external.deviceEventId` / `external.deviceCalendarId`.
- Optionally export MeetingGuard meetings (not those with source `google` or `device`) to `prefs.deviceCalendarExportId`.
- **Export links are per device.** Every device can export the same meeting to its own calendar, so the location of THIS device's copy is kept locally (`DeviceSyncState.exportLinks`, meeting id -> raw event and calendar ids). The synced `external.deviceEventId` / `deviceCalendarId` are only a hint: written when free or already this device's, never overwritten with another device's ref and never cleared for another device. A copy without a local link (reinstall, sign-out wipe) is adopted through the hint or an exact title + start + end match in the export calendar instead of being duplicated. A device sync exports first, then imports, and the import skips this device's own copies.

Pulls happen on session start, on foreground (throttled), when connectivity returns, on `syncNow`, and in the background task. `syncNow` runs one sync at a time; calls made during a run are coalesced into one follow-up run (a settings change during a run is never lost). Each pull emits `calendar:synced`. Outlook and Microsoft Graph are not part of this pass.

## 8. AI pipeline (ai + functions)

```
useAssistant.send(text)
  -> assistantClient.send(AssistantRequest{messages, language, timezone, nowIso, mode, followUpMeetingId})
     httpsCallable(functions, 'assistant', { timeout: 70 s })   region = env.functionsRegion
  -> server: verified account required (email_verified or google.com); zod-validate;
     quota transaction on usage/{uid}/days/{UTC day}; project-wide daily cap
     (plan from entitlements/{uid}, default free; limits free 5 / pro 100 / premium 500);
     load the user's meetings (-7 d .. +60 d, not deleted; field mask + byte budget) as an UNTRUSTED
     delimited data message with refs and participant names; OpenAI (secret OPENAI_API_KEY via
     defineSecret, model param OPENAI_MODEL default "gpt-5.4-mini") with tool calling; map tool calls
     -> AiAction; validate with aiActionSchema; drop actions referencing unknown meeting ids; strip
     conference URLs not typed by the user; accept only typed emails or participants of the TARGET
     meeting (suggestion-chip messages never count as typed)
  <- AssistantResponse { reply, actions[], suggestions[], usage }
  -> the chat shows a confirmation card per action (actionExecutor.preview resolves the meetings);
     on confirm, actionExecutor.execute(action) runs meetingRepository.* with origin 'ai',
     googleCalendarService.createMeetLink, Google invites, the OS share sheet or mailto
```

- The server **never** mutates meetings.
- The confirmation card lists recipients / participants that are not on the meeting yet (warning `new_people`).
- Refunds only for failures before OpenAI did any work (never timeouts or bad requests).
- A follow-up request starts by itself only when the app's own follow-up notification opened the chat (`autoStart`, never parsed from a URL); an external `assistant?followup=` link shows a "Get follow-up ideas" button.
- Execution is idempotent per `action.id`: `mg:{uid}:assistant.executed`, plus `WriteOptions.id` on create.
- Errors use `HttpsError` with `details.reason` set to `quota_exceeded`, `unauthenticated`, `invalid_request` or `upstream_error`.
- Replies are bilingual: they follow `request.language` and the user's time zone.
- In follow-up mode, the post-meeting notification opens `AIChat` with `{ followup }`. The server loads that meeting and returns follow-up suggestions and actions.
- The `deleteAccount` callable requires a recent sign-in (`auth_time` within 5 minutes; the app re-authenticates the user first with `authService.reauthenticate()`), then does these steps in order (every step tolerates data or a user that is already gone, so a retry is safe):
  1. Revokes the user's refresh tokens, so no device can mint a new ID token (an offline device with queued writes can only write while its current ID token lives, at most one hour).
  2. Recursively deletes `users/{uid}`.
  3. Deletes `entitlements/{uid}`.
  4. Recursively deletes `usage/{uid}`.
  5. Deletes the auth user.
  6. Recursively deletes `users/{uid}` again, removing writes that raced in during steps 2-5.
  7. Returns `{ deleted: true }`.

## 9. Offline strategy (data area)

- **Firestore cache.** The React Native build of Firestore only has a memory cache. The data layer keeps its own per-user AsyncStorage cache and an **outbox** (`mg:{uid}:outbox`). Meetings and notes use one key per document (`mg:{uid}:meetings:{id}`, `mg:{uid}:notes:{id}`); preferences, entitlement and profile use `mg:{uid}:preferences|entitlement|profile`; device-local attachment metadata uses `mg:{uid}:attachments`.
- **Writes** go through these steps:
  1. Validate with the core builder.
  2. Apply to memory and cache.
  3. Emit the event.
  4. Append to the outbox.
  5. Resolve.
  6. Send to Firestore in the background.

  The UI never awaits a server acknowledgement. Ids are generated on the client (`doc(collection(...)).id` works offline).
- **Outbox flush** runs on session start, when connectivity returns (NetInfo), on foreground, and on `flushOutbox()`. Permanent rejections (permission or invalid) are dropped, logged and reported. Retryable failures stay queued.
- **Snapshots** merge into the cache. A document with a pending outbox write keeps its local version until the server acknowledges it (a note whose hard delete is pending is never resurrected by an older snapshot). Conflicts resolve last-writer-wins on `updatedAt`. Preferences merge field by field, so an offline change on one device and a change to a different field on another device are both kept.
- **Old-shape documents.** The security rules reject updates that change `source`, `createdAt` or `userId` and profiles with extra keys, so meetings saved by the pre-rebuild app are migrated by a delete followed by a create, and old profiles are rewritten with the allowed keys only (their client-written `plan` / `preferences` fields are captured locally first).
- **Repository details.** `findByExternalId` can return a tombstoned meeting (an active one is preferred) so imports restore instead of duplicating; `subscribe()` emits `[]` instead of throwing when signed out; `upsertExternal` also reports `invalid` (items rejected by validation); `create(input, { id })` returns an existing active meeting with that id and throws `conflict` for a tombstoned one.
- **Headless reads** (`getCachedUpcoming`, `getCached`) use AsyncStorage only.
- **Distinguish failure from empty.** A failure is an `AppError`; an empty list is a real empty list.

## 10. i18n

- **Setup.** i18next + react-i18next + expo-localization. Resources are bundled per namespace in `src/i18n/locales/{en,es}/{common,navigation,onboarding,data,auth,calendar,alerts,ai}.json`, and each area owns its own namespace file.
- **Keys are always namespace-qualified**, for example `t('alerts:max.title')`. The legacy `translations.test.js` treats unqualified dotted keys as `translations.jsx` keys and fails when they are missing there.
- **Pluralization.** Use `_one` / `_other`. `intl-pluralrules` is imported first in `index.js`.
- **Language.**
  - The default is the device language, persisted in `mg:language`.
  - `setLanguage` switches instantly and emits `language:changed`. For source `user`, the data layer writes `prefs.language`.
  - A remote change to `prefs.language` is applied with source `preferences`.
  - Alerts re-render pending notifications when the language changes.
- **Formatting.** `src/utils/format.ts` uses date-fns locales and a 12 h or 24 h clock from `prefs.use24HourClock`, falling back to the locale.
- **Error messages.** `common.json` has `errors.<AppErrorCode>` in EN and ES for every `APP_ERROR_CODES` entry.
- **Compatibility.** Legacy screens receive a `language` prop through module-level wrappers, and `translations.jsx`'s `useTranslation(language)` keeps working.

## 11. Error handling and logging conventions

- **Throw `AppError(code)`.** Never fake success. Never turn a failure into `[]` or null. Wrap external errors with `toAppError(e)`, which keeps `cause` and maps the provider code.
- **User-facing text** is `t(errorMessageKey(code))`. `cancelled` is not shown as an error.
- **Sentry.** `beforeBreadcrumb` (`scrubBreadcrumb`) drops the raw arguments of console breadcrumbs, strips query strings from HTTP breadcrumbs and email-scrubs messages.
- **Logging.** Use `createLogger('area')`:
  - `debug` and `info` are dev-only.
  - `warn` and `error` are always on, and `error` is also reported to Sentry.
  - Never log tokens, emails, meeting text, chat text or notification bodies.
- **No bare `console.log`** in new code (ESLint `no-console`).

## 12. Testing conventions

- Use Jest (`jest-expo`).
- Put pure logic in pure modules with `__tests__/*.test.ts` next to them, for example `computeAlertPlan`, mappers, the outbox reducer, Google and device event mapping, the action executor with mocked repositories, and the i18n key parity between EN and ES.
- Mock Firebase, Expo native modules and GoogleSignin inside each test file with `jest.mock`. `App.test.js` shows the Firebase stubs. Tests must not need network or `EXPO_PUBLIC_*` values.
- `src/core/conformance.ts` must keep compiling (`npx tsc --noEmit`).
- The checks are `npx tsc --noEmit`, `npm run lint`, `npm test`, and `npx expo export --platform android --output-dir <scratch>`.

## 13. Compat shims to remove in stage 3

The legacy modules below keep their export names as thin shims over the new services, so the stage-3 screens keep bundling. A shim that cannot be supported must throw a typed `AppError` (`unsupported`); it must not fake success. All shims return `toLegacyMeetingView` / `toLegacyPreferencesView` shapes (`src/core/legacy.ts`).

| Legacy module | Kept exports, delegating to the new services | Owner |
|---|---|---|
| `src/api/entities.js` | `Meeting.{list,get,create,update,delete}`; `UserPreferences.{filter→[view],create,update}` (`delete` throws `unsupported`); `Note.*`; `User.{me,signIn,signOut}`; `ApiKey.*` | data |
| `src/api/localStorage.js`, `src/services/firestoreService.js`, `src/utils/storage.js`, `src/utils/meetingHelpers.js`, `src/utils/index.ts` (imported with the `.ts` extension), `src/api/fileUpload.js` (expo-file-system `/legacy` or the new API), `src/api/emailService.js` (no fake sends) | as used by the screens (`localStorageAPI.clearAllMeetings` must not fake success) | data |
| `src/contexts/AuthContext.jsx` | `AuthProvider`, `useAuth` (re-exports) | auth |
| `src/services/firebaseAuth.js`, `src/hooks/useGoogleAuth.js`, `src/api/googleTokenManager.js`, `src/api/manualLoginGoogleCalendarService.js` | `useGoogleAuth()` returns `{ user, isSignedIn, isLoading, signIn, signOut }`; `manualLoginGoogleCalendarService.isConnected()` | auth |
| `src/api/googleCalendar.js` (default export: `initialize`, `checkCalendarAccess`, `getCalendarInfo`, ...; `getTodayMeetings` / `getUpcomingMeetings` and manual event writes reject with `unsupported` because Google events are part of the meetings list), `src/api/calendarSyncManager.js` (`setCallbacks` is a no-op because alerts are event-driven; `syncEventToGoogle(id)`, `initialize`), `CalendarSyncSettings.jsx`, `GoogleCalendarConnectionPrompt.jsx`, `pages/CalendarSync.jsx` | as used | calendar |
| `src/components/AlertScheduler.jsx` (ref API `scheduleAlertsForMeeting`, `clearAlertsForMeeting`, `refreshAlerts` → `alertEngine.reconcile`), `NotificationSystem/NotificationManager.jsx` (props `meeting`, `isOpen`, `onClose`, `onSnooze`, `onPostpone`, `alertType`, `intensity`, `language`), `hooks/usePersistentNotification.js` | as used | alerts |
| `src/components/translations.jsx` (`useTranslation(language)`), `CustomHeader.jsx` / `MobileSidebar.jsx` (`language`, `onLanguageToggle`, `setLanguage` props) | as used | i18n-nav |
| `MeetingConfirmationModal.jsx`, `ConfidenceBadge.jsx`, `SourceBadge.jsx` (accept both the new keys and the legacy labels) | as used | ai |

Deleted in stage 2 (no importers left): `googleCalendarConnectionManager.js`, `googleCalendarReconnectService.js`, `googleCalendarInitializer.js`, `EnhancedNotificationManager.js`, `LocalNotificationScheduler.js`, `BackgroundTaskManager.native.js`, `NotificationPermissions.js`, `PersistentNotificationService.js`, `FloatingWidgetManager.js`, `FloatingMeetingWidget.jsx`, `FloatingWidgetContainer.jsx`, `NotificationSystem/{MaximumAlert,MediumAlert,LightAlert}.jsx`, `utils/notificationUtils.js`, `api/meetingManager.js`, `api/openai.js`, `utils/movedToServer.ts`, `config/api.js`, `assets/alert-sound.mp3`.

The legacy `UserPreferences.update` never takes `google_calendar_sync_enabled` or `onboarding_completed` from the screen's (possibly stale) view: those fields belong to the calendar connect/disconnect and onboarding flows.

## 14. Deferred (not in this pass)

- Outlook and Microsoft Graph
- Recurring-meeting creation. Google recurring events are imported as single instances.
- WhatsApp bot
- Full-screen intent
- A native module to read the exact-alarm state
- Home-screen widgets
- Billing and IAP; entitlements are written only by server or admin tooling
- Sign in with Apple, which is required before iOS App Store submission
