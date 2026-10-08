# MeetingGuard AI

MeetingGuard AI is a bilingual (English / Spanish) meeting assistant for Android and iOS. It
reminds you before every meeting with alerts at three levels (MAX, MEDIUM, LIGHT). It syncs with
Google Calendar and the calendars on the phone. An AI assistant creates, moves and shares meetings
from plain text, and nothing changes until you confirm.

- Package / bundle id: `com.meetingguard.ai`. Deep-link scheme: `meetingguardai://`.
- Google Play has **v1.0.9 (versionCode 20)**. It was built from an older code base with a different
  backend.
- This branch (`stabilization`) is **v1.1.0**. It is a rebuild on Expo SDK 57 and Firebase, and it has
  **not been released or tested on a device yet**.
- What changed: `CHANGELOG.md`. What to do next: `docs/HANDOFF.md`.

## Feature status

- **Done:** the code is complete and has automated tests, but nobody has checked it on a real device
  yet (see `docs/TESTING.md`).
- **Partial:** it works with the limits listed.
- **Not in this pass:** it is not built.

| Area | Feature | Status | Notes |
|---|---|---|---|
| Account | Google sign-in (native SDK + Firebase Auth), sign-out | Done | Email/password exists in the auth service but has no screen. |
| Account | Account deletion (in the app and on a web page) | Done | `public/delete-account.html` needs the real support email before you host it. |
| Onboarding | 5 steps: language, calendars, alerts, AI intro, first meeting | Done | |
| Meetings | Create, edit and delete with the form; details; list with search and filters; month calendar | Done | You cannot create recurring meetings yet. |
| Meetings | Offline use (local cache + write queue), sync when back online | Done | |
| Meetings | One-time import of v1.0.9 local data after the upgrade | Done | Needs the upgrade test in `docs/TESTING.md`. |
| Alerts | Scheduled OS notifications per intensity, snooze buttons, post-meeting follow-up | Done | Exact timing needs the user's "Alarms & reminders" permission (Android 12+). |
| Alerts | In-app MAX full-screen alert, MEDIUM banner, LIGHT toast, sound, vibration, voice | Partial | The full-screen alert and the voice readout only work while the app is open. When the phone is locked or the app is closed, MAX is a high-priority alarm notification (there is no full-screen intent). Ringing during Do Not Disturb needs one setting from the user. |
| AI | Assistant chat: create / update / delete / share / bulk update / list, EN and ES, confirmation card for every action | Done | Runs in a Cloud Function (OpenAI key stays on the server). Daily quota per plan: free 5, pro 100, premium 500. |
| AI | Post-meeting follow-up suggestions; AI insights (on-device statistics + optional AI tips) | Done | |
| Calendars | Google Calendar two-way sync, real Google Meet links | Done | Primary Google calendar only. |
| Calendars | Phone calendars (Apple / Android) import and export | Done | |
| Calendars | Outlook / Microsoft 365 | Not in this pass | |
| Channels | WhatsApp bot | Not in this pass | The app shows "coming soon". |
| Language | Instant EN/ES switch, local date formats, 12/24-hour clock setting | Done | |
| Notes | Notes linked to meetings (synced, work offline) | Done | |
| Notes | Attachments on a meeting | Partial | Files stay on the phone. They are not uploaded or synced. |
| Look | Light / dark / system theme | Done | |
| Money | Subscriptions (Google Play, App Store, Stripe) | Not in this pass | The Pricing screen shows the plans and "coming soon". The daily AI quota per plan is already enforced by the server. Plans can be granted by hand (`functions/README.md`). |
| Money | Admin dashboard, home-screen widgets | Not in this pass | Planned for Milestone 6 (`docs/HANDOFF.md`). |
| Platform | iOS app | Partial | The config exists, but it was never built. It needs an Apple account, Sign in with Apple and a 1024 px icon. |
| Operations | Crash reporting (Sentry), OTA updates (EAS Update), CI | Done | Sentry is on only when `EXPO_PUBLIC_SENTRY_DSN` is set. OTA updates reach builds from 1.1.0 on. |
| Security | Firebase App Check | Not in this pass | See `functions/README.md` "App Check". |

## Tech stack

- **App:** Expo SDK 57 (React Native 0.86.3, React 19.2.3, New Architecture, Hermes), strict
  TypeScript in `src/` (path alias `@/*` -> `src/*`), React Navigation 7 (stack), React Native Paper.
- **Backend:** Firebase JS SDK 12 (Auth, Firestore, callable Functions); Cloud Functions v2 in
  TypeScript on Node 22 (`functions/`); OpenAI through the `assistant` function.
- **Sign-in:** `@react-native-google-signin/google-signin` (native Google Sign-In) -> Firebase Auth.
- **Device features:** `expo-notifications`, `expo-background-task`, `expo-task-manager`,
  `expo-calendar`, `expo-audio`, `expo-speech`, `expo-haptics`, `expo-intent-launcher`.
- **Language:** i18next + react-i18next + expo-localization, date-fns for dates.
- **Operations:** Sentry (`@sentry/react-native`), EAS Build / Submit / Update (`expo-updates`),
  GitHub Actions (`.github/workflows/ci.yml`).
- **Quality:** ESLint 9 (flat config), Jest (`jest-expo`) + React Native Testing Library, zod.

## Quick start

**Expo Go does not work.** The app uses native modules that Expo Go does not have (Google Sign-In,
`expo-dev-client`, custom notification sounds and channels). You need a **development build**.

Prerequisites:

- Node.js 22 (22.13 or newer) or 24 (24.3 or newer), and npm.
- `eas-cli` 24.8 or newer: `npm install -g eas-cli`.
- An Android phone with USB debugging, or an Android emulator.
- For local native builds only: Android Studio with JDK 17 (or Xcode on a Mac).

The Firebase, Google and EAS setup is in `docs/SETUP.md`. After that:

```bash
npm ci                                           # install exactly what package-lock.json lists
eas login
eas env:pull --environment development           # writes .env.local (git-ignored)
eas build --profile development --platform android   # cloud build of the dev client (APK)
```

To fill in the values yourself instead of `eas env:pull`, copy `env.example` to `.env` and edit it.
Never commit `.env*`.

Install the APK from the build page on the phone, then start Metro:

```bash
npm start            # expo start --dev-client
```

Open the MeetingGuard AI dev client on the phone and pick the server. With a USB cable,
`adb reverse tcp:8081 tcp:8081` lets the phone reach Metro on your computer.

If the app shows "App not configured", a required `EXPO_PUBLIC_*` value is missing or invalid (see
`src/config/env.ts`).

## Scripts

App (repository root):

| Command | What it does |
|---|---|
| `npm start` | Start Metro for the development build (`expo start --dev-client`). |
| `npm run android` / `npm run ios` | Local native build and run (`expo run:*`). Generates `android/` / `ios/`, which are git-ignored. |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Jest (all app tests) |
| `npm run check:bundle` | Bundle the JS for Android into `dist/check-bundle` (quick "does it bundle" check). |
| `npm run doctor` | `expo-doctor` |
| `npm run apk:sha1` | Create the local test signing key once (outside the repository) and print its SHA-1 / SHA-256. |
| `npm run apk:test` | Build a release test APK on this PC for emulators, signed with that key (`docs/TESTING.md` B.2). Needs Android Studio. |
| `npm run update:preview -- "message"` | Publish an OTA update to the `preview` channel. |
| `npm run update:production -- "message"` | Publish an OTA update to the `production` channel. |
| `node assets/sounds/generate-sounds.js` | Regenerate the alert sounds in `assets/sounds/`. |

Cloud Functions (`cd functions` first):

| Command | What it does |
|---|---|
| `npm run build` / `npm run typecheck` / `npm run lint` | Compile to `lib/`, type check, lint. |
| `npm test` | Unit tests (no network, no emulator). |
| `npm run test:rules` | Firestore security-rules tests on the emulator (needs Java 21). |
| `npm run check:contract` | Checks that `functions/src/shared/aiContract.ts` equals `src/core/aiContract.ts`. |
| `npm run serve` | Build and start the Auth, Firestore and Functions emulators. |
| `npm run deploy` / `npm run deploy:rules` | Deploy the functions / the Firestore rules and indexes. |
| `npm run logs` | Show the function logs. |

## Project structure

```
index.js            Entry: gesture handler, Intl polyfill, Sentry, i18n, background tasks
App.js              Configuration check -> src/navigation/AppRoot (providers + navigation)
app.config.js       The only Expo config (no app.json); android/ and ios/ are generated
eas.json            Build profiles, update channels, submit settings
env.example         Every EXPO_PUBLIC_* variable, with where to find its value
src/
  core/             Pure TypeScript: types, AI contract, ids, events, errors, logger, time
  config/           env.ts (validated EXPO_PUBLIC_* values), firebase.ts
  services/         data, auth, calendar, alerts, ai, attachments, sentry, updates, billing
  navigation/       Root navigator (Auth / Onboarding / Main), deep links, screen registration
  screens/          One folder per area: home, meetings, calendar, notes, assistant, settings, ...
  components/       App shell (header, sidebar, error boundary) and alerts UI (components/alerts)
  contexts/         Theme (system / light / dark)
  i18n/             i18next setup and locales/{en,es}/<namespace>.json
  hooks/, utils/    useResponsive, locale-aware formatting (utils/format.ts)
functions/          Firebase Cloud Functions: assistant, deleteAccount (own package.json)
firestore.rules     Firestore security rules (tests in functions/test/rules)
public/             Static web pages (account deletion page)
plugins/            Expo config plugins: no device transfer, local test-APK signing
scripts/            Local build tools: build-test-apk.mjs (npm run apk:test / apk:sha1)
docs/               Setup, architecture, deployment, testing, handoff
```

## Documentation

| Document | Read it when |
|---|---|
| `docs/HANDOFF.md` | You take over the project: what changed, what to do next, open decisions. |
| `docs/SETUP.md` | You set up Firebase, Google OAuth, EAS and the functions from zero (secret rotation first). |
| `docs/ARCHITECTURE.md` | You change code: layers, contracts, data model, alert and sync pipelines, conventions. |
| `docs/TESTING.md` | You run the automated tests or the on-device test plan. |
| `docs/DEPLOYMENT.md` | You release a build or an OTA update, or you roll one back. |
| `functions/README.md` | You work on the Cloud Functions (assistant, quotas, deleteAccount, emulators). |
| `CHANGELOG.md` | You want the list of changes since v1.0.9. |

## Rules for secrets

Only public values go into the app (`EXPO_PUBLIC_*`). Expo copies every `EXPO_PUBLIC_*` value into
the app bundle, so anyone who has the APK can read it. The OpenAI key lives only in Firebase
Functions secrets. The app has no Google client secret. `.env*`, `reference/`, keystores and
service-account JSON files are ignored by git and by EAS (`.gitignore`, `.easignore`). CI fails if the
Android bundle contains something that looks like a secret.

## License

Private repository; no open-source license is granted.
