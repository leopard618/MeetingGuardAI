# Release 1.5.0: week 5, Stage 1 goes to the stores

This is the week 5 runbook. It says, in order, what has to be true before the build, how the two
store builds are made and submitted, what the store consoles need from us for the new microphone
feature, and how Stage 1 acceptance is recorded. The generic release and rollback procedure is in
docs/v1/DEPLOYMENT.md and is not repeated here; this page only adds what is specific to 1.5.0.

Facts this plan rests on (checked in the consoles on 2026-10-19):

- Google Play: 1.4.0 (versionCode 24) has been in production since 2026-10-06 at 100 percent.
- App Store: 1.4.0 build 9 was REJECTED on 2026-10-20 after the expedited review: 2.1(b) the
  subscription products were never submitted, 2.1(a) Sign in with Apple errored on the review
  iPad, 3.1.2(c) no Terms of Use link in the listing. The fix guide is APP-REVIEW-2026-10-20.md
  in this folder. 1.4.0 has never been live on iOS; the next iOS submission is 1.5.0.
- 1.5.0 adds a native module (expo-speech-recognition) and the microphone permission. It can only
  ship as a store build. It can never be an OTA update onto 1.4.x, and OTA updates published to
  the production channel after this release only reach 1.5.0 binaries (the runtime version follows
  the app version).
- The backend (assistant, whatsappWebhook) and the Firestore rules for Stage 1 are already
  deployed, and the deployed assistant serves both the 1.4.x client (AI contract v4/v5) and the
  1.5.0 client (v6). No backend step is tied to the store release.

## 0. Before building anything

1. The week 3 and week 4 device guide passed on a phone, and one Spanish pass was done. Each
   failure is read in the function logs (`assistant.completed`: `toolCalls`, `actions`,
   `linkedTasks`, `resolutionBlocked`, `moveQuestion`) and fixed before the build, not after.
2. Turn the status notification on. It is week 5 scope and was built in advance, hidden behind a
   build-time switch so the week 3 and 4 test builds did not show it:
   - `src/core/features.ts`: `statusNotification: false` becomes `true`.
   - `src/services/alerts/__tests__/statusNotificationFlag.test.ts`: the first test asserts the
     switch is off. Flip that assertion to `true`; the second test then proves "nothing is
     presented" with the preference OFF instead of the switch (adjust `makePrefs`). Run `npm test`.
   - Settings > Alerts then shows the "Alerts are on" switch (off by default). On Android the
     notification lives on its own low-importance channel, so it never sounds or vibrates.
3. Clean checkout checks, exactly as docs/v1/DEPLOYMENT.md section 4 item 1 lists them, in both
   tiers. The app tier is the one that changed since 1.4.0 in a way the stores can see.
4. `eas env:list --environment production` is complete. `eas build:version:get -p android` returns
   24 or higher (the production profile auto-increments, so the next build is 25 or higher; Play
   rejects anything at or below 24).
5. The privacy policy mentions voice input: the microphone is used only while the user is
   speaking to the assistant, speech is turned into text on the device by the platform
   recognizer, and the text is sent to the assistant backend and to the AI provider exactly like
   a typed message. The store declarations in section 3 below must say the same thing, so write
   the policy sentence first and copy it.

## 1. Android

```
eas build --platform android --profile production
eas submit --platform android --profile production --latest
```

The submit profile uploads to the Internal testing track. From there, in Play Console:

1. Internal testing: install the build on at least one phone from the Play link, sign in, run
   the voice flow once (microphone permission prompt, recognized text, spoken answer), and
   confirm an alarm still fires. This is the upgrade path 1.4.0 to 1.5.0 that users will take.
2. Promote to Production with a staged rollout: 10 percent, then 50, then 100, 24 to 48 hours
   apart, watching Android vitals for crashes in the new native module.
3. Release notes EN and ES are in section 4.

If the service account key is not on this machine, skip `eas submit` and upload the .aab from the
EAS build page by hand, which is how 1.4.0 was released.

## 2. iOS

The three findings of the 2026-10-20 rejection are closed first (APP-REVIEW-2026-10-20.md: the
subscription products created and attached, Sign in with Apple proven on a real iPhone, the EULA
link in both descriptions). Then the rejected 1.4.0 version in App Store Connect is edited in
place: its version string changed to 1.5.0, the 1.5.0 build selected, the products attached, and
the review notes rewritten to answer each finding. Nothing is lost, since 1.4.0 was never live.

```
eas build --platform ios --profile production
eas submit --platform ios --profile production --latest
```

The submit profile already carries the Apple ID, team and app record. Before pressing Submit for
Review in App Store Connect:

1. App Privacy (section 3) is updated for the microphone and the speech text.
2. The review notes include a test account and the two sentences the reviewer can say ("What do I
   have tomorrow?" and "Add a task to call Ana on Friday") so the voice feature is exercised.
3. Both usage strings are the ones in app.config.js (`MICROPHONE_USAGE` and
   `SPEECH_RECOGNITION_USAGE`). Apple rejects builds whose microphone string does not say what the
   audio is for; ours does.

## 3. Store declarations for the microphone

Google Play, App content:

- Permissions: `RECORD_AUDIO` is new. If Play asks, the feature is voice input to the in-app
  assistant, started only by a user tap on the microphone button, no background recording, no
  foreground service.
- Data safety: add "Voice or sound recordings" as collected, processed ephemerally, not shared,
  purpose App functionality (the audio itself is handled by the platform recognizer and is never
  stored by us). The resulting text falls under "Other user-generated content", shared with a
  third party (the AI provider) for App functionality, which the form already declares for typed
  assistant messages; confirm that entry still reads correctly.

App Store Connect, App Privacy:

- Add "Audio Data" under Data Not Linked to You, purpose App Functionality, if the lawyer's
  reading of the policy is that transient on-device recognition counts as collection; otherwise
  record the reasoning. "Other User Content" (the assistant text) is already declared.

Both must match the privacy policy sentence from section 0 item 5.

## 4. Release notes

English:

```
Talk to MeetingGuard. Tap the microphone, say what you need, and hear the answer. Everything
still goes through a confirmation card before it changes your calendar.
Tasks, with reminders that ring like your meeting alerts.
One sentence can do two things: "Book the call with Ana and add a task the day before" creates
both, linked.
Ask for your day, what is overdue, or what to prepare for tomorrow, out loud.
A daily briefing at the time you choose, and an optional "alerts are on" status in the
notification shade.
```

Spanish:

```
Habla con MeetingGuard. Toca el micrófono, di lo que necesitas y escucha la respuesta. Todo
pasa por una tarjeta de confirmación antes de cambiar tu calendario.
Tareas con recordatorios que suenan como tus alertas de reunión.
Una frase puede hacer dos cosas: "Agenda la llamada con Ana y añade una tarea el día antes" crea
ambas, enlazadas.
Pide tu día, lo pendiente o lo que preparar para mañana, en voz alta.
Un resumen diario a la hora que elijas y un aviso opcional de "alertas activas" en la barra de
notificaciones.
```

## 5. Stage 1 acceptance

Run with the client on a phone with the store build installed, in English and then in Spanish.
Record the date, the phone and the build number next to each line.

| Line from the agreement | How it is shown | Evidence to keep |
|---|---|---|
| Voice conversation in English and Spanish | Ask for tomorrow's agenda by voice in each language; hear the list. | Screen recording with sound |
| Confirmed and cancelled by voice; an unclear reply never executes | Propose a meeting; say "yes, confirm" (executes), then propose another and say "yes but make it earlier" (the card stays, nothing is created). | Screen recording; `resolutionBlocked: true` in the function log for the second |
| Tasks created, edited, postponed, completed, deleted; reminders fire | Create a task with a reminder two minutes out; lock the phone; the reminder rings. | Photo of the lock screen |
| Combined requests link the task to the meeting | "Book the call with Ana tomorrow at 10 and add a task the day before to prepare." Two cards; after confirming, the task shows the meeting. | Screenshot; `linkedTasks: 1` in the log |
| Moving a meeting asks about linked tasks | Move that meeting by two days; the reply asks about the task by name; say yes; the task moves. | Screenshot of the question |
| Agenda queries: today, overdue, tomorrow | Three questions, three correct spoken answers, including one empty day answered as "nothing". | Screen recording |
| Daily briefing | Set the briefing time three minutes ahead, close the app; the briefing notification arrives with the next two days. | Photo |
| Status notification (week 5) | Turn it on in Settings > Alerts; it stays in the shade after the app is closed; it updates when a meeting is added. | Photo |
| Released to both stores | Play listing shows 1.5.0; App Store shows 1.5.0 (or the submission receipt if Apple is still reviewing on acceptance day). | Console screenshots |

Sign-off: one message from the client accepting Stage 1, kept with the evidence.

## 6. After the release

1. Tag the released commit `v1.5.0` on branch `v2`, and move the 1.5.0 heading in CHANGELOG.md
   from Unreleased to the release date.
2. Update docs/v1/HANDOFF.md "Status update" and docs/v2/PLAN.md with the live versions and
   dates. Quote live versions only from the consoles.
3. The production OTA channel now serves 1.5.0 only. A fix that touches no native code can go
   out with `eas update --channel production` (docs/v1/DEPLOYMENT.md section 5).

## 7. Things that can go wrong, and what to do

- Play rejects the upload with a versionCode error: the remote counter is below 24. Run
  `eas build:version:set -p android` to 24 and rebuild.
- Apple rejects for the microphone: the review note did not explain the feature, or the reviewer
  denied the permission and saw an empty assistant. The app must still work by typing with the
  microphone denied; verify this on a device before resubmitting.
- Speech recognition does not start on a tester's Android phone: the device has no recognizer
  (common on phones without Google services) or no Spanish pack. The app shows the "voice is not
  available" state and typing still works; this is expected and documented, not a defect.
- The briefing does not arrive on Android 14 with the app closed: the exact alarm permission was
  denied or battery optimization stopped the app. Settings > Alerts shows the permission state;
  this is the same situation as meeting alerts and uses the same guidance screen.
- A 1.4.x user gets a "please update" message from the assistant: expected only for features
  that need contract v6 (task linking); everything 1.4.x could do still works on the deployed
  backend.
- The store review takes long: the Android rollout does not wait for Apple. Release Android first
  and tell the client the iOS date depends on Apple, as it did for 1.4.0.
