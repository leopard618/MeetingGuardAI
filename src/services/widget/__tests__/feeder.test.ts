/**
 * Widget feeder: event wiring, coalescing, formatting handoff and the unavailable-module no-op
 * (docs/ARCHITECTURE.md §19). Real event bus + real i18next (widget namespace, EN + ES);
 * widget/data/format ports are fakes.
 */
import { createInstance } from 'i18next';

import type { FormatOptions, TranslateFn } from '../../../core/contracts';
import { createEventBus, type AppEventMap, type EventBus } from '../../../core/events';
import type { Logger } from '../../../core/logger';
import { buildMeeting, createDefaultPreferences, type Meeting, type Preferences } from '../../../core/types';
import type { MgWidgetMeetingData, MgWidgetStrings } from '../../../../modules/mg-next-meeting-widget';
import { createWidgetFeeder, widgetStringsOf, type WidgetFeederDeps } from '../feeder';

import en from '../../../i18n/locales/en/widget.json';
import es from '../../../i18n/locales/es/widget.json';

const NOW = new Date('2026-10-05T12:00:00.000Z');
const UID = 'user-1';

const instance = createInstance();
void instance.init({
  resources: { en: { widget: en }, es: { widget: es } },
  lng: 'en',
  fallbackLng: 'en',
  ns: ['widget'],
  defaultNS: 'widget',
  interpolation: { escapeValue: false },
  initAsync: false,
});

function translator(language: 'en' | 'es'): TranslateFn {
  const fixed = instance.getFixedT(language);
  return (key, options) => fixed(key, options as Record<string, unknown>) as unknown as string;
}

function makeMeeting(id: string, startAt: string): Meeting {
  return buildMeeting(
    { title: `Meeting ${id}`, startAt, source: 'manual' },
    { id, userId: UID, now: '2026-10-01T00:00:00.000Z', defaultTimezone: 'UTC', defaultLanguage: 'en' },
  );
}

interface Harness {
  deps: WidgetFeederDeps;
  events: EventBus<AppEventMap>;
  widget: {
    available: boolean;
    setNextMeeting: jest.Mock<Promise<void>, [MgWidgetMeetingData | null]>;
    setStrings: jest.Mock<Promise<void>, [MgWidgetStrings]>;
    clear: jest.Mock<Promise<void>, []>;
  };
  data: {
    uid: string | null;
    meetings: Meeting[];
    preferences: Preferences | null;
    getCachedUpcoming: jest.Mock;
  };
  warnings: string[];
  language: 'en' | 'es';
  setLanguage(next: 'en' | 'es'): void;
}

function makeHarness(options: { available?: boolean } = {}): Harness {
  const events = createEventBus<AppEventMap>();
  const widget = {
    available: options.available ?? true,
    setNextMeeting: jest.fn(async (_data: MgWidgetMeetingData | null) => undefined),
    setStrings: jest.fn(async (_strings: MgWidgetStrings) => undefined),
    clear: jest.fn(async () => undefined),
  };
  const data: Harness['data'] = {
    uid: UID,
    meetings: [],
    preferences: createDefaultPreferences({ language: 'en', timezone: 'UTC' }),
    getCachedUpcoming: jest.fn(async () => data.meetings),
  };
  const warnings: string[] = [];
  const logger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: (message: string) => {
      warnings.push(message);
    },
    error: () => undefined,
  };
  const harness: Harness = {
    events,
    widget,
    data,
    warnings,
    language: 'en',
    setLanguage(next) {
      harness.language = next;
    },
    deps: {
      widget: {
        isNativeModuleAvailable: () => widget.available,
        setNextMeeting: widget.setNextMeeting,
        setStrings: widget.setStrings,
        clear: widget.clear,
      },
      events,
      data: {
        getActiveUid: () => data.uid,
        getCachedUpcoming: data.getCachedUpcoming,
        getCachedPreferences: async () => data.preferences,
      },
      i18n: {
        t: (key, opts) => translator(harness.language)(key, opts),
        getLanguage: () => harness.language,
      },
      format: {
        formatTime: (value: string, opts: FormatOptions) => `time(${value}|${String(opts.use24Hour)})`,
        formatDate: (value: string, style, _opts: FormatOptions) => `date(${value}|${style})`,
      },
      deviceTimeZone: () => 'UTC',
      logger,
      now: () => NOW,
    },
  };
  return harness;
}

/** The chain is pure promises (no timers): a few microtask turns settle it. */
async function flush(): Promise<void> {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

it('does nothing anywhere when the native module is unavailable', async () => {
  const h = makeHarness({ available: false });
  const feeder = createWidgetFeeder(h.deps);
  feeder.register();
  h.events.emit('session:started', { uid: UID, restored: true });
  h.events.emit('meetings:changed', { uid: UID, reason: 'updated' });
  h.events.emit('session:ended', { uid: UID, reason: 'sign_out' });
  await feeder.refresh();
  await flush();
  expect(h.data.getCachedUpcoming).not.toHaveBeenCalled();
  expect(h.widget.setNextMeeting).not.toHaveBeenCalled();
  expect(h.widget.setStrings).not.toHaveBeenCalled();
  expect(h.widget.clear).not.toHaveBeenCalled();
});

it('pushes strings and the next meeting on session start', async () => {
  const h = makeHarness();
  h.data.meetings = [makeMeeting('m-1', '2026-10-05T15:00:00.000Z')];
  createWidgetFeeder(h.deps).register();
  h.events.emit('session:started', { uid: UID, restored: false });
  await flush();
  expect(h.widget.setStrings).toHaveBeenCalledWith({
    emptyTitle: 'No upcoming meetings',
    emptyBody: 'Open MeetingGuard to plan one',
    nowLabel: 'Happening now',
  });
  expect(h.widget.setNextMeeting).toHaveBeenCalledWith({
    title: 'Meeting m-1',
    startAtMs: Date.parse('2026-10-05T15:00:00.000Z'),
    timeText: 'time(2026-10-05T15:00:00.000Z|null)',
    dateText: 'Today',
    deepLink: 'meetingguardai://meeting/m-1',
  });
});

it('labels tomorrow and falls back to the formatted date beyond that', async () => {
  const h = makeHarness();
  const feeder = createWidgetFeeder(h.deps);
  h.data.meetings = [makeMeeting('m-2', '2026-10-06T09:00:00.000Z')];
  await feeder.refresh();
  expect(h.widget.setNextMeeting).toHaveBeenLastCalledWith(expect.objectContaining({ dateText: 'Tomorrow' }));
  h.data.meetings = [makeMeeting('m-3', '2026-10-09T09:00:00.000Z')];
  await feeder.refresh();
  expect(h.widget.setNextMeeting).toHaveBeenLastCalledWith(
    expect.objectContaining({ dateText: 'date(2026-10-09T09:00:00.000Z|medium)' }),
  );
});

it('passes the 24-hour clock preference through to the time formatter', async () => {
  const h = makeHarness();
  h.data.preferences = { ...createDefaultPreferences({ language: 'en', timezone: 'UTC' }), use24HourClock: true };
  h.data.meetings = [makeMeeting('m-1', '2026-10-05T15:00:00.000Z')];
  await createWidgetFeeder(h.deps).refresh();
  expect(h.widget.setNextMeeting).toHaveBeenCalledWith(
    expect.objectContaining({ timeText: 'time(2026-10-05T15:00:00.000Z|true)' }),
  );
});

it('clears the entry when nothing is upcoming and clears the widget on session end', async () => {
  const h = makeHarness();
  const feeder = createWidgetFeeder(h.deps);
  feeder.register();
  await feeder.refresh();
  expect(h.widget.setNextMeeting).toHaveBeenCalledWith(null);
  h.events.emit('session:ended', { uid: UID, reason: 'sign_out' });
  await flush();
  expect(h.widget.clear).toHaveBeenCalledTimes(1);
});

it('skips the data read entirely when no session is active', async () => {
  const h = makeHarness();
  h.data.uid = null;
  await createWidgetFeeder(h.deps).refresh();
  expect(h.data.getCachedUpcoming).not.toHaveBeenCalled();
  expect(h.widget.setNextMeeting).not.toHaveBeenCalled();
});

it('coalesces a synchronous burst of change events into one feed', async () => {
  const h = makeHarness();
  createWidgetFeeder(h.deps).register();
  h.events.emit('meetings:changed', { uid: UID, reason: 'updated' });
  h.events.emit('meetings:changed', { uid: UID, reason: 'updated' });
  h.events.emit('calendar:synced', { uid: UID, provider: 'google', created: 1, updated: 0, removed: 0, pushed: 0, error: null });
  await flush();
  expect(h.data.getCachedUpcoming).toHaveBeenCalledTimes(1);
});

it('re-pushes strings in the new language and keeps feeding after a failure', async () => {
  const h = makeHarness();
  const feeder = createWidgetFeeder(h.deps);
  feeder.register();
  h.data.getCachedUpcoming.mockRejectedValueOnce(new Error('cache read failed'));
  await feeder.refresh();
  await flush();
  expect(h.warnings).toHaveLength(1);
  expect(h.widget.setNextMeeting).not.toHaveBeenCalled();

  h.setLanguage('es');
  h.events.emit('language:changed', { language: 'es', source: 'user' });
  await flush();
  expect(h.widget.setStrings).toHaveBeenLastCalledWith({
    emptyTitle: 'No hay reuniones próximas',
    emptyBody: 'Abre MeetingGuard para planificar una',
    nowLabel: 'En curso',
  });
  expect(h.widget.setNextMeeting).toHaveBeenLastCalledWith(null);
});

it('registration is idempotent (no duplicate subscriptions)', async () => {
  const h = makeHarness();
  const feeder = createWidgetFeeder(h.deps);
  feeder.register();
  feeder.register();
  h.events.emit('session:ended', { uid: UID, reason: 'sign_out' });
  await flush();
  expect(h.widget.clear).toHaveBeenCalledTimes(1);
});

it('widgetStringsOf reads the widget namespace', () => {
  expect(widgetStringsOf(translator('en'))).toEqual({
    emptyTitle: 'No upcoming meetings',
    emptyBody: 'Open MeetingGuard to plan one',
    nowLabel: 'Happening now',
  });
});
