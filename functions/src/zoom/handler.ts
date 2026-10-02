/**
 * Logic of the zoom write callables, independent of Firebase wiring (ports injected, like
 * assistant/handler.ts). Design: docs/ARCHITECTURE.md §24; the callable shells (auth, schema
 * parse, ZOOM_ENABLED guard) live in ./index.ts.
 *
 * Order of zoomCreateMeeting: load + validate the caller's own meeting document (ownership is
 * the users/{uid}/meetings path) -> idempotent short-circuit on a stored link -> atomic daily
 * cap (usage/{uid}/days/{UTC day}.zoomCreates) -> Zoom REST create -> ONE transaction that
 * re-checks the preconditions and writes conference.url/password + external.zoomMeetingId
 * PLUS the ownership registry entry zoomMeetings/{zoomMeetingId} = { uid, meetingId, createdAt }
 * (Admin SDK: bypasses the rules; the app's snapshot listener picks the change up). When the
 * re-check fails (the document changed while Zoom worked), the just-created Zoom meeting is
 * deleted again best-effort so the host account never collects orphans.
 *
 * OWNERSHIP of a Zoom meeting id is SERVER-ATTESTED by that registry, never by the meeting
 * document: external.zoomMeetingId is client-writable (any user can stamp any digits on their
 * own docs, and every participant sees the numeric id in the join url), so sync, delete and the
 * create path's stale-id cleanup resolve the owner from zoomMeetings/{id} and deny when the
 * entry is missing or names another uid. All Zoom meetings live on ONE shared host account,
 * which is why the attestation matters. The registry has no client access (firestore.rules).
 *
 * Logs: uid, meeting doc id, Zoom numeric id and error codes only - NEVER titles, URLs or
 * passcodes (§24 logging rule).
 */
import * as logger from 'firebase-functions/logger';
import type { Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';

import { ZOOM_TUNING } from '../config';
import {
  conferenceDetailsSchema,
  usageDayKey,
  zoomCreateMeetingResponseSchema,
  zoomMeetingNumberSchema,
  type ZoomCreateMeetingRequest,
  type ZoomCreateMeetingResponse,
  type ZoomDeleteMeetingRequest,
  type ZoomDeleteMeetingResponse,
  type ZoomSyncMeetingRequest,
  type ZoomSyncMeetingResponse,
} from '../shared/aiContract';
import { toZoomHttpsError, zoomError } from './errors';
import { type ZoomClient } from './api';

// ---------------------------------------------------------------------------------------------
// Ports (Firestore access; firestoreZoomStore below is the real adapter)
// ---------------------------------------------------------------------------------------------

/** Daily counters on usage/{uid}/days/{day} (same documents as the assistant quota). */
export type ZoomUsageField = 'zoomCreates' | 'zoomOps';

/** Server-only ownership registry document zoomMeetings/{zoomMeetingId} (no client access). */
export interface ZoomOwnerEntry {
  uid: string;
  meetingId: string;
}

export interface ZoomStoreTransaction {
  /** Raw users/{uid}/meetings/{id} data, or undefined when the document does not exist. */
  getMeeting(uid: string, meetingId: string): Promise<unknown>;
  /** Partial update; keys are Firestore field paths ("conference.url"). */
  updateMeetingFields(uid: string, meetingId: string, fields: Record<string, unknown>): void;
  /** Writes zoomMeetings/{zoomMeetingId} (the server-attested owner of the Zoom meeting). */
  setZoomOwner(zoomMeetingId: string, entry: ZoomOwnerEntry & { createdAt: string }): void;
  /** Current counter value (0 when the document or field is missing or malformed). */
  readUsageField(uid: string, dayKey: string, field: ZoomUsageField): Promise<number>;
  writeUsageField(uid: string, dayKey: string, field: ZoomUsageField, count: number, updatedAtIso: string): void;
}

export interface ZoomStore {
  /** Raw users/{uid}/meetings/{id} data, or undefined when the document does not exist. */
  getMeeting(uid: string, meetingId: string): Promise<unknown>;
  /** zoomMeetings/{zoomMeetingId}, or null when absent or malformed (= nobody owns the id). */
  getZoomOwner(zoomMeetingId: string): Promise<ZoomOwnerEntry | null>;
  /** Removes zoomMeetings/{zoomMeetingId} after the Zoom meeting itself was deleted. */
  deleteZoomOwner(zoomMeetingId: string): Promise<void>;
  runTransaction<T>(fn: (tx: ZoomStoreTransaction) => Promise<T>): Promise<T>;
}

export interface ZoomHandlerDeps {
  store: ZoomStore;
  /** Created lazily so the secrets are only read for requests that passed every guard. */
  client: () => ZoomClient;
  now: () => Date;
  /** ZOOM_USER_DAILY_LIMIT.value() (a param: read per invocation). */
  createDailyLimit: () => number;
  /** Cap multiplier for the cheap sync/delete counter; default ZOOM_TUNING.opsLimitMultiplier. */
  opsLimitMultiplier?: number;
}

// ---------------------------------------------------------------------------------------------
// Meeting document reading (lenient, like aiMeetingContextDocSchema: user-writable data)
// ---------------------------------------------------------------------------------------------

/** Zoom's own limit on a meeting topic. */
export const ZOOM_TOPIC_MAX_CHARS = 200;
/** Zoom rejects scheduled meetings longer than a day; longer local meetings clamp. */
export const ZOOM_MAX_DURATION_MINUTES = 1_440;

const zoomMeetingDocSchema = z.object({
  title: z.string().catch(''),
  startAt: z.string(),
  durationMinutes: z.number().catch(60),
  timezone: z.string().catch('UTC'),
  deletedAt: z.string().nullable().catch(null),
  conference: conferenceDetailsSchema.nullable().catch(null),
  external: z.record(z.string(), z.unknown()).catch({}),
  // Stored sparsely (absent on one-offs); only non-null-ness matters here: a recurring meeting
  // gets a Zoom type 3 ("recurring, no fixed time") whose join link never expires mid-series
  // (a type 2 id dies 30 days after its scheduled date; §22 promises a reusable link).
  recurrence: z.record(z.string(), z.unknown()).nullable().catch(null),
});
type ZoomMeetingDoc = z.infer<typeof zoomMeetingDocSchema>;

function parseMeetingDoc(raw: unknown): ZoomMeetingDoc | null {
  const parsed = zoomMeetingDocSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** The stored Zoom id, or null when absent or not a plausible Zoom meeting number (client-writable!). */
export function storedZoomMeetingId(external: Record<string, unknown>): string | null {
  const value = external['zoomMeetingId'];
  return typeof value === 'string' && zoomMeetingNumberSchema.safeParse(value).success ? value : null;
}

/** Tolerant extraction for delete (the document may be tombstoned or partial). */
function zoomIdFromRawDoc(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const external = (raw as Record<string, unknown>).external;
  if (typeof external !== 'object' || external === null) return null;
  return storedZoomMeetingId(external as Record<string, unknown>);
}

/** Topic sent to Zoom: trimmed, truncated, never empty. */
export function zoomTopic(title: string): string {
  const trimmed = title.trim().slice(0, ZOOM_TOPIC_MAX_CHARS);
  return trimmed.length > 0 ? trimmed : 'Meeting';
}

/** startAt as Zoom's UTC "yyyy-MM-ddTHH:mm:ssZ", or null when unparsable. */
export function zoomStartTimeUtc(startAtIso: string): string | null {
  const ms = Date.parse(startAtIso);
  if (!Number.isFinite(ms)) return null;
  return `${new Date(ms).toISOString().slice(0, 19)}Z`;
}

function zoomDuration(durationMinutes: number): number {
  if (!Number.isFinite(durationMinutes)) return 60;
  return Math.min(Math.max(Math.round(durationMinutes), 1), ZOOM_MAX_DURATION_MINUTES);
}

/** The meeting's zone when the runtime knows it (sent for display), else null (start is UTC). */
export function usableTimeZone(zone: string): string | null {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Daily caps (usage/{uid}/days/{day}.zoomCreates / .zoomOps; §24)
// ---------------------------------------------------------------------------------------------

/** Atomically counts one operation; false = over the cap (nothing written then). */
async function consumeZoomCounter(
  store: ZoomStore,
  uid: string,
  field: ZoomUsageField,
  limit: number,
  now: Date,
): Promise<boolean> {
  const dayKey = usageDayKey(now);
  return store.runTransaction(async (tx) => {
    const current = await tx.readUsageField(uid, dayKey, field);
    if (current >= limit) return false;
    tx.writeUsageField(uid, dayKey, field, current + 1, now.toISOString());
    return true;
  });
}

function opsLimit(deps: ZoomHandlerDeps): number {
  return deps.createDailyLimit() * (deps.opsLimitMultiplier ?? ZOOM_TUNING.opsLimitMultiplier);
}

async function requireCounter(deps: ZoomHandlerDeps, uid: string, field: ZoomUsageField, limit: number): Promise<void> {
  const allowed = await consumeZoomCounter(deps.store, uid, field, limit, deps.now());
  if (!allowed) {
    logger.info('zoom.quota_exceeded', { uid, field, limit });
    throw zoomError('quota_exceeded', 'Daily Zoom limit reached. Try again tomorrow.');
  }
}

async function bestEffortZoomDelete(client: ZoomClient, zoomMeetingId: string, uid: string, cause: string): Promise<void> {
  try {
    await client.deleteMeeting(zoomMeetingId);
  } catch (error) {
    logger.warn('zoom.cleanup_delete_failed', {
      uid,
      zoomMeetingId,
      cause,
      errorName: error instanceof Error ? error.name : typeof error,
    });
  }
}

/**
 * Whether the CALLER owns this Zoom meeting id, per the server-written registry (see the
 * header): true only when zoomMeetings/{id} exists and names the caller's uid. The meeting
 * document's external.zoomMeetingId is a client-writable HINT and never proves ownership.
 */
async function callerOwnsZoomId(store: ZoomStore, uid: string, zoomMeetingId: string): Promise<boolean> {
  const owner = await store.getZoomOwner(zoomMeetingId);
  return owner !== null && owner.uid === uid;
}

/** Registry cleanup after a Zoom meeting was deleted; a leftover entry is harmless (retry heals). */
async function bestEffortOwnerDelete(store: ZoomStore, zoomMeetingId: string, uid: string): Promise<void> {
  try {
    await store.deleteZoomOwner(zoomMeetingId);
  } catch (error) {
    logger.warn('zoom.registry_delete_failed', {
      uid,
      zoomMeetingId,
      errorName: error instanceof Error ? error.name : typeof error,
    });
  }
}

// ---------------------------------------------------------------------------------------------
// zoomCreateMeeting
// ---------------------------------------------------------------------------------------------

export async function handleZoomCreateMeeting(
  uid: string,
  request: ZoomCreateMeetingRequest,
  deps: ZoomHandlerDeps,
): Promise<ZoomCreateMeetingResponse> {
  const { meetingId } = request;
  try {
    const raw = await deps.store.getMeeting(uid, meetingId);
    if (raw === undefined) throw zoomError('not_found', 'Meeting not found.');
    const doc = parseMeetingDoc(raw);
    if (doc === null) throw zoomError('invalid_request', 'The meeting document is not usable for a Zoom link.');
    if (doc.deletedAt !== null) throw zoomError('not_found', 'Meeting not found.');
    if (doc.conference === null || doc.conference.provider !== 'zoom') {
      throw zoomError('invalid_request', 'The meeting is not a Zoom meeting.');
    }

    const priorZoomId = storedZoomMeetingId(doc.external);
    if (priorZoomId !== null && doc.conference.url !== null) {
      // Idempotent: the link exists already (an earlier call or a concurrent one) - return it.
      const stored = zoomCreateMeetingResponseSchema.safeParse({
        url: doc.conference.url,
        password: doc.conference.password,
        zoomMeetingId: priorZoomId,
      });
      if (stored.success) {
        logger.info('zoom.create_idempotent', { uid, meetingId, zoomMeetingId: priorZoomId });
        return stored.data;
      }
      throw zoomError('invalid_request', 'The stored Zoom link is invalid.');
    }
    if (priorZoomId === null && doc.conference.url !== null) {
      // A pasted link always wins; ensureLink must not be called then (§24).
      throw zoomError('invalid_request', 'The meeting already has a link.');
    }
    // Reaching here: url is null; priorZoomId is either null (normal) or a stale id whose link
    // was cleared client-side - then a fresh Zoom meeting replaces it (the stale one is deleted
    // after the write, so a retry loop can never strand the user).

    const startTimeUtc = zoomStartTimeUtc(doc.startAt);
    if (startTimeUtc === null) throw zoomError('invalid_request', 'The meeting start time is invalid.');

    await requireCounter(deps, uid, 'zoomCreates', deps.createDailyLimit());

    const client = deps.client();
    const created = await client.createMeeting({
      topic: zoomTopic(doc.title),
      startTimeUtc,
      durationMinutes: zoomDuration(doc.durationMinutes),
      timezone: usableTimeZone(doc.timezone),
      recurring: doc.recurrence !== null,
    });
    const response = zoomCreateMeetingResponseSchema.safeParse({
      url: created.joinUrl,
      password: created.passcode,
      zoomMeetingId: created.zoomMeetingId,
    });
    if (!response.success) {
      await bestEffortZoomDelete(client, created.zoomMeetingId, uid, 'unusable_response');
      logger.error('zoom.create_response_invalid', { uid, meetingId });
      throw zoomError('upstream_error', 'Zoom returned an unusable meeting.');
    }

    const nowIso = deps.now().toISOString();
    const txResult = await deps.store.runTransaction(async (tx) => {
      const rawTx = await tx.getMeeting(uid, meetingId);
      if (rawTx === undefined) return 'not_found' as const;
      const docTx = parseMeetingDoc(rawTx);
      if (docTx === null || docTx.deletedAt !== null) return 'not_found' as const;
      if (docTx.conference === null || docTx.conference.provider !== 'zoom') return 'invalid_request' as const;
      // A link pasted while Zoom worked wins; a changed stored id means another call interfered.
      if (docTx.conference.url !== null) return 'invalid_request' as const;
      if (storedZoomMeetingId(docTx.external) !== priorZoomId) return 'invalid_request' as const;
      tx.updateMeetingFields(uid, meetingId, {
        'conference.url': response.data.url,
        'conference.password': response.data.password,
        'external.zoomMeetingId': response.data.zoomMeetingId,
        updatedAt: nowIso,
      });
      // Ownership attestation (see the header): written atomically with the link, so a Zoom id
      // without a registry entry is never a legitimately linked one.
      tx.setZoomOwner(response.data.zoomMeetingId, { uid, meetingId, createdAt: nowIso });
      return 'written' as const;
    });
    if (txResult !== 'written') {
      await bestEffortZoomDelete(client, created.zoomMeetingId, uid, 'preconditions_changed');
      logger.info('zoom.create_aborted', { uid, meetingId, reason: txResult });
      throw zoomError(txResult, 'The meeting changed while the Zoom link was created.');
    }
    if (priorZoomId !== null && priorZoomId !== created.zoomMeetingId) {
      // The stale id came from the CLIENT-writable doc field: only delete the Zoom meeting it
      // names when the registry says the caller owns it (a stamped foreign id is skipped).
      if (await callerOwnsZoomId(deps.store, uid, priorZoomId)) {
        await bestEffortZoomDelete(client, priorZoomId, uid, 'replaced_stale_id');
        await bestEffortOwnerDelete(deps.store, priorZoomId, uid);
      } else {
        logger.info('zoom.stale_id_not_owned', { uid, meetingId, zoomMeetingId: priorZoomId });
      }
    }
    logger.info('zoom.create_completed', { uid, meetingId, zoomMeetingId: created.zoomMeetingId });
    return response.data;
  } catch (error) {
    throw toZoomHttpsError(error, { uid, op: 'create', meetingId });
  }
}

// ---------------------------------------------------------------------------------------------
// zoomSyncMeeting
// ---------------------------------------------------------------------------------------------

export async function handleZoomSyncMeeting(
  uid: string,
  request: ZoomSyncMeetingRequest,
  deps: ZoomHandlerDeps,
): Promise<ZoomSyncMeetingResponse> {
  const { meetingId } = request;
  try {
    const raw = await deps.store.getMeeting(uid, meetingId);
    if (raw === undefined) throw zoomError('not_found', 'Meeting not found.');
    const doc = parseMeetingDoc(raw);
    // Tombstoned, malformed or never linked: nothing to sync (the app ignores the result).
    if (doc === null || doc.deletedAt !== null) return { updated: false };
    const zoomMeetingId = storedZoomMeetingId(doc.external);
    if (zoomMeetingId === null) return { updated: false };
    // The id on the doc is a client-writable hint: a stamped foreign id must never let this
    // caller rewrite another user's Zoom meeting (topic defacement / schedule disruption).
    if (!(await callerOwnsZoomId(deps.store, uid, zoomMeetingId))) {
      logger.info('zoom.sync_denied', { uid, meetingId, zoomMeetingId });
      return { updated: false };
    }

    await requireCounter(deps, uid, 'zoomOps', opsLimit(deps));

    const result = await deps.client().updateMeeting(zoomMeetingId, {
      topic: zoomTopic(doc.title),
      startTimeUtc: zoomStartTimeUtc(doc.startAt),
      durationMinutes: zoomDuration(doc.durationMinutes),
      timezone: usableTimeZone(doc.timezone),
      recurring: doc.recurrence !== null,
    });
    if (result === 'gone') {
      // The Zoom meeting no longer exists; clear nothing (the stub rule) and report no update.
      logger.info('zoom.sync_gone', { uid, meetingId, zoomMeetingId });
      return { updated: false };
    }
    logger.info('zoom.sync_completed', { uid, meetingId, zoomMeetingId });
    return { updated: true };
  } catch (error) {
    throw toZoomHttpsError(error, { uid, op: 'sync', meetingId });
  }
}

// ---------------------------------------------------------------------------------------------
// zoomDeleteMeeting
// ---------------------------------------------------------------------------------------------

export async function handleZoomDeleteMeeting(
  uid: string,
  request: ZoomDeleteMeetingRequest,
  deps: ZoomHandlerDeps,
): Promise<ZoomDeleteMeetingResponse> {
  const { meetingId, zoomMeetingId } = request;
  try {
    let resolved: string | null = null;
    if (meetingId !== null) {
      const raw = await deps.store.getMeeting(uid, meetingId);
      if (raw !== undefined) {
        resolved = zoomIdFromRawDoc(raw);
        // The caller's own (possibly tombstoned) document never referenced a Zoom meeting.
        if (resolved === null && zoomMeetingId === null) return { deleted: false };
      } else if (zoomMeetingId === null) {
        throw zoomError('not_found', 'Meeting not found.');
      }
    }
    if (resolved === null) {
      // Bare Zoom id (schema: at least one of the two is set).
      if (zoomMeetingId === null) throw zoomError('invalid_request', 'A meetingId or zoomMeetingId is required.');
      resolved = zoomMeetingId;
    }
    // Ownership is SERVER-ATTESTED (see the header): both the bare id and the id read from the
    // caller's own document are client-influenced, so the registry must name the caller - one
    // user must never delete another user's Zoom meeting by stamping its (publicly visible) id.
    if (!(await callerOwnsZoomId(deps.store, uid, resolved))) {
      logger.info('zoom.delete_denied', { uid, zoomMeetingId: resolved });
      throw zoomError('not_found', 'No meeting with this Zoom id.');
    }

    await requireCounter(deps, uid, 'zoomOps', opsLimit(deps));

    const result = await deps.client().deleteMeeting(resolved);
    // A Zoom 404 counts as deleted (§24: the goal state "no such Zoom meeting" is reached).
    await bestEffortOwnerDelete(deps.store, resolved, uid);
    logger.info('zoom.delete_completed', { uid, meetingId, zoomMeetingId: resolved, alreadyGone: result === 'gone' });
    return { deleted: true };
  } catch (error) {
    throw toZoomHttpsError(error, { uid, op: 'delete', meetingId });
  }
}

// ---------------------------------------------------------------------------------------------
// Firestore adapter
// ---------------------------------------------------------------------------------------------

/** Collection of the server-only ownership registry (no client access; firestore.rules). */
export const ZOOM_OWNERS_COLLECTION = 'zoomMeetings';

export function firestoreZoomStore(db: Firestore): ZoomStore {
  const meetingRef = (uid: string, meetingId: string) => db.doc(`users/${uid}/meetings/${meetingId}`);
  const usageRef = (uid: string, dayKey: string) => db.doc(`usage/${uid}/days/${dayKey}`);
  // The id is digits only (zoomMeetingNumberSchema) and therefore always a valid doc id.
  const ownerRef = (zoomMeetingId: string) => db.doc(`${ZOOM_OWNERS_COLLECTION}/${zoomMeetingId}`);
  return {
    async getMeeting(uid, meetingId) {
      const snapshot = await meetingRef(uid, meetingId).get();
      return snapshot.exists ? snapshot.data() : undefined;
    },
    async getZoomOwner(zoomMeetingId) {
      const snapshot = await ownerRef(zoomMeetingId).get();
      if (!snapshot.exists) return null;
      const data = snapshot.data() as Record<string, unknown> | undefined;
      const uid = data?.uid;
      const meetingId = data?.meetingId;
      return typeof uid === 'string' && uid.length > 0 && typeof meetingId === 'string' && meetingId.length > 0
        ? { uid, meetingId }
        : null;
    },
    async deleteZoomOwner(zoomMeetingId) {
      await ownerRef(zoomMeetingId).delete();
    },
    runTransaction: <T>(fn: (tx: ZoomStoreTransaction) => Promise<T>) =>
      db.runTransaction(
        (transaction) =>
          fn({
            async getMeeting(uid, meetingId) {
              const snapshot = await transaction.get(meetingRef(uid, meetingId));
              return snapshot.exists ? snapshot.data() : undefined;
            },
            updateMeetingFields(uid, meetingId, fields) {
              transaction.update(meetingRef(uid, meetingId), fields);
            },
            setZoomOwner(zoomMeetingId, entry) {
              transaction.set(ownerRef(zoomMeetingId), entry);
            },
            async readUsageField(uid, dayKey, field) {
              const snapshot = await transaction.get(usageRef(uid, dayKey));
              const value: unknown = snapshot.exists ? snapshot.get(field) : 0;
              return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0;
            },
            writeUsageField(uid, dayKey, field, count, updatedAtIso) {
              transaction.set(usageRef(uid, dayKey), { [field]: count, updatedAt: updatedAtIso }, { merge: true });
            },
          }),
        { maxAttempts: 5 },
      ),
  };
}
