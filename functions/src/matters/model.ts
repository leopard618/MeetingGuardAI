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
 *   matterAddresses/{token}                          reply address -> matter, server only
 *   matterMessageIds/{messageIdKey}                  Message-ID -> matter (threading), server only
 *   inboundEmails/{providerId}                       inbound dedupe marker, server only
 * Under users/{uid}, so deleteAccount's recursive delete removes the matters with the account;
 * the two lookup collections carry the uid and are removed by deleteAccount as well.
 *
 * Pure module: schemas, limits, ids and helpers only (no Firebase, no network).
 */
import { createHash, randomBytes } from 'node:crypto';

import { z } from 'zod';

import {
  DRAFT_HASH_PATTERN,
  MATTER_SOURCES,
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

export const matterPath = (uid: string, matterId: string) => `users/${uid}/${MATTERS_SUBCOLLECTION}/${matterId}`;
export const matterEventPath = (uid: string, matterId: string, eventId: string) =>
  `${matterPath(uid, matterId)}/${MATTER_EVENTS_SUBCOLLECTION}/${eventId}`;
export const matterMessagePath = (uid: string, matterId: string, messageId: string) =>
  `${matterPath(uid, matterId)}/${MATTER_MESSAGES_SUBCOLLECTION}/${messageId}`;

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
  readBackChars: 2000,
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

/** The secret part of a matter's reply address: 96 random bits, lowercase hex (case-safe in email). */
export const REPLY_TOKEN_PATTERN = /^[a-f0-9]{24}$/;

export const matterDocSchema = z
  .object({
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
    replyToken: z.string().regex(REPLY_TOKEN_PATTERN),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    /** When it became done or cancelled. */
    endedAt: isoDateTimeSchema.nullable(),
  })
  .strict();

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
  'email_received',
  'status_changed',
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

/** Results of the sender checks on an inbound email (computed by our code from the raw message). */
export const AUTH_VERDICTS = ['pass', 'fail', 'softfail', 'neutral', 'none', 'temperror', 'permerror'] as const;

export const emailAuthSchema = z
  .object({
    spf: z.enum(AUTH_VERDICTS),
    dkim: z.enum(AUTH_VERDICTS),
    dmarc: z.enum(AUTH_VERDICTS),
  })
  .strict();

export const MESSAGE_DIRECTIONS = ['outbound', 'inbound'] as const;
export const MESSAGE_STATUSES = ['sending', 'sent', 'failed', 'received'] as const;

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
    /** Inbound only: our own SPF, DKIM and DMARC checks. */
    auth: emailAuthSchema.nullable(),
  })
  .strict();

export type MatterMessage = z.infer<typeof matterMessageSchema>;

// ---------------------------------------------------------------------------------------------
// Lookup documents (server only)
// ---------------------------------------------------------------------------------------------

/** matterAddresses/{token}: which matter a reply address belongs to. */
export const matterAddressSchema = z
  .object({ uid: z.string().min(1).max(128), matterId: z.string().min(1).max(128), createdAt: isoDateTimeSchema })
  .strict();

/** matterMessageIds/{messageIdKey}: which matter an email we sent or received belongs to. */
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

/**
 * The document id for a Message-ID (matterMessageIds): sha256 of the id without its angle
 * brackets and surrounding space. Message-IDs can hold characters Firestore ids cannot.
 */
export function messageIdKey(rfcMessageId: string): string {
  const bare = rfcMessageId.trim().replace(/^<|>$/g, '').trim();
  return createHash('sha256').update(bare).digest('hex');
}
