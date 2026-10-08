/**
 * TS wrapper of mg-next-meeting-widget: platform / module-missing no-ops and native delegation.
 * The wrapper resolves the native module at import time, so each case loads it in isolation.
 */

interface WrapperModule {
  isNativeModuleAvailable(): boolean;
  hasWidgets(): Promise<boolean>;
  setNextMeeting(data: unknown): Promise<void>;
  setStrings(strings: unknown): Promise<void>;
  clear(): Promise<void>;
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
    hasWidgets: jest.fn(async () => true),
    setNextMeeting: jest.fn(async () => undefined),
    setStrings: jest.fn(async () => undefined),
    clear: jest.fn(async () => undefined),
  };
}

const DATA = {
  title: 'Weekly sync',
  startAtMs: 1_760_000_000_000,
  timeText: '3:00 PM',
  dateText: 'Today',
  deepLink: 'meetingguardai://meeting/m1',
};

const STRINGS = { emptyTitle: 'No upcoming meetings', emptyBody: 'Open MeetingGuard to plan one', nowLabel: 'Happening now' };

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

describe('mg-next-meeting-widget wrapper', () => {
  it('is unavailable on iOS and every call is a safe no-op', async () => {
    const wrapper = loadWrapper({ platform: 'ios', native: fakeNative() });
    expect(wrapper.isNativeModuleAvailable()).toBe(false);
    await expect(wrapper.hasWidgets()).resolves.toBe(false);
    await expect(wrapper.setNextMeeting(DATA)).resolves.toBeUndefined();
    await expect(wrapper.setStrings(STRINGS)).resolves.toBeUndefined();
    await expect(wrapper.clear()).resolves.toBeUndefined();
  });

  it('is unavailable on android without the native module (module null or require throws)', async () => {
    const missing = loadWrapper({ platform: 'android', native: null });
    expect(missing.isNativeModuleAvailable()).toBe(false);
    await expect(missing.setNextMeeting(DATA)).resolves.toBeUndefined();

    const throwing = loadWrapper({ platform: 'android', requireThrows: true });
    expect(throwing.isNativeModuleAvailable()).toBe(false);
    await expect(throwing.hasWidgets()).resolves.toBe(false);
  });

  it('delegates to the native module on android', async () => {
    const native = fakeNative();
    const wrapper = loadWrapper({ platform: 'android', native });
    expect(wrapper.isNativeModuleAvailable()).toBe(true);
    await expect(wrapper.hasWidgets()).resolves.toBe(true);
    await wrapper.setNextMeeting(DATA);
    expect(native.setNextMeeting).toHaveBeenCalledWith(DATA);
    await wrapper.setNextMeeting(null);
    expect(native.setNextMeeting).toHaveBeenLastCalledWith(null);
    await wrapper.setStrings(STRINGS);
    expect(native.setStrings).toHaveBeenCalledWith(STRINGS);
    await wrapper.clear();
    expect(native.clear).toHaveBeenCalledTimes(1);
  });
});
