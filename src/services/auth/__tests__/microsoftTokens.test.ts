import { AppError } from '../../../core/errors';
import { SECURE_STORE_KEYS } from '../../../core/identifiers';
import { clearMicrosoftToken, getMicrosoftRefreshToken, saveMicrosoftRefreshToken } from '../microsoftTokens';

const mockSetItemAsync = jest.fn(async (..._args: unknown[]) => undefined);
const mockGetItemAsync = jest.fn(async (..._args: unknown[]): Promise<string | null> => null);
const mockDeleteItemAsync = jest.fn(async (..._args: unknown[]) => undefined);

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK: 'AFTER_FIRST_UNLOCK',
  setItemAsync: (...args: unknown[]) => mockSetItemAsync(...args),
  getItemAsync: (...args: unknown[]) => mockGetItemAsync(...args),
  deleteItemAsync: (...args: unknown[]) => mockDeleteItemAsync(...args),
}));

const UID = 'user-1';
const KEY = SECURE_STORE_KEYS.microsoftRefreshToken(UID);

beforeEach(() => {
  jest.clearAllMocks();
  mockGetItemAsync.mockResolvedValue(null);
});

describe('microsoftTokens', () => {
  it('stores the refresh token under the per-uid key', async () => {
    await saveMicrosoftRefreshToken(UID, 'refresh-1');
    expect(mockSetItemAsync).toHaveBeenCalledWith(
      KEY,
      'refresh-1',
      expect.objectContaining({ keychainAccessible: 'AFTER_FIRST_UNLOCK' }),
    );
  });

  it('rejects an empty token', async () => {
    await expect(saveMicrosoftRefreshToken(UID, '')).rejects.toMatchObject({ code: 'invalid_input' });
    expect(mockSetItemAsync).not.toHaveBeenCalled();
  });

  it('save failures surface as calendar_not_connected (never silent success)', async () => {
    mockSetItemAsync.mockRejectedValueOnce(new Error('keystore unavailable'));
    await expect(saveMicrosoftRefreshToken(UID, 'refresh-1')).rejects.toMatchObject({ code: 'calendar_not_connected' });
  });

  it('reads the stored token and null when absent', async () => {
    await expect(getMicrosoftRefreshToken(UID)).resolves.toBeNull();
    mockGetItemAsync.mockResolvedValueOnce('refresh-2');
    await expect(getMicrosoftRefreshToken(UID)).resolves.toBe('refresh-2');
    expect(mockGetItemAsync).toHaveBeenCalledWith(KEY, expect.anything());
  });

  it('an unreadable keystore throws calendar_not_connected instead of pretending "no token"', async () => {
    mockGetItemAsync.mockRejectedValueOnce(new Error('keystore unavailable'));
    await expect(getMicrosoftRefreshToken(UID)).rejects.toBeInstanceOf(AppError);
    mockGetItemAsync.mockRejectedValueOnce(new Error('keystore unavailable'));
    await expect(getMicrosoftRefreshToken(UID)).rejects.toMatchObject({ code: 'calendar_not_connected' });
  });

  it('clear deletes the key and never throws (sign-out must not be blocked)', async () => {
    await clearMicrosoftToken(UID);
    expect(mockDeleteItemAsync).toHaveBeenCalledWith(KEY, expect.anything());
    mockDeleteItemAsync.mockRejectedValueOnce(new Error('keystore unavailable'));
    await expect(clearMicrosoftToken(UID)).resolves.toBeUndefined();
  });
});
