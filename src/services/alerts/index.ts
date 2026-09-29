/**
 * ALERTS area public API (owner: alerts).
 *
 * Layer L4: may import core, i18n, data (barrel). Must NOT import ./tasks (L7) or the auth barrel.
 * AlertHost lives in src/components/alerts; background tasks in ./tasks (imported by index.js).
 */
export { alertEngine } from './engine';
export { computeAlertPlan } from './plan';
export { usePendingAlerts } from './usePendingAlerts';

// Extras for the alert UI (src/components/alerts) and the home screen alert card.
export { alertFeedback, speechLanguageTag, type FeedbackHandle, type FeedbackRequest } from './feedback';
export { MAX_AUTO_SNOOZE_SECONDS, LIGHT_AUTO_HIDE_MS, LIGHT_DISMISS_AFTER_MS, snoozeChoices } from './constants';
export { cleanText, leadText, meetingJoinUrl, meetingLocationText } from './content';
export type { AlertEngineImpl, ResolveOptions } from './engineCore';
export type { ActiveAlertView, AlertPresentationPrefs, ResolveAction } from './types';
