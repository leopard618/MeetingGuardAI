import * as logger from 'firebase-functions/logger';

import { UpstreamError } from '../../src/assistant/errors';
import type { LlmClient, LlmRequest, LlmResult } from '../../src/assistant/llm';
import {
  OPENAI_KEY_TTL_MS,
  createOpenAiKeyProvider,
  googleAuthSecretAccessor,
  googleAuthSecretRotator,
  isSecretManagerPermissionDenied,
  withKeyRetry,
  type OpenAiKeyProvider,
  type SecretRestEdge,
  type SecretVersionAccessor,
} from '../../src/openaiKey';

// Hoisted above the imports by ts-jest.
jest.mock('firebase-functions/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const SECRET_KEY = 'sk-test-rest-key-000000000000';

// ---------------------------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------------------------

function scriptedAccessor(
  script: Array<{ value: string; version: string; createTime?: string | null } | Error>,
): { accessor: SecretVersionAccessor; calls: () => number; metadataCalls: () => number } {
  let calls = 0;
  let metadataCalls = 0;
  let lastStep: { value: string; version: string; createTime?: string | null } | null = null;
  const accessor: SecretVersionAccessor = {
    async accessLatest() {
      const step = script[Math.min(calls, script.length - 1)]!;
      calls += 1;
      if (step instanceof Error) throw step;
      lastStep = step;
      return { value: step.value, version: step.version };
    },
    async latestCreateTime() {
      metadataCalls += 1;
      return lastStep?.createTime ?? null;
    },
  };
  return { accessor, calls: () => calls, metadataCalls: () => metadataCalls };
}

function providerWith(
  script: Array<{ value: string; version: string; createTime?: string | null } | Error>,
  options: { envKey?: string } = {},
): {
  provider: OpenAiKeyProvider;
  calls: () => number;
  metadataCalls: () => number;
  envFallback: jest.Mock;
  clock: { now: number };
} {
  const { accessor, calls, metadataCalls } = scriptedAccessor(script);
  const clock = { now: 1_000 };
  const envFallback = jest.fn(() => options.envKey ?? 'sk-env-fallback-key-0000000000');
  const provider = createOpenAiKeyProvider({ accessor, envFallback, nowMs: () => clock.now });
  return { provider, calls, metadataCalls, envFallback, clock };
}

interface EdgeRequest {
  url: string;
  method: string;
  auth: string | undefined;
  body: unknown;
}

/** Fake Secret Manager REST edge: scripted responses, records every request. No network. */
function fakeEdge(responses: Array<{ status: number; json?: unknown }>): { edge: SecretRestEdge; requests: EdgeRequest[] } {
  const requests: EdgeRequest[] = [];
  const fetchFn = (async (url: unknown, init?: RequestInit) => {
    const step = responses[Math.min(requests.length, responses.length - 1)]!;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    requests.push({
      url: String(url),
      method: init?.method ?? 'GET',
      auth: headers.Authorization,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    return {
      ok: step.status >= 200 && step.status < 300,
      status: step.status,
      json: async () => step.json ?? {},
    } as Response;
  }) as unknown as typeof fetch;
  return { edge: { getToken: async () => 'sa-token-1', fetchFn, projectId: () => 'proj-1' }, requests };
}

// ---------------------------------------------------------------------------------------------
// createOpenAiKeyProvider: cache TTL, invalidate, fallback, status
// ---------------------------------------------------------------------------------------------

describe('createOpenAiKeyProvider', () => {
  it('serves the REST key and caches it for the TTL - without ever fetching version metadata', async () => {
    const { provider, calls, metadataCalls, envFallback, clock } = providerWith([{ value: SECRET_KEY, version: '3' }]);
    await expect(provider.get()).resolves.toEqual({ key: SECRET_KEY, source: 'rest', version: '3' });
    clock.now += OPENAI_KEY_TTL_MS - 1;
    await expect(provider.get()).resolves.toEqual({ key: SECRET_KEY, source: 'rest', version: '3' });
    expect(calls()).toBe(1);
    // The cosmetic createTime call belongs to status() (health) only: get() sits on the
    // assistant's request path, where it would add up to one more 5s REST timeout.
    expect(metadataCalls()).toBe(0);
    expect(envFallback).not.toHaveBeenCalled();
  });

  it('refetches after the TTL and picks up a rotation', async () => {
    const { provider, calls, clock } = providerWith([
      { value: SECRET_KEY, version: '3' },
      { value: 'sk-test-rotated-key-0000000000', version: '4' },
    ]);
    await provider.get();
    clock.now += OPENAI_KEY_TTL_MS;
    await expect(provider.get()).resolves.toEqual({
      key: 'sk-test-rotated-key-0000000000',
      source: 'rest',
      version: '4',
    });
    expect(calls()).toBe(2);
  });

  it('invalidate() forces an immediate refetch', async () => {
    const { provider, calls } = providerWith([
      { value: SECRET_KEY, version: '3' },
      { value: 'sk-test-rotated-key-0000000000', version: '4' },
    ]);
    await provider.get();
    provider.invalidate();
    await expect(provider.get()).resolves.toMatchObject({ version: '4' });
    expect(calls()).toBe(2);
  });

  it('falls back to the env key when REST fails, caching the fallback for the TTL too', async () => {
    const { provider, calls, envFallback, clock } = providerWith([new Error('secretmanager_request_failed (403)')]);
    await expect(provider.get()).resolves.toEqual({
      key: 'sk-env-fallback-key-0000000000',
      source: 'env-fallback',
      version: null,
    });
    clock.now += OPENAI_KEY_TTL_MS - 1;
    await provider.get();
    expect(calls()).toBe(1); // negative-cached: no REST retry inside the TTL
    expect(envFallback).toHaveBeenCalledTimes(1);
    // The warn log carries only categories, never the key value.
    expect(logger.warn).toHaveBeenCalledWith('openaiKey.rest_fetch_failed', {
      errorName: 'Error',
      errorMessage: 'secretmanager_request_failed (403)',
    });
  });

  it('recovers from the fallback once REST works again (after invalidate or TTL)', async () => {
    const { provider, clock } = providerWith([
      new Error('secretmanager_request_failed (403)'),
      { value: SECRET_KEY, version: '5' },
    ]);
    await expect(provider.get()).resolves.toMatchObject({ source: 'env-fallback' });
    clock.now += OPENAI_KEY_TTL_MS;
    await expect(provider.get()).resolves.toEqual({ key: SECRET_KEY, source: 'rest', version: '5' });
  });

  it('status() reports rest mode with version, lastRotatedAt and iamReady', async () => {
    const { provider, metadataCalls } = providerWith([{ value: SECRET_KEY, version: '3', createTime: '2026-09-30T10:00:00Z' }]);
    await expect(provider.status()).resolves.toEqual({
      mode: 'rest',
      version: '3',
      lastRotatedAt: '2026-09-30T10:00:00Z',
      iamReady: true,
    });
    // The metadata fetch is cached with the snapshot: a second status() does not refetch.
    await provider.status();
    expect(metadataCalls()).toBe(1);
  });

  it('status() reports lastRotatedAt null (and does not throw) when the metadata call fails', async () => {
    const { accessor } = scriptedAccessor([{ value: SECRET_KEY, version: '3' }]);
    accessor.latestCreateTime = async () => {
      throw new Error('secretmanager_request_failed (503)');
    };
    const provider = createOpenAiKeyProvider({ accessor, envFallback: () => 'sk-env', nowMs: () => 1_000 });
    await expect(provider.status()).resolves.toMatchObject({ mode: 'rest', lastRotatedAt: null });
  });

  it('status() reports env-fallback mode with iamReady false when REST fails - without a metadata call', async () => {
    const { provider, metadataCalls } = providerWith([new Error('secretmanager_request_failed (403)')]);
    await expect(provider.status()).resolves.toEqual({
      mode: 'env-fallback',
      version: null,
      lastRotatedAt: null,
      iamReady: false,
    });
    expect(metadataCalls()).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// withKeyRetry: the 401 path
// ---------------------------------------------------------------------------------------------

function llmRequest(): LlmRequest {
  return { messages: [], tools: [], toolChoice: 'auto', safetyIdentifier: 'abc' };
}

function llmResult(content: string): LlmResult {
  return { content, refusal: null, toolCalls: [], finishReason: 'stop', usage: null };
}

describe('withKeyRetry', () => {
  function scriptedBuild(perKey: Record<string, LlmResult | Error>) {
    const builtWith: string[] = [];
    const build = (key: string): LlmClient => {
      builtWith.push(key);
      return {
        async complete() {
          const outcome = perKey[key];
          if (outcome === undefined) throw new Error(`unscripted key`);
          if (outcome instanceof Error) throw outcome;
          return outcome;
        },
      };
    };
    return { build, builtWith };
  }

  it('completes without retry on success', async () => {
    const { provider, calls } = providerWith([{ value: SECRET_KEY, version: '3' }]);
    const { build, builtWith } = scriptedBuild({ [SECRET_KEY]: llmResult('ok') });
    const client = withKeyRetry(provider, build);
    await expect(client.complete(llmRequest())).resolves.toMatchObject({ content: 'ok' });
    expect(builtWith).toEqual([SECRET_KEY]);
    expect(calls()).toBe(1);
  });

  it('on a 401 invalidates, refetches, rebuilds and retries once with the new key', async () => {
    const { provider, calls } = providerWith([
      { value: SECRET_KEY, version: '3' },
      { value: 'sk-test-rotated-key-0000000000', version: '4' },
    ]);
    const { build, builtWith } = scriptedBuild({
      [SECRET_KEY]: new UpstreamError('configuration', 401),
      'sk-test-rotated-key-0000000000': llmResult('recovered'),
    });
    const client = withKeyRetry(provider, build);
    await expect(client.complete(llmRequest())).resolves.toMatchObject({ content: 'recovered' });
    expect(builtWith).toEqual([SECRET_KEY, 'sk-test-rotated-key-0000000000']);
    expect(calls()).toBe(2); // the invalidate forced the second REST fetch
  });

  it('rethrows the original 401 without a retry when the refetch returns the same key', async () => {
    const error = new UpstreamError('configuration', 401);
    const { provider } = providerWith([{ value: SECRET_KEY, version: '3' }]);
    const { build, builtWith } = scriptedBuild({ [SECRET_KEY]: error });
    const client = withKeyRetry(provider, build);
    await expect(client.complete(llmRequest())).rejects.toBe(error);
    expect(builtWith).toEqual([SECRET_KEY]); // an identical key can only 401 again
  });

  it('rethrows the second error when the retry fails too', async () => {
    const second = new UpstreamError('configuration', 401);
    const { provider } = providerWith([
      { value: SECRET_KEY, version: '3' },
      { value: 'sk-test-rotated-key-0000000000', version: '4' },
    ]);
    const { build } = scriptedBuild({
      [SECRET_KEY]: new UpstreamError('configuration', 401),
      'sk-test-rotated-key-0000000000': second,
    });
    const client = withKeyRetry(provider, build);
    await expect(client.complete(llmRequest())).rejects.toBe(second);
  });

  it.each([
    ['configuration without 401', new UpstreamError('configuration', 403)],
    ['rate_limited', new UpstreamError('rate_limited', 429)],
    ['plain error', new Error('boom')],
  ])('does not retry on %s', async (_name, error) => {
    const { provider, calls } = providerWith([{ value: SECRET_KEY, version: '3' }]);
    const { build, builtWith } = scriptedBuild({ [SECRET_KEY]: error });
    const client = withKeyRetry(provider, build);
    await expect(client.complete(llmRequest())).rejects.toBe(error);
    expect(builtWith).toEqual([SECRET_KEY]);
    expect(calls()).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// googleAuthSecretAccessor / googleAuthSecretRotator (fake edge; no network)
// ---------------------------------------------------------------------------------------------

const VERSION_NAME = 'projects/123/secrets/OPENAI_API_KEY/versions/4';

describe('googleAuthSecretAccessor', () => {
  it('accessLatest makes exactly ONE request (no metadata on the assistant path), decodes base64, trims', async () => {
    const { edge, requests } = fakeEdge([
      { status: 200, json: { name: VERSION_NAME, payload: { data: Buffer.from(`${SECRET_KEY}\n`).toString('base64') } } },
    ]);
    await expect(googleAuthSecretAccessor(edge).accessLatest()).resolves.toEqual({
      value: SECRET_KEY,
      version: '4',
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: 'https://secretmanager.googleapis.com/v1/projects/proj-1/secrets/OPENAI_API_KEY/versions/latest:access',
      method: 'GET',
      auth: 'Bearer sa-token-1',
    });
  });

  it('latestCreateTime reads the version metadata (health path only)', async () => {
    const { edge, requests } = fakeEdge([
      { status: 200, json: { name: VERSION_NAME, createTime: '2026-09-30T10:00:00Z', state: 'ENABLED' } },
    ]);
    await expect(googleAuthSecretAccessor(edge).latestCreateTime()).resolves.toBe('2026-09-30T10:00:00Z');
    expect(requests[0]!.url).toBe(
      'https://secretmanager.googleapis.com/v1/projects/proj-1/secrets/OPENAI_API_KEY/versions/latest',
    );
  });

  it('latestCreateTime resolves null when the metadata call is denied (versions.get needs secretVersionManager)', async () => {
    const { edge } = fakeEdge([{ status: 403 }]);
    await expect(googleAuthSecretAccessor(edge).latestCreateTime()).resolves.toBeNull();
  });

  it('throws a status-only category error on IAM denial (never a response body)', async () => {
    const { edge } = fakeEdge([{ status: 403, json: { error: { message: 'Permission denied on secret' } } }]);
    await expect(googleAuthSecretAccessor(edge).accessLatest()).rejects.toThrow('secretmanager_request_failed (403)');
  });

  it('rejects a malformed access response', async () => {
    const { edge } = fakeEdge([{ status: 200, json: { name: VERSION_NAME, payload: {} } }]);
    await expect(googleAuthSecretAccessor(edge).accessLatest()).rejects.toThrow('secretmanager_access_malformed');
  });
});

describe('isSecretManagerPermissionDenied', () => {
  it('matches only the self-crafted 403 category', () => {
    expect(isSecretManagerPermissionDenied(new Error('secretmanager_request_failed (403)'))).toBe(true);
    expect(isSecretManagerPermissionDenied(new Error('secretmanager_request_failed (500)'))).toBe(false);
    expect(isSecretManagerPermissionDenied(new Error('some (403) elsewhere'))).toBe(false);
    expect(isSecretManagerPermissionDenied('secretmanager_request_failed (403)')).toBe(false);
  });
});

describe('googleAuthSecretRotator', () => {
  it('addVersion posts the base64 payload and returns the bare version number', async () => {
    const { edge, requests } = fakeEdge([{ status: 200, json: { name: VERSION_NAME, state: 'ENABLED' } }]);
    await expect(googleAuthSecretRotator(edge).addVersion(SECRET_KEY)).resolves.toEqual({ version: '4' });
    expect(requests[0]).toMatchObject({
      url: 'https://secretmanager.googleapis.com/v1/projects/proj-1/secrets/OPENAI_API_KEY:addVersion',
      method: 'POST',
      body: { payload: { data: Buffer.from(SECRET_KEY).toString('base64') } },
    });
  });

  it('listEnabledVersions filters ENABLED across pages', async () => {
    const base = 'projects/123/secrets/OPENAI_API_KEY/versions';
    const { edge, requests } = fakeEdge([
      {
        status: 200,
        json: {
          versions: [
            { name: `${base}/4`, state: 'ENABLED' },
            { name: `${base}/3`, state: 'DISABLED' },
          ],
          nextPageToken: 'page2',
        },
      },
      { status: 200, json: { versions: [{ name: `${base}/2`, state: 'ENABLED' }] } },
    ]);
    await expect(googleAuthSecretRotator(edge).listEnabledVersions()).resolves.toEqual(['4', '2']);
    expect(requests[1]!.url).toContain('?pageToken=page2');
  });

  it('disableVersion posts :disable for the given version', async () => {
    const { edge, requests } = fakeEdge([{ status: 200, json: {} }]);
    await googleAuthSecretRotator(edge).disableVersion('3');
    expect(requests[0]).toMatchObject({
      url: 'https://secretmanager.googleapis.com/v1/projects/proj-1/secrets/OPENAI_API_KEY/versions/3:disable',
      method: 'POST',
    });
  });

  it('surfaces a status-only error when addVersion is denied', async () => {
    const { edge } = fakeEdge([{ status: 403 }]);
    await expect(googleAuthSecretRotator(edge).addVersion(SECRET_KEY)).rejects.toThrow('secretmanager_request_failed (403)');
  });
});
