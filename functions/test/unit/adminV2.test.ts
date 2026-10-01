import * as logger from 'firebase-functions/logger';
import { HttpsError } from 'firebase-functions/https';

import {
  handleGetHealth,
  handleGetStats,
  handleRotateOpenAiKey,
  statsDayKeys,
  sumAdminStatsDayDocs,
  type AdminCaller,
  type AdminHealthPorts,
  type AdminRotatePorts,
  type AdminStatsPorts,
  type AssistantPingResult,
} from '../../src/admin';
import {
  getHealthResponseSchema,
  getStatsResponseSchema,
  rotateOpenAiKeyResponseSchema,
} from '../../src/admin/schemas';
import type { OpenAiKeyStatus } from '../../src/openaiKey';

// Hoisted above the imports by ts-jest.
jest.mock('firebase-functions/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const admin: AdminCaller = { uid: 'admin-1', isAdmin: true };
const mortal: AdminCaller = { uid: 'user-1', isAdmin: false };
const now = new Date('2026-09-30T12:00:00.000Z');

// ---------------------------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------------------------

interface StatsFakeOptions {
  dayDocs?: Record<string, unknown>;
  creationTimes?: string[];
  pricing?: { inPerM: number; outPerM: number };
}

function fakeStatsPorts(options: StatsFakeOptions = {}) {
  const calls: string[] = [];
  const ports: AdminStatsPorts = {
    getStatsDays: jest.fn(async (dayKeys: string[]) => {
      calls.push(`days:${dayKeys.length}`);
      const map = new Map<string, unknown>();
      for (const key of dayKeys) {
        if (options.dayDocs && key in options.dayDocs) map.set(key, options.dayDocs[key]);
      }
      return map;
    }),
    listAuthCreationTimes: jest.fn(async () => {
      calls.push('creationTimes');
      return options.creationTimes ?? [];
    }),
    pricing: jest.fn(() => options.pricing ?? { inPerM: 0, outPerM: 0 }),
  };
  return { ports, calls };
}

const REST_STATUS: OpenAiKeyStatus = {
  mode: 'rest',
  version: '4',
  lastRotatedAt: '2026-09-29T10:00:00Z',
  iamReady: true,
};

function fakeHealthPorts(options: { status?: OpenAiKeyStatus; ping?: AssistantPingResult } = {}) {
  const calls: string[] = [];
  const ports: AdminHealthPorts = {
    runtimeConfig: jest.fn(() => {
      calls.push('config');
      return { model: 'gpt-5.4-mini', reasoningEffort: 'low', globalDailyLimit: 5000 };
    }),
    keyStatus: jest.fn(async () => {
      calls.push('status');
      return options.status ?? REST_STATUS;
    }),
    pingAssistant: jest.fn(async () => {
      calls.push('ping');
      return options.ping ?? { ok: true, latencyMs: 420 };
    }),
  };
  return { ports, calls };
}

const NEW_KEY = 'sk-test-new-key-000000000000000000';

interface RotateFakeOptions {
  status?: number;
  modelIds?: string[];
  networkError?: Error;
  newVersion?: string;
  enabledVersions?: string[];
  addError?: Error;
  listError?: Error;
  disableError?: Error;
}

function fakeRotatePorts(options: RotateFakeOptions = {}) {
  const calls: string[] = [];
  const ports: AdminRotatePorts = {
    fetchOpenAiModels: jest.fn(async (candidateKey: string) => {
      calls.push(`validate:${candidateKey === NEW_KEY ? 'candidate' : 'OTHER'}`);
      if (options.networkError) throw options.networkError;
      return { status: options.status ?? 200, modelIds: options.modelIds ?? ['gpt-5.4-mini', 'gpt-4.1-mini'] };
    }),
    configuredModel: jest.fn(() => 'gpt-5.4-mini'),
    addSecretVersion: jest.fn(async (value: string) => {
      calls.push(`add:${value === NEW_KEY ? 'candidate' : 'OTHER'}`);
      if (options.addError) throw options.addError;
      return { version: options.newVersion ?? '5' };
    }),
    listEnabledSecretVersions: jest.fn(async () => {
      calls.push('list');
      if (options.listError) throw options.listError;
      return options.enabledVersions ?? [options.newVersion ?? '5'];
    }),
    disableSecretVersion: jest.fn(async (version: string) => {
      calls.push(`disable:${version}`);
      if (options.disableError) throw options.disableError;
    }),
    invalidateKeyCache: jest.fn(() => {
      calls.push('invalidate');
    }),
  };
  return { ports, calls };
}

// ---------------------------------------------------------------------------------------------
// Auth enforcement (before any port is touched)
// ---------------------------------------------------------------------------------------------

describe('every v2 handler enforces auth before touching any port', () => {
  const handlers: Array<[string, (caller: AdminCaller | null) => { run: Promise<unknown>; calls: string[] }]> = [
    [
      'adminGetStats',
      (caller) => {
        const { ports, calls } = fakeStatsPorts();
        return { run: handleGetStats(caller, { days: 7 }, ports, now), calls };
      },
    ],
    [
      'adminGetHealth',
      (caller) => {
        const { ports, calls } = fakeHealthPorts();
        return { run: handleGetHealth(caller, { ping: true }, ports), calls };
      },
    ],
    [
      'adminRotateOpenAiKey',
      (caller) => {
        const { ports, calls } = fakeRotatePorts();
        return { run: handleRotateOpenAiKey(caller, { newKey: NEW_KEY }, ports), calls };
      },
    ],
  ];

  it.each(handlers)('%s', async (_name, make) => {
    const unauthenticated = make(null);
    await expect(unauthenticated.run).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(unauthenticated.calls).toEqual([]);
    const denied = make(mortal);
    await expect(denied.run).rejects.toMatchObject({ code: 'permission-denied' });
    expect(denied.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// adminGetStats
// ---------------------------------------------------------------------------------------------

describe('handleGetStats', () => {
  it('returns exactly `days` zero-filled entries, oldest -> newest, ending today (UTC)', async () => {
    const { ports } = fakeStatsPorts();
    const response = await handleGetStats(admin, { days: 7 }, ports, now);
    expect(getStatsResponseSchema.parse(response)).toEqual(response);
    expect(response.days.map((day) => day.date)).toEqual([
      '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30',
    ]);
    expect(response.days.every((day) => day.requests === 0 && day.inputTokens === 0 && day.outputTokens === 0)).toBe(true);
    expect(response.signups.map((day) => day.date)).toEqual(response.days.map((day) => day.date));
    expect(response.totals).toEqual({ requests: 0, inputTokens: 0, outputTokens: 0, signups: 0 });
    expect(response.estCostUsd).toBeNull();
    expect(response.pricing).toEqual({ inPerM: 0, outPerM: 0, source: 'param' });
  });

  it('merges day documents, zero-fills gaps, and tolerates malformed documents', async () => {
    const { ports } = fakeStatsPorts({
      dayDocs: {
        '2026-09-28': { requests: 3, inputTokens: 1200, outputTokens: 480, updatedAt: 'x' },
        '2026-09-30': { requests: 'nonsense', inputTokens: 100, outputTokens: -5, updatedAt: 'x' }, // bad fields -> 0
        '2026-09-29': 'garbage', // not even an object -> zeros
      },
    });
    const response = await handleGetStats(admin, { days: 7 }, ports, now);
    expect(response.days[4]).toEqual({ date: '2026-09-28', requests: 3, inputTokens: 1200, outputTokens: 480 });
    expect(response.days[5]).toEqual({ date: '2026-09-29', requests: 0, inputTokens: 0, outputTokens: 0 });
    expect(response.days[6]).toEqual({ date: '2026-09-30', requests: 0, inputTokens: 100, outputTokens: 0 });
    expect(response.totals).toMatchObject({ requests: 3, inputTokens: 1300, outputTokens: 480 });
  });

  it('buckets signups per UTC day and ignores times outside the range or unparsable', async () => {
    const { ports } = fakeStatsPorts({
      creationTimes: [
        '2026-09-30T00:00:01.000Z',
        '2026-09-30T23:59:59.000Z',
        '2026-09-29T23:59:59.000Z', // 30th in UTC+2, but bucketing is UTC
        '2026-09-01T12:00:00.000Z', // before the 7-day range
        'not-a-date',
      ],
    });
    const response = await handleGetStats(admin, { days: 7 }, ports, now);
    expect(response.signups[5]).toEqual({ date: '2026-09-29', count: 1 });
    expect(response.signups[6]).toEqual({ date: '2026-09-30', count: 2 });
    expect(response.totals.signups).toBe(3); // the out-of-range signup is not in the totals
  });

  it('computes estCostUsd from the pricing params, rounded to 4 decimals', async () => {
    const { ports } = fakeStatsPorts({
      dayDocs: { '2026-09-30': { requests: 1, inputTokens: 1_234_567, outputTokens: 2_000_000, updatedAt: 'x' } },
      pricing: { inPerM: 0.15, outPerM: 0.6 },
    });
    const response = await handleGetStats(admin, { days: 7 }, ports, now);
    // 1.234567 * 0.15 + 2 * 0.6 = 1.38518505 -> 1.3852
    expect(response.estCostUsd).toBe(1.3852);
    expect(response.pricing).toEqual({ inPerM: 0.15, outPerM: 0.6, source: 'param' });
  });

  it('prices one-sided configurations instead of hiding them', async () => {
    const { ports } = fakeStatsPorts({
      dayDocs: { '2026-09-30': { requests: 1, inputTokens: 1_000_000, outputTokens: 1_000_000, updatedAt: 'x' } },
      pricing: { inPerM: 0, outPerM: 2 },
    });
    await expect(handleGetStats(admin, { days: 7 }, ports, now)).resolves.toMatchObject({ estCostUsd: 2 });
  });

  it('supports the 90-day range', async () => {
    const { ports } = fakeStatsPorts();
    const response = await handleGetStats(admin, { days: 90 }, ports, now);
    expect(response.days).toHaveLength(90);
    expect(response.days[0]!.date).toBe('2026-07-03');
    expect(response.days[89]!.date).toBe('2026-09-30');
  });

  it('rejects anything but the four literal ranges', async () => {
    const { ports, calls } = fakeStatsPorts();
    for (const bad of [{ days: 10 }, { days: '7' }, {}, null, undefined, { days: -7 }]) {
      await expect(handleGetStats(admin, bad, ports, now)).rejects.toMatchObject({ code: 'invalid-argument' });
    }
    expect(calls).toEqual([]);
  });

  it('wraps unexpected port failures as internal', async () => {
    const { ports } = fakeStatsPorts();
    (ports.listAuthCreationTimes as jest.Mock).mockRejectedValue(new Error('auth outage'));
    await expect(handleGetStats(admin, { days: 7 }, ports, now)).rejects.toMatchObject({ code: 'internal' });
  });

  it('statsDayKeys crosses month boundaries', () => {
    expect(statsDayKeys(new Date('2026-10-02T05:00:00.000Z'), 4)).toEqual([
      '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02',
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// adminGetHealth
// ---------------------------------------------------------------------------------------------

describe('handleGetHealth', () => {
  it('reports config and secret runtime without pinging by default', async () => {
    const { ports, calls } = fakeHealthPorts();
    for (const data of [undefined, null, {}, { ping: false }]) {
      const response = await handleGetHealth(admin, data, ports);
      expect(getHealthResponseSchema.parse(response)).toEqual(response);
      expect(response).toEqual({
        model: 'gpt-5.4-mini',
        reasoningEffort: 'low',
        globalDailyLimit: 5000,
        secretRuntime: REST_STATUS,
      });
      expect(response).not.toHaveProperty('assistantPing');
    }
    expect(calls).not.toContain('ping');
  });

  it('pings only on ping:true and embeds the result', async () => {
    const { ports } = fakeHealthPorts({ ping: { ok: false, latencyMs: 1200, error: 'configuration (401)' } });
    const response = await handleGetHealth(admin, { ping: true }, ports);
    expect(getHealthResponseSchema.parse(response)).toEqual(response);
    expect(response.assistantPing).toEqual({ ok: false, latencyMs: 1200, error: 'configuration (401)' });
    expect(ports.pingAssistant).toHaveBeenCalledTimes(1);
  });

  it('surfaces the env-fallback / IAM-missing state', async () => {
    const { ports } = fakeHealthPorts({
      status: { mode: 'env-fallback', version: null, lastRotatedAt: null, iamReady: false },
    });
    const response = await handleGetHealth(admin, {}, ports);
    expect(response.secretRuntime).toEqual({ mode: 'env-fallback', version: null, lastRotatedAt: null, iamReady: false });
  });

  it('rejects an invalid payload', async () => {
    const { ports, calls } = fakeHealthPorts();
    await expect(handleGetHealth(admin, { ping: 'yes' }, ports)).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// adminRotateOpenAiKey
// ---------------------------------------------------------------------------------------------

describe('handleRotateOpenAiKey', () => {
  it('validates, stores, disables the prior enabled versions and busts the cache - in that order', async () => {
    const { ports, calls } = fakeRotatePorts({ newVersion: '5', enabledVersions: ['3', '4', '5'] });
    const response = await handleRotateOpenAiKey(admin, { newKey: NEW_KEY }, ports);
    expect(rotateOpenAiKeyResponseSchema.parse(response)).toEqual(response);
    expect(response).toEqual({ ok: true, version: '5', modelAvailable: true });
    expect(calls).toEqual(['validate:candidate', 'add:candidate', 'list', 'disable:3', 'disable:4', 'invalidate']);
  });

  it('trims the pasted key before using it', async () => {
    const { ports } = fakeRotatePorts();
    await handleRotateOpenAiKey(admin, { newKey: `  ${NEW_KEY}\n` }, ports);
    expect(ports.fetchOpenAiModels).toHaveBeenCalledWith(NEW_KEY);
    expect(ports.addSecretVersion).toHaveBeenCalledWith(NEW_KEY);
  });

  it('warns but does not block when the configured model is missing from the key', async () => {
    const { ports } = fakeRotatePorts({ modelIds: ['gpt-4.1-mini'] });
    await expect(handleRotateOpenAiKey(admin, { newKey: NEW_KEY }, ports)).resolves.toMatchObject({
      ok: true,
      modelAvailable: false,
    });
    expect(logger.warn).toHaveBeenCalledWith('adminRotateOpenAiKey.model_missing', { model: 'gpt-5.4-mini' });
    expect(ports.addSecretVersion).toHaveBeenCalled();
  });

  it('disables only numerically LOWER versions, so a concurrent rotation\'s newer version survives', async () => {
    // Interleaved rotations: this call added 5 while another admin already added 6. Disabling
    // "everything except my own" would kill 6 (the live 'latest'); newest-wins keeps it.
    const { ports, calls } = fakeRotatePorts({ newVersion: '5', enabledVersions: ['4', '5', '6'] });
    await expect(handleRotateOpenAiKey(admin, { newKey: NEW_KEY }, ports)).resolves.toMatchObject({
      ok: true,
      version: '5',
    });
    expect(calls).toEqual(['validate:candidate', 'add:candidate', 'list', 'disable:4', 'invalidate']);
  });

  it('rejects an invalid key (OpenAI 401) without storing anything, with a key-free audit log', async () => {
    const { ports, calls } = fakeRotatePorts({ status: 401 });
    const error = await handleRotateOpenAiKey(admin, { newKey: NEW_KEY }, ports).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpsError);
    expect((error as HttpsError).code).toBe('failed-precondition');
    expect((error as HttpsError).details).toEqual({ reason: 'invalid_key' });
    expect(calls).toEqual(['validate:candidate']); // nothing stored, nothing disabled
    expect(logger.warn).toHaveBeenCalledWith('adminRotateOpenAiKey.rejected', {
      adminUid: 'admin-1',
      reason: 'invalid_key',
      status: 401,
    });
  });

  it('rejects any other non-200 validation answer without storing anything, with an audit log', async () => {
    const { ports } = fakeRotatePorts({ status: 429 });
    const error = await handleRotateOpenAiKey(admin, { newKey: NEW_KEY }, ports).catch((caught: unknown) => caught);
    expect((error as HttpsError).code).toBe('failed-precondition');
    expect(ports.addSecretVersion).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('adminRotateOpenAiKey.rejected', {
      adminUid: 'admin-1',
      reason: 'validation_failed',
      status: 429,
    });
  });

  it('maps an unreachable OpenAI to unavailable, drops the network error detail, and audit-logs', async () => {
    const { ports } = fakeRotatePorts({ networkError: new Error(`fetch failed for Bearer ${NEW_KEY}`) });
    const error = await handleRotateOpenAiKey(admin, { newKey: NEW_KEY }, ports).catch((caught: unknown) => caught);
    expect((error as HttpsError).code).toBe('unavailable');
    expect((error as HttpsError).message).not.toContain(NEW_KEY);
    expect(ports.addSecretVersion).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('adminRotateOpenAiKey.rejected', {
      adminUid: 'admin-1',
      reason: 'openai_unreachable',
    });
  });

  it('audit logs carry fixed fields only - never the candidate key', async () => {
    const auditCases: RotateFakeOptions[] = [
      { status: 401 },
      { status: 500 },
      { networkError: new Error('down') },
      { addError: new Error('secretmanager_request_failed (403)') },
    ];
    for (const options of auditCases) {
      const { ports } = fakeRotatePorts(options);
      await handleRotateOpenAiKey(admin, { newKey: NEW_KEY }, ports).catch(() => undefined);
    }
    for (const call of (logger.warn as jest.Mock).mock.calls) {
      expect(JSON.stringify(call)).not.toContain(NEW_KEY);
    }
    expect(logger.warn).toHaveBeenCalledTimes(4);
  });

  it('maps a Secret Manager 403 on addVersion to an actionable failed-precondition (IAM grant missing)', async () => {
    // The project's live state until the owner runs the gcloud grants: validation succeeds
    // (needs no IAM), then Secret Manager denies addVersion. The old message was a generic
    // 'internal' plus a WRONG "deploy functions first" hint.
    const { ports } = fakeRotatePorts({ addError: new Error('secretmanager_request_failed (403)') });
    const error = await handleRotateOpenAiKey(admin, { newKey: NEW_KEY }, ports).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpsError);
    expect((error as HttpsError).code).toBe('failed-precondition');
    expect((error as HttpsError).details).toEqual({ reason: 'iam_missing' });
    expect((error as HttpsError).message).toContain('grant');
    expect((error as HttpsError).message).toContain('Nothing was changed');
    expect(ports.listEnabledSecretVersions).not.toHaveBeenCalled();
    expect(ports.invalidateKeyCache).not.toHaveBeenCalled();
  });

  it('keeps a NON-403 addVersion failure as internal (nothing was provably stored)', async () => {
    const { ports } = fakeRotatePorts({ addError: new Error('secretmanager_request_failed (500)') });
    await expect(handleRotateOpenAiKey(admin, { newKey: NEW_KEY }, ports)).rejects.toMatchObject({ code: 'internal' });
    expect(ports.invalidateKeyCache).not.toHaveBeenCalled();
  });

  it('never leaks the key into any thrown error message or details', async () => {
    const leakCases: RotateFakeOptions[] = [
      { status: 401 },
      { status: 500 },
      { networkError: new Error('down') },
      { addError: new Error('secretmanager_request_failed (403)') },
      { newVersion: '5', enabledVersions: ['4', '5'], disableError: new Error('secretmanager_request_failed (500)') },
    ];
    for (const options of leakCases) {
      const { ports } = fakeRotatePorts(options);
      const error = await handleRotateOpenAiKey(admin, { newKey: NEW_KEY }, ports).catch((caught: unknown) => caught);
      const serialized = JSON.stringify({
        message: (error as HttpsError).message,
        details: (error as HttpsError).details ?? null,
      });
      expect(serialized).not.toContain(NEW_KEY);
    }
  });

  it('rejects malformed requests before any port call', async () => {
    const { ports, calls } = fakeRotatePorts();
    for (const bad of [null, {}, { newKey: 'too-short' }, { newKey: 'x'.repeat(513) }, { newKey: 42 }]) {
      await expect(handleRotateOpenAiKey(admin, bad, ports)).rejects.toMatchObject({ code: 'invalid-argument' });
    }
    expect(calls).toEqual([]);
  });

  it.each([
    ['list', { listError: new Error('secretmanager_request_failed (500)') }],
    ['disable', { disableError: new Error('secretmanager_request_failed (503)') }],
  ])(
    'reports a post-store %s failure as aborted/stored_cleanup_failed and still busts the cache',
    async (_step, failure) => {
      // The new version IS stored and becomes 'latest' - telling the admin "the previous key is
      // still active" here (the old 'internal' path) could make them revoke the NEW key.
      const { ports } = fakeRotatePorts({ newVersion: '5', enabledVersions: ['4', '5'], ...failure });
      const error = await handleRotateOpenAiKey(admin, { newKey: NEW_KEY }, ports).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(HttpsError);
      expect((error as HttpsError).code).toBe('aborted');
      expect((error as HttpsError).details).toEqual({ reason: 'stored_cleanup_failed', version: '5' });
      expect((error as HttpsError).message).toContain('version 5');
      expect(ports.invalidateKeyCache).toHaveBeenCalledTimes(1);
    },
  );
});

// ---------------------------------------------------------------------------------------------
// sumAdminStatsDayDocs (the sharded-aggregate read path)
// ---------------------------------------------------------------------------------------------

describe('sumAdminStatsDayDocs', () => {
  it('sums shards plus the legacy day document and keeps the newest updatedAt', () => {
    expect(
      sumAdminStatsDayDocs([
        { requests: 3, inputTokens: 100, outputTokens: 40, updatedAt: '2026-09-30T10:00:00.000Z' }, // legacy doc
        { requests: 2, inputTokens: 50, outputTokens: 20, updatedAt: '2026-09-30T12:00:00.000Z' }, // shard
        { requests: 1, inputTokens: 25, outputTokens: 10, updatedAt: '2026-09-30T11:00:00.000Z' }, // shard
      ]),
    ).toEqual({ requests: 6, inputTokens: 175, outputTokens: 70, updatedAt: '2026-09-30T12:00:00.000Z' });
  });

  it('degrades malformed documents field-wise and skips non-objects', () => {
    expect(
      sumAdminStatsDayDocs([
        { requests: 'nonsense', inputTokens: 100, outputTokens: -5, updatedAt: 'x' }, // bad fields -> 0
        'garbage', // not an object -> skipped
        { requests: 2, inputTokens: 1, outputTokens: 2, updatedAt: '' },
      ]),
    ).toEqual({ requests: 2, inputTokens: 101, outputTokens: 2, updatedAt: 'x' });
  });

  it('returns zeros for an empty day', () => {
    expect(sumAdminStatsDayDocs([])).toEqual({ requests: 0, inputTokens: 0, outputTokens: 0, updatedAt: '' });
  });

  it('produces exactly the shape handleGetStats parses per day', async () => {
    const summed = sumAdminStatsDayDocs([
      { requests: 2, inputTokens: 30, outputTokens: 40, updatedAt: '2026-09-28T09:00:00.000Z' },
    ]);
    const { ports } = fakeStatsPorts({ dayDocs: { '2026-09-28': summed } });
    const response = await handleGetStats(admin, { days: 7 }, ports, now);
    expect(response.days[4]).toEqual({ date: '2026-09-28', requests: 2, inputTokens: 30, outputTokens: 40 });
  });
});
