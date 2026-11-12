/**
 * M10 leftover fixed on M11 day 1: expired Gmail confirmation codes leave summaryUsers/{uid}
 * (functions/src/summaries/store.ts prunedGmailRequests and pruneGmailRequests, wired into
 * callables.ts allowedSummaryStatus), so the 2-day promise holds without waiting for the next
 * Gmail write. In-memory Firestore fake; the logger is mocked and checked for content.
 */
jest.mock('firebase-functions/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

import * as functionsLogger from 'firebase-functions/logger';
import type { Firestore } from 'firebase-admin/firestore';

import { SUMMARY_USERS_COLLECTION, parseSummaryUser } from '../../src/summaries/address';
import { handleSummaryAction, handleSummaryStatus, type SummaryCallableAuth, type SummaryCallableDeps } from '../../src/summaries/callables';
import { prunedGmailRequests, pruneGmailRequests } from '../../src/summaries/store';
import { FakeFirestore } from './summariesFakeFirestore';

const NOW = new Date('2026-11-12T10:00:00.000Z');
const UID = 'uidPruneDana01';
const PATH = `${SUMMARY_USERS_COLLECTION}/${UID}`;
const AUTH: SummaryCallableAuth = { uid: UID, token: { email: 'dana@company.example', email_verified: true, firebase: { sign_in_provider: 'password' } } };

const FRESH = { gmailAddress: 'dana@gmail.example', code: '222222', receivedAt: '2026-11-11T09:00:00.000Z' };
const EXPIRED = { gmailAddress: 'old@gmail.example', code: '111111', receivedAt: '2026-11-10T09:59:59.000Z' };
const JUNK = { gmailAddress: 'not an address', code: '444444', receivedAt: '2026-11-12T09:30:00.000Z' };

function harness(): { fake: FakeFirestore; deps: SummaryCallableDeps } {
  const fake = new FakeFirestore();
  fake.seed(`users/${UID}`, { createdAt: '2026-11-01T00:00:00.000Z' });
  return {
    fake,
    deps: {
      db: fake as unknown as Firestore,
      now: () => NOW,
      config: { enabled: true, pilotUids: UID, template: '{token}@summaries.meetingguard.example' },
    },
  };
}

async function withAddress(h: ReturnType<typeof harness>, gmailRequests: unknown[]): Promise<void> {
  await handleSummaryAction(AUTH, { op: 'create_address' }, h.deps);
  h.fake.seed(PATH, { ...(h.fake.data(PATH) ?? {}), gmailRequests });
}

function logs(): string {
  return JSON.stringify([
    ...(functionsLogger.info as jest.Mock).mock.calls,
    ...(functionsLogger.warn as jest.Mock).mock.calls,
    ...(functionsLogger.error as jest.Mock).mock.calls,
  ]);
}

describe('prunedGmailRequests (pure)', () => {
  it('drops expired (2 days), unreadable and repeated entries, newest first; null when nothing goes', () => {
    const repeat = { ...FRESH, code: '999999', receivedAt: '2026-11-11T08:00:00.000Z' };
    expect(prunedGmailRequests({ gmailRequests: [EXPIRED, FRESH, JUNK, repeat] }, NOW)).toEqual([FRESH]);
    expect(prunedGmailRequests({ gmailRequests: [FRESH] }, NOW)).toBeNull();
    expect(prunedGmailRequests({ gmailRequests: [] }, NOW)).toBeNull();
    // Exactly 2 days after it arrived it is expired.
    expect(prunedGmailRequests({ gmailRequests: [{ ...FRESH, receivedAt: '2026-11-10T10:00:00.000Z' }] }, NOW)).toEqual([]);
  });
});

describe('pruneGmailRequests and the status hook', () => {
  it('summaryStatus removes expired codes from the document, writes only that field, and logs counts only', async () => {
    const h = harness();
    await withAddress(h, [EXPIRED, FRESH, JUNK]);
    const before = { ...(h.fake.data(PATH) ?? {}) };
    const status = await handleSummaryStatus(AUTH, {}, h.deps);
    expect(status.gmailRequests).toEqual([FRESH]);
    const after = h.fake.data(PATH) ?? {};
    expect(after.gmailRequests).toEqual([FRESH]);
    expect({ ...after, gmailRequests: null }).toEqual({ ...before, gmailRequests: null });
    expect(logs()).toContain('summaries.status.gmail_pruned');
    for (const secret of ['old@gmail.example', '111111', 'dana@gmail.example', '222222']) expect(logs()).not.toContain(secret);
  });

  it('writes nothing when nothing expired, and a second status after a prune writes nothing either', async () => {
    const h = harness();
    await withAddress(h, [FRESH]);
    const writes = h.fake.writeLog().length;
    await handleSummaryStatus(AUTH, {}, h.deps);
    expect(h.fake.writeLog()).toHaveLength(writes);

    const g = harness();
    await withAddress(g, [EXPIRED]);
    await handleSummaryStatus(AUTH, {}, g.deps);
    const afterFirst = g.fake.writeLog().length;
    await handleSummaryStatus(AUTH, {}, g.deps);
    expect(g.fake.writeLog()).toHaveLength(afterFirst);
    expect(g.fake.data(PATH)?.gmailRequests).toEqual([]);
  });

  it('also runs after a summaryAction (it answers with the status)', async () => {
    const h = harness();
    await withAddress(h, [EXPIRED, FRESH]);
    await handleSummaryAction(AUTH, { op: 'set_mailboxes', mailboxes: ['dana@company.example'] }, h.deps);
    expect(h.fake.data(PATH)?.gmailRequests).toEqual([FRESH]);
  });

  it('never creates summaryUsers and leaves a disconnect tombstone alone', async () => {
    const h = harness();
    expect(await pruneGmailRequests(h.fake as unknown as Firestore, UID, NOW)).toBe(0);
    expect(h.fake.has(PATH)).toBe(false);
    const tombstone = { rotationDay: '2026-11-12', rotationsToday: 1, updatedAt: '2026-11-12T09:00:00.000Z' };
    h.fake.seed(PATH, tombstone);
    expect(await pruneGmailRequests(h.fake as unknown as Firestore, UID, NOW)).toBe(0);
    expect(h.fake.data(PATH)).toEqual(tombstone);
  });

  it('a failed prune never fails the status: the answer still hides expired codes, the error name is logged', async () => {
    const h = harness();
    await withAddress(h, [EXPIRED, FRESH]);
    const failing = Object.create(h.fake) as FakeFirestore;
    failing.runTransaction = (() => Promise.reject(new RangeError('contention'))) as FakeFirestore['runTransaction'];
    const status = await handleSummaryStatus(AUTH, {}, { ...h.deps, db: failing as unknown as Firestore });
    expect(status.gmailRequests).toEqual([FRESH]);
    expect(logs()).toContain('summaries.status.gmail_prune_failed');
    expect(logs()).toContain('RangeError');
    expect(logs()).not.toContain('contention');
    expect(parseSummaryUser(h.fake.data(PATH)).gmailRequests).toHaveLength(2);
  });
});
