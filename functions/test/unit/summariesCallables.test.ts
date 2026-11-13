/**
 * summaryStatus and summaryAction (functions/src/summaries/callables.ts and actions.ts;
 * docs/v2/M10-DESIGN.md section 3, section 4 Callables, sections 6, 7 and 9). Firestore is the
 * in-memory fake in summariesFakeFirestore.ts, with a WriteBatch added here for the bulk delete.
 * The logger is mocked so every log line can be checked for content. All data is synthetic.
 */
jest.mock('firebase-functions/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

import * as functionsLogger from 'firebase-functions/logger';
import { HttpsError } from 'firebase-functions/https';
import type { Firestore } from 'firebase-admin/firestore';

import {
  SUMMARY_ERROR_CODES,
  SUMMARY_ERROR_HTTPS_CODES,
  SUMMARY_LIMITS,
  summaryActionResponseSchema,
  summaryErrorDetailsSchema,
  summaryStatusResponseSchema,
  timeZoneSchema,
  type SummaryActionResponse,
  type SummaryErrorCode,
} from '../../src/shared/aiContract';
import { parseKeyring, type Keyring } from '../../src/shared/sealed';
import { isValidTimeZone } from '../../src/shared/time';
import { SUMMARY_ADDRESSES_COLLECTION, SUMMARY_USERS_COLLECTION, tokenHash } from '../../src/summaries/address';
import {
  ATTACH_MEETING_FIELDS,
  SUMMARY_BULK_DELETE_LIMITS,
  deleteAllSummaries,
  detachInboxReason,
  resolveAttachTarget,
  summaryStateOf,
  withRejectedMeeting,
} from '../../src/summaries/actions';
import {
  emptySummaryStatus,
  handleSummaryAction,
  handleSummaryStatus,
  refusedTodayOf,
  summaryCallerOf,
  summaryError,
  verifiedEmailOf,
  type SummaryCallableAuth,
  type SummaryCallableConfig,
  type SummaryCallableDeps,
} from '../../src/summaries/callables';
import {
  MAX_REJECTED_MEETING_IDS,
  SUMMARY_SCHEMA_VERSION,
  addDaysIso,
  deletionMarkerKey,
  digestMarkerKey,
  sealSummaryContent,
  storedSummarySchema,
  summaryDocPath,
  summaryEventPath,
  type StoredCandidate,
  type StoredMatch,
  type StoredSummaryDoc,
} from '../../src/summaries/model';
import { recordRefusal } from '../../src/summaries/store';
import { FakeFirestore, type FakeDocumentReference } from './summariesFakeFirestore';

// ---------------------------------------------------------------------------------------------
// Fake with a WriteBatch (deleteAllSummaries uses db.batch(), like deleteAccount and maintenance)
// ---------------------------------------------------------------------------------------------

class BatchFakeFirestore extends FakeFirestore {
  /** Deletes per committed batch, in order. */
  readonly batchSizes: number[] = [];

  batch(): { delete(ref: FakeDocumentReference): unknown; commit(): Promise<void> } {
    const writes: { kind: 'delete'; path: string }[] = [];
    return {
      delete: (ref: FakeDocumentReference) => {
        writes.push({ kind: 'delete', path: ref.path });
      },
      commit: async () => {
        this.batchSizes.push(writes.length);
        this.commitWrites(writes);
      },
    };
  }
}

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

const NOW = new Date('2026-11-12T10:00:00.000Z');
const UID = 'uidPilotDana01';
const OUTSIDER = 'uidOutsider02';
const EMAIL = 'Dana@Company.Example';
const MAILBOX = 'dana@company.example';
const TEMPLATE = '{token}@summaries.meetingguard.example';
const ADDRESS_DOMAIN = 'summaries.meetingguard.example';
const KEYRING: Keyring = parseKeyring(`k1:${Buffer.alloc(32, 9).toString('base64')}`);
const RECEIVED_AT = '2026-10-16T15:25:00.000Z';
const ZONE = 'America/Mexico_City';

/** Sealed content of every seeded summary: none of it may ever reach a response or a log. */
const SECRET_SUBJECT = 'Quarterly zebra recap';
const SECRET_TITLE_LINE = 'Zebra crossing retrospective';
const SECRET_TEXT = 'Zebra crossing retrospective\nAction items\n- Confidential zebra budget (owner: Lee)';
const SECRET_FROM = 'recaps@notetaker.example';

const SUM_A = 'a1'.repeat(32);
const SUM_B = 'b2'.repeat(32);
const SUM_C = 'c3'.repeat(32);
const REFUSED_ID = 'refused-2026-11-12';

const MEETING_ATLAS = 'meet-atlas';
const MEETING_OTHER = 'meet-other';
const MEETING_STANDUP = 'meet-standup';
const MEETING_GONE = 'meet-gone';

function verifiedAuth(uid: string = UID, email: string = EMAIL): SummaryCallableAuth {
  return { uid, token: { email, email_verified: true, firebase: { sign_in_provider: 'password' } } };
}

function unverifiedAuth(uid: string = UID): SummaryCallableAuth {
  return { uid, token: { email: EMAIL, email_verified: false, firebase: { sign_in_provider: 'password' } } };
}

function appleAuth(uid: string = UID, email: string = EMAIL): SummaryCallableAuth {
  return { uid, token: { email, email_verified: false, firebase: { sign_in_provider: 'apple.com' } } };
}

interface Harness {
  fake: BatchFakeFirestore;
  deps: SummaryCallableDeps;
  setNow(date: Date): void;
}

function harness(config: Partial<SummaryCallableConfig> = {}, extra: Partial<SummaryCallableDeps> = {}): Harness {
  const fake = new BatchFakeFirestore();
  let clock = NOW;
  const deps: SummaryCallableDeps = {
    db: fake as unknown as Firestore,
    now: () => clock,
    config: { enabled: true, pilotUids: `${UID}, someoneElse`, template: TEMPLATE, ...config },
    ...extra,
  };
  return {
    fake,
    deps,
    setNow(date: Date) {
      clock = date;
    },
  };
}

function act(h: Harness, data: unknown, auth: SummaryCallableAuth = verifiedAuth()): Promise<SummaryActionResponse> {
  return handleSummaryAction(auth, data, h.deps);
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

function candidate(meetingId: string, score: number, duplicateMeetingIds: string[] = []): StoredCandidate {
  return {
    meetingId,
    occurrenceDate: null,
    duplicateMeetingIds,
    title: meetingId === MEETING_ATLAS ? 'Atlas launch sync' : 'Marketing review',
    startAt: '2026-10-16T14:00:00.000Z',
    endAt: '2026-10-16T15:00:00.000Z',
    timezone: ZONE,
    score,
    titleScore: 0.6,
    timeScore: 1,
    reasons: ['title_shared_word'],
    zoneUsed: 'meeting',
    cancelled: false,
    allDay: false,
  };
}

const AUTO_MATCH: StoredMatch = {
  meetingId: MEETING_ATLAS,
  occurrenceDate: null,
  duplicateMeetingIds: [],
  method: 'auto',
  score: 0.74,
  titleScore: 0.6,
  timeScore: 1,
  reasons: ['title_shared_word', 'rule_a'],
  zoneUsed: 'meeting',
  matchedAt: RECEIVED_AT,
  meetingSnapshot: { title: 'Atlas launch sync', startAt: '2026-10-16T14:00:00.000Z', endAt: '2026-10-16T15:00:00.000Z', timezone: ZONE },
};

function storedDoc(summaryId: string, overrides: Partial<StoredSummaryDoc> = {}): StoredSummaryDoc {
  const sealed = sealSummaryContent(
    KEYRING,
    { uid: UID, summaryId },
    {
      head: { subject: SECRET_SUBJECT, titleLine: SECRET_TITLE_LINE, dateLine: 'Oct 16, 2026' },
      body: { fromAddress: SECRET_FROM, fromName: 'Zebra Notes', forwardedBy: null, text: SECRET_TEXT, sections: [] },
    },
  );
  return storedSummarySchema.parse({
    schemaVersion: SUMMARY_SCHEMA_VERSION,
    parserVersion: 1,
    status: 'inbox',
    inboxReason: 'needs_confirmation',
    refusedReason: null,
    trust: { tier: 'vendor_verified', recipientBound: true, fresh: true, anchorSource: 'signed_date', originalInboxReason: 'needs_confirmation' },
    senderDomain: 'notetaker.example',
    vendorDomain: 'notetaker.example',
    auth: {
      dkim: [{ domain: 'notetaker.example', result: 'pass', aligned: true, signsTo: true, signsDate: true }],
      arc: { result: 'none', sealer: null },
      verifier: 'mailauth@8.0.4',
    },
    receivedAt: RECEIVED_AT,
    sentAt: '2026-10-16T15:20:00.000Z',
    anchorAt: '2026-10-16T15:20:00.000Z',
    summaryDate: '2026-10-16',
    language: 'en',
    match: null,
    candidates: [candidate(MEETING_ATLAS, 0.74), candidate(MEETING_OTHER, 0.47)],
    rejectedMeetingIds: [],
    counts: { sections: 0, items: 0, textChars: SECRET_TEXT.length },
    flags: { truncated: false, textCutForSize: false, itemTextFromOffsets: false, possibleInstruction: false },
    contentDigest: 'd'.repeat(64),
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

function matchedDoc(summaryId: string, overrides: Partial<StoredSummaryDoc> = {}): StoredSummaryDoc {
  return storedDoc(summaryId, {
    status: 'matched',
    inboxReason: null,
    match: AUTO_MATCH,
    trust: { tier: 'vendor_verified', recipientBound: true, fresh: true, anchorSource: 'signed_date', originalInboxReason: null },
    expiresAt: addDaysIso(RECEIVED_AT, 365),
    ...overrides,
  });
}

const REFUSED_ROW = {
  status: 'refused',
  refusedReason: 'not_from_your_notetaker',
  senderDomain: null,
  firstAt: '2026-11-12T08:00:00.000Z',
  lastAt: '2026-11-12T09:00:00.000Z',
  count: 2,
  expiresAt: '2026-12-12T09:00:00.000Z',
  schemaVersion: 1,
};

function seedSummary(h: Harness, summaryId: string, doc: StoredSummaryDoc | Record<string, unknown>, uid: string = UID): void {
  h.fake.seed(summaryDocPath(uid, summaryId), doc as Record<string, unknown>);
}

function storedAt(h: Harness, summaryId: string, uid: string = UID): StoredSummaryDoc {
  return storedSummarySchema.parse(h.fake.data(summaryDocPath(uid, summaryId)));
}

function meetingPath(meetingId: string, uid: string = UID): string {
  return `users/${uid}/meetings/${meetingId}`;
}

const ONE_OFF_MEETING = {
  title: 'Atlas launch sync',
  description: 'Private agenda that never leaves Firestore',
  startAt: '2026-10-16T14:00:00.000Z',
  durationMinutes: 60,
  timezone: ZONE,
  allDay: false,
  date: '2026-10-16',
  time: '08:00',
  status: 'scheduled',
  source: 'google',
  notes: 'Private meeting notes',
  participants: [{ email: 'lee@company.example', name: 'Lee' }],
  recurrence: null,
  recurrenceOverrides: null,
  deletedAt: null,
};

/** Weekly on Mondays at 09:00 Mexico City (15:00Z) from Monday 2026-10-05. */
const SERIES_MEETING = {
  ...ONE_OFF_MEETING,
  title: 'Team standup',
  startAt: '2026-10-05T15:00:00.000Z',
  durationMinutes: 30,
  date: '2026-10-05',
  time: '09:00',
  recurrence: { freq: 'weekly', interval: 1, byWeekday: ['MO'], byMonthDay: null, until: null, count: null },
  recurrenceOverrides: {
    '2026-10-12': { status: 'cancelled', startAt: null, durationMinutes: null, title: null },
    '2026-10-26': { status: 'modified', startAt: '2026-10-27T16:00:00.000Z', durationMinutes: 45, title: 'Standup moved' },
  },
};

function seedMeetings(h: Harness): void {
  h.fake.seed(meetingPath(MEETING_ATLAS), ONE_OFF_MEETING);
  h.fake.seed(meetingPath(MEETING_OTHER), { ...ONE_OFF_MEETING, title: 'Marketing review', startAt: '2026-10-16T16:00:00.000Z', durationMinutes: 30 });
  h.fake.seed(meetingPath(MEETING_STANDUP), SERIES_MEETING);
  h.fake.seed(meetingPath(MEETING_GONE), { ...ONE_OFF_MEETING, deletedAt: '2026-11-01T00:00:00.000Z' });
}

async function createAddressFor(h: Harness, auth: SummaryCallableAuth = verifiedAuth()): Promise<SummaryActionResponse> {
  return act(h, { op: 'create_address' }, auth);
}

function userDoc(h: Harness, uid: string = UID): Record<string, unknown> {
  return h.fake.data(`${SUMMARY_USERS_COLLECTION}/${uid}`) ?? {};
}

function patchUser(h: Harness, fields: Record<string, unknown>, uid: string = UID): void {
  const path = `${SUMMARY_USERS_COLLECTION}/${uid}`;
  h.fake.seed(path, { ...(h.fake.data(path) ?? {}), ...fields });
}

function writesOf(h: Harness): string[] {
  return h.fake.writeLog();
}

/** Every argument of every logger call, as one JSON string. */
function allLogText(): string {
  const calls = [
    ...(functionsLogger.debug as jest.Mock).mock.calls,
    ...(functionsLogger.info as jest.Mock).mock.calls,
    ...(functionsLogger.warn as jest.Mock).mock.calls,
    ...(functionsLogger.error as jest.Mock).mock.calls,
  ];
  return JSON.stringify(calls);
}

// ---------------------------------------------------------------------------------------------
// Errors and caller
// ---------------------------------------------------------------------------------------------

describe('summaryError', () => {
  it('uses the contract HTTPS code for every reason and puts the reason in details', () => {
    for (const reason of SUMMARY_ERROR_CODES) {
      const error = summaryError(reason, 'Some message.');
      expect(error).toBeInstanceOf(HttpsError);
      expect(error.code).toBe(SUMMARY_ERROR_HTTPS_CODES[reason]);
      expect(summaryErrorDetailsSchema.parse(error.details)).toEqual({ reason });
    }
  });
});

describe('summaryCallerOf and verifiedEmailOf', () => {
  it('reads uid, email, email_verified and the sign-in provider', () => {
    expect(summaryCallerOf(undefined)).toBeNull();
    expect(summaryCallerOf(null)).toBeNull();
    expect(summaryCallerOf(verifiedAuth())).toEqual({ uid: UID, email: EMAIL, emailVerified: true, signInProvider: 'password' });
    expect(summaryCallerOf({ uid: UID, token: {} })).toEqual({ uid: UID, email: null, emailVerified: false, signInProvider: null });
  });

  it('offers the email as the first mailbox only for a verified caller', () => {
    expect(verifiedEmailOf(summaryCallerOf(verifiedAuth()) as NonNullable<ReturnType<typeof summaryCallerOf>>)).toBe(EMAIL);
    expect(verifiedEmailOf(summaryCallerOf(appleAuth()) as NonNullable<ReturnType<typeof summaryCallerOf>>)).toBe(EMAIL);
    expect(verifiedEmailOf(summaryCallerOf(unverifiedAuth()) as NonNullable<ReturnType<typeof summaryCallerOf>>)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// summaryStatus
// ---------------------------------------------------------------------------------------------

describe('summaryStatus', () => {
  it('answers unauthenticated to a signed-out caller, even while switched off', async () => {
    await expectReason(handleSummaryStatus(undefined, {}, harness().deps), 'unauthenticated');
    await expectReason(handleSummaryStatus(undefined, {}, harness({ enabled: false }).deps), 'unauthenticated');
  });

  it('answers invalid_request when the request is not an object', async () => {
    await expectReason(handleSummaryStatus(verifiedAuth(), 'hello', harness().deps), 'invalid_request');
  });

  it('answers enabled false with the empty status and no read while SUMMARIES_ENABLED is off', async () => {
    const h = harness({ enabled: false });
    const status = await handleSummaryStatus(verifiedAuth(), {}, h.deps);
    expect(status).toEqual(emptySummaryStatus(false));
    expect(summaryStatusResponseSchema.parse(status)).toEqual(status);
    expect(h.fake.log).toEqual([]);
  });

  it('answers allowed false with no read for a caller outside the pilot list', async () => {
    const h = harness();
    const status = await handleSummaryStatus(verifiedAuth(OUTSIDER), undefined, h.deps);
    expect(status).toEqual(emptySummaryStatus(true));
    expect(status.enabled).toBe(true);
    expect(h.fake.log).toEqual([]);
  });

  it('answers allowed false with no read for an unverified pilot caller', async () => {
    const h = harness();
    const status = await handleSummaryStatus(unverifiedAuth(), {}, h.deps);
    expect(status).toEqual(emptySummaryStatus(true));
    expect(h.fake.log).toEqual([]);
  });

  it('allows a caller verified by a trusted sign-in provider', async () => {
    const h = harness();
    const status = await handleSummaryStatus(appleAuth(), {}, h.deps);
    expect(status.allowed).toBe(true);
    expect(status.ready).toBe(true);
    expect(status.address).toBeNull();
  });

  it('answers ready false and no address while the template is empty', async () => {
    const h = harness();
    await createAddressFor(h);
    h.deps.config.template = '';
    const status = await handleSummaryStatus(verifiedAuth(), {}, h.deps);
    expect(status).toMatchObject({ enabled: true, allowed: true, ready: false, address: null, mailboxes: [MAILBOX] });
  });

  it('returns the address, mailboxes, unexpired Gmail requests, inbox count and last events', async () => {
    const h = harness();
    await createAddressFor(h);
    patchUser(h, {
      gmailRequests: [
        { gmailAddress: 'old@gmail.example', code: '111111', receivedAt: '2026-11-09T10:00:00.000Z' },
        { gmailAddress: 'dana@gmail.example', code: '222222', receivedAt: '2026-11-12T09:00:00.000Z' },
        { gmailAddress: 'lee@gmail.example', code: '333333', receivedAt: '2026-11-11T09:00:00.000Z' },
        { gmailAddress: 'not an address', code: '444444', receivedAt: '2026-11-12T09:30:00.000Z' },
      ],
      lastReceivedAt: '2026-11-12T08:00:00.000Z',
      lastRefused: { reason: 'sender_not_verified', at: '2026-11-12T07:00:00.000Z', senderDomain: null },
    });
    seedSummary(h, SUM_A, storedDoc(SUM_A));
    seedSummary(h, SUM_B, storedDoc(SUM_B));
    seedSummary(h, SUM_C, matchedDoc(SUM_C));
    seedSummary(h, REFUSED_ID, REFUSED_ROW);

    const status = await handleSummaryStatus(verifiedAuth(), {}, h.deps);
    expect(summaryStatusResponseSchema.parse(status)).toEqual(status);
    const token = userDoc(h).token as string;
    expect(status).toEqual({
      enabled: true,
      allowed: true,
      ready: true,
      address: `${token}@${ADDRESS_DOMAIN}`,
      mailboxes: [MAILBOX],
      gmailRequests: [
        { gmailAddress: 'dana@gmail.example', code: '222222', receivedAt: '2026-11-12T09:00:00.000Z' },
        { gmailAddress: 'lee@gmail.example', code: '333333', receivedAt: '2026-11-11T09:00:00.000Z' },
      ],
      inboxCount: 2,
      lastReceivedAt: '2026-11-12T08:00:00.000Z',
      lastRefused: { reason: 'sender_not_verified', at: '2026-11-12T07:00:00.000Z', senderDomain: null },
      refusedToday: null,
      addressCreatedAt: NOW.toISOString(),
    });
  });

  it('M11: addressCreatedAt is the current address document\'s creation time (B8)', async () => {
    const h = harness();
    // No address yet: null, and no index read.
    expect((await handleSummaryStatus(verifiedAuth(), {}, h.deps)).addressCreatedAt).toBeNull();
    await createAddressFor(h);
    expect((await handleSummaryStatus(verifiedAuth(), {}, h.deps)).addressCreatedAt).toBe(NOW.toISOString());

    // "Get a new address" a day later: the new address has its own time.
    const later = new Date('2026-11-13T09:30:00.000Z');
    h.setNow(later);
    await act(h, { op: 'regenerate_address' });
    const rotated = await handleSummaryStatus(verifiedAuth(), {}, h.deps);
    expect(rotated.addressCreatedAt).toBe(later.toISOString());
    expect(summaryStatusResponseSchema.parse(rotated)).toEqual(rotated);
    // summaryAction answers carry the same status.
    expect((await act(h, { op: 'set_mailboxes', mailboxes: [MAILBOX] })).status.addressCreatedAt).toBe(later.toISOString());

    // An index document that is missing, names another uid or holds no timestamp: null.
    const hash = userDoc(h).tokenHash as string;
    const indexPath = `${SUMMARY_ADDRESSES_COLLECTION}/${hash}`;
    h.fake.seed(indexPath, { uid: UID, createdAt: 'yesterday' });
    expect((await handleSummaryStatus(verifiedAuth(), {}, h.deps)).addressCreatedAt).toBeNull();
    h.fake.seed(indexPath, { uid: OUTSIDER, createdAt: later.toISOString() });
    expect((await handleSummaryStatus(verifiedAuth(), {}, h.deps)).addressCreatedAt).toBeNull();

    // Not ready (no template): no address shown, so no time either.
    h.fake.seed(indexPath, { uid: UID, createdAt: later.toISOString() });
    h.deps.config.template = '';
    expect((await handleSummaryStatus(verifiedAuth(), {}, h.deps)).addressCreatedAt).toBeNull();
  });

  it('M11: an unreadable address document never fails the status (addressCreatedAt null, error name logged)', async () => {
    const h = harness();
    await createAddressFor(h);
    const indexPath = `${SUMMARY_ADDRESSES_COLLECTION}/${userDoc(h).tokenHash as string}`;
    const original = h.fake.doc.bind(h.fake);
    jest.spyOn(h.fake, 'doc').mockImplementation((path: string) => {
      const ref = original(path);
      if (path === indexPath) ref.get = () => Promise.reject(new Error('index read failed: zebra'));
      return ref;
    });
    const status = await handleSummaryStatus(verifiedAuth(), {}, h.deps);
    expect(status.address).not.toBeNull();
    expect(status.addressCreatedAt).toBeNull();
    expect(functionsLogger.warn).toHaveBeenCalledWith('summaries.status.address_age_unread', { uid: UID, errorName: 'Error' });
    expect(allLogText()).not.toContain('zebra');
  });

  it('reports today\'s refusal counter, and capped once the daily cap is reached (design step 9)', async () => {
    const h = harness();
    await createAddressFor(h);
    patchUser(h, { refusedDay: '2026-11-12', refusedCount: 3 });
    const some = await handleSummaryStatus(verifiedAuth(), {}, h.deps);
    expect(some.refusedToday).toEqual({ day: '2026-11-12', count: 3, capped: false });
    expect(summaryStatusResponseSchema.parse(some)).toEqual(some);

    patchUser(h, { refusedCount: SUMMARY_LIMITS.maxRefusalsPerDay });
    expect((await handleSummaryStatus(verifiedAuth(), {}, h.deps)).refusedToday).toEqual({
      day: '2026-11-12',
      count: SUMMARY_LIMITS.maxRefusalsPerDay,
      capped: true,
    });

    // Another UTC day: the counter is yesterday's, so nothing is reported.
    h.setNow(new Date('2026-11-13T00:00:01.000Z'));
    expect((await handleSummaryStatus(verifiedAuth(), {}, h.deps)).refusedToday).toBeNull();
  });

  it('refusedToday is null without refusals, and agrees with the store cap end to end', async () => {
    const h = harness();
    await createAddressFor(h);
    expect((await handleSummaryStatus(verifiedAuth(), {}, h.deps)).refusedToday).toBeNull();
    patchUser(h, { refusedDay: '2026-11-12', refusedCount: 0 });
    expect((await handleSummaryStatus(verifiedAuth(), {}, h.deps)).refusedToday).toBeNull();

    h.fake.seed(`users/${UID}`, { createdAt: '2026-09-01T00:00:00.000Z' });
    const db = h.deps.db;
    const refusal = (index: number) => ({ uid: UID, reason: 'not_from_your_notetaker' as const, senderDomain: null, providerEventId: `pm-${index}`, now: NOW });
    for (let index = 1; index < SUMMARY_LIMITS.maxRefusalsPerDay; index += 1) expect(await recordRefusal(db, refusal(index))).toBe('recorded');
    expect((await handleSummaryStatus(verifiedAuth(), {}, h.deps)).refusedToday?.capped).toBe(false);
    expect(await recordRefusal(db, refusal(SUMMARY_LIMITS.maxRefusalsPerDay))).toBe('recorded');
    expect((await handleSummaryStatus(verifiedAuth(), {}, h.deps)).refusedToday).toEqual({
      day: '2026-11-12',
      count: SUMMARY_LIMITS.maxRefusalsPerDay,
      capped: true,
    });
    expect(await recordRefusal(db, refusal(SUMMARY_LIMITS.maxRefusalsPerDay + 1))).toBe('capped');
    expect(refusedTodayOf({ refusedDay: null, refusedCount: 0 }, NOW)).toBeNull();
  });

  it('drops a stored last refusal or receipt time that does not parse', async () => {
    const h = harness();
    await createAddressFor(h);
    patchUser(h, { lastReceivedAt: 'yesterday', lastRefused: { reason: 'made_up', at: 'x', senderDomain: null } });
    const status = await handleSummaryStatus(verifiedAuth(), {}, h.deps);
    expect(status.lastReceivedAt).toBeNull();
    expect(status.lastRefused).toBeNull();
  });

  it('answers upstream_error when Firestore fails, logging only the error name', async () => {
    const h = harness();
    jest.spyOn(h.fake, 'collection').mockImplementation(() => {
      throw new TypeError('storage down');
    });
    await expectReason(handleSummaryStatus(verifiedAuth(), {}, h.deps), 'upstream_error');
    expect(functionsLogger.error).toHaveBeenCalledWith('summaries.status.failed', { uid: UID, errorName: 'TypeError' });
  });
});

// ---------------------------------------------------------------------------------------------
// summaryAction gates
// ---------------------------------------------------------------------------------------------

describe('summaryAction gates', () => {
  it('answers unauthenticated to a signed-out or unverified caller', async () => {
    const h = harness();
    await expectReason(handleSummaryAction(undefined, { op: 'create_address' }, h.deps), 'unauthenticated');
    await expectReason(act(h, { op: 'create_address' }, null), 'unauthenticated');
    await expectReason(act(h, { op: 'create_address' }, unverifiedAuth()), 'unauthenticated');
    expect(h.fake.log).toEqual([]);
  });

  it('answers not_enabled while SUMMARIES_ENABLED is off', async () => {
    const h = harness({ enabled: false });
    await expectReason(act(h, { op: 'create_address' }), 'not_enabled');
    expect(h.fake.log).toEqual([]);
  });

  it('answers not_allowed outside the pilot list (an empty list allows nobody)', async () => {
    const h = harness();
    await expectReason(act(h, { op: 'create_address' }, verifiedAuth(OUTSIDER)), 'not_allowed');
    const empty = harness({ pilotUids: '' });
    await expectReason(act(empty, { op: 'create_address' }), 'not_allowed');
    expect(h.fake.log).toEqual([]);
    expect(empty.fake.log).toEqual([]);
  });

  it('answers invalid_request for a request that does not match the schema', async () => {
    const h = harness();
    for (const data of [
      undefined,
      {},
      { op: 'explode' },
      { op: 'attach', summaryId: SUM_A, meetingId: MEETING_ATLAS },
      { op: 'attach', summaryId: 'a:b', meetingId: MEETING_ATLAS, occurrenceDate: null },
      { op: 'delete', summaryId: '' },
      { op: 'disconnect' },
      { op: 'set_mailboxes', mailboxes: ['Dana Lee <dana@company.example>'] },
      { op: 'dismiss_gmail', gmailAddress: 'nope' },
    ]) {
      await expectReason(act(h, data), 'invalid_request');
    }
    expect(h.fake.log).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Address ops
// ---------------------------------------------------------------------------------------------

describe('summaryAction create_address and regenerate_address', () => {
  it('creates the address with the verified email as the first mailbox, then answers it again unchanged', async () => {
    const h = harness();
    const first = await createAddressFor(h);
    expect(summaryActionResponseSchema.parse(first)).toEqual(first);
    expect(first.changed).toBe(true);
    expect(first.summary).toBeNull();
    const token = userDoc(h).token as string;
    expect(first.status).toMatchObject({ allowed: true, ready: true, address: `${token}@${ADDRESS_DOMAIN}`, mailboxes: [MAILBOX] });
    expect(h.fake.paths(`${SUMMARY_ADDRESSES_COLLECTION}/`)).toEqual([`${SUMMARY_ADDRESSES_COLLECTION}/${tokenHash(token)}`]);

    const again = await createAddressFor(h);
    expect(again.changed).toBe(false);
    expect(again.status.address).toBe(first.status.address);
    expect(h.fake.paths(`${SUMMARY_ADDRESSES_COLLECTION}/`)).toHaveLength(1);
  });

  it('starts with no mailbox when the sign-in email is not a plain address', async () => {
    const h = harness();
    const response = await createAddressFor(h, verifiedAuth(UID, 'not-an-email'));
    expect(response.status.mailboxes).toEqual([]);
  });

  it('answers not_ready while the template is empty, writing nothing', async () => {
    const h = harness({ template: '' });
    await expectReason(createAddressFor(h), 'not_ready');
    expect(writesOf(h)).toEqual([]);
  });

  it('answers not_allowed and writes nothing once the account deletion has started (review S5)', async () => {
    const h = harness();
    // deleteAccount wrote its record; the caller's ID token is still accepted for up to an hour.
    h.fake.seed(`accountDeletions/${UID}`, { deletedAt: NOW.toISOString() });
    await expectReason(createAddressFor(h), 'not_allowed');
    expect(writesOf(h)).toEqual([]);
    expect(h.fake.paths(`${SUMMARY_ADDRESSES_COLLECTION}/`)).toEqual([]);
  });

  it('regenerates the address in place and drops the old index document', async () => {
    const h = harness();
    const created = await createAddressFor(h);
    const oldToken = userDoc(h).token as string;
    const rotated = await act(h, { op: 'regenerate_address' });
    const newToken = userDoc(h).token as string;
    expect(rotated.changed).toBe(true);
    expect(newToken).not.toBe(oldToken);
    expect(rotated.status.address).toBe(`${newToken}@${ADDRESS_DOMAIN}`);
    expect(rotated.status.address).not.toBe(created.status.address);
    expect(h.fake.has(`${SUMMARY_ADDRESSES_COLLECTION}/${tokenHash(oldToken)}`)).toBe(false);
    expect(h.fake.has(`${SUMMARY_ADDRESSES_COLLECTION}/${tokenHash(newToken)}`)).toBe(true);
  });

  it('answers rate_limited on the sixth rotation of a UTC day, and allows it again the next day', async () => {
    const h = harness();
    await createAddressFor(h);
    for (let index = 0; index < SUMMARY_LIMITS.maxRotationsPerDay; index += 1) {
      expect((await act(h, { op: 'regenerate_address' })).changed).toBe(true);
    }
    const before = userDoc(h).token;
    await expectReason(act(h, { op: 'regenerate_address' }), 'rate_limited');
    expect(userDoc(h).token).toBe(before);
    h.setNow(new Date('2026-11-13T00:00:01.000Z'));
    expect((await act(h, { op: 'regenerate_address' })).changed).toBe(true);
  });

  it('counts a create after a disconnect as a rotation: rate_limited once the day is used up', async () => {
    const h = harness();
    await createAddressFor(h);
    for (let index = 0; index < SUMMARY_LIMITS.maxRotationsPerDay; index += 1) await act(h, { op: 'regenerate_address' });
    await act(h, { op: 'disconnect', deleteSummaries: false });
    await expectReason(createAddressFor(h), 'rate_limited');
    expect(h.fake.paths(`${SUMMARY_ADDRESSES_COLLECTION}/`)).toEqual([]);
  });

  it('creates a new address after a disconnect while the day still has rotations', async () => {
    const h = harness();
    const first = await createAddressFor(h);
    await act(h, { op: 'disconnect', deleteSummaries: false });
    const second = await createAddressFor(h);
    expect(second.changed).toBe(true);
    expect(second.status.address).not.toBe(first.status.address);
    expect(userDoc(h).rotationsToday).toBe(1);
  });

  it('answers not_ready for regenerate before any address, and while the template is empty', async () => {
    const h = harness();
    await expectReason(act(h, { op: 'regenerate_address' }), 'not_ready');
    await createAddressFor(h);
    h.deps.config.template = '';
    await expectReason(act(h, { op: 'regenerate_address' }), 'not_ready');
  });
});

describe('summaryAction set_mailboxes and dismiss_gmail', () => {
  it('replaces the list lowercased and deduplicated; the same list again changes nothing', async () => {
    const h = harness();
    await createAddressFor(h);
    const saved = await act(h, { op: 'set_mailboxes', mailboxes: ['Lee@Company.Example', 'lee@company.example', 'dana@home.example'] });
    expect(saved.changed).toBe(true);
    expect(saved.status.mailboxes).toEqual(['lee@company.example', 'dana@home.example']);
    const repeat = await act(h, { op: 'set_mailboxes', mailboxes: ['lee@company.example', 'DANA@home.example'] });
    expect(repeat.changed).toBe(false);
    const cleared = await act(h, { op: 'set_mailboxes', mailboxes: [] });
    expect(cleared.changed).toBe(true);
    expect(cleared.status.mailboxes).toEqual([]);
  });

  it('answers invalid_request for more than 5, a reserved private-address domain or an address that does not normalize', async () => {
    const h = harness();
    await createAddressFor(h);
    const six = ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => `${name}@company.example`);
    await expectReason(act(h, { op: 'set_mailboxes', mailboxes: six }), 'invalid_request');
    await expectReason(act(h, { op: 'set_mailboxes', mailboxes: [`someone@${ADDRESS_DOMAIN}`] }), 'invalid_request');
    await expectReason(act(h, { op: 'set_mailboxes', mailboxes: ['dana@company.123'] }), 'invalid_request');
    expect(userDoc(h).mailboxes).toEqual([MAILBOX]);
  });

  it('answers not_ready before an address exists (it never creates summaryUsers)', async () => {
    const h = harness();
    await expectReason(act(h, { op: 'set_mailboxes', mailboxes: [MAILBOX] }), 'not_ready');
    expect(h.fake.has(`${SUMMARY_USERS_COLLECTION}/${UID}`)).toBe(false);
  });

  it('dismisses one pending Gmail confirmation (any case) and drops the expired ones on the same write', async () => {
    const h = harness();
    await createAddressFor(h);
    patchUser(h, {
      gmailRequests: [
        { gmailAddress: 'dana@gmail.example', code: '222222', receivedAt: '2026-11-12T09:00:00.000Z' },
        { gmailAddress: 'lee@gmail.example', code: '333333', receivedAt: '2026-11-11T09:00:00.000Z' },
        { gmailAddress: 'old@gmail.example', code: '111111', receivedAt: '2026-11-01T09:00:00.000Z' },
      ],
    });
    const dismissed = await act(h, { op: 'dismiss_gmail', gmailAddress: 'Dana@Gmail.Example' });
    expect(dismissed.changed).toBe(true);
    expect(dismissed.status.gmailRequests).toEqual([{ gmailAddress: 'lee@gmail.example', code: '333333', receivedAt: '2026-11-11T09:00:00.000Z' }]);
    expect(userDoc(h).gmailRequests).toEqual([{ gmailAddress: 'lee@gmail.example', code: '333333', receivedAt: '2026-11-11T09:00:00.000Z' }]);
    const again = await act(h, { op: 'dismiss_gmail', gmailAddress: 'dana@gmail.example' });
    expect(again.changed).toBe(false);
  });

  it('dismiss_gmail without an address changes nothing', async () => {
    const h = harness();
    const response = await act(h, { op: 'dismiss_gmail', gmailAddress: 'dana@gmail.example' });
    expect(response.changed).toBe(false);
    expect(writesOf(h)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// attach
// ---------------------------------------------------------------------------------------------

describe('resolveAttachTarget', () => {
  it('takes a one-off meeting with a null occurrence date only', () => {
    expect(resolveAttachTarget(MEETING_ATLAS, ONE_OFF_MEETING, null)).toEqual({
      ok: true,
      snapshot: { title: 'Atlas launch sync', startAt: '2026-10-16T14:00:00.000Z', endAt: '2026-10-16T15:00:00.000Z', timezone: ZONE },
    });
    expect(resolveAttachTarget(MEETING_ATLAS, ONE_OFF_MEETING, '2026-10-16')).toEqual({ ok: false, reason: 'not_a_series' });
  });

  it('refuses a missing meeting, a tombstone and an unreadable document', () => {
    expect(resolveAttachTarget(MEETING_ATLAS, undefined, null)).toEqual({ ok: false, reason: 'missing' });
    expect(resolveAttachTarget(MEETING_ATLAS, { ...ONE_OFF_MEETING, deletedAt: '2026-11-01T00:00:00.000Z' }, null)).toEqual({
      ok: false,
      reason: 'deleted',
    });
    expect(resolveAttachTarget(MEETING_ATLAS, { ...ONE_OFF_MEETING, status: 'deleted' }, null)).toEqual({ ok: false, reason: 'deleted' });
    expect(resolveAttachTarget(MEETING_ATLAS, { ...ONE_OFF_MEETING, startAt: 'tomorrow' }, null)).toEqual({ ok: false, reason: 'unreadable' });
    // A zone the contract's timeZoneSchema refuses is unreadable for any meeting.
    expect(resolveAttachTarget(MEETING_ATLAS, { ...ONE_OFF_MEETING, timezone: 'Not a zone' }, null)).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('agrees with candidates.ts on zones: a one-off needs a schema-valid zone, only a series one Intl knows', () => {
    const odd = 'Mars/Olympus_Mons';
    expect(timeZoneSchema.safeParse(odd).success).toBe(true);
    expect(isValidTimeZone(odd)).toBe(false);
    expect(resolveAttachTarget(MEETING_ATLAS, { ...ONE_OFF_MEETING, timezone: odd }, null)).toEqual({
      ok: true,
      snapshot: { title: 'Atlas launch sync', startAt: '2026-10-16T14:00:00.000Z', endAt: '2026-10-16T15:00:00.000Z', timezone: odd },
    });
    expect(resolveAttachTarget(MEETING_STANDUP, { ...SERIES_MEETING, timezone: odd }, '2026-10-19')).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('defaults a missing duration to 60 minutes and caps a long title', () => {
    const { durationMinutes: _unused, ...withoutDuration } = ONE_OFF_MEETING;
    const target = resolveAttachTarget(MEETING_ATLAS, { ...withoutDuration, title: 'T'.repeat(SUMMARY_LIMITS.maxTitleChars + 100) }, null);
    expect(target.ok).toBe(true);
    if (!target.ok) return;
    expect(target.snapshot.endAt).toBe('2026-10-16T15:00:00.000Z');
    expect(target.snapshot.title).toHaveLength(SUMMARY_LIMITS.maxTitleChars);
  });

  it('takes a real occurrence of a series at its own start', () => {
    expect(resolveAttachTarget(MEETING_STANDUP, SERIES_MEETING, '2026-10-19')).toEqual({
      ok: true,
      snapshot: { title: 'Team standup', startAt: '2026-10-19T15:00:00.000Z', endAt: '2026-10-19T15:30:00.000Z', timezone: ZONE },
    });
    // The first occurrence is the master itself.
    expect(resolveAttachTarget(MEETING_STANDUP, SERIES_MEETING, '2026-10-05')).toMatchObject({ ok: true });
  });

  it('takes a moved occurrence under its ORIGINAL date with the moved start, duration and title', () => {
    expect(resolveAttachTarget(MEETING_STANDUP, SERIES_MEETING, '2026-10-26')).toEqual({
      ok: true,
      snapshot: { title: 'Standup moved', startAt: '2026-10-27T16:00:00.000Z', endAt: '2026-10-27T16:45:00.000Z', timezone: ZONE },
    });
    // The moved-to date is not an occurrence of its own.
    expect(resolveAttachTarget(MEETING_STANDUP, SERIES_MEETING, '2026-10-27')).toEqual({ ok: false, reason: 'not_an_occurrence' });
  });

  it('refuses another date, a date before the series, an impossible date, a cancelled occurrence and a missing date', () => {
    expect(resolveAttachTarget(MEETING_STANDUP, SERIES_MEETING, '2026-10-20')).toEqual({ ok: false, reason: 'not_an_occurrence' });
    expect(resolveAttachTarget(MEETING_STANDUP, SERIES_MEETING, '2026-09-28')).toEqual({ ok: false, reason: 'not_an_occurrence' });
    expect(resolveAttachTarget(MEETING_STANDUP, SERIES_MEETING, '2026-02-30')).toEqual({ ok: false, reason: 'not_an_occurrence' });
    expect(resolveAttachTarget(MEETING_STANDUP, SERIES_MEETING, '2026-10-12')).toEqual({ ok: false, reason: 'cancelled_occurrence' });
    expect(resolveAttachTarget(MEETING_STANDUP, SERIES_MEETING, null)).toEqual({ ok: false, reason: 'occurrence_required' });
  });

  it('respects count and until like the app', () => {
    const counted = { ...SERIES_MEETING, recurrenceOverrides: null, recurrence: { ...SERIES_MEETING.recurrence, count: 2 } };
    expect(resolveAttachTarget(MEETING_STANDUP, counted, '2026-10-12')).toMatchObject({ ok: true });
    expect(resolveAttachTarget(MEETING_STANDUP, counted, '2026-10-19')).toEqual({ ok: false, reason: 'not_an_occurrence' });
    const until = { ...SERIES_MEETING, recurrenceOverrides: null, recurrence: { ...SERIES_MEETING.recurrence, until: '2026-10-19T15:00:00.000Z' } };
    expect(resolveAttachTarget(MEETING_STANDUP, until, '2026-10-19')).toMatchObject({ ok: true });
    expect(resolveAttachTarget(MEETING_STANDUP, until, '2026-10-26')).toEqual({ ok: false, reason: 'not_an_occurrence' });
  });

  it('reads only the masked fields it needs', () => {
    expect([...ATTACH_MEETING_FIELDS]).not.toContain('notes');
    expect([...ATTACH_MEETING_FIELDS]).not.toContain('participants');
    expect([...ATTACH_MEETING_FIELDS]).not.toContain('description');
    expect([...ATTACH_MEETING_FIELDS]).not.toContain('conference');
  });
});

describe('summaryAction attach', () => {
  it('files an inbox summary under a one-off meeting with a user match, the filed expiry and the user action', async () => {
    const h = harness();
    seedMeetings(h);
    const seeded = storedDoc(SUM_A, { rejectedMeetingIds: [MEETING_ATLAS, 'meet-older'] });
    seedSummary(h, SUM_A, seeded);
    const response = await act(h, { op: 'attach', summaryId: SUM_A, meetingId: MEETING_ATLAS, occurrenceDate: null });
    expect(summaryActionResponseSchema.parse(response)).toEqual(response);
    expect(response.changed).toBe(true);
    expect(response.summary).toEqual({
      summaryId: SUM_A,
      status: 'matched',
      inboxReason: null,
      match: {
        meetingId: MEETING_ATLAS,
        occurrenceDate: null,
        method: 'user',
        meetingSnapshot: { title: 'Atlas launch sync', startAt: '2026-10-16T14:00:00.000Z', endAt: '2026-10-16T15:00:00.000Z', timezone: ZONE },
      },
    });
    const stored = storedAt(h, SUM_A);
    expect(stored.status).toBe('matched');
    expect(stored.inboxReason).toBeNull();
    expect(stored.match).toEqual({
      meetingId: MEETING_ATLAS,
      occurrenceDate: null,
      duplicateMeetingIds: [],
      method: 'user',
      score: null,
      titleScore: null,
      timeScore: null,
      reasons: [],
      zoneUsed: null,
      matchedAt: NOW.toISOString(),
      meetingSnapshot: { title: 'Atlas launch sync', startAt: '2026-10-16T14:00:00.000Z', endAt: '2026-10-16T15:00:00.000Z', timezone: ZONE },
    });
    expect(stored.userAction).toEqual({ kind: 'attach', at: NOW.toISOString() });
    expect(stored.expiresAt).toBe(addDaysIso(RECEIVED_AT, 365));
    expect(stored.updatedAt).toBe(NOW.toISOString());
    // The user chose this meeting: it is no longer rejected. Trust facts and content are untouched.
    expect(stored.rejectedMeetingIds).toEqual(['meet-older']);
    expect(stored.trust).toEqual(seeded.trust);
    expect(stored.receivedAt).toBe(seeded.receivedAt);
    expect(stored.sealedHead).toBe(seeded.sealedHead);
    expect(stored.sealedBody).toBe(seeded.sealedBody);
    expect(stored.candidates).toEqual(seeded.candidates);
    expect(response.status.inboxCount).toBe(0);
  });

  it('answers changed false for the same meeting again, and moves a filed summary to another meeting', async () => {
    const h = harness();
    seedMeetings(h);
    seedSummary(h, SUM_A, matchedDoc(SUM_A));
    const same = await act(h, { op: 'attach', summaryId: SUM_A, meetingId: MEETING_ATLAS, occurrenceDate: null });
    expect(same.changed).toBe(false);
    expect(same.summary?.match?.method).toBe('auto');
    expect(writesOf(h)).toEqual([]);

    const moved = await act(h, { op: 'attach', summaryId: SUM_A, meetingId: MEETING_OTHER, occurrenceDate: null });
    expect(moved.changed).toBe(true);
    expect(moved.summary?.match).toMatchObject({ meetingId: MEETING_OTHER, method: 'user' });
    expect(moved.summary?.match?.meetingSnapshot.title).toBe('Marketing review');
  });

  it('files under a one-off meeting whose zone Intl does not know (it may be suggested by candidates.ts)', async () => {
    const h = harness();
    const odd = 'Mars/Olympus_Mons';
    h.fake.seed(meetingPath('meet-odd-zone'), { ...ONE_OFF_MEETING, timezone: odd });
    seedSummary(h, SUM_A, storedDoc(SUM_A));
    const response = await act(h, { op: 'attach', summaryId: SUM_A, meetingId: 'meet-odd-zone', occurrenceDate: null });
    expect(summaryActionResponseSchema.parse(response)).toEqual(response);
    expect(response.changed).toBe(true);
    expect(response.summary?.match).toMatchObject({ meetingId: 'meet-odd-zone', method: 'user', meetingSnapshot: { timezone: odd } });
    expect(storedAt(h, SUM_A).match?.meetingSnapshot.timezone).toBe(odd);
  });

  it('files a kept summary and a series occurrence', async () => {
    const h = harness();
    seedMeetings(h);
    seedSummary(h, SUM_B, storedDoc(SUM_B, { status: 'kept', inboxReason: null }));
    const response = await act(h, { op: 'attach', summaryId: SUM_B, meetingId: MEETING_STANDUP, occurrenceDate: '2026-10-26' });
    expect(response.summary?.match).toEqual({
      meetingId: MEETING_STANDUP,
      occurrenceDate: '2026-10-26',
      method: 'user',
      meetingSnapshot: { title: 'Standup moved', startAt: '2026-10-27T16:00:00.000Z', endAt: '2026-10-27T16:45:00.000Z', timezone: ZONE },
    });
  });

  it('answers invalid_meeting for a tombstone, a missing meeting, another series date, a cancelled occurrence and a one-off with a date', async () => {
    const h = harness();
    seedMeetings(h);
    seedSummary(h, SUM_A, storedDoc(SUM_A));
    const before = h.fake.data(summaryDocPath(UID, SUM_A));
    for (const [meetingId, occurrenceDate] of [
      [MEETING_GONE, null],
      ['meet-nope', null],
      ['__reserved__', null],
      [MEETING_STANDUP, '2026-10-20'],
      [MEETING_STANDUP, '2026-10-12'],
      [MEETING_STANDUP, null],
      [MEETING_ATLAS, '2026-10-16'],
    ] as const) {
      await expectReason(act(h, { op: 'attach', summaryId: SUM_A, meetingId, occurrenceDate }), 'invalid_meeting');
    }
    expect(h.fake.data(summaryDocPath(UID, SUM_A))).toEqual(before);
    expect(writesOf(h)).toEqual([]);
  });

  it("never reads or files under another user's meeting", async () => {
    const h = harness();
    h.fake.seed(meetingPath('meet-theirs', OUTSIDER), ONE_OFF_MEETING);
    seedSummary(h, SUM_A, storedDoc(SUM_A));
    await expectReason(act(h, { op: 'attach', summaryId: SUM_A, meetingId: 'meet-theirs', occurrenceDate: null }), 'invalid_meeting');
    expect(h.fake.log.filter((entry) => entry.includes(OUTSIDER))).toEqual([]);
  });

  it('answers not_found for a refused row, a missing summary, a document that does not parse and a reserved id', async () => {
    const h = harness();
    seedMeetings(h);
    seedSummary(h, REFUSED_ID, REFUSED_ROW);
    seedSummary(h, SUM_C, { status: 'inbox', schemaVersion: 99 });
    for (const summaryId of [REFUSED_ID, SUM_B, SUM_C]) {
      await expectReason(act(h, { op: 'attach', summaryId, meetingId: MEETING_ATLAS, occurrenceDate: null }), 'not_found');
    }
    await expectReason(act(h, { op: 'attach', summaryId: '__reserved__', meetingId: MEETING_ATLAS, occurrenceDate: null }), 'not_found');
    expect(h.fake.log.some((entry) => entry.includes('__reserved__'))).toBe(false);
    expect(h.fake.data(summaryDocPath(UID, REFUSED_ID))).toEqual(REFUSED_ROW);
  });

  it("does not touch another user's summary with the same id", async () => {
    const h = harness();
    seedMeetings(h);
    seedSummary(h, SUM_A, storedDoc(SUM_A), OUTSIDER);
    await expectReason(act(h, { op: 'attach', summaryId: SUM_A, meetingId: MEETING_ATLAS, occurrenceDate: null }), 'not_found');
    expect(storedAt(h, SUM_A, OUTSIDER).status).toBe('inbox');
  });
});

// ---------------------------------------------------------------------------------------------
// detach and keep
// ---------------------------------------------------------------------------------------------

describe('summaryAction detach', () => {
  it('sends a filed summary back to the inbox, rejects its meeting and drops it from the suggestions', async () => {
    const h = harness();
    seedSummary(h, SUM_A, matchedDoc(SUM_A, { candidates: [candidate(MEETING_ATLAS, 0.74), candidate(MEETING_OTHER, 0.47), candidate('meet-twin', 0.3, [MEETING_ATLAS])] }));
    const response = await act(h, { op: 'detach', summaryId: SUM_A });
    expect(summaryActionResponseSchema.parse(response)).toEqual(response);
    expect(response.changed).toBe(true);
    expect(response.summary).toEqual({ summaryId: SUM_A, status: 'inbox', inboxReason: 'weak', match: null });
    const stored = storedAt(h, SUM_A);
    expect(stored.status).toBe('inbox');
    expect(stored.match).toBeNull();
    expect(stored.rejectedMeetingIds).toEqual([MEETING_ATLAS]);
    expect(stored.candidates.map((entry) => entry.meetingId)).toEqual([MEETING_OTHER]);
    expect(stored.userAction).toEqual({ kind: 'detach', at: NOW.toISOString() });
    // Never earlier than the inbox retention from now: it does not vanish the day after.
    expect(stored.expiresAt).toBe(addDaysIso(NOW, 60));
    expect(response.status.inboxCount).toBe(1);
  });

  it('keeps the inbox reason the trust facts force (no one-tap suggestions for not_addressed_to_you)', async () => {
    const h = harness();
    seedSummary(
      h,
      SUM_A,
      matchedDoc(SUM_A, {
        match: { ...AUTO_MATCH, method: 'user', score: null, titleScore: null, timeScore: null, reasons: [], zoneUsed: null },
        candidates: [],
        trust: { tier: 'vendor_verified', recipientBound: false, fresh: true, anchorSource: 'signed_date', originalInboxReason: 'not_addressed_to_you' },
      }),
    );
    const response = await act(h, { op: 'detach', summaryId: SUM_A });
    expect(response.summary?.inboxReason).toBe('not_addressed_to_you');
    expect(detachInboxReason({ trust: { tier: 'user_forwarded', recipientBound: true, fresh: true, anchorSource: null, originalInboxReason: 'user_forwarded' } })).toBe(
      'user_forwarded',
    );
    expect(detachInboxReason({ trust: { tier: 'vendor_verified', recipientBound: true, fresh: false, anchorSource: null, originalInboxReason: 'old_summary' } })).toBe(
      'old_summary',
    );
    expect(
      detachInboxReason({ trust: { tier: 'vendor_verified', recipientBound: true, fresh: true, anchorSource: 'signed_date', originalInboxReason: 'ambiguous' } }),
    ).toBe('ambiguous');
  });

  it('keeps at most 50 rejected meetings, the newest last', async () => {
    const h = harness();
    const old = Array.from({ length: MAX_REJECTED_MEETING_IDS }, (_, index) => `meet-old-${index}`);
    seedSummary(h, SUM_A, matchedDoc(SUM_A, { rejectedMeetingIds: old }));
    await act(h, { op: 'detach', summaryId: SUM_A });
    const rejected = storedAt(h, SUM_A).rejectedMeetingIds;
    expect(rejected).toHaveLength(MAX_REJECTED_MEETING_IDS);
    expect(rejected[0]).toBe('meet-old-1');
    expect(rejected[rejected.length - 1]).toBe(MEETING_ATLAS);
    expect(withRejectedMeeting(['a', 'b'], 'a')).toEqual(['b', 'a']);
  });

  it('answers changed false for an inbox or kept summary and not_found for a refused row', async () => {
    const h = harness();
    seedSummary(h, SUM_A, storedDoc(SUM_A));
    seedSummary(h, SUM_B, storedDoc(SUM_B, { status: 'kept', inboxReason: null }));
    seedSummary(h, REFUSED_ID, REFUSED_ROW);
    expect(await act(h, { op: 'detach', summaryId: SUM_A })).toMatchObject({
      changed: false,
      summary: { summaryId: SUM_A, status: 'inbox', inboxReason: 'needs_confirmation', match: null },
    });
    expect((await act(h, { op: 'detach', summaryId: SUM_B })).changed).toBe(false);
    await expectReason(act(h, { op: 'detach', summaryId: REFUSED_ID }), 'not_found');
    await expectReason(act(h, { op: 'detach', summaryId: SUM_C }), 'not_found');
    expect(writesOf(h)).toEqual([]);
  });
});

describe('summaryAction keep', () => {
  it('keeps an inbox summary without a meeting with the kept expiry, then answers changed false', async () => {
    const h = harness();
    seedSummary(h, SUM_A, storedDoc(SUM_A));
    const response = await act(h, { op: 'keep', summaryId: SUM_A });
    expect(response.changed).toBe(true);
    expect(response.summary).toEqual({ summaryId: SUM_A, status: 'kept', inboxReason: null, match: null });
    const stored = storedAt(h, SUM_A);
    expect(stored.userAction).toEqual({ kind: 'keep', at: NOW.toISOString() });
    expect(stored.expiresAt).toBe(addDaysIso(RECEIVED_AT, 365));
    expect(stored.candidates).toEqual(storedDoc(SUM_A).candidates);
    expect(response.status.inboxCount).toBe(0);
    expect((await act(h, { op: 'keep', summaryId: SUM_A })).changed).toBe(false);
  });

  it('un-files a filed summary without rejecting its meeting', async () => {
    const h = harness();
    seedSummary(h, SUM_A, matchedDoc(SUM_A));
    const response = await act(h, { op: 'keep', summaryId: SUM_A });
    expect(response.summary).toEqual({ summaryId: SUM_A, status: 'kept', inboxReason: null, match: null });
    expect(storedAt(h, SUM_A).rejectedMeetingIds).toEqual([]);
  });

  it('answers not_found for a refused row and a missing summary', async () => {
    const h = harness();
    seedSummary(h, REFUSED_ID, REFUSED_ROW);
    await expectReason(act(h, { op: 'keep', summaryId: REFUSED_ID }), 'not_found');
    await expectReason(act(h, { op: 'keep', summaryId: SUM_A }), 'not_found');
    expect(h.fake.data(summaryDocPath(UID, REFUSED_ID))).toEqual(REFUSED_ROW);
  });
});

// ---------------------------------------------------------------------------------------------
// delete and disconnect
// ---------------------------------------------------------------------------------------------

describe('summaryAction delete', () => {
  it('hard-deletes a summary, keeps the dedupe markers, and answers changed false the second time', async () => {
    const h = harness();
    seedSummary(h, SUM_A, storedDoc(SUM_A));
    const marker = summaryEventPath('e'.repeat(64));
    h.fake.seed(marker, { expiresAt: '2026-12-17T00:00:00.000Z' });
    const first = await act(h, { op: 'delete', summaryId: SUM_A });
    expect(first).toMatchObject({ changed: true, summary: null });
    expect(h.fake.has(summaryDocPath(UID, SUM_A))).toBe(false);
    expect(h.fake.has(marker)).toBe(true);
    const second = await act(h, { op: 'delete', summaryId: SUM_A });
    expect(second.changed).toBe(false);
  });

  it('writes the deletion marker and the digest marker (expiresAt only) so the summary stays deleted', async () => {
    const h = harness();
    const seeded = storedDoc(SUM_A);
    seedSummary(h, SUM_A, seeded);
    await act(h, { op: 'delete', summaryId: SUM_A });
    const deletion = summaryEventPath(deletionMarkerKey(UID, SUM_A));
    const digest = summaryEventPath(digestMarkerKey(UID, seeded.contentDigest));
    expect(h.fake.paths('summaryEvents/')).toEqual([deletion, digest].sort());
    for (const path of [deletion, digest]) expect(h.fake.data(path)).toEqual({ expiresAt: addDaysIso(NOW, 35) });
    // A second delete of the missing document writes nothing more.
    const writes = writesOf(h).length;
    await act(h, { op: 'delete', summaryId: SUM_A });
    expect(writesOf(h)).toHaveLength(writes);
  });

  it('also writes the deletion marker of every merged id and the digest marker of every merged digest, 64 hex only', async () => {
    const h = harness();
    const mergedDigest = 'e5'.repeat(32);
    const seeded = storedDoc(SUM_A, { mergedIds: [SUM_B], mergedDigests: [mergedDigest] });
    seedSummary(h, SUM_A, seeded);
    expect((await act(h, { op: 'delete', summaryId: SUM_A })).changed).toBe(true);
    const expected = [
      summaryEventPath(deletionMarkerKey(UID, SUM_A)),
      summaryEventPath(deletionMarkerKey(UID, SUM_B)),
      summaryEventPath(digestMarkerKey(UID, seeded.contentDigest)),
      summaryEventPath(digestMarkerKey(UID, mergedDigest)),
    ];
    expect(h.fake.paths('summaryEvents/')).toEqual([...expected].sort());
    for (const path of expected) expect(h.fake.data(path)).toEqual({ expiresAt: addDaysIso(NOW, 35) });
    const tx = h.fake.transactions[h.fake.transactions.length - 1];
    expect(tx?.committed).toBe(true);
    expect([...(tx?.writes ?? [])].sort()).toEqual([...expected.map((path) => `set:${path}`), `delete:${summaryDocPath(UID, SUM_A)}`].sort());

    // A document this version cannot parse: its links still count, junk entries do not.
    const h2 = harness();
    const linked = 'f6'.repeat(32);
    seedSummary(h2, SUM_C, { status: 'inbox', schemaVersion: 99, mergedIds: ['not-hex', linked.toUpperCase(), 7, linked, linked], mergedDigests: 'not a list' });
    expect((await act(h2, { op: 'delete', summaryId: SUM_C })).changed).toBe(true);
    expect(h2.fake.paths('summaryEvents/')).toEqual(
      [summaryEventPath(deletionMarkerKey(UID, SUM_C)), summaryEventPath(deletionMarkerKey(UID, linked))].sort(),
    );
  });

  it('deletes a refused row and a document that does not parse', async () => {
    const h = harness();
    seedSummary(h, REFUSED_ID, REFUSED_ROW);
    seedSummary(h, SUM_C, { status: 'inbox', schemaVersion: 99 });
    expect((await act(h, { op: 'delete', summaryId: REFUSED_ID })).changed).toBe(true);
    // A refused row has no summary id and no content digest: no marker.
    expect(h.fake.paths('summaryEvents/')).toEqual([]);
    expect((await act(h, { op: 'delete', summaryId: SUM_C })).changed).toBe(true);
    // A document this version cannot read still keeps its id from being recreated.
    expect(h.fake.paths('summaryEvents/')).toEqual([summaryEventPath(deletionMarkerKey(UID, SUM_C))]);
    expect(h.fake.paths(`users/${UID}/`)).toEqual([]);
  });
});

describe('summaryAction disconnect', () => {
  it('without deleteSummaries: removes the address, leaves the rotation tombstone and keeps the summaries', async () => {
    const h = harness();
    await createAddressFor(h);
    const token = userDoc(h).token as string;
    seedSummary(h, SUM_A, storedDoc(SUM_A));
    const response = await act(h, { op: 'disconnect', deleteSummaries: false });
    expect(summaryActionResponseSchema.parse(response)).toEqual(response);
    expect(response.changed).toBe(true);
    expect(response.status).toMatchObject({ allowed: true, address: null, mailboxes: [], gmailRequests: [], inboxCount: 1 });
    expect(h.fake.has(`${SUMMARY_ADDRESSES_COLLECTION}/${tokenHash(token)}`)).toBe(false);
    expect(userDoc(h)).toEqual({ rotationDay: null, rotationsToday: 0, updatedAt: NOW.toISOString() });
    expect(h.fake.has(summaryDocPath(UID, SUM_A))).toBe(true);
    expect((await act(h, { op: 'disconnect', deleteSummaries: false })).changed).toBe(false);
  });

  it('with deleteSummaries: deletes every summary and refused row in bounded batches, never the markers or other users', async () => {
    const h = harness({}, { deleteLimits: { batchSize: 2, maxBatches: 12 } });
    await createAddressFor(h);
    for (const id of [SUM_A, SUM_B, SUM_C]) seedSummary(h, id, storedDoc(id));
    seedSummary(h, REFUSED_ID, REFUSED_ROW);
    seedSummary(h, 'refused-2026-11-11', { ...REFUSED_ROW, firstAt: '2026-11-11T08:00:00.000Z' });
    seedSummary(h, SUM_A, storedDoc(SUM_A), OUTSIDER);
    const marker = summaryEventPath('f'.repeat(64));
    h.fake.seed(marker, { expiresAt: '2026-12-17T00:00:00.000Z' });

    const response = await act(h, { op: 'disconnect', deleteSummaries: true });
    expect(response.changed).toBe(true);
    expect(response.status.inboxCount).toBe(0);
    expect(h.fake.paths(`users/${UID}/meetingSummaries/`)).toEqual([]);
    expect(h.fake.batchSizes).toEqual([2, 2, 1]);
    expect(h.fake.has(summaryDocPath(OUTSIDER, SUM_A))).toBe(true);
    expect(h.fake.has(marker)).toBe(true);
    // No deletion markers: the address is gone, so no mail can reach commitSummary again.
    expect(h.fake.paths('summaryEvents/')).toEqual([marker]);
    expect(h.fake.paths(`${SUMMARY_ADDRESSES_COLLECTION}/`)).toEqual([]);
  });

  it('answers upstream_error when one call cannot delete everything, and a repeat finishes the job', async () => {
    const h = harness({}, { deleteLimits: { batchSize: 2, maxBatches: 1 } });
    await createAddressFor(h);
    for (const id of [SUM_A, SUM_B, SUM_C]) seedSummary(h, id, storedDoc(id));
    await expectReason(act(h, { op: 'disconnect', deleteSummaries: true }), 'upstream_error');
    expect(functionsLogger.warn).toHaveBeenCalledWith('summaries.action.delete_incomplete', { uid: UID, summariesDeleted: 2 });
    expect(h.fake.paths(`${SUMMARY_ADDRESSES_COLLECTION}/`)).toEqual([]);
    expect(h.fake.paths(`users/${UID}/meetingSummaries/`)).toHaveLength(1);

    h.deps.deleteLimits = undefined;
    const retry = await act(h, { op: 'disconnect', deleteSummaries: true });
    expect(retry.changed).toBe(true);
    expect(h.fake.paths(`users/${UID}/meetingSummaries/`)).toEqual([]);
    expect((await act(h, { op: 'disconnect', deleteSummaries: true })).changed).toBe(false);
  });

  it('changes nothing for a caller who never had an address or a summary', async () => {
    const h = harness();
    const response = await act(h, { op: 'disconnect', deleteSummaries: true });
    expect(response.changed).toBe(false);
    expect(writesOf(h)).toEqual([]);
  });
});

describe('deleteAllSummaries', () => {
  it('uses batches of at most 400 by default and reports completion', async () => {
    expect(SUMMARY_BULK_DELETE_LIMITS.batchSize).toBeLessThanOrEqual(500);
    const fake = new BatchFakeFirestore();
    for (let index = 0; index < 5; index += 1) fake.seed(summaryDocPath(UID, `refused-2026-10-0${index + 1}`), REFUSED_ROW);
    expect(await deleteAllSummaries(fake as unknown as Firestore, UID)).toEqual({ deleted: 5, complete: true });
    expect(fake.batchSizes).toEqual([5]);
    expect(await deleteAllSummaries(fake as unknown as Firestore, UID)).toEqual({ deleted: 0, complete: true });
  });

  it('stops at maxBatches and says whether anything is left', async () => {
    const fake = new BatchFakeFirestore();
    for (let index = 0; index < 4; index += 1) fake.seed(summaryDocPath(UID, `refused-2026-10-0${index + 1}`), REFUSED_ROW);
    expect(await deleteAllSummaries(fake as unknown as Firestore, UID, { batchSize: 2, maxBatches: 2 })).toEqual({ deleted: 4, complete: true });
    for (let index = 0; index < 5; index += 1) fake.seed(summaryDocPath(UID, `refused-2026-10-0${index + 1}`), REFUSED_ROW);
    expect(await deleteAllSummaries(fake as unknown as Firestore, UID, { batchSize: 2, maxBatches: 2 })).toEqual({ deleted: 4, complete: false });
  });
});

// ---------------------------------------------------------------------------------------------
// Content never leaves, failures, logs
// ---------------------------------------------------------------------------------------------

describe('summaryAction responses and logs carry no summary content', () => {
  it('no response holds a decrypted or sealed field, and the summary state has exactly four keys', async () => {
    const h = harness();
    seedMeetings(h);
    await createAddressFor(h);
    const seededA = storedDoc(SUM_A);
    const seededB = matchedDoc(SUM_B);
    seedSummary(h, SUM_A, seededA);
    seedSummary(h, SUM_B, seededB);
    const sealed = [seededA.sealedHead, seededA.sealedBody, seededB.sealedHead, seededB.sealedBody];
    const responses = [
      await act(h, { op: 'attach', summaryId: SUM_A, meetingId: MEETING_STANDUP, occurrenceDate: '2026-10-19' }),
      await act(h, { op: 'detach', summaryId: SUM_A }),
      await act(h, { op: 'keep', summaryId: SUM_A }),
      await act(h, { op: 'detach', summaryId: SUM_B }),
      await act(h, { op: 'attach', summaryId: SUM_B, meetingId: MEETING_ATLAS, occurrenceDate: null }),
      await act(h, { op: 'delete', summaryId: SUM_A }),
      await act(h, { op: 'set_mailboxes', mailboxes: [MAILBOX] }),
      await act(h, { op: 'disconnect', deleteSummaries: true }),
    ];
    for (const response of responses) {
      const text = JSON.stringify(response);
      expect(text.toLowerCase()).not.toContain('zebra');
      expect(text).not.toContain(SECRET_FROM);
      expect(text).not.toContain('sealed');
      for (const blob of sealed) expect(text).not.toContain(blob.slice(0, 40));
      if (response.summary !== null) expect(Object.keys(response.summary).sort()).toEqual(['inboxReason', 'match', 'status', 'summaryId']);
    }
    expect(Object.keys(summaryStateOf(SUM_B, matchedDoc(SUM_B))).sort()).toEqual(['inboxReason', 'match', 'status', 'summaryId']);
  });

  it('logs no email, mailbox, address, token, meeting id, summary id or content', async () => {
    const h = harness();
    seedMeetings(h);
    await createAddressFor(h);
    const firstToken = userDoc(h).token as string;
    const firstAddress = `${firstToken}@${ADDRESS_DOMAIN}`;
    seedSummary(h, SUM_A, storedDoc(SUM_A));
    await act(h, { op: 'set_mailboxes', mailboxes: ['lee@company.example', MAILBOX] });
    await act(h, { op: 'attach', summaryId: SUM_A, meetingId: MEETING_ATLAS, occurrenceDate: null });
    await expectReason(act(h, { op: 'attach', summaryId: SUM_A, meetingId: MEETING_GONE, occurrenceDate: null }), 'invalid_meeting');
    await act(h, { op: 'detach', summaryId: SUM_A });
    await act(h, { op: 'regenerate_address' });
    const secondToken = userDoc(h).token as string;
    await act(h, { op: 'disconnect', deleteSummaries: true });
    await handleSummaryStatus(verifiedAuth(), {}, h.deps);

    const logs = allLogText();
    expect(logs).toContain('summaries.action');
    expect(logs).toContain(UID);
    for (const secret of [EMAIL, MAILBOX, 'lee@company.example', firstAddress, firstToken, secondToken, MEETING_ATLAS, MEETING_GONE, SUM_A, TEMPLATE, 'zebra', 'Zebra', 'Atlas']) {
      expect(logs).not.toContain(secret);
    }
  });

  it('answers upstream_error on a Firestore failure, logging only uid, op and the error name', async () => {
    const h = harness();
    seedMeetings(h);
    seedSummary(h, SUM_A, storedDoc(SUM_A));
    h.fake.failNextCommit = new RangeError('commit failed');
    await expectReason(act(h, { op: 'attach', summaryId: SUM_A, meetingId: MEETING_ATLAS, occurrenceDate: null }), 'upstream_error');
    expect(functionsLogger.error).toHaveBeenCalledWith('summaries.action.failed', { uid: UID, op: 'attach', errorName: 'RangeError' });
    expect(storedAt(h, SUM_A).status).toBe('inbox');
  });

  it('logs a refused op with its reason code only', async () => {
    const h = harness();
    await expectReason(act(h, { op: 'keep', summaryId: SUM_A }), 'not_found');
    expect(functionsLogger.info).toHaveBeenCalledWith('summaries.action.refused', { uid: UID, op: 'keep', reason: 'not_found' });
  });
});
