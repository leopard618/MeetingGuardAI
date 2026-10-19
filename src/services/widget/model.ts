/**
 * PURE next-widget-entry model (owner: widget; docs/v1/ARCHITECTURE.md §19). No React Native,
 * Expo or Firebase imports; unit-tested next to this file.
 *
 * Selection rules (the contract the feeder and tests pin down):
 * - Candidates: active (deletedAt null), status 'scheduled', non-all-day meetings; recurring
 *   masters are expanded with expandOccurrences over [now - 5 min, now + WIDGET_HORIZON_DAYS).
 * - The entry is the candidate with the EARLIEST effective start >= now - 5 min (a meeting that
 *   just started stays on the widget; the native side switches it to the "now" presentation).
 * - null when there is no candidate (the widget shows its empty state).
 */
import { expandOccurrences } from '../../core/recurrence';
import type { Meeting } from '../../core/types';

export const WIDGET_HORIZON_DAYS = 7;
/** A meeting stays "next" this long after its start (rendered natively with the now-label). */
export const WIDGET_STARTED_GRACE_MINUTES = 5;

/** Plenty for 7 days even for a daily series with moved occurrences; keeps the scan cheap. */
const EXPANSION_MAX = 50;

export interface NextWidgetEntry {
  meetingId: string;
  /** Effective (post-override) title. */
  title: string;
  /** Effective start instant (UTC ISO + epoch ms for the native boundary). */
  startAt: string;
  startAtMs: number;
  /** The occurrence's date key for recurring meetings; null for one-offs. */
  localDateKey: string | null;
}

/**
 * Picks the next widget entry from the given meetings (pure; the feeder formats
 * timeText/dateText with the app's formatters and builds the deep link from meetingId).
 * Ties on the start instant break deterministically on the meeting id.
 */
export function computeNextWidgetEntry(meetings: readonly Meeting[], now: Date): NextWidgetEntry | null {
  const graceStartMs = now.getTime() - WIDGET_STARTED_GRACE_MINUTES * 60_000;
  const windowEndMs = now.getTime() + WIDGET_HORIZON_DAYS * 86_400_000;
  const windowStartIso = new Date(graceStartMs).toISOString();
  const windowEndIso = new Date(windowEndMs).toISOString();

  let best: NextWidgetEntry | null = null;
  for (const meeting of meetings) {
    if (meeting.deletedAt !== null || meeting.status !== 'scheduled' || meeting.allDay) continue;
    const candidate = meeting.recurrence !== null
      ? nextOccurrenceEntry(meeting, windowStartIso, windowEndIso, graceStartMs)
      : oneOffEntry(meeting, graceStartMs, windowEndMs);
    if (candidate === null) continue;
    if (
      best === null ||
      candidate.startAtMs < best.startAtMs ||
      (candidate.startAtMs === best.startAtMs && candidate.meetingId < best.meetingId)
    ) {
      best = candidate;
    }
  }
  return best;
}

function oneOffEntry(meeting: Meeting, graceStartMs: number, windowEndMs: number): NextWidgetEntry | null {
  const startAtMs = Date.parse(meeting.startAt);
  if (!Number.isFinite(startAtMs) || startAtMs < graceStartMs || startAtMs >= windowEndMs) return null;
  return { meetingId: meeting.id, title: meeting.title, startAt: meeting.startAt, startAtMs, localDateKey: null };
}

function nextOccurrenceEntry(
  meeting: Meeting,
  windowStartIso: string,
  windowEndIso: string,
  graceStartMs: number,
): NextWidgetEntry | null {
  let occurrences;
  try {
    occurrences = expandOccurrences(meeting, windowStartIso, windowEndIso, { max: EXPANSION_MAX });
  } catch {
    // A malformed stored rule must never break the widget; the meeting is simply skipped.
    return null;
  }
  // Sorted by effective start; an occurrence can overlap the window by its END while its start
  // is already before the grace boundary (in progress for a while) - those are not "next".
  for (const occurrence of occurrences) {
    const startAtMs = Date.parse(occurrence.startAt);
    if (!Number.isFinite(startAtMs) || startAtMs < graceStartMs) continue;
    return {
      meetingId: meeting.id,
      title: occurrence.title,
      startAt: occurrence.startAt,
      startAtMs,
      localDateKey: occurrence.localDateKey,
    };
  }
  return null;
}
