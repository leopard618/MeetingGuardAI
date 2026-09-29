/**
 * i18next setup and the non-React language API (usable in headless tasks).
 *
 * - Importing this module initializes i18next SYNCHRONOUSLY with the bundled resources and the
 *   device language, so `t` works immediately (headless notification text, module-scope code).
 * - initI18n() then applies the language persisted in GLOBAL_STORAGE_KEYS.language (an explicit
 *   choice always wins over the device language). Idempotent.
 * - setLanguage() switches instantly (react-i18next re-renders every subscriber), persists the
 *   choice and emits `language:changed`. For source 'user' the data layer writes
 *   Preferences.language (this module is L1 and never imports data).
 * - A synced Preferences.language (another device, or the account's saved choice at session
 *   start) is applied with source 'preferences' through the `preferences:changed` event.
 * - Registers expo-localization as the device time-zone provider of core/time.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import i18next, { type i18n as I18nInstance, type Resource } from 'i18next';
import { initReactI18next } from 'react-i18next';

import { I18N_NAMESPACE_LIST, type TranslateFn } from '../core/contracts';
import { AppError, toAppError } from '../core/errors';
import { appEvents, type LanguageChangedEvent, type PreferencesChangedEvent } from '../core/events';
import { GLOBAL_STORAGE_KEYS } from '../core/identifiers';
import { createLogger } from '../core/logger';
import { setDeviceTimeZoneProvider } from '../core/time';
import { LANGUAGES, type Language } from '../core/types';
import { detectDeviceLanguage, detectDeviceTimeZone, isSupportedLanguage, normalizeLanguage } from './detect';
import { RESOURCES } from './resources';

const log = createLogger('i18n');

export const SUPPORTED_LANGUAGES: readonly Language[] = LANGUAGES;
export const I18N_NAMESPACES = I18N_NAMESPACE_LIST;
export const DEFAULT_NAMESPACE = 'common';
export const FALLBACK_LANGUAGE: Language = 'en';

export type LanguageSource = LanguageChangedEvent['source'];

/** The shared i18next instance (also bound to react-i18next). */
export const i18n: I18nInstance = i18next;

type RawTranslate = (key: string, options?: Record<string, unknown>) => unknown;

/** true once the user (or the synced preferences) chose a language; the device language then no longer applies. */
let hasExplicitChoice = false;
/** Incremented on every language change; lets the async restore skip if the user was faster. */
let changeCounter = 0;
let restorePromise: Promise<void> | null = null;

function initializeSync(): void {
  if (i18n.isInitialized) return;
  setDeviceTimeZoneProvider(detectDeviceTimeZone);
  const isDev = typeof __DEV__ !== 'undefined' && __DEV__;
  // initAsync: false + inline resources => initialization completes synchronously.
  void i18n.use(initReactI18next).init({
    resources: RESOURCES as unknown as Resource,
    lng: detectDeviceLanguage(),
    fallbackLng: FALLBACK_LANGUAGE,
    supportedLngs: [...LANGUAGES],
    load: 'languageOnly',
    ns: [...I18N_NAMESPACE_LIST],
    defaultNS: DEFAULT_NAMESPACE,
    fallbackNS: false,
    interpolation: { escapeValue: false },
    returnNull: false,
    returnEmptyString: false,
    appendNamespaceToMissingKey: true,
    initAsync: false,
    saveMissing: isDev,
    missingKeyHandler: isDev
      ? (_languages, namespace, key) => log.warn(`missing translation "${namespace}:${key}"`)
      : false,
    react: { useSuspense: false },
  });
}

initializeSync();

/** Current UI language (always a supported language). */
export function getLanguage(): Language {
  return normalizeLanguage(i18n.resolvedLanguage ?? i18n.language) ?? FALLBACK_LANGUAGE;
}

/**
 * Translates a NAMESPACE-QUALIFIED key ("alerts:max.title") in the current language (or
 * `options.lng`). Missing keys return the key itself.
 */
export const t: TranslateFn = (key, options) => {
  const result = (i18n as unknown as { t: RawTranslate }).t(key, options);
  return typeof result === 'string' ? result : key;
};

/**
 * Raw lookup that can return arrays/objects (legacy screens read string arrays such as
 * "whatsAppBot.features"). Only for the translations.jsx compat layer.
 */
export function translateRaw(key: string, options: Record<string, unknown>): unknown {
  return (i18n as unknown as { t: RawTranslate }).t(key, { ...options, returnObjects: true });
}

async function persistLanguage(language: Language): Promise<void> {
  try {
    await AsyncStorage.setItem(GLOBAL_STORAGE_KEYS.language, language);
  } catch (error) {
    // The switch already happened; only its persistence across restarts failed.
    log.error('could not persist the language choice', toAppError(error));
  }
}

/**
 * Switches the UI language instantly. `source` (default 'user'):
 * - 'user': explicit choice; persisted locally and (by the data layer) to Preferences.language.
 * - 'preferences': applied from synced preferences; persisted locally only.
 * - 'device': device/initial language; not persisted (the device may change it again).
 * Emits `language:changed` when the language actually changes.
 */
export async function setLanguage(
  language: Language,
  options: { source?: LanguageSource } = {},
): Promise<void> {
  const source = options.source ?? 'user';
  if (!isSupportedLanguage(language)) {
    throw new AppError('invalid_input', `Unsupported language: ${String(language)}`);
  }
  changeCounter += 1;
  const previous = getLanguage();
  if (i18n.language !== language) {
    try {
      await i18n.changeLanguage(language);
    } catch (error) {
      throw toAppError(error);
    }
  }
  if (language !== previous) {
    appEvents.emit('language:changed', { language, source });
  }
  if (source !== 'device') {
    hasExplicitChoice = true;
    await persistLanguage(language);
  }
}

async function restorePersistedLanguage(): Promise<void> {
  const counterAtStart = changeCounter;
  let stored: string | null;
  try {
    stored = await AsyncStorage.getItem(GLOBAL_STORAGE_KEYS.language);
  } catch (error) {
    log.warn('could not read the saved language; keeping the device language', toAppError(error).code);
    return;
  }
  if (stored === null) return;
  const language = normalizeLanguage(stored);
  if (language === null) {
    log.warn('ignoring an invalid saved language');
    return;
  }
  hasExplicitChoice = true;
  // The user (or synced preferences) changed the language while we were reading: keep theirs.
  if (changeCounter !== counterAtStart) return;
  if (language !== getLanguage()) {
    await setLanguage(language, { source: 'device' });
  }
}

/** Applies the persisted language choice (idempotent; resolves even if storage is unreadable). */
export function initI18n(): Promise<void> {
  initializeSync();
  if (!restorePromise) {
    restorePromise = restorePersistedLanguage().catch((error: unknown) => {
      log.error('language restore failed', toAppError(error));
    });
  }
  return restorePromise;
}

/**
 * Re-reads the device language (call when the app returns to the foreground: Android users can
 * change the system locale while the app runs). No-op once a language was chosen explicitly.
 */
export async function syncDeviceLanguage(): Promise<void> {
  if (hasExplicitChoice) return;
  const device = detectDeviceLanguage();
  if (device !== getLanguage()) {
    await setLanguage(device, { source: 'device' });
  }
}

/**
 * PURE: which language (if any) a `preferences:changed` event should apply to the UI.
 * - local writes: never (the UI already shows them);
 * - never-saved defaults (updatedAt null): never (they were derived from the UI language);
 * - remote changes: only when `language` is among the changed keys;
 * - cache (session start): the account's saved language wins over the device default.
 */
export function languageFromPreferencesEvent(event: PreferencesChangedEvent, current: Language): Language | null {
  if (event.origin === 'local') return null;
  const language = event.preferences.language;
  if (!isSupportedLanguage(language) || language === current) return null;
  if (event.preferences.updatedAt === null) return null;
  if (event.origin === 'remote' && !event.changedKeys.includes('language')) return null;
  return language;
}

appEvents.on('preferences:changed', (event) => {
  const next = languageFromPreferencesEvent(event, getLanguage());
  if (next === null) return;
  return setLanguage(next, { source: 'preferences' }).catch((error: unknown) => {
    log.error('could not apply the language from preferences', toAppError(error));
  });
});

/** TEST ONLY: resets module state between tests. */
export function resetI18nStateForTests(): void {
  hasExplicitChoice = false;
  changeCounter = 0;
  restorePromise = null;
}
