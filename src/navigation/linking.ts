/**
 * Deep-link configuration (scheme meetingguardai://, paths from core LINKING_PATHS).
 *
 * URLs and notification taps are routed through the gate-aware queue in navigationService
 * instead of React Navigation's initial-state mechanism: at cold start the session is still
 * restoring (splash) and the target screen group is not mounted yet, so React Navigation would
 * drop the link. getInitialURL() therefore hands the URL to openDeepLink() and returns null.
 *
 * Notification responses handled here: the default tap, "mg-open" and "mg-assistant" (via
 * content.data.url). "mg-snooze" belongs to the alerts area (foreground listener + Android
 * background task) and is ignored.
 */
import type { LinkingOptions } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { Linking } from 'react-native';

import type { RootStackParamList } from '../core/contracts';
import { toAppError } from '../core/errors';
import { DEEP_LINK_PREFIX, LINKING_PATHS, NOTIFICATION_ACTIONS, assistantDeepLink } from '../core/identifiers';
import { createLogger } from '../core/logger';
import { MEETING_ID_PATTERN } from '../core/aiContract';
import { openDeepLink } from './navigationService';

const log = createLogger('navigation');

/** Minimal shape of an expo-notifications response used for routing. */
export interface NotificationResponseLike {
  actionIdentifier: string;
  notification: {
    date?: number;
    request: { identifier: string; content: { data?: Record<string, unknown> | null } };
  };
}

const NAVIGATING_ACTIONS: ReadonlySet<string> = new Set([
  Notifications.DEFAULT_ACTION_IDENTIFIER,
  NOTIFICATION_ACTIONS.open,
  NOTIFICATION_ACTIONS.assistant,
]);

/**
 * PURE: the URL a notification response should open, or null (snooze and other actions, foreign
 * notifications). "mg-assistant" always opens the assistant in follow-up mode for that meeting.
 */
export function urlForNotificationResponse(response: NotificationResponseLike): string | null {
  if (!NAVIGATING_ACTIONS.has(response.actionIdentifier)) return null;
  const data = response.notification.request.content.data ?? {};
  if (response.actionIdentifier === NOTIFICATION_ACTIONS.assistant) {
    const meetingId = data.meetingId;
    if (typeof meetingId === 'string' && MEETING_ID_PATTERN.test(meetingId)) {
      return assistantDeepLink({ followUpMeetingId: meetingId });
    }
  }
  const url = data.url;
  return typeof url === 'string' && url.startsWith(DEEP_LINK_PREFIX) ? url : null;
}

// The same response can arrive twice (cold-start "last response" + the listener): route it once.
const handledResponses = new Set<string>();

function responseKey(response: NotificationResponseLike): string {
  const { notification } = response;
  return `${notification.request.identifier}|${response.actionIdentifier}|${notification.date ?? ''}`;
}

/** Routes a notification response once. Returns true when it opened a screen. */
export function handleNotificationResponse(response: NotificationResponseLike): boolean {
  const url = urlForNotificationResponse(response);
  if (url === null) return false;
  const key = responseKey(response);
  if (handledResponses.has(key)) return false;
  handledResponses.add(key);
  return openDeepLink(url);
}

function lastNotificationResponse(): NotificationResponseLike | null {
  try {
    return Notifications.getLastNotificationResponse();
  } catch (error) {
    log.warn('could not read the last notification response', toAppError(error).code);
    return null;
  }
}

export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: [DEEP_LINK_PREFIX],
  config: {
    screens: {
      MeetingDetails: LINKING_PATHS.meeting,
      AIChat: { path: LINKING_PATHS.assistant, parse: { followup: String } },
    },
  },
  async getInitialURL() {
    try {
      const url = await Linking.getInitialURL();
      if (url) openDeepLink(url);
    } catch (error) {
      log.warn('could not read the initial URL', toAppError(error).code);
    }
    const response = lastNotificationResponse();
    if (response) handleNotificationResponse(response);
    return null;
  },
  subscribe() {
    const urlSubscription = Linking.addEventListener('url', ({ url }) => {
      openDeepLink(url);
    });
    const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      handleNotificationResponse(response);
    });
    return () => {
      urlSubscription.remove();
      responseSubscription.remove();
    };
  },
};

/** TEST ONLY. */
export function resetHandledNotificationResponsesForTests(): void {
  handledResponses.clear();
}
