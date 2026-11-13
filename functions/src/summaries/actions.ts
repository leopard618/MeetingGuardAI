/**
 * M10 user-facing summary operations behind summaryAction (docs/v2/M10-DESIGN.md section 4
 * Callables, section 6 Stored, section 7 Deletion, section 9). firebase-admin Firestore with an
 * injected db; the caller passes `now`. Every change of one document runs in ONE transaction with
 * all reads before any write, and changes single top-level fields with update(), so unknown fields
 * (M11's extraction, a later schema) survive.
 *
 * - attachSummary: files an inbox or kept summary (or moves a filed one) under the caller's meeting
 *   users/{uid}/meetings/{meetingId}. The meeting must exist and not be a tombstone. For a series,
 *   occurrenceDate must be a real, not cancelled occurrence (the ORIGINAL local date, the
 *   recurrenceOverrides key, checked with the shared expandOccurrences); for a one-off it must be
 *   null. Sets status matched, a 'user' match with a snapshot of the meeting, userAction and the
 *   filed expiresAt.
 * - detachSummary ("Not this meeting"): back to the inbox, the meeting added to rejectedMeetingIds
 *   (newest last, at most MAX_REJECTED_MEETING_IDS) and dropped from the suggestions, match cleared.
 * - keepSummary ("Keep without a meeting"): status kept, the kept expiresAt.
 * - deleteSummary: a hard delete of one document, plus a deletion marker for its id and the digest
 *   marker for its content in the same transaction, so neither a Postmark retry, nor the same mail
 *   resent, nor a better copy recreates it (35 days). The same goes for the ids and digests the
 *   summary absorbed through upgrades in place (mergedIds, mergedDigests). A missing document
 *   answers deleted false.
 * - deleteAllSummaries: every document under users/{uid}/meetingSummaries, in bounded batches
 *   (after the address is gone, so no markers are needed).
 * - dismissGmailRequest: removes one pending Gmail confirmation from summaryUsers/{uid}.
 *
 * Refused rows (refused-YYYY-MM-DD) and documents that do not parse answer not_found for attach,
 * detach and keep (they can still be deleted). Nothing here decrypts: the sealed fields are never
 * read into a result, and summaryStateOf returns only {summaryId, status, inboxReason, match}.
 * Nothing here logs; the callables log codes and counts. A Firestore error propagates.
 */
import type { DocumentReference, Firestore, Transaction } from 'firebase-admin/firestore';
import { z } from 'zod';

import {
  SUMMARY_LIMITS,
  durationMinutesSchema,
  isoDateTimeSchema,
  recurrenceRuleSchema,
  summaryMatchSchema,
  summaryStateSchema,
  timeZoneSchema,
  type SummaryInboxReason,
  type SummaryMatch,
  type SummaryState,
} from '../shared/aiContract';
import { expandOccurrences, recurrenceOverridesSchema, type RecurringMeetingLike } from '../shared/recurrence';
import { isLocalDate, isValidTimeZone, toLocalDateTime, zonedDateTimeToUtcIso } from '../shared/time';
import { SUMMARY_USERS_COLLECTION, isAddressTombstone, normalizeMailbox, parseSummaryUser } from './address';
import { trustInboxReason } from './match';
import {
  MAX_MERGED_LINKS,
  MAX_REJECTED_MEETING_IDS,
  SUMMARY_RETENTION_DAYS,
  SUMMARY_UID_PATTERN,
  addDaysIso,
  deletionMarkerKey,
  digestMarkerKey,
  isSummaryId,
  markerExpiresAt,
  parseSummaryRecord,
  storedMatchSchema,
  storedSummarySchema,
  summaryDocPath,
  summaryEventPath,
  summaryExpiresAt,
  type StoredCandidate,
  type StoredMatch,
  type StoredSummaryDoc,
} from './model';
import { sliceSafe } from './sanitize';
import { activeGmailRequests, summariesCollection } from './store';

const MINUTE_MS = 60_000;
/** The app's default when a stored meeting has no durationMinutes (as in candidates.ts). */
const DEFAULT_DURATION_MINUTES = 60;
/** Firestore document ids the summary and meeting id patterns allow, minus the reserved __x__ form. */
const DOC_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const RESERVED_DOC_ID = /^__.*__$/;
/** A stored contentDigest (sha256-sized HMAC hex). */
const HEX64 = /^[0-9a-f]{64}$/;

/** Bounded bulk delete (disconnect {deleteSummaries: true}); a callable has 10 seconds. */
export const SUMMARY_BULK_DELETE_LIMITS = {
  /** Documents per WriteBatch (Firestore allows 500 writes per batch). */
  batchSize: 400,
  /** Batches per call; the rest is left for a retry (the callable answers upstream_error). */
  maxBatches: 12,
} as const;

export interface BulkDeleteLimits {
  batchSize: number;
  maxBatches: number;
}

/**
 * The only meeting fields attach reads (field mask): participants, notes, the conference and every
 * other piece of meeting content stay in Firestore.
 */
export const ATTACH_MEETING_FIELDS = [
  'title',
  'startAt',
  'durationMinutes',
  'timezone',
  'allDay',
  'status',
  'deletedAt',
  'recurrence',
  'recurrenceOverrides',
] as const;

function assertUid(uid: string): void {
  if (typeof uid !== 'string' || !SUMMARY_UID_PATTERN.test(uid)) throw new Error('summaries.actions: invalid uid');
}

/** A document id that is safe to put in a path (the contract patterns allow the reserved __x__ ids). */
function isUsableDocId(value: unknown): value is string {
  return typeof value === 'string' && DOC_ID_PATTERN.test(value) && !RESERVED_DOC_ID.test(value);
}

function summaryRef(db: Firestore, uid: string, summaryId: string): DocumentReference {
  return db.doc(summaryDocPath(uid, summaryId));
}

function meetingRef(db: Firestore, uid: string, meetingId: string): DocumentReference {
  return db.doc(`users/${uid}/meetings/${meetingId}`);
}

function canonicalIso(ms: number): string | null {
  if (!Number.isFinite(ms)) return null;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** The later of two ISO instants (an unparsable `a` loses). */
function laterIso(a: string, b: string): string {
  const am = Date.parse(a);
  const bm = Date.parse(b);
  if (!Number.isFinite(am)) return b;
  return Number.isFinite(bm) && bm > am ? b : a;
}

// ---------------------------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------------------------

/** Why attach refused a meeting (all of them are invalid_meeting to the app; safe to log). */
export type InvalidMeetingReason =
  /** No such document under users/{uid}/meetings (or an id Firestore cannot hold). */
  | 'missing'
  /** A tombstone: deletedAt set, or status 'deleted'. */
  | 'deleted'
  /** The fields attach needs do not parse (or, for a series, Intl does not know the time zone). */
  | 'unreadable'
  /** A series without an occurrenceDate. */
  | 'occurrence_required'
  /** A one-off meeting with an occurrenceDate. */
  | 'not_a_series'
  /** occurrenceDate is not one of the series' own dates (within its rule, count and until). */
  | 'not_an_occurrence'
  /** That occurrence is cancelled (recurrenceOverrides). */
  | 'cancelled_occurrence';

export type SummaryOpResult =
  | { status: 'ok'; changed: boolean; state: SummaryState }
  /** No such summary for this caller, a refused row, or a document this version cannot read. */
  | { status: 'not_found' }
  | { status: 'invalid_meeting'; reason: InvalidMeetingReason };

/** A stored match in the contract shape, or null when it does not parse there (e.g. an odd zone). */
export function contractMatchOf(match: StoredMatch | null): SummaryMatch | null {
  if (match === null) return null;
  const parsed = summaryMatchSchema.safeParse({
    meetingId: match.meetingId,
    occurrenceDate: match.occurrenceDate,
    method: match.method,
    meetingSnapshot: {
      title: match.meetingSnapshot.title,
      startAt: match.meetingSnapshot.startAt,
      endAt: match.meetingSnapshot.endAt,
      timezone: match.meetingSnapshot.timezone,
    },
  });
  return parsed.success ? parsed.data : null;
}

/**
 * The summary's state for the summaryAction response: {summaryId, status, inboxReason, match}
 * only (no content, no sealed field). inboxReason is set for inbox items only, match for filed ones.
 */
export function summaryStateOf(summaryId: string, doc: StoredSummaryDoc): SummaryState {
  return summaryStateSchema.parse({
    summaryId,
    status: doc.status,
    inboxReason: doc.status === 'inbox' ? doc.inboxReason : null,
    match: doc.status === 'matched' ? contractMatchOf(doc.match) : null,
  });
}

function ok(changed: boolean, summaryId: string, doc: StoredSummaryDoc): SummaryOpResult {
  return { status: 'ok', changed, state: summaryStateOf(summaryId, doc) };
}

/** The document after `patch`, checked against the stored schema (a wiring mistake throws). */
function patched(doc: StoredSummaryDoc, patch: Record<string, unknown>): StoredSummaryDoc {
  const next = storedSummarySchema.safeParse({ ...doc, ...patch });
  if (!next.success) throw new Error('summaries.actions: the changed summary does not match the stored schema');
  return next.data;
}

/** Reads one summary inside the transaction: the parsed document, or null (not_found). */
async function readSummary(tx: Transaction, ref: DocumentReference): Promise<StoredSummaryDoc | null> {
  const snapshot = await tx.get(ref);
  if (!snapshot.exists) return null;
  const record = parseSummaryRecord(snapshot.data());
  return record !== null && record.kind === 'summary' ? record.doc : null;
}

// ---------------------------------------------------------------------------------------------
// attach
// ---------------------------------------------------------------------------------------------

/** The masked meeting fields attach needs; defaults follow the app's parseMeetingDoc. */
const attachMeetingSchema = z.object({
  title: z.string().min(1),
  startAt: isoDateTimeSchema,
  durationMinutes: durationMinutesSchema.default(DEFAULT_DURATION_MINUTES),
  timezone: timeZoneSchema,
  allDay: z.boolean().default(false),
  recurrence: recurrenceRuleSchema.nullable().default(null),
  recurrenceOverrides: recurrenceOverridesSchema.nullable().default(null),
});

export type MeetingSnapshot = StoredMatch['meetingSnapshot'];

export type AttachTarget = { ok: true; snapshot: MeetingSnapshot } | { ok: false; reason: InvalidMeetingReason };

function isTombstone(data: Record<string, unknown>): boolean {
  return (data.deletedAt !== undefined && data.deletedAt !== null) || data.status === 'deleted';
}

function snapshotOf(title: string, startMs: number, durationMinutes: number, timezone: string): MeetingSnapshot | null {
  const startAt = canonicalIso(startMs);
  const endAt = canonicalIso(startMs + durationMinutes * MINUTE_MS);
  if (startAt === null || endAt === null) return null;
  return { title: sliceSafe(title, SUMMARY_LIMITS.maxTitleChars), startAt, endAt, timezone };
}

/**
 * Decides whether a meeting document can take the summary and returns the snapshot to store
 * (pure). `data` is the field-masked meeting, or undefined when it does not exist.
 * - Zones, exactly as candidates.ts: every meeting needs a zone that passes the contract's
 *   timeZoneSchema (the snapshot stores it); only a series also needs one Intl knows.
 * - One-off: occurrenceDate must be null; the snapshot is the stored start and duration.
 * - Series: occurrenceDate must be one of the series' ORIGINAL local dates. It is checked by
 *   expanding the rule WITHOUT the overrides over the minute of that date's original start (so
 *   count and until apply exactly as in the app, cancelled overrides still consuming count), then
 *   the date's own override decides: cancelled refuses, modified gives the snapshot its start,
 *   duration and title. The master's local date and time come from startAt in its zone, as in
 *   candidates.ts, so attach accepts exactly the occurrences the suggestions offer.
 */
export function resolveAttachTarget(
  meetingId: string,
  data: Record<string, unknown> | undefined,
  occurrenceDate: string | null,
): AttachTarget {
  if (data === undefined) return { ok: false, reason: 'missing' };
  if (isTombstone(data)) return { ok: false, reason: 'deleted' };
  const parsed = attachMeetingSchema.safeParse(data);
  if (!parsed.success) return { ok: false, reason: 'unreadable' };
  const meeting = parsed.data;
  const masterStartMs = Date.parse(meeting.startAt);
  if (!Number.isFinite(masterStartMs)) return { ok: false, reason: 'unreadable' };

  if (meeting.recurrence === null) {
    // A one-off only stores its zone in the snapshot (timeZoneSchema, checked above); no local
    // time is computed in it, so a zone Intl does not know is fine, as in candidates.ts.
    if (occurrenceDate !== null) return { ok: false, reason: 'not_a_series' };
    const snapshot = snapshotOf(meeting.title, masterStartMs, meeting.durationMinutes, meeting.timezone);
    return snapshot === null ? { ok: false, reason: 'unreadable' } : { ok: true, snapshot };
  }

  // A series needs a zone Intl knows: the occurrence arithmetic below works in local time.
  if (!isValidTimeZone(meeting.timezone)) return { ok: false, reason: 'unreadable' };
  if (occurrenceDate === null) return { ok: false, reason: 'occurrence_required' };
  if (!isLocalDate(occurrenceDate)) return { ok: false, reason: 'not_an_occurrence' };
  const masterStart = canonicalIso(masterStartMs);
  if (masterStart === null) return { ok: false, reason: 'unreadable' };
  const local = toLocalDateTime(masterStart, meeting.timezone);
  const like: RecurringMeetingLike = {
    id: meetingId,
    title: meeting.title,
    date: local.date,
    time: local.time,
    timezone: meeting.timezone,
    durationMinutes: meeting.durationMinutes,
    allDay: meeting.allDay,
    recurrence: meeting.recurrence,
    // Without overrides every generated date is found at its original start; the date's own
    // override is applied below.
    recurrenceOverrides: null,
  };
  let originalStartMs: number;
  let found: boolean;
  try {
    const originalStartAt = zonedDateTimeToUtcIso(occurrenceDate, meeting.allDay ? '00:00' : local.time, meeting.timezone);
    originalStartMs = Date.parse(originalStartAt);
    const windowEnd = canonicalIso(originalStartMs + MINUTE_MS);
    if (windowEnd === null) return { ok: false, reason: 'unreadable' };
    const occurrences = expandOccurrences(like, originalStartAt, windowEnd, { max: 8 });
    found = occurrences.some((occurrence) => occurrence.localDateKey === occurrenceDate);
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  if (!found) return { ok: false, reason: 'not_an_occurrence' };

  const override = meeting.recurrenceOverrides?.[occurrenceDate];
  if (override?.status === 'cancelled') return { ok: false, reason: 'cancelled_occurrence' };
  const modified = override?.status === 'modified' ? override : null;
  const startMs = modified !== null && modified.startAt !== null ? Date.parse(modified.startAt) : originalStartMs;
  const durationMinutes = modified?.durationMinutes ?? meeting.durationMinutes;
  const title = modified?.title ?? meeting.title;
  const snapshot = snapshotOf(title, startMs, durationMinutes, meeting.timezone);
  return snapshot === null ? { ok: false, reason: 'unreadable' } : { ok: true, snapshot };
}

export interface AttachInput {
  summaryId: string;
  meetingId: string;
  /** The ORIGINAL local date of a series occurrence; null for a one-off meeting. */
  occurrenceDate: string | null;
}

/**
 * attach, in ONE transaction: reads the summary and the field-masked meeting, then sets status
 * matched, inboxReason null, match {method 'user', meetingId, occurrenceDate,
 * duplicateMeetingIds [], scores null, reasons [], zoneUsed null, matchedAt, meetingSnapshot},
 * userAction {kind 'attach', at}, the filed expiresAt (365 days from receipt) and updatedAt. The
 * meeting leaves rejectedMeetingIds (the user chose it). A summary already filed under the same
 * meeting and occurrence answers changed false and writes nothing.
 */
export async function attachSummary(db: Firestore, uid: string, input: AttachInput, now: Date): Promise<SummaryOpResult> {
  assertUid(uid);
  if (!isUsableDocId(input.summaryId)) return { status: 'not_found' };
  const meetingId = input.meetingId;
  const occurrenceDate = input.occurrenceDate;
  const nowIso = now.toISOString();

  return db.runTransaction(async (tx: Transaction): Promise<SummaryOpResult> => {
    const ref = summaryRef(db, uid, input.summaryId);
    const doc = await readSummary(tx, ref);
    if (doc === null) return { status: 'not_found' };
    if (!isUsableDocId(meetingId)) return { status: 'invalid_meeting', reason: 'missing' };
    const [meetingSnap] = await tx.getAll(meetingRef(db, uid, meetingId), { fieldMask: [...ATTACH_MEETING_FIELDS] });
    const data = meetingSnap !== undefined && meetingSnap.exists ? ((meetingSnap.data() ?? {}) as Record<string, unknown>) : undefined;
    const target = resolveAttachTarget(meetingId, data, occurrenceDate);
    if (!target.ok) return { status: 'invalid_meeting', reason: target.reason };

    if (doc.status === 'matched' && doc.match !== null && doc.match.meetingId === meetingId && doc.match.occurrenceDate === occurrenceDate) {
      return ok(false, input.summaryId, doc);
    }
    const match = storedMatchSchema.parse({
      meetingId,
      occurrenceDate,
      duplicateMeetingIds: [],
      method: 'user',
      score: null,
      titleScore: null,
      timeScore: null,
      reasons: [],
      zoneUsed: null,
      matchedAt: nowIso,
      meetingSnapshot: target.snapshot,
    });
    const patch: Record<string, unknown> = {
      status: 'matched',
      inboxReason: null,
      match,
      rejectedMeetingIds: doc.rejectedMeetingIds.filter((id) => id !== meetingId),
      userAction: { kind: 'attach', at: nowIso },
      expiresAt: summaryExpiresAt('matched', doc.receivedAt),
      updatedAt: nowIso,
    };
    const next = patched(doc, patch);
    tx.update(ref, patch);
    return ok(true, input.summaryId, next);
  });
}

// ---------------------------------------------------------------------------------------------
// detach and keep
// ---------------------------------------------------------------------------------------------

/**
 * The inbox reason a detached summary gets: the one its trust facts force (user_forwarded,
 * not_addressed_to_you, old_summary), else the reason it had at receipt, else 'weak' (it was
 * filed automatically and the user rejected the meeting; summaryRead's re-match refines it).
 */
export function detachInboxReason(doc: Pick<StoredSummaryDoc, 'trust'>): SummaryInboxReason {
  return trustInboxReason(doc.trust) ?? doc.trust.originalInboxReason ?? 'weak';
}

/** The rejected list with `meetingId` added last (deduplicated), at most MAX_REJECTED_MEETING_IDS. */
export function withRejectedMeeting(rejected: readonly string[], meetingId: string): string[] {
  return [...rejected.filter((id) => id !== meetingId), meetingId].slice(-MAX_REJECTED_MEETING_IDS);
}

function notRejected(candidate: StoredCandidate, rejected: ReadonlySet<string>): boolean {
  return !rejected.has(candidate.meetingId) && !candidate.duplicateMeetingIds.some((id) => rejected.has(id));
}

/**
 * detach ("Not this meeting"), in ONE transaction: a filed summary goes back to the inbox
 * (detachInboxReason), its meeting is added to rejectedMeetingIds and dropped from the stored
 * suggestions, match is cleared, userAction {kind 'detach', at} is set. expiresAt becomes the
 * inbox retention counted from receipt, but never less than the inbox retention from now, so a
 * summary filed long ago does not vanish the day after the user sends it back. An inbox or kept
 * summary answers changed false.
 */
export async function detachSummary(db: Firestore, uid: string, summaryId: string, now: Date): Promise<SummaryOpResult> {
  assertUid(uid);
  if (!isUsableDocId(summaryId)) return { status: 'not_found' };
  const nowIso = now.toISOString();

  return db.runTransaction(async (tx: Transaction): Promise<SummaryOpResult> => {
    const ref = summaryRef(db, uid, summaryId);
    const doc = await readSummary(tx, ref);
    if (doc === null) return { status: 'not_found' };
    if (doc.status !== 'matched') return ok(false, summaryId, doc);

    const rejectedId = doc.match?.meetingId ?? null;
    const rejectedMeetingIds = rejectedId === null ? doc.rejectedMeetingIds : withRejectedMeeting(doc.rejectedMeetingIds, rejectedId);
    const rejected = new Set(rejectedMeetingIds);
    const patch: Record<string, unknown> = {
      status: 'inbox',
      inboxReason: detachInboxReason(doc),
      match: null,
      candidates: doc.candidates.filter((candidate) => notRejected(candidate, rejected)),
      rejectedMeetingIds,
      userAction: { kind: 'detach', at: nowIso },
      expiresAt: laterIso(summaryExpiresAt('inbox', doc.receivedAt), addDaysIso(now, SUMMARY_RETENTION_DAYS.inbox)),
      updatedAt: nowIso,
    };
    const next = patched(doc, patch);
    tx.update(ref, patch);
    return ok(true, summaryId, next);
  });
}

/**
 * keep ("Keep without a meeting"), in ONE transaction: status kept, inboxReason and match cleared,
 * userAction {kind 'keep', at}, the kept expiresAt (365 days from receipt). A kept summary answers
 * changed false.
 */
export async function keepSummary(db: Firestore, uid: string, summaryId: string, now: Date): Promise<SummaryOpResult> {
  assertUid(uid);
  if (!isUsableDocId(summaryId)) return { status: 'not_found' };
  const nowIso = now.toISOString();

  return db.runTransaction(async (tx: Transaction): Promise<SummaryOpResult> => {
    const ref = summaryRef(db, uid, summaryId);
    const doc = await readSummary(tx, ref);
    if (doc === null) return { status: 'not_found' };
    if (doc.status === 'kept') return ok(false, summaryId, doc);
    const patch: Record<string, unknown> = {
      status: 'kept',
      inboxReason: null,
      match: null,
      userAction: { kind: 'keep', at: nowIso },
      expiresAt: summaryExpiresAt('kept', doc.receivedAt),
      updatedAt: nowIso,
    };
    const next = patched(doc, patch);
    tx.update(ref, patch);
    return ok(true, summaryId, next);
  });
}

// ---------------------------------------------------------------------------------------------
// Deletion
// ---------------------------------------------------------------------------------------------

/** The 64-hex entries of a stored upgrade-link list (mergedIds, mergedDigests), the newest MAX_MERGED_LINKS. */
function hexLinks(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && HEX64.test(entry)).slice(-MAX_MERGED_LINKS);
}

/**
 * delete: a hard delete of users/{uid}/meetingSummaries/{summaryId} (any shape, refused rows
 * included), in ONE transaction so `deleted` is exact. A deleted summary must stay deleted
 * (design sections 7 and 14), so the same transaction writes, each {expiresAt: 35 days} with no
 * uid and no content:
 * - the deletion marker of the id (deletionMarkerKey) when it is an accepted summary's id (64 hex;
 *   a refused row's id never reaches commitSummary): commitSummary reads it for every row, so a
 *   retry of the same delivery, the same mail resent at row 8 or 9, or a better row 7 copy of it
 *   is a duplicate;
 * - the deletion marker of every id in mergedIds (copies with another id that upgraded this
 *   summary in place), so a resend of such a copy, even with changed text, is a duplicate too;
 * - the content-digest marker (digestMarkerKey) of the document's contentDigest when it has one,
 *   and of every digest in mergedDigests (content an upgrade replaced), so the same content under
 *   another Message-ID is not recreated either.
 * Only 64-hex entries count, at most MAX_MERGED_LINKS of each list (read from the raw document, so
 * a document this version cannot parse is covered as well). The Message-ID and digest markers
 * already claimed by rows 7 and 10 are left in place (the digest one is renewed). A missing
 * document answers deleted false and writes nothing.
 */
export async function deleteSummary(db: Firestore, uid: string, summaryId: string, now: Date): Promise<{ deleted: boolean }> {
  assertUid(uid);
  if (!isUsableDocId(summaryId)) return { deleted: false };
  return db.runTransaction(async (tx: Transaction) => {
    const ref = summaryRef(db, uid, summaryId);
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return { deleted: false };
    const data = (snapshot.data() ?? {}) as Record<string, unknown>;
    const ids = new Set<string>(isSummaryId(summaryId) ? [summaryId] : []);
    for (const id of hexLinks(data.mergedIds)) ids.add(id);
    const digests = new Set<string>(typeof data.contentDigest === 'string' && HEX64.test(data.contentDigest) ? [data.contentDigest] : []);
    for (const digest of hexLinks(data.mergedDigests)) digests.add(digest);
    const marker = { expiresAt: markerExpiresAt(now) };
    for (const id of ids) tx.set(db.doc(summaryEventPath(deletionMarkerKey(uid, id))), marker);
    for (const digest of digests) tx.set(db.doc(summaryEventPath(digestMarkerKey(uid, digest))), marker);
    tx.delete(ref);
    return { deleted: true };
  });
}

/**
 * Deletes every document under users/{uid}/meetingSummaries in batches of `batchSize` (refs only,
 * read with an empty field mask), at most `maxBatches` per call. complete is false when documents
 * remain; a repeat call continues. Call it AFTER the address is gone, so no new summary lands while
 * it runs (commitSummary re-reads the address). Unlike deleteSummary it writes no deletion or
 * digest markers, and needs none: disconnect deletes the address first, so no mail sent to it can
 * reach commitSummary again (it drops address_changed), and a later create_address mints a new
 * token. Existing markers are left alone.
 */
export async function deleteAllSummaries(
  db: Firestore,
  uid: string,
  limits: BulkDeleteLimits = SUMMARY_BULK_DELETE_LIMITS,
): Promise<{ deleted: number; complete: boolean }> {
  assertUid(uid);
  const batchSize = Math.max(1, Math.min(500, Math.floor(limits.batchSize)));
  const maxBatches = Math.max(1, Math.floor(limits.maxBatches));
  let deleted = 0;
  for (let round = 0; round < maxBatches; round += 1) {
    const snapshot = await summariesCollection(db, uid).select().limit(batchSize).get();
    if (snapshot.empty) return { deleted, complete: true };
    const batch = db.batch();
    for (const document of snapshot.docs) batch.delete(document.ref);
    await batch.commit();
    deleted += snapshot.size;
    if (snapshot.size < batchSize) return { deleted, complete: true };
  }
  const rest = await summariesCollection(db, uid).select().limit(1).get();
  return { deleted, complete: rest.empty };
}

// ---------------------------------------------------------------------------------------------
// Gmail confirmation requests
// ---------------------------------------------------------------------------------------------

/**
 * dismiss_gmail, in ONE transaction: removes the pending confirmation of `gmailAddress` (compared
 * normalized and lowercased) from summaryUsers/{uid}.gmailRequests; expired and unreadable entries
 * are dropped on the same write. dismissed false (nothing written) when there is no such pending
 * request, no address, or only a disconnect tombstone.
 */
export async function dismissGmailRequest(db: Firestore, uid: string, gmailAddress: string, now: Date): Promise<{ dismissed: boolean }> {
  assertUid(uid);
  const key = normalizeMailbox(gmailAddress) ?? (typeof gmailAddress === 'string' ? gmailAddress.trim().toLowerCase() : '');
  if (key.length === 0) return { dismissed: false };
  return db.runTransaction(async (tx: Transaction) => {
    const ref = db.doc(`${SUMMARY_USERS_COLLECTION}/${uid}`);
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return { dismissed: false };
    const user = parseSummaryUser(snapshot.data());
    if (isAddressTombstone(user)) return { dismissed: false };
    const active = activeGmailRequests(user, now);
    const remaining = active.filter((request) => request.gmailAddress.toLowerCase() !== key);
    if (remaining.length === active.length) return { dismissed: false };
    tx.update(ref, { gmailRequests: remaining, updatedAt: now.toISOString() });
    return { dismissed: true };
  });
}
