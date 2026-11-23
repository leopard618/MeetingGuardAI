# Stage 4 and final acceptance: recording checklist

How Stage 4 and the agreed scope are closed (milestone M14, Complete-Plan-2026-11-10.md part 2):
Dusko runs the lines below on physical phones with the screen recorded, fills the pass/fail column
with the phone clock time, and sends Francisco the recording plus this list and the handover
document (`HANDOVER-FINAL.md`). Francisco confirms the Stage 4 and final acceptance in writing in
the group. The final payment (USD 700, M14) is released on that written acceptance, and the 60
days of bug fixes start that day.

Build: 1.7.0 from the stores (or TestFlight and internal testing before approval). Full step
detail: `TEST-GUIDE-STAGE4.md`; the runbook: `RELEASE-1.7.0.md`.

| # | Agreement line | What the recording shows | Pass / fail, time |
|---|---|---|---|
| 1 | M14: the guest answers from a phone browser, without installing anything | A new meeting with a guest; the invitation carries the reply line; the guest's phone opens it without the app and sees title, time and organizer only. | |
| 2 | M14: accept and decline | The guest accepts; then another guest declines. | |
| 3 | M14: you are notified | With the app open the notification arrives within seconds; meeting details shows both answers. | |
| 4 | M14: propose another time | The guest proposes tomorrow at 16:00 with a note; the app shows the proposal. | |
| 5 | M14: only a proposal you approve changes the meeting | Keep the time: nothing changes. Approve a second proposal: the meeting moves. | |
| 6 | M14: your alarms and synced calendars follow it | After the approval the alarms show the new time and Google Calendar or Outlook shows it; the guest gets the updated invitation. | |
| 7 | M14: the link closes | Turned off, cancelled and past meetings give the closed pages. | |
| 8 | M14: in every language | The guest page in English, Spanish, Portuguese, French and German. | |
| 9 | Final test pass, every language, both platforms | The parts of TEST-GUIDE-STAGE4.md F1 passed (recorded in the test log, not on video). | |
| 10 | Accessibility | Screen reader on the meeting form and guest replies; the largest font; both themes (F2). | |
| 11 | Performance | Cold start, the list of 300 meetings, an alarm with the app closed (F3). | |
| 12 | Admin dashboard additions | The WhatsApp tab, the Alerts health tab and the user page. | |
| 13 | The final store release | Play Console and App Store Connect show 1.7.0 live. | |
| 14 | The handover document | `HANDOVER-FINAL.md` sent with this list. | |

Known limits stated with the acceptance: with the app closed, a guest's answer is shown the next
time the app opens (server push comes with the assistant, A8); proposals are for one-off
meetings (a series takes accept and decline).

Evidence kept with the sign-off: the recording (with sound), the guest page screenshots in the
five languages, the calendar screenshots for line 6, the admin screenshots for line 12, the
console screenshots for line 13, and Francisco's written acceptance message.
