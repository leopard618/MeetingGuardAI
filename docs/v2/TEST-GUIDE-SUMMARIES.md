# Device test guide: meeting summaries (M10), suggested tasks (M11), HTML descriptions

The device pass for the production summaries setup: private addresses `{token}@summaries.meetingguard.ai`
(MX to Postmark), Fathom accepted as a notetaker (`no-reply@fathom.video`), the suggested tasks in
the app and on WhatsApp, and the HTML calendar description fix (PR #13). The language pass is
TEST-GUIDE-M12.md; Part K below lists the short version for this build.

Test build: the newest `MeetingGuardAI-1.6.0-test-<yyyymmdd-hhmm>.apk` in the deliver folder, built
from v2 at 9c53b92 (M10, M11, M12 and the HTML fix). Server: everything deployed on Nov 16 2026
(summary functions, assistant, WhatsApp webhook, Firestore rules, hosting).

For every step write down: step id, pass or fail, the phone clock time. On a fail take a screenshot
and note the time to the minute: the server logs are found by time.

Account: summaries are on for the accounts in SUMMARIES_PILOT_UIDS only (today: one account).
Test with that account. Any other account sees "Meeting summaries are not available for your
account yet." (that is the expected result for B0).

## Part A. Preparation (30 minutes)

A1. Install the APK (uninstall an older test build first if Android refuses the install). Sign in
with the pilot account. Allow notifications, microphone, exact alarms; turn off battery
optimization when asked.

A2. Settings > Calendar sync: Google Calendar connected. Settings > WhatsApp: the test number
linked (send "hi" once to check it answers).

A3. Fathom, free plan, on a computer: sign up at https://fathom.video with the SAME Google account
whose Gmail you will list as your mailbox. During setup, connect Google Calendar (so the recap
carries the calendar event title) and allow it to join Google Meet calls.

A4. Note the AI actions left (Plans screen). Parts F and G use 2 to 3 AI actions.

A5. A second mail account that is NOT your listed mailbox (any Outlook.com or other Gmail), for
the refused test (Part E).

## Part B. The private address and setup screen

B0. (Optional, second account) Sign in with a non-pilot account, Settings > Meeting summaries.
Expect: "Not available yet". Sign back in with the pilot account.

B1. Settings > Meeting summaries. If no address exists: "Create my private address". Expect: the
address ends in `@summaries.meetingguard.ai` and its first part is a long random code. If an
address existed before the switch, expect the SAME code with the new ending (no new address).

B2. Copy and Share. Expect: "Address copied"; the share sheet text is "My Meeting Guard AI
address for meeting summaries: ...". Do not send it to anyone.

B3. "Where your summaries arrive": Add a mailbox. Try, in order:
- `abc` -> "Enter one email address, like name@company.com."
- your private address -> "Your private address cannot be one of your mailboxes..."
- your Gmail -> added; then the same Gmail again -> "This mailbox is already on the list."
Press Save -> "Mailboxes saved". Leave the screen and come back: the mailbox is still there.

B4. "Notetakers that file by themselves". Expect: `Fathom: no-reply@fathom.video` with a Copy
button. Copy works ("Copied").

B5. "Set up forwarding": the three tabs Gmail, Outlook and Microsoft 365, Other show their steps;
the open buttons open the right web pages. "Steps for your administrator" > Share the steps: the
text contains your mailbox and your private address, and nothing else private.

B6. Activity: "Nothing received yet" / "Waiting for your first summary. This screen checks every
few seconds while it is open."

## Part C. Gmail forwarding with the confirmation code

C1. On a computer: Gmail > Settings > Forwarding and POP/IMAP > Add a forwarding address > paste
the private address > Next > Proceed.

C2. With the app open on the summaries setup screen. Expect within a minute: the box "Gmail
confirmation code" with "Gmail asked to confirm forwarding from <your Gmail>", the code, and
Copy code. Copy it, paste it in Gmail, press Verify. Gmail shows the address as verified.

C3. Leave "Forward a copy of incoming mail" OFF. Gmail > Filters and Blocked Addresses > Create a
new filter > From: `no-reply@fathom.video` > Create filter > Forward it to: the private address >
Create filter.

C4. Dismiss the code box in the app. Expect: it disappears and does not come back.

## Part D. A real Fathom recap, filed by itself (the main test)

D1. In Google Calendar create an event in 10 minutes, 15 minutes long, title
`MG Test Budget Review`, with a Google Meet link. In the app, pull to refresh: the meeting is
there.

D2. Join the Meet on the computer at the start time. Let Fathom join and record. Speak for about
2 minutes, clearly, for example:
"Ana will send the revised budget by Friday. I will send Luis the signed contract next Tuesday.
We agreed to review the hiring plan next month. Someone needs to book the venue."
End the call.

D3. Wait for the Fathom recap email in Gmail (usually 2 to 10 minutes). Expect within a minute
after it arrives in Gmail, in the app:
- the meeting's details show the "Notetaker summary" section;
- Settings > Meeting summaries > Open the summary inbox > "Filed recently": "Filed under MG Test
  Budget Review";
- the summary: "Filed under MG Test Budget Review, <time>. Matched automatically by title and
  time.", chip "From your notetaker", origin "Written by your notetaker (fathom.video), received
  <time>. Signature checked."
- the activity line: "Last summary received <time>".

D4. Read the summary screen top to bottom:
- "Your notetaker's own summary" with its note, then the sections (action items with owner and
  due where Fathom wrote them);
- Fathom's banner lines ("View Meeting", "Ask Fathom" and similar) are NOT shown as content;
- links appear as plain text ("Links are shown as plain text...");
- Copy text works; "Email details" shows the subject and from address;
- "This summary is kept until <date>" is about 12 months ahead.

D5. If D3 put the summary in the inbox instead ("Waiting for a meeting"), note the reason line it
shows (for example "One meeting looks right. Confirm it before the summary is filed." or "No
meeting matched its title and time closely enough."), and the exact recap subject. That is a
calibration finding, not a crash: report it with the time.

## Part E. Other ways in: by hand, refused, rotated

E1. By hand: in Gmail open any email (the Fathom recap is best), Forward, to the private address,
Send. Expect: in the inbox under "Waiting for a meeting", chip "Forwarded", reason "You forwarded
it by hand. Choose the meeting it belongs to.", origin "Forwarded from <your Gmail>...".

E2. On that item: Choose a meeting > the day pager (Previous day / Next day / Day of the summary)
> pick a meeting > File here. Expect: "Filed under <title>"; the meeting's details now show it.

E3. On the filed summary: Not this meeting > Back to the inbox. Expect: "Moved back to your
summary inbox"; that meeting is no longer offered as the suggestion for it. Then Keep without a
meeting: it moves to "Kept without a meeting". Then Move: file it under another meeting.

E4. Refused: from the second account (A5) send a plain email to the private address. Expect
within a minute: nothing in the inbox; Activity shows "Last refused <time>: ..." and "1 email
refused today"; in the inbox, Show refused lists "1 refused on <day>" with "Not from your
notetaker". No content of that email is shown anywhere.

E5. Delete: on the E1 summary, Delete > Delete. Expect: "Summary deleted"; it is gone from the
inbox and from the meeting.

E6. New address: Get a new address > confirm. Expect: a new code, same ending; "Your new address
is ready. Update your forwarding rule." Send an email to the OLD address from your Gmail: nothing
arrives, not even as refused. Gmail forwarding needs the new address confirmed again (repeat C1 to
C3 with the new address, and remove the old forwarding address in Gmail).

## Part F. Suggested tasks from the summary (M11), in the app

Use the Fathom summary from Part D.

F1. Summary screen > Review commitments. Expect: "Turn this summary into tasks" with two choices,
"Show the action items as written" (free) and "Suggest tasks with AI" (1 AI action, the first time
only).

F2. As written: choose it. Expect: the action items exactly as Fathom wrote them, each with "From
the summary:" and its sentence; owner lines ("Owner in the summary: Ana" or "You? (the summary
says: <your name>)"); due lines ("Due <date> (the summary says: Friday)"). AI actions unchanged.

F3. On the cards: Edit one title and save ("Edited by you"); Drop one ("Dropped", then Show
dropped > Restore); leave one without a date and set "Reminder for items without a date" to
"Tomorrow at 9:00".

F4. Press "Add <n> selected". Expect: "Added <n> tasks. Their reminders are set on this phone."
(or the no-reminder variant); the entry on the summary reads "<n> added to your tasks"; each card
shows "In your tasks" and Open task. Open a task: the origin line reads "From your notetaker's summary of MG Test Budget
Review, <date>."; the due date and reminder are set. Undo on one card: "Removed from your tasks";
Add again brings it back once (no duplicate in Tasks).

F5. Switch: "Suggest tasks with AI". Expect, the first time on this account only: the notice
"Before Meeting Guard AI reads this summary" (text goes to OpenAI through our server) with
Continue. Continue: "Reading your notetaker's summary. This uses 1 AI action, the first time
only." Then cards marked "Written by AI from your notetaker's text. Check names, dates and meaning
before you add them." AI actions left: one less.

F6. Leave and open Review commitments again, switch to AI again. Expect: the same list, no new
charge (AI actions left unchanged), no notice again.

F7. Tasks already added in F4 show "Already added" and are not added twice.

## Part G. Suggested tasks on WhatsApp

G1. Send `commitments`. Expect: a numbered list for the newest summary with open items, each line
with its due and the quote "From the summary: ...", and the footer, for example "Reply ALL to add
the 2 marked, numbers to add only those (for example 1 3), DROP and numbers to remove some, or
NONE."

G2. Reply `1`. Expect: item 1 added; in the app the card shows "Added on WhatsApp" and the task is
in Tasks once.

G3. Reply `DROP 2`, then send `commitments` again: item 2 is shown as removed / not offered.

G4. Reply `9` (a number not in the list): "None of those numbers is in the list. Reply with
numbers from the list, for example 1 3."

G5. Reply `AI` when the footer offers it. Expect: the AI list (no new AI action if F5 already
prepared it: "Reply AI to see the tasks Meeting Guard AI already suggested...").

G6. Reply `NONE`: the list closes. Then a normal assistant message ("what do I have tomorrow")
still works.

## Part H. Disconnect and reconnect

H1. Setup screen > Disconnect > Keep them. Expect: "Disconnected. Your summaries are kept."; the
address is gone; the kept summaries and the tasks from them are still there.

H2. Create my private address again: a new code. Then Disconnect > Delete them > Disconnect and
delete. Expect: "Disconnected. Your summaries are deleted."; the inbox is empty; tasks added from
summaries stay in Tasks.

H3. Create the address again and update the Gmail forwarding (C1 to C3), so the account is ready
for more tests.

## Part I. HTML calendar descriptions (PR #13)

I1. Google Calendar on the web: create an event tomorrow with a formatted description: one bold
word, a bullet list of two items, and a link (Insert link) with the text "Check in". Sync in the
app. Expect in the meeting's details: plain readable lines, the bullets as "- item", the link as
"Check in (https://...)". No `<div>`, `<br>`, `&nbsp;` or `<html>` anywhere.

I2. Edit that meeting in the app (pencil): the description field shows the same plain text. Save
without changes: nothing breaks.

I3. Phone calendar: an event with an HTML description (an airline or booking confirmation added
to the phone calendar, like Francisco's flight). Expect the same: readable lines, links with their
address.

I4. A plain description that contains `<` (write "Budget < 5k" in a Google event): it stays
exactly as written.

## Part J. WhatsApp and summaries in Spanish (short)

Settings > Language > Español. Open the summaries setup and a summary: all texts Spanish (the
recap itself stays in its own language). WhatsApp: `compromisos` gives the list in Spanish. Back
to English.

## Part K. Languages (M12), short pass for this build

From TEST-GUIDE-M12.md Part B, in Português, Français and Deutsch: B1 (every screen), B2 (dates),
B3 (create by voice), B8 (agenda read aloud in the right voice), B11 (alert notification with the
app closed), B13 (summaries screens), B14 (WhatsApp list word), B16 (widget). Part C3 (Android 13+
per-app language list shows 5 languages). The full M12 pass needs the 1.7.0 builds.

## Part L. Regression smoke (15 minutes)

L1. Dashboard opens; weekly summary and the assistant banner show.
L2. A meeting in 3 minutes with alerts at 2 and 1 minutes, app closed: both alerts arrive; snooze
works; a MAX alert opens full screen.
L3. Assistant: "Schedule a call with Ana tomorrow at 3 pm" -> card -> confirm -> saved.
L4. Google Tasks: a task created in the app appears in Google Tasks.
L5. Running late on an upcoming meeting: the ready message has the new time.

## What to report

One line per step: id, pass/fail, time. For every fail: screenshot, time to the minute, what you
expected, what you saw. For D5 also the recap subject and the meeting title. Never paste the
private address, the Gmail code or the recap content in a group chat.
