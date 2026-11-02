/**
 * GoogleTasksSyncService orchestration: enable (scope -> list -> preferences -> first sync),
 * setList, disable cleanup, sync, and the not-configured / no-account / no-scope / not-enabled guards.
 */
import { createDefaultPreferences, type Preferences, type PreferencesPatch } from '../../../core/types';
import { createCalendarStatusStore } from '../../calendar/status';
import { createGoogleTasksSyncService, toTaskListInfo } from '../gtasks/service';
import { defaultGtasksSyncState, type GtasksSyncState } from '../gtasks/state';
import { gtasksTaskLocalId } from '../gtasks/sync';
import { FakeClock, FakeTasks, memoryStateStore } from '../__testUtils__/fakes';
import { FakeGoogleTasksApi, googleTasksError } from '../__testUtils__/gtasksFakes';

const NOW = new Date('2026-10-01T08:00:00.000Z');
const LIST = { id: 'gl-default', name: 'My Tasks' };

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function setup(options: { enabled?: boolean; connected?: boolean; hasScope?: boolean; grant?: boolean } = {}) {
  const clock = new FakeClock(new Date(NOW));
  const api = new FakeGoogleTasksApi(clock);
  const tasks = new FakeTasks(clock);
  const state = memoryStateStore<GtasksSyncState>(defaultGtasksSyncState());
  const status = createCalendarStatusStore();
  let preferences: Preferences = createDefaultPreferences();
  const prefsRepo = {
    get: jest.fn(async () => preferences),
    update: jest.fn(async (patch: PreferencesPatch) => {
      preferences = { ...preferences, ...patch };
      return preferences;
    }),
  };
  let hasScope = options.hasScope !== false;
  const auth = {
    isAccountConnected: jest.fn(async () => options.connected !== false),
    hasTasksScope: jest.fn(async () => hasScope),
    requestTasksScope: jest.fn(async () => {
      if (options.grant === false) return false;
      hasScope = true;
      return true;
    }),
  };
  const service = createGoogleTasksSyncService({
    api,
    tasks,
    state,
    auth,
    preferences: prefsRepo,
    status,
    now: clock.now,
    defaultTimeZone: () => 'UTC',
    untitledTitle: () => '(No title)',
    config: { enabled: options.enabled !== false },
  });
  return { service, api, tasks, state, status, prefsRepo, auth, prefs: () => preferences };
}

describe('google tasks service', () => {
  it('is unconfigured when the build switch is off and every method says so', async () => {
    const { service, status } = setup({ enabled: false });
    expect(service.isConfigured()).toBe(false);
    await expect(service.isAccountConnected()).resolves.toBe(false);
    await expect(service.listLists()).rejects.toMatchObject({ code: 'not_configured' });
    await expect(service.sync()).rejects.toMatchObject({ code: 'not_configured' });
    expect(status.get().gtasks).toBeUndefined();
  });

  it('needs a Google account before listing or enabling', async () => {
    const { service, status } = setup({ connected: false });
    await expect(service.isAccountConnected()).resolves.toBe(false);
    await expect(service.listLists()).rejects.toMatchObject({ code: 'google_not_signed_in' });
    await expect(service.enable(LIST)).rejects.toMatchObject({ code: 'google_not_signed_in' });
    await expect(service.sync()).rejects.toMatchObject({ code: 'calendar_not_connected' });
    expect(status.get().gtasks).toMatchObject({ configured: true, connected: false, hasScope: false, enabled: false });
  });

  it('needs the tasks scope to list, and asks for it on enable', async () => {
    const { service, auth, api, status } = setup({ hasScope: false });
    api.seed(LIST.id, { id: 'a1' });
    await expect(service.listLists()).rejects.toMatchObject({ code: 'tasks_scope_missing' });

    const result = await service.enable(LIST);

    expect(auth.requestTasksScope).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ counts: { created: 1 } });
    expect(status.get().gtasks).toMatchObject({ enabled: true, hasScope: true });
  });

  it('stays off when the user declines the tasks scope', async () => {
    const { service, state, status, prefs } = setup({ hasScope: false, grant: false });
    await expect(service.enable(LIST)).rejects.toMatchObject({ code: 'tasks_scope_missing' });
    expect(state.value.enabled).toBe(false);
    expect(prefs().gtasksListId).toBeNull();
    expect(status.get().gtasks).toMatchObject({ enabled: false, hasScope: false });
  });

  it('lists the account lists and marks the first one as the default', async () => {
    const { service, api } = setup();
    api.lists.push({ id: 'gl-work', title: ' Work ' });
    await expect(service.listLists()).resolves.toEqual([
      { id: 'gl-default', name: 'My Tasks', isDefault: true },
      { id: 'gl-work', name: 'Work', isDefault: false },
    ]);
    expect(toTaskListInfo({ id: 'x', title: null }, 3)).toEqual({ id: 'x', name: '', isDefault: false });
  });

  it('enables: stores the list, pulls it, pushes open tasks, and reports the status', async () => {
    const { service, api, tasks, state, status, prefs } = setup();
    api.seed(LIST.id, { id: 'a1', title: 'From Google' });
    const mine = tasks.add({ title: 'Mine' });

    const result = await service.enable(LIST);

    expect(prefs()).toMatchObject({ gtasksListId: LIST.id, gtasksListName: LIST.name });
    expect(result).toMatchObject({ fullSync: true, counts: { created: 1, pushed: 1, failed: 0 } });
    expect(state.value.enabled).toBe(true);
    expect(await tasks.get(gtasksTaskLocalId('a1'))).not.toBeNull();
    expect((await tasks.get(mine.id))?.external.gtasksTaskId).toBe('g1');
    expect(status.get().gtasks).toMatchObject({
      configured: true,
      connected: true,
      hasScope: true,
      enabled: true,
      listId: LIST.id,
      listName: 'My Tasks',
      lastError: null,
    });
    expect(status.get().gtasks?.lastSyncAt).toBe(NOW.toISOString());
    await expect(service.isEnabled()).resolves.toBe(true);
  });

  it('stays enabled when the first sync fails and surfaces the error', async () => {
    const { service, api, status } = setup();
    api.failures.push({ method: 'list', error: googleTasksError(403, 'forbidden') });

    const result = await service.enable(LIST);

    expect(result).toBeNull();
    expect(status.get().gtasks).toMatchObject({ enabled: true, lastError: 'permission_denied' });
  });

  it('sync flushes then pulls and refreshes the status', async () => {
    const { service, api, tasks, status } = setup();
    await service.enable(LIST);
    const other = tasks.add({ title: 'Added later' });
    await service.enqueue([{ id: other.id, op: 'upsert' }]);
    api.seed(LIST.id, { id: 'a2', title: 'New in Google', updated: '2026-10-01T08:30:00.000Z' });

    const result = await service.sync();

    expect(result.counts).toMatchObject({ pushed: 1, created: 1 });
    expect((await tasks.get(other.id))?.external.gtasksTaskId).toBeDefined();
    expect(status.get().gtasks).toMatchObject({ enabled: true, lastError: null, syncing: false });
  });

  it('setList only changes the default for new tasks', async () => {
    const { service, api, tasks, status, prefs } = setup();
    await service.enable(LIST);
    const mine = tasks.add({ title: 'Mine' });
    await service.enqueue([{ id: mine.id, op: 'upsert' }]);
    await service.sync();
    api.calls = [];

    await service.setList({ id: 'gl-work', name: 'Work' });

    expect(prefs()).toMatchObject({ gtasksListId: 'gl-work', gtasksListName: 'Work' });
    expect(status.get().gtasks).toMatchObject({ listId: 'gl-work', listName: 'Work' });
    expect((await tasks.get(mine.id))?.external.gtasksListId).toBe(LIST.id);
    const later = tasks.add({ title: 'Later' });
    await service.enqueue([{ id: later.id, op: 'upsert' }]);
    await service.flushPending();
    expect(api.calls.filter((call) => call.method === 'create').map((call) => call.listId)).toEqual(['gl-work']);
  });

  it('disable deletes imported tasks, unlinks the rest, clears the list and the state', async () => {
    const { service, api, tasks, state, status, prefs } = setup();
    api.seed(LIST.id, { id: 'a1', title: 'From Google' });
    const mine = tasks.add({ title: 'Mine' });
    await service.enable(LIST);
    api.calls = [];

    await service.disable();

    expect(await tasks.get(gtasksTaskLocalId('a1'))).toBeNull();
    expect((await tasks.get(mine.id))?.external).toMatchObject({ gtasksListId: null, gtasksTaskId: null, gtasksUpdatedAt: null });
    expect(prefs()).toMatchObject({ gtasksListId: null, gtasksListName: null });
    expect(state.value.enabled).toBe(false);
    expect(status.get().gtasks).toMatchObject({ enabled: false, listId: null });
    expect(api.calls).toEqual([]);
    await expect(service.sync()).rejects.toMatchObject({ code: 'calendar_not_connected' });
  });
});
