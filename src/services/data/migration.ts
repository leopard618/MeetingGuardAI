/**
 * v1.0.9 / pre-rebuild local data migration: planning (pure) + legacy key cleanup.
 *
 * The v1.0.9 app kept everything in AsyncStorage "meetingguard_data"
 * ({ meetings[], notes[], userPreferences[], apiKeys[], users[] }), and HEAD 3308b9d still wrote
 * there whenever a Firestore write failed (report #8/#21). Records carry `created_by` (email).
 *
 * - Only records of the signed-in account are migrated: `created_by` equal to the account email,
 *   empty, or one of the placeholder owners the old app used when no user was known. Records of
 *   other accounts stay in the legacy blob for when that account signs in on this device.
 * - Ids are "legacy_<oldId>" and every write uses outbox mode "create", so re-running never
 *   duplicates or overwrites.
 * - `apiKeys` (fake keys) and `users` (a local user table with plaintext passwords) are dropped.
 * The engine executes the plan (engine.ts `migrateLegacyLocalData`).
 */
import { AppError, type AppErrorCode } from '../../core/errors';
import { LEGACY_DATA_KEY, LEGACY_STORAGE_KEYS, LEGACY_STORAGE_PREFIXES } from '../../core/identifiers';
import { fromLegacyPreferencesPatch } from '../../core/legacy';
import { buildNote, NOTE_CATEGORIES, type Language, type Meeting, type Note, type NoteCategory, type PreferencesPatch } from '../../core/types';
import type { KeyValueStorage } from './cache';
import { legacyRecordId } from './ids';
import { convertLegacyMeeting } from './mapping';
import { firstValidIso } from './util';

/** Owners the old app wrote when it had no real user (localStorage.js / ModernCreateMeeting). */
const PLACEHOLDER_OWNERS = new Set(['user@example.com', 'unknown@example.com']);

export interface LegacyMigrationInput {
  blob: unknown;
  uid: string;
  email: string | null;
  timeZone: string;
  language: Language;
  now: Date;
  existingMeetingIds: ReadonlySet<string>;
  existingNoteIds: ReadonlySet<string>;
}

export interface LegacyMigrationPlan {
  meetings: Meeting[];
  notes: Note[];
  preferencesPatch: PreferencesPatch | null;
  /** Blob to keep for other accounts (null = delete the legacy key). */
  remainingBlob: Record<string, unknown> | null;
  /** Records not migrated: already migrated, invalid, or without an id. */
  skipped: number;
  errors: AppErrorCode[];
  /** Old meeting id -> new meeting id (attachment relinking). */
  meetingIdMap: Record<string, string>;
}

type LegacyRecord = Record<string, unknown>;

function records(value: unknown): LegacyRecord[] {
  return Array.isArray(value) ? value.filter((item): item is LegacyRecord => typeof item === 'object' && item !== null) : [];
}

function ownerOf(record: LegacyRecord): string {
  return typeof record.created_by === 'string' ? record.created_by.trim().toLowerCase() : '';
}

function belongsTo(record: LegacyRecord, email: string | null): boolean {
  const owner = ownerOf(record);
  if (owner === '' || PLACEHOLDER_OWNERS.has(owner)) return true;
  return email !== null && owner === email.trim().toLowerCase();
}

function addError(errors: AppErrorCode[], code: AppErrorCode): void {
  if (!errors.includes(code)) errors.push(code);
}

function legacyNote(record: LegacyRecord, id: string, uid: string, now: Date): Note {
  const content = typeof record.content === 'string' ? record.content.slice(0, 20_000) : '';
  const explicitTitle = typeof record.title === 'string' ? record.title.trim() : '';
  const title = (explicitTitle || content.split(/\r?\n/)[0]?.trim() || '').slice(0, 200);
  if (!title) throw new AppError('invalid_input', 'Legacy note without title');
  const category: NoteCategory = (NOTE_CATEGORIES as readonly string[]).includes(record.category as string)
    ? (record.category as NoteCategory)
    : 'general';
  const built = buildNote({ title, content, category, pinned: record.pinned === true }, { id, userId: uid, now });
  const createdAt = firstValidIso(record.created_date, record.createdAt) ?? built.createdAt;
  const updatedAt = firstValidIso(record.updated_date, record.updatedAt) ?? createdAt;
  return { ...built, createdAt, updatedAt };
}

export function planLegacyMigration(input: LegacyMigrationInput): LegacyMigrationPlan {
  const plan: LegacyMigrationPlan = {
    meetings: [],
    notes: [],
    preferencesPatch: null,
    remainingBlob: null,
    skipped: 0,
    errors: [],
    meetingIdMap: {},
  };
  if (typeof input.blob !== 'object' || input.blob === null || Array.isArray(input.blob)) {
    addError(plan.errors, 'invalid_input');
    return plan;
  }
  const blob = input.blob as LegacyRecord;
  const foreignMeetings: LegacyRecord[] = [];
  const foreignNotes: LegacyRecord[] = [];
  const foreignPreferences: LegacyRecord[] = [];
  const ctx = { uid: input.uid, timeZone: input.timeZone, language: input.language };

  for (const record of records(blob.meetings)) {
    if (!belongsTo(record, input.email)) {
      foreignMeetings.push(record);
      continue;
    }
    const id = legacyRecordId(record.id);
    if (id === null) {
      plan.skipped += 1;
      continue;
    }
    const oldId = String(record.id).trim();
    if (input.existingMeetingIds.has(id)) {
      plan.meetingIdMap[oldId] = id;
      plan.skipped += 1;
      continue;
    }
    try {
      plan.meetings.push(convertLegacyMeeting(id, record, ctx));
      plan.meetingIdMap[oldId] = id;
    } catch (error) {
      plan.skipped += 1;
      addError(plan.errors, error instanceof AppError ? error.code : 'invalid_input');
    }
  }

  for (const record of records(blob.notes)) {
    if (!belongsTo(record, input.email)) {
      foreignNotes.push(record);
      continue;
    }
    const id = legacyRecordId(record.id);
    if (id === null || input.existingNoteIds.has(id)) {
      plan.skipped += 1;
      continue;
    }
    try {
      plan.notes.push(legacyNote(record, id, input.uid, input.now));
    } catch (error) {
      plan.skipped += 1;
      addError(plan.errors, error instanceof AppError ? error.code : 'invalid_input');
    }
  }

  const ownPreferences: LegacyRecord[] = [];
  for (const record of records(blob.userPreferences)) {
    if (belongsTo(record, input.email)) ownPreferences.push(record);
    else foreignPreferences.push(record);
  }
  // The old Dashboard preferred the record that has an alert intensity.
  const chosen = ownPreferences.find((record) => typeof record.alert_intensity === 'string') ?? ownPreferences[0];
  if (chosen) {
    const patch = fromLegacyPreferencesPatch(chosen);
    plan.preferencesPatch = Object.keys(patch).length > 0 ? patch : null;
  }

  if (foreignMeetings.length > 0 || foreignNotes.length > 0 || foreignPreferences.length > 0) {
    plan.remainingBlob = {
      meetings: foreignMeetings,
      notes: foreignNotes,
      userPreferences: foreignPreferences,
      apiKeys: [],
      users: [],
    };
  }
  return plan;
}

/** Removes legacy token/identity/alert keys (never the legacy data blob). Returns how many existed. */
export async function removeLegacyKeys(storage: Pick<KeyValueStorage, 'getAllKeys' | 'multiRemove'>): Promise<number> {
  const names = new Set<string>(LEGACY_STORAGE_KEYS);
  names.delete(LEGACY_DATA_KEY);
  const keys = (await storage.getAllKeys()).filter(
    (key) => names.has(key) || LEGACY_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix)),
  );
  if (keys.length > 0) await storage.multiRemove(keys);
  return keys.length;
}
