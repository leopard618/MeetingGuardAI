# Release 1.6.0: Stage 2 goes to the stores

The Stage 2 runbook (milestone M9). It says, in order, what has to be true before the build, how
the two store builds are made and submitted, what the store consoles need for the new
integrations, the release notes, and how Stage 2 acceptance is recorded. The generic release and
rollback procedure is docs/v1/DEPLOYMENT.md; the 1.5.0 runbook (RELEASE-1.5.0.md) stays the
reference for the microphone declarations and the Apple findings of October 20. This page only
adds what is specific to 1.6.0.

Facts this plan rests on:

- 1.6.0 carries native changes since 1.5.0, so it ships as a store build: the full-screen alarm
  module (its fired-alarm store), the new expo-linear-gradient module and a changed
  expo-modules-core. The Microsoft sign-in redirect is not native: it uses the meetingguardai
  scheme that 1.5.0 already registers. The Android manifest and the iOS Info.plist keep every
  permission, component and URL scheme of 1.5.0 (binary audit of November 7). 1.6.0 is never an
  OTA update onto 1.5.x, and OTA updates published after it only reach 1.6.0 binaries (the
  runtime version follows the app version).
- The backend for Stage 2 is deployed: the assistant with contract v7 (debrief mode),
  `microsoftSignIn` (needs `MICROSOFT_CLIENT_ID`), `zoomCreateMeeting`, and the Firestore rules
  that accept `pushPending` (website sync). Nothing in the backend is tied to the store release.
- Google Tasks uses a sensitive scope that Google is still verifying (submitted November 6, 2026,
  with the scope justification and Francisco's demo video; "under review"). Decision of November
  6: the store builds ship WITH Google Tasks on, since the app has no real users yet, so
  `EXPO_PUBLIC_GOOGLE_TASKS_SYNC` stays unset in the production environment (unset means on).
  Until Google approves, anyone who connects Google Tasks sees Google's unverified-app screen and
  counts toward the 100-user limit of unverified apps. To hide it again: set the variable to
  `off` in the production environment and publish an OTA update (the switch is read in JS only,
  src/services/tasks/gtasks/index.ts).
- Outlook, To Do and Continue with Microsoft need `EXPO_PUBLIC_MSAL_CLIENT_ID` in the production
  environment. Without it the Outlook card does not exist and the Microsoft sign-in button is
  hidden.

## 0. Before building anything (feature freeze)

1. `TEST-GUIDE-STAGE2.md` passed on an Android phone and on an iPhone, and the Spanish part
   passed. Every failure is fixed before the build, not after. Device-visible fixes after the
   freeze are limited to failures of that guide.
2. `version` in app.config.js is 1.6.0 (done in the freeze commit of November 5, package.json
   too; the CHANGELOG heading stays Unreleased until the store release, section 6). `npm run
   apk:test` names test builds after it, so every test APK from now on is a 1.6.0-test one.
3. Clean checkout checks exactly as docs/v1/DEPLOYMENT.md section 4 lists them: typecheck, lint,
   the whole jest suite, the functions tests. All green on the freeze commit.
4. `eas env:list --environment production` is complete and includes
   `EXPO_PUBLIC_MSAL_CLIENT_ID` (checked November 6; `EXPO_PUBLIC_GOOGLE_TASKS_SYNC` stays unset,
   see above). The 1.6.0 binaries carry the Microsoft client id and both RevenueCat platform
   keys (appl_ and goog_, no test_ key). `EXPO_PUBLIC_SENTRY_DSN` is not set, so Sentry stays off
   in 1.6.0 as in 1.5.0: Android vitals and the App Store crash data are the crash signals during
   the rollout. The DSN is read in JS only, so an EAS Update to runtime 1.6.0 can add it later.
   `eas build:version:get -p android` is at or above the versionCode Play currently serves.
5. The website privacy policy and terms of service carry the in-app text of November 6, in
   English and Spanish, and /delete-account/ answers 200: TERMS-UPDATE-FOR-WEBSITE-2026-11-06.md
   in this folder (Part A terms, Part B privacy, Part C delete-account page). It replaces
   PRIVACY-POLICY-UPDATE-2026-11-02.md. The store declarations in section 3 must match it, so
   the policy goes first.
6. The app name shown on the device is the one Francisco chose (the "name" field in
   app.config.js). Check the spelling on the home screen of the last test build.
7. The store consoles carry the AI allowances (docs/v2/ALLOWANCES-2026-11-05.md): the free-trial
   offers are off on the four subscriptions in both stores, and the subscription descriptions
   and the Play listing paragraph are updated. Both stores are English only today (App Store
   Connect: one English (U.S.) localization per subscription; Play: the release notes field
   offers only the en-US tag), so the English texts are the ones to set. On the App Store the
   group ranking puts Premium above Pro (section 2, item 9).
8. The store builds carry the in-app privacy policy and terms of November 6
   (`LEGAL_LAST_UPDATED` 2026-11-06 in src/screens/legal/legalContent.ts). Never submit, or hand
   to a reviewer, a binary built from an earlier commit, test APKs included: its terms say the
   paid plans "cannot be purchased yet", which contradicts the Plans screen.
9. The Firebase-hosted delete-account page (public/delete-account.html, updated November 6 to
   the same retention text) is deployed: `npx firebase deploy --only hosting` from the
   functions folder. Google Play's "Delete account URL" points to it until
   https://meetingguard.ai/delete-account/ answers.

Status on November 6, 2026, read from the consoles and the APIs:

- Backend: every Cloud Function was deployed on November 5 at 18:44 Pacific, after the allowance
  commits, and the live Firestore rules equal firestore.rules (the usage root document and
  pushPending). Nothing to deploy for this release.
- EAS: the production environment has `EXPO_PUBLIC_MSAL_CLIENT_ID`. The remote versions are
  Android versionCode 26 and iOS build 10 (1.5.0), so the 1.6.0 store builds become 27 and 11.
- Website: https://meetingguard.ai/privacy-policy/, https://meetingguard.ai/terms-of-service/
  and the Spanish pages are still the September 28 version. TERMS-UPDATE-FOR-WEBSITE-2026-11-06.md
  must be live before either store submission (Google also reads the privacy page for the Tasks
  scope). https://meetingguard.ai/delete-account/ answers 404; the Firebase-hosted
  https://meetingguard-ai-app.web.app/delete-account.html works and gets the November 6 text
  with the next hosting deploy (item 9).

Status on November 7, 2026 (read-only audit of the two store builds; the files are in the
deliver folder next to Codebase):

- Android: aab/MeetingGuardAI-1.6.0-vc27-production-20261106-2354.aab, 1.6.0 versionCode 27,
  SHA-256 70ad2ab900f67a385151a2525fe5bf28d21aa80ef08fac4feb490d0c66590746 (EAS build
  11a811f5-c615-4549-aca4-b327c5728edd). Same upload certificate as vc26. The manifest equals
  vc26 apart from the version (39 identical permissions, no new component, no
  foregroundServiceType), so no Play permission declaration changes.
- iOS: ipa/MeetingGuardAI-1.6.0-b11-production-20261106-2342.ipa, 1.6.0 build 11, SHA-256
  bba29f96de07edf986e349c28a6d0ad74d8bdbbb3076610ac15cb39e1543a2cd (EAS build
  4de5b6cb-e211-479f-a6bf-d04dc5ecd7ca, byte-identical to the EAS artifact). Same distribution
  certificate and profile as build 10, no Info.plist key added or removed,
  ITSAppUsesNonExemptEncryption false.
- Both bundles carry the legal texts of November 6 (item 8) and the Google Tasks fix 2fba477.
  The production update branch has no update for runtime 1.6.0 (only one for 1.4.0), so users
  get the audited bundle.
- Backend switches in functions/.env.meetingguard-ai-app (deployed November 5):
  MICROSOFT_CLIENT_ID matches the app's client id; WHATSAPP_ENABLED, ZOOM_ENABLED and
  REVENUECAT_RECONCILE_ENABLED are true; REVENUECAT_ALLOW_SANDBOX is false (section 2, item 5).
- Still open: the website pages are the September 28 version (item 5); the Firebase-hosted
  delete-account page still serves the text of the October 28 hosting deploy, without Microsoft,
  WhatsApp, Zoom or RevenueCat (item 9); the consoles (item 7).

## 1. Android

The store build is made and audited (status of November 7). Upload
aab/MeetingGuardAI-1.6.0-vc27-production-20261106-2354.aab by hand: this machine has no Play
service account key. With one, `eas submit --platform android --profile production --id
11a811f5-c615-4549-aca4-b327c5728edd` uploads that build to Internal testing. In Play Console:

1. Internal testing: Test and release > Testing > Internal testing > Create new release, upload
   the .aab, release name 1.6.0 (27), the notes of section 4. Install it from the testers' link
   over the installed 1.5.0 (the upgrade path users take) and check: the home screen says
   Meeting Guard AI; Continue with Microsoft signs in (the first production binary with the
   Microsoft client id); connect Outlook and run one To Do sync; one Google Tasks list; one
   debrief; one Running late; an alarm still fires full screen; Plans shows Google Play prices
   with buy buttons and no trial badge (after section 0, item 7). A license-tester purchase
   switches the plan only while `REVENUECAT_ALLOW_SANDBOX` is true (section 2, item 5).
2. App content: Data safety as in section 3. The permission declarations (full-screen intent,
   exact alarm, Advertising ID "no") carry over from 1.5.0 unchanged. App access keeps the demo
   account.
3. Promote to Production with a staged rollout: 10 percent, then 50, then 100, 24 to 48 hours
   apart, watching Android vitals for crashes in the new native code and the `microsoftSignIn`
   function logs. Release notes EN and ES are in section 4.

On November 8, 27 (1.6.0) was published straight to Production at 100 percent (the public Play
page shows version 1.6.0), so items 1 and 2 now run against the live app: install it from Play,
run the checks, and fill in Data safety at once. The Play listing App name read "MeetingGuard
AI" (one word), so a search for "meeting guard ai" did not match it; it becomes "Meeting Guard
AI", together with the plans paragraph, in one store listing change.

## 2. iOS

The store build is made and audited (status of November 7). Upload exactly that build, never
`--latest` (which takes whatever build is newest on EAS):

```
npx -y eas-cli@latest submit -p ios --id 4de5b6cb-e211-479f-a6bf-d04dc5ecd7ca
```

EAS holds the App Store Connect API key, and the production submit profile targets app
6819847236, team D695835P4T. On a Mac, Transporter with
ipa/MeetingGuardAI-1.6.0-b11-production-20261106-2342.ipa works too.

Before pressing Submit for Review in App Store Connect:

1. App Privacy (section 3) is updated for the calendar and task data from Microsoft and Google.
2. The review notes include the demo account and say that Outlook, To Do and Google Tasks are
   optional connections the user turns on in Settings > Calendar sync; the reviewer does not
   need a Microsoft account to use the app. Mention Continue with Microsoft as a third-party
   sign-in that sits next to Sign in with Apple (guideline 4.8 is satisfied by Apple sign-in).
3. The Running late share sheet uses the standard activity view; no new permission.
4. TestFlight: 1.6.0 (11) is installed on an iPhone and passes Sign in with Apple, Continue with
   Microsoft, an Outlook connect, and Plans with App Store prices, buy buttons and no trial
   badge.
5. App Review buys in the sandbox, and the webhook ignores sandbox purchases while
   `REVENUECAT_ALLOW_SANDBOX` is false (its value on November 7). 1.5.0 was approved that way,
   but a reviewer who buys stays on Free. For the review window, set it to true in
   functions/.env.meetingguard-ai-app and run, from the functions folder,
   `npx firebase deploy --only functions:revenuecatWebhook,functions:adminReconcileEntitlement`.
   Check that the RevenueCat webhook still sends sandbox events (Integrations > Webhooks), and
   prove it with one TestFlight purchase from a Sandbox Apple Account. After both approvals, set
   it back to false and redeploy the same two functions (SETUP.md 11.3 step 5); every later
   review needs it on again.
6. The demo account shows no "Verify your email" banner (the assistant needs a verified email)
   and still has its free allowance: 10 AI actions in the 7 days after the first one, at most 3
   a day. If usage/<its uid> exists in Firestore (it is created by the first AI action after
   the November 5 deploy), delete it with its days subcollection, then do not use the account's
   AI before the review.
7. The free-trial offers are deleted on the four subscriptions (section 0, item 7) before the
   note that says so is pasted. Apple lists them only under Subscription Prices > View all
   Subscription Pricing > Introductory Offers (current and upcoming); a row is removed with the
   (-) button at its right end, then Delete. An offer cannot be edited or ended early.
8. App Store Version Release: "Manually release this version", so the release can wait for the
   website pages.
9. Group ranking (MeetingGuard Plans > Edit next to Subscriptions): Level 1 Premium Monthly and
   Premium Yearly, Level 2 Pro Monthly and Pro Yearly. On November 8 it read Pro Monthly 1, Pro
   Yearly 2, Premium Monthly 3, Premium Yearly 4, the reverse of APP-REVIEW-2026-10-20.md 1.2
   step 4: Pro to Premium was a downgrade that waits for the renewal (the Plans screen's
   activation wait ends in "Still processing"), and Premium to Pro or yearly to monthly an
   immediate change with a prorated refund. Drop a yearly ON its monthly row to share a level;
   if stacking fails, use four levels with each yearly above its monthly. Apple shows no review
   step for the order; it applies to plan changes after it propagates (allow an hour).
10. Each subscription's English (U.S.) description is the 45-character form of
    ALLOWANCES-2026-11-05.md ("100 AI actions per month", "400 AI actions per month"). The
    Review Information note reads "Shown on the Plans screen (menu, top left > Plans).
    Purchases run through RevenueCat." (the 1.5.0 note said Settings > Plans), with the build 11
    Plans screen as its screenshot where the field can be edited.
11. Submission (App Store Connect since July 15, 2026: the version page no longer lists In-App
    Purchases and Subscriptions): version page with build 11 > Add for Review > Create New
    Submission; then Add for Review on each of the four edited subscriptions, choosing that same
    draft; then App Review > Drafts > check iOS 1.6.0 plus the four subscriptions > Submit for
    Review. Sent alone, the descriptions would be reviewed against 1.5.0. A rejected description
    holds 1.6.0 until it is fixed (Update Review) or removed from the submission.
12. Open, server side, not proven: for an immediate App Store change RevenueCat sends
    PRODUCT_CHANGE and RENEWAL together, and functions/src/revenuecat/mapping.ts writes both
    like a purchase. PRODUCT_CHANGE carries the old product's entitlement and expiry, so when it
    is applied last (an equal or newer event_timestamp_ms, shouldApplyEntitlementWrite in
    functions/src/revenuecat/index.ts), an upgraded user reads as the old plan or as Free.
    RevenueCat calls PRODUCT_CHANGE informative. Proof in TestFlight with the sandbox flag on:
    buy Pro Monthly, then Premium Monthly; the banner must end with "Your Premium plan is now
    active." and entitlements/{uid} must still read premium a minute later.

Apple review can take days. The Android rollout does not wait for it.

## 3. Store declarations

Both consoles must match the in-app privacy policy of November 6 ("Information we collect",
"Who we share information with", "How long we keep your information"). The claims behind it
are listed with their code references in LEGAL-CLAIMS-1.6.0.md. Compared with 1.5.0, these
data types are new or newly reachable in 1.6.0; all are linked to the user, used for App
functionality, encrypted in transit, never used for tracking or advertising:

| Data | Source in 1.6.0 | Play Data safety | App Store App Privacy |
| --- | --- | --- | --- |
| Microsoft name, email, account and tenant id | Continue with Microsoft | Personal info: Name, Email address, User IDs | Contact Info: Name, Email Address; Identifiers: User ID |
| Phone number and WhatsApp profile name | WhatsApp link (optional) | Personal info: Phone number, Name | Contact Info: Phone Number, Name |
| WhatsApp messages and assistant chats | WhatsApp, assistant | Messages: Other in-app messages | User Content: Other User Content |
| Outlook and Google Calendar events | Calendar sync | Calendar: Calendar events | User Content: Other User Content |
| Tasks (app, Google Tasks, Microsoft To Do) | Tasks, task sync | App activity: Other user-generated content | User Content: Other User Content |
| Subscription events (plan, store, product, price, dates) | RevenueCat webhook (already in 1.5.0; declare it now if 1.5.0 did not) | Financial info: Purchase history | Purchases: Purchase History |

- Sharing: answer "not shared". The providers (Google Cloud, OpenAI, RevenueCat, Sentry, Expo,
  Zoom, Meta) are service providers, and the transfers to Google Calendar, Outlook, Google
  Tasks and Microsoft To Do happen because the user connected them; Play's definition of
  sharing excludes both.
- Voice: the app never stores or sends audio. The phone's own speech recognizer (Apple's, or
  usually Google's on Android) may send it to its servers, and the policy says so. The usual
  answer for the platform recognizer is "Audio not collected" in both consoles; if Francisco
  prefers the cautious answer, declare Audio as collected, not stored, App functionality.
- Deletion: users can delete in the app and by email, and the delete-account URL is the
  Firebase-hosted page (section 0, item 9). Account deletion does NOT remove everything: the
  purchase records (revenue records) and RevenueCat's own record stay, the Zoom meetings stay on
  our Zoom account until the user asks, a deletion record stays 30 days, backups up to 14 days.
- No new permission: the Microsoft sign-in is a browser flow, the share sheet is the system one.
  The binaries prove it: the vc27 manifest and the build 11 Info.plist equal 1.5.0 apart from
  the version.
- "Contacts" stays not collected: participants are typed in by the user as part of a meeting
  or a task, the app never reads the address book.

## 4. Release notes

Google Play allows 500 characters per language; these fit (493 and 499) and serve as the App
Store "What's New" too. The product name is "Meeting Guard AI" since November 2.

English:

```
Outlook, both ways: connect your Microsoft account and your meetings stay in step with Outlook.
Microsoft To Do and Google Tasks: pick a list and your tasks stay in step in both places.
Debrief by voice: after a meeting, say what was agreed and confirm the tasks the app proposes.
Running late: send a ready message with the new time, and move the meeting only if you want.
Continue with Microsoft on the sign-in screen.
New plans: 10 free AI actions in your first 7 days, then Pro or Premium.
```

Spanish:

```
Outlook en ambos sentidos: conecta tu cuenta de Microsoft y tus reuniones quedan al día con Outlook.
Microsoft To Do y Google Tasks: elige una lista y tus tareas quedan al día en ambos sitios.
Debrief por voz: al terminar una reunión, di lo acordado y confirma las tareas propuestas.
Voy tarde: envía un mensaje listo con la nueva hora y mueve la reunión solo si quieres.
Continuar con Microsoft al iniciar sesión.
Planes nuevos: 10 acciones de IA gratis en tus primeros 7 días, luego Pro o Premium.
```

App Store Connect, App Review Information, Notes (the demo account details stay as they are):

```
New in 1.6.0: optional connections in Settings > Calendar sync for Outlook calendar, Microsoft To Do and Google Tasks, and "Continue with Microsoft" on the sign-in screen, a third-party option next to Sign in with Apple. None of them is needed to review the app; the demo account uses email sign-in. Google's verification of the Google Tasks permission is in progress, so Google may show an "unverified app" notice when someone connects it. The 3-day free trials were removed: the free plan now includes 10 AI actions during the first 7 days, at most 3 a day. Plans: open the menu (top left) > Plans. The demo account is on the Free plan with its full allowance, and a sandbox purchase of Pro or Premium unlocks the plan within seconds. Running late uses the standard iOS share sheet.
```

The sentence on the sandbox purchase is true only while `REVENUECAT_ALLOW_SANDBOX` is true
(section 2, item 5); without it, delete that sentence before pasting.

## 5. Stage 2 acceptance

The agreement lines and what shows them are in `STAGE2-ACCEPTANCE.md` (16 lines, Spanish pass
of three). Run it on a phone with the store build, record the screen with sound, send Francisco
the recording and the filled list, and keep his written acceptance with the evidence. Payment 9
is released on that message.

## 6. After the release

1. Tag the released commit `v1.6.0` on branch `v2`; move the 1.6.0 heading in CHANGELOG.md from
   Unreleased to the release date.
2. Update docs/v1/HANDOFF.md "Status update" and docs/v2/PLAN.md with the live versions and
   dates, quoted from the consoles.
3. The production OTA channel now serves 1.6.0 only. A fix that touches no native code can go
   out with `eas update --channel production` (docs/v1/DEPLOYMENT.md section 5).
4. When Google verifies the Tasks scope: nothing to switch, the store builds already carry it;
   the unverified-app screen disappears on Google's side.

## 7. Things that can go wrong, and what to do

- The Microsoft sign-in returns to the browser instead of the app: the redirect URI of the Azure
  registration does not match `meetingguardai://auth/microsoft` (SETUP.md section 10). Fix the
  registration; no app change.
- A Microsoft account connected before this build cannot load To Do lists (access denied): the
  consent predates the Tasks scope. The card says so; stop the Outlook sync and connect again.
- Google shows the "unverified app" interstitial on the Tasks permission: expected for accounts
  outside the test list until the scope is verified, on the store builds too (decision of
  November 6).
- Apple rejects for the Microsoft sign-in: the reviewer could not sign in. The review notes
  must say the demo account uses email sign-in and that Microsoft is optional.
- The share sheet on Android reports success even when the user cancelled: known platform
  behaviour, which is why the sheet says "handed over" there and never "sent" or "delivered".
- A debrief returns no tasks: the transcript had no commitment, or the functions are on contract
  v6. `npx firebase functions:list` from the functions folder shows the deployed version; the
  assistant log line `assistant.completed` shows `mode: debrief`.
