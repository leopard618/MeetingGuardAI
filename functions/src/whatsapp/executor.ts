/**
 * Server-side executor for CONFIRMED AiActions over WhatsApp (docs/ARCHITECTURE.md §27). This is
 * the ONLY place the server mutates meetings; everywhere else the app executes confirmed actions
 * itself.
 *
 * Safety invariants:
 * - uid comes ONLY from the server-matched whatsappLinks doc (the webhook resolves it; nothing
 *   in the payload can choose a uid).
 * - Every action is re-validated with the SAME zod contract (aiActionSchema) right before it is
 *   applied, even though pendingActions were server-written.
 * - All reads and writes are `users/{uid}/meetings/*`: owner-scoped by construction.
 * - Written documents match the exact shape firestore.rules isValidMeeting accepts (source
 *   'whatsapp' is in the rules enum) and the app's parseMeetingDoc reads, so the Admin-SDK
 *   bypass grants nothing the client path would not.
 * - Execution idempotency lives in session.claimPendingActions (one atomic claim per proposal);
 *   a double tap or Meta redelivery never reaches this module twice for the same proposal.
 * - Recurrence scopes 'occurrence' and 'following' need the app's split/override engine and are
 *   NOT supported here: such actions are reported unsupported (the webhook already filters them
 *   out at proposal time; this is defense in depth).
 * - Zoom (provider zoom, url null, integration enabled): reuses the zoom handlers best-effort;
 *   a failure never fails the action - the meeting keeps url null and the app's details screen
 *   heals it via ensureLink (§24).
 *
 * Logs: uid, meeting ids and counts only - never titles, URLs or message text.
 */
import * as logger from 'firebase-functions/logger';
import type { Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';

import {
  AI_LIMITS,
  aiActionSchema,
  conferenceDetailsSchema,
  meetingLocationSchema,
  recurrenceRuleSchema,
  type AiAction,
  type AiMeetingChanges,
  type AiMeetingDraft,
  type Language,
} from '../shared/aiContract';
import { isValidTimeZone, toLocalDate, toLocalTime } from '../assistant/time';
import { formatMeetingSummary, type BotMeetingSummaryInput } from './messages';

/** Tombstone title; must equal TOMBSTONE_TITLE in src/core/types.ts (scrub parity). */
export const WHATSAPP_TOMBSTONE_TITLE = 'Deleted meeting';

// ---------------------------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------------------------

export interface MeetingStore {
  /** Raw users/{uid}/meetings/{id} data, or undefined when the document does not exist. */
  getMeeting(uid: string, meetingId: string): Promise<unknown>;
  /** Creates users/{uid}/meetings/{id} (fails when it exists). */
  createMeeting(uid: string, meetingId: string, doc: Record<string, unknown>): Promise<void>;
  /** Partial update; keys are Firestore field paths. */
  updateMeetingFields(uid: string, meetingId: string, fields: Record<string, unknown>): Promise<void>;
  newMeetingId(): string;
}

/** Best-effort Zoom reuse (wired to the zoom handlers while ZOOM_ENABLED; absent otherwise). */
export interface ZoomHooks {
  ensureLink(uid: string, meetingId: string): Promise<void>;
  sync(uid: string, meetingId: string): Promise<void>;
  remove(uid: string, meetingId: string, zoomMeetingId: string): Promise<void>;
}

export interface ExecutorDeps {
  store: MeetingStore;
  now: () => Date;
  zoom?: ZoomHooks;
}

export interface ExecutionResult {
  applied: number;
  /** Actions skipped because this surface cannot apply them (occurrence/following scopes). */
  unsupported: number;
  /** Actions that failed validation or hit a missing/tombstoned meeting. */
  failed: number;
}

// ---------------------------------------------------------------------------------------------
// Stored meeting documents (lenient read, like the zoom handler's)
// ---------------------------------------------------------------------------------------------

const storedMeetingSchema = z.object({
  title: z.string().catch(''),
  startAt: z.string(),
  durationMinutes: z.number().catch(60),
  timezone: z.string().catch('UTC'),
  allDay: z.boolean().catch(false),
  deletedAt: z.string().nullable().catch(null),
  conference: conferenceDetailsSchema.nullable().catch(null),
  location: meetingLocationSchema.nullable().catch(null),
  external: z.record(z.string(), z.unknown()).catch({}),
  recurrence: recurrenceRuleSchema.nullable().catch(null),
  seriesId: z.string().nullable().catch(null),
});
type StoredMeeting = z.infer<typeof storedMeetingSchema>;

function parseStoredMeeting(raw: unknown): StoredMeeting | null {
  const parsed = storedMeetingSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function storedZoomId(external: Record<string, unknown>): string | null {
  const value = external['zoomMeetingId'];
  return typeof value === 'string' && /^[0-9]{1,32}$/.test(value) ? value : null;
}

// ---------------------------------------------------------------------------------------------
// Draft -> document (the exact shape firestore.rules isValidMeeting accepts)
// ---------------------------------------------------------------------------------------------

function usableZone(zone: string, fallback: string): string {
  if (isValidTimeZone(zone)) return zone;
  return isValidTimeZone(fallback) ? fallback : 'UTC';
}

function toParticipants(list: AiMeetingDraft['participants']): { email: string; name: string | null; status: null }[] {
  const byEmail = new Map<string, { email: string; name: string | null; status: null }>();
  for (const item of list) {
    const email = item.email.trim().toLowerCase();
    if (!byEmail.has(email)) {
      const name = item.name?.trim() ?? '';
      byEmail.set(email, { email, name: name.length > 0 ? name : null, status: null });
    }
  }
  return [...byEmail.values()].slice(0, AI_LIMITS.maxParticipants);
}

function normalizedAlertTimes(times: readonly number[] | null): number[] | null {
  if (times === null) return null;
  return [...new Set(times)].sort((a, b) => b - a);
}

/** Builds a complete meeting document from a validated draft. Exported for tests. */
export function draftToMeetingDoc(
  uid: string,
  meetingId: string,
  draft: AiMeetingDraft,
  confidence: number,
  now: Date,
  fallbackTimezone: string,
): Record<string, unknown> {
  const timezone = usableZone(draft.timezone, fallbackTimezone);
  const start = new Date(Date.parse(draft.startAt));
  const startAt = start.toISOString();
  const nowIso = now.toISOString();
  const recurrence = draft.recurrence ?? null;
  const doc: Record<string, unknown> = {
    userId: uid,
    title: draft.title,
    description: draft.description,
    startAt,
    durationMinutes: draft.durationMinutes,
    timezone,
    allDay: draft.allDay,
    date: toLocalDate(start, timezone),
    time: toLocalTime(start, timezone),
    location: draft.location,
    conference: draft.conference,
    participants: toParticipants(draft.participants),
    source: 'whatsapp',
    confidence,
    language: draft.language,
    preparationTips: draft.preparationTips.map((tip) => tip.trim()).filter((tip) => tip.length > 0),
    customAlertTimes: normalizedAlertTimes(draft.customAlertTimes),
    alertIntensity: null,
    notes: null,
    status: 'scheduled',
    external: {},
    createdAt: nowIso,
    updatedAt: nowIso,
    deletedAt: null,
  };
  // Sparse like the app (SPARSE_MEETING_KEYS): absent while null.
  if (recurrence !== null) {
    doc.recurrence = recurrence;
    doc.seriesId = meetingId;
  }
  return doc;
}

/** Field-path updates for a changes payload against the stored document. Exported for tests. */
export function changesToFieldUpdates(
  changes: AiMeetingChanges,
  stored: StoredMeeting,
  meetingId: string,
  now: Date,
): Record<string, unknown> {
  const fields: Record<string, unknown> = { updatedAt: now.toISOString() };
  if (changes.title !== undefined) fields.title = changes.title;
  if (changes.description !== undefined) fields.description = changes.description;
  if (changes.durationMinutes !== undefined) fields.durationMinutes = changes.durationMinutes;
  if (changes.allDay !== undefined) fields.allDay = changes.allDay;
  if (changes.language !== undefined) fields.language = changes.language;
  if (changes.location !== undefined) fields.location = changes.location;
  if (changes.conference !== undefined) fields.conference = changes.conference;
  if (changes.participants !== undefined) fields.participants = toParticipants(changes.participants);
  if (changes.preparationTips !== undefined) {
    fields.preparationTips = changes.preparationTips.map((tip) => tip.trim()).filter((tip) => tip.length > 0);
  }
  if (changes.customAlertTimes !== undefined) fields.customAlertTimes = normalizedAlertTimes(changes.customAlertTimes);
  if (changes.recurrence !== undefined) {
    fields.recurrence = changes.recurrence;
    if (changes.recurrence === null) {
      // Overrides without a rule are dead data (the rules reject them).
      fields.recurrenceOverrides = null;
    } else if (stored.seriesId === null) {
      fields.seriesId = meetingId;
    }
  }
  const timezone = changes.timezone !== undefined ? usableZone(changes.timezone, stored.timezone) : stored.timezone;
  const startIso = changes.startAt !== undefined ? new Date(Date.parse(changes.startAt)).toISOString() : stored.startAt;
  if (changes.startAt !== undefined || changes.timezone !== undefined) {
    if (changes.timezone !== undefined) fields.timezone = timezone;
    if (changes.startAt !== undefined) fields.startAt = startIso;
    const start = new Date(Date.parse(startIso));
    if (!Number.isNaN(start.getTime())) {
      fields.date = toLocalDate(start, usableZone(timezone, 'UTC'));
      fields.time = toLocalTime(start, usableZone(timezone, 'UTC'));
    }
  }
  return fields;
}

/** The scrub set of tombstoneMeeting in src/core/types.ts (content never outlives a delete). */
export function tombstoneFieldUpdates(now: Date): Record<string, unknown> {
  const nowIso = now.toISOString();
  return {
    title: WHATSAPP_TOMBSTONE_TITLE,
    description: '',
    location: null,
    conference: null,
    participants: [],
    preparationTips: [],
    customAlertTimes: null,
    alertIntensity: null,
    notes: null,
    confidence: null,
    recurrence: null,
    recurrenceOverrides: null,
    deletedAt: nowIso,
    updatedAt: nowIso,
  };
}

// ---------------------------------------------------------------------------------------------
// Zoom reuse (best effort, never fatal)
// ---------------------------------------------------------------------------------------------

async function bestEffortZoom(uid: string, meetingId: string, what: string, work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    logger.warn('whatsapp.zoom_hook_failed', {
      uid,
      meetingId,
      hook: what,
      errorName: error instanceof Error ? error.name : typeof error,
    });
  }
}

function touchesZoomSchedule(changes: AiMeetingChanges): boolean {
  return (
    changes.title !== undefined ||
    changes.startAt !== undefined ||
    changes.durationMinutes !== undefined ||
    changes.timezone !== undefined
  );
}

// ---------------------------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------------------------

function isUnsupportedScope(scope: 'occurrence' | 'series' | 'following' | undefined): boolean {
  return scope === 'occurrence' || scope === 'following';
}

async function executeCreate(
  uid: string,
  action: Extract<AiAction, { type: 'create_meeting' }>,
  deps: ExecutorDeps,
  fallbackTimezone: string,
): Promise<void> {
  const meetingId = deps.store.newMeetingId();
  const doc = draftToMeetingDoc(uid, meetingId, action.meeting, action.confidence, deps.now(), fallbackTimezone);
  await deps.store.createMeeting(uid, meetingId, doc);
  if (deps.zoom && action.meeting.conference?.provider === 'zoom' && action.meeting.conference.url === null) {
    const zoom = deps.zoom;
    await bestEffortZoom(uid, meetingId, 'create', () => zoom.ensureLink(uid, meetingId));
  }
  logger.info('whatsapp.action_applied', { uid, type: action.type, meetingId });
}

async function executeUpdate(
  uid: string,
  action: Extract<AiAction, { type: 'update_meeting' }>,
  deps: ExecutorDeps,
): Promise<'applied' | 'failed'> {
  const stored = parseStoredMeeting(await deps.store.getMeeting(uid, action.meetingId));
  if (stored === null || stored.deletedAt !== null) return 'failed';
  const fields = changesToFieldUpdates(action.changes, stored, action.meetingId, deps.now());
  await deps.store.updateMeetingFields(uid, action.meetingId, fields);
  if (deps.zoom && storedZoomId(stored.external) !== null && touchesZoomSchedule(action.changes)) {
    const zoom = deps.zoom;
    await bestEffortZoom(uid, action.meetingId, 'sync', () => zoom.sync(uid, action.meetingId));
  }
  if (deps.zoom && action.changes.conference?.provider === 'zoom' && action.changes.conference.url === null) {
    const zoom = deps.zoom;
    await bestEffortZoom(uid, action.meetingId, 'create', () => zoom.ensureLink(uid, action.meetingId));
  }
  logger.info('whatsapp.action_applied', { uid, type: action.type, meetingId: action.meetingId });
  return 'applied';
}

async function executeDelete(
  uid: string,
  action: Extract<AiAction, { type: 'delete_meeting' }>,
  deps: ExecutorDeps,
): Promise<'applied' | 'failed'> {
  const stored = parseStoredMeeting(await deps.store.getMeeting(uid, action.meetingId));
  if (stored === null) return 'failed';
  if (stored.deletedAt !== null) return 'applied'; // Already deleted: the goal state is reached.
  const zoomId = storedZoomId(stored.external);
  if (deps.zoom && zoomId !== null) {
    const zoom = deps.zoom;
    await bestEffortZoom(uid, action.meetingId, 'delete', () => zoom.remove(uid, action.meetingId, zoomId));
  }
  await deps.store.updateMeetingFields(uid, action.meetingId, tombstoneFieldUpdates(deps.now()));
  logger.info('whatsapp.action_applied', { uid, type: action.type, meetingId: action.meetingId });
  return 'applied';
}

async function executeBulk(
  uid: string,
  action: Extract<AiAction, { type: 'bulk_update' }>,
  deps: ExecutorDeps,
): Promise<{ applied: number; failed: number }> {
  let applied = 0;
  let failed = 0;
  for (const meetingId of action.meetingIds) {
    const stored = parseStoredMeeting(await deps.store.getMeeting(uid, meetingId));
    if (stored === null || stored.deletedAt !== null) {
      failed += 1;
      continue;
    }
    const fields: Record<string, unknown> = { updatedAt: deps.now().toISOString() };
    let schedule = false;
    if (action.shiftMinutes !== null) {
      const startMs = Date.parse(stored.startAt);
      if (!Number.isFinite(startMs)) {
        failed += 1;
        continue;
      }
      const start = new Date(startMs + action.shiftMinutes * 60_000);
      fields.startAt = start.toISOString();
      fields.date = toLocalDate(start, usableZone(stored.timezone, 'UTC'));
      fields.time = toLocalTime(start, usableZone(stored.timezone, 'UTC'));
      schedule = true;
    }
    if (action.changes !== null) {
      Object.assign(fields, changesToFieldUpdates(action.changes, stored, meetingId, deps.now()));
      schedule = schedule || touchesZoomSchedule(action.changes);
    }
    await deps.store.updateMeetingFields(uid, meetingId, fields);
    if (deps.zoom && storedZoomId(stored.external) !== null && schedule) {
      const zoom = deps.zoom;
      await bestEffortZoom(uid, meetingId, 'sync', () => zoom.sync(uid, meetingId));
    }
    applied += 1;
  }
  logger.info('whatsapp.action_applied', { uid, type: action.type, meetings: action.meetingIds.length, applied, failed });
  return { applied, failed };
}

/**
 * Applies a confirmed action list. Every action is re-validated; invalid or share/list entries
 * count as failed/unsupported (share and list are answered at proposal time, never stored).
 */
export async function executeConfirmedActions(
  uid: string,
  actions: readonly unknown[],
  deps: ExecutorDeps,
  fallbackTimezone: string,
): Promise<ExecutionResult> {
  const result: ExecutionResult = { applied: 0, unsupported: 0, failed: 0 };
  for (const candidate of actions) {
    const parsed = aiActionSchema.safeParse(candidate);
    if (!parsed.success) {
      result.failed += 1;
      continue;
    }
    const action = parsed.data;
    try {
      switch (action.type) {
        case 'create_meeting':
          await executeCreate(uid, action, deps, fallbackTimezone);
          result.applied += 1;
          break;
        case 'update_meeting':
          if (isUnsupportedScope(action.scope)) {
            result.unsupported += 1;
          } else if ((await executeUpdate(uid, action, deps)) === 'applied') {
            result.applied += 1;
          } else {
            result.failed += 1;
          }
          break;
        case 'delete_meeting':
          if (isUnsupportedScope(action.scope)) {
            result.unsupported += 1;
          } else if ((await executeDelete(uid, action, deps)) === 'applied') {
            result.applied += 1;
          } else {
            result.failed += 1;
          }
          break;
        case 'bulk_update': {
          const bulk = await executeBulk(uid, action, deps);
          result.applied += bulk.applied > 0 ? 1 : 0;
          result.failed += bulk.applied === 0 ? 1 : 0;
          break;
        }
        default:
          // share_meeting / list never reach the pending set (proposal-time replies).
          result.unsupported += 1;
          break;
      }
    } catch (error) {
      logger.error('whatsapp.action_failed', {
        uid,
        type: action.type,
        errorName: error instanceof Error ? error.name : typeof error,
      });
      result.failed += 1;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// Read-only formatting (share_meeting / list replies; executed at proposal time)
// ---------------------------------------------------------------------------------------------

export async function formatMeetingForShare(
  uid: string,
  meetingId: string,
  language: Language,
  deps: ExecutorDeps,
): Promise<string | null> {
  const stored = parseStoredMeeting(await deps.store.getMeeting(uid, meetingId));
  if (stored === null || stored.deletedAt !== null) return null;
  const timezone = usableZone(stored.timezone, 'UTC');
  const start = new Date(Date.parse(stored.startAt));
  if (Number.isNaN(start.getTime())) return null;
  const summary: BotMeetingSummaryInput = {
    title: stored.title.length > 0 ? stored.title : 'Meeting',
    date: toLocalDate(start, timezone),
    time: stored.allDay ? null : toLocalTime(start, timezone),
    timezone,
    durationMinutes: Math.max(1, Math.round(stored.durationMinutes)),
    place: stored.conference?.url ?? stored.location?.address ?? stored.location?.virtualUrl ?? null,
  };
  return formatMeetingSummary(language, summary);
}

/** How many meetings a list reply shows at most. */
export const LIST_REPLY_LIMIT = 5;

export async function formatMeetingList(
  uid: string,
  meetingIds: readonly string[],
  language: Language,
  deps: ExecutorDeps,
): Promise<string[]> {
  const blocks: string[] = [];
  for (const meetingId of meetingIds.slice(0, LIST_REPLY_LIMIT)) {
    const block = await formatMeetingForShare(uid, meetingId, language, deps);
    if (block !== null) blocks.push(block);
  }
  return blocks;
}

// ---------------------------------------------------------------------------------------------
// Firestore adapter
// ---------------------------------------------------------------------------------------------

export function firestoreMeetingStore(db: Firestore): MeetingStore {
  const ref = (uid: string, meetingId: string) => db.doc(`users/${uid}/meetings/${meetingId}`);
  return {
    async getMeeting(uid, meetingId) {
      const snapshot = await ref(uid, meetingId).get();
      return snapshot.exists ? snapshot.data() : undefined;
    },
    async createMeeting(uid, meetingId, doc) {
      await ref(uid, meetingId).create(doc);
    },
    async updateMeetingFields(uid, meetingId, fields) {
      await ref(uid, meetingId).update(fields);
    },
    newMeetingId() {
      return db.collection('users').doc().id;
    },
  };
}
