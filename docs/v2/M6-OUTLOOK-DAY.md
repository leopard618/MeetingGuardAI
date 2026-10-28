# Milestone 6, Outlook: the delivery day runbook

Goal: finish M6 (Outlook calendar, two-way sync, due November 10, 2026) on the day Francisco sends
the Microsoft account login. The code is done and tested (series push included, CHANGELOG 1.6.0);
the day is configuration, a real-account test, the recording and the delivery note. Plan on one
working day. The 24 hour soak from the deliverable text starts that day and is reported the next
morning; say so in the delivery note.

Secrets: the Microsoft login goes in the password manager, never in chat logs or this repo. The
Application (client) ID is a public identifier and may be committed in docs and the bundle.

Status, October 28, 2026: Francisco registered the app himself under his own Microsoft account and
sent the Application (client) ID: `d6517b23-5dd5-49eb-995a-ed369474a9ae`. Section 1 is therefore
done on his side (ask for the API permissions screenshot if it has not arrived). The ID is in the
local `.env` and in all three EAS environments (section 2 done). Tenant stays empty (common).

## 1. Azure app registration (15 minutes)

Sign in at <https://portal.azure.com> with the account Francisco sent. Skip any offer to start an
Azure subscription. Then open the app registrations page directly:

<https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade>

New registration, exact values (full detail in `docs/v1/SETUP.md` section 10):

| Field | Value |
|---|---|
| Name | MeetingGuard AI |
| Supported account types | Accounts in any organizational directory and personal Microsoft accounts |
| Redirect URI platform | Mobile and desktop applications (public client, not Web) |
| Redirect URI | meetingguardai://auth/microsoft |

After Register: copy the Application (client) ID from Overview. Then API permissions -> Add a
permission -> Microsoft Graph -> Delegated: Calendars.ReadWrite, Tasks.ReadWrite (for M7),
offline_access, openid, profile. User.Read is there already. No admin consent, no client secret.

If the portal asks to create a directory first (a brand new personal account sometimes does),
accept the default directory it proposes and continue.

## 2. Wire the client id (10 minutes)

Local `.env`, add the two lines (tenant stays empty = common):

```bash
EXPO_PUBLIC_MSAL_CLIENT_ID=<the GUID>
EXPO_PUBLIC_MSAL_TENANT=
```

EAS environments for cloud builds (one line, all three environments):

```bash
eas env:set --name EXPO_PUBLIC_MSAL_CLIENT_ID --value "<the GUID>" --environment development --environment preview --environment production --visibility plaintext
```

Check: `eas env:list --environment production | grep MSAL`.

## 3. Build (20 minutes, unattended)

```bash
npm run apk:test
```

The script stamps a new file name under `deliver/` and prints the SHA-256. Install on the phone
and on LDPlayer (`adb install -r <file>`). The Calendar sync screen now shows the Outlook card.

## 4. Real-account test (60 to 90 minutes)

Run `docs/v1/TESTING.md` T15 in order, rows 2 to 11, with Outlook web open in a browser
(<https://outlook.live.com/calendar> for a personal account). Rows 8 to 8d are the series rows added
for M6. Note the phone clock time per row. Anything that fails: fix, rebuild, rerun that row.

Also exercise the two items from the deliverable text that T15 does not spell out:

- Conflict rule: edit the same meeting's title in the app and in Outlook within a minute; the
  most recent edit wins and the loser is kept as a note on the meeting.
- Token expiry and re-consent: on the Microsoft account security page sign out of all sessions,
  then Sync now in the app; the card asks to connect again, and Connect recovers without duplicates.

## 5. Recording (30 minutes)

Screen record the phone, Outlook web visible on the laptop in the same frame or in a second
recording. Lines to show, in this order:

| # | Agreement line | What the recording shows |
|---|---|---|
| 1 | Microsoft sign-in | Connect on the Outlook card; the Microsoft page; back in the app with the account email and Connected. |
| 2 | Outlook meetings arrive | The account's existing events listed as meetings with the Outlook badge. |
| 3 | App meeting appears in Outlook | Create a meeting by voice; refresh Outlook web; it is there with the right time. |
| 4 | Outlook edit appears in the app | Move that event one hour in Outlook web; pull to refresh; the meeting moved. |
| 5 | Alarms follow | Open the meeting; its alert times show the new hour. |
| 6 | Repeating meeting | A weekly meeting, 3 occurrences; Outlook web shows the series. Cancel one occurrence in the app; it disappears in Outlook. |
| 7 | Cancellation from Outlook | Delete a one-off in Outlook web; refresh; it is gone in the app, alert included. |
| 8 | No duplicates | Sync now three times; the meetings list and Outlook web show each meeting once. |
| 9 | Spanish | Switch the app to Spanish; the Outlook card and a sync toast read naturally. |
| 10 | Disconnect | Disconnect; Outlook-imported meetings leave, app-created ones stay. |

Soak: leave the phone and LDPlayer connected to the same account overnight with two or three
meetings each; next morning screenshot both meeting lists and Outlook web (no duplicates, no
loops) and send it as the last piece of evidence.

## 6. Delivery (15 minutes)

1. Commit: `.env` is ignored; commit the docs touched during the day and the CHANGELOG entry
   if it changed. Push `v2`.
2. Send Francisco, in the group: the recording, the table above with pass marks and times, the
   APK name and SHA-256, and one line that the soak result follows next morning.
3. Hand back the Microsoft account: tell Francisco the setup is done and he can change the
   password whenever he likes; the registration stays in the account.
4. Payment 6 is due on acceptance per the consolidated schedule.

Message skeleton (ASCII only, short):

```
Hi Francisco, milestone 6 is ready: Outlook two-way sync. Recording and checklist attached,
test build <file name>. Everything in the list passed on a phone and on the emulator against
the Microsoft account you sent. The 24 hour no-duplicates check runs overnight, I send the
screenshots tomorrow morning. You can change that Microsoft password any time now; the app
registration stays inside the account.
```
