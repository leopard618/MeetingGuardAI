/**
 * M10 candidates: the meeting occurrences a notetaker summary could belong to (docs/v2/M10-DESIGN.md
 * section 6, Candidates and the hard gates; section 12, Matching). A new reader, because
 * assistant/context.ts firestoreMeetingReader drops override titles and durations. match.ts
 * decide() scores what this returns; nothing here scores or files.
 *
 * Window (candidateWindow), half-open [from, to) on the start instant:
 * - with the summary date D: D 00:00Z minus 14 h to D+1 00:00Z plus 14 h, so every zone from UTC-12
 *   to UTC+14 is covered (D 00:00 in UTC+14 is exactly `from`);
 * - with only an anchor: anchor minus 48 h to anchor plus 15 minutes;
 * - with neither: null (the summary goes to the inbox as no_date; nothing is read).
 *
 * Reads (loadCandidates), both on users/{uid}/meetings with one field mask (CANDIDATE_FIELDS) and
 * single-field indexes only (no composite index):
 * - Query 1: startAt in [from, to), ordered by startAt. Documents that carry a recurrence are
 *   not taken as one-offs here (a master whose first occurrence is in range would otherwise come
 *   back twice); each master is expanded once, by id, even when only query 1 returned it.
 * - Query 2: the series masters, `recurrence.freq in [daily, weekly, monthly]` (sparse storage: a
 *   one-off has no recurrence field), each expanded over the window with the shared
 *   expandOccurrences: cancelled occurrences are omitted, moved ones come at their effective start,
 *   duration and title, and occurrenceDate is the ORIGINAL local date (the recurrenceOverrides key).
 *   Imported Google and Outlook series stored one document per instance are plain query 1 rows.
 * - Tombstones (deletedAt set, or a status 'deleted') are dropped. A cancelled meeting (status
 *   'cancelled', for a series every occurrence) is passed with cancelled: true, so decide() keeps it
 *   as a suggestion that never files.
 * - Nothing that starts at or after `now` plus 15 minutes is a candidate: a summary cannot be about
 *   a meeting that had not begun when the server received it. This is the signed-anchor start gate
 *   of section 6 applied with the server's clock, so a vendor clock that runs ahead (fresh allows a
 *   signed Date up to 24 h after receipt) cannot file a recap under a meeting still to come.
 *
 * Bounded (meeting documents are user-writable and the rules cannot bound every map entry): each
 * query reads at most CANDIDATES_TUNING.queryLimit documents, streamed, an oversized document is
 * skipped and reading stops at a byte budget; each series yields at most maxOccurrencesPerSeries
 * occurrences and the result at most maxCandidates. One document that cannot be read is skipped
 * (counted), never thrown. A Firestore failure does throw (the inbound handler answers 500).
 *
 * Every candidate passes matchCandidateSchema; titles are cut to SUMMARY_LIMITS.maxTitleChars. Logs
 * carry the uid and counts only (summaries.candidates, when a cap hits or a document was skipped):
 * never a title, a time, a link or any other meeting content.
 */
import * as logger from 'firebase-functions/logger';
import type { DocumentData, Firestore, Query } from 'firebase-admin/firestore';
import { z } from 'zod';

import {
  MEETING_ID_PATTERN,
  RECURRENCE_FREQS,
  SUMMARY_LIMITS,
  durationMinutesSchema,
  isoDateTimeSchema,
  recurrenceRuleSchema,
  timeZoneSchema,
} from '../shared/aiContract';
import {
  expandOccurrences,
  recurrenceOverridesSchema,
  type MeetingOccurrence,
  type RecurringMeetingLike,
} from '../shared/recurrence';
import { isLocalDate, isValidTimeZone, toLocalDateTime } from '../shared/time';
import { SUMMARIES_TUNING, matchCandidateSchema, type MatchCandidate } from './match';

// ---------------------------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------------------------

export const CANDIDATES_TUNING = {
  /** Window with a summary date: D 00:00Z minus this to D+1 00:00Z plus this. */
  dateWindowPadHours: 14,
  /** Window with only an anchor: anchor minus this ... */
  anchorBeforeHours: 48,
  /** ... to anchor plus this (the signed-anchor start gate). */
  anchorAfterMinutes: SUMMARIES_TUNING.startToleranceMinutes,
  /** Candidates must start before now plus this. */
  nowToleranceMinutes: SUMMARIES_TUNING.startToleranceMinutes,
  /** A longer window is a caller bug: nothing is read (the summary waits in the inbox). */
  maxWindowHours: 72,
  /** Documents read per query (one-offs in the window; series masters). */
  queryLimit: 200,
  /**
   * Serialized characters of one field-masked document; larger ones are skipped. A legitimate
   * series with 200 overrides that each carry a 200-character title stays under 64 KiB.
   */
  maxDocumentBytes: 128 * 1024,
  /** Serialized characters read per query before reading stops. */
  maxQueryBytes: 4 * 1024 * 1024,
  /** Occurrences taken from one series (a window holds at most 3 days of a daily rule). */
  maxOccurrencesPerSeries: 24,
  /** Candidates returned in all (earliest first). */
  maxCandidates: 400,
} as const;

/**
 * The only meeting fields read (Firestore field mask; design section 6). The conference is read as
 * its url alone, so the meeting password never leaves Firestore. updatedAt is in the design's mask
 * and read, but MatchCandidate has no slot for it.
 */
export const CANDIDATE_FIELDS = [
  'title',
  'startAt',
  'durationMinutes',
  'timezone',
  'allDay',
  'status',
  'deletedAt',
  'source',
  'conference.url',
  'recurrence',
  'recurrenceOverrides',
  'updatedAt',
] as const;

/** The preferences field read (users/{uid}/settings/preferences). */
export const PREFERENCES_TIME_ZONE_FIELD = 'timezone';

const MEETINGS_COLLECTION = (uid: string): string => `users/${uid}/meetings`;
const PREFERENCES_DOC = (uid: string): string => `users/${uid}/settings/preferences`;

/** Firebase uids never contain '/', so a uid can never splice extra Firestore path segments. */
const UID_PATTERN = /^[^/]{1,128}$/;
/** Instants as Date#toISOString() writes them, four-digit years only (string order = time order). */
const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** The app's default when a stored meeting has no durationMinutes (DEFAULT_MEETING_DURATION_MINUTES). */
const DEFAULT_DURATION_MINUTES = 60;

// ---------------------------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------------------------

export interface CandidateWindowInput {
  /** YYYY-MM-DD found in the summary, or null. */
  summaryDate: string | null | undefined;
  /** ISO instant with Z or an offset (the signed Date or the forward wrapper's Date), or null. */
  anchorAt: string | null | undefined;
}

/** Half-open range on the meeting start: from <= startAt < to (canonical UTC ISO). */
export interface CandidateWindow {
  from: string;
  to: string;
  /** Which input made the window (for logs and tests). */
  basis: 'summary_date' | 'anchor';
}

function canonicalIso(ms: number): string | null {
  if (!Number.isFinite(ms)) return null;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return null;
  const iso = date.toISOString();
  return CANONICAL_INSTANT.test(iso) ? iso : null;
}

/**
 * The search window (see the module comment). A summary date wins over an anchor (decide() gates
 * on the local date, and that date's window holds every start it can accept). An invalid date
 * (not a real calendar day) or an anchor that is not an ISO instant counts as absent.
 */
export function candidateWindow(input: CandidateWindowInput): CandidateWindow | null {
  const t = CANDIDATES_TUNING;
  const summaryDate = input.summaryDate;
  if (isLocalDate(summaryDate)) {
    const dayStartMs = Date.parse(`${summaryDate}T00:00:00.000Z`);
    const from = canonicalIso(dayStartMs - t.dateWindowPadHours * HOUR_MS);
    const to = canonicalIso(dayStartMs + DAY_MS + t.dateWindowPadHours * HOUR_MS);
    if (from !== null && to !== null) return { from, to, basis: 'summary_date' };
  }
  const anchorAt = input.anchorAt;
  if (typeof anchorAt === 'string' && isoDateTimeSchema.safeParse(anchorAt).success) {
    const anchorMs = Date.parse(anchorAt);
    const from = canonicalIso(anchorMs - t.anchorBeforeHours * HOUR_MS);
    const to = canonicalIso(anchorMs + t.anchorAfterMinutes * MINUTE_MS);
    if (from !== null && to !== null) return { from, to, basis: 'anchor' };
  }
  return null;
}

interface SearchBounds {
  fromMs: number;
  toMs: number;
  from: string;
  to: string;
}

/** The window cut at now plus the tolerance; null when nothing can be a candidate. */
function searchBounds(window: CandidateWindow, now: Date): SearchBounds | null {
  if (!CANONICAL_INSTANT.test(window.from) || !CANONICAL_INSTANT.test(window.to)) return null;
  const fromMs = Date.parse(window.from);
  const windowToMs = Date.parse(window.to);
  const nowMs = now instanceof Date ? now.getTime() : Number.NaN;
  if (!Number.isFinite(fromMs) || !Number.isFinite(windowToMs) || !Number.isFinite(nowMs)) return null;
  if (windowToMs <= fromMs || windowToMs - fromMs > CANDIDATES_TUNING.maxWindowHours * HOUR_MS) return null;
  const toMs = Math.min(windowToMs, nowMs + CANDIDATES_TUNING.nowToleranceMinutes * MINUTE_MS);
  if (toMs <= fromMs) return null;
  const to = canonicalIso(toMs);
  if (to === null) return null;
  return { fromMs, toMs, from: window.from, to };
}

// ---------------------------------------------------------------------------------------------
// Preferences zone
// ---------------------------------------------------------------------------------------------

/** The value when it is a syntactically valid IANA name that Intl knows, else null. */
export function parsePreferencesTimeZone(value: unknown): string | null {
  const parsed = timeZoneSchema.safeParse(value);
  if (!parsed.success) return null;
  return isValidTimeZone(parsed.data) ? parsed.data : null;
}

function assertUid(uid: string): void {
  if (typeof uid !== 'string' || !UID_PATTERN.test(uid)) {
    throw new Error('summaries.candidates: invalid uid');
  }
}

/**
 * users/{uid}/settings/preferences.timezone when it is a valid IANA zone, else null (missing
 * document or field included). Reads that one field only. The inbound handler needs it BEFORE the
 * window when the anchor is a forward wrapper's wall-clock Date; pass the result to loadCandidates
 * (options.preferencesTimeZone) so it is not read twice.
 */
export async function readPreferencesTimeZone(db: Firestore, uid: string): Promise<string | null> {
  assertUid(uid);
  const [snapshot] = await db.getAll(db.doc(PREFERENCES_DOC(uid)), { fieldMask: [PREFERENCES_TIME_ZONE_FIELD] });
  if (!snapshot || !snapshot.exists) return null;
  const data = (snapshot.data() ?? {}) as Record<string, unknown>;
  return parsePreferencesTimeZone(data[PREFERENCES_TIME_ZONE_FIELD]);
}

// ---------------------------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------------------------

/** The masked fields every candidate needs; defaults follow the app's parseMeetingDoc. */
const storedMeetingSchema = z.object({
  title: z.string().min(1),
  startAt: isoDateTimeSchema,
  durationMinutes: durationMinutesSchema.default(DEFAULT_DURATION_MINUTES),
  timezone: timeZoneSchema,
  allDay: z.boolean().default(false),
  status: z.enum(['scheduled', 'cancelled']).default('scheduled'),
  source: z.string().min(1).max(32),
});

/**
 * A series also needs a valid rule and valid overrides. Overrides are parsed with the app's own
 * schema: a master the app cannot parse is not shown to the user, so it is no candidate either
 * (and a cancelled entry is never dropped into a live occurrence).
 */
const storedSeriesSchema = storedMeetingSchema.extend({
  recurrence: recurrenceRuleSchema,
  recurrenceOverrides: recurrenceOverridesSchema.nullable().default(null),
});

type StoredMeeting = z.infer<typeof storedMeetingSchema>;

/** Cuts to `max` UTF-16 units without splitting a surrogate pair. */
function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  const code = value.charCodeAt(max - 1);
  return value.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
}

function clipTitle(title: string): string {
  return truncate(title, SUMMARY_LIMITS.maxTitleChars);
}

function isTombstone(data: Record<string, unknown>): boolean {
  return (data.deletedAt !== undefined && data.deletedAt !== null) || data.status === 'deleted';
}

function hasRecurrence(data: Record<string, unknown>): boolean {
  return data.recurrence !== undefined && data.recurrence !== null;
}

/** conference.url when it is a usable string (anything else is simply no link). */
function conferenceUrlOf(data: Record<string, unknown>): string | null {
  const conference = data.conference;
  if (typeof conference !== 'object' || conference === null) return null;
  const url = (conference as Record<string, unknown>).url;
  return typeof url === 'string' && url.length > 0 && url.length <= 2048 ? url : null;
}

function baseCandidate(id: string, meeting: StoredMeeting, data: Record<string, unknown>) {
  return {
    meetingId: id,
    timezone: meeting.timezone,
    allDay: meeting.allDay,
    cancelled: meeting.status === 'cancelled',
    deleted: false,
    source: meeting.source,
    conferenceUrl: conferenceUrlOf(data),
  };
}

/** A query 1 row as a candidate, or null when it cannot be read. */
function oneOffCandidate(id: string, data: Record<string, unknown>, bounds: SearchBounds): MatchCandidate | null {
  const parsed = storedMeetingSchema.safeParse(data);
  if (!parsed.success) return null;
  const meeting = parsed.data;
  const startMs = Date.parse(meeting.startAt);
  if (!Number.isFinite(startMs)) return null;
  // The query bounds compare strings; an odd stored form must not slip past them.
  if (startMs < bounds.fromMs || startMs >= bounds.toMs) return null;
  const startAt = canonicalIso(startMs);
  const endAt = canonicalIso(startMs + meeting.durationMinutes * MINUTE_MS);
  if (startAt === null || endAt === null) return null;
  return {
    ...baseCandidate(id, meeting, data),
    occurrenceDate: null,
    title: clipTitle(meeting.title),
    startAt,
    endAt,
  };
}

interface SeriesExpansion {
  candidates: MatchCandidate[];
  /** The per-series cap was reached. */
  capped: boolean;
}

/** The occurrences of a query 2 master that start in the bounds, or null when it cannot be read. */
function seriesCandidates(id: string, data: Record<string, unknown>, bounds: SearchBounds): SeriesExpansion | null {
  const parsed = storedSeriesSchema.safeParse(data);
  if (!parsed.success) return null;
  const meeting = parsed.data;
  if (!isValidTimeZone(meeting.timezone)) return null;
  const masterStartMs = Date.parse(meeting.startAt);
  const masterStart = canonicalIso(masterStartMs);
  if (masterStart === null) return null;

  const local = toLocalDateTime(masterStart, meeting.timezone);
  const like: RecurringMeetingLike = {
    id,
    title: meeting.title,
    date: local.date,
    time: local.time,
    timezone: meeting.timezone,
    durationMinutes: meeting.durationMinutes,
    allDay: meeting.allDay,
    recurrence: meeting.recurrence,
    recurrenceOverrides: meeting.recurrenceOverrides,
  };
  const max = CANDIDATES_TUNING.maxOccurrencesPerSeries;
  let occurrences: MeetingOccurrence[];
  try {
    occurrences = expandOccurrences(like, bounds.from, bounds.to, { max });
  } catch {
    return null;
  }

  const base = baseCandidate(id, meeting, data);
  const candidates: MatchCandidate[] = [];
  for (const occurrence of occurrences) {
    // expandOccurrences returns overlaps; a candidate must START in the bounds, like query 1.
    const startMs = Date.parse(occurrence.startAt);
    const endMs = Date.parse(occurrence.endAt);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    if (startMs < bounds.fromMs || startMs >= bounds.toMs) continue;
    const startAt = canonicalIso(startMs);
    const endAt = canonicalIso(endMs);
    if (startAt === null || endAt === null) continue;
    candidates.push({
      ...base,
      occurrenceDate: occurrence.localDateKey,
      title: clipTitle(occurrence.title),
      startAt,
      endAt,
    });
  }
  return { candidates, capped: occurrences.length >= max };
}

// ---------------------------------------------------------------------------------------------
// Bounded reading
// ---------------------------------------------------------------------------------------------

interface RawDoc {
  id: string;
  data: Record<string, unknown>;
}

interface QueryRead {
  docs: RawDoc[];
  /** Documents the stream delivered (oversized ones included). */
  read: number;
  oversized: number;
  /** Reading stopped at maxQueryBytes. */
  budgetCapped: boolean;
}

/** Rough serialized size of a document (characters of its JSON). */
function approximateSize(data: unknown): number {
  try {
    return JSON.stringify(data)?.length ?? 0;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/** Streams the query, skipping oversized documents and stopping at the byte budget. */
async function readBounded(query: Query): Promise<QueryRead> {
  const docs: RawDoc[] = [];
  let read = 0;
  let oversized = 0;
  let total = 0;
  let budgetCapped = false;
  // Streamed: leaving the loop early (budget reached) cancels the rest of the query.
  for await (const item of query.stream() as unknown as AsyncIterable<unknown>) {
    read += 1;
    const snapshot = item as { id: string; data(): DocumentData | undefined };
    const data = (snapshot.data() ?? {}) as Record<string, unknown>;
    const size = approximateSize(data);
    if (size > CANDIDATES_TUNING.maxDocumentBytes) {
      oversized += 1;
      continue;
    }
    if (total + size > CANDIDATES_TUNING.maxQueryBytes) {
      budgetCapped = true;
      break;
    }
    total += size;
    docs.push({ id: snapshot.id, data });
  }
  return { docs, read, oversized, budgetCapped };
}

// ---------------------------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------------------------

export interface CandidatesLogger {
  warn(event: string, fields: Record<string, unknown>): void;
}

const defaultLogger: CandidatesLogger = {
  warn: (event, fields) => logger.warn(event, fields),
};

export interface LoadCandidatesOptions {
  /**
   * The zone readPreferencesTimeZone already returned (it is validated again); undefined reads
   * users/{uid}/settings/preferences here.
   */
  preferencesTimeZone?: string | null;
  /** Test seam; firebase-functions/logger by default. */
  logger?: CandidatesLogger;
}

export interface LoadedCandidates {
  /** Sorted by start, then meeting id, then occurrence date; each parses with matchCandidateSchema. */
  candidates: MatchCandidate[];
  preferencesTimeZone: string | null;
}

/** Counts for the summaries.candidates log line (never content). */
interface LoadStats {
  oneOffDocs: number;
  seriesDocs: number;
  /** Query 1 rows that carry a recurrence (expanded from query 2 instead). */
  seriesInWindow: number;
  tombstones: number;
  /** Documents that could not be read (malformed fields, bad id, unexpandable rule). */
  skipped: number;
  oversized: number;
  oneOffCapped: boolean;
  seriesCapped: boolean;
  budgetCapped: boolean;
  /** Series whose expansion reached maxOccurrencesPerSeries. */
  occurrenceCapped: number;
  candidatesCapped: boolean;
}

function compareCandidates(a: MatchCandidate, b: MatchCandidate): number {
  const x = `${a.startAt}|${a.meetingId}|${a.occurrenceDate ?? ''}`;
  const y = `${b.startAt}|${b.meetingId}|${b.occurrenceDate ?? ''}`;
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * The candidates for one summary (see the module comment). `window` null (no date, no anchor)
 * reads no meetings. `now` is the time the summary is known to exist by: the receipt or attempt
 * time in summaryInbound, and the stored receipt time on summaryRead's re-match (read.ts), so a
 * later re-match never admits a meeting that began after the recap arrived.
 */
export async function loadCandidates(
  db: Firestore,
  uid: string,
  window: CandidateWindow | null,
  now: Date,
  options: LoadCandidatesOptions = {},
): Promise<LoadedCandidates> {
  assertUid(uid);
  const zonePromise =
    options.preferencesTimeZone !== undefined
      ? Promise.resolve(parsePreferencesTimeZone(options.preferencesTimeZone))
      : readPreferencesTimeZone(db, uid);
  const bounds = window === null ? null : searchBounds(window, now);
  if (bounds === null) return { candidates: [], preferencesTimeZone: await zonePromise };

  const meetings = db.collection(MEETINGS_COLLECTION(uid));
  const limit = CANDIDATES_TUNING.queryLimit;
  const oneOffQuery = meetings
    .where('startAt', '>=', bounds.from)
    .where('startAt', '<', bounds.to)
    .orderBy('startAt')
    .select(...CANDIDATE_FIELDS)
    .limit(limit);
  // Sparse storage: one-offs have no recurrence field, so this matches series masters only
  // (automatic single-field index on recurrence.freq; no composite index needed).
  const seriesQuery = meetings
    .where('recurrence.freq', 'in', [...RECURRENCE_FREQS])
    .select(...CANDIDATE_FIELDS)
    .limit(limit);
  const [oneOffs, series, preferencesTimeZone] = await Promise.all([
    readBounded(oneOffQuery),
    readBounded(seriesQuery),
    zonePromise,
  ]);

  const stats: LoadStats = {
    oneOffDocs: oneOffs.read,
    seriesDocs: series.read,
    seriesInWindow: 0,
    tombstones: 0,
    skipped: 0,
    oversized: oneOffs.oversized + series.oversized,
    oneOffCapped: oneOffs.read >= limit,
    seriesCapped: series.read >= limit,
    budgetCapped: oneOffs.budgetCapped || series.budgetCapped,
    occurrenceCapped: 0,
    candidatesCapped: false,
  };

  const collected: MatchCandidate[] = [];
  // Masters by id: query 2's, plus any query 1 row with a recurrence that a capped query 2 did not
  // return. Each master is expanded once, so its first occurrence never comes back twice.
  const masters = new Map<string, RawDoc>(series.docs.map((doc) => [doc.id, doc]));
  for (const doc of oneOffs.docs) {
    if (isTombstone(doc.data)) {
      stats.tombstones += 1;
      continue;
    }
    if (hasRecurrence(doc.data)) {
      stats.seriesInWindow += 1;
      if (!masters.has(doc.id)) masters.set(doc.id, doc);
      continue;
    }
    const candidate = MEETING_ID_PATTERN.test(doc.id) ? oneOffCandidate(doc.id, doc.data, bounds) : null;
    if (candidate === null) stats.skipped += 1;
    else collected.push(candidate);
  }
  for (const doc of masters.values()) {
    if (isTombstone(doc.data)) {
      stats.tombstones += 1;
      continue;
    }
    const expansion = MEETING_ID_PATTERN.test(doc.id) ? seriesCandidates(doc.id, doc.data, bounds) : null;
    if (expansion === null) {
      stats.skipped += 1;
      continue;
    }
    if (expansion.capped) stats.occurrenceCapped += 1;
    collected.push(...expansion.candidates);
  }

  const seen = new Set<string>();
  const candidates: MatchCandidate[] = [];
  for (const raw of collected.sort(compareCandidates)) {
    const key = `${raw.meetingId}|${raw.occurrenceDate ?? ''}`;
    if (seen.has(key)) continue;
    const parsed = matchCandidateSchema.safeParse(raw);
    if (!parsed.success) {
      stats.skipped += 1;
      continue;
    }
    if (candidates.length >= CANDIDATES_TUNING.maxCandidates) {
      stats.candidatesCapped = true;
      break;
    }
    seen.add(key);
    candidates.push(parsed.data);
  }

  const capped =
    stats.oneOffCapped || stats.seriesCapped || stats.budgetCapped || stats.occurrenceCapped > 0 || stats.candidatesCapped;
  if (capped || stats.skipped > 0 || stats.oversized > 0) {
    (options.logger ?? defaultLogger).warn('summaries.candidates', {
      uid,
      basis: window?.basis ?? null,
      capped,
      ...stats,
      candidates: candidates.length,
    });
  }
  return { candidates, preferencesTimeZone };
}
