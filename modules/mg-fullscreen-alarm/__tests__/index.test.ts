/**
 * TS wrapper of mg-fullscreen-alarm: platform / module-missing no-ops and native delegation.
 * The wrapper resolves the native module at import time, so each case loads it in isolation.
 */

interface WrapperModule {
  isNativeModuleAvailable(): boolean;
  setAlarms(alarms: readonly unknown[], scope?: string): Promise<void>;
  clearAlarms(ids?: readonly string[]): Promise<void>;
  getStatus(): Promise<{ exactAllowed: boolean; fullScreenAllowed: boolean; notificationsAllowed: boolean }>;
  openFullScreenIntentSettings(): Promise<void>;
  UNAVAILABLE_STATUS: { exactAllowed: boolean; fullScreenAllowed: boolean; notificationsAllowed: boolean };
}

function loadWrapper(options: { platform: string; native?: Record<string, jest.Mock> | null; requireThrows?: boolean }): WrapperModule {
  let wrapper: WrapperModule | undefined;
  jest.isolateModules(() => {
    jest.doMock('react-native', () => ({ Platform: { OS: options.platform } }));
    jest.doMock('expo', () => ({
      requireOptionalNativeModule: jest.fn(() => {
        if (options.requireThrows) throw new Error('no runtime');
        return options.native ?? null;
      }),
    }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    wrapper = require('..') as WrapperModule;
  });
  if (!wrapper) throw new Error('wrapper did not load');
  return wrapper;
}

function fakeNative(): Record<string, jest.Mock> {
  return {
    setAlarms: jest.fn(async () => undefined),
    clearAlarms: jest.fn(async () => undefined),
    getStatus: jest.fn(async () => ({ exactAllowed: true, fullScreenAllowed: false, notificationsAllowed: true })),
    openFullScreenIntentSettings: jest.fn(async () => undefined),
    getFired: jest.fn(async () => []),
    clearFired: jest.fn(async () => undefined),
  };
}

const SPEC = {
  id: 'mg:m1:5',
  atMs: 1_760_000_000_000,
  title: 't',
  body: 'b',
  deepLink: 'meetingguardai://meeting/m1',
  channelId: 'mg-alert-max-v2',
};

afterEach(() => {
  jest.resetModules();
});

it('is a no-op on iOS (never resolves the native module)', async () => {
  const wrapper = loadWrapper({ platform: 'ios', native: fakeNative() });
  expect(wrapper.isNativeModuleAvailable()).toBe(false);
  await expect(wrapper.setAlarms([SPEC])).resolves.toBeUndefined();
  await expect(wrapper.getStatus()).resolves.toEqual(wrapper.UNAVAILABLE_STATUS);
});

it('is a no-op on Android when the binary lacks the module (OTA update case)', async () => {
  const wrapper = loadWrapper({ platform: 'android', native: null });
  expect(wrapper.isNativeModuleAvailable()).toBe(false);
  await expect(wrapper.clearAlarms(['mg:m1:5'])).resolves.toBeUndefined();
  await expect(wrapper.openFullScreenIntentSettings()).resolves.toBeUndefined();
});

it('stays a no-op when requireOptionalNativeModule itself throws', async () => {
  const wrapper = loadWrapper({ platform: 'android', requireThrows: true });
  expect(wrapper.isNativeModuleAvailable()).toBe(false);
  await expect(wrapper.getStatus()).resolves.toEqual(wrapper.UNAVAILABLE_STATUS);
});

it('delegates to the native module on Android', async () => {
  const native = fakeNative();
  const wrapper = loadWrapper({ platform: 'android', native });
  expect(wrapper.isNativeModuleAvailable()).toBe(true);

  await wrapper.setAlarms([SPEC]);
  // The optional data field always reaches the native record (an empty string when absent).
  expect(native.setAlarms).toHaveBeenCalledWith([{ ...SPEC, data: '' }], null);
  await wrapper.setAlarms([SPEC], 'mgbrief:');
  expect(native.setAlarms).toHaveBeenLastCalledWith([{ ...SPEC, data: '' }], 'mgbrief:');

  await wrapper.clearAlarms(['mg:m1:5']);
  expect(native.clearAlarms).toHaveBeenCalledWith(['mg:m1:5']);
  await wrapper.clearAlarms();
  expect(native.clearAlarms).toHaveBeenLastCalledWith(null);

  await wrapper.openFullScreenIntentSettings();
  expect(native.openFullScreenIntentSettings).toHaveBeenCalled();

  await expect(wrapper.getStatus()).resolves.toEqual({
    exactAllowed: true,
    fullScreenAllowed: false,
    notificationsAllowed: true,
  });
});

it('sanitizes a malformed native status to booleans', async () => {
  const native = fakeNative();
  native.getStatus.mockResolvedValueOnce({ exactAllowed: 1, fullScreenAllowed: 'yes', notificationsAllowed: true });
  const wrapper = loadWrapper({ platform: 'android', native });
  await expect(wrapper.getStatus()).resolves.toEqual({
    exactAllowed: false,
    fullScreenAllowed: false,
    notificationsAllowed: true,
  });
});

describe('fired alarms', () => {
  it('returns nothing and does nothing without the module', async () => {
    const wrapper = loadWrapper({ platform: 'android', native: null }) as WrapperModule & {
      getFired(scope?: string): Promise<unknown[]>;
      clearFired(ids?: readonly string[]): Promise<void>;
    };
    await expect(wrapper.getFired('mg:')).resolves.toEqual([]);
    await expect(wrapper.clearFired(['mg:m1:5'])).resolves.toBeUndefined();
  });

  it('delegates getFired (normalising the records) and clearFired', async () => {
    const native = fakeNative();
    native.getFired.mockResolvedValueOnce([
      { id: 'mg:m1:5', firedAtMs: 1_760_000_000_000, title: 't', body: 'b', deepLink: 'meetingguardai://meeting/m1', data: '{"v":1}' },
      { id: 'mg:m2:5', firedAtMs: 'bad' },
      { title: 'no id' },
      null,
    ]);
    const wrapper = loadWrapper({ platform: 'android', native }) as WrapperModule & {
      getFired(scope?: string): Promise<unknown[]>;
      clearFired(ids?: readonly string[]): Promise<void>;
    };
    await expect(wrapper.getFired('mg:')).resolves.toEqual([
      { id: 'mg:m1:5', firedAtMs: 1_760_000_000_000, title: 't', body: 'b', deepLink: 'meetingguardai://meeting/m1', data: '{"v":1}' },
      { id: 'mg:m2:5', firedAtMs: 0, title: '', body: '', deepLink: '', data: '' },
    ]);
    expect(native.getFired).toHaveBeenCalledWith('mg:');
    await wrapper.getFired();
    expect(native.getFired).toHaveBeenLastCalledWith(null);

    await wrapper.clearFired(['mg:m1:5']);
    expect(native.clearFired).toHaveBeenCalledWith(['mg:m1:5']);
    await wrapper.clearFired();
    expect(native.clearFired).toHaveBeenLastCalledWith(null);
  });

  it('passes the data field through setAlarms', async () => {
    const native = fakeNative();
    const wrapper = loadWrapper({ platform: 'android', native });
    await wrapper.setAlarms([{ ...SPEC, data: '{"v":1}' }], 'mg:');
    expect(native.setAlarms).toHaveBeenCalledWith([{ ...SPEC, data: '{"v":1}' }], 'mg:');
  });
});
