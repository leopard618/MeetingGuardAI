/**
 * summaryRead and the M11 hand-off (functions/src/summaries/read.ts; docs/v2/M10-DESIGN.md
 * section 4 Callables, sections 6 to 9 and 12). Firestore is the in-memory fake in
 * summariesFakeFirestore.ts; candidates and matching are the real candidates.ts and match.ts. The
 * logger is mocked so every log line can be checked for content. All data is synthetic.
 */
jest.mock('firebase-functions/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as functionsLogger from 'firebase-functions/logger';
import { HttpsError } from 'firebase-functions/https';
import type { Firestore } from 'firebase-admin/firestore';

import {
  SUMMARY_ERROR_HTTPS_CODES,
  SUMMARY_LIMITS,
  summaryReadGetResponseSchema,
  summaryReadListResponseSchema,
  type SummaryErrorCode,
  type SummaryReadGetResponse,
  type SummaryReadListResponse,
} from '../../src/shared/aiContract';
import { SealedError, parseKeyring, type Keyring } from '../../src/shared/sealed';
import type { SummaryCallableAuth } from '../../src/summaries/callables';
import { loadCandidates } from '../../src/summaries/candidates';
import { decide } from '../../src/summaries/match';
import {
  SUMMARY_SCHEMA_VERSION,
  addDaysIso,
  sealSummaryContent,
  storedSummarySchema,
  summaryDocPath,
  type StoredCandidate,
  type StoredMatch,
  type StoredSummaryDoc,
} from '../../src/summaries/model';
import {
  SUMMARY_LIST_FIELDS,
  SUMMARY_READ_TUNING,
  handleSummaryRead,
  lazyKeyring,
  loadSummaryForExtraction,
  rematchPatch,
  summarySuggestionsOf,
  summaryTitleOf,
  type SummaryCandidatesLoader,
  type SummaryReadConfig,
  type SummaryReadDeps,
} from '../../src/summaries/read';
import { SECTIONS_PARSER_VERSION, parseSections } from '../../src/summaries/sections';
import { EXTRACTOR_VERSION } from '../../src/commitments/extraction';
import { FakeFirestore, type FakeTransaction } from './summariesFakeFirestore';

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

const NOW = new Date('2026-11-12T10:00:00.000Z');
const UID = 'uidReadDana01';
const OTHER_UID = 'uidReadLee02';
const OUTSIDER = 'uidOutsider03';
const EMAIL = 'dana@company.example';
const KEYRING: Keyring = parseKeyring(`k1:${Buffer.alloc(32, 7).toString('base64')}`);
const OTHER_KEYRING: Keyring = parseKeyring(`k1:${Buffer.alloc(32, 8).toString('base64')}`);
const SEEDED_AT = '2026-11-01T09:00:00.000Z';

/** The worked specimen (design section 6): received 16:00Z, signed Date 15:20Z, summary date 2026-11-10. */
const RECEIVED_AT = '2026-11-10T16:00:00.000Z';
const ANCHOR_AT = '2026-11-10T15:20:00.000Z';
const SUMMARY_DATE = '2026-11-10';
const SUBJECT = 'Recap: Urpayroll weekly sync';
const TITLE_LINE = 'Urpayroll weekly sync';
const FROM_ADDRESS = 'recaps@notetaker.example';
const MAILBOX = 'dana@company.example';
const CONFERENCE_URL = 'https://zoom.us/j/5550001234';
const RECAP_TEXT = [
  'Urpayroll weekly sync',
  'Meeting notes - 2026-11-10',
  '',
  'Action items',
  '[ ] Provide APK access to Urpayroll (owner: Bish)',
  '[ ] Send the release checklist (owner: Dana)',
].join('\n');

const MEETING_ID = 'mtgUrpayrollSync01';
const OTHER_MEETING_ID = 'mtgMarketingReview1';
const DEVICE_COPY_ID = 'mtgUrpayrollDevice1';

/** Distinct 64-hex summary ids. */
function sid(label: string): string {
  return createHash('sha256').update(`read-test:${label}`).digest('hex');
}

const SUM_A = sid('a');
const SUM_B = sid('b');
const SUM_C = sid('c');
const SUM_D = sid('d');
const SUM_E = sid('e');

function verifiedAuth(uid: string = UID): SummaryCallableAuth {
  return { uid, token: { email: EMAIL, email_verified: true, firebase: { sign_in_provider: 'password' } } };
}

function unverifiedAuth(uid: string = UID): SummaryCallableAuth {
  return { uid, token: { email: EMAIL, email_verified: false, firebase: { sign_in_provider: 'password' } } };
}

function appleAuth(uid: string = UID): SummaryCallableAuth {
  return { uid, token: { email: EMAIL, email_verified: false, firebase: { sign_in_provider: 'apple.com' } } };
}

interface Content {
  subject: string | null;
  titleLine: string | null;
  dateLine: string | null;
  text: string;
  fromAddress: string | null;
  forwardedBy: string | null;
}

const DEFAULT_CONTENT: Content = {
  subject: SUBJECT,
  titleLine: TITLE_LINE,
  dateLine: 'Meeting notes - 2026-11-10',
  text: RECAP_TEXT,
  fromAddress: FROM_ADDRESS,
  forwardedBy: null,
};

/** A row 7 inbox summary of the specimen (no candidate at receipt), sealed for (uid, summaryId). */
function summaryDoc(summaryId: string, overrides: Partial<StoredSummaryDoc> = {}, content: Partial<Content> = {}, uid: string = UID): StoredSummaryDoc {
  const c = { ...DEFAULT_CONTENT, ...content };
  const parsed = parseSections(c.text);
  const sealed = sealSummaryContent(
    KEYRING,
    { uid, summaryId },
    {
      head: { subject: c.subject, titleLine: c.titleLine, dateLine: c.dateLine },
      body: { fromAddress: c.fromAddress, fromName: null, forwardedBy: c.forwardedBy, text: c.text, sections: parsed.sections },
    },
  );
  return storedSummarySchema.parse({
    schemaVersion: SUMMARY_SCHEMA_VERSION,
    parserVersion: parsed.parserVersion,
    status: 'inbox',
    inboxReason: 'no_candidate',
    refusedReason: null,
    trust: { tier: 'vendor_verified', recipientBound: true, fresh: true, anchorSource: 'signed_date', originalInboxReason: 'no_candidate' },
    senderDomain: 'notetaker.example',
    vendorDomain: 'notetaker.example',
    auth: {
      dkim: [{ domain: 'notetaker.example', result: 'pass', aligned: true, signsTo: true, signsDate: true }],
      arc: { result: 'none', sealer: null },
      verifier: 'mailauth@8.0.4',
    },
    receivedAt: RECEIVED_AT,
    sentAt: ANCHOR_AT,
    anchorAt: ANCHOR_AT,
    summaryDate: SUMMARY_DATE,
    language: 'en',
    match: null,
    candidates: [],
    rejectedMeetingIds: [],
    counts: { sections: parsed.sections.length, items: parsed.counts.items, textChars: c.text.length },
    flags: { truncated: false, textCutForSize: false, itemTextFromOffsets: false, possibleInstruction: parsed.possibleInstruction },
    contentDigest: createHash('sha256').update(`digest:${summaryId}`).digest('hex'),
    userAction: null,
    extraction: null,
    sealedHead: sealed.sealedHead,
    sealedBody: sealed.sealedBody,
    createdAt: RECEIVED_AT,
    updatedAt: RECEIVED_AT,
    expiresAt: addDaysIso(RECEIVED_AT, 60),
    ...overrides,
  });
}

function autoMatch(meetingId: string = MEETING_ID, duplicateMeetingIds: string[] = []): StoredMatch {
  return {
    meetingId,
    occurrenceDate: null,
    duplicateMeetingIds,
    method: 'auto',
    score: 1,
    titleScore: 1,
    timeScore: 1,
    reasons: ['title_equal', 'time_close', 'rule_a'],
    zoneUsed: 'meeting',
    matchedAt: RECEIVED_AT,
    meetingSnapshot: { title: 'Urpayroll weekly sync', startAt: '2026-11-10T14:00:00.000Z', endAt: '2026-11-10T15:00:00.000Z', timezone: 'UTC' },
  };
}

function filedDoc(summaryId: string, overrides: Partial<StoredSummaryDoc> = {}, content: Partial<Content> = {}): StoredSummaryDoc {
  return summaryDoc(
    summaryId,
    {
      status: 'matched',
      inboxReason: null,
      match: autoMatch(),
      trust: { tier: 'vendor_verified', recipientBound: true, fresh: true, anchorSource: 'signed_date', originalInboxReason: null },
      expiresAt: addDaysIso(RECEIVED_AT, 365),
      ...overrides,
    },
    content,
  );
}

function storedCandidate(meetingId: string, score: number, duplicateMeetingIds: string[] = []): StoredCandidate {
  return {
    meetingId,
    occurrenceDate: null,
    duplicateMeetingIds,
    title: meetingId === MEETING_ID ? 'Urpayroll weekly sync' : `Meeting ${meetingId}`,
    startAt: '2026-11-10T14:00:00.000Z',
    endAt: '2026-11-10T15:00:00.000Z',
    timezone: 'UTC',
    score,
    titleScore: 0.6,
    timeScore: 1,
    reasons: ['title_shared_word'],
    zoneUsed: 'meeting',
    cancelled: false,
    allDay: false,
  };
}

function refusedRow(day: string, count: number, reason = 'not_from_your_notetaker'): Record<string, unknown> {
  return {
    status: 'refused',
    refusedReason: reason,
    senderDomain: null,
    firstAt: `${day}T08:00:00.000Z`,
    lastAt: `${day}T09:30:00.000Z`,
    count,
    expiresAt: addDaysIso(`${day}T09:30:00.000Z`, 30),
    schemaVersion: 1,
  };
}

const MEETING_COMMON = { allDay: false, status: 'scheduled', deletedAt: null, source: 'google', timezone: 'UTC', updatedAt: SEEDED_AT };

function seedMeetings(fake: FakeFirestore, extra: Record<string, unknown> = {}): void {
  fake.seed(`users/${UID}/meetings/${MEETING_ID}`, {
    ...MEETING_COMMON,
    title: 'Urpayroll weekly sync',
    startAt: '2026-11-10T14:00:00.000Z',
    durationMinutes: 60,
    description: 'Private agenda that never leaves Firestore',
    ...extra,
  });
  fake.seed(`users/${UID}/meetings/${OTHER_MEETING_ID}`, {
    ...MEETING_COMMON,
    title: 'Marketing review',
    startAt: '2026-11-10T10:00:00.000Z',
    durationMinutes: 30,
  });
}

interface Harness {
  fake: FakeFirestore;
  deps: SummaryReadDeps;
  keyringCalls: { count: number };
}

function harness(config: Partial<SummaryReadConfig> = {}, extra: Partial<SummaryReadDeps> = {}): Harness {
  const fake = new FakeFirestore();
  fake.seed(`users/${UID}`, { createdAt: SEEDED_AT });
  fake.seed(`users/${UID}/settings/preferences`, { timezone: 'UTC' });
  const keyringCalls = { count: 0 };
  const deps: SummaryReadDeps = {
    db: fake as unknown as Firestore,
    now: () => NOW,
    config: { enabled: true, pilotUids: `${UID}, ${OTHER_UID}`, ...config },
    keyring: () => {
      keyringCalls.count += 1;
      return KEYRING;
    },
    ...extra,
  };
  return { fake, deps, keyringCalls };
}

function seed(h: Harness, summaryId: string, doc: StoredSummaryDoc | Record<string, unknown>, uid: string = UID): void {
  h.fake.seed(summaryDocPath(uid, summaryId), doc as Record<string, unknown>);
}

function stored(h: Harness, summaryId: string, uid: string = UID): StoredSummaryDoc {
  return storedSummarySchema.parse(h.fake.data(summaryDocPath(uid, summaryId)));
}

async function list(h: Harness, view: string, meetingId?: string, auth: SummaryCallableAuth = verifiedAuth()): Promise<SummaryReadListResponse> {
  const data = meetingId === undefined ? { op: 'list', view } : { op: 'list', view, meetingId };
  const response = await handleSummaryRead(auth, data, h.deps);
  if (response.op !== 'list') throw new Error('expected a list answer');
  expect(summaryReadListResponseSchema.safeParse(response).success).toBe(true);
  return response;
}

async function get(h: Harness, summaryId: string, auth: SummaryCallableAuth = verifiedAuth()): Promise<SummaryReadGetResponse> {
  const response = await handleSummaryRead(auth, { op: 'get', summaryId }, h.deps);
  if (response.op !== 'get') throw new Error('expected a get answer');
  expect(summaryReadGetResponseSchema.safeParse(response).success).toBe(true);
  return response;
}

async function expectReason(promise: Promise<unknown>, reason: SummaryErrorCode): Promise<HttpsError> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(HttpsError);
  const error = caught as HttpsError;
  expect(error.code).toBe(SUMMARY_ERROR_HTTPS_CODES[reason]);
  expect(error.details).toEqual({ reason });
  return error;
}

/** Every argument of every logger call, as one JSON string. */
function allLogText(): string {
  return JSON.stringify([
    ...(functionsLogger.debug as jest.Mock).mock.calls,
    ...(functionsLogger.info as jest.Mock).mock.calls,
    ...(functionsLogger.warn as jest.Mock).mock.calls,
    ...(functionsLogger.error as jest.Mock).mock.calls,
  ]);
}

/** The summaries.read line of the last successful call. */
function lastReadLine(): Record<string, unknown> {
  const calls = (functionsLogger.info as jest.Mock).mock.calls.filter((call) => call[0] === 'summaries.read');
  const last = calls[calls.length - 1];
  if (last === undefined) throw new Error('no summaries.read line');
  return last[1] as Record<string, unknown>;
}

function summaryReads(h: Harness, summaryId: string): string[] {
  return h.fake.log.filter((entry) => entry === `get:${summaryDocPath(UID, summaryId)}`);
}

/** Reads of a summary document outside a transaction (the re-match transaction re-reads it too). */
function readsOutsideTransactions(h: Harness, summaryId: string): number {
  const path = summaryDocPath(UID, summaryId);
  const inTransactions = h.fake.transactions.reduce((sum, tx) => sum + tx.reads.filter((read) => read === path).length, 0);
  return summaryReads(h, summaryId).length - inTransactions;
}

function meetingQueries(h: Harness): string[] {
  return h.fake.log.filter((entry) => entry === `query:users/${UID}/meetings`);
}

/** A loader that records the receipt time each call was bounded by, then runs the real one. */
function recordingLoader(calls: string[], fail?: (now: Date) => boolean): SummaryCandidatesLoader {
  return async (db, uid, window, now, options) => {
    calls.push(now.toISOString());
    if (fail?.(now)) throw new RangeError('candidates failed');
    return loadCandidates(db, uid, window, now, options);
  };
}

/** Runs `before` once, right before the first transaction (another device acting meanwhile). */
function beforeFirstTransaction(h: Harness, before: () => void): void {
  const original = h.fake.runTransaction.bind(h.fake);
  let fired = false;
  h.fake.runTransaction = (<T>(fn: (tx: FakeTransaction) => Promise<T>): Promise<T> => {
    if (!fired) {
      fired = true;
      before();
    }
    return original(fn);
  }) as FakeFirestore['runTransaction'];
}

// ---------------------------------------------------------------------------------------------
// Gates and requests
// ---------------------------------------------------------------------------------------------

describe('summaryRead gates', () => {
  it('requires a signed-in verified caller, the switch and the pilot list, in that order, before anything is read', async () => {
    const h = harness();
    await expectReason(handleSummaryRead(null, { op: 'list', view: 'inbox' }, h.deps), 'unauthenticated');
    await expectReason(handleSummaryRead(undefined, { op: 'list', view: 'inbox' }, h.deps), 'unauthenticated');
    await expectReason(handleSummaryRead(unverifiedAuth(), { op: 'list', view: 'inbox' }, h.deps), 'unauthenticated');
    await expectReason(handleSummaryRead(verifiedAuth(OUTSIDER), { op: 'list', view: 'inbox' }, h.deps), 'not_allowed');

    const off = harness({ enabled: false });
    // The switch is checked before the request is parsed, and an unverified caller before the switch.
    await expectReason(handleSummaryRead(verifiedAuth(), { op: 'nope' }, off.deps), 'not_enabled');
    await expectReason(handleSummaryRead(unverifiedAuth(), { op: 'list', view: 'inbox' }, off.deps), 'unauthenticated');
    await expectReason(handleSummaryRead(verifiedAuth(), { op: 'list', view: 'inbox' }, harness({ pilotUids: '' }).deps), 'not_allowed');

    expect(h.fake.log).toEqual([]);
    expect(off.fake.log).toEqual([]);
    expect(h.keyringCalls.count).toBe(0);
  });

  it('accepts a trusted sign-in provider without a verified email flag (the assistant rule)', async () => {
    const h = harness();
    const response = await list(h, 'inbox', undefined, appleAuth());
    expect(response).toEqual({ op: 'list', view: 'inbox', items: [], hasMore: false });
  });

  it('answers invalid_request for anything that is not exactly a contract request', async () => {
    const h = harness();
    for (const data of [
      undefined,
      null,
      {},
      { op: 'list' },
      { op: 'list', view: 'archive' },
      { op: 'list', view: 'meeting' },
      { op: 'list', view: 'inbox', meetingId: MEETING_ID },
      { op: 'list', view: 'meeting', meetingId: 'has/slash' },
      { op: 'get' },
      { op: 'get', summaryId: 'has:colon' },
      { op: 'get', summaryId: 'x'.repeat(129) },
      { op: 'delete', summaryId: SUM_A },
    ]) {
      await expectReason(handleSummaryRead(verifiedAuth(), data, h.deps), 'invalid_request');
    }
    expect(h.fake.log).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------------------------

describe('summaryRead list', () => {
  it('inbox: newest first, the title line else the cleaned subject, suggestions mapped, rejected and row 9 suggestions left out', async () => {
    const h = harness({}, { tuning: { rematchMax: 0 } });
    // A: row 7 with two suggestions, one of them rejected through its duplicate id. Its body is
    // damaged: a list never reads or opens it.
    seed(
      h,
      SUM_A,
      summaryDoc(SUM_A, {
        receivedAt: '2026-11-10T16:00:00.000Z',
        inboxReason: 'needs_confirmation',
        candidates: [storedCandidate(MEETING_ID, 0.74), storedCandidate(OTHER_MEETING_ID, 0.47, ['mtgRejectedCopy'])],
        rejectedMeetingIds: ['mtgRejectedCopy'],
        sealedBody: 'damaged-body-blob',
      }),
    );
    // B: a user forward without a title line, newest.
    seed(
      h,
      SUM_B,
      summaryDoc(
        SUM_B,
        {
          receivedAt: '2026-11-11T08:00:00.000Z',
          inboxReason: 'user_forwarded',
          trust: { tier: 'user_forwarded', recipientBound: false, fresh: false, anchorSource: 'forward_wrapper', originalInboxReason: 'user_forwarded' },
          vendorDomain: null,
          senderDomain: 'company.example',
          candidates: [storedCandidate(MEETING_ID, 0.6), storedCandidate('mtgThird', 0.5), storedCandidate('mtgFourth', 0.4)],
        },
        { titleLine: null, subject: 'Fwd: Recap: Budget review', forwardedBy: MAILBOX, fromAddress: MAILBOX },
      ),
    );
    // C: row 9 (not addressed to you), oldest. Even a stored suggestion is never shown.
    seed(
      h,
      SUM_C,
      summaryDoc(SUM_C, {
        receivedAt: '2026-11-09T08:00:00.000Z',
        inboxReason: 'not_addressed_to_you',
        trust: { tier: 'vendor_verified', recipientBound: false, fresh: true, anchorSource: 'signed_date', originalInboxReason: 'not_addressed_to_you' },
        candidates: [storedCandidate(MEETING_ID, 0.9)],
      }),
    );
    seed(h, SUM_D, filedDoc(SUM_D));
    seed(h, 'refused-2026-11-12', refusedRow('2026-11-12', 3));

    const response = await list(h, 'inbox');
    expect(response.hasMore).toBe(false);
    expect(response.items.map((item) => item.summaryId)).toEqual([SUM_B, SUM_A, SUM_C]);
    const [b, a, c] = response.items;
    expect(b).toMatchObject({ status: 'inbox', title: 'Budget review', tier: 'user_forwarded', inboxReason: 'user_forwarded', senderDomain: 'company.example' });
    expect(b?.suggestions.map((s) => s.meetingId)).toEqual([MEETING_ID, 'mtgThird', 'mtgFourth']);
    expect(a).toEqual({
      summaryId: SUM_A,
      status: 'inbox',
      title: TITLE_LINE,
      summaryDate: SUMMARY_DATE,
      receivedAt: '2026-11-10T16:00:00.000Z',
      tier: 'vendor_verified',
      recipientBound: true,
      fresh: true,
      inboxReason: 'needs_confirmation',
      refusedReason: null,
      senderDomain: 'notetaker.example',
      count: null,
      match: null,
      suggestions: [{ meetingId: MEETING_ID, occurrenceDate: null, title: 'Urpayroll weekly sync', startAt: '2026-11-10T14:00:00.000Z', score: 0.74 }],
    });
    expect(c).toMatchObject({ inboxReason: 'not_addressed_to_you', recipientBound: false, suggestions: [] });

    // Rows come from field-masked queries: no document read, no body opened, nothing written.
    for (const id of [SUM_A, SUM_B, SUM_C]) expect(summaryReads(h, id)).toEqual([]);
    expect(h.fake.writeLog()).toEqual([]);
    expect(SUMMARY_LIST_FIELDS).not.toContain('sealedBody');
    expect(JSON.stringify(response)).not.toContain('sealed');
  });

  it('recent: filed and kept summaries newest first, the match only on filed ones, never suggestions', async () => {
    const h = harness();
    seed(h, SUM_A, filedDoc(SUM_A, { receivedAt: '2026-11-08T10:00:00.000Z', candidates: [storedCandidate(MEETING_ID, 0.9)] }));
    seed(
      h,
      SUM_B,
      summaryDoc(SUM_B, {
        receivedAt: '2026-11-09T10:00:00.000Z',
        status: 'kept',
        inboxReason: null,
        userAction: { kind: 'keep', at: '2026-11-09T11:00:00.000Z' },
        candidates: [storedCandidate(MEETING_ID, 0.5)],
      }),
    );
    seed(h, SUM_C, summaryDoc(SUM_C, { receivedAt: '2026-11-11T10:00:00.000Z' }));
    seed(h, 'refused-2026-11-12', refusedRow('2026-11-12', 1));

    const response = await list(h, 'recent');
    expect(response.items.map((item) => [item.summaryId, item.status])).toEqual([
      [SUM_B, 'kept'],
      [SUM_A, 'matched'],
    ]);
    expect(response.items[1]?.match).toEqual({
      meetingId: MEETING_ID,
      occurrenceDate: null,
      method: 'auto',
      meetingSnapshot: { title: 'Urpayroll weekly sync', startAt: '2026-11-10T14:00:00.000Z', endAt: '2026-11-10T15:00:00.000Z', timezone: 'UTC' },
    });
    expect(response.items[0]?.match).toBeNull();
    for (const item of response.items) {
      expect(item.suggestions).toEqual([]);
      expect(item.inboxReason).toBeNull();
    }
    expect(h.fake.writeLog()).toEqual([]);
  });

  it('refused: one row per UTC day with its count, newest day first, no content and no key needed', async () => {
    const h = harness(
      {},
      {
        keyring: () => {
          throw new Error('the refused view must not ask for the key');
        },
      },
    );
    seed(h, 'refused-2026-11-10', refusedRow('2026-11-10', 2, 'changed_after_sending'));
    seed(h, 'refused-2026-11-12', { ...refusedRow('2026-11-12', 40), senderDomain: 'notetaker.example' });
    seed(h, 'refused-2026-11-11', refusedRow('2026-11-11', 1));
    seed(h, SUM_A, summaryDoc(SUM_A));

    const response = await list(h, 'refused');
    expect(response.items.map((item) => [item.summaryId, item.count, item.refusedReason])).toEqual([
      ['refused-2026-11-12', 40, 'not_from_your_notetaker'],
      ['refused-2026-11-11', 1, 'not_from_your_notetaker'],
      ['refused-2026-11-10', 2, 'changed_after_sending'],
    ]);
    expect(response.items[0]).toEqual({
      summaryId: 'refused-2026-11-12',
      status: 'refused',
      title: null,
      summaryDate: null,
      receivedAt: '2026-11-12T09:30:00.000Z',
      tier: null,
      recipientBound: false,
      fresh: false,
      inboxReason: null,
      refusedReason: 'not_from_your_notetaker',
      senderDomain: 'notetaker.example',
      count: 40,
      match: null,
      suggestions: [],
    });
  });

  it('meeting: summaries filed under the meeting, as its representative or as a duplicate, newest first', async () => {
    const h = harness();
    seed(h, SUM_A, filedDoc(SUM_A, { receivedAt: '2026-11-10T16:00:00.000Z' }));
    seed(h, SUM_B, filedDoc(SUM_B, { receivedAt: '2026-11-11T16:00:00.000Z', match: autoMatch(OTHER_MEETING_ID, [MEETING_ID]) }));
    seed(h, SUM_C, filedDoc(SUM_C, { match: autoMatch(OTHER_MEETING_ID) }));
    seed(h, SUM_D, summaryDoc(SUM_D, { status: 'kept', inboxReason: null, userAction: { kind: 'keep', at: RECEIVED_AT } }));
    seed(h, SUM_E, summaryDoc(SUM_E, { inboxReason: 'needs_confirmation', candidates: [storedCandidate(MEETING_ID, 0.9)] }));

    const response = await list(h, 'meeting', MEETING_ID);
    expect(response.items.map((item) => item.summaryId)).toEqual([SUM_B, SUM_A]);
    expect(response.items.map((item) => item.match?.meetingId)).toEqual([OTHER_MEETING_ID, MEETING_ID]);
    expect((await list(h, 'meeting', 'mtgNobodyFiledHere')).items).toEqual([]);
    expect(h.fake.writeLog()).toEqual([]);
  });

  it('answers an empty view without asking for the key', async () => {
    const h = harness();
    for (const view of ['inbox', 'recent', 'refused']) {
      expect(await list(h, view)).toEqual({ op: 'list', view, items: [], hasMore: false });
    }
    expect(await list(h, 'meeting', MEETING_ID)).toEqual({ op: 'list', view: 'meeting', items: [], hasMore: false });
    expect(h.keyringCalls.count).toBe(0);
  });

  it('pages at SUMMARY_LIMITS.maxListItems: the newest rows, hasMore when more exist', async () => {
    const h = harness({}, { tuning: { rematchMax: 0 } });
    const start = Date.parse('2026-10-01T00:00:00.000Z');
    const ids: string[] = [];
    for (let index = 0; index < SUMMARY_LIMITS.maxListItems + 1; index += 1) {
      const id = sid(`page-${index}`);
      ids.push(id);
      seed(h, id, summaryDoc(id, { receivedAt: new Date(start + index * 60_000).toISOString() }));
    }
    const full = await list(h, 'inbox');
    expect(full.items).toHaveLength(SUMMARY_LIMITS.maxListItems);
    expect(full.hasMore).toBe(true);
    // The oldest one is the row left out.
    expect(full.items.map((item) => item.summaryId)).toEqual([...ids].reverse().slice(0, SUMMARY_LIMITS.maxListItems));
    expect(h.keyringCalls.count).toBe(1);

    h.fake.docs.delete(summaryDocPath(UID, ids[0] as string));
    const exact = await list(h, 'inbox');
    expect(exact.items).toHaveLength(SUMMARY_LIMITS.maxListItems);
    expect(exact.hasMore).toBe(false);
  });

  it('says hasMore when a bounded scan came back full', async () => {
    const h = harness({}, { tuning: { rematchMax: 0, scanLimit: 2, recentScanLimit: 2 } });
    seed(h, SUM_A, summaryDoc(SUM_A));
    seed(h, SUM_B, summaryDoc(SUM_B));
    expect((await list(h, 'inbox')).hasMore).toBe(true);
    seed(h, SUM_C, filedDoc(SUM_C, { receivedAt: '2026-11-01T10:00:00.000Z' }));
    // recent reads filed and kept summaries only: the newer inbox items never crowd it out (review S7).
    expect((await list(h, 'recent')).items.map((item) => item.summaryId)).toEqual([SUM_C]);
    seed(h, SUM_D, filedDoc(SUM_D, { receivedAt: '2026-11-02T10:00:00.000Z' }));
    expect((await list(h, 'recent')).hasMore).toBe(true);
  });

  it('reads the NEWEST rows when more exist than one scan reads, whatever their document ids (review S7)', async () => {
    const h = harness({}, { tuning: { rematchMax: 0, scanLimit: 3, recentScanLimit: 3 } });
    const start = Date.parse('2026-10-01T00:00:00.000Z');
    // Ids rise with age reversed: the newest summaries have the LAST ids, so an unordered read
    // (Firestore returns id order) would pick the oldest ones.
    const inbox: string[] = [];
    const filed: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      const at = new Date(start + index * 3_600_000).toISOString();
      const inboxId = `${'a'.repeat(62)}${index.toString(16).padStart(2, '0')}`;
      const filedId = `${'b'.repeat(62)}${index.toString(16).padStart(2, '0')}`;
      inbox.push(inboxId);
      filed.push(filedId);
      seed(h, inboxId, summaryDoc(inboxId, { receivedAt: at }));
      seed(h, filedId, filedDoc(filedId, { receivedAt: at }));
    }
    // And a later flood of inbox mail with ids before every filed one.
    for (let index = 0; index < 6; index += 1) {
      const floodId = `${'0'.repeat(62)}${index.toString(16).padStart(2, '0')}`;
      seed(h, floodId, summaryDoc(floodId, { receivedAt: new Date(start + (10 + index) * 3_600_000).toISOString() }));
    }
    const newestInbox = await list(h, 'inbox');
    expect(newestInbox.items.map((item) => item.summaryId)).toEqual([5, 4, 3].map((index) => `${'0'.repeat(62)}0${index}`));
    expect(newestInbox.hasMore).toBe(true);
    const recent = await list(h, 'recent');
    expect(recent.items.map((item) => item.summaryId)).toEqual([filed[5], filed[4], filed[3]]);
    expect(recent.hasMore).toBe(true);
  });

  it('declares the (status, receivedAt desc) composite index the ordered list queries need', () => {
    const indexes = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'firestore.indexes.json'), 'utf8')) as {
      indexes: { collectionGroup: string; queryScope: string; fields: { fieldPath: string; order?: string }[] }[];
    };
    expect(indexes.indexes).toContainEqual({
      collectionGroup: 'meetingSummaries',
      queryScope: 'COLLECTION',
      fields: [
        { fieldPath: 'status', order: 'ASCENDING' },
        { fieldPath: 'receivedAt', order: 'DESCENDING' },
      ],
    });
  });

  it('shows a row whose head does not open with title null, logging the reason and count only', async () => {
    const h = harness({}, { tuning: { rematchMax: 0 } });
    seed(h, SUM_A, summaryDoc(SUM_A, { receivedAt: '2026-11-10T16:00:00.000Z' }));
    // B carries A's head: the AAD names A, so it does not open under B.
    seed(h, SUM_B, summaryDoc(SUM_B, { receivedAt: '2026-11-11T16:00:00.000Z', sealedHead: summaryDoc(SUM_A).sealedHead }));
    const response = await list(h, 'inbox');
    expect(response.items.map((item) => [item.summaryId, item.title])).toEqual([
      [SUM_B, null],
      [SUM_A, TITLE_LINE],
    ]);
    expect(functionsLogger.warn).toHaveBeenCalledWith('summaries.read.head_unreadable', { uid: UID, view: 'inbox', count: 1, reasons: ['open_failed'] });
    expect(lastReadLine()).toMatchObject({ uid: UID, op: 'list', view: 'inbox', items: 2, headFailures: 1 });
  });

  it('answers upstream_error when the key itself does not parse, and raises a setup alarm with the reason only', async () => {
    const h = harness({}, { keyring: lazyKeyring(() => 'not-a-keyring') });
    seed(h, SUM_A, filedDoc(SUM_A));
    await expectReason(list(h, 'recent'), 'upstream_error');
    expect(functionsLogger.error).toHaveBeenCalledWith('summaries.setup_alarm', { reason: 'data_key_invalid', detail: 'keyring_malformed' });
    expect(functionsLogger.error).toHaveBeenCalledWith('summaries.read.failed', { uid: UID, op: 'list', view: 'recent', reason: 'keyring_malformed' });
    expect(allLogText()).not.toContain('not-a-keyring');
  });

  it('answers upstream_error on a Firestore failure, logging the error name only', async () => {
    const h = harness();
    (h.fake as unknown as { collection: () => never }).collection = () => {
      throw new RangeError('firestore down');
    };
    await expectReason(list(h, 'inbox'), 'upstream_error');
    expect(functionsLogger.error).toHaveBeenCalledWith('summaries.read.failed', { uid: UID, op: 'list', view: 'inbox', errorName: 'RangeError' });
  });
});

// ---------------------------------------------------------------------------------------------
// get
// ---------------------------------------------------------------------------------------------

describe('summaryRead get', () => {
  it('returns the full view of a filed summary: head, body, verbatim sections and the match', async () => {
    const h = harness();
    seed(h, SUM_A, filedDoc(SUM_A));
    const { summary } = await get(h, SUM_A);
    expect(summary).toMatchObject({
      summaryId: SUM_A,
      status: 'matched',
      title: TITLE_LINE,
      subject: SUBJECT,
      titleLine: TITLE_LINE,
      fromAddress: FROM_ADDRESS,
      forwardedBy: null,
      text: RECAP_TEXT,
      tier: 'vendor_verified',
      match: { meetingId: MEETING_ID, method: 'auto' },
      suggestions: [],
    });
    const expected = parseSections(RECAP_TEXT).sections;
    expect(summary.sections.map((section) => [section.kind, section.heading])).toEqual(expected.map((section) => [section.kind, section.heading]));
    const items = summary.sections.flatMap((section) => section.items);
    expect(items.map((item) => item.owner)).toEqual(['Bish', 'Dana']);
    for (const item of items) expect(summary.text.slice(item.start, item.end)).toBe(item.text);
    // The contract shape: the server-side section flags stay on the server.
    for (const section of summary.sections) expect(Object.keys(section).sort()).toEqual(['derived', 'end', 'heading', 'id', 'items', 'kind', 'start']);
    expect(JSON.stringify(summary)).not.toContain('sealed');
    expect(lastReadLine()).toEqual({ uid: UID, op: 'get', view: null, sections: expected.length });
  });

  it('shows who forwarded a user forward and the suggestions of an inbox item', async () => {
    const h = harness();
    seed(
      h,
      SUM_B,
      summaryDoc(
        SUM_B,
        {
          inboxReason: 'user_forwarded',
          trust: { tier: 'user_forwarded', recipientBound: false, fresh: false, anchorSource: 'forward_wrapper', originalInboxReason: 'user_forwarded' },
          vendorDomain: null,
          candidates: [storedCandidate(MEETING_ID, 0.6)],
        },
        { fromAddress: MAILBOX, forwardedBy: MAILBOX },
      ),
    );
    const { summary } = await get(h, SUM_B);
    expect(summary).toMatchObject({ status: 'inbox', tier: 'user_forwarded', fromAddress: MAILBOX, forwardedBy: MAILBOX, inboxReason: 'user_forwarded' });
    expect(summary.suggestions.map((s) => s.meetingId)).toEqual([MEETING_ID]);
  });

  it('answers not_found WITH details.reason for a missing, refused, foreign, reserved or unreadable summary', async () => {
    const h = harness();
    seed(h, 'refused-2026-11-12', refusedRow('2026-11-12', 2));
    seed(h, SUM_B, summaryDoc(SUM_B, {}, {}, OTHER_UID), OTHER_UID);
    const unreadable = { ...summaryDoc(SUM_C), schemaVersion: 'two' };
    seed(h, SUM_C, unreadable);
    for (const id of [SUM_A, 'refused-2026-11-12', SUM_B, '__summary__', SUM_C]) {
      const error = await expectReason(get(h, id), 'not_found');
      // The app reads not-found WITHOUT details as "summaryRead is not deployed"; this one has them.
      expect(error.code).toBe('not-found');
      expect(error.details).toEqual({ reason: 'not_found' });
    }
    expect(h.keyringCalls.count).toBe(0);
    expect(functionsLogger.info).toHaveBeenCalledWith('summaries.read.refused', { uid: UID, op: 'get', view: null, reason: 'not_found' });
  });

  it('maps every decrypt failure to upstream_error and logs only the SealedError reason', async () => {
    const h = harness();
    seed(h, SUM_A, filedDoc(SUM_A, { sealedBody: 'damaged-body-blob' }));
    seed(h, SUM_B, filedDoc(SUM_B, { sealedHead: summaryDoc(SUM_A).sealedHead }));
    seed(h, SUM_C, filedDoc(SUM_C, { sealedBody: summaryDoc(SUM_C).sealedHead }));
    await expectReason(get(h, SUM_A), 'upstream_error');
    expect(functionsLogger.error).toHaveBeenCalledWith('summaries.read.failed', { uid: UID, op: 'get', view: null, reason: 'blob_malformed' });
    await expectReason(get(h, SUM_B), 'upstream_error');
    // A head sealed for another summary, and a head stored as the body: neither opens.
    await expectReason(get(h, SUM_C), 'upstream_error');
    expect(functionsLogger.error).toHaveBeenCalledWith('summaries.read.failed', { uid: UID, op: 'get', view: null, reason: 'open_failed' });

    const wrongKey = harness({}, { keyring: () => OTHER_KEYRING });
    seed(wrongKey, SUM_A, filedDoc(SUM_A));
    await expectReason(get(wrongKey, SUM_A), 'upstream_error');

    const logs = allLogText();
    for (const secret of [SUBJECT, TITLE_LINE, 'Urpayroll', 'APK', FROM_ADDRESS, SUM_A, SUM_B, SUM_C, MEETING_ID]) expect(logs).not.toContain(secret);
  });
});

// ---------------------------------------------------------------------------------------------
// Inbox re-match
// ---------------------------------------------------------------------------------------------

describe('summaryRead inbox re-match', () => {
  it('files a row 7 summary once its meeting appears, exactly as summaryInbound would have', async () => {
    const h = harness();
    seed(h, SUM_A, summaryDoc(SUM_A));

    // No meeting yet: still no_candidate, nothing written.
    const before = await list(h, 'inbox');
    expect(before.items.map((item) => [item.summaryId, item.inboxReason])).toEqual([[SUM_A, 'no_candidate']]);
    expect(h.fake.writeLog()).toEqual([]);

    seedMeetings(h.fake);
    const after = await list(h, 'inbox');
    expect(after.items).toEqual([]);
    const doc = stored(h, SUM_A);
    expect(doc).toMatchObject({ status: 'matched', inboxReason: null, userAction: null, expiresAt: addDaysIso(RECEIVED_AT, 365), updatedAt: NOW.toISOString() });
    expect(doc.match).toMatchObject({
      meetingId: MEETING_ID,
      occurrenceDate: null,
      method: 'auto',
      matchedAt: NOW.toISOString(),
      meetingSnapshot: { title: 'Urpayroll weekly sync', startAt: '2026-11-10T14:00:00.000Z', endAt: '2026-11-10T15:00:00.000Z', timezone: 'UTC' },
    });
    expect(doc.match?.reasons).toContain('rule_a');
    expect(doc.candidates.map((candidate) => candidate.meetingId)).toEqual([MEETING_ID]);
    // The trust facts and the receipt reason never change.
    expect(doc.trust.originalInboxReason).toBe('no_candidate');
    expect(lastReadLine()).toMatchObject({ rematch: { considered: 1, filed: 1, refreshed: 0, unchanged: 0, conflicts: 0, failed: 0 } });

    const recent = await list(h, 'recent');
    expect(recent.items.map((item) => [item.summaryId, item.match?.meetingId])).toEqual([[SUM_A, MEETING_ID]]);
    expect((await list(h, 'meeting', MEETING_ID)).items.map((item) => item.summaryId)).toEqual([SUM_A]);

    // Filed: the next inbox list re-matches nothing and writes nothing.
    const writes = h.fake.writeLog().length;
    await list(h, 'inbox');
    expect(h.fake.writeLog()).toHaveLength(writes);
  });

  it('decides the same way as decide() on the stored inputs (the specimen scores)', () => {
    const record = decide({
      tier: 'vendor_verified',
      recipientBound: true,
      fresh: true,
      titleLine: TITLE_LINE,
      subjectClean: 'Urpayroll weekly sync',
      summaryDate: SUMMARY_DATE,
      anchor: { at: ANCHOR_AT, signed: true },
      text: RECAP_TEXT,
      preferencesTimeZone: 'UTC',
      rejectedMeetingIds: [],
      candidates: [
        {
          meetingId: MEETING_ID,
          occurrenceDate: null,
          title: 'Urpayroll weekly sync',
          startAt: '2026-11-10T14:00:00.000Z',
          endAt: '2026-11-10T15:00:00.000Z',
          timezone: 'UTC',
          allDay: false,
          cancelled: false,
          deleted: false,
          source: 'google',
          conferenceUrl: null,
        },
      ],
      now: NOW,
    });
    expect(record.status).toBe('matched');
    const doc = summaryDoc(SUM_A);
    expect(rematchPatch(doc, record, NOW)).toMatchObject({ status: 'matched', inboxReason: null, match: { meetingId: MEETING_ID, method: 'auto' } });
    // The same record never files a copy the user acted on, a rejected meeting, or a row 9 copy.
    expect(rematchPatch({ ...doc, userAction: { kind: 'detach', at: SEEDED_AT } }, record, NOW)).toMatchObject({ inboxReason: 'needs_confirmation' });
    expect(rematchPatch({ ...doc, rejectedMeetingIds: [MEETING_ID] }, record, NOW)).toEqual({ inboxReason: 'needs_confirmation', candidates: [], updatedAt: NOW.toISOString() });
    expect(rematchPatch({ ...doc, trust: { ...doc.trust, recipientBound: false } }, record, NOW)).toBeNull();
    expect(rematchPatch({ ...doc, status: 'kept' }, record, NOW)).toBeNull();
  });

  it('refreshes the suggestions of a user forward and an old recap, but never files them', async () => {
    const h = harness();
    seedMeetings(h.fake);
    seed(
      h,
      SUM_A,
      summaryDoc(SUM_A, {
        inboxReason: 'user_forwarded',
        trust: { tier: 'user_forwarded', recipientBound: true, fresh: true, anchorSource: 'forward_wrapper', originalInboxReason: 'user_forwarded' },
        vendorDomain: null,
      }),
    );
    seed(
      h,
      SUM_B,
      summaryDoc(SUM_B, {
        inboxReason: 'old_summary',
        trust: { tier: 'vendor_verified', recipientBound: true, fresh: false, anchorSource: 'signed_date', originalInboxReason: 'old_summary' },
      }),
    );
    const response = await list(h, 'inbox');
    expect(response.items.map((item) => [item.summaryId, item.status, item.inboxReason]).sort()).toEqual(
      [
        [SUM_A, 'inbox', 'user_forwarded'],
        [SUM_B, 'inbox', 'old_summary'],
      ].sort(),
    );
    for (const item of response.items) expect(item.suggestions.map((s) => s.meetingId)).toEqual([MEETING_ID]);
    for (const id of [SUM_A, SUM_B]) {
      const doc = stored(h, id);
      expect(doc.status).toBe('inbox');
      expect(doc.match).toBeNull();
      expect(doc.candidates.map((candidate) => candidate.meetingId)).toEqual([MEETING_ID]);
    }
    expect(lastReadLine()).toMatchObject({ rematch: { considered: 2, filed: 0, refreshed: 2 } });
  });

  it('never re-files a summary the user acted on, but refreshes its reason and suggestions', async () => {
    const h = harness();
    seedMeetings(h.fake);
    const userAction = { kind: 'detach' as const, at: '2026-11-11T09:00:00.000Z' };
    seed(h, SUM_A, summaryDoc(SUM_A, { inboxReason: 'weak', userAction, rejectedMeetingIds: ['mtgOldMeeting'] }));
    const response = await list(h, 'inbox');
    expect(response.items).toHaveLength(1);
    expect(response.items[0]).toMatchObject({ status: 'inbox', inboxReason: 'needs_confirmation' });
    expect(response.items[0]?.suggestions.map((s) => s.meetingId)).toEqual([MEETING_ID]);
    const doc = stored(h, SUM_A);
    expect(doc).toMatchObject({ status: 'inbox', match: null, userAction, rejectedMeetingIds: ['mtgOldMeeting'] });
  });

  it('never files or suggests a rejected meeting, nor its duplicate copy', async () => {
    const h = harness();
    seedMeetings(h.fake);
    // The phone calendar imported the same meeting again (same start, duration and title).
    h.fake.seed(`users/${UID}/meetings/${DEVICE_COPY_ID}`, {
      ...MEETING_COMMON,
      source: 'device',
      title: 'Urpayroll weekly sync',
      startAt: '2026-11-10T14:00:00.000Z',
      durationMinutes: 60,
    });
    seed(h, SUM_A, summaryDoc(SUM_A, { rejectedMeetingIds: [MEETING_ID] }));
    seed(h, SUM_B, summaryDoc(SUM_B, { rejectedMeetingIds: [DEVICE_COPY_ID] }));
    const response = await list(h, 'inbox');
    expect(response.items.map((item) => item.summaryId).sort()).toEqual([SUM_A, SUM_B].sort());
    for (const item of response.items) {
      expect(item.status).toBe('inbox');
      expect(item.suggestions).toEqual([]);
      expect(item.inboxReason).toBe('weak');
    }
    for (const id of [SUM_A, SUM_B]) expect(stored(h, id).candidates).toEqual([]);
  });

  it('leaves a row 9 item alone: no meeting read, no write, no suggestions', async () => {
    const h = harness();
    seedMeetings(h.fake);
    seed(
      h,
      SUM_A,
      summaryDoc(SUM_A, {
        inboxReason: 'not_addressed_to_you',
        trust: { tier: 'vendor_verified', recipientBound: false, fresh: true, anchorSource: 'signed_date', originalInboxReason: 'not_addressed_to_you' },
        candidates: [storedCandidate(MEETING_ID, 0.9)],
      }),
    );
    const response = await list(h, 'inbox');
    expect(response.items[0]).toMatchObject({ summaryId: SUM_A, status: 'inbox', inboxReason: 'not_addressed_to_you', suggestions: [] });
    expect(meetingQueries(h)).toEqual([]);
    expect(h.fake.writeLog()).toEqual([]);
    expect(lastReadLine()).toMatchObject({ rematch: { considered: 0 } });
    expect(summarySuggestionsOf(stored(h, SUM_A))).toEqual([]);
  });

  it('writes nothing when another device kept the summary meanwhile, and answers from the new state', async () => {
    const h = harness();
    seedMeetings(h.fake);
    const doc = summaryDoc(SUM_A);
    seed(h, SUM_A, doc);
    beforeFirstTransaction(h, () => {
      seed(h, SUM_A, { ...doc, status: 'kept', inboxReason: null, userAction: { kind: 'keep', at: NOW.toISOString() }, updatedAt: NOW.toISOString() });
    });
    const response = await list(h, 'inbox');
    expect(response.items).toEqual([]);
    expect(stored(h, SUM_A)).toMatchObject({ status: 'kept', match: null, userAction: { kind: 'keep' } });
    expect(h.fake.transactions).toHaveLength(1);
    expect(h.fake.transactions[0]).toMatchObject({ writes: [], committed: true });
    expect(lastReadLine()).toMatchObject({ rematch: { considered: 1, filed: 0, conflicts: 1 } });
  });

  it('re-reads the document in the transaction: a meeting rejected meanwhile is not filed, and the next list uses the new state', async () => {
    const h = harness();
    seedMeetings(h.fake);
    const doc = summaryDoc(SUM_A);
    seed(h, SUM_A, doc);
    beforeFirstTransaction(h, () => {
      seed(h, SUM_A, { ...doc, rejectedMeetingIds: [MEETING_ID], updatedAt: NOW.toISOString() });
    });
    const first = await list(h, 'inbox');
    expect(first.items.map((item) => item.status)).toEqual(['inbox']);
    expect(stored(h, SUM_A)).toMatchObject({ status: 'inbox', match: null, rejectedMeetingIds: [MEETING_ID] });

    const second = await list(h, 'inbox');
    expect(second.items[0]).toMatchObject({ status: 'inbox', inboxReason: 'weak', suggestions: [] });
    expect(stored(h, SUM_A).status).toBe('inbox');
  });

  it('skips a summary deleted meanwhile without failing the list', async () => {
    const h = harness();
    seedMeetings(h.fake);
    seed(h, SUM_A, summaryDoc(SUM_A));
    beforeFirstTransaction(h, () => {
      h.fake.docs.delete(summaryDocPath(UID, SUM_A));
    });
    expect((await list(h, 'inbox')).items).toEqual([]);
    expect(h.fake.has(summaryDocPath(UID, SUM_A))).toBe(false);
  });

  it('a failing item never fails the list: the others are still re-matched, the error name is logged', async () => {
    const calls: string[] = [];
    const failingReceipt = '2026-11-10T16:30:00.000Z';
    const h = harness({}, { candidates: recordingLoader(calls, (now) => now.toISOString() === failingReceipt) });
    seedMeetings(h.fake);
    seed(h, SUM_A, summaryDoc(SUM_A, { receivedAt: RECEIVED_AT }));
    seed(h, SUM_B, summaryDoc(SUM_B, { receivedAt: failingReceipt }));
    // C's head does not open (sealed for A): a SealedError on one item is logged by reason.
    seed(h, SUM_C, summaryDoc(SUM_C, { receivedAt: '2026-11-10T16:10:00.000Z', sealedHead: summaryDoc(SUM_A).sealedHead }));

    const response = await list(h, 'inbox');
    expect(response.items.map((item) => item.summaryId)).toEqual([SUM_B, SUM_C]);
    expect(stored(h, SUM_A).status).toBe('matched');
    expect(stored(h, SUM_B).status).toBe('inbox');
    expect(stored(h, SUM_C).status).toBe('inbox');
    expect(functionsLogger.warn).toHaveBeenCalledWith('summaries.read.rematch_failed', { uid: UID, stage: 'item', errorName: 'RangeError' });
    expect(functionsLogger.warn).toHaveBeenCalledWith('summaries.read.rematch_failed', { uid: UID, stage: 'item', reason: 'open_failed' });
    expect(lastReadLine()).toMatchObject({ rematch: { considered: 3, filed: 1, failed: 2 } });
  });

  it('a failed preferences read skips the re-match and still answers the list', async () => {
    const h = harness();
    seed(h, SUM_A, summaryDoc(SUM_A));
    const fake = h.fake as unknown as { getAll: (...args: unknown[]) => Promise<unknown> };
    fake.getAll = async () => {
      throw new RangeError('preferences down');
    };
    const response = await list(h, 'inbox');
    expect(response.items.map((item) => item.summaryId)).toEqual([SUM_A]);
    expect(functionsLogger.warn).toHaveBeenCalledWith('summaries.read.rematch_failed', { uid: UID, stage: 'preferences', errorName: 'RangeError' });
  });

  it('re-matches at most rematchMax of the newest eligible items (row 9 and undated items are not counted)', async () => {
    const calls: string[] = [];
    const h = harness({}, { candidates: recordingLoader(calls) });
    const start = Date.parse('2026-11-10T16:00:00.000Z');
    const receipts: string[] = [];
    for (let index = 0; index < 12; index += 1) {
      const receivedAt = new Date(start + index * 60_000).toISOString();
      receipts.push(receivedAt);
      const id = sid(`limit-${index}`);
      seed(h, id, summaryDoc(id, { receivedAt }));
    }
    // Newer than all of them: a row 9 item and an item with neither a date nor an anchor.
    seed(
      h,
      SUM_D,
      summaryDoc(SUM_D, {
        receivedAt: '2026-11-11T10:00:00.000Z',
        inboxReason: 'not_addressed_to_you',
        trust: { tier: 'vendor_verified', recipientBound: false, fresh: true, anchorSource: 'signed_date', originalInboxReason: 'not_addressed_to_you' },
      }),
    );
    seed(h, SUM_E, summaryDoc(SUM_E, { receivedAt: '2026-11-11T11:00:00.000Z', summaryDate: null, anchorAt: null, inboxReason: 'no_date' }));

    const response = await list(h, 'inbox');
    expect(response.items).toHaveLength(14);
    expect(SUMMARY_READ_TUNING.rematchMax).toBe(10);
    expect([...calls].sort()).toEqual([...receipts].reverse().slice(0, 10).sort());
    expect(lastReadLine()).toMatchObject({ rematch: { considered: 10, unchanged: 10 } });
  });

  it('bounds the candidates by the receipt time, never the current time', async () => {
    const calls: string[] = [];
    const h = harness({}, { candidates: recordingLoader(calls) });
    seedMeetings(h.fake);
    // Received at 12:00 with a signed Date that runs ahead (15:20): the 14:00 meeting had not begun.
    const receivedAt = '2026-11-10T12:00:00.000Z';
    seed(h, SUM_A, summaryDoc(SUM_A, { receivedAt }));
    const response = await list(h, 'inbox');
    expect(calls).toEqual([receivedAt]);
    expect(response.items.map((item) => item.status)).toEqual(['inbox']);
    expect(stored(h, SUM_A).status).toBe('inbox');
  });

  it('opens the text only when a candidate carries a conference link, for the link bonus', async () => {
    const plain = harness();
    seedMeetings(plain.fake);
    seed(plain, SUM_A, summaryDoc(SUM_A));
    await list(plain, 'inbox');
    expect(stored(plain, SUM_A).status).toBe('matched');
    expect(readsOutsideTransactions(plain, SUM_A)).toBe(0);

    const linked = harness();
    seedMeetings(linked.fake, { conference: { url: CONFERENCE_URL, password: 'never-read-123' } });
    seed(linked, SUM_A, summaryDoc(SUM_A, {}, { text: `${RECAP_TEXT}\n\nJoin: ${CONFERENCE_URL}` }));
    await list(linked, 'inbox');
    expect(readsOutsideTransactions(linked, SUM_A)).toBe(1);
    const doc = stored(linked, SUM_A);
    expect(doc.status).toBe('matched');
    expect(doc.match?.reasons).toContain('conference_link');
  });

  it('runs only for the inbox view', async () => {
    const calls: string[] = [];
    const h = harness({}, { candidates: recordingLoader(calls) });
    seedMeetings(h.fake);
    seed(h, SUM_A, summaryDoc(SUM_A));
    await list(h, 'recent');
    await list(h, 'refused');
    await list(h, 'meeting', MEETING_ID);
    await get(h, SUM_A);
    expect(calls).toEqual([]);
    expect(h.fake.writeLog()).toEqual([]);
    expect(stored(h, SUM_A).status).toBe('inbox');
  });

  it('answers upstream_error when the key does not parse, before any re-match write', async () => {
    const h = harness({}, { keyring: lazyKeyring(() => 'k1:short') });
    seedMeetings(h.fake);
    seed(h, SUM_A, summaryDoc(SUM_A));
    await expectReason(list(h, 'inbox'), 'upstream_error');
    expect(h.fake.writeLog()).toEqual([]);
    expect(stored(h, SUM_A).status).toBe('inbox');
  });
});

// ---------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------

describe('summary titles', () => {
  it('uses the title line, else the cleaned subject, cut to maxTitleChars; null when there is neither', () => {
    expect(summaryTitleOf({ subject: SUBJECT, titleLine: TITLE_LINE, dateLine: null })).toBe(TITLE_LINE);
    expect(summaryTitleOf({ subject: 'Re: Fwd: Meeting notes: Budget review', titleLine: null, dateLine: null })).toBe('Budget review');
    expect(summaryTitleOf({ subject: 'Fwd: Budget review', titleLine: '   ', dateLine: null })).toBe('Budget review');
    expect(summaryTitleOf({ subject: null, titleLine: null, dateLine: 'Oct 16, 2026' })).toBeNull();
    expect(summaryTitleOf({ subject: 'Fwd:', titleLine: null, dateLine: null })).toBeNull();
    expect(summaryTitleOf({ subject: null, titleLine: 'x'.repeat(SUMMARY_LIMITS.maxTitleChars), dateLine: null })).toHaveLength(SUMMARY_LIMITS.maxTitleChars);
  });

  it('lazyKeyring parses once per secret value and never caches a malformed one', () => {
    let secret = 'bad';
    let reads = 0;
    const keyring = lazyKeyring(() => {
      reads += 1;
      return secret;
    });
    expect(() => keyring()).toThrow(SealedError);
    expect(() => keyring()).toThrow(SealedError);
    secret = `k1:${Buffer.alloc(32, 7).toString('base64')}`;
    const first = keyring();
    expect(keyring()).toBe(first);
    expect(reads).toBe(4);
  });
});

// ---------------------------------------------------------------------------------------------
// M11 hand-off
// ---------------------------------------------------------------------------------------------

describe('loadSummaryForExtraction', () => {
  function extractionDeps(h: Harness, keyring: Keyring = KEYRING) {
    return { db: h.fake as unknown as Firestore, keyring: () => keyring };
  }

  it('returns a filed summary with its text, verbatim sections and the plain context', async () => {
    const h = harness();
    seed(h, SUM_A, filedDoc(SUM_A, { language: 'es' }));
    const result = await loadSummaryForExtraction(UID, SUM_A, extractionDeps(h));
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.summaryId).toBe(SUM_A);
    expect(result.status).toBe('matched');
    expect(result.text).toBe(RECAP_TEXT);
    expect(result.sections).toEqual(parseSections(RECAP_TEXT).sections);
    for (const item of result.sections.flatMap((section) => section.items)) expect(result.text.slice(item.start, item.end)).toBe(item.text);
    expect(result.context).toEqual({
      tier: 'vendor_verified',
      recipientBound: true,
      fresh: true,
      anchorSource: 'signed_date',
      originalInboxReason: null,
      senderDomain: 'notetaker.example',
      vendorDomain: 'notetaker.example',
      match: autoMatch(),
      meetingSnapshot: autoMatch().meetingSnapshot,
      summaryDate: SUMMARY_DATE,
      anchorAt: ANCHOR_AT,
      receivedAt: RECEIVED_AT,
      language: 'es',
      parserVersion: parseSections(RECAP_TEXT).parserVersion,
      possibleInstruction: false,
      truncated: false,
      textFromHtml: false,
    });
    // The head (subject, title line) is not part of the hand-off.
    expect(JSON.stringify(result)).not.toContain(SUBJECT);
    // M11 day 1 added the stamp, the stored extraction and the forwarding mailbox (additive).
    expect(Object.keys(result).sort()).toEqual(['contentDigest', 'context', 'extraction', 'forwardedBy', 'sections', 'status', 'summaryId', 'text']);
    expect(result.contentDigest).toBe(filedDoc(SUM_A).contentDigest);
    expect(result.extraction).toBeNull();
    expect(result.forwardedBy).toBeNull();
  });

  it('M11: carries the stored extraction as it is and the mailbox a user forward came from', async () => {
    const h = harness();
    const extraction = { v: 1, state: 'ready', counts: { open: 2, accepted: 1, dropped: 0 } };
    seed(
      h,
      SUM_A,
      filedDoc(
        SUM_A,
        {
          extraction,
          trust: { tier: 'user_forwarded', recipientBound: false, fresh: false, anchorSource: 'forward_wrapper', originalInboxReason: 'user_forwarded' },
        },
        { forwardedBy: MAILBOX, fromAddress: MAILBOX },
      ),
    );
    const result = await loadSummaryForExtraction(UID, SUM_A, extractionDeps(h));
    expect(result?.extraction).toEqual(extraction);
    expect(result?.forwardedBy).toBe(MAILBOX);
    expect(result?.context.tier).toBe('user_forwarded');
  });

  it('returns a kept summary without a match', async () => {
    const h = harness();
    seed(h, SUM_B, summaryDoc(SUM_B, { status: 'kept', inboxReason: null, userAction: { kind: 'keep', at: RECEIVED_AT } }));
    const result = await loadSummaryForExtraction(UID, SUM_B, extractionDeps(h));
    expect(result).toMatchObject({ status: 'kept', context: { match: null, meetingSnapshot: null } });
  });

  it('carries the reason a summary first waited in the inbox, and whether its text came from HTML (review P6)', async () => {
    const h = harness();
    // Filed by hand after it waited as needs_confirmation: M11 must still see why it waited.
    seed(
      h,
      SUM_A,
      filedDoc(SUM_A, {
        match: { ...autoMatch(), method: 'user' },
        trust: { tier: 'vendor_verified', recipientBound: true, fresh: true, anchorSource: 'signed_date', originalInboxReason: 'needs_confirmation' },
        userAction: { kind: 'attach', at: RECEIVED_AT },
        flags: { truncated: false, textCutForSize: false, itemTextFromOffsets: false, possibleInstruction: false, textFromHtml: true },
      }),
    );
    seed(h, SUM_B, summaryDoc(SUM_B, { status: 'kept', inboxReason: null, userAction: { kind: 'keep', at: RECEIVED_AT } }));
    const filed = await loadSummaryForExtraction(UID, SUM_A, extractionDeps(h));
    expect(filed?.context).toMatchObject({ originalInboxReason: 'needs_confirmation', textFromHtml: true, match: { method: 'user' } });
    const kept = await loadSummaryForExtraction(UID, SUM_B, extractionDeps(h));
    expect(kept?.context).toMatchObject({ originalInboxReason: 'no_candidate', textFromHtml: false });
  });

  it('returns null for an inbox item, a refused row, a missing, foreign or unreadable summary, and unusable ids', async () => {
    const h = harness();
    seed(h, SUM_A, summaryDoc(SUM_A));
    seed(h, 'refused-2026-11-12', refusedRow('2026-11-12', 1));
    seed(h, SUM_B, filedDoc(SUM_B), OTHER_UID);
    seed(h, SUM_C, { ...filedDoc(SUM_C), status: 'archived' });
    const deps = extractionDeps(h);
    expect(await loadSummaryForExtraction(UID, SUM_A, deps)).toBeNull();
    expect(await loadSummaryForExtraction(UID, 'refused-2026-11-12', deps)).toBeNull();
    expect(await loadSummaryForExtraction(UID, SUM_D, deps)).toBeNull();
    expect(await loadSummaryForExtraction(UID, SUM_B, deps)).toBeNull();
    expect(await loadSummaryForExtraction(UID, SUM_C, deps)).toBeNull();
    for (const [uid, id] of [
      ['uid/with/slash', SUM_A],
      ['', SUM_A],
      [UID, '__summary__'],
      [UID, 'a/b'],
      [UID, ''],
    ] as const) {
      expect(await loadSummaryForExtraction(uid, id, deps)).toBeNull();
    }
  });

  it('throws SealedError when the body does not open (the caller maps it to upstream_error)', async () => {
    const h = harness();
    seed(h, SUM_A, filedDoc(SUM_A));
    await expect(loadSummaryForExtraction(UID, SUM_A, extractionDeps(h, OTHER_KEYRING))).rejects.toBeInstanceOf(SealedError);
    seed(h, SUM_B, filedDoc(SUM_B, { sealedBody: summaryDoc(SUM_A).sealedBody }));
    await expect(loadSummaryForExtraction(UID, SUM_B, extractionDeps(h))).rejects.toBeInstanceOf(SealedError);
  });
});

// ---------------------------------------------------------------------------------------------
// M11: suggested-task counts on list rows
// ---------------------------------------------------------------------------------------------

describe('summaryRead rows: M11 suggested-task counts', () => {
  function extractionFor(doc: StoredSummaryDoc, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      v: 1,
      key: 'x_0123456789abcdef',
      state: 'ready',
      contentDigest: doc.contentDigest,
      parserVersion: SECTIONS_PARSER_VERSION,
      extractorVersion: EXTRACTOR_VERSION,
      counts: { open: 2, accepted: 1, dropped: 0 },
      sealed: 'v1.k1.sealed-titles-never-listed',
      ...overrides,
    };
  }

  it('shows {state, open, accepted} on filed and kept rows, stale when the content or the extractor changed', async () => {
    const h = harness();
    const a = filedDoc(SUM_A);
    seed(h, SUM_A, { ...a, extraction: extractionFor(a) });
    const b = filedDoc(SUM_B, { receivedAt: '2026-11-09T10:00:00.000Z' });
    seed(h, SUM_B, { ...b, extraction: extractionFor(b, { contentDigest: 'f'.repeat(64) }) });
    const c = summaryDoc(SUM_C, { status: 'kept', inboxReason: null, userAction: { kind: 'keep', at: RECEIVED_AT }, receivedAt: '2026-11-08T10:00:00.000Z' });
    seed(h, SUM_C, { ...c, extraction: extractionFor(c, { extractorVersion: EXTRACTOR_VERSION + 1, state: 'empty' }) });
    seed(h, SUM_D, filedDoc(SUM_D, { receivedAt: '2026-11-07T10:00:00.000Z' }));

    const response = await list(h, 'recent');
    const byId = new Map(response.items.map((item) => [item.summaryId, item]));
    expect(byId.get(SUM_A)?.commitments).toEqual({ state: 'ready', open: 2, accepted: 1 });
    expect(byId.get(SUM_B)?.commitments).toEqual({ state: 'stale', open: 2, accepted: 1 });
    expect(byId.get(SUM_C)?.commitments).toEqual({ state: 'stale', open: 2, accepted: 1 });
    expect(byId.get(SUM_D)).toBeDefined();
    expect(byId.get(SUM_D) !== undefined && 'commitments' in (byId.get(SUM_D) as object)).toBe(false);
    // The list never reads the sealed titles.
    expect(JSON.stringify(response)).not.toContain('sealed-titles-never-listed');
    expect(SUMMARY_LIST_FIELDS).not.toContain('extraction');
    expect(SUMMARY_LIST_FIELDS.filter((field) => field.startsWith('extraction.'))).not.toContain('extraction.sealed');
  });

  it('never shows counts on an inbox row (it cannot be reviewed) or for an extraction this version cannot read', async () => {
    const h = harness();
    const a = summaryDoc(SUM_A);
    seed(h, SUM_A, { ...a, extraction: extractionFor(a) });
    const b = filedDoc(SUM_B);
    seed(h, SUM_B, { ...b, extraction: { v: 2, state: 'ready' } });
    const inbox = await list(h, 'inbox');
    expect(inbox.items.map((item) => item.commitments)).toEqual([undefined]);
    const recent = await list(h, 'recent');
    expect(recent.items.map((item) => item.commitments)).toEqual([undefined]);
  });

  it('get carries the same counts', async () => {
    const h = harness();
    const a = filedDoc(SUM_A);
    seed(h, SUM_A, { ...a, extraction: extractionFor(a, { counts: { open: 0, accepted: 3, dropped: 1 } }) });
    const response = await get(h, SUM_A);
    expect(response.summary.commitments).toEqual({ state: 'ready', open: 0, accepted: 3 });
  });
});

// ---------------------------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------------------------

describe('summaryRead logs', () => {
  it('logs counts and codes only: no title, subject, text, address, summary id or meeting id', async () => {
    const h = harness();
    seed(h, SUM_A, summaryDoc(SUM_A));
    seed(h, SUM_B, filedDoc(SUM_B, { receivedAt: '2026-11-09T10:00:00.000Z' }));
    seed(h, SUM_C, summaryDoc(SUM_C, { receivedAt: '2026-11-10T17:00:00.000Z', sealedHead: summaryDoc(SUM_A).sealedHead }));
    seed(h, 'refused-2026-11-12', refusedRow('2026-11-12', 2));
    await list(h, 'inbox');
    seedMeetings(h.fake, { conference: { url: CONFERENCE_URL } });
    await list(h, 'inbox');
    await list(h, 'recent');
    await list(h, 'refused');
    await list(h, 'meeting', MEETING_ID);
    await get(h, SUM_B);
    await expectReason(get(h, SUM_D), 'not_found');

    const logs = allLogText();
    expect(logs).toContain('summaries.read');
    expect(logs).toContain(UID);
    for (const secret of [
      SUBJECT,
      TITLE_LINE,
      'Urpayroll',
      'Marketing',
      'APK',
      'Bish',
      FROM_ADDRESS,
      MAILBOX,
      CONFERENCE_URL,
      SUM_A,
      SUM_B,
      SUM_C,
      SUM_D,
      MEETING_ID,
      OTHER_MEETING_ID,
      'refused-2026-11-12',
    ]) {
      expect(logs).not.toContain(secret);
    }
  });
});

