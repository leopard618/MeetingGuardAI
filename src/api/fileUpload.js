/**
 * Meeting attachments (compat module used by ModernCreateMeeting; stage 3 moves it to TS).
 *
 * Attachments stay ON THIS DEVICE: files are copied into the app's document directory
 * (Paths.document/attachments/{uid}/) with the expo-file-system SDK 57 object API, and their
 * metadata lives in the user's local data (src/services/data attachmentStore). Every record is
 * labeled `localOnly: true`; nothing is uploaded or synced, and meetings in Firestore never contain
 * device paths. Signing out deletes the user's attachment files together with the local data.
 *
 * Every method either resolves with a real result or rejects with an AppError (never a fake
 * success, never a crash from removed legacy APIs).
 */
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';

import { AppError, toAppError } from '../core/errors';
import { appEvents } from '../core/events';
import { createLogger } from '../core/logger';
import { t } from '../i18n';
import { attachmentStore, dataService } from '../services/data';

const log = createLogger('attachments');

const MAX_FILE_SIZE_MB = 50;
const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024;
const ATTACHMENTS_DIR = 'attachments';

const SUPPORTED_TYPES = {
  documents: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
  ],
  images: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/heic', 'image/heif'],
  videos: ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/avi', 'video/mov'],
  audio: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/aac', 'audio/mp4'],
  archives: ['application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed', 'application/x-tar', 'application/gzip'],
};

const TYPE_ICONS = { documents: '📄', images: '🖼️', videos: '🎥', audio: '🎵', archives: '📦' };

function userDirectory(uid) {
  return new Directory(Paths.document, ATTACHMENTS_DIR, uid);
}

function safeFileName(name) {
  const cleaned = String(name || 'file').replace(/[^A-Za-z0-9._-]/g, '_');
  return cleaned.slice(-120) || 'file';
}

function generateFileId() {
  return `file_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function requireUid() {
  const uid = dataService.getActiveUid();
  if (!uid) throw new AppError('unauthenticated', 'Attachments need a signed-in user');
  return uid;
}

function cancelledResult() {
  return { success: false, cancelled: true, files: [], errors: [], message: t('data:attachments.pickCancelled') };
}

/** The shape ModernCreateMeeting renders (`type` is the MIME type, used for its icon). */
function toLegacyFile(record) {
  return {
    ...record,
    type: record.mimeType,
    uploadedAt: record.createdAt,
    thumbnail: record.category === 'images' ? record.uri : null,
    localOnly: true,
    localOnlyLabel: t('data:attachments.localOnly'),
  };
}

// Signing out wipes the user's local data (including attachment metadata): delete the files too.
appEvents.on('session:ended', ({ uid }) => {
  try {
    const directory = userDirectory(uid);
    if (directory.exists) directory.delete();
  } catch (error) {
    log.warn(`could not delete local attachments (${toAppError(error).code})`);
  }
});

class FileUploadService {
  constructor() {
    this.supportedTypes = SUPPORTED_TYPES;
    this.maxFileSize = MAX_FILE_SIZE;
  }

  /** Picks documents. Resolves { success, cancelled?, files, errors, message }. */
  async pickDocument(options = {}) {
    let result;
    try {
      result = await DocumentPicker.getDocumentAsync({
        type: options.type || '*/*',
        copyToCacheDirectory: true,
        multiple: options.multiple === true,
      });
    } catch (error) {
      throw toAppError(error);
    }
    if (result.canceled) return cancelledResult();
    return this.processFiles(
      result.assets.map((asset) => ({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? null, size: asset.size ?? null })),
    );
  }

  /** Picks images with the system photo picker (no media-library permission needed). */
  async pickImages(options = {}) {
    let result;
    try {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: options.multiple === true,
        quality: typeof options.quality === 'number' ? options.quality : 0.8,
      });
    } catch (error) {
      throw toAppError(error);
    }
    if (result.canceled) return cancelledResult();
    return this.processImageFiles(result.assets);
  }

  /** Takes a photo. Rejects with AppError('permission_denied') when camera access is refused. */
  async takePhoto(options = {}) {
    let permission;
    try {
      permission = await ImagePicker.requestCameraPermissionsAsync();
    } catch (error) {
      throw toAppError(error);
    }
    if (permission.status !== 'granted') {
      throw new AppError('permission_denied', t('data:attachments.cameraPermissionDenied'));
    }
    let result;
    try {
      result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: typeof options.quality === 'number' ? options.quality : 0.8,
      });
    } catch (error) {
      throw toAppError(error);
    }
    if (result.canceled) return cancelledResult();
    return this.processImageFiles(result.assets);
  }

  processImageFiles(assets) {
    return this.processFiles(
      assets.map((asset) => ({
        uri: asset.uri,
        name: asset.fileName || `image_${Date.now()}.jpg`,
        mimeType: asset.mimeType || 'image/jpeg',
        size: typeof asset.fileSize === 'number' ? asset.fileSize : null,
      })),
    );
  }

  /** Copies each file; per-file failures are reported in `errors` (code + message). */
  async processFiles(files) {
    const processed = [];
    const errors = [];
    for (const file of files) {
      try {
        processed.push(await this.processFile(file));
      } catch (error) {
        const appError = toAppError(error);
        errors.push({ file: file.name, code: appError.code, error: appError.message });
      }
    }
    const parts = [];
    if (processed.length > 0) parts.push(t('data:attachments.added', { count: processed.length }));
    if (errors.length > 0) parts.push(t('data:attachments.failed', { count: errors.length }));
    return { success: processed.length > 0, files: processed, errors, message: parts.join('. ') };
  }

  /** Copies one picked file into the user's attachment directory and records its metadata. */
  async processFile(file) {
    const mimeType = file.mimeType || file.type || null;
    const category = this.getFileType(mimeType);
    if (!category) throw new AppError('unsupported', t('data:attachments.unsupportedType'));
    if (typeof file.size === 'number' && file.size > MAX_FILE_SIZE) {
      throw new AppError('invalid_input', t('data:attachments.tooLarge', { maxMb: MAX_FILE_SIZE_MB }));
    }
    const uid = requireUid();
    const id = generateFileId();
    let destination;
    try {
      const directory = userDirectory(uid);
      directory.create({ intermediates: true, idempotent: true });
      destination = new File(directory, `${id}_${safeFileName(file.name)}`);
      await new File(file.uri).copy(destination);
    } catch (error) {
      throw new AppError('unknown', t('data:attachments.copyFailed'), { cause: error });
    }
    let size = typeof file.size === 'number' ? file.size : null;
    if (size === null) {
      try {
        size = destination.exists ? destination.size : null;
      } catch {
        size = null;
      }
    }
    const record = await attachmentStore.put({
      id,
      name: String(file.name || 'file').slice(0, 500),
      category,
      mimeType,
      size,
      uri: destination.uri,
      meetingId: null,
      createdAt: new Date().toISOString(),
      localOnly: true,
    });
    return toLegacyFile(record);
  }

  async attachFileToMeeting(fileId, meetingId) {
    const record = await attachmentStore.attachToMeeting(fileId, meetingId);
    return { success: true, file: toLegacyFile(record) };
  }

  async getMeetingFiles(meetingId) {
    return (await attachmentStore.forMeeting(meetingId)).map(toLegacyFile);
  }

  async getFileMetadata(fileId) {
    const record = await attachmentStore.get(fileId);
    return record ? toLegacyFile(record) : null;
  }

  /** Deletes the file and its metadata. Rejects with AppError('not_found') for unknown ids. */
  async deleteFile(fileId) {
    const record = await attachmentStore.get(fileId);
    if (!record) throw new AppError('not_found', 'Attachment not found');
    try {
      const file = new File(record.uri);
      if (file.exists) file.delete();
    } catch (error) {
      throw toAppError(error);
    }
    await attachmentStore.remove(fileId);
    return { success: true };
  }

  getSupportedTypes() {
    return this.supportedTypes;
  }

  getFileTypeNames() {
    return {
      documents: t('data:attachments.typeNames.documents'),
      images: t('data:attachments.typeNames.images'),
      videos: t('data:attachments.typeNames.videos'),
      audio: t('data:attachments.typeNames.audio'),
      archives: t('data:attachments.typeNames.archives'),
    };
  }

  /** Category ("documents" | "images" | ...) of a MIME type, or null when unsupported. */
  getFileType(mimeType) {
    if (!mimeType) return null;
    const normalized = String(mimeType).toLowerCase();
    for (const [category, types] of Object.entries(SUPPORTED_TYPES)) {
      if (types.includes(normalized)) return category;
    }
    return null;
  }

  getFileTypeIcon(fileType) {
    return TYPE_ICONS[fileType] || '📎';
  }
}

export default new FileUploadService();
