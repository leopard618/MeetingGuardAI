/**
 * PURE dashboard model (no React, no i18n): greeting period, the meeting happening now and the
 * next one, the live countdown, and today's timeline with conflicts. Conflict rules are shared
 * with the insights screen (../insights/meetingInsights).
 */
import type { Meeting } from '../../core/types';
import {
  endMs,
  findBackToBack,
  findOverlaps,
  isCountable,
  meetingDates,
  meetingsOnDays,
  startMs,
  todayOf,
  type InsightContext,
} from '../insights/meetingInsights';

export type DayPeriod = 'morning' | 'afternoon' | 'evening';

/** 05:00-11:59 morning, 12:00-17:59 afternoon, otherwise evening. */
export function dayPeriodOf(hour: number): DayPeriod {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  return 'evening';
}

/** First name for the greeting ("Ana María López" -> "Ana"); null when there is nothing usable. */
export function firstNameOf(displayName: string | null | undefined): string | null {
  if (typeof displayName !== 'string') return null;
  const first = displayName.trim().split(/\s+/)[0] ?? '';
  // Never greet with an email address.
  if (first.length === 0 || first.includes('@')) return null;
  return first.length > 24 ? `${first.slice(0, 24)}...` : first;
}

// ---------------------------------------------------------------------------------------------
// Now / next
// ---------------------------------------------------------------------------------------------

export interface NowAndNext {
  /** Timed meeting in progress (the one that started last), or null. */
  current: Meeting | null;
  /** First timed meeting that starts after now, or null. */
  next: Meeting | null;
}

/** All-day and cancelled meetings are never "next". */
export function findNowAndNext(meetings: readonly Meeting[], now: Date): NowAndNext {
  const nowMs = now.getTime();
  let current: Meeting | null = null;
  let next: Meeting | null = null;
  for (const meeting of meetings) {
    if (!isCountable(meeting) || meeting.allDay) continue;
    const start = startMs(meeting);
    if (!Number.isFinite(start)) continue;
    const end = endMs(meeting);
    if (start <= nowMs && end > nowMs) {
      if (current === null || start > startMs(current)) current = meeting;
    } else if (start > nowMs) {
      if (next === null || start < startMs(next)) next = meeting;
    }
  }
  return { current, next };
}

export interface CountdownParts {
  /** Whole seconds left (0 when the target has passed). */
  totalSeconds: number;
  hours: number;
  minutes: number;
  seconds: number;
}

export function countdownTo(targetMs: number, nowMs: number): CountdownParts {
  const totalSeconds = Math.max(0, Math.ceil((targetMs - nowMs) / 1000));
  return {
    totalSeconds,
    hours: Math.floor(totalSeconds / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  };
}

/** "4:05" / "1:02:03" (digits only, language-neutral). */
export function formatCountdownClock(parts: CountdownParts): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return parts.hours > 0 ? `${parts.hours}:${pad(parts.minutes)}:${pad(parts.seconds)}` : `${parts.minutes}:${pad(parts.seconds)}`;
}

export type CountdownDisplay =
  /** Under an hour: a ticking clock. */
  | { kind: 'clock'; text: string }
  /** 1-24 hours: whole minutes (formatted as a duration by the screen). */
  | { kind: 'duration'; minutes: number }
  /** A day or more away: a relative date ("tomorrow", "in 3 days"). */
  | { kind: 'relative' }
  | { kind: 'now' };

export const CLOCK_THRESHOLD_SECONDS = 3600;

export function countdownDisplay(targetMs: number, nowMs: number): CountdownDisplay {
  const parts = countdownTo(targetMs, nowMs);
  if (parts.totalSeconds === 0) return { kind: 'now' };
  if (parts.totalSeconds < CLOCK_THRESHOLD_SECONDS) return { kind: 'clock', text: formatCountdownClock(parts) };
  if (parts.totalSeconds < 24 * 3600) return { kind: 'duration', minutes: Math.ceil(parts.totalSeconds / 60) };
  return { kind: 'relative' };
}

/** Tick interval for a countdown: every second under an hour, else every 30 seconds. */
export function countdownTickMs(targetMs: number | null, nowMs: number): number {
  if (targetMs === null) return 30_000;
  return targetMs - nowMs < CLOCK_THRESHOLD_SECONDS * 1000 ? 1000 : 30_000;
}

// ---------------------------------------------------------------------------------------------
// Today's timeline
// ---------------------------------------------------------------------------------------------

export type TimelineState = 'past' | 'now' | 'upcoming';

export interface TimelineItem {
  meeting: Meeting;
  state: TimelineState;
  /** Other meetings of today whose time overlaps this one. */
  overlapsWith: Meeting[];
  /** The meeting this one starts right after (no break), or null. */
  followsRightAfter: Meeting | null;
}

/**
 * Today's meetings (device zone) in order: all-day first, then by start. Cancelled meetings stay
 * in the list (shown as cancelled) but never count as conflicts.
 */
export function buildTodayTimeline(meetings: readonly Meeting[], context: InsightContext): TimelineItem[] {
  const today = todayOf(context);
  const nowMs = context.now.getTime();
  const scheduled = meetingsOnDays(meetings, [today], context.timeZone);
  const cancelled = meetings.filter(
    (meeting) => meeting.deletedAt === null && meeting.status === 'cancelled' && meetingDates(meeting, context.timeZone).includes(today),
  );
  const overlaps = findOverlaps(scheduled);
  const backToBack = findBackToBack(scheduled);

  const items = [...scheduled, ...cancelled].map((meeting): TimelineItem => {
    let state: TimelineState;
    if (meeting.allDay) {
      state = 'now';
    } else {
      const start = startMs(meeting);
      const end = endMs(meeting);
      state = end <= nowMs ? 'past' : start <= nowMs ? 'now' : 'upcoming';
    }
    const overlapsWith = overlaps
      .filter((pair) => pair.first.id === meeting.id || pair.second.id === meeting.id)
      .map((pair) => (pair.first.id === meeting.id ? pair.second : pair.first));
    const follows = backToBack.find((pair) => pair.second.id === meeting.id);
    return { meeting, state, overlapsWith, followsRightAfter: follows ? follows.first : null };
  });

  return items.sort((a, b) => {
    if (a.meeting.allDay !== b.meeting.allDay) return a.meeting.allDay ? -1 : 1;
    return startMs(a.meeting) - startMs(b.meeting) || a.meeting.title.localeCompare(b.meeting.title);
  });
}
