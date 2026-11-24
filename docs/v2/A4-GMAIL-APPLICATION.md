# A4: Gmail for the assistant, prepared for the later phase

Status: prepared in A4, not built. The plan of November 10 leaves sending from Gmail and watching Gmail threads for a later phase. This note is so that phase starts ready. Until then, Gmail users use the assistant's own address, which works for everyone from day one.

## 1. What the later phase would add

1. **Send from the user's Gmail**, when they allow it for a matter, exactly as A4 does for Microsoft: the same send check, hash, caps and approval.
2. **Read the replies there**, only in the threads of the user's matters.
3. **"Watch this thread"** on a Gmail conversation the user picks, with draft replies as approval cards.

## 2. The Google permissions it needs

| Need | Gmail scope | Google's class | What it means for us |
|---|---|---|---|
| Send from the user's Gmail | `https://www.googleapis.com/auth/gmail.send` | Sensitive | Google's OAuth verification (brand, privacy policy, demo video). No yearly security assessment. |
| Read replies and watch threads | `https://www.googleapis.com/auth/gmail.readonly` | Restricted | Google's verification **and** an independent security assessment (CASA) by a Google-approved assessor, repeated at least every 12 months. The assessor's fee is paid every year. |

Google asks for the narrowest scope that does the job. `gmail.readonly` is the narrowest that can read a thread; `gmail.modify` and full mail access are not needed. Sending alone could start with `gmail.send` only; replies would then keep arriving at the assistant's address (it is in Reply-To), which already works.

**Suggested order:** first `gmail.send` alone (no assessment, faster), then `gmail.readonly` when the client wants reading and watched threads in Gmail.

## 3. What Google will ask for, and what we prepare

| Google asks for | Who | Ready in A4 |
|---|---|---|
| A verified domain and the app's home page (meetingguard.ai) | Already done | Yes |
| A privacy policy that names the Gmail data, why it is used, and that it is not used for ads or sold | We write it in A9 with the other assistant texts | Wording below |
| The OAuth consent screen in the Google Cloud project, owned by Aeternum Tech | Francisco, as the project owner | Steps below |
| A justification for each scope | We write it | Text below |
| A demo video of the real app: connecting Gmail, the consent screen, and each scope in use | We record it once the connection works | Script below |
| For `gmail.readonly`: the CASA assessment, and a fix of anything it finds | An approved assessor, paid by Aeternum Tech | Not before the code exists |

Google reviews usually take two to six weeks after submission; the assessment adds its own time.

## 4. Text for the application

**Justification for `gmail.send`:**
"Meeting Guard AI's executive assistant writes emails for a matter the user hands it (for example, asking a contact for a proposal and setting up a meeting). By default it sends from its own address. When the user allows it for one matter, it sends that matter's emails from the user's Gmail, so the contact sees the user's own address. It sends only to the contacts the user confirmed for that matter, only emails the user confirmed or approved, and every email says it was written by an AI assistant for the user. It never reads, lists or deletes mail with this scope."

**Justification for `gmail.readonly`:**
"When a matter sends from the user's Gmail, the contact's reply arrives in that Gmail thread. The assistant reads only the threads of the user's matters, and threads the user picks with 'watch this thread', to draft a reply the user approves. It never lists the inbox, never reads other threads, and keeps the text of those emails only while the matter is open and for the retention period the privacy policy states (90 days by default), then deletes it."

**Privacy policy wording (draft for A9):**
"If you connect your Gmail to the assistant, Meeting Guard AI uses it only to send the emails of the matters you allow, and to read the replies in those threads and in threads you choose to watch. We do not read any other email, we do not use Gmail data for advertising, we do not sell it, and people at Meeting Guard AI do not read it except with your permission, for security, or where the law requires. You can disconnect Gmail at any time in the assistant's settings; we then delete the access at once. Meeting Guard AI's use of information received from Google APIs follows the Google API Services User Data Policy, including the Limited Use requirements."

## 5. Demo video script (for Google)

1. Sign in to Meeting Guard AI on a phone.
2. Open the assistant's settings and tap "Connect your Gmail". Show Google's consent screen with the scope(s) requested.
3. Create a matter, choose "send from my Gmail", read the mandate back and confirm it.
4. Show the email arriving at the contact from the user's Gmail address, with the AI line.
5. (`gmail.readonly`) Reply as the contact; show the assistant reading only that thread and the draft reply as an approval card.
6. Disconnect Gmail in settings and show that the access is gone.

## 6. Steps for Francisco (as the Google Cloud project owner)

1. In Google Cloud Console, project of Meeting Guard AI: OAuth consent screen, publishing status "In production", user type "External".
2. Add the scope(s) above under "Data access".
3. Fill in the justification text (part 4) and the demo video link.
4. Submit for verification and answer Google's questions (we draft the answers).
5. For `gmail.readonly` only: Google names the assessment tier; choose an approved assessor, confirm the fee with us first, run the assessment, and resubmit.

## 7. Cost and time, before anyone decides

- Building the Gmail connection: a separate quote, after A4's Microsoft mailbox works (the server side is shared).
- `gmail.send` only: Google's review, no fee.
- `gmail.readonly`: the yearly assessment fee, paid to the assessor (typically a few hundred to low thousands of US dollars), plus the review time.

Sources: Google's restricted scope verification page (developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification), Google Cloud help "Security Assessment" (support.google.com/cloud/answer/13465431), and the Gmail API scopes reference (developers.google.com/workspace/gmail/api/auth/scopes). Check them again before submitting: Google changes these rules from time to time.
