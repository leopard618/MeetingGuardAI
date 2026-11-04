# Stage 2 acceptance: recording checklist

How Stage 2 is closed (milestone M9, the agreement's November 27 line): Dusko runs the lines
below on a physical phone with the screen recorded, fills the pass/fail column with the phone
clock time, and sends Francisco the recording plus this list. Francisco checks what he wants on
his own phone and confirms acceptance in writing in the group. Payment 9 (USD 550) is released
on that written acceptance.

Build: the Play production release 1.6.0 on Android (staged rollout started); the App Store
build 1.6.0 on iPhone once Apple approves it (TestFlight before that). Language: English, then
the Spanish lines. Full step detail: `TEST-GUIDE-STAGE2.md`; the runbook and the release notes:
`RELEASE-1.6.0.md`.

| # | Agreement line | What the recording shows | Pass / fail, time |
|---|---|---|---|
| 1 | M6: a meeting created in the app appears in Outlook | Create "Nexa kickoff" in the app with a Teams call; Outlook web shows it at the same time as an online meeting. | |
| 2 | M6: an Outlook edit appears in the app; alarms follow | Move it in Outlook web; the app shows the new time and the scheduled alarms moved with it. | |
| 3 | M6: no duplicates after the soak | After a day with Outlook connected, the meetings list, Outlook, Google Calendar and the phone calendar each hold every meeting once. | |
| 4 | M7: the list choice is shown before confirming | Assistant: "add a task to prepare the Globex deck"; the confirm sheet names the To Do list before Confirm. | |
| 5 | M7: a task created in the app appears in the chosen list | The same task is in that list in Microsoft To Do. | |
| 6 | M7: completing it in either place syncs within a minute | Complete one task in the app and another in To Do; each is done on the other side within a minute. | |
| 7 | M7: a task completed in To Do silences its alarm | A task with a reminder three minutes ahead completed in To Do; the reminder does not ring. | |
| 8 | M8: Google Tasks syncing on a test account | On the test account: a task created in the app appears in Google Tasks and a Google edit comes back. | |
| 9 | M8: a spoken debrief becomes confirmed, linked tasks with reminders | Open an ended meeting, speak three commitments, review the cards, confirm; the tasks show the meeting and carry reminders. | |
| 10 | M8: nothing saved before confirmation | After "Create tasks", before Confirm: the Tasks screen has nothing new. | |
| 11 | M9: pick 5, 10, 15 or 30 minutes | Dashboard > Running late; the four chips; tap 10 min. | |
| 12 | M9: a ready message in your language with the title and the new time | The message names the meeting and the start plus ten minutes; edit a word. | |
| 13 | M9: sent from your phone through the share sheet | Share message > WhatsApp; back in the app the sheet reports what the phone reported (handed over on Android, confirmed on iPhone), never "delivered". | |
| 14 | M9: the meeting moves only if you confirm | After sending, nothing has moved; tap Move; the dashboard and Google Calendar show the new time; Keep the time on a second meeting leaves it unchanged. | |
| 15 | M9: End meeting now (client request) | On the running meeting tap End now and confirm; "Happening now" clears. | |
| 16 | Stage 2 release | Play Console shows 1.6.0 in production (staged rollout); App Store Connect shows 1.6.0 submitted, or live if Apple has finished. | |

Spanish pass: repeat lines 4, 9 and 12 in Spanish.

Evidence kept with the sign-off: the recording (with sound), the Outlook and To Do screenshots
for lines 1, 2 and 5, the debrief cards for line 9, the sheet after sharing for line 13, the
console screenshots for line 16, and Francisco's written acceptance message.
