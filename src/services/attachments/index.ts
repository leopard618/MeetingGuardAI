/**
 * ATTACHMENTS public API (device-local meeting attachments).
 *
 * Files stay on this device (Paths.document/attachments/{uid}/); metadata lives in the data
 * layer's per-user store (`attachmentStore`, mg:{uid}:attachments, `localOnly: true`). Nothing is
 * uploaded or synced, and meetings in Firestore never contain device paths. Screens must say so.
 */
import { appEvents } from '../../core/events';
import { attachmentStore, dataService } from '../data';
import { createAttachmentService, type AttachmentService } from './attachmentService';
import { nativeAttachmentFiles, nativeAttachmentOpener, nativeAttachmentPickers, newAttachmentId } from './nativeAdapters';
import { useMeetingAttachments as useMeetingAttachmentsWith, type UseMeetingAttachmentsResult } from './useMeetingAttachments';
import { wireAttachmentEvents } from './wiring';

export const attachmentService: AttachmentService = createAttachmentService({
  store: attachmentStore,
  getUid: () => dataService.getActiveUid(),
  files: nativeAttachmentFiles,
  pickers: nativeAttachmentPickers,
  opener: nativeAttachmentOpener,
  newId: newAttachmentId,
});

// Module scope: this module is loaded at app start (meeting details and form import it).
wireAttachmentEvents(attachmentService, appEvents);

/** The meeting's device-local attachments (live), with add / remove / open. */
export function useMeetingAttachments(meetingId: string): UseMeetingAttachmentsResult {
  return useMeetingAttachmentsWith(meetingId, attachmentService);
}

export {
  createAttachmentService,
  type AttachmentAddResult,
  type AttachmentFailure,
  type AttachmentFailureReason,
  type AttachmentService,
  type AttachmentSource,
  type PickedFile,
} from './attachmentService';
export { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_MB, attachmentCategoryOf, fileSizeParts, resolveMimeType, type FileSizeUnit } from './fileTypes';
export type { UseMeetingAttachmentsResult } from './useMeetingAttachments';
export type { AttachmentCategory, AttachmentRecord } from '../data';
