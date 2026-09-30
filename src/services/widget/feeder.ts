/**
 * Widget feeder core (owner: widget; docs/ARCHITECTURE.md §19): event-driven glue between the
 * meeting store and the Android next-meeting widget, behind injected ports so it is unit-testable
 * without React Native. The app singleton is wired in ./index.ts.
 *
 * Lifecycle (WidgetFeeder in src/core/contracts.ts):
 * - session:started -> push localized strings + feed
 * - meetings:changed / calendar:synced -> feed
 * - preferences:changed (clock format) / language:changed -> push strings + feed
 * - session:ended -> clear()
 * Work is serialized on one promise chain (an event during a feed queues exactly one more run,
 * so bursts of meetings:changed coalesce) and every reaction is a cheap no-op when the native
 * module is unavailable (iOS, web, a binary without it). Errors are logged, never thrown: the
 * widget is an optional surface and must not break callers or the event bus.
 */
import type { FormatOptions, TranslateFn } from '../../core/contracts';
import type { AppEventMap, EventBus } from '../../core/events';
import { meetingDeepLink } from '../../core/identifiers';
import type { Logger } from '../../core/logger';
import { addDaysToLocalDate, toLocalDateTime, todayInZone } from '../../core/time';
import type { Language, Meeting, Preferences } from '../../core/types';
import type { MgWidgetMeetingData, MgWidgetStrings } from '../../../modules/mg-next-meeting-widget';
import { WIDGET_HORIZON_DAYS, computeNextWidgetEntry, type NextWidgetEntry } from './model';

/** Native surface the feeder drives (the TS wrapper of mg-next-meeting-widget). */
export interface WidgetModulePort {
  isNativeModuleAvailable(): boolean;
  setNextMeeting(data: MgWidgetMeetingData | null): Promise<void>;
  setStrings(strings: MgWidgetStrings): Promise<void>;
  clear(): Promise<void>;
}

/** Data reads (headless-safe: getCachedUpcoming works with or without a live session). */
export interface WidgetDataPort {
  getActiveUid(): string | null;
  getCachedUpcoming(uid: string, options: { horizonDays: number; now: Date }): Promise<Meeting[]>;
  getCachedPreferences(uid: string): Promise<Preferences | null>;
}

export interface WidgetI18nPort {
  t: TranslateFn;
  getLanguage(): Language;
}

export interface WidgetFormatPort {
  formatTime(value: string, options: FormatOptions): string;
  formatDate(value: string, style: 'short' | 'medium' | 'long' | 'full', options: FormatOptions): string;
}

export interface WidgetFeederDeps {
  widget: WidgetModulePort;
  events: EventBus<AppEventMap>;
  data: WidgetDataPort;
  i18n: WidgetI18nPort;
  format: WidgetFormatPort;
  deviceTimeZone(): string;
  logger: Logger;
  /** Test seam; defaults to the real clock. */
  now?(): Date;
}

export interface WidgetFeederImpl {
  /** Subscribes to appEvents once (idempotent). */
  register(): void;
  /** Recompute + push now (background task hook; resolves after the queued run completes). */
  refresh(): Promise<void>;
  /**
   * Re-feed when the device timezone differs from the one the last feed formatted with
   * (foreground hook): timeText/dateText are pre-formatted strings, so after a zone change
   * they would show the OLD zone's wall-clock time until some other event feeds again.
   * A cheap no-op when nothing was fed yet or the zone is unchanged.
   */
  refreshIfZoneChanged(): Promise<void>;
}

/**
 * The localized static widget strings ('widget' namespace), passed from JS so the widget follows
 * the APP language, not the system locale (the module's res strings are only the pre-first-run
 * fallback). Called at feed time and again on language:changed.
 */
export function widgetStringsOf(t: TranslateFn): MgWidgetStrings {
  return {
    emptyTitle: t('widget:emptyTitle'),
    emptyBody: t('widget:emptyBody'),
    nowLabel: t('widget:nowLabel'),
  };
}

export function createWidgetFeeder(deps: WidgetFeederDeps): WidgetFeederImpl {
  const log = deps.logger;
  const nowDate = deps.now ?? (() => new Date());
  let registered = false;
  let chain: Promise<void> = Promise.resolve();
  let feedQueued = false;
  /** Device zone the last completed feed formatted with (null until something was fed). */
  let lastFedZone: string | null = null;

  function enqueue(task: () => Promise<void>): Promise<void> {
    chain = chain.then(task).catch((error: unknown) => {
      log.warn('widget update failed', error);
    });
    return chain;
  }

  /** One queued feed covers every event that arrives before it runs (uid resolved at run time). */
  function enqueueFeed(): Promise<void> {
    if (!deps.widget.isNativeModuleAvailable()) return Promise.resolve();
    if (feedQueued) return chain;
    feedQueued = true;
    return enqueue(async () => {
      feedQueued = false;
      await feedOnce();
    });
  }

  function enqueueStrings(): void {
    if (!deps.widget.isNativeModuleAvailable()) return;
    void enqueue(() => deps.widget.setStrings(widgetStringsOf(deps.i18n.t)));
  }

  function enqueueClear(): void {
    if (!deps.widget.isNativeModuleAvailable()) return;
    void enqueue(() => deps.widget.clear());
  }

  async function feedOnce(): Promise<void> {
    const uid = deps.data.getActiveUid();
    // Signed out: leave the widget alone (session:ended already cleared it).
    if (uid === null) return;
    lastFedZone = deps.deviceTimeZone();
    const now = nowDate();
    const meetings = await deps.data.getCachedUpcoming(uid, { horizonDays: WIDGET_HORIZON_DAYS, now });
    const entry = computeNextWidgetEntry(meetings, now);
    if (entry === null) {
      await deps.widget.setNextMeeting(null);
      return;
    }
    const preferences = await deps.data.getCachedPreferences(uid);
    await deps.widget.setNextMeeting(toWidgetData(entry, preferences, now));
  }

  function toWidgetData(entry: NextWidgetEntry, preferences: Preferences | null, now: Date): MgWidgetMeetingData {
    const timeZone = deps.deviceTimeZone();
    const options: FormatOptions = {
      language: deps.i18n.getLanguage(),
      timeZone,
      use24Hour: preferences?.use24HourClock ?? null,
    };
    return {
      title: entry.title,
      startAtMs: entry.startAtMs,
      timeText: deps.format.formatTime(entry.startAt, options),
      dateText: dateTextOf(entry.startAt, timeZone, now, options),
      deepLink: meetingDeepLink(entry.meetingId),
    };
  }

  /** "Today" / "Tomorrow" (widget namespace), else the localized medium date. */
  function dateTextOf(startAt: string, timeZone: string, now: Date, options: FormatOptions): string {
    const startDay = toLocalDateTime(startAt, timeZone).date;
    const today = todayInZone(timeZone, now);
    if (startDay === today) return deps.i18n.t('widget:today');
    if (startDay === addDaysToLocalDate(today, 1)) return deps.i18n.t('widget:tomorrow');
    return deps.format.formatDate(startAt, 'medium', options);
  }

  function register(): void {
    if (registered) return;
    registered = true;
    deps.events.on('session:started', () => {
      enqueueStrings();
      void enqueueFeed();
    });
    deps.events.on('meetings:changed', () => {
      void enqueueFeed();
    });
    deps.events.on('calendar:synced', () => {
      void enqueueFeed();
    });
    deps.events.on('preferences:changed', () => {
      enqueueStrings();
      void enqueueFeed();
    });
    deps.events.on('language:changed', () => {
      enqueueStrings();
      void enqueueFeed();
    });
    deps.events.on('session:ended', () => {
      enqueueClear();
    });
    log.debug('widget feeder registered');
  }

  return {
    register,
    refresh: () => enqueueFeed(),
    refreshIfZoneChanged: () => {
      if (lastFedZone === null || deps.deviceTimeZone() === lastFedZone) return Promise.resolve();
      return enqueueFeed();
    },
  };
}
