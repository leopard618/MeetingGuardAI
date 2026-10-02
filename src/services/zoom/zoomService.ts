/**
 * ZOOM link service (owner: zoom-app) - STUB. Contract: ZoomService in src/core/contracts.ts;
 * design: docs/ARCHITECTURE.md §24. The stub reports "availability unknown" and performs no
 * network work, so every screen keeps today's paste-only behavior until the zoom pass lands.
 *
 * Implementation notes for the zoom-app pass:
 * - Callables: CALLABLES.zoomStatus / zoomCreateMeeting / zoomSyncMeeting / zoomDeleteMeeting
 *   (src/core/aiContract.ts; httpsCallable in env.functionsRegion with ZOOM_CALL_TIMEOUT_MS;
 *   validate responses with the zod schemas; map HttpsError.details.reason via ZOOM_ERROR_CODES
 *   to AppError codes - invalid_request becomes invalid_input).
 * - Session cache: the zoomStatus answer and the per-meeting failure map live in module memory,
 *   cleared on appEvents 'session:ended' (never persisted; a new session asks again).
 * - ensureLink flushes the outbox first (dataService.flushOutbox) - the server loads the meeting
 *   document from Firestore, so an unsent create would 404. Offline => AppError('offline'); the
 *   details card keeps showing the pending copy and Retry.
 * - NO meeting content in logs: meeting ids and error codes only.
 */
import type { ZoomLinkResult, ZoomService } from '../../core/contracts';
import { notImplemented, type AppErrorCode } from '../../core/errors';
import type { Meeting, MeetingPatch } from '../../core/types';

export const zoomService: ZoomService = {
  async isAvailable(): Promise<boolean> {
    // STUB: the integration is treated as unknown/not available; nothing is advertised.
    return false;
  },

  getKnownAvailability(): boolean | null {
    // STUB: null = "not asked yet", so conferenceCapability keeps the plain paste behavior.
    return null;
  },

  async ensureLink(_meetingId: string): Promise<ZoomLinkResult> {
    return notImplemented('zoomService.ensureLink');
  },

  async syncIfNeeded(_meeting: Meeting, _patch: MeetingPatch): Promise<void> {
    // STUB: nothing to sync while no Zoom meetings can exist.
  },

  async onMeetingDeleted(_meeting: Pick<Meeting, 'id' | 'external'>): Promise<void> {
    // STUB: nothing to delete while no Zoom meetings can exist.
  },

  linkFailure(_meetingId: string): AppErrorCode | null {
    return null;
  },
};
