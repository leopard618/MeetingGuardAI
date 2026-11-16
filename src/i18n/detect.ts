/**
 * Device locale detection (expo-localization). Every reader is defensive: expo-localization is a
 * native module, and headless tasks / tests must still get a usable answer.
 */
import { getCalendars, getLocales } from 'expo-localization';

import { APP_LANGUAGES, type AppLanguage } from '../core/types';

const SUPPORTED: ReadonlySet<string> = new Set(APP_LANGUAGES);

export function isSupportedLanguage(value: unknown): value is AppLanguage {
  return typeof value === 'string' && SUPPORTED.has(value);
}

/**
 * Maps a language code or BCP-47 tag ("es", "es-MX", "es_ES", "EN-us", "pt-BR", "fr_CA",
 * "de-CH") to a supported app language through its primary subtag; null when it is not one of
 * APP_LANGUAGES.
 */
export function normalizeLanguage(value: unknown): AppLanguage | null {
  if (typeof value !== 'string') return null;
  const primary = value.trim().toLowerCase().split(/[-_]/)[0] ?? '';
  return isSupportedLanguage(primary) ? primary : null;
}

/** Product rule: a device in a supported language (es-*, pt-*, fr-*, de-*, en-*) gets it, every other device gets English. */
export function languageFromLocaleCode(code: string | null | undefined): AppLanguage {
  return normalizeLanguage(code) ?? 'en';
}

/** Language of the device's primary locale (es* -> 'es', pt* -> 'pt', fr* -> 'fr', de* -> 'de', anything else -> 'en'). */
export function detectDeviceLanguage(): AppLanguage {
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
