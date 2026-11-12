/**
 * Minimal Google Calendar API v3 client (fetch + Bearer token from the auth service).
 *
 * - 401: invalidates the token (GoogleSignin.clearCachedAccessToken via the auth service), fetches
 *   a fresh one and retries ONCE.
 * - 429, 5xx and 403 rate-limit reasons: exponential backoff with jitter (honours Retry-After).
 * - Every failure becomes an AppError whose details carry { status, reason } (never tokens).
 */
import { AppError, isAppError, type AppErrorCode } from '../../../core/errors';
import type { GoogleEvent, GoogleEventList, GoogleEventWrite, SendUpdates } from './types';

export const GOOGLE_CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

/** Response fields Meeting Guard reads from events.list (smaller payloads). */
export const LIST_FIELDS =
  'nextPageToken,nextSyncToken,timeZone,items(id,etag,status,summary,description,location,start,end,updated,' +
  'attendees(email,displayName,responseStatus,self,resource),conferenceData,hangoutLink,recurringEventId,' +
  'eventType,extendedProperties,organizer(email,self))';

export interface GoogleTokenProvider {
  /** Fresh access token with the Calendar scope. */
  getToken(): Promise<string>;
  /** Drops a token Google rejected so the next getToken() refreshes it. */
  invalidate(token: string): Promise<void>;
}

export interface GoogleApiOptions {
  tokens: GoogleTokenProvider;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** 0..1 (jitter). */
  random?: () => number;
  /** Per-request timeout (default 30 s). */
  timeoutMs?: number;
  /** Retries for 429/5xx (default 3). */
  maxRetries?: number;
  baseUrl?: string;
}

export interface ListEventsParams {
  syncToken?: string;
  timeMin?: string;
  timeMax?: string;
  pageToken?: string;
  maxResults?: number;
}

export interface WriteParams {
  sendUpdates: SendUpdates;
  /** 1 when the body contains conferenceData (Meet link creation). */
  conferenceDataVersion?: 0 | 1;
}

export interface PatchParams extends WriteParams {
  /** Optimistic concurrency: 412 when the event changed since this etag. */
  ifMatch?: string | null;
}

export interface GoogleCalendarApi {
  listEvents(calendarId: string, params: ListEventsParams): Promise<GoogleEventList>;
  getEvent(calendarId: string, eventId: string): Promise<GoogleEvent>;
  insertEvent(calendarId: string, body: GoogleEventWrite, params: WriteParams): Promise<GoogleEvent>;
  patchEvent(calendarId: string, eventId: string, body: GoogleEventWrite, params: PatchParams): Promise<GoogleEvent>;
  deleteEvent(calendarId: string, eventId: string, params: { sendUpdates: SendUpdates }): Promise<void>;
}

interface GoogleErrorInfo {
  status: number;
  reason: string | null;
  retryAfterMs: number | null;
}

/** HTTP status of a Google API failure (null for non-HTTP errors). */
export function googleHttpStatus(error: unknown): number | null {
  if (!isAppError(error)) return null;
  const status = error.details?.status;
  return typeof status === 'number' ? status : null;
}

export function googleErrorReason(error: unknown): string | null {
  if (!isAppError(error)) return null;
  const reason = error.details?.reason;
  return typeof reason === 'string' ? reason : null;
}

const RATE_LIMIT_REASONS: ReadonlySet<string> = new Set(['rateLimitExceeded', 'userRateLimitExceeded']);
const SCOPE_REASONS: ReadonlySet<string> = new Set(['insufficientPermissions', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT']);

function isRetryable(info: GoogleErrorInfo): boolean {
  if (info.status === 429 || info.status >= 500) return true;
  return info.status === 403 && info.reason !== null && RATE_LIMIT_REASONS.has(info.reason);
}

function codeFor(info: GoogleErrorInfo): AppErrorCode {
  switch (info.status) {
    case 400:
      return 'invalid_input';
    case 401:
      return 'unauthenticated';
    case 403:
      if (info.reason !== null && SCOPE_REASONS.has(info.reason)) return 'calendar_scope_missing';
      if (info.reason !== null && RATE_LIMIT_REASONS.has(info.reason)) return 'upstream_error';
      return 'permission_denied';
    case 404:
    case 410:
      return 'not_found';
    case 409:
    case 412:
      return 'conflict';
    default:
      return 'upstream_error';
  }
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

async function readErrorInfo(response: Response): Promise<GoogleErrorInfo> {
  let reason: string | null = null;
  try {
    const body = (await response.json()) as {
      error?: { status?: string; errors?: { reason?: string }[]; details?: { reason?: string }[] };
    };
    reason = body.error?.errors?.[0]?.reason ?? body.error?.details?.[0]?.reason ?? body.error?.status ?? null;
  } catch {
    // Non-JSON error body: the status is enough.
  }
  return { status: response.status, reason, retryAfterMs: parseRetryAfter(response.headers.get('Retry-After')) };
}

function buildUrl(base: string, path: string, query: Record<string, string | number | boolean | undefined | null>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return `${base}${path}${parts.length > 0 ? `?${parts.join('&')}` : ''}`;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function createGoogleCalendarApi(options: GoogleApiOptions): GoogleCalendarApi {
  const fetchImpl = options.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxRetries = options.maxRetries ?? 3;
  const base = options.baseUrl ?? GOOGLE_CALENDAR_API_BASE;

  function backoffMs(attempt: number, retryAfterMs: number | null): number {
    if (retryAfterMs !== null) return Math.min(retryAfterMs, 30_000);
    return Math.min(16_000, 1000 * 2 ** attempt) + Math.floor(random() * 250);
  }

  async function send(url: string, init: RequestInit, token: string): Promise<Response> {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      return await fetchImpl(url, {
        ...init,
        headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` },
        signal: controller?.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new AppError('timeout', 'Google Calendar request timed out', { cause: error });
      }
      throw new AppError('offline', 'Google Calendar is unreachable', { cause: error });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    query: Record<string, string | number | boolean | undefined | null>,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T | undefined> {
    const url = buildUrl(base, path, query);
    const headers: Record<string, string> = { Accept: 'application/json', ...extraHeaders };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const init: RequestInit = { method, headers, body: body === undefined ? undefined : JSON.stringify(body) };

    let token = await options.tokens.getToken();
    let refreshedToken = false;
    let attempt = 0;
    for (;;) {
      const response = await send(url, init, token);
      if (response.ok) {
        if (response.status === 204) return undefined;
        const text = await response.text();
        if (text.length === 0) return undefined;
        try {
          return JSON.parse(text) as T;
        } catch (error) {
          throw new AppError('upstream_error', 'Google Calendar returned invalid JSON', { cause: error, details: { status: response.status } });
        }
      }

      const info = await readErrorInfo(response);
      if (info.status === 401 && !refreshedToken) {
        refreshedToken = true;
        await options.tokens.invalidate(token);
        token = await options.tokens.getToken();
        continue;
      }
      if (isRetryable(info) && attempt < maxRetries) {
        await sleep(backoffMs(attempt, info.retryAfterMs));
        attempt += 1;
        continue;
      }
      throw new AppError(codeFor(info), `Google Calendar ${method} failed with HTTP ${info.status}`, {
        details: { status: info.status, reason: info.reason, method },
        retryable: isRetryable(info),
      });
    }
  }

  function eventsPath(calendarId: string, eventId?: string): string {
    const root = `/calendars/${encodeURIComponent(calendarId)}/events`;
    return eventId === undefined ? root : `${root}/${encodeURIComponent(eventId)}`;
  }

  async function required<T>(promise: Promise<T | undefined>, what: string): Promise<T> {
    const value = await promise;
    if (value === undefined) throw new AppError('upstream_error', `Google Calendar returned an empty ${what}`);
    return value;
  }

  return {
    listEvents(calendarId, params) {
      return required(
        request<GoogleEventList>('GET', eventsPath(calendarId), {
          singleEvents: true,
          maxResults: params.maxResults ?? 250,
          syncToken: params.syncToken,
          timeMin: params.syncToken ? undefined : params.timeMin,
          timeMax: params.syncToken ? undefined : params.timeMax,
          pageToken: params.pageToken,
          fields: LIST_FIELDS,
        }),
        'event list',
      );
    },
    getEvent(calendarId, eventId) {
      return required(request<GoogleEvent>('GET', eventsPath(calendarId, eventId), {}), 'event');
    },
    insertEvent(calendarId, body, params) {
      return required(
        request<GoogleEvent>(
          'POST',
          eventsPath(calendarId),
          { sendUpdates: params.sendUpdates, conferenceDataVersion: params.conferenceDataVersion },
          body,
        ),
        'event',
      );
    },
    patchEvent(calendarId, eventId, body, params) {
      return required(
        request<GoogleEvent>(
          'PATCH',
          eventsPath(calendarId, eventId),
          { sendUpdates: params.sendUpdates, conferenceDataVersion: params.conferenceDataVersion },
          body,
          params.ifMatch ? { 'If-Match': params.ifMatch } : undefined,
        ),
        'event',
      );
    },
    async deleteEvent(calendarId, eventId, params) {
      await request<void>('DELETE', eventsPath(calendarId, eventId), { sendUpdates: params.sendUpdates });
    },
  };
}
