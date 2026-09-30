/**
 * Durable write outbox (pure reducer; persisted as JSON under mg:{uid}:outbox).
 *
 * Every local write is recorded here before the promise returned to the caller resolves, and is
 * sent to Firestore in the background (see engine.ts `flush`). Properties:
 * - Order: entries are processed by ascending `seq`; a retryable failure stops the flush so later
 *   writes never overtake earlier ones.
 * - Coalescing: a new write to a document that still has a pending entry replaces that entry in
 *   place (same position, NEW entry id) with the latest state, so the queue is bounded by the
 *   number of touched documents. Preferences/profile patches are merged field by field.
 * - Idempotency: documents have client-generated ids and every send is a transaction that
 *   compares `updatedAt` (last-writer-wins), so re-sending an entry after a lost ack is harmless.
 * - An in-flight entry that was replaced while its send was running is not removed by the ack
 *   (ack is by entry id), so the newer state is sent next.
 */
import { z } from 'zod';

import { APP_ERROR_CODES, type AppErrorCode } from '../../core/errors';
import type { WriteOrigin } from '../../core/events';

export const OUTBOX_KINDS = ['meeting', 'note', 'preferences', 'profile'] as const;
export type OutboxKind = (typeof OUTBOX_KINDS)[number];

/**
 * create  = write only if the document does not exist yet (fresh creates, calendar imports,
 *           legacy migration). If it exists, the server version is kept and adopted locally.
 * set     = full-document write, last-writer-wins on `updatedAt`.
 * migrate = rewrite a document stored in the pre-rebuild Firestore shape (skipped when another
 *           device already migrated it).
 * delete  = hard delete (notes), skipped when the server copy is newer.
 * merge   = field patch (preferences, profile).
 */
export const OUTBOX_MODES = ['create', 'set', 'migrate', 'delete', 'merge'] as const;
export type OutboxMode = (typeof OUTBOX_MODES)[number];

/**
 * Derived from a Record so the compiler fails when core's WriteOrigin gains a member this list
 * misses (a missing origin would make parseOutbox silently DROP persisted entries on restart).
 */
const WRITE_ORIGIN_SET: Record<WriteOrigin, true> = {
  user: true,
  ai: true,
  calendar_google: true,
  calendar_device: true,
  calendar_outlook: true,
  migration: true,
  system: true,
};
const WRITE_ORIGINS = Object.keys(WRITE_ORIGIN_SET) as [WriteOrigin, ...WriteOrigin[]];

export interface OutboxEntry {
  /** Unique per enqueue; a coalesced replacement gets a new id. */
  id: string;
  /** Queue position (ascending). */
  seq: number;
  kind: OutboxKind;
  /** Meeting/note id, "preferences" or the uid (profile). */
  docId: string;
  mode: OutboxMode;
  /** Full document (meeting/note), field patch (preferences/profile), null for delete. */
  data: Record<string, unknown> | null;
  /** updatedAt of the local write (last-writer-wins). */
  updatedAt: string;
  origin: WriteOrigin;
  enqueuedAt: string;
  attempts: number;
  lastError: AppErrorCode | null;
}

export interface OutboxState {
  /** Last seq handed out. */
  seq: number;
  entries: OutboxEntry[];
}

export const EMPTY_OUTBOX: OutboxState = Object.freeze({ seq: 0, entries: [] }) as OutboxState;

export interface OutboxWrite {
  kind: OutboxKind;
  docId: string;
  mode: OutboxMode;
  data: Record<string, unknown> | null;
  updatedAt: string;
  origin: WriteOrigin;
}

function isPatchKind(kind: OutboxKind): boolean {
  return kind === 'preferences' || kind === 'profile';
}

function canCoalesce(existing: OutboxEntry, write: OutboxWrite): boolean {
  if (existing.kind !== write.kind || existing.docId !== write.docId) return false;
  // A preferences "create" (bootstrap document) and a "merge" (user patch) stay separate entries:
  // the create is skipped when another device created the document first, the patch is not.
  if (isPatchKind(write.kind)) return existing.mode === write.mode;
  return true;
}

function combinedMode(existing: OutboxMode, next: OutboxMode): OutboxMode {
  if (next === 'delete') return 'delete';
  if (existing === 'create') return 'create';
  if (existing === 'set') return 'set';
  if (existing === 'delete') return next === 'migrate' ? 'set' : next;
  return next; // existing 'migrate' (or 'merge' for patch kinds, handled by the caller)
}

/** Adds a write, coalescing with a pending entry for the same document. Pure. */
export function enqueueWrite(state: OutboxState, write: OutboxWrite, ctx: { id: string; now: string }): OutboxState {
  const index = state.entries.findIndex((entry) => canCoalesce(entry, write));
  if (index === -1) {
    const seq = state.seq + 1;
    const entry: OutboxEntry = {
      id: ctx.id,
      seq,
      kind: write.kind,
      docId: write.docId,
      mode: write.mode,
      data: write.data,
      updatedAt: write.updatedAt,
      origin: write.origin,
      enqueuedAt: ctx.now,
      attempts: 0,
      lastError: null,
    };
    return { seq, entries: [...state.entries, entry] };
  }

  const existing = state.entries[index] as OutboxEntry;
  let mode: OutboxMode;
  let data: Record<string, unknown> | null;
  if (isPatchKind(write.kind)) {
    mode = write.mode;
    data = write.mode === 'merge' ? { ...(existing.data ?? {}), ...(write.data ?? {}) } : write.data;
  } else {
    mode = combinedMode(existing.mode, write.mode);
    data = mode === 'delete' ? null : write.data;
  }
  const replacement: OutboxEntry = {
    ...existing,
    id: ctx.id,
    mode,
    data,
    updatedAt: write.updatedAt,
    origin: write.origin,
    enqueuedAt: ctx.now,
    attempts: 0,
    lastError: null,
  };
  const entries = [...state.entries];
  entries[index] = replacement;
  return { seq: state.seq, entries };
}

/**
 * Removes an acknowledged entry (by id). When a "create" was actually written and the entry was
 * replaced meanwhile by a newer state (still in "create" mode), that replacement becomes a "set":
 * the document now exists on the server because of our own create.
 */
export function ackEntry(state: OutboxState, acked: OutboxEntry, outcome: 'written' | 'skipped'): OutboxState {
  const entries = state.entries
    .filter((entry) => entry.id !== acked.id)
    .map((entry) =>
      outcome === 'written' &&
      acked.mode === 'create' &&
      !isPatchKind(acked.kind) &&
      entry.kind === acked.kind &&
      entry.docId === acked.docId &&
      entry.mode === 'create'
        ? { ...entry, mode: 'set' as const }
        : entry,
    );
  return { seq: state.seq, entries };
}

/** Changes the mode of a still-pending entry (legacy replacement: delete done, create next). */
export function requeueEntry(state: OutboxState, entryId: string, mode: OutboxMode): OutboxState {
  return {
    seq: state.seq,
    entries: state.entries.map((entry) => (entry.id === entryId ? { ...entry, mode, attempts: 0, lastError: null } : entry)),
  };
}

export function dropEntry(state: OutboxState, entryId: string): OutboxState {
  return { seq: state.seq, entries: state.entries.filter((entry) => entry.id !== entryId) };
}

export function recordFailure(state: OutboxState, entryId: string, code: AppErrorCode): OutboxState {
  return {
    seq: state.seq,
    entries: state.entries.map((entry) =>
      entry.id === entryId ? { ...entry, attempts: entry.attempts + 1, lastError: code } : entry,
    ),
  };
}

export function pendingEntries(state: OutboxState, kind: OutboxKind, docId: string): OutboxEntry[] {
  return state.entries.filter((entry) => entry.kind === kind && entry.docId === docId);
}

export function hasPending(state: OutboxState, kind: OutboxKind, docId: string): boolean {
  return state.entries.some((entry) => entry.kind === kind && entry.docId === docId);
}

/** Entries in processing order. */
export function orderedEntries(state: OutboxState): OutboxEntry[] {
  return [...state.entries].sort((a, b) => a.seq - b.seq);
}

const outboxEntrySchema = z.object({
  id: z.string().min(1),
  seq: z.number().int().nonnegative(),
  kind: z.enum(OUTBOX_KINDS),
  docId: z.string().min(1),
  mode: z.enum(OUTBOX_MODES),
  data: z.record(z.string(), z.unknown()).nullable(),
  updatedAt: z.string().min(1),
  origin: z.enum(WRITE_ORIGINS),
  enqueuedAt: z.string().min(1),
  attempts: z.number().int().nonnegative(),
  lastError: z.enum(APP_ERROR_CODES).nullable(),
});

/** Reads a persisted outbox; invalid entries are dropped (and reported by the caller). */
export function parseOutbox(raw: unknown): { state: OutboxState; dropped: number } {
  if (typeof raw !== 'object' || raw === null) return { state: { seq: 0, entries: [] }, dropped: 0 };
  const record = raw as { seq?: unknown; entries?: unknown };
  const list = Array.isArray(record.entries) ? record.entries : [];
  const entries: OutboxEntry[] = [];
  let dropped = 0;
  for (const item of list) {
    const parsed = outboxEntrySchema.safeParse(item);
    if (parsed.success) entries.push(parsed.data as OutboxEntry);
    else dropped += 1;
  }
  const maxSeq = entries.reduce((max, entry) => Math.max(max, entry.seq), 0);
  const seq = typeof record.seq === 'number' && Number.isInteger(record.seq) ? Math.max(record.seq, maxSeq) : maxSeq;
  return { state: { seq, entries }, dropped };
}
