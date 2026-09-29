import AsyncStorage from '@react-native-async-storage/async-storage';

import { createEventBus, type AppEventMap } from '../../../core/events';
import { firestorePaths, LEGACY_DATA_KEY } from '../../../core/identifiers';
import { cacheKeys } from '../cache';
import { DataEngine } from '../engine';
import { planLegacyMigration } from '../migration';
import { FakeRemote, settle } from '../testing/fakeRemote';

const UID = 'user1';
const EMAIL = 'ana@example.com';
const USER = { uid: UID, email: EMAIL, displayName: 'Ana', photoURL: null, emailVerified: true, providerIds: ['google.com'] };

/** The v1.0.9 / HEAD local database as the old app wrote it. */
const LEGACY_BLOB = {
  meetings: [
    {
      id: '3f2b8a1c-1111-4aaa-8bbb-000000000001',
      title: 'Kickoff',
      date: '2026-10-05',
      time: '10:00',
      duration: 60,
      source: 'Manual',
      location: { type: 'physical', address: 'Calle Mayor 1', virtualPlatform: undefined, virtualLink: undefined },
      participants: [{ name: 'Luis', email: 'luis@example.com' }],
      created_date: '2025-06-01T08:00:00.000Z',
      updated_date: '2025-06-01T08:00:00.000Z',
      created_by: 'ANA@example.com',
    },
    {
      id: '3f2b8a1c-1111-4aaa-8bbb-000000000002',
      title: 'Past review',
      date: '2025-01-10',
      time: '2:30 PM',
      source: 'ChatGPT',
      confidence: 72,
      created_date: '2025-01-01T08:00:00.000Z',
      created_by: 'user@example.com',
    },
    { id: 'broken-1', title: '', date: 'n/a', created_by: EMAIL },
    { id: 'someone-elses', title: 'Private', date: '2026-10-06', time: '09:00', created_by: 'bob@example.com' },
  ],
  notes: [
    { id: 'n1', title: 'Ideas', content: 'Build the thing', category: 'ideas', created_date: '2025-02-01T08:00:00.000Z', created_by: EMAIL },
    { id: 'n2', title: '', content: 'First line becomes the title\nmore', category: 'unknown', created_by: EMAIL },
  ],
  userPreferences: [
    { id: 'p1', created_by: EMAIL, language: 'es' },
    { id: 'p2', created_by: EMAIL, language: 'es', alert_intensity: 'medium', alert_enabled: true },
    { id: 'p3', created_by: 'bob@example.com', alert_intensity: 'light' },
  ],
  apiKeys: [{ id: 'k1', key: 'fake' }],
  users: [{ email: EMAIL, password: 'plaintext' }],
};

function engine(): { engine: DataEngine; remote: FakeRemote } {
  const remote = new FakeRemote();
  const instance = new DataEngine({
    remote,
    storage: AsyncStorage,
    events: createEventBus<AppEventMap>(),
    now: () => new Date('2026-10-01T10:00:00.000Z'),
    getLanguage: () => 'es',
    getTimeZone: () => 'Europe/Madrid',
    timeouts: { flushDelayMs: 0, migrationPreferencesWaitMs: 50, preferencesFallbackMs: 60_000, retryBaseMs: 60_000 },
  });
  return { engine: instance, remote };
}

let active: DataEngine | null = null;

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(async () => {
  await active?.endSession({ wipeLocal: false });
  active = null;
  await settle();
  jest.restoreAllMocks();
});

describe('planLegacyMigration (pure)', () => {
  const base = {
    blob: LEGACY_BLOB,
    uid: UID,
    email: EMAIL,
    timeZone: 'Europe/Madrid',
    language: 'es' as const,
    now: new Date('2026-10-01T10:00:00.000Z'),
    existingMeetingIds: new Set<string>(),
    existingNoteIds: new Set<string>(),
  };

  it("migrates only the signed-in account's records with legacy_ ids and keeps other accounts' records", () => {
    const plan = planLegacyMigration(base);
    expect(plan.meetings.map((m) => m.id)).toEqual(['legacy_3f2b8a1c-1111-4aaa-8bbb-000000000001', 'legacy_3f2b8a1c-1111-4aaa-8bbb-000000000002']);
    expect(plan.meetings[0]).toMatchObject({
      startAt: '2026-10-05T08:00:00.000Z',
      source: 'manual',
      location: { type: 'physical', address: 'Calle Mayor 1', virtualUrl: null },
      participants: [{ email: 'luis@example.com', name: 'Luis', status: null }],
      createdAt: '2025-06-01T08:00:00.000Z',
      userId: UID,
    });
    expect(plan.meetings[1]).toMatchObject({ time: '14:30', source: 'ai_chat', confidence: 72 });
    expect(plan.notes.map((n) => [n.id, n.title, n.category])).toEqual([
      ['legacy_n1', 'Ideas', 'ideas'],
      ['legacy_n2', 'First line becomes the title', 'general'],
    ]);
    expect(plan.preferencesPatch).toEqual({ language: 'es', alertIntensity: 'medium', alertEnabled: true });
    expect(plan.skipped).toBe(1);
    expect(plan.errors).toEqual(['invalid_input']);
    expect(plan.remainingBlob).toEqual({
      meetings: [LEGACY_BLOB.meetings[3]],
      notes: [],
      userPreferences: [LEGACY_BLOB.userPreferences[2]],
      apiKeys: [],
      users: [],
    });
    expect(plan.meetingIdMap['3f2b8a1c-1111-4aaa-8bbb-000000000001']).toBe('legacy_3f2b8a1c-1111-4aaa-8bbb-000000000001');
  });

  it('skips records that were already migrated', () => {
    const plan = planLegacyMigration({
      ...base,
      existingMeetingIds: new Set(['legacy_3f2b8a1c-1111-4aaa-8bbb-000000000001']),
      existingNoteIds: new Set(['legacy_n1']),
    });
    expect(plan.meetings).toHaveLength(1);
    expect(plan.notes).toHaveLength(1);
    expect(plan.skipped).toBe(3);
  });
});

describe('migrateLegacyLocalData (engine)', () => {
  async function seedLegacyDevice(): Promise<void> {
    await AsyncStorage.multiSet([
      [LEGACY_DATA_KEY, JSON.stringify(LEGACY_BLOB)],
      ['google_access_token', 'ya29.secret'],
      ['google_refresh_token', '1//secret'],
      ['user', JSON.stringify({ email: EMAIL })],
      ['users', JSON.stringify(LEGACY_BLOB.users)],
      ['authToken', 'jwt'],
      ['alertSchedule_abc', '{}'],
      ['google_code_verifier', 'v'],
      ['theme', 'dark'],
      [
        'file_f1',
        JSON.stringify({ id: 'f1', name: 'agenda.pdf', type: 'documents', mimeType: 'application/pdf', size: 10, uri: 'file:///doc/f1', meetingId: '3f2b8a1c-1111-4aaa-8bbb-000000000001', uploadedAt: '2025-06-01T08:00:00.000Z' }),
      ],
      ['file_f2', JSON.stringify({ id: 'f2', name: 'bob.pdf', mimeType: 'application/pdf', uri: 'file:///doc/f2', meetingId: 'someone-elses' })],
    ]);
  }

  it('imports once, cleans legacy keys, relinks attachments and is idempotent', async () => {
    await seedLegacyDevice();
    const { engine: data, remote } = engine();
    active = data;
    remote.docs.set(firestorePaths.preferences(UID), { language: 'es', updatedAt: null });
    await data.startSession(UID, { mode: 'headless', user: USER });

    const report = await data.migrateLegacyLocalData(UID);
    expect(report).toMatchObject({ alreadyDone: false, migratedMeetings: 2, migratedNotes: 2, preferencesMigrated: true, skipped: 1 });
    // 5 core keys + 1 alertSchedule_ prefix key + 1 extra (PKCE verifier) + 1 relinked attachment key; the blob stays (bob's records).
    expect(report.removedLegacyKeys).toBe(8);
    expect((await data.listMeetings()).map((m) => m.title)).toEqual(['Past review', 'Kickoff']);
    expect(await data.getPreferences()).toMatchObject({ alertIntensity: 'medium', alertEnabled: true, language: 'es' });

    const keys = await AsyncStorage.getAllKeys();
    for (const key of ['google_access_token', 'google_refresh_token', 'user', 'users', 'authToken', 'alertSchedule_abc', 'google_code_verifier', 'file_f1']) {
      expect(keys).not.toContain(key);
    }
    expect(keys).toEqual(expect.arrayContaining(['theme', 'file_f2', cacheKeys.migration(UID)]));
    const remaining = JSON.parse((await AsyncStorage.getItem(LEGACY_DATA_KEY)) ?? 'null') as { meetings: { id: string }[]; users: unknown[] };
    expect(remaining.meetings.map((m) => m.id)).toEqual(['someone-elses']);
    expect(remaining.users).toEqual([]);

    const attachments = JSON.parse((await AsyncStorage.getItem(cacheKeys.attachments(UID))) ?? '{}') as { items: Record<string, unknown> };
    expect(attachments.items.f1).toMatchObject({ meetingId: 'legacy_3f2b8a1c-1111-4aaa-8bbb-000000000001', localOnly: true, category: 'documents' });

    await data.flushOutbox();
    expect(remote.docs.get(firestorePaths.meeting(UID, 'legacy_3f2b8a1c-1111-4aaa-8bbb-000000000001'))).toMatchObject({ title: 'Kickoff' });
    expect(remote.docs.get(firestorePaths.user(UID))).toMatchObject({ legacyMigratedAt: expect.any(String) as string });

    // Second run: marker present.
    expect(await data.migrateLegacyLocalData(UID)).toMatchObject({ alreadyDone: true, migratedMeetings: 0 });

    // Marker lost (e.g. reinstall with restored backup): nothing is duplicated.
    await AsyncStorage.removeItem(cacheKeys.migration(UID));
    await AsyncStorage.setItem(LEGACY_DATA_KEY, JSON.stringify(LEGACY_BLOB));
    const rerun = await data.migrateLegacyLocalData(UID);
    expect(rerun).toMatchObject({ alreadyDone: false, migratedMeetings: 0, migratedNotes: 0, preferencesMigrated: false });
    expect(await data.listMeetings()).toHaveLength(2);
  });

  it('defers (keeps the legacy data, no marker) when the server preferences cannot be checked', async () => {
    await seedLegacyDevice();
    const { engine: data, remote } = engine();
    active = data;
    remote.online = false;
    await data.startSession(UID, { mode: 'headless', user: USER });

    const report = await data.migrateLegacyLocalData(UID);
    expect(report).toMatchObject({ migratedMeetings: 2, preferencesMigrated: false, errors: expect.arrayContaining(['offline']) as string[] });
    expect(await AsyncStorage.getItem(cacheKeys.migration(UID))).toBeNull();
    expect(await AsyncStorage.getItem(LEGACY_DATA_KEY)).not.toBeNull();
    expect(await AsyncStorage.getItem('google_access_token')).toBeNull();
    expect(await data.getPendingWriteCount()).toBeGreaterThanOrEqual(4);
  });

  it('defers without touching the legacy data when the account email is unknown', async () => {
    await seedLegacyDevice();
    const { engine: data, remote } = engine();
    active = data;
    remote.docs.set(firestorePaths.preferences(UID), { language: 'es', updatedAt: null });
    await data.startSession(UID, { mode: 'headless' });

    const report = await data.migrateLegacyLocalData(UID);
    expect(report).toMatchObject({ migratedMeetings: 0, migratedNotes: 0, errors: ['unauthenticated'] });
    expect(await AsyncStorage.getItem(LEGACY_DATA_KEY)).toBe(JSON.stringify(LEGACY_BLOB));
    expect(await AsyncStorage.getItem(cacheKeys.migration(UID))).toBeNull();
    expect(await AsyncStorage.getItem('google_refresh_token')).toBeNull();
  });

  it('does nothing but cleanup when there is no legacy data, and requires a session for the uid', async () => {
    const { engine: data } = engine();
    active = data;
    await expect(data.migrateLegacyLocalData(UID)).rejects.toMatchObject({ code: 'unauthenticated' });
    await AsyncStorage.setItem('google_user_info', '{}');
    await data.startSession(UID, { mode: 'headless' });
    expect(await data.migrateLegacyLocalData(UID)).toMatchObject({ alreadyDone: false, migratedMeetings: 0, removedLegacyKeys: 1 });
    await expect(data.migrateLegacyLocalData('otherUser')).rejects.toMatchObject({ code: 'unauthenticated' });
  });
});
