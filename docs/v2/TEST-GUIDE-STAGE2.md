# Stage 2 device test guide: the integrations, both platforms

Test build: the newest `MeetingGuardAI-*-test-*.apk` in the deliver folder on Android; the
TestFlight build of the same commit on iPhone. Functions deployed with contract v7, Firestore
rules with `pushPending`, `MICROSOFT_CLIENT_ID` set on the functions and
`EXPO_PUBLIC_MSAL_CLIENT_ID` in the build. Work through it as the user, a consultant called Dusko
who keeps his calendar in Outlook at work and in Google at home, and his tasks in Microsoft To Do.

For every step write down: step number, pass or fail, and the phone clock time. On a fail take a
screenshot. The full step detail per feature is in `docs/v1/TESTING.md` (T15 Outlook, T22 To Do,
T23 debrief, T24 Google Tasks, T25 Continue with Microsoft, T26 website sync, T27 running late);
this guide is the working-day order of the same checks, with what differs on iPhone.

## Part A. Preparation (15 minutes)

1. Install the build, sign in with Google, allow notifications and the microphone. Android:
   Settings > Alerts, allow exact alarms and turn off battery optimization when asked.
2. Have ready, on the same Microsoft account: Outlook web (<https://outlook.live.com> or
   <https://outlook.office.com>) with two or three events this week, and Microsoft To Do
   (<https://to-do.office.com>) with two lists, "Tasks" and "Work", two open tasks and one
   completed task in "Work".
3. Have ready, on the Google account of the phone: Google Calendar and Google Tasks
   (<https://tasks.google.com>) with one list that holds one open task.
4. Delete leftover test meetings and tasks in the app. New chat in the assistant.
5. Language: English for Parts B to G. Part H repeats the key steps in Spanish.

## Part B. Monday: Outlook, both ways (M6; TESTING T15)

B1. Settings > Calendar sync > Outlook card > **Connect**. The Microsoft sign-in opens in the
browser and returns to the app. Expect: the card says Connected with the account's email and the
week's Outlook events appear as meetings with the Outlook badge.

B2. Create "Nexa kickoff" in the app, Wednesday 10:00, 45 minutes, conference type Teams.
Expect: within one sync the event is in Outlook web at the same time, as an online meeting; the
app shows the Teams link once Microsoft delivers it.

B3. In Outlook web move "Nexa kickoff" to 11:00. Pull to refresh the meetings list.
Expect: the app shows 11:00 and Settings > Alerts > scheduled alerts shows the alarms at the new
time.

B4. In Outlook web delete one of the imported events. Refresh.
Expect: it leaves the app (or shows Cancelled); its alarms are gone.

B5. Create a weekly "Team sync", three occurrences, while Outlook is connected. Move the second
occurrence by one hour from the app's list (This meeting only).
Expect: Outlook shows one series with three occurrences, the second at the new hour; no one-off
copies anywhere.

B6. Open Google Calendar and the phone calendar.
Expect: nothing from Outlook has been copied there, and nothing Google-imported went to Outlook.
Count the meetings in the app: no duplicates.

B7. Sign out of the app and sign in again.
Expect: Outlook shows Disconnected; Connect works again (B1). Leave it connected.

## Part C. Tuesday: Microsoft To Do (M7; TESTING T22)

C1. Settings > Calendar sync > Microsoft To Do > **Sync tasks with To Do**. Pick "Work",
**Start sync**.
Expect: an alert with the counts; the card says Syncing, "List: Work". The two open To Do tasks
appear in Tasks; the completed one does not. The app's own open tasks appear in To Do "Work".

C2. Create a task in the app: "Send the Nexa contract", due today 16:00, reminder 30 minutes
before.
Expect: in To Do the task has today's date and a reminder at 15:30.

C3. In To Do rename it to "Send the signed Nexa contract" and add a note. Wait a minute with the
app open (or pull down on the Tasks screen).
Expect: the app shows the new title and the note within a minute.

C4. Complete the task in the app. Expect: To Do shows it completed within a minute. Reopen it in
To Do. Expect: the app shows it open again.

C5. Create "Call the bank" in the app with a reminder three minutes ahead. Complete it in To Do.
Keep the app open.
Expect: within a minute it is done in the app and the reminder does not ring at its time.

C6. Delete one task in To Do and another in the app.
Expect: each disappears on the other side. Tap Sync now three times: still no duplicates.

C7. Assistant: say "Add a task to prepare the Globex deck on Thursday."
Expect: the confirm sheet shows "To Do list: Work" before Confirm. After Confirm the task is in
To Do "Work".

C8. Say "What do I have today?" Expect: the imported To Do task due today is in the spoken
answer like any other.

## Part D. Wednesday: Google Tasks (M8; TESTING T24)

Only on a build where the Google Tasks card is visible (test accounts, or after Google verifies
the scope). On a store build with the switch off this part is skipped and reported as such.

D1. Settings > Calendar sync > Google Tasks > **Sync tasks with Google Tasks**. Google asks for
the Tasks permission once; allow. Pick the list, **Start sync**.
Expect: the counts alert; the open Google task appears in the app; the app's open tasks appear
in Google Tasks.

D2. Create "Review the Globex quote" in the app, due Friday. Expect: in Google Tasks on Friday.

D3. In Google Tasks rename it and mark it done. Refresh.
Expect: the app shows the new title and the task done within a minute.

D4. With To Do still syncing: create "Order business cards" in To Do.
Expect: within two syncs it is in the app and in Google Tasks (the app bridges both).

D5. Assistant: "Add a task to book the hotel for the Globex trip."
Expect: the sheet names both lists (To Do and Google Tasks) before Confirm.

## Part E. Thursday afternoon: the spoken debrief (M8; TESTING T23)

E1. Let "Nexa kickoff" end (or create a meeting that ended ten minutes ago with two
participants, Ana and Luis). Open its details.
Expect: **Debrief this meeting** at the bottom.

E2. Tap it. The assistant opens with the debrief panel naming the meeting. Tap the microphone
and say, in one go: "Ana sends the revised budget by Friday. I owe Luis the signed contract
next Tuesday. We meet again on the twentieth to close."
Expect: the transcript appears in the box; nothing is sent until you tap **Create tasks**.

E3. Tap **Create tasks**.
Expect: two task cards, one per commitment, with the owner (Ana, Luis), the due date (Friday,
next Tuesday) and the meeting named on each card; maybe a third card proposing the follow-up
meeting. Nothing is saved yet.

E4. Change the budget due date on its card to Monday and **Confirm** both task cards.
Expect: two tasks in Tasks, each showing "Nexa kickoff" as its meeting, with reminders. They
reach To Do "Work" (and Google Tasks when D ran).

E5. Open the follow-up notification of any ended meeting (or the post-meeting banner).
Expect: a **Debrief** button that opens the same panel.

E6. Type instead of speaking: paste the same three sentences and tap Create tasks.
Expect: the same cards.

## Part F. Friday: running late, and ending a meeting (M9; TESTING T27)

F1. Create "Globex check-in" starting in five minutes, 30 minutes long, with one participant
(a second address of yours), with Google Calendar sync on.

F2. Dashboard: tap **Running late** under "Next meeting".
Expect: a sheet with the meeting and four chips: 5, 10, 15, 30 min.

F3. Tap **10 min**.
Expect: "New time" is the start plus ten minutes. The message says you are about 10 minutes late
for "Globex check-in" and proposes that time. The participant is listed under the message.

F4. Edit one word, tap **Share message**, choose WhatsApp (or Messages) and send it to yourself.
Expect: the share sheet opens with your edited text. Back in the app: on Android the sheet says
the message went to the app you chose and Meeting Guard cannot see whether it was sent; on
iPhone that your phone confirms it was handed to the app. Then "Move the meeting to <time>?".
Nothing has moved yet.

F5. Tap **Move to <time>**.
Expect: toast "Meeting moved to <time>". Dashboard, list and Google Calendar show the new
start; the length is unchanged; the participant receives the update mail; the alerts are at the
new time.

F6. Create another meeting five minutes ahead. Running late > 5 min > **Share message** >
cancel the share sheet (iPhone; Android cannot report a cancel).
Expect: toast "Nothing was sent", the message stays, nothing moved. Share again, send it, then
tap **Keep the time**. Expect: the sheet closes, the time is unchanged.

F7. Running late > 15 min > **Email participants**.
Expect: the mail app opens addressed to the participant, subject "Running late: <title>", the
message as body. Back in the app the sheet treats it as handed over and asks about moving.

F8. Let the MAX alarm fire for a meeting (lock the phone). On the alarm screen tap **Running
late** (MEDIUM intensity: the same button on the banner).
Expect: the alarm stops, the alarm screen closes, the sheet opens for that meeting.

F9. On the weekly "Team sync": details > **Running late** > 5 min > **Just move the meeting** >
Move.
Expect: the note says only this occurrence moves. The next occurrence shows the new time with
"edited"; the week after is unchanged; Outlook shows the same.

F10. While a meeting is running: dashboard > **End now** (or details > **End meeting now**),
confirm.
Expect: "Happening now" disappears, the details show the shortened length, no further alert
fires for it.

## Part G. The website (T26; needs Sven's site signed in with the same account)

G1. On the website create a meeting for tomorrow with the second address as participant and a
Google Meet link.
Expect: it appears in the app within seconds; within about ten seconds the Meet link appears in
the app and on the website and the participant gets the Google Calendar invitation.

G2. On the website create a meeting with a Zoom link and one participant.
Expect: the Zoom link shows on the website and in the app right away; ONE invitation arrives a
few seconds later and already contains the Zoom link.

G3. On the website cancel the G1 meeting.
Expect: it leaves the app and Google Calendar; the participant gets the cancellation.

## Part H. The Spanish pass

Settings > Language > Español. Check the Calendar sync screen, the Tasks screen and a task
editor read naturally in Spanish.

H1. Repeat C7 in Spanish: "Añade una tarea para preparar la presentación de Globex el jueves."
Expect: the sheet shows "Lista de To Do: Work"; the task lands there.
H2. Repeat E2 and E3 in Spanish: "Ana envía el presupuesto revisado el viernes. Le debo a Luis
el contrato firmado el martes que viene."
Expect: two cards in Spanish, owners and dates right, the meeting named.
H3. Repeat F2 and F3: the message reads "Hola, voy unos 10 minutos tarde a ...".
H4. Outlook card, To Do card: connect and disconnect texts, toasts and alerts in Spanish.
H5. Settings > Language > English. Everything returns to English.

## Part I. What differs on iPhone

- Sign in: **Continue with Microsoft** on the Landing screen signs in with a Microsoft account
  (T25); Sign in with Apple stays available, as Apple requires.
- The lock-screen alarm is a notification (time-sensitive level), not a full-screen takeover.
  Opening it brings the app up with the same MAX alert screen (or the MEDIUM banner) and its
  "Running late" button, so F8 is checked from there; meeting details has the button too.
- The share sheet reports completion: F4 shows "your phone confirms the message was handed to
  the app you chose", and a cancelled sheet (F6) reports "Nothing was sent".
- No home-screen widget, no full-screen morning summary; everything else in Parts B to H is the
  same.

## What to report

A list like this, one line per step, plus the lock-screen photo from F8 and screenshots of: the
Outlook event from B2, the To Do task from C2, the debrief cards from E3, the sheet after F4
(the outcome text) and the moved meeting from F5. Those pictures are also the evidence for the
client's Stage 2 acceptance (`STAGE2-ACCEPTANCE.md`).

```
B1 pass 09:04
C5 FAIL 10:12 (reminder still rang)
E3 pass 15:31
F5 pass 16:03
```
