# Stage 3 acceptance: recording checklist

How Stage 3 is closed (milestone M13, Complete-Plan-2026-11-10.md part 2): Dusko runs the lines
below on a physical phone with the screen recorded, fills the pass/fail column with the phone
clock time, and sends Francisco the recording plus this list. Francisco checks what he wants on
his own phone and confirms acceptance in writing in the group. Payment 10 (USD 550, M13) is
released on that written acceptance.

Stage 3 covers M10 (summaries arrive), M11 (summaries become commitments), M12 (the languages
and the Hindi and Mandarin verdicts) and M13 (WhatsApp complete). Build: the Stage 3 store build
(1.7.0) on Android and iPhone, TestFlight and internal testing before the stores approve it. Full
step detail: `TEST-GUIDE-STAGE3.md`; the release runbook: `RELEASE-1.7.0.md`.

Before line 13 the WhatsApp templates must be approved by Meta (`WhatsApp-Templates-2026-11-12.md`)
and the server switched to live mode; until then lines 13 to 18 are recorded in preview mode
(the same messages, sent inside the 24-hour window) and recorded again in live mode.

| # | Agreement line | What the recording shows | Pass / fail, time |
|---|---|---|---|
| 1 | M10: a private forwarding address | Settings > Meeting summaries shows the private address (blurred in the recording) and the Fathom connection. | |
| 2 | M10: a summary arrives and is matched | A real Fathom (or forwarded) summary of a meeting held today appears under that meeting within a few minutes. | |
| 3 | M10: an unmatched summary waits in the inbox | A summary with no meeting at that time is in the summary inbox and can be attached or kept. | |
| 4 | M10: a fake summary is kept out | A forwarded copy that fails the checks never appears (the summary inbox stays unchanged). | |
| 5 | M10: deletable | Delete one summary; it is gone from the meeting and the inbox. | |
| 6 | M11: commitments proposed with their sentence | Open the matched summary, Suggest tasks; each card names who, what, by when and shows the sentence it came from. | |
| 7 | M11: accept all, or edit or drop | Edit one, drop one, accept the rest; the tasks appear linked to the meeting with reminders. | |
| 8 | M11: the same on WhatsApp | Write "commitments" to the bot; the list arrives; reply with the numbers; the tasks appear in the app. | |
| 9 | M12: Portuguese, French, German everywhere | Switch the app language to each: dashboard, a confirmation card, a reminder and the voice assistant answering in that language. | |
| 10 | M12: the store listings | Play Console and App Store Connect show the listing in the five languages. | |
| 11 | M12: Hindi verdict | `M12-VERDICT-HINDI.md` part 2 filled in after the sessions with real speakers. | |
| 12 | M12: Mandarin verdict | `M12-VERDICT-MANDARIN.md` part 2 filled in after the sessions with real speakers. | |
| 13 | M13: a voice note becomes a meeting | Send the bot a voice note "Lunch with Ana tomorrow at 1 pm"; it answers with what it heard and the Confirm button; after Confirm the meeting is in the app with its alarms. | |
| 14 | M13: a voice note becomes a task | Voice note "Remind me to send the contract on Friday at 10"; Confirm; the task is in the app. | |
| 15 | M13: only users who opted in | Before turning anything on, nothing arrives. Settings > Integrations > WhatsApp assistant > Messages from Meeting Guard AI: turn on Daily agenda; the welcome message arrives. | |
| 16 | M13: the daily agenda | At the briefing time the agenda arrives; tap "See my day"; the full list comes back. | |
| 17 | M13: the debrief prompt | 5 minutes after a meeting ends the prompt arrives; tap Debrief, say or write who does what; the proposed tasks come with the Confirm button. | |
| 18 | M13: task reminders | A task accepted from a summary with a reminder in 5 minutes; the reminder arrives; tap "Mark as done"; the task is done in the app. | |
| 19 | M13: the stop keyword | Write STOP; the bot confirms; every switch in the app is off; no further messages arrive; the assistant still answers a normal question. | |
| 20 | M13: one set of records | The meeting and task from lines 13 and 14 are the same records in the app, on the web agenda and in the synced calendars. | |
| 21 | M13: the admin WhatsApp panel | The admin dashboard WhatsApp tab shows the linked users, the opt-ins, the sends of lines 15 to 18 with their delivery status, and the template states. | |
| 22 | Stage 3 release | Play Console shows 1.7.0 in production; App Store Connect shows 1.7.0 approved or live. | |

Language passes: repeat lines 13, 16 and 19 in Spanish (the templates are English and Spanish;
users in Portuguese, French and German get the English templates and the in-chat answers in their
own language, `WhatsApp-Templates-2026-11-12.md` question 10), and lines 6 and 9 in Portuguese,
French and German.

Evidence kept with the sign-off: the recording (with sound), the WhatsApp chat screenshots for
lines 13 to 19, the admin panel for line 21, the console screenshots for lines 10 and 22, the two
verdict forms, and Francisco's written acceptance message.
