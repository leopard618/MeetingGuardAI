# Connect Fathom

Francisco's request (Nov 17 2026): make "Connect Fathom" the main way to receive meeting summaries,
with account authorization and automatic imports, and keep the email setup as the alternative for
Otter and other notetakers.

## 1. What the user sees

- Meeting summaries (sidebar) opens the connect screen. When the server offers Connect Fathom, the
  first card is **Connect Fathom** (Recommended): one button, Fathom's sign-in opens in an in-app
  browser, the user approves, the browser closes and the card says **Fathom is connected**.
- From then on, after each meeting Fathom records, the summary and action items arrive on their own
  and go through the same matching as email summaries: filed under the right meeting when the match
  is clear, otherwise waiting in the summary inbox. Suggested tasks (M11) work the same way.
- **Other notetakers (email)** sits below as one row that opens the existing email setup.
  It is open by default when Fathom is not offered, when a Gmail code waits, and for someone who
  already receives summaries by email without Fathom.
- The screen keeps only what the user acts on: the Fathom card, the email row, one **Summary
  inbox** row (last summary and what waits), refusals only when there are any, and Stop receiving
  summaries. The explanations (what Meeting Guard AI does, what we read from Fathom, what we
  check, privacy, how long we keep summaries) open from the **question mark** in the header, next
  to the language menu. The summary inbox has a **gear** there that opens this screen.
- **Disconnect Fathom** (after a confirmation) removes the webhook in Fathom and the connection.
  "Stop receiving summaries" also disconnects Fathom first.
- Fathom writes its summaries in English (its API says so); the help sheet says it.

## 2. Flow

1. App: `fathomConnect {op: 'start'}`. The server checks the caller (verified, SUMMARIES_ENABLED,
   pilot list), makes sure the private summary address exists (`createAddress`, idempotent: every
   stored summary is bound to the address and the commit re-checks it), writes one single-use state
   (10 minutes) and answers the Fathom authorize URL.
2. App: `expo-web-browser openAuthSessionAsync(authorizeUrl, 'meetingguardai://fathom')`.
3. Fathom redirects to `fathomOAuth?code&state`. The server consumes the state (single use),
   exchanges the code, creates a webhook for the user's own recordings (`my_recordings`, summary and
   action items, no transcript) with a new per-user URL `fathomWebhook?k=<token>`, seals the tokens
   and the webhook's signing secret, and redirects to `meetingguardai://fathom?result=connected`
   (or `cancelled`, or `error&reason=...`).
4. Fathom posts each finished meeting to `fathomWebhook?k=...`. The server finds the user by the
   token, verifies the signature with that webhook's secret, builds the recap text and runs the
   email pipeline from parsing on (sections, matching, sealing, commit).

## 3. Fathom facts used (checked Nov 17 2026)

Sources: developers.fathom.ai (oauth, webhooks, FAQ, openapi.yaml) and the official
fathom-typescript SDK 0.0.43.

- Authorize: `https://fathom.video/external/v1/oauth2/authorize` with `client_id`, `redirect_uri`,
  `scope=public_api` (the only scope), `state`, `response_type=code`.
- Token: `POST https://api.fathom.ai/external/v1/oauth2/token`, form-encoded, client credentials in
  the body. Refresh tokens are single use and rotate.
- REST: `https://api.fathom.ai/external/v1`, `Authorization: Bearer`. `POST /webhooks`,
  `DELETE /webhooks/{id}`. The create answer carries the webhook's `secret` (`whsec_...`); the id
  cannot be read back later, so it is stored.
- Signatures: `webhook-id`, `webhook-timestamp`, `webhook-signature: v1,<base64>`; HMAC-SHA256 over
  `id.timestamp.rawBody` with the base64-decoded secret after `whsec_`; 5 minute window.
- The payload does not say whose webhook it is: one URL per user.
- API access (keys, webhooks) is on all Fathom plans.
- Not stated by Fathom, so checked in the first real test: whether an OAuth token may create
  webhooks (the API lists Bearer auth for it). If it may not, the fallback is polling each user's
  new recordings on a schedule.

## 4. Data (server only; firestore.rules gives clients nothing)

- `fathomOAuthStates/{sha256(state)}`: `{uid, createdAt, expiresAt}`, deleted when used.
- `fathomHooks/{sha256(token)}`: `{uid, createdAt}`.
- `fathomConnections/{uid}`: `{schemaVersion, hookHash, webhookId, sealedSecrets, connectedAt,
  updatedAt, lastEventAt, refreshLeaseUntil}`. `sealedSecrets` is one AES-256-GCM blob under
  SUMMARIES_DATA_KEY (purpose `fathomConnection:secrets`, AAD `fathomConnection:<uid>`): access
  token, its expiry, refresh token, webhook secret.
- Summaries are the normal `users/{uid}/meetingSummaries/{id}` documents, stored as decision row 7
  (vendor_verified, recipient bound: a signed delivery to the user's own webhook), with
  `source: 'fathom_api'`, sender `no-reply@fathom.video`, message key `fathom:rec:<recording_id>`
  (a redelivery is a duplicate).
- Account deletion and "Stop receiving summaries" delete the connection and hook documents. Only
  `fathomConnect disconnect` can reach Fathom (it holds the client secret); a webhook left in Fathom
  then posts to a hook that maps to nobody and is answered 200 and ignored.

## 5. Webhook answers

404 switched off, 405 not POST, 413 over 5 MiB, 200 ignored for an unknown hook / no content /
bad JSON, 401 bad signature, 200 dropped (pilot, Auth, no address), 200 stored, 500 on a Firestore
failure (Fathom retries). One `summaries.fathom_webhook` log line per request: codes and counts only.

## 6. Functions and setup

All three exist only while `SUMMARIES_ENABLED=true` AND `FATHOM_CLIENT_ID` is set in
`functions/.env.<projectId>` at deploy time. `FATHOM_CLIENT_SECRET` is declared only then.

| Function | Kind | Secrets |
| --- | --- | --- |
| `fathomConnect` | callable (status, start, disconnect) | FATHOM_CLIENT_SECRET, SUMMARIES_DATA_KEY |
| `fathomOAuth` | HTTPS GET, public (the redirect URI) | FATHOM_CLIENT_SECRET, SUMMARIES_DATA_KEY |
| `fathomWebhook` | HTTPS POST, public (signature checked) | SUMMARIES_DATA_KEY |

They run as SUMMARIES_SERVICE_ACCOUNT, like summaryInbound.

Setup, in this order:

1. Register an OAuth app at https://fathom.video/marketplace_applications/new with the redirect URI
   `https://us-central1-meetingguard-ai-app.cloudfunctions.net/fathomOAuth`. Development: any
   Fathom account. Production: a Fathom account on a company email (whoever owns the app holds its
   secret and redirect URLs).
2. `npx firebase functions:secrets:set FATHOM_CLIENT_SECRET` (paste the client secret at the
   prompt; never in chat or the repo).
3. Add `FATHOM_CLIENT_ID=<client id>` to `functions/.env.meetingguard-ai-app`.
4. Deploy by name: `npx firebase deploy --only functions:fathomConnect,functions:fathomOAuth,functions:fathomWebhook`.
   Also redeploy `summaryAction` (disconnect also drops the Fathom connection). Answer No to any
   deletion prompt.
5. After the PR is merged into v2: deploy firestore.rules from v2 (explicit server-only blocks; the
   catch-all already denies these collections).

## 7. App

- `src/services/summaries/fathom.ts`: the callable, the auth session, `parseFathomReturn`.
- `src/services/summaries/useFathomConnection.ts`: status on mount, connect, disconnect.
- `src/screens/summaries/FathomConnectCard.tsx` and the connect screen layout.
- `src/screens/summaries/SummaryHelpSheet.tsx`: the help sheet. Header buttons come from a
  screen's `headerRight` option (`navigation.setOptions`), drawn by `CustomHeader` as
  `HeaderIconButton`s left of the language menu.
- Copy: `summaries:fathom.*`, `summaries:connect.email.*` and `summaries:help.*` in en, es, fr,
  de, pt.
- `expo-web-browser` and the `meetingguardai` scheme are already in the app: no native change.

## 8. Later

- Backfill the last few days of recordings on connect (`GET /meetings`).
- The same pattern for other notetakers with an API (Fireflies, tl;dv, Read.ai), after checking
  their docs. Otter stays on email (no public API outside its business plans, to be confirmed).
