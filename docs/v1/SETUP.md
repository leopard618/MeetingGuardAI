# Setup from zero

This guide takes you from an empty machine to a working development build, deployed Cloud Functions
and cloud builds. Do the steps in order. Each step says where the value goes.

- Accounts you need (the client owns most of them, so ask for access first): Google Cloud / Firebase,
  Expo (EAS), Google Play Console, OpenAI, GitHub. For the clean-up in §1 you also need Render,
  Supabase and Stripe. For iOS you need an Apple Developer account.
- The release process is in `docs/v1/DEPLOYMENT.md`, the tests in `docs/v1/TESTING.md`, and the open
  decisions in `docs/v1/HANDOFF.md`.

Contents:

1. Secrets rotation (do this first)
2. Tools
3. Firebase project
4. Google Cloud: OAuth clients, consent screen, Calendar API
5. EAS (Expo)
6. Cloud Functions, rules and hosting
7. Sentry (optional)
8. iOS: the complete runway to the App Store
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
(`docs/v1/HANDOFF.md` §2 step 2, `docs/v1/TESTING.md` T12): it takes minutes, and afterwards v1.0.9 can no
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
| `gcloud` | optional | Only for the Firestore export / import commands in `docs/v1/DEPLOYMENT.md` |

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
| (d) Local test key (optional) | Test APKs built on your PC with `npm run apk:test`, for emulators (`docs/v1/TESTING.md` B.2) | Run `npm run apk:sha1`. It creates the key once in `%USERPROFILE%\.meetingguard\` and prints the SHA-1 and SHA-256. |

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

**Status (2026-10-19): done.** Branding and `calendar.events` data access are verified and the
publishing status is In production. The list below is kept for the next scope that needs it.

- **Branding:**
  - App name "MeetingGuard AI" and a user support email.
  - App home page, privacy policy URL and terms URL.
  - Authorized domain: a domain the client owns (the brief mentions `meetingguard.ai` /
    `meetingguardai.com`).
  - A logo is optional, and adding one also triggers a review.
- **Audience:** External. Start in **Testing**: only the test users you list (at most 100) can sign
  in, and their grants expire after 7 days. Add every internal tester and the Google account you give
  the Play reviewers (`docs/v1/DEPLOYMENT.md` §9, App access). Move to **In production** after
  verification. **Testing is enough for development and internal testing only:** a production
  rollout needs In production and the verification (`docs/v1/DEPLOYMENT.md` §4 item 4).
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
(`src/i18n/locales/{en,es}/legal.json`). It needs a public web page first (see `docs/v1/HANDOFF.md`).

### 4.5 Google Calendar API

APIs & Services -> Library -> "Google Calendar API" -> **Enable**. The gcloud command does the same:

```bash
gcloud services enable calendar-json.googleapis.com --project <project-id>
```

### 4.6 Google Tasks API and scope (V2 Stage 2, M8)

Google Tasks two-way sync (docs/v1/ARCHITECTURE.md §30) uses the Google account the user signed in
with and one more sensitive scope, requested incrementally when the user turns the sync on.

1. **Enable the API**: APIs & Services -> Library -> "Google Tasks API" -> **Enable**
   (<https://console.cloud.google.com/apis/library/tasks.googleapis.com>), or:

   ```bash
   gcloud services enable tasks.googleapis.com --project <project-id>
   ```

2. **Add the scope to the consent screen**: Google Auth Platform -> Data access
   (<https://console.cloud.google.com/auth/scopes>) -> Add or remove scopes -> tick
   `https://www.googleapis.com/auth/tasks` ("Create, edit, organize, and delete all your tasks") ->
   Update -> Save. It is a **sensitive** scope: the app works right away for the test users listed
   under Audience (and for everyone while the app is in Testing with at most 100 users), and shows
   Google's "unverified app" interstitial to other users until the scope is verified.

3. **Verification** (same procedure as `calendar.events` in §4.4): submit the new scope for
   review with a short justification ("the user chooses to sync the tasks they create in the app
   with a Google Tasks list of their own account; the app reads and writes only that list") and a
   screencast showing the Google Tasks card in Settings -> Calendar sync, the consent screen with
   the Tasks scope, a task created in the app appearing in Google Tasks and the other way round.
   Google answers in days to weeks.

4. **Feature switch**: the Google Tasks card is visible unless the build sets

   ```bash
   EXPO_PUBLIC_GOOGLE_TASKS_SYNC=off
   ```

   Keep it unset (on) for development and test APKs; set it to `off` in the EAS production
   environment (§5.2) until Google approves the scope, then remove it and ship a new build. No
   Firebase or functions change is needed for the switch.

5. **Firestore rules**: the task documents and preferences gained Google Tasks fields
   (`external.gtasksListId/gtasksTaskId/gtasksUpdatedAt`, `preferences.gtasksListId/gtasksListName`).
   Deploy the rules with the build (`npm run deploy:rules` in `functions/`, §6.4); older rules
   reject the first task write with a Google Tasks link as `permission_denied`.

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

Google Play had versionCode 20 (v1.0.9) when this was written; production is now versionCode 24
(v1.4.0, 2026-10-06) and EAS holds the current value. EAS stores the version code on its server
(`"appVersionSource": "remote"`), and the `production` profile increments it before each build
(`autoIncrement`). Set the stored value to 20 **before the first production build**, so that build
gets 21:

```bash
eas build:version:get -p android      # shows the value EAS has now
eas build:version:set -p android      # asks for the new value: enter 20
eas build:version:get -p android      # must show 20
```

Do not put `android.versionCode` in `app.config.js`. `version` (1.3.0) is the user-facing version and
also the OTA runtime version (`docs/v1/DEPLOYMENT.md`).

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
# Sign in with Microsoft (§10.6); empty = disabled
MICROSOFT_CLIENT_ID=
MICROSOFT_TENANT=common
```

| Param | Meaning |
|---|---|
| `FUNCTIONS_REGION` | Region of both callables. It **must equal** `EXPO_PUBLIC_FUNCTIONS_REGION` in every EAS environment, and should be near the Firestore location. |
| `OPENAI_MODEL` | The model name. The client must confirm the model (`docs/v1/HANDOFF.md`). A change needs only a redeploy. |
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

1. The support address in `public/delete-account.html` is `support@meetingguard.ai`
   (filled; change it there if the support email ever changes).
2. Deploy:

   ```bash
   npx firebase deploy --only hosting
   ```

3. The page is at `https://<project-id>.web.app/delete-account`. Use this URL in Play Console
   (`docs/v1/DEPLOYMENT.md`).

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

## 8. iOS: the complete runway to the App Store

**Status (2026-10-19): this runway has been completed.** iOS 1.4.0 build 9 was built with EAS and
submitted to App Store Connect on 2026-10-07 (resubmitted 2026-10-08) and is Waiting for Review.
Keep the steps below for the next build: 1.5.0 adds a native module, so it is a new EAS build and a
new submission, and App Store Connect allows one version in review at a time, so it goes in once
1.4.0 clears. The original text follows.

iOS had never been built when this was written. Work top to bottom; every step says where its values come from.
App code prerequisites (version 1.4.0) are already in the repo: `ios.usesAppleSignIn`, the
Time Sensitive Notifications entitlement, EN+ES `supportedLocales`, the 1024x1024
`assets/icon.png` and the `ios-simulator` build profile. Architecture: docs/v1/ARCHITECTURE.md §26.

### 8.1 Apple Developer account and App Store Connect app

1. Enroll at developer.apple.com (the paid Apple Developer Program; done). Note your **Team ID**:
   developer.apple.com -> Membership details. It goes into `eas.json` -> `submit.production.ios.appleTeamId`.
2. App Store Connect (appstoreconnect.apple.com) -> My Apps -> "+" -> New App:
   - Platform iOS, name "MeetingGuard AI", primary language, bundle ID `com.meetingguard.ai`
     (create the identifier first if the picker does not offer it: developer.apple.com ->
     Identifiers -> "+" -> App ID, exactly `com.meetingguard.ai`), SKU e.g. `meetingguard-ai`.
   - The new app's numeric **Apple ID** (App Store Connect -> the app -> App Information ->
     General Information) goes into `eas.json` -> `submit.production.ios.ascAppId`.
3. `submit.production.ios.appleId` is simply the email you sign in to App Store Connect with.
   The three `submit.ios` values stay placeholders in git until you fill them locally.

### 8.2 Install the Apple sign-in module (one root install)

```bash
npx expo install expo-apple-authentication
```

That adds the SDK-57-matched version to package.json. The `app.config.js` plugin entry is
conditional on the package resolving, so it activates by itself; nothing else to edit. Check:
`npx expo config --type introspect` must now show `com.apple.developer.applesignin` under
`ios.entitlements` and no "Install expo-apple-authentication" warning (the entitlement is only
emitted once the package is installed; iOS prebuild itself is skipped on Windows, introspect is
the Windows-side check).

### 8.3 Capabilities and signing (EAS does this)

```bash
eas credentials -p ios      # or just: eas build -p ios --profile preview
```

Sign in with your Apple account when asked. EAS creates the distribution certificate and
provisioning profile and syncs the App ID capabilities from the generated entitlements:
**Sign in with Apple** (`ios.usesAppleSignIn`) and **Time Sensitive Notifications**
(`ios.entitlements`). Nothing is clicked by hand in the developer portal.
Internal (non-TestFlight) builds only install on registered iPhones: `eas device:create`.

### 8.4 Firebase console: enable the Apple provider

Firebase console -> Authentication -> Sign-in method -> Add new provider -> **Apple** -> enable.

- For the NATIVE iOS sign-in flow that is all the app needs.
- For **token revocation on account deletion** (App Review 5.1.1(v); the app POSTs the fresh
  Apple authorization code to the Identity Toolkit `accounts:revokeToken` endpoint with
  `tokenType: AUTHORIZATION_CODE`, like the native SDKs do) Firebase must be able to talk to
  Apple: create a **Sign in with Apple key** at developer.apple.com -> Keys -> "+" (enable
  "Sign in with Apple", download the `.p8` once) and fill the Apple provider's **Team ID, Key
  ID and private key** fields in the Firebase console. The **Services ID** field is only needed
  if web/Android Apple sign-in is ever added. Revocation cannot be verified from Windows or a
  cloud simulator: docs/v1/TESTING.md T20 row 7 (the Apple ID settings check) is the blocking
  proof before TestFlight.
- The iOS Google OAuth client (§4.3) is separate and still required for Google sign-in on iOS
  (`EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` -> the URL scheme, §5.2).

### 8.5 Builds without owning a Mac or an iPhone

Everything builds on EAS servers; a Mac is never needed.

- **Simulator in the browser (Appetize.io)**: `eas build -p ios --profile ios-simulator`
  produces a `.tar.gz` containing the `.app`. Upload it at appetize.io (free tier) and drive the
  app in a browser. Good for UI, flows, i18n and layout. NOT testable there: push notifications,
  real alert timing, and Sign in with Apple (cloud simulators have no iCloud account signed in).
- **Real iPhones in the browser (BrowserStack App Live / LambdaTest)**: upload the `.ipa` from
  `eas build -p ios --profile preview` (internal distribution). The service re-signs the app for
  its devices, so push notifications will not arrive there either; sign-in, calendar and UI work.
- **TestFlight (a real iPhone, e.g. Francisco's)**: see 8.6. The only path that exercises push
  notifications, time-sensitive alerts and Sign in with Apple end to end.

### 8.6 TestFlight and submission

```bash
eas build -p ios --profile production
eas submit -p ios --profile production      # uploads the .ipa to App Store Connect
```

(Apple's store format is `.ipa`; Google's is `.aab`. `eas submit` reads `appleId` / `ascAppId` /
`appleTeamId` from `eas.json` - §8.1.) After processing, App Store Connect -> TestFlight: add
internal testers (their Apple account emails); they install via the TestFlight app. iOS
versionCode/buildNumber is managed remotely by EAS like Android (`appVersionSource: remote`).

### 8.7 On-device test plan

Run docs/v1/TESTING.md T20 (iOS rows) plus the regular T1/T5/T8/T11 on at least one real iPhone
before review.

### 8.8 App Review checklist

- **4.8 Login services**: Sign in with Apple is offered with equal prominence (official button
  above Google on the landing screen). Done in the app.
- **5.1.1(v) Account deletion**: in-app deletion exists (Settings) and the Apple token is
  revoked during deletion (the `accounts:revokeToken` call; needs 8.4's key). Mention both in
  Review notes.
- **Privacy nutrition labels** (App Store Connect -> App Privacy): data collected and linked to
  the user: email address, name, calendar/meeting data (app functionality), purchase history
  (subscriptions), diagnostics (Sentry, not linked). Match the privacy policy (§6.5 page).
- **Privacy policy URL** and support URL on the store listing.
- **Encryption**: `ITSAppUsesNonExemptEncryption: false` is already set (standard HTTPS only),
  so no export-compliance questions at submission.
- **Screenshots**: 6.9" (iPhone 16 Pro Max class) and 6.5" sets; the simulator build on
  Appetize can produce them.
- **iPad**: first release is iPhone-only (`supportsTablet: false`); iPads run it in
  compatibility mode. To ship real iPad support later: `supportsTablet: true`, test every
  orientation and split view, add iPad screenshots.
- **Demo account for review**: provide a test email/password account with verified email, or
  reviewers use Sign in with Apple themselves.

### 8.9 After approval

OTA updates (`npm run update:production`) reach iOS builds the same as Android within the same
`version` (runtimeVersion policy `appVersion`); anything native (new module/entitlement) needs a
new `version` and a new store build + review.

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
      testing: the production rollout waits for `docs/v1/DEPLOYMENT.md` §4 item 4.
- [ ] `eas env:list` shows every required variable in all three environments.
      `eas build:version:get -p android` shows 20 (or higher after a production build).
- [ ] `OPENAI_API_KEY` is set. `functions/.env.<project-id>` exists. The functions, rules and indexes
      are deployed. `FUNCTIONS_REGION` equals `EXPO_PUBLIC_FUNCTIONS_REGION`.
- [ ] A development build signs in with Google and creates a meeting. The document appears under
      `users/{uid}/meetings` in the Firestore console.
- [ ] The assistant answers (this uses one of the 5 free requests of the day).

---

## 10. Microsoft/Outlook (Azure app registration)

Optional: Outlook calendar sync (docs/v1/ARCHITECTURE.md §17). Without `EXPO_PUBLIC_MSAL_CLIENT_ID`
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
permissions -> `Calendars.ReadWrite`** and **`Tasks.ReadWrite`** (Microsoft To Do, Stage 2 M7: the
app requests both at sign-in; a consent granted without `Tasks.ReadWrite` must be redone by
stopping the Outlook sync and connecting again), plus `offline_access`, `openid` and
`profile` if they are not already listed. These are all delegated permissions that the user consents to at sign-in;
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
  offline_access User.Read Calendars.ReadWrite Tasks.ReadWrite`. The Microsoft account is
  independent of the app's Google/Firebase sign-in.
- Only the refresh token is stored, in expo-secure-store (`mg.ms.refresh.{uid}`); it is deleted on
  disconnect and at sign-out. Access tokens stay in memory.
- Sync: `/me/calendarView/delta` pull + create/patch/delete push on the account's default
  calendar; tasks: `/me/todo/lists/{id}/tasks/delta` pull + create/patch/delete push on the
  chosen To Do list (ARCHITECTURE §28). "Stop sync and review access" opens <https://account.live.com/consent/Manage>
  (work/school accounts use <https://myapps.microsoft.com>), because Graph offers no programmatic
  consent revoke.

### 10.5 Check

- [ ] The Calendar sync screen shows the "Outlook Calendar" card (it is hidden when
      `EXPO_PUBLIC_MSAL_CLIENT_ID` is unset).
- [ ] "Connect Outlook" opens the Microsoft sign-in, returns to the app, and the card shows the
      account and "Connected".
- [ ] "Sync now" reports an Outlook line; an event created in Outlook on the web appears in
      MeetingGuard within one sync, and a meeting created in MeetingGuard appears in Outlook.
- [ ] The "Microsoft To Do" card appears under the Outlook card; "Sync tasks with To Do" lists the
      account's lists and, once started, a task created in the app appears in the chosen list.

### 10.6 Continue with Microsoft (sign-in; docs/v1/ARCHITECTURE.md §31)

The same registration also signs users IN to the app ("Continue with Microsoft" on the Landing
screen). The app sends the Microsoft id_token to the `microsoftSignIn` function, which verifies it
and answers with a Firebase custom token; no Firebase console provider is needed and no secret.

1. **Azure**: nothing new when §10.1 and §10.2 are done. The sign-in asks only for `openid profile
   email` (the `email` permission is in the registration's defaults; add **Microsoft Graph ->
   Delegated -> email** if it is missing). Optional, recommended for work and school accounts:
   **Token configuration -> Add optional claim -> ID -> xms_edov** ("email domain owner verified"),
   which lets such a sign-in join an existing account with the same address instead of asking the
   user to verify the email.
2. **Functions**: add the client id to `functions/.env.<project-id>` (§6.3) and deploy:

   ```dotenv
   MICROSOFT_CLIENT_ID=00000000-0000-0000-0000-000000000000
   MICROSOFT_TENANT=common
   ```

   Both must equal `EXPO_PUBLIC_MSAL_CLIENT_ID` / `EXPO_PUBLIC_MSAL_TENANT` of the app build. An
   empty `MICROSOFT_CLIENT_ID` keeps the function deployed but disabled (the app shows "Microsoft
   sign-in isn't set up").
3. **Firestore rules**: the `microsoftIdentities` collection is server-only; deploy the rules with
   the build (`npm run deploy:rules`).
4. **IAM, once per project**: minting the Firebase custom token needs the
   `iam.serviceAccounts.signBlob` permission, which the functions' runtime service account
   (`<project-number>-compute@developer.gserviceaccount.com`, shown under Cloud Functions ->
   microsoftSignIn -> Details) does not have by default. Without it every sign-in fails with
   "The service isn't responding right now" and the function log says "Permission
   iam.serviceAccounts.signBlob denied". Grant the account the **Service Account Token Creator**
   role on itself:

   ```bash
   gcloud iam service-accounts add-iam-policy-binding <project-number>-compute@developer.gserviceaccount.com \n     --member="serviceAccount:<project-number>-compute@developer.gserviceaccount.com" \n     --role="roles/iam.serviceAccountTokenCreator" --project <project-id>
   ```

   or in the console: IAM & Admin -> IAM -> edit that principal -> add role "Service Account Token
   Creator" -> Save. The grant takes a minute or two to apply.
5. **Check**: Landing shows "Continue with Microsoft" when the app has the client id; a personal
   Microsoft account signs in and lands on the dashboard (docs/v1/TESTING.md T25).
6. **Website** (optional): the web agenda signs users in with the SAME registration and function.
   Azure -> the registration -> Authentication -> Add a platform -> **Single-page application**
   (PKCE, no secret) with the website's redirect URIs (production domains, the Vercel preview and
   `http://localhost:3000/...` for development; they can sit next to the app's mobile redirect).
   The website sends `signInOnly: true` so an unknown Microsoft account is refused with
   not-found (`microsoft_user_not_found`) instead of creating an account without the app. The
   client id is public (a public client), the tenant is `MICROSOFT_TENANT` (`common`).

---

## 11. RevenueCat + store subscriptions (in-app purchases)

Optional: paid plans (docs/v1/ARCHITECTURE.md §20). Without the platform's public SDK key
(`EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` on Android, `EXPO_PUBLIC_REVENUECAT_APPLE_KEY` on iOS)
the Plans screen keeps its catalog-only "Subscriptions coming soon" view on that platform - the
app builds and runs fine without this section, and each platform can go live independently.
RevenueCat's free tier covers this app until real revenue.

The keys involved must never swap places:

- the **public SDK keys** (`goog_...` / `appl_...`) go in the app env
  (`EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` / `EXPO_PUBLIC_REVENUECAT_APPLE_KEY`);
- the **webhook Authorization value** (a random string you invent) goes ONLY in the Functions
  secret `REVENUECAT_WEBHOOK_AUTH`;
- the RevenueCat **secret** API key (`sk_...`) goes ONLY in the Functions secret
  `REVENUECAT_SECRET_KEY` (§11.7 reconciliation) and nowhere else - never in the app env.

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
trial" phase of 3 days. The offer's eligibility MUST be **"new customer acquisition"**: Play
then stops reporting the offer to users who already consumed their trial, which keeps the
app's "3-day free trial" line honest (the copy only appears when the store actually reports
the trial, so a missing offer is visible immediately). iOS has no such store-side filter -
StoreKit reports the intro offer to everyone - so the App Store build words the same line as
"New subscribers: 3-day free trial" instead. Activate products, base plans and offers. Prices
are the catalog values from `src/services/billing.ts`; Google converts them to local
currencies.

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
   for the Play app (`goog_...`), in `.env` and in the EAS environments. For iOS,
   `EXPO_PUBLIC_REVENUECAT_APPLE_KEY` = the Public SDK key of the App Store app (`appl_...`,
   §11.6); each platform reads only its own key.
2. The SDK (`react-native-purchases`) is a NATIVE module: purchases need a new dev/store build
   with a bumped `version` (docs/v1/ARCHITECTURE.md §15 - never OTA). Expo Go stays catalog-only.
   No config plugin and no extra iOS entitlement are needed (the In-App Purchase capability is
   on by default for every App ID; `npx expo config` output is unchanged).

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

### 11.6 iOS: App Store Connect products + the RevenueCat Apple app

Needs the App Store Connect app from §8 first, plus the **Paid Apps agreement** (App Store
Connect -> Business: signed and active - products stay "Missing Metadata" without it).

1. App Store Connect -> your app -> Monetization -> Subscriptions: create ONE subscription
   group (e.g. "MeetingGuard Plans") and inside it the SAME four product ids as Play:
   `pro_monthly`, `pro_yearly`, `premium_monthly`, `premium_yearly` (prices per §11.1; one
   group is what gives Apple its native upgrade/crossgrade handling). On each product add an
   **introductory offer**: free trial, 3 days, new subscribers. Set premium above pro in the
   group's ranking (upgrade direction).
2. App Store Connect -> Users and Access -> Integrations -> **In-App Purchase**: generate an
   In-App Purchase key (.p8) and note the Issuer ID. This key is REQUIRED for StoreKit 2
   (purchases fail to record in RevenueCat without it); the legacy app-specific shared secret
   is NOT needed.
3. RevenueCat -> the same project as §11.2 -> add an **App Store** app with bundle id
   `com.meetingguard.ai`, upload the .p8 + Issuer ID. In **Entitlements**, attach the four App
   Store products to the SAME `pro`/`premium` entitlements as the Play products; add the App
   Store products to the SAME current offering's packages.
4. `EXPO_PUBLIC_REVENUECAT_APPLE_KEY` = API keys -> Public SDK key of the App Store app
   (`appl_...`), into `.env` and the EAS environments (§11.4). The webhook from §11.3 already
   receives App Store events (same URL, `store: APP_STORE`); nothing to redeploy.
5. Sandbox testing uses a **Sandbox Apple Account** (App Store Connect -> Users and Access ->
   Sandbox); those purchases arrive as SANDBOX events and need `REVENUECAT_ALLOW_SANDBOX=true`
   exactly like the Play license-tester phase (11.3 step 5).

### 11.7 Entitlement reconciliation (adminReconcileEntitlement)

Optional self-heal for drifted entitlements (same-user Restore emits no webhook event; missed
deliveries; see docs/v1/ARCHITECTURE.md §20). Gated like Zoom/WhatsApp, so the default deploy
never touches the secret:

1. Set the secret FIRST: `firebase functions:secrets:set REVENUECAT_SECRET_KEY` = the
   RevenueCat **secret** API key (`sk_...`, dashboard -> Project -> API keys). Deploying from a
   machine that cannot be prompted? Create a PLACEHOLDER value first - the function is not
   exported until the param flips, but the secret must EXIST before any deploy that enables it.
2. Put `REVENUECAT_RECONCILE_ENABLED=true` in `functions/.env.<projectId>`, then deploy
   functions. (Back to `false` + redeploy removes the function again - accept the delete offer.)
3. Use it from the admin dashboard: Users table -> "Reconcile" on a user row. Outcomes:
   `updated` (the entitlement was drifted and is now store-truth), `unchanged` (no drift - also
   when a webhook event or admin write landed DURING the reconcile: the newer write wins and a
   re-run checks against the fresh state), `skipped_admin` (an admin-granted plan that
   RevenueCat does not back - such comps are never downgraded; an ACTIVE store subscription
   still overwrites a comp), `no_data` (only sandbox or unverifiable data at RevenueCat - an
   entitlement without a resolvable backing subscription is not trusted as production while
   `REVENUECAT_ALLOW_SANDBOX` is false). The write is auditable in the function logs
   (`revenuecat.reconciled`).

## 12. Zoom auto links (Server-to-Server OAuth app)

Optional. Until this section is done the app simply keeps the paste-a-link behavior for Zoom
(`zoomStatus` answers `configured: false`). Design: docs/v1/ARCHITECTURE.md §24.

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
  `zoomMeetings/{id}` ownership registry (docs/v1/ARCHITECTURE.md §24).
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
`auth:errors.providerDisabled`). Design: docs/v1/ARCHITECTURE.md §25.

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

## 14. WhatsApp bot (Meta Cloud API)

The bot (docs/v1/ARCHITECTURE.md §27) answers from ONE server-owned WhatsApp number. Development
runs on the FREE TEST NUMBER every Meta developer app gets (up to 5 allow-listed recipients, no
business verification needed); the client's own number comes later and the swap is exactly TWO
values (step 8). The client's Meta Business account is NEW, so his own number is not released
yet - that blocks nothing below.

Prerequisites: a Meta developer account (developers.facebook.com) and the client's Meta
Business Portfolio (business.facebook.com). Everything runs on the test number until step 8.

1. **Create the Meta app**: developers.facebook.com -> My Apps -> Create App -> Use case
   "Other" -> type **Business** -> name e.g. "MeetingGuard Bot" -> link the client's Business
   Portfolio. On the app dashboard: Add product -> **WhatsApp** -> Set up. This creates the
   test number automatically.
2. **Collect the three values** under WhatsApp -> **API Setup**:
   - the **Phone number ID** of the TEST number (NOT the displayed phone number),
   - the test number itself as digits only, e.g. `15551234567` (shown as "From"),
   - a **temporary access token** (expires after 24 h; fine for the first smoke test - the
     permanent one comes in step 3).
   Also set the **App Secret** aside: App settings -> Basic -> App secret -> Show.
3. **Permanent access token** (do this right away; the temporary token dies in 24 h):
   business.facebook.com -> Settings -> Business settings -> Users -> **System users** -> Add
   (name e.g. "meetingguard-bot", role Admin) -> Add assets -> Apps -> select the app -> full
   control -> **Generate new token**: select the app, expiry "never", scopes
   `whatsapp_business_messaging` + `whatsapp_business_management` -> Generate and store it in a
   password manager. This token is `WHATSAPP_ACCESS_TOKEN`.
4. **Allow-list the test recipients**: WhatsApp -> API Setup -> "To" -> Manage phone number
   list -> add up to 5 numbers (yours and the client's; each confirms a code over WhatsApp).
   The test number can ONLY message these numbers - a real customer number comes with step 8.
5. **Secrets and params** (functions/, like §12; set the secrets BEFORE flipping the flag):
   ```
   firebase functions:secrets:set WHATSAPP_ACCESS_TOKEN   # the system-user token from step 3
   firebase functions:secrets:set WHATSAPP_APP_SECRET     # App settings -> Basic -> App secret
   firebase functions:secrets:set WHATSAPP_VERIFY_TOKEN   # any random string you invent, e.g. `openssl rand -hex 24`
   ```
   Then in `functions/.env.meetingguard-ai-app`:
   ```
   WHATSAPP_ENABLED=true
   WHATSAPP_PHONE_NUMBER_ID=<Phone number ID from step 2>
   WHATSAPP_DISPLAY_NUMBER=<test number digits, e.g. 15551234567>
   ```
   Deploy: `firebase deploy --only functions,firestore:rules`. The webhook only deploys while
   WHATSAPP_ENABLED=true (docs/v1/ARCHITECTURE.md §27); with the flag false a deploy never touches
   the secrets.
6. **Register the webhook**: WhatsApp -> Configuration -> Webhook -> Edit:
   - Callback URL: `https://us-central1-meetingguard-ai-app.cloudfunctions.net/whatsappWebhook`
   - Verify token: the exact WHATSAPP_VERIFY_TOKEN value from step 5.
   - Verify and save (the function answers the handshake), then under Webhook fields
     **subscribe to `messages`** (only that field).
7. **Check** (from an allow-listed phone):
   - [ ] Send "hi" to the test number -> the bilingual "link your account" reply arrives.
   - [ ] App -> Settings -> WhatsApp -> Generate code; send the 6 digits to the bot -> the
         bilingual "linked" confirmation arrives.
   - [ ] "What do I have tomorrow?" -> an assistant answer; a create request -> summary with
         Confirm/Cancel buttons; Confirm -> the meeting appears in the app (source WhatsApp).
   - [ ] docs/v1/TESTING.md T21 for the full pass.
8. **Go live on the client's own number** (once Meta releases it to his new Business account):
   - Business verification: business.facebook.com -> Settings -> Security centre -> Start
     verification (Meta asks for business documents; this also lifts the new-account limits).
   - WhatsApp -> API Setup -> Add phone number: the client's number (it must NOT be attached
     to a regular WhatsApp/WhatsApp Business app; Meta sends a code), display name review runs
     automatically.
   - The SWAP, two values + nothing else: `WHATSAPP_PHONE_NUMBER_ID` (the new number's id) and
     `WHATSAPP_DISPLAY_NUMBER` in `functions/.env.meetingguard-ai-app`; re-generate the system
     user token ONLY if the app changed (normally the step-3 token keeps working). Redeploy
     functions. The allow-list stops applying; any WhatsApp user can message the bot.
   - [ ] Repeat the step-7 checks from a NON-allow-listed phone.
   - If the Meta app was created fresh (for example after a blocked business account) and the
     WhatsApp product tile does NOT appear on its dashboard, the Webhooks product works instead
     (object "Whatsapp Business Account", subscribe to messages), but two Graph calls are then
     still required, both with the system-user token: POST /{phone_number_id}/register with
     {messaging_product:"whatsapp", pin:"NNNNNN"} (WhatsApp otherwise reports the number
     "isn't on WhatsApp"), and POST /{waba_id}/subscribed_apps (without it the account sends
     its messages nowhere; GET the same path lists what is subscribed). The dashboard "Test"
     button sends Meta's sample payload (wamid ABGGFlA5Fpa, years-old timestamp), which the
     webhook logs as whatsapp.stale_dropped; that is not a real message. Done this way on
     2026-10-22 for +44 7403 693109 (phone number id 1427445667111962, WABA 1116238597569973).

Notes: the webhook rejects unsigned requests (App Secret HMAC over the raw body), so the URL
being public is fine. Firestore gets five new server-only collections (whatsapp*; rules deploy
in step 5). The bot shares the assistant's per-user AI allowance, so WhatsApp traffic cannot
multiply a user's AI spend.

## 15. Executive assistant email (Postmark; prototype A1 to A3)

The assistant sends from its own address on a mail subdomain and receives the replies there
(ARCHITECTURE section 36). It stays OFF until these steps are done; with MATTERS_ENABLED false
nothing below is needed for a deploy.

### 15.1 Postmark account and server

1. The client opens the Postmark account in the company's name (postmarkapp.com) and adds the
   company card; Pro is about USD 16.50 a month and is shared with the forwarded summaries
   (M10). Invite the developers as team members (Account > Team).
2. Create a server named `assistant` (the summaries use their own server). Its default
   transactional stream `outbound` is the one the functions use (MATTERS_TUNING.messageStream).
3. Request the account approval early: until Postmark approves the account it only delivers to
   addresses on the account's own domains.

### 15.2 The mail subdomain (DNS)

1. In Postmark: Sender Signatures > Domains > Add `assistant.meetingguard.ai`. Postmark shows a
   DKIM TXT record (`<selector>._domainkey.assistant`) and a Return-Path CNAME
   (`pm-bounces.assistant` -> `pm.mtasv.net`).
2. Add in the DNS of meetingguard.ai (Hostinger, with the client's OK):
   - the DKIM TXT record and the Return-Path CNAME exactly as Postmark shows them;
   - `MX assistant` -> `inbound.postmarkapp.com`, priority 10 (replies come to Postmark);
   - `TXT _dmarc.assistant` -> `v=DMARC1; p=none; rua=mailto:<an address that reads reports>`
     (move to `p=quarantine` once the reports are clean).
   These touch only the subdomain: the website and any existing mailboxes of meetingguard.ai are
   unchanged.
3. Back in Postmark, verify DKIM and Return-Path.

### 15.3 Inbound

1. Server `assistant` > Settings > Inbound: inbound domain `assistant.meetingguard.ai`.
2. Webhook URL (after the first deploy with MATTERS_ENABLED, 15.4):
   `https://postmark:<MATTERS_INBOUND_PASSWORD>@<region>-<project>.cloudfunctions.net/assistantInboundEmail`
   (HTTP basic auth; the function answers 401 to anything else). Leave "Include raw email
   content" OFF until A2 reads it (A2 checks SPF, DKIM and DMARC from it): with it on, a reply
   carrying an attachment of about 2 MB is over the webhook's 5 MiB limit and is only logged
   (`matters.inbound_too_large`), never stored.

### 15.4 Secrets, params and deploy

From `functions/`, without typing the values at a prompt (no newline is stored):

```bash
printf '%s' "<the API token of server assistant>" | npx firebase functions:secrets:set POSTMARK_SERVER_TOKEN
printf '%s' "$(openssl rand -hex 24)" | npx firebase functions:secrets:set MATTERS_INBOUND_PASSWORD   # also in the webhook URL
```

Then in your own `functions/.env.<projectId>` (only the developer who deploys the matter
functions has these lines until the beta; the other developer leaves them out, see below):

```
MATTERS_ENABLED=true
MATTERS_ALLOWED_UIDS=<uid of each tester, comma-separated>
MATTERS_MAIL_DOMAIN=assistant.meetingguard.ai
MATTERS_USER_DAILY_LIMIT=30
```

and deploy only these five functions by name (CONTRIBUTING, "Deploying"):

```bash
npx firebase deploy --only functions:matterDraft,functions:matterRevise,functions:matterConfirm,functions:matterCancel,functions:assistantInboundEmail
```

Before a Postmark account exists, the secret POSTMARK_SERVER_TOKEN can hold Postmark's public
test token `POSTMARK_API_TEST`: sends are accepted and nothing is delivered.

Replacing a secret (the test token by the real one, or a new MATTERS_INBOUND_PASSWORD): deployed
functions keep the secret VERSION that was latest at their deploy. With only `secrets:set`,
matterConfirm goes on using the test token and answers "sent" while nothing arrives, and after a
new inbound password the webhook answers 401. So after `secrets:set`, either accept the CLI's
offer to update the functions that use the secret, or redeploy them by name:

```bash
npx firebase deploy --only functions:matterConfirm,functions:assistantInboundEmail
```

Never run the `firebase deploy --only functions` the CLI prints as a hint (that is a full
functions deploy). Then check with one real send (15.6).

The MATTERS_* lines stay ONLY in the `.env.<projectId>` of the developer who deploys the matter
functions (Sven) until the beta. The other developer does not copy them: a deploy from `v2`
with MATTERS_ENABLED=true would redeploy the five functions from `v2` code with another tester
list, over what was deployed from the work branch.

While MATTERS_ENABLED is not `true` in a deployer's `.env.<projectId>`, the five functions and
their params and secrets are not even declared (functions/src/config.ts `mattersParams`), so
that deploy never asks for them. A full deploy from `v2` without the line offers to delete the
five functions if they are deployed: answer No. The quick kill switch is a by-name redeploy of
the five functions with MATTERS_ALLOWED_UIDS empty (the run-time MATTERS_ENABLED check cannot be
reached, since the functions only exist while it is true); matterCancel still works for every
owner. Turning the assistant off for good:
`npx firebase functions:delete matterDraft matterRevise matterConfirm matterCancel assistantInboundEmail`.

### 15.5 Test build of the app

`EXPO_PUBLIC_MATTERS_ENABLED=1` in the test build's environment shows Settings > AI executive
assistant. Never in a store build until the beta (A10).

### 15.6 Check

Hand over a matter to your own second address, confirm, and check in the received email
("Show original" in Gmail): SPF, DKIM and DMARC pass, From is the assistant's address,
Reply-To is `m-<token>@assistant.meetingguard.ai`. Reply to it: the reply appears under the
matter (Firestore `users/<uid>/matters/<id>/messages`).
