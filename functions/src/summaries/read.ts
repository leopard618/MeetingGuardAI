/**
 * summaryRead and the M11 hand-off (docs/v2/M10-DESIGN.md section 4 Callables, sections 6 to 9;
 * contract: shared/aiContract.ts summaryRead* schemas, summaryDetailSchema, SUMMARY_LIMITS and
 * SUMMARY_ERROR_CODES). Pure handlers over injected deps (db, clock, the two non-secret params and
 * the keyring), like ./callables.ts; ./readFunction.ts is the Firebase shell and loads this module
 * lazily on the first call, so no other function instance carries the open path.
 *
 * Rules:
 * - Gates exactly as summaryAction (callables.ts requireActionCaller): a verified caller
 *   (unauthenticated), SUMMARIES_ENABLED (not_enabled), the pilot list (not_allowed), in that order,
 *   then the request (invalid_request).
 * - Decrypt only what the answer needs. A list reads its rows through a field mask that leaves
 *   sealedBody in Firestore and opens sealedHead only (the title). get opens sealedHead and
 *   sealedBody. The keyring is asked for on the first open, so a list with nothing to open (an
 *   empty view, the refused rows) never needs the data key.
 * - list: newest first by receivedAt (refused rows: newest UTC day first), at most
 *   SUMMARY_LIMITS.maxListItems rows, hasMore when more exist or a bounded scan came back full.
 *   Views: inbox (status inbox), recent (matched or kept), refused (one row per UTC day with its
 *   count, no content), meeting (filed under that meeting id, as the group's representative or as
 *   one of its duplicateMeetingIds; the master id for a series).
 * - get: the full view. A refused row, a missing summary, another user's summary or one this
 *   version cannot read answer not_found WITH details.reason 'not_found' (summaryError): the app
 *   reads functions/not-found WITHOUT details as "summaryRead is not deployed" (not_enabled).
 * - Queries: inbox (status ==) and recent (status in matched, kept) are ORDERED by receivedAt
 *   descending in Firestore, on the meetingSummaries (status, receivedAt desc) composite index in
 *   firestore.indexes.json, so a bounded read always holds the newest rows: an unordered limit
 *   returns documents in id order (sha256 hex, effectively random), and a flood of inbox mail could
 *   then hide the newest items and starve the recent view (review S7). The index must be deployed
 *   before summaryRead (it is deployed with the rules, design section 7). refused and meeting
 *   filter by one equality and sort in memory (bounded by SUMMARY_READ_TUNING.scanLimit; one row
 *   per UTC day, and the summaries filed under one meeting, are few).
 * - Inbox re-match (the phone may import the meeting after the recap arrived): before the inbox
 *   answers, up to SUMMARY_READ_TUNING.rematchMax of the newest inbox items are matched again with
 *   candidates.ts and match.ts decide(), from the stored trust facts, anchor and summary date, so a
 *   re-match can only file what summaryInbound would have filed (rule A on a row 7 copy;
 *   model.ts buildSummaryDoc applies the same rule). The candidate start gate uses the RECEIPT
 *   time, never the current time: a recap cannot be about a meeting that had not begun when it
 *   arrived. Never filed: a summary with a userAction (the user detached, kept or chose; its
 *   suggestions and reason are still refreshed), a meeting in rejectedMeetingIds (never suggested
 *   either), a row 9 (not_addressed_to_you) item, which is not re-matched at all and never gets
 *   one-tap suggestions. The text is opened only when a candidate carries a conference link
 *   (decide()'s link bonus). Each write runs in a transaction that re-reads the document and
 *   writes nothing when another device changed it meanwhile. One item's failure is logged and
 *   skipped; it never fails the list.
 * - Errors: HttpsError as thrown; a SealedError (key or blob) is upstream_error and logs only its
 *   reason (a key that does not parse is also a summaries.setup_alarm); anything else is
 *   upstream_error with errorName. A list row whose head does not open shows title null (logged
 *   by reason and count), so one damaged row never hides the inbox and can still be deleted.
 * - Answers are validated with the contract response schemas before they are returned.
 * - Logs carry uid, op, view, counts, reason codes and errorName only: never a title, a subject,
 *   an address, text, a summary id or a meeting id.
 *
 * loadSummaryForExtraction (design section 8) is M11's only way in: filed or kept summaries, with
 * the decrypted text and sections plus the plain context. No callable exposes it yet.
 *
 * Product text rule: ASCII punctuation only in this file.
 */
import { HttpsError } from 'firebase-functions/https';
import * as logger from 'firebase-functions/logger';
import type { DocumentReference, Firestore, Query, QuerySnapshot, Transaction } from 'firebase-admin/firestore';
import type { z } from 'zod';

import {
  SUMMARY_LIMITS,
  summaryListItemSchema,
  summaryReadGetResponseSchema,
  summaryReadListResponseSchema,
  summaryReadRequestSchema,
  summarySuggestionSchema,
  type SummaryDetail,
  type SummaryInboxReason,
  type SummaryListItem,
  type SummaryListView,
  type SummaryReadGetResponse,
  type SummaryReadListResponse,
  type SummaryReadResponse,
  type SummarySection as ContractSummarySection,
  type SummarySuggestion,
  type SummaryTier,
} from '../shared/aiContract';
import { SealedError, parseKeyring, type Keyring } from '../shared/sealed';
import { contractMatchOf } from './actions';
import { requireActionCaller, summaryError, type SummaryCallableAuth } from './callables';
import { candidateWindow, loadCandidates, readPreferencesTimeZone, type CandidateWindow, type LoadCandidatesOptions, type LoadedCandidates } from './candidates';
import { decide, trustInboxReason, type MatchAnchor, type MatchRecord } from './match';
import {
  SUMMARY_UID_PATTERN,
  openSummaryBody,
  openSummaryHead,
  parseRefusedRow,
  parseSummaryRecord,
  senderDomainOrNull,
  storedCandidateOf,
  storedCandidateSchema,
  storedMatchOf,
  storedMatchSchema,
  storedSummarySchema,
  summaryDocPath,
  summaryExpiresAt,
  trustRowOf,
  type RefusedRowDoc,
  type StoredMatch,
  type SummaryAnchorSource,
  type SummaryHead,
  type SummaryRef,
} from './model';
import { sliceSafe } from './sanitize';
import { cleanSubject, type SummarySection } from './sections';
import { summariesCollection } from './store';

// ---------------------------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------------------------

export interface SummaryReadTuning {
  /** Inbox items re-matched per inbox list (design section 4: up to 10). */
  rematchMax: number;
  /** Documents read by one list query (inbox newest first; refused and meeting before the in-memory sort). */
  scanLimit: number;
  /** Newest filed or kept summaries read for the recent view (one more than a page shows). */
  recentScanLimit: number;
}

export const SUMMARY_READ_TUNING: Readonly<SummaryReadTuning> = {
  rematchMax: 10,
  // Inbox items live 60 days and refused rows 30, so a full scan means unusual volume.
  scanLimit: 500,
  recentScanLimit: SUMMARY_LIMITS.maxListItems + 1,
};

// ---------------------------------------------------------------------------------------------
// Field masks and row shapes
// ---------------------------------------------------------------------------------------------

/**
 * What the decision of a re-match rests on. The re-match transaction compares them with the
 * document it re-reads; any difference (a user action, an upgrade by a better copy, an earlier
 * re-match on another device) means somebody else changed it, and nothing is written.
 */
const MATCH_BASIS_FIELDS = ['status', 'userAction', 'rejectedMeetingIds', 'trust', 'anchorAt', 'summaryDate', 'contentDigest', 'receivedAt', 'updatedAt'] as const;

/** The plain fields a re-match reads back in its transaction (no sealed field). */
export const SUMMARY_REMATCH_FIELDS = [...MATCH_BASIS_FIELDS, 'schemaVersion', 'inboxReason', 'senderDomain', 'match', 'candidates'] as const;

/** A list row's field mask: the plain fields plus sealedHead. sealedBody never leaves Firestore. */
export const SUMMARY_LIST_FIELDS = [...SUMMARY_REMATCH_FIELDS, 'sealedHead'] as const;

/** A refused row's field mask (it holds no content). */
export const SUMMARY_REFUSED_FIELDS = ['status', 'refusedReason', 'senderDomain', 'firstAt', 'lastAt', 'count', 'expiresAt', 'schemaVersion'] as const;

const listDocSchema = storedSummarySchema.pick({
  schemaVersion: true,
  status: true,
  inboxReason: true,
  trust: true,
  senderDomain: true,
  receivedAt: true,
  anchorAt: true,
  summaryDate: true,
  match: true,
  candidates: true,
  rejectedMeetingIds: true,
  userAction: true,
  contentDigest: true,
  updatedAt: true,
  sealedHead: true,
});
const rematchDocSchema = listDocSchema.omit({ sealedHead: true });
const storedCandidatesSchema = storedCandidateSchema.array().max(SUMMARY_LIMITS.maxSuggestions);

/** A summary as a list reads it (SUMMARY_LIST_FIELDS). */
export type SummaryListDoc = z.infer<typeof listDocSchema>;
/** A summary as the re-match transaction reads it (SUMMARY_REMATCH_FIELDS). */
export type SummaryRematchDoc = z.infer<typeof rematchDocSchema>;

interface ListedSummary {
  id: string;
  doc: SummaryListDoc;
}

interface Scan {
  rows: ListedSummary[];
  /** A query came back full: more matching documents may exist. */
  capped: boolean;
  /** Documents that did not parse (another schema version, a damaged document); skipped. */
  unreadable: number;
}

/** Firestore document ids the summary id pattern allows, minus the reserved __x__ form (as in actions.ts). */
const DOC_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const RESERVED_DOC_ID = /^__.*__$/;
/** A refused row's id (model.ts refusedRowId). */
const REFUSED_ROW_ID = /^refused-\d{4}-\d{2}-\d{2}$/;

function isUsableDocId(value: unknown): value is string {
  return typeof value === 'string' && DOC_ID_PATTERN.test(value) && !RESERVED_DOC_ID.test(value);
}

function isUsableUid(uid: unknown): uid is string {
  return typeof uid === 'string' && SUMMARY_UID_PATTERN.test(uid);
}

function isoMs(value: string): number {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function newestFirst(a: ListedSummary, b: ListedSummary): number {
  const diff = isoMs(b.doc.receivedAt) - isoMs(a.doc.receivedAt);
  if (diff !== 0) return diff;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** JSON with object keys sorted, so Firestore's key order never makes equal values differ. */
function canonical(value: unknown): string {
  const sorted = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(sorted);
    if (typeof entry === 'object' && entry !== null) {
      const record = entry as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(record)
          .sort()
          .map((key) => [key, sorted(record[key])]),
      );
    }
    return entry;
  };
  return JSON.stringify(sorted(value)) ?? 'undefined';
}

function matchBasisOf(doc: Pick<SummaryRematchDoc, (typeof MATCH_BASIS_FIELDS)[number]>): string {
  return canonical(Object.fromEntries(MATCH_BASIS_FIELDS.map((field) => [field, doc[field] ?? null])));
}

// ---------------------------------------------------------------------------------------------
// Deps
// ---------------------------------------------------------------------------------------------

/** The two non-secret params, read by the shell at call time. */
export interface SummaryReadConfig {
  /** SUMMARIES_ENABLED.value() === true. */
  enabled: boolean;
  /** SUMMARIES_PILOT_UIDS (raw comma list; gate.ts parses it). */
  pilotUids: string;
}

export interface SummaryReadLogger {
  info(event: string, fields: Record<string, unknown>): void;
  warn(event: string, fields: Record<string, unknown>): void;
  error(event: string, fields: Record<string, unknown>): void;
}

const defaultLogger: SummaryReadLogger = {
  info: (event, fields) => logger.info(event, fields),
  warn: (event, fields) => logger.warn(event, fields),
  error: (event, fields) => logger.error(event, fields),
};

/** candidates.ts loadCandidates (tests may wrap it). */
export type SummaryCandidatesLoader = (
  db: Firestore,
  uid: string,
  window: CandidateWindow | null,
  now: Date,
  options?: LoadCandidatesOptions,
) => Promise<LoadedCandidates>;

export interface SummaryReadDeps {
  db: Firestore;
  now: () => Date;
  config: SummaryReadConfig;
  /**
   * The keyring of SUMMARIES_DATA_KEY (lazyKeyring). Asked for only when something is opened;
   * throws SealedError for a value that does not parse.
   */
  keyring: () => Keyring;
  /** Test seam: candidates.ts loadCandidates by default. */
  candidates?: SummaryCandidatesLoader;
  /** Test seam: firebase-functions/logger by default. */
  logger?: SummaryReadLogger;
  /** Test seam: SUMMARY_READ_TUNING by default. */
  tuning?: Partial<SummaryReadTuning>;
}

/**
 * The keyring of SUMMARIES_DATA_KEY, parsed on first use and kept while the secret value stays the
 * same; a malformed value throws SealedError every time (never cached). The same contract as
 * inbound.ts lazyKeyring, which cannot be imported here: it would load mailauth with the pipeline.
 * The value is never logged.
 */
export function lazyKeyring(readSecret: () => string): () => Keyring {
  let cached: { secret: string; keyring: Keyring } | null = null;
  return () => {
    const secret = readSecret();
    if (cached !== null && cached.secret === secret) return cached.keyring;
    const keyring = parseKeyring(secret);
    cached = { secret, keyring };
    return keyring;
  };
}

interface ReadContext {
  uid: string;
  db: Firestore;
  now: Date;
  /** The keyring, asked for once per call and only when something is opened. */
  keyring: () => Keyring;
  candidates: SummaryCandidatesLoader;
  tuning: SummaryReadTuning;
  log: SummaryReadLogger;
}

function contextOf(uid: string, deps: SummaryReadDeps): ReadContext {
  let keyring: Keyring | null = null;
  return {
    uid,
    db: deps.db,
    now: deps.now(),
    keyring: () => {
      if (keyring === null) keyring = deps.keyring();
      return keyring;
    },
    candidates: deps.candidates ?? loadCandidates,
    tuning: { ...SUMMARY_READ_TUNING, ...deps.tuning },
    log: deps.logger ?? defaultLogger,
  };
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

const MESSAGES = {
  invalidRequest: 'The summary request is not valid.',
  notFound: 'That summary was not found.',
  upstream: 'Meeting summaries are not available right now. Try again later.',
} as const;

// ---------------------------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------------------------

/** The title a row shows: the title line, else the cleaned subject, cut to maxTitleChars; else null. */
export function summaryTitleOf(head: SummaryHead): string | null {
  const line = head.titleLine !== null && head.titleLine.trim().length > 0 ? head.titleLine : cleanSubject(head.subject);
  if (line === null) return null;
  const title = sliceSafe(line, SUMMARY_LIMITS.maxTitleChars).trim();
  return title.length > 0 ? title : null;
}

/**
 * One-tap suggestions of an inbox item, best first: the stored candidates minus any meeting the
 * user rejected (the representative or a duplicate), at most SUMMARY_LIMITS.maxSuggestions, and
 * none at all on a row 9 item (not_addressed_to_you, finding 7) or outside the inbox.
 */
export function summarySuggestionsOf(doc: Pick<SummaryListDoc, 'status' | 'trust' | 'candidates' | 'rejectedMeetingIds'>): SummarySuggestion[] {
  if (doc.status !== 'inbox' || trustRowOf(doc.trust) === 9) return [];
  const rejected = new Set(doc.rejectedMeetingIds);
  const out: SummarySuggestion[] = [];
  for (const candidate of doc.candidates) {
    if (rejected.has(candidate.meetingId) || candidate.duplicateMeetingIds.some((id) => rejected.has(id))) continue;
    const parsed = summarySuggestionSchema.safeParse({
      meetingId: candidate.meetingId,
      occurrenceDate: candidate.occurrenceDate,
      title: candidate.title,
      startAt: candidate.startAt,
      score: candidate.score,
    });
    if (parsed.success) out.push(parsed.data);
    if (out.length >= SUMMARY_LIMITS.maxSuggestions) break;
  }
  return out;
}

type RowDoc = Pick<
  SummaryListDoc,
  'status' | 'inboxReason' | 'trust' | 'senderDomain' | 'receivedAt' | 'summaryDate' | 'match' | 'candidates' | 'rejectedMeetingIds'
>;

/** A summary's list row (no content but the title). */
export function summaryListItemOf(summaryId: string, doc: RowDoc, title: string | null): SummaryListItem {
  return {
    summaryId,
    status: doc.status,
    title,
    summaryDate: doc.summaryDate,
    receivedAt: doc.receivedAt,
    tier: doc.trust.tier,
    recipientBound: doc.trust.recipientBound,
    fresh: doc.trust.fresh,
    inboxReason: doc.status === 'inbox' ? doc.inboxReason : null,
    refusedReason: null,
    senderDomain: senderDomainOrNull(doc.senderDomain),
    count: null,
    match: doc.status === 'matched' ? contractMatchOf(doc.match) : null,
    suggestions: summarySuggestionsOf(doc),
  };
}

/** A refused row as a list row: the day's count, the latest reason and sender domain, no content. */
export function refusedListItemOf(rowId: string, row: RefusedRowDoc): SummaryListItem {
  return {
    summaryId: rowId,
    status: 'refused',
    title: null,
    summaryDate: null,
    receivedAt: row.lastAt,
    tier: null,
    recipientBound: false,
    fresh: false,
    inboxReason: null,
    refusedReason: row.refusedReason,
    senderDomain: senderDomainOrNull(row.senderDomain),
    count: row.count,
    match: null,
    suggestions: [],
  };
}

/** A sealed section in the contract shape (the section flags stay on the server). */
function contractSectionOf(section: SummarySection): ContractSummarySection {
  return {
    id: section.id,
    kind: section.kind,
    heading: section.heading,
    derived: section.derived,
    start: section.start,
    end: section.end,
    items: section.items.map((item) => ({
      id: item.id,
      text: item.text,
      start: item.start,
      end: item.end,
      checked: item.checked,
      owner: item.owner,
      dueText: item.dueText,
      flags: [...item.flags],
    })),
  };
}

// ---------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------

function listedOf(snapshot: QuerySnapshot, keep: (doc: SummaryListDoc) => boolean): { rows: ListedSummary[]; unreadable: number } {
  const rows: ListedSummary[] = [];
  let unreadable = 0;
  for (const document of snapshot.docs) {
    const parsed = listDocSchema.safeParse(document.data());
    if (!parsed.success || !isUsableDocId(document.id)) {
      unreadable += 1;
      continue;
    }
    if (keep(parsed.data)) rows.push({ id: document.id, doc: parsed.data });
  }
  return { rows, unreadable };
}

async function scanQuery(query: Query, limit: number, keep: (doc: SummaryListDoc) => boolean): Promise<Scan> {
  const snapshot = await query.select(...SUMMARY_LIST_FIELDS).limit(limit).get();
  const { rows, unreadable } = listedOf(snapshot, keep);
  return { rows, capped: snapshot.size >= limit, unreadable };
}

/** The newest inbox items (status ==, ordered by receivedAt desc on the composite index). */
function readInbox(ctx: ReadContext): Promise<Scan> {
  const query = summariesCollection(ctx.db, ctx.uid).where('status', '==', 'inbox').orderBy('receivedAt', 'desc');
  return scanQuery(query, ctx.tuning.scanLimit, (doc) => doc.status === 'inbox');
}

/**
 * The newest filed or kept summaries (status in, ordered by receivedAt desc on the same composite
 * index), so inbox items, however many, never push them out of the read.
 */
function readRecent(ctx: ReadContext): Promise<Scan> {
  const query = summariesCollection(ctx.db, ctx.uid).where('status', 'in', ['matched', 'kept']).orderBy('receivedAt', 'desc');
  return scanQuery(query, ctx.tuning.recentScanLimit, (doc) => doc.status === 'matched' || doc.status === 'kept');
}

/**
 * Filed under `meetingId`: as the match's meeting (the master id for a series) or as one of its
 * duplicateMeetingIds (the same meeting imported twice, design section 6 Grouping). Two
 * single-field queries, merged.
 */
async function readMeeting(ctx: ReadContext, meetingId: string): Promise<Scan> {
  const collection = summariesCollection(ctx.db, ctx.uid);
  const filedHere = (doc: SummaryListDoc): boolean =>
    doc.status === 'matched' && doc.match !== null && (doc.match.meetingId === meetingId || doc.match.duplicateMeetingIds.includes(meetingId));
  const [direct, duplicate] = await Promise.all([
    scanQuery(collection.where('match.meetingId', '==', meetingId), ctx.tuning.scanLimit, filedHere),
    scanQuery(collection.where('match.duplicateMeetingIds', 'array-contains', meetingId), ctx.tuning.scanLimit, filedHere),
  ]);
  const byId = new Map<string, ListedSummary>();
  for (const row of [...direct.rows, ...duplicate.rows]) byId.set(row.id, row);
  return { rows: [...byId.values()], capped: direct.capped || duplicate.capped, unreadable: direct.unreadable + duplicate.unreadable };
}

interface RefusedScan {
  rows: { id: string; row: RefusedRowDoc }[];
  capped: boolean;
  unreadable: number;
}

/** The refused rows (one per UTC day), newest day first. */
async function readRefused(ctx: ReadContext): Promise<RefusedScan> {
  const limit = ctx.tuning.scanLimit;
  const snapshot = await summariesCollection(ctx.db, ctx.uid)
    .where('status', '==', 'refused')
    .select(...SUMMARY_REFUSED_FIELDS)
    .limit(limit)
    .get();
  const rows: { id: string; row: RefusedRowDoc }[] = [];
  let unreadable = 0;
  for (const document of snapshot.docs) {
    const row = REFUSED_ROW_ID.test(document.id) ? parseRefusedRow(document.data()) : null;
    if (row === null) unreadable += 1;
    else rows.push({ id: document.id, row });
  }
  rows.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  return { rows, capped: snapshot.size >= limit, unreadable };
}

// ---------------------------------------------------------------------------------------------
// Inbox re-match
// ---------------------------------------------------------------------------------------------

export interface RematchStats {
  /** Items re-matched (the newest eligible inbox items, at most rematchMax). */
  considered: number;
  /** Filed under a meeting (rule A on a row 7 copy without a user action). */
  filed: number;
  /** Still in the inbox with new suggestions or a new reason. */
  refreshed: number;
  /** Nothing to change (no write). */
  unchanged: number;
  /** Another device or a better copy changed the summary meanwhile (no write). */
  conflicts: number;
  /** Failed and skipped (logged by error name or SealedError reason). */
  failed: number;
}

type RematchOutcome = 'filed' | 'refreshed' | 'unchanged' | 'conflict';

/** The anchor decide() saw at receipt: signed only for a vendor copy's signed Date. */
function anchorOf(doc: Pick<SummaryRematchDoc, 'anchorAt' | 'trust'>): MatchAnchor | null {
  if (doc.anchorAt === null) return null;
  return { at: doc.anchorAt, signed: doc.trust.tier === 'vendor_verified' && doc.trust.anchorSource === 'signed_date' };
}

/** Whether an inbox item can be re-matched: not row 9, and a date or an anchor to search by. */
function isRematchable(doc: SummaryRematchDoc): boolean {
  if (doc.status !== 'inbox' || trustRowOf(doc.trust) === 9) return false;
  if (!Number.isFinite(Date.parse(doc.receivedAt))) return false;
  return candidateWindow({ summaryDate: doc.summaryDate, anchorAt: doc.anchorAt }) !== null;
}

/**
 * The change a re-match makes, or null when there is nothing to change (pure). Filing follows
 * summaryInbound exactly (model.ts buildSummaryDoc): decide() said matched (rule A), the copy is
 * row 7 (vendor signed, bound, fresh), and the matched meeting is not one the user rejected; plus
 * the user has not acted on the summary (a userAction is never overridden). Then status matched,
 * the 'auto' match, the suggestions and the filed expiresAt (365 days from receipt). Otherwise the
 * item stays in the inbox with decide()'s reason (needs_confirmation when it scored for filing but
 * may not be filed) and suggestions; the write happens only when either differs. Suggestions never
 * include a rejected meeting, and a row 9 item never changes here.
 */
export function rematchPatch(doc: SummaryRematchDoc, record: MatchRecord, now: Date): Record<string, unknown> | null {
  const row = trustRowOf(doc.trust);
  if (doc.status !== 'inbox' || row === 9) return null;
  const rejected = new Set(doc.rejectedMeetingIds);
  const isRejected = (meetingId: string, duplicates: readonly string[]): boolean =>
    rejected.has(meetingId) || duplicates.some((id) => rejected.has(id));
  const suggestions = storedCandidatesSchema.safeParse(
    record.candidates
      .filter((candidate) => !isRejected(candidate.meetingId, candidate.duplicateMeetingIds))
      .slice(0, SUMMARY_LIMITS.maxSuggestions)
      .map(storedCandidateOf),
  );
  if (!suggestions.success) throw new Error('summaries.read: a re-match suggestion does not match the stored schema');
  const candidates = suggestions.data;
  const nowIso = now.toISOString();

  const auto = record.status === 'matched' ? record.match : null;
  if (auto !== null && row === 7 && doc.userAction === null && !isRejected(auto.meetingId, auto.duplicateMeetingIds)) {
    const match = storedMatchSchema.safeParse(storedMatchOf(auto));
    if (!match.success) throw new Error('summaries.read: a re-match does not match the stored schema');
    return {
      status: 'matched',
      inboxReason: null,
      match: match.data,
      candidates,
      expiresAt: summaryExpiresAt('matched', doc.receivedAt),
      updatedAt: nowIso,
    };
  }
  const inboxReason: SummaryInboxReason = record.inboxReason ?? trustInboxReason(doc.trust) ?? 'needs_confirmation';
  if (inboxReason === doc.inboxReason && canonical(candidates) === canonical(doc.candidates)) return null;
  return { inboxReason, candidates, updatedAt: nowIso };
}

/** The decrypted text, for the conference-link bonus; null when the summary changed or is gone. */
async function readText(ctx: ReadContext, ref: SummaryRef, contentDigest: string): Promise<string | null> {
  const [snapshot] = await ctx.db.getAll(ctx.db.doc(summaryDocPath(ref.uid, ref.summaryId)), { fieldMask: ['sealedBody', 'contentDigest'] });
  if (snapshot === undefined || !snapshot.exists) return null;
  const data = (snapshot.data() ?? {}) as Record<string, unknown>;
  if (data.contentDigest !== contentDigest || typeof data.sealedBody !== 'string') return null;
  return openSummaryBody(ctx.keyring(), ref, data.sealedBody).text;
}

/** Writes a re-match in ONE transaction that re-reads the document first (see MATCH_BASIS_FIELDS). */
async function commitRematch(ctx: ReadContext, summaryId: string, basis: string, patch: Record<string, unknown>): Promise<RematchOutcome> {
  const ref: DocumentReference = ctx.db.doc(summaryDocPath(ctx.uid, summaryId));
  return ctx.db.runTransaction(async (tx: Transaction): Promise<RematchOutcome> => {
    const [snapshot] = await tx.getAll(ref, { fieldMask: [...SUMMARY_REMATCH_FIELDS] });
    if (snapshot === undefined || !snapshot.exists) return 'conflict';
    const current = rematchDocSchema.safeParse(snapshot.data());
    if (!current.success || matchBasisOf(current.data) !== basis) return 'conflict';
    tx.update(ref, patch);
    return patch.status === 'matched' ? 'filed' : 'refreshed';
  });
}

async function rematchOne(ctx: ReadContext, row: ListedSummary, preferencesTimeZone: string | null): Promise<RematchOutcome> {
  const doc = row.doc;
  const window = candidateWindow({ summaryDate: doc.summaryDate, anchorAt: doc.anchorAt });
  if (window === null) return 'unchanged';
  const ref: SummaryRef = { uid: ctx.uid, summaryId: row.id };
  const head = openSummaryHead(ctx.keyring(), ref, doc.sealedHead);
  // The receipt time bounds the candidates, as in summaryInbound: never a meeting that started
  // more than 15 minutes after the recap arrived.
  const loaded = await ctx.candidates(ctx.db, ctx.uid, window, new Date(doc.receivedAt), { preferencesTimeZone });
  let text = '';
  if (loaded.candidates.some((candidate) => candidate.conferenceUrl !== null)) {
    const opened = await readText(ctx, ref, doc.contentDigest);
    if (opened === null) return 'conflict';
    text = opened;
  }
  const record = decide({
    tier: doc.trust.tier,
    recipientBound: doc.trust.recipientBound,
    fresh: doc.trust.fresh,
    titleLine: head.titleLine,
    subjectClean: cleanSubject(head.subject),
    summaryDate: doc.summaryDate,
    anchor: anchorOf(doc),
    text,
    preferencesTimeZone: loaded.preferencesTimeZone,
    rejectedMeetingIds: doc.rejectedMeetingIds,
    candidates: loaded.candidates,
    now: ctx.now,
  });
  const patch = rematchPatch(doc, record, ctx.now);
  if (patch === null) return 'unchanged';
  return commitRematch(ctx, row.id, matchBasisOf(doc), patch);
}

/**
 * Re-matches the newest eligible inbox items (see the module comment). Throws only when the
 * keyring is unusable (the list could not show titles either); every other failure is per item.
 */
async function rematchInbox(ctx: ReadContext, rows: readonly ListedSummary[]): Promise<RematchStats> {
  const stats: RematchStats = { considered: 0, filed: 0, refreshed: 0, unchanged: 0, conflicts: 0, failed: 0 };
  const chosen = [...rows]
    .sort(newestFirst)
    .filter((row) => isRematchable(row.doc))
    .slice(0, Math.max(0, ctx.tuning.rematchMax));
  stats.considered = chosen.length;
  if (chosen.length === 0) return stats;
  ctx.keyring();

  let preferencesTimeZone: string | null;
  try {
    preferencesTimeZone = await readPreferencesTimeZone(ctx.db, ctx.uid);
  } catch (error) {
    ctx.log.warn('summaries.read.rematch_failed', { uid: ctx.uid, stage: 'preferences', errorName: errorName(error) });
    stats.failed = chosen.length;
    return stats;
  }

  const outcomes = await Promise.all(
    chosen.map(async (row): Promise<RematchOutcome | 'failed'> => {
      try {
        return await rematchOne(ctx, row, preferencesTimeZone);
      } catch (error) {
        const fields: Record<string, unknown> = { uid: ctx.uid, stage: 'item' };
        if (error instanceof SealedError) fields.reason = error.reason;
        else fields.errorName = errorName(error);
        ctx.log.warn('summaries.read.rematch_failed', fields);
        return 'failed';
      }
    }),
  );
  for (const outcome of outcomes) {
    if (outcome === 'filed') stats.filed += 1;
    else if (outcome === 'refreshed') stats.refreshed += 1;
    else if (outcome === 'unchanged') stats.unchanged += 1;
    else if (outcome === 'conflict') stats.conflicts += 1;
    else stats.failed += 1;
  }
  return stats;
}

// ---------------------------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------------------------

interface ListResult {
  response: SummaryReadListResponse;
  /** Fixed codes and counts for the summaries.read line. */
  logFields: Record<string, unknown>;
}

/** The newest rows, titles opened (a head that does not open gives title null, counted by reason). */
function titledRows(ctx: ReadContext, rows: readonly ListedSummary[], headFailures: string[]): SummaryListItem[] {
  if (rows.length === 0) return [];
  const keyring = ctx.keyring();
  return rows.map((row) => {
    let title: string | null = null;
    try {
      title = summaryTitleOf(openSummaryHead(keyring, { uid: ctx.uid, summaryId: row.id }, row.doc.sealedHead));
    } catch (error) {
      if (!(error instanceof SealedError)) throw error;
      headFailures.push(error.reason);
    }
    return summaryListItemOf(row.id, row.doc, title);
  });
}

function listResponse(view: SummaryListView, candidates: SummaryListItem[], hasMore: boolean, logFields: Record<string, unknown>): ListResult {
  const items: SummaryListItem[] = [];
  let invalidRows = 0;
  for (const item of candidates) {
    const parsed = summaryListItemSchema.safeParse(item);
    if (parsed.success) items.push(parsed.data);
    else invalidRows += 1;
  }
  const response = summaryReadListResponseSchema.parse({ op: 'list', view, items, hasMore });
  return { response, logFields: { ...logFields, items: items.length, hasMore, ...(invalidRows > 0 ? { invalidRows } : {}) } };
}

async function listSummaries(ctx: ReadContext, view: SummaryListView, meetingId: string | undefined): Promise<ListResult> {
  const max = SUMMARY_LIMITS.maxListItems;
  if (view === 'refused') {
    const scan = await readRefused(ctx);
    const rows = scan.rows.slice(0, max).map(({ id, row }) => refusedListItemOf(id, row));
    return listResponse(view, rows, scan.rows.length > max || scan.capped, scan.unreadable > 0 ? { unreadable: scan.unreadable } : {});
  }

  let scan: Scan;
  let rematch: RematchStats | null = null;
  if (view === 'inbox') {
    scan = await readInbox(ctx);
    rematch = await rematchInbox(ctx, scan.rows);
    // Something was written, or changed under us: read the inbox again so the answer is current.
    if (rematch.filed + rematch.refreshed + rematch.conflicts > 0) scan = await readInbox(ctx);
  } else if (view === 'recent') {
    scan = await readRecent(ctx);
  } else {
    if (meetingId === undefined) throw summaryError('invalid_request', MESSAGES.invalidRequest);
    scan = await readMeeting(ctx, meetingId);
  }

  const sorted = [...scan.rows].sort(newestFirst);
  const headFailures: string[] = [];
  const rows = titledRows(ctx, sorted.slice(0, max), headFailures);
  if (headFailures.length > 0) {
    ctx.log.warn('summaries.read.head_unreadable', { uid: ctx.uid, view, count: headFailures.length, reasons: [...new Set(headFailures)].sort() });
  }
  const logFields: Record<string, unknown> = {};
  if (rematch !== null) logFields.rematch = rematch;
  if (scan.unreadable > 0) logFields.unreadable = scan.unreadable;
  if (headFailures.length > 0) logFields.headFailures = headFailures.length;
  return listResponse(view, rows, sorted.length > max || scan.capped, logFields);
}

// ---------------------------------------------------------------------------------------------
// get
// ---------------------------------------------------------------------------------------------

/** The full view of one accepted summary; not_found for a refused row or anything else. */
async function getSummary(ctx: ReadContext, summaryId: string): Promise<SummaryReadGetResponse> {
  if (!isUsableDocId(summaryId)) throw summaryError('not_found', MESSAGES.notFound);
  const snapshot = await ctx.db.doc(summaryDocPath(ctx.uid, summaryId)).get();
  const record = snapshot.exists ? parseSummaryRecord(snapshot.data()) : null;
  if (record === null || record.kind !== 'summary') throw summaryError('not_found', MESSAGES.notFound);
  const doc = record.doc;
  const keyring = ctx.keyring();
  const ref: SummaryRef = { uid: ctx.uid, summaryId };
  const head = openSummaryHead(keyring, ref, doc.sealedHead);
  const body = openSummaryBody(keyring, ref, doc.sealedBody);
  const detail: SummaryDetail = {
    ...summaryListItemOf(summaryId, doc, summaryTitleOf(head)),
    subject: head.subject,
    titleLine: head.titleLine,
    fromAddress: body.fromAddress,
    forwardedBy: body.forwardedBy,
    text: body.text,
    sections: body.sections.map(contractSectionOf),
  };
  return summaryReadGetResponseSchema.parse({ op: 'get', summary: detail });
}

// ---------------------------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------------------------

/**
 * summaryRead {op: 'list', view, meetingId?} | {op: 'get', summaryId} -> SummaryReadResponse. See
 * the module comment for the gates, the views, the re-match and the error mapping.
 */
export async function handleSummaryRead(auth: SummaryCallableAuth, data: unknown, deps: SummaryReadDeps): Promise<SummaryReadResponse> {
  const caller = requireActionCaller(auth, deps.config);
  const parsed = summaryReadRequestSchema.safeParse(data ?? {});
  if (!parsed.success) throw summaryError('invalid_request', MESSAGES.invalidRequest);
  const request = parsed.data;
  const ctx = contextOf(caller.uid, deps);
  const view = request.op === 'list' ? request.view : null;
  const base = { uid: caller.uid, op: request.op, view };
  try {
    if (request.op === 'get') {
      const response = await getSummary(ctx, request.summaryId);
      ctx.log.info('summaries.read', { ...base, sections: response.summary.sections.length });
      return response;
    }
    const result = await listSummaries(ctx, request.view, request.meetingId);
    ctx.log.info('summaries.read', { ...base, ...result.logFields });
    return result.response;
  } catch (error) {
    if (error instanceof HttpsError) {
      const reason = (error.details as { reason?: unknown } | undefined)?.reason;
      ctx.log.info('summaries.read.refused', { ...base, reason: typeof reason === 'string' ? reason : error.code });
      throw error;
    }
    if (error instanceof SealedError) {
      if (error.reason.startsWith('keyring_')) ctx.log.error('summaries.setup_alarm', { reason: 'data_key_invalid', detail: error.reason });
      ctx.log.error('summaries.read.failed', { ...base, reason: error.reason });
    } else {
      ctx.log.error('summaries.read.failed', { ...base, errorName: errorName(error) });
    }
    throw summaryError('upstream_error', MESSAGES.upstream);
  }
}

// ---------------------------------------------------------------------------------------------
// M11 hand-off (design section 8)
// ---------------------------------------------------------------------------------------------

/** The plain context M11 labels every extracted item with (structure, not content). */
export interface SummaryExtractionContext {
  /** Trust facts fixed at receipt (an upgrade by a better copy is the only change). */
  tier: SummaryTier;
  recipientBound: boolean;
  fresh: boolean;
  anchorSource: SummaryAnchorSource | null;
  /**
   * Why it waited in the inbox at receipt (trust.originalInboxReason, finding 7); null when it was
   * filed automatically. A summary filed or kept by hand keeps the reason it first waited for.
   */
  originalInboxReason: SummaryInboxReason | null;
  /** The d= of the deciding passing signature, or null. */
  senderDomain: string | null;
  /** The listed notetaker sender's domain for vendor mail; null for user forwards. */
  vendorDomain: string | null;
  /** The stored match (method auto or user) for a filed summary; null for a kept one. */
  match: StoredMatch | null;
  /** match.meetingSnapshot: the meeting as it was when the summary was filed; null when kept. */
  meetingSnapshot: StoredMatch['meetingSnapshot'] | null;
  summaryDate: string | null;
  anchorAt: string | null;
  receivedAt: string;
  language: string | null;
  /** sections.ts SECTIONS_PARSER_VERSION at receipt: M11 may re-run parseSections on `text`. */
  parserVersion: number;
  /** The whole-text scan found instruction-like phrasing (M11 never pre-selects such items). */
  possibleInstruction: boolean;
  /** Any cut at receipt (text, section or item caps, or the size fallback). */
  truncated: boolean;
  /** The text was converted from the message's HTML part (htmlText.ts; flags.textFromHtml). */
  textFromHtml: boolean;
}

export interface SummaryForExtraction {
  summaryId: string;
  status: 'matched' | 'kept';
  /** The normalized plain text: the one string M11 sends to the model and checks quotes against. */
  text: string;
  /** Verbatim sections; every item satisfies text.slice(item.start, item.end) === item.text. */
  sections: SummarySection[];
  context: SummaryExtractionContext;
}

export interface SummaryExtractionDeps {
  db: Firestore;
  /** As SummaryReadDeps.keyring. */
  keyring: () => Keyring;
}

/**
 * A filed (matched) or kept summary of `uid` for M11's extraction, with its decrypted text and
 * sections (sealedBody only; the head is not opened) and the plain context; null for anything
 * else: an inbox item, a refused row, a missing document, one this version cannot read, or ids
 * that are not usable. Throws SealedError when the body does not open (a key or blob problem; the
 * caller maps it to upstream_error) and lets a Firestore error propagate. Logs nothing.
 */
export async function loadSummaryForExtraction(uid: string, summaryId: string, deps: SummaryExtractionDeps): Promise<SummaryForExtraction | null> {
  if (!isUsableUid(uid) || !isUsableDocId(summaryId)) return null;
  const snapshot = await deps.db.doc(summaryDocPath(uid, summaryId)).get();
  const record = snapshot.exists ? parseSummaryRecord(snapshot.data()) : null;
  if (record === null || record.kind !== 'summary') return null;
  const doc = record.doc;
  if (doc.status !== 'matched' && doc.status !== 'kept') return null;
  const body = openSummaryBody(deps.keyring(), { uid, summaryId }, doc.sealedBody);
  const match = doc.status === 'matched' ? doc.match : null;
  return {
    summaryId,
    status: doc.status,
    text: body.text,
    sections: body.sections,
    context: {
      tier: doc.trust.tier,
      recipientBound: doc.trust.recipientBound,
      fresh: doc.trust.fresh,
      anchorSource: doc.trust.anchorSource,
      originalInboxReason: doc.trust.originalInboxReason,
      senderDomain: doc.senderDomain,
      vendorDomain: doc.vendorDomain,
      match,
      meetingSnapshot: match?.meetingSnapshot ?? null,
      summaryDate: doc.summaryDate,
      anchorAt: doc.anchorAt,
      receivedAt: doc.receivedAt,
      language: doc.language,
      parserVersion: doc.parserVersion,
      possibleInstruction: doc.flags.possibleInstruction,
      truncated: doc.flags.truncated,
      textFromHtml: doc.flags.textFromHtml === true,
    },
  };
}
