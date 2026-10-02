/**
 * Deployability contract of functions/src/whatsapp/index.ts (docs/ARCHITECTURE.md §27, mirroring
 * the zoom §24 pattern):
 * - the three whatsapp* callables always export and never bind secrets;
 * - whatsappWebhook exports ONLY while WHATSAPP_ENABLED is true when the module loads, and it is
 *   the only function binding the WHATSAPP_* secrets (plus OPENAI_API_KEY, plus the ZOOM_*
 *   secrets only while ZOOM_ENABLED is also true at load).
 */

jest.mock('firebase-functions/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

import type * as WhatsappModuleNamespace from '../../src/whatsapp';

type WhatsappModule = typeof WhatsappModuleNamespace;

interface EndpointView {
  __endpoint?: { secretEnvironmentVariables?: { key: string }[] };
}

function secretKeys(fn: unknown): string[] {
  const endpoint = (fn as EndpointView).__endpoint;
  return (endpoint?.secretEnvironmentVariables ?? []).map((secret) => secret.key).sort();
}

function loadModule(whatsappEnabled: string | undefined, zoomEnabled?: string): WhatsappModule {
  jest.resetModules();
  if (whatsappEnabled === undefined) delete process.env.WHATSAPP_ENABLED;
  else process.env.WHATSAPP_ENABLED = whatsappEnabled;
  if (zoomEnabled === undefined) delete process.env.ZOOM_ENABLED;
  else process.env.ZOOM_ENABLED = zoomEnabled;
  return jest.requireActual<WhatsappModule>('../../src/whatsapp');
}

describe('whatsapp module exports (deploy gating)', () => {
  const originalWhatsapp = process.env.WHATSAPP_ENABLED;
  const originalZoom = process.env.ZOOM_ENABLED;

  afterEach(() => {
    if (originalWhatsapp === undefined) delete process.env.WHATSAPP_ENABLED;
    else process.env.WHATSAPP_ENABLED = originalWhatsapp;
    if (originalZoom === undefined) delete process.env.ZOOM_ENABLED;
    else process.env.ZOOM_ENABLED = originalZoom;
    jest.resetModules();
  });

  it('exports only the callables while WHATSAPP_ENABLED is unset (deploy without secrets stays possible)', () => {
    const mod = loadModule(undefined);
    expect(mod.whatsappLinkStart).toBeDefined();
    expect(mod.whatsappLinkStatus).toBeDefined();
    expect(mod.whatsappUnlink).toBeDefined();
    expect(mod.whatsappWebhook).toBeUndefined();
  });

  it('exports only the callables while WHATSAPP_ENABLED=false', () => {
    const mod = loadModule('false');
    expect(mod.whatsappWebhook).toBeUndefined();
  });

  it('exports the webhook while WHATSAPP_ENABLED=true', () => {
    const mod = loadModule('true');
    expect(mod.whatsappWebhook).toBeDefined();
  });

  it('binds the WHATSAPP_* secrets plus OPENAI_API_KEY to the webhook ONLY (callables bind none)', () => {
    const mod = loadModule('true');
    expect(secretKeys(mod.whatsappLinkStart)).toEqual([]);
    expect(secretKeys(mod.whatsappLinkStatus)).toEqual([]);
    expect(secretKeys(mod.whatsappUnlink)).toEqual([]);
    expect(secretKeys(mod.whatsappWebhook)).toEqual([
      'OPENAI_API_KEY',
      'WHATSAPP_ACCESS_TOKEN',
      'WHATSAPP_APP_SECRET',
      'WHATSAPP_VERIFY_TOKEN',
    ]);
  });

  it('adds the ZOOM_* secrets to the webhook only while ZOOM_ENABLED is true at load (section 24 amendment)', () => {
    const mod = loadModule('true', 'true');
    expect(secretKeys(mod.whatsappWebhook)).toEqual([
      'OPENAI_API_KEY',
      'WHATSAPP_ACCESS_TOKEN',
      'WHATSAPP_APP_SECRET',
      'WHATSAPP_VERIFY_TOKEN',
      'ZOOM_ACCOUNT_ID',
      'ZOOM_CLIENT_ID',
      'ZOOM_CLIENT_SECRET',
    ]);
  });

  it('whatsappEnabledAtLoad accepts only a true-ish env value', () => {
    const mod = loadModule(undefined);
    expect(mod.whatsappEnabledAtLoad()).toBe(false);
    process.env.WHATSAPP_ENABLED = 'false';
    expect(mod.whatsappEnabledAtLoad()).toBe(false);
    process.env.WHATSAPP_ENABLED = ' TRUE ';
    expect(mod.whatsappEnabledAtLoad()).toBe(true);
    process.env.WHATSAPP_ENABLED = 'true';
    expect(mod.whatsappEnabledAtLoad()).toBe(true);
  });
});
