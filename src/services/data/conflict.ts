/**
 * Conflict rules (pure; unit-tested).
 *
 * Meetings and notes: document-level last-writer-wins on `updatedAt`.
 *   - Outbox send ("set"/"delete"): skipped when the server copy is strictly newer.
 *   - Snapshot merge: a remote version replaces the local one when its updatedAt is >= the local
 *     one (so a pending local edit that is newer survives until its own send settles).
 * Preferences: field-level merge. A pending patch is applied over the current server document,
 *   so offline changes to different fields on two devices are both kept.
 * Profile: identity fields only; createdAt is written once.
 */
import { AppError } from '../../core/errors';
import {
  mergePreferences,
  normalizeAlertTimes,
  parseMeetingDoc,
  parseNoteDoc,
  parseTaskDoc,
  preferencesPatchSchema,
  SERVER_OWNED_PROFILE_KEYS,
  type Preferences,
} from '../../core/types';
import type { OutboxEntry } from './outbox';
import { pickProfileWritable, PROFILE_WRITABLE_KEYS, readRemoteProfile } from './mapping';
import type { CommitDecision, RemoteData } from './remote';
import { isoMs, maxIso } from './util';

function write(data: RemoteData): CommitDecision {
  return { type: 'write', data };
}

function requireData(entry: OutboxEntry): RemoteData {
  if (!entry.data) throw new AppError('invalid_input', `Outbox ${entry.kind} ${entry.mode} without data`);
  return entry.data;
}

function isServerNewer(current: RemoteData, entry: OutboxEntry): boolean {
  const serverMs = isoMs(current.updatedAt);
  const entryMs = isoMs(entry.updatedAt);
  return serverMs !== null && entryMs !== null && serverMs > entryMs;
}

function isCurrentShape(entry: OutboxEntry, current: RemoteData): boolean {
  if (entry.kind === 'meeting') return parseMeetingDoc(entry.docId, current) !== null;
  if (entry.kind === 'task') return parseTaskDoc(entry.docId, current) !== null;
  return parseNoteDoc(entry.docId, current) !== null;
}

const REPLACE_LEGACY: CommitDecision = { type: 'delete', followUp: 'create' };

function decideDocument(entry: OutboxEntry, current: RemoteData | null): CommitDecision {
  switch (entry.mode) {
    case 'create':
      return current ? { type: 'skip', reason: 'exists' } : write(requireData(entry));
    case 'migrate':
      if (!current) return write(requireData(entry));
      return isCurrentShape(entry, current) ? { type: 'skip', reason: 'already_migrated' } : REPLACE_LEGACY;
    case 'set':
      if (!current) return write(requireData(entry));
      if (!isCurrentShape(entry, current)) return REPLACE_LEGACY;
      return isServerNewer(current, entry) ? { type: 'skip', reason: 'stale' } : write(requireData(entry));
    case 'delete':
      if (!current) return { type: 'skip', reason: 'absent' };
      return isServerNewer(current, entry) ? { type: 'skip', reason: 'stale' } : { type: 'delete' };
    default:
      throw new AppError('invalid_input', `Unsupported outbox mode ${entry.mode} for ${entry.kind}`);
  }
}

function decidePreferences(entry: OutboxEntry, current: RemoteData | null, defaults: Preferences): CommitDecision {
  if (entry.mode === 'create') {
    return current ? { type: 'skip', reason: 'exists' } : write(requireData(entry));
  }
  if (entry.mode !== 'merge') {
    throw new AppError('invalid_input', `Unsupported outbox mode ${entry.mode} for preferences`);
  }
  const patch = preferencesPatchSchema.safeParse(requireData(entry));
  if (!patch.success) throw new AppError('invalid_input', 'Invalid preferences patch in outbox', { cause: patch.error });
  const base = current ? mergePreferences(current, defaults) : { ...defaults };
  const merged: Preferences = { ...base, ...patch.data, updatedAt: maxIso(base.updatedAt, entry.updatedAt) };
  merged.defaultAlertTimes = normalizeAlertTimes(merged.defaultAlertTimes);
  return write(merged as unknown as RemoteData);
}

function decideProfile(entry: OutboxEntry, current: RemoteData | null): CommitDecision {
  if (entry.mode !== 'merge') {
    throw new AppError('invalid_input', `Unsupported outbox mode ${entry.mode} for profile`);
  }
  const patch = pickProfileWritable(requireData(entry));
  for (const key of SERVER_OWNED_PROFILE_KEYS) delete patch[key];
  if (!current) {
    return write({
      uid: entry.docId,
      email: null,
      displayName: null,
      photoURL: null,
      lastLoginAt: null,
      legacyMigratedAt: null,
      updatedAt: entry.updatedAt,
      ...patch,
      createdAt: typeof patch.createdAt === 'string' ? patch.createdAt : entry.updatedAt,
    });
  }
  const legacyShape = Object.keys(current).some((key) => !(PROFILE_WRITABLE_KEYS as readonly string[]).includes(key));
  if (legacyShape) {
    // Pre-rebuild profile (name/picture/plan/preferences, Timestamps): the rules only accept
    // current-shape profiles, so rewrite it with the allowed keys. The client-written legacy plan
    // is dropped on purpose (plans live in the server-owned entitlements/{uid}).
    const converted = readRemoteProfile(entry.docId, current);
    const { createdAt: proposedCreatedAt, legacyMigratedAt: proposedMigratedAt, ...identity } = patch;
    return write({
      uid: entry.docId,
      email: converted?.email ?? null,
      displayName: converted?.displayName ?? null,
      photoURL: converted?.photoURL ?? null,
      lastLoginAt: converted?.lastLoginAt ?? null,
      updatedAt: entry.updatedAt,
      ...identity,
      createdAt: converted?.createdAt ?? (typeof proposedCreatedAt === 'string' ? proposedCreatedAt : entry.updatedAt),
      legacyMigratedAt: converted?.legacyMigratedAt ?? (typeof proposedMigratedAt === 'string' ? proposedMigratedAt : null),
    });
  }
  const data: RemoteData = { ...patch };
  if (isoMs(current.createdAt) !== null) delete data.createdAt;
  else if (typeof data.createdAt !== 'string') data.createdAt = entry.updatedAt;
  if (isoMs(current.legacyMigratedAt) !== null) delete data.legacyMigratedAt;
  return { type: 'merge', data };
}

/** The decision taken inside the send transaction for one outbox entry. */
export function decideCommit(entry: OutboxEntry, current: RemoteData | null, ctx: { defaults: Preferences }): CommitDecision {
  switch (entry.kind) {
    case 'meeting':
    case 'note':
    case 'task':
      return decideDocument(entry, current);
    case 'preferences':
      return decidePreferences(entry, current, ctx.defaults);
    case 'profile':
      return decideProfile(entry, current);
    default:
      throw new AppError('invalid_input', 'Unknown outbox kind');
  }
}

/** Snapshot merge rule for meetings/notes: accept the remote version when it is not older. */
export function shouldAcceptRemote(local: { updatedAt: string } | undefined, incoming: { updatedAt: string }): boolean {
  if (!local) return true;
  const localMs = isoMs(local.updatedAt);
  const incomingMs = isoMs(incoming.updatedAt);
  if (localMs === null || incomingMs === null) return true;
  return incomingMs >= localMs;
}
