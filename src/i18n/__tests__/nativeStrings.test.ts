/**
 * Native strings (src/i18n/native/<lang>.json): the iOS permission prompts per language, wired
 * through the Expo `locales` config in app.config.js (each file becomes <lang>.lproj/
 * InfoPlist.strings at prebuild). Expo writes `key = "value";` without escaping
 * (@expo/config-plugins build/ios/Locales.js), so a double quote, a backslash or a line break in a
 * value breaks the iOS build. The English file must equal the base Info.plist values in
 * app.config.js. Same banned characters as the locale files (noTypographicChars.test.ts).
 */
import * as fs from 'fs';
import * as path from 'path';

const NATIVE_ROOT = path.resolve(__dirname, '..', 'native');
const LANGS = ['en', 'es', 'pt', 'fr', 'de'] as const;
const IOS_KEYS = [
  'NSCalendarsUsageDescription',
  'NSCalendarsFullAccessUsageDescription',
  'NSPhotoLibraryUsageDescription',
  'NSCameraUsageDescription',
  'NSMicrophoneUsageDescription',
  'NSSpeechRecognitionUsageDescription',
].sort();

// Built from code points so this file itself contains none of the banned characters.
const BANNED_CODES = [0x2014, 0x2013, 0x2026, 0x2018, 0x2019, 0x201c, 0x201d, 0x201e, 0x201a, 0x00a0, 0x202f];
const BANNED = new RegExp(`[${BANNED_CODES.map((c) => String.fromCodePoint(c)).join('')}]`);

type NativeFile = { ios: Record<string, string> };

function load(lang: string): NativeFile {
  return JSON.parse(fs.readFileSync(path.join(NATIVE_ROOT, `${lang}.json`), 'utf8')) as NativeFile;
}

describe('native strings (iOS InfoPlist.strings per language)', () => {
  test('there is one file per app language and nothing else', () => {
    const files = fs.readdirSync(NATIVE_ROOT).filter((f) => f.endsWith('.json')).sort();
    expect(files).toEqual(LANGS.map((l) => `${l}.json`).sort());
  });

  test.each(LANGS)('%s has exactly the six iOS usage keys, each a non-empty string', (lang) => {
    const file = load(lang);
    expect(Object.keys(file)).toEqual(['ios']);
    expect(Object.keys(file.ios).sort()).toEqual(IOS_KEYS);
    for (const value of Object.values(file.ios)) {
      expect(typeof value).toBe('string');
      expect(value.trim().length).toBeGreaterThan(0);
    }
  });

  test.each(LANGS)('%s values are safe for an unescaped .strings file and plain punctuation', (lang) => {
    const offenders: string[] = [];
    for (const [key, value] of Object.entries(load(lang).ios)) {
      if (/["\\\r\n]/.test(value)) offenders.push(`${key}: double quote, backslash or line break`);
      const match = BANNED.exec(value);
      if (match) offenders.push(`${key}: U+${match[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`);
      if (!value.includes('Meeting Guard AI')) offenders.push(`${key}: brand name missing`);
    }
    expect(offenders).toEqual([]);
  });

  test('the calendar full-access text equals the calendar text in every language', () => {
    for (const lang of LANGS) {
      const { ios } = load(lang);
      expect(ios.NSCalendarsFullAccessUsageDescription).toBe(ios.NSCalendarsUsageDescription);
    }
  });

  test('the files differ per language (no untranslated copy of English)', () => {
    const en = load('en').ios;
    for (const lang of LANGS.filter((l) => l !== 'en')) {
      const other = load(lang).ios;
      for (const key of IOS_KEYS) expect(other[key]).not.toBe(en[key]);
    }
  });

  test('app.config.js points the Expo locales at these files and lists the same languages', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const config = require('../../../app.config.js') as {
      expo: { locales?: Record<string, string>; plugins: unknown[] };
    };
    expect(config.expo.locales).toEqual(
      Object.fromEntries(LANGS.map((l) => [l, `./src/i18n/native/${l}.json`])),
    );
    const localization = config.expo.plugins.find(
      (p): p is [string, { supportedLocales: { ios: string[]; android: string[] } }] =>
        Array.isArray(p) && p[0] === 'expo-localization',
    );
    expect(localization?.[1].supportedLocales.ios).toEqual([...LANGS]);
    expect(localization?.[1].supportedLocales.android).toEqual([...LANGS]);

    // en.json repeats the base Info.plist values that the plugins write.
    const options = (name: string) =>
      (config.expo.plugins.find((p) => Array.isArray(p) && p[0] === name) as [string, Record<string, string>])[1];
    const en = load('en').ios;
    expect(options('expo-calendar').calendarPermission).toBe(en.NSCalendarsUsageDescription);
    expect(options('expo-image-picker').photosPermission).toBe(en.NSPhotoLibraryUsageDescription);
    expect(options('expo-image-picker').cameraPermission).toBe(en.NSCameraUsageDescription);
    expect(options('expo-speech-recognition').microphonePermission).toBe(en.NSMicrophoneUsageDescription);
    expect(options('expo-speech-recognition').speechRecognitionPermission).toBe(
      en.NSSpeechRecognitionUsageDescription,
    );
  });
});
