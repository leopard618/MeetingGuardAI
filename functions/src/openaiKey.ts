/**
 * OpenAI key at runtime (admin v2 contract — STUB: factories throw until the functions
 * implementer lands them; nothing imports this module yet, so current deploys are unaffected).
 *
 * WHY: key rotation from the admin dashboard (adminRotateOpenAiKey) adds a Secret Manager
 * version at RUNTIME, but the env-bound defineSecret value is frozen per deploy. This module
 * makes the assistant read the secret's "latest" version over Secret Manager REST so a rotation
 * takes effect without a redeploy, while keeping the env value as a fallback so existing deploys
 * (and environments without the IAM grant) keep working.
 *
 * CONTRACT (implementation requirements):
 * - Fetch: GET https://secretmanager.googleapis.com/v1/projects/<project>/secrets/
 *   OPENAI_API_KEY/versions/latest:access with a bearer token from google-auth-library's
 *   GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }) default
 *   credentials (google-auth-library is a declared dependency of firebase-admin — no new dep).
 *   Project id: process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT.
 *   The response payload.data is base64; decode with Buffer.from(data, 'base64').toString('utf8').
 * - Cache: per instance, { key, version, fetchedAt }; TTL OPENAI_KEY_TTL_MS. invalidate() clears
 *   it (called by adminRotateOpenAiKey right after disabling the prior versions).
 * - Fallback: when the REST fetch fails for ANY reason (IAM grant missing, network, quota), use
 *   envFallback() (= OPENAI_API_KEY.value()) and report mode 'env-fallback' / iamReady false.
 *   Unit tests inject a fake SecretVersionAccessor and never touch the network.
 * - 401 retry (withKeyRetry): when a completion fails with UpstreamError kind 'configuration'
 *   and status 401 (the cached key was rotated away by another instance), invalidate(), fetch
 *   once more, rebuild the client with the fresh key, retry the completion ONCE, then rethrow.
 * - SECURITY: the key value never appears in logs, errors, Firestore, responses or status();
 *   log only { mode, version, iamReady } and error CATEGORIES.
 */
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

const NOT_IMPLEMENTED = 'openaiKey: not implemented yet (admin v2 — see docs/ADMIN.md §v2)';

/** Real accessor: google-auth-library default credentials + Secret Manager REST. */
export function googleAuthSecretAccessor(): SecretVersionAccessor {
  throw new Error(NOT_IMPLEMENTED);
}

export function createOpenAiKeyProvider(_deps: {
  accessor: SecretVersionAccessor;
  /** Deploy-frozen fallback: () => OPENAI_API_KEY.value(). */
  envFallback: () => string;
  nowMs?: () => number;
}): OpenAiKeyProvider {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * Wraps an LlmClient factory with the 401-retry contract: on UpstreamError('configuration', 401)
 * invalidate + refetch the key, rebuild the client, retry the completion once, then rethrow.
 */
export function withKeyRetry(_provider: OpenAiKeyProvider, _build: (key: string) => LlmClient): LlmClient {
  throw new Error(NOT_IMPLEMENTED);
}
