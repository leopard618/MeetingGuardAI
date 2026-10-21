# Stage 1 device test guide: a real working week

Test build: MeetingGuardAI-1.5.0-test-20261019-0017.apk (or newer). The server is already live, no
rebuild is needed for weeks 3 and 4. Work through this as if you were the user, a consultant
called Dusko who sells to two clients, Ana (Nexa) and Luis (Globex), and reports to a manager
called Marta. Say the sentences out loud first; the "typed" column is for a second pass.

For every step write down: step number, pass or fail, and the phone clock time. On a fail take a
screenshot. The clock time is what finds the request in the function log.

## Part A. Preparation (10 minutes)

1. Install the APK, sign in with Google, allow notifications and the microphone. In Settings >
   Alerts allow exact alarms and turn off battery optimization when asked.
2. Delete leftover test meetings and tasks. Delete old conversations in the assistant (new chat).
3. Create by hand, in the calendar, so the agenda has something real in it:
   - "Weekly standup", today, a time that has already passed, repeating every weekday.
   - "Lunch with Marta", today, 13:00 (or any time still ahead today).
   - "Globex quarterly review", next Monday, 15:00, location "Globex HQ".
4. Create by hand, in Tasks: "Send October invoice", due yesterday, no time. It is now overdue.
5. Language: English for Parts B to E. Part F repeats the key steps in Spanish.

## Part B. Monday morning: planning the week (week 3, combined requests)

B1. **One sentence, two things.**
Say: "Book a call with Ana on Wednesday at 10 and add a task the day before to prepare the proposal."
Expect: two cards. Card 1: meeting "Call with Ana", Wednesday 10:00. Card 2: task "Prepare the
proposal", due Tuesday. The spoken reply mentions both. One card is a fail.

B2. **Confirm by voice.**
Say: "Yes, confirm."
Expect: both execute. The meeting is on Wednesday in the calendar. The task appears in Tasks with
Tuesday's date. Open the task: it shows "Call with Ana" as its meeting. Open the meeting: the task
is listed under it.

B3. **Same thing, different words.** (Each one is a separate request. Confirm each.)
- "Schedule a demo for Luis next Friday at 4 pm, one hour, and remind me two days before to send the slides."
  Expect: meeting Friday 16:00, duration 60 minutes; task "Send the slides" due Wednesday, linked.
- "Set up a 30 minute check-in with Marta tomorrow at 9:30 and add a task to collect the numbers before it."
  Expect: meeting tomorrow 09:30, 30 minutes; task due tomorrow (before the meeting), linked.
- Typed: "meeting with ana thursday 2pm + task tomorrow: draft contract"
  Expect: the same two-card result from sloppy typing.

B4. **A task on its own, with a reminder.**
Say: "Add a task to call the bank on Friday at 11 and remind me 30 minutes before."
Expect: one task card, Friday 11:00, reminder 30 minutes. Confirm. Open the task: reminder shows.

B5. **A task tied to an existing meeting.**
Say: "Add a task to book the room for the Globex quarterly review."
Expect: one task card linked to "Globex quarterly review" (the meeting already exists, so no new
meeting). The due date may be empty or the meeting day; both are acceptable. Confirm.

B6. **Moving a meeting asks about its task.**
Say: "Move the call with Ana to Thursday at 11."
Expect: one meeting card, and the reply ends with a question naming the task: "Should I move
'Prepare the proposal' as well?" No question is a fail.
Say: "Yes."
Expect: the meeting is on Thursday 11:00 and the task moved to Wednesday, keeping the one-day gap.

B7. **Moving and answering in one breath.**
Say: "Move the demo for Luis to the following Monday at 4 and move the slides task with it."
Expect: two cards, meeting and task, both moved, no extra question. Confirm.

B8. **Moving a meeting that has no tasks.**
Say: "Move lunch with Marta to 13:30."
Expect: one card, no task question. Confirm.

B9. **Changing something that is not the date.**
Say: "Rename the call with Ana to Nexa proposal call and add the Zoom link later."
Expect: one card with the new title. No task question (the date did not change). Confirm.

## Part C. Answering the phone: confirmations that must not misfire (voice confirmation)

C1. **Plain yes and plain no.**
Say: "Create a meeting called Budget review on Friday at 3." (one card)
Say: "Cancel."
Expect: the card disappears, nothing is created, the reply says it was dismissed.
Repeat the request, then say "Sure, go ahead."
Expect: created.

C2. **Qualified answers never execute.** For each, first create a fresh card with "Add a meeting
called Test N tomorrow at 2", then answer:
- "Yes but make it earlier."
- "Yes, and invite Marta."
- "OK, only if it is after lunch."
- "Confirm, but at 3 instead."
Expect every time: the Test meeting is NOT created from that answer. The card stays, or a new card
appears with the changed detail. Then finish by tapping Confirm or Dismiss.

C3. **Two cards, one answer.**
Say: "Book a call with Luis tomorrow at 5 and add a task to send him the agenda tomorrow morning."
Say: "Yes, both."
Expect: both execute.

C4. **A question instead of an answer.**
Create a card, then say: "What time is my lunch tomorrow?"
Expect: the card stays, the assistant answers the question. Nothing executes.

## Part D. Through the day: agenda questions (week 4)

D1. **Today.**
Say: "What do I have today?"
Expect: spoken list with times: "Weekly standup (HH:MM), Lunch with Marta (13:30)", plus anything
you created today. Weekly standup must appear as a time, never as a date from weeks ago. Cards may
also show the list; the spoken text must carry the names.

D2. **Overdue.**
Say: "What is overdue?"
Expect: "Send October invoice" is named. Tasks due today or later are not.
Variations: "Anything I missed?", "Which tasks are late?"

D3. **Tomorrow and preparation.**
Say: "What should I prepare for tomorrow?"
Expect: the check-in with Marta at 09:30 and its task "Collect the numbers", and the call with
Luis at 17:00 and its agenda task. The reply joins tasks to their meetings.

D4. **A specific day.**
Say: "What is on Thursday?" Expect: Nexa proposal call 11:00 (and the Ana meeting from B3 if still
there).
Say: "What do I have on Sunday?" Expect: "Nothing on your calendar for that." in words, not silence.

D5. **Next week.**
Say: "What does next week look like?"
Expect: Globex quarterly review on Monday 15:00 at Globex HQ and the moved Luis demo. A long list
may be summarised with "and N more"; the first items must be named.

D6. **Cancelled meetings disappear.**
Cancel "Lunch with Marta" from its detail screen. Say "What do I have today?" again.
Expect: Lunch is no longer named.

D7. **Repeating meetings in context.**
Say: "Skip the standup tomorrow."
Expect: a card that affects only tomorrow's occurrence (the assistant may ask "this one or all?";
answer "just this one"). Confirm. Then ask "What do I have tomorrow?" Expect: standup is not named.

D8. **Complete, postpone, reopen.**
- "Mark Send October invoice as done." Expect: a card, confirm, task shows completed. Ask "What is
  overdue?" Expect: nothing overdue now.
- "Push Prepare the proposal to Thursday morning." Expect: a card with the new date, confirm.
- "Reopen the invoice task." Expect: a card, confirm, it is open again (and overdue again).
- "Delete the room booking task." Expect: a card, confirm, gone.

## Part E. Evening: the daily briefing and the alert engine (week 4)

E1. Settings > Alerts: turn on Daily briefing, set the time 3 minutes ahead. Press Home.
Expect: at that minute a notification "Your briefing" listing today and the next two days, with
the meetings and the open tasks that are due.

E2. Swipe the app away from recent apps (closed completely). Reopen, set the briefing 3 minutes
ahead again, close completely, wait.
Expect: the notification still arrives.

E3. Open the app. Expect: Daily briefing is still ON with the time you set (this was the reset
bug). Change the time to 08:00 and leave it on.

E4. Add a task with a reminder 2 minutes ahead: "Remind me in 2 minutes to send the contract."
Lock the phone. Expect: the reminder rings on the lock screen like a meeting alert.

E5. Create a meeting 3 minutes ahead by voice, confirm, lock the phone. Expect: the meeting alert
fires as it did in version 1.4.

**E6. Status notification (week 5, builds from 20261020 on).** Settings > Alerts > turn on the
status notification. Press Home. Expect a silent, non-dismissable notification in the shade
saying alerts are on and naming the next meeting with its time. Create a meeting earlier than
that one; the notification text should update within a few seconds. Swipe the app away from
recent apps; the notification must stay. Turn the setting off; it must disappear.

## Part F. The Spanish pass

Settings > Language > Español. Check the dashboard, tasks, calendar and settings are in Spanish.

F1. Say: "Qué tengo hoy?" Expect: a spoken Spanish reply naming the meetings with their times.
F2. Say: "Agenda una llamada con Luis el jueves a las 9 y añade una tarea el día antes para preparar el presupuesto."
Expect: two cards in Spanish, task linked.
F3. Say: "Sí, confirmo." Expect: both execute.
F4. Say: "Mueve la llamada con Luis al viernes a las 10." Expect: a card and the question
"Muevo también 'Preparar el presupuesto'?". Say "sí". Expect: both moved.
F5. Create a card ("Crea una reunión llamada Prueba mañana a las 2"), then say "sí pero más tarde."
Expect: nothing executes, the card stays or a later-time card appears.
F6. Say: "Qué tareas tengo atrasadas?" Expect: the overdue task named. Say: "Qué tengo el domingo?"
Expect: "No tienes nada en el calendario para eso."
F7. Settings > Language > English. Expect: everything returns to English.

## What to report

A list like this:

```
B1 pass 10:04
B6 FAIL 10:12 (no task question)
D1 pass 10:31
E1 pass 18:03
```

Plus screenshots of: the two cards from B1, the move question from B6, a qualified answer from C2
with the card still on screen, the spoken agenda from D1, and the briefing notification from E1.
Those five pictures are also the evidence for the client.
