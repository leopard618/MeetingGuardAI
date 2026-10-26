# Stage 1 acceptance: recording checklist

How Stage 1 is closed (milestone M1, October 30, 2026): Dusko runs the lines below on a physical
phone with the screen recorded, fills the pass/fail column with the phone clock time, and sends
Francisco the recording plus this list. Francisco checks what he wants on his own iPhone and
confirms acceptance in writing in the group. No meeting is needed unless he asks for one.

Build: the Play production release 1.5.0 (26) on Android; the App Store build 1.5.0 (10) on
iPhone once Apple approves it (TestFlight before that). Language: English, then the Spanish lines.
Full step detail and example sentences: `TEST-GUIDE-STAGE1.md`; the agreement lines and the
evidence per line: `RELEASE-1.5.0.md` section 5.

| # | Agreement line | What the recording shows | Pass / fail, time |
|---|---|---|---|
| 1 | Voice conversation in English and Spanish | Ask for tomorrow's agenda by voice in English, then in Spanish; the list is spoken back in each language. | |
| 2 | Nothing is saved until confirmed | Say "Book a call with Ana tomorrow at 10"; the card appears; nothing is in the calendar until "yes, confirm". | |
| 3 | Confirmed and cancelled by voice | Confirm one proposal by voice (it executes); propose another and say "cancel" (nothing is created). | |
| 4 | An unclear reply never executes | Propose a meeting and answer "yes but make it earlier"; the card stays, nothing is created, the assistant asks again. | |
| 5 | Tasks: create, edit, postpone, complete, delete | One task through all five by voice or by typing; the list and the calendar reflect each step. | |
| 6 | Task reminders ring through the alarm engine | A task reminder two minutes ahead; lock the phone; the reminder rings on the lock screen. | |
| 7 | One sentence, two things | "Book the call with Ana on Wednesday at 10 and add a task the day before to prepare the proposal": two cards; after confirming, the task shows its meeting and the meeting lists the task. | |
| 8 | Moving a meeting asks about its task | Move that meeting; the reply asks about the task by name; "yes" moves the task too, keeping the gap. | |
| 9 | Agenda: today | "What do I have today?" answered aloud with the real items, repeating meetings included. | |
| 10 | Agenda: overdue | "What is overdue?" answered aloud with the overdue task. | |
| 11 | Agenda: tomorrow, and an empty day | "What should I prepare for tomorrow?" answered aloud; an empty day is answered as "nothing". | |
| 12 | Daily briefing | Briefing time set three minutes ahead, app closed; the briefing notification arrives. | |
| 13 | Full-screen morning summary (Android) | "Show full screen" on, phone locked; the summary takes over the lock screen at the set time. | |
| 14 | Status notification | On in Settings > Alerts; it stays in the shade with the app closed and updates when a meeting is added. | |
| 15 | WhatsApp on the business number | Message +44 7403 693109 from a linked number; the bot replies; a meeting created by message appears in the app after Confirm. | |
| 16 | Released to both stores | Play listing shows 1.5.0; App Store shows 1.5.0, or the "Waiting for Review" screen if Apple has not finished. | |

Spanish pass: repeat lines 1, 2, 7 and 9 in Spanish.

Evidence kept with the sign-off: the recording (with sound), the lock-screen photos for lines 6
and 13, the console screenshots for line 16, and Francisco's written acceptance message.
