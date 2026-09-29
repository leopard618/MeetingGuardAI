import { getUpdateInfo, reportUpdateLaunch, resetUpdateReportForTests, shortUpdateLabel, type UpdateInfo } from '../updates';

const base: UpdateInfo = {
  enabled: true,
  channel: 'production',
  runtimeVersion: '1.1.0',
  updateId: '1a2b3c4d-5e6f-7a8b-9c0d-112233445566',
  embedded: false,
  emergencyLaunch: false,
};

afterEach(() => {
  jest.restoreAllMocks();
  resetUpdateReportForTests();
});

describe('updates', () => {
  it('reads the expo-updates state without throwing under Jest', () => {
    const info = getUpdateInfo();
    expect(typeof info.enabled).toBe('boolean');
    expect(typeof info.embedded).toBe('boolean');
  });

  it('labels an OTA update with its short id and channel, never the built-in bundle', () => {
    expect(shortUpdateLabel(base)).toEqual({ id: '1a2b3c4d', channel: 'production' });
    expect(shortUpdateLabel({ ...base, embedded: true })).toBeNull();
    expect(shortUpdateLabel({ ...base, enabled: false })).toBeNull();
    expect(shortUpdateLabel({ ...base, updateId: null })).toBeNull();
    expect(shortUpdateLabel({ ...base, channel: null })).toEqual({ id: '1a2b3c4d', channel: '-' });
  });

  it('logs an emergency launch once as a warning, never as a second Sentry error', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    reportUpdateLaunch({ ...base, emergencyLaunch: true });
    reportUpdateLaunch({ ...base, emergencyLaunch: true });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[1])).toContain('emergency launch');
    expect(error).not.toHaveBeenCalled();
  });

  it('does not report a normal launch', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    reportUpdateLaunch(base);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('reports nothing when updates are disabled (development, no expo-updates)', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    // A fresh latch: this call reaches the enabled check itself.
    reportUpdateLaunch({ ...base, enabled: false, emergencyLaunch: true });
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
