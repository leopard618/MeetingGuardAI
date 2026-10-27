/**
 * Minimal Microsoft Graph client for the Outlook calendar sync (fetch + Bearer token).
 *
 * - 401: invalidates the cached access token (the token manager refreshes it with the stored
 *   refresh token) and retries ONCE.
 * - 429 / 5xx: exponential backoff with jitter, honouring Retry-After (Graph throttling sends it).
 * - Every failure becomes an AppError whose details carry { status, graphCode } (never tokens).
 * - Delta paging works on absolute URLs (@odata.nextLink / @odata.deltaLink), so `getUrl` accepts
 *   only URLs on the Graph origin.
 */
import { AppError, isAppError, type AppErrorCode } from '../../../core/errors';
import type { GraphDeltaPage, GraphEvent, GraphEventWrite, GraphInstancesPage, GraphUser } from './types';

export const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';

/** Event fields MeetingGuard reads (smaller payloads; delta supports $select). */
export const EVENT_SELECT =
  'id,changeKey,lastModifiedDateTime,type,seriesMasterId,subject,body,bodyPreview,start,end,isAllDay,' +
  'isCancelled,location,attendees,organizer,responseStatus,isOnlineMeeting,onlineMeetingProvider,onlineMeeting,onlineMeetingUrl';

/** Instances of a series master additionally carry the generated start (override matching). */
export const INSTANCE_SELECT = `${EVENT_SELECT},originalStart`;
/** Instance listings are bounded by the override span; this caps a runaway series. */
export const MAX_INSTANCE_PAGES = 20;

/** UTC times + plain-text bodies + bounded pages. */
const PREFER_HEADER = 'outlook.timezone="UTC", outlook.body-content-type="text", odata.maxpagesize=100';

export interface GraphTokenProvider {
  /** Fresh access token for Graph (refreshed with the stored refresh token when needed). */
  getToken(): Promise<string>;
  /** Drops a token Graph rejected so the next getToken() refreshes. */
  invalidate(token: string): Promise<void>;
}

export interface GraphApiOptions {
  tokens: GraphTokenProvider;
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

export interface OutlookGraphApi {
  /** First delta page of /me/calendarView over [startIso, endIso). */
  startDelta(startIso: string, endIso: string): Promise<GraphDeltaPage>;
  /** Follows an @odata.nextLink or @odata.deltaLink (absolute Graph URL). */
  getDeltaPage(url: string): Promise<GraphDeltaPage>;
  getEvent(eventId: string): Promise<GraphEvent>;
  createEvent(body: GraphEventWrite): Promise<GraphEvent>;
  patchEvent(eventId: string, body: GraphEventWrite): Promise<GraphEvent>;
  deleteEvent(eventId: string): Promise<void>;
  /**
   * Occurrences and exceptions of a series master whose start falls in [startIso, endIso)
   * (GET /me/events/{id}/instances), every page followed. Used to find the Graph instance of a
   * cancelled or modified MeetingGuard occurrence.
   */
  listInstances(masterId: string, startIso: string, endIso: string): Promise<GraphEvent[]>;
  /** Signed-in Microsoft account (mail / userPrincipalName). */
  getMe(): Promise<GraphUser>;
}

interface GraphErrorInfo {
  status: number;
  graphCode: string | null;
  retryAfterMs: number | null;
}

/** HTTP status of a Graph failure (null for non-HTTP errors). */
export function graphHttpStatus(error: unknown): number | null {
  if (!isAppError(error)) return null;
  const status = error.details?.status;
  return typeof status === 'number' ? status : null;
}

export function graphErrorCode(error: unknown): string | null {
  if (!isAppError(error)) return null;
  const code = error.details?.graphCode;
  return typeof code === 'string' ? code : null;
}

function isRetryable(info: GraphErrorInfo): boolean {
  return info.status === 429 || info.status >= 500;
}

function codeFor(info: GraphErrorInfo): AppErrorCode {
  switch (info.status) {
    case 400:
      return 'invalid_input';
    case 401:
      return 'unauthenticated';
    case 403:
      return 'permission_denied';
    case 404:
    case 410:
      return 'not_found';
    case 409:
    case 412:
      return 'conflict';
    case 429:
      return 'upstream_error';
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

async function readErrorInfo(response: Response): Promise<GraphErrorInfo> {
  let graphCode: string | null = null;
  try {
    const body = (await response.json()) as { error?: { code?: string } };
    graphCode = body.error?.code ?? null;
  } catch {
    // Non-JSON error body: the status is enough.
  }
  return { status: response.status, graphCode, retryAfterMs: parseRetryAfter(response.headers.get('Retry-After')) };
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function createOutlookGraphApi(options: GraphApiOptions): OutlookGraphApi {
  const fetchImpl = options.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxRetries = options.maxRetries ?? 3;
  const base = options.baseUrl ?? GRAPH_API_BASE;
  const origin = new URL(base).origin;

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
        throw new AppError('timeout', 'Microsoft Graph request timed out', { cause: error });
      }
      throw new AppError('offline', 'Microsoft Graph is unreachable', { cause: error });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function request<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown): Promise<T | undefined> {
    const headers: Record<string, string> = { Accept: 'application/json', Prefer: PREFER_HEADER };
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
          throw new AppError('upstream_error', 'Microsoft Graph returned invalid JSON', {
            cause: error,
            details: { status: response.status },
          });
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
      throw new AppError(codeFor(info), `Microsoft Graph ${method} failed with HTTP ${info.status}`, {
        details: { status: info.status, graphCode: info.graphCode, method },
        retryable: isRetryable(info),
      });
    }
  }

  async function required<T>(promise: Promise<T | undefined>, what: string): Promise<T> {
    const value = await promise;
    if (value === undefined) throw new AppError('upstream_error', `Microsoft Graph returned an empty ${what}`);
    return value;
  }

  return {
    startDelta(startIso, endIso) {
      const url =
        `${base}/me/calendarView/delta?startDateTime=${encodeURIComponent(startIso)}` +
        `&endDateTime=${encodeURIComponent(endIso)}&$select=${encodeURIComponent(EVENT_SELECT)}`;
      return required(request<GraphDeltaPage>('GET', url), 'delta page');
    },
    async getDeltaPage(url) {
      if (new URL(url).origin !== origin) {
        throw new AppError('invalid_input', 'Refusing a delta link outside the Graph origin');
      }
      return required(request<GraphDeltaPage>('GET', url), 'delta page');
    },
    getEvent(eventId) {
      return required(
        request<GraphEvent>('GET', `${base}/me/events/${encodeURIComponent(eventId)}?$select=${encodeURIComponent(EVENT_SELECT)}`),
        'event',
      );
    },
    createEvent(body) {
      return required(request<GraphEvent>('POST', `${base}/me/events`, body), 'event');
    },
    patchEvent(eventId, body) {
      return required(request<GraphEvent>('PATCH', `${base}/me/events/${encodeURIComponent(eventId)}`, body), 'event');
    },
    async deleteEvent(eventId) {
      await request<void>('DELETE', `${base}/me/events/${encodeURIComponent(eventId)}`);
    },
    async listInstances(masterId, startIso, endIso) {
      const instances: GraphEvent[] = [];
      let url: string | undefined =
        `${base}/me/events/${encodeURIComponent(masterId)}/instances?startDateTime=${encodeURIComponent(startIso)}` +
        `&endDateTime=${encodeURIComponent(endIso)}&$select=${encodeURIComponent(INSTANCE_SELECT)}`;
      for (let count = 0; url !== undefined && count < MAX_INSTANCE_PAGES; count += 1) {
        if (new URL(url).origin !== origin) {
          throw new AppError('invalid_input', 'Refusing an instances link outside the Graph origin');
        }
        const page: GraphInstancesPage = await required(request<GraphInstancesPage>('GET', url), 'instances page');
        instances.push(...(page.value ?? []));
        url = page['@odata.nextLink'];
      }
      return instances;
    },
    getMe() {
      return required(request<GraphUser>('GET', `${base}/me?$select=mail,userPrincipalName`), 'user');
    },
  };
}
