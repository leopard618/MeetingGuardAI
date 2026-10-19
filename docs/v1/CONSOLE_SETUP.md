# Firebase & Google console setup guide

Step-by-step setup of everything MeetingGuard AI needs in the Firebase and Google Cloud consoles,
including every key the app uses and where it lives. Written so it can be followed from zero with
the **client's Google account** (recommended for production ownership).

Related docs: `SETUP.md` (full technical setup incl. EAS, secrets rotation, Azure/Outlook §10,
RevenueCat §11, iOS §8), `DEPLOYMENT.md` (release/rollback), `ADMIN.md` (admin dashboard).

---

## 1. How the accounts and keys fit together

```
Google account (project OWNER — should be the client for production)
└── Google Cloud project  =  Firebase project        (one project, two consoles)
    ├── Firebase Authentication  (Google sign-in)
    ├── Firestore database       (all app data; protected by firestore.rules)
    ├── Cloud Functions          (AI assistant, account deletion, admin, billing webhook)
    │     └── Secret Manager     (OPENAI_API_KEY, REVENUECAT_WEBHOOK_AUTH — secrets live ONLY here)
    ├── Firebase Hosting         (/delete-account page, /admin dashboard)
    └── OAuth clients            (Web client = app sign-in audience; Android clients = one per signing key)

Separate accounts (own dashboards, linked by keys):
    OpenAI    → API key (secret)            → stored in Secret Manager, used by the assistant function
    RevenueCat→ public SDK key + webhook    → only when subscriptions go live (SETUP.md §11)
    Azure     → MSAL client id (public)     → only when Outlook sync goes live (SETUP.md §10)
    Apple     → developer account           → only for iOS (SETUP.md §8)
```

**Key rule:** the app (APK) contains **only public identifiers** (`EXPO_PUBLIC_*`).
All secrets live server-side in Secret Manager. Never put a secret in `.env`, EAS env vars, chat, or git.

---

## 2. Choosing the ownership path

### Option A — transfer the existing project to the client (RECOMMENDED)

Keeps the current project `meetingguard-ai-app` — nothing is rebuilt, re-deployed or re-entered.

1. Firebase console → project → ⚙️ **Project settings → Users and permissions** → **Add member** →
   client's Gmail → role **Owner** → invite. The client accepts the email invitation.
2. Billing to the client's card: Google Cloud console → **Billing** → either
   (a) client creates his own billing account (with his card) and you **change the project's billing
   account** to his (Billing → Account management → change), or
   (b) client is added as Billing Account Administrator on the existing one.
3. After launch is stable: remove the developer's account from Users and permissions (or downgrade
   to Editor). The client is now sole owner.
4. Nothing else changes: `.env`, deployed rules/functions, OAuth clients and APKs all keep working.

### Option B — fresh project under the client's account (from zero)

Follow the rest of this guide logged in as the client. At the end you must also:
- update `.env` (new Firebase config + Web client ID) and rebuild the APK,
- update `.firebaserc` and rename `functions/.env.<project-id>`,
- redeploy rules, indexes, functions and hosting,
- re-create the OAuth consent screen, test users and Android OAuth client(s).
Old test data does not migrate (fine during testing).

---

## 3. Create the Firebase project (Option B, or reference)

1. https://console.firebase.google.com → **Create a project**.
2. Name e.g. `MeetingGuard AI`. Note the **project ID** under the name (e.g. `meetingguard-ai-app`) —
   it is permanent and used everywhere below. Edit it with the pencil if wanted.
3. Gemini/AI assistance: **off**. Google Analytics: **off** (can be added later). → Create.

### 3.1 Register the app and collect the 6 config values

1. Project home → **+ Add app** → **Web** (`</>`). Nickname `MeetingGuard app`.
   Do **not** tick Firebase Hosting here. → Register app.
2. The console shows `const firebaseConfig = { ... }`. Copy these 6 values into `.env`
   (no quotes, no spaces — see the key table in §7):
   apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId.
3. **Continue to console** (ignore the `npm install firebase` instructions — already done).

### 3.2 Enable Google sign-in and collect the Web client ID

1. Left menu → **Authentication** (under *Security* or via product search) → **Get started**.
2. **Sign-in method** → **Add new provider → Google → Enable** → choose support email → **Save**.
3. Click the **Google** row again → expand **Web SDK configuration** →
   copy the **Web client ID** (ends `.apps.googleusercontent.com`) → `.env` key
   `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`.
   The **Web client secret** shown below it stays where it is — never copy it anywhere.

### 3.3 Create the Firestore database

1. Left menu → **Firestore Database** → **Create database**.
2. Edition **Standard**, Database ID `(default)`.
3. **Location: `us-central1` (Iowa)** — must match the functions region; cannot be changed later.
4. **Start in production mode** → Create.
5. Production mode = deny-all until our rules are deployed (§8). The app cannot save data before that.

### 3.4 Upgrade to the Blaze plan (required for Cloud Functions)

1. Bottom-left **Spark → Upgrade → Blaze (Pay as you go)**.
2. Link or create a **billing account** (credit/debit card; prepaid cards often rejected).
3. Set the offered **budget** to $10 (or later: ⚙️ → Usage and billing → Budgets).
4. Reality check: testing stays inside the free allowances (~$0). Budgets alert by email only;
   hard cost protection = the functions' built-in daily cap + the OpenAI budget (§6).

---

## 4. Google Cloud console (same project)

Open https://console.cloud.google.com and **select the same project** in the top bar
(check the project ID every time — a very easy mistake is configuring the wrong project).

### 4.1 Enable the Google Calendar API

☰ → **APIs & Services → Library** → search **Google Calendar API** → **Enable**.

### 4.2 OAuth consent screen + test users

1. ☰ → **APIs & Services → OAuth consent screen** (newer UI: **Google Auth Platform**).
2. First time: **Get started** → App name `MeetingGuard AI`, support email → Audience **External** →
   contact email → agree → Create.
3. **Audience → Test users → + Add users**: every Google account that will sign in during testing
   (developer test account, the client's Gmail, any testers). → Save.
4. Publishing status stays **Testing** until Google verification (SETUP.md §4.4):
   - only test users can sign in / grant calendar access;
   - the calendar consent shows a mild "unverified app" notice — normal;
   - calendar access expires after **7 days** in Testing → reconnect in the app (normal, not a bug).

**Status (2026-10-19): done.** Verification is approved and the publishing status is In production,
so none of the notices above appear any more and test users are no longer needed to sign in.

### 4.3 Android OAuth client(s) — one per signing key

☰ → **APIs & Services → Credentials** → **+ Create credentials → OAuth client ID** → **Android**:

| Field | Value |
|---|---|
| Name | e.g. `MeetingGuard test (local key)` |
| Package name | `com.meetingguard.ai` |
| SHA-1 | fingerprint of the signing key (see below) |

Created client IDs are not copied anywhere — the client just has to **exist** in this project.
A (package, SHA-1) pair can exist in **one Google project only**; delete it elsewhere first.

SHA-1 fingerprints to register over time:

| Signing key | Where to get the SHA-1 | When |
|---|---|---|
| Local test key | `npm run apk:sha1` (current: `7E:59:66:D6:5C:28:14:34:5E:12:52:62:05:6E:EF:04:BF:D9:C3:71`) | now (emulator/APK testing) |
| EAS upload key | `eas credentials -p android` | before first EAS cloud build |
| Play App Signing key | Play Console → Test and release → App integrity | before Play release |

### 4.4 iOS client — only when iOS starts (SETUP.md §8, needs Apple account).

---

## 5. The complete key table

### In the app — `.env` locally, EAS env vars for cloud builds (ALL PUBLIC identifiers)

| Key | Where to find it | Required |
|---|---|---|
| `EXPO_PUBLIC_FIREBASE_API_KEY` | §3.1 firebaseConfig `apiKey` (starts `AIza`) | yes |
| `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN` | firebaseConfig `authDomain` | yes |
| `EXPO_PUBLIC_FIREBASE_PROJECT_ID` | firebaseConfig `projectId` | yes |
| `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET` | firebaseConfig `storageBucket` | yes |
| `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | firebaseConfig `messagingSenderId` | yes |
| `EXPO_PUBLIC_FIREBASE_APP_ID` | firebaseConfig `appId` | yes |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | §3.2 Web SDK configuration | yes |
| `EXPO_PUBLIC_FUNCTIONS_REGION` | `us-central1` (must equal functions region) | yes |
| `EXPO_PUBLIC_APP_ENV` | `development` / `preview` / `production` | yes |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | §4.4 iOS client | iOS only |
| `EXPO_PUBLIC_MSAL_CLIENT_ID` (+ `_TENANT`) | Azure app registration (SETUP.md §10) | Outlook only |
| `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` (`goog_…`) | RevenueCat project (SETUP.md §11) | subscriptions only |
| `EXPO_PUBLIC_SENTRY_DSN` | Sentry project settings | optional |

Current developer test project (`meetingguard-ai-app`) values are filled in the local `.env`.
For a client-owned project (Option B) replace them with the new project's values.

### Server-side SECRETS — Secret Manager only, via `npx firebase functions:secrets:set <NAME>`

| Secret | Used by | Source |
|---|---|---|
| `OPENAI_API_KEY` | `assistant` function | OpenAI dashboard → API keys (create NEW; set monthly budget there) |
| `REVENUECAT_WEBHOOK_AUTH` | `revenuecatWebhook` | any long random string; same value pasted in RevenueCat webhook header |

Server parameters (not secret) — `functions/.env.<project-id>`:
`FUNCTIONS_REGION=us-central1`, `OPENAI_MODEL=…`, `OPENAI_REASONING_EFFORT=low`,
`ASSISTANT_GLOBAL_DAILY_LIMIT=5000`.

### NEVER in the app, git, chat or email
OpenAI keys · any `*_CLIENT_SECRET` · Supabase/service-account JSON · keystores ·
webhook secrets · the Web client secret from §3.2. (The pre-rebuild v1.0.9 leaked such values —
rotation checklist: SETUP.md §1.)

---

## 6. OpenAI account (client-owned recommended)

1. https://platform.openai.com → create account → **API keys → Create new secret key**.
2. **Billing**: add ~$10 credit; **Limits**: set a monthly budget — this is the real AI cost control.
3. Check the model in `functions/.env.<project-id>` (`OPENAI_MODEL`) is available to the key.
4. Hand the key over securely, store it with `functions:secrets:set OPENAI_API_KEY`, delete the message.

---

## 7. Connect the repo to the project

```powershell
cd D:\WorkSpace\MeetingGuard_2025.7.28\Codebase
Copy-Item .firebaserc.example .firebaserc     # put the project ID inside (git-ignored)
# .env: fill the key table from §5 (git-ignored; template = env.example)
```

## 8. Deploy the backend

```powershell
cd functions
npm ci
npx firebase login                            # browser: log in as a project owner/editor
npx firebase functions:secrets:set OPENAI_API_KEY
npm run deploy:rules                          # firestore.rules + indexes  (works on Spark too)
npm run deploy                                # all functions (needs Blaze)
npx firebase deploy --only hosting            # /delete-account + /admin pages
```

Verify: Firebase console → Functions lists `assistant`, `deleteAccount`, `dailyMaintenance`,
`revenuecatWebhook`, `adminListUsers`, `adminSetUserDisabled`, `adminSetUserPlan`, `adminGetMetrics`.

## 9. Grant admin access (dashboard)

```powershell
cd functions
gcloud auth application-default login         # once, as a project owner
node scripts/set-admin-claim.mjs <email> --project <project-id>
```
Then open `https://<project-id>.web.app/admin/` and sign in with that email (docs/v1/ADMIN.md).

---

## 10. Final checklist

- [ ] Project exists; owner = client (Option A transfer done, or Option B fresh)
- [ ] Blaze + $10 budget; billing card = client's
- [ ] Web app registered; 6 firebaseConfig values in `.env` / EAS
- [ ] Google sign-in enabled; Web client ID in `.env`
- [ ] Firestore created (us-central1, production mode); rules + indexes deployed
- [ ] Calendar API enabled
- [ ] Consent screen External/Testing; all tester Gmails in Test users (incl. client)
- [ ] Android OAuth client per signing key (test key now; EAS + Play keys later)
- [ ] OPENAI_API_KEY secret set (new key, budget capped); functions deployed; hosting deployed
- [ ] Admin claim granted; /admin reachable
- [ ] APK built against this project (`npm run apk:test`) and sign-in verified on a device/emulator
