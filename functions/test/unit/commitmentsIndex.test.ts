/**
 * Deployability contract of summaryCommitments (functions/src/summaries/commitmentsFunction.ts and
 * its block in summaries/index.ts; docs/v2/M11-DESIGN.md section 2.1, section 15 finding 2,
 * section 8 "Gating and loading"; the summariesIndex.test.ts pattern):
 * - exported ONLY while SUMMARIES_ENABLED is true at load AND SUMMARIES_SERVICE_ACCOUNT is set,
 *   never under the default compute account;
 * - binds exactly SUMMARIES_DATA_KEY and OPENAI_API_KEY, runs as the summaries account, 90 s;
 * - loading the summaries module loads neither the handler, its runtime, the reader nor the
 *   OpenAI SDK; the first call loads them, and a signed-out call is refused there.
 */
jest.mock('firebase-functions/logger', () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const mockLoaded: string[] = [];
jest.mock('openai', () => {
  mockLoaded.push('openai');
  return jest.requireActual('openai');
});
jest.mock('../../src/summaries/commitmentsRuntime', () => {
  mockLoaded.push('commitmentsRuntime');
  return jest.requireActual('../../src/summaries/commitmentsRuntime');
});
jest.mock('../../src/summaries/commitmentsHandler', () => {
  mockLoaded.push('commitmentsHandler');
  return jest.requireActual('../../src/summaries/commitmentsHandler');
});
jest.mock('../../src/summaries/read', () => {
  mockLoaded.push('read');
  return jest.requireActual('../../src/summaries/read');
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type * as SummariesModuleNamespace from '../../src/summaries';

type SummariesModule = typeof SummariesModuleNamespace;

interface Endpoint {
  secretEnvironmentVariables?: { key: string }[];
  callableTrigger?: unknown;
  httpsTrigger?: unknown;
  availableMemoryMb?: unknown;
  timeoutSeconds?: unknown;
  maxInstances?: unknown;
  concurrency?: unknown;
  cpu?: unknown;
  serviceAccountEmail?: unknown;
}

function endpointOf(fn: unknown): Endpoint {
  const endpoint = (fn as { __endpoint?: Endpoint }).__endpoint;
  if (endpoint === undefined) throw new Error('not a Cloud Function');
  return endpoint;
}

function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function loadModule(enabled: string | undefined, serviceAccount: string | undefined): SummariesModule {
  jest.resetModules();
  mockLoaded.length = 0;
  setEnv('SUMMARIES_ENABLED', enabled);
  setEnv('SUMMARIES_SERVICE_ACCOUNT', serviceAccount);
  return jest.requireActual<SummariesModule>('../../src/summaries');
}

const RUNTIME_ACCOUNT = 'summaries-runtime@demo-meetingguard.iam.gserviceaccount.com';

describe('summaryCommitments exports (deploy gating)', () => {
  const original = process.env.SUMMARIES_ENABLED;
  const originalAccount = process.env.SUMMARIES_SERVICE_ACCOUNT;

  afterEach(() => {
    setEnv('SUMMARIES_ENABLED', original);
    setEnv('SUMMARIES_SERVICE_ACCOUNT', originalAccount);
    jest.resetModules();
  });

  it('is undefined unless SUMMARIES_ENABLED is true AND the summaries service account is set', () => {
    for (const [enabled, account] of [
      [undefined, undefined],
      ['false', RUNTIME_ACCOUNT],
      ['true', undefined],
      ['true', ''],
      ['true', '   '],
      [undefined, RUNTIME_ACCOUNT],
    ] as const) {
      const mod = loadModule(enabled, account);
      expect([enabled, account, mod.summaryCommitments]).toEqual([enabled, account, undefined]);
    }
    expect(loadModule('true', RUNTIME_ACCOUNT).summaryCommitments).toBeDefined();
  });

  it('is undefined when the summaries account is a default account, the webhook invoker or not a service account (review S6)', () => {
    const invoker = process.env.SUMMARIES_WHATSAPP_INVOKER;
    try {
      for (const account of ['123456789-compute@developer.gserviceaccount.com', 'demo-meetingguard@appspot.gserviceaccount.com', 'public', 'dana@company.example']) {
        expect([account, loadModule('true', account).summaryCommitments]).toEqual([account, undefined]);
      }
      setEnv('SUMMARIES_WHATSAPP_INVOKER', RUNTIME_ACCOUNT.toUpperCase());
      expect(loadModule('true', RUNTIME_ACCOUNT).summaryCommitments).toBeUndefined();
      setEnv('SUMMARIES_WHATSAPP_INVOKER', '123456789-compute@developer.gserviceaccount.com');
      expect(loadModule('true', RUNTIME_ACCOUNT).summaryCommitments).toBeDefined();
    } finally {
      setEnv('SUMMARIES_WHATSAPP_INVOKER', invoker);
    }
  });

  it('binds exactly SUMMARIES_DATA_KEY and OPENAI_API_KEY and runs as the summaries account, never the default one', () => {
    const mod = loadModule('true', ` ${RUNTIME_ACCOUNT} `);
    const endpoint = endpointOf(mod.summaryCommitments);
    expect((endpoint.secretEnvironmentVariables ?? []).map((secret) => secret.key).sort()).toEqual(['OPENAI_API_KEY', 'SUMMARIES_DATA_KEY']);
    expect(JSON.parse(JSON.stringify(endpoint.serviceAccountEmail)) as unknown).toBe(RUNTIME_ACCOUNT);
    expect(endpoint.callableTrigger).toBeDefined();
    expect(endpoint.httpsTrigger).toBeUndefined();
    expect(endpoint).toMatchObject({ availableMemoryMb: 512, timeoutSeconds: 90, maxInstances: 10, concurrency: 20, cpu: 1 });
    // The M10 functions are unchanged by it.
    expect((endpointOf(mod.summaryRead).secretEnvironmentVariables ?? []).map((secret) => secret.key)).toEqual(['SUMMARIES_DATA_KEY']);
  });

  it('loads no commitments module at load, and loads them on the first call, which refuses a signed-out caller', async () => {
    const mod = loadModule('true', RUNTIME_ACCOUNT);
    expect(mockLoaded).toEqual([]);
    const fn = mod.summaryCommitments as unknown as { run(request: unknown): Promise<unknown> };
    let caught: unknown;
    try {
      await fn.run({ auth: undefined, data: { op: 'get', summaryId: 'a'.repeat(64) }, rawRequest: {} });
    } catch (error) {
      caught = error;
    }
    expect((caught as { code?: unknown }).code).toBe('unauthenticated');
    expect((caught as { details?: unknown }).details).toEqual({ reason: 'unauthenticated' });
    expect(mockLoaded).toEqual(expect.arrayContaining(['commitmentsRuntime', 'commitmentsHandler', 'read']));
  });

  it('the functions entry point exports it from the summaries module, in its own block', () => {
    const source = readFileSync(join(__dirname, '..', '..', 'src', 'index.ts'), 'utf8');
    expect(source).toContain("export { summaryCommitments } from './summaries';");
    expect(source).toContain("export { summaryAction, summaryInbound, summaryRead, summaryStatus } from './summaries';");
  });
});
