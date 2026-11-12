/**
 * M10 stored summary model (docs/v2/M10-DESIGN.md section 4 steps 9 to 16, section 5 trust facts
 * and the refused row, section 7, section 8 sealed content, findings 5, 7 and 10). PURE: zod and
 * node:crypto (through sealed.ts) only; no Firebase imports, no logging, no clock (callers pass
 * `now`). The transactions that write these documents are in store.ts.
 *
 * Documents:
 * - users/{uid}/meetingSummaries/{summaryId}: one accepted or inbox summary (StoredSummaryDoc).
 *   summaryId = sha256 hex of `mg-sum:v1:` + uid + `:` + messageKey (summaryIdFor).
 * - users/{uid}/meetingSummaries/refused-YYYY-MM-DD: one refused row per uid and UTC day
 *   (RefusedRowDoc): reason, verified sender domain, first and last time, count. No content.
 * - summaryEvents/{sha256 hex}: dedupe markers {expiresAt} (no uid, no content) and first-seen
 *   records {firstSeenAt, expiresAt}. Keys: firstSeenKey, refusalMarkerKey, messageMarkerKey,
 *   digestMarkerKey, deletionMarkerKey; each is sha256 hex of its own versioned prefix, so the
 *   kinds never collide.
 *
 * Plaintext on a summary is structure, never content: status, reasons, the trust facts, domains,
 * the auth block, times, the match and suggestions (the user's own meeting titles), counts,
 * contentDigest (an HMAC, not the text). Content is in TWO sealed fields so a list never reads the
 * big blob: sealedHead {subject, titleLine, dateLine} and sealedBody {fromAddress, fromName,
 * forwardedBy, text, sections}. Each is sealed with AES-256-GCM under the content subkey with the
 * AAD summaryAad({uid, summaryId}) + ':head' or + ':body', so a blob moved to another user or
 * document, or a head swapped with a body, fails to open.
 *
 * The 1 MiB Firestore document limit: buildSummaryDoc estimates the encoded document size and,
 * over SUMMARY_DOC_SAFE_BYTES, first drops item text in favour of offsets (itemTextFromOffsets;
 * openSummaryBody rebuilds each item as text.slice(start, end)), then cuts the text at a line
 * boundary (truncated). It never fails a summary for size.
 *
 * Product text rule: ASCII punctuation only in this file.
 */
import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  LOCAL_DATE_KEY_PATTERN,
  MEETING_ID_PATTERN,
  SUMMARY_ID_PATTERN,
  SUMMARY_INBOX_REASONS,
  SUMMARY_LIMITS,
  SUMMARY_MATCH_METHODS,
  SUMMARY_REFUSED_REASONS,
  SUMMARY_SECTION_KINDS,
  SUMMARY_TIERS,
  isoDateTimeSchema,
  summaryAddrSpecSchema,
  summaryDomainSchema,
  type SummaryInboxReason,
  type SummaryRefusedReason,
  type SummaryTier,
} from '../shared/aiContract';
import { SUMMARY_CONTENT_PURPOSE, SealedError, contentDigest, open, seal, summaryAad, type Keyring } from '../shared/sealed';
import type { Classification, NormalizedArc, SignatureResult } from './authenticity';
import type { MatchRecord, StoredSummaryMatch, SummaryMatchCandidate } from './match';
import { sliceSafe } from './sanitize';
import { ITEM_FLAGS, SECTION_FLAGS, type ParsedSections, type SummaryMeta, type SummarySection } from './sections';

// ---------------------------------------------------------------------------------------------
// Versions, collections, retention
// ---------------------------------------------------------------------------------------------

/** Stored on every summary and refused row; bump on an incompatible change of either shape. */
export const SUMMARY_SCHEMA_VERSION = 1;

/** Subcollection under users/{uid} (both recursiveDelete passes of deleteAccount cover it). */
export const MEETING_SUMMARIES_COLLECTION = 'meetingSummaries';
/** Root, server-only: dedupe markers and first-seen records. */
export const SUMMARY_EVENTS_COLLECTION = 'summaryEvents';

/**
 * Retention in days (design section 7; proposals for Francisco, M11 adds the user-facing rules).
 * expiresAt is set at receipt from receivedAt (summaries) or from the write time (rows, markers),
 * and the daily maintenance purges past it. firstSeen is the receipt-time record a Postmark retry
 * reads back (store.ts recordFirstSeen); Postmark stops retrying long before it expires.
 */
export const SUMMARY_RETENTION_DAYS = {
  filedOrKept: 365,
  inbox: 60,
  refused: 30,
  markers: 35,
  gmailRequests: 2,
  firstSeen: 2,
} as const;

/**
 * The only daily cap (finding 5): refusals per uid and UTC day; accepted mail is never capped. The
 * contract's SUMMARY_LIMITS.maxRefusalsPerDay, so summaryStatus refusedToday.capped agrees with it.
 */
export const SUMMARY_REFUSALS_PER_UTC_DAY: number = SUMMARY_LIMITS.maxRefusalsPerDay;

/** Firestore's hard document limit and the bound buildSummaryDoc keeps under. */
export const FIRESTORE_MAX_DOC_BYTES = 1_048_576;
export const SUMMARY_DOC_SAFE_BYTES = 900 * 1024;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Firebase uids never contain '/', so a uid can never splice extra path segments (address.ts). */
export const SUMMARY_UID_PATTERN = /^[^/]{1,128}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const UTC_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** `from` plus `days` days, as an ISO string. */
export function addDaysIso(from: Date | string, days: number): string {
  const ms = typeof from === 'string' ? Date.parse(from) : from.getTime();
  if (!Number.isFinite(ms)) throw new Error('summaries.model: invalid date');
  return new Date(ms + days * DAY_MS).toISOString();
}

/** expiresAt of a summary: filed or kept 365 days, inbox 60 days, both from receivedAt. */
export function summaryExpiresAt(status: StoredSummaryStatus, receivedAt: Date | string): string {
  return addDaysIso(receivedAt, status === 'inbox' ? SUMMARY_RETENTION_DAYS.inbox : SUMMARY_RETENTION_DAYS.filedOrKept);
}

/** expiresAt of a refused row, written at each refusal: 30 days after the latest one. */
export function refusedRowExpiresAt(now: Date): string {
  return addDaysIso(now, SUMMARY_RETENTION_DAYS.refused);
}

/** expiresAt of a dedupe marker (Message-ID, content digest, refusal, deletion): 35 days. */
export function markerExpiresAt(now: Date): string {
  return addDaysIso(now, SUMMARY_RETENTION_DAYS.markers);
}

/** expiresAt of a first-seen record: 2 days. */
export function firstSeenExpiresAt(now: Date): string {
  return addDaysIso(now, SUMMARY_RETENTION_DAYS.firstSeen);
}

/** When a Gmail confirmation request stops being shown: 2 days after it arrived. */
export function gmailRequestExpiresAt(receivedAt: Date | string): string {
  return addDaysIso(receivedAt, SUMMARY_RETENTION_DAYS.gmailRequests);
}

/** The UTC day key YYYY-MM-DD. */
export function utcDayOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Document paths (the uid must match SUMMARY_UID_PATTERN; callers validate before building). */
export function summaryDocPath(uid: string, summaryId: string): string {
  return `users/${uid}/${MEETING_SUMMARIES_COLLECTION}/${summaryId}`;
}

export function summaryEventPath(key: string): string {
  return `${SUMMARY_EVENTS_COLLECTION}/${key}`;
}

// ---------------------------------------------------------------------------------------------
// Ids and keys
// ---------------------------------------------------------------------------------------------

function sha256Hex(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Longest Message-ID kept as a key (the RFC 5322 line limit); a longer one falls back. */
export const MAX_MESSAGE_ID_CHARS = 998;
/** Longest b= value kept as a key; a longer one falls back to the raw hash. */
export const MAX_SIGNATURE_VALUE_CHARS = 8192;

/**
 * A Message-ID header value as a key, or null. Trimmed, one pair of angle brackets removed (and
 * the inside trimmed), then it must be 1 to 998 visible ASCII characters without whitespace or
 * angle brackets. Case is KEPT: msg-id comparison is by string (RFC 5322 section 3.6.4) and
 * common ids are base64 (Gmail's "CA...@mail.gmail.com"), so lowercasing could merge two
 * different messages into one summary. Relays do not change a Message-ID's case, so two copies
 * of one message still share the key. Anything else (comments, folding inside, several ids)
 * gives null and the caller falls back to the signature.
 */
export function normalizeMessageId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  let id = value.trim();
  if (id.startsWith('<') && id.endsWith('>')) id = id.slice(1, -1).trim();
  if (id.length === 0 || id.length > MAX_MESSAGE_ID_CHARS) return null;
  for (let index = 0; index < id.length; index += 1) {
    const code = id.charCodeAt(index);
    if (code <= 0x20 || code >= 0x7f || code === 0x3c || code === 0x3e) return null;
  }
  return id;
}

/** A DKIM b= value as a key (whitespace removed, base64 only), or null. */
function normalizeSignatureValue(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const compact = value.replace(/\s+/g, '');
  if (compact.length === 0 || compact.length > MAX_SIGNATURE_VALUE_CHARS) return null;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(compact) ? compact : null;
}

export interface MessageKeyInput {
  /** The Message-ID header value (headers.ts header.messageId), or null. */
  messageIdHeader: string | null | undefined;
  /** b= of the deciding signature (NormalizedSignature.signatureValue), or null. */
  decidingSignatureValue: string | null | undefined;
  /** The raw message bytes. */
  raw: Uint8Array;
}

/**
 * Step 11 messageKey: `mid:` + the normalized Message-ID, else `sig:` + the deciding signature's
 * b= value, else `raw:` + sha256 hex of the raw bytes. The source prefix keeps the three kinds
 * apart, so a Message-ID can never equal another message's b= or raw hash. Content-derived:
 * never log it (log only its source, `messageKey.slice(0, 3)`).
 */
export function messageKeyFor(input: MessageKeyInput): string {
  const messageId = normalizeMessageId(input.messageIdHeader);
  if (messageId !== null) return `mid:${messageId}`;
  const signature = normalizeSignatureValue(input.decidingSignatureValue);
  if (signature !== null) return `sig:${signature}`;
  return `raw:${sha256Hex(input.raw)}`;
}

function assertUid(uid: string): void {
  if (typeof uid !== 'string' || !SUMMARY_UID_PATTERN.test(uid)) throw new Error('summaries.model: invalid uid');
}

/** summaryId: sha256 hex of `mg-sum:v1:` + uid + `:` + messageKey (64 lowercase hex). */
export function summaryIdFor(uid: string, messageKey: string): string {
  assertUid(uid);
  if (typeof messageKey !== 'string' || messageKey.length === 0) throw new Error('summaries.model: invalid messageKey');
  return sha256Hex(`mg-sum:v1:${uid}:${messageKey}`);
}

/** True for an accepted summary's id (64 lowercase hex). */
export function isSummaryId(value: unknown): value is string {
  return typeof value === 'string' && HEX64.test(value);
}

/** The refused row of a UTC day: `refused-2026-11-12` (satisfies SUMMARY_ID_PATTERN). */
export function refusedRowId(utcDay: string): string {
  if (typeof utcDay !== 'string' || !UTC_DAY_PATTERN.test(utcDay)) throw new Error('summaries.model: invalid UTC day');
  const id = `refused-${utcDay}`;
  if (!SUMMARY_ID_PATTERN.test(id)) throw new Error('summaries.model: invalid refused row id');
  return id;
}

/** Postmark MessageID (or another provider event id): visible ASCII, 1 to 256 characters. */
export function isProviderEventId(value: unknown): value is string {
  return typeof value === 'string' && /^[\x21-\x7e]{1,256}$/.test(value);
}

/** summaryEvents key of the first-seen record of one provider delivery. */
export function firstSeenKey(providerEventId: string): string {
  return sha256Hex(`mg-seen:v1:${providerEventId}`);
}

/** summaryEvents key of the refusal dedupe marker (a redelivery never counts twice). */
export function refusalMarkerKey(uid: string, providerEventId: string): string {
  assertUid(uid);
  return sha256Hex(`mg-ref:v1:${uid}:${providerEventId}`);
}

/** summaryEvents key of the message marker (rows 7 and 10 claim it; the key uses messageKey). */
export function messageMarkerKey(uid: string, messageKey: string): string {
  assertUid(uid);
  return sha256Hex(`mg-mid:v1:${uid}:${messageKey}`);
}

/** summaryEvents key of the content-digest marker (rows 7 and 10 claim it; a user delete writes it). */
export function digestMarkerKey(uid: string, digest: string): string {
  assertUid(uid);
  return sha256Hex(`mg-dig:v1:${uid}:${digest}`);
}

/**
 * summaryEvents key of the deletion marker: summaryAction delete writes it in the delete's own
 * transaction, and commitSummary reads it for EVERY row, so a deleted summary is never recreated
 * under its id by a retry, a replay or a better copy of the same message (design section 7).
 */
export function deletionMarkerKey(uid: string, summaryId: string): string {
  assertUid(uid);
  if (typeof summaryId !== 'string' || summaryId.length === 0) throw new Error('summaries.model: invalid summaryId');
  return sha256Hex(`mg-del:v1:${uid}:${summaryId}`);
}

// ---------------------------------------------------------------------------------------------
// Trust rank (upgrades, step 13 and finding 10)
// ---------------------------------------------------------------------------------------------

/** Decision rows that store a summary (section 5). */
export type SummaryRow = 7 | 8 | 9 | 10;

/**
 * Upgrade order: row 7 (vendor signed, bound, fresh) > row 8 (vendor signed, bound, old) > row 10
 * (user forward) > row 9 (vendor signed, not addressed to you).
 * - 7 is the only copy that may file automatically: the notetaker signed it, a listed mailbox is in
 *   a signed To or Cc, and the signed Date is fresh.
 * - 8 is still provably the user's own copy (bound through a signed header); only its age is off.
 * - 10 is vouched for by the user: one of the user's mailboxes signed the forward. The notetaker's
 *   signature did not survive, so the content is only as good as that mailbox.
 * - 9 is genuine notetaker content, but nothing binds it to the user: anyone who learns the private
 *   address (a co-attendee, or a stranger who puts it on his own meeting) can cause it. Binding to
 *   the user (rows 7, 8, 10) outranks vendor origin without binding, because the residual risk of
 *   section 5 is a genuine recap of somebody else's meeting. Row 9 never gets one-tap suggestions.
 * A copy replaces an existing one only with a strictly higher rank; equal ranks are duplicates.
 */
export const TRUST_RANKS: Readonly<Record<SummaryRow, number>> = { 7: 4, 8: 3, 10: 2, 9: 1 };

/** trustRank of a decision row; 0 for rows that never store a summary. */
export function trustRank(row: number): number {
  return row === 7 || row === 8 || row === 9 || row === 10 ? TRUST_RANKS[row] : 0;
}

/** Rows whose copies claim the Message-ID and digest markers (rows 7 and 10 only, finding 10). */
export function claimsMarkers(row: number): boolean {
  return row === 7 || row === 10;
}

/** The ranks that may claim markers (store.ts guards claimMarkers with it). */
export const MARKER_CLAIM_RANKS: ReadonlySet<number> = new Set([TRUST_RANKS[7], TRUST_RANKS[10]]);

/** The decision row a stored summary's trust facts describe. */
export function trustRowOf(trust: Pick<SummaryTrust, 'tier' | 'recipientBound' | 'fresh'>): SummaryRow {
  if (trust.tier === 'user_forwarded') return 10;
  if (!trust.recipientBound) return 9;
  return trust.fresh ? 7 : 8;
}

/** trustRank of a stored summary. */
export function trustRankOf(trust: Pick<SummaryTrust, 'tier' | 'recipientBound' | 'fresh'>): number {
  return TRUST_RANKS[trustRowOf(trust)];
}

// ---------------------------------------------------------------------------------------------
// Stored shapes
// ---------------------------------------------------------------------------------------------

/** Statuses of an accepted summary (refused rows are RefusedRowDoc). */
export const STORED_SUMMARY_STATUSES = ['matched', 'inbox', 'kept'] as const;
export type StoredSummaryStatus = (typeof STORED_SUMMARY_STATUSES)[number];

/** What the user did through summaryAction; a summary with one keeps its status and match on an upgrade. */
export const SUMMARY_USER_ACTIONS = ['attach', 'detach', 'keep'] as const;
export type SummaryUserActionKind = (typeof SUMMARY_USER_ACTIONS)[number];

export const SUMMARY_ANCHOR_SOURCES = ['signed_date', 'forward_wrapper'] as const;
export type SummaryAnchorSource = (typeof SUMMARY_ANCHOR_SOURCES)[number];

const SIGNATURE_RESULTS = ['pass', 'fail', 'neutral', 'policy', 'temperror'] as const satisfies readonly SignatureResult[];
const ARC_RESULTS = ['pass', 'fail', 'none'] as const satisfies readonly NormalizedArc['result'][];
const ZONES_USED = ['meeting', 'preferences', 'utc'] as const;

const meetingIdField = z.string().regex(MEETING_ID_PATTERN);
const localDateField = z.string().regex(LOCAL_DATE_KEY_PATTERN);
const titleField = z.string().max(SUMMARY_LIMITS.maxTitleChars);
const zoneField = z.string().max(64);
/** Bounds on the stored match lists (match.ts produces far fewer; the builder slices to them). */
const MAX_DUPLICATE_IDS = 20;
const MAX_REASON_CODES = 24;
/** "Not this meeting" ids kept on a summary; summaryAction detach keeps the newest this many. */
export const MAX_REJECTED_MEETING_IDS = 50;
/**
 * Upgrade links kept on a summary (mergedIds, mergedDigests), the newest this many each. An upgrade
 * needs a strictly higher trust rank and there are four ranks, so one summary absorbs at most three
 * copies; the bound only guards against a corrupt document.
 */
export const MAX_MERGED_LINKS = 8;
const reasonCodes = z.array(z.string().max(40)).max(MAX_REASON_CODES);
const scoreField = z.number().min(0).max(1);

/** Trust facts, fixed at receipt (finding 7); only an upgrade by a better copy replaces them. */
export const summaryTrustSchema = z.object({
  tier: z.enum(SUMMARY_TIERS),
  /** B: a listed mailbox is in a To or Cc the deciding signature covers. */
  recipientBound: z.boolean(),
  /** The deciding signature covers Date and Date is in the Fresh window. */
  fresh: z.boolean(),
  /** Where anchorAt came from: the signed Date (vendor) or the forward wrapper's Date (unsigned). */
  anchorSource: z.enum(SUMMARY_ANCHOR_SOURCES).nullable(),
  /** The inbox reason at receipt; null when it was filed automatically. */
  originalInboxReason: z.enum(SUMMARY_INBOX_REASONS).nullable(),
});
export type SummaryTrust = z.infer<typeof summaryTrustSchema>;

/** The auth block (authenticity.ts storedAuth): at most 5 signatures, no b= values. */
export const storedAuthSchema = z.object({
  dkim: z
    .array(
      z.object({
        domain: z.string().max(253),
        result: z.enum(SIGNATURE_RESULTS),
        aligned: z.boolean(),
        signsTo: z.boolean(),
        signsDate: z.boolean(),
      }),
    )
    .max(5),
  arc: z.object({ result: z.enum(ARC_RESULTS), sealer: z.string().max(253).nullable() }),
  verifier: z.string().max(64),
});
export type StoredAuth = z.infer<typeof storedAuthSchema>;

export const storedMeetingSnapshotSchema = z.object({
  title: titleField,
  startAt: isoDateTimeSchema,
  endAt: isoDateTimeSchema,
  timezone: zoneField,
});

/**
 * The stored match (design section 6, Stored). method 'auto' comes from rule A (match.ts
 * StoredSummaryMatch); 'user' from summaryAction attach, which may leave the scores null when the
 * meeting was not a suggestion.
 */
export const storedMatchSchema = z.object({
  meetingId: meetingIdField,
  occurrenceDate: localDateField.nullable(),
  duplicateMeetingIds: z.array(meetingIdField).max(MAX_DUPLICATE_IDS),
  method: z.enum(SUMMARY_MATCH_METHODS),
  score: scoreField.nullable(),
  titleScore: scoreField.nullable(),
  timeScore: scoreField.nullable(),
  reasons: reasonCodes,
  zoneUsed: z.enum(ZONES_USED).nullable(),
  matchedAt: isoDateTimeSchema,
  meetingSnapshot: storedMeetingSnapshotSchema,
});
export type StoredMatch = z.infer<typeof storedMatchSchema>;

/** A stored suggestion (match.ts SummaryMatchCandidate). */
export const storedCandidateSchema = z.object({
  meetingId: meetingIdField,
  occurrenceDate: localDateField.nullable(),
  duplicateMeetingIds: z.array(meetingIdField).max(MAX_DUPLICATE_IDS),
  title: titleField,
  startAt: isoDateTimeSchema,
  endAt: isoDateTimeSchema,
  timezone: zoneField,
  score: scoreField,
  titleScore: scoreField,
  timeScore: scoreField,
  reasons: reasonCodes,
  zoneUsed: z.enum(ZONES_USED).nullable(),
  cancelled: z.boolean(),
  allDay: z.boolean(),
});
export type StoredCandidate = z.infer<typeof storedCandidateSchema>;

export const summaryUserActionSchema = z.object({
  kind: z.enum(SUMMARY_USER_ACTIONS),
  at: isoDateTimeSchema,
});
export type SummaryUserAction = z.infer<typeof summaryUserActionSchema>;

const countField = z.number().int().min(0);

/**
 * users/{uid}/meetingSummaries/{summaryId}. Plaintext structure plus the two sealed fields.
 * Parsing keeps unknown fields (a later version, or M11's extraction), so a read-modify-write never
 * drops them; writers should still change single top-level fields with update().
 */
export const storedSummarySchema = z.looseObject({
  schemaVersion: z.number().int().min(1),
  parserVersion: z.number().int().min(0),
  status: z.enum(STORED_SUMMARY_STATUSES),
  /** Why it waits (status inbox); null otherwise. */
  inboxReason: z.enum(SUMMARY_INBOX_REASONS).nullable(),
  /** Always null on a summary (refused rows are a separate shape). */
  refusedReason: z.null(),
  trust: summaryTrustSchema,
  /** The d= of the deciding passing signature (finding 17), or null. */
  senderDomain: summaryDomainSchema.nullable(),
  /** The listed sender address's domain for vendor mail; null for user forwards. */
  vendorDomain: summaryDomainSchema.nullable(),
  auth: storedAuthSchema,
  /** First-seen receipt time (a Postmark retry keeps it). */
  receivedAt: isoDateTimeSchema,
  /** The message's Date header, or null. */
  sentAt: isoDateTimeSchema.nullable(),
  /** The matching anchor: the signed Date (vendor) or the forward wrapper's Date (user forward). */
  anchorAt: isoDateTimeSchema.nullable(),
  /** YYYY-MM-DD found in the summary, or null. */
  summaryDate: localDateField.nullable(),
  /** Free string (M12 adds languages); null when unknown. */
  language: z.string().min(1).max(35).nullable(),
  match: storedMatchSchema.nullable(),
  candidates: z.array(storedCandidateSchema).max(SUMMARY_LIMITS.maxSuggestions),
  rejectedMeetingIds: z.array(meetingIdField).max(MAX_REJECTED_MEETING_IDS),
  counts: z.object({ sections: countField, items: countField, textChars: countField }),
  flags: z.object({
    /** Any cut: the sanitizer's text cap, the section or item caps, or the size fallback. */
    truncated: z.boolean(),
    /** The size fallback cut the text at a line boundary. */
    textCutForSize: z.boolean(),
    /** Item text was dropped for size; readers rebuild it as text.slice(start, end). */
    itemTextFromOffsets: z.boolean(),
    /** The whole-text scan found instruction-like phrasing (M11 never pre-selects such items). */
    possibleInstruction: z.boolean(),
    /**
     * The text was converted from the message's HTML part (htmlText.ts: an HTML-only message, or a
     * plain part that was blank). Written only when true, so a summary from a text/plain part keeps
     * the four flags above; an upgrade replaces the flags with the better copy's.
     */
    textFromHtml: z.literal(true).optional(),
  }),
  /** HMAC-SHA256 hex of the text under the digest subkey (sealed.ts contentDigest). */
  contentDigest: z.string().regex(HEX64),
  /**
   * Ids of copies with ANOTHER id that upgraded this summary in place (store.ts commitSummary),
   * oldest first, at most MAX_MERGED_LINKS. A user delete writes a deletion marker for each, so a
   * resend of such a copy under its own Message-ID never brings the summary back (section 7).
   * Absent on a summary no other copy upgraded.
   */
  mergedIds: z.array(z.string().regex(HEX64)).max(MAX_MERGED_LINKS).optional(),
  /**
   * The contentDigest values an upgrade replaced, oldest first, at most MAX_MERGED_LINKS. A user
   * delete writes the digest marker of each, so the earlier content under another Message-ID is
   * not recreated either. Absent when no upgrade changed the digest.
   */
  mergedDigests: z.array(z.string().regex(HEX64)).max(MAX_MERGED_LINKS).optional(),
  userAction: summaryUserActionSchema.nullable(),
  /** Reserved for M11; null in M10. */
  extraction: z.unknown().nullable(),
  sealedHead: z.string().min(1),
  sealedBody: z.string().min(1),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema,
});
export type StoredSummaryDoc = z.infer<typeof storedSummarySchema>;

/** users/{uid}/meetingSummaries/refused-YYYY-MM-DD: no subject, no addresses, no body. */
export const refusedRowSchema = z.looseObject({
  status: z.literal('refused'),
  /** The latest refusal's reason that day. */
  refusedReason: z.enum(SUMMARY_REFUSED_REASONS),
  /** The d= of a PASSING signature of the latest refusal, else null ("an unknown sender"). */
  senderDomain: summaryDomainSchema.nullable(),
  firstAt: isoDateTimeSchema,
  lastAt: isoDateTimeSchema,
  count: z.number().int().min(1),
  expiresAt: isoDateTimeSchema,
  schemaVersion: z.number().int().min(1),
});
export type RefusedRowDoc = z.infer<typeof refusedRowSchema>;

/** A summary, or null for anything that does not parse (a refused row, a corrupt document). */
export function parseStoredSummary(raw: unknown): StoredSummaryDoc | null {
  const parsed = storedSummarySchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** A refused row, or null. */
export function parseRefusedRow(raw: unknown): RefusedRowDoc | null {
  const parsed = refusedRowSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** A row of the meetingSummaries collection by its kind; null when it is neither shape. */
export function parseSummaryRecord(
  raw: unknown,
): { kind: 'summary'; doc: StoredSummaryDoc } | { kind: 'refused'; doc: RefusedRowDoc } | null {
  const status = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).status : undefined;
  if (status === 'refused') {
    const doc = parseRefusedRow(raw);
    return doc === null ? null : { kind: 'refused', doc };
  }
  const doc = parseStoredSummary(raw);
  return doc === null ? null : { kind: 'summary', doc };
}

// ---------------------------------------------------------------------------------------------
// Sealed content
// ---------------------------------------------------------------------------------------------

export interface SummaryRef {
  uid: string;
  summaryId: string;
}

/** Caps applied before sealing (the contract's detail limits). */
export const SEALED_LIMITS = {
  subjectChars: SUMMARY_LIMITS.maxSubjectChars,
  titleLineChars: SUMMARY_LIMITS.maxTitleChars,
  dateLineChars: SUMMARY_LIMITS.maxTitleChars,
  fromNameChars: 200,
} as const;

/** sealedHead: what a list shows. */
export const summaryHeadSchema = z.object({
  subject: z.string().max(SEALED_LIMITS.subjectChars).nullable(),
  titleLine: z.string().max(SEALED_LIMITS.titleLineChars).nullable(),
  dateLine: z.string().max(SEALED_LIMITS.dateLineChars).nullable(),
});
export type SummaryHead = z.infer<typeof summaryHeadSchema>;

const offsetField = z.number().int().min(0).max(SUMMARY_LIMITS.maxTextChars);

/** A sealed item: `text` is absent when the document was degraded to offsets. */
const sealedItemSchema = z.object({
  id: z.string().regex(SUMMARY_ID_PATTERN),
  text: z.string().max(SUMMARY_LIMITS.maxItemChars).optional(),
  start: offsetField,
  end: offsetField,
  checked: z.boolean().nullable(),
  owner: z.string().max(SUMMARY_LIMITS.maxItemFieldChars).nullable(),
  dueText: z.string().max(SUMMARY_LIMITS.maxItemFieldChars).nullable(),
  flags: z.array(z.enum(ITEM_FLAGS)).max(ITEM_FLAGS.length),
});
export type StoredSummaryItem = z.infer<typeof sealedItemSchema>;

const sealedSectionSchema = z.object({
  id: z.string().regex(SUMMARY_ID_PATTERN),
  kind: z.enum(SUMMARY_SECTION_KINDS),
  heading: z.string().max(SUMMARY_LIMITS.maxHeadingChars).nullable(),
  derived: z.boolean(),
  start: offsetField,
  end: offsetField,
  flags: z.array(z.enum(SECTION_FLAGS)).max(SECTION_FLAGS.length),
  items: z.array(sealedItemSchema).max(SUMMARY_LIMITS.maxItems),
});
export type StoredSummarySection = z.infer<typeof sealedSectionSchema>;

const sealedBodySchema = z.object({
  fromAddress: summaryAddrSpecSchema.nullable(),
  fromName: z.string().max(SEALED_LIMITS.fromNameChars).nullable(),
  forwardedBy: summaryAddrSpecSchema.nullable(),
  text: z.string().min(1).max(SUMMARY_LIMITS.maxTextChars),
  sections: z.array(sealedSectionSchema).max(SUMMARY_LIMITS.maxSections),
  itemTextFromOffsets: z.boolean(),
});
export type StoredSummaryBody = z.infer<typeof sealedBodySchema>;

/** sealedBody content as callers give it (sections from parseSections, item text included). */
export interface SummaryBodyInput {
  fromAddress: string | null;
  fromName: string | null;
  forwardedBy: string | null;
  text: string;
  sections: readonly SummarySection[];
}

/** sealedBody as openSummaryBody returns it: every item has its text (rebuilt when needed). */
export interface SummaryBody {
  fromAddress: string | null;
  fromName: string | null;
  forwardedBy: string | null;
  text: string;
  sections: SummarySection[];
  /** The stored copy kept offsets only (the size fallback); the texts were rebuilt here. */
  itemTextFromOffsets: boolean;
}

export interface SummaryContent {
  head: SummaryHead;
  body: SummaryBodyInput;
}

export interface SealedSummaryFields {
  sealedHead: string;
  sealedBody: string;
}

function headAad(ref: SummaryRef): string {
  return `${summaryAad(ref)}:head`;
}

function bodyAad(ref: SummaryRef): string {
  return `${summaryAad(ref)}:body`;
}

function capped(value: string | null | undefined, max: number): string | null {
  if (typeof value !== 'string') return null;
  const cut = sliceSafe(value, max);
  return cut.length > 0 ? cut : null;
}

function addrOrNull(value: string | null | undefined): string | null {
  return typeof value === 'string' && summaryAddrSpecSchema.safeParse(value).success ? value : null;
}

function headFor(head: SummaryHead): SummaryHead {
  return {
    subject: capped(head.subject, SEALED_LIMITS.subjectChars),
    titleLine: capped(head.titleLine, SEALED_LIMITS.titleLineChars),
    dateLine: capped(head.dateLine, SEALED_LIMITS.dateLineChars),
  };
}

function sealedItemOf(item: SummarySection['items'][number], text: string, offsetsOnly: boolean): StoredSummaryItem {
  // Only an item that the offsets reproduce exactly loses its text; any other keeps it (no loss).
  const dropText = offsetsOnly && text.slice(item.start, item.end) === item.text;
  const sealed: StoredSummaryItem = {
    id: item.id,
    start: item.start,
    end: item.end,
    checked: item.checked,
    owner: item.owner,
    dueText: item.dueText,
    flags: [...item.flags],
  };
  if (!dropText) sealed.text = item.text;
  return sealed;
}

function sealedBodyOf(body: SummaryBodyInput, offsetsOnly: boolean): StoredSummaryBody {
  return {
    fromAddress: addrOrNull(body.fromAddress),
    fromName: capped(body.fromName, SEALED_LIMITS.fromNameChars),
    forwardedBy: addrOrNull(body.forwardedBy),
    text: body.text,
    sections: body.sections.map((section) => ({
      id: section.id,
      kind: section.kind,
      heading: section.heading,
      derived: section.derived,
      start: section.start,
      end: section.end,
      flags: [...section.flags],
      items: section.items.map((item) => sealedItemOf(item, body.text, offsetsOnly)),
    })),
    itemTextFromOffsets: offsetsOnly,
  };
}

function sealJson(keyring: Keyring, value: unknown, aad: string): string {
  return seal(keyring, SUMMARY_CONTENT_PURPOSE, JSON.stringify(value), aad);
}

function sealBodyValue(keyring: Keyring, ref: SummaryRef, body: StoredSummaryBody): string {
  const checked = sealedBodySchema.safeParse(body);
  if (!checked.success) throw new Error('summaries.model: the summary body does not match the sealed schema');
  return sealJson(keyring, checked.data, bodyAad(ref));
}

function sealHeadValue(keyring: Keyring, ref: SummaryRef, head: SummaryHead): string {
  return sealJson(keyring, headFor(head), headAad(ref));
}

/**
 * Seals head and body for one summary. Item text is kept (no size fallback here; buildSummaryDoc
 * applies it). Throws SealedError for a bad keyring or ref, and a plain Error when the body is
 * not storable (empty text, offsets outside the schema limits).
 */
export function sealSummaryContent(keyring: Keyring, ref: SummaryRef, content: SummaryContent): SealedSummaryFields {
  return {
    sealedHead: sealHeadValue(keyring, ref, content.head),
    sealedBody: sealBodyValue(keyring, ref, sealedBodyOf(content.body, false)),
  };
}

function parseSealedJson<T>(schema: z.ZodType<T>, plaintext: string, what: string): T {
  let value: unknown;
  try {
    value = JSON.parse(plaintext);
  } catch {
    throw new SealedError('blob_malformed', `sealed summary ${what} is not valid`);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new SealedError('blob_malformed', `sealed summary ${what} is not valid`);
  return parsed.data;
}

/** Opens sealedHead. Throws SealedError (open_failed for a wrong ref or a body blob, blob_malformed for bad content). */
export function openSummaryHead(keyring: Keyring, ref: SummaryRef, blob: string): SummaryHead {
  return parseSealedJson(summaryHeadSchema, open(keyring, SUMMARY_CONTENT_PURPOSE, blob, headAad(ref)), 'head');
}

/**
 * Opens sealedBody and rebuilds item text dropped for size (text.slice(start, end)). Throws
 * SealedError: open_failed for a wrong ref or a head blob, blob_malformed when the content does
 * not parse or an offset lies outside the text.
 */
export function openSummaryBody(keyring: Keyring, ref: SummaryRef, blob: string): SummaryBody {
  const body = parseSealedJson(sealedBodySchema, open(keyring, SUMMARY_CONTENT_PURPOSE, blob, bodyAad(ref)), 'body');
  const length = body.text.length;
  let items = 0;
  const sections: SummarySection[] = body.sections.map((section) => {
    if (section.start > section.end || section.end > length) throw new SealedError('blob_malformed', 'sealed summary body is not valid');
    return {
      ...section,
      items: section.items.map((item) => {
        if (item.start > item.end || item.end > length) throw new SealedError('blob_malformed', 'sealed summary body is not valid');
        items += 1;
        return { ...item, text: item.text ?? body.text.slice(item.start, item.end) };
      }),
    };
  });
  if (items > SUMMARY_LIMITS.maxItems) throw new SealedError('blob_malformed', 'sealed summary body is not valid');
  return {
    fromAddress: body.fromAddress,
    fromName: body.fromName,
    forwardedBy: body.forwardedBy,
    text: body.text,
    sections,
    itemTextFromOffsets: body.itemTextFromOffsets,
  };
}

// ---------------------------------------------------------------------------------------------
// Size (the 1 MiB document limit)
// ---------------------------------------------------------------------------------------------

/**
 * Firestore's storage size of a value: strings UTF-8 bytes + 1, numbers 8, booleans and null 1,
 * maps the sum of (key bytes + 1 + value), arrays the sum of their values.
 */
export function estimateFirestoreBytes(value: unknown): number {
  if (value === null || value === undefined) return 1;
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf8') + 1;
  if (typeof value === 'number') return 8;
  if (typeof value === 'boolean') return 1;
  if (value instanceof Date) return 8;
  if (Array.isArray(value)) return value.reduce<number>((sum, entry) => sum + estimateFirestoreBytes(entry), 0);
  if (typeof value === 'object') {
    let sum = 0;
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      sum += Buffer.byteLength(key, 'utf8') + 1 + estimateFirestoreBytes(entry);
    }
    return sum;
  }
  return 8;
}

/** Estimated stored size of a document: its name (path segments + 16) plus its fields plus 32. */
export function estimateDocBytes(path: string, data: Record<string, unknown>): number {
  const name = path.split('/').reduce((sum, segment) => sum + Buffer.byteLength(segment, 'utf8') + 1, 16);
  return name + estimateFirestoreBytes(data) + 32;
}

/** A sealed blob's length for a plaintext of `bytes` UTF-8 bytes (base64url plus the frame). */
const SEALED_FRAME_CHARS = 64;
function sealedCharsFor(json: string): number {
  return SEALED_FRAME_CHARS + Math.ceil(Buffer.byteLength(json, 'utf8') / 3) * 4;
}

export type SizeDegradation = 'none' | 'item_text_from_offsets' | 'text_cut';

/** The body after the size fallback: whole, items without text, or text cut too. */
function cutBody(body: StoredSummaryBody, cut: number): StoredSummaryBody {
  const prefix = sliceSafe(body.text, cut);
  const trimmed = prefix.trimEnd();
  const text = trimmed.length > 0 ? trimmed : prefix;
  const length = text.length;
  const sections: StoredSummarySection[] = [];
  for (const section of body.sections) {
    if (section.start >= length) continue;
    if (section.heading !== null && section.start + section.heading.length > length) continue;
    const items = section.items.filter((item) => item.start <= item.end && item.end <= length);
    const clipped = section.end > length || items.length < section.items.length;
    const flags = clipped && !section.flags.includes('truncated') ? [...section.flags, 'truncated' as const] : section.flags;
    sections.push({ ...section, end: Math.min(section.end, length), flags, items });
  }
  return { ...body, text, sections };
}

/** Largest index i in [0, count) with fits(i) true (fits is monotonic: true then false), or -1. */
function lastFitting(count: number, fits: (index: number) => boolean): number {
  let lo = 0;
  let hi = count - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (fits(mid)) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/**
 * The size fallback for sealedBody: whole when its sealed form fits `maxSealedChars`; else item
 * text dropped (rebuilt from offsets on open); else the text cut at the last line boundary that
 * fits (sections clipped, items past the cut dropped). Never throws; a budget too small for one
 * character still returns a one-character body (buildSummaryDoc then checks the hard limit).
 */
export function fitSummaryBody(
  body: SummaryBodyInput,
  maxSealedChars: number,
): { body: StoredSummaryBody; degradation: SizeDegradation } {
  const whole = sealedBodyOf(body, false);
  if (sealedCharsFor(JSON.stringify(whole)) <= maxSealedChars) return { body: whole, degradation: 'none' };
  const offsets = sealedBodyOf(body, true);
  if (sealedCharsFor(JSON.stringify(offsets)) <= maxSealedChars) return { body: offsets, degradation: 'item_text_from_offsets' };

  const fitsAt = (cut: number): boolean => sealedCharsFor(JSON.stringify(cutBody(offsets, cut))) <= maxSealedChars;
  const lineEnds: number[] = [];
  for (let at = offsets.text.indexOf('\n'); at !== -1; at = offsets.text.indexOf('\n', at + 1)) {
    if (at > 0) lineEnds.push(at);
  }
  const line = lastFitting(lineEnds.length, (index) => fitsAt(lineEnds[index] ?? 0));
  if (line >= 0) return { body: cutBody(offsets, lineEnds[line] ?? 0), degradation: 'text_cut' };
  // Not even the first line fits: cut inside it (unreachable with the text and structure caps).
  const firstLineEnd = lineEnds[0] ?? offsets.text.length;
  const chars = lastFitting(firstLineEnd, (index) => fitsAt(index + 1));
  return { body: cutBody(offsets, Math.max(1, chars + 1)), degradation: 'text_cut' };
}

// ---------------------------------------------------------------------------------------------
// buildSummaryDoc
// ---------------------------------------------------------------------------------------------

export interface BuildSummaryDocInput {
  keyring: Keyring;
  uid: string;
  /** summaryIdFor(uid, messageKey). */
  summaryId: string;
  /** classify() result; rows 7 to 10 only (anything else throws). */
  classification: Pick<Classification, 'row' | 'tier' | 'recipientBound' | 'fresh' | 'senderDomain' | 'anchorAt' | 'anchorSource'>;
  /** decide() result. */
  match: MatchRecord;
  /** parseSections(text). */
  sections: ParsedSections;
  /** extractSummaryMeta(text, subject). */
  meta: Pick<SummaryMeta, 'titleLine' | 'dateLine' | 'summaryDate'>;
  /** The stored text (after stripForwardWrapper): every section and item offset points into it. */
  text: string;
  /** sanitizeText(...).truncated. */
  textTruncated: boolean;
  /** The text came from the HTML part (htmlText.ts); stored as flags.textFromHtml. */
  textFromHtml?: boolean;
  /** The sanitized Subject (sanitizeLine), or null. */
  subject: string | null;
  /** The strict header.from addr-spec (never postal-mime's). */
  fromAddress: string | null;
  /** The sanitized display name, or null. */
  fromName: string | null;
  /** storedAuth(signatures, arc). */
  auth: StoredAuth;
  /** The parsed Date header, or null. */
  sentAt: Date | null;
  /** User forwards: the forward wrapper's Date as an instant (an unsigned anchor). Ignored for vendor rows. */
  forwardAnchorAt?: Date | null;
  /** First-seen receipt time (store.ts recordFirstSeen / readFirstSeen). */
  receivedAt: Date;
  language?: string | null;
  now: Date;
  /** Test seam: the safe size bound (default SUMMARY_DOC_SAFE_BYTES). */
  safeBytes?: number;
}

export interface BuiltSummary {
  doc: StoredSummaryDoc;
  /**
   * Seals the same (already size-fitted) content for another summary id: commitSummary calls it
   * when an upgrade lands on an existing copy with a different id (a digest twin).
   */
  reseal(summaryId: string): SealedSummaryFields;
  /** trustRank(classification.row): pass it to commitSummary. */
  rank: number;
  /** Rows 7 and 10: pass it to commitSummary. */
  claimMarkers: boolean;
  degradation: SizeDegradation;
  estimatedBytes: number;
}

const TIER_FOR_ROW: Readonly<Record<SummaryRow, SummaryTier>> = {
  7: 'vendor_verified',
  8: 'vendor_verified',
  9: 'vendor_verified',
  10: 'user_forwarded',
};

/** The inbox reason the trust facts force (match.ts trustInboxReason), used when a record lacks one. */
const ROW_INBOX_REASON: Readonly<Record<SummaryRow, SummaryInboxReason>> = {
  7: 'needs_confirmation',
  8: 'old_summary',
  9: 'not_addressed_to_you',
  10: 'user_forwarded',
};

function isoOrNull(date: Date | null | undefined): string | null {
  return date instanceof Date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function domainOrNull(value: string | null | undefined): string | null {
  return typeof value === 'string' && summaryDomainSchema.safeParse(value).success ? value : null;
}

/** decide()'s match in the stored shape, lists sliced to the stored bounds (summaryRead's re-match reuses it). */
export function storedMatchOf(match: StoredSummaryMatch | null): StoredMatch | null {
  if (match === null) return null;
  return {
    meetingId: match.meetingId,
    occurrenceDate: match.occurrenceDate,
    duplicateMeetingIds: match.duplicateMeetingIds.slice(0, MAX_DUPLICATE_IDS),
    method: match.method,
    score: match.score,
    titleScore: match.titleScore,
    timeScore: match.timeScore,
    reasons: match.reasons.slice(0, MAX_REASON_CODES),
    zoneUsed: match.zoneUsed,
    matchedAt: match.matchedAt,
    meetingSnapshot: { ...match.meetingSnapshot },
  };
}

/** A decide() suggestion in the stored shape (summaryRead's re-match reuses it). */
export function storedCandidateOf(candidate: SummaryMatchCandidate): StoredCandidate {
  return {
    meetingId: candidate.meetingId,
    occurrenceDate: candidate.occurrenceDate,
    duplicateMeetingIds: candidate.duplicateMeetingIds.slice(0, MAX_DUPLICATE_IDS),
    title: candidate.title,
    startAt: candidate.startAt,
    endAt: candidate.endAt,
    timezone: candidate.timezone,
    score: candidate.score,
    titleScore: candidate.titleScore,
    timeScore: candidate.timeScore,
    reasons: candidate.reasons.slice(0, MAX_REASON_CODES),
    zoneUsed: candidate.zoneUsed,
    cancelled: candidate.cancelled,
    allDay: candidate.allDay,
  };
}

function itemCount(sections: readonly { items: readonly unknown[] }[]): number {
  return sections.reduce((sum, section) => sum + section.items.length, 0);
}

/**
 * The document for an accepted or inbox summary (rows 7 to 10), sealed and size-fitted. Pure apart
 * from the random IVs. Throws a plain Error for a wiring mistake (another row, a tier that does
 * not fit the row, empty text, an invalid id) and SealedError for a bad keyring; never for size.
 */
export function buildSummaryDoc(input: BuildSummaryDocInput): BuiltSummary {
  assertUid(input.uid);
  if (!isSummaryId(input.summaryId)) throw new Error('summaries.model: invalid summaryId');
  const row = input.classification.row;
  if (row !== 7 && row !== 8 && row !== 9 && row !== 10) throw new Error('summaries.model: only rows 7 to 10 store a summary');
  const tier = TIER_FOR_ROW[row];
  if (input.classification.tier !== tier) throw new Error('summaries.model: the tier does not fit the decision row');
  if (typeof input.text !== 'string' || input.text.length === 0) throw new Error('summaries.model: empty text is refused as unreadable');

  const ref: SummaryRef = { uid: input.uid, summaryId: input.summaryId };
  const receivedAt = input.receivedAt.toISOString();
  const nowIso = input.now.toISOString();
  // Defence in depth for rule A and finding 7: only a row 7 copy with a match is ever stored as
  // filed automatically, and a row 9 copy never carries one-tap suggestions, whatever the match
  // record says (decide() already behaves so; this keeps a wiring mistake from filing anything).
  const autoFiled = input.match.status === 'matched' && row === 7 && input.match.match !== null;
  const status: StoredSummaryStatus = autoFiled ? 'matched' : 'inbox';
  const inboxReason: SummaryInboxReason | null = autoFiled ? null : (input.match.inboxReason ?? ROW_INBOX_REASON[row]);
  const candidates = row === 9 ? [] : input.match.candidates.slice(0, SUMMARY_LIMITS.maxSuggestions).map(storedCandidateOf);
  const fromAddress = addrOrNull(input.fromAddress);

  let anchorAt: string | null = null;
  let anchorSource: SummaryAnchorSource | null = null;
  if (tier === 'vendor_verified') {
    anchorAt = input.classification.anchorSource === 'signed_date' ? isoOrNull(input.classification.anchorAt) : null;
    anchorSource = anchorAt === null ? null : 'signed_date';
  } else {
    anchorAt = isoOrNull(input.forwardAnchorAt);
    anchorSource = anchorAt === null ? null : 'forward_wrapper';
  }

  const language = typeof input.language === 'string' && input.language.length > 0 && input.language.length <= 35 ? input.language : null;
  const parsed = storedAuthSchema.safeParse(input.auth);
  if (!parsed.success) throw new Error('summaries.model: the auth block does not match the stored schema');

  const head: SummaryHead = { subject: input.subject, titleLine: input.meta.titleLine, dateLine: input.meta.dateLine };
  const bodyInput: SummaryBodyInput = {
    fromAddress,
    fromName: input.fromName,
    // "Forwarded from <address>": the user's own mailbox that signed the forward.
    forwardedBy: tier === 'user_forwarded' ? fromAddress : null,
    text: input.text,
    sections: input.sections.sections,
  };
  const sealedHead = sealHeadValue(input.keyring, ref, head);

  const structure: StoredSummaryDoc = {
    schemaVersion: SUMMARY_SCHEMA_VERSION,
    parserVersion: input.sections.parserVersion,
    status,
    inboxReason,
    refusedReason: null,
    trust: {
      tier,
      recipientBound: input.classification.recipientBound,
      fresh: input.classification.fresh,
      anchorSource,
      originalInboxReason: inboxReason,
    },
    senderDomain: domainOrNull(input.classification.senderDomain),
    vendorDomain: tier === 'vendor_verified' && fromAddress !== null ? domainOrNull(fromAddress.slice(fromAddress.lastIndexOf('@') + 1)) : null,
    auth: parsed.data,
    receivedAt,
    sentAt: isoOrNull(input.sentAt),
    anchorAt,
    summaryDate: input.meta.summaryDate,
    language,
    match: autoFiled ? storedMatchOf(input.match.match) : null,
    candidates,
    rejectedMeetingIds: input.match.rejectedMeetingIds.slice(-MAX_REJECTED_MEETING_IDS),
    counts: { sections: 0, items: 0, textChars: 0 },
    flags: {
      truncated: false,
      textCutForSize: false,
      itemTextFromOffsets: false,
      possibleInstruction: input.sections.possibleInstruction,
      ...(input.textFromHtml === true ? { textFromHtml: true as const } : {}),
    },
    contentDigest: contentDigest(input.keyring, input.text),
    userAction: null,
    extraction: null,
    sealedHead,
    sealedBody: '',
    createdAt: nowIso,
    updatedAt: nowIso,
    expiresAt: summaryExpiresAt(status, receivedAt),
  };

  // Everything but sealedBody has its final size now (counts and flags are fixed-size values).
  const path = summaryDocPath(input.uid, input.summaryId);
  const safeBytes = input.safeBytes ?? SUMMARY_DOC_SAFE_BYTES;
  const budget = safeBytes - estimateDocBytes(path, structure);
  const fitted = fitSummaryBody(bodyInput, budget);
  const sealedBody = sealBodyValue(input.keyring, ref, fitted.body);
  const cutForSize = fitted.degradation === 'text_cut';

  const doc: StoredSummaryDoc = {
    ...structure,
    counts: { sections: fitted.body.sections.length, items: itemCount(fitted.body.sections), textChars: fitted.body.text.length },
    flags: {
      truncated: input.textTruncated || input.sections.truncated || cutForSize,
      textCutForSize: cutForSize,
      itemTextFromOffsets: fitted.body.itemTextFromOffsets,
      possibleInstruction: input.sections.possibleInstruction,
      ...(input.textFromHtml === true ? { textFromHtml: true as const } : {}),
    },
    sealedBody,
  };

  const checked = storedSummarySchema.safeParse(doc);
  if (!checked.success) throw new Error('summaries.model: the summary document does not match the stored schema');
  const estimatedBytes = estimateDocBytes(path, doc);
  if (estimatedBytes > FIRESTORE_MAX_DOC_BYTES) throw new Error('summaries.model: the summary document exceeds the Firestore limit');

  const keyring = input.keyring;
  return {
    doc,
    reseal: (summaryId: string): SealedSummaryFields => {
      const other: SummaryRef = { uid: input.uid, summaryId };
      return { sealedHead: sealHeadValue(keyring, other, head), sealedBody: sealBodyValue(keyring, other, fitted.body) };
    },
    rank: trustRank(row),
    claimMarkers: claimsMarkers(row),
    degradation: fitted.degradation,
    estimatedBytes,
  };
}

// ---------------------------------------------------------------------------------------------
// Refused rows and markers (shapes written by store.ts)
// ---------------------------------------------------------------------------------------------

export interface RefusedRowInput {
  existing: RefusedRowDoc | null;
  reason: SummaryRefusedReason;
  senderDomain: string | null;
  now: Date;
}

/** The refused row after one more refusal that UTC day (pure). */
export function nextRefusedRow(input: RefusedRowInput): RefusedRowDoc {
  const nowIso = input.now.toISOString();
  return {
    status: 'refused',
    refusedReason: input.reason,
    senderDomain: domainOrNull(input.senderDomain),
    firstAt: input.existing?.firstAt ?? nowIso,
    lastAt: nowIso,
    count: (input.existing?.count ?? 0) + 1,
    expiresAt: refusedRowExpiresAt(input.now),
    schemaVersion: SUMMARY_SCHEMA_VERSION,
  };
}

/** Normalizes a reason code to the contract enum, or null. */
export function refusedReasonOrNull(value: unknown): SummaryRefusedReason | null {
  return typeof value === 'string' && (SUMMARY_REFUSED_REASONS as readonly string[]).includes(value) ? (value as SummaryRefusedReason) : null;
}

/** Normalizes an inbox reason to the contract enum, or null. */
export function inboxReasonOrNull(value: unknown): SummaryInboxReason | null {
  return typeof value === 'string' && (SUMMARY_INBOX_REASONS as readonly string[]).includes(value) ? (value as SummaryInboxReason) : null;
}

/** A sender domain as the app may show it (summaryDomainSchema), or null. */
export function senderDomainOrNull(value: unknown): string | null {
  return typeof value === 'string' ? domainOrNull(value) : null;
}
