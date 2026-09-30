/**
 * Widget feeder (owner: widget; docs/ARCHITECTURE.md §19): keeps the Android next-meeting
 * home-screen widget (modules/mg-next-meeting-widget) in step with the meeting store.
 *
 * This file only wires the app singleton; the logic lives in ./feeder.ts (injected ports,
 * unit-tested) and the pure entry selection in ./model.ts.
 *
 * Contract (WidgetFeeder in src/core/contracts.ts):
 * - registerWidgetFeeder() is idempotent and imported ONCE from index.js AFTER
 *   './src/services/alerts/tasks' (so headless background runs feed the widget too). It only
 *   subscribes to appEvents; when the native module is unavailable (iOS, web, binary without
 *   it) every reaction is a cheap no-op.
 * - session:started / meetings:changed / calendar:synced -> computeNextWidgetEntry over the
 *   repository list (getCachedUpcoming: live session or headless cache), timeText/dateText from
 *   the app's formatters (clock preference + language), setNextMeeting(...).
 * - language:changed / preferences:changed -> setStrings (t('widget:...')) + re-feed.
 * - session:ended -> clear().
 */
import type { FormatOptions } from '../../core/contracts';
import { appEvents } from '../../core/events';
import { createLogger } from '../../core/logger';
import { getDeviceTimeZone } from '../../core/time';
import { getLanguage, t } from '../../i18n';
import { formatDate, formatTime } from '../../utils/format';
import * as widgetModule from '../../../modules/mg-next-meeting-widget';
import { dataService, meetingRepository, preferencesRepository } from '../data';
import { createWidgetFeeder, type WidgetFeederImpl } from './feeder';

export { widgetStringsOf } from './feeder';
export type { WidgetDataPort, WidgetFeederDeps, WidgetFeederImpl, WidgetModulePort } from './feeder';
export { computeNextWidgetEntry, WIDGET_HORIZON_DAYS, WIDGET_STARTED_GRACE_MINUTES } from './model';
export type { NextWidgetEntry } from './model';

const feeder: WidgetFeederImpl = createWidgetFeeder({
  widget: widgetModule,
  events: appEvents,
  data: {
    getActiveUid: () => dataService.getActiveUid(),
    getCachedUpcoming: (uid, options) => meetingRepository.getCachedUpcoming(uid, options),
    getCachedPreferences: (uid) => preferencesRepository.getCached(uid),
  },
  // Late-bound wrappers: i18n/format resolve at call time (headless runs restore the language
  // after this module loads).
  i18n: {
    t: (key, options) => t(key, options),
    getLanguage: () => getLanguage(),
  },
  format: {
    formatTime: (value: string, options: FormatOptions) => formatTime(value, options),
    formatDate: (value: string, style, options: FormatOptions) => formatDate(value, style, options),
  },
  deviceTimeZone: getDeviceTimeZone,
  logger: createLogger('widget'),
});

/** Subscribes to app events and starts feeding the widget. Idempotent. */
export function registerWidgetFeeder(): void {
  feeder.register();
}

/** Recompute + push now (hook for the background refresh task; never throws). */
export async function refreshWidget(): Promise<void> {
  await feeder.refresh();
}
