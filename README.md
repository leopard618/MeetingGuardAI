# MeetingGuard AI

Bilingual (EN/ES) meeting assistant for Android and iOS, built with Expo / React Native.
Package / bundle id: `com.meetingguard.ai` (published on Google Play).

> **Status: stabilization in progress.** The app is being cleaned up, moved to the latest
> Expo SDK and to a Firebase backend (Auth + Firestore + Cloud Functions). Subscriptions are
> disabled in this release (the Pricing screen shows "Subscriptions coming soon").

## Stack

- Expo (managed workflow, Continuous Native Generation), React Native, React Navigation (stack)
- React Native Paper, `@expo/vector-icons`
- Firebase JS SDK (Auth + Firestore)
- `expo-notifications`, `expo-background-fetch`, `expo-task-manager`, `expo-calendar`
- JavaScript with incremental TypeScript (`tsconfig.json` has `allowJs`; new modules are `.ts`/`.tsx`)

## Getting started

Prerequisites: Node.js LTS, npm, and for native builds either EAS (`npm i -g eas-cli`) or a
local Android Studio / Xcode setup.

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
| `npm test` | Placeholder until the test setup lands |
| `npm run doctor` | `expo-doctor` dependency / config checks |
| `npm run export:android` | Bundle the JS for Android (quick "does it bundle" check) |

## Configuration

- **`app.config.js` is the single Expo config** (there is no `app.json`).
- **Native folders are generated**: `android/` and `ios/` are git-ignored. Use
  `npx expo prebuild` locally if you need them; EAS generates them on the build server.
- **Versioning**: `version` in `app.config.js` is the user-facing version. Android
  `versionCode` / iOS `buildNumber` are stored remotely by EAS (`appVersionSource: "remote"`)
  and auto-incremented for `production` builds.
- **Environment variables**: see `env.example`. Only public values (`EXPO_PUBLIC_*` Firebase
  web config, OAuth client IDs, optional Sentry DSN) may be shipped in the app. Configure them
  as EAS environment variables for cloud builds; `.env` files are never uploaded to EAS
  (`.easignore`).
- **Private material** (credentials, contracts) must stay out of the repo; `reference/`,
  `.env*`, keystores and service-account JSON files are ignored by git and EAS.

## Project structure

```
App.js            # Providers + navigation (entry)
src/
  api/            # Data entities, Google Calendar, AI, billing catalog
  components/     # Shared UI, alert system (NotificationSystem/)
  config/         # Firebase and app configuration
  contexts/       # Auth and theme contexts
  hooks/          # React hooks
  pages/          # Screens
  services/       # Notifications, background tasks, Firebase services
  utils/          # Helpers
public/           # Static web pages (account deletion request form)
```

## License

Private repository; no open-source license is granted.
