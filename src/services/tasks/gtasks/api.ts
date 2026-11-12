/**
 * Minimal Google Tasks API v1 client (fetch + Bearer token from the auth service), modelled on
 * src/services/calendar/google/api.ts.
 *
 * - 401: invalidates the token (GoogleSignin.clearCachedAccessToken via the auth service), fetches
 *   a fresh one and retries ONCE.
 * - 429, 5xx and 403 rate-limit reasons: exponential backoff with jitter (honours Retry-After).
 * - Every failure becomes an AppError whose details carry { status, reason } (never tokens); the
 *   sync reads the status with googleTasksHttpStatus (404 = the copy is gone).
 */
import { AppError, isAppError, type AppErrorCode } from '../../../core/errors';
import type { GoogleTokenProvider } from '../../calendar/google/api';
import type { GoogleTask, GoogleTaskList, GoogleTaskListPage, GoogleTaskPage, GoogleTaskWrite } from './types';

export type { GoogleTokenProvider } from '../../calendar/google/api';

export const GOOGLE_TASKS_API_BASE = 'https://tasks.googleapis.com/tasks/v1';
/** API maximum for both listings. */
export const PAGE_SIZE = 100;
/** Caps a runaway listing (100 pages = 10 000 tasks per list). */
export const MAX_PAGES = 100;

export interface GoogleTasksApiOptions {
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

export interface ListTasksParams {
  /** RFC 3339: only tasks modified after this instant (incremental pull). */
  updatedMin?: string;
  pageToken?: string;
}

export interface GoogleTasksApi {
  /** Every task list of the account (all pages). */
  listLists(): Promise<GoogleTaskList[]>;
  /** One page of a list's tasks, deleted and hidden ones included. */
  listTasks(listId: string, params: ListTasksParams): Promise<GoogleTaskPage>;
  getTask(listId: string, taskId: string): Promise<GoogleTask>;
  createTask(listId: string, body: GoogleTaskWrite): Promise<GoogleTask>;
  patchTask(listId: string, taskId: string, body: GoogleTaskWrite): Promise<GoogleTask>;
  deleteTask(listId: string, taskId: string): Promise<void>;
}

interface ErrorInfo {
  status: number;
  reason: string | null;
  retryAfterMs: number | null;
}

/** HTTP status of a Google Tasks failure (null for non-HTTP errors). */
export function googleTasksHttpStatus(error: unknown): number | null {
  if (!isAppError(error)) return null;
  const status = error.details?.status;
  return typeof status === 'number' ? status : null;
}

const RATE_LIMIT_REASONS: ReadonlySet<string> = new Set(['rateLimitExceeded', 'userRateLimitExceeded']);
const SCOPE_REASONS: ReadonlySet<string> = new Set(['insufficientPermissions', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT']);

function isRetryable(info: ErrorInfo): boolean {
  if (info.status === 429 || info.status >= 500) return true;
  return info.status === 403 && info.reason !== null && RATE_LIMIT_REASONS.has(info.reason);
}

function codeFor(info: ErrorInfo): AppErrorCode {
  switch (info.status) {
    case 400:
      return 'invalid_input';
    case 401:
      return 'unauthenticated';
    case 403:
      if (info.reason !== null && SCOPE_REASONS.has(info.reason)) return 'tasks_scope_missing';
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

async function readErrorInfo(response: Response): Promise<ErrorInfo> {
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

export function createGoogleTasksApi(options: GoogleTasksApiOptions): GoogleTasksApi {
  const fetchImpl = options.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxRetries = options.maxRetries ?? 3;
  const base = options.baseUrl ?? GOOGLE_TASKS_API_BASE;

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
        throw new AppError('timeout', 'Google Tasks request timed out', { cause: error });
      }
      throw new AppError('offline', 'Google Tasks is unreachable', { cause: error });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    query: Record<string, string | number | boolean | undefined | null>,
    body?: unknown,
  ): Promise<T | undefined> {
    const url = buildUrl(base, path, query);
    const headers: Record<string, string> = { Accept: 'application/json' };
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
          throw new AppError('upstream_error', 'Google Tasks returned invalid JSON', { cause: error, details: { status: response.status } });
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
      throw new AppError(codeFor(info), `Google Tasks ${method} failed with HTTP ${info.status}`, {
        details: { status: info.status, reason: info.reason, method },
        retryable: isRetryable(info),
      });
    }
  }

  function tasksPath(listId: string, taskId?: string): string {
    const root = `/lists/${encodeURIComponent(listId)}/tasks`;
    return taskId === undefined ? root : `${root}/${encodeURIComponent(taskId)}`;
  }

  async function required<T>(promise: Promise<T | undefined>, what: string): Promise<T> {
    const value = await promise;
    if (value === undefined) throw new AppError('upstream_error', `Google Tasks returned an empty ${what}`);
    return value;
  }

  return {
    async listLists() {
      const lists: GoogleTaskList[] = [];
      let pageToken: string | undefined;
      for (let count = 0; count < MAX_PAGES; count += 1) {
        const page = await required(request<GoogleTaskListPage>('GET', '/users/@me/lists', { maxResults: PAGE_SIZE, pageToken }), 'task list page');
        lists.push(...(page.items ?? []));
        pageToken = page.nextPageToken;
        if (pageToken === undefined) return lists;
      }
      throw new AppError('upstream_error', 'Google Tasks returned too many task list pages', { details: { pages: MAX_PAGES } });
    },
    listTasks(listId, params) {
      return required(
        request<GoogleTaskPage>('GET', tasksPath(listId), {
          maxResults: PAGE_SIZE,
          showCompleted: true,
          showHidden: true,
          showDeleted: true,
          updatedMin: params.updatedMin,
          pageToken: params.pageToken,
        }),
        'task page',
      );
    },
    getTask(listId, taskId) {
      return required(request<GoogleTask>('GET', tasksPath(listId, taskId), {}), 'task');
    },
    createTask(listId, body) {
      return required(request<GoogleTask>('POST', tasksPath(listId), {}, body), 'task');
    },
    patchTask(listId, taskId, body) {
      return required(request<GoogleTask>('PATCH', tasksPath(listId, taskId), {}, body), 'task');
    },
    async deleteTask(listId, taskId) {
      await request<void>('DELETE', tasksPath(listId, taskId), {});
    },
  };
}
