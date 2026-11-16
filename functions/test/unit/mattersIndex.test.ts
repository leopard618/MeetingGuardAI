/**
 * The deploy-time gate, the secret bindings and the inbound webhook's password check
 * (functions/src/matters/index.ts).
 */
import type * as MattersModuleNs from '../../src/matters';
import { MATTERS_PARAM_NAMES, isMatterUserAllowed } from '../../src/config';
import { isInboundAuthorized, mattersServiceAccountAtLoad, providerIdOf } from '../../src/matters';

jest.mock('firebase-functions/logger', () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

type MattersModule = typeof MattersModuleNs;

interface EndpointView {
  __endpoint?: { secretEnvironmentVariables?: { key: string }[]; serviceAccountEmail?: unknown };
}

/** The runtime account as the CLI reads it from the manifest (unset: RESET_VALUE, serialized as null). */
function wireServiceAccount(fn: unknown): unknown {
  const value = (fn as EndpointView).__endpoint?.serviceAccountEmail;
  return value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as unknown);
}

function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

/** A synthetic dedicated runtime account (reserved test project id). */
const RUNTIME_ACCOUNT = 'matters-functions@demo-meetingguard.iam.gserviceaccount.com';
const FUNCTION_NAMES = ['matterDraft', 'matterRevise', 'matterConfirm', 'matterCancel', 'assistantInboundEmail'] as const;

function secretKeys(fn: unknown): string[] {
  const endpoint = (fn as EndpointView).__endpoint;
  return (endpoint?.secretEnvironmentVariables ?? []).map((secret) => secret.key).sort();
}

function loadModule(enabled: string | undefined): MattersModule {
  jest.resetModules();
  if (enabled === undefined) delete process.env.MATTERS_ENABLED;
  else process.env.MATTERS_ENABLED = enabled;
  return jest.requireActual<MattersModule>('../../src/matters');
}

/** The names firebase-functions would put in the deploy manifest after loading the module. */
function declaredNamesAfterLoading(enabled: string | undefined): string[] {
  jest.resetModules();
  const params = jest.requireActual<{ declaredParams: { name: string }[] }>('firebase-functions/params');
  params.declaredParams.length = 0; // the registry lives on globalThis and outlives resetModules
  loadModule(enabled);
  return params.declaredParams.map((param) => param.name);
}

describe('matters functions: deploy gate', () => {
  const original = process.env.MATTERS_ENABLED;
  const originalAccount = process.env.MATTERS_SERVICE_ACCOUNT;
  const originalProject = process.env.GCLOUD_PROJECT;
  afterEach(() => {
    setEnv('MATTERS_ENABLED', original);
    setEnv('MATTERS_SERVICE_ACCOUNT', originalAccount);
    setEnv('GCLOUD_PROJECT', originalProject);
    jest.resetModules();
  });

  it('exports nothing while MATTERS_ENABLED is unset or false (a deploy never needs the secrets)', () => {
    for (const value of [undefined, 'false']) {
      const mod = loadModule(value);
      expect(mod.matterDraft).toBeUndefined();
      expect(mod.matterRevise).toBeUndefined();
      expect(mod.matterConfirm).toBeUndefined();
      expect(mod.matterCancel).toBeUndefined();
      expect(mod.assistantInboundEmail).toBeUndefined();
    }
  });

  it('declares no matter param or secret while it is off, so no deploy asks for them', () => {
    for (const value of [undefined, 'false']) {
      const names = declaredNamesAfterLoading(value);
      expect(names).toContain('OPENAI_API_KEY'); // the rest of config.ts still loads
      for (const name of MATTERS_PARAM_NAMES) expect(names).not.toContain(name);
    }
  });

  it('declares all of them while it is on', () => {
    const names = declaredNamesAfterLoading('true');
    for (const name of MATTERS_PARAM_NAMES) expect(names).toContain(name);
  });

  it('exports the four callables and the webhook while it is true, each with only the secrets it needs', () => {
    const mod = loadModule(' TRUE ');
    expect(secretKeys(mod.matterDraft)).toEqual(['OPENAI_API_KEY']);
    expect(secretKeys(mod.matterRevise)).toEqual(['OPENAI_API_KEY']);
    expect(secretKeys(mod.matterConfirm)).toEqual(['MATTERS_POSTMARK_TOKEN']);
    expect(secretKeys(mod.matterCancel)).toEqual([]);
    expect(secretKeys(mod.assistantInboundEmail)).toEqual(['MATTERS_INBOUND_PASSWORD']);
  });

  it('runs every function as the MATTERS_SERVICE_ACCOUNT account when the line is set', () => {
    setEnv('MATTERS_SERVICE_ACCOUNT', ` ${RUNTIME_ACCOUNT} `);
    const mod = loadModule('true');
    for (const name of FUNCTION_NAMES) expect(wireServiceAccount(mod[name])).toBe(RUNTIME_ACCOUNT);
  });

  it('keeps the default account without the line', () => {
    setEnv('MATTERS_SERVICE_ACCOUNT', undefined);
    const mod = loadModule('true');
    for (const name of FUNCTION_NAMES) expect(wireServiceAccount(mod[name])).toBeNull();
  });
});

describe('matters functions: MATTERS_SERVICE_ACCOUNT', () => {
  const originalAccount = process.env.MATTERS_SERVICE_ACCOUNT;
  const originalProject = process.env.GCLOUD_PROJECT;
  afterEach(() => {
    setEnv('MATTERS_SERVICE_ACCOUNT', originalAccount);
    setEnv('GCLOUD_PROJECT', originalProject);
  });

  it('expands the name@ shorthand with the project, and reads a full address as written', () => {
    setEnv('GCLOUD_PROJECT', 'demo-meetingguard');
    setEnv('MATTERS_SERVICE_ACCOUNT', 'matters-functions@');
    expect(mattersServiceAccountAtLoad()).toBe(RUNTIME_ACCOUNT);
    setEnv('MATTERS_SERVICE_ACCOUNT', RUNTIME_ACCOUNT);
    expect(mattersServiceAccountAtLoad()).toBe(RUNTIME_ACCOUNT);
  });

  it('reads anything that is not one service account as unset', () => {
    for (const value of [undefined, '', '   ', 'public', 'private', 'allUsers', 'ana@example.com', 'group:team@example.com', 'a@b.iam.gserviceaccount.com,c@d.iam.gserviceaccount.com']) {
      setEnv('MATTERS_SERVICE_ACCOUNT', value);
      expect(mattersServiceAccountAtLoad()).toBeNull();
    }
  });
});

describe('matters functions: inbound basic auth', () => {
  const basic = (value: string) => `Basic ${Buffer.from(value).toString('base64')}`;

  it('accepts only postmark:<password>', () => {
    expect(isInboundAuthorized(basic('postmark:s3cret'), 's3cret')).toBe(true);
    expect(isInboundAuthorized(basic('postmark:wrong'), 's3cret')).toBe(false);
    expect(isInboundAuthorized(basic('other:s3cret'), 's3cret')).toBe(false);
    expect(isInboundAuthorized(undefined, 's3cret')).toBe(false);
    expect(isInboundAuthorized('Bearer s3cret', 's3cret')).toBe(false);
    // an unset password never authorizes anything
    expect(isInboundAuthorized(basic('postmark:'), '')).toBe(false);
  });

  it('finds the provider id of a payload too large to parse, for the log line', () => {
    const big = Buffer.from(`{"From":"a@b.c","Subject":"x","MessageID":"73e6d360-66eb-11e1-8e72-a8904824019b","RawEmail":"${'x'.repeat(200_000)}`);
    expect(providerIdOf(big)).toBe('73e6d360-66eb-11e1-8e72-a8904824019b');
    expect(providerIdOf(Buffer.from('{"Subject":"no id"}'))).toBeNull();
  });
});

describe('config: tester list', () => {
  it('allows listed uids, everyone with *, nobody when empty', () => {
    expect(isMatterUserAllowed('u1, u2', 'u2')).toBe(true);
    expect(isMatterUserAllowed('u1,u2', 'u3')).toBe(false);
    expect(isMatterUserAllowed('*', 'anyone')).toBe(true);
    expect(isMatterUserAllowed('', 'u1')).toBe(false);
  });
});
