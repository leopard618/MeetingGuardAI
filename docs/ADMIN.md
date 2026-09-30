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
