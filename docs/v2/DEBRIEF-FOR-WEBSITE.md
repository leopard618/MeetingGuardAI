# The post-meeting debrief, as the app really does it (for the website)

Written for Sven, for the landing page feature card and the "How it works" story. Every line
here matches the app (docs/v1/ARCHITECTURE.md section 29, docs/v1/TESTING.md T23). Francisco asked
for an accurate description, so the website must not promise more than this.

## In one sentence

After a meeting you tell the assistant what was agreed, by voice or by typing, and it proposes
follow-up tasks linked to that meeting; nothing is saved until you confirm each one.

## How the user gets there (two ways, both need a tap)

1. From the meeting. Once the meeting has ended, its details screen shows a button "Debrief this
   meeting". Tapping it opens the assistant with the debrief panel for that meeting. The button
   never appears on a meeting that has not ended, nor on a cancelled one. A repeating meeting
   offers it once its first occurrence has started.
2. From the reminder. Five minutes after the meeting ends, the app sends the notification
   "How did <meeting> go?" (when follow-up reminders are on, which is the default). Opening it
   brings up the assistant with a banner that has a "Debrief" button. Tapping that opens the same
   panel.

So: the app reminds the user automatically, but the debrief itself always starts with a tap.
There is no automatic recording and no listening in the background. Say that plainly.

## What happens in the panel

- The panel names the meeting, shows a short hint, an empty text box and a microphone button.
- Voice: the user taps the microphone and speaks naturally, in one go, as to a colleague. Speech
  recognition runs on the phone. Listening stops by itself after a pause, or at 60 seconds. The
  recognised text lands in the box. Nothing is sent yet.
- Typing: the user can type or paste instead of speaking, or fix a misheard word in the box.
- The user taps "Create tasks". Only then is the text sent to the assistant, together with the
  meeting it belongs to. Up to 4000 characters.

## What comes back

- One proposed task per commitment in the text, as cards: a title that starts with a verb, the
  owner when a name was said (a participant of the meeting or a name in the text), the due date
  when a deadline was said ("by Friday", "next week", "tomorrow" are resolved to real dates), and
  the meeting it belongs to. No date is invented when none was said.
- When a task sync is on, each card also shows the Microsoft To Do list or Google Tasks list it
  will go to.
- If the user explicitly asked for a follow-up meeting ("let's meet again on the 20th"), a
  meeting proposal card can appear too.
- If nothing in the text is a commitment, the assistant says so and proposes nothing.
- The assistant only proposes in a debrief. It never deletes, moves or changes anything on its
  own, even if the spoken text asks for it.

## Confirmation, the part to stress

- Each card has Review and Confirm, and Reject. "Review all" confirms several at once. The
  spoken "yes, confirm" works too.
- Nothing exists until a card is confirmed. The Tasks screen shows nothing new before that.
- A confirmed task is created linked to the meeting (the meeting's details list its tasks), gets a
  reminder like any task, and reaches Microsoft To Do or Google Tasks through the normal sync when
  one is connected.
- A rejected card is simply dropped.
- The same meeting can be debriefed again later.

## Languages and limits

- English and Spanish: panel, speech recognition and the proposed titles follow the app language.
- One debrief is one AI action of the user's plan (same allowance as any assistant request).
- If the phone is offline when "Create tasks" is tapped, the message shows "Not sent" with Retry;
  the same text is sent again when back online.

## Wording the website may use

- "After the meeting, say what was agreed. Meeting Guard turns it into follow-up tasks with owners
  and due dates, linked to the meeting. You confirm each one before anything is created."
- "Five minutes after a meeting ends, the app asks how it went. One tap opens the debrief."
- "Speak or type. The text stays on the phone until you tap Create tasks."

## Wording to avoid

- "Records your meeting", "transcribes the call", "listens to the meeting": it does not. It
  captures what the user says afterwards.
- "Automatically creates tasks": the user confirms every one.
- "Meeting minutes" or "summary": the output is tasks, plus a short reply.

## The three-step story Francisco asked for

Prepare (meetings from Google Calendar, Outlook and the phone, with preparation tips and notes)
-> arrive on time (alarms that ring, running late in one tap) -> turn agreements into follow-up
tasks (the debrief, synced to To Do and Google Tasks). The debrief is step three.

## Attachments, since Francisco raised them in the same message

Personal notes on a meeting sync between the user's devices. Document attachments are stored on
the phone where they were added only: they are not uploaded, do not reach the other devices and
are not shared with participants. The website should say exactly that.
