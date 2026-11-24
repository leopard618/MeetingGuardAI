# Test guide: Stage 3 (M10 to M13)

For: whoever tests the 1.7.0 build (Dusko, Francisco, testers). The recording checklist that
closes Stage 3 is `STAGE3-ACCEPTANCE.md`; this guide has the steps behind it.

Parts A and B are already written: the summaries (M10, M11) in `TEST-GUIDE-SUMMARIES.md` and the
languages (M12) in `TEST-GUIDE-M12.md`. Run them on the 1.7.0 build. Part C below is WhatsApp (M13).
Part D repeats the key steps in every app language.

Setup for part C: an Android phone and an iPhone with 1.7.0, each signed in to a test account
that is linked to WhatsApp (Settings > Integrations > WhatsApp assistant), and the server in
preview mode (`RELEASE-1.7.0.md` section 1). In preview mode a message the bot starts reaches the
phone only if that phone wrote to the bot in the last 24 hours: write "hi" to the bot before each
block. In live mode (after Meta approves the templates) repeat C3 to C7 without writing first.

## C1. Voice notes

1. In the WhatsApp chat with the bot, record a voice note: "Lunch with Ana tomorrow at 1 pm".
   Expected: a first reply "I heard: "Lunch with Ana tomorrow at 1 pm"", then the proposal with
   Confirm and Cancel. Nothing is created before Confirm.
2. Tap Confirm. Expected: "Done"; the meeting is in the app with its alarms.
3. Voice note: "Remind me to send the contract on Friday at 10". Confirm. The task is in the app.
4. With a proposal waiting, send a voice note saying "yes". Expected: it does NOT confirm; it goes
   to the assistant as a message. Only the Confirm button or a typed 1 confirms.
5. A voice note longer than 4 minutes. Expected: "That voice note is too long for me...".
6. On an account with no AI action left: a voice note gets the allowance message, no transcription.

## C2. Opt-in

1. Settings > Integrations > WhatsApp assistant. Expected: under the linked number, "Messages from
   Meeting Guard AI" with the explainer and one switch per kind, all off. "Commitments to review
   (pilot)" shows for summaries pilot users only.
2. Turn on Daily agenda. Expected: the welcome message arrives in WhatsApp naming the agenda and
   how to STOP.
3. Turn it off and on again: no second welcome.

## C3. Daily agenda

1. Set the briefing time (Settings > Alerts > Daily briefing time) a few minutes ahead, with a
   meeting and a task due today. Expected at that time (within 5 minutes): "Your day" with the
   number of meetings, the first one's time and title, and the tasks due and overdue.
2. Tap "See my day". Expected: every meeting of the day with its time and place, then the tasks.
3. On a day with nothing: no message.

## C4. Debrief prompt

1. Debrief prompts on. Create a meeting that ends in 2 minutes. Expected: about 5 minutes after it
   ends, "How did it go?" with Debrief and Not this time. Not between 21:00 and 7:00, at most 3 a day.
2. Tap Debrief, then write (or record) "Ana sends the proposal by Friday; I book the room".
   Expected: proposed tasks with Confirm and Cancel; Confirm creates them linked to the meeting.
3. Tap Not this time on another prompt: nothing more is sent.

## C5. Task reminders

1. Task reminders on. Accept a task from a summary (part A) with a reminder in 5 minutes.
   Expected at that time: "Task reminder" with Mark as done and Remind me in 1 hour.
   A task for someone else's commitment (one person) gets "Follow-up reminder" with the name.
2. Tap Remind me in 1 hour: the bot says when; the reminder comes again an hour later.
3. Tap Mark as done: the task is done in the app (and in To Do or Google Tasks when synced).
4. Move the task's due time in the app: the reminder follows the new time, not the old one.

## C6. Commitments to review (pilot)

1. Commitments switch on (pilot account). Forward or receive a summary with action items that is
   matched to a meeting. Expected: "Commitments to review" with the Commitments button (held to
   7:00 if it arrives at night).
2. Tap Commitments: the numbered list of M11 arrives; reply with numbers to accept.

## C7. STOP

1. Write STOP (also "Stop.", "baja", "stop please"). Expected: the STOP reply; in the app every
   switch is off and the screen says STOP turned them off. No further messages arrive.
2. Ask the assistant a normal question: it still answers.

## C8. One set of records and the admin panel

1. The meeting and task of C1 appear on the web agenda and in the synced calendars once.
2. Admin dashboard > WhatsApp: the linked users, the opt-ins, the sends of C2 to C6 with their
   status (sent, delivered, read), and the templates with their states.

## D. Every language

Switch the app language to Spanish, Portuguese, French and German in turn and repeat C1 step 1,
C3 step 2 and C7 step 1. Expected: the bot's own texts (I heard, the day list, the STOP reply)
in that language; the templates themselves in Spanish for Spanish and in English for the others
(`WhatsApp-Templates-2026-11-12.md` question 10).
