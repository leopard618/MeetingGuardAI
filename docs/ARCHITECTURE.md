# MeetingGuard AI architecture (stage 3: TypeScript app)

The source of truth for types and contracts is the code in `src/core/`. This document explains how the pieces fit together. If the two ever disagree, the code wins; fix the document.

- `src/core/types.ts`: domain types, zod schemas and pure builders
- `src/core/aiContract.ts`: the callable contract shared with `/functions`
- `src/core/contracts.ts`: service interfaces, module map, navigation params, lifecycle
- `src/core/identifiers.ts`: every persistent id, key and path
- `src/core/events.ts`: the typed event bus
- `src/core/errors.ts`, `src/core/logger.ts`, `src/core/time.ts`
- `src/core/conformance.ts`: compile-time checks that every module exports what the contracts promise

## 1. Layers

```
L7  entry / UI     index.js, App.js, src/navigation, src/screens, src/components, src/contexts,
                   src/hooks, src/services/alerts/tasks.ts (headless)
L6  session        src/services/auth (barrel): sessionManager, AuthProvider, useAuth
L5  ai             src/services/ai
L4  calendar       src/services/calendar          alerts engine   src/services/alerts
                   attachments   src/services/attachments (device-local files)
L3  identity       src/services/auth/authService.ts (Google/Firebase identity + Google tokens)
L2  data           src/services/data (repositories, cache, outbox, React hooks)
L1  config, i18n   src/config/firebase.ts, src/config/env.ts, src/i18n, src/utils/format.ts,
                   src/services/sentry.ts, src/services/updates.ts (OTA state),
                   src/services/billing.ts (plan catalog)
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
| auth | `src/services/auth/authService.ts` (`authService`); `src/services/auth` (`authService`, `sessionManager`, `AuthProvider`, `useAuth`) | auth |
| calendar | `src/services/calendar` (`googleCalendarService`, `deviceCalendarService`, `calendarSyncEngine`, `useCalendarStatus`); `src/services/calendar/outlook` (`outlookCalendarService`, §17) | calendar |
| alerts | `src/services/alerts` (`alertEngine`, `computeAlertPlan`, `usePendingAlerts`); `src/services/alerts/fsi.ts` (`fullScreenAlarm`, §18); `src/services/alerts/tasks.ts` (`registerBackgroundTasks`, `unregisterBackgroundTasks`, plus the module-scope task definitions); `src/components/alerts` (`AlertHost`) | alerts |
| i18n + navigation | `src/i18n` (`i18n`, `initI18n`, `t`, `getLanguage`, `setLanguage`, `SUPPORTED_LANGUAGES`, `I18N_NAMESPACES`, `I18nProvider`, `useT`, `useLanguage`); `src/utils/format.ts`; `src/navigation` (`navigationRef`, `navigate`, `openDeepLink`, `isNavigationReady`, `linking`, `RootNavigator`, `ROUTES`); `src/screens/onboarding` | i18n-nav |
| ai | `src/services/ai` (`assistantClient`, `actionExecutor`, `useAssistant`) | ai |
| zoom | `src/services/zoom` (`zoomService`, `useZoomStatus`); `functions/src/zoom` (zoom* callables, §24) | zoom-app / zoom-server |
| attachments | `src/services/attachments` (`attachmentService`, `useMeetingAttachments`); metadata in the data layer's `attachmentStore` | notes |
| shell | `src/contexts/ThemeContext.tsx` (`ThemeProvider`, `useTheme`, `useAppThemes`), `src/components/{CustomHeader,MobileSidebar,ThemeToggle,ErrorBoundary,AppToast}.tsx`, `src/hooks/useResponsive.ts` | shell |
| screens | `src/screens/<area>` (one folder per screen group, §13); `src/screens/shared` (`useFormatters`, `Section` / `ScreenBody`, `MeetingStatus`, `useLiveNow`, `useKeyboardAvoidance`, `useDiscardChangesGuard`, `text`) | screen groups |
| release | `src/services/updates.ts` (OTA state), `app.config.js` (`updates`, `runtimeVersion`), `eas.json` channels, `docs/DEPLOYMENT.md` | release |
| widget | `modules/mg-next-meeting-widget` (local Expo module), `src/services/widget` (`registerWidgetFeeder`, `refreshWidget`, `widgetStringsOf`, `computeNextWidgetEntry`), i18n namespace `widget` (§19) | widget |
| billing | `src/services/billing.ts` (catalog), `src/services/purchases` (`purchasesService`), `functions/src/revenuecat` (webhook), `src/screens/pricing`, i18n namespace `pricing` (§20) | billing |
| admin | `public/admin` (build-free web app), `functions/src/admin` (callables), `functions/scripts/set-admin-claim.mjs`, `docs/ADMIN.md` (§21) | admin |
| functions | `functions/src/index.ts` (`assistant`, `deleteAccount`, scheduled `dailyMaintenance`); `functions/src/shared/aiContract.ts` is a **verbatim** copy of `src/core/aiContract.ts`, and CI diffs the two; `firestore.rules`, `firestore.indexes.json`, `firebase.json` | functions |

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
| `source` | `manual\|ai_chat\|whatsapp\|google\|device\|outlook`. |
| `confidence` | 0-100 or null. |
| `language` | `en\|es`. |
| `preparationTips[]` | |
| `customAlertTimes` | Minutes-before offsets, or null to use the preference defaults. |
| `alertIntensity` | Override of the preference, or null. |
| `notes` | |
| `status` | `scheduled\|cancelled`. |
| `external` | `{ googleEventId, googleCalendarId, googleEtag, googleUpdatedAt, deviceEventId, deviceCalendarId, outlookEventId, outlookCalendarId, outlookChangeKey, outlookUpdatedAt, zoomMeetingId }` (the outlook and zoom keys are stored sparsely, §16/§17/§24) |
| `recurrence`, `recurrenceOverrides`, `seriesId` | Recurring meetings (§16); null for one-offs and stored sparsely. |
| `createdAt`, `updatedAt` | |
| `deletedAt` | Tombstone for soft delete. A tombstone keeps only what sync needs (ids, source, status, time slot, external refs, timestamps): title becomes `TOMBSTONE_TITLE`, and description, notes, participants, conference, location, tips and alert settings are cleared (`tombstoneMeeting` / `scrubMeetingContent`). Tombstones older than `TOMBSTONE_RETENTION_DAYS` (60) are hard-deleted, and older content-carrying tombstones are scrubbed, once per session after the first server snapshot. The scheduled `dailyMaintenance` function also hard-deletes them on the server (users who never open the app again). |

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
| `accountDeletions/{uid}` | `{ deletedAt }` (ISO), written by `deleteAccount`, purged after 30 days | **none** (server only; used to re-apply deletions after a backup restore) |
| everything else | | deny |

The app's queries use single-field indexes only (`startAt`). `firestore.indexes.json` adds one field override: a collection-group index on `meetings.deletedAt` for the server's tombstone purge.

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
  0. Records the deletion in `accountDeletions/{uid}` (after a Firestore restore, `functions/scripts/replay-account-deletions.mjs` deletes those accounts' documents again; DEPLOYMENT §7).
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
- **Outbox flush** runs on session start, when connectivity returns (NetInfo), on foreground, and on `flushOutbox()`. Permanent rejections (permission or invalid) are dropped, logged and reported, with one exception: a `permission_denied` on a meeting write that carries phase-1 fields (recurrence / Outlook, stored sparsely) most likely means the deployed rules predate phase 1, so it stays queued and retries (bounded by the send-attempt limit) instead of being rolled back. Retryable failures stay queued.
- **Snapshots** merge into the cache. A document with a pending outbox write keeps its local version until the server acknowledges it (a note whose hard delete is pending is never resurrected by an older snapshot). Conflicts resolve last-writer-wins on `updatedAt`. Preferences merge field by field, so an offline change on one device and a change to a different field on another device are both kept.
- **Old-shape documents.** The security rules reject updates that change `source`, `createdAt` or `userId` and profiles with extra keys, so meetings saved by the pre-rebuild app are migrated by a delete followed by a create, and old profiles are rewritten with the allowed keys only (their client-written `plan` / `preferences` fields are captured locally first).
- **Repository details.** `findByExternalId` can return a tombstoned meeting (an active one is preferred) so imports restore instead of duplicating; `subscribe()` emits `[]` instead of throwing when signed out; `upsertExternal` also reports `invalid` (items rejected by validation); `create(input, { id })` returns an existing active meeting with that id and throws `conflict` for a tombstoned one.
- **Headless reads** (`getCachedUpcoming`, `getCached`) use AsyncStorage only.
- **Distinguish failure from empty.** A failure is an `AppError`; an empty list is a real empty list.

## 10. i18n

- **Setup.** i18next + react-i18next + expo-localization. Resources are bundled per namespace in `src/i18n/locales/{en,es}/<namespace>.json` and registered in `src/i18n/resources.ts`; the list is `I18N_NAMESPACE_LIST` in `contracts.ts`. Each area owns its namespace files:

  | Namespaces | Owner |
  |---|---|
  | `common` (actions, language names, formatting words, session prompts, consent, `errors.<AppErrorCode>`), `navigation` (route titles), `onboarding` | i18n-nav |
  | `data`, `auth`, `calendar`, `alerts`, `ai` | service areas |
  | `settings`, `meetings` | stage-2 screens |
  | `home`, `insights` | home |
  | `calendarView`, `create` (and `meetings` list/actions keys) | meetings |
  | `notes`, `attachments` | notes |
  | `shell`, `landing`, `legal`, `pricing` | shell (`pricing` content changes in §20 belong to billing) |
  | `widget` | widget (§19; strings are passed to the native side pre-localized) |

- **Keys are always namespace-qualified**, for example `t('alerts:max.title')`. There are no unqualified keys and no namespace-bound translators.
- **Tests.** `src/i18n/__tests__/resources.test.ts` fails when a key exists in one language only, or a value is empty. `src/i18n/__tests__/keysUsed.test.ts` scans every source file and fails when a key literal (static, or the static part of a dynamic `ns:a.b.${x}` key) is missing in EN or ES, or when `t()` gets an unqualified key. `src/navigation/__tests__/routeTitles.test.ts` keeps route titles and sidebar labels in step with `ROUTES`.
- **Pluralization.** Use `_one` / `_other`. `intl-pluralrules` is imported first in `index.js`.
- **Language.**
  - The default is the device language, persisted in `mg:language`.
  - `setLanguage` switches instantly and emits `language:changed`. For source `user`, the data layer writes `prefs.language`.
  - A remote change to `prefs.language` is applied with source `preferences`.
  - Alerts re-render pending notifications when the language changes.
  - Every screen reads the live language itself (`useT`, `useLanguage`); nothing is passed down as a prop.
- **Formatting.** `src/utils/format.ts` uses date-fns locales and a 12 h or 24 h clock from `prefs.use24HourClock`, falling back to the locale. Screens use `src/screens/shared/useFormatters` (bound to the live language and the clock preference). Week start follows the language (Sunday for English, Monday for Spanish).
- **Error messages.** `common.json` has `errors.<AppErrorCode>` in EN and ES for every `APP_ERROR_CODES` entry.
- **Exception.** `src/components/NotConfiguredScreen.tsx` (shown when the build has no `EXPO_PUBLIC_*` configuration) is bilingual with fixed text on purpose: no service, i18n included, is started on that path.

## 11. Error handling and logging conventions

- **Throw `AppError(code)`.** Never fake success. Never turn a failure into `[]` or null. Wrap external errors with `toAppError(e)`, which keeps `cause` and maps the provider code.
- **User-facing text** is `t(errorMessageKey(code))`. `cancelled` is not shown as an error.
- **Sentry.** `beforeBreadcrumb` (`scrubBreadcrumb`) drops the raw arguments of console breadcrumbs, strips query strings from HTTP breadcrumbs and email-scrubs messages.
- **Logging.** Use `createLogger('area')`:
  - `debug` and `info` are dev-only.
  - `warn` and `error` are always on, and `error` is also reported to Sentry.
  - Never log tokens, emails, meeting text, chat text or notification bodies.
- **No `console.*`** outside `src/core/logger.ts` (ESLint `no-console`; config, Firebase, Sentry and the event bus log through `createLogger` too).

## 12. Testing conventions

- Use Jest (`jest-expo`).
- Put pure logic in pure modules with `__tests__/*.test.ts` next to them, for example `computeAlertPlan`, mappers, the outbox reducer, Google and device event mapping, the action executor with mocked repositories, and the i18n key parity between EN and ES.
- Mock Firebase, Expo native modules and GoogleSignin inside each test file with `jest.mock`. `App.test.js` shows the Firebase stubs. Tests must not need network or `EXPO_PUBLIC_*` values.
- `src/core/conformance.ts` must keep compiling (`npx tsc --noEmit`).
- Every screen has a render test (React Native Testing Library, hooks mocked) and its non-trivial logic lives in a pure model with unit tests (`homeModel`, `meetingInsights`, `meetingListModel`, `calendarModel`, `notesModel`, `chatModel`, `calendarSyncModel`, `pricingModel`, `meetingForm`, `legalContent`).
- The checks are `npx tsc --noEmit`, `npm run lint` (0 warnings; the React Compiler hook rules `react-hooks/immutability`, `refs`, `purity` and `set-state-in-effect` are enabled at their recommended level), `npm test`, and `npx expo export --platform android --output-dir <scratch>`.

## 13. Screens (stage 3: everything is TypeScript)

Every screen is strict TypeScript under `src/screens`, registered at module level in `src/navigation/screens.tsx` under the original route names (links, the sidebar and notifications keep working). There is no JavaScript in `src/` and no compatibility layer: screens use the service hooks directly. Common rules: text through i18next (EN + ES), dates and times through `useFormatters` (a date that starts a header or line goes through `capitalizeFirst`), colors from the Paper theme or `useTheme().colors` (light / dark), `FlatList` / `SectionList` for lists, safe-area insets, accessibility roles and labels on touchables and switches, loading / empty / error states (a load failure with nothing cached shows the error with Retry, never an empty state next to it), `createLogger` instead of `console`, and no fake data or fake success.

Shared screen pieces (`src/screens/shared`):

- `ScreenBody` (forms and settings) keeps the focused field above the keyboard: a KeyboardAvoidingView with the offset measured by `useKeyboardAvoidance` on Android (edge-to-edge, the window is not resized), `automaticallyAdjustKeyboardInsets` on iOS. The assistant chat uses the same hook.
- `useDiscardChangesGuard(dirty, { busy })` (`usePreventRemove`): Back with unsaved changes asks "Discard changes?"; the screen calls `allowLeave()` after a successful save. Used by the meeting form and alert settings (the note editor has its own prompt).
- `useLiveNow(ms)`: the clock for countdowns and relative times; it pauses while the screen is not focused or the app is in the background.
- Only the stack header draws a screen's title and back arrow; screens do not repeat them.

| Screen (file) | Route(s) | Namespaces | Notes |
|---|---|---|---|
| `home/DashboardScreen` | `Dashboard` | `home` | Greeting, offline banner (unsynced count from the data layer), next meeting with a focus- and foreground-aware countdown, quick actions (WhatsApp shown as "coming soon"), today's timeline, alert card (permission, exact alarms, DND hint), on-device insights summary; pull to refresh = meetings refresh + calendar sync. |
| `insights/AIInsightsScreen` | `AIInsights` (title "Insights" / "Resumen") | `insights` | Week / month statistics computed on the device (`meetingInsights.ts`); optional AI suggestions through the shared assistant thread after an explicit quota notice. A load failure shows the error with Retry. |
| `meetings/list/MeetingsListScreen` | `TotalMeetings` | `meetings` (`list.*`, `actions.*`) | Day-grouped `SectionList` in the device zone, accent-insensitive search, upcoming / past / all and source filters, confirm-before-delete with the real calendar effect. |
| `calendar/CalendarScreen` | `Calendar` | `calendarView` | 6-week month grid with per-source dots and spoken day labels; "New meeting on <day>" opens `CreateMeeting { date }`. |
| `create/ChooseCreationMethodScreen` | `ChooseCreationMethod` | `create` | Manual form, assistant (notes the daily AI quota), WhatsApp disabled ("coming soon"). |
| `meetings/MeetingDetailsScreen` | `MeetingDetails { meetingId }` | `meetings` | Live meeting (deep links included); attachments section. A Google Meet meeting without a link says the link comes from the Google Calendar sync only when Google Calendar is connected; otherwise it offers "Connect Google Calendar". |
| `meetings/MeetingFormScreen` (`meetingForm.ts`) | `CreateMeeting { date? }`, `EditMeeting { meetingId }` | `meetings` | Links are only what the user pastes; Google Meet without a link is saved as `{ provider: 'google_meet', url: null }` so the Google push creates a real link; device-local attachments. Every change applies on Save only: files picked here stay unlinked until Save (deleted on Discard), saved files removed with X are deleted on Save; the attachment list is read once per meeting id, so live meeting updates never drop picked files. Discard prompt on Back. |
| `notes/NotesScreen` | `Notes` | `notes` | Notes through `useNotes()` (offline outbox); pinned first; search; categories; full-screen editor with meeting link and discard prompt. |
| `attachments/MeetingAttachmentsSection` | (inside MeetingDetails) | `attachments` | Files copied into the app's document folder, never uploaded; 50 MB limit; cleanup on sign-out, meeting deletion and after 24 h for unlinked files. |
| `assistant/AssistantScreen` | `AIChat { followup?, prefill?, autoStart? }` | `ai` | Chat thread, action cards, `MeetingConfirmationModal` (nothing runs without confirmation), usage pill, errors with Retry / See plans. |
| `calendarSync/CalendarSyncScreen` | `CalendarSync` | `calendar` | Google connect / reconnect / stop (optionally revoke), phone calendars (permission, import switches, export target), "Sync now" with the real per-provider result. Title and back arrow come from the stack header. |
| `settings/SettingsScreen` | `Settings`, `Profile` | `settings` | Account (in-app deletion with a fresh sign-in), alerts, theme, language, time format (automatic / 12 h / 24 h, `timeFormat.ts`, saved at once), calendars, legal, version and the running OTA update. |
| `alerts/AlertSettingsScreen` | `AlertSettings` | `alerts`, `onboarding` | Every alert preference after onboarding (form shared with onboarding step 3); Save applies, Back with changes asks first. |
| `auth/LandingScreen` | `Landing` | `landing` | Value props that match the app, the free quota from `PLAN_DAILY_AI_LIMITS`, Google sign-in (cancel is not an error), secondary "Continue with email" button (§25), language switch, Terms / Privacy links. |
| `auth/EmailAuthScreen` | `EmailAuth` | `auth` | Email/password sign-in and account creation with inline password reset (§25); reached from Landing only. |
| `legal` (`legalContent.ts`, `LegalDocumentScreen`) | `Privacy`, `Terms` (standalone variants outside Main) | `legal` | Complete EN / ES texts. `LEGAL_ENTITY` and `legal:jurisdiction` are marked placeholders to fill before release. |
| `pricing/PricingScreen` (`pricingModel.ts`) | `Pricing` | `pricing` | Catalog from `src/services/billing.ts` ($7.99 / $14.99, 25% off yearly); current plan from the entitlement; "subscriptions coming soon", no purchase or external links. |
| `onboarding/*` | `Onboarding*` | `onboarding` | Stage 2 (§5). |

**App shell (owner: shell).** `ThemeContext.tsx`: the saved choice (`system` / `light` / `dark`; the old `theme` key is migrated once); `useTheme()` returns `{ themeMode, setThemeMode, colorScheme, isDarkMode, toggleTheme, isLoaded, colors }`, and `useAppThemes()` gives `AppRoot` the matching Paper theme, React Navigation theme and status-bar style. `CustomHeader` shows a back arrow when the stack can go back, the live EN/ES switch, the theme toggle and the menu. `MobileSidebar` items are typed Main routes. `ErrorBoundary.tsx` reports through the logger (Sentry) and renders a localized, theme-aware fallback; it wraps the whole app (scope `app`) and, as the root stack's `screenLayout`, every screen (scope `screen`: only the failed screen is replaced and the header keeps working). The crash reporter is registered when `AppRoot` loads. Toasts use the `AppToast` layouts (`toastConfig`): themed, and they wrap instead of cutting the text to one line.

**Navigation params.** `MeetingDetails` and `EditMeeting` take `{ meetingId }` (required); `CreateMeeting` takes an optional `{ date }` ("YYYY-MM-DD", device zone). Screens pass ids, never meeting objects.

**Session in screens.** `useAuth()` returns `AuthContextValue` (`contracts.ts`: `status`, `isAuthenticated`, `authUser`, `entitlement` (plan via `effectivePlan()`), `hasCalendarScope`, `signInWithGoogle`, `signInWithEmail`, `signUpWithEmail`, `signOut`, `requestCalendarScope`, `deleteAccount`) plus the auth area's extensions in `AuthContextValueImpl` (`src/services/auth/AuthProvider.tsx`: `reauthenticate`, `requestCalendarAccess`, `calendarConnected`, `sessionError`, `sendPasswordReset`). Screens sign out through `useSignOutFlow()` (`src/navigation/useSignOut.ts`), which handles the `pending_writes` confirmation. The list of files removed during the rebuild is in `CHANGELOG.md`.

**What stays for pre-rebuild data** (data migration only): `src/services/data/legacyInput.ts` reads the v1.0.9 AsyncStorage blob (`migrateLegacyLocalData`, run once per account) and old-shape Firestore documents (`mapping.ts`); `legacyPurge.ts` deletes the old plaintext tokens at every start; `relinkLegacyAttachments` adopts old attachment metadata; `ThemeContext` migrates the old `theme` key.

## 14. Deferred (not in this pass)

- WhatsApp bot
- Sign in with Apple, which is required before iOS App Store submission
- Pushing time-modified occurrence overrides to Google/Outlook (kept local; §16)
- iOS widget (§19 is Android-only), iOS billing (§20 ships Android/Play products only)

Moved out of this list by the phase-1 contracts: recurring meetings (§16), Outlook (§17),
full-screen intent + exact-alarm state via the local module (§18). Moved out by the phase-2
contracts: "this and following" edits / series splitting (§16), the Android home-screen widget
(§19), billing/IAP via RevenueCat (§20; entitlements stay server-written - now by the webhook
and admin callables) and the admin dashboard (§21).

## 15. Releases and OTA updates

- `expo-updates` with EAS Update: `updates.url` is the project's `u.expo.dev` URL, `runtimeVersion` uses the `appVersion` policy (an update only reaches binaries with the same `version`), `checkAutomatically: ON_LOAD` and `fallbackToCacheTimeout: 0` (the launch never waits for the network; a downloaded update runs from the next cold start).
- Each `eas.json` build profile listens to its own channel (`development`, `preview`, `production`). `npm run update:preview -- "message"` / `npm run update:production -- "message"` publish with the matching EAS environment, so the `EXPO_PUBLIC_*` values are bundled.
- A native change (new native module, permission, plugin option, SDK upgrade) needs a new `version` and a store build, never an OTA update.
- `src/services/updates.ts` reads the running update; Settings shows its short id and channel. A downloaded update that crashes on start is marked failed by expo-updates' error recovery, which relaunches the previous update (`isEmergencyLaunch` stays false); the signal for a bad OTA update is new Sentry crashes grouped by the tag `expo.updates.update_id`. An "emergency launch" means the update store itself could not be used (the embedded bundle runs); Sentry's Expo integration reports it (tag `expo.updates.emergency_launch`), and the app only logs a warning.
- Release checklist, rollback, backups and the Firebase side: `docs/DEPLOYMENT.md`. Project setup: `docs/SETUP.md`. Tests and the device plan: `docs/TESTING.md`. Open work and decisions: `docs/HANDOFF.md`.

## 16. Recurring meetings (phase 1)

The model is in `src/core/recurrence.ts` (pure, exhaustively unit-tested; no rrule dependency)
and `types.ts`. One stored document per series (the **master**); occurrences are **never stored**.

- `Meeting.recurrence` (`recurrenceRuleSchema`, shared verbatim with the AI contract):
  `{ freq daily|weekly|monthly, interval >= 1, byWeekday? (weekly, MO..SU, weeks start Monday),
  byMonthDay? (monthly, 1-31; months without that day are skipped), until (inclusive UTC instant)
  | count (total occurrences incl. the first), all fields present and nullable }`. The master's own
  `startAt`/`date`/`time` is the first occurrence; the rule runs in the MEETING's timezone.
- `Meeting.recurrenceOverrides`: `{ [localDateKey]: { status 'cancelled' | 'modified', startAt,
  durationMinutes, title } }`, keyed by the occurrence's ORIGINAL local date in the meeting's zone.
  `Meeting.seriesId` = the master's id (v1), null for one-offs.
- `expandOccurrences(meeting, windowStart, windowEnd, { max })` returns
  `{ occurrenceId = "{meetingId}:{localDateKey}", meetingId, localDateKey, startAt, endAt,
  durationMinutes, title, overridden }`, DST-safe: each occurrence is derived from wall-clock
  date+time via `zonedDateTimeToUtcIso`, so a 09:00 meeting stays at 09:00 across DST and the
  result is independent of the device zone. Cancelled occurrences are omitted; `count` is consumed
  by cancelled ones; a modified occurrence sorts and windows by its EFFECTIVE time.
- **Edit scopes**: `'occurrence'` writes an override (repository ops `updateOccurrence` /
  `cancelOccurrence` / `restoreOccurrence`, `MeetingRecurrenceOps` in contracts.ts);
  `'series'` is a plain update/remove of the master; `'following'` splits the series (below).
- **"This and following" (scope v2).** The pure math is `splitRecurrenceAt(meeting, fromDateKey)`
  in `src/core/recurrence.ts` (unit-tested; `fromDateKey` = the FIRST affected occurrence's
  ORIGINAL local date):
  - **Master truncation:** `rule.until` becomes 1 second before the split occurrence's ORIGINAL
    start (inclusive-until keeps every earlier occurrence); a `count` rule is CONVERTED to
    `until` (count is always null afterwards). Overrides with keys before the split date stay.
  - **Tail series:** a NEW meeting (new id; `seriesId` = the new id - series identity is not
    shared across the split) with `startAt` = the split occurrence's original start, every
    content field copied from the master, overrides with keys >= the split date moved over
    (including a 'modified' override ON the split date - it stays an override), and the
    remaining rule: `until` rules keep their `until`; `count` rules keep `count - occurrences
    generated before the split` (cancelled ones consume count); endless stays endless.
  - **Edge cases:** a split at the FIRST original occurrence returns `'series_edit'` (callers
    apply a plain series update / remove; `editFollowing` then returns `created: null`,
    `deleteFollowing` resolves null). A date the series never generates, or one past the
    rule's end, throws `AppError('invalid_input')`.
  - **Repository ops** (`MeetingRecurrenceOps`): `editFollowing(id, fromDateKey, patch,
    options?) -> { master, created }` writes the truncated master and creates the tail with
    `patch` applied to it (full MeetingPatch surface - it edits a series master);
    `deleteFollowing(id, fromDateKey, options?) -> Meeting | null` only truncates. Both emit
    `meetings:changed` for every written id with the caller's origin (`user` / `ai`).
  - **External calendars:** the split IS two ordinary local writes, so the existing Google push
    handles it: the old event gets a PATCH with the truncated RRULE (`UNTIL=...`) and the tail
    is INSERTED as a brand-new series event (`googleEventIdForMeeting(newId)`). Expected Google
    result: the original series ends the day before the split, a new independent series starts
    at it; EXDATEs follow the override partition. A Google-side edit of either event keeps
    syncing to its own local meeting. Outlook: unchanged - recurring meetings are never pushed
    to Graph (§17), so neither side of the split appears in Outlook.
  - **UI:** the occurrence/series choice dialogs (`src/screens/meetings/list/meetingActions.tsx`)
    gain the third option `meetings:actions.scopeFollowing`; a "following" EDIT uses the
    occurrence sheet surface (title/date/time/duration -> `editFollowing` patch), the full form
    stays series-only.
- **Sparse storage:** `toMeetingDoc` leaves `recurrence`, `recurrenceOverrides`, `seriesId` (and
  the `external.outlook*` refs) out while null, so documents written by this app version keep
  passing the PREVIOUS deployed rules; `parseMeetingDoc` fills nulls back in and drops overrides
  whose rule is gone. The updated `firestore.rules` must allow these keys before any recurring
  meeting can sync.
- **Alerts:** the planner expands recurring masters over the horizon (+ the longest alert offset)
  and emits occurrence items with ids `mg:{meetingId}:{localDateKey}:{offsetMin}` and
  `mg:{meetingId}:{localDateKey}:followup` (`occurrence*NotificationId` in identifiers.ts; the
  parser handles 3- and 4-part ids, so the reconcile diff needs no change). One-off meetings keep
  their existing 3-part ids; snooze stays one per meeting.
- **Device-calendar export:** recurring masters are NEVER exported to a phone calendar (the
  export writes single plain events; a series would freeze its first occurrence and go stale).
  A copy exported before the meeting became recurring is removed by the next export sync.
- **Google mapping** (`toGoogleRecurrence` / `parseGoogleRecurrence`): masters push
  `event.recurrence` = one RRULE line (v1 subset) plus one EXDATE line per CANCELLED override
  (`EXDATE;TZID=<meeting tz>:<local date-time>` for timed series; all-day series use DATE values,
  `EXDATE;VALUE=DATE:<yyyymmdd>` and a date-only UNTIL, as RFC 5545 / Google require for all-day
  events). An off-pattern anchor date (weekly rule without the anchor's weekday, monthly rule
  with a different day) gets an EXDATE too: Google renders DTSTART as an instance while
  `expandOccurrences` skips it. Time-modified overrides are NOT pushed (documented limitation; the
  occurrence keeps `overridden: true` locally). Import keeps `singleEvents=true`, with one rule:
  instances whose `recurringEventId` decodes via `meetingIdFromGoogleEventId` (an `mgev...` id)
  are OUR pushed series - skip importing them (the local master already expands them). Removing
  the repeat from a synced series pushes `recurrence: []`, which clears Google's RRULE (a PATCH
  keeps fields it does not mention), so no phantom series is left in Google Calendar.
- **AI contract v2** (additive): drafts/changes gain optional `recurrence`;
  `update_meeting`/`delete_meeting` gain optional `{ scope: 'occurrence'|'series',
  occurrenceDate }` (occurrence scope limits changes to startAt/durationMinutes/title). Old
  clients strip the unknown fields; old servers simply never send them.
- **AI contract v3** (`AI_CONTRACT_VERSION = 3`, additive): scope gains `'following'`;
  `occurrenceDate` doubles as the split date and is required for it. A 'following' update
  allows the FULL change surface (the executor calls `editFollowing` and the patch lands on the
  tail master); a 'following' delete calls `deleteFollowing`. The executor ignores the scope on
  one-off meetings exactly like 'occurrence'. The assistant tool schemas / prompt / mapping in
  `functions/src/assistant/{tools,prompt,actions}.ts` describe the new scope with the same
  validation (occurrence_date required, invalid dates dropped like v2 does for 'occurrence').

## 17. Outlook calendar (Microsoft Graph)

Contract: `OutlookCalendarService` + `MICROSOFT_OAUTH` in `src/core/contracts.ts`; implementation
in `src/services/calendar/outlook/` (api/mapping/sync/service mirror the Google provider; without
`EXPO_PUBLIC_MSAL_CLIENT_ID`, `isConfigured()` is false, the whole UI is hidden and the engine
does not register the provider). The Microsoft account is independent of the app's
Google/Firebase identity. v1 limitations (documented): MeetingGuard recurrence rules and meetings
imported from Google/device calendars are never pushed to Graph, and a Teams link is only created
with the event (Graph cannot reliably turn an existing event into a Teams meeting here). When a
one-off that was already pushed to Outlook gains a recurrence rule, the push DELETES the Graph
event and clears the `external.outlook*` refs - a stale single event must not linger in Outlook,
and an Outlook-side edit of it must not rewrite the local series anchor. Removing the rule again
re-pushes the meeting as a one-off.

- **Auth:** expo-auth-session PKCE against
  `https://login.microsoftonline.com/{EXPO_PUBLIC_MSAL_TENANT||'common'}/v2.0`, scopes `openid
  profile offline_access User.Read Calendars.ReadWrite`, redirect
  `meetingguardai://auth/microsoft` (`MS_AUTH_REDIRECT_PATH`; navigation ignores it). Client id:
  optional `EXPO_PUBLIC_MSAL_CLIENT_ID` (absent => Outlook hidden). ONLY the refresh token is
  persisted, in expo-secure-store under `SECURE_STORE_KEYS.microsoftRefreshToken(uid)`
  (`src/services/auth/microsoftTokens.ts`); access tokens live in memory. Disconnect and session
  end clear it. Azure app registration steps: docs/SETUP.md §10.
- **Pull:** `GET /me/calendarView/delta` over `CALENDAR_SYNC_WINDOW` with the deltaLink persisted
  in `mg:{uid}:calendar.outlook` (`USER_STORAGE.outlookCalendar`); HTTP 410 => full resync;
  `@removed` => deleted upsert. Results go to `meetingRepository.upsertExternal` with provider
  `'outlook'` (source `'outlook'`, refs `external.outlook*`, conflict resolution like Google:
  provider `lastModifiedDateTime` vs stored `outlookUpdatedAt`, changeKey short-circuit).
- **Push:** the engine queues local `user`/`ai` writes exactly like Google. Inserts use
  `POST /me/events` with `transactionId: "mgev-" + meeting.id` (idempotent across retries),
  updates `PATCH`, deletes `DELETE`. A meeting with conference `{ provider: 'teams', url: null }`
  is created with `isOnlineMeeting: true, onlineMeetingProvider: "teamsForBusiness"` and the
  returned `onlineMeeting.joinUrl` is stored as the conference url. Ref write-backs use origin
  `'calendar_outlook'` (never re-pushed).
- **Status:** `CalendarStatus.outlook` (optional; absent when unconfigured) via
  `useCalendarStatus`; sync reports gain `report.outlook`.

## 18. Full-screen alarm (Android)

Contract: `FullScreenAlarmModule` in `src/core/contracts.ts`; glue `src/services/alerts/fsi.ts`
(IMPLEMENTED: wraps the native module, `isAvailable()` false on iOS/web or in binaries without
the module, and every method is then a safe no-op); native side: local Expo module
`modules/mg-fullscreen-alarm` (Kotlin + config plugin adding `USE_FULL_SCREEN_INTENT` and its
receivers; a store build - never an OTA update - ships it, hence version 1.2.0).

- **Native contract:** `setAlarms(alarms)` is DECLARATIVE (replaces the whole pending set);
  `clearAlarms(ids?)`; `getStatus() -> { exactAllowed, fullScreenAllowed, notificationsAllowed }`
  (finally a real exact-alarm read); `openFullScreenIntentSettings()`. Each alarm:
  AlarmManager `setExactAndAllowWhileIdle` -> BroadcastReceiver -> NotificationCompat notification
  with `fullScreenIntent` (PendingIntent to MainActivity carrying the deepLink) on the meeting's
  EXISTING alert channel. Pending alarms persist in SharedPreferences; a `BOOT_COMPLETED`
  receiver restores them natively (no JS needed).
- **Known tradeoff:** the native notification has no Snooze action buttons (the expo path's
  `mg-alert` category does). A MAX alert delivered through the module in the background is
  snoozed from the in-app full-screen alarm after tapping it; MEDIUM alerts keep the buttons.
  Adding native snooze actions is future work (TESTING T14 tells testers it is not a bug).
- **Engine integration** (spelled out in fsi.ts): during reconcile, when android + available +
  `fullScreenAllowed && notificationsAllowed`, desired entries with kind `alert` and intensity
  `max` are routed to `setAlarms` (id = the notification identifier, so the diff extends to the
  module) and EXCLUDED from the expo-notifications desired set BEFORE the diff - one path per
  identifier, no double fire; stale expo copies are cancelled by the ordinary diff. Unavailable or
  denied => the same entries stay on the expo path in the same reconcile (never dropped).
  `endSession`/`cancelAll` also `clearAlarms()`. Status surfaces as
  `AlertEngineStatus.fullScreenAlarms`; alert settings + onboarding step 3 show the new
  permission state on Android 14+.

## 19. Next-meeting home-screen widget (Android)

Contract: `NextMeetingWidgetModule` + `WidgetFeeder` in `src/core/contracts.ts`; TS wrapper
`modules/mg-next-meeting-widget/index.ts` (IMPLEMENTED: safe no-ops when the native module is
missing); JS glue `src/services/widget` (feeder + pure `computeNextWidgetEntry` model); native
side: local Expo module `modules/mg-next-meeting-widget` (Kotlin), built like
`modules/mg-fullscreen-alarm` (§18). Native code ships only in a store build (new `version`).

- **Rendering model:** JS pushes PRE-LOCALIZED, PRE-FORMATTED strings
  (`{ title, startAtMs, timeText, dateText, deepLink } | null` + static strings
  `{ emptyTitle, emptyBody, nowLabel }` from the `widget` i18n namespace); the native side never
  formats or translates. Strings follow the APP language; the module's `res/values` +
  `res/values-es` strings are only the fallback for a widget added before the app first runs.
- **Native contract:** SharedPreferences hold the last data + strings. `setNextMeeting` re-renders
  every widget instance and, for non-null data, schedules ONE INEXACT AlarmManager broadcast at
  `startAtMs` (never `setExact`: no exact-alarm entanglement) so the provider swaps to the
  `nowLabel` presentation without JS. `BOOT_COMPLETED` re-renders and re-schedules from
  SharedPreferences. Tap = `PendingIntent` (FLAG_IMMUTABLE) with ACTION_VIEW on the stored
  `deepLink`; the empty state opens the app's launch intent. `clear()` wipes data + strings.
- **AppWidget wiring (config-plugin-free):** the `AppWidgetProvider` receiver
  (`android.appwidget.action.APPWIDGET_UPDATE` filter + `android.appwidget.provider` meta-data
  pointing at `res/xml/mg_next_meeting_widget_info.xml`) lives in the module's OWN
  `android/src/main/AndroidManifest.xml` and is merged by Gradle - **app.config.js does not
  change** (no plugin needed; add one only if a real manifest need appears). Widget info:
  `minWidth/minHeight` for 4x1 cells, `updatePeriodMillis=0` (we push), `resizeMode`
  horizontal, `widgetCategory` home_screen. Layout uses RemoteViews-safe views only
  (LinearLayout/FrameLayout + TextView/ImageView; NO ConstraintLayout or custom views) - works
  on Android 9 / LDPlayer 9. `expo-module.config.json` (android module
  `com.meetingguard.nextmeetingwidget.MgNextMeetingWidgetModule`) is added TOGETHER with the
  Kotlin sources, never before (autolinking would break the Gradle build).
- **Feeder lifecycle** (`registerWidgetFeeder()`, idempotent; imported once from `index.js`
  AFTER `./src/services/alerts/tasks`, so headless background runs feed the widget too):
  `session:started` / `meetings:changed` / `calendar:synced` -> recompute + `setNextMeeting`;
  `language:changed` / `preferences:changed` -> `setStrings(widgetStringsOf(t))` + re-feed;
  `session:ended` -> `clear()`. The background refresh task's sync/reconcile emits the events
  the feeder already listens to; `refreshWidget()` exists as an explicit hook.
- **Next entry** (`computeNextWidgetEntry`, pure, unit-tested): active, `scheduled`, non-all-day
  meetings; recurring masters expanded over `[now - 5 min, now + 7 d)`; earliest effective start
  wins; a meeting keeps the slot for 5 minutes after starting (native shows `nowLabel` once
  `startAtMs` passes). Signed out / no meetings -> null -> empty state.

## 20. Billing (RevenueCat + Google Play)

Contract: `PurchasesService`, `PLAY_PRODUCT_IDS`, `StoreOffering` etc. in `src/core/contracts.ts`;
stub `src/services/purchases/index.ts` (isConfigured() false => exactly today's behavior);
webhook mapping `functions/src/revenuecat/mapping.ts` (pure, IMPLEMENTED); catalog stays
`src/services/billing.ts`. Setup guide: docs/SETUP.md §11 (RevenueCat project, Play Console
subscriptions `pro_monthly` / `pro_yearly` / `premium_monthly` / `premium_yearly`, each with a
3-day free trial; RevenueCat entitlements `pro` and `premium`; webhook + Authorization value).

- **SDK:** `react-native-purchases` (10.x; peer RN >= 0.73, no Expo config plugin; requires a dev
  or store build - Expo Go's preview mode counts as unconfigured). Installed by the INTEGRATOR
  via `npx expo install react-native-purchases`.
- **Configuration:** optional `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` (a public `goog_...` SDK key)
  in `src/config/env.ts` + `env.example`. Absent, or platform != android, or the native module
  missing => `purchasesService.isConfigured()` false and the Pricing screen behaves exactly as
  today ("subscriptions coming soon", no purchase UI). `configure(uid)` runs on session start,
  so RevenueCat's `app_user_id` IS the Firebase uid.
- **THE CLIENT NEVER WRITES `entitlements/{uid}`.** Firestore rules stay as they are (owner
  read, no client write). Writers are the RevenueCat webhook and the admin callable, both via
  the Admin SDK. `EntitlementSource` gained `'revenuecat'` and `'admin'` (types.ts).
- **Pricing UI state machine** (`pricingModel.ts` + `PricingScreen`): unconfigured -> today's
  catalog view. Configured -> load the current offering (`getOffering()`): show STORE price
  strings (never computed prices); load failure -> catalog prices + error banner with Retry and
  NO purchase buttons (no fake purchasable state). Purchase: `purchase(tier, cycle)`;
  'cancelled' is silent; success -> "processing" state until the existing entitlement listener
  (`useEntitlement`) flips (webhook latency is seconds); failures -> localized AppError.
  Restore button when configured (`restore()`; 'nothing_to_restore' gets its own message).
  Active paid plan -> current-plan display + "Manage subscription" (`manageUrl(productId)`,
  the Play subscriptions deep link). All states have a11y labels, EN + ES.
- **Webhook** (`functions/src/revenuecat/index.ts`, exported from `functions/src/index.ts` as
  `revenuecatWebhook`): v2 `onRequest`, POST only, secret `REVENUECAT_WEBHOOK_AUTH`
  (`defineSecret`) compared (timing-safe) against the raw `Authorization` header value that the
  RevenueCat dashboard sends verbatim; 401 on mismatch. Body `{ api_version, event }`
  (`revenueCatWebhookBodySchema`). **Idempotency:** `create()` of `revenuecatEvents/{event.id}`
  in a transaction with the entitlement write; an existing marker => 200 no-op (event ids are
  stable across retries). Mapping = `entitlementFromEvent` (decision table in mapping.ts;
  TRANSFER writes `transferred_to` active + `transferred_from` expired). Anonymous
  `$RCAnonymousID:` ids and unknown event types are acknowledged with 200 and logged; malformed
  bodies get 400. Always 200 for handled events (never let RevenueCat retry a success).
- **Tests:** mapping unit tests per event type; webhook handler tests (auth, idempotency,
  TRANSFER, malformed body) with mocked firestore; app-side purchases service tests with a
  mocked `react-native-purchases`; pricing model tests for every UI state.

## 21. Admin dashboard

Contract: `functions/src/admin/schemas.ts` (zod, IMPLEMENTED - the callable names and shapes are
fixed there); callables in `functions/src/admin/index.ts` exported from `functions/src/index.ts`;
web app in `public/admin/` served by Firebase Hosting (firebase.json already serves `public/`);
short guide docs/ADMIN.md (EN).

- **Auth:** every callable requires `request.auth.token.admin === true` (custom claim), else
  `permission-denied` (`unauthenticated` without auth). The claim is set offline with
  `functions/scripts/set-admin-claim.mjs <uid-or-email> [--remove]` (Admin SDK, ADC creds).
  Custom claims travel INSIDE the ID token: after setting the claim, an already-signed-in admin
  must refresh (`getIdToken(true)`); the page does that once automatically after sign-in before
  deciding whether to show the UI, and shows a "not an admin" block state otherwise.
- **Callables** (zod-validated, `invalid-argument` on bad input):
  - `adminListUsers({ pageToken?, pageSize? (1-100, default 50) })` -> `{ users, nextPageToken }`
    - Auth `listUsers` page joined (`getAll`) with `entitlements/{uid}` and today's
    `usage/{uid}/days/{key}` (`usageToday`, 0 when absent).
  - `adminSetUserDisabled({ uid, disabled })` - `updateUser` + revoke refresh tokens when
    disabling.
  - `adminSetUserPlan({ uid, plan, expiresAt })` - writes `entitlements/{uid}`
    `{ plan, status: 'active', expiresAt, source: 'admin', updatedAt }` (also for 'free': an
    explicit downgrade overrides a stale paid doc).
  - `adminGetMetrics({})` -> `{ totalUsers, planCounts, assistantRequests: { today, last7Days } }`
    - usage summed over collection group `days` filtered on `updatedAt`; requires a
    collection-group index on `days.updatedAt` (add to `firestore.indexes.json`).
- **Web app** (`public/admin/index.html` + `admin.js` + `admin.css`): build-free ES modules
  loading the Firebase JS SDK from `https://www.gstatic.com/firebasejs/<version>/...`
  (app/auth/functions); Google sign-in popup (hosting runs on the authDomain, so the popup
  works); pages: Users (paged table, disable/enable, set plan), Metrics. English only. The
  hosting CSP in firebase.json currently blocks ALL scripts and connections
  (`default-src 'none'`); the admin area adds a `/admin/**` headers entry allowing
  `script-src https://www.gstatic.com`, `connect-src https://*.googleapis.com` (+ the callable
  region host) - scoped to `/admin/**` only, the root CSP stays locked down.
- **Rules:** nothing changes in firestore.rules (callables use the Admin SDK).

## 22. Video-call link modes (conference)

Contract: `conferenceCapability(provider, calendarStatus)` + `teamsLinkOnCreateOnly(external)`
in `src/core/conference.ts` (pure, IMPLEMENTED, unit-tested). The mode is DERIVED at render
time, never stored; `Meeting.conference` stays `{ provider, url, password } | null` and a link
is only ever a real one (pasted or provider-created; §8's "never fabricated" rule).

Ground truth (verified in the sync code): Google pushes request a real Meet link for
`google_meet + url null` on INSERT AND PATCH (`wantsMeetLink`, google/sync.ts), so a connected
account only needs Save. Outlook creates a Teams link for `teams + url null` ON INSERT ONLY
(outlook/mapping.ts; §17) - a meeting already pushed to Outlook (`external.outlookEventId`
set) without a url never gets one.

| provider | calendar state | mode / autoState | form hint (below the chips) | details card (no url) |
|---|---|---|---|---|
| none | - | `none` | - | section hidden (unless a pasted `location.virtualUrl` exists) |
| other | - | `paste` | `meetings:form.pasteLinkHint` | `meetings:details.noLink` |
| zoom | status unknown (`calendar.zoom` absent: zoomStatus not answered this session) | `paste` | `meetings:form.pasteLinkHint` | `meetings:details.noLink` |
| zoom | server configured (§24) | `auto_zoom` / `ready` | `meetings:form.zoomWillBeCreated` | `meetings:details.zoomPending`; swaps to `meetings:details.zoomCreateFailed` + Retry when `zoomService.linkFailure(id)` reports one |
| zoom | server said not configured | `auto_zoom` / `not_configured` | `meetings:form.pasteLinkHint` + muted `meetings:form.zoomNotConfigured` note (`conferenceFormNote`) | `meetings:details.noLink` |
| google_meet | google connected | `auto_google` / `ready` | `meetings:form.meetWillBeCreated` | `meetings:details.meetPending` ("waiting for sync") |
| google_meet | not connected | `auto_google` / `needs_connection` | `meetings:form.meetNeedsCalendar` | `meetings:details.meetNeedsCalendar` + "Connect Google Calendar" CTA |
| teams | outlook hidden/unconfigured | `paste` | `meetings:form.pasteLinkHint` | `meetings:details.noLink` |
| teams | outlook configured + connected | `auto_outlook` / `ready` | new `meetings:form.teamsWillBeCreated` | new `meetings:details.teamsPending`; but `teamsLinkOnCreateOnly` (already pushed, no link) -> new `meetings:details.teamsLinkTooLate` (paste fallback) |
| teams | configured, not connected | `auto_outlook` / `needs_connection` | new `meetings:form.teamsNeedsOutlook` | new `meetings:details.teamsNeedsOutlook` + "Connect Outlook" CTA |

- A PASTED url always wins: the mode only describes the empty-url behavior, and the details
  card shows the Join button whenever a valid url exists.
- **Push-target degrade** (`ConferencePushTarget`, third argument of `conferenceCapability`):
  an auto mode the sync engines can never reach for THAT meeting falls back to `paste` (no
  promise, no connect CTA). Ground truth from the push filters: the Outlook push never pushes
  recurring meetings (§17) nor `source: 'google' | 'device'` ones (`isOutlookPushable`), and
  the Google push never pushes `source: 'device' | 'outlook'` ones (`pushGoogleMeeting`) -
  recurring masters ARE pushed to Google, so Meet + recurrence keeps its promise. The form
  passes the draft's repeat choice + the edited meeting's source ('manual' for a new one);
  the details card passes the stored meeting's `source` and `recurrence`.
- The form derives the hint from `conferenceCapability(draft.conferenceProvider, status)` with
  the LIVE `useCalendarStatus()` value, so switching the provider chips or connecting a
  calendar updates the text immediately (the stage-3 bug: the hint was Google-only and partly
  static). The url input label stays "optional" exactly for the two auto modes.
- The AI executor keeps its own Meet path (`createMeetLink`); nothing changes there.

## 23. Phase-2 file ownership (exact lists; parallel implementers must not cross them)

- **videocall**: `src/screens/meetings/MeetingFormScreen.tsx`, `src/screens/meetings/meetingForm.ts`,
  `src/screens/meetings/MeetingDetailsScreen.tsx`, their tests under
  `src/screens/meetings/__tests__/`, i18n `meetings.json` (`form.*`, `details.*` keys only) and
  `create.json` in both languages. Reads `useCalendarStatus` + `src/core/conference.ts` only.
- **recscope**: `src/services/data/**` (editFollowing/deleteFollowing implementation replacing
  the engine stubs, + tests), `src/screens/meetings/list/meetingActions.tsx`,
  `src/screens/meetings/OccurrenceEditSheet.tsx`, `src/screens/meetings/occurrences.ts` (+ their
  tests), `src/services/ai/actionExecutor.ts` + `src/services/ai/presentation.ts` +
  `src/services/ai/recurrenceText.ts` ('following' execution/preview),
  `functions/src/assistant/{tools,prompt,actions}.ts` (+ functions tests). i18n: the
  `meetings:actions.scopeFollowing/followingDeleted/followingUpdated` and
  `ai:recurrence.scopeFollowing` keys ALREADY EXIST (architect) - recscope edits no JSON unless
  adding `ai.json` keys of its own. NEVER touches MeetingFormScreen/MeetingDetailsScreen.
- **widget**: `modules/mg-next-meeting-widget/**` (Kotlin + expo-module.config.json + widget res;
  the TS wrapper exists), `src/services/widget/**`, the ONE feeder import line in `index.js`,
  i18n `widget.json` (extending the three existing keys is fine). app.config.js only if a
  plugin becomes unavoidable (§19 says none is expected).
- **billing**: `src/services/billing.ts`, `src/services/purchases/**`, `src/screens/pricing/**`,
  `src/config/env.ts` + `env.example` (EXPO_PUBLIC_REVENUECAT_ANDROID_KEY),
  `functions/src/revenuecat/**` + the `revenuecatWebhook` export line in
  `functions/src/index.ts`, functions tests, i18n `pricing.json`, docs/SETUP.md §11.
- **admin**: `public/admin/**`, `functions/src/admin/**` + the admin export lines in
  `functions/src/index.ts`, `functions/scripts/set-admin-claim.mjs`, functions tests,
  `firebase.json` (the scoped `/admin/**` headers entry ONLY), `firestore.indexes.json`
  (the `days.updatedAt` collection-group index ONLY), docs/ADMIN.md.
- **shared**: `src/i18n/resources.ts` and navigation registrations - own lines only. Version
  bump, CHANGELOG, HANDOFF/TESTING updates: integrator.

## 24. Zoom auto links (server-created)

Contract: zoom* schemas + `CALLABLES.zoom*` + `ZOOM_ERROR_CODES` in `src/core/aiContract.ts`
(mirrored verbatim in `functions/src/shared/aiContract.ts`); app service contract `ZoomService` /
`UseZoomStatusResult` in `src/core/contracts.ts` (stubs in `src/services/zoom/`); capability mode
`auto_zoom` in `src/core/conference.ts` (IMPLEMENTED); callables in `functions/src/zoom/`
(zoomStatus IMPLEMENTED, write callables stubbed). Owner setup + deploy order: docs/SETUP.md §12.

The server owns ONE Zoom Server-to-Server OAuth app (host account `me`); users never connect
their own Zoom accounts and the app never sees Zoom credentials.

- **Callables** (names in `CALLABLES`, zod request/response schemas in aiContract.ts; every
  error is an `HttpsError` with `details.reason` from `ZOOM_ERROR_CODES`, mapped per
  `ZOOM_ERROR_HTTPS_CODES`):
  - `zoomStatus {} -> { configured }`: auth required (not verified). Answers from the NON-SECRET
    `ZOOM_ENABLED` param only, so it always deploys and never touches the secrets. The app asks
    once per session (`zoomService.isAvailable()`, cache cleared on `session:ended`).
  - `zoomCreateMeeting { meetingId } -> { url, password, zoomMeetingId }`: verified account
    required (same rule as the assistant: `email_verified` or provider google.com). Loads
    `users/{uid}/meetings/{meetingId}` (ownership of the DOCUMENT is the path), validates
    provider `zoom`, no pasted url and no existing `external.zoomMeetingId` (idempotent: an
    existing id returns the stored values), creates the Zoom meeting - type 2 (scheduled, from
    title/startAt/durationMinutes/timezone) for a one-off, type 3 (recurring, NO fixed time)
    when the document carries a recurrence rule, because a type-2 id expires 30 days after its
    scheduled date while a type-3 join link stays valid for the whole series (it expires a year
    after its last use; §22 promises a reusable link) - then ONE transaction writes
    `conference.url`, `conference.password`, `external.zoomMeetingId` AND the ownership
    registry entry (below) via the Admin SDK and returns them (the app's snapshot listener
    delivers the link; the return value is a fast path).
  - `zoomSyncMeeting { meetingId } -> { updated }`: patches topic/start/duration/timezone of the
    existing Zoom meeting after a local edit (join url never changes; a recurring/type-3
    meeting patches the topic only - it has no schedule on Zoom's side). Denied (benign
    `updated: false`, logged `zoom.sync_denied`) when the registry does not name the caller.
  - `zoomDeleteMeeting { meetingId | zoomMeetingId } -> { deleted }`: deletes the Zoom meeting
    on meeting deletion; the bare `zoomMeetingId` form covers already-tombstoned docs. BOTH
    forms require the registry to name the caller (else `not_found`), and a completed delete
    also removes the registry entry. A Zoom 404 resolves `deleted: true`.
- **Ownership registry** (`zoomMeetings/{zoomMeetingId}` = `{ uid, meetingId, createdAt }`,
  Admin SDK only - firestore.rules denies ALL client access): every Zoom meeting lives on ONE
  shared host account and `external.zoomMeetingId` is CLIENT-writable (any user can stamp any
  digits on their own documents, and every participant sees the numeric id in the join url), so
  the meeting document NEVER proves who owns a Zoom id. `zoomCreateMeeting` writes the registry
  entry in the same transaction as the link; sync, delete and the create path's stale-id
  cleanup resolve ownership from it and treat the document field purely as a hint - without
  this, any verified user could delete or rewrite any other user's Zoom meeting by stamping
  its id.
- **Quota**: `zoomCreateMeeting` bumps `usage/{uid}/days/{UTC day}.zoomCreates` transactionally,
  capped by the param `ZOOM_USER_DAILY_LIMIT` (default 30); sync/delete share `zoomOps` capped
  at 10x. Over cap => reason `quota_exceeded`.
- **Secrets/params** (`functions/src/config.ts`): secrets `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`,
  `ZOOM_CLIENT_SECRET` are bound ONLY on the three write callables, which are EXPORTED only
  while `ZOOM_ENABLED` is true at deploy time - the default deploy never references the secrets
  and cannot fail on them. S2S token: POST zoom.us/oauth/token
  `grant_type=account_credentials&account_id=...` with Basic base64(clientId:clientSecret);
  cached in instance memory until shortly before expiry; then api.zoom.us/v2 with Bearer.
- **Rules**: `external.zoomMeetingId` is allowed client-side exactly like the outlook refs
  (string <= 64): the callable writes it first via the Admin SDK, but every later client edit
  rewrites the whole document, external refs included, so the key must stay client-writable.
  Because it is client-writable it is only a HINT - ownership comes from the server-only
  `zoomMeetings/{id}` registry (explicit deny block in firestore.rules). Stored sparsely
  (`SPARSE_EXTERNAL_KEYS`), so docs written by this app version keep passing the PREVIOUS
  deployed rules; the owner deploys the updated rules with the functions.
- **App flow** (`ZoomService` in contracts.ts; wiring owner zoom-app): the form passes
  `calendar.zoom = { configured }` (from `useZoomStatus()`; absent while unknown) into
  `conferenceCapability`; §22's table has the exact copy states. The write callables require a
  VERIFIED account, so the form and the details screen mirror the gate client-side
  (`needsEmailVerification(authUser)`): for an unverified email user `calendar.zoom` stays
  absent - plain paste, no "will be created" promise, and `ensureLink` is never fired (the
  server would refuse every retry). After Save (create or edit) with provider zoom, no url,
  status ready and a verified account -> fire-and-forget `ensureLink(meetingId)` (flushes the
  outbox first; the details card shows `zoomPending`, or `zoomCreateFailed` + Retry via
  `linkFailure(id)`). Edits that touch title/startAt/duration/timezone ->
  `syncIfNeeded(meeting, patch)`. Deletions (list actions, details, AI executor) ->
  `onMeetingDeleted(meeting)`. The AI executor treats provider-zoom create/update the same way
  after executing the confirmed action. A pasted link always wins; `ensureLink` is never called
  when a url exists.
- **"This and following" semantics** (§16 split of a zoom series): the server-created Zoom
  meeting ATTACHES TO THE ORIGINAL MASTER. The tail is built with `conference.url`/`password`
  nulled whenever the master has provider zoom AND an `external.zoomMeetingId`
  (engine.ts `buildFollowingTail`; a PASTED link without an id is copied like any other field),
  so the tail gets a FRESH Zoom meeting - via the executor's zoom hooks on the AI path, or the
  details card's `zoomPending` auto-`ensureLink` on the manual path. Copying the url would
  leave the tail pointing at a Zoom meeting that dies with the old series and that tail edits
  could never sync. Deleting "this and following" FROM THE FIRST occurrence collapses to a
  whole-series delete (`deleteFollowing` resolves null): both callers (meetingActions,
  actionExecutor) then run `onMeetingDeleted` exactly like a plain series delete; a real
  truncation keeps the series and its link alive.
- **Offline and retry semantics** (verified in src/services/zoom): an offline Save still saves
  (outbox); `ensureLink` then fails with `offline`, the failure is recorded per meeting and the
  details card shows `zoomCreateFailed` + Retry. NOTHING retries automatically on reconnect -
  the link appears after the explicit Retry, or in the next app session: the failure map and the
  status answer live in session memory (cleared on `session:ended`; continuations that settle
  after the clear are epoch-guarded and never write into the next session's map), so a fresh
  session's details screen auto-fires the idempotent `ensureLink` again and heals the meeting.
  For the same reason a server-side `ZOOM_ENABLED` flip is only picked up by the NEXT session
  (`useZoomStatus().refresh` exists but nothing calls it automatically).
- **Known limitations** (accepted, by design "best effort"):
  - DELETE while offline is permanent leakage: `onMeetingDeleted` only logs a failure, nothing
    re-queues it and no code ever scans tombstones for leftover Zoom ids, so a Zoom meeting
    whose app meeting was deleted in airplane mode stays on the host account (joinable by
    anyone holding the link) until the owner removes it in the Zoom portal. A persisted
    retry queue is future work.
  - The `ZoomLinkResult` that `ensureLink` resolves with is not merged into the local copy;
    the link reaches the app only through the snapshot listener. A full-document save fired in
    the 1-3 s window between the server transaction and the snapshot (second quick edit of a
    doc with a pending outbox write) can therefore erase the fresh link; the details card then
    re-fires `ensureLink`, which creates a REPLACEMENT Zoom meeting and orphans the first on
    the host account (one wasted `zoomCreates` unit). Narrowing the window via a
    repository-level merge is future work.
- **Logging**: uid, meeting doc id, Zoom numeric id, error codes. Never topics or links.

## 25. Email sign-in and the verification gate

Contract: `AuthService.signInWithEmail / signUpWithEmail / sendPasswordReset /
resendVerification / reloadUser` in `src/core/contracts.ts` (authService IMPLEMENTED);
`AuthContextValueImpl` adds `resendVerification()` and `refreshUser()` (IMPLEMENTED); error
mapping in `src/services/auth/authErrors.ts` (IMPLEMENTED); screen stub
`src/screens/auth/EmailAuthScreen.tsx` (route `EmailAuth` in the Auth stack); banner stub
`src/screens/shared/VerifyEmailBanner.tsx`. Owner console steps: docs/SETUP.md §13.

- **Provider**: Firebase Email/Password. The server may not have it enabled:
  `auth/operation-not-allowed` maps to `not_configured` / reason `provider_disabled`
  (`auth:errors.providerDisabled`), so the UI degrades to a clear message instead of crashing.
- **Flows**: Landing gains a secondary `landing:signIn.email` button -> `EmailAuth`. The screen
  toggles sign-in / create-account (email + password with show/hide and autofill hints,
  optional name on create, keyboard-safe via `ScreenBody`), has an INLINE forgot-password flow
  (`sendPasswordReset`; always the neutral `auth:emailAuth.resetSent` - no account
  enumeration), and after create shows `auth:emailAuth.verificationSent`. `signUpWithEmail`
  sends the verification email NON-BLOCKING: the user is signed in even when sending failed
  (resend exists). Sessions started by email behave exactly like Google ones (profile ensure,
  migration, cleanup - the session manager keys on the Firebase user only).
- **Error mapping** (authErrors.ts): `invalid-credential` / `invalid-login-credentials` /
  `wrong-password` / `user-not-found` all collapse to reason `invalid_credentials`
  (`auth:errors.invalidCredentials`, one generic message - no account enumeration); also
  `email_in_use`, `weak_password`, `too_many_requests`, `provider_disabled`.
- **Verification gate**: the assistant callable already rejects callers without
  `email_verified` unless the provider is google.com. Client mirror:
  `needsEmailVerification(authUser)` (VerifyEmailBanner.tsx); the zoom surfaces mirror it too
  (§24 app flow). The banner mounts on the assistant screen (and the entries into it):
  `auth:verify.assistantBody` with `auth:verify.resend` (-> `resendVerification()`) and
  `auth:verify.check` ("I verified" -> `refreshUser()`, which reloads the Firebase user,
  refreshes `authUser.emailVerified` AND force-mints a fresh ID token (`getIdToken(true)`):
  the callables authorize from the TOKEN's `email_verified` claim, and the cached token says
  unverified for up to an hour after the mail link was clicked - without the forced refresh,
  "I verified" would clear the banner while the server keeps answering `unauthenticated`).
  The assistant's server rejection for an unverified caller shows the SAME message. Settings'
  account section shows `auth:verify.verified` / `auth:verify.notVerified`. Everything else in
  the app works unverified (the gate is AI-only); navigation is unchanged (user exists =>
  normal session).
- **Tests required**: authService email methods (mocked firebase/auth - exist), authErrors
  mapping rows, EmailAuthScreen render + interaction (mode toggle, submit, reset), banner
  render + `needsEmailVerification`, i18n parity (auth.json keys exist in EN+ES).
