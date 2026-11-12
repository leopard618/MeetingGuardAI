/**
 * The deploy-time gate, the secret bindings and the inbound webhook's password check
 * (functions/src/matters/index.ts).
 */
import type * as MattersModuleNs from '../../src/matters';
import { isMatterUserAllowed } from '../../src/config';
import { isInboundAuthorized } from '../../src/matters';

jest.mock('firebase-functions/logger', () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

type MattersModule = typeof MattersModuleNs;

interface EndpointView {
  __endpoint?: { secretEnvironmentVariables?: { key: string }[] };
}

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

describe('matters functions: deploy gate', () => {
  const original = process.env.MATTERS_ENABLED;
  afterEach(() => {
    if (original === undefined) delete process.env.MATTERS_ENABLED;
    else process.env.MATTERS_ENABLED = original;
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

  it('exports the four callables and the webhook while it is true, each with only the secrets it needs', () => {
    const mod = loadModule(' TRUE ');
    expect(secretKeys(mod.matterDraft)).toEqual(['OPENAI_API_KEY']);
    expect(secretKeys(mod.matterRevise)).toEqual(['OPENAI_API_KEY']);
    expect(secretKeys(mod.matterConfirm)).toEqual(['POSTMARK_SERVER_TOKEN']);
    expect(secretKeys(mod.matterCancel)).toEqual([]);
    expect(secretKeys(mod.assistantInboundEmail)).toEqual(['MATTERS_INBOUND_PASSWORD']);
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
});

describe('config: tester list', () => {
  it('allows listed uids, everyone with *, nobody when empty', () => {
    expect(isMatterUserAllowed('u1, u2', 'u2')).toBe(true);
    expect(isMatterUserAllowed('u1,u2', 'u3')).toBe(false);
    expect(isMatterUserAllowed('*', 'anyone')).toBe(true);
    expect(isMatterUserAllowed('', 'u1')).toBe(false);
  });
});
