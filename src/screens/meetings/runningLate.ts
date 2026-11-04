/**
 * Running late (V2 Stage 2, M9; docs/v1/ARCHITECTURE.md section 33). PURE: no React, no RN,
 * no repository (unit-tested in __tests__/runningLate.test.ts).
 *
 * The user picks how late they are (5, 10, 15 or 30 minutes), gets a ready message in the UI
 * language with the meeting title and the new time, edits it and sends it from the phone through
 * the share sheet (or the mail composer to the participants). Moving the meeting to the new
 * time is a SEPARATE decision taken afterwards, never a side effect of sending. The app never
 * claims the message was delivered: the share sheet's answer is reported as what it is (see
 * `shareOutcome`).
 */
import type { TranslateFn } from '../../core/contracts';
import { getDeviceTimeZone, todayInZone } from '../../core/time';
import type { Meeting, MeetingPatch } from '../../core/types';
import type { Formatters } from '../shared/useFormatters';
import { expandMeetingsForDisplay, type DisplayMeeting } from './occurrences';

export const RUNNING_LATE_DELAYS = [5, 10, 15, 30] as const;
export type RunningLateDelay = (typeof RUNNING_LATE_DELAYS)[number];

/** What an entry point hands to the sheet: the stored meeting and, when known, the occurrence start. */
export interface RunningLateTarget {
  meetingId: string;
  /** Start of the occurrence in hand (alert, dashboard row); null = the next live occurrence. */
  startAt: string | null;
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
/** How far ahead "the next live occurrence" of a series is looked for (details screen). */
const NEXT_OCCURRENCE_WINDOW_MS = 370 * DAY_MS;

export function endMs(meeting: Pick<Meeting, 'startAt' | 'durationMinutes'>): number {
  return Date.parse(meeting.startAt) + meeting.durationMinutes * MINUTE_MS;
}

/** A timed, not cancelled meeting that has not ended yet (upcoming or running). */
export function canRunLate(meeting: Pick<Meeting, 'allDay' | 'status' | 'startAt' | 'durationMinutes'>, now: Date): boolean {
  if (meeting.allDay || meeting.status === 'cancelled') return false;
  return endMs(meeting) > now.getTime();
}

/** A live meeting that has already started (the "End meeting now" case). */
export function isRunningNow(meeting: Pick<Meeting, 'allDay' | 'status' | 'startAt' | 'durationMinutes'>, now: Date): boolean {
  return canRunLate(meeting, now) && Date.parse(meeting.startAt) <= now.getTime();
}

/**
 * The display row the sheet works on: a one-off meeting as it is, or ONE occurrence of a series
 * (the one starting at `startAt` when an entry point knows it, else the next live one). Null when
 * nothing is live: deleted, cancelled, all-day, or already over.
 */
export function resolveRunningLateMeeting(master: Meeting, startAt: string | null, now: Date): DisplayMeeting | null {
  if (master.deletedAt !== null) return null;
  if (master.recurrence === null) return canRunLate(master, now) ? master : null;
  const anchor = startAt !== null && Number.isFinite(Date.parse(startAt)) ? Date.parse(startAt) : now.getTime();
  const from = Math.min(anchor, now.getTime()) - DAY_MS;
  const to = startAt !== null ? anchor + DAY_MS : now.getTime() + NEXT_OCCURRENCE_WINDOW_MS;
  let rows: DisplayMeeting[];
  try {
    rows = expandMeetingsForDisplay([master], { startIso: new Date(from).toISOString(), endIso: new Date(to).toISOString() }, { maxPerSeries: 400 });
  } catch {
    return null;
  }
  const live = rows.filter((row) => canRunLate(row, now));
  if (startAt !== null) {
    const exact = live.find((row) => Date.parse(row.startAt) === anchor);
    if (exact) return exact;
  }
  // The occurrence in hand was edited or has ended meanwhile: the next live one is the best fit.
  return live[0] ?? null;
}

/**
 * The new start: `minutes` after the scheduled start, or after now (rounded up to the next whole
 * minute) once the meeting has already started, so the message never names a time in the past.
 */
export function runningLateNewStart(startAt: string, minutes: number, now: Date): string {
  const nowCeil = Math.ceil(now.getTime() / MINUTE_MS) * MINUTE_MS;
  const base = Math.max(Date.parse(startAt), nowCeil);
  return new Date(base + minutes * MINUTE_MS).toISOString();
}

/** "3:10 PM" today, "Tue, Nov 4, 3:10 PM" when the new time falls on another day (device zone). */
export function newTimeText(fmt: Formatters, newStartAt: string, now: Date, timeZone: string = getDeviceTimeZone()): string {
  let sameDay = true;
  try {
    sameDay = todayInZone(timeZone, newStartAt) === todayInZone(timeZone, now);
  } catch {
    sameDay = true;
  }
  return sameDay ? fmt.time(newStartAt) : fmt.dateTime(newStartAt);
}

/** The ready message in the UI language: title, delay and the new time. */
export function buildRunningLateMessage(
  t: TranslateFn,
  fmt: Formatters,
  meeting: Pick<Meeting, 'title'>,
  minutes: number,
  newStartAt: string,
  now: Date,
): string {
  return t('meetings:runningLate.message', {
    count: minutes,
    title: meeting.title,
    time: newTimeText(fmt, newStartAt, now),
    interpolation: { escapeValue: false },
  });
}

export type RunningLateShareOutcome = 'confirmed' | 'handed_over' | 'dismissed';

/**
 * What the share sheet's answer really means. iOS reports both completion (`sharedAction`, the
 * chosen app finished its activity) and dismissal; Android reports `sharedAction` as soon as the
 * sheet opens, so there the message is only known to have been HANDED OVER, never sent. The mail
 * composer (mailto:) is the same: handed over.
 */
export function shareOutcome(result: 'shared' | 'dismissed', platform: string): RunningLateShareOutcome {
  if (result === 'dismissed') return 'dismissed';
  return platform === 'ios' ? 'confirmed' : 'handed_over';
}

/** A write scoped to the row in hand: the one-off meeting, or one occurrence of a series. */
export type ScopedMeetingWrite =
  | { scope: 'meeting'; meetingId: string; patch: Pick<MeetingPatch, 'startAt' | 'durationMinutes'> }
  | { scope: 'occurrence'; meetingId: string; localDateKey: string; patch: Pick<MeetingPatch, 'startAt' | 'durationMinutes'> };

function scoped(meeting: DisplayMeeting, patch: Pick<MeetingPatch, 'startAt' | 'durationMinutes'>): ScopedMeetingWrite {
  return meeting.occurrence !== undefined && meeting.recurrence !== null
    ? { scope: 'occurrence', meetingId: meeting.id, localDateKey: meeting.occurrence.localDateKey, patch }
    : { scope: 'meeting', meetingId: meeting.id, patch };
}

/** Moves the start to the new time; the length stays, so the meeting ends later. */
export function runningLateMove(meeting: DisplayMeeting, newStartAt: string): ScopedMeetingWrite {
  return scoped(meeting, { startAt: newStartAt });
}

/**
 * "End meeting now": shortens the running meeting so it ends at `now` (whole minutes, at least
 * one). Null when the meeting is not running: nothing to end.
 */
export function endNowWrite(meeting: DisplayMeeting, now: Date): ScopedMeetingWrite | null {
  if (!isRunningNow(meeting, now)) return null;
  const elapsed = Math.ceil((now.getTime() - Date.parse(meeting.startAt)) / MINUTE_MS);
  const durationMinutes = Math.max(1, Math.min(meeting.durationMinutes, elapsed));
  if (durationMinutes === meeting.durationMinutes) return null;
  return scoped(meeting, { durationMinutes });
}

/** Names for the mail composer and the hint: "Ana, bob@example.com". */
export function participantNames(meeting: Pick<Meeting, 'participants'>): string[] {
  return meeting.participants.map((participant) => participant.name?.trim() || participant.email);
}
