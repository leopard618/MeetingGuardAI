/**
 * M10 inbound write transactions (docs/v2/M10-DESIGN.md section 4 steps 9, 10, 13 and 15,
 * section 5 row 16, section 7, red-team findings 5, 7, 10 and 14). firebase-admin Firestore with an
 * injected db; the caller passes `now`. Every multi-document change runs in ONE transaction with
 * all reads before any write. Shapes and keys come from model.ts.
 *
 * - recordFirstSeen / readFirstSeen: summaryEvents/{firstSeenKey} = {firstSeenAt, expiresAt}, so a
 *   Postmark retry after a 500 keeps the original receipt time (the Fresh window and the row 5
 *   retry window are measured from it).
 * - recordRefusal: the only daily cap (finding 5): refusals only, deduped by the provider event
 *   id, at most SUMMARY_REFUSALS_PER_UTC_DAY per uid and UTC day, one refused row per day.
 * - storeGmailRequest: up to 3 Gmail confirmation requests keyed by the Gmail address, the user's
 *   own mailboxes ranked first so strangers cannot push out the user's code (finding 14).
 * - commitSummary: re-reads the address and users/{uid}, then creates, upgrades in place or drops
 *   as a duplicate (step 13, finding 10). Markers are claimed only by rows 7 and 10, and only here,
 *   after authentication: a forged message is refused before it can reach this function, so it can
 *   never pre-claim a real recap's Message-ID. A summary the user deleted stays deleted: the
 *   delete (actions.ts) writes a deletion marker for its id and the digest marker for its content,
 *   and this function reads both for every row. An upgrade in place records on its target the id
 *   of an incoming copy with another id (mergedIds) and the digest it replaced (mergedDigests), so
 *   the delete covers those too.
 * - countInbox: the summaryStatus inbox count.
 *
 * Nothing here logs; the inbound handler logs the outcomes (uid, tok8, verdict, reason). A
 * Firestore error propagates (the handler answers 500 and Postmark retries); a transaction is
 * atomic, so a failed commit leaves no marker and no counter behind.
 */
import type { DocumentReference, DocumentSnapshot, Firestore, Query, Transaction } from 'firebase-admin/firestore';

import {
  SUMMARY_LIMITS,
  summaryGmailCodeSchema,
  summaryGmailRequestSchema,
  type SummaryGmailRequest,
  type SummaryLastRefused,
  type SummaryRefusedReason,
} from '../shared/aiContract';
import {
  SUMMARY_USERS_COLLECTION,
  isAddressTombstone,
  normalizeMailbox,
  parseSummaryUser,
  resolveTokenInTransaction,
  type SummaryUserDoc,
} from './address';
import {
  MARKER_CLAIM_RANKS,
  MAX_MERGED_LINKS,
  MEETING_SUMMARIES_COLLECTION,
  SUMMARY_REFUSALS_PER_UTC_DAY,
  SUMMARY_RETENTION_DAYS,
  SUMMARY_UID_PATTERN,
  deletionMarkerKey,
  firstSeenExpiresAt,
  firstSeenKey,
  isProviderEventId,
  isSummaryId,
  markerExpiresAt,
  nextRefusedRow,
  parseRefusedRow,
  parseStoredSummary,
  refusalMarkerKey,
  refusedReasonOrNull,
  refusedRowId,
  senderDomainOrNull,
  storedSummarySchema,
  summaryDocPath,
  summaryEventPath,
  summaryExpiresAt,
  trustRankOf,
  utcDayOf,
  type SealedSummaryFields,
  type StoredSummaryDoc,
  type StoredSummaryStatus,
} from './model';

const DAY_MS = 24 * 60 * 60 * 1000;
const HEX64 = /^[0-9a-f]{64}$/;

/** Existing copies with the same content digest read per commit (inside the transaction). */
export const DIGEST_TWIN_QUERY_LIMIT = 5;

function assertUid(uid: string): void {
  if (typeof uid !== 'string' || !SUMMARY_UID_PATTERN.test(uid)) throw new Error('summaries.store: invalid uid');
}

function eventRef(db: Firestore, key: string): DocumentReference {
  return db.doc(summaryEventPath(key));
}

function summaryRef(db: Firestore, uid: string, summaryId: string): DocumentReference {
  return db.doc(summaryDocPath(uid, summaryId));
}

function summaryUserRef(db: Firestore, uid: string): DocumentReference {
  return db.doc(`${SUMMARY_USERS_COLLECTION}/${uid}`);
}

function userRef(db: Firestore, uid: string): DocumentReference {
  return db.doc(`users/${uid}`);
}

/** users/{uid}/meetingSummaries. */
export function summariesCollection(db: Firestore, uid: string): Query {
  assertUid(uid);
  return db.collection(`users/${uid}/${MEETING_SUMMARIES_COLLECTION}`);
}

function isoMs(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** A marker counts until its expiresAt passes; one without a readable expiresAt always counts. */
function markerLive(snapshot: DocumentSnapshot, nowMs: number): boolean {
  if (!snapshot.exists) return false;
  const expires = isoMs((snapshot.data() ?? {}).expiresAt);
  return expires === null || expires > nowMs;
}

/** ALREADY_EXISTS from create() (gRPC code 6, or its string forms). */
export function isAlreadyExists(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return code === 6 || code === 'already-exists' || code === 'ALREADY_EXISTS';
}

/** summaryUsers/{uid} when it holds an address (not missing, not a disconnect tombstone), else null. */
function addressHolder(snapshot: DocumentSnapshot): SummaryUserDoc | null {
  if (!snapshot.exists) return null;
  const user = parseSummaryUser(snapshot.data());
  return isAddressTombstone(user) ? null : user;
}

// ---------------------------------------------------------------------------------------------
// First seen (step 9 receipt time across retries)
// ---------------------------------------------------------------------------------------------

function firstSeenOf(snapshot: DocumentSnapshot): Date | null {
  if (!snapshot.exists) return null;
  const ms = isoMs((snapshot.data() ?? {}).firstSeenAt);
  return ms === null ? null : new Date(ms);
}

/** The first-seen time of a provider delivery, or null (none recorded, or an invalid id). */
export async function readFirstSeen(db: Firestore, providerEventId: string | null | undefined): Promise<Date | null> {
  if (!isProviderEventId(providerEventId)) return null;
  return firstSeenOf(await eventRef(db, firstSeenKey(providerEventId)).get());
}

/**
 * Records `now` as the first-seen time of a provider delivery unless an earlier one is stored, and
 * returns the time that stands. One transaction. An invalid id records nothing and returns `now`.
 */
export async function recordFirstSeen(db: Firestore, providerEventId: string | null | undefined, now: Date): Promise<Date> {
  if (!isProviderEventId(providerEventId)) return now;
  const ref = eventRef(db, firstSeenKey(providerEventId));
  return db.runTransaction(async (tx: Transaction) => {
    const existing = firstSeenOf(await tx.get(ref));
    if (existing !== null && existing.getTime() <= now.getTime()) return existing;
    tx.set(ref, { firstSeenAt: now.toISOString(), expiresAt: firstSeenExpiresAt(now) });
    return now;
  });
}

// ---------------------------------------------------------------------------------------------
// Refusals (step 9, finding 5)
// ---------------------------------------------------------------------------------------------

export type RefusalOutcome = 'recorded' | 'duplicate' | 'capped' | 'dropped';

export interface RecordRefusalInput {
  uid: string;
  reason: SummaryRefusedReason;
  /** The d= of a PASSING signature only (Classification.senderDomain); anything else is stored as null. */
  senderDomain: string | null;
  /** Postmark MessageID. Without a valid one the refusal still counts, but a redelivery may count twice. */
  providerEventId: string | null;
  now: Date;
  /**
   * The address hash the mail arrived on. When given, the refusal is dropped unless it still maps
   * to `uid` (a regenerate between the lookup and this write); recommended.
   */
  tokenHash?: string;
}

/**
 * One refusal, in ONE transaction:
 * - dropped (nothing written) when summaryUsers/{uid} is missing or a disconnect tombstone, when
 *   users/{uid} is gone, or when `tokenHash` no longer maps to the uid. Never creates summaryUsers;
 * - duplicate (nothing written) when the refusal marker of this provider event exists;
 * - capped (nothing written) once SUMMARY_REFUSALS_PER_UTC_DAY refusals were counted this UTC day;
 * - recorded: the marker {expiresAt}, summaryUsers {refusedDay, refusedCount, lastRefused} and the
 *   day's refused row {status, refusedReason, senderDomain, firstAt, lastAt, count, expiresAt,
 *   schemaVersion} (latest reason and domain; no subject, no address, no body).
 */
export async function recordRefusal(db: Firestore, input: RecordRefusalInput): Promise<RefusalOutcome> {
  assertUid(input.uid);
  const reason = refusedReasonOrNull(input.reason);
  if (reason === null) throw new Error('summaries.store: unknown refusal reason');
  const uid = input.uid;
  const now = input.now;
  const nowIso = now.toISOString();
  const day = utcDayOf(now);
  const senderDomain = senderDomainOrNull(input.senderDomain);
  const markerKey = isProviderEventId(input.providerEventId) ? refusalMarkerKey(uid, input.providerEventId) : null;

  return db.runTransaction(async (tx: Transaction): Promise<RefusalOutcome> => {
    if (input.tokenHash !== undefined) {
      const owner = await resolveTokenInTransaction(tx, db, input.tokenHash);
      if (owner !== uid) return 'dropped';
    }
    const sUserRef = summaryUserRef(db, uid);
    const user = addressHolder(await tx.get(sUserRef));
    if (user === null) return 'dropped';
    if (!(await tx.get(userRef(db, uid))).exists) return 'dropped';
    const marker = markerKey !== null ? eventRef(db, markerKey) : null;
    if (marker !== null && markerLive(await tx.get(marker), now.getTime())) return 'duplicate';
    const done = user.refusedDay === day ? user.refusedCount : 0;
    if (done >= SUMMARY_REFUSALS_PER_UTC_DAY) return 'capped';
    const rowRef = summaryRef(db, uid, refusedRowId(day));
    const rowSnap = await tx.get(rowRef);
    const existing = rowSnap.exists ? parseRefusedRow(rowSnap.data()) : null;

    const lastRefused: SummaryLastRefused = { reason, at: nowIso, senderDomain };
    if (marker !== null) tx.set(marker, { expiresAt: markerExpiresAt(now) });
    tx.update(sUserRef, { refusedDay: day, refusedCount: done + 1, lastRefused });
    tx.set(rowRef, nextRefusedRow({ existing, reason, senderDomain, now }));
    return 'recorded';
  });
}

// ---------------------------------------------------------------------------------------------
// Gmail confirmation requests (step 10, finding 14)
// ---------------------------------------------------------------------------------------------

/**
 * stored: written. crowded_out: valid, but three requests from the user's own mailboxes are
 * already pending and an unlisted requester never evicts one of them (nothing written). stale:
 * valid, but the pending request of the same Gmail address was received at the same time or later
 * (a Postmark retry or a late delivery of an older confirmation); it is kept and nothing is written.
 */
export type GmailRequestOutcome = 'stored' | 'crowded_out' | 'stale' | 'invalid' | 'expired' | 'dropped';

export interface StoreGmailRequestInput {
  uid: string;
  /** The Gmail address that asked to forward here (normalized and lowercased here). */
  gmailAddress: string;
  /** The confirmation code (summaryGmailCodeSchema). */
  code: string;
  /**
   * The account's sign-in email when Firebase Auth marks it verified, else null. It binds like a
   * listed mailbox (section 5), so its requests rank with the listed ones (finding 14).
   */
  accountEmail: string | null;
  /** First-seen receipt time. */
  receivedAt: Date;
  now: Date;
  /** As in recordRefusal: when given, dropped unless it still maps to `uid`. */
  tokenHash?: string;
}

function gmailExpired(request: SummaryGmailRequest, nowMs: number): boolean {
  const at = isoMs(request.receivedAt);
  return at === null || at + SUMMARY_RETENTION_DAYS.gmailRequests * DAY_MS <= nowMs;
}

function newestFirst(a: SummaryGmailRequest, b: SummaryGmailRequest): number {
  return (isoMs(b.receivedAt) ?? 0) - (isoMs(a.receivedAt) ?? 0);
}

/** The unexpired requests that parse, one per Gmail address (the newest), in no set order. */
function unexpiredGmailRequests(user: Pick<SummaryUserDoc, 'gmailRequests'>, now: Date): SummaryGmailRequest[] {
  const nowMs = now.getTime();
  const byAddress = new Map<string, SummaryGmailRequest>();
  for (const raw of user.gmailRequests) {
    const parsed = summaryGmailRequestSchema.safeParse(raw);
    if (!parsed.success || gmailExpired(parsed.data, nowMs)) continue;
    const entry = parsed.data;
    const key = entry.gmailAddress.toLowerCase();
    const previous = byAddress.get(key);
    if (previous === undefined || newestFirst(entry, previous) < 0) byAddress.set(key, entry);
  }
  return [...byAddress.values()];
}

/** The newest unexpired request already stored for `gmailAddress` (normalized, lowercased), or undefined. */
function pendingFor(requests: readonly SummaryGmailRequest[], gmailAddress: string): SummaryGmailRequest | undefined {
  return requests.find((request) => request.gmailAddress.toLowerCase() === gmailAddress);
}

/**
 * The unexpired Gmail requests in the contract shape, newest first, one per Gmail address (the
 * newest), at most SUMMARY_LIMITS.maxGmailRequests. Pure; summaryStatus uses it. Entries that do
 * not parse are skipped.
 */
export function activeGmailRequests(user: Pick<SummaryUserDoc, 'gmailRequests'>, now: Date): SummaryGmailRequest[] {
  return unexpiredGmailRequests(user, now).sort(newestFirst).slice(0, SUMMARY_LIMITS.maxGmailRequests);
}

/**
 * Which requests to keep (finding 14): those from a listed mailbox or the verified account email
 * first, then newest first. `listed` holds normalized, lowercased addresses.
 */
function keepOrder(listed: ReadonlySet<string>): (a: SummaryGmailRequest, b: SummaryGmailRequest) => number {
  const rank = (request: SummaryGmailRequest): number => (listed.has(request.gmailAddress.toLowerCase()) ? 0 : 1);
  return (a, b) => rank(a) - rank(b) || newestFirst(a, b);
}

/**
 * Stores a Gmail confirmation code on summaryUsers/{uid} in ONE transaction: expired entries
 * dropped, an entry for the same Gmail address replaced by a NEWER one only, at most 3 kept, each
 * {gmailAddress, code, receivedAt}, stored newest first. Which 3 (finding 14): requests from the
 * user's listed mailboxes or `accountEmail` rank ahead of the others, then the newest, so three
 * strangers asking to forward here never push out the user's own code; a listed request may push
 * out an unlisted one. Outcomes: stored; stale (the pending request of the same address was
 * received at or after `receivedAt`, so a retry of an older confirmation never replaces the newer
 * code; nothing written); crowded_out (an unlisted request with three listed ones pending, nothing
 * written); invalid: the address or code does not parse (nothing written); expired: it arrived
 * more than 2 days ago (a late redelivery); dropped: no address (missing or tombstone
 * summaryUsers, or `tokenHash` no longer maps to the uid). Never creates summaryUsers.
 */
export async function storeGmailRequest(db: Firestore, input: StoreGmailRequestInput): Promise<GmailRequestOutcome> {
  assertUid(input.uid);
  const gmailAddress = normalizeMailbox(input.gmailAddress);
  if (gmailAddress === null || !summaryGmailCodeSchema.safeParse(input.code).success) return 'invalid';
  const parsed = summaryGmailRequestSchema.safeParse({ gmailAddress, code: input.code, receivedAt: input.receivedAt.toISOString() });
  if (!parsed.success) return 'invalid';
  const entry = parsed.data;
  if (gmailExpired(entry, input.now.getTime())) return 'expired';
  const uid = input.uid;
  const accountEmail = normalizeMailbox(input.accountEmail);

  return db.runTransaction(async (tx: Transaction): Promise<GmailRequestOutcome> => {
    if (input.tokenHash !== undefined) {
      const owner = await resolveTokenInTransaction(tx, db, input.tokenHash);
      if (owner !== uid) return 'dropped';
    }
    const ref = summaryUserRef(db, uid);
    const user = addressHolder(await tx.get(ref));
    if (user === null) return 'dropped';
    const listed = new Set<string>(user.mailboxes);
    if (accountEmail !== null) listed.add(accountEmail);
    const pending = unexpiredGmailRequests(user, input.now);
    // Only a newer confirmation replaces the pending code of the same address: a Postmark retry of
    // an older delivery keeps its first-seen receivedAt, so it never wins over a later code.
    const same = pendingFor(pending, gmailAddress);
    if (same !== undefined && (isoMs(same.receivedAt) ?? 0) >= input.receivedAt.getTime()) return 'stale';
    const others = pending.filter((request) => request.gmailAddress.toLowerCase() !== gmailAddress);
    const kept = [entry, ...others].sort(keepOrder(listed)).slice(0, SUMMARY_LIMITS.maxGmailRequests);
    if (!kept.includes(entry)) return 'crowded_out';
    tx.update(ref, { gmailRequests: kept.sort(newestFirst) });
    return 'stored';
  });
}

// ---------------------------------------------------------------------------------------------
// Commit (steps 13 and 15, row 16)
// ---------------------------------------------------------------------------------------------

export type CommitOutcome = 'created' | 'upgraded' | 'duplicate' | 'dropped';

/** Why, as a fixed code (safe to log). */
export type CommitReason =
  /** created: no copy and no live marker. */
  | 'new'
  /** upgraded: an existing copy (same id or same digest) had a lower trust rank. */
  | 'better_copy'
  /** duplicate: an existing copy has the same or a higher trust rank (or could not be read). */
  | 'copy_exists'
  /**
   * duplicate: no copy left but a live Message-ID or digest marker (claimed by a row 7 or 10 copy,
   * or written by a user delete for the deleted content): never recreated.
   */
  | 'marker_claimed'
  /** duplicate: the user deleted the summary with this id (a live deletion marker), any row. */
  | 'deleted_by_user'
  /** duplicate: create() hit ALREADY_EXISTS. */
  | 'already_exists'
  /** dropped: the address no longer maps to the uid (regenerated, disconnected, deleted). */
  | 'address_changed'
  /** dropped: users/{uid} is gone (account deleted). */
  | 'user_missing';

export interface CommitSummaryInput {
  uid: string;
  /** summaryAddresses doc id the mail arrived on (re-read inside the transaction). */
  tokenHash: string;
  /** summaryIdFor(uid, messageKey): the id `doc` was sealed for. */
  summaryId: string;
  /** buildSummaryDoc(...).doc. */
  doc: StoredSummaryDoc;
  /** buildSummaryDoc(...).reseal: seals the same content for an upgrade target with another id. */
  reseal: (summaryId: string) => SealedSummaryFields;
  /** buildSummaryDoc(...).claimMarkers (rows 7 and 10). Ignored for any other rank. */
  claimMarkers: boolean;
  /** messageMarkerKey(uid, messageKey), or null. */
  messageIdMarkerKey: string | null;
  /** digestMarkerKey(uid, doc.contentDigest), or null. */
  digestMarkerKey: string | null;
  /** buildSummaryDoc(...).rank (trustRank of the decision row). */
  rank: number;
  now: Date;
}

export interface CommitSummaryResult {
  outcome: CommitOutcome;
  reason: CommitReason;
  /** The summary written (created, upgraded) or the copy that made this one a duplicate; else null. */
  summaryId: string | null;
  /** That summary's status after the commit (for the `matched` log field); null when unknown. */
  status: StoredSummaryStatus | null;
  /** Markers written by this commit (0 to 2). */
  markersClaimed: number;
}

interface ExistingCopy {
  id: string;
  doc: StoredSummaryDoc;
  rank: number;
  byId: boolean;
}

/**
 * The fields an upgrade replaces: the new copy's trust facts, auth, domains, times, content and
 * digest. Kept: createdAt, receivedAt (the first receipt), userAction, rejectedMeetingIds,
 * extraction, mergedIds and mergedDigests (commitSummary extends those two with mergedLinksPatch)
 * and any unknown field. Without a user action the new status, inboxReason, match,
 * candidates and expiresAt replace the old; a summary the user attached, kept or detached keeps
 * its status, match and suggestions (never override a user action). update() replaces each listed
 * top-level field as a whole, so no stale nested key survives.
 */
export function upgradePatch(
  target: StoredSummaryDoc,
  incoming: StoredSummaryDoc,
  sealed: SealedSummaryFields,
  nowIso: string,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    schemaVersion: incoming.schemaVersion,
    parserVersion: incoming.parserVersion,
    trust: incoming.trust,
    senderDomain: incoming.senderDomain,
    vendorDomain: incoming.vendorDomain,
    auth: incoming.auth,
    sentAt: incoming.sentAt,
    anchorAt: incoming.anchorAt,
    summaryDate: incoming.summaryDate,
    language: incoming.language ?? target.language,
    counts: incoming.counts,
    flags: incoming.flags,
    contentDigest: incoming.contentDigest,
    sealedHead: sealed.sealedHead,
    sealedBody: sealed.sealedBody,
    updatedAt: nowIso,
  };
  if (target.userAction === null) {
    patch.status = incoming.status;
    patch.inboxReason = incoming.inboxReason;
    patch.match = incoming.match;
    patch.candidates = incoming.candidates;
    patch.expiresAt = summaryExpiresAt(incoming.status, target.receivedAt);
  }
  return patch;
}

/** `list` with `value` added last, the newest MAX_MERGED_LINKS kept; null when it is already there. */
function withLink(list: readonly string[] | undefined, value: string): string[] | null {
  const current = list ?? [];
  return current.includes(value) ? null : [...current, value].slice(-MAX_MERGED_LINKS);
}

/**
 * The upgrade links an in-place upgrade adds to its target (pure; design section 7): the incoming
 * copy's id in mergedIds when it differs from the target's, and the target's previous
 * contentDigest in mergedDigests when the upgrade replaces it. deleteSummary turns each into a
 * deletion or digest marker, so a user delete also covers the copies the summary absorbed. Empty
 * when nothing changes (a same-id upgrade with the same content, or a link already recorded).
 */
export function mergedLinksPatch(
  target: Pick<StoredSummaryDoc, 'contentDigest' | 'mergedIds' | 'mergedDigests'>,
  targetId: string,
  incomingId: string,
  incomingDigest: string,
): { mergedIds?: string[]; mergedDigests?: string[] } {
  const patch: { mergedIds?: string[]; mergedDigests?: string[] } = {};
  if (incomingId !== targetId) {
    const ids = withLink(target.mergedIds, incomingId);
    if (ids !== null) patch.mergedIds = ids;
  }
  if (incomingDigest !== target.contentDigest) {
    const digests = withLink(target.mergedDigests, target.contentDigest);
    if (digests !== null) patch.mergedDigests = digests;
  }
  return patch;
}

function latestIso(a: string | null, b: string): string {
  const am = isoMs(a);
  const bm = isoMs(b);
  if (am === null) return b;
  return bm !== null && bm > am ? b : (a as string);
}

/** Upgrade target: the copy with the same id, else the best-ranked, then the oldest. */
function pickTarget(copies: readonly ExistingCopy[]): ExistingCopy | undefined {
  const byId = copies.find((copy) => copy.byId);
  if (byId !== undefined) return byId;
  return [...copies].sort((a, b) => b.rank - a.rank || (isoMs(a.doc.createdAt) ?? 0) - (isoMs(b.doc.createdAt) ?? 0))[0];
}

/**
 * Seals the outcome of an accepted or inbox summary in ONE transaction (step 15). Reads first:
 * summaryAddresses/{tokenHash} and summaryUsers/{uid} (must still map to the uid, else dropped
 * address_changed), users/{uid} (must exist, else dropped user_missing), the summary by id, up to
 * DIGEST_TWIN_QUERY_LIMIT summaries with the same contentDigest, the Message-ID and digest
 * markers, and the deletion marker of the summary id (for every row). Then:
 * - a live deletion marker (the user deleted this summary; design section 7): 'duplicate'
 *   deleted_by_user, whatever the row, so neither a retry of the same delivery, nor the same mail
 *   resent at row 8 or 9, nor a better row 7 copy of it brings it back;
 * - an existing copy (by id or digest) with a lower trust rank is upgraded in place (upgradePatch;
 *   resealed for its own id when the id differs): 'upgraded'. The same update adds the upgrade
 *   links (mergedLinksPatch): the incoming id when it differs from the target's, the target's
 *   previous digest when it changes, so deleting the target later also marks those;
 * - an existing copy with the same or a higher rank, or one that does not parse: 'duplicate'. When
 *   the dropped copy has no document of its own, its id is linked into the kept summary's
 *   mergedIds, so deleting that summary later also marks this id;
 * - no copy but a live Message-ID or digest marker: 'duplicate'. The digest marker is claimed by
 *   rows 7 and 10 and also written by a user delete, so a copy of deleted content under another
 *   Message-ID (any row) is not recreated either;
 * - otherwise create() the summary: 'created' (ALREADY_EXISTS at commit: 'duplicate').
 * Markers {expiresAt: 35 days} are claimed (written when missing or expired) only when claimMarkers
 * and the rank is row 7's or row 10's, on every outcome but dropped. created and upgraded also move
 * summaryUsers.lastReceivedAt forward to the summary's receivedAt. Any other Firestore error
 * propagates and, the transaction being atomic, leaves nothing behind.
 */
export async function commitSummary(db: Firestore, input: CommitSummaryInput): Promise<CommitSummaryResult> {
  assertUid(input.uid);
  if (!isSummaryId(input.summaryId)) throw new Error('summaries.store: invalid summaryId');
  const parsedDoc = storedSummarySchema.safeParse(input.doc);
  if (!parsedDoc.success) throw new Error('summaries.store: the summary document does not match the stored schema');
  const doc = parsedDoc.data;
  const uid = input.uid;
  const now = input.now;
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const claim = input.claimMarkers && MARKER_CLAIM_RANKS.has(input.rank);
  const markerKeys = [...new Set([input.messageIdMarkerKey, input.digestMarkerKey])].filter(
    (key): key is string => typeof key === 'string' && HEX64.test(key),
  );
  const deletionRef = eventRef(db, deletionMarkerKey(uid, input.summaryId));

  const result = (
    outcome: CommitOutcome,
    reason: CommitReason,
    summaryId: string | null,
    status: StoredSummaryStatus | null,
    markersClaimed = 0,
  ): CommitSummaryResult => ({ outcome, reason, summaryId, status, markersClaimed });

  try {
    return await db.runTransaction(async (tx: Transaction): Promise<CommitSummaryResult> => {
      // ---- Reads (all before any write) ----
      const owner = await resolveTokenInTransaction(tx, db, input.tokenHash);
      if (owner !== uid) return result('dropped', 'address_changed', null, null);
      if (!(await tx.get(userRef(db, uid))).exists) return result('dropped', 'user_missing', null, null);
      const sUserRef = summaryUserRef(db, uid);
      const sUser = addressHolder(await tx.get(sUserRef));
      if (sUser === null) return result('dropped', 'address_changed', null, null);
      const ownRef = summaryRef(db, uid, input.summaryId);
      const ownSnap = await tx.get(ownRef);
      const twins = await tx.get(summariesCollection(db, uid).where('contentDigest', '==', doc.contentDigest).limit(DIGEST_TWIN_QUERY_LIMIT));
      const markers: { ref: DocumentReference; live: boolean }[] = [];
      for (const key of markerKeys) {
        const ref = eventRef(db, key);
        markers.push({ ref, live: markerLive(await tx.get(ref), nowMs) });
      }
      const deletedByUser = markerLive(await tx.get(deletionRef), nowMs);

      // ---- Decision ----
      const found: { id: string; raw: unknown; byId: boolean }[] = [];
      if (ownSnap.exists) found.push({ id: input.summaryId, raw: ownSnap.data(), byId: true });
      for (const twin of twins.docs) {
        if (twin.id !== input.summaryId) found.push({ id: twin.id, raw: twin.data(), byId: false });
      }
      const copies: ExistingCopy[] = [];
      let unreadable = false;
      for (const entry of found) {
        const existing = parseStoredSummary(entry.raw);
        if (existing === null) unreadable = true;
        else copies.push({ id: entry.id, doc: existing, rank: trustRankOf(existing.trust), byId: entry.byId });
      }

      // ---- Writes ----
      const claimMarkers = (): number => {
        if (!claim) return 0;
        let written = 0;
        for (const marker of markers) {
          if (marker.live) continue;
          tx.set(marker.ref, { expiresAt: markerExpiresAt(now) });
          written += 1;
        }
        return written;
      };
      const touchLastReceived = (): void => {
        const next = latestIso(sUser.lastReceivedAt, doc.receivedAt);
        if (next !== sUser.lastReceivedAt) tx.update(sUserRef, { lastReceivedAt: next });
      };

      // Deleted by the user: never recreated, upgraded or twinned, whatever the row (section 7).
      if (deletedByUser) return result('duplicate', 'deleted_by_user', null, null, claimMarkers());
      const best = [...copies].sort((a, b) => b.rank - a.rank)[0];
      if (unreadable) {
        // Never overwrite or twin a copy this version cannot read.
        return result('duplicate', 'copy_exists', best?.id ?? (ownSnap.exists ? input.summaryId : null), best?.doc.status ?? null, claimMarkers());
      }
      if (best !== undefined) {
        if (input.rank <= best.rank) {
          // The copy is dropped, but when it has no document of its own its id is linked to the kept
          // summary (bounded, like an upgrade link), so a user delete of that summary also writes the
          // deletion marker for this id and a resend of it with changed text stays deleted.
          if (!ownSnap.exists) {
            const links = mergedLinksPatch(best.doc, best.id, input.summaryId, best.doc.contentDigest);
            if (links.mergedIds !== undefined) tx.update(summaryRef(db, uid, best.id), { mergedIds: links.mergedIds });
          }
          return result('duplicate', 'copy_exists', best.id, best.doc.status, claimMarkers());
        }
        const target = pickTarget(copies) ?? best;
        const sealed = target.id === input.summaryId ? { sealedHead: doc.sealedHead, sealedBody: doc.sealedBody } : input.reseal(target.id);
        const patch: Record<string, unknown> = {
          ...upgradePatch(target.doc, doc, sealed, nowIso),
          ...mergedLinksPatch(target.doc, target.id, input.summaryId, doc.contentDigest),
        };
        tx.update(summaryRef(db, uid, target.id), patch);
        const claimed = claimMarkers();
        touchLastReceived();
        const status = (patch.status as StoredSummaryStatus | undefined) ?? target.doc.status;
        return result('upgraded', 'better_copy', target.id, status, claimed);
      }
      if (markers.some((marker) => marker.live)) return result('duplicate', 'marker_claimed', null, null, claimMarkers());
      tx.create(ownRef, doc);
      const claimed = claimMarkers();
      touchLastReceived();
      return result('created', 'new', input.summaryId, doc.status, claimed);
    });
  } catch (error) {
    if (isAlreadyExists(error)) return result('duplicate', 'already_exists', input.summaryId, null);
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------
// Inbox count
// ---------------------------------------------------------------------------------------------

/** Summaries waiting in the inbox (an aggregation count on status == 'inbox'). */
export async function countInbox(db: Firestore, uid: string): Promise<number> {
  const snapshot = await summariesCollection(db, uid).where('status', '==', 'inbox').count().get();
  const count: unknown = snapshot.data().count;
  return typeof count === 'number' && Number.isInteger(count) && count >= 0 ? count : 0;
}
