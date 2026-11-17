/**
 * Executive assistant: the matter data model (A1; docs/v1/ARCHITECTURE.md section 36).
 *
 * A matter is one job the user hands the assistant ("contact Carlos, ask for the proposal, set up
 * a meeting, follow up until Friday"). Its MANDATE says what the assistant may do: whom it may
 * email, what it may ask for, which times it may offer, how often it follows up and until when.
 * Nothing is sent before the user confirms one exact draft, the mandate together with the first
 * email (confirmedHash); every send is checked against that confirmed mandate in code, never by
 * the model.
 *
 * Layout (Firestore; all written ONLY by the matter functions through the Admin SDK):
 *   users/{uid}/matters/{matterId}                   MatterDoc      owner read, server write
 *   users/{uid}/matters/{matterId}/events/{eventId}  MatterEvent    owner read, server write
 *   users/{uid}/matters/{matterId}/messages/{msgId}  MatterMessage  owner read, server write
 *   users/{uid}/matters/{matterId}/approvals/{id}    MatterApproval owner read, server write (A2)
 *   users/{uid}/matters/{matterId}/proposals/{id}    MatterProposal owner read, server write (A2)
 *   matterAddresses/{token}                          reply address -> matter, server only
 *   matterMessageIds/{messageIdKey}                  Message-ID -> matter (threading), server only
 *   inboundEmails/{providerId}                       inbound dedupe marker, server only
 *   matterSchedule/{matterId}                        next follow-up or end check (A2), server only
 *   matterReadQueue/{matterId_messageId}             a reply read in progress or to retry (A2), server only
 * Under users/{uid}, so deleteAccount's recursive delete removes the matters with the account;
 * the lookup collections carry the uid and are removed by deleteAccount as well. The two A2
 * queues are top-level collections queried on one field (nextActionAt, claimedAt), so they need no
 * composite or collection-group index.
 *
 * Pure module: schemas, limits, ids and helpers only (no Firebase, no network).
 */
import { createHash, randomBytes } from 'node:crypto';

import { z } from 'zod';

import {
  COMMITMENT_LIMITS,
  COMMITMENT_STATUSES,
  DRAFT_HASH_PATTERN,
  MATTER_APPROVAL_KINDS,
  MATTER_APPROVAL_REASONS,
  MATTER_APPROVAL_STATUSES,
  MATTER_GUARD_FLAGS,
  MATTER_SEND_OUTCOMES,
  MATTER_SOURCES,
  MEETING_ID_PATTERN,
  commitmentDueSchema,
  commitmentOwnerSchema,
  emailSchema,
  isoDateTimeSchema,
  languageSchema,
  timeZoneSchema,
} from '../shared/aiContract';

// ---------------------------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------------------------

export const MATTERS_SUBCOLLECTION = 'matters';
export const MATTER_EVENTS_SUBCOLLECTION = 'events';
export const MATTER_MESSAGES_SUBCOLLECTION = 'messages';
export const MATTER_ADDRESSES_COLLECTION = 'matterAddresses';
export const MATTER_MESSAGE_IDS_COLLECTION = 'matterMessageIds';
export const INBOUND_EMAILS_COLLECTION = 'inboundEmails';
export const MATTER_APPROVALS_SUBCOLLECTION = 'approvals';
export const MATTER_PROPOSALS_SUBCOLLECTION = 'proposals';
export const MATTER_SCHEDULE_COLLECTION = 'matterSchedule';
export const MATTER_READ_QUEUE_COLLECTION = 'matterReadQueue';

export const matterPath = (uid: string, matterId: string) => `users/${uid}/${MATTERS_SUBCOLLECTION}/${matterId}`;
export const matterEventPath = (uid: string, matterId: string, eventId: string) =>
  `${matterPath(uid, matterId)}/${MATTER_EVENTS_SUBCOLLECTION}/${eventId}`;
export const matterMessagePath = (uid: string, matterId: string, messageId: string) =>
  `${matterPath(uid, matterId)}/${MATTER_MESSAGES_SUBCOLLECTION}/${messageId}`;
export const matterApprovalPath = (uid: string, matterId: string, id: string) =>
  `${matterPath(uid, matterId)}/${MATTER_APPROVALS_SUBCOLLECTION}/${id}`;
export const matterProposalPath = (uid: string, matterId: string, id: string) =>
  `${matterPath(uid, matterId)}/${MATTER_PROPOSALS_SUBCOLLECTION}/${id}`;
/** matterReadQueue/{id}: matter and message ids are Firestore auto ids (alphanumeric), so "_" separates them. */
export const readQueueId = (matterId: string, messageId: string) => `${matterId}_${messageId}`;

// ---------------------------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------------------------

export const MATTER_LIMITS = {
  /** The user's own words (typed or transcribed), with their answers to the questions appended. */
  requestChars: 4000,
  titleChars: 120,
  goalChars: 600,
  itemChars: 200,
  nameChars: 100,
  maxContacts: 5,
  maxAskItems: 8,
  maxQuestions: 5,
  /** Written by code (text.ts readBack); the longest possible mandate fits (mattersParts.test.ts). */
  readBackChars: 8000,
  maxTimeWindows: 10,
  meetingMinutesMin: 5,
  meetingMinutesMax: 480,
  followUpEveryDaysMax: 14,
  followUpMaxCount: 10,
  /** A mandate never runs longer than this from its confirmation. */
  maxMandateDays: 90,
  eventDetailChars: 500,
  /** The first email as drafted (subject and plain text, before the code adds the footer). */
  firstEmailChars: 3000,
  subjectChars: 200,
  /** Plain-text body kept per email (longer bodies are cut, never rejected). */
  bodyChars: 20_000,
  maxRecipients: 20,
  maxReferences: 50,
  /** RFC 5322 line limit; Message-IDs are far shorter in practice. */
  messageIdChars: 998,
  /** A contact's Message-ID is put in In-Reply-To / References only up to this length (A2). */
  threadIdChars: 250,
  /** Attachments described per inbound email (name, type, size; the bytes are never kept in A2). */
  maxAttachments: 20,
  attachmentNameChars: 200,
  /** A reply draft as the model writes it (before the code adds the signature and footer). */
  replyChars: 3000,
  quoteChars: 300,
  maxProposalsPerReply: 5,
} as const;

// ---------------------------------------------------------------------------------------------
// The mandate
// ---------------------------------------------------------------------------------------------

/** Who receives a copy: every email in copy (cc), or one summary a day. */
export const COPY_OWNER_MODES = ['cc', 'daily_summary'] as const;

const shortText = (max: number) => z.string().trim().min(1).max(max);

export const mandateContactSchema = z
  .object({
    name: shortText(MATTER_LIMITS.nameChars),
    email: emailSchema,
  })
  .strict();

export const timeWindowSchema = z
  .object({ start: isoDateTimeSchema, end: isoDateTimeSchema })
  .strict()
  .refine((w) => Date.parse(w.start) < Date.parse(w.end), { message: 'A time window must end after it starts.' });

/** The meeting the assistant may set up (A3); null when the matter needs no meeting. */
export const mandateMeetingSchema = z
  .object({
    durationMinutes: z.number().int().min(MATTER_LIMITS.meetingMinutesMin).max(MATTER_LIMITS.meetingMinutesMax),
    /** When it may offer times; empty = any free time in the user's calendars before endsAt. */
    windows: z.array(timeWindowSchema).max(MATTER_LIMITS.maxTimeWindows),
  })
  .strict();

export const mandateFollowUpSchema = z
  .object({
    /** Days without an answer before the next follow-up. */
    everyDays: z.number().int().min(1).max(MATTER_LIMITS.followUpEveryDaysMax),
    /** 0 = never follow up. */
    maxCount: z.number().int().min(0).max(MATTER_LIMITS.followUpMaxCount),
  })
  .strict();

/**
 * What the user allows for one matter. What the assistant NEVER does (pay, accept a price or
 * negotiate money, agree to anything contractual, contact anyone else, send from the user's own
 * mailbox without permission) is not part of the mandate: it is enforced in code for every
 * matter and cannot be granted here.
 */
export const mandateSchema = z
  .object({
    contacts: z
      .array(mandateContactSchema)
      .min(1)
      .max(MATTER_LIMITS.maxContacts)
      .refine((list) => new Set(list.map((c) => c.email.toLowerCase())).size === list.length, {
        message: 'Each contact appears once.',
      }),
    /** What the matter is for, in one or two sentences. */
    goal: shortText(MATTER_LIMITS.goalChars),
    /** What the assistant may ask the contacts for (a document, a date, a confirmation). */
    mayAsk: z.array(shortText(MATTER_LIMITS.itemChars)).max(MATTER_LIMITS.maxAskItems),
    meeting: mandateMeetingSchema.nullable(),
    followUp: mandateFollowUpSchema,
    /** The assistant stops at this instant (or earlier, when the matter is done). */
    endsAt: isoDateTimeSchema,
    copyOwner: z.enum(COPY_OWNER_MODES),
    /** Language of the emails to the contacts. */
    language: languageSchema,
    /** The user's zone: times in emails and the meeting windows are shown in it. */
    timeZone: timeZoneSchema,
  })
  .strict();

export type Mandate = z.infer<typeof mandateSchema>;
export type MandateContact = z.infer<typeof mandateContactSchema>;

/** JSON with object keys in a fixed order, so equal mandates always give the same text. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** The first email as drafted: what the user reads before confirming, and what is sent. */
export const firstEmailSchema = z
  .object({
    subject: shortText(MATTER_LIMITS.subjectChars),
    text: shortText(MATTER_LIMITS.firstEmailChars),
  })
  .strict();

export type FirstEmail = z.infer<typeof firstEmailSchema>;

/**
 * Fingerprint of one exact draft: the mandate and the first email. The app confirms by sending
 * back the hash of the version it showed; any later change gives another hash, so a stale screen
 * can never confirm something the user did not read.
 */
export function draftHash(mandate: Mandate, firstEmail: FirstEmail): string {
  return createHash('sha256').update(canonicalJson({ firstEmail, mandate })).digest('hex');
}

// ---------------------------------------------------------------------------------------------
// The matter
// ---------------------------------------------------------------------------------------------

/**
 * draft: the mandate is being worked out and waits for the user's confirmation (nothing sent);
 * active: confirmed, the assistant works within the mandate; paused: the user paused it;
 * done: the goal was reached; cancelled: the user stopped it, or its end date passed.
 */
export const MATTER_STATUSES = ['draft', 'active', 'paused', 'done', 'cancelled'] as const;
export type MatterStatus = (typeof MATTER_STATUSES)[number];

/**
 * Where the first email stands. matterConfirm claims the send ('sending') in the same
 * transaction that activates the matter, so two overlapping confirms never both send.
 * none:    not tried yet
 * sending: claimed by one confirm call that is sending it now
 * sent:    the provider accepted it (firstSentAt)
 * test:    accepted with Postmark's test token POSTMARK_API_TEST, which delivers nothing: no
 *          firstSentAt, so no follow-up or reply ever builds on it
 * failed:  the provider clearly refused it (setup, rejected, rate limit): a retry may send again
 * unknown: no clear answer (timeout, lost connection, server error): it may have gone out, so it
 *          is never sent again automatically
 */
export const FIRST_SEND_STATES = ['none', 'sending', 'sent', 'test', 'failed', 'unknown'] as const;
export type FirstSendState = (typeof FIRST_SEND_STATES)[number];

/** Why a send is 'unknown', when we know more (Postmark 406: the copy arrives, the contact's does not). */
export const SEND_UNKNOWN_CAUSES = ['inactive_recipient'] as const;

/**
 * How long a 'sending' claim counts as a send in progress: a second confirm in this window hears
 * 'sending' ("check again"); after it, the claiming call has died (the function timeout is 60 s) and
 * the send is 'unknown'.
 */
export const SENDING_WINDOW_MS = 120_000;

/**
 * Why a matter stopped (A2): the user cancelled it, its end date passed, the contact asked us to
 * stop, the owner confirmed the goal was reached, or a contact marked our email as spam.
 */
export const STOP_REASONS = ['user', 'ended', 'contact_asked', 'goal_reached', 'complaint'] as const;
export type StopReason = (typeof STOP_REASONS)[number];

/** The day's counters of one matter (UTC day), for the caps of A2 (caps.ts). */
export const dailyCountsSchema = z
  .object({
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    /** Model reads of replies. */
    reads: z.number().int().min(0),
    /** Replies sent without the owner's approval (MATTERS_AUTO_REPLY). */
    autoReplies: z.number().int().min(0),
    /** Emails in and out on the matter (a loop shows as many). */
    exchanges: z.number().int().min(0),
    /** A many_replies card was already added today. */
    capCard: z.boolean(),
  })
  .strict();
export type DailyCounts = z.infer<typeof dailyCountsSchema>;

/** The secret part of a matter's reply address: 96 random bits, lowercase hex (case-safe in email). */
export const REPLY_TOKEN_PATTERN = /^[a-f0-9]{24}$/;

const matterDocShape = {
    status: z.enum(MATTER_STATUSES),
    /** The user's interface language when the matter was created (read-back, questions). */
    language: languageSchema,
    /** The user's zone when the matter was created (dates in the drafts are resolved in it). */
    timeZone: timeZoneSchema,
    title: shortText(MATTER_LIMITS.titleChars),
    request: shortText(MATTER_LIMITS.requestChars),
    source: z.enum(MATTER_SOURCES),
    /** The user's name as shown to the contacts ("Ana Lopez's AI assistant"); may be empty. */
    ownerName: z.string().max(MATTER_LIMITS.nameChars),
    /** The user's verified email, for the copies; null when the account has none. */
    ownerEmail: emailSchema.nullable(),
    /** The current draft or confirmed mandate; null while details are missing. */
    mandate: mandateSchema.nullable(),
    /** The first email as drafted; null while details are missing. */
    firstEmail: firstEmailSchema.nullable(),
    /** Missing details the assistant asks about before the mandate can be confirmed. */
    questions: z.array(shortText(MATTER_LIMITS.itemChars)).max(MATTER_LIMITS.maxQuestions),
    /** The mandate in plain words, as shown to the user before confirming. */
    readBack: z.string().max(MATTER_LIMITS.readBackChars),
    /** Increases with every new draft. */
    mandateVersion: z.number().int().min(0),
    /** Hash of the draft the user confirmed (null while a draft); sends are checked against it. */
    confirmedHash: z.string().regex(DRAFT_HASH_PATTERN).nullable(),
    confirmedAt: isoDateTimeSchema.nullable(),
    /** When the first email went out; null until then (a repeated confirm never sends twice). */
    firstSentAt: isoDateTimeSchema.nullable(),
    /** FIRST_SEND_STATES; matters stored before this field read as 'none'. */
    firstSendState: z.enum(FIRST_SEND_STATES).default('none'),
    /** When the current send was claimed ('sending'). */
    firstSendClaimedAt: isoDateTimeSchema.nullable().default(null),
    /** Set with firstSendState 'unknown' when the cause is known (SEND_UNKNOWN_CAUSES). */
    firstSendUnknownCause: z.enum(SEND_UNKNOWN_CAUSES).nullable().default(null),
    replyToken: z.string().regex(REPLY_TOKEN_PATTERN),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    /** When it became done or cancelled. */
    endedAt: isoDateTimeSchema.nullable(),
    // ---- A2 (every field has a default, so matters written by A1 still read) ----
    /** Why it stopped (STOP_REASONS); null while it runs. */
    stopReason: z.enum(STOP_REASONS).nullable().default(null),
    /** Follow-ups sent (and claimed ones whose fate is unknown: never sent twice). */
    followUpsSent: z.number().int().min(0).default(0),
    /** A follow-up a tick claimed and is sending: { number, claimedAt }. */
    followUpClaim: z.object({ number: z.number().int().min(1), claimedAt: isoDateTimeSchema }).strict().nullable().default(null),
    /** Our last email that went out (the follow-up clock runs from it). */
    lastOutboundAt: isoDateTimeSchema.nullable().default(null),
    /** The last email of a contact that was not an automatic reply. */
    lastInboundAt: isoDateTimeSchema.nullable().default(null),
    /** Contact addresses that hard-bounced or are inactive at Postmark: never emailed again. */
    bouncedRecipients: z.array(emailSchema).max(MATTER_LIMITS.maxRecipients).default([]),
    /** Approval cards waiting for the owner (shown in the list). */
    pendingApprovals: z.number().int().min(0).default(0),
    dailyCounts: dailyCountsSchema.nullable().default(null),
};

/** What the functions WRITE: strict, nothing outside the model. */
export const matterDocSchema = z.object(matterDocShape).strict();

/**
 * What the functions READ: the same fields, but a field this version does not know (written by a
 * newer version during a rollout) is dropped instead of making the whole matter unreadable. Updates
 * are patches, so the unknown field stays in Firestore.
 */
export const matterDocReadSchema = z.object(matterDocShape);

export type MatterDoc = z.infer<typeof matterDocSchema>;

// ---------------------------------------------------------------------------------------------
// The timeline (events) and the emails (messages)
// ---------------------------------------------------------------------------------------------

/** A2 and A3 add their own types (commitment_proposed, approval_requested, meeting_booked, ...). */
export const MATTER_EVENT_TYPES = [
  'created',
  'mandate_drafted',
  'mandate_confirmed',
  'email_sent',
  'email_failed',
  /** The provider gave no clear answer: the email may have gone out (never resent automatically). */
  'email_unconfirmed',
  /** Accepted with Postmark's test token: delivered to nobody. */
  'email_test',
  'email_received',
  'status_changed',
  // A2
  /** The model read a reply (detail: what it proposed, as a category). */
  'reply_read',
  /** A reply was stored and never acted on (the owner's address, an automatic reply, a paused matter). */
  'reply_not_acted_on',
  'approval_requested',
  'approval_decided',
  'commitment_proposed',
  'commitment_decided',
  'reply_sent',
  'follow_up_sent',
  'email_bounced',
  'spam_complaint',
] as const;
export type MatterEventType = (typeof MATTER_EVENT_TYPES)[number];

export const matterEventSchema = z
  .object({
    type: z.enum(MATTER_EVENT_TYPES),
    at: isoDateTimeSchema,
    /** The messages/{id} document this event is about, if any. */
    messageId: z.string().min(1).max(128).nullable(),
    /** Short, user-facing note (no email bodies). */
    detail: z.string().max(MATTER_LIMITS.eventDetailChars),
  })
  .strict();

export type MatterEvent = z.infer<typeof matterEventSchema>;

/** SPF as Postmark's Received-SPF header states it: a hint only, never deciding. */
export const SPF_HINTS = ['pass', 'fail', 'softfail', 'neutral', 'none', 'temperror', 'permerror', 'unknown'] as const;

/**
 * The sender check of an inbound email (A2; mailCheck.ts, computed by our code from the raw email):
 * trusted:    a DKIM signature that passes, aligned with the From domain, signs From
 *             (mail/auth.ts isPassSig)
 * unverified: no such signature (or no raw email to check): read, but never answered automatically
 * malformed:  the headers do not parse strictly, or the raw From is not the From Postmark reports
 */
export const SENDER_VERDICTS = ['trusted', 'unverified', 'malformed'] as const;
export type SenderVerdict = (typeof SENDER_VERDICTS)[number];

export const emailAuthSchema = z
  .object({
    verdict: z.enum(SENDER_VERDICTS),
    fromAligned: z.boolean(),
    spf: z.enum(SPF_HINTS),
    /** A valid ARC chain sealed by google.com or microsoft.com (recorded; not deciding in A2). */
    arcTrusted: z.boolean(),
    /** Why it is not trusted, as a category ('no_raw', 'from_mismatch', 'no_aligned_signature', ...). */
    reason: z.string().max(40).nullable(),
  })
  .strict();
export type EmailAuth = z.infer<typeof emailAuthSchema>;

/**
 * Who wrote an inbound email, by its From address:
 * contact: one of the mandate's contacts; owner: the owner's own email (never acted on: the owner
 * instructs only in the app); other: anyone else (a card, never answered).
 */
export const SENDER_ROLES = ['contact', 'owner', 'other'] as const;
export type SenderRole = (typeof SENDER_ROLES)[number];

/**
 * Where the model read of an inbound email stands (matterInboundRead):
 * none: waits for the trigger; reading: claimed; done: read and acted on (or decided without the
 * model); failed: the read failed and matterTick retries it; skipped: stored only (never acted on).
 */
export const READ_STATES = ['none', 'reading', 'done', 'failed', 'skipped'] as const;
export type ReadState = (typeof READ_STATES)[number];
/** A read claim older than this is stale (the trigger died): matterTick retries it. */
export const READ_STALE_MS = 10 * 60_000;
export const MAX_READ_ATTEMPTS = 3;

export const attachmentInfoSchema = z
  .object({ name: z.string().max(MATTER_LIMITS.attachmentNameChars), type: z.string().max(100), size: z.number().int().min(0) })
  .strict();

export const MESSAGE_DIRECTIONS = ['outbound', 'inbound'] as const;
/** test: sent with Postmark's test token (accepted, delivered to nobody). */
export const MESSAGE_STATUSES = ['sending', 'sent', 'test', 'failed', 'received'] as const;

const messageIdSchema = z.string().min(3).max(MATTER_LIMITS.messageIdChars);

export const matterMessageSchema = z
  .object({
    direction: z.enum(MESSAGE_DIRECTIONS),
    status: z.enum(MESSAGE_STATUSES),
    /** RFC 5322 Message-ID with its angle brackets. */
    rfcMessageId: messageIdSchema,
    inReplyTo: messageIdSchema.nullable(),
    references: z.array(messageIdSchema).max(MATTER_LIMITS.maxReferences),
    from: z.object({ name: z.string().max(MATTER_LIMITS.nameChars).nullable(), email: emailSchema }).strict(),
    to: z.array(emailSchema).max(MATTER_LIMITS.maxRecipients),
    cc: z.array(emailSchema).max(MATTER_LIMITS.maxRecipients),
    subject: z.string().max(MATTER_LIMITS.subjectChars),
    text: z.string().max(MATTER_LIMITS.bodyChars),
    at: isoDateTimeSchema,
    /** The email provider's id (outbound: for delivery events; inbound: for dedupe). */
    providerId: z.string().min(1).max(128).nullable(),
    /** Inbound only: our own sender check (A2); null for outbound and for A1 emails. */
    auth: emailAuthSchema.nullable(),
    // ---- A2 inbound fields (defaults keep A1 messages readable) ----
    senderRole: z.enum(SENDER_ROLES).nullable().default(null),
    /** An automatic reply (out of office, Auto-Submitted, bulk): stored, never answered. */
    autoReply: z.boolean().default(false),
    attachments: z.array(attachmentInfoSchema).max(MATTER_LIMITS.maxAttachments).default([]),
    readState: z.enum(READ_STATES).nullable().default(null),
    readAttempts: z.number().int().min(0).default(0),
    readClaimedAt: isoDateTimeSchema.nullable().default(null),
    /** What the read decided, as a category (the intent, or why it was not read). */
    readOutcome: z.string().max(40).nullable().default(null),
  })
  .strict();

export type MatterMessage = z.input<typeof matterMessageSchema>;
/** A stored message as read back (defaults applied, an unknown field dropped). */
export const matterMessageReadSchema = matterMessageSchema.strip();
export type StoredMessage = z.output<typeof matterMessageSchema>;

// ---------------------------------------------------------------------------------------------
// Approval cards and proposed commitments (A2)
// ---------------------------------------------------------------------------------------------

/** Where an approved reply draft's send stands (the matterConfirm pattern, per card). */
export const CARD_SEND_STATES = ['none', 'sending', 'sent', 'failed', 'unknown'] as const;

export const draftEmailSchema = z
  .object({
    to: z.array(emailSchema).min(1).max(MATTER_LIMITS.maxRecipients),
    cc: z.array(emailSchema).max(MATTER_LIMITS.maxRecipients),
    subject: z.string().min(1).max(MATTER_LIMITS.subjectChars),
    /** The whole body as sent (signature and footer included). */
    text: z.string().min(1).max(MATTER_LIMITS.bodyChars),
  })
  .strict();
export type DraftEmail = z.infer<typeof draftEmailSchema>;

export const threadingSchema = z
  .object({ inReplyTo: messageIdSchema.nullable(), references: z.array(messageIdSchema).max(MATTER_LIMITS.maxReferences) })
  .strict();
export type Threading = z.infer<typeof threadingSchema>;

export const matterApprovalSchema = z
  .object({
    kind: z.enum(MATTER_APPROVAL_KINDS),
    status: z.enum(MATTER_APPROVAL_STATUSES),
    reason: z.enum(MATTER_APPROVAL_REASONS).nullable(),
    quote: z.string().max(MATTER_LIMITS.quoteChars).nullable(),
    from: z.string().max(400).nullable(),
    draft: draftEmailSchema.nullable(),
    draftHash: z.string().regex(DRAFT_HASH_PATTERN).nullable(),
    threading: threadingSchema.nullable(),
    guardFlags: z.array(z.enum(MATTER_GUARD_FLAGS)).max(MATTER_GUARD_FLAGS.length),
    sendOutcome: z.enum(MATTER_SEND_OUTCOMES).nullable(),
    sendState: z.enum(CARD_SEND_STATES),
    sendClaimedAt: isoDateTimeSchema.nullable(),
    auto: z.boolean(),
    /** The inbound message the card is about (messages/{id}); null for a bounce. */
    sourceMessageId: z.string().min(1).max(128).nullable(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    decidedAt: isoDateTimeSchema.nullable(),
  })
  .strict();
export type MatterApproval = z.infer<typeof matterApprovalSchema>;
export const matterApprovalReadSchema = matterApprovalSchema.strip();

export const matterProposalSchema = z
  .object({
    quote: z.string().min(1).max(MATTER_LIMITS.quoteChars),
    title: z.string().min(1).max(COMMITMENT_LIMITS.maxTitleChars),
    owner: commitmentOwnerSchema.nullable(),
    due: commitmentDueSchema.nullable(),
    status: z.enum(COMMITMENT_STATUSES),
    taskId: z.string().regex(MEETING_ID_PATTERN).nullable(),
    sourceMessageId: z.string().min(1).max(128),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    decidedAt: isoDateTimeSchema.nullable(),
  })
  .strict();
export type MatterProposal = z.infer<typeof matterProposalSchema>;
export const matterProposalReadSchema = matterProposalSchema.strip();

/** The hash of one exact reply draft (and its threading): approving names the version shown. */
export function draftEmailHash(draft: DraftEmail, threading: Threading): string {
  return createHash('sha256').update(canonicalJson({ draft, threading })).digest('hex');
}

/**
 * A proposed commitment's id, which is also its task's id once accepted: "mt_" plus a hash of the
 * matter, the message and the position, so a re-read of the same reply never makes a second one.
 */
export function proposalIdFor(matterId: string, messageId: string, index: number): string {
  return `mt_${createHash('sha256').update(`${matterId}:${messageId}:${index}`).digest('hex').slice(0, 24)}`;
}

/** matterSchedule/{matterId}: when matterTick looks at the matter next. */
export const matterScheduleSchema = z
  .object({ uid: z.string().min(1).max(128), matterId: z.string().min(1).max(128), nextActionAt: isoDateTimeSchema })
  .strict();
export type MatterSchedule = z.infer<typeof matterScheduleSchema>;

/** matterReadQueue/{matterId_messageId}: a read claimed (or failed) that matterTick may retry. */
export const matterReadQueueSchema = z
  .object({
    uid: z.string().min(1).max(128),
    matterId: z.string().min(1).max(128),
    messageId: z.string().min(1).max(128),
    /** The claim's time, or the time a failed read may be retried from. */
    claimedAt: isoDateTimeSchema,
    attempts: z.number().int().min(0),
  })
  .strict();
export type MatterReadQueue = z.infer<typeof matterReadQueueSchema>;

// ---------------------------------------------------------------------------------------------
// Lookup documents (server only)
// ---------------------------------------------------------------------------------------------

/** matterAddresses/{token}: which matter a reply address belongs to. */
export const matterAddressSchema = z
  .object({ uid: z.string().min(1).max(128), matterId: z.string().min(1).max(128), createdAt: isoDateTimeSchema })
  .strict();

/**
 * matterMessageIds/{messageIdKey}: which matter an email WE sent belongs to (In-Reply-To /
 * References of a reply point at it). Only our own outgoing Message-IDs are indexed, each with
 * create(): an inbound email never writes here, so a sender cannot re-point another user's thread.
 */
export const matterMessageIdSchema = z
  .object({ uid: z.string().min(1).max(128), matterId: z.string().min(1).max(128), createdAt: isoDateTimeSchema })
  .strict();

// ---------------------------------------------------------------------------------------------
// Ids and addresses
// ---------------------------------------------------------------------------------------------

/** A new reply-address token (unguessable: replies are matched to a matter by it). */
export function newReplyToken(): string {
  return randomBytes(12).toString('hex');
}

/** The local part of a matter's reply address: m-<token>. */
const REPLY_LOCAL_PATTERN = /^m-([a-f0-9]{24})$/;

export function replyAddressFor(token: string, domain: string): string {
  if (!REPLY_TOKEN_PATTERN.test(token)) throw new Error('Invalid reply token.');
  return `m-${token}@${domain.toLowerCase()}`;
}

/**
 * The token of a reply address on our domain, or null for any other address. Case-insensitive
 * (some mail systems change the case of the local part) and tolerant of a display name.
 */
export function replyTokenFromAddress(address: string, domain: string): string | null {
  const bare = (address.match(/<([^>]+)>/)?.[1] ?? address).trim().toLowerCase();
  const at = bare.lastIndexOf('@');
  if (at <= 0 || bare.slice(at + 1) !== domain.toLowerCase()) return null;
  return REPLY_LOCAL_PATTERN.exec(bare.slice(0, at))?.[1] ?? null;
}

/** Whether an address is on our own mail domain or a subdomain of it (never a contact, never a sender). */
export function isOwnDomain(address: string, domain: string): boolean {
  const host = address.trim().toLowerCase().split('@').pop() ?? '';
  const own = domain.trim().toLowerCase();
  return own.length > 0 && (host === own || host.endsWith(`.${own}`));
}

/**
 * The document id for a Message-ID (matterMessageIds): sha256 of the id without its angle
 * brackets and surrounding space. Message-IDs can hold characters Firestore ids cannot.
 */
export function messageIdKey(rfcMessageId: string): string {
  const bare = rfcMessageId.trim().replace(/^<|>$/g, '').trim();
  return createHash('sha256').update(bare).digest('hex');
}
