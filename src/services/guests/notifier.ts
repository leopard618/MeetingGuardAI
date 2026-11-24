/**
 * M14: "you are notified" when a guest answers. While a session is active the app listens to the
 * new answers (users/{uid}/guestResponses with state 'new') and shows one local notification per
 * answer (the follow-up channel), which opens the meeting. There is no server push before the
 * assistant's A8, so a closed app learns of answers when it next opens; the meeting details
 * screen always shows them. Each answer notifies once per phone (ids kept on the device).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

import type { Meeting } from '../../core/types';
import { appEvents, type AppEventMap, type EventBus } from '../../core/events';
import { ANDROID_CHANNELS, meetingDeepLink } from '../../core/identifiers';
import { createLogger } from '../../core/logger';
import { i18n } from '../../i18n/i18n';
import { meetingRepository } from '../data';
import { guestService, type GuestAnswer, type GuestService } from './guestService';

const log = createLogger('guests-notifier');
const STORE_KEY = (uid: string) => `mg:${uid}:guests.notified`;
const KEEP = 200;

export interface GuestNotifierDeps {
  service: GuestService;
  storage: Pick<typeof AsyncStorage, 'getItem' | 'setItem'>;
  getMeeting(id: string): Promise<Pick<Meeting, 'title'> | null>;
  present(id: string, title: string, body: string, url: string): Promise<void>;
  t(key: string, values?: Record<string, unknown>): string;
}

/** The notification text of one answer (pure). */
export function notificationTextOf(answer: GuestAnswer, meetingTitle: string, t: GuestNotifierDeps['t']): { title: string; body: string } {
  const name = answer.guestName ?? answer.guestEmail ?? t('meetings:guests.someone');
  const key = answer.kind === 'accepted' ? 'accepted' : answer.kind === 'declined' ? 'declined' : 'proposed';
  return { title: t(`meetings:guests.notify.${key}`, { name }), body: meetingTitle };
}

export async function notifyNewAnswers(uid: string, answers: readonly GuestAnswer[], deps: GuestNotifierDeps): Promise<number> {
  const fresh = answers.filter((answer) => answer.state === 'new');
  if (fresh.length === 0) return 0;
  let seen: string[] = [];
  try {
    seen = JSON.parse((await deps.storage.getItem(STORE_KEY(uid))) ?? '[]') as string[];
  } catch {
    seen = [];
  }
  const known = new Set(seen);
  let shown = 0;
  for (const answer of fresh) {
    const key = `${answer.id}:${answer.updatedAt}`;
    if (known.has(key)) continue;
    known.add(key);
    seen.push(key);
    const meeting = await deps.getMeeting(answer.meetingId).catch(() => null);
    const text = notificationTextOf(answer, meeting?.title ?? '', deps.t);
    try {
      await deps.present(`guest-reply-${answer.id}`, text.title, text.body, meetingDeepLink(answer.meetingId));
      shown += 1;
    } catch (error) {
      log.warn('could not show a guest answer', { name: error instanceof Error ? error.name : 'unknown' });
    }
  }
  await deps.storage.setItem(STORE_KEY(uid), JSON.stringify(seen.slice(-KEEP))).catch(() => undefined);
  return shown;
}

const defaultDeps: GuestNotifierDeps = {
  service: guestService,
  storage: AsyncStorage,
  getMeeting: (id) => meetingRepository.get(id),
  async present(id, title, body, url) {
    await Notifications.scheduleNotificationAsync({
      identifier: id,
      content: { title, body, data: { url }, autoDismiss: true },
      trigger: { channelId: ANDROID_CHANNELS.followup } as Notifications.NotificationTriggerInput,
    });
  },
  t: (key, values) => i18n.t(key, values ?? {}),
};

/** Listens while a session is active; returns the stop function. */
export function startGuestNotifier(events: Pick<EventBus<AppEventMap>, 'on'> = appEvents, deps: GuestNotifierDeps = defaultDeps): () => void {
  let stopListening: (() => void) | null = null;
  const stop = (): void => {
    stopListening?.();
    stopListening = null;
  };
  const offStarted = events.on('session:started', ({ uid }) => {
    stop();
    stopListening = deps.service.subscribe(uid, null, (answers) => {
      void notifyNewAnswers(uid, answers, deps);
    });
  });
  const offEnded = events.on('session:ended', () => stop());
  return () => {
    stop();
    offStarted();
    offEnded();
  };
}
