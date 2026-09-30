# Changelog

All notable changes to MeetingGuard AI. Versions follow `version` in `app.config.js`. That value is
also the OTA runtime version.

## [1.2.0] - Unreleased (branch `stabilization`)

This version is a rebuild. It is compared here with **v1.0.9**, the version on Google Play
(versionCode 20, built in September 2025 from commit `ef4963f`). None of the later v1.0.x work on
`main` (up to `3308b9d`) was ever released. The developer handoff is in `docs/HANDOFF.md`.

The version number jumped from 1.1.0 (test builds only, never published) to 1.2.0 when the
full-screen alarm native module was added: a new native module changes the runtime version, so it
needs a new store/APK build and must never ship as an OTA update onto a 1.1.0 binary.

### Draft store release notes

- **EN:** New MeetingGuard AI: alerts that work even when the app is closed - including full-screen
  alarms over the lock screen on Android - recurring meetings, two-way Google Calendar sync, phone
  calendars, a smarter AI assistant that always asks before changing anything, notes, and instant
  English/Spanish switching. Please sign in again with Google. Your meetings from the previous
  version are imported automatically.
- **ES:** Nuevo MeetingGuard AI: alertas que funcionan incluso con la app cerrada - incluidas
  alarmas a pantalla completa sobre la pantalla de bloqueo en Android - reuniones recurrentes,
  sincronización en ambos sentidos con Google Calendar, calendarios del teléfono, un asistente de IA
  más inteligente que siempre pide confirmación antes de cambiar algo, notas y cambio instantáneo
  entre inglés y español. Vuelve a iniciar sesión con Google. Tus reuniones de la versión anterior se
  importan automáticamente.

### Added

- **Sign-in and account:**
  - Google sign-in with the native Google SDK and Firebase Auth.
  - Account deletion in the app (Settings -> Account) and a web page for Google Play
    (`public/delete-account.html`).
- **Onboarding:** 5 steps: language, calendars, alerts (including the notification and exact-alarm
  permissions), AI intro, and a guided first meeting.
- **Sync:** meetings, notes and settings are stored per user in Firestore and sync across devices. The
  app works offline: changes wait in a local queue and are sent when the connection returns.
- **Import of v1.0.9 data:** the meetings, notes and preferences that v1.0.9 kept on the phone are
  imported once, into the account with the same email.
- **Alerts:**
  - OS notifications that fire when the app is in the background or closed, and after a reboot.
  - An Android notification channel per intensity (with and without vibration).
  - Exact alarms (after the user allows them) and an option to ring during Do Not Disturb (MAX).
  - In the app:
    - **MAX:** a full-screen alert with a looping alarm that gets louder, a spoken readout in English
      or Spanish, vibration and a 60-second auto-snooze.
    - **MEDIUM:** a banner that stays until you act.
    - **LIGHT:** a toast.
  - "Snooze" buttons on the notification, and a post-meeting follow-up notification.
  - **Full-screen MAX alarms on Android** (new native module `mg-fullscreen-alarm`): a MAX alert
    shows over the lock screen even when the app is closed, on the meeting's alert channel, and
    pending alarms are restored after a reboot. When the module or the permission is missing
    (revocable on Android 14+) the alert falls back to a normal notification, never lost and never
    doubled. Alert settings and onboarding show the real full-screen and exact-alarm permission
    state on devices with the module.
  - Settings for alert times, intensity per meeting, sound type, volume, vibration and snooze length.
    The 12/24-hour time format is in Settings, next to the language.
- **Calendars:**
  - Two-way Google Calendar sync: create, update and delete in both directions, with invitations for
    participants and real Google Meet links.
  - **Outlook / Microsoft 365 sync (phase 1):** connect a Microsoft account (PKCE sign-in, no
    server); two-way sync with the account's default calendar over Microsoft Graph delta queries,
    with Teams links for online meetings. Needs an Azure app registration
    (`EXPO_PUBLIC_MSAL_CLIENT_ID`, `docs/SETUP.md` §10); the Outlook card is hidden when it is not
    configured. In this version recurring series, and meetings that came from Google or the phone
    calendars, are not pushed to Outlook.
  - Import from and export to the calendars on the phone (Apple / Android).
- **Recurring meetings (phase 1):**
  - A "Repeat" section in the meeting form: daily / weekly (with weekday chips) / monthly, an
    interval ("every 2 weeks"), and an end (never, on a date, or after N times). English and Spanish.
  - The dashboard, list and calendar show one row per occurrence; details show the rule in words and
    the next occurrences.
  - Editing or deleting an occurrence asks the scope: "This meeting only" (that occurrence) or
    "The whole series". One occurrence can be moved, resized, renamed or removed without touching the
    rest of the series.
  - The assistant understands repeat requests ("every Monday at 9", "cada lunes a las 9") and scoped
    changes ("delete only tomorrow's standup"); confirmation cards state the rule and the scope.
  - Google Calendar sync pushes the series as a real recurring event (cancelled occurrences
    included). Time changes of a single occurrence stay in MeetingGuard in this version.
- **AI assistant:**
  - It runs on our server (Cloud Function) and understands English and Spanish.
  - It can create, update, delete, share, bulk-update and list meetings.
  - It shows a confirmation card for every action, and nothing changes without your confirmation.
  - It knows the current date and your time zone, and gives follow-up suggestions after meetings.
  - Daily request limit per plan: 5 on the free plan.
- **Screens:**
  - Edit meeting (it was "coming soon").
  - Meeting details with attachments. The files stay on the phone.
  - Meetings list with search and filters.
  - A month calendar.
  - Notes that are saved and synced (they were sample data).
  - Insights computed on the phone.
  - Forms keep the field you type in above the keyboard, and ask before discarding unsaved changes.
- **Look and language:**
  - Instant English/Spanish switching without a restart, with local date and time formats.
  - Light, dark and system themes.
- **Legal:** complete privacy policy and terms in English and Spanish. The company details are still
  placeholders.
- **Operations:**
  - Crash reporting with Sentry (optional).
  - A daily Cloud Function (`dailyMaintenance`) erases deleted-meeting records after 60 days on the
    server, as the privacy policy says, and account deletions are recorded for 30 days so that a
    backup restore cannot bring a deleted account back (`functions/scripts/replay-account-deletions.mjs`).
  - Over-the-air JavaScript updates with EAS Update (channels development / preview / production).
  - GitHub Actions CI and about 1,000 automated tests (app, Cloud Functions, Firestore rules).
  - Local test APKs for emulator testing without EAS: `npm run apk:test` builds a release APK signed
    with a local test key (EAS Update off) and `npm run apk:sha1` prints that key's SHA-1
    (`docs/TESTING.md` B.2).

### Changed

- **Platform:** Expo SDK 52 -> **57**, React Native 0.76.9 -> **0.86.3**, React 18.3 -> **19.2.3**,
  New Architecture, Android target API 36.
- **Code:** all app code under `src/` is now strict **TypeScript** (it was JavaScript).
- **Backend:** the Render (Express + Supabase) backend is replaced by **Firebase**: Auth, Firestore
  with security rules, and Cloud Functions (`assistant`, `deleteAccount`).
- **Languages:** i18next with namespaced EN/ES files replaces the custom dictionary. The language is
  detected from the phone and saved.
- **Pricing:** the Pricing screen shows the contract prices (Pro $7.99, Premium $14.99, 25% off
  yearly) and "Subscriptions coming soon". There are no purchase buttons and no payment links.
- **App name:** the launcher name is now "MeetingGuard AI" (it was `meeting-guard-ai`).
- **Android:**
  - Backup of app data is off (`allowBackup: false`), and data extraction rules also exclude it from
    device-to-device transfers (Android 12+).
  - `RECORD_AUDIO`, `READ_CONTACTS` and `SYSTEM_ALERT_WINDOW` are blocked.
  - `SCHEDULE_EXACT_ALARM` was added.
- **App size:** icons are imported per family (Ionicons, MaterialCommunityIcons, MaterialIcons), so
  the bundle carries 3 icon fonts instead of all 19 (about 2 MB less). ESLint blocks the
  `@expo/vector-icons` barrel import.
- **Sign-in:** users must sign in again (with Google). The v1.0.9 backend session is not carried over.

### Removed

- **Stripe Payment Links** for subscriptions. They broke Google Play payment rules, and the only
  link compiled into v1.0.9 was a test-mode link.
- **Secrets in the app:** the OpenAI key and the Google OAuth client secret. OpenAI is called only
  from the server.
- **Debug and fake features:**
  - the debug and test screens
  - the fake "API Keys" screen
  - the "Delete the ADSF meeting" chat chip, which deleted the newest meeting without asking
  - fake conference links
  - "invitations sent" messages that sent nothing
- **WhatsApp:** the placeholder WhatsApp screen and route. The creation chooser shows WhatsApp as "not
  available yet".
- **Old code (for developers):**
  - All JavaScript screens and components: `src/pages/*` and the JS versions of the header, sidebar,
    theme toggle, error boundary, confirmation modal and badges.
  - `translations.jsx`, `AlertScheduler`, `NotificationSystem`, `contexts/{Theme,Auth}Context.jsx`.
  - `config/imageSliderConfig.js`, `hooks/{useGoogleAuth,usePersistentNotification}.js`.
  - `utils/{responsive,meetingHelpers,storage}.js`, `utils/index.ts`.
  - `api/{entities,localStorage,googleCalendar,googleTokenManager,calendarSyncManager,manualLoginGoogleCalendarService,emailService,fileUpload}.js`.
  - `services/{firebaseAuth,firestoreService}.js`.
  - The stage-2 compatibility shims.
  - `react-native-iap`, `expo-av`, `expo-background-fetch`, `react-native-dotenv` and about 35 unused
    packages.
  - Code that is still needed to read old data now lives in `src/services/data/legacyInput.ts`.

### Fixed (problems in v1.0.9)

- Alerts only fired while the app was open on the Dashboard; v1.0.9 had no OS notifications. They are
  now scheduled with the OS.
- A chat suggestion chip deleted a meeting without confirmation.
- The AI chat used an OpenAI key inside the app.
- The Google sign-in flow depended on a backend route that returned other users' Google tokens. The
  app now uses native Google Sign-In and stores no tokens.

### Security

- No secrets in the app bundle; CI scans the bundle on every push (and fails if it cannot scan it).
- Firestore security rules, with emulator tests:
  - Users read and write only their own data.
  - Plans (`entitlements`) and usage counters are server-only.
- Google access tokens come from the native SDK when needed and are never stored. The old plaintext
  token keys are deleted at start.
- Sentry drops personal data (emails, query strings, console arguments). The logs never contain
  tokens, emails, meeting text or chat text.
- The assistant treats meeting data as untrusted input (prompt-injection defences). It accepts only
  email addresses that the user typed or that already belong to the meeting.

### Known issues

See `docs/HANDOFF.md` §4. The main ones:

- Full-screen alarms over the lock screen are Android-only and need the `mg-fullscreen-alarm`
  native module in the build (revocable by the user on Android 14+; the app then falls back to a
  high-priority notification).
- Exact alarms and the Do Not Disturb override need the user's permission.
- Outlook sync needs an Azure app registration and pushes neither recurring series nor meetings
  that came from Google or the phone calendars. Deleting or editing our own series occurrence by
  occurrence in Google/Outlook web does not import back.
- WhatsApp and subscriptions are not built.
- Recurring meetings: "this and following" edits do not exist, and moving a single occurrence is not
  pushed to Google Calendar (the change is only in MeetingGuard).
- Attachments stay on the phone.
- iOS has not been built.
- **Nothing was tested on a device.**

## [1.0.9] - September 2025 (Google Play, versionCode 20)

The version on Google Play when this work started. It was built from commit `ef4963f`:

- Login through the Render backend.
- Meetings stored only on the phone.
- Alerts only while the app was open.
- Subscriptions through Stripe Payment Links.
