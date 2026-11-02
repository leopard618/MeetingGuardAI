/**
 * When a meeting can be debriefed (M8): it has ended (start + duration is in the past), or it is
 * a series whose first occurrence has started (some occurrence has ended by now). Cancelled
 * meetings are never debriefed. Pure; unit-tested.
 */
import type { Meeting } from '../../core/types';

export function canDebrief(meeting: Pick<Meeting, 'startAt' | 'durationMinutes' | 'status' | 'recurrence'>, now: Date): boolean {
  if (meeting.status === 'cancelled') return false;
  const start = Date.parse(meeting.startAt);
  if (Number.isNaN(start)) return false;
  if (meeting.recurrence !== null) return start <= now.getTime();
  return start + meeting.durationMinutes * 60_000 <= now.getTime();
}
