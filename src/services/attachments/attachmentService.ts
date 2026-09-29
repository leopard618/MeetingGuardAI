/**
 * Device-local meeting attachments (replaces src/api/fileUpload.js).
 *
 * Attachments are NOT uploaded: a picked file is copied into the app's document directory
 * (attachments/{uid}/) on THIS device and its metadata goes to the data layer's per-user
 * attachment store (mg:{uid}:attachments, every record `localOnly: true`). Meetings in Firestore
 * never contain device paths, other devices never see the files, and the UI says so.
 *
 * This module holds the logic only; the native pieces (pickers, file system, "open with") are
 * injected (./nativeAdapters.ts in the app, fakes in tests). Every method resolves with a real
 * result or rejects with an AppError: no fake success.
 */
import { AppError, toAppError, type AppErrorCode } from '../../core/errors';
import type { Unsubscribe } from '../../core/events';
import { createLogger } from '../../core/logger';
import type { AttachmentRecord, AttachmentStore } from '../data';
import { MAX_ATTACHMENT_BYTES, attachmentCategoryOf, displayFileName, resolveMimeType, safeFileName } from './fileTypes';

const log = createLogger('attachments');

/** Where a new attachment comes from. */
export type AttachmentSource = 'document' | 'image' | 'camera';

/** A file returned by a picker (usually a copy in the cache directory). */
export interface PickedFile {
  uri: string;
  name: string;
  mimeType: string | null;
  size: number | null;
}

export type AttachmentFailureReason = 'unsupported_type' | 'too_large' | 'copy_failed' | 'save_failed';

export interface AttachmentFailure {
  name: string;
  reason: AttachmentFailureReason;
  code: AppErrorCode;
}

export interface AttachmentAddResult {
  /** The user closed the picker without choosing anything. */
  cancelled: boolean;
  added: AttachmentRecord[];
  failures: AttachmentFailure[];
}

/** The native file operations the service needs. */
export interface AttachmentFileSystem {
  /** Copies `file` into the user's attachment directory as `fileName`. */
  copyIn(uid: string, file: PickedFile, fileName: string): Promise<{ uri: string; size: number | null }>;
  exists(uri: string): boolean;
  /** Deletes a file inside the app's storage; a missing file is not an error. */
  remove(uri: string): void;
  /** Deletes the user's whole attachment directory (sign-out, account deletion). */
  removeUserDirectory(uid: string): void;
}

export interface AttachmentPickers {
  /** The picked files, or null when the user cancelled. Rejects with AppError('permission_denied') for a refused camera. */
  pick(source: AttachmentSource, options: { multiple: boolean }): Promise<PickedFile[] | null>;
}

export interface AttachmentOpener {
  /** Hands the file to another app (Android "open with", iOS share sheet with preview). */
  open(record: AttachmentRecord): Promise<void>;
}

export interface AttachmentServiceDeps {
  store: AttachmentStore;
  getUid(): string | null;
  files: AttachmentFileSystem;
  pickers: AttachmentPickers;
  opener: AttachmentOpener;
  newId(): string;
  now?(): Date;
}

export interface AttachmentService {
  /** Opens a picker and stores what the user chose (linked to `meetingId` when given). */
  add(source: AttachmentSource, options?: { meetingId?: string | null; multiple?: boolean }): Promise<AttachmentAddResult>;
  /** Stores already picked files; per-file problems are reported in `failures`. */
  importFiles(files: readonly PickedFile[], options?: { meetingId?: string | null }): Promise<AttachmentAddResult>;
  /** The meeting's attachments, oldest first. */
  listForMeeting(meetingId: string): Promise<AttachmentRecord[]>;
  linkToMeeting(id: string, meetingId: string): Promise<AttachmentRecord>;
  /** Deletes the file and its metadata. Rejects with AppError('not_found') for an unknown id. */
  remove(id: string): Promise<void>;
  /** Deletes every attachment of a meeting (the meeting was deleted). Returns how many. */
  removeForMeeting(meetingId: string): Promise<number>;
  /**
   * Deletes attachments that were never linked to a meeting (picked in a form that was then
   * abandoned) and are older than `olderThanMs` (default 24 h). Returns how many.
   */
  pruneUnlinked(options?: { olderThanMs?: number }): Promise<number>;
  /** Opens the file with another app. Rejects with AppError('not_found') when the file is gone. */
  open(record: AttachmentRecord): Promise<void>;
  /** Called after every change (add, link, remove), so open screens can re-read. */
  subscribe(listener: () => void): Unsubscribe;
  /** The session ended: the data layer wiped the metadata, delete the files too. */
  handleSessionEnded(uid: string): void;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function failure(name: string, reason: AttachmentFailureReason, code: AppErrorCode): AttachmentFailure {
  return { name, reason, code };
}

export function createAttachmentService(deps: AttachmentServiceDeps): AttachmentService {
  const listeners = new Set<() => void>();
  const now = (): Date => deps.now?.() ?? new Date();

  function notify(): void {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        log.warn('an attachment listener failed', toAppError(error).code);
      }
    }
  }

  function requireUid(): string {
    const uid = deps.getUid();
    if (!uid) throw new AppError('unauthenticated', 'Attachments need a signed-in user');
    return uid;
  }

  /** Deletes the file of a record; files outside the app storage are left alone by the adapter. */
  function deleteFile(record: AttachmentRecord): void {
    try {
      deps.files.remove(record.uri);
    } catch (error) {
      throw toAppError(error);
    }
  }

  async function importOne(uid: string, file: PickedFile, meetingId: string | null): Promise<AttachmentRecord | AttachmentFailure> {
    const name = displayFileName(file.name, 'file');
    const mimeType = resolveMimeType(file.mimeType, name);
    const category = attachmentCategoryOf(mimeType);
    if (!category || !mimeType) return failure(name, 'unsupported_type', 'unsupported');
    if (typeof file.size === 'number' && file.size > MAX_ATTACHMENT_BYTES) return failure(name, 'too_large', 'invalid_input');

    const id = deps.newId();
    let copied: { uri: string; size: number | null };
    try {
      copied = await deps.files.copyIn(uid, file, `${id}_${safeFileName(name)}`);
    } catch (error) {
      log.warn('could not copy an attachment', toAppError(error).code);
      return failure(name, 'copy_failed', 'unknown');
    }
    const size = copied.size ?? file.size;
    if (typeof size === 'number' && size > MAX_ATTACHMENT_BYTES) {
      safeRemove(copied.uri);
      return failure(name, 'too_large', 'invalid_input');
    }
    try {
      return await deps.store.put({
        id,
        name,
        category,
        mimeType,
        size: typeof size === 'number' && size >= 0 ? size : null,
        uri: copied.uri,
        meetingId,
        createdAt: now().toISOString(),
        localOnly: true,
      });
    } catch (error) {
      const appError = toAppError(error);
      log.warn('could not save attachment metadata', appError.code);
      safeRemove(copied.uri);
      return failure(name, 'save_failed', appError.code);
    }
  }

  function safeRemove(uri: string): void {
    try {
      deps.files.remove(uri);
    } catch (error) {
      log.warn('could not clean up an attachment copy', toAppError(error).code);
    }
  }

  const service: AttachmentService = {
    async add(source, options = {}) {
      requireUid();
      let picked: PickedFile[] | null;
      try {
        picked = await deps.pickers.pick(source, { multiple: source !== 'camera' && options.multiple === true });
      } catch (error) {
        throw toAppError(error);
      }
      if (picked === null) return { cancelled: true, added: [], failures: [] };
      return service.importFiles(picked, { meetingId: options.meetingId ?? null });
    },

    async importFiles(files, options = {}) {
      const uid = requireUid();
      const added: AttachmentRecord[] = [];
      const failures: AttachmentFailure[] = [];
      for (const file of files) {
        const result = await importOne(uid, file, options.meetingId ?? null);
        if ('reason' in result) failures.push(result);
        else added.push(result);
      }
      if (added.length > 0) notify();
      return { cancelled: false, added, failures };
    },

    async listForMeeting(meetingId) {
      requireUid();
      const items = await deps.store.forMeeting(meetingId);
      return [...items].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
    },

    async linkToMeeting(id, meetingId) {
      requireUid();
      const record = await deps.store.attachToMeeting(id, meetingId);
      notify();
      return record;
    },

    async remove(id) {
      requireUid();
      const record = await deps.store.get(id);
      if (!record) throw new AppError('not_found', 'Attachment not found');
      deleteFile(record);
      await deps.store.remove(id);
      notify();
    },

    async removeForMeeting(meetingId) {
      requireUid();
      const records = await deps.store.forMeeting(meetingId);
      let removed = 0;
      for (const record of records) {
        try {
          deleteFile(record);
          await deps.store.remove(record.id);
          removed += 1;
        } catch (error) {
          log.warn('could not remove an attachment of a deleted meeting', toAppError(error).code);
        }
      }
      if (removed > 0) notify();
      return removed;
    },

    async pruneUnlinked(options = {}) {
      requireUid();
      const cutoff = now().getTime() - (options.olderThanMs ?? DAY_MS);
      const stale = (await deps.store.list()).filter((record) => {
        if (record.meetingId !== null) return false;
        const created = Date.parse(record.createdAt);
        return !Number.isFinite(created) || created < cutoff;
      });
      let removed = 0;
      for (const record of stale) {
        try {
          deleteFile(record);
          await deps.store.remove(record.id);
          removed += 1;
        } catch (error) {
          log.warn('could not prune an unlinked attachment', toAppError(error).code);
        }
      }
      if (removed > 0) notify();
      return removed;
    },

    async open(record) {
      if (!deps.files.exists(record.uri)) throw new AppError('not_found', 'Attachment file is missing');
      try {
        await deps.opener.open(record);
      } catch (error) {
        throw toAppError(error);
      }
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    handleSessionEnded(uid) {
      try {
        deps.files.removeUserDirectory(uid);
      } catch (error) {
        log.warn('could not delete local attachments', toAppError(error).code);
      }
      notify();
    },
  };
  return service;
}
