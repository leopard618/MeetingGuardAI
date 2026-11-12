# Meeting Guard AI - Cloud Functions

Firebase backend for the Meeting Guard AI app: Cloud Functions v2 (TypeScript, Node 22), Firestore
security rules and the public account-deletion page.

| Callable | What it does |
|---|---|
| `assistant` | AI assistant. Validates the request, counts the daily quota, loads the user's meetings server-side, calls OpenAI with tool calling and returns a reply plus **proposed** actions. It never changes data: the app shows a confirmation card and executes confirmed actions itself. |
| `deleteAccount` | Records the deletion in `accountDeletions/{uid}` (anonymous id + time, kept 30 days for the restore runbook), then deletes `users/{uid}` (recursively), `entitlements/{uid}`, `usage/{uid}` (recursively), the user's `microsoftIdentities` and the Firebase Auth user. Idempotent. |
| `microsoftSignIn` | Sign in with Microsoft (unauthenticated by design: it IS the sign-in). The app runs the Microsoft PKCE sign-in and sends the id_token plus its nonce; the function verifies the token against Microsoft's published keys (audience = `MICROSOFT_CLIENT_ID`, issuer = the token's tenant, `MICROSOFT_TENANT` policy, lifetime, nonce), resolves the Firebase user (`microsoftIdentities/{oid}`, else an existing user with the same VERIFIED email, else a new `ms_{oid}` user) and answers with a custom token (docs/ARCHITECTURE.md §31, docs/SETUP.md §10.6). Empty `MICROSOFT_CLIENT_ID` = disabled. |
| `adminListUsers` / `adminSetUserDisabled` / `adminSetUserPlan` / `adminGetMetrics` | Admin dashboard v1 (custom claim `admin: true` required; `src/admin`, docs/ADMIN.md). |
| `adminGetStats` / `adminGetHealth` / `adminRotateOpenAiKey` | Admin dashboard v2: per-UTC-day usage/signup series with a cost estimate, runtime health (secret mode + optional real OpenAI ping), and OpenAI key rotation via Secret Manager (docs/ADMIN.md §v2). |
| `zoomStatus` | Whether the Zoom integration is configured (the non-secret `ZOOM_ENABLED` param; no secrets, always deployed). |
| `zoomCreateMeeting` / `zoomSyncMeeting` / `zoomDeleteMeeting` | Server-created Zoom links via the project's Server-to-Server OAuth app (docs/ARCHITECTURE.md §24). Deployed ONLY while `ZOOM_ENABLED=true`; the only functions binding the `ZOOM_ACCOUNT_ID` / `ZOOM_CLIENT_ID` / `ZOOM_CLIENT_SECRET` secrets. Owner order (docs/SETUP.md §12): set the secrets, set `ZOOM_ENABLED=true` in `functions/.env.<projectId>`, then deploy. |

| Scheduled | What it does |
|---|---|
| `dailyMaintenance` | Every day at 03:30 UTC: hard-deletes meeting tombstones older than 60 days (a collection-group query on `deletedAt`; the index is in `../firestore.indexes.json`) and account deletion records older than 30 days. The privacy policy promises both. The first deploy enables Cloud Scheduler. |

The request/response contract is `src/shared/aiContract.ts`, a **verbatim copy** of the app's
`src/core/aiContract.ts`. `npm run check:contract`, a unit test and CI fail when the two differ. To
change the contract, edit `src/core/aiContract.ts` in the app and copy it over.

```
functions/
  src/index.ts                 exports assistant, deleteAccount and the admin callables
  src/config.ts                params (FUNCTIONS_REGION, OPENAI_MODEL, OPENAI_REASONING_EFFORT, pricing, ZOOM_ENABLED, ZOOM_USER_DAILY_LIMIT), secrets (OPENAI_API_KEY, ZOOM_*), limits
  src/assistant/               handler, quota, meeting context, prompt, tools, action mapping, OpenAI adapter, time zones
  src/admin/                   admin callables (schemas.ts = the contract, index.ts = handlers/ports)
  src/openaiKey.ts             runtime OpenAI key: Secret Manager REST + cache + env fallback + rotation edge
  src/zoom/                    zoom* callables (docs/ARCHITECTURE.md §24): index.ts = shell + conditional export, handler.ts = logic on ports, token.ts = S2S token cache, api.ts = Zoom REST client
  src/deleteAccount.ts
  src/microsoftSignIn.ts       Sign in with Microsoft: id_token verification (RS256, JWKS cache), identity resolution, custom token
  src/maintenance/             retention: tombstone purge, deletion log (core.ts pure, index.ts schedule)
  src/shared/aiContract.ts     verbatim copy of src/core/aiContract.ts
  scripts/replay-account-deletions.mjs   re-applies account deletions after a Firestore restore
  test/unit/                   Jest unit tests (no network, no emulator)
  test/rules/                  Firestore rules tests (emulator)
../firestore.rules, ../firestore.indexes.json, ../firebase.json, ../public/delete-account.html
```

## Prerequisites

- Firebase project on the **Blaze** plan (Cloud Functions v2 and Secret Manager need billing).
- Node **22** (the deployed runtime is `nodejs22`; firebase-admin 14 and openai 7 need Node ≥ 22).
- Java **21+** only for the emulators (`npm run serve`, `npm run test:rules`).
- firebase-tools is a pinned dev dependency, so use `npx firebase ...` from this folder (the npm
  scripts already do). A global install works as well.

## First-time setup

```bash
# from the repository root
cp .firebaserc.example .firebaserc          # then put your Firebase project id in it
cd functions
npm ci
npx firebase login
```

### Secret: OpenAI API key

```bash
npx firebase functions:secrets:set OPENAI_API_KEY      # paste the key when prompted
```

The key lives in Cloud Secret Manager. It is never in the repository, the app or the logs. Deploying
grants the function's service account access to it. To rotate it, set a new version and redeploy
`assistant` - or use the admin dashboard's "Rotate OpenAI key" card, which needs the one-time
IAM grant below but no redeploy.

### OpenAI key rotation from the admin dashboard (admin v2)

Admin v2 reads the secret's `latest` version at runtime over Secret Manager REST
(`src/openaiKey.ts`: 5-minute per-instance cache, env-bound value as fallback) so the
`adminRotateOpenAiKey` callable can rotate the key **without a redeploy**. This needs a one-time
IAM grant that deploys do NOT create (owner-run; the runtime service account of this project is
`577722164101-compute@developer.gserviceaccount.com`):

```sh
gcloud secrets add-iam-policy-binding OPENAI_API_KEY \
  --project=meetingguard-ai-app \
  --member=serviceAccount:577722164101-compute@developer.gserviceaccount.com \
  --role=roles/secretmanager.secretAccessor

gcloud secrets add-iam-policy-binding OPENAI_API_KEY \
  --project=meetingguard-ai-app \
  --member=serviceAccount:577722164101-compute@developer.gserviceaccount.com \
  --role=roles/secretmanager.secretVersionManager
```

(`secretAccessor` lets the runtime read `versions/latest`; `secretVersionManager` lets the
rotation callable add a version and disable the prior ones. Both are scoped to this ONE secret,
not the project.) Equivalent REST: `POST https://secretmanager.googleapis.com/v1/projects/
meetingguard-ai-app/secrets/OPENAI_API_KEY:setIamPolicy` with those two bindings added.

Until the grant exists, nothing breaks: the assistant keeps using the env-bound secret
(`mode: 'env-fallback'`), the admin dashboard's Settings tab shows `iamReady: false` together
with the exact commands above and disables the rotate button, and a rotation attempt that
slips through fails with an explicit `failed-precondition` "grant missing" error (the Secret
Manager 403 is mapped - it is NOT a deploy problem). Rotation order (enforced by the
callable): validate the candidate key against `GET api.openai.com/v1/models` → `addVersion` →
disable prior enabled versions with **lower numbers only** (newest wins, so two concurrent
rotations converge instead of disabling each other's version - which would leave
`versions/latest` disabled and the runtime silently on the env fallback) → invalidate the
in-instance cache. If disabling fails AFTER the new version was stored, the callable still
invalidates the cache and reports `aborted`/`stored_cleanup_failed` naming the stored version:
the new key IS becoming active, so do not revoke it at OpenAI - retry the rotation or disable
the old versions in the console. Rejected attempts are audit-logged
(`adminRotateOpenAiKey.rejected`, fixed key-free fields). Other instances pick the new key up
within the 5-minute TTL, or immediately on an OpenAI 401 (one forced refetch + retry). The key
value is never logged, stored in Firestore or returned to the browser.

### Parameters

| Param | Default | Notes |
|---|---|---|
| `FUNCTIONS_REGION` | `us-central1` | Region of both callables. **Must equal `EXPO_PUBLIC_FUNCTIONS_REGION`** in the app. |
| `OPENAI_MODEL` | `gpt-5.4-mini` | Any chat model with tool calling and strict schemas. Check that your key can use it (`GET /v1/models`) before launch. |
| `OPENAI_REASONING_EFFORT` | `low` | `none`, `minimal`, `low`, `medium` or `high`. Use `omit` for non-reasoning models such as `gpt-4.1-mini`, which reject the parameter. |
| `ASSISTANT_GLOBAL_DAILY_LIMIT` | `5000` | Project-wide cap on assistant requests per UTC day that reach OpenAI (spend safeguard on top of the per-user quota). `0` disables it. Also set an OpenAI usage limit and a GCP budget alert. |
| `OPENAI_PRICE_IN_PER_M` | `0` | Input price in USD per 1M tokens, for the admin dashboard's estimated-cost tile only (admin v2). `0` = pricing unset, the estimate is hidden. |
| `OPENAI_PRICE_OUT_PER_M` | `0` | Output price in USD per 1M tokens; same rules as above. |
| `MICROSOFT_CLIENT_ID` | (empty) | Azure "Application (client) ID" of the Meeting Guard AI registration (docs/SETUP.md §10). Empty disables Sign in with Microsoft (the callable answers failed-precondition). **Must equal `EXPO_PUBLIC_MSAL_CLIENT_ID`** in the app. |
| `MICROSOFT_TENANT` | `common` | Tenants whose tokens are accepted: `common`, `organizations`, `consumers` or a tenant GUID. **Must equal `EXPO_PUBLIC_MSAL_TENANT`** in the app (empty there = `common`). |

Every param has a default, but the CLI only uses values it finds in a dotenv file. Without
`functions/.env.<projectId>`, an interactive `firebase deploy` asks for each param (press Enter to take
the default) and a non-interactive deploy (CI) fails. So create the file once per project:

```dotenv
OPENAI_MODEL=gpt-5.4-mini
OPENAI_REASONING_EFFORT=low
FUNCTIONS_REGION=us-central1
ASSISTANT_GLOBAL_DAILY_LIMIT=5000
MICROSOFT_CLIENT_ID=00000000-0000-0000-0000-000000000000
MICROSOFT_TENANT=common
```

The repository's `.gitignore` ignores `.env.*`, so these files stay on the machine that deploys.
They must never contain secrets. Changing the model is a param change plus a redeploy; no code change
is needed.

## Deploy

```bash
npm run deploy          # functions (predeploy: lint, contract check, build)
npm run deploy:rules    # firestore.rules + firestore.indexes.json
npx firebase deploy --only hosting   # public/delete-account.html -> https://<project>.web.app/delete-account
```

Before deploying hosting, replace `REPLACE_WITH_SUPPORT_EMAIL@example.com` in
`public/delete-account.html` with the real support address. The page has no form and no script: it
explains in-app deletion (Settings → Delete account) and offers a `mailto:` fallback. Use its URL as
the account-deletion link in Google Play Console.

## After a Firestore restore

A restore or import brings back the data of accounts deleted after the backup time. Right after
importing into `(default)`, run (with Application Default Credentials):

```bash
npm run build
node scripts/replay-account-deletions.mjs --project <project-id> --since <backup time, ISO 8601> --dry-run
node scripts/replay-account-deletions.mjs --project <project-id> --since <backup time, ISO 8601>
```

The whole procedure is in `../docs/DEPLOYMENT.md` §7.

## Local development with the emulators

```bash
npm run serve    # builds, then starts the auth, firestore and functions emulators (project demo-meetingguard)
```

- The assistant needs the OpenAI key in the emulator too. Put it in `functions/.secret.local`
  (git-ignored) as `OPENAI_API_KEY=...`. Without it, calls fail with `upstream_error`.
- App side (development builds only): `EXPO_PUBLIC_USE_EMULATORS=1`, plus `EXPO_PUBLIC_EMULATOR_HOST`
  (`10.0.2.2` for the Android emulator, or your computer's LAN IP for a physical device). For a
  physical device, add `"host": "0.0.0.0"` to the `auth`, `firestore` and `functions` emulator
  entries in `firebase.json` on your machine.
- Emulator UI: http://localhost:4000

## Tests and checks

```bash
npm run lint             # ESLint (typescript-eslint)
npm run typecheck        # tsc on sources and tests
npm run build            # tsc -> lib/
npm test                 # unit tests: quota, entitlement, time zones, context, prompt, tools, action mapping, handler (incl. stats hook), admin v1+v2, openaiKey (secret REST mocked), deleteAccount, maintenance, contract copy
npm run check:contract   # src/shared/aiContract.ts == ../src/core/aiContract.ts
npm run test:rules       # Firestore rules tests inside `firebase emulators:exec` (Java 21+)
```

CI (`.github/workflows/ci.yml`) runs all of them. The `functions` job runs everything except the rules
tests; the `firestore-rules` job runs the rules tests with Java 21.

## How the assistant works

1. **Auth and validation.** It requires Firebase Auth with a verified account (`email_verified`, or
   the `google.com` provider): throw-away email/password accounts created through the Auth REST API
   cannot use the paid assistant. It validates the request with `assistantRequestSchema` and an IANA
   time-zone check.
2. **Quota.** One Firestore transaction reads `entitlements/{uid}` (missing means free; expired or
   revoked means free) and increments `usage/{uid}/days/{yyyy-mm-dd}`.
   - The day is the **UTC** day, per the shared contract (`usageDayKey`). The client cannot reset its
     quota by sending another time zone.
   - Limits: free 5, pro 100, premium 500 requests per day.
   - An over-quota call fails with `resource-exhausted` and `details.usage`, and never reaches OpenAI.
   - A project-wide daily cap (`ASSISTANT_GLOBAL_DAILY_LIMIT`, sharded counter in
     `usage_global/{day}/shards/*`, checked with a one-minute per-instance cache) stops requests before
     OpenAI when reached.
   - Refunds: only failures before OpenAI did any work (context loading, a missing follow-up meeting,
     the global cap, configuration / connection errors, 429 and 5xx answers). Timeouts, bad requests
     and anything after a completion are billed by OpenAI and are not refunded.
3. **Meeting context.** It reads `users/{uid}/meetings` with `startAt` in [now − 7 d, now + 60 d]. It
   drops tombstones and keeps at most 200 meetings, closest to now first.
   - Loading is bounded: a field mask (only the fields below), a streamed query, documents over 64 KB
     skipped, and reading stops at 2 MB in total. Meeting documents are user-writable and the rules
     cannot bound every participant entry, so one user must never be able to exhaust the memory of an
     instance shared with other users (20 concurrent requests per 512 MiB instance).
   - Each meeting gets a short stable ref (`m` + 7 base32 characters of sha256(id)). Real ids never go
     to the model.
   - The model sees only: title, local start in the user's zone, weekday, duration, all-day, status,
     source, location type and address, conference provider and whether a link exists, and up to 10
     participants (email and name, so "the 4pm meeting with Alejandro" resolves).
   - It never sees links, passwords, notes or descriptions. The one exception is the description of
     the meeting in follow-up mode.
4. **Prompt.**
   - The developer message holds only server-generated rules: the current local time with its offset,
     the weekday, the time zone, a date table for "tomorrow" and "next Monday", and the reply language
     (EN/ES).
   - The meetings go in a separate user-role message as JSON between delimiters that carry a random
     per-request nonce (`<` and `>` are escaped). The model is told that this block is untrusted data.
5. **OpenAI call.**
   - It uses chat completions with 7 strict function tools: create, update, delete, share, bulk update,
     list, and suggest_replies.
   - Other settings: `max_completion_tokens` 3000, the configured `reasoning_effort`, `store: false`,
     and a hashed `safety_identifier`.
   - Timeouts: 45 s per attempt, one retry, and a 50 s hard deadline (the function timeout is 60 s).
6. **Mapping.**
   - The model gives local dates and times; the server resolves them to ISO-8601 with the zone offset,
     handling DST gaps and overlaps.
   - Refs that are not in the context are dropped. Invalid, empty and duplicate proposals are dropped.
   - Conference URLs and passcodes the user did not type are removed.
   - Email addresses the user did not type are accepted only when they already belong to the meeting
     the action targets (share, update) or, in follow-up mode, to the meeting that just ended
     (create). Addresses of other meetings in the context are never accepted: an attacker who is a
     participant of their own invitation cannot get a meeting (with its link and password) or an
     invitation routed to them through injected text.
   - Messages the user sent by tapping a suggestion chip (`origin: 'suggestion'`) are model-written
     and never count as typed.
   - When the model returns a participant without a name, the stored name for that address is kept.
   - Every action is validated with `aiActionSchema`; there are at most 10 actions and 5 suggestions.
7. **Errors.** Errors are `HttpsError` with `details: { reason, usage }`, where `reason` is
   `quota_exceeded`, `unauthenticated`, `invalid_request` or `upstream_error`.

**Logs** contain the uid and counts only: the number of meetings, tool calls, actions and dropped
proposals, token usage, and latency. They never contain messages, titles, emails or model output.

## Granting a plan manually

Billing is not wired yet. `entitlements/{uid}` is written only with admin rights, for example from the
Firebase console:

```json
{ "plan": "pro", "status": "active", "expiresAt": null, "source": "manual", "updatedAt": "2026-10-01T00:00:00.000Z" }
```

Clients can read their own entitlement and usage documents but can never write them (`firestore.rules`).

## deleteAccount

Requires a recent sign-in (`auth_time` within 5 minutes, like Firebase's own `deleteUser`). The app
re-authenticates the user (Google account picker, or the password) right before calling it; an old
session gets `failed-precondition` with `details.reason: 'requires_recent_login'`.

## App Check

`enforceAppCheck` is `false` on both callables. The Firebase JS SDK used by the app has no device
attestation provider on React Native, so enforcing it would reject every call. To enable it:

1. Add `@react-native-firebase/app-check` (Play Integrity / App Attest) to the app.
2. Register both apps in Firebase App Check.
3. Set `enforceAppCheck: true` in `src/assistant/index.ts` and `src/deleteAccount.ts`.
4. Redeploy.

## Troubleshooting

- **`upstream_error` with `kind: configuration` in the logs.** The key is wrong or revoked, or the
  model is not available to it. Check the secret and `OPENAI_MODEL`.
- **`FAILED_PRECONDITION` / index errors.** They should not happen, because every query uses the
  single-field `startAt` range. If one does, add the index that the error message links to in
  `../firestore.indexes.json`.
- **Unit tests and `jose`.** firebase-admin pulls in `jose` 6, which is ESM-only. Node 22 loads it
  natively, but Jest 29 cannot, so `jest.config.js` maps it to `test/stubs/jose.js`. The unit tests
  never verify JWTs.
