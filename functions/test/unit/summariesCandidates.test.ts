/**
 * M10 candidates (functions/src/summaries/candidates.ts; docs/v2/M10-DESIGN.md section 6,
 * Candidates and the hard gates, and section 12, Matching): the window at the UTC-12 and UTC+14
 * edges, the one-off query, tombstones, Meeting Guard AI series (today's occurrence once, a moved
 * occurrence with its original occurrenceDate, a cancelled one skipped, the master not
 * double-counted), imported series instances, the bounds and the counts-only log, the preferences
 * zone, and decide() end to end on the worked fixture. All data is synthetic: "Acmepay" stands in
 * for the company name of the design's worked fixture, as in summariesMatch.test.ts.
 */
jest.mock('firebase-functions/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

import * as functionsLogger from 'firebase-functions/logger';
import type { Firestore } from 'firebase-admin/firestore';

import { RECURRENCE_FREQS } from '../../src/shared/aiContract';
import { zonedDateTimeToUtcIso } from '../../src/shared/time';
import {
  CANDIDATES_TUNING,
  CANDIDATE_FIELDS,
  candidateWindow,
  loadCandidates,
  parsePreferencesTimeZone,
  readPreferencesTimeZone,
  type CandidateWindow,
  type LoadedCandidates,
} from '../../src/summaries/candidates';
import { decide, matchCandidateSchema, type MatchCandidate, type MatchInput } from '../../src/summaries/match';

// ---------------------------------------------------------------------------------------------
// Fake Firestore: collection queries (where / orderBy / select / limit / stream) and getAll
// ---------------------------------------------------------------------------------------------

type Data = Record<string, unknown>;
type Op = '>=' | '>' | '<' | '<=' | '==' | 'in';

interface QueryState {
  collection: string;
  filters: { field: string; op: Op; value: unknown }[];
  orderBy: string[];
  select: string[] | null;
  limit: number | null;
}

interface FakeSnapshot {
  id: string;
  exists: boolean;
  data(): Data | undefined;
}

function getPath(data: unknown, path: string): unknown {
  let value: unknown = data;
  for (const part of path.split('.')) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
    value = (value as Data)[part];
  }
  return value;
}

/** A Firestore field mask: only the listed (dotted) paths, missing ones left out. */
function project(data: Data, fields: readonly string[] | null): Data {
  if (fields === null) return structuredClone(data);
  const out: Data = {};
  for (const field of fields) {
    const value = getPath(data, field);
    if (value === undefined) continue;
    const parts = field.split('.');
    let target = out;
    for (const part of parts.slice(0, -1)) {
      if (typeof target[part] !== 'object' || target[part] === null) target[part] = {};
      target = target[part] as Data;
    }
    target[parts[parts.length - 1] as string] = structuredClone(value);
  }
  return out;
}

/** Range filters match only values of the bound's type (strings here), like Firestore. */
function matches(value: unknown, op: Op, bound: unknown): boolean {
  if (op === 'in') return Array.isArray(bound) && bound.some((item) => item === value);
  if (op === '==') return value === bound;
  if (typeof value !== 'string' || typeof bound !== 'string') return false;
  if (op === '>=') return value >= bound;
  if (op === '>') return value > bound;
  if (op === '<') return value < bound;
  return value <= bound;
}

class FakeQuery {
  constructor(
    private readonly db: FakeFirestore,
    private readonly state: QueryState,
  ) {}

  where(field: string, op: Op, value: unknown): FakeQuery {
    return new FakeQuery(this.db, { ...this.state, filters: [...this.state.filters, { field, op, value }] });
  }

  orderBy(field: string): FakeQuery {
    return new FakeQuery(this.db, { ...this.state, orderBy: [...this.state.orderBy, field] });
  }

  select(...fields: string[]): FakeQuery {
    return new FakeQuery(this.db, { ...this.state, select: fields });
  }

  limit(limit: number): FakeQuery {
    return new FakeQuery(this.db, { ...this.state, limit });
  }

  stream(): AsyncIterable<FakeSnapshot> {
    const db = this.db;
    const state = this.state;
    db.queries.push(state);
    return (async function* rows() {
      for (const snapshot of db.run(state)) {
        db.streamed += 1;
        yield snapshot;
      }
    })();
  }
}

class FakeFirestore {
  readonly docs = new Map<string, Data>();
  readonly queries: QueryState[] = [];
  readonly getAllCalls: { paths: string[]; fieldMask: string[] | null }[] = [];
  streamed = 0;
  failQueries: Error | null = null;

  collection(path: string): FakeQuery {
    return new FakeQuery(this, { collection: path, filters: [], orderBy: [], select: null, limit: null });
  }

  doc(path: string): { path: string } {
    return { path };
  }

  async getAll(...args: unknown[]): Promise<FakeSnapshot[]> {
    const last = args[args.length - 1];
    const hasOptions = typeof last === 'object' && last !== null && !('path' in last);
    const refs = (hasOptions ? args.slice(0, -1) : args) as { path: string }[];
    const fieldMask = hasOptions ? ((last as { fieldMask?: string[] }).fieldMask ?? null) : null;
    this.getAllCalls.push({ paths: refs.map((ref) => ref.path), fieldMask });
    return refs.map((ref) => {
      const data = this.docs.get(ref.path);
      return {
        id: ref.path.split('/').pop() ?? '',
        exists: data !== undefined,
        data: () => (data === undefined ? undefined : project(data, fieldMask)),
      };
    });
  }

  /** Direct children of the collection, filtered, ordered (by field, then id) and limited. */
  run(state: QueryState): FakeSnapshot[] {
    if (this.failQueries !== null) throw this.failQueries;
    const prefix = `${state.collection}/`;
    let rows = [...this.docs.entries()]
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
      .map(([path, data]) => ({ id: path.slice(prefix.length), data }))
      .filter((row) => state.filters.every((f) => matches(getPath(row.data, f.field), f.op, f.value)))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const field of state.orderBy) {
      rows = rows
        .filter((row) => getPath(row.data, field) !== undefined)
        .sort((a, b) => {
          const x = String(getPath(a.data, field));
          const y = String(getPath(b.data, field));
          return x < y ? -1 : x > y ? 1 : 0;
        });
    }
    if (state.limit !== null) rows = rows.slice(0, state.limit);
    return rows.map((row) => ({ id: row.id, exists: true, data: () => project(row.data, state.select) }));
  }
}

// ---------------------------------------------------------------------------------------------
// Synthetic data
// ---------------------------------------------------------------------------------------------

const UID = 'uid_candidates_1';
const MX = 'America/Mexico_City'; // UTC-6 all year since 2022
const D = '2026-10-16'; // a Friday
/** 15:25 Mexico City, five minutes after the worked fixture's signed Date. */
const NOW = new Date('2026-10-16T21:25:00.000Z');
/** Late enough that every meeting on D, in every zone, has begun. */
const NOW_LATE = new Date('2026-10-18T00:00:00.000Z');
const SIGNED_AT = '2026-10-16T21:20:00.000Z'; // 15:20 local
const WEEKLY_FR = { freq: 'weekly', interval: 1, byWeekday: ['FR'], byMonthDay: null, until: null, count: null };
const DAILY = { freq: 'daily', interval: 1, byWeekday: null, byMonthDay: null, until: null, count: null };

/** A full stored meeting, as the app writes it (fields the reader must never load included). */
function meetingDoc(overrides: Data = {}): Data {
  return {
    userId: UID,
    title: 'Acmepay weekly sync',
    description: 'Synthetic agenda text',
    startAt: '2026-10-16T20:00:00.000Z', // 14:00 local
    durationMinutes: 60,
    timezone: MX,
    allDay: false,
    date: '2026-10-16',
    time: '14:00',
    location: null,
    conference: null,
    participants: [{ email: 'pat@company.example', name: 'Pat Example', status: null }],
    source: 'manual',
    confidence: null,
    language: 'en',
    preparationTips: [],
    customAlertTimes: null,
    alertIntensity: null,
    notes: 'Synthetic private note',
    status: 'scheduled',
    external: {
      googleEventId: null,
      googleCalendarId: null,
      googleEtag: null,
      googleUpdatedAt: null,
      deviceEventId: null,
      deviceCalendarId: null,
    },
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    deletedAt: null,
    ...overrides,
  };
}

/** The weekly Friday 14:00 series, first occurrence 2026-09-18 (four weeks before D). */
function seriesDoc(overrides: Data = {}): Data {
  return meetingDoc({
    startAt: '2026-09-18T20:00:00.000Z',
    date: '2026-09-18',
    recurrence: WEEKLY_FR,
    seriesId: 'm_series',
    ...overrides,
  });
}

function without(doc: Data, key: string): Data {
  const copy = { ...doc };
  delete copy[key];
  return copy;
}

function put(db: FakeFirestore, id: string, data: Data): void {
  db.docs.set(`users/${UID}/meetings/${id}`, data);
}

function windowFor(summaryDate: string | null, anchorAt: string | null): CandidateWindow {
  const window = candidateWindow({ summaryDate, anchorAt });
  if (window === null) throw new Error('expected a window');
  return window;
}

const DATE_WINDOW = windowFor(D, null);

function silentLogger() {
  return { warn: jest.fn() };
}

/** loadCandidates with a capturing logger; every candidate must parse with matchCandidateSchema. */
async function load(
  db: FakeFirestore,
  window: CandidateWindow | null = DATE_WINDOW,
  now: Date = NOW,
  extra: { preferencesTimeZone?: string | null } = {},
): Promise<LoadedCandidates & { warn: jest.Mock }> {
  const logger = silentLogger();
  const result = await loadCandidates(db as unknown as Firestore, UID, window, now, { logger, ...extra });
  for (const candidate of result.candidates) {
    expect(matchCandidateSchema.safeParse(candidate).success).toBe(true);
    expect(candidate.deleted).toBe(false);
  }
  return { ...result, warn: logger.warn };
}

function keys(candidates: readonly MatchCandidate[]): string[] {
  return candidates.map((c) => `${c.meetingId}@${c.occurrenceDate ?? '-'}`);
}

/** Nothing a log line carries may be meeting content. */
function expectCountsOnly(calls: unknown[][]): void {
  const serialized = JSON.stringify(calls);
  for (const content of ['Acmepay', 'Marketing', 'zoom.us', 'Synthetic', 'company.example', 'pw-synthetic', '2026-10']) {
    expect(serialized).not.toContain(content);
  }
}

// ---------------------------------------------------------------------------------------------

describe('candidateWindow', () => {
  it('with a summary date covers D in every zone from UTC-12 to UTC+14', () => {
    expect(DATE_WINDOW).toEqual({ from: '2026-10-15T10:00:00.000Z', to: '2026-10-17T14:00:00.000Z', basis: 'summary_date' });
    // UTC+14: D begins exactly at `from` (inclusive); the minute before is D-1 there.
    expect(zonedDateTimeToUtcIso(D, '00:00', 'Pacific/Kiritimati')).toBe(DATE_WINDOW.from);
    expect(zonedDateTimeToUtcIso('2026-10-15', '23:59', 'Pacific/Kiritimati') < DATE_WINDOW.from).toBe(true);
    // UTC-12 (POSIX sign: Etc/GMT+12): the last minute of D is well inside `to` (exclusive).
    expect(zonedDateTimeToUtcIso(D, '23:59', 'Etc/GMT+12')).toBe('2026-10-17T11:59:00.000Z');
    expect('2026-10-17T11:59:00.000Z' < DATE_WINDOW.to).toBe(true);
  });

  it('with only an anchor: 48 hours before to 15 minutes after', () => {
    expect(windowFor(null, '2026-10-16T15:20:00-06:00')).toEqual({
      from: '2026-10-14T21:20:00.000Z',
      to: '2026-10-16T21:35:00.000Z',
      basis: 'anchor',
    });
  });

  it('a summary date wins over an anchor', () => {
    expect(windowFor(D, SIGNED_AT)).toEqual(DATE_WINDOW);
  });

  it('crosses month, year and leap-day boundaries', () => {
    expect(windowFor('2026-12-31', null)).toMatchObject({ from: '2026-12-30T10:00:00.000Z', to: '2027-01-01T14:00:00.000Z' });
    expect(windowFor('2028-02-29', null)).toMatchObject({ from: '2028-02-28T10:00:00.000Z', to: '2028-03-01T14:00:00.000Z' });
  });

  it('gives null with neither (inbox no_date); invalid inputs count as absent', () => {
    expect(candidateWindow({ summaryDate: null, anchorAt: null })).toBeNull();
    expect(candidateWindow({ summaryDate: undefined, anchorAt: undefined })).toBeNull();
    expect(candidateWindow({ summaryDate: '2026-02-30', anchorAt: null })).toBeNull();
    expect(candidateWindow({ summaryDate: '16/10/2026', anchorAt: null })).toBeNull();
    expect(candidateWindow({ summaryDate: null, anchorAt: 'yesterday' })).toBeNull();
    // An RFC 5322 Date is header text, not an anchor: the caller converts it first.
    expect(candidateWindow({ summaryDate: null, anchorAt: 'Fri, 16 Oct 2026 15:20:00 -0600' })).toBeNull();
    expect(candidateWindow({ summaryDate: '2026-02-30', anchorAt: SIGNED_AT })?.basis).toBe('anchor');
    expect(candidateWindow({ summaryDate: D, anchorAt: 'garbage' })).toEqual(DATE_WINDOW);
  });
});

// ---------------------------------------------------------------------------------------------

describe('loadCandidates: one-off meetings', () => {
  it('returns a one-off meeting in range from the masked fields only', async () => {
    const db = new FakeFirestore();
    put(
      db,
      'm_one',
      meetingDoc({
        source: 'google',
        conference: { provider: 'zoom', url: 'https://us02web.zoom.us/j/81234567890', password: 'pw-synthetic' },
      }),
    );
    const result = await load(db);
    expect(result.candidates).toEqual([
      {
        meetingId: 'm_one',
        occurrenceDate: null,
        title: 'Acmepay weekly sync',
        startAt: '2026-10-16T20:00:00.000Z',
        endAt: '2026-10-16T21:00:00.000Z',
        timezone: MX,
        allDay: false,
        cancelled: false,
        deleted: false,
        source: 'google',
        conferenceUrl: 'https://us02web.zoom.us/j/81234567890',
      },
    ]);
    const serialized = JSON.stringify(result);
    for (const secret of ['pw-synthetic', 'Synthetic private note', 'pat@company.example', 'Synthetic agenda text']) {
      expect(serialized).not.toContain(secret);
    }
    expect(result.warn).not.toHaveBeenCalled();
  });

  it('drops tombstones (deletedAt set, or status deleted) and meetings outside the window', async () => {
    const db = new FakeFirestore();
    put(db, 'm_live', meetingDoc());
    put(db, 'm_tombstone', meetingDoc({ title: 'Deleted meeting', deletedAt: '2026-10-15T08:00:00.000Z' }));
    put(db, 'm_status_deleted', meetingDoc({ status: 'deleted' }));
    put(db, 'm_garbage_deleted_at', meetingDoc({ deletedAt: 12345 }));
    put(db, 'm_day_before', meetingDoc({ startAt: '2026-10-15T09:59:00.000Z' }));
    put(db, 'm_week_before', meetingDoc({ startAt: '2026-10-09T20:00:00.000Z' }));
    const result = await load(db);
    expect(keys(result.candidates)).toEqual(['m_live@-']);
  });

  it('keeps a cancelled meeting, marked cancelled (a suggestion that never files)', async () => {
    const db = new FakeFirestore();
    put(db, 'm_cancelled', meetingDoc({ status: 'cancelled' }));
    const result = await load(db);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ meetingId: 'm_cancelled', cancelled: true });
  });

  it('takes nothing that starts at or after now plus 15 minutes', async () => {
    const db = new FakeFirestore();
    put(db, 'm_started', meetingDoc({ startAt: '2026-10-16T21:39:59.999Z' }));
    put(db, 'm_future', meetingDoc({ startAt: '2026-10-16T21:40:00.000Z' }));
    put(db, 'm_tonight', meetingDoc({ startAt: '2026-10-17T02:00:00.000Z' })); // 20:00 local on D
    expect(keys((await load(db, DATE_WINDOW, NOW)).candidates)).toEqual(['m_started@-']);
    expect(keys((await load(db, DATE_WINDOW, NOW_LATE)).candidates)).toEqual(['m_started@-', 'm_future@-', 'm_tonight@-']);
    expect(db.queries[0]?.filters).toEqual([
      { field: 'startAt', op: '>=', value: '2026-10-15T10:00:00.000Z' },
      { field: 'startAt', op: '<', value: '2026-10-16T21:40:00.000Z' },
    ]);
  });

  it('fills missing optional fields like the app (60 minutes, not all-day, scheduled)', async () => {
    const db = new FakeFirestore();
    put(db, 'm_sparse', without(without(without(meetingDoc(), 'durationMinutes'), 'allDay'), 'status'));
    // A syntactically valid zone Intl does not know stays (decide() falls back to the other zones).
    put(db, 'm_unknown_zone', meetingDoc({ startAt: '2026-10-16T18:00:00.000Z', timezone: 'Mars/Base' }));
    const result = await load(db);
    expect(result.candidates).toEqual([
      expect.objectContaining({ meetingId: 'm_unknown_zone', timezone: 'Mars/Base' }),
      expect.objectContaining({ meetingId: 'm_sparse', endAt: '2026-10-16T21:00:00.000Z', allDay: false, cancelled: false }),
    ]);
  });

  it('skips documents that cannot be read, never throws, and logs counts only', async () => {
    const db = new FakeFirestore();
    put(db, 'm_good', meetingDoc());
    put(db, 'm_bad_start', meetingDoc({ startAt: '2026-10-16T19:61:00.000Z' }));
    put(db, 'm_no_title', without(meetingDoc(), 'title'));
    put(db, 'm_empty_title', meetingDoc({ title: '' }));
    put(db, 'm_zero_duration', meetingDoc({ durationMinutes: 0 }));
    put(db, 'm_text_duration', meetingDoc({ durationMinutes: '60' }));
    put(db, 'm_bad_zone', meetingDoc({ timezone: 'Not a zone' }));
    put(db, 'm_odd_status', meetingDoc({ status: 'postponed' }));
    put(db, 'm_no_source', without(meetingDoc(), 'source'));
    put(db, 'bad.id', meetingDoc());
    const result = await load(db);
    expect(keys(result.candidates)).toEqual(['m_good@-']);
    expect(result.warn).toHaveBeenCalledTimes(1);
    expect(result.warn).toHaveBeenCalledWith('summaries.candidates', expect.objectContaining({ uid: UID, skipped: 9, capped: false }));
    expectCountsOnly(result.warn.mock.calls);
  });

  it('cuts titles to the schema bound without splitting a surrogate pair', async () => {
    const db = new FakeFirestore();
    const smiley = String.fromCharCode(0xd83d, 0xde00);
    put(db, 'm_pair', meetingDoc({ title: `${'B'.repeat(499)}${smiley}${'C'.repeat(100)}` }));
    put(db, 'm_long', meetingDoc({ startAt: '2026-10-16T18:00:00.000Z', title: 'D'.repeat(600) }));
    const result = await load(db);
    expect(result.candidates.map((c) => c.title)).toEqual(['D'.repeat(500), 'B'.repeat(499)]);
  });

  it('skips an oversized document', async () => {
    const db = new FakeFirestore();
    put(db, 'm_good', meetingDoc());
    put(db, 'm_huge', meetingDoc({ startAt: '2026-10-16T18:00:00.000Z', title: 'H'.repeat(200_000) }));
    const result = await load(db);
    expect(keys(result.candidates)).toEqual(['m_good@-']);
    expect(result.warn).toHaveBeenCalledWith('summaries.candidates', expect.objectContaining({ oversized: 1, skipped: 0 }));
  });
});

// ---------------------------------------------------------------------------------------------

describe('loadCandidates: Meeting Guard AI series', () => {
  it("gives today's occurrence of a weekly series once, keyed by its original date", async () => {
    const db = new FakeFirestore();
    put(db, 'm_series', seriesDoc());
    const result = await load(db);
    expect(result.candidates).toEqual([
      {
        meetingId: 'm_series',
        occurrenceDate: D,
        title: 'Acmepay weekly sync',
        startAt: '2026-10-16T20:00:00.000Z',
        endAt: '2026-10-16T21:00:00.000Z',
        timezone: MX,
        allDay: false,
        cancelled: false,
        deleted: false,
        source: 'manual',
        conferenceUrl: null,
      },
    ]);
  });

  it('does not double-count a master whose first occurrence is in the window', async () => {
    const db = new FakeFirestore();
    put(db, 'm_new_series', seriesDoc({ startAt: '2026-10-16T20:00:00.000Z', date: D, seriesId: 'm_new_series' }));
    const result = await load(db);
    // Query 1 returned the master too; it is expanded once.
    expect(keys(result.candidates)).toEqual([`m_new_series@${D}`]);
  });

  it('expands a master that only query 1 returned (query 2 capped)', async () => {
    const db = new FakeFirestore();
    // 200 older series fill query 2 (document id order); the in-window master sorts after them.
    for (let i = 0; i < CANDIDATES_TUNING.queryLimit; i += 1) {
      put(db, `a_series_${String(i).padStart(3, '0')}`, seriesDoc({ startAt: '2026-01-05T15:00:00.000Z', recurrence: { ...WEEKLY_FR, byWeekday: ['MO'] } }));
    }
    put(db, 'z_series', seriesDoc({ startAt: '2026-10-16T20:00:00.000Z', date: D }));
    const result = await load(db);
    expect(keys(result.candidates)).toEqual([`z_series@${D}`]);
    expect(result.warn).toHaveBeenCalledWith('summaries.candidates', expect.objectContaining({ seriesCapped: true, capped: true }));
  });

  it('puts a moved occurrence at its new time and title, with the ORIGINAL occurrenceDate', async () => {
    const db = new FakeFirestore();
    put(
      db,
      'm_series',
      seriesDoc({
        recurrenceOverrides: {
          // Today's occurrence moved to 11:00 local, 45 minutes, renamed.
          [D]: { status: 'modified', startAt: '2026-10-16T17:00:00.000Z', durationMinutes: 45, title: 'Acmepay weekly sync (moved)' },
          // Last week's occurrence moved onto today at 09:00 local.
          '2026-10-09': { status: 'modified', startAt: '2026-10-16T15:00:00.000Z', durationMinutes: null, title: null },
        },
      }),
    );
    const result = await load(db);
    expect(result.candidates.map((c) => ({ occurrenceDate: c.occurrenceDate, title: c.title, startAt: c.startAt, endAt: c.endAt }))).toEqual([
      { occurrenceDate: '2026-10-09', title: 'Acmepay weekly sync', startAt: '2026-10-16T15:00:00.000Z', endAt: '2026-10-16T16:00:00.000Z' },
      { occurrenceDate: D, title: 'Acmepay weekly sync (moved)', startAt: '2026-10-16T17:00:00.000Z', endAt: '2026-10-16T17:45:00.000Z' },
    ]);
  });

  it('drops an occurrence moved out of the window', async () => {
    const db = new FakeFirestore();
    put(
      db,
      'm_series',
      seriesDoc({ recurrenceOverrides: { [D]: { status: 'modified', startAt: '2026-10-20T20:00:00.000Z', durationMinutes: null, title: null } } }),
    );
    expect((await load(db)).candidates).toEqual([]);
  });

  it('omits a cancelled occurrence', async () => {
    const db = new FakeFirestore();
    put(db, 'm_series', seriesDoc({ recurrenceOverrides: { [D]: { status: 'cancelled', startAt: null, durationMinutes: null, title: null } } }));
    put(db, 'm_marketing', meetingDoc({ title: 'Marketing review', startAt: '2026-10-16T16:00:00.000Z', durationMinutes: 30 }));
    const result = await load(db);
    expect(keys(result.candidates)).toEqual(['m_marketing@-']);
  });

  it('passes the occurrences of a cancelled series as cancelled', async () => {
    const db = new FakeFirestore();
    put(db, 'm_series', seriesDoc({ status: 'cancelled' }));
    const result = await load(db);
    expect(result.candidates).toEqual([expect.objectContaining({ meetingId: 'm_series', occurrenceDate: D, cancelled: true })]);
  });

  it('expands an all-day series at local midnight and keeps only starts inside the window', async () => {
    const db = new FakeFirestore();
    put(
      db,
      'm_all_day',
      meetingDoc({ title: 'Acmepay offsite', startAt: '2026-10-01T06:00:00.000Z', allDay: true, durationMinutes: 1440, recurrence: DAILY }),
    );
    // 10-15 starts before `from` (it only overlaps); 10-17 has not begun at NOW.
    expect(keys((await load(db, DATE_WINDOW, NOW)).candidates)).toEqual([`m_all_day@${D}`]);
    const late = await load(db, DATE_WINDOW, NOW_LATE);
    expect(late.candidates.map((c) => [c.occurrenceDate, c.startAt, c.allDay])).toEqual([
      [D, '2026-10-16T06:00:00.000Z', true],
      ['2026-10-17', '2026-10-17T06:00:00.000Z', true],
    ]);
  });

  it('skips series that cannot be expanded and drops tombstoned masters', async () => {
    const db = new FakeFirestore();
    put(db, 'm_series', seriesDoc());
    put(db, 'm_unknown_zone', seriesDoc({ timezone: 'Mars/Base' }));
    put(db, 'm_bad_rule', seriesDoc({ recurrence: { ...WEEKLY_FR, interval: 0 } }));
    put(db, 'm_bad_override', seriesDoc({ recurrenceOverrides: { '16-10-2026': { status: 'cancelled', startAt: null, durationMinutes: null, title: null } } }));
    put(db, 'm_old_tombstone', seriesDoc({ deletedAt: '2026-10-01T00:00:00.000Z' }));
    const result = await load(db);
    expect(keys(result.candidates)).toEqual([`m_series@${D}`]);
    expect(result.warn).toHaveBeenCalledWith('summaries.candidates', expect.objectContaining({ skipped: 3, tombstones: 1 }));
    expectCountsOnly(result.warn.mock.calls);
  });

  it('reads imported Google and Outlook series as one document per instance', async () => {
    const db = new FakeFirestore();
    put(db, 'o_inst_1009', meetingDoc({ source: 'outlook', startAt: '2026-10-09T20:00:00.000Z' }));
    put(db, 'o_inst_1016', meetingDoc({ source: 'outlook' }));
    put(db, 'g_inst_1016', meetingDoc({ source: 'google', title: 'Marketing review', startAt: '2026-10-16T16:00:00.000Z', durationMinutes: 30 }));
    // A Google series imported as a rule (parseGoogleRecurrence) is a master like any other.
    put(db, 'g_series', seriesDoc({ source: 'google', title: 'Acmepay vendor check', startAt: '2026-09-18T18:00:00.000Z' }));
    const result = await load(db);
    expect(keys(result.candidates)).toEqual(['g_inst_1016@-', `g_series@${D}`, 'o_inst_1016@-']);
    expect(result.candidates.map((c) => c.source)).toEqual(['google', 'google', 'outlook']);
  });
});

// ---------------------------------------------------------------------------------------------

describe('loadCandidates: queries and bounds', () => {
  it('uses single-field indexes only: a startAt range and recurrence.freq in', async () => {
    const db = new FakeFirestore();
    await load(db);
    const meetings = `users/${UID}/meetings`;
    expect(db.queries).toEqual([
      {
        collection: meetings,
        filters: [
          { field: 'startAt', op: '>=', value: '2026-10-15T10:00:00.000Z' },
          { field: 'startAt', op: '<', value: '2026-10-16T21:40:00.000Z' },
        ],
        orderBy: ['startAt'],
        select: [...CANDIDATE_FIELDS],
        limit: CANDIDATES_TUNING.queryLimit,
      },
      {
        collection: meetings,
        filters: [{ field: 'recurrence.freq', op: 'in', value: [...RECURRENCE_FREQS] }],
        orderBy: [],
        select: [...CANDIDATE_FIELDS],
        limit: CANDIDATES_TUNING.queryLimit,
      },
    ]);
    expect(CANDIDATE_FIELDS).not.toContain('conference');
    expect(CANDIDATE_FIELDS).toContain('conference.url');
    expect(db.getAllCalls).toEqual([{ paths: [`users/${UID}/settings/preferences`], fieldMask: ['timezone'] }]);
  });

  it('caps the one-off query and logs counts only', async () => {
    const db = new FakeFirestore();
    for (let i = 0; i < 205; i += 1) {
      const start = new Date(Date.parse('2026-10-15T10:00:00.000Z') + i * 60_000).toISOString();
      put(db, `m_${String(i).padStart(3, '0')}`, meetingDoc({ title: `Acmepay item ${i}`, startAt: start, durationMinutes: 15 }));
    }
    const result = await load(db);
    expect(result.candidates).toHaveLength(CANDIDATES_TUNING.queryLimit);
    expect(result.warn).toHaveBeenCalledWith(
      'summaries.candidates',
      expect.objectContaining({ uid: UID, basis: 'summary_date', capped: true, oneOffCapped: true, oneOffDocs: 200, candidates: 200 }),
    );
    expectCountsOnly(result.warn.mock.calls);
  });

  it('caps the occurrences of one series', async () => {
    const db = new FakeFirestore();
    const overrides: Data = {};
    for (let day = 1; day <= 30; day += 1) {
      const key = `2026-09-${String(day).padStart(2, '0')}`;
      const start = new Date(Date.parse('2026-10-16T12:00:00.000Z') + day * 10 * 60_000).toISOString();
      overrides[key] = { status: 'modified', startAt: start, durationMinutes: null, title: null };
    }
    put(
      db,
      'm_daily',
      meetingDoc({ startAt: '2026-09-01T15:00:00.000Z', durationMinutes: 30, recurrence: DAILY, recurrenceOverrides: overrides }),
    );
    const result = await load(db);
    expect(result.candidates).toHaveLength(CANDIDATES_TUNING.maxOccurrencesPerSeries);
    expect(result.warn).toHaveBeenCalledWith('summaries.candidates', expect.objectContaining({ occurrenceCapped: 1, capped: true }));
  });

  it('stops reading at the byte budget', async () => {
    const db = new FakeFirestore();
    for (let i = 0; i < 40; i += 1) {
      const start = new Date(Date.parse('2026-10-16T12:00:00.000Z') + i * 60_000).toISOString();
      put(db, `m_${String(i).padStart(2, '0')}`, meetingDoc({ title: 'W'.repeat(120_000), startAt: start }));
    }
    const result = await load(db);
    expect(result.candidates.length).toBeGreaterThan(30);
    expect(result.candidates.length).toBeLessThan(40);
    // The stream was left early: the rest of the query was never delivered.
    expect(db.streamed).toBe(result.candidates.length + 1);
    expect(result.warn).toHaveBeenCalledWith('summaries.candidates', expect.objectContaining({ budgetCapped: true, capped: true }));
  });

  it('reads no meetings without a usable window', async () => {
    const overlong: CandidateWindow = { from: '2026-10-12T00:00:00.000Z', to: '2026-10-17T00:00:00.000Z', basis: 'anchor' };
    const notBegun: CandidateWindow = { from: '2026-10-17T00:00:00.000Z', to: '2026-10-17T12:00:00.000Z', basis: 'anchor' };
    const inverted: CandidateWindow = { from: '2026-10-17T00:00:00.000Z', to: '2026-10-16T00:00:00.000Z', basis: 'anchor' };
    const loose: CandidateWindow = { from: '2026-10-16', to: '2026-10-17', basis: 'anchor' };
    for (const [window, now] of [
      [null, NOW],
      [overlong, NOW_LATE],
      [notBegun, NOW],
      [inverted, NOW_LATE],
      [loose, NOW_LATE],
      [DATE_WINDOW, new Date('invalid')],
    ] as const) {
      const db = new FakeFirestore();
      put(db, 'm_one', meetingDoc());
      db.docs.set(`users/${UID}/settings/preferences`, { timezone: MX });
      const result = await load(db, window, now);
      expect(result.candidates).toEqual([]);
      expect(result.preferencesTimeZone).toBe(MX);
      expect(db.queries).toEqual([]);
    }
  });

  it('logs through firebase-functions/logger by default', async () => {
    const db = new FakeFirestore();
    put(db, 'm_no_title', without(meetingDoc(), 'title'));
    await loadCandidates(db as unknown as Firestore, UID, DATE_WINDOW, NOW);
    expect(functionsLogger.warn).toHaveBeenCalledWith('summaries.candidates', expect.objectContaining({ skipped: 1 }));
    expectCountsOnly((functionsLogger.warn as jest.Mock).mock.calls);
  });

  it('lets a Firestore failure through (the inbound handler answers 500)', async () => {
    const db = new FakeFirestore();
    db.failQueries = new Error('UNAVAILABLE');
    await expect(loadCandidates(db as unknown as Firestore, UID, DATE_WINDOW, NOW, { logger: silentLogger() })).rejects.toThrow('UNAVAILABLE');
  });

  it('rejects a uid that could splice a path', async () => {
    const db = new FakeFirestore();
    await expect(loadCandidates(db as unknown as Firestore, 'a/b', DATE_WINDOW, NOW)).rejects.toThrow('invalid uid');
    await expect(readPreferencesTimeZone(db as unknown as Firestore, '')).rejects.toThrow('invalid uid');
    expect(db.queries).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------

describe('preferences zone', () => {
  it('accepts valid IANA zones only', () => {
    for (const zone of [MX, 'UTC', 'Etc/GMT+12', 'Pacific/Kiritimati', 'Europe/London']) {
      expect(parsePreferencesTimeZone(zone)).toBe(zone);
    }
    for (const value of ['Mars/Base', '+05:00', '', ' UTC', `${MX} `, 'A'.repeat(65), 42, null, undefined, {}]) {
      expect(parsePreferencesTimeZone(value)).toBeNull();
    }
  });

  it('reads users/{uid}/settings/preferences.timezone with a field mask', async () => {
    const db = new FakeFirestore();
    expect(await readPreferencesTimeZone(db as unknown as Firestore, UID)).toBeNull();
    db.docs.set(`users/${UID}/settings/preferences`, { timezone: MX, language: 'es', briefingTime: '08:00' });
    expect(await readPreferencesTimeZone(db as unknown as Firestore, UID)).toBe(MX);
    db.docs.set(`users/${UID}/settings/preferences`, { timezone: 'Mars/Base' });
    expect(await readPreferencesTimeZone(db as unknown as Firestore, UID)).toBeNull();
    db.docs.set(`users/${UID}/settings/preferences`, { language: 'en' });
    expect(await readPreferencesTimeZone(db as unknown as Firestore, UID)).toBeNull();
    expect(db.getAllCalls.every((call) => JSON.stringify(call.fieldMask) === JSON.stringify(['timezone']))).toBe(true);
  });

  it('loadCandidates returns the stored zone, or uses (and re-checks) the one the caller read', async () => {
    const db = new FakeFirestore();
    db.docs.set(`users/${UID}/settings/preferences`, { timezone: MX });
    expect((await load(db)).preferencesTimeZone).toBe(MX);

    const given = new FakeFirestore();
    expect((await load(given, DATE_WINDOW, NOW, { preferencesTimeZone: 'Europe/London' })).preferencesTimeZone).toBe('Europe/London');
    expect((await load(given, DATE_WINDOW, NOW, { preferencesTimeZone: 'Mars/Base' })).preferencesTimeZone).toBeNull();
    expect((await load(given, DATE_WINDOW, NOW, { preferencesTimeZone: null })).preferencesTimeZone).toBeNull();
    expect(given.getAllCalls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------

describe('end to end with decide(): the worked fixture of section 6', () => {
  /** The weekly sync as a Meeting Guard AI series, the marketing review as a Google import, noise. */
  function fixtureDb(): FakeFirestore {
    const db = new FakeFirestore();
    db.docs.set(`users/${UID}/settings/preferences`, { timezone: MX, language: 'es' });
    put(db, 'm_sync', seriesDoc({ seriesId: 'm_sync' }));
    put(
      db,
      'm_marketing',
      meetingDoc({ title: 'Marketing review', source: 'google', startAt: '2026-10-16T16:00:00.000Z', durationMinutes: 30 }),
    );
    put(db, 'm_deleted', meetingDoc({ title: 'Deleted meeting', deletedAt: '2026-10-14T00:00:00.000Z' }));
    put(db, 'm_other_day', meetingDoc({ title: 'Acmepay marketing sync', startAt: '2026-10-14T20:00:00.000Z' }));
    // Later the same day: it has not begun when the recap arrives, so it is no candidate.
    put(db, 'm_evening', meetingDoc({ title: 'Acmepay marketing retro', startAt: '2026-10-17T00:00:00.000Z' }));
    return db;
  }

  function input(loaded: LoadedCandidates, overrides: Partial<MatchInput> = {}): MatchInput {
    return {
      tier: 'vendor_verified',
      recipientBound: true,
      fresh: true,
      titleLine: 'Acmepay marketing launch readiness',
      subjectClean: 'Meeting notes: Acmepay marketing launch readiness',
      summaryDate: D,
      anchor: { at: SIGNED_AT, signed: true },
      text: 'Synthetic recap. Action items: [ ] Send the synthetic file (owner: Pat)',
      preferencesTimeZone: loaded.preferencesTimeZone,
      rejectedMeetingIds: [],
      candidates: loaded.candidates,
      now: NOW,
      ...overrides,
    };
  }

  it('files the recap under the series occurrence: S 0.74 against 0.47', async () => {
    const loaded = await load(fixtureDb(), windowFor(D, SIGNED_AT), NOW);
    expect(keys(loaded.candidates)).toEqual(['m_marketing@-', `m_sync@${D}`]);
    expect(loaded.preferencesTimeZone).toBe(MX);

    const record = decide(input(loaded));
    expect(record.status).toBe('matched');
    expect(record.match).toMatchObject({
      meetingId: 'm_sync',
      occurrenceDate: D,
      duplicateMeetingIds: [],
      method: 'auto',
      score: 0.74,
      titleScore: 0.6,
      timeScore: 1,
      zoneUsed: 'meeting',
      meetingSnapshot: { title: 'Acmepay weekly sync', startAt: '2026-10-16T20:00:00.000Z', endAt: '2026-10-16T21:00:00.000Z', timezone: MX },
    });
    const marketing = record.candidates.find((c) => c.meetingId === 'm_marketing');
    expect(marketing?.titleScore).toBe(0.6);
    expect(marketing?.score).toBeCloseTo(0.47, 2);
  });

  it('without a signed time: 0.565 each, inbox ambiguous, both suggested', async () => {
    const loaded = await load(fixtureDb(), windowFor(D, null), NOW);
    const record = decide(input(loaded, { anchor: null }));
    expect(record.status).toBe('inbox');
    expect(record.inboxReason).toBe('ambiguous');
    expect(record.match).toBeNull();
    expect(record.candidates.map((c) => c.score)).toEqual([0.565, 0.565]);
    expect(record.candidates.map((c) => c.meetingId).sort()).toEqual(['m_marketing', 'm_sync']);
  });

  it('a cancelled occurrence of the sync leaves nothing to file automatically', async () => {
    const db = fixtureDb();
    put(
      db,
      'm_sync',
      seriesDoc({ seriesId: 'm_sync', recurrenceOverrides: { [D]: { status: 'cancelled', startAt: null, durationMinutes: null, title: null } } }),
    );
    const record = decide(input(await load(db, windowFor(D, SIGNED_AT), NOW)));
    expect(record.status).toBe('inbox');
    expect(record.candidates.map((c) => c.meetingId)).toEqual(['m_marketing']);
  });

  it('reaches decide() at the UTC+14 and UTC-12 edges of the date window', async () => {
    const db = new FakeFirestore();
    const zephyr = (id: string, timezone: string, date: string, time: string) =>
      put(db, id, meetingDoc({ title: 'Zephyrcorp onboarding', timezone, startAt: zonedDateTimeToUtcIso(date, time, timezone), durationMinutes: 30 }));
    zephyr('m_kiritimati', 'Pacific/Kiritimati', D, '00:30');
    zephyr('m_baker', 'Etc/GMT+12', D, '23:30');
    zephyr('m_kiritimati_before', 'Pacific/Kiritimati', '2026-10-15', '23:30');
    const loaded = await load(db, windowFor(D, null), NOW_LATE);
    expect(keys(loaded.candidates)).toEqual(['m_kiritimati@-', 'm_baker@-']);

    const record = decide({
      ...input(loaded, { anchor: null, titleLine: 'Zephyrcorp onboarding', subjectClean: null, now: NOW_LATE }),
      preferencesTimeZone: null,
    });
    expect(record.candidates.map((c) => [c.meetingId, c.zoneUsed]).sort()).toEqual([
      ['m_baker', 'meeting'],
      ['m_kiritimati', 'meeting'],
    ]);
  });
});
