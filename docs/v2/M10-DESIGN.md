# M10 design: summaries arrive by themselves

Status: design, November 11, 2026. Built from workflow wf_73d17e52-6fe (four code and research
readers, three competing designs, one synthesis checked against the code, one security red team).
The red team's 17 findings are folded in; section 15 lists each one and how it is handled.
Anything marked UNVERIFIED is a day-0 or day-1 check, not a fact.

## 0. What M10 must deliver

Contract (Project-Plan-2026-11-09.md, Consolidated-Schedule-2026-10-27): "A private forwarding
address for the summary your notetaker already writes; matched to the meeting by time and title;
unmatched ones wait in a summary inbox; checks that keep a fake summary out of your account; stored
for you only, encrypted, deletable."

Acceptance: "A real recap email forwarded in lands against the correct meeting; a forged one is
refused." Recorded on a real phone, like every milestone.

Not M10: turning the summary into commitments and tasks, WhatsApp, the connect and disconnect
screen with retention rules (all M11). M10 hands M11 clean, structured data (section 8).

Background (Oct 16 decision): Meeting Guard AI never joins, records or listens to a meeting. It
ingests the summary email the user's own notetaker already sends. Francisco's vendor is still
unknown. His specimen ("Urpayroll .docx", pasted into Word by him) shows a title line, then
"Meeting notes", a middle dot, "2026-10-16" (a date, no time), then TLDR, Updates, Decisions, Action items,
Waiting on, Open questions and a custom "Launch Readiness" section. Action items read
"[ ] Provide APK access/files to Urpayroll (owner: Bish)", with no due dates. Its TLDR contradicts
its speaker-attributed layer, so the TLDR is never ground truth.

## 1. Decisions

1. Provider: Postmark, the provider already priced to Francisco for the assistant
   (Assistant-Proposal-2026-11-09.md:133, :139). One account in Aeternum Tech's name with two
   Postmark servers: "Meeting Guard AI Summaries" (M10, receive only) and "Meeting Guard AI
   Assistant" (Sven's A1). Separate webhooks, tokens and subdomains; no shared code.
2. Address: `<26-character token>@summaries.meetingguard.ai`, a receive-only subdomain with one MX
   record. Before DNS exists, development uses Postmark's default inbound address with the token
   after a plus sign.
3. Authenticity is decided by our own DKIM check of the raw message (mailauth), never by the
   provider's verdicts and never by SPF.
4. Only one kind of email is filed automatically: a recap signed by an allowlisted notetaker
   sender, addressed (in a signed header) to one of the user's own mailboxes, fresh, and matched by
   title AND time. Everything genuine but weaker waits in the summary inbox. Everything else is
   refused and its content is not stored.
5. Changed from the synthesized design: a summary the user forwards by hand from his own mailbox
   ("U" tier) waits in the inbox with one-tap suggestions; it is never filed automatically and is
   labelled "Forwarded from <address>", not "by you". Reason: an Outlook "Forward to" rule re-sends
   any matching mail, a spoofed one included, as the user (red team finding 2), and DKIM proves the
   domain, not the person.
6. Storage: users/{uid}/meetingSummaries, server-only. Text, subject and addresses sealed with
   AES-256-GCM under a key in Secret Manager, bound to the uid and the document id. The app reads
   only through callables; nothing lands in AsyncStorage.
7. Ship dark: SUMMARIES_ENABLED plus a uid pilot list. The four summary functions can deploy during
   Apple's review because 1.6.0 never calls them. No rules deploy is needed for M10 to work (the
   catch-all at firestore.rules:456-459 already denies the new paths); the explicit deny blocks,
   the index, and the deleteAccount and dailyMaintenance changes deploy after Apple's decision.
8. Demo on a time-stamped Android test APK. No EAS Update to runtime 1.6.0 while iOS 1.6.0 (12) is
   in review. Francisco sees his own summaries on his iPhone after approval, through a JS update
   hidden behind the pilot list or the Stage 3 build; decided then.

## 2. Provider

Why Postmark:
- Already in the figure Francisco approved for the assistant (about USD 16.50 a month for 10,000
  emails, Pro). Complete-Plan-2026-11-10.md:151 promises one account for both projects.
- Pro lists inbound processing; Basic does not (pricing page, per the research map).
- Inbound arrives as JSON; with "Include raw email content in JSON payload" it carries RawEmail,
  the full RFC 822 bytes our DKIM check needs (partly verified through third-party docs).
- The default `<serverhash>@inbound.postmarkapp.com` address accepts plus-addressing and passes the
  part after "+" as MailboxHash, so work starts before anyone touches the meetingguard.ai DNS.

Weaknesses designed around:
- Postmark does not sign webhooks. Basic auth in the webhook URL, compared timing-safe (the
  revenuecatWebhook model, functions/src/revenuecat/index.ts:265-271). A leaked webhook secret
  still cannot plant a vendor-signed recap, because authenticity rests on DKIM.
- Retries: answer 200 for every deliberate outcome, refusals included; 500 only for a Firestore
  failure or a fresh DNS temperror (section 4).
- Keep Postmark inbound spam blocking off on the Summaries server (setting UNVERIFIED).

Cost (https://postmarkapp.com/pricing, checked 2026-11-11): the free Developer plan has no inbound
processing and Basic (USD 15) does not list it either, so the account needs Pro from the first day:
USD 16.50 a month for 10,000 emails, USD 1.30 per extra 1,000. A processed inbound message counts
as one email, and so does each Cc or Bcc address. Pro allows 10 servers, 6 users and 10 domains.
This is the approved assistant cost, shared by both projects; Francisco delegated the choice on
Nov 11 ("decide which is the best price option and propose it so I can agree"), so the proposal goes
to him before the plan is upgraded.

Fallbacks (the handler takes a provider-neutral InboundEnvelope {provider, providerEventId,
rawMime, envelopeRecipient, receivedAt}, so a switch is one adapter file):
- Resend, only if Sven insists for A1: the webhook carries metadata, the raw message is a second
  download (about +1 day).
- Mailgun Free: one inbound route, multipart form posts (about +1 day).
- Not this week: SendGrid (free plan retired 2025-05-28), Amazon SES (no direct webhook), Cloudflare
  Email Routing (needs the meetingguard.ai nameservers moved and rejects DMARC failures first).

Day-0 checks, in Postmark's activity view and our logs (2 hours):
1. Resolved 2026-11-11: the Developer plan has no inbound, so the checks run on Pro.
2. RawEmail is present and byte-exact for an 8-bit message.
3. OriginalRecipient is the envelope recipient after a Gmail filter forward.
4. MailboxHash works on the default address.
5. The payload size of a real recap.
6. What happens at the monthly limit; whether usage alerts exist; whether inbound rules can block
   senders (quota burn, red team finding 3).
7. Whether team members can be limited to one server (finding 4). The pricing page lists "User
   Roles" without saying, and the team-roles help article answers 404, so check it when inviting
   Sven. If not, Sven stays off the account and uses only the Assistant server's token, which the
   owner gives him.
8. Partly resolved 2026-11-11: activity history defaults to 45 days. The retention add-on (Pro and
   up, from about USD 5 a month) sets 7 to 365 days for the whole account, every server included;
   below 45 days Postmark removes expired data within 24 hours. So [N] in section 14 is 45 unless
   Francisco approves the add-on; still check that inbound content follows the same setting.

## 3. Address

- Token: `randomBytes(16)` encoded as lowercase RFC 4648 base32 without padding, 26 characters of
  [a-z2-7]. Lowercase because forwarders may case-fold local parts. Never derived from the uid, the
  email or the time; never the 6-digit WhatsApp link code.
- Rendered from SUMMARIES_ADDRESS_TEMPLATE containing `{token}`: production
  `{token}@summaries.meetingguard.ai`; development `<serverhash>+{token}@inbound.postmarkapp.com`;
  empty means "being set up". Francisco gets his address only after the MX record is live, because
  a changed address means redoing the Gmail confirmation.
- Storage (server-only):
  - `summaryAddresses/{tokenHash}` = {uid, createdAt}, tokenHash = sha256 hex of
    `mg-summary-address:v1:` + token (the hashLinkCode shape, functions/src/whatsapp/signature.ts:65-68).
  - `summaryUsers/{uid}` = {token, tokenHash, address, createdAt, rotationDay, rotationsToday,
    mailboxes[] (max 5, lowercased), gmailRequests[] (max 3), refusedDay, refusedCount,
    lastReceivedAt, lastRefused, updatedAt}. The plain token is kept so the user can re-read the
    address; it is never logged and never client-readable.
- Routing uses ONLY the envelope recipient (OriginalRecipient, else MailboxHash). Header addresses
  (To, Cc, Delivered-To) never route mail to an account (finding 15).
- Create (callable op create_address): verified caller (requireVerified rule,
  functions/src/whatsapp/index.ts:96-103) and in the pilot list. One transaction in the mintCode
  shape (functions/src/whatsapp/link.ts:199-212); idempotent. Mailboxes start as the verified sign-in
  email.
- Regenerate (op regenerate_address, confirmed in the app): one transaction, at most 5 a UTC day;
  the old index doc is deleted, so mail to the old address is dropped from then on. Each rotation is
  logged to Cloud Logging as `summaries.address.rotated` {uid, old tok8}, so a database restore can
  be followed by re-rotating (finding 12).
- Mailboxes (op set_mailboxes): up to 5 addresses where the user's recaps arrive. Ownership is not
  proven: a listed mailbox only lets mail addressed to it into THIS user's account, so listing a
  stranger's address harms only the lister. A Gmail confirmation never adds a mailbox by itself.
- Disconnect (op disconnect {deleteSummaries}): deletes the index doc and replaces summaryUsers/{uid}
  with a counters-only tombstone {rotationDay, rotationsToday, updatedAt}, so disconnect followed by
  create still counts against the 5-a-day rotation cap (review finding, Nov 11); optionally deletes
  every summary. deleteAddressDocs takes a REQUIRED mode: 'disconnect' or 'account_deletion' (the
  second removes summaryUsers/{uid} entirely). Built in M10 because account deletion reuses it; the
  button can wait for M11's connect screen.
- Logs carry the uid, the first 8 hex characters of tokenHash, the verdict and the reason. Never an
  address, a token or a code.

## 4. Pipeline (summaryInbound)

New code: `functions/src/summaries/` with index.ts (shells, gate, exports), provider/postmark.ts,
inbound.ts (a pure handler over injected ports, the handleRevenueCatWebhook shape), address.ts,
mime.ts, authenticity.ts (runMailAuth plus a pure classify), sanitize.ts, sections.ts,
candidates.ts, match.ts, store.ts, callables.ts, read.ts. Plus `functions/src/shared/sealed.ts` and
verbatim copies of `src/core/errors.ts`, `time.ts` and `recurrence.ts` under the drift check.

New dependencies, pinned exact, loaded lazily inside summaryInbound only: mailauth 8.0.4 (MIT) and
postal-mime 4.1.4 (MIT-0, no dependencies). Day-1 spike (2026-11-11): both ship CommonJS builds and
types, and load under plain Node, tsc and Jest 29 without a stub; a message signed in the test with
dkimSign verifies, a changed body fails, postal-mime parses it. Both releases were at least two weeks
old when pinned (8.0.5, 8.0.6 and postal-mime 4.2.1 were a day old). mailauth 8.0.4 pins joi 18.3.0
(GHSA-4528-x5fx-h6hg, high, in `string().email({ multiple: true })`, which mailauth never calls), so
functions/package.json overrides joi to 18.3.1 for mailauth only. The remaining new audit entry is
fast-xml-parser (low), used only by the BIMI code we never load. Never `npm audit fix --omit=dev`.

Options: onRequest, FUNCTIONS_REGION, invoker "public" set explicitly
(functions/src/revenuecat/index.ts:352), secrets SUMMARIES_WEBHOOK_AUTH and SUMMARIES_DATA_KEY,
memory 1GiB, concurrency 2, maxInstances 3, timeout 60 s (finding 11). Gated like WhatsApp: exported
only when SUMMARIES_ENABLED is true at deploy time.

Steps, in order:
1. Switch off: 404. Not POST: 405.
2. Basic auth, timing-safe (timingSafeStringEqual imported from functions/src/whatsapp/signature.ts;
   the RevenueCat copy is not touched during review). Empty configured secret rejects. Failure: 401.
3. Body over 12 MiB: 200 ignored. Use the framework's parsed req.body; pick out only RawEmail,
   OriginalRecipient, MailboxHash and MessageID with zod. No RawEmail: 200 ignored, logged as a
   setup alarm.
4. Token from the envelope recipient only; summaryAddresses lookup; the uid must be in the pilot
   list, exist in Auth and not be disabled (finding 12). Otherwise 200 dropped, nothing stored.
5. Raw size over 5 MiB, more than 100 MIME parts or nesting deeper than 10: refused too_large or
   malformed.
6. Header sanity on the raw header block: exactly one From with one mailbox; at most one To, Cc,
   Date, Subject, Message-ID and Sender. From is parsed ONCE with one strict parser and must be a
   plain addr-spec: no comments, groups, route syntax, encoded words in the address or second "@"
   (finding 8). Failure: refused malformed.
7. mailauth over the raw bytes with a node:dns resolver (4 s timeout, 2 tries, cached per call).
   Alignment is computed by classify itself against the step-6 From domain, not taken from
   mailauth's status. A DNS temperror counts as deciding only for a signature whose d= is an
   allowlisted sender domain or a listed mailbox's domain; then 500 while the Date header is under
   5 hours old, after that a failure.
8. classify (pure; section 5) returns {outcome, tier, reason, anchor, trust facts}.
9. Refused: one row per uid and UTC day with a count (section 7). The refused counter is the only
   daily cap: 40 refusals a day, deduped by Postmark MessageID so a redelivery never counts twice;
   accepted and inbox mail is never capped by junk (finding 5). Over the cap: drop, and the app
   suggests a new address.
10. Gmail confirmation: stored in gmailRequests keyed by the requesting Gmail address (max 3, 2-day
    expiry, finding 14). We never fetch Google's link.
11. Accepted or inbox: messageKey = normalized Message-ID, else the deciding signature's b=, else
    sha256(raw). summaryId = sha256 hex of `mg-sum:v1:` + uid + `:` + messageKey.
12. sanitize and sections (section 8). Empty text: refused unreadable.
13. Dedupe (finding 10): the Message-ID and content-digest markers in summaryEvents are claimed only
    by auto-filed vendor recaps and by user forwards. A lower-trust inbox copy never blocks a
    higher-trust one: when a better copy arrives with the same digest or Message-ID, the existing
    document is upgraded in place (tier, trust facts, match) instead of dropping the new one.
14. Match (section 6) when the outcome allows it; otherwise inbox with the reason.
15. Seal and commit in ONE transaction: re-read summaryAddresses (dropped if it no longer maps to the
    uid), require users/{uid} to exist, claim the markers, create the summary, update
    summaryUsers.lastReceivedAt. ALREADY_EXISTS means duplicate.
16. Log `summaries.inbound` {uid, tok8, verdict, reason, tier, matched, ms}. Never subject, title,
    addresses, body or header text; failures log errorName only.

Callables (onCall, FUNCTIONS_REGION, verified caller plus pilot):
- summaryStatus (always deployed, no secret): {enabled, allowed, ready, address, mailboxes,
  gmailRequests, inboxCount, lastReceivedAt, lastRefused}.
- summaryAction (always deployed, no secret): create_address, regenerate_address, set_mailboxes,
  dismiss_gmail, attach {summaryId, meetingId, occurrenceDate}, detach, keep, delete, disconnect.
  attach validates the meeting exists, is not a tombstone, belongs to the caller, and for a series
  that occurrenceDate is a real occurrence.
- summaryRead (gated, binds SUMMARIES_DATA_KEY, 30 s, 512MiB): list {inbox | recent | refused |
  meeting} decrypting titles only, after re-matching up to 10 recent unmatched inbox items (the
  phone may import the meeting after the recap arrives); get {summaryId} for the full view.

Contract: new CALLABLES entries, request and response schemas and SUMMARY_ERROR_CODES in
src/core/aiContract.ts, copied verbatim to functions/src/shared. Additive, so AI_CONTRACT_VERSION
stays. check-contract.mjs and functions/test/unit/contract.test.ts grow from one file pair to four.

## 5. Authenticity

Definitions:
- passSig: a DKIM signature with result pass, aligned with the From domain (d= equal, or one a
  subdomain of the other), "from" in its signed headers, no l= body-length limit, not rsa-sha1, key
  of at least 1024 bits, not a t=y testing key.
- V (vendor): a passSig and the From address is in SUMMARIES_SENDERS, a comma list of exact
  notetaker sender addresses (not bare domains, finding 6), compared as lowercased IDNA ASCII.
  Ships EMPTY; filled from calibration.
- B (bound to the user): a listed mailbox (or the verified account email) appears as an addr-spec
  in To and "to" is in the deciding signature's signed headers, or in Cc and "cc" is signed. A
  mailbox found in an unsigned header never counts; display names are never read (finding 1).
- U (user forward): From is exactly one of the user's mailboxes, with a passSig for its domain.
- G (Gmail confirmation): From is exactly forwarding-noreply@google.com with a passSig for google.com
  (confirmed on the first real one, UNVERIFIED).
- T (tampered): a signature by a SUMMARIES_SENDERS domain is present but fails, and there is no V.
- Fresh: the deciding passSig signs "date", and Date lies within 14 days before and 24 hours after
  receipt.

Trust facts stored immutably on every summary at receipt (finding 7): tier, recipientBound, fresh,
anchorSource, originalInboxReason. Filing, keeping or moving never clears them.

Decision table, evaluated in order; every email gets exactly one result:

| # | Condition | HTTP | Result |
|---|---|---|---|
| 0 | Switch off / not POST | 404 / 405 | nothing |
| 1 | Basic auth wrong or missing | 401 | nothing |
| 2 | Oversize body, unparsable JSON, no RawEmail | 200 | ignored |
| 3 | Unknown or regenerated token, user missing, disabled or not in pilot | 200 | dropped |
| 4 | Raw too large, too many parts, header sanity or strict From fails | 200 | refused too_large / malformed |
| 5 | Deciding DNS temperror, Date under 5 h old | 500 | retry |
| 6 | G | 200 | Gmail code request stored |
| 7 | V and B and Fresh | 200 | ACCEPT vendor_verified; auto-filed only on match rule A, else inbox |
| 8 | V and B, not Fresh | 200 | INBOX old_summary |
| 9 | V, not B (sent straight to the private address, Bcc, or To/Cc unsigned) | 200 | INBOX not_addressed_to_you; no one-tap suggestions |
| 10 | U | 200 | INBOX user_forwarded; one-tap suggestions; "Forwarded from <address>" |
| 11 | T behind a valid ARC chain from Google or Microsoft | 200 | REFUSE could_not_verify_after_forwarding; the app shows the fix (Redirect, or forward as attachment) |
| 12 | T | 200 | REFUSE changed_after_sending |
| 13 | From is a listed sender or a user mailbox, but no passSig | 200 | REFUSE sender_not_verified |
| 14 | Everything else: unlisted signer, unsigned mail, display-name spoof, someone else's forward | 200 | REFUSE not_from_your_notetaker |
| 15 | Rows 7 to 10 with empty text after parsing | 200 | REFUSE unreadable |
| 16 | Rows 7 and 10, marker already claimed | 200 | duplicate (or upgrade, step 13) |

A refused row stores only {status, refusedReason, senderDomain, firstAt, lastAt, count, expiresAt}:
no subject, no addresses, no body. senderDomain is shown only when it is the d= of a passing
signature; otherwise the app says "an unknown sender", so an attacker cannot put a phishing domain
on our screen (finding 17).

What each check blocks:
- Basic auth: direct POSTs. The 128-bit token: guessing. Regenerate: a leaked address.
- Header sanity and the single strict From parse: duplicate-header and parser-confusion tricks.
- Aligned DKIM: a spoofed From. The body hash: a changed action item or owner.
- No l=, rsa-sha1, weak or testing keys: append and weak-key tricks.
- Exact sender allowlist: arbitrary DKIM-valid senders, and a notetaker's share or invite mails.
  Content from non-notetakers is never stored.
- B through signed headers only: a stranger putting the victim's private address on his own
  meeting, an added unsigned Cc, a co-attendee replaying his own copy.
- Freshness plus 35-day markers: replays. Markers claimed only after authentication: a forger
  cannot pre-claim a real recap's Message-ID.

Calibration (day 2 and day 5): from Francisco's recap sent AS AN ATTACHMENT (a plain forward drops
the vendor's signature headers), run mailauth locally on the .eml and record: the vendor's d=,
the exact sender address, whether To, Cc and Date are signed (the h= list), whether l= is used, and
whether each attendee gets a separate copy. The .eml is never committed and is deleted afterwards.
If the vendor signs only with its email service's domain (unaligned), V cannot pass; the fix then is
an explicit (sender address, signing domain) pair in SUMMARIES_SENDERS, decided on the evidence.

Residual risks, stated in the docs:
- A genuine recap of a meeting an attacker recorded, sent to the user's real mailbox, is real mail.
  It files only on title AND time (rule A); the reader says "A notetaker summary can come from a
  meeting someone else recorded", and it becomes tasks only through M11's review.
- A compromised vendor DKIM key defeats the check.
- If the vendor puts all attendees in one signed To, a co-attendee who also learned the token could
  get a real recap filed.

## 6. Matching

Inputs: titleLine (first meaningful body line), subjectClean (Subject without Fwd/Re/RV and vendor
prefixes), summaryDate D (YYYY-MM-DD from the first 10 lines or the Subject; ISO, "Oct 16, 2026",
"16 de octubre de 2026"; two different dates mean none), anchor (the signed Date header for vendor
mail, the forward wrapper's Date for user forwards), conference links in the text.

Candidates (summaries/candidates.ts, a new reader; firestoreMeetingReader drops override titles and
durations, fit check 1):
- Field mask: title, startAt, durationMinutes, timezone, allDay, status, deletedAt, source,
  conference, recurrence, recurrenceOverrides, updatedAt.
- Window with D: D 00:00Z minus 14 h to D+1 00:00Z plus 14 h (every zone UTC-12 to UTC+14). With
  only an anchor: anchor minus 48 h to anchor plus 15 min. With neither: inbox no_date.
- Query 1: startAt range, documents with a recurrence skipped (a master whose first occurrence is in
  range would come back twice). Query 2: Meeting Guard AI series, expanded with the copied
  expandOccurrences; cancelled occurrences omitted, moved ones at their effective start and title.
  Imported Google and Outlook series are already one document per instance.

Hard gates: tombstones dropped; with a signed anchor the start must be before anchor plus 15 min;
with D the start's local date must equal D in the meeting's zone, the preferences zone or UTC;
rejectedMeetingIds dropped; cancelled and all-day are suggestions only.

Scores:
- Title T (0 to 1): 1.0 on equal normalized titles (NFKD, no accents, lowercase, "&" as "and",
  prefixes and trailing dates removed); else the best of token Dice, 0.85 when every token of the
  shorter set is in the longer, and 0.6 for a shared distinctive token (4 or more letters, not in
  the generic list: meeting, call, sync, weekly, daily, standup, update, review, team, project,
  planning, discussion, status, check, demo, kickoff, and the Spanish equivalents). Against both
  titleLine and subjectClean.
- Time M: with an anchor, lag = anchor minus the meeting end; 1.0 from -15 to +60 minutes, falling
  to 0 at +6 hours; 0.6 when the meeting ended early. Without an anchor 0.5; an unsigned anchor at
  most 0.8.
- S = 0.65 T + 0.35 M, plus 0.15 when the meeting's conference link appears in the text, capped at 1.

Grouping: same start within 5 minutes, same duration and same normalized title count as one group
(Outlook plus the phone calendar can import one meeting twice). The representative follows source
priority outlook, google, manual, ai_chat, whatsapp, device; the others go to duplicateMeetingIds.

Decision (constants in SUMMARIES_TUNING, recalibrated on Francisco's real recaps):
- Rule A, auto-file: tier vendor_verified, T at least 0.35, S at least 0.60, and no second group
  within 0.15. This is the only automatic filing.
- Rule B (exactly one candidate that day, T at least 0.6, M at least 0.5) no longer files by itself
  (finding 6); it puts the recap in the inbox with that meeting as the first suggestion.
- Ties within 0.15: inbox ambiguous, both suggested. Nothing in the window: no_candidate ("the
  meeting may be on a calendar that is not connected"). Below thresholds: weak.
- Suggestions: top 3 groups with S at least 0.20, except on not_addressed_to_you items.

Stored: match {meetingId (master id for a series), occurrenceDate (the original localDateKey, the
key of recurrenceOverrides), duplicateMeetingIds, method auto | user, score, titleScore, timeScore,
reasons[], zoneUsed, matchedAt, meetingSnapshot {title, startAt, endAt, timezone}}, candidates[],
rejectedMeetingIds[].

Worked fixture: the specimen title on 2026-10-16, signed Date 15:20 America/Mexico_City, candidates
"Urpayroll weekly sync" 14:00-15:00 and "Marketing review" 10:00-10:30. Both get T 0.6 from a
distinctive word; M is 1.0 against 0.23; S 0.74 against 0.47: filed under the Urpayroll meeting.
The same recap without a signed time: 0.565 each, inbox ambiguous, both suggested.

## 7. Data, rules, retention, deletion, encryption

`users/{uid}/meetingSummaries/{summaryId}`, under users/{uid} so both recursiveDelete passes of
deleteAccount cover it (functions/src/deleteAccount.ts:69, :77).
- Plaintext (structure, not content): schemaVersion, parserVersion, status (matched | inbox | kept |
  refused), inboxReason, refusedReason, the trust facts, senderDomain, vendorDomain, auth {dkim[]
  {domain, result, aligned, signsTo, signsDate} max 5, arc {result, sealer}, verifier
  "mailauth@<version>"}, receivedAt, sentAt, anchorAt, summaryDate, language (free string, M12 adds
  languages), match, candidates, rejectedMeetingIds, counts, contentDigest (HMAC), userAction,
  extraction (null, reserved for M11), createdAt, updatedAt, expiresAt.
- Sealed field: subject, titleLine, dateLine, fromAddress, fromName, forwardedBy, text (max 100,000
  characters), sections[]. Refused rows have none. The raw message and the HTML are never stored.
- Root, server-only: summaryAddresses/{tokenHash}, summaryUsers/{uid}, summaryEvents/{sha256}
  (dedupe markers {expiresAt}, no uid, no content).
- No M10 state on meeting, profile or preferences documents: app meeting writes are full
  replacements and an unknown preferences key fails the hasOnly check (firestore.rules:309-317).

Rules: the catch-all already denies all of these paths. M10 adds explicit deny blocks (a recursive
`match /meetingSummaries/{document=**}` inside users/{uid}, and root blocks beside the WhatsApp ones)
with rules tests, deployed after Apple's decision together with the index.

Index: one fieldOverride on collectionGroup meetingSummaries, field expiresAt, copying the
meetings.deletedAt entry (firestore.indexes.json:41-62), for the purge.

Retention (expiresAt at receipt; proposals for Francisco, M11 adds the user-facing rules): filed or
kept 12 months, inbox 60 days, refused rows 30 days, markers 35 days, Gmail requests 2 days.
dailyMaintenance gains two purge ports (functions/src/maintenance/core.ts:42-65), counts in logs
only.

Deletion:
- One summary: summaryAction delete, a hard delete; the markers stay so a Postmark retry cannot
  recreate it.
- All: summaryAction disconnect {deleteSummaries: true}.
- Account: AccountDeletionPorts gains deleteSummaryData(uid) (deleteAddressDocs with mode
  'account_deletion', so no tombstone survives), called right after revokeRefreshTokens
  and before the first recursiveDelete, so new mail stops resolving at once; the commit
  transaction's re-read and the second recursive pass close the race. Also in the deletion replay
  (maintenance/core.ts:117-139) and functions/scripts/replay-account-deletions.mjs. Deployed after
  Apple's decision; until then only pilot test accounts that will not be deleted hold summary data.
- Backups keep deleted data up to 21 days (maintenance/core.ts:11-16); Postmark keeps its copy for
  its retention period (day-0 check 8); the original stays in the user's mailbox.

Encryption (`functions/src/shared/sealed.ts`, node:crypto only):
- AES-256-GCM, random 12-byte IV, 16-byte tag, AAD `meetingSummary:` + uid + `:` + summaryId, so a
  blob moved to another user or document fails to open.
- HKDF-SHA256 subkeys per purpose (`meetingSummaries:content`, `meetingSummaries:digest`); a keyring
  `k1:<base64>` where the first key encrypts and any listed key decrypts.
- The summary functions run under a dedicated service account, the only one granted secretAccessor
  on SUMMARIES_DATA_KEY (finding 13; owner IAM step). Today every function runs as the default
  compute account. If that step slips, the claim wording drops "kept apart".
- Owner step, in bash so no newline is stored:
  `printf '%s' "k1:$(openssl rand -base64 32)" | npx firebase functions:secrets:set SUMMARIES_DATA_KEY`.
  A lost key makes stored summaries unreadable; the originals still exist in the user's email.

## 8. What M10 hands M11

M11 never touches MIME or HTML. It reads loadSummaryForExtraction(uid, summaryId) in
functions/src/summaries/read.ts, which returns only filed or kept summaries.

Sanitization before storage: NFKC; control, zero-width, bidi, BOM and Unicode tag characters
removed; blank-line runs collapsed. The vendor's text/plain part is preferred when the vendor
signature passes. HTML-only mail: script, style, head and comments dropped, and so is every element
hidden by inline style or by a class or id that a `<style>` rule hides (display:none,
visibility:hidden, opacity:0, font-size under 2px, max-height:0, off-screen positioning, text colored
like its background), decided before the style blocks are removed (finding 16). Caps: 100,000
characters, 40 sections, 400 items, 1,000 characters per item; truncation flagged.

Sealed content:
- text: the normalized plain text, the one string M11 sends to the model and checks quotes against.
- sections[] {id, kind, heading (verbatim), derived, start, end, items[]}. Kinds: preamble, tldr,
  summary, updates, decisions, action_items, next_steps, waiting_on, open_questions, notes, custom,
  body. Headings recognized in English and Spanish; unknown short heading lines become custom with
  the heading kept ("Launch Readiness"); no heading at all gives one body section.
- items[] {id, text, start, end, checked, owner, dueText, flags[]}: id `i_` + 12 hex of sha256(kind,
  heading, line), stable across re-parses; text verbatim, with text.slice(start, end) === item.text
  enforced by a test; owner from "(owner: Bish)" or "(responsable: ...)"; dueText only when present,
  never invented; flags possible_instruction (scanned over the whole text and every section, not
  only items), has_link, truncated.
- derived is true for tldr and summary: M11 never extracts a commitment from the TLDR alone.

Plain context for "every item labelled with its origin": tier, trust facts, senderDomain, the match
and meetingSnapshot, summaryDate, anchorAt, language, parserVersion (M11 can re-run sections.ts on
the stored text after a parser fix).

Invariants M11 keeps: summary text only in a separate user-role data block between per-request
nonce delimiters, never in the developer message (functions/src/assistant/prompt.ts:64-66, :134-135,
:215-216); the model may cite only existing item ids, each quote a verbatim substring checked in
code (the provenance checks at functions/src/assistant/actions.ts:165-190); links, emails and phone
numbers never become actions; items from unbound, stale or flagged sources are never pre-selected
in "Accept all".

Confirmed hazard: a new TaskSource value makes every 1.6.0 client drop the task (parseTaskDoc
safeParses source as z.enum(TASK_SOURCES), src/core/types.ts:1025-1027, and the engine skips invalid
tasks), and the tasks hasOnly rule rejects new keys. So M11 keeps provenance on the summary
(extraction.items itemId to taskId) and creates tasks with existing fields only.

## 9. App

JavaScript only (core Clipboard through the existing copyText, Share, Linking, plain Text; no
WebView, no HTML renderer), so the screens can later ride an update to runtime 1.6.0.

- Service `src/services/summaries/` in the whatsappService shape: injected transport, offline probe,
  zod on both sides, error mapping onto existing AppError codes, in-memory cache cleared on session
  end. Hooks useSummaryStatus, useSummaryList, useSummary. No engine listener, no AsyncStorage, no
  outbox.
- Routes SummaryConnect, SummaryInbox, SummaryView {summaryId} (routes.ts, MainStackParamList,
  screens.tsx, RootNavigator and its test mock, navigation titles in EN and ES).
- Settings > Integrations row "Meeting summaries" (MaterialCommunityIcons email-outline), with
  "2 waiting for a meeting" when the inbox has items. Shown only when enabled and in the pilot.
- SummaryConnectScreen: the line "Meeting Guard AI does not join, record or listen to your
  meetings"; Create my private address; the address with Copy, Share and Get a new address (with a
  confirmation); "Where your summaries arrive" (mailboxes); the Gmail code card, prominent only when
  the requesting Gmail is a listed mailbox, otherwise "Someone else asked; ignore it"; setup tabs
  Gmail | Outlook and Microsoft 365 | Other, with "Steps for your administrator" to share; last
  received and last refused with what to do; after 24 hours with nothing, the Microsoft 365 hint;
  "What we check" in plain language. Polls status every 8 s while focused and waiting.
- SummaryInboxScreen: "Waiting for a meeting" cards (title, date, origin chip, reason, up to 3
  one-tap "File under ..." buttons except on not_addressed_to_you cards, Choose a meeting, Keep
  without a meeting, Delete); "Filed recently"; "Refused" collapsed, one row per day with a count.
  Pull to refresh re-matches.
- AttachMeetingSheet: a day stepper from the summary date, that day's meetings from useMeetings with
  series expanded locally, so a weekly series shows that day's occurrence.
- SummaryViewScreen: title; origin line ("Written by your notetaker (<domain>), received <time>.
  Signature checked." or "Forwarded from <address>. The notetaker's own signature could not be
  checked."); the fixed line "Meeting Guard AI did not attend this meeting. This text comes from
  your notetaker."; the match line; sections with verbatim headings, the TLDR headed "Your
  notetaker's own summary"; links as plain text; Not this meeting, Move, Delete.
- MeetingSummarySection on Meeting details, between Notes and Attachments: "Notetaker summary" rows;
  hidden when disabled or empty; room left beside Debrief for M11's "Review commitments".
- i18n: new "summaries" namespace in EN and ES (Spanish written by hand), ASCII punctuation only;
  resources, keysUsed and noTypographicChars tests stay green.
- Deferred: the dashboard setup step, the sidebar item, the Disconnect button (server op built).

## 10. Francisco's setup

In the app (once his uid is in the pilot): Settings > Integrations > Meeting summaries > Create my
private address; check the mailbox list; Copy.

Gmail or Google Workspace:
1. https://mail.google.com/mail/u/0/#settings/fwdandpop > Add a forwarding address > paste > Next >
   Proceed.
2. Gmail mails a confirmation code to the private address; the app shows it within a minute. Paste
   it on the same Gmail page and Verify.
3. Leave forwarding of all mail OFF.
4. https://mail.google.com/mail/u/0/#settings/filters > Create a new filter > From: the notetaker's
   sender > Create filter > Forward it to: the private address > Create filter.
5. Workspace: if forwarding is greyed out, the admin allows automatic forwarding in
   https://admin.google.com > Apps > Google Workspace > Gmail > End User Access (menu UNVERIFIED).

Microsoft 365 company mailbox:
- Administrator, once: Microsoft blocks automatic forwarding to outside addresses by default. In
  https://security.microsoft.com/antispam create an OUTBOUND anti-spam policy for Francisco's mailbox
  only, "Automatic forwarding rules" = "On - Forwarding is enabled". Check
  https://admin.exchange.microsoft.com/#/remotedomains > Default allows automatic forwarding.
- Francisco: https://outlook.office.com/mail/options/mail/rules > Add new rule > From: the notetaker's
  sender > "Redirect to" the private address. Only Redirect: it keeps the notetaker as the sender so
  its signature can be checked. "Forward to" is not supported.
- A blocked forward bounces to the notetaker, not to him; the app shows the admin steps again after
  a day with nothing received.
- Whether Safe Links or a disclaimer breaks the vendor signature on redirect is UNVERIFIED; if it
  does (row 11), base scope adds verification of a recap forwarded as an attachment (the attached
  message keeps the vendor's bytes and signature; the outer forward proves who sent it).

The notetaker itself: keep "email me the summary" on, to the mailbox with the rule. Never add the
private address as a meeting guest or to a share list.

By hand, any time: forwarding a summary from a listed mailbox works; it waits in the inbox for one
tap.

Owner steps (Dusko; SETUP.md section 15): Postmark Summaries server with raw content on and spam
blocking off; webhook `https://postmark:<secret>@<region>-meetingguard-ai-app.cloudfunctions.net/summaryInbound`
(region UNVERIFIED); secrets SUMMARIES_WEBHOOK_AUTH and SUMMARIES_DATA_KEY; params in
functions/.env.meetingguard-ai-app (SUMMARIES_ENABLED, SUMMARIES_PILOT_UIDS,
SUMMARIES_ADDRESS_TEMPLATE, SUMMARIES_SENDERS, SUMMARIES_TRUSTED_FORWARDERS empty); the dedicated
service account; then the selective functions deploy, the webhook URL, the inbound domain after the
MX record (Sven adds it in Hostinger: host summaries, MX, inbound.postmarkapp.com, priority 10).

## 11. Demo (about 12 minutes, Android test APK, laptop mail client recorded alongside)

Preparation: summary functions deployed with the demo uid in the pilot; SUMMARIES_SENDERS
calibrated on a rehearsal recap of the demo notetaker; in the demo Google Calendar, synced into the
app, "Urpayroll weekly sync" today and "Marketing review" earlier the same day;
MeetingGuardAI-1.6.0-m10-test-YYYYMMDD-HHMM.apk installed after uninstalling the Play build.

1. Setup: create the address, copy it; Gmail Add a forwarding address; the code appears in the app;
   Verify; create the filter.
2. Real meeting: a short call with the notetaker; speak two action items with owners; end it.
3. Acceptance line 1: the recap arrives in Gmail and is forwarded; in the app, Meeting details of
   "Urpayroll weekly sync" shows "Notetaker summary": origin line with "Signature checked", "did not
   attend", the match line, the action items verbatim. "Marketing review" has nothing.
4. Acceptance line 2, a forged one is refused:
   a. From a second Gmail account with the notetaker's display name, the recap text and subject,
      sent to the private address: Refused, "not from your notetaker". Nothing stored.
   b. A colleague's own real recap forwarded to the private address: refused the same way, or held
      as "not addressed to you" if it is vendor-signed.
   c. A spoofed vendor From and a tampered signed copy (the real .eml with one owner changed),
      through the real MX if a host with outbound port 25 exists, otherwise posted as a
      Postmark-shaped payload by functions/scripts/send-test-inbound.mjs (the video says so):
      sender_not_verified and changed_after_sending. Plus the decision-table tests passing.
5. Duplicate: the same recap again; no second summary.
6. Inbox: a recap of a meeting not in the calendar waits with its reason; Choose a meeting; Keep;
   Delete.
7. Address control: Get a new address; mail to the old one never arrives.

Close: no server push until A8, so a summary appears when the app is opened; nothing becomes a task
until M11.

## 12. Tests

Functions (ts-jest, fakes, logger mocked):
- Address: token format and hash, envelope-only routing, idempotent create, regenerate in one
  transaction and the sixth rotation rate-limited, mailbox validation, unverified and non-pilot
  callers rejected.
- Inbound handler: 404, 405, 401 including an empty configured secret; oversize and missing RawEmail
  ignored; unknown token, regenerated token, deleted user and non-pilot uid write nothing; refused
  cap counts refusals only and a redelivery once; a forged message carrying a real recap's
  Message-ID does not block the real one; an inbox copy is upgraded by a later bound copy; Firestore
  failure 500 with no marker; fresh and old DNS temperror; address regenerated between lookup and
  commit; no logger call contains subject, address, body or header text.
- Authenticity, row by row, with fixtures signed in the test by mailauth's signer and a generated
  RSA-2048 key behind a stub resolver: bound vendor; vendor To the token; To unsigned; added
  unsigned Cc naming a listed mailbox; display-name address in To; stale Date; body and header
  tampered; unaligned d=; l= with appended text; t=y; rsa-sha1; 512-bit key; vendor From unsigned;
  display-name spoof; user forward; unlisted mailbox; spoofed own address; Gmail confirmation with
  and without a google.com pass; duplicate From and To; From with comments, groups, route syntax or
  encoded words; ARC behind body-hash failure gives could_not_verify_after_forwarding. One locally
  captured fixture from Dusko's own notetaker; never Francisco's email. An optional local-only test
  reads an untracked .eml from MG_REAL_RECAP_EML, skipped in CI.
- Sections: a synthetic copy of the specimen layout (middle-dot date line, the seven sections, the
  owner format, the slice invariant, stable ids); Spanish headings; body fallback; HTML-only lists;
  hidden HTML by inline style and by style-block class; zero-width, bidi and tag characters; Gmail
  and Outlook forward wrappers in EN and ES; caps; flags.
- Matching: the worked fixtures; the date in the meeting's zone (21:30 America/Mexico_City), the
  preferences zone and UTC; the Europe/London DST week; UTC+14 and UTC-12 edges; Outlook-plus-device
  duplicates grouped; a Meeting Guard AI weekly series (today's occurrence, a moved one with the
  original occurrenceDate, a cancelled one skipped, the master not double-counted); cancelled and
  all-day never auto-filed; rule B goes to the inbox; re-match files an item once the meeting
  appears.
- sealed: round trip; wrong AAD fails; flipped bits fail; key rotation; purpose separation; no
  plaintext in output; malformed keyrings rejected.
- Gating: with SUMMARIES_ENABLED unset, summaryInbound and summaryRead are undefined and the two
  always-on callables bind no secret.
- Updates: deleteAccount order (after revoke, before the first recursive delete, also on retry);
  maintenance purges; the replay port; the contract check over four file pairs.

Rules (npm run test:rules): owner and others denied on meetingSummaries and below, and on the three
root collections; existing paths unchanged; the missing whatsapp* deny cases added.

App: service schemas and error mapping; connect, inbox and attach models; the summary section hidden
when disabled, origin line first, no tappable links; EN/ES parity and the typographic guard.

Device: a new T31 "Meeting summaries" in docs/v1/TESTING.md.

## 13. Work plan (about 5 working days)

Branch m10-summaries from v2 in the side git dir. The owner runs every deploy and console step.

- Day 0 (operations, in parallel): Sven confirms Postmark and the two-server split and names his
  subdomain; Francisco says which notetaker and mailbox, and sends one recap as an attachment; the
  Postmark account opens in Aeternum Tech's name; one combined message to the DNS owner with the
  summaries MX record and Sven's A1 records. Prepare and submit the M13 WhatsApp templates to Meta.
- Day 1: spike (Postmark free inbound, RawEmail fidelity, OriginalRecipient, mailauth and the parser
  under the CommonJS build and Jest 29, mailauth on downloaded .eml files); shared copies and the
  four-pair drift check; sealed.ts and address.ts with tests; contract schemas; rules blocks with
  rules tests.
- Day 2: postmark adapter, mime, authenticity with the signed-fixture table, inbound, store
  transactions, the Gmail code, summaryStatus and summaryAction, the gating test. Evening: the owner
  creates the secrets and the service account, sets the params, deploys the summary functions with
  the demo uid, sets the webhook. First real message end to end; calibrate SUMMARIES_SENDERS.
- Day 3: sanitize and sections against the specimen and the calibration .eml; candidates, match,
  summaryRead with re-match; deleteAccount, replay and maintenance ports with the index (committed,
  deployed after Apple's decision).
- Day 4: the app service, hooks and screens; routes and titles; the summaries namespace in EN and ES;
  app tests green.
- Day 5: MX live, Francisco's address and forwarding; recalibrate on his real recaps; docs
  (ARCHITECTURE section 36, SETUP section 15 with the support runbook, TESTING T31, LEGAL-CLAIMS
  entries, a draft privacy paragraph for the website and legal.json, HANDOFF); the time-stamped test
  APK; rehearse and record.

Base scope excludes: an admin health line, ARC rescue into acceptance, the SPF path for tenants that
sign only as onmicrosoft.com, a per-user "Trust this notetaker", pause, mailbox ownership proof, the
dashboard step, the sidebar item and the Disconnect button.

Cut order if time runs out: (1) re-match on list (manual attach stays); (2) AttachMeetingSheet
(one-tap suggestions and Keep only); (3) the conference-link bonus; (4) server recurrence expansion
(series candidates go to the inbox).

Never cut: Basic auth first; envelope-only routing and the pilot gate before parsing; header sanity
with the single From parse; DKIM classification with signed-header binding; the refuse and inbox
rows; markers claimed only after authentication; freshness; the Gmail code card; sealing with AAD;
server-only data; per-summary delete and the account-deletion wiring; ship-dark gating; the "did not
attend" line.

## 14. Honest wording for the app, the privacy policy and LEGAL-CLAIMS

- Encrypted: "Encrypted in transit and at rest by Google Cloud. In addition, Meeting Guard AI
  encrypts each summary's text, subject and the email addresses in it with its own key, kept in
  Google Secret Manager. Your private address, the mailboxes you list, and details such as the date,
  the sender's domain and the meeting it is filed under do not get this extra layer. This is not
  end-to-end encryption: people with administrative access to our systems could technically decrypt
  it. Our email provider, Postmark, receives each email first and keeps it for [N] days."
- Stored for you only: "Only you can see your summaries in the app; other Meeting Guard AI users
  cannot reach them."
- Deletable: "You can delete any summary, or all of them, at any time. They leave our live database
  at once and our backups within 21 days. The copy at our email provider expires after [N] days. The
  original email stays in your own mailbox."
- Forged one refused: "A summary that your notetaker did not sign, that was changed after it was
  sent, or that was not sent to one of your own mailboxes is refused, and its content is not kept by
  Meeting Guard AI. A real summary sent straight to your private address waits in your inbox for
  your OK." Never claim that a fake summary can never reach an account.
- Refused content: "not stored by Meeting Guard AI", never "discarded" (Postmark still holds it).
- [N] comes from day-0 check 8. The privacy policy names Postmark before the pilot opens to everyone.

## 15. Red-team findings and how each is handled

| # | Severity | Finding | Handled by |
|---|---|---|---|
| 1 | high | Recipient binding met through an unsigned Cc or a display name | B counts a mailbox only from a signed header, addr-spec only (section 5) |
| 2 | high | An Outlook "Forward to" rule re-sends forged mail as the user | U never auto-files; "Forward to" unsupported, Redirect only; label "Forwarded from" (decision 5) |
| 3 | high | Mail to random local parts burns the shared Postmark allowance | Day-0 check 6; usage alerts; Pro arrives with A1 anyway; claim removed |
| 4 | high | Everyone on the shared Postmark account can read M10 mail | Day-0 check 7 (per-server access, else Sven off the account, server token only); shortest retention; Postmark named in the policy |
| 5 | medium | Junk counted before authentication silently drops real recaps | Only refusals count, deduped by Postmark MessageID; banner suggests a new address (step 9) |
| 6 | medium | A genuine recap of an attacker's meeting files automatically | Exact sender addresses; auto-file on rule A only; reader line (sections 5, 6) |
| 7 | medium | Trust facts lost after filing from the inbox | Immutable trust facts; M11 never pre-selects such items; no one-tap on not_addressed_to_you |
| 8 | medium | From parsed twice by different parsers | One strict parse; alignment computed in classify; strict From sanity (step 6) |
| 9 | medium | Microsoft 365 rewriting breaks genuine recaps | Mailbox type asked on day 0; row 11 wording; attachment verification enters base scope if needed |
| 10 | low | An unbound inbox copy pushes out the bound copy as a duplicate | Markers only for rows 7 and 10; upgrade in place (step 13) |
| 11 | low | Memory exhaustion before the token check | Concurrency 2, 1GiB, req.body reused, token first, part and depth caps |
| 12 | low | Deleted accounts or a restore keep addresses alive | Auth and users/{uid} checks; rotation log in Cloud Logging; restore runbook |
| 13 | low | Every function can read the data key | Dedicated service account; lazy imports; wording if it slips |
| 14 | low | The single Gmail code slot can be overwritten | Up to 3 requests keyed by Gmail address; prominent only for a listed mailbox |
| 15 | low | Header fallbacks route mail to an account the envelope never named | Envelope recipient only (section 3) |
| 16 | low | Text hidden by style-block classes reaches M11 | Visibility decided before removing styles; text/plain preferred; full-text instruction scan |
| 17 | low | Attacker-chosen sender domains shown in the app | One refused row a day; domain shown only for a passing signature |

## 16. Open questions

- Sven, answered Nov 11 in the group: Postmark with two servers, assistant.meetingguard.ai for A1;
  the DNS is at Hostinger and Francisco gave Sven admin access to the Hostinger account, so Sven
  adds the summaries MX record together with his own; DMARC reports for his subdomain go to a new
  dmarc@meetingguard.ai mailbox. Still open: Sven's OK on the proposal that Dusko opens the account
  in Aeternum Tech's name and Sven gets the Assistant server only, and Francisco's OK on Pro.
- Francisco: which notetaker; which mailbox (Gmail, Workspace, Microsoft 365, Outlook.com); is it his
  sign-in email; one recap as an attachment; for Microsoft 365, his administrator.
- Postmark day-0 checks 1 to 8 (section 2).
- From the calibration .eml: the vendor's d= and sender address, the signed header list, l=,
  separate copies per attendee, whether the body carries a time or only the date, whether the
  subject equals the calendar title.
- Gmail's confirmation email: DKIM d=google.com, exact subject and code wording (fixed on the first
  real one).
- mailauth 8 result field names and CommonJS loading; the MIME parser choice.
- A host with outbound port 25 for the forged-mail demo, or the simulated provider hop.
- The App Store privacy category and Play Data safety type for forwarded email content, before the
  pilot opens to everyone.
- Retention periods (12 months, 60 days, 30 days) for Francisco's confirmation in M11.
