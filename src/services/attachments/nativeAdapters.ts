/**
 * Native pieces of the attachment service (SDK 57 APIs):
 * - files: the expo-file-system object API (File / Directory / Paths; the root legacy functions
 *   throw since SDK 54), under Paths.document/attachments/{uid}/;
 * - pickers: expo-document-picker (any file, copied to the cache) and expo-image-picker (system
 *   photo picker: no media-library permission; camera after the camera permission);
 * - opener: Android ACTION_VIEW with the file's content:// URI (expo-file-system's FileProvider
 *   covers the files directory) and a read grant; iOS share sheet (Quick Look preview, "Open in").
 */
import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as IntentLauncher from 'expo-intent-launcher';
import { Platform, Share } from 'react-native';

import { AppError } from '../../core/errors';
import type { AttachmentFileSystem, AttachmentOpener, AttachmentPickers, PickedFile } from './attachmentService';

const ATTACHMENTS_DIRECTORY = 'attachments';
const ANDROID_ACTION_VIEW = 'android.intent.action.VIEW';
/** Intent.FLAG_GRANT_READ_URI_PERMISSION */
const FLAG_GRANT_READ_URI_PERMISSION = 1;
const IMAGE_QUALITY = 0.8;

function userDirectory(uid: string): Directory {
  return new Directory(Paths.document, ATTACHMENTS_DIRECTORY, uid);
}

/** Only files inside the app's own storage are ever deleted (metadata is local, but be strict). */
function isAppStorageUri(uri: string): boolean {
  return [Paths.document.uri, Paths.cache.uri].some((root) => root.length > 0 && uri.startsWith(root));
}

/**
 * The file of a stored URI. iOS may move the app container on an update (the absolute path
 * changes), so a missing file is looked up again under the current documents directory.
 */
function resolveFile(uri: string): File {
  const direct = new File(uri);
  if (direct.exists) return direct;
  const marker = `/${ATTACHMENTS_DIRECTORY}/`;
  const index = uri.lastIndexOf(marker);
  if (index < 0) return direct;
  const segments = uri.slice(index + marker.length).split('/').filter((segment) => segment.length > 0);
  if (segments.length === 0) return direct;
  const rebased = new File(Paths.document, ATTACHMENTS_DIRECTORY, ...segments);
  return rebased.exists ? rebased : direct;
}

export const nativeAttachmentFiles: AttachmentFileSystem = {
  async copyIn(uid, file, fileName) {
    const directory = userDirectory(uid);
    directory.create({ intermediates: true, idempotent: true });
    const destination = new File(directory, fileName);
    const source = new File(file.uri);
    // The pickers hand over a private copy in the cache: move it (no second copy of a large
    // file). Anything else (or a failed move) is copied.
    let moved = false;
    if (Paths.cache.uri.length > 0 && file.uri.startsWith(Paths.cache.uri)) {
      try {
        await source.move(destination);
        moved = true;
      } catch {
        moved = false;
      }
    }
    if (!moved) await source.copy(destination);
    let size: number | null = null;
    try {
      size = destination.exists ? destination.size : null;
    } catch {
      size = null;
    }
    return { uri: destination.uri, size };
  },
  exists(uri) {
    try {
      return resolveFile(uri).exists;
    } catch {
      return false;
    }
  },
  remove(uri) {
    const file = resolveFile(uri);
    if (!isAppStorageUri(file.uri)) return;
    if (file.exists) file.delete();
  },
  removeUserDirectory(uid) {
    const directory = userDirectory(uid);
    if (directory.exists) directory.delete();
  },
};

function fromImageAsset(asset: ImagePicker.ImagePickerAsset, index: number): PickedFile {
  const fallbackName = `photo_${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}_${index + 1}.jpg`;
  return {
    uri: asset.uri,
    name: asset.fileName ?? fallbackName,
    mimeType: asset.mimeType ?? 'image/jpeg',
    size: typeof asset.fileSize === 'number' ? asset.fileSize : null,
  };
}

export const nativeAttachmentPickers: AttachmentPickers = {
  async pick(source, { multiple }) {
    if (source === 'document') {
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple });
      if (result.canceled) return null;
      return result.assets.map((asset) => ({
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType ?? null,
        size: typeof asset.size === 'number' ? asset.size : null,
      }));
    }
    if (source === 'image') {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: multiple,
        quality: IMAGE_QUALITY,
      });
      if (result.canceled) return null;
      return result.assets.map(fromImageAsset);
    }
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      throw new AppError('permission_denied', 'Camera permission denied', { details: { permission: 'camera' } });
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: IMAGE_QUALITY });
    if (result.canceled) return null;
    return result.assets.map(fromImageAsset);
  },
};

export const nativeAttachmentOpener: AttachmentOpener = {
  async open(record) {
    const file = resolveFile(record.uri);
    if (Platform.OS === 'android') {
      await IntentLauncher.startActivityAsync(ANDROID_ACTION_VIEW, {
        data: file.contentUri,
        type: record.mimeType,
        flags: FLAG_GRANT_READ_URI_PERMISSION,
      });
      return;
    }
    await Share.share({ url: file.uri, title: record.name });
  },
};

export function newAttachmentId(): string {
  return `att_${Crypto.randomUUID().replace(/-/g, '')}`;
}
