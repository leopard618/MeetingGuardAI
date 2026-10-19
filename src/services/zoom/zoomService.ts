/**
 * ZOOM link service (owner: zoom-app). Contract: ZoomService in src/core/contracts.ts;
 * design: docs/v1/ARCHITECTURE.md §24.
 *
 * - Callables: CALLABLES.zoomStatus / zoomCreateMeeting / zoomSyncMeeting / zoomDeleteMeeting
 *   over the shared Firebase Functions instance (src/config/firebase.ts, already pinned to
 *   env.functionsRegion and emulator-aware) with ZOOM_CALL_TIMEOUT_MS. Requests and responses
 *   are validated with the zod schemas of src/core/aiContract.ts; HttpsError.details.reason is
 *   mapped to AppError codes (invalid_request becomes invalid_input).
 * - Session cache: the zoomStatus answer and the per-meeting failure map live in module memory
 *   and are cleared on appEvents 'session:ended' (never persisted; a new session asks again).
 * - ensureLink flushes the outbox first (the server loads the meeting document from Firestore,
 *   so an unsent create would 404), dedupes concurrent calls per meeting and remembers the last
 *   failure for linkFailure() until a later success. Offline => AppError('offline').
 * - NO meeting content in logs: meeting ids and error codes only.
 */
import NetInfo from '@react-native-community/netinfo';
import { httpsCallable } from 'firebase/functions';

import {
  CALLABLES,
  ZOOM_CALL_TIMEOUT_MS,
  zoomCreateMeetingRequestSchema,
  zoomCreateMeetingResponseSchema,
  zoomDeleteMeetingResponseSchema,
  zoomErrorDetailsSchema,
  zoomStatusResponseSchema,
  zoomSyncMeetingResponseSchema,
  type ZoomErrorCode,
} from '../../core/aiContract';
import type { ZoomLinkResult, ZoomService } from '../../core/contracts';
import { AppError, isAppError, toAppError, type AppErrorCode } from '../../core/errors';
import { appEvents, type AppEventMap, type EventBus, type Unsubscribe } from '../../core/events';
import { createLogger } from '../../core/logger';
import type { Meeting, MeetingPatch } from '../../core/types';
import { functions } from '../../config/firebase';
import { meetingRepository } from '../data';

const log = createLogger('zoom');

/** The four zoom* callable names (CALLABLES in src/core/aiContract.ts). */
export type ZoomCallableName =
  | typeof CALLABLES.zoomStatus
  | typeof CALLABLES.zoomCreateMeeting
  | typeof CALLABLES.zoomSyncMeeting
  | typeof CALLABLES.zoomDeleteMeeting;

/** Sends one request to a zoom* callable and resolves with the raw `data`. */
export interface ZoomTransport {
  call(name: ZoomCallableName, request: unknown, options: { timeoutMs: number }): Promise<unknown>;
}

export interface ZoomServiceDeps {
  /** null when Firebase is not configured in this build. */
  getTransport(): ZoomTransport | null;
  /** Sends pending local writes before a server call reads the document (best effort). */
  flushOutbox?: () => Promise<unknown>;
  /** true only when the device is KNOWN to be offline (unknown => false). */
  connectivity?: { isOffline(): Promise<boolean> };
  /** When given, the session cache is cleared on its 'session:ended' event (appEvents). */
  events?: Pick<EventBus<AppEventMap>, 'on'>;
  timeoutMs?: number;
}

/** MeetingPatch keys that change what the Zoom meeting shows (§24: topic/start/duration/zone). */
const ZOOM_SYNC_FIELDS = ['title', 'startAt', 'durationMinutes', 'timezone'] as const;

const REASON_TO_APP_CODE: Readonly<Record<ZoomErrorCode, AppErrorCode>> = {
  unauthenticated: 'unauthenticated',
  not_configured: 'not_configured',
  not_found: 'not_found',
  invalid_request: 'invalid_input',
  quota_exceeded: 'quota_exceeded',
  upstream_error: 'upstream_error',
};

function readCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function readMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : '';
}

/** The Firebase callable client reports a fetch that never reached the server as "internal [0]". */
function isStatusZero(message: string): boolean {
  return /\[0\]\s*$/.test(message);
}

function isNetworkMessage(message: string): boolean {
  return /network request failed|failed to fetch|network error|internet connection appears to be offline/i.test(message);
}

/**
 * Normalizes anything a zoom* callable throws into an AppError. `offline` is the connectivity
 * probe's answer after the failure (improves the mapping of status-0 "internal" errors).
 */
export function mapZoomError(error: unknown, context: { offline?: boolean } = {}): AppError {
  if (isAppError(error)) return error;
  const providerCode = readCode(error);
  const message = readMessage(error);
  const rawDetails = typeof error === 'object' && error !== null ? (error as { details?: unknown }).details : undefined;
  const details = zoomErrorDetailsSchema.safeParse(rawDetails);
  if (details.success) {
    return new AppError(REASON_TO_APP_CODE[details.data.reason], `zoom ${details.data.reason}`, {
      cause: error,
      details: { reason: details.data.reason, providerCode },
    });
  }
  if (providerCode !== null && providerCode.startsWith('functions/')) {
    const bare = providerCode.slice('functions/'.length);
    if (bare === 'deadline-exceeded') {
      return new AppError('timeout', 'zoom request timed out', { cause: error, details: { providerCode } });
    }
    if (bare === 'internal' && (isStatusZero(message) || context.offline === true)) {
      return new AppError('offline', 'zoom unreachable', { cause: error, details: { providerCode } });
    }
  }
  if (context.offline === true || isNetworkMessage(message)) {
    return new AppError('offline', 'zoom unreachable', { cause: error });
  }
  return toAppError(error, 'upstream_error');
}

/** The ZoomService contract plus the session plumbing the hook and the event wiring use. */
export interface ZoomServiceInternal extends ZoomService {
  /** Drops the cached zoomStatus answer and asks again (useZoomStatus().refresh). */
  refreshAvailability(): Promise<boolean>;
  /** Notifies whenever getKnownAvailability() may have changed (hook re-renders). */
  subscribeAvailability(listener: () => void): Unsubscribe;
  /** Session end: forget the status answer and the per-meeting failures. */
  clearSessionCache(): void;
}

export function createZoomService(deps: ZoomServiceDeps): ZoomServiceInternal {
  const timeoutMs = deps.timeoutMs ?? ZOOM_CALL_TIMEOUT_MS;
  /** zoomStatus answer this session; null = not known (unanswered or failed). */
  let known: boolean | null = null;
  let statusPromise: Promise<boolean> | null = null;
  /** Bumped on clearSessionCache so a stale in-flight status answer is never cached. */
  let sessionEpoch = 0;
  /** Signed-in uid (from 'session:started'); used only for the post-link re-push announcement. */
  let currentUid: string | null = null;
  const failures = new Map<string, AppErrorCode>();
  const linkCalls = new Map<string, Promise<ZoomLinkResult>>();
  const listeners = new Set<() => void>();

  function notify(): void {
    for (const listener of [...listeners]) listener();
  }

  function setKnown(value: boolean | null): void {
    known = value;
    notify();
  }

  async function probeOffline(): Promise<boolean> {
    if (!deps.connectivity) return false;
    try {
      return await deps.connectivity.isOffline();
    } catch {
      return false;
    }
  }

  /** Best effort: the server reads the document from Firestore, so pending writes go first. */
  async function flushPending(): Promise<void> {
    try {
      await deps.flushOutbox?.();
    } catch (error) {
      log.warn('outbox flush before a zoom call failed', toAppError(error).code);
    }
  }

  async function askStatus(): Promise<boolean> {
    const epoch = sessionEpoch;
    const transport = deps.getTransport();
    if (!transport) return false;
    let raw: unknown;
    try {
      raw = await transport.call(CALLABLES.zoomStatus, {}, { timeoutMs });
    } catch (error) {
      // Resolves false but stays UN-cached (known stays null), so a later call retries.
      log.warn('zoom status failed', mapZoomError(error).code);
      return false;
    }
    const parsed = zoomStatusResponseSchema.safeParse(raw);
    if (!parsed.success) {
      log.warn('zoom status response failed validation');
      return false;
    }
    if (epoch === sessionEpoch) setKnown(parsed.data.configured);
    return parsed.data.configured;
  }

  function isAvailable(): Promise<boolean> {
    if (known !== null) return Promise.resolve(known);
    if (statusPromise) return statusPromise;
    const promise = askStatus().finally(() => {
      if (statusPromise === promise) statusPromise = null;
    });
    statusPromise = promise;
    return promise;
  }

  async function doEnsureLink(meetingId: string): Promise<ZoomLinkResult> {
    const request = zoomCreateMeetingRequestSchema.safeParse({ meetingId });
    if (!request.success) throw new AppError('invalid_input', 'invalid zoom create request');
    const transport = deps.getTransport();
    if (!transport) throw new AppError('not_configured', 'Firebase is not configured in this build');
    if (await probeOffline()) throw new AppError('offline', 'Device is offline');
    await flushPending();
    let raw: unknown;
    try {
      raw = await transport.call(CALLABLES.zoomCreateMeeting, request.data, { timeoutMs });
    } catch (error) {
      throw mapZoomError(error, { offline: await probeOffline() });
    }
    const parsed = zoomCreateMeetingResponseSchema.safeParse(raw);
    if (!parsed.success) throw new AppError('upstream_error', 'Invalid zoom create response');
    return parsed.data;
  }

  function ensureLink(meetingId: string): Promise<ZoomLinkResult> {
    const inFlight = linkCalls.get(meetingId);
    if (inFlight) return inFlight;
    // A call can settle AFTER the session that started it ended (sign-out mid-flight): the
    // failure map belongs to ONE session (§24), so the continuations only touch it while the
    // epoch is unchanged - mirroring askStatus. Without this, user A's late failure would leak
    // A's meeting id + failure code into user B's session on the same device.
    const epoch = sessionEpoch;
    const promise = doEnsureLink(meetingId)
      .then((result) => {
        if (epoch === sessionEpoch) {
          failures.delete(meetingId);
          // The link/passcode were written SERVER-side (Admin SDK), so the snapshot arrives as a
          // remote change, which the calendar engine never pushes (origin filter). Re-announce it
          // as a local update so Google/Outlook/device events are re-sent with the join info -
          // otherwise attendee invitation emails never contain the Zoom link.
          if (currentUid !== null) {
            appEvents.emit('meetings:changed', {
              uid: currentUid,
              changedIds: [meetingId],
              reason: 'updated',
              origin: 'user',
            });
          }
        }
        return result;
      })
      .catch((caught: unknown) => {
        const error = toAppError(caught);
        if (epoch === sessionEpoch) {
          failures.set(meetingId, error.code);
          log.warn('zoom link creation failed', { meetingId, code: error.code });
        }
        throw error;
      })
      .finally(() => {
        if (linkCalls.get(meetingId) === promise) linkCalls.delete(meetingId);
      });
    linkCalls.set(meetingId, promise);
    return promise;
  }

  async function syncIfNeeded(meeting: Meeting, patch: MeetingPatch): Promise<void> {
    if (meeting.external.zoomMeetingId === null) return;
    if (!ZOOM_SYNC_FIELDS.some((field) => patch[field] !== undefined)) return;
    const transport = deps.getTransport();
    if (!transport) return;
    try {
      await flushPending();
      const raw = await transport.call(CALLABLES.zoomSyncMeeting, { meetingId: meeting.id }, { timeoutMs });
      if (!zoomSyncMeetingResponseSchema.safeParse(raw).success) {
        log.warn('zoom sync response failed validation', { meetingId: meeting.id });
      }
    } catch (error) {
      log.warn('zoom sync failed', { meetingId: meeting.id, code: mapZoomError(error).code });
    }
  }

  async function onMeetingDeleted(meeting: Pick<Meeting, 'id' | 'external'>): Promise<void> {
    const zoomMeetingId = meeting.external.zoomMeetingId;
    failures.delete(meeting.id);
    if (zoomMeetingId === null) return;
    const transport = deps.getTransport();
    if (!transport) return;
    try {
      // The document is already tombstoned when this runs, so the bare-id form is the right one
      // (the server attests ownership from its zoomMeetings registry; a Zoom 404 = deleted anyway).
      const raw = await transport.call(CALLABLES.zoomDeleteMeeting, { meetingId: null, zoomMeetingId }, { timeoutMs });
      if (!zoomDeleteMeetingResponseSchema.safeParse(raw).success) {
        log.warn('zoom delete response failed validation', { meetingId: meeting.id });
      }
    } catch (error) {
      log.warn('zoom delete failed', { meetingId: meeting.id, code: mapZoomError(error).code });
    }
  }

  function clearSessionCache(): void {
    sessionEpoch += 1;
    currentUid = null;
    statusPromise = null;
    failures.clear();
    linkCalls.clear();
    setKnown(null);
  }

  // The status answer and the failure map belong to ONE session (§24).
  deps.events?.on('session:ended', () => clearSessionCache());
  // The uid is only needed to re-announce a server-written link as a pushable local change.
  deps.events?.on('session:started', (event) => {
    currentUid = event.uid;
  });

  return {
    isAvailable,
    getKnownAvailability(): boolean | null {
      return known;
    },
    ensureLink,
    syncIfNeeded,
    onMeetingDeleted,
    linkFailure(meetingId: string): AppErrorCode | null {
      return failures.get(meetingId) ?? null;
    },
    async refreshAvailability(): Promise<boolean> {
      sessionEpoch += 1;
      statusPromise = null;
      setKnown(null);
      return isAvailable();
    },
    subscribeAvailability(listener: () => void): Unsubscribe {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    clearSessionCache,
  };
}

function getDefaultTransport(): ZoomTransport | null {
  const instance = functions;
  if (!instance) return null;
  return {
    async call(name: ZoomCallableName, request: unknown, options: { timeoutMs: number }): Promise<unknown> {
      const callable = httpsCallable<unknown, unknown>(instance, name, { timeout: options.timeoutMs });
      const result = await callable(request);
      return result.data;
    },
  };
}

export const zoomService: ZoomServiceInternal = createZoomService({
  getTransport: getDefaultTransport,
  flushOutbox: () => meetingRepository.flushOutbox(),
  connectivity: {
    async isOffline(): Promise<boolean> {
      const state = await NetInfo.fetch();
      return state.isConnected === false;
    },
  },
  events: appEvents,
});
