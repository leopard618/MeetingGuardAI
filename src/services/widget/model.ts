/**
 * PURE next-widget-entry model (owner: widget; docs/ARCHITECTURE.md §19). No React Native,
 * Expo or Firebase imports; unit-tested next to this file.
 *
 * Selection rules (the contract the feeder and tests pin down):
 * - Candidates: active (deletedAt null), status 'scheduled', non-all-day meetings; recurring
 *   masters are expanded with expandOccurrences over [now - 5 min, now + WIDGET_HORIZON_DAYS).
 * - The entry is the candidate with the EARLIEST effective start >= now - 5 min (a meeting that
 *   just started stays on the widget; the native side switches it to the "now" presentation).
 * - null when there is no candidate (the widget shows its empty state).
 */
import { notImplemented } from '../../core/errors';
import type { Meeting } from '../../core/types';

export const WIDGET_HORIZON_DAYS = 7;
/** A meeting stays "next" this long after its start (rendered natively with the now-label). */
export const WIDGET_STARTED_GRACE_MINUTES = 5;

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
 * STUB (widget pass): picks the next widget entry from the active meetings. Pure; the feeder
 * formats timeText/dateText with the app's formatters and builds the deep link from meetingId.
 */
export function computeNextWidgetEntry(meetings: readonly Meeting[], now: Date): NextWidgetEntry | null {
  void meetings;
  void now;
  throw notImplemented('computeNextWidgetEntry');
}
