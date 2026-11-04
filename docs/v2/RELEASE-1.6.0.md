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
- Google Tasks uses a sensitive scope that Google has not verified yet (SETUP.md section 4.6).
  Store builds set `EXPO_PUBLIC_GOOGLE_TASKS_SYNC=off` until the verification lands; the card is
  hidden and the engine skips the provider. The test accounts keep working on test builds.
- Outlook, To Do and Continue with Microsoft need `EXPO_PUBLIC_MSAL_CLIENT_ID` in the production
  environment. Without it the Outlook card does not exist and the Microsoft sign-in button is
  hidden.

## 0. Before building anything (feature freeze)

1. `TEST-GUIDE-STAGE2.md` passed on an Android phone and on an iPhone, and the Spanish part
   passed. Every failure is fixed before the build, not after. Device-visible fixes after the
   freeze are limited to failures of that guide.
2. `version` in app.config.js is 1.6.0 (today it still reads 1.5.0; bump it in the freeze
   commit together with the CHANGELOG date). `npm run apk:test` names test builds after it, so
   the last test APK before the store build is a 1.6.0-test one.
3. Clean checkout checks exactly as docs/v1/DEPLOYMENT.md section 4 lists them: typecheck, lint,
   the whole jest suite, the functions tests. All green on the freeze commit.
4. `eas env:list --environment production` is complete and includes
   `EXPO_PUBLIC_MSAL_CLIENT_ID` and `EXPO_PUBLIC_GOOGLE_TASKS_SYNC=off`.
   `eas build:version:get -p android` is at or above the versionCode Play currently serves.
5. The privacy policy is live on the website with the Outlook / To Do / Google Tasks sentences
   (PRIVACY-POLICY-UPDATE-2026-11-02.md in this folder). The store declarations in section 3
   must match it, so the policy goes first.
6. The app name shown on the device is the one Francisco chose (the "name" field in
   app.config.js). Check the spelling on the home screen of the last test build.

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

English:

```
Outlook, both ways. Connect your Microsoft account and your meetings flow between MeetingGuard
and Outlook, with no duplicates. Teams links are created for you.
Microsoft To Do. Pick a list and your tasks stay in step in both places. Completing a task in
To Do silences its reminder here.
Debrief by voice. After a meeting, say what was agreed; the app proposes tasks with owners and
due dates linked to that meeting. Nothing is saved until you confirm.
Running late. Pick 5, 10, 15 or 30 minutes, get a ready message with the new time, send it from
your phone, and move the meeting only if you want to.
Continue with Microsoft on the sign-in screen, and meetings created on the website reach your
calendars through the app.
```

Spanish:

```
Outlook en ambos sentidos. Conecta tu cuenta de Microsoft y tus reuniones fluyen entre
MeetingGuard y Outlook, sin duplicados. Los enlaces de Teams se crean por ti.
Microsoft To Do. Elige una lista y tus tareas se mantienen al día en los dos sitios. Completar
una tarea en To Do silencia su recordatorio aquí.
Debrief por voz. Al terminar una reunión, di lo que se acordó; la app propone tareas con
responsables y fechas enlazadas a esa reunión. Nada se guarda hasta que confirmas.
Voy tarde. Elige 5, 10, 15 o 30 minutos, recibe un mensaje listo con la nueva hora, envíalo desde
tu teléfono y mueve la reunión solo si quieres.
Continuar con Microsoft en la pantalla de inicio de sesión, y las reuniones creadas en la web
llegan a tus calendarios a través de la app.
```

Google Tasks is not in the notes while the store builds carry the switch off; add one line in
both languages when the scope is verified and the switch is turned on.

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
4. When Google verifies the Tasks scope: set `EXPO_PUBLIC_GOOGLE_TASKS_SYNC` to on in the
   production environment, rebuild (it is a build-time switch), add the release-notes line.

## 7. Things that can go wrong, and what to do

- The Microsoft sign-in returns to the browser instead of the app: the redirect URI of the Azure
  registration does not match `meetingguardai://auth/microsoft` (SETUP.md section 10). Fix the
  registration; no app change.
- A Microsoft account connected before this build cannot load To Do lists (access denied): the
  consent predates the Tasks scope. The card says so; stop the Outlook sync and connect again.
- Google shows the "unverified app" interstitial on the Tasks permission: expected for accounts
  outside the test list until the scope is verified. On store builds the card is hidden anyway.
- Apple rejects for the Microsoft sign-in: the reviewer could not sign in. The review notes
  must say the demo account uses email sign-in and that Microsoft is optional.
- The share sheet on Android reports success even when the user cancelled: known platform
  behaviour, which is why the sheet says "handed over" there and never "sent" or "delivered".
- A debrief returns no tasks: the transcript had no commitment, or the functions are on contract
  v6. `npx firebase functions:list` from the functions folder shows the deployed version; the
  assistant log line `assistant.completed` shows `mode: debrief`.
