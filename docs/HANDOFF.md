# Handoff: MeetingGuard AI v1.1.0 (stabilization)

This is the starting point for the developer who owns the repository. It covers:

- what changed in the stabilization pass
- what is still open, and who must do it
- which decisions the client must make

State at the time of writing (2026-09-28):

- Branch `stabilization`, version 1.1.0, not released.
- Every automated check passes.
- **Nothing has been run on a real device.**
- Google Play still serves v1.0.9 (versionCode 20).

---

## 0. Where the code is

- `stabilization` has 45 commits on top of `main` (`3308b9d`) at the time of writing
  (`git log --oneline main..stabilization` lists them). **Nothing is pushed.**
- The commits are in a **separate git directory**,
  `C:/Users/Leopard/git-data/MeetingGuardAI-work/.git`, with the work tree
  `D:/WorkSpace/MeetingGuard_2025.7.28/Codebase`. git.exe could not write to the `.git` folder on D:
  in the working environment. So the `.git` on D: still points at `main`, and `git status` there shows
  all of this work as uncommitted changes.
- To see the history:

  ```bash
  git --git-dir=C:/Users/Leopard/git-data/MeetingGuardAI-work/.git --work-tree="D:/WorkSpace/MeetingGuard_2025.7.28/Codebase" log --oneline
  ```

- To bring the branch into the main repository, run this from `D:/WorkSpace/MeetingGuard_2025.7.28/Codebase`:

  ```bash
  git fetch C:/Users/Leopard/git-data/MeetingGuardAI-work/.git stabilization:stabilization
  ```

  Before you switch branches in that folder, check that nothing else changed there, because
  `git checkout -f` discards local changes. `git diff --stat stabilization` does **not** work for
  this: that folder's index is `main`, so every file that is new on `stabilization` is untracked
  there and shows as deleted. Stage everything and compare the staged tree instead:

  ```bash
  git add -A
  git diff --cached --stat stabilization   # must print nothing: the folder equals the branch
  ```

  If it prints files, those are real local changes: keep them first (`git stash push -u`, then review
  the stash). When it is empty, run `git checkout -f stabilization`.
- **Push only after the history clean-up** in `docs/SETUP.md` §1.2. The old history contains secrets,
  and this branch is built on it.

---

## 1. What was changed

### Stage 1: platform and safety (`6f2e758` ... `578df16`)

- **Repository hygiene:**
  - Fixed `.gitignore` / `.easignore` (they ignored `*.md` and test files, and uploaded `reference/`).
  - Removed debug screens, the fake API Keys screen, the "Delete the ADSF meeting" chip (it deleted
    a meeting without asking), 103 unreachable modules and 35 unused packages.
- **Config:** one Expo config (`app.config.js`), no committed `android/`, and remote version codes
  on EAS.
- **Platform:** upgraded from Expo SDK 52 to **SDK 57** (React Native 0.86.3, React 19.2.3, New
  Architecture, target API 36). This is required for any Play update.
- **Secrets:** no secrets in the client any more. The OpenAI key, the Google client secret and all
  `@env` values were removed. A typed, validated `src/config/env.ts`, and an "App not configured"
  screen instead of a crash.
- **Tooling:** TypeScript (strict), ESLint 9, Jest + React Native Testing Library, GitHub Actions CI
  with a bundle secret scan, and Sentry.
- **Payments:** removed `react-native-iap` and the Stripe payment links. Pricing shows "coming
  soon".

### Stage 2: core rebuild (`8feed26` ... `8e1830f`)

- **Contracts:** typed contracts and domain model in `src/core` (see `docs/ARCHITECTURE.md`).
- **Data:** an offline-first Firestore data layer with a local cache and a write queue (outbox),
  conflict rules, and a one-time import of v1.0.9 local data.
- **Auth:**
  - Native Google Sign-In -> Firebase Auth, and a session manager (start and end of a session, a
    wipe on sign-out).
  - Account deletion, in the app and as a web page.
- **Calendars:** two-way Google Calendar sync on the device (incremental `calendar.events` scope, real
  Meet links), plus phone calendar import and export.
- **Alerts:**
  - OS notifications scheduled on the device, with Android channels per intensity and the exact-alarm
    permission.
  - In-app MAX / MEDIUM / LIGHT alerts with sound, voice and vibration.
  - Snooze buttons, the post-meeting follow-up, and background refresh.
- **Language and navigation:** i18next EN/ES with instant switching and locale formats; a gated
  navigator (Auth / Onboarding / Main) and 5-step onboarding.
- **AI:** the assistant runs in the `assistant` Cloud Function. It has server-side OpenAI, daily
  quotas per plan, a spend cap, and prompt-injection defences. Every action needs a confirmation card.
- **Backend:** `deleteAccount` callable, Firestore security rules with emulator tests, and CI jobs.
- **Screens:** new TypeScript screens for meeting details, the meeting form, Settings and alert
  settings. A security and reliability review of all of the above.

### Stage 3: screens, clean-up, OTA (`13613ff` ... `90a0cc8`)

- Every remaining screen was rewritten in strict TypeScript: Dashboard, AI insights, meetings list,
  calendar, creation chooser, notes, attachments, assistant chat, calendar sync, landing, legal,
  pricing and the app shell.
- **No JavaScript is left in `src/`.** All compatibility layers are removed, and so are about 600
  translation keys that only the old screens used.
- New guard tests for translation keys and route titles.
- OTA updates with EAS Update: channels per build profile, `runtimeVersion` from `version`, and
  Sentry events tagged with the running update (the bad-OTA signal). The runbook is
  `docs/DEPLOYMENT.md`.

### Stage 4: documentation (this commit)

- New: `README.md`, `docs/SETUP.md`, `docs/DEPLOYMENT.md`, `docs/TESTING.md`, this file and
  `CHANGELOG.md`.
- `docs/ARCHITECTURE.md` now describes only the final code.

### Review fixes (after the documentation commit)

- **Screens:** keyboard-aware forms, "Discard changes?" on Back (meeting form, alert settings),
  attachment removals applied on Save only, themed multi-line toasts, one header per screen,
  per-screen error boundaries, load failures shown with Retry instead of empty states, focus-aware
  clocks, a Time format setting next to Language, honest MAX-alert and Google Meet texts.
- **Assistant:** unknown or invalid proposed actions are dropped instead of failing the whole reply
  (forward compatibility with newer servers); a safe sequential confirm loop.
- **Backend:** `dailyMaintenance` (tombstone purge after 60 days, deletion-log pruning) and the
  account deletion log with a restore replay script; backups disclosed in the privacy texts.
- **Release:** a hard OAuth-verification gate before production, v1.0.9 fixture phones for T12,
  corrected OTA monitoring (bad-update signal = Sentry crashes by `expo.updates.update_id`), a fuller
  data safety list, a 1-2 page release / rollback summary, zero-warning lint in CI, a fail-closed
  secret scan, Android data extraction rules (no device-to-device transfer), iPhone-only iOS.

### Milestone 5 status

| Milestone 5 item | Status |
|---|---|
| Production hosting, SSL, secure env | Ready to deploy on Firebase (HTTPS only; the OpenAI key in Secret Manager; only public values in the app). Not deployed yet: it needs the client's project access. |
| Monitoring (errors, health) | Sentry is wired in; it needs `EXPO_PUBLIC_SENTRY_DSN`. The Cloud Monitoring and budget alerts are described in `docs/DEPLOYMENT.md` §8. There is no separate health endpoint (the backend is two callables). |
| Backups | Commands are ready (`docs/DEPLOYMENT.md` §7); they must be turned on in the project. |
| QA: calendars, alerts, EN/ES | Automated: 96 app suites (926 tests), 11 function suites (90 tests), and the rules tests. The device plan is written (`docs/TESTING.md` Part B) but **not run**. Outlook is not built. |
| Test builds: Play internal testing, TestFlight | Android: ready once `docs/SETUP.md` is done. iOS: blocked (Apple account, Sign in with Apple). |
| Deployment and rollback notes | `docs/DEPLOYMENT.md`, "Release and rollback in brief" (the 1-2 page summary at the top); the numbered sections are the full runbook. |

---

## 2. What YOU must do next

Do these in order. **You** = the developer, **Client** = the product owner.

| # | Task | Owner | Details |
|---|---|---|---|
| 1 | Get access: Firebase / Google Cloud (Owner), the Expo organization of the project, Play Console (Admin), OpenAI, Render, Supabase, Stripe, GitHub, and Apple if iOS is planned. | Client gives, you check | `docs/SETUP.md` intro |
| 2 | Prepare one or two **v1.0.9 fixture phones** for the upgrade test T12 **before** step 3: install v1.0.9 from Google Play, sign in, create the meetings, notes and settings of T12 row 1. Turn off auto-update for the app in the Play Store, keep the phones, and do not update them. After step 3, v1.0.9 can no longer sign in. | You | `docs/TESTING.md` T12 |
| 3 | Rotate every leaked secret and lock down the old Render backend. | You. The client accepts that v1.0.9 AI chat and login break. | `docs/SETUP.md` §1.1, §1.3 |
| 4 | Clean the git history, then push `stabilization`. | You | `docs/SETUP.md` §1.2, §0 above |
| 5 | Firebase project, OAuth clients (web, Android x2, iOS), consent screen, Calendar API. | You | `docs/SETUP.md` §3-4 |
| 6 | Provide the legal entity, jurisdiction, support email and a domain. Have a lawyer review the texts. | Client | §3 below |
| 7 | Fill `LEGAL_ENTITY`, `legal:jurisdiction` and the support email. Publish the privacy policy and terms at a public URL (only the delete page exists in `public/`). | You | `docs/DEPLOYMENT.md` §4 |
| 8 | Submit the Google OAuth verification for `calendar.events`. Start early: it takes days to weeks. | You (form, video), Client (domain) | `docs/SETUP.md` §4.4 |
| 9 | EAS environment variables, versionCode 20, keystore check, Play service account. | You | `docs/SETUP.md` §5 |
| 10 | Set the OpenAI secret, create the params file, deploy the functions, rules, indexes and the delete page. Set the OpenAI and Google Cloud budgets. | You | `docs/SETUP.md` §6 |
| 11 | Turn on Firestore PITR and daily backups, Sentry, and the monitoring alerts. | You | `docs/DEPLOYMENT.md` §7-8 |
| 12 | Preview build. Run `docs/TESTING.md` T1-T11 and T13. Fix what fails. | You | `docs/TESTING.md` |
| 13 | Production build to internal testing. Run the upgrade test T12 on the fixture phones from step 2 (update them through the internal-testing link). | You | `docs/DEPLOYMENT.md` §3, `docs/TESTING.md` T12 |
| 14 | Play Console App content: data safety, account deletion URL, app access, exact alarms. | You. The client confirms the answers. | `docs/DEPLOYMENT.md` §9 |
| 15 | Staged rollout to production, with monitoring. Only after the OAuth consent screen is In production and `calendar.events` is verified (or the client accepts the unverified screen and the 100-user cap in writing). | You. The client approves the release. | `docs/DEPLOYMENT.md` §3, §4 item 4, §8 |
| 16 | When most users run 1.1.0: delete the Render service, the Supabase project and the Stripe webhooks and links. | You, after the client agrees | `docs/SETUP.md` §1.3 |
| 17 | Make the decisions in §3. | Client | §3 below |

---

## 3. Decisions needed from the client

| Decision | Options | What it blocks |
|---|---|---|
| **WhatsApp bot** | (a) Provide a Meta-verified WhatsApp Business account and number, and pay for a webhook service. (b) Take it out of scope. | The WhatsApp creation channel. The app shows "coming soon". |
| **iOS launch and Apple account** | Who owns the Apple Developer account, and when iOS should launch. | TestFlight and the App Store. iOS also needs Sign in with Apple, a 1024 px icon and the iOS OAuth client (`docs/SETUP.md` §8). |
| **Billing stack** | (a) RevenueCat: one SDK for Play and the App Store, webhooks to our server, a revenue fee. (b) Custom: Play Billing + StoreKit + our own receipt checks and store notifications. Also: build a web app for Stripe (7-day trial) or drop Stripe. | Subscriptions and trials (Milestone 6). We recommend RevenueCat. |
| **Outlook / Microsoft 365** | (a) Build a Microsoft Graph integration (Azure app registration, admin consent for some companies). (b) Take it out of scope. Outlook accounts that are added to the phone's calendar can already be imported through phone calendars. | Direct Outlook sync. |
| **AI model** | Confirm the model (the contract says GPT-4 Turbo; the server default is `gpt-5.4-mini`, and a change is a parameter plus a redeploy), a monthly OpenAI budget, and the daily limits. Free 5 is from the contract; pro 100 and premium 500 are our proposal. | Assistant cost and quality. |
| **Legal entity for the privacy policy and terms** | Company legal name, registered address, contact email, governing law and courts, and a lawyer's review. | The store release, the OAuth verification and the Play data safety form. |
| **Support email** | One address for users. | The delete-account page, the Play listing, the OAuth consent screen and the legal texts. |
| **v1.0.9 users** | Accept that the secret rotation breaks v1.0.9 AI chat and login. Decide when to shut down Render. Decide what to do with paying Stripe customers, if there are any (refund, or grant the plan by hand). | Secret rotation (`docs/SETUP.md` §1). |
| **Domain and website** | A domain the client owns for the home page and the privacy policy. | Google OAuth verification, the Play listing. |

---

## 4. Known limitations

These are true in v1.1.0. Some are platform limits, some are not built yet.

- **No full-screen intent.**
  - The MAX alert is full screen only while the app is open.
  - When the phone is locked or the app is closed, MAX is a high-priority alarm notification. It
    cannot be swiped away, and it plays the alarm sound on the alarm audio stream.
  - `expo-notifications` 57 has no full-screen intent. Adding one needs a native module and a Play
    declaration.
- **Exact alarms need the user's permission.**
  - Android 12+ asks for "Alarms & reminders". On Android 14+ it is off by default for new installs.
  - Without it, Android may deliver alerts late under Doze.
  - There is no API to read the setting from JavaScript, so the app checks again when the user
    returns from the settings.
- **Do Not Disturb override needs a user action.** MAX rings during DND only after the user allows
  "Override Do Not Disturb" for the MAX channel (the button is in Alert settings). On iOS, MAX / MEDIUM
  are time-sensitive and break through a Focus only if the Focus allows it. There are no iOS critical
  alerts.
- **Voice readout and the looping alarm** play only while the app is open. A notification always plays
  the channel sound.
- **Alert window.**
  - Alerts are scheduled up to 14 days ahead, with at most 60 pending (an iOS limit).
  - When more are needed, a "refill" reminder asks the user to open the app.
  - Background refresh runs at most about once an hour, when the OS allows it.
- **Recurring meetings are not supported.** The app cannot create a repeating meeting. The assistant
  proposes only the next one. Google recurring events are imported as single occurrences.
- **Outlook is not implemented** (only through the phone-calendar import).
- **Google Calendar** syncs the primary calendar only, from 30 days back to 180 days ahead.
- **App Check is deferred** (`enforceAppCheck: false`). The callables are protected by Firebase Auth, a
  verified-account check, per-user quotas and a project-wide daily cap. `functions/README.md` says how
  to enable App Check.
- **Subscriptions are not implemented.** There is no purchase flow. Plans are set by hand in
  `entitlements/{uid}`, and the server enforces the AI quota per plan.
- **Attachments are device-local.** They are copied into the app's folder, never uploaded or synced.
  They are removed on sign-out and meeting deletion, and lost on uninstall. The limit is 50 MB per file.
- **Sign-in:** there is no email/password screen (the service supports it). There is no Sign in with
  Apple, which iOS requires.
- **iOS has never been built.** The icon is 512 px (Apple needs 1024 px). `eas.json` has placeholder
  Apple ids. The first iOS release is iPhone only (`ios.supportsTablet: false`); iPad support needs
  iPad landscape QA and iPad screenshots (`docs/SETUP.md` §8).
- **Legal texts have placeholders** (`LEGAL_ENTITY`, `legal:jurisdiction`, the support email). They
  exist only inside the app, with no public URL.
- **OTA reach.** OTA updates reach only builds from 1.1.0 on. A downloaded update runs from the next
  cold start.
- **Small items:**
  - The sign-out prompt uses a generic "unsynced changes" text, without a count.
  - The sidebar does not list AI insights or calendar sync; they are reached from the Dashboard and
    Settings.
  - The "App not configured" screen has fixed bilingual text and is always light.
  - npm reports pending install-script approvals (Sentry CLI, Firebase and others). This comes from
    npm 11. If a CI runner blocks the scripts, run `npm approve-scripts <package>`.

---

## 5. Next pass plan (Milestone 6)

The order assumes the client chooses RevenueCat and iOS. Adjust it after the decisions in §3.

1. **Billing (RevenueCat):**
   - Create the products in Play Console and App Store Connect: Pro and Premium, monthly and yearly,
     with 3-day trials. The prices are in `src/services/billing.ts`: $7.99 / $14.99, 25% off yearly.
   - Add the RevenueCat SDK. It is a native module, so it needs a store build and a `version` bump.
   - Add a webhook Cloud Function that writes `entitlements/{uid}`. The rules already block client
     writes there.
   - Add restore purchases, and turn on `PURCHASES_AVAILABLE` in `src/services/billing.ts` (the Plans
     screen then shows the purchase buttons and the "Most popular" badge).
2. **Tier enforcement:**
   - The AI quota is **already server-side**: the `assistant` function reads `entitlements/{uid}` in
     its quota transaction (`PLAN_DAILY_AI_LIMITS`).
   - Only features beyond the AI quota need new gates, both in the rules / functions and in the UI.
3. **Stripe web checkout** (7-day trial), only if the client wants a web app. It writes the same
   entitlement document through a webhook.
4. **Widgets:** an Android "Next meeting" widget and an iOS WidgetKit widget with an App Group. Both are
   native, so they need a store build.
5. **Admin web (MVP):**
   - A small app on Firebase Hosting, with callable functions protected by an `admin` custom claim.
   - It lists users, enables and disables them, shows the entitlement and usage, grants plans and shows
     basic metrics (users, subscribers).
   - Write a short admin guide.
6. **Store listings:**
   - Play: screenshots EN/ES, descriptions, and data safety updated for purchases.
   - App Store: privacy labels, IAP products and review notes. iPad screenshots only if iPad
     support is turned on (`docs/SETUP.md` §8).
7. **iOS release:** Sign in with Apple, the 1024 px icon, TestFlight, then the App Store.
8. **Final QA:** purchases with Play license testers and the App Store sandbox, the tier limits, and the
   performance targets (`docs/TESTING.md` T13).
9. **Optional, after the decisions:** App Check, a native full-screen-intent module for MAX, Outlook,
   the WhatsApp bot, and recurring meetings (the planned shape is in `docs/ARCHITECTURE.md` §14).
