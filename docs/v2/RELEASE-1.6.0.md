# Release 1.6.0: Stage 2 goes to the stores

The Stage 2 runbook (milestone M9). It says, in order, what has to be true before the build, how
the two store builds are made and submitted, what the store consoles need for the new
integrations, the release notes, and how Stage 2 acceptance is recorded. The generic release and
rollback procedure is docs/v1/DEPLOYMENT.md; the 1.5.0 runbook (RELEASE-1.5.0.md) stays the
reference for the microphone declarations and the Apple findings of October 20. This page only
adds what is specific to 1.6.0.

Facts this plan rests on:

- 1.6.0 carries native changes since 1.5.0 (the full-screen alarm module, the Microsoft sign-in
  redirect, expo-speech-recognition from 1.5.0), so it ships as a store build. It is never an OTA
  update onto 1.5.x, and OTA updates published after it only reach 1.6.0 binaries (the runtime
  version follows the app version).
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
   see above).
   `eas build:version:get -p android` is at or above the versionCode Play currently serves.
5. The privacy policy is live on the website with the Outlook / To Do / Google Tasks sentences
   (PRIVACY-POLICY-UPDATE-2026-11-02.md in this folder). The store declarations in section 3
   must match it, so the policy goes first.
6. The app name shown on the device is the one Francisco chose (the "name" field in
   app.config.js). Check the spelling on the home screen of the last test build.
7. The store consoles carry the AI allowances (docs/v2/ALLOWANCES-2026-11-05.md): the free-trial
   offers are off on the four subscriptions in both stores, the subscription descriptions and
   the Play listing paragraph are updated in English and Spanish.

Status on November 6, 2026, read from the consoles and the APIs:

- Backend: every Cloud Function was deployed on November 5 at 18:44 Pacific, after the allowance
  commits, and the live Firestore rules equal firestore.rules (the usage root document and
  pushPending). Nothing to deploy for this release.
- EAS: the production environment has `EXPO_PUBLIC_MSAL_CLIENT_ID`. The remote versions are
  Android versionCode 26 and iOS build 10 (1.5.0), so the 1.6.0 store builds become 27 and 11.
- Website: https://meetingguard.ai/privacy-policy/ and the Spanish page are still the September
  28 version. PRIVACY-POLICY-UPDATE-2026-11-02.md, plus the sentence on tasks in the AI section
  and the allowance wording of the in-app policy, must be live before either store submission
  (Google also reads it for the Tasks scope). https://meetingguard.ai/delete-account/ answers
  404; the Firebase-hosted https://meetingguard-ai-app.web.app/delete-account.html works.

## 1. Android

```
eas build --platform android --profile production
eas submit --platform android --profile production --latest
```

The submit profile uploads to the Internal testing track. In Play Console:

1. Internal testing: install the build from the Play link over the installed 1.5.0, sign in,
   connect Outlook, run one To Do sync, one debrief, one Running late, and confirm an alarm still
   fires. This is the upgrade path users take.
2. Promote to Production with a staged rollout: 10 percent, then 50, then 100, 24 to 48 hours
   apart, watching Android vitals for crashes in the new native code and the Microsoft sign-in.
3. Release notes EN and ES are in section 4.

If the service account key is not on this machine, skip `eas submit` and upload the .aab from
the EAS build page by hand.

## 2. iOS

```
eas build --platform ios --profile production
eas submit --platform ios --profile production --latest
```

Before pressing Submit for Review in App Store Connect:

1. App Privacy (section 3) is updated for the calendar and task data from Microsoft and Google.
2. The review notes include the demo account and say that Outlook, To Do and Google Tasks are
   optional connections the user turns on in Settings > Calendar sync; the reviewer does not
   need a Microsoft account to use the app. Mention Continue with Microsoft as a third-party
   sign-in that sits next to Sign in with Apple (guideline 4.8 is satisfied by Apple sign-in).
3. The Running late share sheet uses the standard activity view; no new permission.

Apple review can take days. The Android rollout does not wait for it.

## 3. Store declarations

Google Play, App content, Data safety:

- "Calendar events" (Outlook events read and written through Microsoft Graph when the user
  connects Outlook) and "Other user-generated content" for tasks (Microsoft To Do, Google Tasks)
  as collected, used for App functionality, not shared with third parties except the connected
  provider the user chose, encrypted in transit, deletable by the user (disconnect removes the
  imported copies; account deletion removes everything).
- No new permission: the Microsoft sign-in is a browser flow, the share sheet is the system one.

App Store Connect, App Privacy:

- "Contacts" is not collected. "Other Data" / "User Content" already covers the assistant text;
  add calendar and task content linked to the user for App Functionality if it is not declared
  yet. Both must match the privacy policy wording.

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
New in 1.6.0: optional connections in Settings > Calendar sync for Outlook calendar, Microsoft To Do and Google Tasks, and "Continue with Microsoft" on the sign-in screen, a third-party option next to Sign in with Apple. None of them is needed to review the app; the demo account uses email sign-in. Google's verification of the Google Tasks permission is in progress, so Google may show an "unverified app" notice when someone connects it. The 3-day free trials were removed: the free plan now includes 10 AI actions during the first 7 days. Running late uses the standard iOS share sheet.
```

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
