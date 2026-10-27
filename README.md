# MeetingGuard AI

MeetingGuard AI is a meeting assistant for iPhone and Android. It keeps your meetings in one place,
syncs them with Google Calendar, Outlook and the calendars on your phone, and makes sure you never
miss one: alarms that ring even when the app is closed, including full-screen alarms over the lock
screen on Android. An AI assistant creates, moves and shares meetings from plain text or voice, and
nothing changes until you confirm it. English and Spanish.

- Package / bundle id: `com.meetingguard.ai`
- Client: Francisco Maldonado, Aeternum Tech Ltd. Developer: Dusko.
- Branch `v2` is the current work. `main` holds the released version 1.

## Version 1: released

Version 1 is the rebuilt app (Expo SDK 57, Firebase): meetings, calendar sync, alerts and
full-screen alarms, recurring meetings, notes, the AI assistant for meetings, subscriptions, and the
WhatsApp bot.

- **Google Play:** v1.4.0 in production since October 6, 2026.
- **App Store:** v1.4.0 submitted on October 8, 2026, in Apple's review queue.
- Google sign-in and calendar access are verified by Google.

Everything written for version 1 lives in [`docs/v1/`](docs/v1/): architecture, setup, deployment,
testing, the admin dashboard and the handoff notes.

## Version 2: in progress

Version 2 turns the assistant into a conversational agent for meetings, tasks and commitments, in
four stages:

1. **Stage 1, the core agent:** two-way voice conversation, tasks with reminders, combined requests
   ("book the call and add a task the day before"), agenda questions and a daily briefing.
2. **Stage 2, external tasks and follow-through:** Google Tasks and Microsoft To Do sync, Outlook
   calendar, personal debriefs after a meeting, the running-late flow.
3. **Stage 3, languages and WhatsApp:** Portuguese, Hindi, and the full agent over WhatsApp.
4. **Stage 4, guest links and more languages:** invitation links guests can answer without the
   app, French, German, Mandarin.

The plan also adds an interface modernization and a feature that turns the meeting summaries from a
notetaker into tasks with alarms.

Stage 1 (weeks 1 to 5) is released. The working plan for weeks 6 to 17, the scope and price
record and the client's V2 roadmap are in [`docs/v2/`](docs/v2/), starting with
`docs/v2/Project-Plan-2026-10-25.docx`.

## Where things are

| You want | Look at |
|---|---|
| What changed, version by version | `CHANGELOG.md` |
| The working plan, weeks 6 to 17 (overview, per-developer weeks, to-do lists) | `docs/v2/Project-Plan-2026-10-25.docx` |
| The consolidated plan and schedule after the client approved the landing page and web agenda (October 27): every milestone with owner, date, acceptance criteria, payment and dependencies; payments received and ahead; launches; languages dated; bug-fix coverage. Same data as Excel and calendar files (generators: scratchpad schedule-data.js, make-schedule*.js) | `docs/v2/Consolidated-Schedule-2026-10-27.docx`, `docs/v2/MeetingGuard-Schedule-2026-10-27.xlsx`, `docs/v2/MeetingGuard-Schedule-2026-10-27.ics` |
| The revised plan of October 26 (assistant postponed); superseded by the consolidated schedule | `docs/v2/Revised-Plan-2026-10-26.docx` |
| Superseded on October 26 evening, kept for the assistant design notes: the proposal (assistant, website, operating costs, security), the milestone plan with payment column, the scope and payment breakdown | `docs/v2/Proposal-Francisco-2026-10-26.docx`, `docs/v2/Milestones-and-Payments-2026-10-26.docx`, `docs/v2/Payment-Breakdown-2026-10-26.docx` |
| The agreed scope, prices and the status of weeks 1 to 5 | `docs/v2/PLAN.md` |
| The client's V2 roadmap | `docs/v2/MeetingGuard_Roadmap_for_Dusko-7.docx` |
| How the app is built | `docs/v1/ARCHITECTURE.md` |
| Console setup, deployment, testing | `docs/v1/` |
