/**
 * summaryCommitments decide (functions/src/summaries/commitmentsStore.ts decideCommitments and the
 * handler's decide op; docs/v2/M11-DESIGN.md sections 3.4 and 3.5, section 8 "decide"). The task
 * document, idempotency across taps, devices and WhatsApp, drop, restore, Undo with the fd digest,
 * Add again, the task zone and the defaults. All data is synthetic.
 */
jest.mock('firebase-functions/logger', () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

import { HttpsError } from 'firebase-functions/https';
import type { Firestore } from 'firebase-admin/firestore';

import { commitmentErrorDetailsSchema, type CommitmentItem, type SummaryCommitmentsResponse } from '../../src/shared/aiContract';
import { COMMITMENT_TASK_KEYS, commitmentOriginLine } from '../../src/commitments/taskDoc';
import { handleSummaryCommitments } from '../../src/summaries/commitmentsHandler';
import { parseExtraction } from '../../src/summaries/commitmentsModel';
import { acceptedTitleOf, decideCommitments, type DecideInput } from '../../src/summaries/commitmentsStore';
import { summaryDocPath } from '../../src/summaries/model';
import { KEYRING, MEETING_ID, MEETING_TITLE, ROTATED_KEYRING, SUMMARY_A, UID, autoMatch, harness, seedMeeting, seedSummary, verifiedAuth, type Harness } from './commitmentsHarness';

const PATH_A = summaryDocPath(UID, SUMMARY_A);
const TASKS = `users/${UID}/tasks/`;

/** Four action items: a stated date and time, the user's own item with a date already past, someone else's, and nobody's. */
const DATED_RECAP = [
  'Ops sync',
  'Meeting notes 2026-10-16',
  '',
  'Action items',
  '[ ] Send the invoice summary to finance (owner: Bish) (due: Oct 20, 2026 15:00)',
  '[ ] Review the vendor contract (owner: Dana Ruiz) (due: 2026-10-16)',
  '[ ] Prepare the board slides (owner: Lee)',
  '[ ] Book the offsite venue',
].join('\n');

function call(h: Harness, data: unknown) {
  return handleSummaryCommitments(verifiedAuth(), data, h.deps);
}

async function reasonOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(HttpsError);
    return commitmentErrorDetailsSchema.parse((error as HttpsError).details).reason;
  }
  throw new Error('expected a refusal');
}

async function setup(options: { meeting?: Record<string, unknown> | null; seed?: Parameters<typeof seedSummary>[2] } = {}) {
  const h = harness();
  seedSummary(h.db, SUMMARY_A, { text: DATED_RECAP, ...options.seed });
  if (options.meeting !== null) seedMeeting(h.db, options.meeting ?? {});
  const prepared = await call(h, { op: 'prepare', summaryId: SUMMARY_A, mode: 'as_written' });
  const items = prepared.commitments?.items ?? [];
  if (items.length !== 4) throw new Error(`expected 4 suggestions, got ${items.length}`);
  return { h, prepared, items, key: prepared.commitments?.key as string };
}

function draftOf(item: CommitmentItem, overrides: Record<string, unknown> = {}) {
  return {
    title: item.title,
    dueDate: item.due?.date ?? null,
    dueTime: item.due?.time ?? null,
    reminderMinutesBefore: item.due?.time ? 60 : null,
    owner: item.owner === null ? null : { name: item.owner.name, isUser: item.owner.isUser },
    ...overrides,
  };
}

function accept(item: CommitmentItem, overrides: Record<string, unknown> = {}) {
  return { anchorId: item.anchorId, decision: 'accept' as const, draft: draftOf(item, overrides) };
}

function decide(h: Harness, key: string, decisions: unknown[], extra: Record<string, unknown> = {}): Promise<SummaryCommitmentsResponse> {
  return call(h, { op: 'decide', summaryId: SUMMARY_A, key, timezone: 'America/Mexico_City', language: 'en', decisions, ...extra });
}

function taskOf(h: Harness, taskId: string | null | undefined): Record<string, unknown> | undefined {
  return taskId ? h.db.data(`${TASKS}${taskId}`) : undefined;
}

function whatsappInput(h: Harness, key: string, decisions: DecideInput['decisions'], overrides: Partial<DecideInput> = {}): DecideInput {
  return {
    ref: { uid: UID, summaryId: SUMMARY_A },
    key,
    contentDigest: (h.db.data(PATH_A) as { contentDigest: string }).contentDigest,
    channel: 'whatsapp',
    requestZone: null,
    preferencesZone: null,
    language: 'en',
    decisions,
    keyring: KEYRING,
    now: h.clock.now,
    ...overrides,
  };
}

describe('the task document', () => {
  it('is an ordinary task: existing keys only, source ai_chat, pushPending, the meeting, the person, the origin line', async () => {
    const { h, items, key } = await setup();
    const [invoice, contract] = items as [CommitmentItem, CommitmentItem];
    const response = await decide(h, key, [accept(invoice), accept(contract)], { timezone: 'Europe/Madrid' });
    expect(response.results?.map((result) => result.outcome)).toEqual(['added', 'added']);
    const task = taskOf(h, response.results?.[0]?.taskId);
    expect(Object.keys(task ?? {}).sort()).toEqual([...COMMITMENT_TASK_KEYS].sort());
    const description = commitmentOriginLine({ language: 'en', mode: 'as_written', meetingTitle: MEETING_TITLE, date: '2026-10-16' });
    expect(task).toEqual({
      userId: UID,
      title: 'Bish: Send the invoice summary to finance',
      description,
      dueDate: '2026-10-20',
      dueTime: '15:00',
      // A time stated in the summary keeps the meeting's zone, whatever the phone's.
      timezone: 'America/Mexico_City',
      reminderMinutesBefore: 60,
      status: 'open',
      meetingId: MEETING_ID,
      people: [{ name: 'Bish', email: null }],
      completedAt: null,
      source: 'ai_chat',
      pushPending: true,
      createdAt: h.clock.now.toISOString(),
      updatedAt: h.clock.now.toISOString(),
    });
    expect(description).not.toContain('invoice');
    // The user's own item: no people entry; a date without a time follows the request's zone.
    const own = taskOf(h, response.results?.[1]?.taskId);
    expect(own).toMatchObject({ title: 'Review the vendor contract', people: [], timezone: 'Europe/Madrid', dueDate: '2026-10-16', dueTime: null });
    // The answer says what was added, from the server's own write.
    expect(response.commitments?.items.filter((item) => item.status === 'accepted').map((item) => item.taskExists)).toEqual([true, true]);
  });

  it('links a series occurrence to the master meeting, and a deleted or missing meeting to none', async () => {
    const series = await setup({ seed: { match: autoMatch({ occurrenceDate: '2026-10-16' }) }, meeting: { recurrence: { freq: 'weekly' } } });
    const seriesTask = taskOf(series.h, (await decide(series.h, series.key, [accept(series.items[2] as CommitmentItem)])).results?.[0]?.taskId);
    expect(seriesTask).toMatchObject({ meetingId: MEETING_ID });
    expect(seriesTask?.description).toContain('(Oct 16, 2026)');

    const tombstone = await setup({ meeting: { deletedAt: '2026-10-17T00:00:00.000Z' } });
    expect(taskOf(tombstone.h, (await decide(tombstone.h, tombstone.key, [accept(tombstone.items[2] as CommitmentItem)])).results?.[0]?.taskId)).toMatchObject({ meetingId: null });

    const missing = await setup({ meeting: null });
    expect(taskOf(missing.h, (await decide(missing.h, missing.key, [accept(missing.items[2] as CommitmentItem)])).results?.[0]?.taskId)).toMatchObject({ meetingId: null });
  });

  it('keeps a title the user edited as typed, a phone number included', async () => {
    const { h, items, key } = await setup();
    const typed = 'Call Lee at +1 555 010 9999 about the slides';
    const response = await decide(h, key, [accept(items[2] as CommitmentItem, { title: typed })]);
    expect(taskOf(h, response.results?.[0]?.taskId)?.title).toBe(typed);
  });

  it("rebuilds the '<owner>: ' prefix when the user changes the owner but not the title", () => {
    const suggestion = { title: 'Bish: Send the invoice summary to finance', owner: 'Bish', role: 'other' as const };
    expect(acceptedTitleOf(suggestion, { title: suggestion.title, owner: { name: 'Lee', isUser: false } })).toBe('Lee: Send the invoice summary to finance');
    expect(acceptedTitleOf(suggestion, { title: suggestion.title, owner: { name: 'Dana Ruiz', isUser: true } })).toBe('Send the invoice summary to finance');
    expect(acceptedTitleOf(suggestion, { title: suggestion.title, owner: null })).toBe('Send the invoice summary to finance');
    expect(acceptedTitleOf(suggestion, { title: suggestion.title, owner: { name: 'Bish', isUser: false } })).toBe(suggestion.title);
    expect(acceptedTitleOf(suggestion, { title: 'My own words', owner: { name: 'Lee', isUser: false } })).toBe('My own words');
    expect(acceptedTitleOf({ title: 'Book the offsite venue', owner: null, role: 'none' }, { title: 'Book the offsite venue', owner: { name: 'Lee', isUser: false } })).toBe(
      'Lee: Book the offsite venue',
    );
  });
});

describe('idempotency', () => {
  it('a second tap answers already_added and creates nothing', async () => {
    const { h, items, key } = await setup();
    const first = await decide(h, key, [accept(items[0] as CommitmentItem)]);
    const second = await decide(h, key, [accept(items[0] as CommitmentItem)]);
    expect(first.results?.[0]?.outcome).toBe('added');
    expect(second.results?.[0]).toEqual({ anchorId: items[0]?.anchorId, outcome: 'already_added', taskId: first.results?.[0]?.taskId });
    expect(h.db.paths(TASKS)).toHaveLength(1);
  });

  it('two devices accepting at once create one task', async () => {
    const { h, items, key } = await setup();
    const both = await Promise.all([decide(h, key, [accept(items[0] as CommitmentItem)]), decide(h, key, [accept(items[0] as CommitmentItem)])]);
    expect(both.map((response) => response.results?.[0]?.outcome).sort()).toEqual(['added', 'already_added']);
    expect(h.db.paths(TASKS)).toHaveLength(1);
  });

  it('a WhatsApp reply after the app answers already_added', async () => {
    const { h, items, key } = await setup();
    const app = await decide(h, key, [accept(items[0] as CommitmentItem)]);
    const reply = await decideCommitments(h.db as unknown as Firestore, whatsappInput(h, key, [{ anchorId: items[0]?.anchorId as string, decision: 'accept', draft: null }]));
    expect(reply.kind === 'decided' && reply.results).toEqual([{ anchorId: items[0]?.anchorId, outcome: 'already_added', taskId: app.results?.[0]?.taskId }]);
    expect(h.db.paths(TASKS)).toHaveLength(1);
  });

  it('an old key is stale; a summary that is gone is not_found and gets nothing written', async () => {
    const { h, items, key } = await setup();
    expect(await reasonOf(decide(h, 'x_0000000000000000', [accept(items[0] as CommitmentItem)]))).toBe('stale');
    await h.db.doc(PATH_A).delete();
    expect(await reasonOf(decide(h, key, [accept(items[0] as CommitmentItem)]))).toBe('not_found');
    expect(h.db.has(PATH_A)).toBe(false);
    expect(h.db.paths(TASKS)).toEqual([]);
  });
});

describe('drop, restore, Undo and Add again', () => {
  it('drop and restore move an open suggestion; neither applies to an accepted one, and a dropped one is not accepted', async () => {
    const { h, items, key } = await setup();
    const [a, b] = items as [CommitmentItem, CommitmentItem];
    const dropped = await decide(h, key, [{ anchorId: b.anchorId, decision: 'drop' }, accept(a)]);
    expect(dropped.results?.map((result) => result.outcome)).toEqual(['dropped', 'added']);
    expect(dropped.commitments?.items[1]?.status).toBe('dropped');
    expect((await decide(h, key, [accept(b)])).results?.[0]?.outcome).toBe('not_open');
    expect((await decide(h, key, [{ anchorId: a.anchorId, decision: 'drop' }])).results?.[0]?.outcome).toBe('not_open');
    expect((await decide(h, key, [{ anchorId: a.anchorId, decision: 'restore' }])).results?.[0]?.outcome).toBe('not_open');
    const restored = await decide(h, key, [{ anchorId: b.anchorId, decision: 'restore' }]);
    expect(restored.results?.[0]?.outcome).toBe('restored');
    expect(restored.commitments?.items[1]?.status).toBe('open');
    // Counts for the lists follow.
    expect(parseExtraction(h.db.data(PATH_A)?.extraction)?.counts).toEqual({ open: 3, accepted: 1, dropped: 0 });
  });

  it('Undo removes the task while its visible fields are unchanged (a To Do write-back does not count), then a new id', async () => {
    const { h, items, key } = await setup();
    const added = await decide(h, key, [accept(items[0] as CommitmentItem)]);
    const taskId = added.results?.[0]?.taskId as string;
    const task = taskOf(h, taskId) as Record<string, unknown>;
    h.db.seed(`${TASKS}${taskId}`, {
      ...task,
      pushPending: false,
      updatedAt: '2026-10-17T15:00:05.000Z',
      external: { todoListId: 'L1', todoTaskId: 'T1', todoUpdatedAt: '2026-10-17T15:00:05.000Z', gtasksListId: null, gtasksTaskId: null, gtasksUpdatedAt: null },
    });
    const removed = await decide(h, key, [{ anchorId: items[0]?.anchorId, decision: 'remove' }]);
    expect(removed.results?.[0]).toEqual({ anchorId: items[0]?.anchorId, outcome: 'removed', taskId });
    expect(h.db.has(`${TASKS}${taskId}`)).toBe(false);
    expect(removed.commitments?.items[0]?.status).toBe('open');
    const again = await decide(h, key, [accept(items[0] as CommitmentItem)]);
    expect(again.results?.[0]?.outcome).toBe('added');
    expect(again.results?.[0]?.taskId).not.toBe(taskId);
  });

  it('Undo of a renamed task answers changed and leaves the task alone', async () => {
    const { h, items, key } = await setup();
    const taskId = (await decide(h, key, [accept(items[0] as CommitmentItem)])).results?.[0]?.taskId as string;
    h.db.seed(`${TASKS}${taskId}`, { ...(taskOf(h, taskId) as Record<string, unknown>), title: 'Renamed by the user' });
    const changed = await decide(h, key, [{ anchorId: items[0]?.anchorId, decision: 'remove' }]);
    expect(changed.results?.[0]).toEqual({ anchorId: items[0]?.anchorId, outcome: 'changed', taskId });
    expect(h.db.has(`${TASKS}${taskId}`)).toBe(true);
    expect(changed.commitments?.items[0]?.status).toBe('accepted');
  });

  it('Undo of a task accepted before a data-key rotation still removes it (fd under every key; review P2)', async () => {
    const { h, items, key } = await setup();
    const taskId = (await decide(h, key, [accept(items[0] as CommitmentItem)])).results?.[0]?.taskId as string;
    h.keys.ring = ROTATED_KEYRING;
    const removed = await decide(h, key, [{ anchorId: items[0]?.anchorId, decision: 'remove' }]);
    expect(removed.results?.[0]).toEqual({ anchorId: items[0]?.anchorId, outcome: 'removed', taskId });
    expect(h.db.has(`${TASKS}${taskId}`)).toBe(false);
    // A rename is still a change under the new key.
    const again = (await decide(h, key, [accept(items[0] as CommitmentItem)])).results?.[0]?.taskId as string;
    h.db.seed(`${TASKS}${again}`, { ...(taskOf(h, again) as Record<string, unknown>), title: 'Renamed by the user' });
    expect((await decide(h, key, [{ anchorId: items[0]?.anchorId, decision: 'remove' }])).results?.[0]?.outcome).toBe('changed');
  });

  it('two lines that differ only in case or spacing get their own keys: one decide adds two tasks, a repeat adds none (review S4)', async () => {
    const h = harness();
    const twins = ['Ops sync', 'Meeting notes 2026-10-16', '', 'Action items', '[ ] Send the deck to Acme (owner: Lee)', '[ ] send the deck  to Acme (owner: Lee)'].join('\n');
    seedSummary(h.db, SUMMARY_A, { text: twins });
    seedMeeting(h.db);
    const prepared = await call(h, { op: 'prepare', summaryId: SUMMARY_A, mode: 'as_written' });
    const items = prepared.commitments?.items ?? [];
    expect(items).toHaveLength(2);
    const keys = parseExtraction(h.db.data(PATH_A)?.extraction)?.views.as_written?.items.map((item) => item.k) ?? [];
    expect(new Set(keys).size).toBe(2);
    const key = prepared.commitments?.key as string;
    const first = await decide(h, key, items.map((item) => accept(item)));
    expect(first.results?.map((result) => result.outcome)).toEqual(['added', 'added']);
    expect(new Set(first.results?.map((result) => result.taskId)).size).toBe(2);
    const second = await decide(h, key, items.map((item) => accept(item)));
    expect(second.results?.map((result) => result.outcome)).toEqual(['already_added', 'already_added']);
    expect(h.db.paths(TASKS)).toHaveLength(2);
  });

  it('a second line sharing a key inside one call is already_added, never a second task; Undo in the same call leaves no task behind (review S4)', async () => {
    const { h, items, key } = await setup();
    // Force the collision the keys now prevent: two listed lines with one anchor key.
    const doc = h.db.data(PATH_A) as Record<string, unknown>;
    const extraction = parseExtraction(doc.extraction);
    const view = extraction?.views.as_written;
    if (extraction === null || extraction === undefined || view === null || view === undefined) throw new Error('fixture');
    const shared = view.items[2]?.k as string;
    const collided = { ...extraction, views: { ...extraction.views, as_written: { ...view, items: view.items.map((item, index) => (index === 3 ? { ...item, k: shared } : item)) } } };
    h.db.seed(PATH_A, { ...doc, extraction: collided });
    const both = await decide(h, key, [accept(items[2] as CommitmentItem), accept(items[3] as CommitmentItem)]);
    expect(both.results?.map((result) => result.outcome)).toEqual(['added', 'already_added']);
    expect(both.results?.[1]?.taskId).toBe(both.results?.[0]?.taskId);
    expect(h.db.paths(TASKS)).toHaveLength(1);
    const undone = await decide(h, key, [{ anchorId: items[3]?.anchorId, decision: 'remove' }]);
    expect(undone.results?.[0]?.outcome).toBe('removed');
    expect(h.db.paths(TASKS)).toEqual([]);
    // Accept and Undo of one key in the same call: created, then dropped again before the write.
    const sameCall = await decide(h, key, [accept(items[2] as CommitmentItem), { anchorId: items[3]?.anchorId, decision: 'remove' }]);
    expect(sameCall.results?.map((result) => result.outcome)).toEqual(['added', 'removed']);
    expect(h.db.paths(TASKS)).toEqual([]);
  });

  it('a task deleted in Tasks shows as removed, and Add again gets a new id', async () => {
    const { h, items, key } = await setup();
    const taskId = (await decide(h, key, [accept(items[2] as CommitmentItem)])).results?.[0]?.taskId as string;
    await h.db.doc(`${TASKS}${taskId}`).delete();
    const got = await call(h, { op: 'get', summaryId: SUMMARY_A });
    expect(got.commitments?.items[2]).toMatchObject({ status: 'accepted', taskId, taskExists: false });
    const again = await decide(h, key, [accept(items[2] as CommitmentItem)]);
    expect(again.results?.[0]?.outcome).toBe('added');
    expect(again.results?.[0]?.taskId).not.toBe(taskId);
    expect(again.commitments?.items[2]).toMatchObject({ status: 'accepted', taskExists: true });
  });
});

describe('invalid decisions', () => {
  it('31 decisions, broken due invariants, a repeated anchor, a malformed zone or a blank title fail the whole call; nothing is written', async () => {
    const { h, items, key } = await setup();
    const before = JSON.stringify(h.db.data(PATH_A));
    const many = Array.from({ length: 31 }, (_, index) => ({ anchorId: `i_${index.toString(16).padStart(12, '0')}`, decision: 'drop' }));
    expect(await reasonOf(decide(h, key, many))).toBe('invalid_request');
    expect(await reasonOf(decide(h, key, [accept(items[0] as CommitmentItem, { dueDate: null, dueTime: '10:00', reminderMinutesBefore: null })]))).toBe('invalid_request');
    expect(await reasonOf(decide(h, key, [accept(items[0] as CommitmentItem, { dueTime: null, reminderMinutesBefore: 30 })]))).toBe('invalid_request');
    expect(await reasonOf(decide(h, key, [accept(items[0] as CommitmentItem), { anchorId: items[0]?.anchorId, decision: 'drop' }]))).toBe('invalid_request');
    // The zod shape check still holds for a zone that is not even a zone name.
    expect(await reasonOf(decide(h, key, [accept(items[0] as CommitmentItem)], { timezone: 'not a zone; drop' }))).toBe('invalid_request');
    expect(await reasonOf(decide(h, key, [accept(items[1] as CommitmentItem), accept(items[0] as CommitmentItem, { title: '   ' })]))).toBe('invalid_request');
    expect(h.db.paths(TASKS)).toEqual([]);
    expect(JSON.stringify(h.db.data(PATH_A))).toBe(before);
  });

  it('a well-formed device zone the server does not know falls back to the meeting zone instead of refusing; drop needs no zone (review P3)', async () => {
    const { h, items, key } = await setup();
    const response = await decide(h, key, [accept(items[3] as CommitmentItem), { anchorId: items[2]?.anchorId, decision: 'drop' }], { timezone: 'Mars/Olympus' });
    expect(response.results?.map((result) => result.outcome)).toEqual(['added', 'dropped']);
    expect(taskOf(h, response.results?.[0]?.taskId)).toMatchObject({ timezone: 'America/Mexico_City', dueDate: null, dueTime: null, reminderMinutesBefore: null });
  });
});

describe('zones and defaults (no draft: WhatsApp)', () => {
  it('a WhatsApp user without a preferences zone gets the meeting zone: tomorrow 9:00 local, reminder at the time', async () => {
    const { h, items, key } = await setup();
    const result = await decideCommitments(h.db as unknown as Firestore, whatsappInput(h, key, [{ anchorId: items[3]?.anchorId as string, decision: 'accept', draft: null }]));
    const taskId = result.kind === 'decided' ? result.results[0]?.taskId : null;
    expect(taskOf(h, taskId)).toMatchObject({ timezone: 'America/Mexico_City', dueDate: '2026-10-18', dueTime: '09:00', reminderMinutesBefore: 0, people: [] });
  });

  it("'tomorrow' at 23:30 in Mexico City is the next local date, not two days ahead", async () => {
    const { h, items, key } = await setup();
    h.clock.now = new Date('2026-10-18T05:30:00.000Z');
    const result = await decideCommitments(
      h.db as unknown as Firestore,
      whatsappInput(h, key, [{ anchorId: items[3]?.anchorId as string, decision: 'accept', draft: null }], { preferencesZone: 'America/Mexico_City', now: h.clock.now }),
    );
    const taskId = result.kind === 'decided' ? result.results[0]?.taskId : null;
    expect(taskOf(h, taskId)).toMatchObject({ timezone: 'America/Mexico_City', dueDate: '2026-10-18', dueTime: '09:00' });
  });

  it('a kept summary with no usable zone gets no default reminder (never 9:00 UTC)', async () => {
    const { h, items, key } = await setup({ seed: { status: 'kept' }, meeting: null });
    for (const preferencesZone of [null, 'UTC', 'Etc/UTC']) {
      const result = await decideCommitments(
        h.db as unknown as Firestore,
        whatsappInput(h, key, [{ anchorId: items[3]?.anchorId as string, decision: 'accept', draft: null }], { preferencesZone }),
      );
      const taskId = result.kind === 'decided' ? result.results[0]?.taskId : null;
      expect([preferencesZone, taskOf(h, taskId)]).toEqual([
        preferencesZone,
        expect.objectContaining({ timezone: 'UTC', dueDate: null, dueTime: null, reminderMinutesBefore: null, meetingId: null }),
      ]);
      // Undo, so the next zone writes a new task.
      await decideCommitments(h.db as unknown as Firestore, whatsappInput(h, key, [{ anchorId: items[3]?.anchorId as string, decision: 'remove', draft: null }], { preferencesZone }));
    }
  });

  it('a stated date and time keep the meeting zone with the reminder 60 minutes before; an overdue date has no reminder', async () => {
    const { h, items, key } = await setup();
    const result = await decideCommitments(
      h.db as unknown as Firestore,
      whatsappInput(h, key, [
        { anchorId: items[0]?.anchorId as string, decision: 'accept', draft: null },
        { anchorId: items[1]?.anchorId as string, decision: 'accept', draft: null },
      ]),
    );
    const ids = result.kind === 'decided' ? result.results.map((entry) => entry.taskId) : [];
    expect(taskOf(h, ids[0])).toMatchObject({ timezone: 'America/Mexico_City', dueDate: '2026-10-20', dueTime: '15:00', reminderMinutesBefore: 60 });
    expect(taskOf(h, ids[1])).toMatchObject({ dueDate: '2026-10-16', dueTime: null, reminderMinutesBefore: null, people: [] });
    const got = await call(h, { op: 'get', summaryId: SUMMARY_A });
    expect(got.commitments?.items[1]?.due).toMatchObject({ date: '2026-10-16', time: null, zone: null, overdue: true, quote: '2026-10-16' });
    expect(got.commitments?.items[0]?.due).toMatchObject({ date: '2026-10-20', time: '15:00', zone: 'America/Mexico_City', overdue: false });
    expect(got.commitments?.items[0]?.via).toBe('whatsapp');
  });

  it('in the app, a changed time follows the phone zone', async () => {
    const { h, items, key } = await setup();
    const response = await decide(h, key, [accept(items[0] as CommitmentItem, { dueTime: '16:00' })], { timezone: 'Europe/Madrid' });
    expect(taskOf(h, response.results?.[0]?.taskId)).toMatchObject({ timezone: 'Europe/Madrid', dueTime: '16:00' });
  });
});
