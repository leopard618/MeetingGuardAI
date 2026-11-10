# Meeting Guard AI

## The AI executive assistant: what it does, the plan and the price

Prepared by Dusko and Sven for Francisco Maldonado, Aeternum Tech Ltd. November 9, 2026. This answers your messages of November 5 and November 9. All amounts in US dollars.

**Short answer.** You hand the assistant a matter, by voice or text, and it runs that matter by email until it is done. It writes to the people involved, follows up, books the meeting and turns promises into tasks, always inside limits you confirm and keeping you informed. Our best price is USD 4,950: 9 milestones of USD 550, USD 1,100 less than on October 26. Part 2 lists every task it performs.

## In one glance

| Part | Milestones | Price | Who | Timing |
|---|---|---|---|---|
| Prototype: a delegated matter by email, from your words to a booked meeting, demonstrated live | A1 to A4 | USD 2,200 | Sven | Demonstrated about 3 weeks after your go |
| Production: safety, your mailbox, briefings, the server side finished, the assistant inside the app with its subscription | A5 to A8 | USD 2,200 | Sven A5 to A7, Dusko A8 | About 4 weeks after your go on production |
| Beta and public release | A9 | USD 550 | Dusko, with Sven's support included | About 3 weeks; paid at your final acceptance of the assistant |
| Total | 9 milestones | USD 4,950 | Sven USD 3,850, Dusko USD 1,100 | About 10 weeks from your first go, plus the days you take to decide after the demonstration |

On October 26 the same assistant was 11 milestones and USD 6,050. This plan is 9 milestones and USD 4,950, USD 1,100 less, with the same capabilities. The reason is in part 4: two milestones are no longer needed because the app already has those pieces.

Production starts only after you have seen the prototype work and said go. If you stop after the prototype, nothing more is charged.

## 1. What the assistant is

An optional premium module inside Meeting Guard AI. You delegate a matter to it, by voice or by typing, in English or Spanish, and it handles that matter by email until it is done: it writes to the people involved, reads their replies, follows up, books the meeting, turns promises into tasks with reminders, and tells you what is happening. It works only inside the limits you confirm for each matter (the mandate), keeps you informed of every email it sends, and stops to ask you whenever something falls outside those limits.

It is sold as its own subscription, separate from Pro and Premium, so a user can hold both.

## 2. What it will do: the specific tasks

| You say or do | What the assistant does |
|---|---|
| "Contact Carlos, ask for the updated proposal, set up a meeting to discuss it, and follow up until Friday. Keep me copied." | Turns it into a matter with a mandate: who may be contacted, what may be asked, which times may be offered, how often to follow up, until when. If something is missing (which Carlos, his email address, an end date), it asks first. It reads the mandate back to you, and nothing is sent until you confirm. |
| You confirm the mandate | Writes and sends the first email from its own address, which says it is your AI assistant, and keeps you informed: a copy of each email by default, or a daily summary if you prefer. When you allow it for that matter, it sends from your connected Microsoft mailbox instead, with a line saying an AI assistant drafted it. The sending address stays the same for the whole matter. |
| Carlos replies with a question the mandate covers | Reads the reply in the context of the thread and the mandate and answers within it. Any commitment (who, what, by when) is proposed as a task with a reminder, linked to the matter, which you confirm with one tap. |
| Carlos does not reply | Sends the follow-up on the agreed schedule and stops at the end date. If Carlos asks it to stop, it stops and tells you. |
| Carlos proposes a time, or asks for options | Checks your availability in Meeting Guard AI, including your Google and Outlook calendars as of your phone's last sync, and offers two or three free times, written with the time zone. The meeting counts as agreed only when Carlos picks one; then it creates the meeting with its linked tasks and reminders and sends the confirmation. |
| Carlos asks for a payment, a discount or a contract change, asks something the mandate does not cover, proposes a time that does not fit, copies in someone new, or replies in a way it cannot read with confidence | Stops. Nothing is sent. You get an approval card with the question and the options; it continues only on your answer. |
| "What is happening with Carlos?" | Answers aloud from the matter's history: what was sent, what came back, what is promised, what waits for you. You can interrupt it with a tap or by speaking, and it stops and listens. |
| "Pause the Carlos matter", "resume it", "move the deadline to Monday", "stop following up", "cancel it" | Applies it, by voice, by text or on the matter page. A change rewrites the mandate, which is read back and confirmed before it applies. A paused or cancelled matter sends nothing; a cancelled one closes with a note in its timeline. |
| "Watch this thread" on a conversation in your Microsoft mailbox | Reads new messages in that thread only and drafts a reply as an approval card. It sends only after your approval, or within a mandate you confirmed. |
| Before a meeting it arranged, or when you ask about any meeting | Gives you a briefing: who, why, the correspondence, open commitments and decisions pending, as a notification and read aloud on request. |
| Every morning, at your daily briefing time | Sends its digest as a notification: what moved overnight, what needs you today, follow-ups due, meetings it arranged. Read aloud on request, and on WhatsApp for linked users once the Stage 3 daily agenda is live. On Android, the full-screen morning summary you asked for on October 21 (in the app since 1.5.0) opens the app, where the digest is shown in full; on iPhone it is a notification, by Apple's rules. |
| Settings | You set the follow-up cadence, working hours and quiet days, the language of its emails, the signature, the copy rule (a full copy or a daily summary, never off), default mandate limits and the sending identity. Changes apply to new matters and, if you choose, to open ones. |
| Any matter | Keeps a timeline: every action, email in and out, approval, commitment and decision waiting for you. A failed send or booking shows there and as a notification, with retry or cancel. |

## 3. The rules it follows, and what comes later

Never, by design: pay, accept a price or negotiate money; agree to or sign anything contractual (such language is blocked in its drafts); promise dates, deliveries or information for you beyond what the mandate says; contact anyone outside the mandate without your approval; send from your own mailbox unless you connected it and allowed it for that matter; tell you something is done before it really is. The AI only suggests. A separate check in our own code decides whether anything may be sent or booked, against the limits you confirmed.

Your V2 rule that every outgoing message and every new meeting or task needs your approval is kept this way. Confirming the mandate is that approval, and it covers only what the mandate lists: the first email, the follow-ups on the agreed schedule, the times it may offer, and booking the time the contact picks, with its confirmation email. Commitments become tasks only when you confirm them. Everything else waits for an approval card.

Every commitment it proposes shows the email and the sentence it came from. Briefings and spoken answers use only the matter's own records and your meetings, never anything invented.

Not in this price, for a later phase: whole-inbox triage (it watches only the threads you pick); assistant workflows on WhatsApp; shopping, travel or restaurant booking; languages beyond English and Spanish; a continuous phone-call style voice conversation (the prototype measures its cost per minute, then we quote it as an optional add-on so you decide with numbers).

Gmail: for the assistant to send from a user's Gmail and read the replies there, Google must approve a restricted permission, and the app must pass an independent security assessment by a Google-approved assessor, repeated every 12 months, with the fee paid to the assessor each year (typically a few hundred to low thousands of dollars). Watching Gmail threads follows the same approval. Google's review usually takes two to six weeks after submission. We prepare the application inside A5 and write the privacy wording it needs, confirm the assessor's fee with you before submitting, and you submit it as the owner of the Google Cloud project. Until Google approves, Gmail users use the assistant address, which works for everyone from day one.

## 4. Why the price is lower than on October 26

Since October 26, Apple approved 1.5.0 with its subscriptions, the AI allowances went live on November 5, and 1.6.0 added the rest. Two of those pieces replace milestones of October 26:

- Allowances and metering: the monthly AI allowances, the per-user counters, the plan checks on the server and the project-wide daily cap on AI requests that limits spend. The assistant adds its own counters (matters, emails, voice minutes) to them inside A5, so the separate metering milestone is gone.
- The store subscription: the four plans approved in both stores, with purchases and plan status handled through RevenueCat, and allowances that follow each subscriber's own subscription month. The Assistant subscription, its allowances and top-ups are built on that base inside A8, so the separate subscription milestone is gone.

Other pieces make the plan safer, though they do not shorten it:

- Microsoft: sign-in with Microsoft and the Outlook and To Do connection are in 1.6.0, with the Microsoft app registration and consent screen. Today that connection lives on the phone, with calendar and task permissions only. Sending from your mailbox (A6) adds two mail permissions, send and read, to the same registration, and you connect your Microsoft account once more to grant them. Microsoft's screen says the app may read your mail; the assistant opens only the threads of your matters and the ones you pick. The access is kept encrypted on the server, so the assistant can act while your phone is off. Company accounts need Aeternum Tech to be a verified publisher at Microsoft and, where the company blocks user consent, its administrator's approval.
- Commitments: the debrief in 1.6.0 already finds who owes what by when and turns it into tasks you confirm. The assistant uses the same rules and task format for commitments found in replies.
- Also reused: voice in English and Spanish, the confirmation cards and the server checks behind them, your daily briefing time and the full-screen summary on Android, and your meetings on the server, which already include the events the app imports from Google Calendar, Outlook and your phone's calendar.

## 5. The milestones

Each milestone ends with a recorded demo on a real phone and a code push; its USD 550 is released then, as in our existing agreement. A9 is paid at your final acceptance of the assistant.

### Prototype (Sven), USD 2,200, demonstrated about 3 weeks after your go

The 3 weeks count from the day the mail records and the email provider account in part 8 are in place.

| Milestone | What it delivers |
|---|---|
| A1. The assistant's email identity | A dedicated address per user on a Meeting Guard AI mail subdomain, with a display name that says it is an AI assistant acting for you (for example, Francisco's AI assistant); you informed of every email (a copy by default, or a daily summary); replies come back and attach to the right matter; bounces handled; a daily send cap per user. SPF, DKIM and DMARC on the subdomain, so the app's other mail is never affected, and a slow start at low volume to build its sending reputation. One email provider account serves both the assistant and the forwarded meeting summaries of the agreed scope: whichever is built first sets it up, the summaries never wait for the assistant, and nothing is charged twice. |
| A2. The delegated matter and its mandate | Your words become a matter with a mandate (who, what, which times, how often, until when); missing details asked first; read back and confirmed before anything is sent. Pause, resume, change and cancel by voice or text. |
| A3. Replies, follow-ups and safety | Each reply read against the thread and the mandate; commitments proposed as linked tasks with reminders for your confirmation; the next step within the mandate taken; follow-ups on the cadence, stopping at the end date or when the contact asks. Every email says whom it acts for and that an AI assistant wrote it. Anything outside the mandate or unclear becomes an approval card. Tested against hostile emails, including one pretending to come from you. |
| A4. Scheduling, voice, history and the demonstration | Availability from your meetings in Meeting Guard AI, including the events imported from your connected calendars; two or three free times offered with the time zone; the chosen one booked with linked tasks and reminders; the confirmation sent, with the guest invitation link once the Stage 4 links are live. Delegation and status questions by voice in English and Spanish, with spoken answers you can interrupt. The timeline per matter. The live demonstration below, with the measured cost per matter and per minute of the natural-voice option. |

The live demonstration (the Carlos scenario) runs on a real phone, once in English and once in Spanish, with the delegation once by voice and once by text:

1. You delegate the Carlos request; the mandate is read back; you confirm.
2. The first email reaches the contact, and your copy reaches you, within one minute.
3. The contact replies with a question; the assistant answers within the mandate and proposes the commitment as a task.
4. No reply for the agreed interval; the follow-up goes out on schedule.
5. The contact proposes a time; the assistant checks availability, confirms, and the meeting appears in Meeting Guard AI with linked tasks and reminders.
6. The contact asks for a payment; the assistant stops and you see an approval card.
7. You ask by voice what is happening; it answers aloud from the history; you interrupt it, by voice or with a tap, and it listens.
8. The measured cost of the matter (model, voice, emails) is shown.

Not in the prototype: sending from your own mailbox, watched threads, briefings and the digest, the assistant screens in the app (the demonstration shows the timeline on a simple page), and the subscription. These come in production. Then you decide on production.

### Production, USD 2,200, about 4 weeks after your go on production

| Milestone | Who | What it delivers |
|---|---|---|
| A5. Security, limits and metering | Sven | A written threat model for email as an open channel (fake senders, hidden instructions inside emails, data leaks, misuse of the sending domain), with a control for each, reviewed and signed by Dusko; hard mandate limits; financial and contractual language blocked in drafts; hostile-email tests in English and Spanish. Retention and deletion: email texts kept while a matter is open and for a set period after it closes (90 days suggested, yours to set), then deleted; a matter can be deleted at any time; deleting your account removes everything; mailbox access kept encrypted on the server, never visible in the admin, and removed when you disconnect. Every action counted on the allowance system 1.6.0 already runs; the per-user cost in the admin and a spend cap per user per day; the assistant behind an on/off switch; the Gmail application prepared. |
| A6. Your mailbox, watched threads, briefings, notifications | Sven | Sending from your connected Microsoft mailbox when you allow it per matter, and reading the replies there; "watch this thread" with draft replies as approval cards; briefings before the meetings it arranged and on request; the morning digest; notifications sent from the server for the digest, the briefings and new approval cards (today every notification in the app is scheduled on the phone itself); the preferences listed in part 2. |
| A7. The server side finished, and the texts | Sven | The server side finished and documented, so the app screens can be built on it; spoken answers in English and Spanish that start at once, instead of after the whole answer is ready; the privacy policy and terms updated for the assistant (what goes to OpenAI and to the email provider, how long emails are kept, that you are responsible for whom it contacts, and that it may not be used for marketing or bulk email); an assistant section on meetingguard.ai with the demonstration video; the Assistant plan's store text and screenshots in English and Spanish; the production checklist and a handover note for running it (mail domain health, bounces, cost). |
| A8. The assistant inside the app, with its subscription | Dusko | The matters list and timeline, approval cards, delegation by voice or text, pause, resume, change and cancel on the matter page, "watch this thread" from the matter page or a list of your recent conversations; settings (assistant address, connected sending account, default limits, preferences); the usage meter; a consent screen before first use saying your emails and the replies are processed by OpenAI through our server; the app receiving the server's notifications. The Assistant subscription in both stores (monthly and yearly) with its allowances, top-ups and a soft stop at the limit, built on the plans already live; Free, Pro and Premium untouched. Device attestation (App Check) switched on for the server functions before the public release. |

### Beta and public release, USD 550, about 3 weeks

| Milestone | Who | What it delivers |
|---|---|---|
| A9. Beta and release | Dusko, with Sven's support included | The release build goes through Apple and Google review with the assistant and its subscription visible to the reviewer and described in the review notes. The beta for you and a few users, a feedback form, daily review and corrections, the beta report. Beta exit: no data exposure, no action outside a mandate without approval, and the cost per matter within the estimate. Then your final acceptance of the assistant, and the public release to a growing share of users, watched on cost per matter, approvals, bounces and complaints, and switched off at once if something goes wrong. |

## 6. What it costs to run per subscriber

Estimates for one paying assistant subscriber per month, with the providers we propose at their list prices of October 26. There are no paying users yet whose usage we could measure, so these are still the October 26 estimates; the prototype replaces them with measured numbers.

| Component | Typical | Heavy |
|---|---|---|
| AI model (the OpenAI model the app uses today) | USD 0.28 | USD 1.42 |
| Voice in the app (speech on the phone, no per-minute cost) | USD 0.00 | USD 0.00 |
| Email (Postmark, share above its base plan) | USD 0.08 | USD 0.29 |
| Hosting, functions, database (Firebase) | USD 0.10 | USD 0.25 |
| Total | USD 0.46 | USD 1.96 |
| Natural-voice add-on, if chosen (about USD 0.03 a minute, preliminary) | USD 0.60 | USD 1.80 |
| Total with the natural-voice add-on | USD 1.06 | USD 3.76 |

Typical means 8 matters and 20 voice minutes a month, inside the suggested allowance. Heavy means 25 matters and 60 voice minutes, above it, so that subscriber buys top-ups. If assistant workflows later move to WhatsApp, add about USD 0.09 for a typical subscriber and USD 0.26 for a heavy one. One fixed cost on top: the email provider's base plan, about USD 16.50 a month for 10,000 emails, shared by all subscribers.

Suggested allowance for the Assistant plan: 10 matters, 30 voice minutes and 100 assistant emails a month, with top-ups in packs of 5 matters. The prices users pay are your decision. Against a monthly price like Premium's, even a heavy subscriber leaves a wide margin after the store's fee.

## 7. How it fits with the agreed work

Dusko's agreed scope (the Stage 2 close, Stages 3 and 4, and the summaries) and Sven's current work keep their order and their payments, and they come first. Nothing in them depends on the assistant. The prototype is Sven's work and starts on your go. Dusko joins at A8, when the server side is ready; we confirm that week at the demonstration, so it never pushes the agreed work.

## 8. What we need from you

- Your go on the prototype; after the demonstration, your go on production.
- At the start: the DNS records for the assistant's mail subdomain (we send the exact records), and an account with the email provider in Aeternum Tech's name (about USD 16.50 a month). The provider reviews new accounts before they can write to outside addresses, so we open it in the first days.
- Two test contacts for the demonstration.
- For production: a Microsoft test mailbox; the mail permissions (send and read) and the server settings added to the Microsoft app registration; Microsoft publisher verification for Aeternum Tech (a free Microsoft partner ID and the meetingguard.ai domain), so company accounts can connect. We send the steps.
- If you want Gmail sending: the Google application as project owner, and the assessor's yearly fee.
- Before A7: your approval of the updated privacy policy and terms, and the retention period for emails.
- Before A8: the Assistant plan prices and allowances.
- Before A9: the beta testers.

## 9. What we ask you to confirm

1. The tasks in part 2 and the rules in part 3 are the assistant you want.
2. The price: USD 4,950 for 9 milestones, USD 550 each, released after each demo and code push; A9 at your final acceptance of the assistant.
3. Your go on the prototype, A1 to A4, USD 2,200. Production, A5 to A9, starts only on your go after the demonstration.

Thank you for bringing it back. The assistant is the part of Meeting Guard AI that works for you while you are busy, and we are ready to start on your go.
