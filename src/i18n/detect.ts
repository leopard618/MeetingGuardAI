/**
 * Device locale detection (expo-localization). Every reader is defensive: expo-localization is a
 * native module, and headless tasks / tests must still get a usable answer.
 */
import { getCalendars, getLocales } from 'expo-localization';

import { LANGUAGES, type Language } from '../core/types';

const SUPPORTED: ReadonlySet<string> = new Set(LANGUAGES);

export function isSupportedLanguage(value: unknown): value is Language {
  return typeof value === 'string' && SUPPORTED.has(value);
}

/**
 * Maps a language code or BCP-47 tag ("es", "es-MX", "es_ES", "EN-us") to a supported language;
 * null when it is not English or Spanish.
 */
export function normalizeLanguage(value: unknown): Language | null {
  if (typeof value !== 'string') return null;
  const primary = value.trim().toLowerCase().split(/[-_]/)[0] ?? '';
  return isSupportedLanguage(primary) ? primary : null;
}

/** Product rule: a Spanish device (es-*) gets Spanish, every other device gets English. */
export function languageFromLocaleCode(code: string | null | undefined): Language {
  return normalizeLanguage(code) === 'es' ? 'es' : 'en';
}

/** Language of the device's primary locale (es* -> 'es', anything else -> 'en'). */
export function detectDeviceLanguage(): Language {
  try {
    const [primary] = getLocales();
    return languageFromLocaleCode(primary?.languageCode ?? primary?.languageTag);
  } catch {
    return 'en';
  }
}

/** IANA zone of the device calendar settings; null when unavailable. */
export function detectDeviceTimeZone(): string | null {
  try {
    return getCalendars()[0]?.timeZone ?? null;
  } catch {
    return null;
  }
}

/** The device's 12/24-hour setting; null when unknown (web, tests, old OS versions). */
export function deviceUses24HourClock(): boolean | null {
  try {
    const value = getCalendars()[0]?.uses24hourClock;
    return typeof value === 'boolean' ? value : null;
  } catch {
    return null;
  }
}
