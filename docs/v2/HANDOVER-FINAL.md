# Meeting Guard AI: handover at the final acceptance

For: Francisco and whoever runs Meeting Guard AI after the agreed scope (M1 to M14) is accepted.
It replaces `docs/v1/HANDOFF.md` as the starting point. No secret values are in this file or in
the repository: they live in Google Secret Manager and in the consoles listed below.

## 1. What is where

| Part | Where | Notes |
|---|---|---|
| App (Android, iPhone) | This repository, `src/` (Expo, React Native) | Built with EAS; store listings in Play Console and App Store Connect |
| Server | `functions/src` (Firebase Cloud Functions, Node 22, region us-central1) | One codebase; each feature behind a parameter |
| Database rules | `firestore.rules`, tested in `functions/test/rules` (CI) | Deployed only from `v2` |
| Admin dashboard | `public/admin` (Firebase Hosting) | Sign-in with the admin or viewer claim |
| Guest page | `public/g` (Firebase Hosting, `/g`) | M14 reply links |
| Website and web agenda | meetingguard.ai, Sven's repository | Same Firebase project and records |
| Branches | `main` production, `v2` staging, `dev_dusko` and `dev_sven` work | Changes reach `v2` by pull request (CONTRIBUTING.md) |

Architecture: `docs/v1/ARCHITECTURE.md` (sections per feature), the milestone designs in
`docs/v2` (M10-DESIGN.md, M11-DESIGN.md, M12-LANGUAGES.md, WhatsApp-Templates-2026-11-12.md),
and the release runbooks (`RELEASE-1.6.0.md`, `RELEASE-1.7.0.md`, `RELEASE-1.7.0-LANGUAGES.md`).

## 2. Accounts and consoles

| Service | What it does | Owner account |
|---|---|---|
| Firebase / Google Cloud (meetingguard-ai-app) | Sign-in, database, functions, hosting, secrets, logs | Aeternum Tech |
| Google Cloud OAuth | Google sign-in, Calendar and Tasks (verified Nov 11, 2026) | Aeternum Tech |
| Microsoft Entra | Microsoft sign-in, Outlook, To Do | Aeternum Tech |
| Meta Business (WhatsApp Business account) | The bot number, the message templates | Francisco's portfolio |
| Apple App Store Connect | iPhone app, subscriptions, TestFlight | Aeternum Tech |
| Google Play Console | Android app, subscriptions | Aeternum Tech |
| RevenueCat | Subscriptions for both stores | Aeternum Tech |
| OpenAI | The AI assistant, debriefs, summaries suggestions, voice note transcription | Aeternum Tech |
| Postmark | Summary emails (inbound), assistant mail | Aeternum Tech |
| Fathom | Connect Fathom (production app) | The company Fathom account |
| Zoom | Zoom links | Aeternum Tech |
| Expo (EAS) | Builds and over-the-air updates | Aeternum Tech |
| Sentry | Crash reports | Aeternum Tech |

## 3. Parameters and secrets (names only)

Plain parameters live in `functions/.env.meetingguard-ai-app` (not in the repository); secrets in
Secret Manager. Each feature switch is a parameter, so a feature can be turned off without a code
change (then redeploy the named functions).

- Switches: `WHATSAPP_ENABLED`, `WHATSAPP_TEMPLATES_MODE` (off, preview, live), `SUMMARIES_ENABLED`,
  `ZOOM_ENABLED`, `MATTERS_ENABLED`, `REVENUECAT_RECONCILE_ENABLED`.
- Lists and limits: `SUMMARIES_PILOT_UIDS`, `SUMMARIES_SENDERS`, `MATTERS_ALLOWED_UIDS`,
  `ASSISTANT_GLOBAL_DAILY_LIMIT`, `WHATSAPP_USER_DAILY_LIMIT`, `ZOOM_USER_DAILY_LIMIT`.
- Identifiers (not secret): `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_DISPLAY_NUMBER`, `WHATSAPP_WABA_ID`,
  `MICROSOFT_CLIENT_ID`, `MICROSOFT_TENANT`, `FATHOM_CLIENT_ID`, `OPENAI_MODEL`.
- Secrets: `OPENAI_API_KEY` (rotated from the admin dashboard), `WHATSAPP_ACCESS_TOKEN`,
  `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `SUMMARIES_DATA_KEY`, `SUMMARIES_WEBHOOK_AUTH`,
  `FATHOM_CLIENT_SECRET`, `REVENUECAT_SECRET_KEY`, `REVENUECAT_WEBHOOK_AUTH`, `ZOOM_*`, `MATTERS_*`.

## 4. How to release

1. Work on a branch, open a pull request into `v2`, wait for CI, merge.
2. Server: deploy only the changed functions by name (never a full deploy); rules and hosting
   only from `v2`. Answer No when the CLI offers to delete a function.
3. App: JavaScript-only fixes go out as an over-the-air update to the same runtime version; a
   change of native configuration (permissions, languages, modules) needs a store build.
4. `main` follows `v2` at each store release.

## 5. Running it

- Daily: the admin dashboard Overview (users, AI usage), WhatsApp (sends and templates) and Alerts
  health (phones with notifications or exact alarms off).
- Logs: `npx firebase functions:log` from `functions/`. Logs never contain message text, phone
  numbers or summary text.
- Retention runs by itself every night (`dailyMaintenance`).
- Abuse of a guest link: the owner turns it off on the meeting; the limits per address and per
  link are in `functions/src/guests/core.ts` (`GUEST_TUNING`).
- A WhatsApp template moved to Marketing by Meta: it stops by itself; the WhatsApp tab shows it.
  Submit a corrected version with a new name.
- A key to rotate: OpenAI from the admin dashboard; the others in Secret Manager, then redeploy
  the functions that bind it (the runbooks name them).

## 6. Known limits at handover

- Notifications are scheduled on the phone. A guest's answer, a WhatsApp reply or a summary reaches
  a closed app when it opens next; server push comes with the assistant (A8).
- WhatsApp templates are in English and Spanish; users in Portuguese, French and German get the
  English templates and the in-chat texts in their language.
- Guest proposals are for one-off meetings; a series takes accept and decline.
- Hindi and Mandarin: see the two verdict forms (`M12-VERDICT-HINDI.md`, `M12-VERDICT-MANDARIN.md`).

## 7. After the acceptance

- 60 days of bug fixes from the date of the final acceptance (Complete-Plan-2026-11-10.md).
- The AI executive assistant (matters) continues as its own milestones A1 to A10, with Sven's
  parts reviewed and merged through `v2`, and its own acceptance.
