/**
 * Full-screen alarm glue (../fsi.ts): FullScreenAlarmModule contract over the local module's
 * TS wrapper. Unavailable => every method is a resolving no-op (the engine falls back to
 * expo-notifications); available => calls are delegated 1:1.
 */
import type { FullScreenAlarmSpec } from '../../../core/contracts';

const mockWrapper = {
  isNativeModuleAvailable: jest.fn((): boolean => false),
  setAlarms: jest.fn(async (_alarms: unknown) => undefined),
  clearAlarms: jest.fn(async (_ids?: readonly string[]) => undefined),
  getStatus: jest.fn(async () => ({ exactAllowed: true, fullScreenAllowed: true, notificationsAllowed: true })),
  openFullScreenIntentSettings: jest.fn(async () => undefined),
  getFired: jest.fn(async (_scope?: string) => [] as unknown[]),
  clearFired: jest.fn(async (_ids?: readonly string[]) => undefined),
  UNAVAILABLE_STATUS: { exactAllowed: false, fullScreenAllowed: false, notificationsAllowed: false },
};

jest.mock('../../../../modules/mg-fullscreen-alarm', () => mockWrapper);

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { fullScreenAlarm } = require('../fsi') as typeof import('../fsi');

const SPEC: FullScreenAlarmSpec = {
  id: 'mg:m1:5',
  atMs: 1_760_000_000_000,
  title: 'Meeting m1 starts in 5 minutes',
  body: '12:00',
  deepLink: 'meetingguardai://meeting/m1',
  channelId: 'mg-alert-max-v2',
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('module missing (iOS / web / old binary)', () => {
  beforeEach(() => mockWrapper.isNativeModuleAvailable.mockReturnValue(false));

  it('is unavailable and every method resolves without touching the native side', async () => {
    expect(fullScreenAlarm.isAvailable()).toBe(false);
    await expect(fullScreenAlarm.setAlarms([SPEC])).resolves.toBeUndefined();
    await expect(fullScreenAlarm.clearAlarms()).resolves.toBeUndefined();
    await expect(fullScreenAlarm.openFullScreenIntentSettings()).resolves.toBeUndefined();
    await expect(fullScreenAlarm.getStatus()).resolves.toEqual({
      exactAllowed: false,
      fullScreenAllowed: false,
      notificationsAllowed: false,
    });
    expect(mockWrapper.setAlarms).not.toHaveBeenCalled();
    expect(mockWrapper.clearAlarms).not.toHaveBeenCalled();
    expect(mockWrapper.getStatus).not.toHaveBeenCalled();
    expect(mockWrapper.openFullScreenIntentSettings).not.toHaveBeenCalled();
    await expect(fullScreenAlarm.getFired('mg:')).resolves.toEqual([]);
    await expect(fullScreenAlarm.clearFired(['mg:m1:5'])).resolves.toBeUndefined();
    expect(mockWrapper.getFired).not.toHaveBeenCalled();
    expect(mockWrapper.clearFired).not.toHaveBeenCalled();
  });
});

describe('module present (Android)', () => {
  beforeEach(() => mockWrapper.isNativeModuleAvailable.mockReturnValue(true));

  it('delegates setAlarms with the exact spec fields and the scope', async () => {
    const mapped = [
      {
        id: 'mg:m1:5',
        atMs: 1_760_000_000_000,
        title: 'Meeting m1 starts in 5 minutes',
        body: '12:00',
        deepLink: 'meetingguardai://meeting/m1',
        channelId: 'mg-alert-max-v2',
      },
    ];
    await fullScreenAlarm.setAlarms([SPEC]);
    expect(mockWrapper.setAlarms).toHaveBeenLastCalledWith(mapped, undefined);
    await fullScreenAlarm.setAlarms([SPEC], 'mg:');
    expect(mockWrapper.setAlarms).toHaveBeenLastCalledWith(mapped, 'mg:');
  });

  it('delegates clearAlarms with and without ids', async () => {
    await fullScreenAlarm.clearAlarms(['mg:m1:5']);
    expect(mockWrapper.clearAlarms).toHaveBeenCalledWith(['mg:m1:5']);
    await fullScreenAlarm.clearAlarms();
    expect(mockWrapper.clearAlarms).toHaveBeenLastCalledWith(undefined);
  });

  it('delegates getStatus and openFullScreenIntentSettings', async () => {
    await expect(fullScreenAlarm.getStatus()).resolves.toEqual({
      exactAllowed: true,
      fullScreenAllowed: true,
      notificationsAllowed: true,
    });
    await fullScreenAlarm.openFullScreenIntentSettings();
    expect(mockWrapper.openFullScreenIntentSettings).toHaveBeenCalled();
  });

  it('passes the data field through and delegates the fired-alarm calls', async () => {
    await fullScreenAlarm.setAlarms([{ ...SPEC, data: '{"v":1}' }], 'mg:');
    expect(mockWrapper.setAlarms).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'mg:m1:5', data: '{"v":1}' })], 'mg:');
    const fired = [{ id: 'mg:m1:5', firedAtMs: 1, title: 't', body: 'b', deepLink: '', data: '{"v":1}' }];
    mockWrapper.getFired.mockResolvedValueOnce(fired);
    await expect(fullScreenAlarm.getFired('mg:')).resolves.toEqual(fired);
    expect(mockWrapper.getFired).toHaveBeenCalledWith('mg:');
    await fullScreenAlarm.clearFired(['mg:m1:5']);
    expect(mockWrapper.clearFired).toHaveBeenCalledWith(['mg:m1:5']);
    await fullScreenAlarm.clearFired();
    expect(mockWrapper.clearFired).toHaveBeenLastCalledWith(undefined);
  });

  it('propagates native failures to the caller (the engine logs and falls back)', async () => {
    mockWrapper.setAlarms.mockRejectedValueOnce(new Error('native down'));
    await expect(fullScreenAlarm.setAlarms([SPEC])).rejects.toThrow('native down');
  });
});
