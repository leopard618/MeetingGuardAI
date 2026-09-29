import {
  ackEntry,
  EMPTY_OUTBOX,
  enqueueWrite,
  hasPending,
  orderedEntries,
  parseOutbox,
  recordFailure,
  type OutboxState,
  type OutboxWrite,
} from '../outbox';

let counter = 0;
function ctx(): { id: string; now: string } {
  counter += 1;
  return { id: `e${counter}`, now: '2026-10-01T10:00:00.000Z' };
}

function meetingWrite(docId: string, mode: OutboxWrite['mode'], title: string, updatedAt = '2026-10-01T10:00:00.000Z'): OutboxWrite {
  return { kind: 'meeting', docId, mode, data: mode === 'delete' ? null : { title }, updatedAt, origin: 'user' };
}

describe('outbox reducer', () => {
  beforeEach(() => {
    counter = 0;
  });

  it('keeps FIFO order across documents', () => {
    let state: OutboxState = EMPTY_OUTBOX;
    state = enqueueWrite(state, meetingWrite('a', 'create', 'A'), ctx());
    state = enqueueWrite(state, meetingWrite('b', 'create', 'B'), ctx());
    state = enqueueWrite(state, { kind: 'note', docId: 'n1', mode: 'create', data: { title: 'N' }, updatedAt: 'x', origin: 'user' }, ctx());
    expect(orderedEntries(state).map((entry) => entry.docId)).toEqual(['a', 'b', 'n1']);
    expect(orderedEntries(state).map((entry) => entry.seq)).toEqual([1, 2, 3]);
  });

  it('coalesces writes to the same document in place with the latest state and a new entry id', () => {
    let state = enqueueWrite(EMPTY_OUTBOX, meetingWrite('a', 'create', 'v1'), ctx());
    state = enqueueWrite(state, meetingWrite('b', 'set', 'B'), ctx());
    const firstId = state.entries[0]?.id;
    state = enqueueWrite(state, meetingWrite('a', 'set', 'v2', '2026-10-01T10:05:00.000Z'), ctx());

    expect(state.entries).toHaveLength(2);
    const a = orderedEntries(state)[0];
    expect(a?.docId).toBe('a');
    expect(a?.mode).toBe('create'); // still create-if-absent: it was never sent
    expect(a?.data).toEqual({ title: 'v2' });
    expect(a?.updatedAt).toBe('2026-10-01T10:05:00.000Z');
    expect(a?.id).not.toBe(firstId);
  });

  it('turns create/set followed by delete into a delete, and delete followed by set into a set', () => {
    let state = enqueueWrite(EMPTY_OUTBOX, { kind: 'note', docId: 'n', mode: 'create', data: { t: 1 }, updatedAt: 'x', origin: 'user' }, ctx());
    state = enqueueWrite(state, { kind: 'note', docId: 'n', mode: 'delete', data: null, updatedAt: 'y', origin: 'user' }, ctx());
    expect(state.entries[0]).toMatchObject({ mode: 'delete', data: null });
    state = enqueueWrite(state, { kind: 'note', docId: 'n', mode: 'set', data: { t: 2 }, updatedAt: 'z', origin: 'user' }, ctx());
    expect(state.entries[0]).toMatchObject({ mode: 'set', data: { t: 2 } });
  });

  it('merges preference patches field by field but keeps the bootstrap create separate', () => {
    let state = enqueueWrite(
      EMPTY_OUTBOX,
      { kind: 'preferences', docId: 'preferences', mode: 'create', data: { language: 'en', alertEnabled: true }, updatedAt: 'a', origin: 'system' },
      ctx(),
    );
    state = enqueueWrite(state, { kind: 'preferences', docId: 'preferences', mode: 'merge', data: { alertIntensity: 'light' }, updatedAt: 'b', origin: 'user' }, ctx());
    state = enqueueWrite(state, { kind: 'preferences', docId: 'preferences', mode: 'merge', data: { language: 'es' }, updatedAt: 'c', origin: 'user' }, ctx());
    expect(state.entries).toHaveLength(2);
    expect(orderedEntries(state).map((entry) => entry.mode)).toEqual(['create', 'merge']);
    expect(orderedEntries(state)[1]?.data).toEqual({ alertIntensity: 'light', language: 'es' });
  });

  it('acks by entry id: a replacement queued during the send survives, and becomes a set after our create was written', () => {
    let state = enqueueWrite(EMPTY_OUTBOX, meetingWrite('a', 'create', 'v1'), ctx());
    const inFlight = state.entries[0];
    if (!inFlight) throw new Error('missing entry');
    state = enqueueWrite(state, meetingWrite('a', 'set', 'v2'), ctx()); // user edit while sending
    state = ackEntry(state, inFlight, 'written');
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]).toMatchObject({ mode: 'set', data: { title: 'v2' } });

    const acked = ackEntry(state, state.entries[0]!, 'written');
    expect(acked.entries).toHaveLength(0);
    expect(hasPending(acked, 'meeting', 'a')).toBe(false);
  });

  it('records failures and parses persisted state, dropping invalid entries', () => {
    let state = enqueueWrite(EMPTY_OUTBOX, meetingWrite('a', 'create', 'A'), ctx());
    state = recordFailure(state, state.entries[0]!.id, 'offline');
    expect(state.entries[0]).toMatchObject({ attempts: 1, lastError: 'offline' });

    const raw = JSON.parse(JSON.stringify({ ...state, entries: [...state.entries, { bogus: true }] })) as unknown;
    const parsed = parseOutbox(raw);
    expect(parsed.dropped).toBe(1);
    expect(parsed.state.entries).toEqual(state.entries);
    expect(parsed.state.seq).toBe(1);
    expect(parseOutbox(null).state.entries).toEqual([]);
  });
});
