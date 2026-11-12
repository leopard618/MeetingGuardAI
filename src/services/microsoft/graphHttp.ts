/**
 * Microsoft Graph HTTP core shared by the Outlook calendar sync and the Microsoft To Do sync
 * (fetch + Bearer token). Pure: no Expo / RN imports.
 *
 * - 401: invalidates the cached access token (the token manager refreshes it with the stored
 *   refresh token) and retries ONCE.
 * - 429 / 5xx: exponential backoff with jitter, honouring Retry-After (Graph throttling sends it).
 * - Every failure becomes an AppError whose details carry { status, graphCode } (never tokens).
 * - Paging links (@odata.nextLink / @odata.deltaLink) are absolute URLs: `assertGraphUrl` accepts
 *   only URLs on the Graph origin.
 */
import { AppError, isAppError, type AppErrorCode } from '../../core/errors';

export const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';

export interface GraphTokenProvider {
  /** Fresh access token for Graph (refreshed with the stored refresh token when needed). */
  getToken(): Promise<string>;
  /** Drops a token Graph rejected so the next getToken() refreshes. */
  invalidate(token: string): Promise<void>;
}

export interface GraphHttpOptions {
  tokens: GraphTokenProvider;
  /** Sent with every request (`Prefer` header): time zone, body type, page size. */
  prefer: string;
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

export type GraphMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface GraphHttp {
  readonly base: string;
  /** Sends one request; undefined for empty (204) responses. */
  request<T>(method: GraphMethod, url: string, body?: unknown): Promise<T | undefined>;
  /** Like request, but an empty response is an upstream_error (`what` names the expected payload). */
  required<T>(method: GraphMethod, url: string, what: string, body?: unknown): Promise<T>;
  /** Throws invalid_input for a link that does not point at the Graph origin. */
  assertGraphUrl(url: string, what: string): void;
}

interface GraphErrorInfo {
  status: number;
  graphCode: string | null;
  /** Graph's own error text (never a token); for logs and bug reports. */
  graphMessage: string | null;
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

/** "code: message" of a Graph failure for logs (null for non-Graph errors). */
export function graphErrorText(error: unknown): string | null {
  if (!isAppError(error)) return null;
  const code = error.details?.graphCode;
  const message = error.details?.graphMessage;
  if (typeof code !== 'string' && typeof message !== 'string') return null;
  return [code, message].filter((part): part is string => typeof part === 'string').join(': ');
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
  let graphMessage: string | null = null;
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    graphCode = body.error?.code ?? null;
    graphMessage = typeof body.error?.message === 'string' ? body.error.message.slice(0, 300) : null;
  } catch {
    // Non-JSON error body: the status is enough.
  }
  return { status: response.status, graphCode, graphMessage, retryAfterMs: parseRetryAfter(response.headers.get('Retry-After')) };
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function createGraphHttp(options: GraphHttpOptions): GraphHttp {
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

  async function request<T>(method: GraphMethod, url: string, body?: unknown): Promise<T | undefined> {
    const headers: Record<string, string> = { Accept: 'application/json', Prefer: options.prefer };
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
        details: { status: info.status, graphCode: info.graphCode, graphMessage: info.graphMessage, method },
        retryable: isRetryable(info),
      });
    }
  }

  return {
    base,
    request,
    async required<T>(method: GraphMethod, url: string, what: string, body?: unknown): Promise<T> {
      const value = await request<T>(method, url, body);
      if (value === undefined) throw new AppError('upstream_error', `Microsoft Graph returned an empty ${what}`);
      return value;
    },
    assertGraphUrl(url, what) {
      if (new URL(url).origin !== origin) {
        throw new AppError('invalid_input', `Refusing ${what} outside the Graph origin`);
      }
    },
  };
}
