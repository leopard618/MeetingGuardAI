/**
 * PURE recurring-meeting helpers of the data layer (owner: data). No React Native, Expo or
 * Firebase imports; unit-tested next to the repository tests.
 *
 * The repository's occurrence operations (MeetingRecurrenceOps in src/core/contracts.ts) must
 * check that a `localDateKey` really names an occurrence of the series before writing an override
 * for it: an override on a date the series never generates would be dead data that no expansion
 * ever reads.
 */
import { LOCAL_DATE_KEY_PATTERN } from '../../core/aiContract';
import { expandOccurrences, type RecurringMeetingLike } from '../../core/recurrence';
import { addMinutesIso, isLocalDate, zonedDateTimeToUtcIso } from '../../core/time';

/**
 * True when `localDateKey` is an ORIGINAL occurrence date of the meeting's series (independent of
 * overrides: cancelled occurrences still count, because `count` rules consume them and an override
 * keyed by the date stays addressable). False for one-off meetings, malformed keys, dates the
 * pattern never generates, and dates past the rule's `until` / `count` end.
 *
 * Never throws: an invalid rule or timezone simply means "not an occurrence".
 */
export function isSeriesOccurrenceDate(
  meeting: RecurringMeetingLike & { recurrence: NonNullable<RecurringMeetingLike['recurrence']> },
  localDateKey: string,
): boolean {
  if (!LOCAL_DATE_KEY_PATTERN.test(localDateKey) || !isLocalDate(localDateKey)) return false;
  try {
    // Overrides stripped: the ORIGINAL date set is independent of them (cancelled overrides
    // consume `count`, exactly like the expander's own accounting without an override map).
    const probe: RecurringMeetingLike = { ...meeting, recurrenceOverrides: null };
    const originalStart = zonedDateTimeToUtcIso(localDateKey, meeting.allDay ? '00:00' : meeting.time, meeting.timezone);
    const occurrences = expandOccurrences(probe, originalStart, addMinutesIso(originalStart, 1), { max: 2 });
    return occurrences.some((occurrence) => occurrence.localDateKey === localDateKey);
  } catch {
    return false;
  }
}
