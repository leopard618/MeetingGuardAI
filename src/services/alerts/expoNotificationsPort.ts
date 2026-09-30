/**
 * NotificationsPort backed by expo-notifications 57 (owner: alerts).
 *
 * SDK 57 specifics (verified against node_modules typings / native sources):
 * - The Android channel goes INSIDE the trigger: { type: DATE, date, channelId }.
 * - iOS turns DATE triggers into time-interval triggers, so the fire time is read from our own
 *   payload (data.fireAt), never from the returned trigger.
 * - iOS reports Notification.date in seconds, Android in milliseconds: normalized here.
 * - Headless (Android task) payloads may carry `dataString` instead of `data`.
 * - getLastNotificationResponse() is synchronous in 57; it is NOT cleared here (navigation reads
 *   it for cold-start routing).
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { Unsubscribe } from '../../core/contracts';
import { lightColors } from '../../theme/tokens';
import { extractContentData } from './content';
import type {
  AlertNotificationSpec,
  ChannelSpec,
  CategorySpec,
  IncomingNotification,
  IncomingResponse,
  NotificationPresentation,
  NotificationsPort,
  PresentedNotificationRecord,
  RawPermission,
  ScheduledNotificationRecord,
  ScheduledSpec,
} from './types';

// MG Indigo brand primary; notification accents are rendered by the OS on its own surfaces, so
// the light-scheme brand hue is used in both modes.
const ACCENT_COLOR = lightColors.primary;

/** Seconds (iOS) or milliseconds (Android) since epoch -> milliseconds. */
export function normalizeEpochMs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return Date.now();
  return value < 100_000_000_000 ? Math.round(value * 1000) : Math.round(value);
}

function triggerDateOf(trigger: unknown): number | null {
  if (typeof trigger !== 'object' || trigger === null) return null;
  const record = trigger as { type?: unknown; value?: unknown; date?: unknown };
  if (record.type !== 'date') return null;
  if (typeof record.value === 'number') return normalizeEpochMs(record.value);
  if (typeof record.date === 'number') return normalizeEpochMs(record.date);
  return null;
}

function toIncoming(notification: unknown): IncomingNotification | null {
  if (typeof notification !== 'object' || notification === null) return null;
  const record = notification as { date?: unknown; request?: { identifier?: unknown; content?: unknown } };
  const identifier = record.request?.identifier;
  if (typeof identifier !== 'string') return null;
  return {
    identifier,
    date: normalizeEpochMs(record.date),
    data: extractContentData(record.request?.content),
  };
}

/** Maps a (possibly raw, headless) response object; null when it is not a response. */
export function toIncomingResponse(response: unknown): IncomingResponse | null {
  if (typeof response !== 'object' || response === null) return null;
  const record = response as { actionIdentifier?: unknown; notification?: unknown };
  if (typeof record.actionIdentifier !== 'string') return null;
  const notification = toIncoming(record.notification);
  return notification ? { actionIdentifier: record.actionIdentifier, notification } : null;
}

function importanceOf(value: ChannelSpec['importance']): Notifications.AndroidImportance {
  switch (value) {
    case 'max':
      return Notifications.AndroidImportance.MAX;
    case 'high':
      return Notifications.AndroidImportance.HIGH;
    default:
      return Notifications.AndroidImportance.DEFAULT;
  }
}

function priorityOf(value: AlertNotificationSpec['androidPriority']): Notifications.AndroidNotificationPriority {
  switch (value) {
    case 'max':
      return Notifications.AndroidNotificationPriority.MAX;
    case 'high':
      return Notifications.AndroidNotificationPriority.HIGH;
    default:
      return Notifications.AndroidNotificationPriority.DEFAULT;
  }
}

function toRawPermission(response: Notifications.NotificationPermissionsStatus): RawPermission {
  const provisional = response.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  const status: RawPermission['status'] =
    response.granted || provisional ? 'granted' : response.status === 'denied' ? 'denied' : 'undetermined';
  return { status, canAskAgain: response.canAskAgain, provisional };
}

export function createExpoNotificationsPort(): NotificationsPort {
  const platform: NotificationsPort['platform'] =
    Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'other';

  return {
    platform,

    setPresentationHandler(decide: (notification: IncomingNotification) => NotificationPresentation) {
      Notifications.setNotificationHandler({
        handleNotification: async (notification) => {
          const incoming = toIncoming(notification);
          const decision: NotificationPresentation = incoming
            ? decide(incoming)
            : { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false };
          return { ...decision };
        },
      });
    },

    async setChannels(channels: readonly ChannelSpec[]) {
      if (platform !== 'android') return;
      for (const channel of channels) {
        await Notifications.setNotificationChannelAsync(channel.id, {
          name: channel.name,
          description: channel.description,
          importance: importanceOf(channel.importance),
          // No `sound` key = the system default (a "default" string would be looked up as a raw
          // resource file); null = silent; otherwise a file listed in the plugin "sounds".
          ...(channel.sound === 'default' ? {} : { sound: channel.sound }),
          vibrationPattern: channel.vibrationPattern,
          enableVibrate: channel.vibrationPattern.length > 0,
          bypassDnd: channel.bypassDnd,
          lockscreenVisibility: channel.lockscreenPublic
            ? Notifications.AndroidNotificationVisibility.PUBLIC
            : Notifications.AndroidNotificationVisibility.PRIVATE,
          lightColor: ACCENT_COLOR,
          enableLights: channel.importance !== 'default',
          showBadge: true,
          ...(channel.alarmUsage
            ? {
                audioAttributes: {
                  usage: Notifications.AndroidAudioUsage.ALARM,
                  contentType: Notifications.AndroidAudioContentType.SONIFICATION,
                },
              }
            : {}),
        });
      }
    },

    async deleteChannels(ids: readonly string[]) {
      if (platform !== 'android') return;
      for (const id of ids) {
        const existing = await Notifications.getNotificationChannelAsync(id);
        if (existing) await Notifications.deleteNotificationChannelAsync(id);
      }
    },

    async setCategories(categories: readonly CategorySpec[]) {
      for (const category of categories) {
        await Notifications.setNotificationCategoryAsync(
          category.id,
          category.actions.map((action) => ({
            identifier: action.id,
            buttonTitle: action.title,
            options: { opensAppToForeground: action.opensApp },
          })),
        );
      }
    },

    async getPermission() {
      return toRawPermission(await Notifications.getPermissionsAsync());
    },

    async requestPermission() {
      return toRawPermission(
        await Notifications.requestPermissionsAsync({
          ios: { allowAlert: true, allowSound: true, allowBadge: false },
        }),
      );
    },

    async getScheduled(): Promise<ScheduledNotificationRecord[]> {
      const requests = await Notifications.getAllScheduledNotificationsAsync();
      return requests.map((request) => ({
        identifier: request.identifier,
        data: extractContentData(request.content),
        triggerDate: triggerDateOf(request.trigger),
      }));
    },

    async schedule(spec: ScheduledSpec) {
      await Notifications.scheduleNotificationAsync({
        identifier: spec.identifier,
        content: {
          title: spec.title,
          body: spec.body,
          data: { ...spec.data },
          ...(spec.categoryId !== null ? { categoryIdentifier: spec.categoryId } : {}),
          sound: spec.sound,
          interruptionLevel: spec.interruptionLevel,
          priority: priorityOf(spec.androidPriority),
          vibrate: spec.vibrate,
          sticky: spec.sticky,
          autoDismiss: true,
          color: ACCENT_COLOR,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(spec.fireAt),
          channelId: spec.channelId,
        },
      });
    },

    async cancel(identifier: string) {
      await Notifications.cancelScheduledNotificationAsync(identifier);
    },

    async getPresented(): Promise<PresentedNotificationRecord[]> {
      const presented = await Notifications.getPresentedNotificationsAsync();
      const records: PresentedNotificationRecord[] = [];
      for (const notification of presented) {
        const incoming = toIncoming(notification);
        if (incoming) records.push(incoming);
      }
      return records;
    },

    async dismiss(identifier: string) {
      await Notifications.dismissNotificationAsync(identifier);
    },

    addReceivedListener(listener: (notification: IncomingNotification) => void): Unsubscribe {
      const subscription = Notifications.addNotificationReceivedListener((notification) => {
        const incoming = toIncoming(notification);
        if (incoming) listener(incoming);
      });
      return () => subscription.remove();
    },

    addResponseListener(listener: (response: IncomingResponse) => void): Unsubscribe {
      const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
        const incoming = toIncomingResponse(response);
        if (incoming) listener(incoming);
      });
      return () => subscription.remove();
    },

    getLastResponse(): IncomingResponse | null {
      return toIncomingResponse(Notifications.getLastNotificationResponse());
    },
  };
}
