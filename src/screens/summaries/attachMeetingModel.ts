/**
 * Pure model of the "Choose a meeting" sheet (AttachMeetingSheet; docs/v2/M10-DESIGN.md section
 * 9): the day the stepper starts on, that day's meetings with series expanded locally, and the
 * summaryAction attach request for a picked row. No React, no Firebase: unit tests import it
 * directly.
 *
 * Series: the sheet reuses the app's display expansion (src/screens/meetings/occurrences.ts over
 * core expandOccurrences), so a weekly series shows that day's occurrence with its effective
 * start and title, and the attach request carries the master id plus the occurrence's ORIGINAL
 * local date (the recurrenceOverrides key). Tombstones and cancelled occurrences of a series are
 * never offered (the server refuses both). A cancelled meeting IS offered, marked as cancelled:
 * it may have been held anyway, the server suggests it (needs_confirmation) and attach accepts it.
 */
import { isLocalDate, todayInZone, toLocalDateTime } from '../../core/time';
import type { Meeting } from '../../core/types';
import type { AttachSummaryRequest } from '../../services/summaries/summariesService';
import { meetingDayKeys } from '../calendar/calendarModel';
import { displayKeyOf, displayWindowForDays, expandMeetingsForDisplay, type DisplayMeeting } from '../meetings/occurrences';

/** What the sheet files (the stable API the inbox and view screens use). */
export interface AttachMeetingTarget {
  summaryId: string;
  /** The date written in the summary (YYYY-MM-DD), or null; the day stepper starts there. */
  summaryDate: string | null;
  /** When the summary arrived (ISO); the stepper starts on its local day when summaryDate is null. */
  receivedAt: string;
  /** 'file': an inbox or kept summary; 'move': a filed one (Move on the view screen). */
  mode: 'file' | 'move';
  /** The meeting it is filed under now ('move'), so the sheet can mark it; null otherwise. */
  currentMeetingId: string | null;
  /**
   * Optional, 'move' of a series: the occurrence it is filed under now (match.occurrenceDate).
   * Without it a series occurrence is never marked as the current one (only a one-off is).
   */
  currentOccurrenceDate?: string | null;
}

/**
 * The day the stepper opens on: the date written in the summary, else the local day the summary
 * arrived, else today (an unreadable arrival time).
 */
export function attachStartDay(
  target: Pick<AttachMeetingTarget, 'summaryDate' | 'receivedAt'>,
  timeZone: string,
  now: Date,
): string {
  if (target.summaryDate !== null && isLocalDate(target.summaryDate)) return target.summaryDate;
  if (Number.isFinite(Date.parse(target.receivedAt))) return toLocalDateTime(target.receivedAt, timeZone).date;
  return todayInZone(timeZone, now);
}

/** All-day first, then by start, then by title (the calendar agenda's order). */
function compareInDay(a: DisplayMeeting, b: DisplayMeeting): number {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  const byStart = Date.parse(a.startAt) - Date.parse(b.startAt);
  if (byStart !== 0) return byStart;
  return a.title.localeCompare(b.title);
}

/**
 * The meetings a summary can be filed under on the local day `dayKey` (in `timeZone`): not
 * deleted (cancelled ones included, see isCancelledMeeting), series expanded to that day's
 * occurrences (a cancelled occurrence drops out). A series whose rule could not be expanded
 * (corrupt data; occurrences.ts then shows the master once) is left out, because an attach
 * without its occurrence date would be refused.
 */
export function meetingsOnDay(meetings: readonly Meeting[], dayKey: string, timeZone: string): DisplayMeeting[] {
  if (!isLocalDate(dayKey)) return [];
  const active = meetings.filter((meeting) => meeting.deletedAt === null);
  const expanded = expandMeetingsForDisplay(active, displayWindowForDays(dayKey, dayKey, timeZone));
  return expanded
    .filter((meeting) => meeting.recurrence === null || meeting.occurrence !== undefined)
    .filter((meeting) => meetingDayKeys(meeting, timeZone).includes(dayKey))
    .sort(compareInDay);
}

/** A cancelled meeting (for a series, every occurrence): offered with a "Cancelled" badge. */
export function isCancelledMeeting(meeting: Pick<DisplayMeeting, 'status'>): boolean {
  return meeting.status === 'cancelled';
}

/** A stable row key (a series has one row per occurrence, all with the master's id). */
export function attachRowKey(meeting: DisplayMeeting): string {
  return displayKeyOf(meeting);
}

/** summaryAction attach for a picked row: the master id and, for a series, the ORIGINAL local date. */
export function attachRequestFor(summaryId: string, meeting: DisplayMeeting): AttachSummaryRequest {
  return { summaryId, meetingId: meeting.id, occurrenceDate: meeting.occurrence?.localDateKey ?? null };
}

/** Whether a row is where the summary is filed now ('move' mode). */
export function isCurrentMeeting(target: Pick<AttachMeetingTarget, 'currentMeetingId' | 'currentOccurrenceDate'>, meeting: DisplayMeeting): boolean {
  if (target.currentMeetingId === null || meeting.id !== target.currentMeetingId) return false;
  if (meeting.occurrence === undefined) return true;
  return (target.currentOccurrenceDate ?? null) === meeting.occurrence.localDateKey;
}
