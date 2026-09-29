import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { dayRangeUtc } from '../../../core/time';
import type { KeyValueStorage } from '../cache';
import type { DataEngine } from '../engine';
import { useEntitlement, useMeeting, useMeetings, useNotes, usePreferences, useSyncState } from '../react';
import { settle } from '../testing/fakeRemote';

jest.mock('../instance', () => {
  const { DataEngine: Engine } = jest.requireActual<typeof import('../engine')>('../engine');
  const { FakeRemote: Remote } = jest.requireActual<typeof import('../testing/fakeRemote')>('../testing/fakeRemote');
  const storageModule = jest.requireMock<{ default?: unknown }>('@react-native-async-storage/async-storage');
  const remote = new Remote();
  const dataEngine = new Engine({
    remote,
    storage: (storageModule.default ?? storageModule) as KeyValueStorage,
    getLanguage: () => 'en',
    getTimeZone: () => 'America/Los_Angeles',
    timeouts: { flushDelayMs: 0, preferencesFallbackMs: 60_000, retryBaseMs: 60_000 },
  });
  return { dataEngine };
});

const { dataEngine } = jest.requireMock<{ dataEngine: DataEngine }>('../instance');
const UID = 'user1';

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(async () => {
  await act(async () => {
    await dataEngine.endSession({ wipeLocal: true });
  });
  await settle();
  jest.restoreAllMocks();
});

describe('data hooks', () => {
  it('reflect the session lifecycle and every local write without polling', async () => {
    const today = dayRangeUtc('2026-10-05', 'America/Los_Angeles');
    const { result } = await renderHook(() => ({
      today: useMeetings(today),
      all: useMeetings(),
      prefs: usePreferences(),
      entitlement: useEntitlement(),
      sync: useSyncState(),
    }));
    expect(result.current.all).toMatchObject({ meetings: [], isLoading: false, error: null });
    expect(result.current.prefs.isLoaded).toBe(false);
    expect(result.current.entitlement).toMatchObject({ plan: 'free', isLoaded: false });

    await act(async () => {
      await dataEngine.startSession(UID);
      await settle();
    });
    await waitFor(() => expect(result.current.prefs.isLoaded).toBe(true));

    await act(async () => {
      await dataEngine.createMeeting({ title: 'Late call', startAt: '2026-10-06T06:30:00.000Z', source: 'manual' }); // 23:30 PDT on the 5th
      await dataEngine.createMeeting({ title: 'Next day', startAt: '2026-10-06T16:00:00.000Z', source: 'manual' });
    });
    expect(result.current.all.meetings.map((m) => m.title)).toEqual(['Late call', 'Next day']);
    expect(result.current.today.meetings.map((m) => m.title)).toEqual(['Late call']);

    await act(async () => {
      await result.current.prefs.update({ alertIntensity: 'medium' });
    });
    expect(result.current.prefs.preferences.alertIntensity).toBe('medium');
    expect(result.current.sync.online).toBe(true);
    expect(result.current.entitlement).toMatchObject({ plan: 'free', isLoaded: true });

    await act(async () => {
      await dataEngine.endSession({ wipeLocal: true });
    });
    expect(result.current.all.meetings).toEqual([]);
    expect(result.current.prefs.isLoaded).toBe(false);
  });

  it('useMeeting follows one meeting and hides it once deleted; useNotes sorts pinned first', async () => {
    await act(async () => {
      await dataEngine.startSession(UID);
    });
    const meeting = await dataEngine.createMeeting({ title: 'Watch me', startAt: '2026-10-07T16:00:00.000Z', source: 'manual' });
    const { result } = await renderHook(() => ({ one: useMeeting(meeting.id), notes: useNotes() }));
    expect(result.current.one.meeting?.title).toBe('Watch me');

    await act(async () => {
      await dataEngine.updateMeeting(meeting.id, { title: 'Renamed' });
    });
    expect(result.current.one.meeting?.title).toBe('Renamed');

    await act(async () => {
      await result.current.notes.create({ title: 'Plain' });
      await result.current.notes.create({ title: 'Pinned', pinned: true });
    });
    expect(result.current.notes.notes.map((note) => note.title)).toEqual(['Pinned', 'Plain']);

    const plain = result.current.notes.notes.find((note) => note.title === 'Plain');
    await act(async () => {
      await dataEngine.removeMeeting(meeting.id);
      if (plain) await result.current.notes.remove(plain.id);
    });
    expect(result.current.one.meeting).toBeNull();
    expect(result.current.notes.notes.map((note) => note.title)).toEqual(['Pinned']);
  });

  it('reports an invalid range as an error instead of throwing during render', async () => {
    const { result } = await renderHook(() => useMeetings({ from: 'not a date' }));
    expect(result.current.error).toMatchObject({ code: 'invalid_input' });
    expect(result.current.meetings).toEqual([]);
  });
});
