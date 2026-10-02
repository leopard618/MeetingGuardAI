# Full feature test pass on LDPlayer

A complete, ordered walkthrough of every feature that can be tested today, written for the
current setup: no real phone, LDPlayer 9 on the PC, the local test APK, and the live
`meetingguard-ai-app` backend. The master test plan with every edge case is
`docs/TESTING.md` (T1 to T21); this guide tells you which parts to run now, in what order,
with condensed steps and expected results. When a step here feels too thin, open the matching
T-section in TESTING.md for the full table.

- **APK:** `deliver\MeetingGuardAI-1.4.0-test.apk` (built 2026-10-02 12:35). It contains the
  payments code, the filled legal texts (AETERNUM TECH LTD) and the slimmed landing screen.
- **Backend:** all functions and hosting are deployed. AI assistant, Zoom links, email
  verification and the admin dashboard are live. Payments, WhatsApp and Outlook are dormant
  (see "Out of scope" below).
- **Admin dashboard:** https://meetingguard-ai-app.web.app/admin/ (sign in with an admin
  account: snowleo1342@gmail.com or fmaldonadoharo@gmail.com).
- **Delete-account page:** https://meetingguard-ai-app.web.app/delete-account

## 1. Setup (once, about 20 minutes)

1. **LDPlayer instance:** use a fresh or clean instance for testing, never the personal
   instances that hold 2FA or Telegram. In LDPlayer settings set a phone-like screen:
   - Resolution: Customize, 1080 x 2340, DPI 450 (common Samsung-class phone), or
     720 x 1600, DPI 320 to represent a budget phone. Test at least once on each.
   - LDPlayer 9 runs Android 9, so some newer-Android prompts never appear (see 1.1).
2. **adb:** enable "Local connection" under LDPlayer settings -> Others -> ADB debugging,
   then in PowerShell:

   ```powershell
   $env:Path += ";$env:LOCALAPPDATA\Android\Sdk\platform-tools"
   adb connect 127.0.0.1:5555
   adb devices          # should list 127.0.0.1:5555 as "device"
   ```

3. **Install the APK:** drag the APK onto the LDPlayer window, or:

   ```powershell
   adb install -r "D:\WorkSpace\MeetingGuard_2025.7.28\deliver\MeetingGuardAI-1.4.0-test.apk"
   ```

   `-r` keeps app data when you install a newer test APK. If an APK signed with another key
   is installed, first `adb uninstall com.meetingguard.ai`.
4. **Accounts:** Google account A (a test user on the OAuth consent screen, added to the
   emulator under Settings -> Accounts) and Google account B as a meeting participant (any
   mailbox you can open on the PC is enough, B does not need the app).
5. **Spanish voice** for the MAX alert readout: Settings -> Language & input ->
   Text-to-speech output -> Google engine -> install Spanish (Spain) voice data. Sound plays
   through the PC speakers, so unmute Windows and the LDPlayer volume.
6. **Firebase console open** in a browser tab (Authentication + Firestore), to verify what
   the server stores.

### 1.1 Android 9 differences (not bugs)

LDPlayer 9 is Android 9, so compared to the TESTING.md tables written for Android 12-15:

- No notification permission prompt (Android 13+ only): notifications are allowed by default.
- No "Alarms & reminders" exact-alarm screen (Android 12+ only): the onboarding alerts step
  simply skips that button or it does nothing. Exact alarms always work on Android 9.
- Full-screen alarms open without a special permission (Android 14 restricts this, 9 does not).
- No vibration motor and no battery-killer vendor software: vibration and aggressive
  background killing need a real phone later (Francisco's device feedback covers this).

If any of these behave differently than described in a TESTING.md row, note it but do not
count it as a failure unless the app crashes or an alert is missed.

## 2. Out of scope today (do not test, nothing is wrong)

| Area | Why blocked | Unblocks when |
|---|---|---|
| T12 upgrade from v1.0.9 | Needs builds signed with the Google Play key, on a real phone | Play internal testing build |
| T13 performance | Emulator speed says nothing about a budget phone | Real low-end phone |
| T15 Outlook sync | No Azure app registration; the Outlook card is hidden by design | Azure setup (SETUP §10) |
| T17 purchases | No Play products or RevenueCat key yet; paid cards show but buying is off | Store runway after Francisco confirms prices |
| T20 iOS / Apple sign-in | No iOS build; Apple button is iOS-only | iOS runway (SETUP §8) |
| T21 WhatsApp bot | Deployed dormant; waiting for Francisco's Meta values | Meta credentials |
| Real vibration, battery killers | Emulator limitation | Real phone |

Everything else in the app is fully testable right now.

## 3. The pass

Work through the sessions in order; each is roughly 1 to 2 hours. Tick each line and record
failures per section 4. Session 1 must be first (it creates the accounts); the rest can be
reordered.

### Session 1: First run, sign-in, onboarding, legal (T1, T2, T19)

1. Fresh install, open the app. Expect: slim Landing in the system language, title-only
   value rows, "Continue with Google", "Continue with email", free-plan line, Terms and
   Privacy links.
2. **Legal texts (new in this build):** open Terms and Privacy from Landing, in English and
   in Spanish (switch the emulator language or check again later from Settings). Expect:
   AETERNUM TECH LTD with Company No. 14085985 and the City Road address in the first
   sections, support@meetingguard.ai as a tappable contact, "England and Wales" in the
   governing-law section, "Last updated" date shown, no "[PLACEHOLDER]" text anywhere.
3. Google sign-in with account A: picker opens, onboarding starts, user appears in Firebase
   Authentication and `users/{uid}` in Firestore. Cancel-the-picker and airplane-mode cases
   per T1 rows 3 and 4.
4. Onboarding (T2): language step switches the UI instantly; calendar step connects Google
   Calendar (consent screen) or can be skipped; alerts step sets intensity, sound and times;
   killing the app mid-onboarding resumes onboarding; the guided first meeting lands on the
   Dashboard.
5. Sign out, then **email sign-up** (T19) with a mailbox you can read: create account,
   verification email arrives, the app gates you until verified ("resend" works), after
   tapping the link the gate lifts without reinstalling and the AI works immediately.
6. Sign out and back in with each account: meetings return from the server, onboarding does
   not repeat.
7. Offline sign-out warning (T1 row 6): airplane mode, create a meeting, sign out. Expect an
   unsynced-changes warning with "Sign out anyway"; cancel keeps everything.

### Session 2: Meetings, AI assistant, sync, Zoom (T3, T4, T8, T9, T18)

Tip: the free plan allows 5 AI requests per day. Before heavy AI testing, open the admin
dashboard and grant account A the premium plan (500 per day). That is itself a test (see
Session 4, do it from there or just do the grant now and verify the banner later).

1. **Manual meetings (T3):** create with title, date, time, duration, location, participants
   (account B's email), notes; edit each field; delete. Everything shows correctly on the
   Dashboard and in the calendar views; Firestore mirrors it.
2. **AI chat (T3):** create via chat in English and Spanish ("tomorrow 3pm meeting with Ana
   about the budget"). Expect a confirmation card before anything is saved, correct parsed
   fields, quota counter visible, polite refusal past the daily limit. Edit and delete via
   chat too ("move my 3pm to 5pm", "cancel the budget meeting"). Check no AI answer ever
   contains em dashes or curly quotes (product rule).
3. **Recurring meetings (T3):** create a daily and a weekly series (manual and via AI), edit
   one occurrence, edit "this and following", delete the series. Expect the series to behave
   per choice and Google Calendar (next step) to mirror the rule.
4. **Offline (T4):** airplane mode, create and edit meetings, reopen the app, go online.
   Expect queued changes to sync, the unsynced counter to drop to zero, nothing lost.
5. **Google Calendar sync (T8):** meetings created in the app appear in
   calendar.google.com (account A) within a minute; a meeting created in Google Calendar
   appears in the app; edits both ways converge; deleting in one deletes in the other.
6. **Zoom (T18):** create a meeting with video call on, provider Zoom, with account B as
   participant. Expect a real zoom.us join link in the app; the Google Calendar event
   description contains the Join line and passcode; **account B's invitation email contains
   the Zoom link**; the link opens a valid Zoom meeting page; deleting the meeting deletes
   the Zoom meeting (link dies). Repeat once in Spanish: the join block says "Unirse" and
   "Código de acceso". Daily cap is 30 Zoom meetings per user.
7. **Phone calendars (T9):** import from the emulator's local calendar and export to it.
8. **Deep link:** `adb shell am start -a android.intent.action.VIEW -d "meetingguardai://meeting/<meetingId>" com.meetingguard.ai`
   (ids in Firestore under `users/{uid}/meetings`) opens that meeting.

### Session 3: Alerts, alarms, widget, language, deletion (T5, T6, T7, T10, T14, T16, T11)

1. **Alert matrix (T5):** create near-future meetings (2 to 3 minutes out) and verify alerts
   fire with the app in foreground, in background, and killed (swiped away from Recents;
   never use Force stop, Android cancels alarms of force-stopped apps by design). Run MAX
   (full screen + sound + voice readout), MEDIUM and LIGHT. Check both configured alert
   times fire (for example 15 min before and at start).
2. **Full-screen alarm (T14):** MAX intensity with the app killed and the screen locked.
   Expect a full-screen alarm over the lock screen with meeting details, snooze and dismiss
   buttons, sound and the spoken readout (Spanish voice when the app is in Spanish).
3. **Snooze (T6):** snooze from the notification and from the full-screen alarm; the alert
   returns after the snooze interval.
4. **Follow-up (T7):** after a meeting's end time, the follow-up notification appears and
   its actions work.
5. **Doze check:** `adb shell dumpsys battery unplug` then
   `adb shell dumpsys deviceidle force-idle`, with a meeting a few minutes out. The alert
   must still fire on time. Reset with `deviceidle unforce` and `battery reset`.
6. **Reboot:** `adb reboot` with a meeting 5 minutes out. After boot (do not open the app),
   the alert still fires.
7. **Widget (T16):** add the MeetingGuard widget to the home screen. It shows the next
   meeting, updates when meetings change, tapping opens the meeting, and it shows a sensible
   empty state with no meetings.
8. **Language (T10):** switch EN to ES in Settings. Expect every screen, notification text,
   date format and the AI to follow; no mixed-language screens; switch back.
9. **Account deletion (T11):** with a throwaway account (second email sign-up), delete the
   account in Settings. Expect re-authentication, a clear warning, then sign-out; the user
   and their data disappear from Firebase Authentication and Firestore. Also open the public
   delete-account page (link above) and check both languages show support@meetingguard.ai.

### Session 4: Plans, quota, admin dashboard (T17 partial, ADMIN.md)

1. **Pricing screen:** open Plans in the app. Expect all four paid cards (Pro and Premium,
   monthly and yearly) with prices and features; since billing is not configured yet, no
   purchase goes through, and that is correct today.
2. **Admin grant pipeline:** in the admin dashboard, find account A and set plan Premium.
   Expect within a minute, with the app open: a plan-change toast in the app, the quota line
   becomes "x of 500", and the Plans screen shows the granted-plan banner instead of
   purchase buttons for the active plan.
3. **Quota enforcement:** set the plan back to Free; the limit drops to 5; the 6th AI
   request of the day is refused politely (counts already used that day still count).
4. **Admin dashboard itself:** sign in at /admin with the admin account; non-admin accounts
   must be rejected. Check: user list and search, plan set and revoke, the metrics charts
   render with real numbers (requests, users, estimated cost), Reconcile button is present
   (it reports "not configured" until RevenueCat is live, which is correct), and no text
   anywhere with em dashes or curly quotes.
5. **AI key management:** the Settings tab shows the key status. Rotation needs the two IAM
   grants (commands shown on that page); if you have not run them yet, "rotate" failing is
   expected, note it and move on.

## 4. Recording results

For every test note: pass or fail, the session/step number, emulator resolution and DPI, app
version from the bottom of Settings, and the time of each alert you measured. Screenshot
every failure plus `adb logcat -s ReactNativeJS` output around the moment it happened.

Bug note template:

```
[S2-6 Zoom] FAIL
Emulator: LDPlayer 1080x2340 dpi450, app 1.4.0
Steps: created meeting with Zoom + participant B
Expected: B's email contains the Zoom link
Actual: email has no link (screenshot 03.png)
Logcat: attached
```

Send me the notes in any form; I will fix and rebuild the APK (`npm run apk:test`, about
6 minutes per build).

## 5. Map to the master plan

| Here | TESTING.md |
|---|---|
| Session 1 | T1, T2, T19 |
| Session 2 | T3, T4, T8, T9, T18 |
| Session 3 | T5, T6, T7, T10, T11, T14, T16 |
| Session 4 | T17 (UI and grant pipeline only), docs/ADMIN.md checks |
| Out of scope | T12, T13, T15, T17 purchases, T20, T21 |
