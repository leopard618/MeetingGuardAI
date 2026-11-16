# WhatsApp message templates for M13 (batch of November 12, 2026)

For: the person who submits the templates in WhatsApp Manager (Francisco, or someone he gives
access), and for Dusko and Sven, who write the M13 code against them.

Status: draft, not submitted (Nov 12 2026). Approval only makes a template available. Nothing is
sent to anyone until the M13 code ships, and then only to users who turned the messages on.

File and line references are relative to the repository root. "UNVERIFIED" marks a point nobody
has checked yet. The Meta pages could not be opened from the machine that drafted this, so the
Meta rules below come from search extracts of Meta's official pages; section 9 lists the pages to
open in a browser before submitting.

## 1. The batch

Meta lets a business start a WhatsApp conversation only with a template it approved beforehand.
Free-form messages are allowed only inside the 24-hour window that opens each time the user
writes. Today the bot only answers, so it needs no templates (functions/src/whatsapp/send.ts:4-8).
M13 adds messages the bot starts by itself. The contract wording
(docs/v2/Project-Plan-2026-11-09.md:51): "debriefs, confirmations and the daily agenda through
approved templates, only to users who opted in, with a stop keyword; one set of records with the
app". On Nov 12 2026 two more were added: "commitments ready" and WhatsApp reminders for accepted
tasks, follow-ups included (docs/v2/M11-DESIGN.md:630-635, 1131-1140).

| # | Template name | Category | The bot sends it | Switch that gates it | Validity |
|---|---|---|---|---|---|
| 3.1 | `mg_daily_agenda_v1` | Utility | Once a day at the user's briefing time | Daily agenda | 6 hours |
| 3.2 | `mg_debrief_prompt_v1` | Utility | 5 minutes after a meeting ends | Debrief prompts | 3 hours |
| 3.3 | `mg_meeting_confirmation_v1` | Utility | Meeting Guard AI adds or moves a meeting on the server, outside this chat and the app | Meeting confirmations | 12 hours |
| 3.4 | `mg_commitments_ready_v1` | Utility | A notetaker summary is filed with commitments | Commitments to review (pilot) | 12 hours |
| 3.5 | `mg_task_reminder_v1` | Utility | At the reminder time of a task accepted from a summary | Task reminders | 1 hour |
| 3.6 | `mg_followup_reminder_v1` | Utility | At the reminder time of someone else's commitment | Task reminders | 1 hour |
| 3.7 | `mg_optin_welcome_v1` | Utility | Once, when the user first turns messages on | (the opt-in itself) | 12 hours |

Each name holds two languages, English and Spanish. Meta reviews each language separately, each
has its own status, and each counts toward the account's template limit (14 of 250 for an
unverified portfolio, 6,000 once verified).

**Language codes: `en` and `es`.** At send time the code must name the language exactly as
submitted; Meta has no fallback between `es` and `es_MX` (error 132001). The app knows only `en`
and `es` (functions/src/shared/aiContract.ts:153), and a linked user with `language` 'es' gets
Spanish, anyone else English (functions/src/whatsapp/session.ts:399-405). The Spanish is neutral
Latin American with "tu", like the bot's other texts (messages.ts:74-93), so one `es` version
serves Mexico, Colombia and the rest. In WhatsApp Manager pick the plain "English" and "Spanish"
entries, not a regional one.

**Category: Utility for all seven.** Meta's utility test: non-promotional, and specific to or
requested by the user (their account, their services). Every message here is about the user's own
meetings, tasks or settings and is sent only after they switched it on. None mentions plans,
prices, upgrades or offers: one promotional sentence makes a template Marketing. Since April 2025
Meta does not reject a wrong category; it approves the template as Marketing instead, and it can
also move an approved template later. The debrief prompt and the daily agenda carry the most risk
of that, so their wording stays plain.

**Variables are positional** ({{1}}, {{2}}), "Number" in WhatsApp Manager. A variable value cannot
contain a line break, so a list never goes into one variable.

**The door-opener pattern.** Where the content is long (the day's agenda, a meeting's details, the
list of commitments), the template is short and has a quick-reply button. A tap is a message from
the user, so it opens the 24-hour window, and the bot then sends the full content as a normal
message, formatted as today.

**Opt-in.** M13 adds one opt-in, "Messages from Meeting Guard AI" / "Mensajes de Meeting Guard
AI", with a switch per kind of message, all off by default, in Settings > Integrations > WhatsApp
assistant (labels in both languages in section 7). STOP, written in the chat, turns them all off
(sections 4 and 7).

## 2. Submitting in WhatsApp Manager

Who signs in: the templates belong to the WhatsApp Business account in Francisco's Meta business
portfolio, the one that holds the bot's UK business number (docs/v1/SETUP.md:1094-1101;
docs/v2/STAGE1-ACCEPTANCE.md:29). The person who submits must be signed in to
business.facebook.com with a Facebook account that has full control of that portfolio or of its
WhatsApp account: Francisco, or someone he adds (whether Dusko or Sven has such access is
UNVERIFIED). The "meetingguard-bot" system user (SETUP.md:1110-1115) cannot sign in to the web
pages, but its access lets the code create the same templates through the API (section 7).

The steps (Meta's current labels as its docs describe them; Meta renames them often, so expect
small differences):

1. Open https://business.facebook.com/wa/manage/message-templates/ . If asked, choose Francisco's
   business portfolio, then the WhatsApp account with the UK business number (selector at the top
   of the page).
2. Click "Create template".
3. Category: "Utility". Type: "Default" (the custom template, not one from the template library).
   Click "Next".
4. Name: paste the name from section 3, for example `mg_daily_agenda_v1`. Language: "English".
   Add a second language: "Spanish". Each language gets its own tab in the editor.
5. Type of variable: "Number".
6. Header: choose "Text" and paste the header.
7. Body: paste the body exactly, line breaks included. The editor turns {{1}} into a variable and
   asks for a sample value for each one; paste the sample values from the template's table.
8. Footer: paste the footer (the welcome template has none).
9. Buttons: "Add button" > "Quick reply" (custom). Add the labels in the order shown. The order
   matters: the code sends each button's payload by its position (0, 1).
10. Message validity period: set it here, from the table in section 1. If this page does not
    offer it, do not submit this template here; Dusko creates it through the API with
    `message_send_ttl_seconds` (section 7), so no edit is needed after approval. Setting it later
    would be an edit of an approved template: it counts against the edit limits below and sends
    the template back to review.
11. Open the Spanish tab and paste the Spanish header, body, footer, buttons and samples.
12. Click "Submit". Repeat for the seven names.

After submitting:
- The status shows "In review", then "Active" (approved) or "Rejected" with a reason. Review
  usually takes minutes to a day (UNVERIFIED).
- Check the Category column after approval. If a template shows "Marketing", tell Dusko before
  anything else: it changes cost and delivery (section 6). This one check is not enough: Meta
  re-checks approved templates later and can move one to Marketing while it stays "Active" (with
  no advance notice for a business already warned for misuse). The code therefore watches Meta's
  status and category webhooks and stops sending such a template by itself (section 7).
- If a template is rejected, send the reason to Dusko and do not resubmit different wording on your
  own. After approval, a template can be edited only once a day and 10 times in 30 days, and its
  category cannot be edited. A deleted name cannot be used again for 30 days, which is why every
  name ends in `_v1`: a fixed version goes in as `_v2`.
- Nothing else needs setting up in WhatsApp Manager. The button payloads are set by the code at
  send time.

## 3. The templates

Rules for every variable value at send time (the M13 sender does this, section 7): line breaks and
tabs become spaces, runs of spaces become one space, the value is trimmed, cut at a word boundary
to the stated length with no dots added, and never empty (the fallback is given). Times are
24-hour "H:MM", with no leading zero on the hour ("9:30", "16:00"), so the value cleaner strips the
zero that `toLocalTime` adds (functions/src/assistant/time.ts:109-112). They are shown in the zone
the app last sent to the opt-in record (refreshed by the callable on every app start, section 7),
else preferences.timezone when the document has one, else the task's or meeting's own timezone;
never the 'UTC' fallback of session.ts:403 (the app documents preferences.timezone as possibly
stale, src/services/alerts/briefing.ts:19-21). A reminder always fires at dueDate + dueTime in the
task's own timezone (src/services/alerts/taskReminders.ts:65). In Spanish, an hour of 1 takes
"a la" ("a la 1:30"), every other hour "a las".

### 3.1 Daily agenda: `mg_daily_agenda_v1`

Purpose: the day at a glance, at the time the user chose, with the full list one tap away.

When: once a day at `preferences.briefingTime` (default "08:00", src/core/types.ts:112, 767-768)
in the user's time zone, while the Daily agenda switch is on. This switch is separate from the
phone's daily briefing (`briefingEnabled`, off by default, types.ts:767). Not sent on an empty day
(no meetings, no tasks due or overdue), and not sent while the server has no real zone for the
user (section 8, question 4 and 11).

| Part | English (`en`) | Spanish (`es`) |
|---|---|---|
| Header | `Your day` | `Tu día` |
| Footer | `Reply STOP to turn off these messages.` | `Responde STOP para desactivar estos mensajes.` |
| Button 1 (quick reply) | `See my day` | `Ver mi día` |

Body (en):

```text
Here is your agenda for today from Meeting Guard AI: {{1}}. Tasks: {{2}}.

Tap "See my day" for the full list with times and places.
```

Body (es):

```text
Esta es tu agenda de hoy en Meeting Guard AI: {{1}}. Tareas: {{2}}.

Toca "Ver mi día" para ver la lista completa con horarios y lugares.
```

| Var | Content | Source in code | Sample (en) | Sample (es) |
|---|---|---|---|---|
| {{1}} | Today's meetings: the count, the first timed meeting's time and its title (cut to 60). Forms: "no meetings", "1 meeting at 9:30 (Weekly sync)", "3 meetings, the first at 9:30 (Weekly sync)", "1 all-day meeting (Offsite)"; es "sin reuniones", "1 reunión a las 9:30 (Revisión semanal)", "3 reuniones, la primera a las 9:30 (Revisión semanal)", "1 reunión de todo el día (Offsite)" | `firestoreMeetingReader` with `listByStartRange` and `listRecurring` (functions/src/assistant/context.ts:31-41, 433), `expandOccurrences` (functions/src/shared/recurrence.ts:319), fields title, startAt, durationMinutes, allDay (functions/src/whatsapp/executor.ts:102-114); cancelled meetings skipped as in src/services/alerts/briefing.ts:77; wording from src/i18n/locales/{en,es}/alerts.json:6-15 | `3 meetings, the first at 9:30 (Weekly sync)` | `3 reuniones, la primera a las 9:30 (Revisión semanal)` |
| {{2}} | Open tasks due today and overdue. Forms: "2 due today and 1 overdue", "1 due today", "none due today and 3 overdue", "none due today"; es "2 para hoy y 1 vencida", "1 para hoy", "ninguna para hoy y 3 vencidas", "ninguna para hoy" | tasks reader (functions/src/assistant/tasksContext.ts:171), counted as in src/services/alerts/briefing.ts:143-152 (status open, dueDate today or earlier) | `2 due today and 1 overdue` | `2 para hoy y 1 vencida` |

Tap "See my day" (payload `wa_agenda:<sendId>`): the bot sends today's list in the window: each
meeting as the bot's existing block (`formatMeetingSummary`, functions/src/whatsapp/messages.ts:110-116),
every meeting of the day (not the 5-item cap of executor.ts:647, because the template promises the
full list), then the tasks due and overdue as "- title (due 16:00)" (the line format of
executor.ts:649-671, also without its cap). The text is cut only at `MAX_TEXT_CHARS` (send.ts:13),
with a last line "and N more in the app" / "y N más en la app". It is built from the records, not
by the AI, so it uses no AI action.
M13 builds: the payload routing and this renderer. Typing "What do I have today?" keeps working
through the assistant as today (1 AI action).

Notes: calendar events imported on the phone are only as fresh as its last sync
(docs/v2/Complete-Plan-2026-11-10.md:21). The test guides describe a briefing of three days
(docs/v2/TEST-GUIDE-STAGE1.md:146) while the code shows today only; this template says "today".
The assistant's morning digest (A8, Complete-Plan-2026-11-10.md:26) can grow the tap content later
without a new template.

### 3.2 Debrief prompt: `mg_debrief_prompt_v1`

Purpose: the WhatsApp version of the app's "How did it go?" follow-up, so the user can debrief
the meeting in the chat.

When: 5 minutes after each meeting instance ends (`FOLLOW_UP_DELAY_MINUTES`,
src/core/identifiers.ts:407). For a one-off meeting that is startAt + durationMinutes. For a series
it is each occurrence from `expandOccurrences` (functions/src/shared/recurrence.ts:319) with its
overrides: cancelled occurrences are skipped, moved ones use their new end, and {{1}} is the
occurrence's own title, as the phone's follow-up does (src/services/alerts/plan.ts:16-20, 155-160).
To keep the volume low: only the meetings the phone gives a follow-up (status 'scheduled', not
all-day, not deleted; src/services/alerts/plan.ts:6), with no participant filter because meetings
imported from the device calendar never carry participants
(src/services/calendar/device/mapping.ts:214), at most 3 a day, and none between 21:00 and 7:00
local (skipped, not delayed). Not sent while the user has no AI action left in the current
allowance (the tap would only end in the quota message, messages.ts:57). Gated by the Debrief
prompts switch. The phone's own "How did it go?" follow-up (`followUpEnabled`, on by default,
src/core/types.ts:766) fires at the same minute (question 16).

| Part | English (`en`) | Spanish (`es`) |
|---|---|---|
| Header | `How did it go?` | `¿Cómo te fue?` |
| Footer | `Reply STOP to turn off these messages.` | `Responde STOP para desactivar estos mensajes.` |
| Button 1 (quick reply) | `Debrief` | `Resumen` |
| Button 2 (quick reply) | `Not this time` | `Esta vez no` |

Body (en):

```text
Your meeting "{{1}}" has ended. Do you want to note what was agreed?

Tap "Debrief" and tell me who does what, and by when. I will turn it into tasks for you to confirm.
```

Body (es):

```text
Tu reunión "{{1}}" ya terminó. ¿Quieres anotar lo que se acordó?

Toca "Resumen" y cuéntame quién hace qué y para cuándo. Lo convertiré en tareas para que las confirmes.
```

The body says nothing about the AI allowance on purpose: plan or allowance wording in a template
invites Meta to classify it as Marketing, and it would fix business rules into text that can be
edited only 10 times in 30 days. The allowance line goes into the in-window "Debrief tapped" text
of section 4 instead.

| Var | Content | Source in code | Sample (en) | Sample (es) |
|---|---|---|---|---|
| {{1}} | The meeting title, or for a series the occurrence's own title, cut to 60; fallback "Meeting" / "Reunión" (alerts.json:44) | title (functions/src/whatsapp/executor.ts:102-114); for a series `occurrence.title ?? meeting.title` as src/services/alerts/briefing.ts:90 | `Weekly sync with Urpayroll` | `Reunión semanal con Urpayroll` |

The Spanish button says "Resumen" because the app already calls the debrief that
(src/i18n/locales/es/ai.json:26-28); a notetaker summary is a "minuta" (M11-DESIGN.md:1114-1115).
The wording avoids "records", "transcribes", "listens" and the other words of
docs/v2/DEBRIEF-FOR-WEBSITE.md:76-80.

Tap "Debrief" (payload `wa_debrief:<sendId>`): the bot keeps the meeting for 15 minutes in its own
session field with its own expiresAt, like summaryOffer, cleared by redeemLinkCode (15 minutes is
the session window, config.ts:257, and what the privacy text describes, en/legal.json:106), and
sends the debrief prompt of section 4. The user's next text goes to the assistant with mode
'debrief' and `followUpMeetingId` (functions/src/shared/aiContract.ts:385-403), as the only
message, as the app sends a debrief (src/services/ai/controller.ts:171-179), not session.turns,
so earlier chat turns never become tasks; the proposed tasks then use the existing Confirm/Cancel
step. The AI action is charged when the debrief runs, not at the tap. M13 builds: the session state and the bridge change, because today the bridge always
sends mode 'chat' and `followUpMeetingId` null (webhook.ts:299-308).

Tap "Not this time" (payload `wa_skip:<sendId>`): the bot sends nothing and logs the skip.

A typed answer without a tap goes to the assistant as a normal chat message, as today.

### 3.3 Meeting confirmation: `mg_meeting_confirmation_v1`

Purpose: the "confirmations" of the contract, in the reading that needs a template: the bot
confirms a meeting that Meeting Guard AI added or moved for the user on the server, outside this
chat and the app. The other reading,
the Confirm/Cancel step and the "Done. I applied the changes." reply of the chat
(messages.ts:58-64), always answers the user's own message inside the window and needs no
template. See question 1 in section 8; if Francisco means only the chat confirmations, this
template is simply never used.

When (default): a meeting that starts in the next 7 days is added or moved by Meeting Guard AI on
the server, outside this chat and outside the app (for example from a forwarded email or summary).
Never for meetings whose source is google, device or outlook (calendar sync,
`IMPORTED_MEETING_SOURCES`, src/core/types.ts:1329): the user made those changes in their own
calendar, and an echo of them on WhatsApp is the kind of surprise that gets a number blocked or
reported. Not during the first import of a calendar, at most 3 a day. Between 21:00 and 7:00 in
the user's zone, held and sent at 7:00 (the validity counts from the actual send); dropped if no
longer true by then (the meeting is gone or moved again). Gated by the Meeting confirmations
switch.

Today no such server path exists: the only meetings the server writes are the chat's own (source
'whatsapp', executor.ts:180), and the meeting model has no organizer field to tell "added by
someone else" apart. So 3.3 is submitted with the batch (an approved template nobody uses costs
nothing), but its trigger stays off until Francisco answers question 1.

| Part | English (`en`) | Spanish (`es`) |
|---|---|---|
| Header | `Meeting saved` | `Reunión guardada` |
| Footer | `Reply STOP to turn off these messages.` | `Responde STOP para desactivar estos mensajes.` |
| Button 1 (quick reply) | `Details` | `Detalles` |

Body (en):

```text
Meeting Guard AI saved your meeting "{{1}}" for {{2}}.

Tap "Details" to see it here, or open the app to change it.
```

Body (es):

```text
Meeting Guard AI guardó tu reunión "{{1}}" para el {{2}}.

Toca "Detalles" para verla aquí, o abre la app para cambiarla.
```

| Var | Content | Source in code | Sample (en) | Sample (es) |
|---|---|---|---|---|
| {{1}} | The meeting title, cut to 60; fallback "Meeting" / "Reunión" | title (executor.ts:102-114) | `Client call with Ana` | `Llamada con Ana` |
| {{2}} | The start in the user's zone (section 3). Forms: "Fri, Nov 13 at 10:00", "Fri, Nov 13 (all day)"; es "vie 13 nov a las 10:00", "vie 13 nov (todo el día)" | startAt converted to that zone (the stored date and time fields, executor.ts:175-176, are in the meeting's zone), date format of `dueDateOf` (functions/src/summaries/whatsappRender.ts:117-124) | `Fri, Nov 13 at 10:00` | `vie 13 nov a las 10:00` |

Tap "Details" (payload `wa_meeting:<sendId>`): the bot sends the meeting's block
(`formatMeetingSummary`, messages.ts:110-116), no AI action. A meeting deleted since gets the text
of section 4. M13 builds: the payload routing, and the trigger at the server path that adds or
moves the meeting once one exists (it skips the sources google, device and outlook).

### 3.4 Commitments ready: `mg_commitments_ready_v1`

Purpose: tell the user that a forwarded notetaker summary is filed and has commitments, and lead
into the "commitments" / "compromisos" flow that already exists (M11-DESIGN.md section 4).

When: once per summary, when a recap is filed under a meeting on arrival (status 'matched',
functions/src/summaries/model.ts:1032-1036, committed as 'created', functions/src/summaries/store.ts:672)
and its action sections (`action_items`, `next_steps`, `waiting_on`,
functions/src/commitments/payload.ts:32) are not empty. Also on 'upgraded' (store.ts:666) when the
status becomes 'matched' (a better copy of an inbox summary, upgradePatch, store.ts:485-491); at
most once per summaryId, deduplicated by the send log. A hand-forwarded recap is filed only when
the user taps attach or keep in the app (summaries/actions.ts:337-379, 451-468); by default no
message then, because the user is in the app (question 9). Between 21:00 and 7:00 in the user's
zone, held and sent at 7:00 (the validity counts from the actual send); dropped if no longer true
by then (the summary was reviewed in the app or deleted). Pilot users only (`SUMMARIES_PILOT_UIDS`,
functions/src/whatsapp/summaryPort.ts:181), gated by the Commitments to review switch. The send
crosses the M11 key boundary through an ids-only queue entry (section 7).

| Part | English (`en`) | Spanish (`es`) |
|---|---|---|
| Header | `Commitments to review` | `Compromisos por revisar` |
| Footer | `Reply STOP to turn off these messages.` | `Responde STOP para desactivar estos mensajes.` |
| Button 1 (quick reply) | `Commitments` | `Compromisos` |

Body (en):

```text
Your notetaker's summary of "{{1}}" on {{2}} is filed in Meeting Guard AI. It lists commitments you can turn into tasks.

Tap "Commitments" or write commitments to review them. Nothing is added until you reply.
```

Body (es):

```text
La minuta de tu asistente de notas sobre "{{1}}" del {{2}} ya está archivada en Meeting Guard AI. Tiene compromisos que puedes convertir en tareas.

Toca "Compromisos" o escribe compromisos para revisarlos. No se agrega nada hasta que respondas.
```

| Var | Content | Source in code | Sample (en) | Sample (es) |
|---|---|---|---|---|
| {{1}} | The matched meeting's title, cut to 60; fallback "Meeting" / "Reunión" | `match.meetingSnapshot.title` (model.ts:393-398, 416) | `Urpayroll weekly sync` | `Reunión semanal de Urpayroll` |
| {{2}} | The meeting date, short, "Oct 16" / "16 oct" (the body reads "on Oct 16" / "del 16 oct") | `match.occurrenceDate`, else the local date of `match.meetingSnapshot.startAt` in `meetingSnapshot.timezone`, else `summaryDate` (the chain of functions/src/summaries/commitmentsHandler.ts:288-291; occurrenceDate is null for every one-off meeting, summaries/actions.ts:253, model.ts:407), shown with `shortDateOf` (whatsappRender.ts:110-115). All three are plaintext fields of the summary document (model.ts:473, 476) | `Oct 16` | `16 oct` |

There is no count of commitments on purpose: `counts.items` counts every bullet, not commitments
(model.ts:479), and the list is prepared on demand, not on arrival (commitmentsHandler.ts:13-24).

Tap "Commitments" (payload `wa_commit:<sendId>`): the bot runs the same offer as the typed trigger
(worker op 'offer', summaryRoute.ts:249) and sends the list with its replies (numbers, ALL, DROP,
NONE, AI), free unless the user asks for AI. M13 builds: the payload routing, and the offer for the
summary named in the send log while it is still eligible; today the offer always opens the newest
eligible summary (functions/src/summaries/whatsappCommitments.ts:201-242). The labels equal the
trigger words (summaryRoute.ts:61), so a tap whose payload is missing still reaches the flow when
the label is read as text. Typing "commitments" or "compromisos" works already.

### 3.5 Task reminder: `mg_task_reminder_v1`

Purpose: the client's request, a WhatsApp reminder at the scheduled time of an accepted task.

When: at the due time minus `reminderMinutesBefore`, computed as the phone does
(src/services/alerts/taskReminders.ts:59-70): open tasks with a due date, a due time and a
reminder. Gated by the Task reminders switch, for tasks accepted from a summary (id starting
`sm_`, functions/src/commitments/ids.ts:99-104), as Francisco asked (M11-DESIGN.md:1133-1134);
every task with a reminder only if he chooses that (question 2). An `sm_` task with exactly one
person gets 3.6 instead. The phone keeps its own reminder too (question 3). The schedule lives
outside the task document (section 7).

| Part | English (`en`) | Spanish (`es`) |
|---|---|---|
| Header | `Task reminder` | `Recordatorio de tarea` |
| Footer | `Reply STOP to turn off these messages.` | `Responde STOP para desactivar estos mensajes.` |
| Button 1 (quick reply) | `Mark as done` | `Marcar como hecha` |
| Button 2 (quick reply) | `Remind me in 1 hour` | `Recuérdamelo en 1 hora` |

Body (en):

```text
Reminder from Meeting Guard AI: your task "{{1}}", due {{2}}.

Tap "Mark as done" when it is finished, or "Remind me in 1 hour".
```

Body (es):

```text
Recordatorio de Meeting Guard AI: tu tarea "{{1}}", para {{2}}.

Toca "Marcar como hecha" cuando la termines, o "Recuérdamelo en 1 hora".
```

| Var | Content | Source in code | Sample (en) | Sample (es) |
|---|---|---|---|---|
| {{1}} | The task title (max 200), cut to 100 | `users/{uid}/tasks/{id}` title (src/core/types.ts:1093-1117) | `Send the signed proposal to Ana` | `Enviar la propuesta firmada a Ana` |
| {{2}} | The due moment. Forms: "today at 16:00", "tomorrow at 9:00", "on Fri, Oct 16 at 9:00"; es "hoy a las 16:00", "mañana a las 9:00", "el vie 16 oct a las 9:00", "hoy a la 1:00" | dueDate, dueTime, timezone (types.ts:1093-1117), shown in the user's zone; date as `dueDateOf` (whatsappRender.ts:117-124) | `today at 16:00` | `hoy a las 16:00` |

The first line has no verb tense ("due", "para") on purpose: an undated commitment reminds at the
due time itself (`minutesBeforeDefaultTime` 0, functions/src/commitments/taskDoc.ts:80), so the
"Remind me in 1 hour" repeat, or a delivery late within the validity, arrives after the due time.

Tap "Mark as done" (payload `wa_done:<sendId>`): the server writes status 'done', completedAt now
and updatedAt now in one update, the fields `taskChangesToFieldUpdates` writes today
(functions/src/whatsapp/executor.ts:328-355), because the app rejects a done task without
completedAt (src/core/types.ts:1142-1145), and answers in the window (section 4). No AI action:
today marking a task done from WhatsApp goes through the assistant, its confirm step and 1 AI
action (executor.ts:352-355). A task already done, deleted or moved since the send gets the
matching text.

Tap "Remind me in 1 hour" (payload `wa_later:<sendId>`): the server queues one more reminder for 60
minutes later and confirms. That second reminder is another template message.

M13 builds: the schedule, the done write and both payload routes.

### 3.6 Follow-up reminder: `mg_followup_reminder_v1`

Purpose: the same reminder for a commitment someone else made, with that person's name in view,
so the user remembers to check with them.

When: as 3.5, for a task that is someone else's commitment from a summary: an `sm_` task
(functions/src/commitments/ids.ts:99-104) with exactly one person
(functions/src/commitments/taskDoc.ts:303-308) gets 3.6. {{2}} is the title without the
"<name>: " prefix when it has one, otherwise the full title: `ownerPrefixed` leaves a title
unchanged when it already starts with the owner's name (functions/src/commitments/verify.ts:436-442),
and such a follow-up must still read as a follow-up, not as the user's own job (M11-DESIGN.md
section 11). Any other task gets 3.5.

| Part | English (`en`) | Spanish (`es`) |
|---|---|---|
| Header | `Follow-up reminder` | `Recordatorio de seguimiento` |
| Footer | `Reply STOP to turn off these messages.` | `Responde STOP para desactivar estos mensajes.` |
| Button 1 (quick reply) | `Mark as done` | `Marcar como hecha` |
| Button 2 (quick reply) | `Remind me in 1 hour` | `Recuérdamelo en 1 hora` |

Body (en):

```text
Reminder from Meeting Guard AI: check with {{1}} on "{{2}}", due {{3}}.

Tap "Mark as done" when it is settled, or "Remind me in 1 hour".
```

Body (es):

```text
Recordatorio de Meeting Guard AI: pregúntale a {{1}} por "{{2}}", previsto para {{3}}.

Toca "Marcar como hecha" cuando la tarea quede resuelta, o "Recuérdamelo en 1 hora".
```

| Var | Content | Source in code | Sample (en) | Sample (es) |
|---|---|---|---|---|
| {{1}} | The person's name, cut to 60 | `people[0].name` (taskDoc.ts:303-308) | `Cristina Reyes` | `Cristina Reyes` |
| {{2}} | The title without the "<name>: " prefix when it has one, otherwise the full title, cut to 100 | title minus the prefix, as `titleWords` does (whatsappRender.ts:296-301) | `Confirm the launch date` | `Confirmar la fecha de lanzamiento` |
| {{3}} | The due moment, as {{2}} of 3.5 | as 3.5 | `today at 9:00` | `hoy a las 9:00` |

The text says "check with", never that the person agreed (M11-DESIGN.md:1116-1118). Taps: as 3.5.

### 3.7 Opt-in welcome: `mg_optin_welcome_v1`

Purpose: confirm the opt-in on the number itself, name the business, and say how to stop. Meta's
policy asks for clear opt-out instructions, and confirming an opt-in or opt-out is one of Meta's
utility uses. It also lets the user see right away that the messages reach the right phone.

When: once, when the user turns on the first switch in the app (the opt-in goes from off to on).
Not when switches change later. Usually the user is outside the window at that moment, hence a
template.

| Part | English (`en`) | Spanish (`es`) |
|---|---|---|
| Header | `WhatsApp messages are on` | `Mensajes de WhatsApp activados` |
| Footer | (none) | (none) |
| Buttons | (none) | (none) |

Body (en):

```text
You turned on WhatsApp messages from Meeting Guard AI for {{1}}.

You can change them at any time in the app, in Settings > Integrations > WhatsApp assistant. Reply STOP here to turn them all off.
```

Body (es):

```text
Activaste los mensajes de WhatsApp de Meeting Guard AI para {{1}}.

Puedes cambiarlos cuando quieras en la app, en Ajustes > Integraciones > Asistente de WhatsApp. Responde STOP aquí para desactivarlos todos.
```

| Var | Content | Source in code | Sample (en) | Sample (es) |
|---|---|---|---|---|
| {{1}} | The switches now on, in one line: "your daily agenda at 8:00", "debrief prompts", "meeting confirmations", "commitments to review", "task reminders"; es "tu agenda diaria a las 8:00", "los avisos de resumen", "las confirmaciones de reuniones", "los compromisos por revisar", "los recordatorios de tareas". Example ending of the first line: "for your daily agenda at 8:00 and commitments to review." / "para tu agenda diaria a las 8:00 y los compromisos por revisar." | the new opt-in record (section 7); the path matches the app (src/screens/settings/SettingsScreen.tsx:175-182; src/i18n/locales/{en,es}/whatsapp.json:4-7) | `your daily agenda at 8:00 and task reminders` | `tu agenda diaria a las 8:00 y los recordatorios de tareas` |

## 4. Texts the bot sends inside the window (not submitted to Meta)

These answer the user's own message or tap, so they are ordinary messages. They go into
messages.ts with the other bot texts and follow the same product text rule.

| Moment | English | Spanish |
|---|---|---|
| STOP (all switches go off) | `Done. Meeting Guard AI will no longer message you first on WhatsApp. You can still write to the assistant here. To turn the messages back on, open the app: Settings > Integrations > WhatsApp assistant.` | `Listo. Meeting Guard AI ya no te enviará mensajes por su cuenta. Puedes seguir escribiéndole al asistente aquí. Para activar los mensajes de nuevo, abre la app: Ajustes > Integraciones > Asistente de WhatsApp.` |
| See my day: first line | `Your day (Thu, Nov 12):` | `Tu día (jue 12 nov):` |
| Debrief tapped | `Tell me what was agreed in "Weekly sync": who does what, and by when. Write it in one message and I will turn it into tasks for you to confirm. This debrief uses 1 AI action.` | `Cuéntame qué se acordó en "Reunión semanal": quién hace qué y para cuándo. Escríbelo en un solo mensaje y lo convertiré en tareas para que las confirmes. Este resumen usa 1 acción de IA.` |
| Meeting gone | `That meeting is no longer in Meeting Guard AI.` | `Esa reunión ya no está en Meeting Guard AI.` |
| Mark as done | `OK. I marked "Send the signed proposal to Ana" as done.` | `Listo. Marqué "Enviar la propuesta firmada a Ana" como hecha.` |
| Task already done | `That task is already done.` | `Esa tarea ya está hecha.` |
| Task gone | `That task is no longer in Meeting Guard AI.` | `Esa tarea ya no está en Meeting Guard AI.` |
| Remind me in 1 hour | `OK. I will remind you again at 17:00.` | `De acuerdo. Te lo recuerdo otra vez a las 17:00.` |
| Tap on an old message | `That message is out of date. Open the app to see the current details.` | `Ese mensaje está desactualizado. Abre la app para ver los detalles actuales.` |

## 5. Design rules applied

Every body, header, footer, button and sample above was counted and checked by a script. The
Meta limits come from https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components.md
and https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-review/ .

- Names: lowercase letters, digits and underscores, at most 512 characters, with a version suffix.
- Body at most 1,024 characters. The longest is 245 (es 3.4), 269 with its samples filled in.
- Header (text) and footer at most 60 characters, footer without variables. Longest header 30 (es
  3.7), longest footer 45 (es).
- Quick-reply labels at most 25 characters (non-template reply buttons allow only 20, a different
  limit). Longest label 22 ("Recuérdamelo en 1 hora"). At most 10 buttons; these use 1 or 2.
- No body starts or ends with a variable (Meta error 2388299); every body ends with fixed text and
  a full stop.
- No two variables touch; at least one word of fixed text always sits between them, not only
  punctuation (Meta's INVALID_FORMAT guidance asks for descriptive text between parameters).
- Variables numbered in order with no gaps, each used once.
- Enough fixed text for the variables (Meta error 2388293, no published threshold): at least 19
  fixed words for every 2 variables (the fewest is 19, es 3.3), 23 for the 3 of 3.6.
- A sample value for every variable, realistic, on one line, no #, $ or %.
- No emoji. No em dashes, en dashes, ellipsis characters, curly quotes or guillemets; the app's
  Spanish uses guillemets around titles (es/alerts.json:40), the templates use straight quotes.
  The product name is always "Meeting Guard AI".
- No two templates share a body and footer (Meta rejects duplicates even under another name).
- Every message names Meeting Guard AI, so it reads right whatever the number's display name is
  (the display name is UNVERIFIED, SETUP.md:1150).

| Template | Lang | Body | With samples | Header | Footer | Labels |
|---|---|---|---|---|---|---|
| 3.1 daily agenda | en / es | 132 / 137 | 190 / 202 | 8 / 6 | 38 / 45 | 10 / 10 |
| 3.2 debrief prompt | en / es | 169 / 169 | 190 / 193 | 14 / 13 | 38 / 45 | 7, 13 / 7, 11 |
| 3.3 meeting confirmation | en / es | 115 / 121 | 145 / 148 | 13 / 16 | 38 / 45 | 7 / 8 |
| 3.4 commitments ready | en / es | 210 / 245 | 227 / 269 | 21 / 23 | 38 / 45 | 11 / 11 |
| 3.5 task reminder | en / es | 128 / 137 | 163 / 175 | 13 / 21 | 38 / 45 | 12, 19 / 17, 22 |
| 3.6 follow-up reminder | en / es | 137 / 172 | 172 / 218 | 18 / 27 | 38 / 45 | 12, 19 / 17, 22 |
| 3.7 opt-in welcome | en / es | 196 / 208 | 235 / 260 | 24 / 30 | none | none |

## 6. Costs, pacing and validity

Meta charges Francisco's WhatsApp Business account for each template message delivered, at a rate
set by the category (Utility here) and by the country code of the user's phone, so a user in Mexico
is billed at Mexico's rate, not at the rate of the UK number. Since October 1, 2026 the bot's own
replies inside the 24-hour window are billable as well, after 1,000 free each month per business
number; what users send is free, and users never pay. If Meta moves a template to Marketing, it
stays approved and keeps sending, but it costs more, it is not delivered to US (+1) numbers, users
who turned off marketing messages in WhatsApp stop receiving it (131050), and it counts against
Meta's per-user marketing caps (131049). Meta also clears the template's validity when it changes
the category, so a 1-hour task reminder could then arrive up to 30 days late. Meta can make that
move at any time after approval, so the code watches for it and stops such a template by itself
(section 7).

Meta rates every template from blocks, reports and read rates. A template with poor feedback is
paused (it cannot be sent during a pause) and, after repeated pauses, disabled for good, which then
needs a new template with new wording. Hence few, expected messages, each with its own switch,
STOP in every footer, a STOP that understands the usual ways of asking to stop (section 7), and
quiet hours from 21:00 to 7:00 for the messages no user scheduled (3.2, 3.3, 3.4). Messages the
bot starts also count toward the portfolio's daily limit of unique users (250 for a new portfolio,
2,000 after business verification).

The validity in section 1 is how long Meta keeps trying to deliver a message to a phone that is
off. Without it a reminder could arrive up to 30 days late. Utility templates accept 30 seconds to
12 hours. The validity is set when the template is created (section 2 step 10); setting it later is
an edit of an approved template.

## 7. What the M13 code needs

- [ ] `sendTemplate` in functions/src/whatsapp/send.ts: type 'template', the name, the exact language
      code, the body parameters and one quick-reply payload per button index; update the header
      comment (send.ts:4-8). Graph v21.0 (functions/src/config.ts:253).
- [ ] A template registry in config.ts (own block): name, language codes, number of parameters,
      the expected category (UTILITY) and validity in seconds. 'es' maps to `es`, everything else
      to `en`, so PT, FR and DE users after M12 get English (question 10).
- [ ] Required: subscribe the app to the `message_template_status_update`,
      `message_template_quality_update` and `template_category_update` webhook fields (today only
      `messages` is subscribed, docs/v1/SETUP.md:1138; a setting of the Meta app, not a deploy)
      and parse them in the webhook. Store category, status and `message_send_ttl_seconds` per
      template name AND language (server-only, for example `whatsappTemplates/{name}_{language}`).
      The send gate refuses a template whose category is not UTILITY, whose status is not
      APPROVED, or whose TTL no longer matches the registry, logs it, and alerts Dusko and Sven.
      Reason: Meta re-checks approved templates and can move one to Marketing while it stays
      approved; it then costs more, is blocked for +1 numbers and marketing opt-outs, and loses its
      validity (section 6). The same data feeds the admin WhatsApp panel
      (Project-Plan-2026-11-09.md:56).
- [ ] The value cleaner of section 3, with the fallbacks and lengths stated per variable, and the
      "H:MM" time with no leading zero.
- [ ] The opt-in record in `whatsappUsers/{uid}` (server-only, firestore.rules:447-466), written by a
      callable from the app: opt-in time, the wording version shown, one flag per switch, the STOP
      time, the phoneE164 it was given for, and the device time zone, refreshed by the callable on
      every app start for opted-in users (section 3). Keeping it out of the preferences avoids a
      rules change (preferences keys are `hasOnly`, firestore.rules:315-323). Unlinking and
      deleteAccount.ts (own block) clear it. `redeemLinkCode` (session.ts:297-336) also clears it,
      in the same transaction, for the previous uid of the phone and for a uid whose phone changes
      (today that transaction only sets `{ phoneE164: null, linkedAt: null }` on the previous uid
      and deletes the old phone's link and session, session.ts:314-324). The send gate requires
      the record's phoneE164 to equal `whatsappUsers/{uid}.phoneE164` and
      `whatsappLinks/{phone}.uid` to equal the uid. A new number starts with every switch off and
      gets 3.7 again when the user turns one on (Meta's opt-in is per phone number).
- [ ] The app: a "Messages from Meeting Guard AI" section on the WhatsApp assistant screen, shown
      when linked, all switches off by default. Proposed text: "Choose which messages Meeting Guard
      AI may send you on WhatsApp without you writing first. Reply STOP in the chat to turn them
      all off." / "Elige qué mensajes puede enviarte Meeting Guard AI por WhatsApp sin que le
      escribas primero. Responde STOP en el chat para desactivarlos todos." The opt-in must name
      the business and say that messages will be sent (Meta's opt-in page). Labels (en / es):
      title "Messages from Meeting Guard AI" / "Mensajes de Meeting Guard AI"; switches "Daily
      agenda" / "Agenda diaria", "Debrief prompts" / "Avisos de resumen", "Meeting confirmations" /
      "Confirmaciones de reuniones", "Commitments to review (pilot)" / "Compromisos por revisar
      (piloto)" (pilot users only), "Task reminders" / "Recordatorios de tareas". The labels match
      the template headers and the {{1}} forms of 3.7.
- [ ] STOP in webhook.ts, at no AI action (today "stop" reaches the assistant, webhook.ts:504, and
      is charged, assistant/handler.ts:163). Where: right after the dedupe claim (webhook.ts:425)
      and before the per-phone cap returns (webhook.ts:428-437), so an opt-out is never lost to the
      daily limit (config.ts:223-226); it looks up the link itself, acts for linked users only, and
      runs before the relink, confirm, summary and assistant paths. Matching: normalize as
      `normalizeSummaryText` does (summaryRoute.ts:49-58: lowercase, accents removed, spaces
      collapsed), then strip all punctuation and emoji and collapse spaces again, so "Stop.",
      "STOP!" and "¡Baja!" count. Turn everything off when the result is one of: stop, parar,
      detener, baja, unsubscribe, darme de baja, dar de baja, no mas mensajes, stop messages, stop
      reminders. Also turn everything off when the message starts with stop or baja and has at most
      4 words ("stop please", "baja por favor"). Keep "no" and "cancel" out, as now, because they
      are confirm/cancel words (webhook.ts:158-159); none of the STOP words is taken by the summary
      words (summaryRoute.ts:75-80). If the assistant detects an opt-out request in any other
      message, the bridge applies STOP and refunds the action (this needs an opt-out signal in the
      assistant response, a change to both aiContract.ts copies, and a refund next to
      `refundQuota`, assistant/handler.ts:38). STOP sends the STOP reply of section 4, also when
      the phone is over its daily cap, and deletes the user's `whatsappReminders` entries. Meta's
      policy asks to respect every opt-out request, however it is worded.
- [ ] Template button taps in `extractInboundMessages` (webhook.ts:64-93): type "button" with
      `button.payload`, `button.text` and `context.id`. Route the `wa_agenda`, `wa_debrief`,
      `wa_skip`, `wa_meeting`, `wa_commit`, `wa_done` and `wa_later` payloads; ignore unknown ones;
      with no payload, read the label as text. Today a tap gets `unsupportedType` (webhook.ts:493).
- [ ] A send log, for example `whatsappSends/{sendId}`: uid, phone, template, language, the target
      ids, time, wamid, expiry and the delivery status from the status webhooks. Payloads carry
      only `<prefix>:<sendId>`; a tap is honoured only when the sendId belongs to that phone's
      account and has not expired. This is also the "sends logged" of the working plan.
- [ ] The gate before every send: linked, opted in for this phone (the opt-in item above), the
      template's switch on, not stopped, the template's live category UTILITY, status APPROVED and
      TTL as in the registry, the daily caps, the quiet hours from 21:00 to 7:00 in the user's zone
      (3.2 skipped; 3.3 and 3.4 held until 7:00 and checked again then), and for 3.2 at least one
      AI action left in the current allowance. Tested in the functions tests.
- [ ] Schedules: today the only scheduled function is `dailyMaintenance` (functions/src/maintenance/index.ts:143-145)
      and there are no Firestore triggers. A scheduler every 5 minutes sends what is due
      (reminders, debrief prompts, agenda slots, held 3.3 and 3.4 messages). The reminder times
      live in their own collection, for example `whatsappReminders/{uid}_{taskId}`, kept current by
      a trigger on task writes for opted-in users. When the Task reminders switch goes on, the
      callable builds `whatsappReminders` for the user's open tasks with a future reminder (as
      `computeTaskReminderPlan`, src/services/alerts/taskReminders.ts:47-81, without the 20-item
      budget). When it goes off, or STOP arrives, they are deleted. Never a new key on the task
      document: an unknown key drops the task on app 1.6.0 (M11-DESIGN.md:1138, hazard 3).
- [ ] Commitments ready: where a matched summary is committed (store.ts:666-672, inside
      the `summaryInbound` function, functions/src/index.ts:65), write only an ids-only queue entry (uid, summaryId, time) to the send log,
      keyed by summaryId so it is written at most once. The M13 scheduler, which holds the WhatsApp
      token and no data key, reads the plaintext `match.meetingSnapshot`, `match.occurrenceDate`
      and `summaryDate` (model.ts:473, 476) and sends. summaryInbound gets no WhatsApp secret: it
      runs as the summaries service account with SUMMARIES_DATA_KEY
      (summaries/inboundFunction.ts:101-112), and the M11 separation keeps the two apart
      (M11-DESIGN.md section 4.3).
- [ ] Debrief: the session state (its own field with expiresAt, 15 minutes, cleared by
      redeemLinkCode) and mode 'debrief' in the bridge with the debrief text as the only message
      (webhook.ts:299-308; src/services/ai/controller.ts:171-179).
- [ ] Mark as done: the server writes status 'done', completedAt now and updatedAt now in one
      update, the fields `taskChangesToFieldUpdates` writes today
      (functions/src/whatsapp/executor.ts:328-355), because the app rejects a done task without
      completedAt (src/core/types.ts:1142-1145). Whether that change then reaches a Microsoft To
      Do or Google Tasks sync is UNVERIFIED.
- [ ] Send errors logged and dropped, never retried in a loop: 131047 (window closed),
      132001 (language not approved), 132015 (paused), 132016 (disabled), 131026 (not
      deliverable), and 131049 or 131050 should a template become Marketing (the category
      webhook item above stops such a template before these appear).
- [ ] Creating the templates through the API instead of the web page, if Francisco prefers: POST
      `/{waba_id}/message_templates` with the system user's access, for example
      `{"name":"mg_task_reminder_v1","language":"en","category":"UTILITY","message_send_ttl_seconds":3600,"components":[{"type":"HEADER","format":"TEXT","text":"Task reminder"},{"type":"BODY","text":"<body>","example":{"body_text":[["Send the signed proposal to Ana","today at 16:00"]]}},{"type":"FOOTER","text":"Reply STOP to turn off these messages."},{"type":"BUTTONS","buttons":[{"type":"QUICK_REPLY","text":"Mark as done"},{"type":"QUICK_REPLY","text":"Remind me in 1 hour"}]}]}`.
      Field names from Meta's template pages (check them, section 9).
- [ ] Privacy texts: the notifications paragraph says "We do not send push notifications from a
      server" (docs/v2/TERMS-UPDATE-FOR-WEBSITE-2026-11-06.md:303, section B9), the in-app text
      describes only replies (src/i18n/locales/en/legal.json:105-106, 166), and a new STOP sentence
      is added: "Reply STOP in the WhatsApp chat to turn off the messages Meeting Guard AI sends
      without you writing first. The assistant still answers when you write." / "Responde STOP en
      el chat de WhatsApp para desactivar los mensajes que Meeting Guard AI te envía sin que le
      escribas primero. El asistente sigue respondiendo cuando le escribes." The old sentence
      "Send STOP to pause the assistant" (LEGAL-CLAIMS-1.6.0.md:145; TERMS-UPDATE:423) does not
      come back: STOP does not pause the assistant.
- [ ] Small fixes next to it: the old bot texts say "Meeting Guard" and "Settings > WhatsApp"
      (messages.ts:53-54, 75-76); M13 can bring them to "Meeting Guard AI" and the real path.
- [ ] Deploy only the named functions (AGENTS.md rule 3); the webhook redeploy follows
      M11-DESIGN.md section 12, owner question 2.

## 8. Open questions (each with the default used above)

1. What "confirmations" means in the contract. Default: a bot-started confirmation when Meeting
   Guard AI adds or moves a meeting on the server, outside this chat and the app (3.3).
   Calendar-sync echoes are excluded because the user made those changes in their own calendar.
   No such server path exists before M13, so 3.3 is submitted but its trigger stays off until
   Francisco answers. The other reading, the chat's own Confirm/Cancel and "Done" replies, needs
   no template; then 3.3 stays unused. Ask Francisco.
2. Which tasks get WhatsApp reminders. Default: tasks accepted from summaries (the `sm_` filter),
   as the request says (M11-DESIGN.md:1133-1134). Ask Francisco whether all tasks with a reminder
   should get WhatsApp reminders too.
3. The phone and WhatsApp both remind. Default: both, since the phone schedules on its own
   (taskReminders.ts) and turning it off would need an app change.
4. The agenda on an empty day. Default: not sent (the phone's briefing does send one,
   briefing.ts:17-18), which saves a paid message.
5. `es` or `es_MX`. Default: `es`, neutral Latin American text.
6. How many debrief prompts. Default: at most 3 a day, only the meetings the phone gives a
   follow-up (no participant filter), none from 21:00 to 7:00, none while the user has no AI
   action left.
7. What STOP turns off. Default: every message the bot starts, all switches at once; turned back on
   only in the app, where the opt-in is recorded. Normal chat keeps working.
8. STOP words. Default: STOP advertised in both languages; the list of section 7 accepted too
   (parar, detener, baja, unsubscribe, darme de baja, dar de baja, no mas mensajes, stop messages,
   stop reminders, and a short message starting with stop or baja), with punctuation and emoji
   ignored.
9. Commitments ready for a summary the user files by hand in the app. Default: no message.
10. Portuguese, French and German after M12. Default: they get the English templates until
    translated ones are approved (each adds a review, and the assistant itself stays EN and ES,
    Project-Plan-2026-11-09.md:89).
11. The agenda time and zone. Default: the app's briefing time, in the zone the app last sent to
    the opt-in record (section 3); no agenda while the server only has the UTC fallback.
12. Who submits. Default: Francisco, or someone he gives full control of the WhatsApp account; the
    API route of section 7 needs no web login.
13. A voice note after "Debrief". Default: treated as the debrief once M13's voice notes work.
14. A template even when the user wrote in the last 24 hours. Default: always the template; one
    path, and the free-form alternative is billable as well since October 1, 2026.
15. 24-hour times for English. Default: 24-hour as in the bot today; `use24HourClock` false
    (types.ts:704) could switch to "4:00 PM".
16. The phone's follow-up ("How did it go?", `followUpEnabled`, on by default,
    src/core/types.ts:766) fires at the same time as 3.2. Default: send 3.2 anyway, since the user
    switched it on; ask Francisco.

## 9. Meta pages to check before submitting

Open these in a browser and check the points this batch relies on: the body, header, footer and
button limits, quick-reply labels with accents ("Recuérdamelo", "día"; one Meta page calls labels
"alphanumeric"), the 30-day block on deleted names, the validity range, whether WhatsApp Manager
offers the validity field (section 2 step 10), what happens to the validity when Meta changes a
template's category (the review read it as cleared), the names of the template status, quality and
category webhook fields (section 7), and whether #, $ or % are refused only in the {{ }} markers or
also in values sent later (the drafter read it as the markers).

- Components and limits: https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components.md
- Template review and rejection reasons: https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-review/
- Categories: https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization
- Template management (names, edits, limits): https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-management/
- Supported languages: https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/supported-languages
- Validity (time-to-live): https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/time-to-live/
- Opt-in: https://developers.facebook.com/documentation/business-messaging/whatsapp/getting-opt-in
- Button taps in the webhook: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/button/
- Pricing: https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing
- Messaging limits: https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits
- Error codes: https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes
- WhatsApp Business Messaging Policy (read directly, updated September 23, 2026): https://whatsappbusiness.com/policy/
