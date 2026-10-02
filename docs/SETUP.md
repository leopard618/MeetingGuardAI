# Setup from zero

This guide takes you from an empty machine to a working development build, deployed Cloud Functions
and cloud builds. Do the steps in order. Each step says where the value goes.

- Accounts you need (the client owns most of them, so ask for access first): Google Cloud / Firebase,
  Expo (EAS), Google Play Console, OpenAI, GitHub. For the clean-up in §1 you also need Render,
  Supabase and Stripe. For iOS you need an Apple Developer account.
- The release process is in `docs/DEPLOYMENT.md`, the tests in `docs/TESTING.md`, and the open
  decisions in `docs/HANDOFF.md`.

Contents:

1. Secrets rotation (do this first)
2. Tools
3. Firebase project
4. Google Cloud: OAuth clients, consent screen, Calendar API
5. EAS (Expo)
6. Cloud Functions, rules and hosting
7. Sentry (optional)
8. iOS (when the client decides)
9. Final check
10. Microsoft/Outlook (Azure app registration)
11. RevenueCat + Google Play subscriptions (in-app purchases)
12. Zoom auto links (Server-to-Server OAuth app)
13. Email/password sign-in (Firebase provider)

---

## 1. Secrets rotation (do this first)

The published v1.0.9 app and the git history contain real secrets. **Rotating them is the fix.**
Removing them from git only hides them, and copies already exist. Every day the old values stay valid,
anyone with the APK or the repository can use them (OpenAI costs, database access, payment events).

### 1.1 What leaked and how to rotate it

Only the kind of each secret is listed here, never a value. Keep the old values in a password manager
(you need them for §1.2), never in the repository.

| # | Kind | Where it leaked | How to rotate | Effect on the live v1.0.9 app |
|---|---|---|---|---|
| 1 | OpenAI API key (A) | Inside the published v1.0.9 APK | platform.openai.com -> the project -> API keys -> revoke the key. Create a new key only for the Firebase secret (§6.2). Set a monthly budget or usage limit on the project. | AI chat in v1.0.9 stops (it calls OpenAI directly with this key). |
| 2 | OpenAI API key (B, a different key) | Git history | Revoke it the same way. | None. |
| 3 | Google OAuth client secret (one value) | The APK and the git history | Google Cloud console -> APIs & Services -> Credentials -> the OAuth client that owns it -> **Add secret**, give the new secret to the old backend if it must keep running, then **disable and delete** the old secret. If nothing uses the client any more, delete the client. v1.3.0 uses **no** client secret. | Google login in v1.0.9 goes through the Render backend, which uses this secret. Login breaks until the backend has the new secret. |
| 4 | Supabase anon key and **service_role** key | Git history | Supabase dashboard -> the project -> Project Settings -> JWT Keys (older dashboards: Settings -> API) -> rotate the JWT secret. This makes new anon and service_role keys. If the project is not needed any more, export what you need (paid users, see §1.3), then pause or delete it. | The Render backend uses Supabase. Put the new keys in its environment, or v1.0.9 stops working. |
| 5 | JWT signing secret of the old backend | Git history | Render dashboard -> the backend service -> Environment -> change the value -> redeploy. | All v1.0.9 sessions end; users sign in again. |
| 6 | Stripe webhook signing secrets (two values) | Git history | Stripe dashboard -> Developers -> Webhooks -> the endpoint -> **Roll secret** (or delete the endpoint if nothing uses it). Update the backend environment. | Payment webhooks of the old backend fail until it has the new secret. |

In the git history, the secrets are in `deno/env.example` (commit `fe86d3f`),
`src/api/aiService.js` (`6c9413b`), and `backend/server.js` / `backend/env.example` (commits
`29c9677`, `a8b0746`, `2f7b325`, `7471bab` and the parent of `3308b9d`).

Also do these:

- Delete old downloaded OAuth files (`client_secret_*.json`) from all computers after the rotation.
- In OpenAI, check the usage page for strange traffic before you revoke the keys (it tells you if a
  key was abused).
- In Stripe, check whether the v1.0.9 Payment Links created **real** subscriptions. Deactivate the
  links. The client decides what happens to paying users (refund, or grant the plan by hand as in
  `functions/README.md` "Granting a plan manually").

The client must accept that v1.0.9 features break during the rotation. Do not wait for v1.3.0 to ship
before you rotate. Just before you start, prepare the v1.0.9 fixture phones for the upgrade test
(`docs/HANDOFF.md` §2 step 2, `docs/TESTING.md` T12): it takes minutes, and afterwards v1.0.9 can no
longer sign in to create that data.

### 1.2 Clean the git history (after the rotation)

1. Make sure the GitHub repository is **private**. Turn on secret scanning and push protection
   (GitHub -> Settings -> Code security).
2. Save the old backend source before you change history (see §1.3).
3. Make a full backup: `git clone --mirror <repo-url> meetingguard-backup.git`.
4. Install `git-filter-repo` (`pip install git-filter-repo`). Write the old secret values into a
   local file outside the repository (one per line, format `value==>REMOVED`), then run
   `git filter-repo --replace-text <that-file>` in a fresh clone that has **every** branch, including
   `stabilization`.
5. Force-push all branches and tags. Ask everyone to clone again. Delete the local secret file.

The `stabilization` branch sits on top of the old history, so rewrite it in the same run. If you push
it before the clean-up, you have to rewrite it again.

### 1.3 Old Render backend: lock it down, then shut it down

The live v1.0.9 app uses an Express + Supabase backend at `meetingguard-backend.onrender.com`. Its
source was deleted from the repository in commit `3308b9d`. Save a copy outside this repository
**before** §1.2:

```bash
git archive -o legacy-backend.zip 3308b9d^ backend
```

Security problems found in that source:

- `/oauth/google-check` gives any caller the Google tokens of a pending sign-in (another user's).
- `save-user` issues a login token (JWT) for any email address.
- `check-user` tells anyone whether an account exists.
- `test-update-plan`, `test-payment-success`, `user-plan/:email` and `/payment-success` read or change
  plans without authentication.

What to do:

1. **Now:** check in the Render dashboard whether the service is running. If it is, deploy a version
   with those routes removed, or suspend the service. Suspending it stops sign-in in v1.0.9. The
   meetings in v1.0.9 are stored on the phones, so they are not lost; v1.3.0 imports them after the
   update.
2. **After v1.3.0 is live and most users have updated:**
   - Delete the Render service.
   - Export what you need from Supabase, then pause or delete the project.
   - Delete the Stripe webhook endpoints and payment links.
3. In the Play "What's new" text for 1.3.0, tell users to sign in again with Google.

---

## 2. Tools

| Tool | Version | Used for |
|---|---|---|
| Node.js + npm | 22 (22.13+) or 24 (24.3+). Use Node 22 for `functions/`, which runs on `nodejs22`. | App, functions |
| Git | any recent | |
| `eas-cli` | 24.8.0 or newer (`eas.json` requires it): `npm install -g eas-cli` | Builds, env vars, updates |
| Firebase CLI | already a dev dependency of `functions/`: run `npx firebase ...` inside `functions/` | Functions, rules, hosting, backups |
| Java 21 (for example Temurin 21) | only for the emulators and `npm run test:rules` | Local backend tests |
| Android platform-tools (`adb`) | any recent | Installing builds, device tests |
| `gcloud` | optional | Only for the Firestore export / import commands in `docs/DEPLOYMENT.md` |

Install the app dependencies (repository root). `npm ci` installs exactly what `package-lock.json`
lists:

```bash
npm ci
```

---

## 3. Firebase project

Open https://console.firebase.google.com. If the client already has the Firebase project that the
old HEAD `3308b9d` used, you can reuse it. Check what is inside first.

### 3.1 Project and billing

1. Create the project (or open the existing one). Write down the **project id**.
2. Switch to the **Blaze** plan (Usage and billing). Cloud Functions v2, Secret Manager and Firestore
   backups need it.
3. Add a budget alert: Google Cloud console -> Billing -> Budgets & alerts.

### 3.2 Authentication

Build -> Authentication -> Get started -> Sign-in method -> **Google** -> Enable. Set the public name
and the support email, then save.

Enabling Google creates the OAuth client "Web client (auto created by Google Service)". You need its
**client ID** in §4.1. You never need its client secret. Email/Password is optional: the app has no
screen for it.

### 3.3 Firestore

Build -> Firestore Database -> Create database:

- If the console asks for an edition, choose **Standard**.
- **Location:** you cannot change it later. Pick one close to the users, for example `nam5` (US) or
  `eur3` (Europe). Deploy the functions in the same area (§6.3).
- Choose **production mode**. The real rules come from `firestore.rules` in §6.4.

### 3.4 Register the apps

Project settings -> General -> Your apps:

1. **Web app** (for example "MeetingGuard app config"). The app uses the Firebase **JS** SDK, so its
   config is the web config. Copy the `firebaseConfig` values into these variables (§5.2):

   | `firebaseConfig` field | Variable |
   |---|---|
   | `apiKey` | `EXPO_PUBLIC_FIREBASE_API_KEY` |
   | `authDomain` | `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN` |
   | `projectId` | `EXPO_PUBLIC_FIREBASE_PROJECT_ID` |
   | `storageBucket` | `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET` |
   | `messagingSenderId` | `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` |
   | `appId` | `EXPO_PUBLIC_FIREBASE_APP_ID` |

2. **Android app**, package `com.meetingguard.ai`. Add the SHA-1 (and SHA-256) fingerprints from §4.2.
   Firebase then creates the Android OAuth clients for you. Do **not** add `google-services.json` to
   the project; the app does not use it.
3. **iOS app**, bundle ID `com.meetingguard.ai`. Firebase creates an iOS OAuth client. Do not add
   `GoogleService-Info.plist`.

---

## 4. Google Cloud: OAuth clients, consent screen, Calendar API

Open https://console.cloud.google.com and select the **same project** as Firebase.

### 4.1 Web client (used as `webClientId`)

APIs & Services -> Credentials -> "Web client (auto created by Google Service)" -> copy the **Client
ID** into `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`.

Firebase accepts Google ID tokens issued for this client. `src/services/auth/authService.ts` passes it
to `GoogleSignin.configure({ webClientId })`. Do not copy the client secret anywhere.

### 4.2 Android clients (one per signing key)

Google Sign-In on Android checks the package name **and** the SHA-1 of the key that signed the
installed app. You need one Android OAuth client per signing key:

| Key | Signs | Where to find the SHA-1 |
|---|---|---|
| (a) **EAS upload key** | Every APK/AAB built by EAS (development, preview, production), unless you created more than one keystore | Run `eas credentials -p android` in the repository root, choose the Android keystore. It prints the MD5, SHA-1 and SHA-256 fingerprints. |
| (b) **Google Play app signing key** | Every app installed from Google Play, on any track (internal, closed, production) | Play Console -> MeetingGuard AI -> **App integrity** (left menu, under "Test and release"; "Release" -> "Setup" in older consoles) -> App signing -> "App signing key certificate" -> SHA-1 |
| (c) Debug key (optional) | Local `npm run android` builds | After `npx expo prebuild`, run `cd android` then `./gradlew signingReport` (needs JDK 17). |
| (d) Local test key (optional) | Test APKs built on your PC with `npm run apk:test`, for emulators (`docs/TESTING.md` B.2) | Run `npm run apk:sha1`. It creates the key once in `%USERPROFILE%\.meetingguard\` and prints the SHA-1 and SHA-256. |

The local test keystore (`npm run apk:sha1`) needs its own Android OAuth client, like every other key.

On the same App integrity page, the "Upload key certificate" SHA-1 must equal (a). If it does not, the
EAS keystore is not the Play upload key and Play will reject uploads. Ask the client. The fix is the
original keystore or an upload key reset in App integrity.

To create a client: Credentials -> Create credentials -> OAuth client ID -> Android -> package name
`com.meetingguard.ai` + SHA-1. Adding the SHA-1 to the Firebase Android app (§3.4) does the same thing.
The code does not use the Android client ID, so `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` is optional.

Troubleshooting:

- **`DEVELOPER_ERROR` at sign-in:** the SHA-1 of the key that signed this build is missing, or
  `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` is wrong. Check which key signed the build (EAS or Play).
- **"The package name and fingerprint are already in use":** another Google Cloud project has an
  Android client with the same package and SHA-1 (maybe the old v1.0.9 project). Delete it there
  first.

### 4.3 iOS client and URL scheme

Credentials -> Create credentials -> OAuth client ID -> iOS -> bundle ID `com.meetingguard.ai`. You
can also use the client Firebase created in §3.4.

- **Client ID** -> `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` (required for iOS builds).
- **iOS URL scheme** (`com.googleusercontent.apps.<...>`) -> `EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME`. This is
  optional: `app.config.js` derives the scheme from the iOS client ID. Without a scheme the Google
  Sign-In plugin is left out, and Google sign-in cannot work on iOS.

### 4.4 OAuth consent screen (Google Auth Platform)

Google Auth Platform (older console: "OAuth consent screen"):

- **Branding:**
  - App name "MeetingGuard AI" and a user support email.
  - App home page, privacy policy URL and terms URL.
  - Authorized domain: a domain the client owns (the brief mentions `meetingguard.ai` /
    `meetingguardai.com`).
  - A logo is optional, and adding one also triggers a review.
- **Audience:** External. Start in **Testing**: only the test users you list (at most 100) can sign
  in, and their grants expire after 7 days. Add every internal tester and the Google account you give
  the Play reviewers (`docs/DEPLOYMENT.md` §9, App access). Move to **In production** after
  verification. **Testing is enough for development and internal testing only:** a production
  rollout needs In production and the verification (`docs/DEPLOYMENT.md` §4 item 4).
- **Data access (scopes):**
  - `openid`, `.../auth/userinfo.email` and `.../auth/userinfo.profile` (not sensitive).
  - `https://www.googleapis.com/auth/calendar.events` (**sensitive**). The app asks for it only when the
    user connects Google Calendar (incremental `addScopes`).

**Verification for `calendar.events`.** Without it, users see the "Google hasn't verified this app"
screen, and there is a 100-user limit. To verify you need:

- The domain verified in Google Search Console.
- A public home page and privacy policy on that domain. The policy must explain how the app uses
  Google user data, and must follow Google's Limited Use rules.
- An unlisted YouTube video that shows the sign-in, the consent screen with the calendar scope, and
  how the app uses the calendar data.
- A short written reason for the scope.

Review takes days to weeks, so start early. The privacy policy exists today only inside the app
(`src/i18n/locales/{en,es}/legal.json`). It needs a public web page first (see `docs/HANDOFF.md`).

### 4.5 Google Calendar API

APIs & Services -> Library -> "Google Calendar API" -> **Enable**. The gcloud command does the same:

```bash
gcloud services enable calendar-json.googleapis.com --project <project-id>
```

---

## 5. EAS (Expo)

### 5.1 Log in and check the project link

```bash
eas login
eas whoami
eas project:info
```

`eas project:info` must show the project id `139b18d2-655f-458f-854a-27e423530626` (slug
`meeting-guard-ai`). The same id is in `app.config.js` (`extra.eas.projectId`, and the updates URL).
The config has no `owner` field. If you get a permission error, the Expo account or organization that
owns the project must add you.

### 5.2 Environment variables

EAS keeps the values per environment (`development`, `preview`, `production`). Each build profile in
`eas.json` reads its own environment, and so does `npm run update:<channel>`. `.env` files are never
uploaded (`.easignore`).

| Variable | development | preview | production | Notes |
|---|---|---|---|---|
| `EXPO_PUBLIC_FIREBASE_API_KEY` ... `EXPO_PUBLIC_FIREBASE_APP_ID` (6 values) | yes | yes | yes | §3.4. Required. |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | yes | yes | yes | §4.1. Required. |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | yes | yes | yes | §4.3. Required for iOS. |
| `EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME` | optional | optional | optional | §4.3. Read by `app.config.js` at build time. |
| `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` | optional | optional | optional | Not used by the code. |
| `EXPO_PUBLIC_APP_ENV` | `development` | `preview` | `production` | Sentry environment name. |
| `EXPO_PUBLIC_FUNCTIONS_REGION` | yes | yes | yes | Must equal `FUNCTIONS_REGION` of the functions (§6.3). Default `us-central1`. |
| `EXPO_PUBLIC_SENTRY_DSN` | usually empty | yes | yes | §7. Empty = Sentry off. |
| `EXPO_PUBLIC_USE_EMULATORS`, `EXPO_PUBLIC_EMULATOR_HOST` | only for emulator work | never | never | §6.6. |
| `SENTRY_ORG`, `SENTRY_PROJECT` | - | optional | yes | Plaintext. For source-map upload. |
| `SENTRY_AUTH_TOKEN` | - | optional | yes | **secret** visibility. |

`env.example` lists every variable and where to find it. Set each one with `eas env:set`, one line per
variable. `--environment` can be repeated:

```bash
eas env:set --name EXPO_PUBLIC_FIREBASE_API_KEY --value "<value>" --environment development --environment preview --environment production --visibility plaintext
eas env:set --name EXPO_PUBLIC_APP_ENV --value production --environment production --visibility plaintext
eas env:set --name SENTRY_AUTH_TOKEN --value "<token>" --environment production --visibility secret
```

Rules:

- `EXPO_PUBLIC_*` values end up in the app bundle. Use `plaintext` (or `sensitive`), never `secret`,
  and never put a secret in them.
- `env:create` is deprecated; use `env:set`, which creates or updates.

Check the values, then pull the development values for local work:

```bash
eas env:list --environment production
eas env:pull --environment development      # writes .env.local (git-ignored)
```

### 5.3 Android versionCode: set it to 20 once

Google Play already has versionCode 20 (v1.0.9). EAS stores the version code on its server
(`"appVersionSource": "remote"`), and the `production` profile increments it before each build
(`autoIncrement`). Set the stored value to 20 **before the first production build**, so that build
gets 21:

```bash
eas build:version:get -p android      # shows the value EAS has now
eas build:version:set -p android      # asks for the new value: enter 20
eas build:version:get -p android      # must show 20
```

Do not put `android.versionCode` in `app.config.js`. `version` (1.3.0) is the user-facing version and
also the OTA runtime version (`docs/DEPLOYMENT.md`).

### 5.4 Signing credentials

Run `eas credentials -p android` and check that a keystore exists for `com.meetingguard.ai`. It is the
Play upload key that signed v15 to v20.

- **Never create a new keystore when one exists.**
- If it is missing (for example, the project moved to another Expo account), get the original from the
  client, or request an upload key reset in Play Console -> App integrity.

For `eas submit`, create a Google Cloud service account with access to Play Console. Save its JSON key
as `google-play-service-account.json` in the repository root: `eas.json` points there, and git ignores
the file. Or upload it with `eas credentials -p android` (Google Service Account). The Expo guide
"Creating a Google Service Account for EAS Submit" has the clicks.

### 5.5 First development build

```bash
eas build --profile development --platform android
```

When the build finishes, open its page on the phone and install the APK. Then run `npm start` (see
`README.md` "Quick start").

---

## 6. Cloud Functions, rules and hosting

More details: `functions/README.md`.

### 6.1 Firebase CLI and project

Copy the example file, then put your project id into `.firebaserc`:

```bash
cp .firebaserc.example .firebaserc
```

`.firebaserc` is git-ignored. Then install and log in:

```bash
cd functions
npm ci
npx firebase login
npx firebase projects:list
```

Run every command below inside `functions/`. The Firebase CLI finds `firebase.json` in the parent
folder.

### 6.2 OpenAI secret

Create a new OpenAI key (§1.1) in an OpenAI project with a monthly budget. Check that the key can use
the model you choose (§6.3). Then run:

```bash
npx firebase functions:secrets:set OPENAI_API_KEY
```

Paste the key at the prompt. It goes to Cloud Secret Manager, never to the repository or the app.

To rotate the key later:

1. Run the same command again, then `npm run deploy`.
2. Revoke the old key in OpenAI.
3. `npx firebase functions:secrets:prune` deletes unused secret versions.

### 6.3 Parameters

All parameters have defaults (`functions/src/config.ts`). Create `functions/.env.<project-id>` anyway.
Without it the CLI stops at every interactive deploy to ask for each value, and a non-interactive
deploy (CI) fails. The file is git-ignored. **No secrets in this file.**

```dotenv
FUNCTIONS_REGION=us-central1
OPENAI_MODEL=gpt-5.4-mini
OPENAI_REASONING_EFFORT=low
ASSISTANT_GLOBAL_DAILY_LIMIT=5000
```

| Param | Meaning |
|---|---|
| `FUNCTIONS_REGION` | Region of both callables. It **must equal** `EXPO_PUBLIC_FUNCTIONS_REGION` in every EAS environment, and should be near the Firestore location. |
| `OPENAI_MODEL` | The model name. The client must confirm the model (`docs/HANDOFF.md`). A change needs only a redeploy. |
| `OPENAI_REASONING_EFFORT` | `none`, `minimal`, `low`, `medium`, `high`, or `omit` for models that reject the parameter. |
| `ASSISTANT_GLOBAL_DAILY_LIMIT` | Project-wide limit on assistant requests per UTC day (spend guard). `0` turns it off. |

### 6.4 Deploy the functions, rules and indexes

```bash
npm run deploy          # functions; lint, contract check and build run first (predeploy)
npm run deploy:rules    # firestore.rules + firestore.indexes.json
```

- The first deploy turns on several Google Cloud APIs (Cloud Functions, Cloud Build, Artifact
  Registry, Cloud Run, Eventarc, Secret Manager). This can take a few minutes. If it fails the first
  time, wait a minute and run it again.
- Check: Firebase console -> Functions lists `assistant`, `deleteAccount` and `dailyMaintenance` in
  your region. `dailyMaintenance` is scheduled (the first deploy enables Cloud Scheduler); the next
  day its log shows `dailyMaintenance.completed` with the counts.

### 6.5 Account deletion page (Firebase Hosting)

1. Replace the four `REPLACE_WITH_SUPPORT_EMAIL@example.com` placeholders in
   `public/delete-account.html` with the real support email.
2. Deploy:

   ```bash
   npx firebase deploy --only hosting
   ```

3. The page is at `https://<project-id>.web.app/delete-account`. Use this URL in Play Console
   (`docs/DEPLOYMENT.md`).

### 6.6 Emulators (optional, for backend work)

You need Java 21. Start the emulators:

```bash
npm run serve
```

This starts the Auth, Firestore and Functions emulators with the project id `demo-meetingguard`. The
emulator UI is at http://localhost:4000.

- **Assistant:** it needs a key in `functions/.secret.local` (git-ignored) as `OPENAI_API_KEY=...`.
- **App side** (a development build, in `.env.local`):
  - `EXPO_PUBLIC_USE_EMULATORS=1`.
  - `EXPO_PUBLIC_EMULATOR_HOST=10.0.2.2` for the Android emulator, or your computer's LAN IP for a
    phone.
  - `EXPO_PUBLIC_FIREBASE_PROJECT_ID=demo-meetingguard`, because the functions emulator serves the
    callables under that project id.
- **Physical phone:** in your local copy of `firebase.json`, add `"host": "0.0.0.0"` to the `auth`,
  `firestore` and `functions` emulator entries. Do not commit that change.

---

## 7. Sentry (optional)

1. Create a Sentry project of type React Native. Copy its **DSN** into `EXPO_PUBLIC_SENTRY_DSN` for
   `preview` and `production` (§5.2).
2. Source maps for store builds: set `SENTRY_ORG` and `SENTRY_PROJECT` (plaintext), and
   `SENTRY_AUTH_TOKEN` (**secret**, an organization auth token). Without all three, `app.config.js`
   turns the upload off and the build still succeeds.
3. Source maps for OTA updates: after `npm run update:<channel>`, run
   `npx sentry-expo-upload-sourcemaps dist` with the same three variables set in your shell.

Development builds never send events (`enabled: !__DEV__` in `src/services/sentry.ts`).

---

## 8. iOS (when the client decides)

iOS has never been built. You need these first:

- An Apple Developer account.
- An App ID `com.meetingguard.ai` with the **Time Sensitive Notifications** capability
  (`app.config.js` sets that entitlement).
- The iOS OAuth client (§4.3).
- A 1024x1024 app icon (`assets/icon.png` is 512x512).
- **iPad:** the first release is iPhone only (`ios.supportsTablet: false` in `app.config.js`; iPads
  run it in iPhone compatibility mode). The layouts are portrait-only and nothing was tested on an
  iPad. To support iPad, set `supportsTablet: true` (Expo then declares every iPad orientation, as
  the App Store requires for multitasking), test the screens in iPad landscape and split view, and
  add iPad screenshots to the App Store listing.
- **Sign in with Apple** or another login that meets App Store guideline 4.8. The app offers Google
  sign-in, so Apple requires this.
- The real Apple values in `eas.json` -> `submit.production.ios` (`appleId`, `ascAppId`,
  `appleTeamId`). They are placeholders now.

Internal test builds only install on registered iPhones (`eas device:create`):

```bash
eas build --profile preview --platform ios
```

TestFlight: `eas build --profile production --platform ios`, then
`eas submit --profile production --platform ios`.

---

## 9. Final check

You are done when all of these are true:

- [ ] The old OpenAI keys, Google client secret, Supabase keys, JWT secret and Stripe webhook secrets
      are rotated or revoked (§1.1). The Render backend is locked down (§1.3).
- [ ] The Firebase project is on Blaze, with Google sign-in on and Firestore in production mode.
- [ ] Android OAuth clients exist for the EAS upload key and the Play app signing key. The web client
      ID is in EAS.
- [ ] The consent screen is set up with `calendar.events`. The Google Calendar API is enabled.
      Verification is submitted. While it is pending you may keep the Testing status, with every
      tester and the Play reviewer account as test users, but only for development and internal
      testing: the production rollout waits for `docs/DEPLOYMENT.md` §4 item 4.
- [ ] `eas env:list` shows every required variable in all three environments.
      `eas build:version:get -p android` shows 20 (or higher after a production build).
- [ ] `OPENAI_API_KEY` is set. `functions/.env.<project-id>` exists. The functions, rules and indexes
      are deployed. `FUNCTIONS_REGION` equals `EXPO_PUBLIC_FUNCTIONS_REGION`.
- [ ] A development build signs in with Google and creates a meeting. The document appears under
      `users/{uid}/meetings` in the Firestore console.
- [ ] The assistant answers (this uses one of the 5 free requests of the day).

---

## 10. Microsoft/Outlook (Azure app registration)

Optional: Outlook calendar sync (docs/ARCHITECTURE.md §17). Without `EXPO_PUBLIC_MSAL_CLIENT_ID`
the whole Outlook feature is hidden - the app builds and runs fine without this section. A free
personal Microsoft account is enough to create the registration; no Azure subscription and no
client secret are needed (the app is a public client using PKCE).

### 10.1 Create the app registration

1. Sign in at <https://portal.azure.com> (or <https://entra.microsoft.com>) and open
   **Microsoft Entra ID -> App registrations -> New registration**.
2. **Name**: `MeetingGuard AI` (users see it on the consent screen).
3. **Supported account types**: "Accounts in any organizational directory and personal Microsoft
   accounts" (this matches the default tenant `common`; pick a narrower audience only if you also
   set `EXPO_PUBLIC_MSAL_TENANT`).
4. **Redirect URI**: choose the platform **Mobile and desktop applications** (a "Public
   client/native" redirect; NOT Web) and enter exactly:

   ```text
   meetingguardai://auth/microsoft
   ```

   This must match `MS_AUTH_REDIRECT_PATH` in `src/core/identifiers.ts`. Do not add a secret:
   the mobile app cannot keep one, and the PKCE flow does not use one.
5. Register, then copy the **Application (client) ID** (a GUID) from the Overview page.

### 10.2 Permissions

Open **API permissions**. `User.Read` is present by default; add **Microsoft Graph -> Delegated
permissions -> `Calendars.ReadWrite`**, plus `offline_access`, `openid` and `profile` if they are
not already listed. These are all delegated permissions that the user consents to at sign-in;
**Grant admin consent** is NOT required for personal accounts or the `common` audience.

Under **Authentication**, confirm the redirect URI is listed under "Mobile and desktop
applications" and leave "Allow public client flows" as is (the authorization-code + PKCE flow does
not need the toggle).

### 10.3 App environment

Add to `.env` (and to the EAS environments for cloud builds; §5):

```bash
# Application (client) ID from 10.1
EXPO_PUBLIC_MSAL_CLIENT_ID=00000000-0000-0000-0000-000000000000
# Optional; 'common' (any Microsoft account) is the default.
# 'organizations' | 'consumers' | a tenant GUID or verified domain narrow the audience.
EXPO_PUBLIC_MSAL_TENANT=
```

Both values are public identifiers (like the Google client IDs): they may appear in the bundle.

### 10.4 How the app uses it

- Sign-in: expo-auth-session PKCE against
  `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize`, scopes `openid profile
  offline_access User.Read Calendars.ReadWrite`. The Microsoft account is independent of the
  app's Google/Firebase sign-in.
- Only the refresh token is stored, in expo-secure-store (`mg.ms.refresh.{uid}`); it is deleted on
  disconnect and at sign-out. Access tokens stay in memory.
- Sync: `/me/calendarView/delta` pull + create/patch/delete push on the account's default
  calendar. "Stop sync and review access" opens <https://account.live.com/consent/Manage>
  (work/school accounts use <https://myapps.microsoft.com>), because Graph offers no programmatic
  consent revoke.

### 10.5 Check

- [ ] The Calendar sync screen shows the "Outlook Calendar" card (it is hidden when
      `EXPO_PUBLIC_MSAL_CLIENT_ID` is unset).
- [ ] "Connect Outlook" opens the Microsoft sign-in, returns to the app, and the card shows the
      account and "Connected".
- [ ] "Sync now" reports an Outlook line; an event created in Outlook on the web appears in
      MeetingGuard within one sync, and a meeting created in MeetingGuard appears in Outlook.

---

## 11. RevenueCat + Google Play subscriptions (in-app purchases)

Optional: paid plans (docs/ARCHITECTURE.md §20). Without `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`
the Plans screen keeps its catalog-only "Subscriptions coming soon" view - the app builds and
runs fine without this section. RevenueCat's free tier covers this app until real revenue.

Two secrets are involved and they must never swap places:

- the **public SDK key** (`goog_...`) goes in the app env (`EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`);
- the **webhook Authorization value** (a random string you invent) goes ONLY in the Functions
  secret `REVENUECAT_WEBHOOK_AUTH`. The RevenueCat **secret** API key (`sk_...`) is used nowhere.

### 11.1 Play Console: the four subscriptions

Play Console -> your app -> Monetize -> Products -> Subscriptions. The app must already have at
least one build uploaded to a Play track (internal testing is enough) before products can be
created. Create these EXACT product ids (the app and functions match on them):

| Product id | Base plan (id suggestion) | Price | Offer |
|---|---|---|---|
| `pro_monthly` | monthly, auto-renewing (`p1m`) | $7.99 / month | 3-day free trial |
| `pro_yearly` | yearly, auto-renewing (`p1y`) | $71.91 / year | 3-day free trial |
| `premium_monthly` | monthly, auto-renewing (`p1m`) | $14.99 / month | 3-day free trial |
| `premium_yearly` | yearly, auto-renewing (`p1y`) | $134.91 / year | 3-day free trial |

For each product: add one base plan, then an **offer** on that base plan with a single "free
trial" phase of 3 days (eligibility: new customer acquisition). Activate products, base plans
and offers. Prices are the catalog values from `src/services/billing.ts`; Google converts them
to local currencies. The trial copy in the app ("3-day free trial") only appears when the store
actually reports the trial, so a missing offer is visible immediately.

### 11.2 RevenueCat project

1. <https://app.revenuecat.com> -> create a project (e.g. "MeetingGuard") -> add an **Android
   (Play Store)** app with package `com.meetingguard.ai`.
2. Connect Play: RevenueCat needs a Google Cloud **service account** with the Play Android
   Publisher + Pub/Sub roles (follow RevenueCat's "Google Play service credentials" wizard,
   including the real-time developer notifications Pub/Sub topic). Wait for the green check -
   credentials can take ~half an hour to propagate.
3. **Entitlements**: create exactly `pro` and `premium`. Attach `pro_monthly` + `pro_yearly` to
   `pro`, and `premium_monthly` + `premium_yearly` to `premium` (the products appear after the
   Play import in "Products").
4. **Offering**: create/keep the offering marked **current** (id `default` is fine) with four
   packages pointing at the four products. Package identifiers do not matter to the app (it
   matches by product id), the standard `$rc_monthly`/`$rc_annual` plus two customs work.

### 11.3 Webhook (writes entitlements/{uid})

1. Invent a long random string, e.g. `openssl rand -base64 32`, and set it as the secret:
   `firebase functions:secrets:set REVENUECAT_WEBHOOK_AUTH` (paste the value when prompted).
2. Deploy functions (`firebase deploy --only functions`). Copy the `revenuecatWebhook` URL from
   the deploy output (or Firebase console -> Functions; a v2 URL looks like
   `https://revenuecatwebhook-....a.run.app`).
3. RevenueCat -> Project -> Integrations -> **Webhooks**: URL = that function URL,
   "Authorization header value" = the SAME random string. Leave "send all events" on.
4. Press "Send test event": the function logs `revenuecat.ignored` with reason `test_event`
   and RevenueCat shows 200. A 401 means the header value and the secret differ.
5. **Sandbox toggle.** License-tester and developer test purchases arrive as `SANDBOX` events,
   which the webhook IGNORES by default (a test purchase must never grant - or expire - a real
   production entitlement). For the §11.5 / T17 verification phase deploy with the param set:
   `firebase deploy --only functions` and answer `true` when prompted for
   `REVENUECAT_ALLOW_SANDBOX` (or put `REVENUECAT_ALLOW_SANDBOX=true` in `functions/.env.<project>`).
   **After the tests, set it back to `false` and redeploy**; optionally also switch the
   RevenueCat webhook to production-only events in the dashboard.

The webhook writes `entitlements/{uid}` (uid = `app_user_id` = Firebase uid) and an idempotency
marker in `revenuecatEvents/{event.id}`. Firestore rules stay untouched: clients can only READ
their own entitlement; the Admin SDK bypasses the rules.

### 11.4 App build

1. `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` = RevenueCat -> Project -> API keys -> Public SDK key
   for the Play app (`goog_...`), in `.env` and in the EAS environments.
2. The SDK (`react-native-purchases`) is a NATIVE module: purchases need a new dev/store build
   with a bumped `version` (docs/ARCHITECTURE.md §15 - never OTA). Expo Go stays catalog-only.

### 11.5 Check

- [ ] Plans screen (configured build): prices come from Google Play (local currency), paid cards
      show "Get Pro"/"Get Premium" and the 3-day free trial line; no "coming soon" banner.
- [ ] With a **license tester** account (Play Console -> Settings -> License testing) and the
      webhook deployed with `REVENUECAT_ALLOW_SANDBOX=true` (11.3 step 5): buying
      Pro completes, the screen shows "Activating your plan...", and within seconds
      `entitlements/{uid}` appears in Firestore (`source: "revenuecat"`) and the app shows
      "Current plan" on Pro. The assistant quota rises to the Pro limit.
- [ ] "Restore purchases" on a reinstalled build finds the subscription; on a fresh account it
      says no purchases were found.
- [ ] Cancelling in Play -> the webhook logs a CANCELLATION event and the entitlement stays
      `active` until the expiry date, then EXPIRATION flips it to `expired` (plan back to Free).
- [ ] When the sandbox checks are done: `REVENUECAT_ALLOW_SANDBOX` back to `false` + redeploy
      (11.3 step 5).

## 12. Zoom auto links (Server-to-Server OAuth app)

Optional. Until this section is done the app simply keeps the paste-a-link behavior for Zoom
(`zoomStatus` answers `configured: false`). Design: docs/ARCHITECTURE.md §24.

### 12.1 Zoom marketplace app

1. Sign in at https://marketplace.zoom.us with the Zoom account that should HOST the created
   meetings (a paid plan lifts the 40-minute limit; the integration works on free too).
2. Develop -> Build App -> **Server-to-Server OAuth** -> name it (for example "MeetingGuard").
3. App credentials page: note the **Account ID**, **Client ID** and **Client Secret** (these are
   the three secrets below; never put them in the repository or the app).
4. Scopes -> Add scopes: `meeting:write:meeting` (create/update/delete the account's own
   meetings). Older marketplace UIs call it `meeting:write` / `meeting:write:admin` - pick the
   write scope for meetings of the app's own account.
5. Activation page: **Activate** the app (an S2S app must be activated before the token
   endpoint accepts it).

### 12.2 Secrets and param - ORDER MATTERS

Set the three secrets FIRST, then the param, then deploy. The three write callables
(`zoomCreateMeeting`, `zoomSyncMeeting`, `zoomDeleteMeeting`) are only part of a deploy while
`ZOOM_ENABLED=true`, and a deploy that includes them fails when a secret is missing.

```bash
cd functions
npx firebase functions:secrets:set ZOOM_ACCOUNT_ID    # paste the Account ID
npx firebase functions:secrets:set ZOOM_CLIENT_ID     # paste the Client ID
npx firebase functions:secrets:set ZOOM_CLIENT_SECRET # paste the Client Secret
```

Then put the switch into `functions/.env.<projectId>` (for example
`functions/.env.meetingguard-ai-app`):

```
ZOOM_ENABLED=true
# optional abuse guard, default 30 created meetings per user per UTC day:
# ZOOM_USER_DAILY_LIMIT=30
```

### 12.3 Deploy

```bash
npx firebase deploy --only firestore:rules,functions
```

- The rules deploy ships the `external.zoomMeetingId` key (without it the app's meeting edits
  would be rejected once a link was created) and the explicit deny block for the server-only
  `zoomMeetings/{id}` ownership registry (docs/ARCHITECTURE.md §24).
- The functions deploy now includes `zoomStatus` AND the three write callables; the CLI grants
  their service account access to the three secrets.
- To switch the feature OFF again: set `ZOOM_ENABLED=false` (or remove the line), deploy, and
  ACCEPT when the CLI offers to delete the three zoom write functions. `zoomStatus` stays and
  answers `configured: false`.

### 12.4 Check

- [ ] App: create a meeting, Video call = Zoom, leave the link empty -> the form says "A Zoom
      link will be created when you save"; after Save the details card shows the pending note
      and then the real `zoom.us` join link (plus passcode when the account adds one).
- [ ] Editing the meeting's time updates the Zoom meeting; deleting the meeting deletes it in
      Zoom (check the Zoom web portal).
- [ ] Functions logs show uid + Zoom meeting id only - never meeting titles.

### 12.5 Troubleshooting

- **Create fails right away with "not configured"** (app shows the create-failed card; logs show
  `zoom.upstream_failed` with status 400/401): the token mint was rejected - re-check the three
  secrets (12.2) and that the marketplace app is ACTIVATED (12.1 step 5). After fixing a secret,
  redeploy the functions so they pick the new version up.
- **Create fails with "not configured" and status 404**: the account rejected the `me` host
  alias for Server-to-Server tokens (some accounts require an explicit user). Fix: set
  `ZOOM_HOST_USER` in `functions/src/zoom/api.ts` to the host's Zoom email address and
  redeploy.
- **"Daily Zoom limit reached"**: the per-user abuse caps (`ZOOM_USER_DAILY_LIMIT`, default 30
  creates per UTC day; sync/delete share a 10x pool). Raise the param in
  `functions/.env.<projectId>` if real users hit it.

## 13. Email/password sign-in (Firebase provider)

The app ships the email sign-in UI either way; this console switch makes it work. Without it,
submitting the form shows "Email sign-in is not enabled" (`auth/operation-not-allowed` ->
`auth:errors.providerDisabled`). Design: docs/ARCHITECTURE.md §25.

1. Firebase console -> Authentication -> Sign-in method -> **Email/Password** -> Enable (leave
   "Email link (passwordless sign-in)" off) -> Save.
2. Authentication -> Settings -> **Authorized domains**: the verification and password-reset
   links open on the project's default `<projectId>.firebaseapp.com` handler, which is
   authorized out of the box - only check this list if you customized the action URL or email
   templates.
3. Optional: Authentication -> Templates - adjust the verification and password-reset email
   texts (EN; Firebase localizes the handler page itself).
4. Check:
   - [ ] Landing -> "Continue with email" -> create an account -> the verification email
         arrives; the app signs in and works.
   - [ ] The AI assistant shows the "Verify your email" gate until the link is clicked and
         "I verified" is pressed; afterwards the assistant answers.
   - [ ] "Forgot your password?" sends the reset email and the new password signs in.
   - [ ] A wrong password and an unknown email show the SAME generic message (no account
         enumeration).
