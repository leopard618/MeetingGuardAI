/**
 * Minimal Zoom REST client (api.zoom.us/v2) for the write callables.
 *
 * - One operation = one HTTP call with a Bearer token from the shared token manager; an
 *   unexpected 401 (expired/revoked token despite the cache window) invalidates the cache and
 *   retries ONCE with a fresh token.
 * - Status mapping (docs/ARCHITECTURE.md §24): second 401 => not_configured; 404 => not_found
 *   (update/delete translate it to "gone" for the caller); 429 => quota_exceeded; anything
 *   else non-2xx => upstream_error.
 * - SECURITY: requests/responses carry meeting topics and join URLs; nothing from them is ever
 *   logged here or put into error messages (only status codes travel up).
 */
import { z } from 'zod';

import { ZOOM_TUNING } from '../config';
import { ZoomApiError } from './errors';
import { type ZoomCredentials, type ZoomTokenManager } from './token';

export const ZOOM_API_BASE = 'https://api.zoom.us/v2';

/**
 * Host user of every created meeting (docs/ARCHITECTURE.md §24: the account's own user). Zoom
 * resolves `me` from the access token; if a given account rejects the alias for S2S tokens
 * (create fails with not_configured / status 404, see docs/SETUP.md §12.5), replace it with
 * the host's email address - this constant is the only place.
 */
export const ZOOM_HOST_USER = 'me';

/** Zoom "scheduled meeting" type (a one-off with a start time). */
export const ZOOM_MEETING_TYPE_SCHEDULED = 2;
/**
 * Zoom "recurring meeting with no fixed time": no start_time/duration, and the join link stays
 * valid for the whole series (it expires a year after its LAST use, while a type-2 id expires 30
 * days after its scheduled date - fatal for monthly or paused series). Used whenever the meeting
 * document carries a recurrence rule; the app's alerts/calendar own the actual schedule.
 */
export const ZOOM_MEETING_TYPE_RECURRING = 3;

export interface ZoomCreateMeetingInput {
  /** Meeting topic, already truncated to Zoom's 200-char limit by the handler. */
  topic: string;
  /** Start instant as UTC "yyyy-MM-ddTHH:mm:ssZ". */
  startTimeUtc: string;
  durationMinutes: number;
  /** IANA zone for display/recurrence on Zoom's side; null = omit (start_time is UTC anyway). */
  timezone: string | null;
  /** The meeting document has a recurrence rule: create type 3 (no fixed time) instead of 2. */
  recurring: boolean;
}

export interface ZoomCreatedMeeting {
  /** Zoom's numeric meeting id as a string (external.zoomMeetingId). */
  zoomMeetingId: string;
  joinUrl: string;
  /** Zoom passcode when the host account's settings add one. */
  passcode: string | null;
}

export interface ZoomMeetingPatch {
  topic: string;
  startTimeUtc: string | null;
  durationMinutes: number;
  timezone: string | null;
  /** The meeting document has a recurrence rule: only the topic is patched (type 3 has no schedule). */
  recurring: boolean;
}

export interface ZoomClient {
  createMeeting(input: ZoomCreateMeetingInput): Promise<ZoomCreatedMeeting>;
  /** "gone" = Zoom answered 404 (the meeting no longer exists on Zoom's side). */
  updateMeeting(zoomMeetingId: string, patch: ZoomMeetingPatch): Promise<'updated' | 'gone'>;
  /** "gone" = already deleted on Zoom's side (the caller treats both as success). */
  deleteMeeting(zoomMeetingId: string): Promise<'deleted' | 'gone'>;
}

const createdMeetingSchema = z.object({
  id: z.union([z.number().int(), z.string()]),
  join_url: z.string().min(1),
  password: z.string().optional(),
});

export interface ZoomClientDeps {
  credentials: ZoomCredentials;
  tokens: ZoomTokenManager;
  fetchFn?: typeof fetch;
  requestTimeoutMs?: number;
}

export function createZoomClient(deps: ZoomClientDeps): ZoomClient {
  const fetchFn = deps.fetchFn ?? fetch;
  const requestTimeoutMs = deps.requestTimeoutMs ?? ZOOM_TUNING.zoomRequestTimeoutMs;

  async function send(method: 'POST' | 'PATCH' | 'DELETE', path: string, body: unknown, token: string): Promise<Response> {
    try {
      return await fetchFn(`${ZOOM_API_BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch {
      throw new ZoomApiError('upstream_error', null, 'Zoom request failed.');
    }
  }

  /** One call with the one-retry-on-401 rule; resolves the response for 2xx and 404 only. */
  async function request(method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<Response> {
    let response = await send(method, path, body, await deps.tokens.getToken(deps.credentials));
    if (response.status === 401) {
      deps.tokens.invalidate();
      response = await send(method, path, body, await deps.tokens.getToken(deps.credentials));
      if (response.status === 401) {
        throw new ZoomApiError('not_configured', 401, 'Zoom rejected the server credentials.');
      }
    }
    if (response.ok || response.status === 404) return response;
    if (response.status === 429) {
      throw new ZoomApiError('quota_exceeded', 429, 'Zoom rate limit hit.');
    }
    throw new ZoomApiError('upstream_error', response.status, `Zoom answered ${response.status}.`);
  }

  return {
    async createMeeting(input) {
      // Type 3 takes no schedule (start/duration/zone describe nothing there); the app's own
      // calendar and alerts carry the real occurrence times.
      const body = input.recurring
        ? { topic: input.topic, type: ZOOM_MEETING_TYPE_RECURRING }
        : {
            topic: input.topic,
            type: ZOOM_MEETING_TYPE_SCHEDULED,
            start_time: input.startTimeUtc,
            duration: input.durationMinutes,
            ...(input.timezone === null ? {} : { timezone: input.timezone }),
          };
      const response = await request('POST', `/users/${encodeURIComponent(ZOOM_HOST_USER)}/meetings`, body);
      if (response.status === 404) {
        // users/me unknown: the S2S app lost its user scope - an owner-side configuration issue.
        throw new ZoomApiError('not_configured', 404, 'Zoom host account not found.');
      }
      let raw: unknown;
      try {
        raw = await response.json();
      } catch {
        throw new ZoomApiError('upstream_error', response.status, 'Zoom create response was not JSON.');
      }
      const parsed = createdMeetingSchema.safeParse(raw);
      if (!parsed.success) {
        throw new ZoomApiError('upstream_error', response.status, 'Zoom create response was malformed.');
      }
      const passcode = parsed.data.password;
      return {
        zoomMeetingId: String(parsed.data.id),
        joinUrl: parsed.data.join_url,
        passcode: typeof passcode === 'string' && passcode.length > 0 ? passcode : null,
      };
    },

    async updateMeeting(zoomMeetingId, patch) {
      // A recurring (type 3) meeting has no schedule on Zoom's side: patch the topic only, so
      // Zoom never converts or rejects the no-fixed-time meeting over schedule fields.
      const body = patch.recurring
        ? { topic: patch.topic }
        : {
            topic: patch.topic,
            ...(patch.startTimeUtc === null ? {} : { start_time: patch.startTimeUtc }),
            duration: patch.durationMinutes,
            ...(patch.timezone === null ? {} : { timezone: patch.timezone }),
          };
      const response = await request('PATCH', `/meetings/${encodeURIComponent(zoomMeetingId)}`, body);
      return response.status === 404 ? 'gone' : 'updated';
    },

    async deleteMeeting(zoomMeetingId) {
      const response = await request(
        'DELETE',
        `/meetings/${encodeURIComponent(zoomMeetingId)}?schedule_for_reminder=false`,
      );
      return response.status === 404 ? 'gone' : 'deleted';
    },
  };
}
