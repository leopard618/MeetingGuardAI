/**
 * Deployability contract of functions/src/zoom/index.ts (docs/ARCHITECTURE.md §24):
 * - zoomStatus always exports and never binds the ZOOM_* secrets.
 * - the three write callables export ONLY while ZOOM_ENABLED is true when the module loads
 *   (CLI discovery), and they are the only functions binding the ZOOM_* secrets.
 */

jest.mock('firebase-functions/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

import type * as ZoomModuleNamespace from '../../src/zoom';

type ZoomModule = typeof ZoomModuleNamespace;

interface EndpointView {
  __endpoint?: { secretEnvironmentVariables?: { key: string }[] };
}

function secretKeys(fn: unknown): string[] {
  const endpoint = (fn as EndpointView).__endpoint;
  return (endpoint?.secretEnvironmentVariables ?? []).map((secret) => secret.key).sort();
}

function loadZoomModule(zoomEnabled: string | undefined): ZoomModule {
  jest.resetModules();
  if (zoomEnabled === undefined) {
    delete process.env.ZOOM_ENABLED;
  } else {
    process.env.ZOOM_ENABLED = zoomEnabled;
  }
  return jest.requireActual<ZoomModule>('../../src/zoom');
}

describe('zoom module exports (deploy gating)', () => {
  const originalValue = process.env.ZOOM_ENABLED;

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.ZOOM_ENABLED;
    } else {
      process.env.ZOOM_ENABLED = originalValue;
    }
    jest.resetModules();
  });

  it('exports only zoomStatus while ZOOM_ENABLED is unset (deploy without secrets stays possible)', () => {
    const mod = loadZoomModule(undefined);
    expect(mod.zoomStatus).toBeDefined();
    expect(mod.zoomCreateMeeting).toBeUndefined();
    expect(mod.zoomSyncMeeting).toBeUndefined();
    expect(mod.zoomDeleteMeeting).toBeUndefined();
  });

  it('exports only zoomStatus while ZOOM_ENABLED=false', () => {
    const mod = loadZoomModule('false');
    expect(mod.zoomStatus).toBeDefined();
    expect(mod.zoomCreateMeeting).toBeUndefined();
  });

  it('exports the write callables while ZOOM_ENABLED=true', () => {
    const mod = loadZoomModule('true');
    expect(mod.zoomStatus).toBeDefined();
    expect(mod.zoomCreateMeeting).toBeDefined();
    expect(mod.zoomSyncMeeting).toBeDefined();
    expect(mod.zoomDeleteMeeting).toBeDefined();
  });

  it('binds the ZOOM_* secrets to the write callables ONLY (zoomStatus deploys without them)', () => {
    const mod = loadZoomModule('true');
    expect(secretKeys(mod.zoomStatus)).toEqual([]);
    const expected = ['ZOOM_ACCOUNT_ID', 'ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET'];
    expect(secretKeys(mod.zoomCreateMeeting)).toEqual(expected);
    expect(secretKeys(mod.zoomSyncMeeting)).toEqual(expected);
    expect(secretKeys(mod.zoomDeleteMeeting)).toEqual(expected);
  });

  it('zoomWriteCallablesEnabledAtLoad accepts only a true-ish env value', () => {
    const mod = loadZoomModule(undefined);
    expect(mod.zoomWriteCallablesEnabledAtLoad()).toBe(false);
    process.env.ZOOM_ENABLED = 'false';
    expect(mod.zoomWriteCallablesEnabledAtLoad()).toBe(false);
    process.env.ZOOM_ENABLED = ' TRUE ';
    expect(mod.zoomWriteCallablesEnabledAtLoad()).toBe(true);
    process.env.ZOOM_ENABLED = 'true';
    expect(mod.zoomWriteCallablesEnabledAtLoad()).toBe(true);
  });
});
