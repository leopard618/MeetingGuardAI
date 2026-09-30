/**
 * Widget feeder (owner: widget; docs/ARCHITECTURE.md §19): keeps the Android next-meeting
 * home-screen widget (modules/mg-next-meeting-widget) in step with the meeting store.
 *
 * Contract (WidgetFeeder in src/core/contracts.ts):
 * - registerWidgetFeeder() is idempotent and imported ONCE from index.js AFTER
 *   './src/services/alerts/tasks' (so headless background runs feed the widget too). It only
 *   subscribes to appEvents; when the native module is unavailable (iOS, web, binary without
 *   it) every reaction is a cheap no-op.
 * - session:started / meetings:changed / calendar:synced -> computeNextWidgetEntry over the
 *   repository list (getCachedUpcoming in headless), format timeText/dateText with the app's
 *   formatters (clock preference + language), setNextMeeting(...).
 * - language:changed / preferences:changed -> setStrings (t('widget:...')) + re-feed.
 * - session:ended -> clear().
 */
import type { TranslateFn } from '../../core/contracts';
import { createLogger } from '../../core/logger';
import type { MgWidgetStrings } from '../../../modules/mg-next-meeting-widget';

export { computeNextWidgetEntry, WIDGET_HORIZON_DAYS, WIDGET_STARTED_GRACE_MINUTES } from './model';
export type { NextWidgetEntry } from './model';

const log = createLogger('widget');

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

let registered = false;

/** STUB (widget pass): subscribes to app events and starts feeding the widget. Idempotent. */
export function registerWidgetFeeder(): void {
  if (registered) return;
  registered = true;
  // The native module does not exist yet (§19); registering is a no-op so index.js can already
  // import this module without behavior changes. The widget pass replaces this body.
  log.debug('widget feeder registered (stub: native module not present in this build)');
}

/** STUB (widget pass): recompute + push now (hook for the background refresh task). */
export async function refreshWidget(): Promise<void> {
  // No-op until the widget pass lands (never throws: callers treat the widget as optional).
}
