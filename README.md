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
- Firebase JS SDK 12 (Auth + Firestore; Cloud Functions client ready for the AI backend)
- `expo-notifications`, `expo-background-task`, `expo-task-manager`, `expo-calendar`, `expo-audio`
- Sentry (`@sentry/react-native`, enabled only when `EXPO_PUBLIC_SENTRY_DSN` is set)
- JavaScript with incremental TypeScript (`allowJs`, `strict`; new modules are `.ts`/`.tsx`,
  `@/*` path alias -> `src/*`)
- Tooling: ESLint 9 (flat config, `eslint-config-expo`), Jest (`jest-expo`) +
  React Native Testing Library, GitHub Actions CI (`.github/workflows/ci.yml`)

### Temporarily unavailable in this build

- **AI assistant**: direct OpenAI calls were removed (the key was extractable from the APK). It
  will come back as a Firebase callable Cloud Function.
- **Google sign-in / Google Calendar connect / token refresh**: the old flows needed the Google
  OAuth client secret in the app or the retired Render backend. Sign-in is being rebuilt with
  `@react-native-google-signin/google-signin` + Firebase.
- **Subscriptions**: purchase buttons are hidden ("coming soon").

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

## Project structure

```
index.js          # Entry: Sentry init + registerRootComponent(App)
App.js            # Providers + navigation
src/
  api/            # Data entities, Google Calendar, AI, billing catalog
  components/     # Shared UI, alert system (NotificationSystem/)
  config/         # env.ts (typed public env), firebase.ts, feature flags
  contexts/       # Auth and theme contexts
  hooks/          # React hooks
  pages/          # Screens
  services/       # Notifications, background tasks, Firebase services
  utils/          # Helpers
public/           # Static web pages (account deletion request form)
```

## License

Private repository; no open-source license is granted.
