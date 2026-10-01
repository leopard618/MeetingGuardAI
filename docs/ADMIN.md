# Admin dashboard

A small operations dashboard for MeetingGuard AI: user list, disable/enable, manual plan grants
and basic usage metrics. It is an internal tool, so the UI is English only.

- Web app: `public/admin/` (build-free: plain ES modules + Firebase JS SDK from the gstatic CDN),
  served by Firebase Hosting at `https://<project-id>.web.app/admin/`.
- Backend: four callables in `functions/src/admin/` (`adminListUsers`, `adminSetUserDisabled`,
  `adminSetUserPlan`, `adminGetMetrics`; contract in `functions/src/admin/schemas.ts`,
  design in docs/ARCHITECTURE.md §21).
- Access: every callable requires the caller's ID token to carry the custom claim `admin: true`.
  The page only decides what to *show*; enforcement is entirely server-side. `firestore.rules`
  is unchanged — the callables use the Admin SDK, and `entitlements/{uid}` / `usage/{uid}/days`
  stay unwritable for clients.

## One-time setup

1. **Deploy the backend** (owner-run; from the repo root):

   ```sh
   firebase deploy --only functions
   firebase deploy --only firestore:indexes   # adds the days.updatedAt collection-group index
   firebase deploy --only hosting             # publishes public/, including /admin
   ```

   The metrics callable needs the `days.updatedAt` collection-group index from
   `firestore.indexes.json`; until the index has finished building, `adminGetMetrics` fails with
   a Firestore precondition error — just retry later.

2. **Grant the admin claim** (from `functions/`, with Application Default Credentials that may
   manage the project's users — `gcloud auth application-default login`):

   ```sh
   node scripts/set-admin-claim.mjs you@example.com --project <project-id>
   node scripts/set-admin-claim.mjs <uid-or-email> --remove --project <project-id>   # revoke
   ```

   Claims travel inside the ID token. The dashboard force-refreshes the token once after
   sign-in, so a freshly granted claim works after a sign-out/sign-in on the page; open mobile
   sessions of that user pick claims up within an hour.

3. **Open** `https://<project-id>.web.app/admin/` and sign in with the Google account you granted
   the claim to. Any other account sees a "Not an administrator" block screen.

4. **Verify the CSP override once** (the root Hosting CSP is `default-src 'none'`, which would
   block the app; `firebase.json` adds a scoped `/admin` + `/admin/**` header entry that must win
   for the page to work):

   ```sh
   curl -sI https://<project-id>.web.app/admin/ | grep -i content-security-policy
   ```

   The value must contain `script-src 'self' https://www.gstatic.com`. If it still shows the
   root `default-src 'none'` policy alone, the header entries in `firebase.json` are in the
   wrong order (the `/admin` entries must come after the catch-all `**`).

   The `connect-src` / `frame-src` sources are PINNED to this project's hosts
   (`https://us-central1-meetingguard-ai-app.cloudfunctions.net`,
   `https://meetingguard-ai-app.firebaseapp.com`) instead of the multi-tenant wildcards
   `*.cloudfunctions.net` / `*.run.app` / `*.web.app` (any GCP customer's service matches those,
   which would let an injected script exfiltrate the admin's ID token). If the callable region
   or the project id ever changes, update these two hosts in `firebase.json` together with
   `FUNCTIONS_REGION` / `config.js`.

## Operations

- **Users**: paged table (50 per page, "Load more" fetches the next Firebase Auth page). The
  search box filters the pages loaded so far by email, name or uid — it does not search the
  whole user base.
  - **Plan** column shows the *effective* plan (an expired or revoked entitlement shows `free`,
    with the raw status next to it) plus the source (`revenuecat`, `admin`, …) and expiry.
  - **AI today** is the user's assistant-request count for the current UTC day.
- **Disable / Enable**: disabling a user also revokes their refresh tokens, so open sessions die
  when their current ID token expires (up to one hour). You cannot disable your own account.
- **Set plan**: pick free/pro/premium and an optional expiry date (interpreted as *end of that
  day, UTC*; empty = no expiry), then Apply. This writes `entitlements/{uid}` with
  `source: 'admin'` and status `active` — also for `free`, so an explicit downgrade overrides a
  stale paid document. Note: a later RevenueCat webhook event for the same user overwrites an
  admin grant (last writer wins by design).
- **Metrics**: total Auth users, effective plan counts, and assistant requests today / last
  7 UTC days (sum of the per-user daily counters, keyed on the counters' `updatedAt`).

## v2 (in progress — architecture + build spec)

Goal: a modern, token-driven dashboard with usage statistics (charts) and OpenAI key
management. Contracts are frozen in `functions/src/admin/schemas.ts` (zod is the spec); this
section is the page/runtime spec the two implementers build against. Zero file overlap:
**functions-engineer** owns `functions/**`; **web-engineer** owns `public/admin/**`.

### New callables (contracts in `functions/src/admin/schemas.ts`)

| Callable | Request | Response (summary) |
|---|---|---|
| `adminGetStats` | `{ days: 7\|14\|30\|90 }` | zero-filled per-UTC-day series `days[{date,requests,inputTokens,outputTokens}]` + `signups[{date,count}]` + `totals` + `estCostUsd` (null when pricing unset) + `pricing {inPerM,outPerM,source:'param'}` |
| `adminGetHealth` | `{ ping?: boolean }` | `model`, `reasoningEffort`, `globalDailyLimit`, `secretRuntime {mode:'rest'\|'env-fallback', version, lastRotatedAt, iamReady}`, `assistantPing {ok,latencyMs,error?}` only when `ping:true` (a REAL minimal OpenAI call — costs money; only the Settings "Test assistant" button sends it) |
| `adminRotateOpenAiKey` | `{ newKey }` (trimmed, 20–512 chars) | `{ ok:true, version, modelAvailable }` — never echoes the key |

The four v1 callables are unchanged. All seven require the `admin: true` claim.

### Stats pipeline

- The assistant handler, after a successful OpenAI completion, merge-sets
  `adminStats/ai/days/{yyyy-mm-dd}` (UTC day = `usageDayKey`, same key as the quota) with
  `FieldValue.increment` transforms: `{requests:+1, inputTokens:+p, outputTokens:+c, updatedAt}`.
  One awaited write inside its own try/catch — a stats failure logs a warning and never fails
  the user request. Decisions: only completions are counted (billed work; matches the quota sum
  within refunds); `uniqueUsers` and `byModel` are **skipped** in v2 (no cheap atomic source for
  the former; the latter adds nothing while pricing is a flat param pair).
- Signups are derived inside `adminGetStats` from Auth `listUsers` `creationTime` paging —
  no new writes.
- `firestore.rules` denies `adminStats/**` to all clients explicitly (server/Admin SDK only).
- Cost estimate: params `OPENAI_PRICE_IN_PER_M` / `OPENAI_PRICE_OUT_PER_M` (USD per 1M tokens,
  default `"0"` = hidden; `functions/src/config.ts`).

### OpenAI key runtime + rotation (security bar)

- `functions/src/openaiKey.ts` (module contract in the file): the assistant fetches secret
  version `latest` via Secret Manager REST (google-auth-library default credentials,
  cloud-platform scope — a firebase-admin dependency, nothing new), caches per instance with a
  5-minute TTL, falls back to the env-bound `OPENAI_API_KEY.value()` when REST fails (missing
  IAM grant, emulator, tests), and exposes `status()` for `adminGetHealth`. On an OpenAI 401
  the wrapped client invalidates, refetches once and retries once (`withKeyRetry`).
- Rotation (`adminRotateOpenAiKey`): validate the candidate against `GET api.openai.com/v1/models`
  (non-200 → `failed-precondition`; configured model missing → `modelAvailable:false`,
  warn-not-block) → Secret Manager `addVersion` → disable all prior enabled versions → invalidate
  the local cache. The key value never appears in logs, errors, Firestore, responses or the DOM
  longer than needed.
- IAM (owner-run once, see `functions/README.md` "OpenAI key rotation"): grant the runtime SA
  `secretAccessor` + `secretVersionManager` on the one secret. Until then `adminGetHealth`
  reports `iamReady:false` + `mode:'env-fallback'` and the Settings page shows the exact command.

### UI v2 (`public/admin/` — build-free, CSP unchanged, charts = hand-rolled inline SVG)

- **Theme**: dark-only (decision — ops tool; drops the dual-scheme CSS). Adopt the app tokens as
  CSS custom properties in `admin.css` with a comment pointing at `src/theme/tokens.ts`
  (`darkColors` + `chartPalette.dark`): bg `#0C1320`, surface `#131C2B`, surface-2 `#18202F`,
  surface-3 `#202B40`, text `#E7EDF6`, muted `#9AA8BE`, primary `#AFB4FF` (on-primary `#101273`),
  border `#27324A`, outline `#5E6F8D`, danger `#FF9F9F`/`#7C2222`, ok `#6CD9A0`/`#14543A`,
  warn `#F5B950`/`#6B3F05`, info `#79C0F7`, `--chart-1…6: #8F94F3 #3ECFBE #F0A64B #F383AE
  #5BB7F5 #93A3B8`. Radii 8/12/16, 4pt spacing grid, max-width 1100, sticky header, cards grid,
  visible focus states (2px primary outline), system font stack.
- **Navigation**: top tabs under the header — **Overview / Users / AI usage / Settings**
  (buttons with `aria-selected`, hash-routed `#overview` etc. so refresh keeps the tab; decision:
  tabs over sidebar — better at narrow widths, smaller diff).
- **Overview**: existing six metric tiles + 14-day requests area chart (`adminGetStats {days:14}`,
  `--chart-1`) + signups bar chart (`--chart-5`).
- **Users**: the existing table, functionality 1:1 (search, load more, plan editor, disable).
- **AI usage**: range switch 7/30/90 → `adminGetStats`; requests line (`--chart-1`); tokens
  stacked bars (input `--chart-2`, output `--chart-1`, legend labels "Input"/"Output"); totals
  top-line; est. cost tile only when `estCostUsd !== null`.
- **Settings**: health card (model, reasoning effort, global daily limit, secret mode/version/
  lastRotatedAt; `iamReady:false` state shows the grant command in a `<code>` block) · "Test
  assistant" button → `adminGetHealth {ping:true}` with latency/result states · "Rotate OpenAI
  key" card: `<input type="password" autocomplete="off">` + paste-only hint, `confirm()` dialog
  naming the irreversible effect, result states (success shows version + a warning when
  `modelAvailable` is false), input cleared in `finally`, value never logged/stored.
- **Charts**: `public/admin/chart.js` (spec header in the file): `renderLineChart` /
  `renderBarChart`, nice-tick y auto-scale, thinned date labels, `<title>` tooltips + `.sr-only`
  table fallback, colors from CSS vars, empty-state text, ~200-line budget, no deps.

### Rollout (owner-run, after both implementers + integrator land)

`firebase deploy --only functions` → the IAM grant (README) → `firebase deploy --only
firestore:rules` → `firebase deploy --only hosting`. Charts show real data from the first
post-deploy assistant request onward (history before the deploy has no aggregates — expected).

## Local development

- `firebase emulators:start --only hosting` then open `http://localhost:5000/admin/` —
  `localhost` is an authorized OAuth domain by default, and the reserved
  `/__/firebase/init.json` config URL works, so sign-in runs against the *live* project.
- Opening `public/admin/index.html` via `file://` does **not** work for real use: the reserved
  config URL and absolute asset paths are missing and `file://` is not an authorized sign-in
  domain. For layout work outside Hosting you can drop a `public/admin/config.js` with
  `export const firebaseConfig = { … }` (the standard web config; it is not a secret) and
  optionally `export const region = 'us-central1'`, and serve the folder over HTTP. The file is
  optional and nothing references it in production.
- The callable region defaults to `us-central1` and must match `FUNCTIONS_REGION`
  (`functions/src/config.ts`); override it via `config.js` if the project ever moves regions.
