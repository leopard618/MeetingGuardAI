/**
 * I18N public API (owner: i18n-nav). Layer L1: imports only core (+ i18next, expo-localization,
 * AsyncStorage). Talks to the data layer only through appEvents.
 *
 * - i18next + react-i18next + expo-localization; resources bundled from ./locales/{en,es}/<ns>.json
 *   (one file per namespace, each owned by its area). Keys are ALWAYS namespace-qualified:
 *   t('alerts:max.title'). Fallback language 'en'. compatibilityJSON is not set (i18next >= 24).
 * - Importing this module initializes i18next synchronously (device language) so `t` works in
 *   headless tasks; initI18n() then applies the persisted language (GLOBAL_STORAGE_KEYS.language).
 * - setLanguage persists locally and emits appEvents 'language:changed' (the data layer writes
 *   Preferences.language for source 'user'); a synced Preferences.language is applied with
 *   source 'preferences'.
 * - Registers expo-localization as device time-zone provider (core/time setDeviceTimeZoneProvider).
 */
export {
  DEFAULT_NAMESPACE,
  FALLBACK_LANGUAGE,
  I18N_NAMESPACES,
  SUPPORTED_LANGUAGES,
  getLanguage,
  i18n,
  initI18n,
  languageFromPreferencesEvent,
  setLanguage,
  syncDeviceLanguage,
  t,
  type LanguageSource,
} from './i18n';
export { I18nProvider, useLanguage, useT } from './react';
export {
  detectDeviceLanguage,
  deviceUses24HourClock,
  isSupportedLanguage,
  languageFromLocaleCode,
  normalizeLanguage,
} from './detect';
