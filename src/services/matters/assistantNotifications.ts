/**
 * A5: what the phone does with the morning digest (matterDigest), until A8 sends notifications from
 * the server:
 * - rememberDigest keeps how many things wait for the owner (with its time), so the daily briefing
 *   notification (alerts/briefing.ts, scheduled on the phone, even by the background refresh) can
 *   add one line: "Assistant: 2 things need you". A count older than DIGEST_LINE_MAX_AGE_MS is not
 *   used (the line is left out rather than wrong).
 * - scheduleBriefings keeps one local notification per meeting the assistant booked, the owner's
 *   briefingMinutes before it ("mgmatter:" identifiers, disjoint from the alert engine's "mg:",
 *   the tasks' "mgtask:" and the briefing's "mgbrief:"). Tapping it opens the matter and starts the
 *   briefing (meetingguardai://matters?matter=<id>&brief=1).
 * Nothing the owner wrote is stored: a count and a time, and the titles inside the notifications.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

import type { MatterDigestResponse } from '../../core/aiContract';
import { channelFor, DEEP_LINK_PREFIX } from '../../core/identifiers';
import { createLogger } from '../../core/logger';

const log = createLogger('matters.notifications');

export const MATTER_NOTIFICATION_PREFIX = 'mgmatter';
const CACHE_KEY = 'matters.digest.v1';
export const DIGEST_LINE_MAX_AGE_MS = 36 * 3_600_000;
/** At most this many briefing notifications are kept (they share the OS budget with the alerts). */
export const MAX_BRIEFING_NOTIFICATIONS = 3;

export async function rememberDigest(digest: Pick<MatterDigestResponse, 'needsYou' | 'generatedAt'>): Promise<void> {
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ needsYou: digest.needsYou, generatedAt: digest.generatedAt }));
  } catch (error) {
    log.warn('digest cache write failed', error);
  }
}

/** How many things waited for the owner at the last digest; null when unknown or too old. */
export async function assistantNeedsYou(now: Date = new Date()): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as { needsYou?: unknown; generatedAt?: unknown };
    const at = typeof value.generatedAt === 'string' ? Date.parse(value.generatedAt) : NaN;
    if (!Number.isFinite(at) || now.getTime() - at > DIGEST_LINE_MAX_AGE_MS) return null;
    return typeof value.needsYou === 'number' && value.needsYou >= 0 ? value.needsYou : null;
  } catch {
    return null;
  }
}

export function matterBriefingId(matterId: string, start: string): string {
  return `${MATTER_NOTIFICATION_PREFIX}:${matterId}:${Date.parse(start)}`;
}

export function matterBriefingUrl(matterId: string): string {
  return `${DEEP_LINK_PREFIX}matters?matter=${encodeURIComponent(matterId)}&brief=1`;
}

/** The briefing notifications the digest asks for (the soonest first, at most MAX_BRIEFING_NOTIFICATIONS). */
export function plannedBriefings(digest: Pick<MatterDigestResponse, 'briefings' | 'briefingMinutes'>, now: Date): { id: string; matterId: string; title: string; start: string; fireAt: number }[] {
  if (digest.briefingMinutes <= 0) return [];
  return digest.briefings
    .map((b) => ({ id: matterBriefingId(b.matterId, b.start), matterId: b.matterId, title: b.title, start: b.start, fireAt: Date.parse(b.start) - digest.briefingMinutes * 60_000 }))
    .filter((b) => Number.isFinite(b.fireAt) && b.fireAt > now.getTime() + 60_000)
    .sort((a, b) => a.fireAt - b.fireAt)
    .slice(0, MAX_BRIEFING_NOTIFICATIONS);
}

/** Keeps exactly the planned briefing notifications (cancels stale ones, schedules new ones). */
export async function scheduleBriefings(
  digest: Pick<MatterDigestResponse, 'briefings' | 'briefingMinutes'>,
  text: { title(title: string): string; body: string },
  now: Date = new Date(),
): Promise<void> {
  try {
    const planned = plannedBriefings(digest, now);
    const wanted = new Set(planned.map((p) => p.id));
    const scheduled = (await Notifications.getAllScheduledNotificationsAsync()).map((n) => n.identifier).filter((id) => id.startsWith(`${MATTER_NOTIFICATION_PREFIX}:`));
    for (const id of scheduled) if (!wanted.has(id)) await Notifications.cancelScheduledNotificationAsync(id);
    const have = new Set(scheduled);
    for (const p of planned) {
      if (have.has(p.id)) continue;
      await Notifications.scheduleNotificationAsync({
        identifier: p.id,
        content: { title: text.title(p.title), body: text.body, data: { url: matterBriefingUrl(p.matterId) }, sound: 'default', autoDismiss: true },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(p.fireAt), channelId: channelFor('briefing', true) },
      });
    }
  } catch (error) {
    log.warn('briefing notifications not scheduled', error);
  }
}
