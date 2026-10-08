/**
 * Server-side confirmed-action executor (functions/src/whatsapp/executor.ts): contract
 * re-validation, rules-compatible document shapes, ownership scoping, unsupported scopes,
 * zoom hooks (best effort) and the read-only share/list formatting.
 */
jest.mock('firebase-functions/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

import type { AiAction } from '../../src/shared/aiContract';
import {
  LIST_REPLY_LIMIT,
  WHATSAPP_TOMBSTONE_TITLE,
  draftToMeetingDoc,
  executeConfirmedActions,
  formatMeetingForShare,
  formatMeetingList,
  tombstoneFieldUpdates,
  type MeetingStore,
  type ZoomHooks,
} from '../../src/whatsapp/executor';

const NOW = new Date('2026-10-05T12:00:00.000Z');

class FakeMeetingStore implements MeetingStore {
  docs = new Map<string, Record<string, unknown>>();
  ids: string[] = ['new1', 'new2'];

  key(uid: string, id: string): string {
    return `${uid}/${id}`;
  }
  async getMeeting(uid: string, meetingId: string): Promise<unknown> {
    return this.docs.get(this.key(uid, meetingId));
  }
  async createMeeting(uid: string, meetingId: string, doc: Record<string, unknown>): Promise<void> {
    if (this.docs.has(this.key(uid, meetingId))) throw new Error('already exists');
    this.docs.set(this.key(uid, meetingId), { ...doc });
  }
  async updateMeetingFields(uid: string, meetingId: string, fields: Record<string, unknown>): Promise<void> {
    const doc = this.docs.get(this.key(uid, meetingId));
    if (!doc) throw new Error('missing');
    Object.assign(doc, fields);
  }
  newMeetingId(): string {
    return this.ids.shift() ?? 'overflow';
  }
}

function storedMeeting(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    userId: 'u1',
    title: 'Weekly sync',
    description: 'notes',
    startAt: '2026-10-06T14:00:00.000Z',
    durationMinutes: 60,
    timezone: 'Europe/Madrid',
    allDay: false,
    status: 'scheduled',
    source: 'manual',
    participants: [],
    location: null,
    conference: null,
    external: {},
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    deletedAt: null,
    ...overrides,
  };
}

const draft = {
  title: 'Dentist',
  description: '',
  startAt: '2026-10-07T09:30:00.000+02:00',
  durationMinutes: 30,
  timezone: 'Europe/Madrid',
  allDay: false,
  location: null,
  conference: null,
  participants: [{ email: 'Ana@Example.com', name: ' Ana ' }],
  preparationTips: [' bring insurance card ', ' '],
  customAlertTimes: [5, 60, 5],
  language: 'en' as const,
};

function createAction(overrides: Partial<Extract<AiAction, { type: 'create_meeting' }>> = {}): AiAction {
  return { type: 'create_meeting', id: 'a1', summary: 'Create Dentist', confidence: 90, meeting: draft, ...overrides };
}

describe('draftToMeetingDoc', () => {
  it('builds the exact shape firestore.rules isValidMeeting accepts, with source whatsapp', () => {
    const doc = draftToMeetingDoc('u1', 'm1', draft, 90, NOW, 'UTC');
    expect(doc).toMatchObject({
      userId: 'u1',
      title: 'Dentist',
      startAt: '2026-10-07T07:30:00.000Z', // normalized to UTC Z (the rules require ...Z)
      durationMinutes: 30,
      timezone: 'Europe/Madrid',
      allDay: false,
      date: '2026-10-07',
      time: '09:30',
      source: 'whatsapp',
      confidence: 90,
      language: 'en',
      status: 'scheduled',
      external: {},
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      deletedAt: null,
    });
    expect(doc.participants).toEqual([{ email: 'ana@example.com', name: 'Ana', status: null }]);
    expect(doc.preparationTips).toEqual(['bring insurance card']);
    expect(doc.customAlertTimes).toEqual([60, 5]); // deduped, largest first (app parity)
    expect(doc).not.toHaveProperty('recurrence'); // sparse like SPARSE_MEETING_KEYS
    expect(doc).not.toHaveProperty('seriesId');
  });

  it('stores a recurrence rule sparsely and stamps seriesId = id', () => {
    const rule = { freq: 'weekly' as const, interval: 1, byWeekday: null, byMonthDay: null, until: null, count: null };
    const doc = draftToMeetingDoc('u1', 'm9', { ...draft, recurrence: rule }, 50, NOW, 'UTC');
    expect(doc.recurrence).toEqual(rule);
    expect(doc.seriesId).toBe('m9');
  });

  it('falls back to a usable time zone when the draft zone is not a runtime zone', () => {
    const doc = draftToMeetingDoc('u1', 'm1', { ...draft, timezone: 'Not/AZone' }, 50, NOW, 'Europe/Madrid');
    expect(doc.timezone).toBe('Europe/Madrid');
  });
});

describe('executeConfirmedActions', () => {
  it('creates a meeting and counts it applied', async () => {
    const store = new FakeMeetingStore();
    const result = await executeConfirmedActions('u1', [createAction()], { store, now: () => NOW }, 'UTC');
    expect(result).toEqual({ applied: 1, unsupported: 0, failed: 0 });
    expect(store.docs.get('u1/new1')).toMatchObject({ title: 'Dentist', source: 'whatsapp' });
  });

  it('re-validates with the contract: a malformed stored action never executes', async () => {
    const store = new FakeMeetingStore();
    const evil = { type: 'create_meeting', id: 'a1', summary: 's', confidence: 90, meeting: { title: '' } };
    const result = await executeConfirmedActions('u1', [evil], { store, now: () => NOW }, 'UTC');
    expect(result).toEqual({ applied: 0, unsupported: 0, failed: 1 });
    expect(store.docs.size).toBe(0);
  });

  it('is owner-scoped by construction: another user\'s meeting id resolves to nothing', async () => {
    const store = new FakeMeetingStore();
    store.docs.set('owner/m1', storedMeeting({ userId: 'owner' }));
    const action: AiAction = { type: 'update_meeting', id: 'a1', summary: 's', confidence: 80, meetingId: 'm1', changes: { title: 'Hacked' } };
    const result = await executeConfirmedActions('attacker', [action], { store, now: () => NOW }, 'UTC');
    expect(result).toEqual({ applied: 0, unsupported: 0, failed: 1 });
    expect(store.docs.get('owner/m1')?.title).toBe('Weekly sync');
  });

  it('updates fields and recomputes date/time when startAt changes', async () => {
    const store = new FakeMeetingStore();
    store.docs.set('u1/m1', storedMeeting());
    const action: AiAction = {
      type: 'update_meeting',
      id: 'a1',
      summary: 's',
      confidence: 80,
      meetingId: 'm1',
      changes: { title: 'Renamed', startAt: '2026-10-06T16:00:00.000+02:00' },
    };
    const result = await executeConfirmedActions('u1', [action], { store, now: () => NOW }, 'UTC');
    expect(result.applied).toBe(1);
    const doc = store.docs.get('u1/m1');
    expect(doc).toMatchObject({
      title: 'Renamed',
      startAt: '2026-10-06T14:00:00.000Z',
      date: '2026-10-06',
      time: '16:00',
      updatedAt: NOW.toISOString(),
    });
    expect(doc?.source).toBe('manual'); // untouched fields stay
  });

  it('refuses occurrence/following scopes (app-only recurrence engine)', async () => {
    const store = new FakeMeetingStore();
    store.docs.set('u1/m1', storedMeeting());
    const occurrence: AiAction = {
      type: 'update_meeting',
      id: 'a1',
      summary: 's',
      confidence: 80,
      meetingId: 'm1',
      changes: { title: 'x' },
      scope: 'occurrence',
      occurrenceDate: '2026-10-06',
    };
    const following: AiAction = {
      type: 'delete_meeting',
      id: 'a2',
      summary: 's',
      confidence: 80,
      meetingId: 'm1',
      scope: 'following',
      occurrenceDate: '2026-10-06',
    };
    const result = await executeConfirmedActions('u1', [occurrence, following], { store, now: () => NOW }, 'UTC');
    expect(result).toEqual({ applied: 0, unsupported: 2, failed: 0 });
    expect(store.docs.get('u1/m1')?.title).toBe('Weekly sync');
  });

  it('deletes by tombstoning with the scrub set (content never outlives the delete)', async () => {
    const store = new FakeMeetingStore();
    store.docs.set('u1/m1', storedMeeting({ notes: 'secret', participants: [{ email: 'a@b.co', name: null, status: null }] }));
    const action: AiAction = { type: 'delete_meeting', id: 'a1', summary: 's', confidence: 80, meetingId: 'm1' };
    const result = await executeConfirmedActions('u1', [action], { store, now: () => NOW }, 'UTC');
    expect(result.applied).toBe(1);
    expect(store.docs.get('u1/m1')).toMatchObject({
      title: WHATSAPP_TOMBSTONE_TITLE,
      description: '',
      participants: [],
      notes: null,
      conference: null,
      deletedAt: NOW.toISOString(),
    });
    // Idempotent replay of a delete on an already-tombstoned doc counts applied.
    const again = await executeConfirmedActions('u1', [action], { store, now: () => NOW }, 'UTC');
    expect(again).toEqual({ applied: 1, unsupported: 0, failed: 0 });
  });

  it('bulk-shifts every target and recomputes the local date/time', async () => {
    const store = new FakeMeetingStore();
    store.docs.set('u1/m1', storedMeeting());
    store.docs.set('u1/m2', storedMeeting({ startAt: '2026-10-06T08:00:00.000Z' }));
    const action: AiAction = {
      type: 'bulk_update',
      id: 'a1',
      summary: 's',
      confidence: 80,
      meetingIds: ['m1', 'm2', 'ghost'],
      shiftMinutes: 60,
      changes: null,
    };
    const result = await executeConfirmedActions('u1', [action], { store, now: () => NOW }, 'UTC');
    // Partial bulk = applied AND failed (the reply then says some changes did not land).
    expect(result).toEqual({ applied: 1, unsupported: 0, failed: 1 });
    expect(store.docs.get('u1/m1')?.startAt).toBe('2026-10-06T15:00:00.000Z');
    expect(store.docs.get('u1/m2')?.startAt).toBe('2026-10-06T09:00:00.000Z');

    // A fully successful bulk reports NO failure.
    const clean: AiAction = { type: 'bulk_update', id: 'a2', summary: 's', confidence: 80, meetingIds: ['m1', 'm2'], shiftMinutes: 60, changes: null };
    const cleanResult = await executeConfirmedActions('u1', [clean], { store, now: () => NOW }, 'UTC');
    expect(cleanResult).toEqual({ applied: 1, unsupported: 0, failed: 0 });
  });

  it('calls the zoom ensureLink hook for provider zoom with url null, and survives its failure', async () => {
    const store = new FakeMeetingStore();
    const calls: string[] = [];
    const zoom: ZoomHooks = {
      ensureLink: async (uid, meetingId) => {
        calls.push(`ensure:${uid}/${meetingId}`);
        throw new Error('zoom down');
      },
      sync: async () => undefined,
      remove: async () => undefined,
    };
    const zoomDraft = { ...draft, conference: { provider: 'zoom' as const, url: null, password: null } };
    const result = await executeConfirmedActions('u1', [createAction({ meeting: zoomDraft })], { store, now: () => NOW, zoom }, 'UTC');
    expect(result.applied).toBe(1); // zoom failure is non-fatal; the app heals via ensureLink (section 24)
    expect(calls).toEqual(['ensure:u1/new1']);
    expect(store.docs.get('u1/new1')).toMatchObject({ conference: { provider: 'zoom', url: null, password: null } });
  });

  it('calls zoom sync on schedule-touching updates and zoom remove before a delete', async () => {
    const store = new FakeMeetingStore();
    store.docs.set('u1/m1', storedMeeting({ external: { zoomMeetingId: '123456789' } }));
    const calls: string[] = [];
    const zoom: ZoomHooks = {
      ensureLink: async () => undefined,
      sync: async (uid, meetingId) => {
        calls.push(`sync:${uid}/${meetingId}`);
      },
      remove: async (uid, meetingId, zoomMeetingId) => {
        calls.push(`remove:${uid}/${meetingId}/${zoomMeetingId}`);
      },
    };
    const update: AiAction = { type: 'update_meeting', id: 'a1', summary: 's', confidence: 80, meetingId: 'm1', changes: { durationMinutes: 45 } };
    const del: AiAction = { type: 'delete_meeting', id: 'a2', summary: 's', confidence: 80, meetingId: 'm1' };
    await executeConfirmedActions('u1', [update, del], { store, now: () => NOW, zoom }, 'UTC');
    expect(calls).toEqual(['sync:u1/m1', 'remove:u1/m1/123456789']);
  });

  it('never executes share or list from a pending set (defense in depth)', async () => {
    const store = new FakeMeetingStore();
    store.docs.set('u1/m1', storedMeeting());
    const share: AiAction = { type: 'share_meeting', id: 'a1', summary: 's', confidence: 80, meetingId: 'm1', recipients: [], channel: 'system_share', message: null };
    const list: AiAction = { type: 'list', id: 'a2', summary: 's', confidence: 80, meetingIds: ['m1'] };
    const result = await executeConfirmedActions('u1', [share, list], { store, now: () => NOW }, 'UTC');
    expect(result).toEqual({ applied: 0, unsupported: 2, failed: 0 });
  });
});

describe('share/list formatting', () => {
  it('formats a stored meeting as a forwardable block (no email sending)', async () => {
    const store = new FakeMeetingStore();
    store.docs.set('u1/m1', storedMeeting({ conference: { provider: 'zoom', url: 'https://zoom.us/j/1', password: null } }));
    const block = await formatMeetingForShare('u1', 'm1', 'en', { store, now: () => NOW });
    expect(block).toContain('*Weekly sync*');
    expect(block).toContain('2026-10-06 16:00 (Europe/Madrid)'); // local time in the meeting zone
    expect(block).toContain('https://zoom.us/j/1');
  });

  it('returns null for missing or tombstoned meetings and caps list replies', async () => {
    const store = new FakeMeetingStore();
    expect(await formatMeetingForShare('u1', 'ghost', 'en', { store, now: () => NOW })).toBeNull();
    store.docs.set('u1/gone', storedMeeting({ deletedAt: NOW.toISOString() }));
    expect(await formatMeetingForShare('u1', 'gone', 'en', { store, now: () => NOW })).toBeNull();
    for (let index = 0; index < 8; index += 1) {
      store.docs.set(`u1/m${index}`, storedMeeting());
    }
    const blocks = await formatMeetingList('u1', ['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'], 'en', { store, now: () => NOW });
    expect(blocks).toHaveLength(LIST_REPLY_LIMIT);
  });
});

describe('tombstoneFieldUpdates', () => {
  it('matches the app scrub set (title, content, participants, conference, recurrence cleared)', () => {
    const fields = tombstoneFieldUpdates(NOW);
    expect(fields).toEqual({
      title: WHATSAPP_TOMBSTONE_TITLE,
      description: '',
      location: null,
      conference: null,
      participants: [],
      preparationTips: [],
      customAlertTimes: null,
      alertIntensity: null,
      notes: null,
      confidence: null,
      recurrence: null,
      recurrenceOverrides: null,
      deletedAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
  });
});
