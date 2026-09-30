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
 * - Recurring meetings (docs/ARCHITECTURE.md §16): the master expands into occurrences over
 *   [now - followUpDelay, horizon + largest offset] and each occurrence gets its own items with
 *   4-part ids ("mg:{id}:{localDateKey}:{offset}" / ":followup") and `localDateKey` set; cancelled
 *   occurrences get nothing; modified ones alert at their EFFECTIVE time. A series that continues
 *   past the horizon marks the plan truncated exactly like a one-off beyond the horizon.
 * - Items are returned sorted by fireAt (ties: alerts before follow-ups, then identifier).
 * All arithmetic is on UTC instants, so offsets are exact across DST changes (occurrence starts
 * come from the meeting's wall clock via expandOccurrences, which is DST-safe by construction).
 */
import { LOCAL_DATE_KEY_PATTERN, MEETING_ID_PATTERN } from '../../core/aiContract';
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
  occurrenceAlertNotificationId,
  occurrenceFollowUpNotificationId,
} from '../../core/identifiers';
import { expandOccurrences, recurrenceEndsAt, type MeetingOccurrence } from '../../core/recurrence';
import { zonedDateTimeToUtcIso } from '../../core/time';
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

    const intensity = meeting.alertIntensity ?? preferences.alertIntensity;
    const offsets = effectiveAlertOffsets(meeting, preferences);

    const pushAlert = (identifier: string, offset: number, fireMs: number, localDateKey?: string): void => {
      if (fireMs <= nowMs) return;
      if (fireMs > horizonEndMs) {
        beyondHorizon = true;
        return;
      }
      if (isSuppressed(meeting.id, fireMs)) return;
      alerts.push({
        identifier,
        kind: 'alert',
        meetingId: meeting.id,
        ...(localDateKey !== undefined ? { localDateKey } : {}),
        offsetMinutes: offset,
        fireAt: new Date(fireMs).toISOString(),
        intensity,
        channelId: channelForIntensity(intensity, vibration),
        categoryId: NOTIFICATION_CATEGORIES.alert,
      });
    };
    const pushFollowUp = (identifier: string, endMs: number, localDateKey?: string): void => {
      if (!preferences.followUpEnabled) return;
      const fireMs = endMs + FOLLOW_UP_DELAY_MINUTES * MINUTE_MS;
      if (fireMs <= nowMs) return;
      if (fireMs > horizonEndMs) {
        beyondHorizon = true;
        return;
      }
      followUps.push({
        identifier,
        kind: 'followup',
        meetingId: meeting.id,
        ...(localDateKey !== undefined ? { localDateKey } : {}),
        offsetMinutes: null,
        fireAt: new Date(fireMs).toISOString(),
        intensity,
        channelId: channelFor('followup', vibration),
        categoryId: NOTIFICATION_CATEGORIES.followup,
      });
    };

    if (meeting.recurrence !== null) {
      const occurrences = expandForPlan(meeting, nowMs, horizonEndMs, offsets[0] ?? 0);
      if (occurrences !== null) {
        for (const occurrence of occurrences) {
          const occurrenceStartMs = Date.parse(occurrence.startAt);
          for (const offset of offsets) {
            pushAlert(
              occurrenceAlertNotificationId(meeting.id, occurrence.localDateKey, offset),
              offset,
              occurrenceStartMs - offset * MINUTE_MS,
              occurrence.localDateKey,
            );
          }
          pushFollowUp(
            occurrenceFollowUpNotificationId(meeting.id, occurrence.localDateKey),
            Date.parse(occurrence.endAt),
            occurrence.localDateKey,
          );
        }
        // A series running past the horizon needs a refresh before the window runs out, exactly
        // like a one-off meeting beyond the horizon.
        const endsAt = recurrenceEndsAt(meeting);
        if (endsAt === null || Date.parse(endsAt) > horizonEndMs) beyondHorizon = true;
        continue;
      }
      // Invalid rule (never stored by this app version): fall through to the one-off path so the
      // master's own first occurrence still alerts instead of silently dropping the meeting.
    }

    const startMs = Date.parse(meeting.startAt);
    for (const offset of offsets) {
      pushAlert(alertNotificationId(meeting.id, offset), offset, startMs - offset * MINUTE_MS);
    }
    pushFollowUp(followUpNotificationId(meeting.id), meetingEndMs(meeting));
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

/**
 * Occurrences of a recurring meeting that can still need a notification: the window starts
 * FOLLOW_UP_DELAY_MINUTES in the past (an occurrence that just ended still gets its follow-up)
 * and ends `maxOffsetMinutes` past the horizon (an alert `offset` minutes before a start just
 * beyond the horizon fires inside it). Returns null for an invalid rule instead of throwing:
 * the planner must never lose every other meeting to one bad document.
 */
function expandForPlan(
  meeting: Meeting,
  nowMs: number,
  horizonEndMs: number,
  maxOffsetMinutes: number,
): MeetingOccurrence[] | null {
  const windowStart = new Date(nowMs - FOLLOW_UP_DELAY_MINUTES * MINUTE_MS).toISOString();
  const windowEnd = new Date(horizonEndMs + maxOffsetMinutes * MINUTE_MS + MINUTE_MS).toISOString();
  try {
    return expandOccurrences(meeting, windowStart, windowEnd);
  } catch {
    return null;
  }
}

/** Effective (post-override) values of one occurrence: what rendering and snoozes need. */
export interface OccurrenceEffective {
  localDateKey: string;
  /** Effective start (UTC ISO), 'modified' override applied. */
  startAt: string;
  durationMinutes: number;
  title: string;
  /** True when a 'modified' override applies. */
  overridden: boolean;
}

/**
 * Direct (no expansion) lookup of one occurrence's effective values, given its ORIGINAL local
 * date key. Returns null for non-recurring meetings, malformed keys, occurrences cancelled by an
 * override, and invalid timezone data. It deliberately does NOT re-check the series pattern:
 * callers hold identifiers the planner itself produced (notification ids, alert payloads).
 */
export function occurrenceEffective(
  meeting: Pick<Meeting, 'title' | 'time' | 'timezone' | 'durationMinutes' | 'allDay' | 'recurrence' | 'recurrenceOverrides'>,
  localDateKey: string,
): OccurrenceEffective | null {
  if (meeting.recurrence === null || !LOCAL_DATE_KEY_PATTERN.test(localDateKey)) return null;
  const override = meeting.recurrenceOverrides?.[localDateKey] ?? null;
  if (override !== null && override.status === 'cancelled') return null;
  let startAt: string;
  try {
    startAt =
      override?.startAt !== null && override?.startAt !== undefined
        ? new Date(Date.parse(override.startAt)).toISOString()
        : zonedDateTimeToUtcIso(localDateKey, meeting.allDay ? '00:00' : meeting.time, meeting.timezone);
  } catch {
    return null;
  }
  if (!Number.isFinite(Date.parse(startAt))) return null;
  return {
    localDateKey,
    startAt,
    durationMinutes: override?.durationMinutes ?? meeting.durationMinutes,
    title: override?.title ?? meeting.title,
    overridden: override !== null,
  };
}

// Compile-time check that the extended signature still satisfies the contract
// (src/core/conformance.ts checks the public export too).
const _contractCheck: ComputeAlertPlan = computeAlertPlan;
void _contractCheck;
