# MeetingGuard AI

Bilingual (EN/ES) meeting assistant for Android and iOS, built with Expo / React Native.
Package / bundle id: `com.meetingguard.ai` (published on Google Play).

> **Status: stabilization in progress.** The app is being cleaned up, moved to the latest
> Expo SDK and to a Firebase backend (Auth + Firestore + Cloud Functions). Subscriptions are
> disabled in this release (the Pricing screen shows "Subscriptions coming soon").

## Stack

- Expo SDK 57 (React Native 0.86, React 19.2, New Architecture + Hermes), Continuous Native
  Generation, React Navigation 7 (stack)
- React Native Paper, `@expo/vector-icons`, `react-native-safe-area-context` (edge-to-edge)
- Firebase JS SDK 12 (Auth + Firestore + callable Cloud Functions), native Google Sign-In
  (`@react-native-google-signin/google-signin`)
- i18next + react-i18next + expo-localization (EN/ES, switchable without a restart)
- `expo-notifications`, `expo-background-task`, `expo-task-manager`, `expo-calendar`, `expo-audio`
- Sentry (`@sentry/react-native`, enabled only when `EXPO_PUBLIC_SENTRY_DSN` is set)
- TypeScript (`strict`) for all of `src/` (no JavaScript left there; `@/*` path alias ->
  `src/*`); only the entry files and tool configs at the root are JavaScript
- Tooling: ESLint 9 (flat config, `eslint-config-expo`), Jest (`jest-expo`) +
  React Native Testing Library, GitHub Actions CI (`.github/workflows/ci.yml`)

### What runs where

- **Sign-in**: Google (native SDK -> Firebase Auth credential) and email/password. No client
  secret or refresh token is stored by the app; Google access tokens come from the native SDK on
  demand.
- **Data**: Firestore is the source of truth; the app keeps a per-user AsyncStorage cache and a
  write outbox, so meetings can be created and edited offline.
- **Google Calendar**: two-way sync on the device (incremental `calendar.events` scope); device
  calendars (Apple / Android) through `expo-calendar`.
- **Alerts**: OS notifications scheduled on the device (rolling window, Android channels per
  intensity) plus the in-app MAX / MEDIUM / LIGHT alert UI.
- **AI assistant**: the `assistant` callable Cloud Function calls OpenAI (server-side secret,
  daily quota per plan) and only proposes actions; the app asks the user to confirm each one.
- **Subscriptions**: purchase buttons are hidden ("coming soon"); plans are read from the
  server-owned `entitlements/{uid}` document.

See `docs/ARCHITECTURE.md` for the module map, contracts, session lifecycle and data layout.

## Getting started

Prerequisites: Node.js 22 or 24, npm 10+, and for native builds either EAS (`npm i -g eas-cli`)
or a local Android Studio (JDK 17) / Xcode 26.4+ setup.

```bash
npm install
cp env.example .env      # fill in values - never commit .env
npm start                # Metro + dev client
```

The app uses `expo-dev-client`, so it runs in a development build (not Expo Go):

```bash
eas build --profile development --platform android
```

## Scripts

| Script | What it does |
| --- | --- |
| `npm start` | Start Metro |
| `npm run android` / `npm run ios` | Local native build + run (`expo run:*`, generates `android/` / `ios/`) |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Jest (`jest-expo` preset) |
| `npm run check:bundle` | Bundle the JS for Android into `dist/check-bundle` (quick "does it bundle" check) |
| `npm run doctor` | `expo-doctor` dependency / config checks |

## Configuration

- **`app.config.js` is the single Expo config** (there is no `app.json`).
- **Native folders are generated**: `android/` and `ios/` are git-ignored. Use
  `npx expo prebuild` locally if you need them; EAS generates them on the build server.
- **Versioning**: `version` in `app.config.js` is the user-facing version. Android
  `versionCode` / iOS `buildNumber` are stored remotely by EAS (`appVersionSource: "remote"`)
  and auto-incremented for `production` builds.
- **Environment variables**: see `env.example`; they are read and validated (zod) only in
  `src/config/env.ts`. Only public values (`EXPO_PUBLIC_*` Firebase web config, OAuth client
  IDs, optional Sentry DSN) may be shipped in the app - never an OpenAI key or a client secret
  (those belong in Firebase Functions secrets). If required values are missing the app shows an
  "App not configured" screen instead of crashing. Configure them as EAS environment variables
  for cloud builds; `.env` files are never uploaded to EAS (`.easignore`).
- **Sentry**: set `EXPO_PUBLIC_SENTRY_DSN` to enable crash reporting. Source-map upload during
  EAS builds needs `SENTRY_ORG`, `SENTRY_PROJECT` and `SENTRY_AUTH_TOKEN` (EAS secret); without
  them the upload step is skipped and the build still succeeds.
- **Private material** (credentials, contracts) must stay out of the repo; `reference/`,
  `.env*`, keystores and service-account JSON files are ignored by git and EAS.

## Firebase backend

`functions/` (TypeScript, Node 22, its own `package.json`), `firestore.rules`,
`firestore.indexes.json` and `firebase.json` hold the backend. Copy `.firebaserc.example` to
`.firebaserc` (git-ignored) with your project id, then:

```bash
cd functions && npm ci && npm run build && npm test
firebase functions:secrets:set OPENAI_API_KEY      # never in the app or the repo
firebase deploy --only functions,firestore:rules,firestore:indexes
```

- The functions region comes from the `FUNCTIONS_REGION` param (default `us-central1`) and must
  match the app's `EXPO_PUBLIC_FUNCTIONS_REGION`.
- `OPENAI_MODEL` (default `gpt-5.4-mini`) and `OPENAI_REASONING_EFFORT` are deploy-time params.
- `npm run test:rules` (in `functions/`) runs the security-rules tests on the Firestore emulator
  (Java 21); CI runs them on every push.
- `public/delete-account.html` is the account-deletion page for Google Play (Firebase Hosting).
  Replace the `REPLACE_WITH_SUPPORT_EMAIL@example.com` placeholders before deploying it.

## Project structure

```
index.js          # Entry: gesture handler, Intl polyfill, Sentry, i18n, background tasks
App.js            # Configuration gate -> src/navigation/AppRoot (providers + navigation)
src/
  core/           # Pure TypeScript contracts, types, ids, events, errors, time (no RN/Expo)
  services/       # data, auth, calendar, alerts, ai, attachments (one public entry per area),
                  # sentry, billing (plan catalog)
  navigation/     # Root navigator, deep links, route registration
  screens/        # Every screen, one folder per area (home, meetings, calendar, notes, ...)
  i18n/           # i18next setup + locales/{en,es}/<namespace>.json
  components/     # App shell (header, sidebar, error boundary), shared UI, alerts UI (alerts/)
  contexts/       # Theme (system / light / dark)
  hooks/, utils/  # useResponsive, locale-aware formatting
functions/        # Firebase Cloud Functions (assistant, deleteAccount)
public/           # Static web pages (account deletion instructions)
docs/             # Architecture
```

## License

Private repository; no open-source license is granted.
