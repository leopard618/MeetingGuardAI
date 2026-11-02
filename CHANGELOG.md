# Changelog

All notable changes to MeetingGuard AI. Versions follow `version` in `app.config.js`. That value is
also the OTA runtime version.

## [1.6.0] - Unreleased (V2 Stage 2, branch `v2`)

Stage 2 of the V2 agreement: the calendar and task integrations (Outlook, Microsoft To Do, Google
Tasks), the spoken debrief and the running-late message. Includes a native change (full-screen
alarm module), so it ships as a store/APK build, never as an OTA update onto 1.5.x.

### Added

- **Flat dark UI** (client decision): the app opens in dark mode on a fresh install (a saved
  choice still wins) with charcoal neutrals; no gradients, no light or spark effects and no
  decorative motion anywhere; the accent is a solid indigo. The header is a menu button, the
  title and a language pill with the country flag. The bottom bar is gone: the AI assistant is a
  floating button that opens the chat with a tap and can be long-pressed and dragged anywhere
  (the spot is remembered). The dashboard is, in order: a short greeting, the next-meeting card
  (clock line, countdown in accent, Details and Join), the tasks card beside a 2 x 2 grid of
  quick actions (new meeting, new with AI, WhatsApp, notes), today's schedule, and a "Your week"
  card with a static seven-day meeting-time chart. The overview tiles, the ask bar and the
  alerts card are gone (alert settings stay in the menu and in Settings).
- **New welcome image**: the sign-in screen opens on the brand image (the mark, the app name and
  "Never Miss What Matters." over a night office) with only the sign-in buttons and the Terms and
  Privacy links below it; the old photo, logo, headline, feature list, quota note and white card
  are gone.
- **Bottom navigation bar with the AI assistant in the middle**: Home, Meetings, AI, Calendar and
  Tasks are one tap away from every main screen; the assistant is a raised gradient orb that
  breathes until the chat is open (it replaces the floating assistant button). The menu keeps the
  remaining destinations (new meeting, notes, plans, settings). The bar owns the bottom safe-area
  inset, so list paddings and the floating buttons sit right above it; modal sheets and editors
  keep their window insets.
- **Light and spark**: an ambient aurora (three drifting color blooms) behind the dashboard
  greeting and glass stat tiles, a soft glow and twinkling sparks around the assistant orb, a
  light sweep across the next-meeting card and the sign-in button, a glass tab bar, fade-and-rise
  screen transitions, and vivid indigo-to-violet gradients in dark mode instead of the pale ones.
  Cards now cast their shadow on Android (they no longer clip their own box). All effects are
  decorative, ignore touches and stay still under "reduce motion".
- **New typeface and icons**: the whole app is set in Plus Jakarta Sans (heavy, tight headlines,
  relaxed body text) and the shell, dashboard, menu and meeting rows use one thin line-icon family
  (Feather) through the kit's Icon component. The header is no longer an app bar: it sits on the
  screen background with the title, the EN/ES pill and a gradient avatar with your initial that
  opens the menu (the theme switch lives in the menu and in Settings). The bottom bar is a floating
  pill. The dashboard opens with a big greeting, three stat tiles (today, tasks due, this week) and
  the next meeting on a gradient card with a white Join button.
- **Visual refresh**: indigo gradients on the primary buttons, the floating "new" buttons, the
  header hairline and the active tab; a gradient hero card on the dashboard with the greeting and
  today's numbers (meetings today, tasks due); the next-meeting card and every resting card are
  lifted with a soft indigo shadow (tonal step in dark mode) and rounder corners; the landing
  photo sits under an indigo-to-night gradient and the sign-in button is a gradient pill; empty
  states get a gradient icon circle. Motion: cards, tiles, tabs and buttons spring to 97 percent
  while pressed, dashboard blocks and today's rows fade in with a short stagger, the active tab
  pill springs in. Everything is static under the system "reduce motion" setting. Needs
  `expo-linear-gradient` (native module), so it ships with the next APK and store build.
- **Outlook calendar sync, activated** (milestone M6): the Microsoft Graph two-way sync built in
  v1 is switched on by setting `EXPO_PUBLIC_MSAL_CLIENT_ID` (Azure app registration, SETUP §10).
  Connect a Microsoft account on the Calendar sync screen; meetings flow both ways with the
  existing conflict rules, and alerts re-reconcile after every pull.
- **Repeating meetings reach Outlook**: a MeetingGuard series is pushed as a Graph series master
  (daily, weekly, monthly rules; until and count; the anchor moved to the first generated
  occurrence when the rule skips it). Cancelled occurrences delete their Outlook instance,
  modified ones (time, duration, title) patch it; the shape change one-off <-> series is handled
  by delete and re-create. Instances of our own series coming back through calendarView are
  skipped, and a full sync never tombstones a series master. Occurrence edits made in Outlook on a
  MeetingGuard series stay in Outlook (same one-way rule as Google).

- **Microsoft To Do, two-way task sync** (milestone M7): on the Microsoft account the Outlook card
  connects (one consent, now with `Tasks.ReadWrite`), tasks sync both ways with a chosen To Do
  list: title, notes, due date, reminder, done state and deletion. The list is chosen when the
  sync is turned on (Calendar sync screen, Microsoft To Do card), can be changed for new tasks,
  and a task can be moved to another list from its editor; the editor and the assistant's confirm
  sheet name the list before anything is saved, and the editor says what To Do does not keep (a
  due time without a reminder, people, the meeting link). Tasks completed in To Do silence their
  reminder here within a minute while the app is open (a one-minute To Do pull on top of the
  calendar sync). Tasks finished in To Do before the sync never saw them are not imported.
  Task documents gain `source` and the To Do link (`external`), preferences the default list;
  Firestore rules updated.
- **Home screen, client feedback (Oct 28)**: the Next meeting card also shows the next all-day item
  (a birthday or holiday from a phone calendar) when it comes no later than the next timed meeting,
  with its own Details button; the "Tasks today" card moved up, right under that card, so it is seen
  without scrolling. All-day items were already in today's timeline and in the lists.
- **Alert intensity for events from other calendars** (Settings > Alerts > "Events from other
  calendars"): one intensity for meetings imported from a phone, Google or Outlook calendar, or
  "same as above". A meeting's own intensity still wins; all-day events never ring. The Default
  chip in the meeting form and the details line name the intensity that really applies.

### Fixed

Code audit of October 30, 2026 (docs/v2/AUDIT-2026-10-30.md has the full list and the
countermeasures that need a device run):

- **Dashboard and list jank with daily series**: recurring meetings were re-expanded over a year
  on every 30 s clock tick, and every time-zone check built a new Intl formatter. Expansions are
  now keyed on the local day, the zone validity and the device zone are cached, and daily/weekly
  rules start iterating near the window instead of at the anchor.
- **Outlook, fresh install or second device**: the first pull could import this user's own pushed
  events as foreign meetings (duplicates whose deletion deleted the real event). Own events are
  recognised by their transactionId and the session-start pull waits for the server's meetings.
- **Outlook all-day events east of UTC** arrived one day early (Graph converts all-day midnights
  to UTC); the calendar date is now taken correctly.
- **Outlook invitations for hybrid meetings** (address plus video link) carried no join link; the
  link now travels in the body like it does for Google, and is stripped again on import.
- **Google and Outlook connect** wiped the queued pushes, so edits and deletes made while the
  connection was lost never reached the calendar; the queue now survives a reconnect.
- **Edits pulled from one calendar reach the other** for meetings linked to both (a meeting moved
  in Google Calendar is moved in Outlook too).
- **Google 412 on an attendee RSVP** dropped the local edit; an invisible remote change now
  retries the write, and "this and following" masters Google derives from ours are recognised.
- **Microsoft To Do**: the public tasks repository dropped the write options, so imports lost
  their deterministic id and source (Stop sync left them behind, duplicates on restart); links are
  learned on import so Change list leaves one copy; a reminder after the due date keeps its instant;
  date-only values at UTC+13 no longer shift; a 403 on one task no longer blocks the whole sync;
  disconnecting Outlook turns the To Do sync off.
- **Microsoft sign-in**: a token refresh still in flight at sign-out could re-store the token or
  hand it to the next user; a keystore write failure while rotating the token no longer counts as
  a revoked consent.
- **Assistant**: a typed "si" (no accent) never executed while the reply said it was confirming;
  a plain "yes" now resolves the newest proposal only, not every card in the thread; a bulk move
  that fails on one meeting reports the rest as done; assistant tasks get a deterministic id (no
  twins on retry); an exhausted OpenAI quota is logged as configuration, not as traffic; a task
  linked to a meeting created in the same reply runs after the meeting.
- **Data layer**: preferences written by an older build no longer reset keys it does not know;
  transaction contention is retried instead of dropped; one stuck document no longer blocks every
  other write for up to an hour; an unreadable outbox row no longer blocks the session; the
  Android AsyncStorage limit is raised to 50 MB (plugins/withAsyncStorageDbSize.js).
- **Alerts**: the iOS pending budget now accounts for task reminders and briefings (64 cap); the
  native alarm no longer re-fires when a reconcile races the fire instant (native change); the
  exact-alarm card stops asking once the permission is granted.
- **Meeting details**: no "Meeting not found" flash while deleting; next occurrences follow the
  clock; task due times show in the device zone like their reminders.
- **Server**: WhatsApp sessions of unlinked phones are purged on schedule; a message that fails
  after its dedupe claim gets an error reply instead of silence; account deletion removes the
  Zoom ownership registry and the restore replay removes WhatsApp links; google-auth-library is
  a declared dependency.
- **One invitation email for Zoom meetings**: a meeting saved with an automatic Zoom link was
  pushed to Google/Outlook at once and again seconds later when the link landed, so attendees got
  an invitation without the link followed by an "updated invitation" with it. The calendar pushes
  now wait for the link (held at most 30 s, released on success or failure), so one invitation goes
  out with the join link in it.
- **Alarm voice readout on Android**: a MAX alert fired by the native full-screen alarm while the
  app was closed opened the app on the meeting page only, without the in-app alarm (sound loop,
  spoken readout, snooze). The native module now records fired alarms with their payload and the
  alert engine re-shows them in-app when the app opens (within 20 minutes), through the same rules
  as a tray notification. Native change: ships with the next store/APK build.

## [1.5.0] - Unreleased (V2 Stage 1, branch `v2`)

The conversational agent: two-way voice, tasks as a first-class item, combined requests and the
agenda. Adds the native speech-recognition module and the microphone permission, so this version
ships only as a store/APK build, never as an OTA update onto 1.4.x.

### Added

- **Two-way voice conversation** (week 1): on-device speech recognition in English and Spanish,
  the recognized text on screen and correctable by typing, spoken replies with a toggle, and
  context carried across turns. Every action still ends in a confirmation card.
- **Tasks as a first-class item** (week 2): create, edit, postpone, complete, reopen and delete,
  with description, optional due date and time, a reminder through the alarm engine, status and
  links to meetings and people. Tasks appear on the dashboard and the calendar, and can be
  created over WhatsApp.
- **Voice confirmation of actions**: an explicit spoken "yes, confirm" or "cancel" executes or
  dismisses the pending proposals through exactly the same path as the card buttons. An unclear
  or contradictory reply never executes anything; it is sent to the assistant as a normal
  message instead.
- **Combined requests that link** (week 3, AI contract v6): "book the call with Ana and add a
  task the day before to prepare the proposal" proposes both in one response, and the task is
  linked to the meeting that does not exist yet (`meetingActionId`, resolved on the device once
  the meeting is created). A missing link never costs the user the task.
- **Meeting-move prompts**: moving a meeting that has linked tasks asks once, by name, whether
  the task should move too, and keeps the gap the user set up. The question is guaranteed by the
  server: when the model moves a meeting and says nothing about a linked, dated, open task, the
  question is appended to the reply.
- **Server-side consent guard**: a spoken or typed answer to a confirmation card is honoured as
  confirm or cancel only when it is short and carries no qualifier ("yes but make it earlier"
  leaves the cards on screen), whatever the model decided. Logged as resolutionBlocked so it can
  be checked without a device.
- **Full-screen morning summary** (week 5, Android; Francisco request): the daily briefing can
  take over the screen like a meeting alarm at the time you set, instead of a quiet notification.
  Settings > Alerts > Daily briefing > Show full screen (Android only, off by default, needs the
  full-screen permission). It reuses the meeting-alarm module; a new scoped setAlarms keeps the
  briefing and meeting alarms from cancelling each other. On iPhone and where the permission is
  off it stays a notification.
- **"Alerts are on" status notification** (week 5): an optional, silent, ongoing notification
  that says alerts are armed and names the next meeting, kept current while the app is closed.
- **Admin: read-only role and audit log** (milestone M2): a `viewer` claim (granted with
  `set-admin-claim.mjs --role viewer`) opens every dashboard view without any write action,
  enforced server-side; every administrative write (plan change, disable, key rotation,
  reconcile) records who, what, before, after and outcome in `adminAudit`.
- **Admin: Revenue tab** (milestone M1): paying users by plan and store, estimated MRR, trials
  started, new paid, cancellations, refunds and expirations per day from the store webhook
  events (`adminGetRevenue`). The billing webhook now keeps the billing facts (store, product,
  period, price) on each event marker and next to the entitlement; it never uses them for
  entitlement decisions.
  Settings > Alerts > Status notification, off by default. Its own low-importance channel on
  Android.
- **Apple sign-in errors tell the truth**: a refused Apple credential is reported as such (EN/ES)
  instead of "the email or password is incorrect", and the refusal reason reaches the crash
  reporter.
- **Plans screen subscription terms** (App Store rule 3.1.2): the renewal terms in one line and
  links to the privacy policy and the terms of use on the Plans screen itself, in English and
  Spanish. Apple rejected 1.4.0 on 2026-10-20 partly for their absence.
- **Composed agenda answers** skip cancelled meetings and read a repeating meeting as a time of
  day, since its stored start is the first occurrence of the series.
- **Daily briefing** (week 4): an optional once-a-day notification summarizing that day, at a
  time the user controls (Settings > Alerts). Its own `mgbrief:*` scheduler and Android channel,
  so it can never collide with meeting alerts or task reminders, and its own switch.
- **Agenda answers** (week 4): "what do I have today", "what is overdue" and "what should I
  prepare for tomorrow". The server now composes the answer text from the resolved rows when the
  model writes none, so a voice-only user hears the items instead of a caption, and hears
  "nothing" when the answer is nothing. Series exceptions (`skipped`, `moved`) and the agenda
  text of near-term meetings reach the model, so a cancelled standup is never announced and
  preparation advice is never invented.

### Fixed


- **The assistant sometimes printed raw JSON instead of a confirmation card**: for some
  phrasings (seen with "rename the call ... and add the Zoom link later") the model wrote a
  tool's arguments into its reply text and made no tool call, so the user saw a JSON blob and
  no card. The server now recovers such a tool call, validates it like any other, and never
  shows raw JSON in a reply. Prompt rule 15 tells the model not to do it, and rule 14 now also
  treats "remind me ..." as a linked task.
- **Calendar showed six columns** on some phones: the seventh weekday and every Saturday wrapped
  onto the next line because seven cells of exactly one seventh of the width overflowed by a
  fraction of a pixel. The grid is now rows of seven flexible cells, which cannot wrap. The
  calendar header also moved to a left-aligned month title with grouped arrows, the grid sits on
  a rounded surface, today is a ring and the selected day a filled circle.
- A read-only answer is no longer captioned "review and confirm", which asked the user to
  confirm something that did not exist.
- A repeating meeting in an agenda list showed the series master's date (often months past)
  instead of the occurrence the answer was about.
- The assistant voice hook updated a ref during render.

## [1.4.0] - Released October 6, 2026 (Google Play, production, 100 percent). iOS submitted October 8, 2026 and still in App Store review.

iOS pass: Sign in with Apple and App Store readiness. New native module + entitlement, so this
version ships only as a store/APK build - never as an OTA update onto 1.3.x.

### Added

- **Sign in with Apple** (iOS only; docs/v1/ARCHITECTURE.md §26): official Apple button above
  "Continue with Google" on the landing screen (App Review 4.8, equal prominence), nonce-checked
  `signInAsync` -> Firebase `signInWithCredential`, silent cancel, first-sign-in name capture.
  New runtime dependency `expo-apple-authentication`; new i18n keys (EN+ES) for the button,
  the two Apple error messages and the revoke notice.
- **Trusted-provider verification gate**: `TRUSTED_SIGN_IN_PROVIDERS` (google.com, apple.com) +
  `isTrustedSignInProvider` in the shared AI contract (app and functions copies, drift-checked).
  The assistant and Zoom callables and the client verify-email banner all accept Apple accounts
  as verified - including "Hide My Email" private-relay addresses, which can report
  `email_verified: false` although Apple itself verified the Apple ID. Password accounts are
  gated exactly as before.
- **Apple token revocation on account deletion** (App Review 5.1.1(v)): deleting an Apple
  account reauthenticates via the Apple sheet, then revokes the Apple token BEFORE the delete
  callable runs - a direct Identity Toolkit `accounts:revokeToken` request with
  `tokenType: AUTHORIZATION_CODE`, the same call the native iOS SDK makes (the JS SDK's
  `revokeAccessToken` mislabels the code as an access token and Apple then revokes nothing
  while reporting success). The authorization code is stashed only after Firebase validated
  the credential, so a wrong-identity code (auth/user-mismatch) is never revocable. Revocation
  is best effort: on failure a notice toast explains the manual detach path and the deletion
  still proceeds. Deploy order: the 1.4.0 functions (trusted-provider gate) go live BEFORE any
  iOS build reaches testers (docs/v1/DEPLOYMENT.md section 4).
- **iOS build/store runway** (docs/v1/SETUP.md §8): `ios.usesAppleSignIn`, time-sensitive
  notifications entitlement, `ITSAppUsesNonExemptEncryption: false`, EN+ES locales, iPhone-only
  first release (`supportsTablet: false`), `ios-simulator` EAS build profile (Appetize browser
  testing), and the full owner checklist from Apple Developer enrollment to TestFlight,
  privacy labels and review notes. On-device test plan: docs/v1/TESTING.md T20.

### Changed

- `assets/icon.png` is now the final 1024x1024 App Store icon (Android adaptive icon unchanged).
- Version 1.4.0 in `app.config.js` / `package.json` (OTA runtime version separation from 1.3.x).

## [1.3.1] - Released inside 1.4.0 on October 6, 2026 (branch `stabilization`)

UI modernization ("MG Indigo"): a visual-only restyle of every screen. No business logic,
navigation, i18n keys (beyond two added alert-status strings) or alert behavior changed.

### Added

- **Zoom auto links, server-created** (docs/v1/ARCHITECTURE.md §24; owner setup docs/v1/SETUP.md §12):
  picking Video call = Zoom and saving without a link now creates a real Zoom meeting on the
  owner's Server-to-Server OAuth app and writes the join url/passcode into the meeting
  (`zoomCreateMeeting`/`zoomSyncMeeting`/`zoomDeleteMeeting` callables + `zoomStatus`); edits
  sync topic/time to Zoom, deletes remove the Zoom meeting (manual and assistant paths alike).
  Off by default: without the `ZOOM_ENABLED` param and the three Zoom secrets the app keeps the
  paste-a-link behavior, and the default functions deploy never references the secrets. New
  Firestore rules key `external.zoomMeetingId` ships with this (deploy rules with the
  functions); per-user daily caps guard abuse.
- **Email/password sign-in + verification gate** (docs/v1/ARCHITECTURE.md §25; owner console
  switch docs/v1/SETUP.md §13): a second landing button opens sign-in / create-account with
  show/hide password, autofill hints and an inline no-enumeration password reset; unverified
  email accounts get a verify banner (resend with cooldown + "I verified") on the AI assistant
  surfaces, which stay gated until verified - everything else works unverified. Graceful
  "email sign-in is not enabled" message while the Firebase provider is off.
- **Admin dashboard v2** (`/admin`; docs/v1/ADMIN.md): modern dark UI on the app design tokens,
  four hash-routed tabs (Overview, Users, AI usage, Settings) with hand-rolled SVG charts
  (requests/day, signups/day, input/output tokens/day; 7/30/90-day ranges) and an estimated-cost
  tile driven by the `OPENAI_PRICE_IN_PER_M` / `OPENAI_PRICE_OUT_PER_M` params. New callables
  `adminGetStats`, `adminGetHealth` (runtime health + optional real OpenAI ping) and
  `adminRotateOpenAiKey` (validate against OpenAI, store via Secret Manager, disable prior
  versions - the key value never appears in logs, errors, Firestore or the browser). The
  assistant now aggregates per-UTC-day request/token stats into `adminStats/ai/days/*` and reads
  its OpenAI key from Secret Manager at runtime (5-minute cache, 401-retry, env fallback), so a
  dashboard rotation needs no redeploy.

### Changed

- **One design language across the app.** A single brand hue (MG Indigo `#4646D3` light /
  `#AFB4FF` dark) replaces Paper's stock purple plus the assistant's emerald and the calendar
  sync screen's blue/slate; cool-slate neutrals, hairline-bordered flat cards, sentence-case
  section headers, and one focal element per screen. All colors, typography, spacing, radii and
  component metrics come from `src/theme/tokens.ts`; the ~93 distinct hard-coded hex colors that
  screens used before are down to zero outside the theme (a WCAG-AA contrast guard test covers
  every documented pairing in light AND dark mode).
- **Shared component kit** (`src/components/ui/`): MGButton, Card, SectionHeader, ListGroup/
  ListRow (incl. destructive rows), Badge, Banner (titled), EmptyState/ErrorState (retry with
  spinner)/LoadingState/Skeleton, SheetHandle - now used by every screen for consistent cards,
  rows, buttons, badges, banners and empty/error/loading states.
- **Restyled screens:** landing, onboarding (incl. pixel-accurate alert previews), legal,
  pricing, settings, alert preferences; dashboard (focal next-meeting card, quick actions,
  timeline) and AI insights (stat tiles, load-by-day bars); meetings list/form/details,
  calendar + month grid, create flow, attachments, confirmation modal; assistant chat,
  calendar sync, notes, and the MAX/MEDIUM/LIGHT alert overlays (now token-driven,
  mode-invariant always-dark, with AA-fixed join/ack buttons) plus AppToast and the error
  fallback.
- Meeting sources and note categories share one categorical palette (accent bars, dots,
  legends) with ≥3:1 contrast in both modes; the hard-coded Google blue and Tailwind note hexes
  are gone.
- Accessibility: 44dp touch targets, font-scaling-safe layouts at 360dp (no fixed text
  heights), kept/extended accessibility roles, labels and states throughout.

## [1.3.0] - Released inside 1.4.0 on October 6, 2026 (branch `stabilization`)

The version jumped because this release ships **new native code** (the widget module and the
purchases SDK): it needs a store/APK build and must never reach a 1.2.0 binary as an OTA update.

### Added

- **Home-screen widget (Android)** (new native module `mg-next-meeting-widget`): shows the next
  meeting (title, time, date) in the app's language, flips to "Happening now" at start time,
  updates when meetings change (background sync included), survives a reboot, and opens the
  meeting when tapped. Signed out or without upcoming meetings it shows an empty state.
- **Recurring meetings: "This and following"** as a third scope next to "This meeting only" and
  "The whole series", in the list and details dialogs, the occurrence edit sheet and the AI
  assistant ("move the standup to 10 from next week on"). The series is split: earlier
  occurrences keep the old rule, the edited part becomes its own series. Google Calendar shows
  the original series shortened plus a new series event.
- **Subscriptions (Google Play + RevenueCat), behind a build flag:** with
  `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` set, the Pricing screen sells Pro/Premium
  (monthly/yearly, 3-day free trials, prices straight from Google Play), with purchase,
  restore and "Manage subscription". Plans are activated by the server (RevenueCat webhook
  `revenuecatWebhook`); the app never writes its own plan. Without the key the screen keeps
  saying "Subscriptions coming soon" exactly as before. Setup: `docs/v1/SETUP.md` §11.
- **Admin dashboard** (`/admin` on Firebase Hosting, admins only via a custom claim): user list
  with plan and today's AI usage, disable/enable accounts, set a plan manually, and usage
  metrics. Guide: `docs/v1/ADMIN.md`.
- **Video-call links:** the meeting form and details now derive their link text from the chosen
  provider AND the live calendar connections. Teams links are created automatically when a
  meeting is first pushed to a connected Outlook account; Google Meet keeps working on every
  sync. Where a link can never be auto-created (Teams + repeat, meetings imported from another
  calendar, an event already in Outlook without a link) the app says so instead of promising
  one.

### Fixed

- The helper text under the video-call options did not change when switching the provider, and
  claimed a link would be generated even when it never would (the auto-link text was
  Google-only and partly static). It now updates immediately per provider and connection
  state, with a "Connect" button when connecting a calendar would enable the link.
- The AI delete-confirmation card showed the whole-meeting warning for a "this and following"
  delete; it now says only the occurrences from that date on are removed.
- **"This and following" with a date change kept the old weekly/monthly pattern**, so the moved
  occurrence silently vanished (a Tuesday series moved to Wednesday still met on Tuesdays). The
  rule now follows the new day, and a move past the series' end date is rejected instead of
  producing an empty series.
- Saving an unrelated edit in the meeting form could wipe a Meet/Teams link the calendar sync
  had just created (the form diffed against a stale snapshot). An untouched link field now
  keeps the live link.
- The recurring-meeting dialogs' question named only two of the three buttons; it now describes
  "this and all following occurrences" too (EN + ES).
- **Upgrading Pro -> Premium now replaces the Play subscription** (with credit for unused time)
  instead of opening a second, parallel subscription that billed twice.
- The "Current plan" badge follows the actually purchased billing cycle; the other cycle's card
  and the blocked downgrade card explain that the switch happens in Google Play instead of
  showing an untrue badge or dead space. "Manage subscription" deep-links to the purchased
  product.
- The "Activating your plan..." wait now ends honestly after ~2 minutes ("Still processing")
  instead of spinning forever with Retry/Restore disabled; the plan still activates by itself.
- The RevenueCat webhook ignores out-of-order stale events (a delayed expiration can no longer
  downgrade a resubscribed user) and ignores SANDBOX test events unless explicitly enabled for
  the test phase (`REVENUECAT_ALLOW_SANDBOX`).
- The widget degrades from "Happening now" to the empty state on its own 5 minutes after the
  start (it no longer shows a past meeting overnight) and re-renders on timezone/clock changes;
  the app re-feeds it after a zone change.
- Admin hardening: callable uids are restricted to the safe document-id charset, and the
  `/admin` CSP is pinned to this project's hosts instead of multi-tenant wildcards.

### Changed

- Version 1.3.0 (new native modules; store build only, never OTA - §15 of the architecture).
- `react-native-purchases` 10.10.2 added; the entitlement document gained the sources
  `revenuecat` and `admin` (server-written, as before).

## [1.2.0] - Released inside 1.4.0 on October 6, 2026 (branch `stabilization`)

This version is a rebuild. It is compared here with **v1.0.9**, the version on Google Play
(versionCode 20, built in September 2025 from commit `ef4963f`). None of the later v1.0.x work on
`main` (up to `3308b9d`) was ever released. The developer handoff is in `docs/v1/HANDOFF.md`.

The version number jumped from 1.1.0 (test builds only, never published) to 1.2.0 when the
full-screen alarm native module was added: a new native module changes the runtime version, so it
needs a new store/APK build and must never ship as an OTA update onto a 1.1.0 binary.

### Draft store release notes

- **EN:** New MeetingGuard AI: alerts that work even when the app is closed - including full-screen
  alarms over the lock screen on Android - recurring meetings, two-way Google Calendar sync, phone
  calendars, a smarter AI assistant that always asks before changing anything, notes, and instant
  English/Spanish switching. Please sign in again with Google. Your meetings from the previous
  version are imported automatically.
- **ES:** Nuevo MeetingGuard AI: alertas que funcionan incluso con la app cerrada - incluidas
  alarmas a pantalla completa sobre la pantalla de bloqueo en Android - reuniones recurrentes,
  sincronización en ambos sentidos con Google Calendar, calendarios del teléfono, un asistente de IA
  más inteligente que siempre pide confirmación antes de cambiar algo, notas y cambio instantáneo
  entre inglés y español. Vuelve a iniciar sesión con Google. Tus reuniones de la versión anterior se
  importan automáticamente.

### Added

- **Sign-in and account:**
  - Google sign-in with the native Google SDK and Firebase Auth.
  - Account deletion in the app (Settings -> Account) and a web page for Google Play
    (`public/delete-account.html`).
- **Onboarding:** 5 steps: language, calendars, alerts (including the notification and exact-alarm
  permissions), AI intro, and a guided first meeting.
- **Sync:** meetings, notes and settings are stored per user in Firestore and sync across devices. The
  app works offline: changes wait in a local queue and are sent when the connection returns.
- **Import of v1.0.9 data:** the meetings, notes and preferences that v1.0.9 kept on the phone are
  imported once, into the account with the same email.
- **Alerts:**
  - OS notifications that fire when the app is in the background or closed, and after a reboot.
  - An Android notification channel per intensity (with and without vibration).
  - Exact alarms (after the user allows them) and an option to ring during Do Not Disturb (MAX).
  - In the app:
    - **MAX:** a full-screen alert with a looping alarm that gets louder, a spoken readout in English
      or Spanish, vibration and a 60-second auto-snooze.
    - **MEDIUM:** a banner that stays until you act.
    - **LIGHT:** a toast.
  - "Snooze" buttons on the notification, and a post-meeting follow-up notification.
  - **Full-screen MAX alarms on Android** (new native module `mg-fullscreen-alarm`): a MAX alert
    shows over the lock screen even when the app is closed, on the meeting's alert channel, and
    pending alarms are restored after a reboot. When the module or the permission is missing
    (revocable on Android 14+) the alert falls back to a normal notification, never lost and never
    doubled. Alert settings and onboarding show the real full-screen and exact-alarm permission
    state on devices with the module.
  - Settings for alert times, intensity per meeting, sound type, volume, vibration and snooze length.
    The 12/24-hour time format is in Settings, next to the language.
- **Calendars:**
  - Two-way Google Calendar sync: create, update and delete in both directions, with invitations for
    participants and real Google Meet links.
  - **Outlook / Microsoft 365 sync (phase 1):** connect a Microsoft account (PKCE sign-in, no
    server); two-way sync with the account's default calendar over Microsoft Graph delta queries,
    with Teams links for online meetings. Needs an Azure app registration
    (`EXPO_PUBLIC_MSAL_CLIENT_ID`, `docs/v1/SETUP.md` §10); the Outlook card is hidden when it is not
    configured. In this version recurring series, and meetings that came from Google or the phone
    calendars, are not pushed to Outlook.
  - Import from and export to the calendars on the phone (Apple / Android).
- **Recurring meetings (phase 1):**
  - A "Repeat" section in the meeting form: daily / weekly (with weekday chips) / monthly, an
    interval ("every 2 weeks"), and an end (never, on a date, or after N times). English and Spanish.
  - The dashboard, list and calendar show one row per occurrence; details show the rule in words and
    the next occurrences.
  - Editing or deleting an occurrence asks the scope: "This meeting only" (that occurrence) or
    "The whole series". One occurrence can be moved, resized, renamed or removed without touching the
    rest of the series.
  - The assistant understands repeat requests ("every Monday at 9", "cada lunes a las 9") and scoped
    changes ("delete only tomorrow's standup"); confirmation cards state the rule and the scope.
  - Google Calendar sync pushes the series as a real recurring event (cancelled occurrences
    included). Time changes of a single occurrence stay in MeetingGuard in this version.
- **AI assistant:**
  - It runs on our server (Cloud Function) and understands English and Spanish.
  - It can create, update, delete, share, bulk-update and list meetings.
  - It shows a confirmation card for every action, and nothing changes without your confirmation.
  - It knows the current date and your time zone, and gives follow-up suggestions after meetings.
  - Daily request limit per plan: 5 on the free plan.
- **Screens:**
  - Edit meeting (it was "coming soon").
  - Meeting details with attachments. The files stay on the phone.
  - Meetings list with search and filters.
  - A month calendar.
  - Notes that are saved and synced (they were sample data).
  - Insights computed on the phone.
  - Forms keep the field you type in above the keyboard, and ask before discarding unsaved changes.
- **Look and language:**
  - Instant English/Spanish switching without a restart, with local date and time formats.
  - Light, dark and system themes.
- **Legal:** complete privacy policy and terms in English and Spanish. The company details are still
  placeholders.
- **Operations:**
  - Crash reporting with Sentry (optional).
  - A daily Cloud Function (`dailyMaintenance`) erases deleted-meeting records after 60 days on the
    server, as the privacy policy says, and account deletions are recorded for 30 days so that a
    backup restore cannot bring a deleted account back (`functions/scripts/replay-account-deletions.mjs`).
  - Over-the-air JavaScript updates with EAS Update (channels development / preview / production).
  - GitHub Actions CI and about 1,000 automated tests (app, Cloud Functions, Firestore rules).
  - Local test APKs for emulator testing without EAS: `npm run apk:test` builds a release APK signed
    with a local test key (EAS Update off) and `npm run apk:sha1` prints that key's SHA-1
    (`docs/v1/TESTING.md` B.2).

### Changed

- **Platform:** Expo SDK 52 -> **57**, React Native 0.76.9 -> **0.86.3**, React 18.3 -> **19.2.3**,
  New Architecture, Android target API 36.
- **Code:** all app code under `src/` is now strict **TypeScript** (it was JavaScript).
- **Backend:** the Render (Express + Supabase) backend is replaced by **Firebase**: Auth, Firestore
  with security rules, and Cloud Functions (`assistant`, `deleteAccount`).
- **Languages:** i18next with namespaced EN/ES files replaces the custom dictionary. The language is
  detected from the phone and saved.
- **Pricing:** the Pricing screen shows the contract prices (Pro $7.99, Premium $14.99, 25% off
  yearly) and "Subscriptions coming soon". There are no purchase buttons and no payment links.
- **App name:** the launcher name is now "MeetingGuard AI" (it was `meeting-guard-ai`).
- **Android:**
  - Backup of app data is off (`allowBackup: false`), and data extraction rules also exclude it from
    device-to-device transfers (Android 12+).
  - `RECORD_AUDIO`, `READ_CONTACTS` and `SYSTEM_ALERT_WINDOW` are blocked.
  - `SCHEDULE_EXACT_ALARM` was added.
- **App size:** icons are imported per family (Ionicons, MaterialCommunityIcons, MaterialIcons), so
  the bundle carries 3 icon fonts instead of all 19 (about 2 MB less). ESLint blocks the
  `@expo/vector-icons` barrel import.
- **Sign-in:** users must sign in again (with Google). The v1.0.9 backend session is not carried over.

### Removed

- **Stripe Payment Links** for subscriptions. They broke Google Play payment rules, and the only
  link compiled into v1.0.9 was a test-mode link.
- **Secrets in the app:** the OpenAI key and the Google OAuth client secret. OpenAI is called only
  from the server.
- **Debug and fake features:**
  - the debug and test screens
  - the fake "API Keys" screen
  - the "Delete the ADSF meeting" chat chip, which deleted the newest meeting without asking
  - fake conference links
  - "invitations sent" messages that sent nothing
- **WhatsApp:** the placeholder WhatsApp screen and route. The creation chooser shows WhatsApp as "not
  available yet".
- **Old code (for developers):**
  - All JavaScript screens and components: `src/pages/*` and the JS versions of the header, sidebar,
    theme toggle, error boundary, confirmation modal and badges.
  - `translations.jsx`, `AlertScheduler`, `NotificationSystem`, `contexts/{Theme,Auth}Context.jsx`.
  - `config/imageSliderConfig.js`, `hooks/{useGoogleAuth,usePersistentNotification}.js`.
  - `utils/{responsive,meetingHelpers,storage}.js`, `utils/index.ts`.
  - `api/{entities,localStorage,googleCalendar,googleTokenManager,calendarSyncManager,manualLoginGoogleCalendarService,emailService,fileUpload}.js`.
  - `services/{firebaseAuth,firestoreService}.js`.
  - The stage-2 compatibility shims.
  - `react-native-iap`, `expo-av`, `expo-background-fetch`, `react-native-dotenv` and about 35 unused
    packages.
  - Code that is still needed to read old data now lives in `src/services/data/legacyInput.ts`.

### Fixed (problems in v1.0.9)

- Alerts only fired while the app was open on the Dashboard; v1.0.9 had no OS notifications. They are
  now scheduled with the OS.
- A chat suggestion chip deleted a meeting without confirmation.
- The AI chat used an OpenAI key inside the app.
- The Google sign-in flow depended on a backend route that returned other users' Google tokens. The
  app now uses native Google Sign-In and stores no tokens.

### Security

- No secrets in the app bundle; CI scans the bundle on every push (and fails if it cannot scan it).
- Firestore security rules, with emulator tests:
  - Users read and write only their own data.
  - Plans (`entitlements`) and usage counters are server-only.
- Google access tokens come from the native SDK when needed and are never stored. The old plaintext
  token keys are deleted at start.
- Sentry drops personal data (emails, query strings, console arguments). The logs never contain
  tokens, emails, meeting text or chat text.
- The assistant treats meeting data as untrusted input (prompt-injection defences). It accepts only
  email addresses that the user typed or that already belong to the meeting.

### Known issues

See `docs/v1/HANDOFF.md` §4. The main ones:

- Full-screen alarms over the lock screen are Android-only and need the `mg-fullscreen-alarm`
  native module in the build (revocable by the user on Android 14+; the app then falls back to a
  high-priority notification).
- Exact alarms and the Do Not Disturb override need the user's permission.
- Outlook sync needs an Azure app registration and pushes neither recurring series nor meetings
  that came from Google or the phone calendars. Deleting or editing our own series occurrence by
  occurrence in Google/Outlook web does not import back.
- WhatsApp and subscriptions are not built.
- Recurring meetings: "this and following" edits do not exist, and moving a single occurrence is not
  pushed to Google Calendar (the change is only in MeetingGuard).
- Attachments stay on the phone.
- iOS has not been built.
- **Nothing was tested on a device.**

## [1.0.9] - September 2025 (Google Play, versionCode 20)

The version on Google Play when this work started. It was built from commit `ef4963f`:

- Login through the Render backend.
- Meetings stored only on the phone.
- Alerts only while the app was open.
- Subscriptions through Stripe Payment Links.
