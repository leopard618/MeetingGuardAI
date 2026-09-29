/**
 * Device-local attachment metadata (mg:{uid}:attachments).
 *
 * Attachments are NOT uploaded: the file stays in the app's document directory on this device and
 * every record says so (`localOnly: true`), so no screen can present a device path as if it were
 * available on other devices. Meetings in Firestore never contain attachment URIs.
 * The file copy itself is done by src/api/fileUpload.js; this module only stores metadata.
 */
import { z } from 'zod';

import { AppError, toAppError } from '../../core/errors';
import { createLogger } from '../../core/logger';
import { cacheKeys, type KeyValueStorage } from './cache';
import { Mutex } from './util';

const log = createLogger('data.attachments');

export const ATTACHMENT_CATEGORIES = ['documents', 'images', 'videos', 'audio', 'archives'] as const;
export type AttachmentCategory = (typeof ATTACHMENT_CATEGORIES)[number];

export interface AttachmentRecord {
  id: string;
  name: string;
  category: AttachmentCategory;
  /** MIME type ("application/octet-stream" when unknown). */
  mimeType: string;
  size: number | null;
  /** file:// URI inside the app's document directory on THIS device. */
  uri: string;
  meetingId: string | null;
  createdAt: string;
  /** Always true: attachments are never uploaded or synced. */
  localOnly: true;
}

const attachmentSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().max(500),
  category: z.enum(ATTACHMENT_CATEGORIES),
  mimeType: z.string().min(1).max(200),
  size: z.number().nonnegative().nullable(),
  uri: z.string().min(1),
  meetingId: z.string().min(1).nullable(),
  createdAt: z.string().min(1),
  localOnly: z.literal(true),
});

type AttachmentMap = Record<string, AttachmentRecord>;

export interface AttachmentStore {
  list(): Promise<AttachmentRecord[]>;
  get(id: string): Promise<AttachmentRecord | null>;
  put(record: AttachmentRecord): Promise<AttachmentRecord>;
  attachToMeeting(id: string, meetingId: string): Promise<AttachmentRecord>;
  forMeeting(meetingId: string): Promise<AttachmentRecord[]>;
  remove(id: string): Promise<AttachmentRecord | null>;
}

function parseMap(raw: string | null): AttachmentMap {
  if (raw === null) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new AppError('unknown', 'Attachment metadata is unreadable', { cause: error });
  }
  const items = (value as { items?: unknown } | null)?.items;
  const out: AttachmentMap = {};
  if (typeof items !== 'object' || items === null) return out;
  for (const [id, item] of Object.entries(items as Record<string, unknown>)) {
    const parsed = attachmentSchema.safeParse(item);
    if (parsed.success) out[id] = parsed.data as AttachmentRecord;
    else log.warn('dropping an invalid attachment record');
  }
  return out;
}

export function createAttachmentStore(storage: KeyValueStorage, getUid: () => string | null): AttachmentStore {
  const mutex = new Mutex();

  function requireUid(): string {
    const uid = getUid();
    if (!uid) throw new AppError('unauthenticated', 'Attachments need a signed-in user');
    return uid;
  }

  async function read(uid: string): Promise<AttachmentMap> {
    try {
      return parseMap(await storage.getItem(cacheKeys.attachments(uid)));
    } catch (error) {
      throw toAppError(error);
    }
  }

  async function write(uid: string, map: AttachmentMap): Promise<void> {
    try {
      await storage.setItem(cacheKeys.attachments(uid), JSON.stringify({ v: 1, items: map }));
    } catch (error) {
      throw toAppError(error);
    }
  }

  function mutate<T>(fn: (map: AttachmentMap) => { map: AttachmentMap; result: T }): Promise<T> {
    const uid = requireUid();
    return mutex.run(async () => {
      const { map, result } = fn(await read(uid));
      await write(uid, map);
      return result;
    });
  }

  return {
    async list() {
      const map = await read(requireUid());
      return Object.values(map).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    },
    async get(id) {
      return (await read(requireUid()))[id] ?? null;
    },
    async put(record) {
      const parsed = attachmentSchema.safeParse(record);
      if (!parsed.success) throw new AppError('invalid_input', 'Invalid attachment record', { cause: parsed.error });
      const checked = parsed.data as AttachmentRecord;
      return mutate((map) => ({ map: { ...map, [checked.id]: checked }, result: checked }));
    },
    async attachToMeeting(id, meetingId) {
      return mutate((map) => {
        const current = map[id];
        if (!current) throw new AppError('not_found', 'Attachment not found');
        const next: AttachmentRecord = { ...current, meetingId };
        return { map: { ...map, [id]: next }, result: next };
      });
    },
    async forMeeting(meetingId) {
      const map = await read(requireUid());
      return Object.values(map).filter((item) => item.meetingId === meetingId);
    },
    async remove(id) {
      return mutate((map) => {
        const current = map[id] ?? null;
        const { [id]: _removed, ...rest } = map;
        return { map: rest, result: current };
      });
    },
  };
}

const LEGACY_FILE_KEY_PREFIX = 'file_';

function legacyCategory(value: unknown, mimeType: string): AttachmentCategory {
  if (typeof value === 'string' && (ATTACHMENT_CATEGORIES as readonly string[]).includes(value)) return value as AttachmentCategory;
  if (mimeType.startsWith('image/')) return 'images';
  if (mimeType.startsWith('video/')) return 'videos';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'documents';
}

/**
 * Moves v1.0.9/HEAD attachment metadata (global AsyncStorage keys "file_<id>") into the user's
 * store, relinking meeting ids through `resolveMeetingId` (old id -> new id, or null when the
 * meeting is not this user's). Records of other users' meetings are left untouched.
 * Returns the number of legacy keys removed.
 */
export async function relinkLegacyAttachments(
  storage: KeyValueStorage,
  uid: string,
  resolveMeetingId: (oldId: string) => string | null,
): Promise<number> {
  const keys = (await storage.getAllKeys()).filter((key) => key.startsWith(LEGACY_FILE_KEY_PREFIX));
  if (keys.length === 0) return 0;
  const pairs = await storage.multiGet(keys);
  const moved: AttachmentRecord[] = [];
  const consumedKeys: string[] = [];
  for (const [key, raw] of pairs) {
    if (raw === null) continue;
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      consumedKeys.push(key);
      continue;
    }
    const oldMeetingId = typeof record.meetingId === 'string' && record.meetingId.length > 0 ? record.meetingId : null;
    const meetingId = oldMeetingId === null ? null : resolveMeetingId(oldMeetingId);
    if (oldMeetingId !== null && meetingId === null) continue; // not this user's meeting
    const mimeType = typeof record.mimeType === 'string' && record.mimeType ? record.mimeType : 'application/octet-stream';
    const candidate = {
      id: typeof record.id === 'string' && record.id ? record.id : key.slice(LEGACY_FILE_KEY_PREFIX.length),
      name: typeof record.name === 'string' ? record.name.slice(0, 500) : 'file',
      category: legacyCategory(record.type, mimeType),
      mimeType,
      size: typeof record.size === 'number' && record.size >= 0 ? record.size : null,
      uri: typeof record.uri === 'string' ? record.uri : '',
      meetingId,
      createdAt: typeof record.uploadedAt === 'string' ? record.uploadedAt : new Date(0).toISOString(),
      localOnly: true as const,
    };
    const parsed = attachmentSchema.safeParse(candidate);
    consumedKeys.push(key);
    if (parsed.success) moved.push(parsed.data as AttachmentRecord);
  }
  if (moved.length > 0) {
    const current = parseMap(await storage.getItem(cacheKeys.attachments(uid)));
    for (const item of moved) current[item.id] = item;
    await storage.setItem(cacheKeys.attachments(uid), JSON.stringify({ v: 1, items: current }));
  }
  if (consumedKeys.length > 0) await storage.multiRemove(consumedKeys);
  return consumedKeys.length;
}
