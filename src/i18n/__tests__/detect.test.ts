import { getCalendars, getLocales } from 'expo-localization';

import { detectDeviceLanguage, deviceUses24HourClock, languageFromLocaleCode, normalizeLanguage } from '../detect';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(),
  getCalendars: jest.fn(),
}));

const mockedGetLocales = getLocales as jest.Mock;
const mockedGetCalendars = getCalendars as jest.Mock;

describe('normalizeLanguage', () => {
  it.each([
    ['es', 'es'],
    ['es-MX', 'es'],
    ['es_ES', 'es'],
    ['EN-us', 'en'],
    [' en ', 'en'],
    ['fr', 'fr'],
    ['pt-BR', 'pt'],
    ['pt_PT', 'pt'],
    ['fr-CA', 'fr'],
    ['de-AT', 'de'],
    ['de-CH', 'de'],
    ['it', null],
    ['hi-IN', null],
    ['', null],
    [null, null],
    [42, null],
  ])('%p -> %p', (input, expected) => {
    expect(normalizeLanguage(input)).toBe(expected);
  });
});

describe('languageFromLocaleCode (a supported language, else en)', () => {
  it.each([
    ['es-419', 'es'],
    ['pt-BR', 'pt'],
    ['pt-PT', 'pt'],
    ['fr-CA', 'fr'],
    ['de-CH', 'de'],
    ['en-GB', 'en'],
    ['hi-IN', 'en'],
    ['zh-Hans-CN', 'en'],
    [null, 'en'],
    [undefined, 'en'],
  ])('%p -> %p', (input, expected) => {
    expect(languageFromLocaleCode(input)).toBe(expected);
  });
});

describe('device detection', () => {
  it('uses the primary locale', () => {
    mockedGetLocales.mockReturnValue([{ languageCode: 'es', languageTag: 'es-AR' }, { languageCode: 'en' }]);
    expect(detectDeviceLanguage()).toBe('es');
    mockedGetLocales.mockReturnValue([{ languageCode: 'de', languageTag: 'de-DE' }, { languageCode: 'es' }]);
    expect(detectDeviceLanguage()).toBe('de');
    mockedGetLocales.mockReturnValue([{ languageCode: 'it', languageTag: 'it-IT' }, { languageCode: 'es' }]);
    expect(detectDeviceLanguage()).toBe('en');
  });

  it('falls back to English when the native module fails', () => {
    mockedGetLocales.mockImplementation(() => {
      throw new Error('native module missing');
    });
    expect(detectDeviceLanguage()).toBe('en');
  });

  it('reads the 24-hour clock setting, null when unknown', () => {
    mockedGetCalendars.mockReturnValue([{ uses24hourClock: true, timeZone: 'Europe/Madrid' }]);
    expect(deviceUses24HourClock()).toBe(true);
    mockedGetCalendars.mockReturnValue([{ uses24hourClock: null, timeZone: null }]);
    expect(deviceUses24HourClock()).toBeNull();
  });
});
