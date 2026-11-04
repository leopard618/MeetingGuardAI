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
| tasks | `src/services/tasks/todo` (`todoSyncService`, §28, re-exported by the calendar barrel); `src/services/microsoft/graphHttp.ts` (the Graph HTTP core both Microsoft syncs use) | tasks |
| alerts | `src/services/alerts` (`alertEngine`, `computeAlertPlan`, `usePendingAlerts`); `src/services/alerts/fsi.ts` (`fullScreenAlarm`, §18); `src/services/alerts/tasks.ts` (`registerBackgroundTasks`, `unregisterBackgroundTasks`, plus the module-scope task definitions); `src/components/alerts` (`AlertHost`) | alerts |
| i18n + navigation | `src/i18n` (`i18n`, `initI18n`, `t`, `getLanguage`, `setLanguage`, `SUPPORTED_LANGUAGES`, `I18N_NAMESPACES`, `I18nProvider`, `useT`, `useLanguage`); `src/utils/format.ts`; `src/navigation` (`navigationRef`, `navigate`, `openDeepLink`, `isNavigationReady`, `linking`, `RootNavigator`, `ROUTES`); `src/screens/onboarding` | i18n-nav |
| ai | `src/services/ai` (`assistantClient`, `actionExecutor`, `useAssistant`) | ai |
| zoom | `src/services/zoom` (`zoomService`, `useZoomStatus`); `functions/src/zoom` (zoom* callables, §24) | zoom-app / zoom-server |
| attachments | `src/services/attachments` (`attachmentService`, `useMeetingAttachments`); metadata in the data layer's `attachmentStore` | notes |
| shell | `src/contexts/ThemeContext.tsx` (`ThemeProvider`, `useTheme`, `useAppThemes`), `src/components/{CustomHeader,MobileSidebar,BottomNavBar,ThemeToggle,ErrorBoundary,AppToast}.tsx`, `src/hooks/useWindowInsets.tsx`, `src/hooks/useResponsive.ts` | shell |
| screens | `src/screens/<area>` (one folder per screen group, §13); `src/screens/shared` (`useFormatters`, `Section` / `ScreenBody`, `MeetingStatus`, `useLiveNow`, `useKeyboardAvoidance`, `useDiscardChangesGuard`, `text`) | screen groups |
| release | `src/services/updates.ts` (OTA state), `app.config.js` (`updates`, `runtimeVersion`), `eas.json` channels, `docs/v1/DEPLOYMENT.md` | release |
| widget | `modules/mg-next-meeting-widget` (local Expo module), `src/services/widget` (`registerWidgetFeeder`, `refreshWidget`, `widgetStringsOf`, `computeNextWidgetEntry`), i18n namespace `widget` (§19) | widget |
| billing | `src/services/billing.ts` (catalog), `src/services/purchases` (`purchasesService`), `functions/src/revenuecat` (webhook), `src/screens/pricing`, i18n namespace `pricing` (§20) | billing |
| admin | `public/admin` (build-free web app), `functions/src/admin` (callables), `functions/scripts/set-admin-claim.mjs`, `docs/v1/ADMIN.md` (§21) | admin |
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
- `alertEnabled` (master switch), `alertIntensity` (`max|medium|light`), `importedAlertIntensity` (the same values or null = same as `alertIntensity`; applies to meetings from a phone, Google or Outlook calendar without an override of their own), `alertSoundType` (`voice_and_sound|voice_only|sound_only`), `alertVolume` (0-1), `vibrationEnabled`
- `defaultAlertTimes` (default `[15,5,0]`), `snoozeMinutes`, `followUpEnabled`
- `use24HourClock` (null means the locale default), `onboardingCompleted`
- `googleCalendarSyncEnabled`, `deviceCalendarImportIds[]`, `deviceCalendarExportId`
- `todoListId`, `todoListName` (the Microsoft To Do list new tasks go to, §28; null = not chosen)
- `updatedAt`

Reads use `mergePreferences`, which merges field by field so one bad field never resets the rest (the old bug #19). Google tokens are **never** stored.

**Other entities:**

- **UserProfile**: `uid`, `email`, `displayName`, `photoURL`, timestamps, `legacyMigratedAt`. It has **no** plan, role or subscription fields (`SERVER_OWNED_PROFILE_KEYS`).
- **Entitlement**: `{ plan free|pro|premium, status, expiresAt, source, updatedAt }`. It is server-owned and read-only on the client. A missing document means free. `effectivePlan()` downgrades expired plans.
- **Note**: `title`, `content`, `category` (`general|work|ideas|personal`), `meetingId`, `pinned`. Notes are hard-deleted.
- **Task** (V2 Stage 1): `title`, `description`, `dueDate` + `dueTime` + `timezone` (a time needs a date), `reminderMinutesBefore` (needs a time), `status` (`open|done`) with `completedAt` set exactly while done, `meetingId`, `people[]`, `source` (`manual|ai_chat|whatsapp|todo`), `external` (`{ todoListId, todoTaskId, todoUpdatedAt }`, the Microsoft To Do link, §28). Tasks are hard-deleted. Every write goes through `buildTask` / `applyTaskPatch`; reads through `parseTaskDoc` (older documents get `source: 'manual'` and an empty link).

## 4. Firestore layout and rules intent

| Path | Content | Client access |
|---|---|---|
| `users/{uid}` | UserProfile | owner read and write; writes that contain any `SERVER_OWNED_PROFILE_KEYS` key are rejected |
| `users/{uid}/meetings/{id}` | MeetingDoc | owner read and write; `userId == uid`; type and size checks on `title`, `startAt`, `durationMinutes`, `source`; every alert-time element an int in [0, 10080]; string lists (`preparationTips`) join-checked for type and total size (participant maps cannot be iterated in rules: the assistant bounds what it loads) |
| `users/{uid}/notes/{id}` | Note (without id) | owner read and write |
| `users/{uid}/tasks/{id}` | Task (without id) | owner read and write; `userId == uid`; due/reminder invariants, `source` and the `external` keys validated (`isValidTask`, `isValidTaskExternal`; `src/core/__tests__/tasksRulesDrift.test.ts` keeps the allowlist in step with the Task shape) |
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
channel sound, also with `alertSoundType: 'voice_only'` (the voice readout runs in the in-app
alert; on Android the full-screen alarm opens the app and the fired alarm is re-shown in-app, §18;
on iOS the user opens the alert); the alert settings screen says so.

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

- iOS keeps 64 pending notifications and Android allows about 500 alarms, so the budget is 60 in total,
  MINUS what the task reminders (`mgtask:`) and the morning briefing (`mgbrief:`) hold at reconcile
  time: they share the same per-app cap (audit 2026-10-30).
- `SCHEDULE_EXACT_ALARM` is declared. `openExactAlarmSettings()` opens the setting through expo-intent-launcher. There is no JS API to check it, so reconcile again after the user returns (AppState active).
- There is no full-screen intent.
- expo-background-task (`mg-background-refresh`, every 60 minutes or more) restores the persisted language (`initI18n`), calls `withHeadlessSession`, then `calendarSyncEngine.syncNow({ headless: true })`, then `alertEngine.reconcile('background')`. Without an alert session the notification text follows `prefs.language`. It only refreshes the rolling window. Delivery itself never depends on it.
- The notification-response task is registered on Android only (iOS delivers action responses to the listener).

## 7. Calendar sync pipeline (calendar area)

**Google, on the device:**

- **Tokens.** `authService.getGoogleAccessToken({ requireCalendar: true })` wraps `GoogleSignin.getTokens()`; the native SDK refreshes the token. There is no client secret and tokens are never persisted. A 401 triggers `invalidateGoogleAccessToken` and one retry.
- **Scope.** `https://www.googleapis.com/auth/calendar.events`, requested incrementally with `addScopes`.
- **Push.** The engine listens to `meetings:changed` and pushes only local writes with origin `user` or `ai`, plus remote changes the website flagged (`pushRequested`, section 32).
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
| `auth/LandingScreen` | `Landing` | `landing` | Brand image (mark, name and tagline baked in), no panel or copy, Google sign-in (cancel is not an error), secondary "Continue with email" button (§25), language switch, Terms / Privacy links. |
| `auth/EmailAuthScreen` | `EmailAuth` | `auth` | Email/password sign-in and account creation with inline password reset (§25); reached from Landing only. |
| `legal` (`legalContent.ts`, `LegalDocumentScreen`) | `Privacy`, `Terms` (standalone variants outside Main) | `legal` | Complete EN / ES texts. `LEGAL_ENTITY` and `legal:jurisdiction` are marked placeholders to fill before release. |
| `pricing/PricingScreen` (`pricingModel.ts`) | `Pricing` | `pricing` | Catalog from `src/services/billing.ts` ($7.99 / $14.99, 25% off yearly); current plan from the entitlement; "subscriptions coming soon", no purchase or external links. |
| `onboarding/*` | `Onboarding*` | `onboarding` | Stage 2 (§5). |

**App shell (owner: shell).** `ThemeContext.tsx`: the saved choice (`system` / `light` / `dark`; the old `theme` key is migrated once); `useTheme()` returns `{ themeMode, setThemeMode, colorScheme, isDarkMode, toggleTheme, isLoaded, colors }`, and `useAppThemes()` gives `AppRoot` the matching Paper theme, React Navigation theme and status-bar style. `CustomHeader` shows a back arrow when the stack can go back, the live EN/ES switch, the theme toggle and the menu. `MobileSidebar` items are typed Main routes. `BottomNavBar` (one instance under the Main stack, like the sidebar) shows five typed Main routes (Dashboard, TotalMeetings, AIChat as the raised assistant orb, Calendar, Tasks; `BOTTOM_BAR_ITEMS`) with the current route selected and navigates through `navigateToTopLevel`; it stays on every main screen, the chat included (the composer sits above it), and replaces the former floating assistant button. `CustomHeader` lost the theme toggle (menu and Settings keep it) and shows the account avatar as the menu button. Gradients come from `expo-linear-gradient` (native module: ships with store/APK builds) through the kit's `GradientSurface`; icons are Feather through the kit's `Icon`; the typeface is Plus Jakarta Sans (`@expo-google-fonts/plus-jakarta-sans`, loaded with `useFonts` in `AppRoot` before the first frame, system font on a load failure); `docs/v1/DESIGN_SYSTEM.md` §2.1 has the gradient, depth and motion rules. The bar owns the bottom safe-area inset: the Main group hands its screens a bottom inset of 0 (`SafeAreaInsetsContext` override in `RootNavigator`), so list paddings and FABs land right above the bar, and the RN Modal sheets and editors opened from a screen read the window insets through `useWindowInsets()` instead. `ErrorBoundary.tsx` reports through the logger (Sentry) and renders a localized, theme-aware fallback; it wraps the whole app (scope `app`) and, as the root stack's `screenLayout`, every screen (scope `screen`: only the failed screen is replaced and the header keeps working). The crash reporter is registered when `AppRoot` loads. Toasts use the `AppToast` layouts (`toastConfig`): themed, and they wrap instead of cutting the text to one line.

**Navigation params.** `MeetingDetails` and `EditMeeting` take `{ meetingId }` (required); `CreateMeeting` takes an optional `{ date }` ("YYYY-MM-DD", device zone). Screens pass ids, never meeting objects.

**Session in screens.** `useAuth()` returns `AuthContextValue` (`contracts.ts`: `status`, `isAuthenticated`, `authUser`, `entitlement` (plan via `effectivePlan()`), `hasCalendarScope`, `signInWithGoogle`, `signInWithEmail`, `signUpWithEmail`, `signOut`, `requestCalendarScope`, `deleteAccount`) plus the auth area's extensions in `AuthContextValueImpl` (`src/services/auth/AuthProvider.tsx`: `reauthenticate`, `requestCalendarAccess`, `calendarConnected`, `sessionError`, `sendPasswordReset`). Screens sign out through `useSignOutFlow()` (`src/navigation/useSignOut.ts`), which handles the `pending_writes` confirmation. The list of files removed during the rebuild is in `CHANGELOG.md`.

**What stays for pre-rebuild data** (data migration only): `src/services/data/legacyInput.ts` reads the v1.0.9 AsyncStorage blob (`migrateLegacyLocalData`, run once per account) and old-shape Firestore documents (`mapping.ts`); `legacyPurge.ts` deletes the old plaintext tokens at every start; `relinkLegacyAttachments` adopts old attachment metadata; `ThemeContext` migrates the old `theme` key.

## 14. Deferred (not in this pass)

- WhatsApp bot
- Sign in with Apple, which is required before iOS App Store submission
- Pushing time-modified occurrence overrides to Google/Outlook (kept local; §16)
- iOS widget (§19 is Android-only)

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
- Release checklist, rollback, backups and the Firebase side: `docs/v1/DEPLOYMENT.md`. Project setup: `docs/v1/SETUP.md`. Tests and the device plan: `docs/v1/TESTING.md`. Open work and decisions: `docs/v1/HANDOFF.md`.

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
    to Graph before Stage 2; since M6 the split is two ordinary series pushes to Graph as well (§17).
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
Google/Firebase identity. Limitations (documented): meetings imported from Google/device
calendars are never pushed to Graph, and a Teams link is only created with the event (Graph cannot
reliably turn an existing event into a Teams meeting here).
- **Series (Stage 2, M6):** a recurring master is pushed as a Graph series master.
  `toGraphRecurrence` (mapping.ts) maps daily / weekly (`daysOfWeek`, Monday weeks) / monthly
  (`dayOfMonth`) rules with `interval`; `until` becomes the local date of the LAST generated
  occurrence (`endDate`), `count` a `numbered` range; `recurrenceTimeZone` is the meeting zone. An
  off-pattern anchor moves the master start (same wall-clock time) to the first generated
  occurrence, which is what `expandOccurrences` renders locally. After every series create / patch,
  `applyOccurrenceOverrides` (sync.ts) lists the instances around each override
  (`GET /me/events/{id}/instances`, matched by `originalStart`) and DELETEs cancelled ones /
  PATCHes modified ones (start, end, subject); Graph regenerates the occurrences when the master
  recurrence is patched, so the pass is idempotent. The visible hash of a series includes the rule
  and every override. `state.kinds` (event id -> single | series) remembers what we created: a
  shape change (one-off <-> series) deletes the old event and creates a new one with a fresh
  deterministic transactionId (`-k<hash of the old link>`), never a cross-shape PATCH; links made
  before the field existed count as single. Import skips instances whose `seriesMasterId` is one of
  our masters and the full-sync sweep never tombstones a master (masters are not in calendarView),
  so Outlook-side occurrence edits or a series deletion in Outlook do not flow back (same one-way
  rule as the Google provider, §16).

- **Auth:** expo-auth-session PKCE against
  `https://login.microsoftonline.com/{EXPO_PUBLIC_MSAL_TENANT||'common'}/v2.0`, scopes `openid
  profile offline_access User.Read Calendars.ReadWrite Tasks.ReadWrite` (one consent for the
  calendar and the To Do sync, §28), redirect
  `meetingguardai://auth/microsoft` (`MS_AUTH_REDIRECT_PATH`; navigation ignores it). Client id:
  optional `EXPO_PUBLIC_MSAL_CLIENT_ID` (absent => Outlook hidden). ONLY the refresh token is
  persisted, in expo-secure-store under `SECURE_STORE_KEYS.microsoftRefreshToken(uid)`
  (`src/services/auth/microsoftTokens.ts`); access tokens live in memory. Disconnect and session
  end clear it. Azure app registration steps: docs/v1/SETUP.md §10.
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
  (finally a real exact-alarm read); `openFullScreenIntentSettings()`; `getFired(scope?)` /
  `clearFired(ids?)` (below). Each alarm:
  AlarmManager `setExactAndAllowWhileIdle` -> BroadcastReceiver -> NotificationCompat notification
  with `fullScreenIntent` (PendingIntent to MainActivity carrying the deepLink) on the meeting's
  EXISTING alert channel. Pending alarms persist in SharedPreferences; a `BOOT_COMPLETED`
  receiver restores them natively (no JS needed).
- **Known tradeoff:** the native notification has no Snooze action buttons (the expo path's
  `mg-alert` category does). A MAX alert delivered through the module in the background is
  snoozed from the in-app full-screen alarm after tapping it; MEDIUM alerts keep the buttons.
  Adding native snooze actions is future work (TESTING T14 tells testers it is not a bug).
- **Fired alarms reach the in-app alarm (1.5.0 fix):** the fired native notification is not an
  expo-notifications one, so `getPresentedNotificationsAsync` never lists it and the tray sweep
  could not re-show it: opening the app from the alarm only navigated to the meeting, without
  the sound loop, the voice readout or snooze. Now each spec carries `data` (the StoredAlertData
  as JSON); the receiver records the fired alarm (SharedPreferences `FiredStore`, pruned after 2
  hours) before posting; the engine's tray sweep (session start, foreground, host attach) reads
  `getFired('mg:')`, runs each record through the same rules as a tray entry (stale / acknowledged
  => dismissed; within `PRESENTED_RESHOW_WINDOW_MS` => `presentIncoming` in-app) and then
  `clearFired(ids)`. Records are untouched while no `AlertHost` is attached. `clearAlarms` also
  forgets fired records; the tray copy (tag = id, notify id 0, the pair expo's dismiss cancels) is
  removed when the alert is handled, as for expo deliveries.
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

## 20. Billing (RevenueCat + Google Play + App Store)

Contract: `PurchasesService`, `PLAY_PRODUCT_IDS`, `APP_STORE_PRODUCT_IDS`, `StoreOffering` etc.
in `src/core/contracts.ts`; implementation `src/services/purchases/**`; webhook mapping
`functions/src/revenuecat/mapping.ts` (pure, IMPLEMENTED); reconciliation
`functions/src/revenuecat/reconcile.ts`; catalog stays `src/services/billing.ts`. Setup guide:
docs/v1/SETUP.md §11 (RevenueCat project, Play Console + App Store Connect subscriptions
`pro_monthly` / `pro_yearly` / `premium_monthly` / `premium_yearly` - the SAME product ids on
both stores, each with a 3-day free trial; RevenueCat entitlements `pro` and `premium`; webhook
+ Authorization value; reconciliation secret + param).

- **SDK:** `react-native-purchases` (10.x; peer RN >= 0.73, no Expo config plugin; requires a dev
  or store build - Expo Go's preview mode counts as unconfigured). Installed by the INTEGRATOR
  via `npx expo install react-native-purchases`. iOS uses StoreKit 2 by default (the SDK's
  `storeKitVersion: DEFAULT` picks it on iOS 16+; this app's minimum is 16.4) - no option is
  passed. No iOS entitlement/app.config change: the In-App Purchase capability is on by default
  for every App ID, so prebuild output is unchanged (verified via `npx expo config`).
- **Configuration:** optional per-platform PUBLIC SDK keys in `src/config/env.ts` +
  `env.example`: `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` (`goog_...`) and
  `EXPO_PUBLIC_REVENUECAT_APPLE_KEY` (`appl_...`). `isConfigured()` is true only when the
  RUNNING platform's key is set AND the native module is present; each platform ignores the
  other's key, so Android can sell while iOS is still closed (and vice versa). The platform key
  is resolved in `src/services/purchases/index.ts` wiring (the service keeps ONE `apiKey()` dep
  so unit tests stay platform-free). Everything else (missing key, Expo Go, web) keeps the
  Pricing screen exactly as today ("subscriptions coming soon", no purchase UI).
  `configure(uid)` runs on session start, so RevenueCat's `app_user_id` IS the Firebase uid -
  identical on both platforms (Apple sign-in users are plain Firebase uids too).
- **THE CLIENT NEVER WRITES `entitlements/{uid}`.** Firestore rules stay as they are (owner
  read, no client write). Writers are the RevenueCat webhook and the admin callable, both via
  the Admin SDK. `EntitlementSource` gained `'revenuecat'` and `'admin'` (types.ts).
- **Pricing UI state machine** (`pricingModel.ts` + `PricingScreen`): unconfigured -> today's
  catalog view. Configured -> load the current offering (`getOffering()`): show STORE price
  strings (never computed prices); load failure -> catalog prices + error banner with Retry and
  NO purchase buttons (no fake purchasable state). Purchase: `purchase(tier, cycle)`;
  'cancelled' is silent; an UPGRADE (tier increase from the current plan) -> "processing" state
  until the existing entitlement listener (`useEntitlement`) flips (webhook latency is seconds);
  failures -> localized AppError. Restore button when configured (`restore()`;
  'nothing_to_restore' gets its own message). Active paid plan -> current-plan display +
  "Manage subscription" (iOS: `showManageSubscriptions()` native sheet, URL fallback; Android:
  `manageUrl(productId)` Play deep link) - shown ONLY when `getActiveProductId()` reports a
  store subscription, never for admin-granted plans. All states have a11y labels, EN + ES.
- **Cycle switches and downgrades are IN-APP** (decision, supersedes the earlier
  out-of-app hints): Google Play's manage page cannot move a user between DISTINCT products
  (our cycles and tiers are four separate products), so pointing there was a dead end. Every
  non-current paid card is purchasable: `purchase()` already replaces the running subscription
  (Android `GoogleProductChangeInfo` { oldProductIdentifier,
  `PLAY_PRORATION_IMMEDIATE_WITH_TIME_PRORATION` } - unused time is credited as time on the new
  product, so no direction loses money; iOS: one subscription group, StoreKit applies its own
  rules and needs no product change). UI: the same-tier other-cycle card shows "Switch to
  yearly/monthly billing" (`pricing:store.switchToYearly/switchToMonthly`), a lower-tier card on
  Premium shows "Switch to Pro" (`pricing:store.switchTier`); a NON-upgrade purchase (same or
  lower tier: the entitlement plan may not change, and iOS applies some changes only at the next
  renewal) skips the 'activating' wait - it refreshes `getActiveProductId()` and shows the
  `pricing:store.changeConfirmed*` toast instead. The old `switchCycleHint`/`downgradeHint`
  cards and keys are removed. The double-billing guard stays: when the store cannot answer which
  product is active, the replacement purchase is aborted (retryable), never risked.
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
- **Reconciliation** (`functions/src/revenuecat/reconcile.ts`): `adminReconcileEntitlement`
  ({ uid }, admin custom claim) heals a drifted `entitlements/{uid}` against
  `GET https://api.revenuecat.com/v1/subscribers/{uid}` (Authorization: Bearer the SECRET
  `REVENUECAT_SECRET_KEY` - a Secret Manager secret bound ONLY to this callable; note the GET
  CREATES an empty RevenueCat customer for unknown ids, which is harmless). On-demand only (no
  scheduled sweep: drift is rare and user-visible; a sweep would hit the REST API for every
  subscriber daily and mass-write silently - the pure pieces are reusable if one is ever
  wanted). Deploy gating = the zoom/whatsapp pattern: exported only while the non-secret
  `REVENUECAT_RECONCILE_ENABLED` param is true at deploy time, so default deploys never
  reference the secret. Mapping: `entitlementFromSubscriber` produces the SAME
  `EntitlementWrite` shape as the webhook ('premium' over 'pro'; active / grace_period /
  expired / revoked; sandbox subscriptions ignored unless `REVENUECAT_ALLOW_SANDBOX`). Drift
  rule (`decideReconcile`): write ONLY when plan/status/expiresAt differ; an ACTIVE store
  subscription overwrites anything (like the next webhook event would), an empty or lapsed
  store state NEVER overwrites `source: 'admin'` (comps survive), and a still-granting
  `source: 'revenuecat'` document that RevenueCat no longer backs is expired (missed
  EXPIRATION heal). The written document carries `eventTimestampMs: null` so every future
  webhook event passes the stale-event guard. Audit log `revenuecat.reconciled` (adminUid, uid,
  outcome; never the key). Admin web: a per-user "Reconcile" button in the Users table
  (`public/admin/admin.js`, callable `adminReconcileEntitlement`) with a result toast
  (updated / unchanged / skipped_admin / no_data) that refreshes the row's plan cell.
- **Tests:** mapping unit tests per event type; webhook handler tests (auth, idempotency,
  TRANSFER, malformed body) with mocked firestore; reconcile tests (REST mapping, sandbox gate,
  drift decision incl. admin protection, handler over fake ports); app-side purchases service
  tests with a mocked `react-native-purchases`; pricing model tests for every UI state
  (both platforms' copy, switch/downgrade cards, the non-upgrade confirm path).

## 21. Admin dashboard

Contract: `functions/src/admin/schemas.ts` (zod, IMPLEMENTED - the callable names and shapes are
fixed there); callables in `functions/src/admin/index.ts` exported from `functions/src/index.ts`;
web app in `public/admin/` served by Firebase Hosting (firebase.json already serves `public/`);
short guide docs/v1/ADMIN.md (EN).

- **Auth:** every callable requires `request.auth.token.admin === true` (custom claim), else
  `permission-denied` (`unauthenticated` without auth). The claim is set offline with
  `functions/scripts/set-admin-claim.mjs <uid-or-email> [--role admin|viewer] [--remove]` (Admin SDK, ADC creds); `adminRole: 'viewer'` reads every view and writes nothing; every admin write lands in `adminAudit` (functions/src/admin/audit.ts).
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
  `src/config/env.ts` + `env.example` (EXPO_PUBLIC_REVENUECAT_ANDROID_KEY /
  EXPO_PUBLIC_REVENUECAT_APPLE_KEY), `functions/src/revenuecat/**` (webhook + reconcile) + their
  export lines in `functions/src/index.ts`, functions tests, i18n `pricing.json`, docs/v1/SETUP.md
  §11. The admin Users-table "Reconcile" button in `public/admin/admin.js` is the one sanctioned
  cross-over into the admin area (its callable lives under revenuecat/).
- **admin**: `public/admin/**`, `functions/src/admin/**` + the admin export lines in
  `functions/src/index.ts`, `functions/scripts/set-admin-claim.mjs`, functions tests,
  `firebase.json` (the scoped `/admin/**` headers entry ONLY), `firestore.indexes.json`
  (the `days.updatedAt` collection-group index ONLY), docs/v1/ADMIN.md.
- **shared**: `src/i18n/resources.ts` and navigation registrations - own lines only. Version
  bump, CHANGELOG, HANDOFF/TESTING updates: integrator.

## 24. Zoom auto links (server-created)

Contract: zoom* schemas + `CALLABLES.zoom*` + `ZOOM_ERROR_CODES` in `src/core/aiContract.ts`
(mirrored verbatim in `functions/src/shared/aiContract.ts`); app service contract `ZoomService` /
`UseZoomStatusResult` in `src/core/contracts.ts` (stubs in `src/services/zoom/`); capability mode
`auto_zoom` in `src/core/conference.ts` (IMPLEMENTED); callables in `functions/src/zoom/`
(zoomStatus IMPLEMENTED, write callables stubbed). Owner setup + deploy order: docs/v1/SETUP.md §12.

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
  and cannot fail on them. ONE amendment (§27): `whatsappWebhook` also binds the ZOOM_* secrets
  for its executor's zoom reuse, but only while `ZOOM_ENABLED` is true at ITS load time, which
  per SETUP §12 implies the secrets exist - deploys still can never fail on them. S2S token: POST zoom.us/oauth/token
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
- **One invitation email** (push hold, `src/core/pushHold.ts`): the link is written server-side
  seconds after the meeting is saved, and the calendar engine had already pushed the meeting on
  Save, so attendees got an invitation without the link followed by an "updated invitation"
  with it (user report, 2026-10-30). `ensureLink` now HOLDS the meeting id on
  `calendarPushHold` for the whole call: the engine's debounced flush keeps held ids in its
  local queues and the persisted Google and Outlook queues skip them (`holdPush` dep), the
  device export too. When the call settles, link or failure, the service re-announces the
  meeting as a local change (`meetings:changed`, origin user) and releases the hold; the engine
  flushes on the release, so ONE insert goes out carrying the join link (or none, after a
  failure). Holds nest and expire on their own after `PUSH_HOLD_MAX_MS` (30 s, longer than
  the callable timeout), so a lost release can never block a push. Edits made during the hold
  ride along in the same push.
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
`src/screens/shared/VerifyEmailBanner.tsx`. Owner console steps: docs/v1/SETUP.md §13.

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
  `email_verified` unless the provider is trusted (google.com; apple.com joins in §26 via
  `TRUSTED_SIGN_IN_PROVIDERS`). Client mirror:
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

## 26. Sign in with Apple and iOS readiness (iOS pass)

Contract: `AuthService.signInWithApple / revokeAppleTokens` and the reauthenticate provider order
in `src/core/contracts.ts`; `AuthContextValueImpl.signInWithApple` (wrapper, mirrors the Google
one: cancel -> `authCancelled`, errors -> `toFailure`); error mapping `mapAppleSignInError` in
`src/services/auth/authErrors.ts`; the official button in
`src/screens/auth/AppleSignInButton.tsx`. Owner console steps: docs/v1/SETUP.md §8.
New runtime dependency: `expo-apple-authentication` (installed with `npx expo install`; the
`app.config.js` plugin entry activates itself once the package resolves).

- **Flow** (`signInWithApple`, iOS ONLY): `isAvailableAsync()` gate (`unsupported` /
  `apple_sign_in_unavailable` elsewhere) -> raw random nonce (expo-crypto `getRandomBytes(32)`,
  base64url) -> `signInAsync({ requestedScopes: [FULL_NAME, EMAIL], nonce: SHA-256 hex of the raw
  nonce via Crypto.digestStringAsync })` -> `new OAuthProvider('apple.com').credential({ idToken:
  identityToken, rawNonce })` -> `signInWithCredential`. Apple checks that the token's nonce
  equals the hash; Firebase checks the raw nonce hashes to it (replay protection). The module is
  `require()`d lazily (pattern: `loadGoogleModule`), never top-level imported.
- **First sign-in only**: Apple returns `fullName`/`email` ONCE. When the Firebase user has no
  `displayName`, save the formatted name via `updateProfile` (best effort + `notifyProfileChanged`,
  exactly like `signUpWithEmail`). Cancel (`ERR_REQUEST_CANCELED`) resolves
  `{ status: 'cancelled' }` and stays silent in the UI.
- **Provider trust**: `TRUSTED_SIGN_IN_PROVIDERS` / `isTrustedSignInProvider` in
  `src/core/aiContract.ts` (mirrored verbatim in `functions/src/shared/aiContract.ts`;
  `npm run check:contract`). Apple accounts count as verified WITHOUT the email round-trip -
  Apple verified the Apple ID, and private-relay (Hide My Email) addresses belong to verified
  Apple IDs. This helper (never a literal provider string) is the gate in exactly these places:
  `isVerifiedCaller` in `functions/src/assistant/handler.ts`, `isVerifiedCaller` in
  `functions/src/zoom/index.ts` (server), and `needsEmailVerification` in
  `src/screens/shared/VerifyEmailBanner.tsx` (client mirror). App and functions semantics stay
  identical; everything §25 says about the gate is unchanged for password accounts.
- **Sessions**: nothing changes. The session manager keys on the Firebase user only; ensureProfile,
  migration and cleanup treat an apple.com session exactly like a Google or email one.
- **Account deletion** (App Review 5.1.1(v): revoke Apple tokens when the account dies). Flow for
  users with provider apple.com (checked FIRST, before google.com, in `useDeleteAccountFlow`):
  `reauthenticate()` (Apple branch: `signInAsync` with no scopes + fresh nonce ->
  `reauthenticateWithCredential`; the new single-use `authorizationCode` is stashed in the auth
  module only AFTER that call validated it - a code from a sheet confirmed with a different
  Apple ID, `auth/user-mismatch`, is never kept) -> `authService.revokeAppleTokens()` (a direct
  Identity Toolkit `accounts:revokeToken` POST with `tokenType: AUTHORIZATION_CODE` - the same
  request the native iOS SDK's `revokeToken(withAuthorizationCode:)` makes; Firebase exchanges
  the code with the Sign in with Apple key from docs/v1/SETUP.md §8.4 and revokes the Apple refresh token
  server-side. The JS SDK's `revokeAccessToken(auth, token)` is deliberately NOT used: it
  labels its argument an Apple ACCESS token, and Apple answers 200 to unrecognized token
  strings per RFC 7009, so passing the authorization code through it resolves while revoking
  nothing - an invisible failure of exactly this review requirement, only provable on a real
  device: docs/v1/TESTING.md T20 row 7) -> `sessionManager.deleteAccount()`
  (unchanged: callable -> revokeGoogleAccess best effort -> END). Revocation is BEST EFFORT +
  PROCEED: on failure show the `auth:deleteAccount.appleRevokeNotice` toast and continue. Why:
  the user's right to delete the account may not depend on Apple/Firebase revocation uptime (the
  deletion requirement itself), the server delete kills app access regardless, and the notice
  tells the user how to detach the app from their Apple ID manually. Order matters: revocation
  needs a signed-in user and runs BEFORE the delete callable (Google revocation stays after, as
  today). `reauthenticate` provider order: apple.com first on iOS when the module is usable (it
  refreshes the code revocation needs), otherwise google.com, otherwise password; on Android an
  apple.com-only session cannot exist (no Apple provider there).
- **Landing UI**: `AppleSignInButton` (official `AppleAuthenticationButton`) directly ABOVE
  "Continue with Google", iOS-only render, equal size/prominence (HIG + review 4.8). The native
  button localizes its own label; `accessibilityLabel` = `landing:signIn.apple`.
  EmailAuthScreen is untouched.
- **i18n keys** (EN+ES, parity-tested): `landing:signIn.apple`,
  `auth:errors.appleSignInUnavailable`, `auth:errors.appleSignInFailed`,
  `auth:deleteAccount.appleRevokeNotice`.
- **Config** (this pass): `version` 1.4.0 (new native module - store/APK build only, no OTA onto
  1.3.x), `ios.usesAppleSignIn: true`, conditional `expo-apple-authentication` plugin entry,
  1024x1024 `assets/icon.png` (Android adaptive icon unchanged), eas.json `ios-simulator` build
  profile (extends preview, `ios.simulator: true`) for browser-simulator testing (Appetize).
- **Tests required**: authService.signInWithApple (mocked expo-apple-authentication + firebase):
  success, cancel silent, unavailable, missing identityToken, first-sign-in name capture;
  reauthenticate apple branch + code stash; revokeAppleTokens (fresh code, stale code, failure);
  mapAppleSignInError rows; functions isVerifiedCaller x apple.com (assistant + zoom);
  needsEmailVerification x apple.com; AppleSignInButton render gate; delete-flow revocation
  order + best-effort notice; i18n parity (automatic).

## 27. WhatsApp bot (Cloud API)

Contract: whatsapp* schemas + `CALLABLES.whatsapp*` + `WHATSAPP_ERROR_CODES` in
`src/core/aiContract.ts` (mirrored verbatim in `functions/src/shared/aiContract.ts`); functions in
`functions/src/whatsapp/` (IMPLEMENTED); app service `src/services/whatsapp/` + the
`WhatsAppConnect` screen (owner app-ui). Owner setup + deploy order: docs/v1/SETUP.md §14.

The server owns ONE WhatsApp Cloud API phone number (Meta's free TEST number during development,
the client's own number after business verification; the go-live swap is exactly two values,
SETUP §14). Users link their WhatsApp phone to their account with a short-lived code; the bot
then reuses the ASSISTANT PIPELINE over WhatsApp and executes confirmed actions SERVER-side.

- **Functions** (`functions/src/whatsapp/index.ts`):
  - `whatsappLinkStart {} -> { code, expiresAtIso }`, `whatsappLinkStatus {} -> { enabled,
    linked, displayNumber, deepLink, linkedLast4 }`, `whatsappUnlink {} -> { unlinked }`: onCall, NO secrets,
    ALWAYS exported (zoomStatus precedent). status needs auth only and answers from the
    non-secret params + Firestore; start/unlink need a VERIFIED caller (same rule as the
    assistant) and throw `not_configured` while `WHATSAPP_ENABLED` is false (ratified: full
    WhatsApp data removal stays available through deleteAccount even while the feature is off).
    Errors carry `details.reason` from `WHATSAPP_ERROR_CODES` (rate_limited ->
    resource-exhausted).
  - `whatsappWebhook` (onRequest): exported ONLY while `WHATSAPP_ENABLED` is true at deploy time
    (`whatsappEnabledAtLoad()`, the exact §24 conditional-export pattern), so the default deploy
    never references the secrets and cannot fail on them. It is the ONLY function binding
    `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`; it also binds
    `OPENAI_API_KEY` (assistant fast path) and - **§24 amendment** - the ZOOM_* secrets, but
    ONLY while `ZOOM_ENABLED` is ALSO true at load time, which per SETUP §12 implies those
    secrets exist: a deploy still can never fail on missing secrets. Non-secret params:
    `WHATSAPP_PHONE_NUMBER_ID` (Graph sender id), `WHATSAPP_DISPLAY_NUMBER` (digits, wa.me deep
    link), `WHATSAPP_USER_DAILY_LIMIT` (default 50), tuning in `WHATSAPP_TUNING`.
- **Webhook pipeline** (`webhook.ts`, `signature.ts`): GET = Meta handshake (`hub.mode=subscribe`
  + timing-safe `hub.verify_token` match -> 200 with the raw `hub.challenge`, else 403). POST:
  1) `X-Hub-Signature-256` = HMAC-SHA256 of the RAW body bytes (`req.rawBody`; Meta escapes
  non-ASCII, so re-serialized JSON would break the digest) with the App Secret, compared
  timing-safely - reject 401, never log payloads; 2) per-message age check + dedupe: a message
  whose `messages[].timestamp` is older than `eventTtlDays` is dropped UNCLAIMED (the dedupe
  markers are purged on that schedule, so the acceptance window and the replay window coincide -
  a captured signed payload cannot be replayed after the purge), then the create-once marker
  `whatsappEvents/{sha256(wamid)}` (wamids can contain `/`), already-exists -> skip (absorbs
  Meta redelivery during long runs); 3) `value.statuses` and echoes from our own number are
  ignored; 4) INLINE processing: the function timeout (300 s) covers a whole worst-case batch
  (assistant deadline 50 s per message), and `processWebhookPayload` stops claiming FURTHER
  messages once `inlineBudgetMs` is spent, answering 500 so Meta redelivers the unclaimed rest
  (dedupe absorbs the processed part) - a claimed message is therefore never lost to a timeout
  kill. Inline vs task queue: no new deps/IAM/function, dedupe makes redelivery safe. Documented
  risk: Meta may throttle or disable a subscription that answers slowly; revisit a Cloud Tasks
  hop only if that is observed.
- **Collections** (ALL server-only, explicit deny blocks in firestore.rules like zoomMeetings;
  `phoneE164` = digits-only wa_id):
  - `whatsappLinks/{phoneE164}` = `{ uid, linkedAt, profileName|null }` (phone -> uid; the ONLY
    source of the executing uid).
  - `whatsappUsers/{uid}` = `{ phoneE164|null, linkedAt|null, codeHash|null, codeExpiresAt|null,
    codeIssuesToday, lastCodeAt }` (reverse index + code rate limit: max 5 codes/uid/UTC day,
    one active code).
  - `whatsappLinkCodes/{sha256(code)}` = `{ uid, expiresAt }` (O(1) webhook match; the plain
    code is returned to the app exactly once and never stored).
  - `whatsappSessions/{phoneE164}` = `{ uid|null, turns[<=10 {role,text,atIso}],
    pendingActions|null, pendingNonce|null, promptMsgId|null, actionsExpireAt|null,
    counts{day,inbound,unlinkedReplies,codeFailures}, updatedAt }`. Conversation context resets
    after 15 idle minutes (counters survive); sessions idle > 30 days are purged by
    dailyMaintenance, which also purges expired whatsappEvents and whatsappLinkCodes.
    WRITE DISCIPLINE (the webhook runs with real concurrency, so full-document writes from stale
    snapshots are banned): counters move ONLY through transactional record* increments (the caps
    read the post-increment value, so parallel deliveries cannot undercount); ordinary turns
    merge-write only `{uid, turns, updatedAt}` (`SessionPatch`); and the pending* fields are
    touched by exactly three paths - `savePendingProposal` (arm), `clearStalePending`
    (transactional disarm, only while the stored nonce still equals the one this invocation's
    snapshot carried, so a no-action turn can never swallow a proposal a concurrent message just
    armed) and `claimPendingActions` (atomic take). Nothing else can resurrect a claimed
    proposal, so a confirmed action list executes exactly once.
- **Linking**: the app calls whatsappLinkStart (6-digit crypto-random code, TTL 10 min; the
  daily-cap check, the replacement of the previous code doc and the rate-limit write run in ONE
  `mintCode` transaction, so concurrent calls can neither exceed the cap nor strand a
  replaced-but-still-redeemable code doc), the user sends the code to the bot number
  (allow-listed during the test phase). Webhook, six-digit text from an UNLINKED sender: ONE
  transaction validates the code hash, writes whatsappLinks + whatsappUsers (cleaning any
  previous phone of the uid or previous uid of the phone), stamps the session's uid (disarming
  any proposal pending under a previous uid) and deletes the code doc -> bilingual success
  reply. A six-digit text from a LINKED phone attempts the SAME redemption first (account
  switch on one phone: rebinding replies linkSuccess in the NEW account's language; expired
  replies codeExpired; only 'invalid' falls through to the assistant). A failed redemption
  (typo or stale code) answers codeExpired - accurate in both cases - and counts toward
  `codeFailuresPerPhonePerDay` (10): past that ceiling the webhook stops redeeming entirely
  (silent for unlinked phones, plain chat for linked ones), which is the hard brute-force bound
  on the 6-digit space. Anything else from an unlinked phone -> "link your account in the app"
  (EN+ES in one message), capped at 3/phone/day. unlink and deleteAccount (port
  `deleteWhatsAppData`, called after the usage purge) delete the same trio. The app's Settings
  screen shows the MASKED linked number (`linkedLast4`), so an account owner notices if a
  leaked code bound someone else's phone; Unlink is one tap away there.
- **Assistant bridge**: `runAssistant(uid, request, deps)` is the auth-free seam split out of
  `handleAssistant` (same file; the callable still parses + gates exactly as before), and
  `buildAssistantDeps(db)` (assistant/index.ts) is the shared dependency set - the WhatsApp path
  therefore consumes the SAME per-user daily quota (PLAN_DAILY_AI_LIMITS), global budget and
  admin usage counters as the app. Request: session turns + the new message, `language` from
  `users/{uid}/settings/preferences` (fallback 'en': the inbound payload carries NO locale, so
  there is no WhatsApp-side language signal), `timezone` from preferences (fallback UTC), mode
  'chat'. quota_exceeded -> localized limit message. Replies and all bot strings live in
  `messages.ts` (EN+ES, plain punctuation; unlinked senders get bilingual messages).
- **Confirm flow**: proposed MUTATING actions are never executed directly. The bot sends the
  action summaries plus interactive reply buttons Confirm/Cancel (ids `wa_confirm:<nonce>` /
  `wa_cancel:<nonce>`; text fallback 1/yes/si/ok vs 2/no/cancel, accent-normalized), stores them
  as `pendingActions` with a 15 min expiry, and executes only on confirm. The prompt body
  budgets its BULLETS (per-summary cap + "and N more" collapse), never the tail, so the 1/2
  instruction always survives the interactive-body limit. If the buttons message fails to send,
  the same body goes out as plain text (it carries the 1/2 instruction); if that also fails,
  the proposal is disarmed - an armed proposal the user never saw must not be confirmable by a
  stray later "1". `claimPendingActions` clears the pending set INSIDE a transaction, so a
  double tap or a redelivered tap finds nothing to execute (idempotency; `promptMsgId`
  identifies the proposal). The confirm reply distinguishes full success from PARTIAL
  application ("some changes could not be applied") whenever any confirmed action - or any
  member of a bulk_update - failed. `share_meeting` and `list` are answered IMMEDIATELY with a
  forwardable formatted summary (never email); scopes 'occurrence'/'following' are declined
  ("use the app") - the recurrence split/override engine is app-only.
- **Executor** (`executor.ts`): applies confirmed create/update/delete/bulk_update via the Admin
  SDK on `users/{uid}/meetings`. uid comes ONLY from the link doc; every action is re-validated
  with the SAME zod contract; written documents match the exact shape `isValidMeeting` accepts
  (source 'whatsapp') and the app's `parseMeetingDoc` reads, so the rules bypass grants nothing
  the client path would not. Deletes tombstone with the app's scrub set. Zoom reuse: provider
  zoom + url null + ZOOM_ENABLED -> `handleZoomCreateMeeting` via the exported `zoomDeps()`;
  schedule edits -> sync; deletes -> remove; all best effort (a failure keeps url null and the
  app heals it via ensureLink, §24).
- **Abuse bounds**: per-PHONE `WHATSAPP_USER_DAILY_LIMIT` (default 50) counted ATOMICALLY on the
  session doc (transactional increment, checked on the post-increment value - parallel blasts
  cannot stretch the cap; bounds Graph sends and Firestore work from unlinked spam, repeated
  buttons and code guessing even without a uid); over the cap -> ONE bilingual notice, then
  silent drop. Unlinked prompts capped at 3/phone/day. Link codes capped at 5/uid/day
  (transactional), failed redemptions at `codeFailuresPerPhonePerDay` 10/phone/day (then no
  redemption attempts at all). Send failures are LOG AND DROP, never
  retried (the bot only ever replies inside Meta's 24 h service window, so free-form sends are
  always allowed; template-only error 131047 cannot normally occur).
- **Logging**: uid, wamid and `phoneLogId` ONLY, where `phoneLogId` is the first 16 hex chars of
  sha256 of "wa:" + phoneE164 (pseudonymous; unkeyed because the secret-free callables log too).
  NEVER message text, meeting content, codes, tokens or raw phone numbers.
- **App side** (`src/services/whatsapp/`, `WhatsAppConnectScreen`): the service caches the last
  whatsappLinkStatus answer per auth session; the connect screen polls whatsappLinkStatus every
  8 s ONLY while a link code is pending AND the screen is focused and the app foregrounded (so
  the screen flips to "linked" by itself), and stops otherwise - the callable load stays
  negligible. The code view names the bot number next to the code (WhatsApp may live on another
  device than the app, where the wa.me button cannot open); the linked view shows the MASKED
  linked phone (`linkedLast4`). Known gap (accepted for now): there is no owner push/email on a
  successful link - the server has no push pipeline yet; the masked number plus the 8 s poll is
  the visibility story until one exists.

## 28. Microsoft To Do (Graph; V2 Stage 2, M7)

Contract: `TodoSyncService` in `src/core/contracts.ts`; implementation in
`src/services/tasks/todo/` (api / mapping / state / sync / service mirror the Outlook provider,
§17) on the shared Graph HTTP core `src/services/microsoft/graphHttp.ts` (Bearer token,
401 refresh-once, 429/5xx backoff, AppError mapping; the Outlook client uses the same core).
Without `EXPO_PUBLIC_MSAL_CLIENT_ID` the service is unconfigured, `CalendarStatus.todo` stays
absent, the To Do card is hidden and the engine skips the provider.

- **Account.** The Microsoft account the Outlook card connects: the same refresh token
  (`microsoftTokenManager`, exported by `src/services/calendar/outlook`) and one consent that
  includes `Tasks.ReadWrite`. A consent granted before M7 (no Tasks scope) makes Graph answer 403
  on `/me/todo`; the service records `permission_denied` and the card asks to reconnect Outlook.
  "Connected" (`status.todo.connected`) mirrors the Outlook connection; "enabled" is this
  device's switch (`mg:{uid}:tasks.todo`, like the Outlook connection it does not sync between
  devices). The chosen DEFAULT LIST is in Preferences (`todoListId`, `todoListName`), synced.
- **List choice.** `enable(list)` stores the list, pulls it, queues every open unlinked task and
  flushes; `setList` changes the default for NEW tasks only. A task can name its own list
  (`external.todoListId`, set at creation through `TaskInput.todoListId` or later through
  `TaskPatch.todoListId`); the push engine deletes the old copy and creates a new one when the
  desired list differs from the actual one (Graph cannot move tasks). `state.links` (local task
  id -> actual list + To Do id, this device) tells the two apart; other devices read the link
  from the task document. The assistant's confirm card and the task editor show the list name
  before anything is saved (`AiActionPreview.todoListName`, `TaskEditorTodo`).
- **What syncs.** Title, notes (`body`, text), due DATE, reminder (a To Do instant: due time
  minus the offset), done state (`status: completed`), deletion. What stays in MeetingGuard only,
  and the editor says so: a due time without a reminder, people, the meeting link, the zone.
  Due dates are pushed as local midnight of the task's zone (UTC with the Prefer header) and read
  back as the local date NEAREST to the instant in the device zone, so UTC-midnight dates from
  other clients land on the right day too (`nearestLocalDate`). A To Do reminder coming back
  becomes due time + whole-day offset when the days differ by at most a week, else a reminder at
  the due time. A task completed in To Do before MeetingGuard ever saw it is history and is not
  imported.
- **Pull.** `/me/todo/lists/{listId}/tasks/delta` for the default list plus every list a linked
  task lives in; delta links persisted per list; a full listing on the first sync of a list,
  every 7 days and on HTTP 410. `@removed` deletes the local task; a linked task missing from a
  full listing is deleted too. Imports use `tasksRepository.create` with the deterministic id
  `td_<To Do id or hash>`, origin `tasks_todo`, source `todo`; link write-backs use origin
  `tasks_todo`. The engine pushes that origin on to Google Tasks only (the app bridges the two
  providers, `taskPushTargets`), never back to To Do; the push-side hash check keeps a link
  write-back from costing a call. Conflict rule: a local change waiting in
  the queue wins over the pulled version; otherwise To Do's `lastModifiedDateTime` wins when it is
  newer than the stored `todoUpdatedAt`; an unchanged visible hash is skipped (echo suppression).
- **Push.** `tasks:changed` events with origin `user` / `ai` (the data engine emits them for local
  task writes and remote snapshots, carrying the removed tasks' links on delete) are queued
  persist-first in `state.pending` and flushed after the engine's 2 s debounce; POST / PATCH /
  DELETE `/me/todo/lists/{listId}/tasks`; a 404 on PATCH re-creates; blocking codes (offline,
  token, 403) keep the queue, retryable ones count attempts up to 8, the rest are dropped and
  counted as failed. A finished task that was never pushed is not created in To Do.
- **Timing.** `syncNow` (session start, foreground, 5-minute interval, connectivity, "Sync now",
  pull-to-refresh, background refresh) runs the To Do flush + pull after the calendars. While the
  app is active the engine also pulls To Do on its own every `TODO_FOREGROUND_INTERVAL_MS` (60 s),
  so a task completed in To Do silences its reminder here within a minute (the task reminder
  reconciler reacts to the repository change). In the background the cadence is the OS background
  refresh.
- **Disable.** Forgets the queue, delta links and links; deletes the tasks imported from To Do
  (their copies stay in Microsoft); clears the links of the other tasks and the list in
  preferences. Session end wipes `mg:{uid}:*` like every other sync state; the token is the
  Outlook cleanup hook's job.
- **Status.** `CalendarStatus.todo` (`configured`, `connected`, `enabled`, `listId`, `listName`,
  syncing / lastSyncAt / lastError) through `useCalendarStatus`; sync reports gain
  `report.todo` (`TodoSyncResult`) and errors use provider `'todo'`.
- **Tasks screen triggers.** Pull-to-refresh on the Tasks screen runs
  `calendarSyncEngine.syncTasksNow()` (To Do and Google Tasks flush + pull only, no calendars;
  `TaskSyncReport` with one error entry per failing provider, the first one shown as a toast), and
  gaining focus runs the same sync quietly at most once every 15 s (`useTasksRefresh`,
  `src/screens/tasks/useTasksRefresh.ts`), so opening the screen is enough to see what changed
  elsewhere. The one-minute pull and the debounced push keep running in the background.
- **Tests.** `src/services/tasks/__tests__` (mapping, sync with a scriptable Graph fake, service),
  `src/services/calendar/__tests__/engineTodo.test.ts`, the data engine's task write options and
  event (`engineTasks.test.ts`), the rules drift test, the calendar sync screen's To Do card and
  the executor preview. Device test guide: `docs/v1/TESTING.md` T22.

## 29. Spoken debrief (V2 Stage 2, M8)

After a meeting the user says what was agreed, and the assistant turns that into task proposals
linked to the meeting. Nothing is saved until each card is confirmed. Contract v7
(`src/core/aiContract.ts` = `functions/src/shared/aiContract.ts`): a third assistant mode,
`debrief`, carrying `followUpMeetingId` (the meeting that ended) and exactly one trailing user
message, the transcript.

- **Entry points.** Meeting details shows **Debrief this meeting** once the meeting has ended
  (`canDebrief` in `src/screens/meetings/debrief.ts`: start + duration in the past; a series once
  its first occurrence started; never a cancelled meeting). It opens the chat with
  `AIChat { debrief: meetingId }` (deep link `meetingguardai://assistant?debrief=<id>`). The
  follow-up banner (post-meeting notification, `followup` param) offers a **Debrief** button that
  opens the same panel, so the notification flow and the details screen meet in one place.
- **Capture.** `DebriefPanel` (`src/screens/assistant/DebriefPanel.tsx`) shows the meeting, a hint,
  an editable transcript box and a microphone. The microphone is the chat screen's ONE voice
  session (`useVoiceInput`, expo-speech-recognition, up to `VOICE_MAX_SESSION_MS` = 60 s, silence
  timers as in the composer) routed by target: while the panel captures, interim text goes into
  the panel instead of the composer and the final text never auto-sends. The user reads the
  transcript, fixes it if needed and taps **Create tasks**; typing instead of speaking works too.
  `sendableDebrief` caps the text at 4000 characters (the contract's message limit).
- **Request.** `AssistantController.startDebrief(meetingId, transcript)` adds the transcript as a
  user message carrying `debriefMeetingId` (the bubble is labelled "Debrief: <title>") and runs
  the request with `mode: 'debrief'`, `followUpMeetingId: meetingId` and ONLY that one message:
  earlier chat turns never steer a debrief. The reply is labelled the same way. A debrief does not
  mark the meeting in `followUpsRequested` (a meeting can be debriefed again), and a failed one is
  retried with the same transcript (`FailedRequest { mode: 'debrief', meetingId, userMessageId }`,
  also detected for a thread restored from storage). `debriefInFlight` drives the loading text.
- **Server.** `functions/src/assistant`: debrief mode always carries the task context and task
  tools (a v7 client by definition), uses `toolChoice: 'required'` and a `# Debrief mode` prompt
  block: the transcript is speech-to-text (expect misheard words), one `create_task` per
  commitment, every task with `meeting_ref` = the ended meeting, the owner in `people` by name
  (only names the user said or participants of that meeting; the user is never a person entry;
  emails only when spelled out, like every other task person), relative deadlines resolved from
  the date table, no date when none was said, titles that start with a verb in the transcript's
  language, a 1-2 sentence reply. `mapToolCalls` enforces the rule the prompt states: in debrief
  mode only `create_task`, `create_meeting` (an explicitly requested follow-up meeting), the two
  list tools and `suggest_replies` are accepted; anything else is dropped as `not_allowed`.
  Fallback replies: `debrief` (tasks proposed, empty model text) and `debrief_empty` (nothing to
  turn into a task). A v6 server rejects the mode as `invalid_request`; deploy the functions with
  the app (`npm run deploy` in `functions/`).
- **Confirmation.** The proposals are the usual `create_task` cards (title, due, people, the
  linked meeting, the To Do / Google Tasks list when a sync is on): Review and Confirm, Reject,
  the pending bar's "Review all", and the spoken "yes, confirm" of the voice confirmation flow.
  Confirmed tasks are created through the task executor with the meeting link and reach the
  connected task providers through the normal push path (§28, §30).
- **Tests.** Contract (`aiContract.test.ts` both sides), controller and conversation (debrief
  request shape, labels, retry), chat model (params, `sendableDebrief`), the assistant screen
  (panel open / send / close, loading text), meeting details (button and navigation),
  `canDebrief`; server: prompt block, tool guard (`actions.test.ts`), handler end to end
  (`handler.test.ts` "debrief mode (v7)"). Device test guide: `docs/v1/TESTING.md` T23.

## 30. Google Tasks (Tasks API v1; V2 Stage 2, M8)

Contract: `GoogleTasksSyncService` in `src/core/contracts.ts`; implementation in
`src/services/tasks/gtasks/` (types / api / mapping / state / sync / service / index), a one-to-one
mirror of the Microsoft To Do engine (§28) over the Google Tasks REST API
(`https://tasks.googleapis.com/tasks/v1`). Everything said in §28 about queueing, echo
suppression, conflict rule, timing, disable and status holds here with the `gtasks` names; this
section lists what differs.

- **Build switch.** `isConfigured()` is `EXPO_PUBLIC_GOOGLE_TASKS_SYNC !== 'off'` (default ON;
  store builds set `off` until Google verifies the scope, `docs/v1/SETUP.md` §4.6). Off: no
  `CalendarStatus.gtasks`, the card is hidden, the engine skips the provider.
- **Account and scope.** The Google account signed in natively on the device (GoogleSignin), the
  same one Google Calendar uses. The sensitive scope `https://www.googleapis.com/auth/tasks`
  (`GOOGLE_TASKS_SCOPES`) is requested incrementally when the user taps "Sync tasks with Google
  Tasks": `listLists` asks for it before loading the lists, since the chooser comes before "Start
  sync" (`enable` asks too when it was skipped; `authService.requestTasksScope`,
  `GoogleSignin.addScopes`; an email/password user is signed in to Google first). A decline shows
  the card's "access was not granted" text and nothing is queued. `getGoogleAccessToken({ requireTasks: true })` throws
  `tasks_scope_missing` (new `AppErrorCode`, EN/ES text) when the scope is missing; the card then
  says access was not granted. A Google Calendar disconnect with revoke disables the Google Tasks
  sync first (`googleCalendarService.disconnect`), since the revoke takes the tasks grant too.
- **Lists.** `tasks/v1/users/@me/lists`; the API has no default flag, so the first list (Google's
  built-in "My Tasks") is marked `isDefault`. The chosen default list lives in Preferences
  (`gtasksListId`, `gtasksListName`), a task's own list in `external.gtasksListId`
  (`TaskInput.gtasksListId` / `TaskPatch.gtasksListId`). The API cannot move a task between
  lists: delete + create, like To Do.
- **What syncs.** Title, notes, due DATE and done state (`status: needsAction | completed`;
  reopening clears `completed` explicitly). Google Tasks has no reminders and ignores the time
  part of `due` (stored as `<date>T00:00:00.000Z`), so the due time, the reminder, people, the
  meeting link and the zone stay in Meeting Guard; an import keeps the existing local due time and
  reminder when the date did not change. The visible hash is title + notes + due date + done.
  Subtasks are flattened (the parent is ignored). A task already completed when first seen is not
  imported.
- **Pull.** `tasks.list` with `showCompleted`, `showHidden` and `showDeleted` for the default
  list plus every list a linked task lives in, paged (100 per page). No delta links: the state
  keeps an `updatedMin` watermark per list (the previous pull time minus a 2-minute skew margin;
  items inside the margin re-list as unchanged); a full listing runs on the first sync of a list,
  every 7 days and whenever the watermark is missing. `deleted: true` deletes the local task; a
  linked task missing from a full listing is deleted too. Imports use the deterministic id
  `gt_<Google id or hash>`, origin `tasks_gtasks`, source `gtasks`; link write-backs use origin
  `tasks_gtasks` (pushed on to Microsoft To Do only, never back to Google; §28).
- **Push.** Same queue as To Do (`state.pending`, persist-first, the engine's debounce; POST /
  PATCH / DELETE; a 404 on PATCH re-creates). Blocking codes additionally include
  `google_not_signed_in` and `tasks_scope_missing` (everything stays queued); a 403 on one task is
  that task's failure. HTTP mapping in `gtasks/api.ts`: 401 invalidates the token and retries
  once, 429 / 5xx / rate-limit 403 back off with jitter and honour Retry-After, scope 403 becomes
  `tasks_scope_missing`.
- **Storage and rules.** State in `mg:{uid}:tasks.gtasks` (`USER_STORAGE.gtasksTasks`).
  Firestore: `external` accepts `gtasksListId / gtasksTaskId / gtasksUpdatedAt`, `source` accepts
  `gtasks`, preferences accept `gtasksListId / gtasksListName` (`firestore.rules`; deploy with the
  build). The task READ schema (`taskDocReadSchema`) fills every external key an older build did
  not write (`fillTaskExternalRefs`), like the meeting reader: a reader that requires a new key
  silently hides every older document in the app while the server-side assistant still lists
  them (the November 2, 2026 "WhatsApp still shows deleted tasks" report).
- **UI.** The "Google Tasks" card on the Calendar sync screen (`GoogleTasksCard`, states via
  `gtasksStateView`; needs the Google session, else "Sign in with Google on this device first");
  the task editor's second list box (`TaskEditor` `gtasks` prop, the box component is shared with
  To Do as `ListSyncBox`); the assistant's confirm card shows "Google Tasks list: <name>" next to
  the To Do list (`AiActionPreview.gtasksListName`, `describeTaskDraft`). Sync reports gain
  `report.gtasks` and provider `'gtasks'`.
- **Tests.** `src/services/tasks/__tests__/gtasks{Mapping,Sync,Service}.test.ts` with
  `__testUtils__/gtasksFakes.ts`, the engine (`engineTodo.test.ts` gtasks cases), the auth
  service scope cases, the calendar sync model and screen, the executor preview, the rules drift
  test and the rules fixture. Device test guide: `docs/v1/TESTING.md` T24.

## 31. Sign in with Microsoft (custom token through the microsoftSignIn callable)

Contract: `AuthService.signInWithMicrosoft`, the custom-token branch of `reauthenticate` and
`AuthContextValue.signInWithMicrosoft / canSignInWithMicrosoft` in `src/core/contracts.ts`;
request / response schemas and `MICROSOFT_SIGN_IN_REASONS` in `src/core/aiContract.ts` (=
`functions/src/shared/aiContract.ts`). Client flow in `src/services/microsoft/signIn.ts` over the
shared PKCE prompt `src/services/microsoft/authPrompt.ts` (the Outlook connection's
`outlook/authAdapter.ts` is now a thin port over it); server in `functions/src/microsoftSignIn.ts`.
Owner steps: docs/v1/SETUP.md §10.6.

- **Why a callable.** The Firebase JS SDK cannot exchange a Microsoft token itself
  (`signInWithCredential` is not supported for Microsoft, and the popup/redirect flow is web
  only). The app therefore runs the Microsoft PKCE sign-in it already has for Outlook, with the
  identity scopes only (`MICROSOFT_OAUTH.signInScopes` = openid profile email: no offline_access,
  so no refresh token exists and nothing is stored), sends the id_token to `microsoftSignIn`
  and signs in with the Firebase custom token it answers. One Azure registration serves both
  flows; the Outlook connection remains its own consent with its own refresh token.
- **Client.** `signInWithMicrosoft`: `EXPO_PUBLIC_MSAL_CLIENT_ID` required (else
  `not_configured` / `microsoft_not_configured`; the Landing button is hidden through
  `canSignInWithMicrosoft`), raw nonce (same generator as Apple's) in the authorize request,
  `requestMicrosoftIdToken` (prompt with `prompt=select_account`, code exchange at
  `/oauth2/v2.0/token` with a plain fetch, 30 s timeout) -> callable `{ idToken, nonce }` ->
  `signInWithCustomToken`. A closed browser resolves `cancelled`; a second tap joins the running
  flow. Server reasons map to auth reasons: `microsoft_not_configured`, `email_in_use`
  (`conflict`), `microsoft_token_invalid` -> `microsoft_sign_in_rejected` (retryable); a failed
  browser flow is `microsoft_sign_in_failed`. EN/ES texts in `auth:errors.*`.
- **Server** (`handleMicrosoftSignIn`, unauthenticated by design, 30 s, maxInstances 10).
  `verifyMicrosoftIdToken`: RS256 with Node crypto against Microsoft's published keys
  (`login.microsoftonline.com/common/discovery/v2.0/keys`, cached 24 h, one refetch per minute on
  an unknown kid); `aud` = `MICROSOFT_CLIENT_ID`, `iss` = `https://login.microsoftonline.com/{tid}/v2.0`
  with `tid` under the `MICROSOFT_TENANT` policy (common: any; consumers: only the personal
  tenant; organizations: anything but it; a GUID: that tenant), `exp` / `nbf` with 60 s skew,
  `nonce` = the request nonce, `oid` and `sub` present. Email = the `email` claim, else
  `preferred_username` when it is an address; `emailVerified` only for personal accounts (the
  consumer tenant) or a work account carrying `xms_edov: true` (Microsoft does not vouch for
  other work-account emails, which is what would otherwise allow an account takeover by email).
- **User resolution.** `microsoftIdentities/{oid}` = `{ uid, tid, email, createdAt, lastSignInAt }`
  (server only; rules deny clients). Known oid -> that uid. Unknown oid with an email that already
  belongs to a Firebase user -> joined to that account (`linked`) only when the email is verified,
  else `already-exists` / `email_in_use` (the user signs in with the method they used before).
  Otherwise a new user `ms_<oid>` (`emailVerified` from the claim, display name from `name`).
  The custom token carries the developer claim `signInProvider: 'microsoft.com'`. Account
  deletion removes the identity documents (`deleteMicrosoftIdentities`, before the Auth user).
- **Session shape.** A custom-token user has no `providerData`: `signedInWithMicrosoft(user)` in
  `src/services/auth/authResults.ts` is `providerIds.length === 0`. The verification banner
  follows `emailVerified` as for password accounts (a work account without the verified-domain
  claim is asked to verify; the email is sent the usual way). `reauthenticate` for such a session
  runs the Microsoft flow again and signs in with a fresh custom token for the SAME uid (a new
  `auth_time` for the account deletion); another Microsoft account is `user_mismatch`, never a
  switch. A Microsoft identity joined to a Google account keeps reauthenticating through Google.
- **UI.** Landing: "Continue with Microsoft" between Google and email, the glass style of the
  email button with the Microsoft mark (`testID landing-microsoft`), hidden without a client id.
  The delete-account flow treats a custom-token session like a provider account (reauthenticate,
  then the server call).
- **Tests.** `src/services/microsoft/__tests__/signIn.test.ts`,
  `src/services/auth/__tests__/authService.microsoft.test.ts`, the Landing and Settings screens;
  server `functions/test/unit/microsoftSignIn.test.ts` (a key pair generated in the test covers
  every verification failure, the tenant policy and the linking rules) and the deleteAccount
  ordering. Device test guide: `docs/v1/TESTING.md` T25.

## 32. Website writes (pushPending; V2 Stage 2)

The website (Sven's, a separate codebase) creates, edits and cancels meetings by writing the
same `users/{uid}/meetings/{id}` documents the app writes. It cannot reach Google Calendar or
Outlook: the Google token stays on the phone (privacy policy), and the website has no Google
sign-in of its own. So a website write reaches the providers through the app, exactly like a
change made in the app, and the website says which documents need that with ONE field.

- **Contract.** The website writes `pushPending: true` on every meeting document it creates,
  updates or cancels, together with a fresh `updatedAt` (the snapshot merge is last-writer-wins
  on `updatedAt`, and an unchanged `updatedAt` is never applied). A cancel is the app's
  tombstone (`deletedAt` = `updatedAt` = now, the other fields kept), never a document delete,
  so the app can remove the provider event and the attendees get the cancellation mail. A Google
  Meet request is `conference: { provider: 'google_meet', url: null, password: null }`; the push
  creates the link (`wantsMeetLink`) and writes it back. A Zoom request is
  `conference: { provider: 'zoom', url: null, password: null }` followed by the website's call to
  `zoomCreateMeeting` (section 24): the app keeps the push back until the server's link
  write-back arrives (a partial update that keeps `pushPending` and bumps `updatedAt`), so the
  attendees get ONE invitation that already carries the Zoom link (`awaitsZoomLink`, the website
  counterpart of the app's own push hold). When Zoom creation fails for good the website rewrites
  the meeting with another provider or a pasted link, flag set, or it is never pushed. The rules
  accept the flag as a boolean (`isValidMeeting`); the website never clears it.
- **App.** The read schema drops the flag (it never enters the `Meeting` model, so every app
  write of the document, the provider write-back included, leaves it out). The data engine reports
  the flagged ids on the `meetings:changed` event (`reason: 'remote'`, `pushRequested`) when it
  accepts the document (`mergeRemoteMeeting`), except a live Zoom meeting without a link yet
  (`awaitsZoomLink`). The calendar engine queues those ids for Google
  and Outlook as upserts, persist-first like a local write (`onMeetingChanged`); a tombstone is
  turned into a delete by the push itself. Device calendar exports already refresh on every remote
  change.
- **Limits.** Nothing happens until a phone with the app receives the change and has the provider
  connected (the website shows "Meet link pending" until then). A meeting written before Google or
  Outlook is connected is picked up by the first-connection backfill
  (`enqueueUpcomingOwnMeetings`). Two phones that both see the flag both push: the Google event
  id is deterministic (`googleEventIdForMeeting`), so the second push patches instead of
  duplicating, and an unchanged Google-visible hash is never re-sent. A document whose flag the
  write-back never cleared (push failed for good) is pushed again the next time it arrives changed.
- **Tests.** `src/services/data/__tests__/engine.test.ts` (flag reported, never stored, Zoom
  held until the link), `src/core/__tests__/pushHold.test.ts` (`awaitsZoomLink`),
  `src/services/calendar/__tests__/engine.test.ts` and `engineOutlook.test.ts` (queued like a
  local write), `functions/test/rules/firestore.rules.test.ts` (flag accepted, non-boolean
  rejected). Device test guide: `docs/v1/TESTING.md` T26.

## 33. Running late (V2 Stage 2, M9)

The user picks how late they are, gets a ready message in the UI language with the meeting title
and the new time, edits it and sends it FROM THE PHONE through the share sheet or the mail
composer. Moving the meeting is a separate decision taken afterwards, never a side effect of
sending, and the app never claims a message was delivered.

- **Entry points.** The dashboard card (`NextMeetingCard`: "Running late" under the buttons of
  the running and the next meeting), meeting details ("Running late" while the meeting, or the
  next live occurrence of a series, has not ended), the MAX alarm modal and the MEDIUM banner
  ("Running late" next to Snooze; the alert is resolved as `open` first, like Details, so the
  alarm stops and the full-screen modal unmounts before the sheet shows). Every entry point calls
  `openRunningLate({ meetingId, startAt })` (`src/screens/meetings/RunningLateSheet.tsx`): a
  module store read by `RunningLateHost`, rendered once in `AppRoot` next to `AlertHost`.
  The host loads the live meeting (`useMeeting`) and resolves the ROW the user meant
  (`resolveRunningLateMeeting`, `src/screens/meetings/runningLate.ts`): a one-off meeting as it
  is, or one occurrence of a series (the one starting at `startAt` when the alert or the
  dashboard row knows it, else the next live one; the details screen passes null). Nothing live
  (deleted, cancelled, all-day, over) closes the sheet with a notice.
- **Compose.** Chips for 5, 10, 15 and 30 minutes (`RUNNING_LATE_DELAYS`). The new start is
  the delay after the scheduled start, or after now (next whole minute) once the meeting has
  started, so the message never names a time in the past (`runningLateNewStart`). The message
  (`buildRunningLateMessage`, `meetings:runningLate.message`) carries the title and the new
  time (clock only on the same day, date too otherwise) and is an editable text box; a new delay
  rewrites it. The participants are listed as a hint (the share sheet cannot pre-address) and
  "Email participants" opens the mail composer with them as recipients (`buildMailtoUrl`).
- **What the phone reports.** `shareOutcome`: iOS reports completion (`sharedAction`, the
  chosen app finished its activity) or dismissal; Android reports `sharedAction` as soon as the
  sheet opens. So the sheet says "your phone confirms the message was handed to the app you
  chose" on iOS, "the message went to the app you chose; Meeting Guard cannot see whether it
  was sent" on Android and after the mail composer, and "nothing was sent" (staying on the
  message) when iOS reports a dismissal. The word "delivered" never appears.
- **Move.** A second step, after the message or through "Just move the meeting" (people already
  told): "Move the meeting to <time>?" with the scope spelled out (one occurrence of a series
  only; Google / Outlook push when sync is on; a device-calendar import stays in the app) and
  Move / Keep the time. Move is `runningLateMove` + `applyScopedWrite`
  (`src/screens/meetings/scopedWrite.ts`): `meetingRepository.update` for a one-off meeting,
  `updateOccurrence` (a 'modified' override, section 16) for a series, origin 'user' in both
  cases, so the calendar engine pushes it and the alert engine re-plans the alarms like any
  other edit. The length is kept: the meeting ends later.
- **End meeting now** (client request, November 3; same module). The running meeting offers
  "End now" on the dashboard card and "End meeting now" on details: after a confirmation
  `endNowWrite` shortens it to the elapsed whole minutes (at least one; one occurrence only for a
  series), so "Happening now" clears and the alarms stop.
- **Tests.** `src/screens/meetings/__tests__/runningLate.test.ts` (resolution, new start,
  message EN/ES, outcome, scoped writes), `RunningLateSheet.test.tsx` (compose, share,
  dismissed, Android, mail, just move, series, not live, Spanish), the dashboard and details
  screen tests (entry points, End now). Device test guide: `docs/v1/TESTING.md` T27.
