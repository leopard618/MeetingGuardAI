# Release 1.7.0: the Stage 3 and Stage 4 release (M10 to M14)

For: Dusko (who runs the deploys and the store builds) and Sven (who reviews the web parts).

Version 1.7.0 brings the summaries (M10, M11), the five languages (M12), WhatsApp complete
(M13) and the guest invitation links (M14), plus the admin additions. This file is the runbook
for the M13 and M14 parts and the order of the whole release. The languages part has its own
steps in `RELEASE-1.7.0-LANGUAGES.md`; the generic release and rollback procedure is
`docs/v1/DEPLOYMENT.md`. Nothing here deploys from a work branch except functions by name
(AGENTS.md rule 3).

## 0. Before building (freeze)

1. The PR with M13 and M14 is merged into `v2`; CI is green (app checks, functions checks and
   the Firestore rules tests, which run only in CI because they need Java).
2. `TEST-GUIDE-STAGE3.md` and `TEST-GUIDE-STAGE4.md` passed on an Android phone and an iPhone,
   with a test APK and a TestFlight build of the freeze commit.
3. `version` is 1.7.0 in app.config.js and package.json.

## 1. Server, in this order

All from a checkout of `v2`, in `functions/` (`cd /d/WorkSpace/MeetingGuard_2025.7.28/Codebase/functions`).

1. Parameters (owner edits `functions/.env.meetingguard-ai-app`, never in a chat):
   - `WHATSAPP_TEMPLATES_MODE=preview` (the messages the bot starts go out inside the 24-hour
     window only, for the test before Meta approves the templates). `off` sends nothing and hides
     the opt-in in the app.
   - `WHATSAPP_WABA_ID=<digits>`: the WhatsApp Business account id, for the hourly template status
     sync. Not a secret. Empty means no sync (then only the template webhooks fill the states).
   - Nothing else is new. `WHATSAPP_ENABLED=true` and `SUMMARIES_ENABLED=true` stay.
2. Functions by name (answer No if the CLI offers to delete anything; cancel if it asks for a
   secret value):

   ```text
   npx firebase deploy --only functions:whatsappWebhook,functions:whatsappMessages,functions:whatsappTick,functions:whatsappTaskReminderSync,functions:dailyMaintenance,functions:deleteAccount,functions:adminGetWhatsapp,functions:adminGetAlertsHealth,functions:adminGetUser,functions:reportAlertHealth,functions:guestLinkCreate,functions:guestLinkRevoke,functions:guestView,functions:guestRespond
   ```

   whatsappTick binds WHATSAPP_ACCESS_TOKEN (the webhook's secret; no new secret). The guest
   functions and reportAlertHealth bind no secret.
3. Firestore rules from `v2` (`npx firebase deploy --only firestore:rules`): the guest answers
   (`users/{uid}/guestResponses`, owner reads and marks seen or decided) need them before the app
   ships. The new server-only collections are denied by the catch-all already.
4. Hosting from `v2` (`npx firebase deploy --only hosting`): the guest page at `/g` and the admin
   WhatsApp, Alerts health and user page additions. Check:
   https://meetingguard-ai-app.web.app/g shows "This link does not work" (no token), and the
   admin page shows the WhatsApp and Alerts health tabs.
5. Logs to read after each step: `npx firebase functions:log --only whatsappTick` shows
   `whatsapp.tick` every 5 minutes with `mode: preview`.

The guest page address is frozen into every invitation sent: `https://meetingguard-ai-app.web.app/g`.
If the web agenda later serves its own guest page, that page calls the same two functions
(`guestView`, `guestRespond`) and the hosting `/g` path redirects to it; never the other way round.

## 2. Meta (WhatsApp Manager), owner or Francisco

1. Submit the seven templates of `WhatsApp-Templates-2026-11-12.md` sections 2 and 3, English
   and Spanish, category Utility, with the validity of section 1.
2. In the Meta app's WhatsApp configuration, subscribe the webhook fields
   `message_template_status_update`, `message_template_quality_update` and
   `template_category_update` (today only `messages` is subscribed).
3. When all fourteen language versions show Active, set `WHATSAPP_TEMPLATES_MODE=live` and
   deploy `whatsappTick` and `whatsappMessages` by name. The admin WhatsApp tab lists every
   template with Usable yes or no; a template Meta moves to Marketing stops by itself.

## 3. The app

1. Store builds of 1.7.0 (EAS, production profile), Android first.
2. Store declarations, both stores:
   - WhatsApp voice notes go to OpenAI for transcription (not stored): the AI data line already
     names OpenAI; no new data type.
   - Guest answers (name, email, note typed by a guest) are stored in the owner's account. On
     Google Play's data safety form this is "other user content" collected and not shared; on
     Apple's privacy label it falls under "Other User Content", linked to the user, not used
     for tracking.
   - The phone's alarm health report (permission states and alarm counts) is diagnostics.
3. Release notes (five languages): voice notes on WhatsApp; daily agenda, debrief prompts and
   task reminders on WhatsApp when you turn them on; reply links for guests; plus the M10 to M12
   lines of `RELEASE-1.7.0-LANGUAGES.md`.
4. The website: Sven publishes the privacy text for the voice notes, the WhatsApp messages and
   the guest links (the in-app texts of `src/i18n/locales/*/legal.json`, sections whatsapp and
   guests) before the store submission.

## 4. After release

- Admin, Alerts health tab: phones with notifications or exact alarms off, from the first
  sessions on 1.7.0.
- Admin, WhatsApp tab: opt-ins and sends; a failed send shows Meta's code (131047 window closed
  is expected in preview mode for users who did not write in the last 24 hours).
- A guest link abused: turn it off on the meeting (the owner), or lower `GUEST_TUNING` and
  redeploy `guestView` and `guestRespond`.

## 5. What can go wrong

| Symptom | Cause | What to do |
|---|---|---|
| No WhatsApp messages at all | `WHATSAPP_TEMPLATES_MODE` off, or whatsappTick not deployed | Check the param and the tick log |
| Sends fail with 131047 | Preview mode and the user did not write in 24 hours | Expected until live mode |
| Sends skipped `template_unavailable` | Live mode and the template is not Active as Utility | Admin WhatsApp tab; wait for Meta or fix the template |
| Guest page says the link does not work | Link turned off, or the meeting not in Firestore yet | Share the link again from meeting details |
| The reply line missing on a new meeting | The phone was offline when the meeting was saved | Meeting details > Add the reply link to the invitation |
