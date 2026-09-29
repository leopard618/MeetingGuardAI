import AsyncStorage from '@react-native-async-storage/async-storage';

import { createEventBus, type AppEventMap, type MeetingsChangedEvent } from '../../../core/events';
import { firestorePaths } from '../../../core/identifiers';
import { buildMeeting, toMeetingDoc, type Meeting } from '../../../core/types';
import { cacheKeys } from '../cache';
import { DataEngine } from '../engine';
import type { NetworkMonitor } from '../platform';
import type { RemoteDocSnapshot } from '../remote';
import { FakeProviderError, FakeRemote, settle, strictRules } from '../testing/fakeRemote';

const UID = 'user1';
const T0 = '2026-10-01T10:00:00.000Z';

interface Harness {
  engine: DataEngine;
  remote: FakeRemote;
  events: ReturnType<typeof createEventBus<AppEventMap>>;
  meetingEvents: MeetingsChangedEvent[];
  setNow(iso: string): void;
  setOnline(online: boolean): void;
}

let current: Harness | null = null;

function harness(options: { preferencesFallbackMs?: number } = {}): Harness {
  const remote = new FakeRemote();
  const events = createEventBus<AppEventMap>();
  const meetingEvents: MeetingsChangedEvent[] = [];
  events.on('meetings:changed', (event) => {
    meetingEvents.push(event);
  });
  let now = new Date(T0);
  let online = true;
  const listeners = new Set<(value: boolean | null) => void>();
  const network: NetworkMonitor = {
    fetch: async () => online,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const engine = new DataEngine({
    remote,
    storage: AsyncStorage,
    events,
    network,
    now: () => now,
    getLanguage: () => 'en',
    getTimeZone: () => 'Europe/Madrid',
    timeouts: {
      flushDelayMs: 0,
      commitMs: 2_000,
      fetchMs: 2_000,
      headlessMs: 2_000,
      preferencesFallbackMs: options.preferencesFallbackMs ?? 60_000,
      migrationPreferencesWaitMs: 100,
      retryBaseMs: 60_000,
    },
  });
  current = {
    engine,
    remote,
    events,
    meetingEvents,
    setNow: (iso) => {
      now = new Date(iso);
    },
    setOnline: (value) => {
      online = value;
      remote.online = value;
      for (const listener of listeners) listener(value);
      if (value) remote.notifyListeners();
    },
  };
  return current;
}

function storedMeeting(id: string, title: string, startAt: string, updatedAt = T0): Meeting {
  const meeting = buildMeeting(
    { title, startAt, source: 'manual' },
    { id, userId: UID, now: updatedAt, defaultTimezone: 'Europe/Madrid', defaultLanguage: 'en' },
  );
  return meeting;
}

async function storageKeys(): Promise<string[]> {
  return [...(await AsyncStorage.getAllKeys())];
}

async function readJson(key: string): Promise<unknown> {
  const raw = await AsyncStorage.getItem(key);
  return raw === null ? null : (JSON.parse(raw) as unknown);
}

beforeEach(async () => {
  await AsyncStorage.clear();
  // Expected warnings (offline sends, invalid documents) are asserted through behaviour, not logs.
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  if (current) await current.engine.endSession({ wipeLocal: false });
  current = null;
  await settle();
  jest.restoreAllMocks();
});

describe('session start', () => {
  it('resolves from the cache without waiting for the network and emits cache_loaded', async () => {
    const cached = storedMeeting('m1', 'Cached', '2026-10-05T08:00:00.000Z');
    await AsyncStorage.setItem(cacheKeys.meeting(UID, 'm1'), JSON.stringify(toMeetingDoc(cached)));
    const h = harness();
    h.remote.online = false;

    await h.engine.startSession(UID, { mode: 'foreground' });

    expect((await h.engine.listMeetings()).map((m) => m.title)).toEqual(['Cached']);
    expect(h.meetingEvents[0]).toEqual({ uid: UID, reason: 'cache_loaded' });
  });

  it('rejects every call with unauthenticated when no session is active (never a fake empty list)', async () => {
    const h = harness();
    await expect(h.engine.listMeetings()).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(h.engine.updatePreferences({ alertEnabled: false })).rejects.toMatchObject({ code: 'unauthenticated' });
  });
});

describe('offline writes and the outbox', () => {
  it('persists writes locally first and flushes them in order, once, when back online', async () => {
    const h = harness();
    await h.engine.startSession(UID);
    h.setOnline(false);

    const a = await h.engine.createMeeting({ title: 'A', startAt: '2026-10-05T08:00:00.000Z', source: 'manual' });
    const b = await h.engine.createMeeting({ title: 'B', startAt: '2026-10-06T08:00:00.000Z', source: 'manual' });
    h.setNow('2026-10-01T10:05:00.000Z');
    await h.engine.updateMeeting(a.id, { title: 'A2' });
    await settle();

    expect(await h.engine.getPendingWriteCount()).toBe(2);
    const outbox = (await readJson(cacheKeys.outbox(UID))) as { entries: { docId: string; mode: string }[] };
    expect(outbox.entries.map((entry) => [entry.docId, entry.mode])).toEqual([
      [a.id, 'create'],
      [b.id, 'create'],
    ]);
    expect(await readJson(cacheKeys.meeting(UID, a.id))).toMatchObject({ title: 'A2' });
    expect(h.remote.docs.size).toBe(0);
    expect(h.meetingEvents.filter((e) => e.reason !== 'cache_loaded').map((e) => [e.reason, e.origin])).toEqual([
      ['created', 'user'],
      ['created', 'user'],
      ['updated', 'user'],
    ]);

    h.setOnline(true);
    const result = await h.engine.flushOutbox();
    await settle();

    expect(result.pending).toBe(0);
    const meetingCommits = h.remote.commits.filter((commit) => commit.path.includes('/meetings/'));
    expect(meetingCommits.map((commit) => commit.path)).toEqual([firestorePaths.meeting(UID, a.id), firestorePaths.meeting(UID, b.id)]);
    expect(h.remote.docs.get(firestorePaths.meeting(UID, a.id))).toMatchObject({ title: 'A2', userId: UID, deletedAt: null });
    expect(await h.engine.getPendingWriteCount()).toBe(0);
    expect((await h.engine.flushOutbox()).flushed).toBe(0);
    expect(h.remote.commits.filter((commit) => commit.path.includes('/meetings/'))).toHaveLength(2);
  });

  it('re-sending after a lost acknowledgement is idempotent', async () => {
    const h = harness();
    h.remote.docs.set(firestorePaths.preferences(UID), { language: 'en' });
    await h.engine.startSession(UID);
    await settle();
    h.setOnline(false);
    const meeting = await h.engine.createMeeting({ title: 'Once', startAt: '2026-10-05T08:00:00.000Z', source: 'manual' });

    const realCommit = h.remote.commit.bind(h.remote);
    let lostAck = true;
    h.remote.commit = async (path, decide) => {
      const result = await realCommit(path, decide);
      if (lostAck) {
        lostAck = false;
        throw new FakeProviderError('deadline-exceeded');
      }
      return result;
    };
    h.setOnline(true);
    const first = await h.engine.flushOutbox();
    expect(first).toMatchObject({ flushed: 0, pending: 1 });

    const second = await h.engine.flushOutbox();
    expect(second).toMatchObject({ flushed: 1, pending: 0, rejected: 0 });
    expect(h.remote.commits.filter((commit) => commit.path.includes('/meetings/')).map((commit) => commit.decision.type)).toEqual([
      'write',
      'skip',
    ]);
    expect([...h.remote.docs.keys()].filter((path) => path.includes('/meetings/'))).toEqual([firestorePaths.meeting(UID, meeting.id)]);
  });

  it('last-writer-wins: a newer server version beats an older pending local edit', async () => {
    const h = harness();
    await h.engine.startSession(UID);
    const meeting = await h.engine.createMeeting({ title: 'Base', startAt: '2026-10-05T08:00:00.000Z', source: 'manual' });
    await h.engine.flushOutbox();
    await settle();

    h.setOnline(false);
    h.setNow('2026-10-01T10:01:00.000Z');
    await h.engine.updateMeeting(meeting.id, { title: 'Local (older)' });
    const serverDoc = { ...toMeetingDoc(meeting), title: 'Remote (newer)', updatedAt: '2026-10-01T10:02:00.000Z' };
    h.remote.docs.set(firestorePaths.meeting(UID, meeting.id), serverDoc);

    h.setOnline(true);
    await h.engine.flushOutbox();
    await settle();

    expect((await h.engine.getMeeting(meeting.id))?.title).toBe('Remote (newer)');
    expect(h.remote.docs.get(firestorePaths.meeting(UID, meeting.id))).toMatchObject({ title: 'Remote (newer)' });
    expect(h.meetingEvents.some((e) => e.reason === 'remote' && e.changedIds?.includes(meeting.id))).toBe(true);
  });

  it('drops permanently rejected writes and restores the server version', async () => {
    const h = harness();
    await h.engine.startSession(UID);
    const meeting = await h.engine.createMeeting({ title: 'Server title', startAt: '2026-10-05T08:00:00.000Z', source: 'manual' });
    await h.engine.flushOutbox();
    h.setOnline(false);
    await h.engine.updateMeeting(meeting.id, { title: 'Rejected edit' });
    h.remote.commitFailures.push(new FakeProviderError('permission-denied'));

    h.setOnline(true);
    const result = await h.engine.flushOutbox();

    expect(result).toMatchObject({ rejected: 1, pending: 0 });
    expect((await h.engine.getMeeting(meeting.id))?.title).toBe('Server title');
  });

  it('create with a caller-chosen id is idempotent and delete is a synced tombstone', async () => {
    const h = harness();
    await h.engine.startSession(UID);
    const input = { title: 'From AI', startAt: '2026-10-05T08:00:00.000Z', source: 'ai_chat' as const };
    const first = await h.engine.createMeeting(input, { id: 'ai_action_1', origin: 'ai' });
    const again = await h.engine.createMeeting({ ...input, title: 'Different' }, { id: 'ai_action_1', origin: 'ai' });
    expect(again).toEqual(first);

    await h.engine.removeMeeting(first.id);
    await h.engine.removeMeeting(first.id); // idempotent
    await h.engine.flushOutbox();
    expect(await h.engine.getMeeting(first.id)).toBeNull();
    expect(await h.engine.listMeetings()).toEqual([]);
    expect((await h.engine.listMeetings({ includeDeleted: true })).map((m) => m.id)).toEqual([first.id]);
    expect(h.remote.docs.get(firestorePaths.meeting(UID, first.id))).toMatchObject({ deletedAt: expect.any(String) as string });
    // The deleted meeting's content leaves the server and the cache.
    expect(h.remote.docs.get(firestorePaths.meeting(UID, first.id))).toMatchObject({ title: 'Deleted meeting', description: '' });
    expect(JSON.stringify(await readJson(cacheKeys.meeting(UID, first.id)))).not.toContain('From AI');
    await expect(h.engine.updateMeeting(first.id, { title: 'x' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('scrubs old tombstones that still carry content and hard-deletes expired ones', async () => {
    const recent = {
      ...storedMeeting('recent', 'Salary review', '2026-09-20T08:00:00.000Z', '2026-09-25T08:00:00.000Z'),
      notes: 'Secret notes',
      deletedAt: '2026-09-25T08:00:00.000Z',
    };
    const expired = {
      ...storedMeeting('expired', 'Old one', '2026-06-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
      deletedAt: '2026-07-01T08:00:00.000Z',
    };
    const alive = storedMeeting('alive', 'Alive', '2026-10-06T08:00:00.000Z');
    const h = harness();
    for (const meeting of [recent, expired, alive]) {
      h.remote.docs.set(firestorePaths.meeting(UID, meeting.id), toMeetingDoc(meeting) as never);
    }
    await h.engine.startSession(UID);
    await settle(20);
    await h.engine.flushOutbox();
    await settle(10);

    expect(h.remote.docs.get(firestorePaths.meeting(UID, 'recent'))).toMatchObject({ title: 'Deleted meeting', notes: null });
    expect(h.remote.docs.has(firestorePaths.meeting(UID, 'expired'))).toBe(false);
    expect(h.remote.docs.get(firestorePaths.meeting(UID, 'alive'))).toMatchObject({ title: 'Alive' });
    const ids = (await h.engine.listMeetings({ includeDeleted: true })).map((m) => m.id).sort();
    expect(ids).toEqual(['alive', 'recent']);
    expect(await h.engine.maintainTombstones()).toEqual({ scrubbed: 0, purged: 0 });
  });
});

describe('real-time snapshots', () => {
  it('reflects changes made on another device and removals', async () => {
    const h = harness();
    await h.engine.startSession(UID);
    await settle();

    const other = storedMeeting('fromTablet', 'Tablet meeting', '2026-10-07T09:00:00.000Z');
    h.remote.serverSet(firestorePaths.meeting(UID, other.id), toMeetingDoc(other) as unknown as Record<string, unknown>);
    await settle();
    expect((await h.engine.listMeetings()).map((m) => m.id)).toEqual(['fromTablet']);
    expect(h.meetingEvents.at(-1)).toEqual({ uid: UID, changedIds: ['fromTablet'], reason: 'remote' });

    h.remote.serverDelete(firestorePaths.meeting(UID, other.id));
    await settle();
    expect(await h.engine.listMeetings()).toEqual([]);
  });

  it('drops cached meetings that were deleted on the server while offline, but keeps pending local ones', async () => {
    const gone = storedMeeting('gone', 'Deleted elsewhere', '2026-10-05T08:00:00.000Z');
    await AsyncStorage.setItem(cacheKeys.meeting(UID, 'gone'), JSON.stringify(toMeetingDoc(gone)));
    const h = harness();
    h.remote.online = false;
    await h.engine.startSession(UID);
    const local = await h.engine.createMeeting({ title: 'Offline new', startAt: '2026-10-06T08:00:00.000Z', source: 'manual' });
    h.remote.commitFailures.push(new FakeProviderError('unavailable'));

    h.setOnline(true);
    await settle();

    const ids = (await h.engine.listMeetings()).map((m) => m.id);
    expect(ids).toContain(local.id);
    expect(ids).not.toContain('gone');
    expect(await AsyncStorage.getItem(cacheKeys.meeting(UID, 'gone'))).toBeNull();
  });

  it('rewrites meetings stored in the pre-rebuild Firestore shape (delete + create under the rules)', async () => {
    const h = harness();
    h.remote.rules = strictRules;
    h.remote.docs.set(firestorePaths.meeting(UID, 'oldDoc1'), {
      title: 'Old shape',
      date: '2026-10-05',
      time: '10:00',
      duration: 30,
      source: 'Manual',
      created_date: '2026-09-01T08:00:00.000Z',
    });
    await h.engine.startSession(UID);
    await settle(10);

    expect(await h.engine.getMeeting('oldDoc1')).toMatchObject({ startAt: '2026-10-05T08:00:00.000Z', durationMinutes: 30, source: 'manual' });
    expect(h.remote.docs.get(firestorePaths.meeting(UID, 'oldDoc1'))).toMatchObject({ startAt: '2026-10-05T08:00:00.000Z', userId: UID });
    expect(h.remote.commits.filter((c) => c.path.endsWith('oldDoc1')).map((c) => c.decision.type)).toEqual(['delete', 'write']);
    expect(await h.engine.getPendingWriteCount()).toBe(0);

    // A later user edit is a normal update that the rules accept.
    await h.engine.updateMeeting('oldDoc1', { title: 'Edited' });
    expect(await h.engine.flushOutbox()).toMatchObject({ rejected: 0, pending: 0 });
    expect(h.remote.docs.get(firestorePaths.meeting(UID, 'oldDoc1'))).toMatchObject({ title: 'Edited' });
  });
});

describe('preferences', () => {
  it('keeps the onboarding gate closed while only the timeout fallback (defaults) is known', async () => {
    const h = harness({ preferencesFallbackMs: 20 });
    h.remote.docs.set(firestorePaths.preferences(UID), { language: 'es', onboardingCompleted: true, updatedAt: T0 });
    h.setOnline(false);
    await h.engine.startSession(UID);
    await new Promise((resolve) => setTimeout(resolve, 40));
    await settle(5);

    // Readers (alerts, legacy shims) may use the defaults, but they are not settled.
    expect(h.engine.getSnapshot()).toMatchObject({ preferencesLoaded: true, preferencesSettled: false });
    expect(h.engine.getSnapshot().preferences.onboardingCompleted).toBe(false);

    h.setOnline(true);
    await settle(10);
    expect(h.engine.getSnapshot()).toMatchObject({ preferencesLoaded: true, preferencesSettled: true });
    expect(h.engine.getSnapshot().preferences).toMatchObject({ language: 'es', onboardingCompleted: true });
  });

  it('bootstraps the document from the pre-rebuild users/{uid}.preferences once', async () => {
    const h = harness();
    h.remote.docs.set(firestorePaths.user(UID), { plan: 'free', preferences: { alert_enabled: false, alert_intensity: 'medium' } });
    await h.engine.startSession(UID);
    await settle(10);

    const prefs = await h.engine.getPreferences();
    expect(prefs).toMatchObject({ alertEnabled: false, alertIntensity: 'medium', language: 'en', timezone: 'Europe/Madrid' });
    expect(h.engine.getSnapshot().preferencesLoaded).toBe(true);
    expect(h.remote.docs.get(firestorePaths.preferences(UID))).toMatchObject({ alertEnabled: false, alertIntensity: 'medium' });
  });

  it('merges field by field: offline local change + remote change on another field are both kept', async () => {
    const h = harness();
    h.remote.docs.set(firestorePaths.preferences(UID), {
      language: 'es',
      alertIntensity: 'light',
      alertEnabled: true,
      updatedAt: '2026-09-30T10:00:00.000Z',
    });
    const changes: string[][] = [];
    h.events.on('preferences:changed', (event) => {
      changes.push([event.origin, ...event.changedKeys]);
    });
    await h.engine.startSession(UID);
    await settle();
    expect(await h.engine.getPreferences()).toMatchObject({ language: 'es', alertIntensity: 'light' });

    h.setOnline(false);
    await h.engine.updatePreferences({ vibrationEnabled: false });
    h.remote.docs.set(firestorePaths.preferences(UID), {
      ...(h.remote.docs.get(firestorePaths.preferences(UID)) ?? {}),
      alertEnabled: false,
      updatedAt: '2026-10-01T11:00:00.000Z',
    });
    h.setOnline(true);
    await h.engine.flushOutbox();
    await settle();

    expect(await h.engine.getPreferences()).toMatchObject({ vibrationEnabled: false, alertEnabled: false, alertIntensity: 'light', language: 'es' });
    expect(h.remote.docs.get(firestorePaths.preferences(UID))).toMatchObject({ vibrationEnabled: false, alertEnabled: false, alertIntensity: 'light' });
    expect(changes).toContainEqual(['local', 'vibrationEnabled']);
  });

  it('never re-creates a preferences document that was deleted on the server (account deletion)', async () => {
    const h = harness();
    h.remote.docs.set(firestorePaths.preferences(UID), { language: 'es', alertIntensity: 'light', updatedAt: T0 });
    await h.engine.startSession(UID);
    await settle();
    expect((await h.engine.getPreferences()).language).toBe('es');
    const commitsBefore = h.remote.commits.length;

    h.remote.serverDelete(firestorePaths.preferences(UID));
    await settle(10);

    expect(h.remote.docs.has(firestorePaths.preferences(UID))).toBe(false);
    expect(h.remote.commits.length).toBe(commitsBefore);
    expect(await h.engine.getPendingWriteCount()).toBe(0);
    // The local copy stays usable.
    expect((await h.engine.getPreferences()).language).toBe('es');
  });

  it('suspendRemote stops listeners and outbox sends until resumeRemote', async () => {
    const h = harness();
    h.remote.docs.set(firestorePaths.preferences(UID), { language: 'en', updatedAt: T0 });
    await h.engine.startSession(UID);
    await settle();

    h.engine.suspendRemote();
    const meeting = await h.engine.createMeeting({ title: 'Queued', startAt: '2026-10-06T08:00:00.000Z', source: 'manual' });
    h.remote.serverSet(firestorePaths.meeting(UID, 'remote1'), toMeetingDoc(storedMeeting('remote1', 'Remote', '2026-10-07T08:00:00.000Z')) as never);
    await h.engine.flushOutbox();
    await settle(10);

    // Nothing was sent, and the remote change was not applied while suspended.
    expect(h.remote.docs.has(firestorePaths.meeting(UID, meeting.id))).toBe(false);
    expect(await h.engine.getPendingWriteCount()).toBe(1);
    expect((await h.engine.listMeetings()).map((m) => m.id)).toEqual([meeting.id]);

    h.engine.resumeRemote();
    await settle(10);
    expect(h.remote.docs.has(firestorePaths.meeting(UID, meeting.id))).toBe(true);
    expect((await h.engine.listMeetings()).map((m) => m.id).sort()).toEqual([meeting.id, 'remote1'].sort());
  });

  it('writes prefs.language when the user switches language (language:changed source user)', async () => {
    const h = harness();
    h.remote.docs.set(firestorePaths.preferences(UID), { language: 'en' });
    await h.engine.startSession(UID);
    await settle();
    h.events.emit('language:changed', { language: 'es', source: 'user' });
    h.events.emit('language:changed', { language: 'en', source: 'preferences' });
    await settle();
    expect((await h.engine.getPreferences()).language).toBe('es');
  });
});

describe('profile and entitlement', () => {
  it('ensureProfile never writes plan fields, keeps createdAt, and rewrites a legacy profile without losing its preferences', async () => {
    const h = harness();
    h.remote.rules = strictRules;
    h.remote.docs.set(firestorePaths.user(UID), {
      plan: 'pro',
      createdAt: '2025-01-01T00:00:00.000Z',
      name: 'Old name',
      preferences: { alert_enabled: false, alert_intensity: 'light' },
    });
    // The profile rewrite is sent before the preferences snapshot arrives (worst case ordering).
    const listenDoc = h.remote.listenDoc.bind(h.remote);
    let releasePreferences: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releasePreferences = resolve;
    });
    h.remote.listenDoc = (path: string, onNext: (snapshot: RemoteDocSnapshot) => void): (() => void) => {
      if (!path.endsWith('/settings/preferences')) return listenDoc(path, onNext);
      let unsubscribe: () => void = () => undefined;
      void gate.then(() => {
        unsubscribe = listenDoc(path, onNext);
      });
      return () => unsubscribe();
    };
    await h.engine.startSession(UID, {
      user: { uid: UID, email: 'ana@example.com', displayName: 'Ana', photoURL: null, emailVerified: true, providerIds: ['google.com'] },
    });
    await settle(10);
    await h.engine.flushOutbox();
    expect(h.remote.docs.get(firestorePaths.user(UID))).not.toHaveProperty('preferences');
    releasePreferences();
    await settle(10);
    await h.engine.flushOutbox();

    const doc = h.remote.docs.get(firestorePaths.user(UID));
    expect(doc).toEqual({
      uid: UID,
      email: 'ana@example.com',
      displayName: 'Ana',
      photoURL: null,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: expect.any(String) as string,
      lastLoginAt: expect.any(String) as string,
      legacyMigratedAt: null,
    });
    expect(await h.engine.getPreferences()).toMatchObject({ alertEnabled: false, alertIntensity: 'light' });
    expect(h.remote.docs.get(firestorePaths.preferences(UID))).toMatchObject({ alertEnabled: false, alertIntensity: 'light' });
    const profileWrites = h.remote.commits.filter((commit) => commit.path === firestorePaths.user(UID));
    for (const commit of profileWrites) {
      if (commit.decision.type === 'merge' || commit.decision.type === 'write') {
        expect(commit.decision.data).not.toHaveProperty('plan');
      }
    }
    expect((await h.engine.getProfile())?.createdAt).toBe('2025-01-01T00:00:00.000Z');
  });

  it('reads the server-owned entitlement (missing = free) and never writes it', async () => {
    const h = harness();
    await h.engine.startSession(UID);
    await settle();
    expect(await h.engine.getEntitlement()).toMatchObject({ plan: 'free', source: 'default' });

    h.remote.serverSet(firestorePaths.entitlement(UID), { plan: 'pro', status: 'active', expiresAt: null, source: 'manual', updatedAt: null });
    await settle();
    expect(await h.engine.getEntitlement()).toMatchObject({ plan: 'pro' });
    expect(h.remote.commits.some((commit) => commit.path.startsWith('entitlements/'))).toBe(false);
    expect(await readJson(cacheKeys.entitlement(UID))).toMatchObject({ plan: 'pro' });
  });
});

describe('calendar imports', () => {
  it('upserts provider events and emits one imported event with the calendar origin', async () => {
    const h = harness();
    await h.engine.startSession(UID);
    await settle();
    const result = await h.engine.upsertExternal([
      {
        provider: 'google',
        externalId: 'evt1',
        calendarId: 'primary',
        etag: '"1"',
        providerUpdatedAt: '2026-10-01T09:00:00.000Z',
        deleted: false,
        meeting: { title: 'Imported', startAt: '2026-10-08T09:00:00.000Z' },
      },
    ]);
    expect(result).toMatchObject({ created: 1, invalid: 0 });
    const imported = h.meetingEvents.filter((event) => event.reason === 'imported');
    expect(imported).toEqual([{ uid: UID, changedIds: ['g_evt1'], reason: 'imported', origin: 'calendar_google' }]);
    expect(await h.engine.findByExternalId('google', 'evt1')).toMatchObject({ id: 'g_evt1', source: 'google' });
  });
});

describe('session end and headless reads', () => {
  it('wipes only this user`s keys when asked to', async () => {
    await AsyncStorage.setItem('mg:otherUser:preferences', '{}');
    await AsyncStorage.setItem('mg:language', 'es');
    const h = harness();
    await h.engine.startSession(UID);
    await h.engine.createMeeting({ title: 'x', startAt: '2026-10-05T08:00:00.000Z', source: 'manual' });
    await h.engine.endSession({ wipeLocal: true });

    const keys = await storageKeys();
    expect(keys.filter((key) => key.startsWith(`mg:${UID}:`))).toEqual([]);
    expect(keys).toEqual(expect.arrayContaining(['mg:otherUser:preferences', 'mg:language']));
    expect(h.meetingEvents.at(-1)).toEqual({ uid: UID, reason: 'session_reset' });
    await expect(h.engine.listMeetings()).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('a sign-out wipe never deletes the writes of the next session (same user signs straight back in)', async () => {
    const h = harness();
    await h.engine.startSession(UID);
    h.setOnline(false);
    await h.engine.createMeeting({ title: 'Before sign-out', startAt: '2026-10-05T08:00:00.000Z', source: 'manual' });

    const ending = h.engine.endSession({ wipeLocal: true });
    const starting = h.engine.startSession(UID);
    await Promise.all([ending, starting]);
    const after = await h.engine.createMeeting({ title: 'After sign-in', startAt: '2026-10-06T08:00:00.000Z', source: 'manual' });
    await settle();

    expect(await AsyncStorage.getItem(cacheKeys.meeting(UID, after.id))).not.toBeNull();
    expect((await h.engine.listMeetings()).map((m) => m.title)).toEqual(['After sign-in']);
    const outbox = (await readJson(cacheKeys.outbox(UID))) as { entries: { docId: string }[] };
    expect(outbox.entries.map((entry) => entry.docId)).toEqual([after.id]);
  });

  it('getCachedUpcoming reads AsyncStorage without a session (headless) and filters eligible meetings', async () => {
    const h = harness();
    h.remote.online = false;
    await h.engine.startSession(UID);
    const soon = await h.engine.createMeeting({ title: 'Soon', startAt: '2026-10-01T12:00:00.000Z', source: 'manual' });
    const running = await h.engine.createMeeting({ title: 'Running', startAt: '2026-10-01T09:30:00.000Z', source: 'manual' });
    const past = await h.engine.createMeeting({ title: 'Past', startAt: '2026-09-30T08:00:00.000Z', source: 'manual' });
    const far = await h.engine.createMeeting({ title: 'Far', startAt: '2026-11-30T08:00:00.000Z', source: 'manual' });
    const cancelled = await h.engine.createMeeting({ title: 'Cancelled', startAt: '2026-10-02T08:00:00.000Z', source: 'manual', status: 'cancelled' });
    const deleted = await h.engine.createMeeting({ title: 'Deleted', startAt: '2026-10-02T09:00:00.000Z', source: 'manual' });
    await h.engine.removeMeeting(deleted.id);
    await h.engine.endSession({ wipeLocal: false });

    const upcoming = await h.engine.getCachedUpcoming(UID, { now: new Date(T0) });
    expect(upcoming.map((m) => m.id)).toEqual([running.id, soon.id]);
    expect([past.id, far.id, cancelled.id, deleted.id].some((id) => upcoming.some((m) => m.id === id))).toBe(false);
    // The server preferences were never reached in this session: nothing cached, no invented defaults.
    expect(await h.engine.getCachedPreferences(UID)).toBeNull();
  });

  it('headless sessions fetch upcoming meetings and preferences once, attach no listeners and flush', async () => {
    const h = harness();
    const remoteMeeting = storedMeeting('r1', 'From server', '2026-10-03T08:00:00.000Z');
    h.remote.docs.set(firestorePaths.meeting(UID, 'r1'), toMeetingDoc(remoteMeeting) as unknown as Record<string, unknown>);
    h.remote.docs.set(firestorePaths.preferences(UID), { alertIntensity: 'medium' });
    const listen = jest.spyOn(h.remote, 'listenCollection');

    await h.engine.startSession(UID, { mode: 'headless' });

    expect(listen).not.toHaveBeenCalled();
    expect((await h.engine.listMeetings()).map((m) => m.id)).toEqual(['r1']);
    expect((await h.engine.getPreferences()).alertIntensity).toBe('medium');
  });
});
