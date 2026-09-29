/**
 * PURE alert planner (owner: alerts). No Expo / React Native imports in this file.
 * Rules: ComputeAlertPlan in src/core/contracts.ts.
 *
 * - prefs.alertEnabled false => empty plan (master switch; also no follow-ups).
 * - Eligible meeting: deletedAt null, status 'scheduled', allDay false, valid id and startAt.
 * - Alert offsets: meeting.customAlertTimes ?? prefs.defaultAlertTimes (deduped, integers >= 0).
 * - Each notification: fireAt > now and fireAt <= now + horizon.
 * - Intensity: meeting.alertIntensity ?? prefs.alertIntensity; channel = channelForIntensity.
 * - Follow-up (prefs.followUpEnabled): end + FOLLOW_UP_DELAY_MINUTES on the follow-up channel.
 * - Sorted by fireAt (ties: alerts before follow-ups, then identifier) and cut at the budget.
 * All arithmetic is on UTC instants, so offsets are exact across DST changes.
 */
import { MEETING_ID_PATTERN } from '../../core/aiContract';
import type { AlertPlan, AlertPlanOptions, ComputeAlertPlan, DesiredNotification } from '../../core/contracts';
import {
  ALERT_HORIZON_DAYS,
  ALERT_NOTIFICATION_BUDGET,
  ANDROID_CHANNELS,
  FOLLOW_UP_DELAY_MINUTES,
  NOTIFICATION_CATEGORIES,
  alertNotificationId,
  channelForIntensity,
  followUpNotificationId,
} from '../../core/identifiers';
import type { Meeting, Preferences } from '../../core/types';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** A pending snooze of a meeting (planned alerts that would duplicate it are dropped). */
export interface PlanSuppression {
  meetingId: string;
  /** Snooze fire time (UTC ISO). */
  fireAt: string;
}

export interface AlertPlanOptionsExt extends AlertPlanOptions {
  /** Pending snoozes: alerts of the same meeting within `suppressWindowMs` of one are dropped. */
  suppress?: readonly PlanSuppression[];
  /** Default 2 minutes. */
  suppressWindowMs?: number;
}

/** Meetings that can get alerts at all (independent of time). */
export function isAlertEligibleMeeting(meeting: Meeting): boolean {
  return (
    meeting.deletedAt === null &&
    meeting.status === 'scheduled' &&
    !meeting.allDay &&
    MEETING_ID_PATTERN.test(meeting.id) &&
    Number.isFinite(Date.parse(meeting.startAt))
  );
}

/** Deduped, valid (integer >= 0) offsets, largest first. */
export function effectiveAlertOffsets(meeting: Meeting, preferences: Preferences): number[] {
  const source = meeting.customAlertTimes ?? preferences.defaultAlertTimes;
  const valid = source.filter((value) => Number.isInteger(value) && value >= 0);
  return [...new Set(valid)].sort((a, b) => b - a);
}

export function meetingEndMs(meeting: Pick<Meeting, 'startAt' | 'durationMinutes'>): number {
  return Date.parse(meeting.startAt) + meeting.durationMinutes * MINUTE_MS;
}

function compareItems(a: DesiredNotification, b: DesiredNotification): number {
  const byTime = Date.parse(a.fireAt) - Date.parse(b.fireAt);
  if (byTime !== 0) return byTime;
  if (a.kind !== b.kind) return a.kind === 'alert' ? -1 : 1;
  return a.identifier < b.identifier ? -1 : a.identifier > b.identifier ? 1 : 0;
}

export function computeAlertPlan(
  meetings: readonly Meeting[],
  preferences: Preferences,
  now: Date,
  options: AlertPlanOptionsExt = {},
): AlertPlan {
  const budget = Math.max(0, Math.floor(options.budget ?? ALERT_NOTIFICATION_BUDGET));
  const horizonDays = options.horizonDays ?? ALERT_HORIZON_DAYS;
  const empty: AlertPlan = { items: [], truncated: false, refillBefore: null };
  if (!preferences.alertEnabled) return empty;

  const nowMs = now.getTime();
  const horizonEndMs = nowMs + horizonDays * DAY_MS;
  const suppressWindowMs = options.suppressWindowMs ?? 2 * MINUTE_MS;
  const suppressions = new Map<string, number[]>();
  for (const entry of options.suppress ?? []) {
    const at = Date.parse(entry.fireAt);
    if (!Number.isFinite(at)) continue;
    const list = suppressions.get(entry.meetingId) ?? [];
    list.push(at);
    suppressions.set(entry.meetingId, list);
  }
  const isSuppressed = (meetingId: string, fireMs: number): boolean =>
    (suppressions.get(meetingId) ?? []).some((at) => Math.abs(at - fireMs) <= suppressWindowMs);

  const candidates: DesiredNotification[] = [];
  let beyondHorizon = false;
  const seen = new Set<string>();

  for (const meeting of meetings) {
    if (seen.has(meeting.id) || !isAlertEligibleMeeting(meeting)) continue;
    seen.add(meeting.id);

    const startMs = Date.parse(meeting.startAt);
    const intensity = meeting.alertIntensity ?? preferences.alertIntensity;

    for (const offset of effectiveAlertOffsets(meeting, preferences)) {
      const fireMs = startMs - offset * MINUTE_MS;
      if (fireMs <= nowMs) continue;
      if (fireMs > horizonEndMs) {
        beyondHorizon = true;
        continue;
      }
      if (isSuppressed(meeting.id, fireMs)) continue;
      candidates.push({
        identifier: alertNotificationId(meeting.id, offset),
        kind: 'alert',
        meetingId: meeting.id,
        offsetMinutes: offset,
        fireAt: new Date(fireMs).toISOString(),
        intensity,
        channelId: channelForIntensity(intensity),
        categoryId: NOTIFICATION_CATEGORIES.alert,
      });
    }

    if (preferences.followUpEnabled) {
      const fireMs = meetingEndMs(meeting) + FOLLOW_UP_DELAY_MINUTES * MINUTE_MS;
      if (fireMs > nowMs) {
        if (fireMs > horizonEndMs) {
          beyondHorizon = true;
        } else {
          candidates.push({
            identifier: followUpNotificationId(meeting.id),
            kind: 'followup',
            meetingId: meeting.id,
            offsetMinutes: null,
            fireAt: new Date(fireMs).toISOString(),
            intensity,
            channelId: ANDROID_CHANNELS.followup,
            categoryId: NOTIFICATION_CATEGORIES.followup,
          });
        }
      }
    }
  }

  candidates.sort(compareItems);
  const items = candidates.slice(0, budget);
  const truncated = beyondHorizon || candidates.length > items.length;
  const last = items[items.length - 1];
  return {
    items,
    truncated,
    refillBefore: truncated && last ? last.fireAt : null,
  };
}

// Compile-time check that the extended signature still satisfies the contract
// (src/core/conformance.ts checks the public export too).
const _contractCheck: ComputeAlertPlan = computeAlertPlan;
void _contractCheck;
