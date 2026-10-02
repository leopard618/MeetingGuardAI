import { type ZoomClient, type ZoomCreateMeetingInput, type ZoomCreatedMeeting, type ZoomMeetingPatch } from '../../src/zoom/api';
import { ZoomApiError } from '../../src/zoom/errors';
import {
  handleZoomCreateMeeting,
  handleZoomDeleteMeeting,
  handleZoomSyncMeeting,
  storedZoomMeetingId,
  usableTimeZone,
  zoomStartTimeUtc,
  zoomTopic,
  type ZoomHandlerDeps,
  type ZoomStore,
  type ZoomStoreTransaction,
  type ZoomUsageField,
} from '../../src/zoom/handler';

jest.mock('firebase-functions/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const UID = 'user_1';
const NOW = new Date('2026-10-01T10:00:00.000Z');
const DAY = '2026-10-01';

// ---------------------------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------------------------

class FakeZoomStore implements ZoomStore {
  readonly meetings = new Map<string, Record<string, unknown>>();
  readonly usage = new Map<string, number>();
  readonly updates: { meetingId: string; fields: Record<string, unknown> }[] = [];
  /** When set, transaction reads see THIS data instead (simulates a concurrent edit). */
  txMeetingOverride: Record<string, unknown> | 'missing' | null = null;

  usageKey(field: ZoomUsageField, day = DAY): string {
    return `${field}/${day}`;
  }

  setUsage(field: ZoomUsageField, count: number): void {
    this.usage.set(this.usageKey(field), count);
  }

  count(field: ZoomUsageField): number {
    return this.usage.get(this.usageKey(field)) ?? 0;
  }

  async getMeeting(_uid: string, meetingId: string): Promise<unknown> {
    return this.meetings.get(meetingId);
  }

  async findMeetingByZoomId(_uid: string, zoomMeetingId: string): Promise<{ id: string } | null> {
    for (const [id, data] of this.meetings) {
      const external = data.external as Record<string, unknown> | undefined;
      if (external && external.zoomMeetingId === zoomMeetingId) return { id };
    }
    return null;
  }

  async runTransaction<T>(fn: (tx: ZoomStoreTransaction) => Promise<T>): Promise<T> {
    const writes: (() => void)[] = [];
    const result = await fn({
      getMeeting: async (_uid, meetingId) => {
        if (this.txMeetingOverride === 'missing') return undefined;
        if (this.txMeetingOverride !== null) return this.txMeetingOverride;
        return this.meetings.get(meetingId);
      },
      updateMeetingFields: (_uid, meetingId, fields) => {
        writes.push(() => this.updates.push({ meetingId, fields }));
      },
      readUsageField: async (_uid, dayKey, field) => this.usage.get(`${field}/${dayKey}`) ?? 0,
      writeUsageField: (_uid, dayKey, field, count) => {
        writes.push(() => this.usage.set(`${field}/${dayKey}`, count));
      },
    });
    writes.forEach((write) => write());
    return result;
  }
}

class FakeZoomClient implements ZoomClient {
  readonly created: ZoomCreateMeetingInput[] = [];
  readonly updated: { zoomMeetingId: string; patch: ZoomMeetingPatch }[] = [];
  readonly deleted: string[] = [];
  createResult: ZoomCreatedMeeting | Error = {
    zoomMeetingId: '987654321',
    joinUrl: 'https://zoom.us/j/987654321?pwd=abc',
    passcode: 'abc123',
  };
  updateResult: 'updated' | 'gone' | Error = 'updated';
  deleteResult: 'deleted' | 'gone' | Error = 'deleted';

  async createMeeting(input: ZoomCreateMeetingInput): Promise<ZoomCreatedMeeting> {
    this.created.push(input);
    if (this.createResult instanceof Error) throw this.createResult;
    return this.createResult;
  }

  async updateMeeting(zoomMeetingId: string, patch: ZoomMeetingPatch): Promise<'updated' | 'gone'> {
    this.updated.push({ zoomMeetingId, patch });
    if (this.updateResult instanceof Error) throw this.updateResult;
    return this.updateResult;
  }

  async deleteMeeting(zoomMeetingId: string): Promise<'deleted' | 'gone'> {
    this.deleted.push(zoomMeetingId);
    if (this.deleteResult instanceof Error) throw this.deleteResult;
    return this.deleteResult;
  }
}

function zoomDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'Weekly sync',
    startAt: '2026-10-05T14:00:00.000Z',
    durationMinutes: 45,
    timezone: 'Europe/Madrid',
    deletedAt: null,
    conference: { provider: 'zoom', url: null, password: null },
    external: {},
    ...overrides,
  };
}

function depsWith(
  store: FakeZoomStore,
  client: FakeZoomClient,
  overrides: Partial<ZoomHandlerDeps> = {},
): ZoomHandlerDeps {
  return {
    store,
    client: () => client,
    now: () => NOW,
    createDailyLimit: () => 30,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------

describe('zoom handler helpers', () => {
  it('zoomTopic trims, truncates to 200 chars and never sends an empty topic', () => {
    expect(zoomTopic('  Weekly sync  ')).toBe('Weekly sync');
    expect(zoomTopic('x'.repeat(300))).toHaveLength(200);
    expect(zoomTopic('   ')).toBe('Meeting');
  });

  it('zoomStartTimeUtc renders UTC without milliseconds and rejects garbage', () => {
    expect(zoomStartTimeUtc('2026-10-05T16:00:00.000+02:00')).toBe('2026-10-05T14:00:00Z');
    expect(zoomStartTimeUtc('not a date')).toBeNull();
  });

  it('usableTimeZone keeps known zones and drops unknown ones', () => {
    expect(usableTimeZone('Europe/Madrid')).toBe('Europe/Madrid');
    expect(usableTimeZone('Mars/Olympus')).toBeNull();
  });

  it('storedZoomMeetingId only accepts plausible Zoom meeting numbers (client-writable field)', () => {
    expect(storedZoomMeetingId({ zoomMeetingId: '987654321' })).toBe('987654321');
    expect(storedZoomMeetingId({})).toBeNull();
    expect(storedZoomMeetingId({ zoomMeetingId: 987654321 })).toBeNull();
    expect(storedZoomMeetingId({ zoomMeetingId: '../admin' })).toBeNull();
    expect(storedZoomMeetingId({ zoomMeetingId: '1'.repeat(33) })).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// zoomCreateMeeting
// ---------------------------------------------------------------------------------------------

describe('handleZoomCreateMeeting', () => {
  it('creates the Zoom meeting, writes the link transactionally and counts the create', async () => {
    const store = new FakeZoomStore();
    store.meetings.set('m1', zoomDoc());
    const client = new FakeZoomClient();

    const response = await handleZoomCreateMeeting(UID, { meetingId: 'm1' }, depsWith(store, client));

    expect(response).toEqual({
      url: 'https://zoom.us/j/987654321?pwd=abc',
      password: 'abc123',
      zoomMeetingId: '987654321',
    });
    expect(client.created).toEqual([
      { topic: 'Weekly sync', startTimeUtc: '2026-10-05T14:00:00Z', durationMinutes: 45, timezone: 'Europe/Madrid' },
    ]);
    expect(store.updates).toEqual([
      {
        meetingId: 'm1',
        fields: {
          'conference.url': 'https://zoom.us/j/987654321?pwd=abc',
          'conference.password': 'abc123',
          'external.zoomMeetingId': '987654321',
          updatedAt: NOW.toISOString(),
        },
      },
    ]);
    expect(store.count('zoomCreates')).toBe(1);
    expect(store.count('zoomOps')).toBe(0);
  });

  it('is idempotent: an existing stored link is returned without calling Zoom or counting', async () => {
    const store = new FakeZoomStore();
    store.meetings.set(
      'm1',
      zoomDoc({
        conference: { provider: 'zoom', url: 'https://zoom.us/j/111?pwd=x', password: null },
        external: { zoomMeetingId: '111' },
      }),
    );
    const client = new FakeZoomClient();

    const response = await handleZoomCreateMeeting(UID, { meetingId: 'm1' }, depsWith(store, client));

    expect(response).toEqual({ url: 'https://zoom.us/j/111?pwd=x', password: null, zoomMeetingId: '111' });
    expect(client.created).toHaveLength(0);
    expect(store.count('zoomCreates')).toBe(0);
    expect(store.updates).toHaveLength(0);
  });

  it('rejects when a link was pasted (paste wins)', async () => {
    const store = new FakeZoomStore();
    store.meetings.set('m1', zoomDoc({ conference: { provider: 'zoom', url: 'https://example.com/call', password: null } }));
    const client = new FakeZoomClient();

    await expect(handleZoomCreateMeeting(UID, { meetingId: 'm1' }, depsWith(store, client))).rejects.toMatchObject({
      code: 'invalid-argument',
      details: { reason: 'invalid_request' },
    });
    expect(client.created).toHaveLength(0);
  });

  it.each([
    ['a missing document', undefined],
    ['a tombstoned document', zoomDoc({ deletedAt: '2026-09-30T00:00:00.000Z' })],
  ])('answers not_found for %s', async (_label, doc) => {
    const store = new FakeZoomStore();
    if (doc) store.meetings.set('m1', doc);
    const client = new FakeZoomClient();

    await expect(handleZoomCreateMeeting(UID, { meetingId: 'm1' }, depsWith(store, client))).rejects.toMatchObject({
      code: 'not-found',
      details: { reason: 'not_found' },
    });
    expect(client.created).toHaveLength(0);
    expect(store.count('zoomCreates')).toBe(0);
  });

  it('rejects a meeting whose provider is not zoom', async () => {
    const store = new FakeZoomStore();
    store.meetings.set('m1', zoomDoc({ conference: { provider: 'google_meet', url: null, password: null } }));

    await expect(handleZoomCreateMeeting(UID, { meetingId: 'm1' }, depsWith(store, new FakeZoomClient()))).rejects.toMatchObject({
      details: { reason: 'invalid_request' },
    });
  });

  it('rejects an unparsable start time before counting the quota', async () => {
    const store = new FakeZoomStore();
    store.meetings.set('m1', zoomDoc({ startAt: 'whenever' }));

    await expect(handleZoomCreateMeeting(UID, { meetingId: 'm1' }, depsWith(store, new FakeZoomClient()))).rejects.toMatchObject({
      details: { reason: 'invalid_request' },
    });
    expect(store.count('zoomCreates')).toBe(0);
  });

  it('enforces the daily create cap without calling Zoom', async () => {
    const store = new FakeZoomStore();
    store.meetings.set('m1', zoomDoc());
    store.setUsage('zoomCreates', 30);
    const client = new FakeZoomClient();

    await expect(handleZoomCreateMeeting(UID, { meetingId: 'm1' }, depsWith(store, client))).rejects.toMatchObject({
      code: 'resource-exhausted',
      details: { reason: 'quota_exceeded' },
    });
    expect(client.created).toHaveLength(0);
    expect(store.count('zoomCreates')).toBe(30);
  });

  it('deletes the created Zoom meeting again when a link appeared while Zoom worked', async () => {
    const store = new FakeZoomStore();
    store.meetings.set('m1', zoomDoc());
    store.txMeetingOverride = zoomDoc({ conference: { provider: 'zoom', url: 'https://pasted.example.com', password: null } });
    const client = new FakeZoomClient();

    await expect(handleZoomCreateMeeting(UID, { meetingId: 'm1' }, depsWith(store, client))).rejects.toMatchObject({
      details: { reason: 'invalid_request' },
    });
    expect(client.deleted).toEqual(['987654321']);
    expect(store.updates).toHaveLength(0);
  });

  it('deletes the created Zoom meeting again when the document vanished while Zoom worked', async () => {
    const store = new FakeZoomStore();
    store.meetings.set('m1', zoomDoc());
    store.txMeetingOverride = 'missing';
    const client = new FakeZoomClient();

    await expect(handleZoomCreateMeeting(UID, { meetingId: 'm1' }, depsWith(store, client))).rejects.toMatchObject({
      details: { reason: 'not_found' },
    });
    expect(client.deleted).toEqual(['987654321']);
  });

  it('replaces a stale stored id without a link and drops the old Zoom meeting', async () => {
    const store = new FakeZoomStore();
    store.meetings.set('m1', zoomDoc({ external: { zoomMeetingId: '111' } }));
    const client = new FakeZoomClient();

    const response = await handleZoomCreateMeeting(UID, { meetingId: 'm1' }, depsWith(store, client));

    expect(response.zoomMeetingId).toBe('987654321');
    expect(store.updates).toHaveLength(1);
    expect(client.deleted).toEqual(['111']);
  });

  it('maps a Zoom 429 to quota_exceeded for the app', async () => {
    const store = new FakeZoomStore();
    store.meetings.set('m1', zoomDoc());
    const client = new FakeZoomClient();
    client.createResult = new ZoomApiError('quota_exceeded', 429, 'Zoom rate limit hit.');

    await expect(handleZoomCreateMeeting(UID, { meetingId: 'm1' }, depsWith(store, client))).rejects.toMatchObject({
      code: 'resource-exhausted',
      details: { reason: 'quota_exceeded' },
    });
  });

  it('maps an unusable Zoom response to upstream_error and cleans the orphan up', async () => {
    const store = new FakeZoomStore();
    store.meetings.set('m1', zoomDoc());
    const client = new FakeZoomClient();
    client.createResult = { zoomMeetingId: '12', joinUrl: 'ftp://zoom.us/j/12', passcode: null };

    await expect(handleZoomCreateMeeting(UID, { meetingId: 'm1' }, depsWith(store, client))).rejects.toMatchObject({
      code: 'unavailable',
      details: { reason: 'upstream_error' },
    });
    expect(client.deleted).toEqual(['12']);
    expect(store.updates).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------
// zoomSyncMeeting
// ---------------------------------------------------------------------------------------------

describe('handleZoomSyncMeeting', () => {
  it('patches the existing Zoom meeting and counts a zoomOp', async () => {
    const store = new FakeZoomStore();
    store.meetings.set('m1', zoomDoc({ title: 'Moved sync', external: { zoomMeetingId: '987654321' } }));
    const client = new FakeZoomClient();

    await expect(handleZoomSyncMeeting(UID, { meetingId: 'm1' }, depsWith(store, client))).resolves.toEqual({ updated: true });
    expect(client.updated).toEqual([
      {
        zoomMeetingId: '987654321',
        patch: { topic: 'Moved sync', startTimeUtc: '2026-10-05T14:00:00Z', durationMinutes: 45, timezone: 'Europe/Madrid' },
      },
    ]);
    expect(store.count('zoomOps')).toBe(1);
  });

  it('no-ops without a stored Zoom id (no Zoom call, no count)', async () => {
    const store = new FakeZoomStore();
    store.meetings.set('m1', zoomDoc());
    const client = new FakeZoomClient();

    await expect(handleZoomSyncMeeting(UID, { meetingId: 'm1' }, depsWith(store, client))).resolves.toEqual({ updated: false });
    expect(client.updated).toHaveLength(0);
    expect(store.count('zoomOps')).toBe(0);
  });

  it('answers not_found for a missing document', async () => {
    await expect(
      handleZoomSyncMeeting(UID, { meetingId: 'm1' }, depsWith(new FakeZoomStore(), new FakeZoomClient())),
    ).rejects.toMatchObject({ details: { reason: 'not_found' } });
  });

  it('reports updated false when the Zoom meeting is gone', async () => {
    const store = new FakeZoomStore();
    store.meetings.set('m1', zoomDoc({ external: { zoomMeetingId: '987654321' } }));
    const client = new FakeZoomClient();
    client.updateResult = 'gone';

    await expect(handleZoomSyncMeeting(UID, { meetingId: 'm1' }, depsWith(store, client))).resolves.toEqual({ updated: false });
  });

  it('enforces the shared ops cap (limit x multiplier)', async () => {
    const store = new FakeZoomStore();
    store.meetings.set('m1', zoomDoc({ external: { zoomMeetingId: '987654321' } }));
    store.setUsage('zoomOps', 300);
    const client = new FakeZoomClient();

    await expect(handleZoomSyncMeeting(UID, { meetingId: 'm1' }, depsWith(store, client))).rejects.toMatchObject({
      details: { reason: 'quota_exceeded' },
    });
    expect(client.updated).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------
// zoomDeleteMeeting
// ---------------------------------------------------------------------------------------------

describe('handleZoomDeleteMeeting', () => {
  it('deletes via the (tombstoned) meeting document and counts a zoomOp', async () => {
    const store = new FakeZoomStore();
    store.meetings.set('m1', zoomDoc({ deletedAt: '2026-10-01T09:00:00.000Z', external: { zoomMeetingId: '987654321' } }));
    const client = new FakeZoomClient();

    await expect(
      handleZoomDeleteMeeting(UID, { meetingId: 'm1', zoomMeetingId: null }, depsWith(store, client)),
    ).resolves.toEqual({ deleted: true });
    expect(client.deleted).toEqual(['987654321']);
    expect(store.count('zoomOps')).toBe(1);
  });

  it('reports deleted false when the document never referenced a Zoom meeting', async () => {
    const store = new FakeZoomStore();
    store.meetings.set('m1', zoomDoc());
    const client = new FakeZoomClient();

    await expect(
      handleZoomDeleteMeeting(UID, { meetingId: 'm1', zoomMeetingId: null }, depsWith(store, client)),
    ).resolves.toEqual({ deleted: false });
    expect(client.deleted).toHaveLength(0);
    expect(store.count('zoomOps')).toBe(0);
  });

  it('accepts a bare zoomMeetingId that belongs to one of the CALLER\'s meetings', async () => {
    const store = new FakeZoomStore();
    store.meetings.set('m2', zoomDoc({ external: { zoomMeetingId: '555' } }));
    const client = new FakeZoomClient();

    await expect(
      handleZoomDeleteMeeting(UID, { meetingId: null, zoomMeetingId: '555' }, depsWith(store, client)),
    ).resolves.toEqual({ deleted: true });
    expect(client.deleted).toEqual(['555']);
  });

  it('denies a bare zoomMeetingId that no caller-owned meeting references', async () => {
    const store = new FakeZoomStore();
    store.meetings.set('m2', zoomDoc({ external: { zoomMeetingId: '555' } }));
    const client = new FakeZoomClient();

    await expect(
      handleZoomDeleteMeeting(UID, { meetingId: null, zoomMeetingId: '999' }, depsWith(store, client)),
    ).rejects.toMatchObject({ code: 'not-found', details: { reason: 'not_found' } });
    expect(client.deleted).toHaveLength(0);
    expect(store.count('zoomOps')).toBe(0);
  });

  it('answers not_found when only a meetingId is given and the document is gone', async () => {
    await expect(
      handleZoomDeleteMeeting(UID, { meetingId: 'm1', zoomMeetingId: null }, depsWith(new FakeZoomStore(), new FakeZoomClient())),
    ).rejects.toMatchObject({ details: { reason: 'not_found' } });
  });

  it('falls back to the bare id (with the ownership check) when the document is already gone', async () => {
    const store = new FakeZoomStore();
    store.meetings.set('m2', zoomDoc({ external: { zoomMeetingId: '555' } }));
    const client = new FakeZoomClient();

    await expect(
      handleZoomDeleteMeeting(UID, { meetingId: 'm1', zoomMeetingId: '555' }, depsWith(store, client)),
    ).resolves.toEqual({ deleted: true });
    expect(client.deleted).toEqual(['555']);
  });

  it('treats a Zoom 404 as deleted', async () => {
    const store = new FakeZoomStore();
    store.meetings.set('m1', zoomDoc({ external: { zoomMeetingId: '987654321' } }));
    const client = new FakeZoomClient();
    client.deleteResult = 'gone';

    await expect(
      handleZoomDeleteMeeting(UID, { meetingId: 'm1', zoomMeetingId: null }, depsWith(store, client)),
    ).resolves.toEqual({ deleted: true });
  });

  it('enforces the shared ops cap', async () => {
    const store = new FakeZoomStore();
    store.meetings.set('m1', zoomDoc({ external: { zoomMeetingId: '987654321' } }));
    store.setUsage('zoomOps', 300);
    const client = new FakeZoomClient();

    await expect(
      handleZoomDeleteMeeting(UID, { meetingId: 'm1', zoomMeetingId: null }, depsWith(store, client)),
    ).rejects.toMatchObject({ details: { reason: 'quota_exceeded' } });
    expect(client.deleted).toHaveLength(0);
  });
});
