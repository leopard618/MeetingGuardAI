# Claim ledger: in-app legal texts for 1.6.0 (dated 2026-11-06)

One line per factual claim the new or changed texts make. The Spanish text makes the same claims.
Paths are relative to the repo root (branch v2, read on November 6, 2026). VERIFIED = the code at
that location does what the sentence says. NOT VERIFIED = no code can prove it (a third party's
behaviour, a console or environment setting, a legal statement); the reason is given.

Second pass (November 6, after the accuracy, language and compliance reviews): rows marked "(R)"
are new or changed because of a review finding. The decision on every finding is in the last
section. The website copy of these texts is TERMS-UPDATE-FOR-WEBSITE-2026-11-06.md in this folder
(it carries every changed string word for word).

## Privacy Policy

| # | Section | Claim | Evidence | Status |
|---|---|---|---|---|
| P1 | collect | Sign-in exists with Google, Apple and Microsoft | src/services/auth/authService.ts:7-25; src/i18n/locales/en/landing.json:7 | VERIFIED |
| P2 | collect | We receive the name and email the provider shares and, when it gives one, the profile photo | src/services/auth/authService.ts:106-107, 429; src/services/data/mapping.ts:203-205 | VERIFIED |
| P3 | collect | Together with the account identifier at that provider | Google and Apple: Firebase credential exchange, src/services/auth/authService.ts:7-20; Microsoft: functions/src/microsoftSignIn.ts:303-309, 430 | VERIFIED (Google and Apple ids are held by Firebase Authentication) |
| P4 (R) | collect | Tasks hold title, description (notes), due date and time, reminder, people (name, optional email) and the linked meeting | src/core/types.ts:1087-1110; src/i18n/locales/en/tasks.json:67 (the editor calls the field "Description") | VERIFIED |
| P5 | collect | Preferences include the calendars and the task lists chosen for sync | src/core/types.ts:706-719 | VERIFIED |
| P6 | collect | The App Store or Google Play handles the payment; we never receive card or bank details | src/services/purchases/service.ts:271-332; functions/src/revenuecat/mapping.ts:34-58 (the only event fields we read) | VERIFIED |
| P7 (R) | collect | RevenueCat sends our server a record of each subscription event, such as a purchase, renewal, plan change, billing problem, cancellation or expiry | functions/src/revenuecat/mapping.ts:19-31 (INITIAL_PURCHASE, RENEWAL, PRODUCT_CHANGE, BILLING_ISSUE, CANCELLATION, EXPIRATION, TRANSFER and others); functions/src/revenuecat/index.ts:297-331 | VERIFIED |
| P8 (R) | collect | The record holds the plan, store, product, price and currency, the dates and a cancellation or expiry reason | functions/src/revenuecat/index.ts:104-124 (markerOf: cancelReason, expirationReason, currency, environment) | VERIFIED |
| P9 | collect | It tells us which plan you have and when it renews or ends | functions/src/revenuecat/mapping.ts:110-140; functions/src/shared/entitlement.ts:53-66 | VERIFIED |
| P10 (R) | collect | WhatsApp: we store the phone number, the WhatsApp profile name, the link date and the conversation state, which is the last 10 messages (the user's and the assistant's together) and a pending proposal | functions/src/whatsapp/session.ts:43-57, 94-97, 314; functions/src/whatsapp/webhook.ts:289, 339; functions/src/config.ts:265 | VERIFIED |
| P10a (R) | collect | Crash reporting also sends performance measurements of a sample of sessions; email addresses are removed from error reports | src/services/sentry.ts:63-69 (tracesSampleRate 0.1), 70-81 (beforeSend scrubs error events only) | VERIFIED |
| P11 | device | The offline copy includes tasks and is deleted at sign-out | src/services/data/cache.ts:5-9; src/services/data/engine.ts:927-946 | VERIFIED |
| P12 | use | Task lists are synced | src/services/calendar/engine.ts:14-16, 30-37 | VERIFIED |
| P12a (R) | use | The app keeps meetings, tasks and notes up to date and schedules alerts and reminders | src/services/data/cache.ts:5-9; src/services/alerts/taskReminders.ts:1-12 | VERIFIED |
| P13 | use | The assistant also answers on WhatsApp | functions/src/whatsapp/index.ts:191; functions/src/whatsapp/webhook.ts:288-304 | VERIFIED |
| P14 | use | Your data is used to manage a subscription you buy | functions/src/revenuecat/index.ts:1-17; src/services/purchases/index.ts:1-19 | VERIFIED |
| P15 | google | Google Tasks uses the "tasks" permission, asked for when you turn the sync on | src/core/contracts.ts:591; src/services/tasks/gtasks/index.ts:5-7 | VERIFIED |
| P16 | google | That permission allows creating, editing, organizing and deleting all your tasks | Google's own description of the https://www.googleapis.com/auth/tasks scope | NOT VERIFIED (Google's consent wording, not code) |
| P17 | google | The app only works with the task lists you choose | src/services/tasks/gtasks/sync.ts:4-5, 12-17, 123-128; src/core/types.ts:718 | VERIFIED |
| P18 | google | It imports their tasks and writes the tasks you create, complete, change or delete | src/services/tasks/gtasks/sync.ts:4-17 | VERIFIED |
| P19 | google | Title, notes, due date and completion sync; due time, reminder, people and meeting stay in the app | src/services/tasks/gtasks/mapping.ts:63-74; src/i18n/locales/en/tasks.json:106 | VERIFIED |
| P20 | google | With To Do sync on too, tasks from Google Tasks are also written to the To Do list | src/services/calendar/engine.ts:35-37, 152-171, 404-422 | VERIFIED |
| P21 | google | Events and tasks are saved in the Firebase account | firestore.rules:371; functions/src/assistant/tasksContext.ts:5 | VERIFIED |
| P22 | google | They drive alerts and task reminders | src/services/alerts/taskReminders.ts:1-7; src/services/alerts/briefing.ts:1-10 | VERIFIED |
| P23 | google | The assistant can answer questions about your tasks | functions/src/assistant/handler.ts:185-193 | VERIFIED |
| P24 | google | The Google token stays on the device, is managed by Google Sign-In and is never stored on our servers (Calendar and Tasks) | src/services/auth/authService.ts:11-12; src/services/tasks/gtasks/index.ts:38-41 | VERIFIED |
| P25 | google | Google Calendar and Google Tasks are disconnected on the Calendar sync screen in Settings | src/screens/settings/SettingsScreen.tsx:163-166; src/screens/calendarSync/CalendarSyncScreen.tsx:5-12; src/i18n/locales/en/calendar.json:29, 116 | VERIFIED |
| P25a (R) | google | Stopping a sync removes the imported events or tasks from the app; nothing is deleted in Google | src/services/calendar/google/service.ts:188-204 (removeGoogleLinks); src/i18n/locales/en/calendar.json:28, 115 | VERIFIED |
| P26 (R) | google (Limited Use) | Transfer examples: OpenAI (assistant), Meta (WhatsApp replies about Google events and tasks), Zoom (a Zoom link added to a Google event sends its title and time), Outlook (a change pulled from Google for your own meeting is pushed on to Outlook) and To Do (the task bridge) | functions/src/assistant/prompt.ts:205-208; functions/src/whatsapp/executor.ts:624-685 and webhook.ts:296-344; src/core/conference.ts:94-101 and functions/src/zoom/api.ts:128-139; src/services/calendar/engine.ts:479-496; src/services/calendar/engine.ts:152-171 | VERIFIED |
| P27 | microsoft | Continue with Microsoft opens Microsoft's page and sends the signed id_token to our server | src/services/microsoft/signIn.ts:1-11; src/i18n/locales/en/landing.json:7; functions/src/microsoftSignIn.ts:1-17 | VERIFIED |
| P28 | microsoft | The token carries name, email and account identifier | functions/src/microsoftSignIn.ts:67-75 | VERIFIED |
| P29 | microsoft | Our server checks it | functions/src/microsoftSignIn.ts:4-10 | VERIFIED |
| P30 | microsoft | It creates the account on the first sign-in or links an existing account with the same email when Microsoft confirms the address | functions/src/microsoftSignIn.ts:10-15, 218, 352-355, 400-431 | VERIFIED |
| P31 | microsoft | We keep the Microsoft account id, its tenant id, the email and the first and last sign-in dates | functions/src/microsoftSignIn.ts:303-309, 430, 466-471 | VERIFIED |
| P32 (R) | microsoft | Outlook asks for Calendars.ReadWrite and Tasks.ReadWrite together, plus User.Read and offline_access | src/core/contracts.ts:751-752 | VERIFIED |
| P33 | microsoft | Events of the main Outlook calendar are imported | src/services/calendar/outlook/api.ts:67 (/me/calendarView/delta, the default calendar) | VERIFIED |
| P34 (R) | microsoft | Meetings created, changed or deleted in the app are written to Outlook, except events that come from Google Calendar or the phone | src/services/calendar/outlook/sync.ts:491-493 (isOutlookPushable); src/services/calendar/engine.ts:11-13, 470-480 | VERIFIED |
| P35 | microsoft | Outlook sends the invitations to the participants | src/services/calendar/outlook/mapping.ts:390-402 (attendees on every pushed event); src/services/calendar/engine.ts:24-26 | NOT VERIFIED for the sending itself (Outlook's behaviour); attendees are sent, VERIFIED |
| P36 | microsoft | A Teams link is created as an online meeting in Outlook and Microsoft creates the link | src/services/calendar/outlook/mapping.ts:407-410; src/services/calendar/outlook/sync.ts:427-448 | VERIFIED |
| P37 | microsoft | To Do only works with the lists you choose, imports and writes back | src/services/tasks/todo/sync.ts:3-17; src/services/tasks/todo/index.ts:5-6 | VERIFIED |
| P38 (R) | microsoft | Title, notes, due date, reminder and completion sync; a due time without a reminder, people and meeting stay in the app | src/services/tasks/todo/mapping.ts:1-9, 108-126 (due sent at 00:00, the time travels only as the reminder); src/i18n/locales/en/tasks.json:98 | VERIFIED |
| P39 | microsoft | With Google Tasks sync on too, tasks from To Do go to Google Tasks and the other way round | src/services/calendar/engine.ts:152-171 | VERIFIED |
| P40 (R) | microsoft | Events and tasks from Microsoft are saved in the Firebase account and the assistant can answer about them | firestore.rules:371; src/core/types.ts:172-196; functions/src/assistant/context.ts:357-372 and tasksContext.ts:157-169 (every meeting and task, any source) | VERIFIED |
| P41 (R) | microsoft | Microsoft tokens stay on the device and never reach our servers; the stored one is in secure storage and deleted at sign-out or Outlook disconnect | src/services/auth/microsoftTokens.ts:1-13, 23-24; src/services/calendar/outlook/index.ts:4-6, 13; no file in functions/src calls Microsoft Graph | VERIFIED |
| P42 | microsoft | Outlook and To Do sync are stopped on the Calendar sync screen | src/screens/calendarSync/CalendarSyncScreen.tsx:7-10; src/i18n/locales/en/calendar.json:52, 84 | VERIFIED |
| P43 | microsoft | Personal accounts remove the access at account.live.com/consent/Manage | src/services/microsoft/authPrompt.ts:46-47 | VERIFIED |
| P43a (R) | microsoft | Stopping a sync removes the imported events or tasks from the app; nothing is deleted in Outlook or To Do | src/i18n/locales/en/calendar.json:51, 83 | VERIFIED |
| P44 | zoom | Our server creates the meeting on Meeting Guard AI's own Zoom account | functions/src/zoom/api.ts:22-27; functions/src/zoom/token.ts:1-10, 61 | VERIFIED |
| P45 | zoom | The join link and the passcode are stored with the meeting | functions/src/zoom/handler.ts:307-311 | VERIFIED |
| P46 (R) | zoom | Our server sends Zoom only the title, start time, duration and time zone; a repeating meeting only the title | functions/src/zoom/api.ts:128-139 | VERIFIED |
| P47 | zoom | Changing or deleting the meeting in the app updates or deletes it on Zoom | src/services/zoom/zoomService.ts:284-316 | VERIFIED |
| P48 | zoom | No Zoom account is needed and the user's own Zoom account is never connected | functions/src/zoom/token.ts:1-10; src/services/zoom/zoomService.ts:1-18 | VERIFIED |
| P48a (R) | zoom | The meeting is hosted on our Zoom account; Zoom handles the call and may give the host its meeting reports | functions/src/zoom/api.ts:21-27 (ZOOM_HOST_USER 'me'); functions/src/zoom/handler.ts:15-20 ("All Zoom meetings live on ONE shared host account") | VERIFIED for the hosting; the reports are Zoom's product: NOT VERIFIED |
| P49 | whatsapp | Optional; linked with a one-time code from the WhatsApp assistant screen in Settings | functions/src/whatsapp/link.ts:1-11, 92-94, 126-138; src/screens/settings/SettingsScreen.tsx:175-178; src/i18n/locales/en/whatsapp.json:9 | VERIFIED |
| P50 | whatsapp | Messages reach our server through Meta (WhatsApp Business Platform) | functions/src/whatsapp/webhook.ts:60-95; functions/src/whatsapp/signature.ts:4-7 | VERIFIED |
| P51 | whatsapp | Handled like app requests: OpenAI gets the recent chat messages and the same view of meetings and tasks | functions/src/whatsapp/webhook.ts:288-304 (mode chat, current contract version); functions/src/assistant/handler.ts:181, 185-193 | VERIFIED |
| P52 | whatsapp | Nothing is created, changed or deleted until confirmed in the chat | functions/src/whatsapp/webhook.ts:166-199, 349-357, 444-474 | VERIFIED |
| P53 (R) | whatsapp | Replies, including the meetings and tasks asked about with their title, date, time and video-call link or address, go back through Meta | functions/src/whatsapp/executor.ts:624-647 (place = conference.url, else address, else virtualUrl); functions/src/whatsapp/webhook.ts:320-344; functions/src/whatsapp/send.ts:2, 58 | VERIFIED |
| P53a (R) | whatsapp | Use of WhatsApp itself is subject to WhatsApp's own terms and privacy policy | legal statement | NOT VERIFIED (counsel) |
| P54 (R) | whatsapp | The server keeps the last 10 messages of the chat in total, the user's and the assistant's, and a pending proposal | functions/src/whatsapp/session.ts:43-57, 94-97 (pushTurn keeps maxTurns); functions/src/config.ts:265; functions/src/whatsapp/webhook.ts:289, 339 | VERIFIED |
| P55 | whatsapp | After 15 minutes without messages they are no longer used and the next message starts a new conversation | functions/src/whatsapp/session.ts:78-92; functions/src/config.ts:257; functions/src/whatsapp/webhook.ts:428-431 | VERIFIED |
| P56 | whatsapp | The conversation state is deleted once 30 days pass without messages | functions/src/maintenance/core.ts:25-31, 102-106; functions/src/maintenance/index.ts:65-74; functions/src/config.ts:277 | VERIFIED (daily run at 03:30 UTC) |
| P57 | whatsapp | Server logs never hold message text or phone numbers | functions/src/whatsapp/webhook.ts:12-13; functions/src/whatsapp/signature.ts:9-13, 60-63; functions/src/whatsapp/link.ts:11 | VERIFIED |
| P58 | whatsapp | Unlinking on that screen deletes the link and the conversation state | src/i18n/locales/en/whatsapp.json:26; functions/src/whatsapp/link.ts:163-184 | VERIFIED |
| P59 | ai | Meetings from the past 7 days to the next 60 days, plus repeating meetings | functions/src/assistant/context.ts:36-44, 167-180; functions/src/config.ts:110-111 | VERIFIED |
| P60 | ai | Titles, dates and times, locations, up to 10 participants with names and emails | functions/src/assistant/context.ts:307-331; functions/src/config.ts:119 | VERIFIED |
| P61 (R) | ai | Descriptions only, shortened, for the meetings of the past 7 days and the next 2 days, for repeating meetings that already started, and for the follow-up or debrief meeting | functions/src/assistant/prompt.ts:57-62, 196-204 (start - now <= 2 days); functions/src/assistant/context.ts:35-44, 176-185 (series loaded whatever their date), 213-216 (start = first occurrence), 342-348; functions/src/config.ts:123, 125 | VERIFIED |
| P62 (R) | ai | Notes and the video-call link and passcode saved with a meeting are never sent; a description is sent as written, so a link or passcode inside it is sent too | functions/src/assistant/context.ts:263-266 (clip only collapses whitespace), 316 (conference: provider and hasLink only), 357-372 (field mask: no notes, no password); src/services/calendar/shared.ts:118-134 (stripJoinBlock removes only the app's own block); src/services/calendar/google/mapping.ts:273; src/services/calendar/outlook/mapping.ts:229 | VERIFIED |
| P63 | ai | In chats and debriefs: open tasks and tasks completed in the last 7 days, up to 100 | functions/src/assistant/handler.ts:185-193; functions/src/assistant/tasksContext.ts:44-45, 54-101; functions/src/config.ts:114 | VERIFIED |
| P64 | ai | Task fields sent: title, status, due date and time, reminder, people's names, linked meeting | functions/src/assistant/tasksContext.ts:107-150 | VERIFIED |
| P65 (R) | ai | Task descriptions (notes) are never sent | functions/src/assistant/tasksContext.ts:107-150 (description is read, line 159, but not in the model view) | VERIFIED |
| P65a (R) | ai | Each request carries a coded identifier derived from the account, used by OpenAI to detect abuse | functions/src/assistant/llm.ts:39-41 (sha256 of a prefix and the uid), 96 (safety_identifier); functions/src/assistant/handler.ts:218 | VERIFIED (OpenAI's use of it: OpenAI's documentation) |
| P65b (R) | ai | Voice input: the microphone is used only after a tap and until listening stops, in the assistant and in a debrief | src/screens/assistant/useVoice.ts:170-215 (toggle start and stop); src/screens/assistant/DebriefPanel.tsx:1-6 (the chat screen's voice session) | VERIFIED |
| P65c (R) | ai | The phone's recognizer (Apple's on iPhone, usually Google's on Android) may send the audio to its servers | src/screens/assistant/useVoice.ts:197-209 (no requiresOnDeviceRecognition); node_modules/expo-speech-recognition/build/ExpoSpeechRecognitionModule.types.d.ts:203-207 (default false: audio may go over the network) | VERIFIED that on-device is not required; what a given phone does: NOT VERIFIED (platform) |
| P65d (R) | ai | The app does not save the audio and never sends it to our servers; only the recognized text is sent | src/screens/assistant/useVoice.ts:1-12, 197-209 (no recordingOptions; transcripts go to onTranscript and onFinal) | VERIFIED |
| P66 | sharing | Microsoft, when you sign in with Microsoft or connect Outlook or To Do | see P27-P43 | VERIFIED |
| P67 | sharing | Apple, when you sign in with Apple | src/services/auth/authService.ts:15-20 | VERIFIED |
| P67a (R) | sharing | The phone's speech recognition service may receive the audio of voice input | see P65c | VERIFIED as P65c |
| P68 (R) | sharing | Our server sends Zoom only title, time, duration and time zone | functions/src/zoom/api.ts:128-139 | VERIFIED |
| P69 | sharing | Meta carries the WhatsApp messages | see P50, P53 | VERIFIED |
| P70 (R) | sharing | RevenueCat receives the anonymous user ID of every signed-in user at session start, with its SDK's technical data, and the store's purchase records of buyers | src/services/purchases/index.ts:7-16, 46-57 (configure(uid) on session:started); src/services/purchases/service.ts:243-263 (appUserID = uid) | VERIFIED for the uid; the SDK's own technical data: NOT VERIFIED (RevenueCat SDK); only builds with the platform key (production keys: NOT VERIFIED) |
| P70a (R) | sharing | Sentry also receives performance measurements | src/services/sentry.ts:63-69 | VERIFIED |
| P70b (R) | sharing | Expo is asked for a newer version at every start, which shares the IP address, the app version and a random installation identifier | app.config.js:129-137 (updates.url, checkAutomatically ON_LOAD); node_modules/expo-updates/android/src/main/java/expo/modules/updates/loader/FileDownloader.kt:836 and ios/EXUpdates/AppLoader/FileDownloader.swift:448 (EAS-Client-ID header) | VERIFIED |
| P71 | sharing | Google Tasks, Outlook and To Do only when connected | src/services/calendar/engine.ts:222-229; src/services/tasks/gtasks/service.ts:165-189 | VERIFIED |
| P71a (R) | sharing (note) | Our service providers may use the data only to provide their service to us and must protect it at least as well as the policy describes | contracts with the providers | NOT VERIFIED (owner: confirm the data processing terms of OpenAI, RevenueCat, Sentry, Expo, Zoom, Meta and Google Cloud) |
| P72 (R) | retention | Account deletion removes account, meetings, tasks, notes, preferences, usage, subscription status, WhatsApp link and Microsoft sign-in record, and does not cancel a store subscription | functions/src/deleteAccount.ts:65-79, 130-138 (only entitlements/{uid}; no store or RevenueCat call) | VERIFIED (the store's billing: store behaviour) |
| P73 | retention | It removes the app's access to the Google account or the Apple account | src/services/auth/sessionCore.ts:20-22; src/screens/settings/useDeleteAccountFlow.tsx:8-13, 84 | VERIFIED (Apple revocation is best effort, with a notice on failure) |
| P74 | retention | Copies in Google Calendar, Outlook, the phone calendar, Google Tasks and To Do stay there | functions/src/deleteAccount.ts:65-79 (no provider call); src/i18n/locales/en/calendar.json:28, 51, 83, 115 | VERIFIED |
| P74a (R) | retention | The Zoom meetings created for the user stay on our Zoom account after account deletion until the user asks us to delete them | functions/src/deleteAccount.ts:53-57, 119-129 (registry deleted, ids copied to the deletion record, no Zoom call); functions/scripts holds no Zoom cleanup; functions/src/maintenance/core.ts:94-98 | VERIFIED (deleting on request is a manual owner task) |
| P75 | retention | The WhatsApp link (number and profile name) is kept until unlink or account deletion | functions/src/whatsapp/link.ts:163-184; functions/src/deleteAccount.ts:72 | VERIFIED |
| P76 | retention | Conversation state: unused after 15 minutes, deleted after 30 days without messages | see P55, P56 | VERIFIED |
| P77 (R) | retention | Purchase event records (uid, plan, store, product, price and currency, dates) stay on our servers after account deletion, as revenue records | functions/src/revenuecat/index.ts:104-124, 301-309; functions/src/deleteAccount.ts:65-79 (not deleted); functions/src/maintenance/core.ts:88-115 (no purge); functions/src/admin/revenue.ts:1-20 | VERIFIED (no time limit exists, see open questions) |
| P77a (R) | retention | RevenueCat keeps its own record of the user ID, and of purchases, after account deletion | functions/src/deleteAccount.ts:65-79 (no RevenueCat call); functions/src/revenuecat/reconcile.ts:427 (GET only) | VERIFIED that we do not delete it; RevenueCat's retention: NOT VERIFIED |
| P78 (R) | retention | Logs hold the user ID, technical identifiers, the request details Google Cloud records (IP address, type of app) and a code instead of the WhatsApp number, for up to 30 days | functions/src/whatsapp/signature.ts:60-63; functions/src/whatsapp/webhook.ts:219-422 and executor.ts:369-525 (meetingId, taskId, wamid); functions/src/zoom/handler.ts:333; functions/package.json (firebase-functions 7.4.0, v2 functions on Cloud Run) | VERIFIED for our own log lines; Cloud Run request logs (IP, user agent) and the 30-day retention are platform settings: NOT VERIFIED |
| P79 (R) | retention | The deletion record holds the uid, the date and the Zoom meeting numbers, for 30 days; after a restore we use the record to delete the data again | functions/src/deleteAccount.ts:89-91, 119-129; functions/src/maintenance/core.ts:22-23, 94-98, 129-139 | VERIFIED; the replay does not yet delete microsoftIdentities or zoomMeetings (open question) |
| P79a (R) | notifications | Meeting alerts, task reminders, the follow-up reminder (on by default) and the daily briefing (off by default) are local notifications that show titles and times; no server push | src/services/alerts/plan.ts:11, 156; src/services/alerts/taskReminders.ts:1-12; src/services/alerts/briefing.ts:1-14; src/core/types.ts:766-767; src/i18n/locales/en/alerts.json:2-14, 34-44; no push token or FCM call in src or functions/src | VERIFIED |
| P80 | rights | Tasks can be edited in the app | src/i18n/locales/en/tasks.json:67; src/core/types.ts:1092-1110 | VERIFIED |
| P81 | rights | Consent is withdrawn by stopping Google Tasks, Outlook or To Do sync or unlinking WhatsApp | src/i18n/locales/en/calendar.json:29, 52, 84, 116; functions/src/whatsapp/link.ts:180-184 | VERIFIED |
| P82 | rights (note) | Legal bases: contract, consent (calendar and task connections, WhatsApp, the assistant), legitimate interest | legal statement | NOT VERIFIED (counsel) |

## Terms of Service

| # | Section | Claim | Evidence | Status |
|---|---|---|---|---|
| T1 | service | The app stores meetings, tasks and notes and schedules reminders on the device | src/services/data/cache.ts:5-9; src/services/alerts/taskReminders.ts:1-7 | VERIFIED |
| T2 | service | It syncs with Google Calendar, Outlook, the phone calendars, Google Tasks and Microsoft To Do when connected | src/screens/calendarSync/CalendarSyncScreen.tsx:1-17 | VERIFIED; present in the 1.6.0 store build per docs/v2/RELEASE-1.6.0.md:19-29 (MSAL client id set, Google Tasks switch unset): NOT VERIFIED in code (EAS environment) |
| T2a (R) | account | Sign-in is offered with Google, Apple, Microsoft or a password | src/services/auth/authService.ts:7-25; src/i18n/locales/en/landing.json:5-8 | VERIFIED |
| T3 | service | The assistant proposes tasks from a debrief spoken or typed after a meeting, for you to confirm | src/screens/assistant/DebriefPanel.tsx:1-6; src/screens/meetings/debrief.ts:1-14; src/i18n/locales/en/ai.json:29; functions/src/assistant/prompt.ts:154-166 | VERIFIED |
| T4 | service | Running late prepares a message with the new time that you send from your phone; the meeting moves only if you choose | src/screens/meetings/runningLate.ts:1-10 | VERIFIED |
| T5 | plans | The Free plan needs no payment | src/services/billing.ts:64 | VERIFIED |
| T6 | plans | Pro and Premium are bought in the app through the App Store or Google Play | src/services/purchases/service.ts:271-332; src/screens/pricing/PricingScreen.tsx:428-470 | VERIFIED; sales need the platform's RevenueCat key in the build (src/services/purchases/index.ts:7-12): production keys NOT VERIFIED (EAS environment) |
| T7 | plans | The AI actions per plan are in the "AI assistant" section above | src/i18n/locales/en/legal.json terms.sections.ai.items[1]; src/screens/legal/legalContent.ts:41-57 (ai before plans) | VERIFIED |
| T8 | plans | Monthly or yearly, renew automatically at the same price until cancelled in Google Play or the App Store settings at least 24 hours before the end | src/i18n/locales/en/pricing.json:105-106; src/screens/pricing/PricingScreen.tsx:606; src/services/billing.ts:63-89 | VERIFIED as the app's own wording; the renewal rules themselves are the stores': NOT VERIFIED in code |
| T8a (R) | plans | Payment is charged to the store account when the purchase is confirmed and at each renewal | docs/v2/APP-REVIEW-2026-10-20.md:160-165 (the App Store description already says it) | NOT VERIFIED (store behaviour; true without a trial) |
| T9 | plans | The store shows the final price with taxes before the purchase | src/i18n/locales/en/pricing.json:103-104; src/screens/pricing/PricingScreen.tsx:601 | VERIFIED as the app's own wording |
| T10 | plans | The store handles billing, cancellations and refunds | functions/src/revenuecat/mapping.ts:96-140 (we only react to store events; no billing or refund code exists) | VERIFIED |
| T11 | plans | After a cancellation the plan stays active until the end of the paid period, then returns to Free | functions/src/revenuecat/mapping.ts:106, 123-126; functions/src/shared/entitlement.ts:53-66; src/core/types.ts:908-915 | VERIFIED |
| T12 | plans | A store refund ends the plan | functions/src/revenuecat/mapping.ts:105, 124-125; functions/src/shared/entitlement.ts:58 | VERIFIED |
| T13 | plans | A change of plan or billing period is carried out by the store; some changes start at the next renewal | src/services/purchases/service.ts:310-325; src/i18n/locales/en/pricing.json:98-99 | VERIFIED |
| T13a (R) | plans | Deleting the app or the account does not cancel the subscription | functions/src/deleteAccount.ts:65-79 (no store call is possible from the server) | VERIFIED (the store keeps billing: store behaviour) |
| T14 | thirdParty | The app works with Google (sign-in, Calendar, Tasks, Firebase, Google Play), Apple (Sign in with Apple, App Store), Microsoft (sign-in, Outlook, To Do), Zoom, Meta (WhatsApp), OpenAI and RevenueCat | src/services/auth/authService.ts:7-25; src/core/contracts.ts:589-591, 749-754; functions/src/zoom/api.ts:22-27; functions/src/whatsapp/send.ts:58; functions/src/assistant/llm.ts:7, 80; src/services/purchases/index.ts:1-19 | VERIFIED |

## Website wording deliberately not carried over (the code does not do it)

TERMS-UPDATE-FOR-WEBSITE.md, section B13, gives Sven the same list.

| Website text (PRIVACY-POLICY-UPDATE-2026-11-02.md) | What the code does | Evidence |
|---|---|---|
| "Send STOP to pause the assistant" | No STOP handling exists; the only way out is Unlink | functions/src/whatsapp/webhook.ts:405-482 (no STOP branch) |
| "Apple and Microsoft may hide your real email address behind a relay address" | Microsoft sends the account email; only Apple offers relay addresses (Apple feature, not code) | functions/src/microsoftSignIn.ts:67-75 |
| Google: "reads the events of the calendars you choose" | Only the primary Google calendar is synced (the in-app "main calendar" wording is kept) | src/i18n/locales/en/calendar.json:12; docs/v1/HANDOFF.md:262 |
| Outlook: "the events of your Outlook calendars" | Only the default Outlook calendar is read | src/services/calendar/outlook/api.ts:67 |
| "We do not store the content of your messages beyond a short conversation state, which resets after 15 minutes" | The last 10 messages stay stored until the next message after a pause or the 30-day purge | functions/src/whatsapp/session.ts:78-97; functions/src/maintenance/core.ts:25-31 |
| WhatsApp: "we store that phone number, the date you linked it and a short conversation state" | The WhatsApp profile name is stored too | functions/src/whatsapp/session.ts:314 |
| "your upcoming meetings and open tasks" are sent to OpenAI | Meetings of the past 7 days to the next 60, repeating meetings, and tasks completed in the last 7 days too | functions/src/assistant/context.ts:167-180; functions/src/assistant/tasksContext.ts:44-45 |
| Microsoft "sends our server a signed proof" | The app sends Microsoft's id_token to our server | src/services/microsoft/signIn.ts:1-11 |
| "Settings > WhatsApp" | The row is "WhatsApp assistant" under Integrations | src/i18n/locales/en/whatsapp.json:4-8 |
| Work or school accounts remove access at myapps.microsoft.com | Not in the app; only the personal-account page is linked | src/services/microsoft/authPrompt.ts:46-47 |
| Delete page: the 30-day record is kept "so that pending charges or refunds can be matched" | The record exists to replay deletions after a backup restore | functions/src/maintenance/core.ts:9-16 |

## Review findings (November 6): decision per finding

Numbering follows the order of each review: A = accuracy, L = language, C = compliance. "Applied"
= in the drafts (and in the website document). "Open" = valid, but the fix is in app code, the
repo docs, a console or a counsel decision, none of which this pass may change; it is listed in
the open questions of the hand-off.

| Finding | Decision | Where |
|---|---|---|
| A1, C1 voice input missing | Applied | privacy.ai body[3]; sharing item (speech recognition service); P65b-P65d, P67a |
| A2 "video-call links and passcodes are never sent" false when a description holds them | Applied (reworded; stripping them in code is open) | privacy.ai body[0]; P62 |
| A3, C19 RevenueCat gets every signed-in user; its record survives deletion; currency | Applied, except "anonymous" kept as the policy's defined term (open, counsel) | sharing RevenueCat item; retention items 6 and 7; P70, P77, P77a |
| A4, C6 Zoom meetings survive account deletion | Applied as disclosure; the cleanup job is open | retention item 4; P74a |
| A5 Zoom hosting and meeting reports | Applied | privacy.zoom body[1]; P48a |
| A6, L2 meeting form says only Google sends invitations | Open (app code: MeetingFormScreen.tsx:149, 738-742; meetings.json:92-93) | none |
| A7, L3, C13 description sentence too narrow and unclear | Applied | privacy.ai body[0]; P61 |
| A8, L5, L6, C14 To Do due time, offline_access, assistant purpose | Applied | privacy.microsoft body[1-3]; P32, P38, P40 |
| A9, C20 OpenAI safety identifier | Applied | privacy.ai body[2]; P65a |
| A10, C21 server logs hold more than the user ID | Applied (to confirm in Logs Explorer: open) | retention item 8; P78 |
| A11 Sentry performance traces | Applied | collect item 6, sharing Sentry item; P10a, P70a |
| A12 Expo updates | Applied | sharing Expo item; P70b |
| A13, C5, C17 Limited Use transfers (Meta, Zoom, Outlook) and stop-sync removal | Applied (the bridge wording in the app's sync cards is open) | google items[1], google body[3], microsoft body[3]; P25a, P26, P43a |
| A14 WhatsApp replies carry the video-call link | Applied | privacy.whatsapp body[0]; P53 |
| A15 backup replay skips microsoftIdentities and zoomMeetings | Sentence kept (it states what we do after a restore); code fix open | P79 |
| A16, L10, C12 terms.account names only Google | Applied (factually incomplete for 1.6.0: Microsoft sign-in is new) | terms.account items[1]; T2a |
| L1 collect WhatsApp item understates the stored messages | Applied | collect item 7; P10 |
| L4 task "Description" versus "notes" | Applied | collect item 2, ai body[1]; P4, P65 |
| L7 WhatsApp paragraph: long sentence, "Desde entonces", WhatsApp's own terms | Applied | privacy.whatsapp body[0]; P53a |
| L8 "10 at most" ambiguous | Applied | privacy.whatsapp body[1]; P54 |
| L9 terms.service sentence too long | Applied | terms.service |
| L11, C15 use item without tasks | Applied | use items[0]; P12a |
| L12 word order and loose references | Applied | google body[1], microsoft body[1-3] |
| L13 Spanish subjunctive | Applied | es retention item 5 |
| L14 "si la facilita", "en nuestro nombre" | Applied (also in the sharing item) | es collect items 0 and 5, es sharing |
| L15 "tareas pendientes" | Applied | es ai body[1] |
| L16 paywall link says "Terms of Use" | Open (pricing.json:109) | none |
| L17 Settings row lists only Google Calendar | Open (settings.json:29) | none |
| C2 Apple 5.1.1(i) equal-protection statement | Applied (the providers' data processing terms must be confirmed: open) | sharing note; P71a |
| C3 November 2 website text contradicts the app | Applied in TERMS-UPDATE-FOR-WEBSITE.md (Part B replaces it, B13 lists the differences) | website document |
| C4 deletion does not cancel the subscription | Applied in the drafts; the delete confirmation text (auth.json:39) is open | terms.plans body[2], retention item 0; T13a, P72 |
| C7 no retention period for purchase records | Partly: RevenueCat's copy disclosed; the period and its legal basis are open (counsel) | retention items 6 and 7 |
| C8 store declarations behind the policy | Open (docs/v2/RELEASE-1.6.0.md section 3, consoles) | none |
| C9 delete-account page incomplete | Applied for the website page (TERMS-UPDATE-FOR-WEBSITE.md Part C); public/delete-account.html is open | website document |
| C10 onboarding AI disclosure and consent | Open (onboarding.json:130, product decision) | none |
| C11 legal texts must be in the store binary | Open (release step; see the apply instructions) | none |
| C16 notifications section only names meeting alerts | Applied | privacy.notifications; P79a |
| C18 when payment is charged | Applied | terms.plans body[1]; T8a |
| C22 trials still in the consoles | Open (console check) | none |
| C23 Apple standard EULA sentence | Not applied: the standard EULA picks California law, which conflicts with the England and Wales clause; counsel decides | none |
