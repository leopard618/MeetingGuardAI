/**
 * OpenAI key at runtime (admin v2; spec in docs/ADMIN.md §v2).
 *
 * WHY: key rotation from the admin dashboard (adminRotateOpenAiKey) adds a Secret Manager
 * version at RUNTIME, but the env-bound defineSecret value is frozen per deploy. This module
 * makes the assistant read the secret's "latest" version over Secret Manager REST so a rotation
 * takes effect without a redeploy, while keeping the env value as a fallback so existing deploys
 * (and environments without the IAM grant) keep working.
 *
 * IAM: the REST path needs roles/secretmanager.secretAccessor (read) and, for rotation,
 * roles/secretmanager.secretVersionManager on this ONE secret for the runtime service account
 * (owner-run once; exact commands in functions/README.md "OpenAI key rotation"). Until granted,
 * every fetch falls back to the env value and status() reports iamReady: false.
 *
 * SECURITY (grep: never-log-openai-key): the key value never appears in logs, errors, Firestore,
 * responses or status(); logs carry only { mode, version, iamReady } and error CATEGORIES, and
 * the errors thrown here are self-crafted category strings, never upstream response bodies.
 */
import * as logger from 'firebase-functions/logger';
import { GoogleAuth } from 'google-auth-library';

import { OPENAI_API_KEY } from './config';
import { UpstreamError } from './assistant/errors';
import type { LlmClient } from './assistant/llm';

export const OPENAI_KEY_SECRET_NAME = 'OPENAI_API_KEY';

/** Cache TTL: a rotation on another instance is picked up within 5 minutes (or on 401-retry). */
export const OPENAI_KEY_TTL_MS = 5 * 60_000;

export interface OpenAiKeySnapshot {
  key: string;
  source: 'rest' | 'env-fallback';
  /** Bare Secret Manager version number (e.g. "3"); null on the env fallback. */
  version: string | null;
}

/** What adminGetHealth reports as secretRuntime (never the key value). */
export interface OpenAiKeyStatus {
  mode: 'rest' | 'env-fallback';
  version: string | null;
  /** createTime of the latest enabled version (ISO), null when unknown. */
  lastRotatedAt: string | null;
  /** false until the runtime SA holds secretAccessor (+ secretVersionManager for rotation). */
  iamReady: boolean;
}

/** Injected REST edge (real: GoogleAuth + fetch; tests: fakes — no network in unit tests). */
export interface SecretVersionAccessor {
  /** Resolves the latest ENABLED version's value; throws on IAM/network/API failure. */
  accessLatest(): Promise<{ value: string; version: string; createTime: string | null }>;
}

export interface OpenAiKeyProvider {
  /** Cached key (REST, TTL OPENAI_KEY_TTL_MS), or the env fallback when REST fails. */
  get(): Promise<OpenAiKeySnapshot>;
  /** Drops the cache so the next get() refetches (called after a rotation). */
  invalidate(): void;
  /** Health view for adminGetHealth; probes REST when the cache is cold. */
  status(): Promise<OpenAiKeyStatus>;
}

// ---------------------------------------------------------------------------------------------
// Secret Manager REST edge (GoogleAuth default credentials; injectable for unit tests)
// ---------------------------------------------------------------------------------------------

const SECRET_MANAGER_BASE = 'https://secretmanager.googleapis.com/v1';
/** Per-request cap for Secret Manager REST (a cold key fetch sits on the user's request path). */
export const SECRET_REST_TIMEOUT_MS = 5_000;

/** The three injected effects of the REST edge; tests fake all of them (no network). */
export interface SecretRestEdge {
  /** Bearer token for Secret Manager (cloud-platform scope). */
  getToken(): Promise<string>;
  fetchFn: typeof fetch;
  /** GCP project id of the secret (the function's own project). */
  projectId(): string;
}

function runtimeProjectId(): string {
  const projectId = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId) throw new Error('secretmanager_project_unknown');
  return projectId;
}

/**
 * Real edge: google-auth-library default credentials (a declared dependency of firebase-admin —
 * no new package) with the cloud-platform scope the Secret Manager API requires.
 */
function googleAuthEdge(): SecretRestEdge {
  let auth: GoogleAuth | null = null;
  return {
    async getToken() {
      auth ??= new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
      const token = await auth.getAccessToken();
      if (!token) throw new Error('secretmanager_token_unavailable');
      return token;
    },
    fetchFn: fetch,
    projectId: runtimeProjectId,
  };
}

/**
 * One Secret Manager REST call. Non-2xx throws a CATEGORY error with the status only — the
 * response body is never read, so no upstream text can leak into logs (never-log-openai-key).
 */
async function secretRest(edge: SecretRestEdge, method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
  const token = await edge.getToken();
  const response = await edge.fetchFn(`${SECRET_MANAGER_BASE}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(SECRET_REST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`secretmanager_request_failed (${response.status})`);
  return response.json();
}

function secretPathOf(edge: SecretRestEdge): string {
  return `projects/${edge.projectId()}/secrets/${OPENAI_KEY_SECRET_NAME}`;
}

/** "projects/<n>/secrets/<name>/versions/4" -> "4" (empty string when malformed). */
function bareVersionOf(name: unknown): string {
  if (typeof name !== 'string') return '';
  return name.split('/').pop() ?? '';
}

/** Real accessor: google-auth-library default credentials + Secret Manager REST. */
export function googleAuthSecretAccessor(edge: SecretRestEdge = googleAuthEdge()): SecretVersionAccessor {
  return {
    async accessLatest() {
      const secretPath = secretPathOf(edge);
      const accessed = (await secretRest(edge, 'GET', `${secretPath}/versions/latest:access`)) as {
        name?: unknown;
        payload?: { data?: unknown };
      };
      const version = bareVersionOf(accessed.name);
      const data = typeof accessed.payload?.data === 'string' ? accessed.payload.data : '';
      // Trimmed: a trailing newline from `firebase functions:secrets:set` would break the
      // Authorization header. Real keys never contain whitespace.
      const value = Buffer.from(data, 'base64').toString('utf8').trim();
      if (version.length === 0 || value.length === 0) throw new Error('secretmanager_access_malformed');
      // createTime is cosmetic (health's lastRotatedAt) and versions.get is NOT part of
      // secretAccessor (it comes with secretVersionManager), so a denial must not break the fetch.
      let createTime: string | null = null;
      try {
        const metadata = (await secretRest(edge, 'GET', `${secretPath}/versions/latest`)) as { createTime?: unknown };
        if (typeof metadata.createTime === 'string') createTime = metadata.createTime;
      } catch {
        // Key fetch succeeded; lastRotatedAt stays null.
      }
      return { value, version, createTime };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Rotation edge (adminRotateOpenAiKey): addVersion + disable prior enabled versions
// ---------------------------------------------------------------------------------------------

export interface SecretRotator {
  /** Secret Manager addVersion; resolves the new BARE version number (e.g. "4"). */
  addVersion(value: string): Promise<{ version: string }>;
  /** Bare numbers of every currently ENABLED version. */
  listEnabledVersions(): Promise<string[]>;
  disableVersion(version: string): Promise<void>;
}

export function googleAuthSecretRotator(edge: SecretRestEdge = googleAuthEdge()): SecretRotator {
  return {
    async addVersion(value) {
      const added = (await secretRest(edge, 'POST', `${secretPathOf(edge)}:addVersion`, {
        payload: { data: Buffer.from(value, 'utf8').toString('base64') },
      })) as { name?: unknown };
      const version = bareVersionOf(added.name);
      if (version.length === 0) throw new Error('secretmanager_add_malformed');
      return { version };
    },
    async listEnabledVersions() {
      const enabled: string[] = [];
      let pageToken: string | null = null;
      do {
        const query: string = pageToken === null ? '' : `?pageToken=${encodeURIComponent(pageToken)}`;
        const page = (await secretRest(edge, 'GET', `${secretPathOf(edge)}/versions${query}`)) as {
          versions?: Array<{ name?: unknown; state?: unknown }>;
          nextPageToken?: unknown;
        };
        for (const version of page.versions ?? []) {
          if (version.state !== 'ENABLED') continue;
          const bare = bareVersionOf(version.name);
          if (bare.length > 0) enabled.push(bare);
        }
        pageToken = typeof page.nextPageToken === 'string' && page.nextPageToken.length > 0 ? page.nextPageToken : null;
      } while (pageToken !== null);
      return enabled;
    },
    async disableVersion(version) {
      await secretRest(edge, 'POST', `${secretPathOf(edge)}/versions/${encodeURIComponent(version)}:disable`);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Provider (per-instance cache + env fallback)
// ---------------------------------------------------------------------------------------------

export function createOpenAiKeyProvider(deps: {
  accessor: SecretVersionAccessor;
  /** Deploy-frozen fallback: () => OPENAI_API_KEY.value(). */
  envFallback: () => string;
  nowMs?: () => number;
}): OpenAiKeyProvider {
  const nowMs = deps.nowMs ?? (() => Date.now());
  /** Fallback results are cached too (negative caching): a missing IAM grant must not add a
   *  failing REST round trip to every assistant request. The TTL bounds the recovery time. */
  let cached: { snapshot: OpenAiKeySnapshot; createTime: string | null; fetchedAt: number } | null = null;

  async function ensure(): Promise<{ snapshot: OpenAiKeySnapshot; createTime: string | null }> {
    if (cached && nowMs() - cached.fetchedAt < OPENAI_KEY_TTL_MS) return cached;
    try {
      const latest = await deps.accessor.accessLatest();
      cached = {
        snapshot: { key: latest.value, source: 'rest', version: latest.version },
        createTime: latest.createTime,
        fetchedAt: nowMs(),
      };
    } catch (error) {
      // Category only (never-log-openai-key): our accessor errors are self-crafted strings.
      logger.warn('openaiKey.rest_fetch_failed', {
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: error instanceof Error ? error.message.slice(0, 200) : '',
      });
      cached = {
        snapshot: { key: deps.envFallback(), source: 'env-fallback', version: null },
        createTime: null,
        fetchedAt: nowMs(),
      };
    }
    return cached;
  }

  return {
    async get() {
      return (await ensure()).snapshot;
    },
    invalidate() {
      cached = null;
    },
    async status() {
      const entry = await ensure();
      return {
        mode: entry.snapshot.source,
        version: entry.snapshot.version,
        lastRotatedAt: entry.createTime,
        // REST working implies the accessor grant is in place; any REST failure (IAM missing,
        // network, quota) reports false and the dashboard shows the grant commands.
        iamReady: entry.snapshot.source === 'rest',
      };
    },
  };
}

/** One provider per function instance (assistant and each admin callable deploy separately, so a
 *  rotation's invalidate() only clears its own instance; others refresh via TTL or 401-retry). */
let instanceProvider: OpenAiKeyProvider | null = null;
export function instanceOpenAiKeyProvider(): OpenAiKeyProvider {
  instanceProvider ??= createOpenAiKeyProvider({
    accessor: googleAuthSecretAccessor(),
    // Only read when REST fails, inside an invocation of a function that binds the secret.
    envFallback: () => OPENAI_API_KEY.value(),
  });
  return instanceProvider;
}

// ---------------------------------------------------------------------------------------------
// 401 retry (the cached key was rotated away by another instance)
// ---------------------------------------------------------------------------------------------

/**
 * Wraps an LlmClient factory with the 401-retry contract: on UpstreamError('configuration', 401)
 * invalidate + refetch the key, rebuild the client, retry the completion once, then rethrow.
 * When the refetch yields the SAME key (REST still down, env fallback), the retry is skipped and
 * the original error is rethrown — an identical key can only 401 again.
 */
export function withKeyRetry(provider: OpenAiKeyProvider, build: (key: string) => LlmClient): LlmClient {
  return {
    async complete(request) {
      const first = await provider.get();
      try {
        return await build(first.key).complete(request);
      } catch (error) {
        const rotatedAway = error instanceof UpstreamError && error.kind === 'configuration' && error.status === 401;
        if (!rotatedAway) throw error;
        provider.invalidate();
        const second = await provider.get();
        if (second.key === first.key) throw error;
        return await build(second.key).complete(request);
      }
    },
  };
}
