# M12 device test guide: Portuguese, French and German, both platforms

The device pass for M12 (M12-LANGUAGES.md, acceptance lines 1 to 11). It is the Portuguese,
French and German counterpart of TEST-GUIDE-STAGE2.md Part H (the Spanish pass), extended to
voice, notifications, native prompts and the store pages. The full test guide in every language
is M13's; this guide is what M12 needs for its demo and its acceptance.

Test build: the newest `MeetingGuardAI-*-test-*.apk` in the deliver folder on Android; the
TestFlight build of the same commit on iPhone. Both must be 1.7.0 builds: the language list and
the iOS permission prompts are native and do not reach a 1.6.0 binary by OTA. Server: the M12
functions and the Firestore rules that accept `pt`, `fr` and `de` are deployed (M12-LANGUAGES.md
section 6); without the rules, a meeting confirmed from a card in pt, fr or de is refused.

For every step write down: step number, language, pass or fail, and the phone clock time. On a
fail take a screenshot. Record the screen with sound for parts B to D: the recordings are the
acceptance evidence.

## Part A. Preparation (20 minutes)

1. Install the build, sign in, allow notifications and the microphone. Android: Settings >
   Alerts, allow exact alarms and turn off battery optimization when asked.
2. Speech and voices on the phone, for each of Portuguese (Brazil), French (France) and German
   (Germany):
   - Android: Settings > System > Languages > Text-to-speech output > Speech Services by Google >
     gear > Install voice data > the language. For offline recognition, the Google app >
     Settings > Voice > Offline speech recognition > the language.
   - iPhone: Settings > Accessibility > Spoken Content > Voices > the language (download one
     voice); Settings > General > Keyboard > Dictation Languages includes the language.
3. Test data: two meetings tomorrow (one with the participant Ana), one task due Friday, and an
   English notetaker recap forwarded to your private address (M10) so a summary with commitments
   exists.
4. New chat in the assistant. Write down the free AI actions left: the voice steps use about
   eight per language, so use a test account with Pro, or a fresh free allowance per language.

## Part B. The language pass (repeat for Português, Français, Deutsch)

The phrases below are examples; say them naturally. Expected labels are the app's own: Settings
is Configurações / Paramètres / Einstellungen.

B1. Settings > Language > the language. Expect: every screen switches at once, without a
restart. Walk the dashboard, a meeting's details, the meeting editor, Tasks and a task editor,
Calendar sync, Alert settings, Plans, Meeting summaries and the assistant. Nothing in English,
except product names and the executive assistant (matters), which stays English.

B2. Dates. Expect: day and month names in the language; times in 24-hour format (unless Alert
settings > clock says otherwise); the month calendar starts on Sunday in Portuguese, on Monday in
French and German; "tomorrow" reads amanhã / demain / morgen.

B3. Voice: create. Microphone button in the assistant, then say:

- pt: "Marque uma reunião com a Ana amanhã às três da tarde sobre o orçamento."
- fr: "Organise une réunion avec Ana demain à 15 h pour parler du budget."
- de: "Plane eine Besprechung mit Ana morgen um halb vier zum Budget."

Expect: the transcript in the language, then a card with title, Ana, tomorrow and 15:00 (15:30
for "halb vier"), buttons in the language. Say "sim" / "oui" / "ja". The meeting is saved.

B4. Voice: a qualified yes is not a yes. Create another card, then say "sim, mas às 5" / "oui
mais demain" / "ja aber um 5". Expect: the card is NOT confirmed; the assistant asks or proposes
the change. Then say "não" / "non" / "nein": the card is cancelled, nothing saved.

B5. Voice: move. "Mude a reunião com a Ana para quinta-feira que vem às 10h." / "Déplace la
réunion avec Ana à jeudi prochain 10 h." / "Verschieb die Besprechung mit Ana auf nächsten
Donnerstag um 10 Uhr." Expect: a move card with the right Thursday and 10:00; confirm by voice.

B6. Voice: cancel. "Cancele a reunião com a Ana." / "Annule la réunion avec Ana." / "Sag die
Besprechung mit Ana ab." Expect: a cancel card naming the meeting; confirm by voice; it is gone.

B7. Voice: a meeting and a task in one sentence. "Marque uma ligação com a Globex na terça às
15h e adicione uma tarefa para preparar a apresentação na segunda." / "Organise un appel avec
Globex mardi à 15 h et ajoute une tâche pour préparer la présentation lundi." / "Plane einen
Anruf mit Globex am Dienstag um 15 Uhr und füge eine Aufgabe hinzu, die Präsentation am Montag
vorzubereiten." Expect: two cards, the right days.

B8. Agenda aloud. "O que eu tenho amanhã?" / "Qu'est-ce que j'ai demain ?" / "Was habe ich
morgen?" Expect: the answer in the language, read aloud in a voice of that language (not an
English voice reading Portuguese).

B9. Debrief by voice on a meeting that has ended (meetings.json `debrief`: "Recapitular esta
reunião" / "Faire le bilan de cette réunion" / "Besprechung auswerten"). Say: "A Ana envia o
orçamento revisado na sexta. Eu devo ao Luis o contrato assinado na terça que vem." / "Ana
envoie le budget révisé vendredi. Je dois envoyer à Luis le contrat signé mardi prochain." /
"Ana schickt das überarbeitete Budget am Freitag. Ich schulde Luis den unterschriebenen Vertrag
bis nächsten Dienstag." Expect: two task cards in the language, owners and dates right.

B10. Running late on an upcoming meeting ("Vou me atrasar" / "Je suis en retard" / "Ich
verspäte mich"), 10 minutes. Expect: the ready message in the language with the new time.

B11. Notifications with the app closed (swipe it away). Create a meeting in 3 minutes with
alerts at 2 and 1 minutes. Expect: the alert title, text and buttons in the language; snooze
(Adiar / Reporter / Schlummern) works and its notification is in the language; on Android a MAX
alert's full-screen alarm and its voice readout are in the language. After the meeting ends, the
follow-up notification is in the language.

B12. Daily briefing: Alert settings > daily briefing at the next minute. Expect: the briefing in
the language (also full screen on Android if enabled). A task reminder (task due in 2 minutes
with a reminder) is in the language too.

B13. Meeting summaries: open the summary from Part A. Expect: the screens, the origin lines of
its tasks and the commitment cards in the language (Resumos de reuniões / Comptes rendus de
réunion / Besprechungsprotokolle). The recap itself is English; that is expected.

B14. WhatsApp (linked test number): send "compromissos" / "engagements" / "zusagen". Expect: the
open commitments list in the language.

B15. Legal: Settings > Legal > Privacy Policy and Terms. Expect: the translated texts, with the
line that the English version prevails; the menu path to delete the account quotes the labels
the app shows (Configurações > Conta > Excluir conta / Paramètres > Compte > Supprimer le compte
/ Einstellungen > Konto > Konto löschen). Open each and compare with the screen.

B16. Android widget: add the "Next meeting" widget. Expect: its texts in the language.

## Part C. Native prompts and the per-app language (1.7.0 only)

C1. iPhone: delete the app, set the phone language to Portuguese (Brazil) (Settings > General >
Language & Region), install the TestFlight build. Expect: the calendar, microphone, speech
recognition, photo and camera permission prompts in Portuguese when each is first asked. Repeat
in French and German (one language per reinstall is enough if time is short: Portuguese, then
spot-check French and German).

C2. iPhone: Settings > Meeting Guard AI > Language. Expect: English, Español, Português,
Français, Deutsch. Pick Deutsch: the app opens in German; the system date picker and the share
sheet inside the app are German too.

C3. Android 13 or later: Settings > Apps > Meeting Guard AI > Language. Expect: the five
languages are offered. Pick Français: the app opens in French.

C4. First run in a new language: clear the app's data (Android) or reinstall (iPhone) with the
phone in German. Expect: the onboarding starts in German without a choice.

## Part D. Missing voice data

D1. On an Android phone without the French speech pack and offline (airplane mode), app in
French: tap the microphone. Expect: a clear message in French that voice input in this language
is not available on the phone, with the way to install it; typing still works. No crash.

D2. Remove the German TTS voice, ask for the agenda in German. Expect: the answer is shown; if
no German voice exists, the app says so or stays silent; it never reads German with an English
voice without warning.

## Part E. Back to English and Spanish

E1. Settings > Language > Español, then English. Expect: everything returns, including the
notifications already scheduled (they are rebuilt in the new language at the next refresh).

E2. Repeat B3 in Spanish and in English. Expect: unchanged behaviour (regression check).

## Part F. What differs on iPhone

- The lock-screen alert is a notification (Time Sensitive), not a full-screen takeover; B11
  checks the notification text and, after opening it, the in-app alert screen.
- The share sheet and the date picker follow the app language only in 1.7.0 builds (C2).
- The widget (B16) is Android only.
