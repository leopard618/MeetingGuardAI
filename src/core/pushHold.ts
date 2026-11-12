/**
 * Calendar push hold (core helper, no contract): a meeting whose Zoom link is being created
 * server-side is kept back from the calendar pushes (Google, Outlook, device export) until the
 * link lands or the attempt fails. Attendees then get ONE invitation email that already carries
 * the join link, instead of an invitation followed by an "updated invitation" with the link
 * (user report, 2026-10-30). Design: docs/v1/ARCHITECTURE.md section 24.
 *
 * - hold(meetingId) registers a hold and returns its release. Holds nest (a second hold on the
 *   same id must be released too). Every hold expires on its own after maxMs, so a lost release
 *   can never block a push for good.
 * - isHeld(meetingId) is consulted by the engine's debounced flush and by the persisted Google
 *   and Outlook queues (held entries stay queued).
 * - onRelease(listener) tells the engine to flush what it kept back.
 */
import type { ConferenceDetails } from './aiContract';

/**
 * True while a meeting's Zoom link is still being created server-side (`{ provider 'zoom', url
 * null }`). The hold below covers the app's own writes; a document the WEBSITE wrote arrives
 * through the snapshot with `pushPending: true` before zoomCreateMeeting has written the link,
 * so the data engine keeps such a meeting out of `pushRequested`. The server's link write-back
 * is a partial update that keeps `pushPending` and bumps `updatedAt`, and that second arrival
 * is pushed: attendees get ONE invitation that already carries the link (ARCHITECTURE section 32).
 * A tombstone is never held (a cancel must reach the providers).
 */
export function awaitsZoomLink(meeting: { conference: ConferenceDetails | null; deletedAt: string | null }): boolean {
  return meeting.deletedAt === null && meeting.conference?.provider === 'zoom' && meeting.conference.url === null;
}

export interface PushHold {
  hold(meetingId: string, maxMs?: number): () => void;
  isHeld(meetingId: string): boolean;
  onRelease(listener: (meetingId: string) => void): () => void;
  /** Releases every hold (session end, tests). */
  clear(): void;
}

/** Longer than the Zoom callable timeout (ZOOM_CALL_TIMEOUT_MS, 20 s) plus the snapshot delay. */
export const PUSH_HOLD_MAX_MS = 30_000;

interface HoldTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

interface HoldEntry {
  count: number;
  expiry: unknown;
}

export function createPushHold(timers?: HoldTimers): PushHold {
  const clock: HoldTimers = timers ?? {
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  const entries = new Map<string, HoldEntry>();
  const listeners = new Set<(meetingId: string) => void>();

  function notify(meetingId: string): void {
    for (const listener of [...listeners]) {
      try {
        listener(meetingId);
      } catch {
        // A listener failure must not stop the other listeners or the release.
      }
    }
  }

  function drop(meetingId: string): void {
    const entry = entries.get(meetingId);
    if (!entry) return;
    clock.clearTimeout(entry.expiry);
    entries.delete(meetingId);
    notify(meetingId);
  }

  return {
    hold(meetingId, maxMs = PUSH_HOLD_MAX_MS) {
      const existing = entries.get(meetingId);
      if (existing) clock.clearTimeout(existing.expiry);
      const entry: HoldEntry = {
        count: (existing?.count ?? 0) + 1,
        expiry: clock.setTimeout(() => drop(meetingId), maxMs),
      };
      entries.set(meetingId, entry);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const current = entries.get(meetingId);
        if (!current) return;
        if (current.count > 1) {
          current.count -= 1;
          return;
        }
        drop(meetingId);
      };
    },
    isHeld(meetingId) {
      return entries.has(meetingId);
    },
    onRelease(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    clear() {
      for (const meetingId of [...entries.keys()]) drop(meetingId);
    },
  };
}

/** App-wide instance: the zoom service holds, the calendar engine and queues consult it. */
export const calendarPushHold: PushHold = createPushHold();
