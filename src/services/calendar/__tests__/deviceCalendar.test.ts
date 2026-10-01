import { createEventBus, type AppEventMap } from '../../../core/events';
import { toLocalDateTime } from '../../../core/time';
import { createDefaultPreferences, type Preferences } from '../../../core/types';
import type { DeviceCalendarPort, DevicePermission } from '../device/adapter';
import {
  deviceEventToMeetingInput,
  deviceOccurrenceKey,
  generateDeviceKey,
  isGoogleAccountCalendar,
  meetingToDeviceEvent,
  ownRawId,
  parseScopedId,
  scopeId,
  type DeviceCalendarLike,
  type DeviceEventDetails,
  type DeviceEventLike,
} from '../device/mapping';
import { createDeviceCalendarService } from '../device/service';
import { defaultDeviceSyncState, type DeviceSyncState } from '../stateStore';
import { createCalendarStatusStore } from '../status';
import { FakeClock, FakeMeetings, memoryStateStore } from '../__testUtils__/fakes';

const KEY = 'abcdefghij12';
const OTHER_KEY = 'zzzzzzzzzz99';

function event(overrides: Partial<DeviceEventLike> = {}): DeviceEventLike {
  return {
    id: '101',
    calendarId: '3',
    title: 'Dentist',
    notes: null,
    location: null,
    startDate: '2026-10-05T16:00:00.000Z',
    endDate: '2026-10-05T16:45:00.000Z',
    allDay: false,
    timeZone: 'America/New_York',
    status: 'confirmed',
    recurrenceRule: null,
    ...overrides,
  };
}

describe('device-scoped ids', () => {
  it('scopes and parses ids and ignores other devices', () => {
    const scoped = scopeId(KEY, 'E621E1F8-C36C:1');
    expect(parseScopedId(scoped)).toEqual({ deviceKey: KEY, rawId: 'E621E1F8-C36C:1' });
    expect(ownRawId(scoped, KEY)).toBe('E621E1F8-C36C:1');
    expect(ownRawId(scopeId(OTHER_KEY, '3'), KEY)).toBeNull();
    expect(ownRawId('3', KEY)).toBeNull();
    expect(generateDeviceKey(() => 0.5)).toMatch(/^[a-z0-9]{12}$/);
  });

  it('keys recurring occurrences by start', () => {
    expect(deviceOccurrenceKey(event())).toBe('101');
    expect(deviceOccurrenceKey(event({ recurrenceRule: { frequency: 'weekly' } }))).toBe('101@2026-10-05T16:00:00.000Z');
  });
});

describe('device event mapping', () => {
  const ctx = { platform: 'android' as const, deviceTimeZone: 'America/Los_Angeles', untitledTitle: '(No title)' };

  it('maps timed events and ignores non-IANA zone names (iOS)', () => {
    expect(deviceEventToMeetingInput(event(), ctx)).toMatchObject({
      title: 'Dentist',
      startAt: '2026-10-05T16:00:00.000Z',
      durationMinutes: 45,
      timezone: 'America/New_York',
      allDay: false,
      participants: [],
    });
    expect(deviceEventToMeetingInput(event({ timeZone: 'EST' }), { ...ctx, platform: 'ios' })?.timezone).toBe(
      'America/Los_Angeles',
    );
  });

  it('keeps all-day dates on Android (UTC midnight) and iOS (local midnight)', () => {
    const android = deviceEventToMeetingInput(
      event({ allDay: true, startDate: '2026-10-05T00:00:00.000Z', endDate: '2026-10-07T00:00:00.000Z', timeZone: 'UTC' }),
      ctx,
    );
    expect(toLocalDateTime(android!.startAt, android!.timezone ?? '').date).toBe('2026-10-05');
    expect(android?.durationMinutes).toBe(2 * 1440);

    const ios = deviceEventToMeetingInput(
      event({ allDay: true, startDate: '2026-10-05T07:00:00.000Z', endDate: '2026-10-06T06:59:59.000Z', timeZone: 'PDT' }),
      { ...ctx, platform: 'ios' },
    );
    expect(toLocalDateTime(ios!.startAt, ios!.timezone ?? '').date).toBe('2026-10-05');
    expect(ios?.durationMinutes).toBe(1440);
  });

  it('detects conference links in notes', () => {
    const input = deviceEventToMeetingInput(event({ notes: 'Join: https://teams.microsoft.com/l/meetup-join/xyz.' }), ctx);
    expect(input?.conference).toEqual({ provider: 'teams', url: 'https://teams.microsoft.com/l/meetup-join/xyz', password: null });
  });

  it('writes all-day exports the way each platform stores them', () => {
    const allDay = {
      title: 'Holiday',
      description: '',
      startAt: '2026-10-05T07:00:00.000Z',
      durationMinutes: 1440,
      timezone: 'America/Los_Angeles',
      allDay: true,
      location: null,
      conference: { provider: 'zoom' as const, url: 'https://zoom.us/j/1', password: null },
    };
    const android = meetingToDeviceEvent(allDay, { platform: 'android', deviceTimeZone: 'America/Los_Angeles' });
    expect(android.startDate.toISOString()).toBe('2026-10-05T00:00:00.000Z');
    expect(android.endDate.toISOString()).toBe('2026-10-06T00:00:00.000Z');
    expect(android.timeZone).toBe('UTC');
    expect(android.notes).toBe('https://zoom.us/j/1');
    expect(android.alarms).toEqual([]);
    const ios = meetingToDeviceEvent(allDay, { platform: 'ios', deviceTimeZone: 'America/Los_Angeles' });
    expect(ios.startDate.toISOString()).toBe('2026-10-05T07:00:00.000Z');
    expect(ios.endDate.toISOString()).toBe('2026-10-06T06:59:59.000Z');
    expect(ios.url).toBe('https://zoom.us/j/1');
  });

  it('recognizes Google account calendars', () => {
    const google: DeviceCalendarLike = { id: '1', title: 'me@gmail.com', allowsModifications: true, source: { name: 'me@gmail.com', type: 'com.google' } };
    expect(isGoogleAccountCalendar(google, 'android')).toBe(true);
    expect(isGoogleAccountCalendar({ ...google, source: { name: 'Gmail', type: 'caldav' } }, 'ios')).toBe(true);
    expect(isGoogleAccountCalendar({ ...google, source: { name: 'iCloud', type: 'caldav' } }, 'ios')).toBe(false);
    expect(isGoogleAccountCalendar({ ...google, source: { name: 'Phone', type: 'LOCAL' } }, 'android')).toBe(false);
  });
});

class FakePort implements DeviceCalendarPort {
  permission: DevicePermission = { status: 'granted', canAskAgain: true };
  calendars: DeviceCalendarLike[] = [
    { id: '3', title: 'Personal', allowsModifications: true, source: { name: 'Phone', type: 'LOCAL' } },
    { id: '4', title: 'me@gmail.com', allowsModifications: true, source: { name: 'me@gmail.com', type: 'com.google' } },
  ];
  events: DeviceEventLike[] = [];
  created: { calendarId: string; details: DeviceEventDetails }[] = [];
  updated: string[] = [];
  deleted: string[] = [];
  private seq = 500;

  getPermission = async () => this.permission;
  requestPermission = async () => this.permission;
  getCalendars = async () => this.calendars;
  listEvents = async (calendarIds: readonly string[]) => this.events.filter((item) => calendarIds.includes(item.calendarId ?? ''));
  findEvent = async (eventId: string) => this.events.find((item) => item.id === eventId) ?? null;
  createEvent = async (calendarId: string, details: DeviceEventDetails) => {
    this.seq += 1;
    const id = String(this.seq);
    this.created.push({ calendarId, details });
    this.events.push({
      ...event({ id, calendarId, title: details.title, startDate: details.startDate, endDate: details.endDate }),
    });
    return id;
  };
  updateEvent = async (eventId: string) => {
    this.updated.push(eventId);
  };
  deleteEvent = async (eventId: string) => {
    this.deleted.push(eventId);
    this.events = this.events.filter((item) => item.id !== eventId);
  };
}

function setupService(prefs: Partial<Preferences> = {}) {
  const clock = new FakeClock(new Date('2026-10-01T08:00:00.000Z'));
  const port = new FakePort();
  const meetings = new FakeMeetings(clock);
  const state = memoryStateStore<DeviceSyncState>(defaultDeviceSyncState());
  const preferences = { ...createDefaultPreferences({ timezone: 'America/Los_Angeles' }), ...prefs };
  const service = createDeviceCalendarService({
    port,
    meetings,
    preferences: { get: async () => preferences },
    state,
    deviceKey: async () => KEY,
    platform: 'android',
    deviceTimeZone: () => 'America/Los_Angeles',
    untitledTitle: () => '(No title)',
    now: clock.now,
    status: createCalendarStatusStore(),
    events: createEventBus<AppEventMap>(),
    getUid: () => 'user-1',
  });
  return { service, port, meetings, preferences, state };
}

describe('deviceCalendarService', () => {
  it('lists calendars with scoped ids', async () => {
    const { service } = setupService();
    const calendars = await service.listCalendars();
    expect(calendars.map((calendar) => calendar.id)).toEqual([scopeId(KEY, '4'), scopeId(KEY, '3')]);
    expect(calendars.find((calendar) => calendar.title === 'me@gmail.com')?.isGoogleAccount).toBe(true);
  });

  it('imports selected calendars, skips unchanged events and prunes removed ones', async () => {
    const { service, port, meetings } = setupService();
    port.events = [event({ id: '101' }), event({ id: '102', title: 'Gym' }), event({ id: '900', calendarId: '4' })];
    const first = await service.importFrom([scopeId(KEY, '3'), scopeId(OTHER_KEY, '3')]);
    expect(first.counts.created).toBe(2);
    expect(meetings.all().every((meeting) => meeting.source === 'device')).toBe(true);
    expect(meetings.all()[0]?.external.deviceEventId).toBe(scopeId(KEY, '101'));
    expect(meetings.all()[0]?.external.deviceCalendarId).toBe(scopeId(KEY, '3'));

    const again = await service.importFrom([scopeId(KEY, '3')]);
    expect(again.counts).toMatchObject({ created: 0, updated: 0, removed: 0, unchanged: 2 });

    port.events = [event({ id: '101', title: 'Dentist (moved)' })];
    const third = await service.importFrom([scopeId(KEY, '3')]);
    expect(third.counts).toMatchObject({ updated: 1, removed: 1 });

    const deselected = await service.importFrom([]);
    expect(deselected.counts.removed).toBe(1);
    expect(meetings.all().every((meeting) => meeting.deletedAt !== null)).toBe(true);
  });

  it('skips Google account calendars while Google sync is on', async () => {
    const { service, port, meetings } = setupService({ googleCalendarSyncEnabled: true });
    port.events = [event({ id: '900', calendarId: '4' })];
    await service.importFrom([scopeId(KEY, '4')]);
    expect(meetings.all()).toHaveLength(0);
  });

  it('exports our meetings once, updates on change and never re-imports the copy', async () => {
    const { service, port, meetings } = setupService();
    const own = meetings.add({ title: 'Review', startAt: '2026-10-05T16:00:00.000Z', source: 'manual' });
    const exported = await service.exportMeeting(own, scopeId(KEY, '3'));
    expect(port.created).toHaveLength(1);
    expect(exported.external.deviceEventId).toBe(scopeId(KEY, '501'));

    await service.exportMeeting(exported, scopeId(KEY, '3'));
    expect(port.created).toHaveLength(1);
    expect(port.updated).toHaveLength(0);

    const renamed = await meetings.update(own.id, { title: 'Review v2' }, { origin: 'user' });
    await service.exportMeeting(renamed, scopeId(KEY, '3'));
    expect(port.updated).toEqual(['501']);

    await service.importFrom([scopeId(KEY, '3')]);
    expect(meetings.all().filter((meeting) => meeting.source === 'device')).toHaveLength(0);

    await expect(service.exportMeeting(renamed, scopeId(OTHER_KEY, '3'))).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('never deletes the original event of an imported meeting', async () => {
    const { service, port, meetings } = setupService();
    port.events = [event({ id: '101' })];
    await service.importFrom([scopeId(KEY, '3')]);
    await service.removeExported(meetings.all()[0]!);
    expect(port.deleted).toEqual([]);
  });

  it('reconciles exports against the export target', async () => {
    const { service, port, meetings, preferences } = setupService();
    preferences.deviceCalendarExportId = scopeId(KEY, '3');
    meetings.add({ title: 'Upcoming', startAt: '2026-10-05T16:00:00.000Z', source: 'ai_chat' });
    meetings.add({ title: 'Imported', startAt: '2026-10-05T18:00:00.000Z', source: 'google' });
    meetings.add({ title: 'Old', startAt: '2026-08-01T16:00:00.000Z', source: 'manual' });
    expect(await service.syncExports()).toEqual({ exported: 1, removed: 0, failed: 0 });

    preferences.deviceCalendarExportId = null;
    expect(await service.syncExports()).toEqual({ exported: 0, removed: 1, failed: 0 });
    expect(port.deleted).toHaveLength(1);
  });

  it('never exports recurring masters and removes a copy exported before the repeat was added', async () => {
    const { service, port, meetings, preferences } = setupService();
    preferences.deviceCalendarExportId = scopeId(KEY, '3');
    const weekly = { freq: 'weekly', interval: 1, byWeekday: null, byMonthDay: null, until: null, count: null } as const;
    // A master is one stored document: exporting it would freeze its FIRST occurrence in the
    // phone calendar as a single stale event (ARCHITECTURE §16).
    meetings.add({ title: 'Series', startAt: '2026-10-05T16:00:00.000Z', source: 'manual', recurrence: weekly });
    const own = meetings.add({ title: 'One-off', startAt: '2026-10-05T17:00:00.000Z', source: 'manual' });
    expect(await service.syncExports()).toEqual({ exported: 1, removed: 0, failed: 0 });
    expect(port.created).toHaveLength(1);

    // The exported one-off later becomes recurring: its copy is removed on the next sync.
    await meetings.update(own.id, { recurrence: weekly }, { origin: 'user' });
    expect(await service.syncExports()).toEqual({ exported: 0, removed: 1, failed: 0 });
    expect(port.deleted).toHaveLength(1);
  });

  it('removes the copy of a deleted meeting once', async () => {
    const { service, port, meetings, preferences } = setupService();
    preferences.deviceCalendarExportId = scopeId(KEY, '3');
    const own = meetings.add({ title: 'Upcoming', startAt: '2026-10-05T16:00:00.000Z', source: 'manual' });
    await service.syncExports();
    const exported = meetings.meetings.get(own.id)!;
    await meetings.remove(exported.id, { origin: 'user' });
    expect(await service.syncExports({ meetingIds: [own.id] })).toEqual({ exported: 0, removed: 1, failed: 0 });
    expect(await service.syncExports()).toEqual({ exported: 0, removed: 0, failed: 0 });
    expect(port.deleted).toHaveLength(1);
  });

  it('requires calendar permission for device access', async () => {
    const { service, port } = setupService();
    port.permission = { status: 'denied', canAskAgain: false };
    await expect(service.listCalendars()).rejects.toMatchObject({ code: 'calendar_permission_denied' });
    await expect(service.importFrom([scopeId(KEY, '3')])).rejects.toMatchObject({ code: 'calendar_permission_denied' });
  });
});

describe('device calendar export on several devices', () => {
  function device(key: string, meetings: FakeMeetings, clock: FakeClock, exportRaw: string | null) {
    const port = new FakePort();
    const state = memoryStateStore<DeviceSyncState>(defaultDeviceSyncState());
    const preferences = {
      ...createDefaultPreferences({ timezone: 'America/Los_Angeles' }),
      deviceCalendarExportId: exportRaw === null ? null : scopeId(key, exportRaw),
    };
    const service = createDeviceCalendarService({
      port,
      meetings,
      preferences: { get: async () => preferences },
      state,
      deviceKey: async () => key,
      platform: 'android',
      deviceTimeZone: () => 'America/Los_Angeles',
      untitledTitle: () => '(No title)',
      now: clock.now,
      status: createCalendarStatusStore(),
      events: createEventBus<AppEventMap>(),
      getUid: () => 'user-1',
    });
    return { service, port, state, preferences };
  }

  function setupTwo() {
    const clock = new FakeClock(new Date('2026-10-01T08:00:00.000Z'));
    const meetings = new FakeMeetings(clock);
    const own = meetings.add({ title: 'Review', startAt: '2026-10-05T16:00:00.000Z', source: 'manual' });
    return { meetings, own, a: device(KEY, meetings, clock, '3'), b: device(OTHER_KEY, meetings, clock, '3') };
  }

  it('keeps one copy per device and never overwrites or clears the other device's link', async () => {
    const { meetings, own, a, b } = setupTwo();
    await a.service.syncExports();
    await b.service.syncExports();
    expect(a.port.created).toHaveLength(1);
    expect(b.port.created).toHaveLength(1);
    // The synced hint stays with the first device; B keeps its own link locally.
    expect(meetings.meetings.get(own.id)?.external.deviceEventId).toBe(scopeId(KEY, '501'));
    expect(b.state.value.exportLinks[own.id]).toEqual({ eventId: '501', calendarId: '3' });

    // Repeated syncs on both devices: no duplicates, nothing re-created.
    await a.service.syncExports();
    await b.service.syncExports();
    await b.service.sync();
    expect(a.port.created).toHaveLength(1);
    expect(b.port.created).toHaveLength(1);
    expect(meetings.all().filter((meeting) => meeting.source === 'device')).toHaveLength(0);

    // B turns its export off: B removes ITS copy; A's copy and the shared hint are untouched.
    b.preferences.deviceCalendarExportId = null;
    expect(await b.service.syncExports()).toEqual({ exported: 0, removed: 1, failed: 0 });
    expect(b.port.deleted).toEqual(['501']);
    expect(a.port.deleted).toEqual([]);
    expect(meetings.meetings.get(own.id)?.external.deviceEventId).toBe(scopeId(KEY, '501'));

    // A turns its export off too: its own copy (known through the hint/link) is removed.
    a.preferences.deviceCalendarExportId = null;
    expect(await a.service.syncExports()).toEqual({ exported: 0, removed: 1, failed: 0 });
    expect(a.port.deleted).toEqual(['501']);
    expect(meetings.meetings.get(own.id)?.external.deviceEventId).toBeNull();
  });

  it('adopts its own copy instead of duplicating it after the local state was wiped (sign-out)', async () => {
    const { a, b } = setupTwo();
    await a.service.syncExports();
    await b.service.syncExports();
    expect(b.port.created).toHaveLength(1);

    b.state.value = defaultDeviceSyncState();
    await b.service.sync();
    expect(b.port.created).toHaveLength(1);
    expect(b.state.value.exportLinks).not.toEqual({});
  });
});
