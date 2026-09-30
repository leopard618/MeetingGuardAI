/**
 * PURE display expansion of recurring meetings (unit-tested; no React / RN imports).
 *
 * The list, calendar and dashboard render one row per OCCURRENCE, not per stored document
 * (ARCHITECTURE §16: occurrences are never stored). This module turns `Meeting[]` from
 * `useMeetings()` into display entries: one-off meetings pass through unchanged; recurring
 * masters are replaced by their occurrences inside the screen's window, each materialized as a
 * Meeting-shaped value (so every existing pure model keeps working) plus the occurrence ref the
 * scope dialogs need. Expansion is DST-safe (core `expandOccurrences` works in the meeting's
 * zone).
 */
import { expandOccurrences } from '../../core/recurrence';
import { isLocalDate, isLocalTime, toLocalDateTime, todayInZone, zonedDateTimeToUtcIso, addDaysToLocalDate } from '../../core/time';
import type { Meeting, MeetingPatch } from '../../core/types';

/** Which occurrence of a series a display row is (the scope dialogs and repositories need the key). */
export interface MeetingOccurrenceRef {
  /** `"{meetingId}:{localDateKey}"` (core occurrenceIdFor). */
  occurrenceId: string;
  /** The occurrence's ORIGINAL local date in the meeting's zone (the override key). */
  localDateKey: string;
  /** True when a 'modified' override applies to this occurrence. */
  overridden: boolean;
}

/**
 * A row of the list / calendar agenda / dashboard: a Meeting, or one materialized occurrence of a
 * recurring meeting (`occurrence` set; `startAt`/`date`/`time`/`durationMinutes`/`title` are the
 * occurrence's effective values, everything else is the master's).
 */
export type DisplayMeeting = Meeting & { occurrence?: MeetingOccurrenceRef };

/** Stable, unique list key (a series has many rows with the master's id). */
export function displayKeyOf(meeting: DisplayMeeting): string {
  return meeting.occurrence?.occurrenceId ?? meeting.id;
}

export interface DisplayWindow {
  /** UTC ISO instants; occurrences overlapping [start, end) are shown. */
  startIso: string;
  endIso: string;
}

/** How far the meetings list looks back / ahead when expanding series (documented bound). */
export const LIST_PAST_DAYS = 90;
export const LIST_FUTURE_DAYS = 370;

/** Window of whole local days around `now` (list, dashboard). */
export function displayWindowAround(now: Date, timeZone: string, pastDays: number, futureDays: number): DisplayWindow {
  const today = todayInZone(timeZone, now);
  return {
    startIso: zonedDateTimeToUtcIso(addDaysToLocalDate(today, -pastDays), '00:00', timeZone),
    endIso: zonedDateTimeToUtcIso(addDaysToLocalDate(today, futureDays + 1), '00:00', timeZone),
  };
}

/** Window covering the local days [firstKey, lastKey] plus one day of slack each side (calendar grid). */
export function displayWindowForDays(firstKey: string, lastKey: string, timeZone: string): DisplayWindow {
  return {
    startIso: zonedDateTimeToUtcIso(addDaysToLocalDate(firstKey, -1), '00:00', timeZone),
    endIso: zonedDateTimeToUtcIso(addDaysToLocalDate(lastKey, 2), '00:00', timeZone),
  };
}

function materialize(master: Meeting, occurrence: ReturnType<typeof expandOccurrences>[number]): DisplayMeeting {
  const local = toLocalDateTime(occurrence.startAt, master.timezone);
  return {
    ...master,
    startAt: occurrence.startAt,
    durationMinutes: occurrence.durationMinutes,
    title: occurrence.title,
    date: local.date,
    time: local.time,
    occurrence: {
      occurrenceId: occurrence.occurrenceId,
      localDateKey: occurrence.localDateKey,
      overridden: occurrence.overridden,
    },
  };
}

/**
 * Expands every recurring master in `meetings` into its occurrences inside `window`; one-off
 * meetings pass through as they are. A master whose rule cannot be expanded (invalid data) falls
 * back to its own single row instead of disappearing. The result keeps no particular order (the
 * screen models sort).
 */
export function expandMeetingsForDisplay(
  meetings: readonly Meeting[],
  window: DisplayWindow,
  options: { maxPerSeries?: number } = {},
): DisplayMeeting[] {
  const out: DisplayMeeting[] = [];
  for (const meeting of meetings) {
    if (meeting.recurrence === null) {
      out.push(meeting);
      continue;
    }
    try {
      for (const occurrence of expandOccurrences(meeting, window.startIso, window.endIso, { max: options.maxPerSeries })) {
        out.push(materialize(meeting, occurrence));
      }
    } catch {
      // Defensive: parseMeetingDoc validates rules, so this only happens for corrupt in-memory
      // data. Showing the master once is better than hiding the meeting.
      out.push(meeting);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// "Edit this occurrence" (the v1 override surface: title, start, duration)
// ---------------------------------------------------------------------------------------------

export interface OccurrenceEditDraft {
  title: string;
  /** Wall clock in the MEETING's time zone. */
  date: string;
  time: string;
  durationMinutes: number;
}

/** The sheet's starting values: the occurrence's effective title/start/duration in the meeting zone. */
export function occurrenceEditDraftOf(entry: DisplayMeeting): OccurrenceEditDraft {
  const local = toLocalDateTime(entry.startAt, entry.timezone);
  return { title: entry.title, date: local.date, time: local.time, durationMinutes: entry.durationMinutes };
}

export function isOccurrenceDraftValid(draft: OccurrenceEditDraft): boolean {
  const title = draft.title.trim();
  return (
    title.length > 0 &&
    title.length <= 200 &&
    isLocalDate(draft.date) &&
    isLocalTime(draft.time) &&
    Number.isInteger(draft.durationMinutes) &&
    draft.durationMinutes >= 1
  );
}

/**
 * Only what really changed, for MeetingRecurrenceOps.updateOccurrence. An empty patch means the
 * sheet can simply close.
 */
export function occurrenceEditPatch(
  entry: DisplayMeeting,
  draft: OccurrenceEditDraft,
): Pick<MeetingPatch, 'startAt' | 'durationMinutes' | 'title'> {
  const patch: Pick<MeetingPatch, 'startAt' | 'durationMinutes' | 'title'> = {};
  const title = draft.title.trim();
  if (title !== entry.title) patch.title = title;
  const startAt = zonedDateTimeToUtcIso(draft.date, draft.time, entry.timezone);
  if (Date.parse(startAt) !== Date.parse(entry.startAt)) patch.startAt = startAt;
  if (draft.durationMinutes !== entry.durationMinutes) patch.durationMinutes = draft.durationMinutes;
  return patch;
}
