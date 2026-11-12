/**
 * Deployability contract of functions/src/summaries/index.ts (docs/v2/M10-DESIGN.md decision 7,
 * section 4 Options, section 12 Gating; the whatsappIndex.test.ts pattern):
 * - summaryStatus and summaryAction always export and never bind a secret;
 * - summaryInbound exports ONLY while SUMMARIES_ENABLED is true when the module loads, and then binds
 *   exactly SUMMARIES_WEBHOOK_AUTH and SUMMARIES_DATA_KEY;
 * - summaryRead follows the same gate and binds SUMMARIES_DATA_KEY only (never the webhook secret),
 *   runs under the same service account option, and loads ./read on its first call only;
 * - summaryInbound runs as SUMMARIES_SERVICE_ACCOUNT when that is set at load (design section 7,
 *   finding 13), and as the default account otherwise; the callables never carry it; it is a
 *   plain dotenv key read by gate.ts summariesServiceAccountAtLoad, never a declared param;
 * - loading the module never loads mailauth, postal-mime or the pipeline modules (authenticity,
 *   mime, inbound): every function instance of the project loads the whole entry point;
 * - summaryAction cannot decrypt: its modules never reference the data key or the open helpers.
 */
jest.mock('firebase-functions/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// Load detectors: each factory records the module, then hands out the real one. Explicit mocks
// survive jest.resetModules, and every fresh load of the module graph runs the factory again.
const mockLoaded: string[] = [];
jest.mock('mailauth', () => {
  mockLoaded.push('mailauth');
  return jest.requireActual('mailauth');
});
jest.mock('postal-mime', () => {
  mockLoaded.push('postal-mime');
  return jest.requireActual('postal-mime');
});
jest.mock('../../src/summaries/authenticity', () => {
  mockLoaded.push('authenticity');
  return jest.requireActual('../../src/summaries/authenticity');
});
jest.mock('../../src/summaries/mime', () => {
  mockLoaded.push('mime');
  return jest.requireActual('../../src/summaries/mime');
});
jest.mock('../../src/summaries/inbound', () => {
  mockLoaded.push('inbound');
  return jest.requireActual('../../src/summaries/inbound');
});
jest.mock('../../src/summaries/read', () => {
  mockLoaded.push('read');
  return jest.requireActual('../../src/summaries/read');
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type * as ParamsNamespace from 'firebase-functions/params';

import type * as SummariesModuleNamespace from '../../src/summaries';
import { summariesServiceAccountAtLoad } from '../../src/summaries/gate';

type SummariesModule = typeof SummariesModuleNamespace;

interface EndpointView {
  __endpoint?: {
    secretEnvironmentVariables?: { key: string }[];
    callableTrigger?: unknown;
    httpsTrigger?: unknown;
    availableMemoryMb?: unknown;
    timeoutSeconds?: unknown;
    maxInstances?: unknown;
    /** The runtime service account (firebase-functions 7 optionsToEndpoint: serviceAccount). */
    serviceAccountEmail?: unknown;
  };
}

function endpointOf(fn: unknown): NonNullable<EndpointView['__endpoint']> {
  const endpoint = (fn as EndpointView).__endpoint;
  if (endpoint === undefined) throw new Error('not a Cloud Function');
  return endpoint;
}

function secretKeys(fn: unknown): string[] {
  return (endpointOf(fn).secretEnvironmentVariables ?? []).map((secret) => secret.key).sort();
}

/**
 * The service account as the CLI reads it from the manifest. firebase-functions 7 puts
 * serviceAccountEmail on every v2 endpoint, as RESET_VALUE ("the platform default", serialized as
 * null by its toJSON, like stackToWire does) unless the option is set; a set value is the string.
 */
function wireServiceAccount(fn: unknown): unknown {
  const value = endpointOf(fn).serviceAccountEmail;
  return value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as unknown);
}

function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function loadModule(summariesEnabled: string | undefined, serviceAccount?: string): SummariesModule {
  jest.resetModules();
  mockLoaded.length = 0;
  setEnv('SUMMARIES_ENABLED', summariesEnabled);
  setEnv('SUMMARIES_SERVICE_ACCOUNT', serviceAccount);
  return jest.requireActual<SummariesModule>('../../src/summaries');
}

const PIPELINE_MODULES = ['mailauth', 'postal-mime', 'authenticity', 'mime', 'inbound'];
/** A synthetic dedicated runtime account (reserved test project id). */
const RUNTIME_ACCOUNT = 'summaries-runtime@demo-meetingguard.iam.gserviceaccount.com';

describe('summaries module exports (deploy gating)', () => {
  const original = process.env.SUMMARIES_ENABLED;
  const originalAccount = process.env.SUMMARIES_SERVICE_ACCOUNT;

  afterEach(() => {
    setEnv('SUMMARIES_ENABLED', original);
    setEnv('SUMMARIES_SERVICE_ACCOUNT', originalAccount);
    jest.resetModules();
  });

  it('exports only the callables while SUMMARIES_ENABLED is unset (deploy without secrets stays possible)', () => {
    const mod = loadModule(undefined);
    expect(mod.summaryStatus).toBeDefined();
    expect(mod.summaryAction).toBeDefined();
    expect(mod.summaryInbound).toBeUndefined();
    expect(mod.summaryRead).toBeUndefined();
    expect(secretKeys(mod.summaryStatus)).toEqual([]);
    expect(secretKeys(mod.summaryAction)).toEqual([]);
  });

  it('exports only the callables while SUMMARIES_ENABLED=false', () => {
    const mod = loadModule('false');
    expect(mod.summaryInbound).toBeUndefined();
    expect(mod.summaryStatus).toBeDefined();
    expect(mod.summaryAction).toBeDefined();
  });

  it('exports summaryInbound while SUMMARIES_ENABLED=true, binding exactly the two summary secrets', () => {
    const mod = loadModule('true');
    expect(mod.summaryInbound).toBeDefined();
    expect(secretKeys(mod.summaryInbound)).toEqual(['SUMMARIES_DATA_KEY', 'SUMMARIES_WEBHOOK_AUTH']);
    expect(endpointOf(mod.summaryInbound).httpsTrigger).toBeDefined();
    // The callables still bind none.
    expect(secretKeys(mod.summaryStatus)).toEqual([]);
    expect(secretKeys(mod.summaryAction)).toEqual([]);
  });

  // null on the wire is "the default compute account" (the CLI sends no service account); a
  // string is the account the function runs as.
  it('runs summaryInbound as SUMMARIES_SERVICE_ACCOUNT when it is set at deploy time (finding 13); the callables never carry it', () => {
    const mod = loadModule('true', `  ${RUNTIME_ACCOUNT} `);
    expect(wireServiceAccount(mod.summaryInbound)).toBe(RUNTIME_ACCOUNT);
    expect(secretKeys(mod.summaryInbound)).toEqual(['SUMMARIES_DATA_KEY', 'SUMMARIES_WEBHOOK_AUTH']);
    for (const fn of [mod.summaryStatus, mod.summaryAction]) {
      expect(wireServiceAccount(fn)).toBeNull();
    }
  });

  it('keeps the default runtime account while SUMMARIES_SERVICE_ACCOUNT is empty, blank or unset', () => {
    for (const value of [undefined, '', '   ']) {
      const mod = loadModule('true', value);
      expect(mod.summaryInbound).toBeDefined();
      expect([value, wireServiceAccount(mod.summaryInbound)]).toEqual([value, null]);
      for (const fn of [mod.summaryStatus, mod.summaryAction]) {
        expect(wireServiceAccount(fn)).toBeNull();
      }
    }
  });

  // firebase-tools resolves DECLARED params only after discovery, so a declared
  // SUMMARIES_SERVICE_ACCOUNT would be prompted for (and its answer ignored by the load-time read)
  // or fail a non-interactive deploy. The manifest's params come from this registry.
  it('SUMMARIES_SERVICE_ACCOUNT is not a declared param (a plain dotenv key read at load), while the other summary params are', () => {
    for (const [enabled, account] of [
      ['true', RUNTIME_ACCOUNT],
      ['true', undefined],
      [undefined, RUNTIME_ACCOUNT],
    ] as const) {
      // The registry is a globalThis singleton that outlives jest.resetModules: start it empty, so
      // only what this load declares is in it.
      jest.requireActual<typeof ParamsNamespace>('firebase-functions/params').declaredParams.length = 0;
      const mod = loadModule(enabled, account);
      const { declaredParams } = jest.requireActual<typeof ParamsNamespace>('firebase-functions/params');
      const names = declaredParams.map((param) => param.name);
      expect([enabled, account, names.includes('SUMMARIES_SERVICE_ACCOUNT')]).toEqual([enabled, account, false]);
      // Control: the registry is the one the summary params land in.
      expect(names).toEqual(expect.arrayContaining(['SUMMARIES_ENABLED', 'SUMMARIES_PILOT_UIDS', 'SUMMARIES_ADDRESS_TEMPLATE', 'SUMMARIES_SENDERS']));
      if (enabled === 'true') {
        // The account still reaches the endpoint as a plain string, never as a param expression.
        expect(wireServiceAccount(mod.summaryInbound)).toBe(account ?? null);
      }
    }
  });

  it('summariesServiceAccountAtLoad (gate.ts) trims, treats blank as unset and expands the name@ shorthand with GCLOUD_PROJECT', () => {
    const savedProject = process.env.GCLOUD_PROJECT;
    try {
      for (const [value, project, expected] of [
        [` ${RUNTIME_ACCOUNT}\t`, 'demo-meetingguard', RUNTIME_ACCOUNT],
        ['summaries-runtime@', 'demo-meetingguard', RUNTIME_ACCOUNT],
        ['summaries-runtime@', ' demo-meetingguard ', RUNTIME_ACCOUNT],
        ['summaries-runtime@', undefined, 'summaries-runtime@'],
        ['summaries-runtime@', '  ', 'summaries-runtime@'],
        ['@', 'demo-meetingguard', '@'],
        [undefined, 'demo-meetingguard', null],
        ['', 'demo-meetingguard', null],
        [' \t ', 'demo-meetingguard', null],
      ] as const) {
        setEnv('SUMMARIES_SERVICE_ACCOUNT', value);
        setEnv('GCLOUD_PROJECT', project);
        expect([value, project, summariesServiceAccountAtLoad()]).toEqual([value, project, expected]);
      }
    } finally {
      setEnv('GCLOUD_PROJECT', savedProject);
    }
  });

  it('a service account without SUMMARIES_ENABLED exports no webhook and leaves the callables alone', () => {
    const mod = loadModule('false', RUNTIME_ACCOUNT);
    expect(mod.summaryInbound).toBeUndefined();
    for (const fn of [mod.summaryStatus, mod.summaryAction]) {
      expect(wireServiceAccount(fn)).toBeNull();
    }
  });

  it('deploys the callables as callables with the SUMMARIES_FUNCTION_TUNING.callables options', () => {
    const mod = loadModule(undefined);
    for (const fn of [mod.summaryStatus, mod.summaryAction]) {
      const endpoint = endpointOf(fn);
      expect(endpoint.callableTrigger).toBeDefined();
      expect(endpoint.availableMemoryMb).toBe(256);
      expect(endpoint.timeoutSeconds).toBe(10);
      expect(endpoint.maxInstances).toBe(10);
    }
  });

  it('loads neither mailauth nor postal-mime nor the pipeline modules while SUMMARIES_ENABLED is unset', () => {
    loadModule(undefined);
    expect(mockLoaded).toEqual([]);
  });

  it('still loads none of them at module load while SUMMARIES_ENABLED=true (the pipeline loads on the first request)', () => {
    loadModule('true');
    expect(mockLoaded.filter((name) => PIPELINE_MODULES.includes(name))).toEqual([]);
    // Nor the reader: summaryRead loads ./read on its first call.
    expect(mockLoaded).not.toContain('read');
  });

  it('the load detectors do see a module that loads mailauth (control)', () => {
    loadModule(undefined);
    jest.requireActual('../../src/summaries/authenticity');
    expect(mockLoaded).toContain('mailauth');
  });

  it('exports summaryRead only while SUMMARIES_ENABLED is true, binding the data key only', () => {
    for (const value of [undefined, 'false', '']) {
      const mod = loadModule(value);
      expect([value, mod.summaryRead]).toEqual([value, undefined]);
    }
    const mod = loadModule('true');
    expect(mod.summaryRead).toBeDefined();
    expect(secretKeys(mod.summaryRead)).toEqual(['SUMMARIES_DATA_KEY']);
    const endpoint = endpointOf(mod.summaryRead);
    expect(endpoint.callableTrigger).toBeDefined();
    expect(endpoint.httpsTrigger).toBeUndefined();
    expect(endpoint.availableMemoryMb).toBe(512);
    expect(endpoint.timeoutSeconds).toBe(30);
    expect(endpoint.maxInstances).toBe(10);
  });

  it('runs summaryRead as SUMMARIES_SERVICE_ACCOUNT when it is set at deploy time, and as the default account otherwise', () => {
    const dedicated = loadModule('true', RUNTIME_ACCOUNT);
    expect(wireServiceAccount(dedicated.summaryRead)).toBe(RUNTIME_ACCOUNT);
    expect(wireServiceAccount(dedicated.summaryInbound)).toBe(RUNTIME_ACCOUNT);
    expect(secretKeys(dedicated.summaryRead)).toEqual(['SUMMARIES_DATA_KEY']);
    for (const value of [undefined, '', '  ']) {
      const shared = loadModule('true', value);
      expect([value, wireServiceAccount(shared.summaryRead)]).toEqual([value, null]);
    }
  });

  it('loads ./read on the first summaryRead call only, and never the pipeline modules', async () => {
    const mod = loadModule('true');
    expect(mockLoaded).not.toContain('read');
    const fn = mod.summaryRead as unknown as { run(request: unknown): Promise<unknown> };
    let caught: unknown;
    try {
      await fn.run({ auth: undefined, data: { op: 'list', view: 'inbox' }, rawRequest: {} });
    } catch (error) {
      caught = error;
    }
    // A signed-out call is refused by the handler before the Admin SDK or the data key is touched.
    expect((caught as { code?: unknown }).code).toBe('unauthenticated');
    expect((caught as { details?: unknown }).details).toEqual({ reason: 'unauthenticated' });
    expect(mockLoaded).toContain('read');
    expect(mockLoaded.filter((name) => PIPELINE_MODULES.includes(name))).toEqual([]);
  });

  it('summariesEnabledAtLoad accepts only a true-ish env value', () => {
    const mod = loadModule(undefined);
    expect(mod.summariesEnabledAtLoad()).toBe(false);
    process.env.SUMMARIES_ENABLED = 'false';
    expect(mod.summariesEnabledAtLoad()).toBe(false);
    process.env.SUMMARIES_ENABLED = ' TRUE ';
    expect(mod.summariesEnabledAtLoad()).toBe(true);
  });
});

describe('summaryAction cannot decrypt', () => {
  const SOURCES = ['index.ts', 'callables.ts', 'actions.ts'].map((name) => ({
    name,
    text: readFileSync(join(__dirname, '..', '..', 'src', 'summaries', name), 'utf8'),
  }));

  it('the callable modules never reference the data key, a keyring or the open helpers', () => {
    for (const source of SOURCES) {
      // Comments may name the key to say it is never read; code may not.
      const code = source.text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect({ name: source.name, hits: code.match(/SUMMARIES_DATA_KEY|SUMMARIES_WEBHOOK_AUTH|parseKeyring|openSummaryHead|openSummaryBody|\bopen\(/g) }).toEqual({
        name: source.name,
        hits: null,
      });
    }
  });
});
