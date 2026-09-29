/**
 * PURE alert planner (owner: alerts). No Expo / React Native imports in this file.
 * Rules: ComputeAlertPlan in src/core/contracts.ts.
 *
 * - prefs.alertEnabled false => empty plan (master switch; also no follow-ups).
 * - Eligible meeting: deletedAt null, status 'scheduled', allDay false, valid id and startAt.
 * - Alert offsets: meeting.customAlertTimes ?? prefs.defaultAlertTimes (deduped, integers >= 0).
 * - Each notification: fireAt > now and fireAt <= now + horizon.
 * - Intensity: meeting.alertIntensity ?? prefs.alertIntensity; channel = channelForIntensity
 *   (no-vibration variant when prefs.vibrationEnabled is false).
 * - Follow-up (prefs.followUpEnabled): end + FOLLOW_UP_DELAY_MINUTES on the follow-up channel.
 * - Budget: ALERTS FIRST (earliest first). Follow-ups are low value and only use the space the
 *   alerts leave, so they never push a real alert out of the OS schedule. When the alerts alone do
 *   not fit, one slot is reserved for the refill reminder (refillReminderAt): it fires before the
 *   scheduled window runs out and asks the user to open the app (which reconciles again).
 * - Items are returned sorted by fireAt (ties: alerts before follow-ups, then identifier).
 * All arithmetic is on UTC instants, so offsets are exact across DST changes.
 */
import { MEETING_ID_PATTERN } from '../../core/aiContract';
import type { AlertPlan, AlertPlanOptions, ComputeAlertPlan, DesiredNotification } from '../../core/contracts';
import {
  ALERT_HORIZON_DAYS,
  ALERT_NOTIFICATION_BUDGET,
  FOLLOW_UP_DELAY_MINUTES,
  NOTIFICATION_CATEGORIES,
  alertNotificationId,
  channelFor,
  channelForIntensity,
  followUpNotificationId,
} from '../../core/identifiers';
import type { Meeting, Preferences } from '../../core/types';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
/** The refill reminder fires this long before the last alert that fits in the OS schedule. */
export const REFILL_REMINDER_LEAD_MS = 60 * MINUTE_MS;
/** ...but never sooner than this after the plan is computed (the app is usually open then). */
export const REFILL_REMINDER_MIN_DELAY_MS = 30 * MINUTE_MS;

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

/** When the refill reminder fires, given the last alert that fits in the OS schedule. */
export function refillReminderTime(lastScheduledAlertMs: number, nowMs: number): number {
  return Math.max(nowMs + REFILL_REMINDER_MIN_DELAY_MS, lastScheduledAlertMs - REFILL_REMINDER_LEAD_MS);
}

export function computeAlertPlan(
  meetings: readonly Meeting[],
  preferences: Preferences,
  now: Date,
  options: AlertPlanOptionsExt = {},
): AlertPlan {
  const budget = Math.max(0, Math.floor(options.budget ?? ALERT_NOTIFICATION_BUDGET));
  const horizonDays = options.horizonDays ?? ALERT_HORIZON_DAYS;
  const empty: AlertPlan = { items: [], truncated: false, refillBefore: null, refillReminderAt: null };
  if (!preferences.alertEnabled) return empty;

  const nowMs = now.getTime();
  const horizonEndMs = nowMs + horizonDays * DAY_MS;
  const suppressWindowMs = options.suppressWindowMs ?? 2 * MINUTE_MS;
  const vibration = preferences.vibrationEnabled;
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

  const alerts: DesiredNotification[] = [];
  const followUps: DesiredNotification[] = [];
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
      alerts.push({
        identifier: alertNotificationId(meeting.id, offset),
        kind: 'alert',
        meetingId: meeting.id,
        offsetMinutes: offset,
        fireAt: new Date(fireMs).toISOString(),
        intensity,
        channelId: channelForIntensity(intensity, vibration),
        categoryId: NOTIFICATION_CATEGORIES.alert,
      });
    }

    if (preferences.followUpEnabled) {
      const fireMs = meetingEndMs(meeting) + FOLLOW_UP_DELAY_MINUTES * MINUTE_MS;
      if (fireMs > nowMs) {
        if (fireMs > horizonEndMs) {
          beyondHorizon = true;
        } else {
          followUps.push({
            identifier: followUpNotificationId(meeting.id),
            kind: 'followup',
            meetingId: meeting.id,
            offsetMinutes: null,
            fireAt: new Date(fireMs).toISOString(),
            intensity,
            channelId: channelFor('followup', vibration),
            categoryId: NOTIFICATION_CATEGORIES.followup,
          });
        }
      }
    }
  }

  alerts.sort(compareItems);
  followUps.sort(compareItems);

  let chosenAlerts: DesiredNotification[];
  let chosenFollowUps: DesiredNotification[];
  let refillReminderAt: string | null = null;
  if (alerts.length > budget) {
    // Real alerts do not fit: keep the earliest ones and reserve one slot for the refill reminder
    // (with a budget of 1 there is no room for both: the alert wins).
    const reserve = budget >= 2 ? 1 : 0;
    chosenAlerts = alerts.slice(0, budget - reserve);
    chosenFollowUps = [];
    const lastAlert = chosenAlerts[chosenAlerts.length - 1];
    if (reserve === 1 && lastAlert) {
      refillReminderAt = new Date(refillReminderTime(Date.parse(lastAlert.fireAt), nowMs)).toISOString();
    }
  } else {
    chosenAlerts = alerts;
    chosenFollowUps = followUps.slice(0, budget - alerts.length);
  }

  const items = [...chosenAlerts, ...chosenFollowUps].sort(compareItems);
  const truncated = beyondHorizon || alerts.length + followUps.length > items.length;
  const last = items[items.length - 1];
  return {
    items,
    truncated,
    refillBefore: truncated && last ? last.fireAt : null,
    refillReminderAt,
  };
}

// Compile-time check that the extended signature still satisfies the contract
// (src/core/conformance.ts checks the public export too).
const _contractCheck: ComputeAlertPlan = computeAlertPlan;
void _contractCheck;
