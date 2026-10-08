/**
 * Keeps the device-local attachment files in step with the session and the meetings:
 * - session:ended      -> the data layer wiped the metadata; delete the user's files too;
 * - session:started    -> delete attachments picked in a form that was never saved (> 24 h);
 * - meetings:changed   -> a meeting deleted on this device (origin user / ai) takes its
 *                         attachments with it (nothing else could ever show them again).
 */
import { toAppError } from '../../core/errors';
import type { AppEventMap, EventBus, Unsubscribe } from '../../core/events';
import { createLogger } from '../../core/logger';
import type { AttachmentService } from './attachmentService';

const log = createLogger('attachments');

export function wireAttachmentEvents(service: AttachmentService, bus: EventBus<AppEventMap>): Unsubscribe {
  const unsubscribers = [
    bus.on('session:ended', ({ uid }) => {
      service.handleSessionEnded(uid);
    }),
    bus.on('session:started', async () => {
      try {
        await service.pruneUnlinked();
      } catch (error) {
        log.warn('could not prune unlinked attachments', toAppError(error).code);
      }
    }),
    bus.on('meetings:changed', async (event) => {
      if (event.reason !== 'deleted' || (event.origin !== 'user' && event.origin !== 'ai')) return;
      for (const meetingId of event.changedIds ?? []) {
        try {
          await service.removeForMeeting(meetingId);
        } catch (error) {
          log.warn('could not remove the attachments of a deleted meeting', toAppError(error).code);
        }
      }
    }),
  ];
  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
  };
}
