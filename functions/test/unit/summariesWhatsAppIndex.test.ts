/**
 * Deployability of the WhatsApp leg (functions/src/summaries/whatsappFunction.ts, its block in
 * summaries/index.ts, whatsapp/summaryPort.ts; docs/v2/M11-DESIGN.md section 4.3, section 15
 * finding 2, section 8 "Gating and loading"; the commitmentsIndex.test.ts pattern):
 * - summaryWhatsApp exports ONLY while SUMMARIES_ENABLED and WHATSAPP_ENABLED are true at load, the
 *   summaries service account and SUMMARIES_WHATSAPP_INVOKER are set, and the two differ;
 * - it binds exactly SUMMARIES_DATA_KEY and OPENAI_API_KEY, runs as the summaries account, and only
 *   the invoker may call it;
 * - loading the summaries module loads no worker module; the first request does;
 * - the webhook never binds or imports the data key, the sealing code or the reader, also with
 *   summaries on; its port exists only while SUMMARIES_ENABLED is true at load;
 * - the port: the URL, the ID token from the metadata server, the timeout and the answer checks.
 */
jest.mock('firebase-functions/logger', () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const mockLoaded: string[] = [];
jest.mock('../../src/summaries/whatsappRuntime', () => {
  mockLoaded.push('whatsappRuntime');
  return jest.requireActual('../../src/summaries/whatsappRuntime');
});
jest.mock('../../src/summaries/whatsappCommitments', () => {
  mockLoaded.push('whatsappCommitments');
  return jest.requireActual('../../src/summaries/whatsappCommitments');
});
jest.mock('../../src/summaries/read', () => {
  mockLoaded.push('read');
  return jest.requireActual('../../src/summaries/read');
});
jest.mock('../../src/shared/sealed', () => {
  mockLoaded.push('sealed');
  return jest.requireActual('../../src/shared/sealed');
});

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import type { Firestore } from 'firebase-admin/firestore';

import type * as SummariesModuleNamespace from '../../src/summaries';
import type * as WhatsappModuleNamespace from '../../src/whatsapp';
import type * as PortModuleNamespace from '../../src/whatsapp/summaryPort';
import { isDefaultServiceAccount, isServiceAccountAddress, sameServiceAccount, summariesWhatsAppInvokerAtLoad, summariesWhatsAppUrlAtLoad } from '../../src/summaries/gate';
import { uidTagOf, type SummaryWhatsAppResponse } from '../../src/summaries/whatsappProtocol';
import { createSummaryPort, metadataIdTokenSource, portTimeoutMs, summaryWorkerUrl } from '../../src/whatsapp/summaryPort';

type SummariesModule = typeof SummariesModuleNamespace;

interface Endpoint {
  secretEnvironmentVariables?: { key: string }[];
  httpsTrigger?: { invoker?: unknown };
  callableTrigger?: unknown;
  availableMemoryMb?: unknown;
  timeoutSeconds?: unknown;
  serviceAccountEmail?: unknown;
}

function endpointOf(fn: unknown): Endpoint {
  const endpoint = (fn as { __endpoint?: Endpoint }).__endpoint;
  if (endpoint === undefined) throw new Error('not a Cloud Function');
  return endpoint;
}

function secretKeys(fn: unknown): string[] {
  return (endpointOf(fn).secretEnvironmentVariables ?? []).map((secret) => secret.key).sort();
}

const ENV = ['SUMMARIES_ENABLED', 'WHATSAPP_ENABLED', 'SUMMARIES_SERVICE_ACCOUNT', 'SUMMARIES_WHATSAPP_INVOKER', 'SUMMARIES_WHATSAPP_URL', 'GCLOUD_PROJECT', 'SUMMARIES_PILOT_UIDS'] as const;
type EnvName = (typeof ENV)[number];
const original: Partial<Record<EnvName, string | undefined>> = {};
for (const name of ENV) original[name] = process.env[name];

function setEnv(values: Partial<Record<EnvName, string | undefined>>): void {
  for (const name of ENV) {
    const value = values[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

const RUNTIME = 'summaries-runtime@demo-meetingguard.iam.gserviceaccount.com';
const INVOKER = '123456789-compute@developer.gserviceaccount.com';
const ALL_ON = { SUMMARIES_ENABLED: 'true', WHATSAPP_ENABLED: 'true', SUMMARIES_SERVICE_ACCOUNT: RUNTIME, SUMMARIES_WHATSAPP_INVOKER: INVOKER };

function loadSummaries(values: Partial<Record<EnvName, string | undefined>>): SummariesModule {
  jest.resetModules();
  mockLoaded.length = 0;
  setEnv(values);
  return jest.requireActual<SummariesModule>('../../src/summaries');
}

afterEach(() => {
  setEnv(original);
  jest.resetModules();
});

describe('summaryWhatsApp exports (deploy gating)', () => {
  it('is undefined unless both switches are on and the two accounts are set and differ', () => {
    const cases: Partial<Record<EnvName, string>>[] = [
      {},
      { ...ALL_ON, SUMMARIES_ENABLED: 'false' },
      { ...ALL_ON, WHATSAPP_ENABLED: 'false' },
      { ...ALL_ON, SUMMARIES_SERVICE_ACCOUNT: '  ' },
      { ...ALL_ON, SUMMARIES_WHATSAPP_INVOKER: '' },
      { ...ALL_ON, SUMMARIES_WHATSAPP_INVOKER: ` ${RUNTIME.toUpperCase()} ` },
    ];
    for (const values of cases) expect([values, loadSummaries(values).summaryWhatsApp]).toEqual([values, undefined]);
    expect(loadSummaries(ALL_ON).summaryWhatsApp).toBeDefined();
    // The "name@" shorthand names the same account as the full address.
    expect(loadSummaries({ ...ALL_ON, GCLOUD_PROJECT: 'demo-meetingguard', SUMMARIES_WHATSAPP_INVOKER: 'summaries-runtime@' }).summaryWhatsApp).toBeUndefined();
  });

  it('is undefined for an invoker that is not one service account ("public" means allUsers) or a summaries account that is a default one (review S6)', () => {
    for (const invoker of ['public', 'private', 'allUsers', 'user:dana@company.example', 'dana@company.example', 'domain:company.example', 'public,123-compute@developer.gserviceaccount.com']) {
      const values = { ...ALL_ON, SUMMARIES_WHATSAPP_INVOKER: invoker };
      expect([invoker, loadSummaries(values).summaryWhatsApp]).toEqual([invoker, undefined]);
    }
    for (const account of [INVOKER, '987654321-compute@developer.gserviceaccount.com', 'demo-meetingguard@appspot.gserviceaccount.com', 'public']) {
      const mod = loadSummaries({ ...ALL_ON, SUMMARIES_SERVICE_ACCOUNT: account });
      expect([account, mod.summaryWhatsApp, mod.summaryCommitments]).toEqual([account, undefined, undefined]);
    }
    // The M10 functions keep their documented fallback.
    expect(loadSummaries({ ...ALL_ON, SUMMARIES_SERVICE_ACCOUNT: '987654321-compute@developer.gserviceaccount.com' }).summaryRead).toBeDefined();
    // A dedicated account with the default compute account as the invoker (today's setup) still exports.
    expect(endpointOf(loadSummaries(ALL_ON).summaryWhatsApp).httpsTrigger?.invoker).toEqual([INVOKER]);
    setEnv({ SUMMARIES_WHATSAPP_INVOKER: 'public' });
    expect(summariesWhatsAppInvokerAtLoad()).toBeNull();
    expect(isServiceAccountAddress('sa-webhook@')).toBe(true);
    expect(isServiceAccountAddress('sa-webhook@demo.iam.gserviceaccount.com')).toBe(true);
    expect(isServiceAccountAddress('dana@gmail.com')).toBe(false);
    expect(isDefaultServiceAccount(' 123-COMPUTE@developer.gserviceaccount.com ')).toBe(true);
    expect(isDefaultServiceAccount(RUNTIME)).toBe(false);
  });

  it('binds exactly the data key and the OpenAI key, runs as the summaries account, and only the invoker may call it', () => {
    const mod = loadSummaries(ALL_ON);
    const endpoint = endpointOf(mod.summaryWhatsApp);
    expect(secretKeys(mod.summaryWhatsApp)).toEqual(['OPENAI_API_KEY', 'SUMMARIES_DATA_KEY']);
    expect(JSON.parse(JSON.stringify(endpoint.serviceAccountEmail)) as unknown).toBe(RUNTIME);
    expect(endpoint.httpsTrigger?.invoker).toEqual([INVOKER]);
    expect(endpoint.callableTrigger).toBeUndefined();
    expect(endpoint).toMatchObject({ availableMemoryMb: 512, timeoutSeconds: 90 });
    // The M11 callable and the M10 functions are unchanged by it.
    expect(secretKeys(mod.summaryCommitments)).toEqual(['OPENAI_API_KEY', 'SUMMARIES_DATA_KEY']);
    expect(secretKeys(mod.summaryRead)).toEqual(['SUMMARIES_DATA_KEY']);
  });

  it('loads no worker module at load; a request loads it, and a GET or a bad body is refused', async () => {
    const mod = loadSummaries(ALL_ON);
    expect(mockLoaded).not.toContain('whatsappRuntime');
    expect(mockLoaded).not.toContain('whatsappCommitments');
    expect(mockLoaded).not.toContain('read');
    const fn = mod.summaryWhatsApp as unknown as (req: unknown, res: unknown) => Promise<void>;
    const answer = () => {
      const state: { status: number | null; body: unknown } = { status: null, body: null };
      const res = {
        status(code: number) {
          state.status = code;
          return res;
        },
        send(body: unknown) {
          state.body = body;
          return res;
        },
        json(body: unknown) {
          state.body = body;
          return res;
        },
      };
      return { state, res };
    };
    const get = answer();
    await fn({ method: 'GET', body: {}, headers: {}, get: () => undefined }, get.res);
    expect(get.state).toEqual({ status: 405, body: 'Method Not Allowed' });
    expect(mockLoaded).not.toContain('whatsappRuntime');
    const bad = answer();
    await fn({ method: 'POST', body: { op: 'offer' }, headers: {}, get: () => undefined }, bad.res);
    expect(bad.state).toEqual({ status: 400, body: 'Bad Request' });
    expect(mockLoaded).toEqual(expect.arrayContaining(['whatsappRuntime', 'whatsappCommitments']));
  });

  it('the functions entry point exports it from the summaries module, in its own line', () => {
    const source = readFileSync(join(__dirname, '..', '..', 'src', 'index.ts'), 'utf8');
    expect(source).toContain("export { summaryWhatsApp } from './summaries';");
    expect(source).toContain("export { summaryCommitments } from './summaries';");
  });

  it('reads the plain keys: the invoker shorthand, the URL override and the account comparison', () => {
    setEnv({ SUMMARIES_WHATSAPP_INVOKER: ' sa-webhook@ ', GCLOUD_PROJECT: 'demo-meetingguard' });
    expect(summariesWhatsAppInvokerAtLoad()).toBe('sa-webhook@demo-meetingguard.iam.gserviceaccount.com');
    setEnv({});
    expect(summariesWhatsAppInvokerAtLoad()).toBeNull();
    for (const [value, expected] of [
      ['https://summarywhatsapp-abc-uc.a.run.app', 'https://summarywhatsapp-abc-uc.a.run.app'],
      ['https://summarywhatsapp-abc-uc.a.run.app/', 'https://summarywhatsapp-abc-uc.a.run.app'],
      ['http://summarywhatsapp-abc-uc.a.run.app', null],
      ['https://user:pass@summarywhatsapp-abc-uc.a.run.app', null],
      ['https://summarywhatsapp-abc-uc.a.run.app/?a=1', null],
      ['not a url', null],
      ['   ', null],
    ] as const) {
      setEnv({ SUMMARIES_WHATSAPP_URL: value });
      expect([value, summariesWhatsAppUrlAtLoad()]).toEqual([value, expected]);
    }
    expect(sameServiceAccount(' A@b.c ', 'a@B.C')).toBe(true);
    expect(sameServiceAccount(null, 'a@b.c')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// The webhook keeps the data key out
// ---------------------------------------------------------------------------------------------

/** Every module a source file loads at run time (relative value imports and requires). */
function runtimeGraph(entry: string): string[] {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    const specs: string[] = [];
    for (const match of source.matchAll(/^(?:import|export)\s+(?!type\s)[^'";]*?from\s+'(\.[^']+)'/gm)) specs.push(match[1] as string);
    for (const match of source.matchAll(/^import\s+'(\.[^']+)'/gm)) specs.push(match[1] as string);
    for (const match of source.matchAll(/require\('(\.[^']+)'\)/g)) specs.push(match[1] as string);
    for (const spec of specs) {
      const base = resolve(dirname(file), spec);
      const target = existsSync(`${base}.ts`) ? `${base}.ts` : existsSync(join(base, 'index.ts')) ? join(base, 'index.ts') : null;
      if (target !== null) stack.push(target);
    }
  }
  return [...seen].map((file) => relative(join(__dirname, '..', '..', 'src'), file).split('\\').join('/')).sort();
}

describe('the webhook and the data key', () => {
  it('never loads the sealing code, the reader, the commitments path or the worker; only config.ts names the data key in code', () => {
    const src = join(__dirname, '..', '..', 'src');
    const graph = runtimeGraph(join(src, 'whatsapp', 'index.ts'));
    expect(graph).toEqual(expect.arrayContaining(['whatsapp/webhook.ts', 'whatsapp/summaryPort.ts', 'whatsapp/summaryRoute.ts', 'summaries/whatsappProtocol.ts', 'summaries/gate.ts']));
    const forbidden = graph.filter(
      (file) => file === 'shared/sealed.ts' || (file.startsWith('summaries/') && file !== 'summaries/gate.ts' && file !== 'summaries/whatsappProtocol.ts') || file.startsWith('commitments/'),
    );
    expect(forbidden).toEqual([]);
    // Code only: a comment may name the key (gate.ts explains which functions bind it).
    const code = (file: string): string =>
      readFileSync(join(src, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
    const naming = graph.filter((file) => code(file).includes('SUMMARIES_DATA_KEY'));
    expect(naming).toEqual(['config.ts']);
  });

  it('whatsappWebhook binds the same secrets with summaries on, and loading it never loads sealed or the reader', () => {
    jest.resetModules();
    mockLoaded.length = 0;
    setEnv(ALL_ON);
    const mod = jest.requireActual<typeof WhatsappModuleNamespace>('../../src/whatsapp');
    expect(secretKeys(mod.whatsappWebhook)).toEqual(['OPENAI_API_KEY', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN']);
    expect(mockLoaded).not.toContain('sealed');
    expect(mockLoaded).not.toContain('read');
    expect(mockLoaded).not.toContain('whatsappCommitments');
  });

  it('the port exists only while SUMMARIES_ENABLED is true at load, and serves pilot uids only, read per call', () => {
    jest.resetModules();
    setEnv({ GCLOUD_PROJECT: 'demo-meetingguard' });
    const db = {} as Firestore;
    let port = jest.requireActual<typeof PortModuleNamespace>('../../src/whatsapp/summaryPort');
    expect(port.summaryRouteDepsAtLoad(db)).toBeUndefined();
    jest.resetModules();
    setEnv({ SUMMARIES_ENABLED: 'true', GCLOUD_PROJECT: 'demo-meetingguard', SUMMARIES_PILOT_UIDS: 'uidPilot01' });
    port = jest.requireActual<typeof PortModuleNamespace>('../../src/whatsapp/summaryPort');
    const deps = port.summaryRouteDepsAtLoad(db);
    expect(deps).toBeDefined();
    expect(deps?.allowed('uidPilot01')).toBe(true);
    expect(deps?.allowed('uidOther02')).toBe(false);
    process.env.SUMMARIES_ENABLED = 'false';
    expect(deps?.allowed('uidPilot01')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// The port
// ---------------------------------------------------------------------------------------------

function jwt(payload: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'RS256' })}.${part(payload)}.c2ln`;
}

const OK_RESPONSE: SummaryWhatsAppResponse = { outcome: 'no_summary', text: 'Nothing here.', buttons: null, offer: { action: 'keep' } };
const REQUEST = { op: 'offer', phoneE164: '15550003333', language: 'en' } as const;

describe('the port', () => {
  it('builds the worker URL from the region and the project, or takes the override', () => {
    expect(summaryWorkerUrl('us-central1', 'demo-meetingguard', null)).toBe('https://us-central1-demo-meetingguard.cloudfunctions.net/summaryWhatsApp');
    expect(summaryWorkerUrl('us-central1', 'demo-meetingguard', 'https://x-uc.a.run.app')).toBe('https://x-uc.a.run.app');
    expect(summaryWorkerUrl('us-central1', '', null)).toBeNull();
    expect(summaryWorkerUrl('us central1', 'demo', null)).toBeNull();
  });

  it('shrinks the timeout with the batch: 95 s at the start, what is left minus 15 s later, never below 5 s', () => {
    expect(portTimeoutMs(0)).toBe(95_000);
    expect(portTimeoutMs(130_000)).toBe(95_000);
    expect(portTimeoutMs(200_000)).toBe(25_000);
    expect(portTimeoutMs(230_000)).toBe(5_000);
    expect(portTimeoutMs(400_000)).toBe(5_000);
  });

  it('asks the metadata server for an ID token of the audience, and reuses it until shortly before it expires', async () => {
    let now = 1_000_000_000_000;
    const token = jwt({ exp: Math.floor(now / 1000) + 3600 });
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(`${token}\n`, { status: 200 });
    }) as unknown as typeof fetch;
    const source = metadataIdTokenSource({ fetchImpl, now: () => now });
    expect(await source('https://w.example/summaryWhatsApp')).toBe(token);
    expect(await source('https://w.example/summaryWhatsApp')).toBe(token);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=https%3A%2F%2Fw.example%2FsummaryWhatsApp&format=full',
    );
    expect((calls[0]?.init?.headers as Record<string, string>)['Metadata-Flavor']).toBe('Google');
    now += 56 * 60_000;
    await source('https://w.example/summaryWhatsApp');
    expect(calls).toHaveLength(2);
    const failing = metadataIdTokenSource({ fetchImpl: (async () => new Response('no', { status: 404 })) as unknown as typeof fetch });
    await expect(failing('https://w.example')).rejects.toThrow();
  });

  it('posts the request with the token, follows no redirect, and parses the answer', async () => {
    const seen: RequestInit[] = [];
    const port = createSummaryPort({
      url: 'https://w.example/summaryWhatsApp',
      idToken: async () => 'tok.en.sig',
      fetchImpl: (async (_url: string, init?: RequestInit) => {
        seen.push(init ?? {});
        return new Response(JSON.stringify(OK_RESPONSE), { status: 200 });
      }) as unknown as typeof fetch,
    });
    expect(await port.call(REQUEST, 1000)).toEqual({ kind: 'ok', response: OK_RESPONSE });
    expect(seen[0]?.method).toBe('POST');
    expect(seen[0]?.redirect).toBe('manual');
    expect((seen[0]?.headers as Record<string, string>).Authorization).toBe('Bearer tok.en.sig');
    expect(JSON.parse(String(seen[0]?.body))).toEqual(REQUEST);
  });

  it('answers timeout, unreachable or bad_response instead of throwing', async () => {
    const answering = (response: Response | Error) =>
      createSummaryPort({
        url: 'https://w.example',
        idToken: async () => 'a.b.c',
        fetchImpl: (async () => {
          if (response instanceof Error) throw response;
          return response;
        }) as unknown as typeof fetch,
      });
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    expect(await answering(timeout).call(REQUEST, 10)).toEqual({ kind: 'timeout' });
    expect(await answering(new TypeError('fetch failed')).call(REQUEST, 10)).toEqual({ kind: 'unreachable', reason: 'network', status: null });
    expect(await answering(new Response('', { status: 302 })).call(REQUEST, 10)).toEqual({ kind: 'unreachable', reason: 'status', status: 302 });
    expect(await answering(new Response('Forbidden', { status: 403 })).call(REQUEST, 10)).toEqual({ kind: 'unreachable', reason: 'status', status: 403 });
    expect(await answering(new Response('{oops', { status: 200 })).call(REQUEST, 10)).toEqual({ kind: 'unreachable', reason: 'bad_response', status: 200 });
    expect(await answering(new Response(JSON.stringify({ outcome: 'offered' }), { status: 200 })).call(REQUEST, 10)).toEqual({ kind: 'unreachable', reason: 'bad_response', status: 200 });
    const big = createSummaryPort({ url: 'https://w.example', idToken: async () => 'a.b.c', maxResponseBytes: 10, fetchImpl: (async () => new Response(JSON.stringify(OK_RESPONSE), { status: 200 })) as unknown as typeof fetch });
    expect(await big.call(REQUEST, 10)).toEqual({ kind: 'unreachable', reason: 'bad_response', status: 200 });
    const noToken = createSummaryPort({ url: 'https://w.example', idToken: async () => Promise.reject(new Error('metadata')), fetchImpl: (async () => new Response('')) as unknown as typeof fetch });
    expect(await noToken.call(REQUEST, 10)).toEqual({ kind: 'unreachable', reason: 'token', status: null });
  });

  it('the uid tag is the first 16 hex of sha256 of the uid', () => {
    expect(uidTagOf('uidCommitDana01')).toMatch(/^[0-9a-f]{16}$/);
    expect(uidTagOf('uidCommitDana01')).not.toBe(uidTagOf('uidCommitLee02'));
  });
});
