/**
 * A5: keeps the executive assistant's morning digest fresh on the phone, so the daily briefing line
 * ("Assistant: 2 things need you") and the briefing notifications before the meetings it booked do
 * not depend on the owner opening the matters screen. When a session starts and whenever the app
 * comes to the foreground (at most once per DIGEST_REFRESH_MIN_MS), while the assistant is on in
 * this build and someone is signed in: matterDigest, then rememberDigest and scheduleBriefings, then
 * onUpdated (AppRoot: the briefing scheduler reconciles with the new count). Every failure is
 * quiet: the digest is a convenience, and the matters screen loads it again anyway.
 * Notifications sent from the server come with A8. Nothing the owner wrote is logged.
 */
import { AppState } from 'react-native';

import type { Language, MatterDigestResponse } from '../../core/aiContract';
import { appEvents, type AppEventMap, type EventBus } from '../../core/events';
import { createLogger } from '../../core/logger';
import { getDeviceTimeZone } from '../../core/time';
import { toBaseLanguage } from '../../core/types';
import { env } from '../../config/env';
import { auth } from '../../config/firebase';
import { getLanguage, t } from '../../i18n';
import { rememberDigest, scheduleBriefings } from './assistantNotifications';
import { matterService } from './matterService';

const log = createLogger('matters.digest');

/** The digest is fetched again at most this often (app openings in between reuse the last one). */
export const DIGEST_REFRESH_MIN_MS = 30 * 60_000;

export interface DigestRefreshDeps {
  enabled(): boolean;
  signedIn(): boolean;
  language(): Language;
  timeZone(): string;
  digest(language: Language, timeZone: string): Promise<MatterDigestResponse>;
  /** Keeps the count and schedules the briefing notifications (assistantNotifications.ts). */
  apply(digest: MatterDigestResponse): Promise<void>;
  subscribeAppState(listener: (state: string) => void): () => void;
  now(): number;
}

const defaultDeps: DigestRefreshDeps = {
  enabled: () => env.mattersEnabled,
  signedIn: () => Boolean(auth?.currentUser),
  language: () => toBaseLanguage(getLanguage()),
  timeZone: getDeviceTimeZone,
  digest: (language, timeZone) => matterService.digest(language, timeZone),
  apply: async (digest) => {
    await rememberDigest(digest);
    await scheduleBriefings(digest, { title: (title) => t('matters:brief.notificationTitle', { title }), body: t('matters:brief.notificationBody') });
  },
  subscribeAppState: (listener) => {
    const subscription = AppState.addEventListener('change', listener);
    return () => subscription.remove();
  },
  now: () => Date.now(),
};

/** Starts the refresh; returns the function that stops it. */
export function startAssistantDigestRefresh(
  options: { onUpdated?: () => void } = {},
  deps: DigestRefreshDeps = defaultDeps,
  events: Pick<EventBus<AppEventMap>, 'on'> = appEvents,
): () => void {
  /** When the digest was last fetched; null: not yet in this session. */
  let last: number | null = null;
  let running = false;
  const refresh = async (force: boolean): Promise<void> => {
    if (running || !deps.enabled() || !deps.signedIn()) return;
    if (!force && last !== null && deps.now() - last < DIGEST_REFRESH_MIN_MS) return;
    running = true;
    try {
      const digest = await deps.digest(deps.language(), deps.timeZone());
      last = deps.now();
      await deps.apply(digest);
      options.onUpdated?.();
    } catch (error) {
      log.warn('the assistant digest was not refreshed', error);
    } finally {
      running = false;
    }
  };
  const offStarted = events.on('session:started', () => void refresh(true));
  const offEnded = events.on('session:ended', () => {
    last = null;
  });
  const offAppState = deps.subscribeAppState((state) => {
    if (state === 'active') void refresh(false);
  });
  void refresh(false);
  return () => {
    offStarted();
    offEnded();
    offAppState();
  };
}
