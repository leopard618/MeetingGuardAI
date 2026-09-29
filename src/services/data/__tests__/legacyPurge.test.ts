import AsyncStorage from '@react-native-async-storage/async-storage';

import { LEGACY_DATA_KEY } from '../../../core/identifiers';
import { purgeLegacyCredentials } from '../legacyPurge';

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('purgeLegacyCredentials (app start)', () => {
  it('removes every pre-rebuild token and identity key but keeps the legacy data blob and app keys', async () => {
    await AsyncStorage.multiSet([
      ['google_refresh_token', 'secret-refresh'],
      ['google_access_token', 'secret-access'],
      ['authToken', 'jwt'],
      ['auth_token', 'jwt2'],
      ['refresh_token', 'r'],
      ['refreshToken', 'r2'],
      ['google_code_verifier', 'pkce'],
      ['userData', '{"token":"x"}'],
      ['alertSchedule_m1', '{}'],
      [LEGACY_DATA_KEY, '{"meetings":[]}'],
      ['mg:language', 'es'],
      ['mg:user1:meetings:m1', '{}'],
    ]);

    const removed = await purgeLegacyCredentials();

    expect(removed).toBe(9);
    expect([...(await AsyncStorage.getAllKeys())].sort()).toEqual([LEGACY_DATA_KEY, 'mg:language', 'mg:user1:meetings:m1'].sort());
  });

  it('never throws when storage fails', async () => {
    const failing = {
      getAllKeys: jest.fn(async () => {
        throw new Error('disk');
      }),
      multiRemove: jest.fn(),
    };
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(purgeLegacyCredentials(failing)).resolves.toBe(0);
  });
});
