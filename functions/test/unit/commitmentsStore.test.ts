/**
 * The stored extraction and its transactions (functions/src/summaries/commitmentsModel.ts and
 * commitmentsStore.ts; docs/v2/M11-DESIGN.md sections 2.7 to 2.9 and 3.5, section 8 "Handler").
 * The lease, the call cap, never recreating a summary, the sealed blob and its AAD, the size
 * budget, the carry-over by anchorKey (also across a key rotation) and by offsets, and the
 * "already added" marks. All data is synthetic.
 */
jest.mock('firebase-functions/logger', () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

import type { Firestore } from 'firebase-admin/firestore';

import { COMMITMENT_LIMITS, summaryListCommitmentsSchema } from '../../src/shared/aiContract';
import { SealedError, summaryAad } from '../../src/shared/sealed';
import { asWrittenProposals } from '../../src/commitments/asWritten';
import { EXTRACTOR_VERSION, extractionListFactsOf } from '../../src/commitments/extraction';
import { anchorKeyOf, anchorOccurrence, extractionKey } from '../../src/commitments/ids';
import { handleSummaryCommitments } from '../../src/summaries/commitmentsHandler';
import {
  MAX_STORED_DECISIONS,
  compactDecisions,
  emptyExtraction,
  extractionAad,
  nextExtraction,
  openView,
  parseExtraction,
  sealView,
  storedExtractionSchema,
  titleOverlap,
  type StoredDecision,
  type StoredExtraction,
  type StoredView,
} from '../../src/summaries/commitmentsModel';
import {
  beginPreparation,
  commitPreparation,
  fitExtraction,
  recordModelCall,
  settleFailedPreparation,
} from '../../src/summaries/commitmentsStore';
import { FIRESTORE_MAX_DOC_BYTES, SUMMARY_DOC_SAFE_BYTES, estimateDocBytes, summaryDocPath } from '../../src/summaries/model';
import { parseSections } from '../../src/summaries/sections';
import { SPECIMEN } from './commitmentsFixtures';
import {
  KEYRING,
  MEETING_ID,
  NOW,
  OTHER_UID,
  ROTATED_KEYRING,
  SUMMARY_A,
  SUMMARY_B,
  UID,
  autoMatch,
  harness,
  seedSummary,
  sid,
  verifiedAuth,
  type Harness,
} from './commitmentsHarness';

const REF = { uid: UID, summaryId: SUMMARY_A };
const PATH_A = summaryDocPath(UID, SUMMARY_A);
const DIGEST = 'a'.repeat(64);
const PRESELECT = { allowed: true, selectAll: true, reason: null };
const STAMP = { meetingId: MEETING_ID, occurrenceDate: null };

function call(h: Harness, data: unknown) {
  return handleSummaryCommitments(verifiedAuth(), data, h.deps);
}

function stored(h: Harness, path: string = PATH_A): StoredExtraction {
  const parsed = parseExtraction(h.db.data(path)?.extraction);
  if (parsed === null) throw new Error('no extraction');
  return parsed;
}

function asWrittenOf(text: string) {
  return asWrittenProposals({ text, sections: parseSections(text).sections, referenceDay: '2026-10-16', userNames: ['Dana Ruiz'] });
}

function built(text: string, previous: StoredExtraction | null, options: Partial<Parameters<typeof nextExtraction>[0]> = {}) {
  return nextExtraction({
    keyring: KEYRING,
    ref: REF,
    text,
    summary: { contentDigest: DIGEST, parserVersion: 1 },
    previous,
    mode: 'as_written',
    key: extractionKey({ contentDigest: DIGEST, parserVersion: 1, extractorVersion: EXTRACTOR_VERSION, mode: 'as_written' }),
    verified: asWrittenOf(text),
    meetingId: MEETING_ID,
    now: NOW,
    model: null,
    truncated: false,
    matchStamp: STAMP,
    preselect: PRESELECT,
    similarTextKeys: new Set(),
    leaseId: null,
    ...options,
  });
}

// ---------------------------------------------------------------------------------------------
// Sealing and size
// ---------------------------------------------------------------------------------------------

describe('the sealed blob', () => {
  it("opens with the AAD summaryAad + ':extraction' and fails for another user, another summary or the other view", () => {
    expect(extractionAad(REF)).toBe(`${summaryAad(REF)}:extraction`);
    const asWritten = built(SPECIMEN, null).extraction;
    const view = asWritten.views.as_written as StoredView;
    expect(openView(KEYRING, REF, view).map((item) => item.title)).toContain('Bish: Provide APK access/files to Urpayroll');
    expect(() => openView(KEYRING, { uid: OTHER_UID, summaryId: SUMMARY_A }, view)).toThrow(SealedError);
    expect(() => openView(KEYRING, { uid: UID, summaryId: SUMMARY_B }, view)).toThrow(expect.objectContaining({ reason: 'open_failed' }));
    // A blob from the other view of the same summary opens but does not list these items.
    const ai = built(SPECIMEN, asWritten, { mode: 'ai', verified: asWrittenOf(SPECIMEN).slice(0, 2), key: extractionKey({ contentDigest: DIGEST, parserVersion: 1, extractorVersion: EXTRACTOR_VERSION, mode: 'ai' }) }).extraction;
    const swapped: StoredView = { ...(ai.views.ai as StoredView), sealed: view.sealed };
    expect(() => openView(KEYRING, REF, swapped)).toThrow(expect.objectContaining({ reason: 'blob_malformed' }));
  });

  it('keeps titles, owners and dates out of the plaintext; the stored shape parses and the list reads its stamp', () => {
    const extraction = built(SPECIMEN, null).extraction;
    expect(storedExtractionSchema.safeParse(extraction).success).toBe(true);
    const plaintext = JSON.stringify({ ...extraction, views: { ai: null, as_written: { ...extraction.views.as_written, sealed: null } } });
    for (const secret of ['Provide APK', 'Bish', 'Cristina', 'checklist with the client']) expect([secret, plaintext.includes(secret)]).toEqual([secret, false]);
    const facts = extractionListFactsOf(extraction, { contentDigest: DIGEST, parserVersion: 1 });
    expect(summaryListCommitmentsSchema.parse(facts)).toEqual({ state: 'ready', open: extraction.views.as_written?.items.length, accepted: 0 });
    expect(extractionListFactsOf(extraction, { contentDigest: 'b'.repeat(64), parserVersion: 1 })?.state).toBe('stale');
  });

  it('the largest extraction (two full views, every decision) keeps a document at the summary size cap under 1 MiB', () => {
    const sealedItems = (prefix: string) =>
      Array.from({ length: COMMITMENT_LIMITS.maxProposals }, (_, index) => ({
        a: `i_${(index + (prefix === 'q' ? 100 : 0)).toString(16).padStart(12, '0')}`,
        title: 'T'.repeat(COMMITMENT_LIMITS.maxTitleChars),
        owner: 'O'.repeat(COMMITMENT_LIMITS.maxOwnerChars),
        dueDate: '2026-11-20',
        dueTime: '15:00',
      }));
    const viewOf = (prefix: string, mode: 'ai' | 'as_written'): StoredView => {
      const items = sealedItems(prefix);
      return {
        key: extractionKey({ contentDigest: DIGEST, parserVersion: 1, extractorVersion: EXTRACTOR_VERSION, mode }),
        state: 'ready',
        preparedAt: NOW.toISOString(),
        model: 'm'.repeat(100),
        truncated: true,
        matchStamp: STAMP,
        preselect: PRESELECT,
        items: items.map((item, index) => ({
          a: item.a,
          ak: 'item',
          k: index.toString(16).padStart(24, '0'),
          t: index.toString(16).padStart(24, 'f'),
          n: index + 1,
          s: 's_000000000000',
          sk: 'action_items',
          qs: index * 1000,
          qe: index * 1000 + 999,
          kind: 'action',
          owner: 'other',
          due: 'summary',
          dqs: index * 1000,
          dqe: index * 1000 + 99,
          conf: 100,
          flags: ['possible_instruction', 'has_link', 'truncated', 'payment_like', 'suggested', 'checklist', 'owner_guess', 'similar_added'],
          tfa: true,
        })),
        sealed: sealView(KEYRING, REF, items),
      };
    };
    const decisions: StoredDecision[] = Array.from({ length: MAX_STORED_DECISIONS }, (_, index) => ({
      k: index.toString(16).padStart(24, '1'),
      t: index.toString(16).padStart(24, '2'),
      s: 'accepted',
      taskId: `sm_${index.toString(16).padStart(32, '0')}`,
      gen: 999,
      at: NOW.toISOString(),
      fd: 'f'.repeat(16),
      via: 'whatsapp',
      qs: 0,
      qe: 1000,
    }));
    const largest: StoredExtraction = {
      ...emptyExtraction({ contentDigest: DIGEST, parserVersion: 1 }, NOW),
      mode: 'ai',
      state: 'ready',
      key: viewOf('i', 'ai').key,
      preparedAt: NOW.toISOString(),
      views: { ai: viewOf('i', 'ai'), as_written: viewOf('q', 'as_written') },
      decisions,
      calls: { n: 3, digest: DIGEST, extractorVersion: EXTRACTOR_VERSION },
      charge: { at: NOW.toISOString(), dayKey: '2026-10-17', charges: { day: true, intro: true, cycle: NOW.toISOString() } },
      lease: { until: NOW.toISOString(), id: 'f'.repeat(32) },
    };
    expect(storedExtractionSchema.safeParse(largest).success).toBe(true);
    const extractionBytes = estimateDocBytes(PATH_A, { extraction: largest });
    expect(extractionBytes).toBeLessThan(FIRESTORE_MAX_DOC_BYTES - SUMMARY_DOC_SAFE_BYTES - 16 * 1024);
    // A summary document already at the size cap of buildSummaryDoc still takes it.
    const base: Record<string, unknown> = { sealedBody: 'b'.repeat(SUMMARY_DOC_SAFE_BYTES - 200) };
    expect(estimateDocBytes(PATH_A, base)).toBeLessThanOrEqual(SUMMARY_DOC_SAFE_BYTES);
    const fitted = fitExtraction(PATH_A, base, largest);
    expect(fitted).toBe(largest);
    expect(estimateDocBytes(PATH_A, { ...base, extraction: fitted })).toBeLessThan(FIRESTORE_MAX_DOC_BYTES);
    // Past the room, the kept other view goes first, then the write is refused.
    const slimBytes = estimateDocBytes(PATH_A, { extraction: { ...largest, views: { ai: largest.views.ai, as_written: null } } });
    const fuller: Record<string, unknown> = { sealedBody: 'b'.repeat(FIRESTORE_MAX_DOC_BYTES - 16 * 1024 - slimBytes - 1000) };
    const slim = fitExtraction(PATH_A, fuller, largest);
    expect(slim?.views.as_written).toBeNull();
    expect(slim?.views.ai).toEqual(largest.views.ai);
    expect(fitExtraction(PATH_A, { sealedBody: 'b'.repeat(FIRESTORE_MAX_DOC_BYTES) }, largest)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// Lease, cap, never recreate
// ---------------------------------------------------------------------------------------------

describe('the preparation transactions', () => {
  const begin = (h: Harness, overrides: Partial<Parameters<typeof beginPreparation>[1]> = {}) =>
    beginPreparation(h.db as unknown as Firestore, {
      ref: REF,
      mode: 'ai',
      contentDigest: (h.db.data(PATH_A) as { contentDigest?: string } | undefined)?.contentDigest ?? DIGEST,
      leaseId: 'a'.repeat(32),
      leaseSeconds: 100,
      maxModelCalls: 3,
      now: NOW,
      ...overrides,
    });

  it('one lease at a time; an expired lease can be taken again; the items as written need none', async () => {
    const h = harness();
    seedSummary(h.db, SUMMARY_A);
    expect((await begin(h)).kind).toBe('leased');
    expect((await begin(h, { leaseId: 'b'.repeat(32) })).kind).toBe('preparing');
    expect((await begin(h, { leaseId: 'b'.repeat(32), mode: 'as_written' })).kind).toBe('build');
    expect((await begin(h, { leaseId: 'b'.repeat(32), now: new Date(NOW.getTime() + 101_000) })).kind).toBe('leased');
    expect(stored(h).lease?.id).toBe('b'.repeat(32));
  });

  it('the call cap counts per content digest and extractor version', async () => {
    const h = harness();
    const digest = 'c'.repeat(64);
    seedSummary(h.db, SUMMARY_A, { contentDigest: digest, extraction: { ...emptyExtraction({ contentDigest: digest, parserVersion: 1 }, NOW), calls: { n: 3, digest, extractorVersion: EXTRACTOR_VERSION } } });
    expect((await begin(h)).kind).toBe('cap');
    seedSummary(h.db, SUMMARY_A, { contentDigest: digest, extraction: { ...emptyExtraction({ contentDigest: digest, parserVersion: 1 }, NOW), calls: { n: 3, digest: 'd'.repeat(64), extractorVersion: EXTRACTOR_VERSION } } });
    expect((await begin(h)).kind).toBe('leased');
    seedSummary(h.db, SUMMARY_A, { contentDigest: digest, extraction: { ...emptyExtraction({ contentDigest: digest, parserVersion: 1 }, NOW), calls: { n: 3, digest, extractorVersion: EXTRACTOR_VERSION - 1 } } });
    expect((await begin(h)).kind).toBe('leased');
  });

  it('never creates a document: every write needs the summary to exist, filed or kept', async () => {
    const h = harness();
    const db = h.db as unknown as Firestore;
    expect((await begin(h, { contentDigest: DIGEST })).kind).toBe('not_found');
    expect(await recordModelCall(db, { ref: REF, leaseId: 'a'.repeat(32), contentDigest: DIGEST, charge: null, now: NOW })).toBe('gone');
    expect(await settleFailedPreparation(db, { ref: REF, leaseId: 'a'.repeat(32), contentDigest: DIGEST, uncountCall: true, clearCharge: true, now: NOW })).toBe('gone');
    const commit = await commitPreparation(db, { ref: REF, contentDigest: DIGEST, leaseId: null, build: (previous) => built(SPECIMEN, previous) });
    expect(commit.kind).toBe('not_found');
    seedSummary(h.db, SUMMARY_B, { status: 'inbox' });
    expect((await beginPreparation(db, { ref: { uid: UID, summaryId: SUMMARY_B }, mode: 'as_written', contentDigest: DIGEST, leaseId: 'a'.repeat(32), leaseSeconds: 100, maxModelCalls: 3, now: NOW })).kind).toBe('not_found');
    expect(h.db.has(PATH_A)).toBe(false);
    expect(h.db.writeLog()).toEqual([]);
  });

  it('the final write needs the same content and our lease', async () => {
    const h = harness();
    seedSummary(h.db, SUMMARY_A);
    const digest = (h.db.data(PATH_A) as { contentDigest: string }).contentDigest;
    await begin(h);
    const db = h.db as unknown as Firestore;
    const build = (previous: StoredExtraction | null) => built(SPECIMEN, previous, { summary: { contentDigest: digest, parserVersion: 1 } });
    expect((await commitPreparation(db, { ref: REF, contentDigest: 'e'.repeat(64), leaseId: 'a'.repeat(32), build })).kind).toBe('changed');
    expect((await commitPreparation(db, { ref: REF, contentDigest: digest, leaseId: 'b'.repeat(32), build })).kind).toBe('lost');
    const written = await commitPreparation(db, { ref: REF, contentDigest: digest, leaseId: 'a'.repeat(32), build: (previous) => built(SPECIMEN, previous, { summary: { contentDigest: digest, parserVersion: 1 }, leaseId: 'a'.repeat(32) }) });
    expect(written.kind).toBe('written');
    expect(stored(h).lease).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// Carry-over and marks
// ---------------------------------------------------------------------------------------------

describe('carry-over', () => {
  it('after a key rotation the old blob still opens and the decisions carry over to the new primary key', async () => {
    const h = harness();
    seedSummary(h.db, SUMMARY_A);
    const prepared = await call(h, { op: 'prepare', summaryId: SUMMARY_A, mode: 'as_written' });
    const item = prepared.commitments?.items.find((entry) => entry.quote.startsWith('Share the release checklist'));
    const decided = await call(h, {
      op: 'decide',
      summaryId: SUMMARY_A,
      key: prepared.commitments?.key,
      timezone: 'America/Mexico_City',
      language: 'en',
      decisions: [{ anchorId: item?.anchorId, decision: 'accept', draft: { title: item?.title, dueDate: null, dueTime: null, reminderMinutesBefore: null, owner: null } }],
    });
    h.keys.ring = ROTATED_KEYRING;
    expect((await call(h, { op: 'get', summaryId: SUMMARY_A })).commitments?.items.find((entry) => entry.anchorId === item?.anchorId)?.status).toBe('accepted');
    // An extractor bump makes it stale; the new extraction is keyed under k2.
    const doc = h.db.data(PATH_A) as Record<string, unknown>;
    h.db.seed(PATH_A, { ...doc, extraction: { ...(doc.extraction as Record<string, unknown>), extractorVersion: EXTRACTOR_VERSION - 1 } });
    const again = await call(h, { op: 'prepare', summaryId: SUMMARY_A, mode: 'as_written' });
    expect(again.commitments?.items.find((entry) => entry.anchorId === item?.anchorId)).toMatchObject({ status: 'accepted', taskId: decided.results?.[0]?.taskId });
    const start = SPECIMEN.indexOf('Share the release checklist');
    const end = SPECIMEN.indexOf('\n', start);
    const newKey = anchorKeyOf(ROTATED_KEYRING, SUMMARY_A, SPECIMEN.slice(start, end), anchorOccurrence(SPECIMEN, start, end));
    expect(stored(h).decisions.find((decision) => decision.s === 'accepted')?.k).toBe(newKey);
  });

  it('after a parser bump of the same text, an accepted line overlapping a new item by half or more is carried over by offsets', () => {
    const first = built(SPECIMEN, null).extraction;
    const view = first.views.as_written as StoredView;
    const target = view.items[1];
    if (target === undefined) throw new Error('fixture');
    const half = Math.ceil((target.qe - target.qs) / 2);
    const accepted: StoredDecision = { k: '9'.repeat(24), t: null, s: 'accepted', taskId: `sm_${'7'.repeat(32)}`, gen: 0, at: NOW.toISOString(), fd: '0'.repeat(16), via: 'app', qs: target.qs, qe: target.qs + half };
    const tooLittle: StoredDecision = { ...accepted, k: '8'.repeat(24), taskId: `sm_${'6'.repeat(32)}`, qs: view.items[2]?.qs ?? 0, qe: (view.items[2]?.qs ?? 0) + 4 };
    tooLittle.qs = (view.items[2]?.qs ?? 0) - 100;
    // The old parse cut the line differently: its stamp is older, its keys do not match.
    const older: StoredExtraction = { ...first, parserVersion: 0, decisions: [accepted, tooLittle] };
    const next = built(SPECIMEN, older).extraction;
    const carried = next.decisions.find((decision) => decision.taskId === accepted.taskId);
    expect(carried).toMatchObject({ k: target.k, s: 'accepted', qs: target.qs, qe: target.qe });
    expect(next.decisions.find((decision) => decision.taskId === tooLittle.taskId)?.k).toBe(tooLittle.k);
    expect(next.counts.accepted).toBe(1);
  });

  it('keeps a field a later version adds (the WhatsApp offers counter) through decide and prepare', async () => {
    const h = harness();
    seedSummary(h.db, SUMMARY_A);
    const prepared = await call(h, { op: 'prepare', summaryId: SUMMARY_A, mode: 'as_written' });
    const doc = h.db.data(PATH_A) as Record<string, unknown>;
    h.db.seed(PATH_A, { ...doc, extraction: { ...(doc.extraction as Record<string, unknown>), offers: { day: '2026-10-17', n: 2 } } });
    const item = prepared.commitments?.items[0];
    await call(h, { op: 'decide', summaryId: SUMMARY_A, key: prepared.commitments?.key, timezone: 'UTC', language: 'en', decisions: [{ anchorId: item?.anchorId, decision: 'drop' }] });
    await call(h, { op: 'prepare', summaryId: SUMMARY_A, mode: 'ai' }).catch(() => undefined);
    expect((h.db.data(PATH_A)?.extraction as Record<string, unknown>).offers).toEqual({ day: '2026-10-17', n: 2 });
    expect(stored(h).decisions.some((decision) => decision.s === 'dropped')).toBe(true);
  });

  it('compacts decisions: one per key (accepted wins), no empty open entries, at most MAX_STORED_DECISIONS', () => {
    const base: StoredDecision = { k: '1'.repeat(24), t: null, s: 'open', taskId: null, gen: 0, at: null, fd: null, via: null, qs: null, qe: null };
    const compact = compactDecisions(
      [base, { ...base, s: 'accepted', taskId: `sm_${'1'.repeat(32)}`, at: NOW.toISOString() }, { ...base, k: '2'.repeat(24) }, { ...base, k: '3'.repeat(24), gen: 1 }],
      new Set(['1'.repeat(24)]),
    );
    expect(compact.map((decision) => [decision.k[0], decision.s, decision.gen])).toEqual([
      ['1', 'accepted', 0],
      ['3', 'open', 1],
    ]);
    const many = Array.from({ length: MAX_STORED_DECISIONS + 10 }, (_, index) => ({ ...base, k: index.toString(16).padStart(24, '0'), s: 'dropped' as const }));
    expect(compactDecisions(many, new Set())).toHaveLength(MAX_STORED_DECISIONS);
  });
});

describe('the marks the ids cannot see', () => {
  it('a line accepted from another summary of the same meeting is marked similar_added and unticked; another meeting is not', async () => {
    const h = harness();
    seedSummary(h.db, SUMMARY_A);
    const first = await call(h, { op: 'prepare', summaryId: SUMMARY_A, mode: 'as_written' });
    const line = first.commitments?.items.find((entry) => entry.quote.startsWith('Prepare the demo account'));
    await call(h, {
      op: 'decide',
      summaryId: SUMMARY_A,
      key: first.commitments?.key,
      timezone: 'UTC',
      language: 'en',
      decisions: [{ anchorId: line?.anchorId, decision: 'accept', draft: { title: line?.title, dueDate: null, dueTime: null, reminderMinutesBefore: null, owner: null } }],
    });
    // A second notetaker's copy of the same meeting (different bytes, same line).
    seedSummary(h.db, SUMMARY_B, { text: `${SPECIMEN}\n- Sent by the second notetaker.` });
    const second = await call(h, { op: 'prepare', summaryId: SUMMARY_B, mode: 'as_written' });
    const marked = second.commitments?.items.filter((entry) => entry.flags.includes('similar_added')) ?? [];
    expect(marked.map((entry) => entry.quote)).toEqual([line?.quote]);
    expect(marked[0]).toMatchObject({ status: 'open', preselected: false });
    const other = sid('other-meeting');
    seedSummary(h.db, other, { text: `${SPECIMEN}\n- Another meeting.`, match: autoMatch({ meetingId: 'mtgOtherMeeting01' }) });
    const unrelated = await call(h, { op: 'prepare', summaryId: other, mode: 'as_written' });
    expect(unrelated.commitments?.items.some((entry) => entry.flags.includes('similar_added'))).toBe(false);
  });

  it('after an upgrade whose line changed, an open item close to a task accepted from the earlier copy is marked', async () => {
    const h = harness();
    seedSummary(h.db, SUMMARY_A);
    const first = await call(h, { op: 'prepare', summaryId: SUMMARY_A, mode: 'as_written' });
    const line = first.commitments?.items.find((entry) => entry.quote.startsWith('Provide APK'));
    await call(h, {
      op: 'decide',
      summaryId: SUMMARY_A,
      key: first.commitments?.key,
      timezone: 'UTC',
      language: 'en',
      decisions: [{ anchorId: line?.anchorId, decision: 'accept', draft: { title: line?.title, dueDate: null, dueTime: null, reminderMinutesBefore: null, owner: { name: 'Bish', isUser: false } } }],
    });
    const extraction = h.db.data(PATH_A)?.extraction;
    const changed = SPECIMEN.replace('Provide APK access/files to Urpayroll (owner: Bish)', 'Provide the APK access files to Urpayroll today (owner: Bish)');
    seedSummary(h.db, SUMMARY_A, { text: changed, extraction });
    const again = await call(h, { op: 'prepare', summaryId: SUMMARY_A, mode: 'as_written' });
    const item = again.commitments?.items.find((entry) => entry.quote.startsWith('Provide the APK'));
    expect(item).toMatchObject({ status: 'open', preselected: false });
    expect(item?.flags).toContain('similar_added');
    expect(again.commitments?.items.filter((entry) => entry.flags.includes('similar_added'))).toHaveLength(1);
    // The accepted line of the earlier copy is still remembered (its task stays the user's).
    expect(stored(h).decisions.some((decision) => decision.s === 'accepted')).toBe(true);
  });

  it('titleOverlap counts shared 3+ letter words over the larger set', () => {
    expect(titleOverlap('Bish: Provide APK access/files to Urpayroll', 'Bish: Provide the APK access files to Urpayroll today')).toBeCloseTo(6 / 7);
    expect(titleOverlap('Send the deck', 'Book the room')).toBe(0);
    expect(titleOverlap('', 'Anything')).toBe(0);
  });
});
