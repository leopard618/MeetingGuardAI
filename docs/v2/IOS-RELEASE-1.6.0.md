# iOS 1.6.0: from the subscriptions to the release (build 11)

Status on November 8, 2026: Android 1.6.0 (versionCode 27) is live on Google Play at 100 percent. On
iOS, 1.5.0 (build 10) is live. Build 11 of 1.6.0 is built and audited (Xcode 26.6 with the iOS 26.5
SDK, which Apple accepts for the App Store until April 2027) but not uploaded. In App Store Connect
the subscription ranking is upside down, the descriptions still say "per day" and the 3-day trials
may still exist. The backend ignores sandbox purchases, and the website still shows the September 28
privacy policy and terms.

This guide was checked against Apple's help pages, the code and the live store pages (workflow
wf_09a2bac0-92d: research, an iOS feature check, a review-risk skeptic and a truth skeptic; their
corrections are applied). It replaces the App Store review note in RELEASE-1.6.0.md section 4; the
What's New texts there are T1 here.

Who does what:

- You (Dusko): App Store Connect, Firebase, Google Cloud and RevenueCat in the browser, and the
  functions deploys in your terminal.
- Francisco: the Account Holder. Only he can accept Apple agreements. He has the iPhone for the
  TestFlight checks.
- Assistant: runs the upload only after "upload iOS", and does repo work (the optional webhook fix,
  the tag, the changelog) only when asked. It never opens .env files or console pages.
- Sven: publishes the website pages.

Links: the App Store Connect deep links follow the URL pattern the site uses today, which Apple does
not document. If one lands on the wrong page, open https://appstoreconnect.apple.com/apps/6819847236
and follow the click path given with it.

## The order at a glance

| Phase | What | Who | Waits for |
|---|---|---|---|
| A | Agreements, website, subscriptions, RevenueCat, App Privacy, App Information, version 1.6.0 texts, review notes | You, Francisco, Sven | Nothing. Start now. |
| B | Upload build 11, Apple processes it | Assistant, then you | Your "upload iOS" (and A1 if an agreement is pending) |
| C | Sandbox flag on, optional webhook fix, demo account reset, TestFlight checks | You, Assistant, Francisco | B, and A3 done at least an hour earlier |
| D | Build on the version, one draft (version, 4 subscriptions, group), final checks, Submit for Review | You | C, and the website pages from A2 |
| E | In review, and what to do if Apple rejects | You, Assistant | Apple, usually 1 to 2 days |
| F | Release This Version | You, with Francisco's OK | Approval |
| G | Sandbox flag off, tag v1.6.0, changelog | You, Assistant | Release |

B does not wait for the rest of A. Two items on the critical path are outside your hands: the
agreements only Francisco can accept (A1) and Sven's pages (A2). Start both first.

## Step 0. Decisions

| # | Decision | Recommendation |
|---|---|---|
| 1 | Sandbox flag on for the review window (C1) | Yes. Without it a reviewer who buys stays on Free (guideline 2.1(b)). |
| 2 | PRODUCT_CHANGE webhook fix (C2) | Approve now ("fix webhook"), so one deploy carries it with the flag. C4 row 12 proves it. Server only, no new build. |
| 3 | Screenshots (A7 step 5, D2) | Required if the live set shows a Google Play badge, a Slack tile, "25 today" or the old WhatsApp number (2.3.10, 2.3.1). Otherwise recommended: the October cards show the old design and the one-word name. |
| 4 | Group display name "Meeting Guard AI Plans" (A3.5) | Yes. It rides the same review. |
| 5 | Spanish names on the four subscriptions (A3.7) | Optional. Today the Spanish storefronts show the English names. |
| 6 | Audio Data in App Privacy (A5) | Not collected. Apple's recognizer handles the audio and the app sends only text. |
| 7 | Multiseat purchasing (A3.6) | Turn it off. Apple turns it on by default for new subscriptions, and the server gives one purchase to one account. |
| 8 | Submit before November 16 | Earlier skips the two new age rating questions (D6). Later is fine too: both answers are No. |
| 9 | OpenAI permission (guideline 5.1.2(i)) | Ship build 11 with the disclosure in T5 and the demo onboarding reset (C3 step 7). An accepted risk: onboarding completion is stored per account, so the 1.5.0 reviewer on the demo account most likely never saw the OpenAI notice. A real Allow step needs build 12. |
| 10 | "Google Play" in the iPhone app (guideline 2.3.10) | Ship build 11 and keep build 12 ready. The delete-account warning ("App Store or Google Play") is new in 1.6.0 and sits in the flow reviewers test. If Apple cites it, build 12 gets iPhone-only wording the same day. |

## Phase A. Before the upload (any order)

### A1. Agreements (Francisco accepts, you look)

1. Open https://developer.apple.com/account and https://appstoreconnect.apple.com/business
   (Agreements).
2. If the developer site shows a banner that the Apple Developer Program License Agreement was
   updated (Apple's terms page lists a revision of October 29, 2026), Francisco clicks Review
   Agreement, reads it, ticks the box and clicks Agree.
3. In Business > Agreements, Paid Apps must read Active. If it reads "Active (New Agreement
   Available)" or offers View and Agree to Terms (revision of October 13, 2026), Francisco opens it
   and agrees.
4. Any other yellow banner at the top of App Store Connect: Francisco completes it.
5. The Digital Services Act trader status should still read verified with current contact details.
   Change nothing unless they are outdated.

Check: no agreement banner on either site, and Paid Apps reads Active.

Why: until an update is accepted, the upload can fail with a 403 "required agreement is missing or
has expired", subscription edits and Submit for Review are blocked, and paid purchases do not work
in review. The agreement binds his company, so Francisco reads and accepts it himself.

### A2. Website (Sven publishes, you check)

1. Send Sven docs/v2/TERMS-UPDATE-FOR-WEBSITE-2026-11-06.md: Part A on /terms-of-service/, Part B on
   /privacy-policy/, Part C as /delete-account/, in English and Spanish. Add the home, pricing and
   FAQ pages (ALLOWANCES-2026-11-05.md, section "Website (Sven)") and the three-word name Meeting
   Guard AI.
2. Check https://meetingguard.ai/privacy-policy/ and https://meetingguard.ai/terms-of-service/ with
   their Spanish pages: a new "Last updated" date; the privacy page names Microsoft, WhatsApp
   (Meta), Zoom, RevenueCat and Google Tasks; the terms no longer say the paid plans "cannot be
   purchased yet" and no longer mention 5 requests per day. The home, pricing and FAQ pages show no
   3-day trial, no "5 per day" and no "cannot be purchased yet". The assistant can read the live
   pages for you on request.

Blocker: Submit for Review waits for these pages. Apple reads the privacy policy linked in App Store
Connect (5.1.1(i)), and the Support and Marketing URLs lead to the site, so a reviewer would see
text that contradicts the Plans screen (2.1(a), 2.3). The repo has no hosted copy to fall back on.

### A3. Subscriptions (you)

Group page:
https://appstoreconnect.apple.com/apps/6819847236/distribution/subscriptiongroups/22449438 (Apps >
Meeting Guard AI > Monetization > Subscriptions > MeetingGuard Plans). Pro Monthly:
https://appstoreconnect.apple.com/apps/6819847236/distribution/subscriptions/6819952561. Open the
other three from the group page.

Make all edits before any Add for Review: D5 puts them into the 1.6.0 draft. Sent alone, they would
be reviewed against 1.5.0.

A3.1 Ranking

1. Group page > Subscriptions section > Edit Order (on some pages it reads just Edit). The Edit
   Subscription Order window has a drag handle on each row. If you get checkboxes instead of
   handles, that is the Add for Review selection used in D5: click Cancel.
2. Drag Premium Monthly to the top.
3. Drop Premium Yearly ON the Premium Monthly row (not into the gap between rows), so both sit on
   Level 1.
4. Drop Pro Yearly ON the Pro Monthly row, so both sit on Level 2.
5. Before saving, the window must show exactly two levels: Level 1 Premium Monthly and Premium
   Yearly, Level 2 Pro Monthly and Pro Yearly. If stacking will not work, use four levels in this
   order: Premium Yearly, Premium Monthly, Pro Yearly, Pro Monthly. Never a monthly above its
   yearly.
6. Save.

Check: the group page shows Premium on level 1 and Pro on level 2, and all four stay Approved. Apple
shows no review step for the order. Allow up to an hour before you test an upgrade.

Why: today Pro Monthly is Level 1, so Apple treats Pro to Premium as a downgrade that waits for the
renewal. A reviewer who upgrades gets "Still processing" and stays on Pro (3.1.2(b)).

A3.2 Trials (all four)

1. Subscription > Subscription Prices > View all Subscription Pricing > tab Introductory Offers,
   current and upcoming lists. The subscription page itself and All Prices and Currencies do not
   list offers.
2. For a row such as Free, 3 days: hover over the right end of the row, click (-), then Delete.
   Repeat for every row.
3. The same on Pro Yearly, Premium Monthly and Premium Yearly.

Check: no current and no upcoming offer on all four. There is no Save and no review step. An offer
cannot be edited or ended early, so Delete is the only way.

Why: while an offer exists, the Plans screen shows "New subscribers: 3-day free trial", which
contradicts the new plans and the review note. The sandbox can take up to an hour to drop it.

A3.3 Descriptions (English (U.S.), all four)

1. Subscription > localization section (Display Name and Description) > English (U.S.).
2. Description: `100 AI actions per month` on Pro Monthly and Pro Yearly, `400 AI actions per month`
   on Premium Monthly and Premium Yearly (24 of 45 characters). Keep the display names.
3. Save.

Check: the localization reads Prepare for Submission and the subscription stays Approved. The old
text stays in the store until Apple approves the new one.

A3.4 Review Information (all four)

1. Lower on each subscription page, Review Information > Review Notes: T6. Save.
2. Screenshot: leave it for now (D3). If the section is locked while the subscription is Approved,
   leave it entirely.

A3.5 Group display name

1. Group page > localization section > English (U.S.).
2. Subscription Group Display Name: `Meeting Guard AI Plans`. App name option: keep (it shows
   Meeting Guard AI).
3. If a Spanish row exists: `Planes de Meeting Guard AI`.
4. Save.

Check: Prepare for Submission, and the group's Add for Review becomes active. Do not click it yet
(D5). Users see this name in the iPhone's Settings > Subscriptions.

A3.6 Multiseat off (all four)

Subscription > Purchase Options > Edit > "No, don't allow multiseat purchases" > Confirm (if it
already reads not allowed, nothing to do). Leave the App Store availability on: Apple does not allow
removing it after approval. Apple documents no review step for this.

Why: Apple's help says multiseat purchasing is on by default, except for some subscriptions created
before September 14, 2026; ours date from October. Seats a company buys through Apple Business
Manager would unlock nobody, because the server gives one purchase to one Firebase account.

A3.7 Optional: Spanish names

On each subscription: localization section > (+) > Spanish (Mexico), the variant of A6 step 5 >
Display Name `Pro Mensual`, `Pro Anual`, `Premium Mensual` or `Premium Anual` > Description `100
acciones de IA al mes` or `400 acciones de IA al mes` > Add. Localizations can be added only before
you submit.

A3.8 Leave alone: Family Sharing ("Turn On" cannot be undone), Retention Messaging, Image,
Availability, prices, Tax Category and the reference names.

### A4. RevenueCat (you)

1. https://app.revenuecat.com > the Meeting Guard project > Apps (Apps & providers) > the App Store
   app (bundle id com.meetingguard.ai): the In-App Purchase Key section must hold a key with a valid
   status, and in the product catalog the four App Store products must not read "Could not check".
2. If there is no key: App Store Connect > Users and Access > Integrations
   (https://appstoreconnect.apple.com/access/integrations/api) > In-App Purchase in the side list >
   Generate In-App Purchase Key, name `RevenueCat` (needs the Admin or Account Holder role) >
   download the .p8 once and note the Key ID and the Issuer ID > upload the .p8 to the RevenueCat
   App Store app with both IDs > Save. Keep the .p8 out of the chat and out of the repo.
3. Integrations > Webhooks > the webhook to revenuecatWebhook: it sends production and sandbox
   events (needed for C1), for all apps or at least the App Store app.
4. Optional: in the RevenueCat App Store app, copy the Apple server notification URL. In App Store
   Connect > App Information > App Store Server Notifications, if the Production and Sandbox Server
   URLs are empty, paste it into both (Version 2) and Save. Renewals, refunds and plan changes then
   reach RevenueCat without delay.

Why: the app uses react-native-purchases 10, which buys through StoreKit 2. SETUP.md 11.6 says
StoreKit 2 purchases fail to record in RevenueCat without the In-App Purchase key, and
APP-REVIEW-2026-10-20.md left its upload open. Without it, or with a webhook that skips sandbox
events or the App Store app, a purchase ends in "Still processing" even with the sandbox flag on.

### A5. App Privacy (you)

1. https://appstoreconnect.apple.com/apps/6819847236/distribution/privacy (sidebar App Privacy) >
   next to Data Types, Edit.
2. The target list: Contact Info > Name, Email Address and Phone Number; Identifiers > User ID; User
   Content > Other User Content; Purchases > Purchase History. The live label lists all of these
   except Phone Number.
3. Tick Phone Number (the WhatsApp link stores it) > Continue > Phone Number: purpose App
   Functionality, linked to the user Yes, used for tracking No.
4. Open the other five and confirm the same three answers. They cover the Microsoft sign-in (name,
   email, account id), calendar events, tasks, assistant and WhatsApp messages, and the subscription
   events.
5. Leave Audio Data and Contacts not collected (decision 6; the app never reads the address book).
6. Publish, then Publish again in the "Publish Your App Privacy Responses?" dialog.

Check: App Privacy lists Phone Number. It goes live at once, without review, and is right for 1.5.0
too, whose WhatsApp link already stored the number.

### A6. App Information (you)

https://appstoreconnect.apple.com/apps/6819847236/distribution/info (sidebar App Information).
Change only what differs, then Save.

1. Name: `Meeting Guard AI`.
2. Subtitle, English (U.S.): T0. The live "Meeting alarms and AI planner" overclaims on iPhone,
   where alerts are Time Sensitive notifications and nothing rings with the app closed. If you keep
   the old subtitle, change `alarm` to `alert` in the English keywords (T4).
3. Category: Productivity (secondary Business). Content Rights: unchanged. License Agreement:
   Apple's standard EULA; do not upload a custom one.
4. Privacy Policy URL: https://meetingguard.ai/privacy-policy/ (it must load).
5. Spanish: open the language menu at the top right. The public Mexico and Spain pages show English
   text, so the listing most likely has no Spanish localization. If Spanish is missing, add Spanish
   (Mexico), which Apple uses for Mexico and the Latin American storefronts, and fill in Name
   `Meeting Guard AI`, Subtitle (T0 Spanish) and Privacy Policy URL
   `https://meetingguard.ai/privacy-policy/`. Save. If only Spanish (Spain) exists, use it and
   replace the keyword `pendientes` with `horario` in T4.
6. Age Rating: D6.

The subtitle and the new localization are reviewed with 1.6.0. Do them before D4.

### A7. Version 1.6.0 (you)

1. https://appstoreconnect.apple.com/apps/6819847236 > in the sidebar, (+) next to iOS App > New
   Version > `1.6.0` > Create. Skip this if the sidebar already shows 1.6.0. It copies the 1.5.0
   texts and screenshots.
2. The page: https://appstoreconnect.apple.com/apps/6819847236/distribution/ios/version/inflight.
3. Language menu > English (U.S.): Promotional Text T2, Description T3 (delete the old text first),
   Keywords T4, What's New in This Version T1. Keep the Support URL and the Marketing URL; the
   support page must show support@meetingguard.ai. Save.
4. Language menu > Spanish (the localization from A6 step 5): Promotional Text, Description,
   Keywords and What's New from the Spanish T1 to T4, Support URL the same as English. Save. Its
   screenshots fall back to the English set.
5. Screenshots: scroll to App Previews and Screenshots and look at every image and any App Preview
   video. If one shows a Google Play badge, a Slack tile, "25 today" or the old WhatsApp number, D2
   becomes required. At least one screenshot must stay in each slot.

Check: Save succeeds and no field is red. Each description ends with the subscription terms, the
Privacy Policy link and the Terms of Use (EULA) link.

Why: 1.4.0 was rejected for a missing subscription paragraph with the EULA link (3.1.2(c)). The
texts describe the iPhone build only: no widget, no full-screen alarm with the app closed, no
Android and no Google Play (2.3.1, 2.3.10).

### A8. App Review Information and release option (same page)

1. Sign-In Information: Sign-in required ticked, user name `hello@meetingguard.ai`. Leave the stored
   password as it is, and keep it out of the chat and out of the Notes.
2. Contact Information: name, email, and a phone with + and the country code (the field refuses a
   number without the plus since August 19, 2026).
3. Notes: delete the 1.5.0 text and paste T5. Before you submit: fill in the Tested on line after
   C4, delete "The attached recording shows the sync." if you attach nothing, and delete the last
   sentence of item 7 if the sandbox flag is not live.
4. Attachment (recommended): a short iPhone recording of the Outlook, To Do and Google Tasks sync,
   because the reviewer has none of those accounts. An unlisted video link in the Notes works too.
5. App Store Version Release: Manually release this version.
6. Save.

## Phase B. Upload and processing

### B1. Upload (you say it, the assistant runs it)

1. Write "upload iOS" in the chat, best after A1: a pending agreement makes the upload fail with a
   403.
2. The assistant runs, from the Codebase folder:

```
npx -y eas-cli@latest submit -p ios --id 4de5b6cb-e211-479f-a6bf-d04dc5ecd7ca
```

Never `--latest`, which takes whatever build is newest on EAS. EAS uses the App Store Connect API
key it holds and the production submit profile (app 6819847236, team D695835P4T).

Check: EAS says the binary was uploaded to App Store Connect, and the submission on expo.dev reads
finished.

If it fails:

- 403 or "required agreement is missing or has expired": A1, then the assistant runs it again.
- EAS asks for an Apple sign-in: run the same command yourself in
  D:\WorkSpace\MeetingGuard_2025.7.28\Codebase.
- "bundle version 11 was already used": build 11 is already in App Store Connect; check TestFlight.
- An Apple email lists ITMS problems: forward it to the assistant first. Build 10 passed the same
  checks.

### B2. Processing

1. https://appstoreconnect.apple.com/apps/6819847236/testflight/ios > 1.6.0 > build 11.
2. Wait until it no longer says Processing. Apple gives no time; minutes to an hour is common, and
   Apple sends an email.

Check: build 11 is listed and does not say Missing Compliance (the build declares
ITSAppUsesNonExemptEncryption false). If it does, stop and tell the assistant before you answer
anything.

### B3. Build to Francisco

TestFlight > Internal Testing > Francisco's group. With automatic distribution on, build 11 is there
already. Otherwise: Add Builds > 1.6.0 (11) > Next > What to Test: T8 > Add. Internal builds need no
Beta App Review.

## Phase C. Backend, demo account, TestFlight checks

### C1. Sandbox flag on (you)

1. In your editor, set `REVENUECAT_ALLOW_SANDBOX=true` in functions/.env.meetingguard-ai-app and
   save. (The assistant never opens .env files.)
2. In D:\WorkSpace\MeetingGuard_2025.7.28\Codebase\functions run:

```
npx firebase deploy --only functions:revenuecatWebhook,functions:adminReconcileEntitlement
```

If the VPN breaks the deploy, run it again.

3. Check: the output ends with "Deploy complete!". At
   https://console.cloud.google.com/run?project=meetingguard-ai-app > revenuecatwebhook > the newest
   revision > Variables, REVENUECAT_ALLOW_SANDBOX reads true.
4. The RevenueCat webhook sends sandbox events (A4 step 3).
5. Proof: C4 row 11.

Side effect: while the flag is true, any TestFlight or App Review purchase grants a plan in the live
database. With no paying users that is acceptable. G1 turns it off.

### C2. PRODUCT_CHANGE webhook fix (on "fix webhook")

- Problem (not proven): functions/src/revenuecat/mapping.ts writes PRODUCT_CHANGE like a purchase,
  with the old product and the old expiry. For an immediate App Store upgrade RevenueCat sends
  PRODUCT_CHANGE and RENEWAL together. If PRODUCT_CHANGE is applied last, an upgraded user reads as
  the old plan or as Free.
- Fix: the assistant records PRODUCT_CHANGE without writing the plan (App Store events only), adds
  tests, runs the functions tests and commits on v2. You deploy with the C1 command; one deploy
  carries the fix and the flag. No new app build.
- Proof: C4 row 12.

### C3. Demo account (you), close to Submit

1. https://console.firebase.google.com/project/meetingguard-ai-app/authentication/users > search
   `hello@meetingguard.ai` > copy the User UID.
2. Firestore > usage > that UID
   (https://console.firebase.google.com/project/meetingguard-ai-app/firestore/databases/-default-/data/~2Fusage).
   If the document exists: its menu > Delete document. The days subcollection normally goes with it;
   if it stays, delete it too.
3. Firestore > entitlements > that UID: missing, or free or expired. In RevenueCat > Customers,
   search the UID: no active subscription, sandbox included. If either shows an active Pro or
   Premium, tell the assistant before you delete anything.
4. Sign in once with the demo account (your emulator with the Play build is fine) and do not open
   the assistant. There must be no "Verify your email" banner. Menu > Plans shows "Your count
   appears after you use the assistant." or a count cached on that device; step 2 is the proof that
   the allowance is full. If the password no longer works, fix that first: it is the one stored in
   App Store Connect.
5. Optional, by hand and not with the assistant: one meeting yesterday (so "Debrief this meeting"
   shows) and three or four over the next two weeks (so "Running late" shows), with fictional
   titles. Then sign out.
6. Never sign in to the demo account on the iPhone that made the TestFlight purchases while the flag
   is on: a restore or sync can move that sandbox subscription to the demo account.
7. Recommended, last: Firestore > users > that UID > settings > preferences: set the field
   `onboardingCompleted` to false. The reviewer then goes through onboarding, including "Meet your
   AI assistant" with the Privacy notice that names OpenAI (decision 9). Do not sign in to the demo
   account afterwards: finishing onboarding sets it back to true.
8. Right before D8, look at usage and entitlements for that UID once more. After a rejection, redo
   steps 2 to 7 before resubmitting, with the flag still on.

Why: an unverified email blocks every AI feature, and a used-up allowance leaves the reviewer with
"You've used today's free actions".

### C4. TestFlight checks (Francisco on the device, you collect)

Install 1.6.0 (11) from TestFlight over the App Store 1.5.0, the path users take. Run the rows in
order. Use a test account for the sign-ins and the purchase, never the demo account. TestFlight
purchases are free and run in the sandbox.

| # | Do | Expected |
|---|---|---|
| 1 | Look at the home screen | The name reads Meeting Guard AI. iOS may shorten it under the icon. |
| 2 | Open the sign-in screen | Continue with Apple sits above Google, Microsoft and email, is the same size, and needs no scrolling. |
| 3 | Continue with Apple, share or hide the email | The dashboard opens. |
| 4 | Sign out. Continue with Microsoft | iOS asks to use "microsoftonline.com" to sign in > Continue > Microsoft account and consent > back in the app, signed in. A browser page that stays open means a wrong Azure redirect: tell the assistant (no app change needed). |
| 5 | Sign out. Continue with Google | Signed in. |
| 6 | Settings > Calendar sync > Connect Outlook, then the To Do card, then the Google Tasks card | A meeting made in the app appears in Outlook. A task reaches the chosen To Do list. Google shows its "unverified app" screen (expected), then a task reaches Google Tasks. |
| 7 | A meeting that has ended > Debrief this meeting > allow Microphone and Speech Recognition > speak two commitments > Create tasks | Two task cards. After Confirm, the tasks exist and show the meeting. |
| 8 | An upcoming meeting with a participant email > Running late > 10 min > Share message > send through Messages. Then again, and dismiss the sheet | First: "Your phone confirms the message was handed to the app you chose." Second: "Nothing was sent." |
| 9 | A meeting 3 minutes ahead at Maximum. Lock the phone, then tap the notification. Repeat with the app open | Locked: a Time Sensitive notification with sound; note what the tap opens (meeting details or the alert screen). App open: the full-screen alert with looping sound and the spoken readout. |
| 10 | Menu > Plans | Prices in the App Store currency per month and per year, buy buttons, no "New subscribers: 3-day free trial", the renewal sentence, Privacy Policy and Terms of Use links, Restore purchases. |
| 11 | Only after C1: buy Pro (monthly) and confirm the sheet | "Your Pro plan is now active." within seconds, and the Pro card says Current plan. You check Firestore entitlements > that account's UID: plan pro, source revenuecat. |
| 12 | Then switch to Premium (monthly) | An immediate change, "Your Premium plan is now active.", and still premium a minute later. If it falls back to Pro or Free: approve C2 and repeat. |
| 13 | Last: Settings > Account > Delete account on the Apple test account | The Apple sheet asks to confirm, the account is deleted and signed out, and no notice says the Apple revocation failed. |

If a row fails:

- Row 10 shows a trial line: an offer still exists (A3.2). Wait an hour after deleting it.
- Row 10 shows no prices or no buy buttons: suspect the Paid Apps agreement (A1).
- Row 11 waits, then shows "Still processing": the flag is not live, the webhook skips sandbox
  events or the App Store app, or RevenueCat has no In-App Purchase key (A4).
- Row 13 shows the revocation notice: the Firebase Apple provider lacks its OAuth code flow key
  (APP-REVIEW-2026-10-20.md, remaining item 1). No new build needed.
- A code problem: tell the assistant. A code fix means build 12, built only with your OK, with a new
  time-stamped IPA and its own build id for the upload.

On an iPad, if anyone has one: App Review used an iPad Air for 1.4.0, and the same TestFlight build
opens in an iPhone-size window (compatibility mode). Run rows 2, 3, 10 and 13 there, once in
landscape. Without a Mail account, "Email participants" opens the iOS Mail setup or shows "No mail
app could be opened"; both are expected.

Francisco sends you: screenshots of rows 2, 10 and 11 (and 12), what the tap in row 9 opened, and
the model and iOS version of each device (Settings > General > About) for the Tested on line of T5.

## Phase D. Submission

### D1. Select build 11

Version page > Build > (+) > 1.6.0 (11) > Done > Save.

Check: the Build section shows the icon, 1.6.0 (11) and the upload date. No export compliance
question is expected.

### D2. Screenshots (required per A7 step 5, otherwise optional)

1. Francisco takes 4 to 6 screenshots on his iPhone with build 11 and fictional data: dashboard,
   assistant with a confirmation card, the alert screen, Running late and Plans. English, and
   Spanish if he likes.
2. The assistant makes them App Store ready: resized to exactly 1290 x 2796 (from a 1179 x 2556
   capture that is a stretch of 0.02 percent nobody sees) and flattened, with no alpha channel.
   Apple takes 1320 x 2868, 1290 x 2796 or 1260 x 2736 in the large iPhone slot.
3. You upload them in the slot the current set uses, delete the old ones and Save, for each
   language.

Never a store badge or an Android frame (2.3.10). New screenshots are reviewed with 1.6.0.

### D3. Subscription review screenshot

On each subscription, Review Information: if Screenshot shows Choose File, upload Francisco's row 10
screenshot. It replaces the October one, which says "requests per day". Save. If the section is
locked while the subscription is Approved, leave it.

### D4. Put the version into a draft

Version page, top right: Add for Review > Create New Submission. The status becomes Ready for
Review; nothing is sent to Apple yet.

Check: no error list. If Apple lists missing fields, fill them in and try again.

### D5. Add the subscriptions and the group to that draft

1. On each of the four subscriptions: Add for Review > the draft that holds iOS 1.6.0. Never Create
   New Submission here. (Alternative: group page > Edit > tick the four > Add for Review > the same
   draft.)
2. Group page > Add for Review > the same draft, for the A3.5 rename.
3. Spanish subscription localizations (A3.7) travel with their subscriptions.

Check: https://appstoreconnect.apple.com/apps/6819847236/distribution/reviewsubmissions > Drafts
lists iOS 1.6.0, Pro Monthly, Pro Yearly, Premium Monthly, Premium Yearly and MeetingGuard Plans.

### D6. Age rating, only if you submit on or after November 16

App Information > Age Ratings > Edit. Two new questions: Shared Location No (the app asks for no
location and shares none; meeting places are typed text), Dating and Relationships No. Keep the
other answers as for 1.5.0: Messaging and Chat No (the chat is with the AI, and Running late hands
the text to other apps), User-Generated Content No, Advertising No. Save. The rating should not
change.

### D7. Final check before Submit

| Item | Where | Must read |
|---|---|---|
| Agreements | Business > Agreements | Paid Apps Active, no banner (A1) |
| Website | meetingguard.ai | New privacy policy and terms in English and Spanish; home, pricing and FAQ without trials or per-day limits (A2) |
| Ranking | Group page | Premium on level 1, Pro on level 2 (A3.1) |
| Trials | Each subscription > View all Subscription Pricing > Introductory Offers | No rows (A3.2) |
| Multiseat | Each subscription > Purchase Options | Not allowed (A3.6) |
| RevenueCat | App Store app, webhook | In-App Purchase key valid; the webhook sends sandbox events for the App Store app (A4) |
| App Privacy | App Privacy | Phone Number added and published (A5) |
| App Information | App Information | Subtitle saved; Spanish localization with name, subtitle and privacy URL (A6) |
| Version | 1.6.0 page | Build 11, English and Spanish texts, screenshots checked, Manually release this version (A7, D1, D2) |
| Review notes | 1.6.0 page | T5 with the Tested on line filled; the sandbox sentence only if C1 is live (A8) |
| Contact phone | 1.6.0 page | Starts with + and the country code (A8) |
| Sandbox flag | Cloud Run variable | true, proven by C4 row 11 (C1) |
| Demo account | Firestore, RevenueCat, one sign-in | usage document gone, no active subscription, email verified, onboarding reset (C3) |
| Age rating | App Information | Answered, if on or after November 16 (D6) |
| Over-the-air updates | Assistant, read-only, on your OK: `npx -y eas-cli@latest update:list --branch production` | No update for runtime 1.6.0, so the reviewer runs the audited bundle |
| Draft | App Review > Drafts | 1.6.0, the four subscriptions and the group (D5) |

### D8. Submit for Review

Sidebar App Review > Drafts > open the draft > Submit for Review. The same draft also opens from
Draft Submissions at the bottom right of the version page.

Check: the submission reads Waiting for Review, and Apple sends a confirmation email. Take a
screenshot: it is the evidence for line 16 of docs/v2/STAGE2-ACCEPTANCE.md.

## Phase E. While in review, and if Apple rejects

Timing: Apple reviews about half of all submissions within 24 hours and 90 percent within 48. The
statuses go Waiting for Review > In Review > Pending Developer Release (approved), or Rejected or
Unresolved Issues.

While in review, do not:

- publish an over-the-air update to runtime 1.6.0 (the reviewer must run the reviewed bundle);
- set the sandbox flag back to false;
- use the demo account;
- change the WhatsApp, Zoom or Google Tasks switches;
- take the website pages down.

Keep the contact phone reachable and answer App Review messages the same day.

If Apple rejects, the email and App Review > the submission show the message.

| The finding is about | What to do | New build? |
|---|---|---|
| Texts, screenshots or notes | Edit them on the version page, reply in the message thread, then Update Review and resubmit. | No |
| One subscription description or the group name | Edit it and Update Review, or remove that item so 1.6.0 can go through and send the edit later on its own. A removed item cannot come back into that submission. | No |
| A purchase that did not unlock, or a failed sign-in | Fix the setup (C1, A4, Azure, Firebase), reply with what was wrong and how it was fixed, then resubmit. | No |
| "Google Play" or "Android" in the app (2.3.10), or the OpenAI permission (5.1.2(i)) | Tell the assistant: build 12 with iPhone-only wording, or an Allow step before the first AI request, with your OK. Upload it with its own id, select it on the same 1.6.0 page, resubmit. | Yes |
| Other behaviour in the app | Tell the assistant. A code fix becomes build 12 as above. | Yes |
| You think the reviewer is wrong | Reply in the thread with facts and a recording. Appeal to the App Review Board only after that. | No |

While any item is rejected, the whole submission waits, and nothing can be added to it. Before you
resubmit, redo C3 steps 2 to 7.

## Phase F. Release (you, with Francisco's OK)

1. Wait until the version reads Pending Developer Release, and the four subscriptions and the group
   read Approved.
2. Make sure the website pages are still live.
3. Optional: Phased Release for Automatic Updates spreads automatic updates over 7 days (1, 2, 5,
   10, 20, 50, 100 percent), with a pause of up to 30 days. With almost no iOS users it adds little.
4. Version page > Release This Version > Confirm.

Check: within 24 hours, https://apps.apple.com/app/id6819847236 shows version 1.6.0 with the new
description, and Update on an iPhone installs it.

## Phase G. After the release

1. You: set `REVENUECAT_ALLOW_SANDBOX=false` and run the C1 deploy again. Check: the Cloud Run
   variable reads false. Every later review needs it on again.
2. You: each subscription description reads Approved with the new text.
3. Assistant, when you say so: tag `v1.6.0` on commit dddd715 on branch v2 in the side git dir. The
   binary audit of November 7 showed build 11 matches that commit; later commits (docs, the spelling
   fix 5029cf1) are not in the build. The tag is pushed only when you ask.
4. Assistant: the CHANGELOG.md 1.6.0 date, docs/v1/HANDOFF.md "Status update", docs/v2/PLAN.md and
   docs/v2/RELEASE-1.6.0.md with the live versions and dates, quoted from the consoles.
5. You: a screenshot of 1.6.0 Ready for Distribution for line 16 of STAGE2-ACCEPTANCE.md.
6. Later, fixes only, by an over-the-air update to runtime 1.6.0 or in the next build, and never to
   switch on a feature the review did not see: the iPhone "Status notification" switch (it promises
   a permanent notification iOS cannot keep); "Android" and "Google Play" in the iOS strings (the
   delete-account warning, the voice-readout help); "daily AI limit" in the AI suggestions dialog;
   the "Prices are in US dollars" footer; the WhatsApp bot's quota message
   (functions/src/whatsapp/messages.ts lines 56 and 77 call every limit daily; "midnight UTC" is
   right only for the free daily cap).
7. Before the next review: C3 and C1 again.
8. Optional: Accessibility Nutrition Labels (sidebar App Accessibility; claim only what you tested),
   the Spanish subscription names and new screenshots if you skipped them.

## Risks to know (not blockers)

- OpenAI permission (5.1.2(i)): the guideline asks for explicit permission before personal data goes
  to a third-party AI. Onboarding names OpenAI with a Continue button, and nothing asks before the
  first assistant or debrief request. Mitigation without a build: T5 and C3 step 7. The real fix, an
  Allow step, is a build.
- "Google Play" and "Android" in the app (2.3.10), moderate: the delete-account warning is new in
  1.6.0 and the voice-readout help says "On Android". If Apple cites it, reply that the warning
  tells cross-platform subscribers where to cancel, and ship build 12. An over-the-air update would
  not reliably reach the reviewer: with fallbackToCacheTimeout 0 the first launch runs the embedded
  bundle.
- Free allowance: 3 AI actions a day. Tapping the post-meeting follow-up notification also spends
  one.
- Microsoft consent: publisher verification is not done, so Microsoft may label the app unverified,
  and a work tenant that blocks user consent shows "Need admin approval". T5 says Microsoft is
  optional.
- Google Tasks: Google shows its unverified-app screen until it approves the scope. T5 says so.
- iPhone alerts: no full-screen alarm and no critical alert with the app closed. C4 row 9 checks
  what the tap on a lock-screen alert opens: the in-app help promises the alarm screen, the code
  opens the meeting details.
- Status notification switch: it shows on iPhone and promises a permanent notification that iOS
  cannot keep. A reviewer could cite 2.1.
- Sign in with Apple on iPad: the 1.4.0 rejection came from an iPad. The iPad rows of C4 cover it.

## Texts to paste

A script counted every text below on the exact text with LF line breaks, and checked it for long
dashes, ellipsis characters and curly quotes. Descriptions, What's New and the subtitle count
characters; keywords and the review notes count bytes.

### T0. Subtitle (App Information; 30 characters at most; reviewed with 1.6.0)

English (U.S.) (29 characters):

```
Meeting alerts and AI planner
```

Spanish (30 characters):

```
Alertas, agenda y asistente IA
```

### T1. What's New in This Version

English (493 characters):

```
Outlook, both ways: connect your Microsoft account and your meetings stay in step with Outlook.
Microsoft To Do and Google Tasks: pick a list and your tasks stay in step in both places.
Debrief by voice: after a meeting, say what was agreed and confirm the tasks the app proposes.
Running late: send a ready message with the new time, and move the meeting only if you want.
Continue with Microsoft on the sign-in screen.
New plans: 10 free AI actions in your first 7 days, then Pro or Premium.
```

Spanish (499 characters):

```
Outlook en ambos sentidos: conecta tu cuenta de Microsoft y tus reuniones quedan al día con Outlook.
Microsoft To Do y Google Tasks: elige una lista y tus tareas quedan al día en ambos sitios.
Resumen por voz: al terminar una reunión, di lo acordado y confirma las tareas propuestas.
Voy tarde: envía un mensaje listo con la nueva hora y mueve la reunión solo si quieres.
Continuar con Microsoft al iniciar sesión.
Planes nuevos: 10 acciones de IA gratis en tus primeros 7 días, luego Pro o Premium.
```

Both are RELEASE-1.6.0.md section 4; the Spanish line 3 says "Resumen por voz", the term of the
app's Spanish screens ("Resumir esta reunión").

### T2. Promotional Text (170 characters at most; it can change at any time without review)

English (168 characters):

```
New: Outlook, Microsoft To Do and Google Tasks sync, debrief by voice and a ready message when you are running late. Start free with 10 AI actions in your first 7 days.
```

Spanish (168 characters):

```
Novedades: sincroniza Outlook, Microsoft To Do y Google Tasks, haz tu resumen por voz y avisa si vas tarde. Empieza gratis con 10 acciones de IA en tus primeros 7 días.
```

### T3. Description (4,000 characters at most)

English (3,693 characters):

```
Never miss a meeting again. Meeting Guard AI puts your meeting alerts, calendars and tasks in one place, with an AI assistant that schedules meetings for you.

ALERTS THAT GET YOUR ATTENTION
Get a notification with sound before your meetings, even when the app is closed or your iPhone is locked: 15 and 5 minutes before and at the start by default, or at the times you choose. Choose the alert level: Maximum, Medium or Light. Maximum and Medium alerts are marked Time Sensitive, so they can reach you during a Focus that allows Time Sensitive notifications. Press and hold an alert to snooze it, or tap it to open the meeting. With the app open, a Maximum alert fills the screen with a looping alarm, reads the meeting aloud and lets you join, snooze or say you are running late. After a meeting, a follow-up notification takes you to the assistant to capture next steps, and an optional daily briefing sums up your meetings and tasks for the day at the time you choose.

YOUR CALENDARS, TOGETHER
Two-way sync with Google Calendar and Outlook keeps your meetings in step, and your Google and Outlook events get Meeting Guard AI alerts. Google Calendar or Outlook emails the invitation to your participants. Events from the calendars on your iPhone, such as iCloud, get alerts too, and you can add your Meeting Guard AI meetings, except repeating ones, to one of those calendars.

YOUR TASKS, IN STEP
Pick a Microsoft To Do or Google Tasks list and your tasks stay in step both ways: title, notes, due date and done state. With both syncs on, the app copies tasks from one service to the other. Task reminders arrive as notifications.

AN AI ASSISTANT THAT ASKS FIRST
Type or say "Lunch with Ana tomorrow at 2 pm" and the assistant prepares the meeting; nothing is saved until you confirm it. One sentence can create a meeting and a task together. Ask "What do I have tomorrow?" and get your agenda, read aloud if you like, and confirm or cancel by voice too. Link your WhatsApp number to create meetings by message as well; those requests count as AI actions.

DEBRIEF BY VOICE
After a meeting, open it and tap "Debrief this meeting". Say what was agreed (up to 60 seconds) or type it. The app proposes the tasks, and nothing is saved until you confirm them.

RUNNING LATE
Pick how late you are and get a ready message with the new time. Share it with any app or email it to the participants, and move the meeting only if you want. If a meeting finishes early, tap "End meeting now".

ZOOM, MEET AND TEAMS LINKS
A meeting can get its own Zoom link automatically, or a Google Meet link when Google Calendar is connected. Microsoft Teams links come through Outlook where your account offers them.

Sign in with Apple, Google, Microsoft or email. Works in English and Spanish. Provided by AETERNUM TECH LTD. Questions? support@meetingguard.ai

PLANS
Free to start: your first 7 days include 10 AI actions (up to 3 a day). After that, AI actions need Pro or Premium. Creating meetings and tasks by hand, your reminders, your agenda and export are always free. Pro includes 100 AI actions per month and Premium 400, renewing each month on the day you subscribed. Prices are shown in the app before you buy and may vary by country.

Meeting Guard AI offers auto-renewable subscriptions (Pro, Premium; monthly or yearly). Payment is charged to your Apple Account at confirmation of purchase. The subscription renews automatically unless cancelled at least 24 hours before the end of the current period. Manage or cancel in your App Store account settings.
Privacy Policy: https://meetingguard.ai/privacy-policy/
Terms of Use (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/
```

Spanish (3,920 characters):

```
No vuelvas a perderte una reunión. Meeting Guard AI reúne tus alertas de reuniones, calendarios y tareas en un solo lugar, con un asistente de IA que programa reuniones por ti.

ALERTAS QUE LLAMAN TU ATENCIÓN
Recibe una notificación con sonido antes de tus reuniones, aunque la app esté cerrada o el iPhone bloqueado: por defecto 15 y 5 minutos antes y al empezar, o cuando tú elijas. Elige la intensidad: Máxima, Media o Ligera. Las alertas Máxima y Media son urgentes y pueden llegarte durante un modo de concentración que las permita. Mantén presionada una alerta para posponerla o tócala para abrir la reunión. Con la app abierta, una alerta Máxima ocupa la pantalla con una alarma que se repite, lee la reunión en voz alta y te deja unirte, posponerla o avisar que vas tarde. Tras una reunión, un aviso de seguimiento te lleva al asistente para anotar los próximos pasos, y un resumen diario opcional repasa tus reuniones y tareas del día a la hora que elijas.

TUS CALENDARIOS, JUNTOS
La sincronización en ambos sentidos con Google Calendar y Outlook mantiene tus reuniones al día, y los eventos de ambos reciben las alertas de Meeting Guard AI. Google Calendar u Outlook envían la invitación por correo a tus participantes. Los eventos de los calendarios de tu iPhone, como iCloud, también reciben alertas, y puedes añadir a uno de ellos tus reuniones de Meeting Guard AI, salvo las que se repiten.

TUS TAREAS, AL DÍA
Elige una lista de Microsoft To Do o de Google Tasks y tus tareas quedan al día en ambos sentidos: título, notas, fecha límite y estado. Si conectas los dos, la app copia las tareas de un servicio al otro. Los recordatorios de tareas llegan como notificaciones.

UN ASISTENTE DE IA QUE PREGUNTA ANTES
Escribe o di "Almuerzo con Ana mañana a las 2 p. m." y el asistente prepara la reunión; no se guarda nada hasta que la confirmes. Una sola frase puede crear una reunión y una tarea a la vez. Pregunta "¿Qué tengo mañana?" y recibe tu agenda, en voz alta si quieres, y confirma o cancela también con la voz. Vincula tu número de WhatsApp para crear reuniones por mensaje; esas solicitudes cuentan como acciones de IA.

RESUMEN POR VOZ
Al terminar una reunión, ábrela y toca "Resumir esta reunión". Di lo que se acordó (hasta 60 segundos) o escríbelo. La app propone las tareas y no se guarda nada hasta que las confirmes.

VOY TARDE
Elige cuánto vas a tardar y recibe un mensaje listo con la nueva hora. Compártelo con cualquier app o envíalo por correo a los participantes, y mueve la reunión solo si quieres. Si una reunión termina antes, toca "Terminar la reunión ahora".

ENLACES DE ZOOM, MEET Y TEAMS
Una reunión puede tener su propio enlace de Zoom automático, o uno de Google Meet si conectas Google Calendar. Los enlaces de Microsoft Teams llegan a través de Outlook si tu cuenta los ofrece.

Inicia sesión con Apple, Google, Microsoft o tu correo. Funciona en español e inglés. Ofrecido por AETERNUM TECH LTD. ¿Preguntas? support@meetingguard.ai

PLANES
Gratis para empezar: tus primeros 7 días incluyen 10 acciones de IA (hasta 3 al día). Después, las acciones de IA requieren Pro o Premium. Crear reuniones y tareas a mano, tus recordatorios, tu agenda y la exportación son siempre gratis. Pro incluye 100 acciones de IA al mes y Premium 400, y se renuevan cada mes el día en que te suscribiste. Los precios se muestran en la app antes de comprar y pueden variar según el país.

Meeting Guard AI ofrece suscripciones con renovación automática (Pro, Premium; mensual o anual). El pago se carga a tu cuenta de Apple al confirmar la compra. La suscripción se renueva automáticamente salvo que se cancele al menos 24 horas antes del final del periodo actual. Gestiona o cancela la suscripción en los ajustes de tu cuenta de App Store.
Política de privacidad: https://meetingguard.ai/privacy-policy/
Términos de uso (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/
```

No prices: each localization serves many storefronts (the Mexico page sells Pro Monthly for MXN
179), and the product page lists every subscription at its local price. "After that, AI actions need
Pro or Premium." makes clear what needs a purchase (2.3.2). The subscription paragraph is the 1.5.0
text, with "Apple Account" for Apple's current name of the Apple ID.

### T4. Keywords (100 bytes at most; no words from the name or the subtitle, no company names)

English (97 bytes):

```
reminder,alarm,scheduler,agenda,assistant,voice,appointment,organizer,sync,deadline,calendar,task
```

Spanish (97 bytes):

```
recordatorio,alarma,reuniones,calendario,tareas,voz,planificador,organizador,pendientes,programar
```

If only Spanish (Spain) exists: `horario` instead of `pendientes`, which means earrings in Spain. If
the old English subtitle stays: `alert` instead of `alarm`.

### T5. App Review Information > Notes (4,000 bytes at most)

3,788 bytes:

```
New in 1.6.0. Everything below is optional and can be reviewed with the demo account unless noted.

1. Outlook calendar, Microsoft To Do and Google Tasks sync: menu (top left) > Settings > Calendar sync. Each needs the user's own Microsoft or Google account, so the demo account has none connected. On an email account, connect Google Calendar first (it signs in to Google on the device), then turn on Google Tasks. The attached recording shows the sync. Google is still verifying the Google Tasks permission, so Google may show an "unverified app" notice when someone connects it.
2. "Continue with Microsoft" on the sign-in screen: an optional third-party sign-in. Sign in with Apple is offered on the same screen (guideline 4.8). The demo account uses email sign-in.
3. Debrief by voice: open a meeting that has ended (menu > All meetings > Past) > "Debrief this meeting". Speak (up to 60 seconds) or type what was agreed, tap "Create tasks", then confirm or cancel the proposed task cards. Nothing is saved before confirmation. It uses the microphone and speech recognition permissions that 1.5.0 already declared.
4. Running late: open an upcoming or running meeting > "Running late" (also on the dashboard card and on the in-app alert). Pick 5, 10, 15 or 30 minutes and edit the ready message. "Share message" opens the standard iOS share sheet. "Email participants" (shown when the meeting has participants) opens Mail; if iOS cannot open a mail app, the app says so and suggests "Share message". Moving the meeting is a separate, optional step afterwards.
5. "End meeting now": in the details of a meeting that is running. It shortens the meeting so it ends now and its alerts stop.
Quick path for 3 to 5: create a meeting that started 5 minutes ago, lasts 30 minutes and has one participant email. Its details show "Running late" and "End meeting now". A minute or two after "End meeting now", "Debrief this meeting" appears (go back and reopen the meeting if needed).
6. Microsoft Teams links: only through a connected Outlook calendar whose Microsoft account offers Teams. Otherwise the app says so and offers to paste a link.
7. Plans (menu > Plans): the 3-day free trials were removed. Free now includes 10 AI actions during the 7 days after the first one, at most 3 a day (days change at midnight UTC). When they are used, the assistant needs a subscription; creating meetings and tasks by hand stays free. Pro includes 100 and Premium 400 AI actions per subscription month. The demo account is on Free with its full allowance and no active subscription, so the whole purchase flow can be reviewed. A sandbox purchase of Pro or Premium unlocks the plan within seconds.

AI and privacy: the assistant, debrief and AI suggestions send the request and a limited view of the user's meetings and tasks to OpenAI through our server. This is disclosed in onboarding (Meet your AI assistant > Privacy), in the AI suggestions confirmation and in the Privacy Policy (menu > Settings > Legal > Privacy Policy, section "AI assistant (OpenAI)").

Accounts created with email must verify the address before AI features work; Apple, Google and Microsoft sign-ins are verified at once. The demo account is verified. Tapping the post-meeting follow-up notification starts an assistant request, which counts as one AI action.

External services: OpenAI (assistant, debrief, AI suggestions), Google Firebase and Google Cloud (accounts, data, server functions), RevenueCat (subscription status), Microsoft Graph (Microsoft sign-in, Outlook, To Do), Google Calendar and Google Tasks APIs, Zoom (meeting links), WhatsApp Business by Meta (optional WhatsApp assistant).

Tested on an iPhone (MODEL, iOS VERSION) and on an iPad (MODEL, iPadOS VERSION) in compatibility mode. The app is iPhone-only.
```

Before you paste: replace MODEL and VERSION with Francisco's devices (drop the iPad part if nobody
tested on one), drop "The attached recording shows the sync." if you attach nothing, and drop the
last sentence of item 7 if the sandbox flag is not live.

### T6. Subscription Review Information > Review Notes (all four)

```
Shown on the Plans screen (menu, top left > Plans). Purchases run through RevenueCat.
```

### T7. Subscription descriptions and the group name

- Pro Monthly and Pro Yearly, English (U.S.) description: `100 AI actions per month`
- Premium Monthly and Premium Yearly, English (U.S.) description: `400 AI actions per month`
- Optional Spanish (A3.7): `100 acciones de IA al mes` and `400 acciones de IA al mes`
- Group display name: `Meeting Guard AI Plans` (a Spanish row, if any: `Planes de Meeting Guard AI`)

### T8. TestFlight What to Test

```
Store build 1.6.0 (11). Please check: sign-in with Apple, Microsoft and Google; Settings > Calendar sync (Outlook, To Do, Google Tasks); one debrief; Running late; Plans (App Store prices, no trial line).
```
