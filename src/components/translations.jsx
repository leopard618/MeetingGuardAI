/**
 * COMPAT MODULE (owner: i18n-nav; stage 3 migrates the screens to useT() and deletes this file).
 *
 * The legacy screens call `useTranslation(language)` and then `t` with UNQUALIFIED dotted keys
 * (section + key, e.g. dashboard.title).
 * The dictionary now lives in the i18next resources:
 *   - "nav.*"        -> navigation namespace (src/i18n/locales/<lng>/navigation.json, key "nav")
 *   - everything else -> common namespace   (src/i18n/locales/<lng>/common.json, same keys)
 * `t` follows the LIVE app language (the `language` argument is accepted for compatibility but
 * ignored: the old default of 'en' left components in English when a parent forgot the prop),
 * and components re-render when the language changes. Keys that point to arrays/objects return
 * them (e.g. "whatsAppBot.features"); unknown keys return the key, as before.
 */
import { useCallback } from 'react';
import { useTranslation as useI18nextTranslation } from 'react-i18next';

import { normalizeLanguage } from '../i18n/detect';
import { FALLBACK_LANGUAGE, translateRaw } from '../i18n/i18n';
import commonEn from '../i18n/locales/en/common.json';
import navigationEn from '../i18n/locales/en/navigation.json';
import commonEs from '../i18n/locales/es/common.json';
import navigationEs from '../i18n/locales/es/navigation.json';

/** The legacy dictionary shape ({ en: { dashboard: {...}, nav: {...}, ... }, es: {...} }). */
export const translations = {
  en: { ...commonEn, nav: navigationEn.nav },
  es: { ...commonEs, nav: navigationEs.nav },
};

const NAMESPACE_BY_SECTION = { nav: 'navigation' };

/** Looks up a legacy key in `language` (falls back to English, then to the key itself). */
export function translateLegacy(key, language) {
  const section = String(key).split('.')[0];
  const ns = NAMESPACE_BY_SECTION[section] ?? 'common';
  const value = translateRaw(String(key), { ns, lng: language, defaultValue: key });
  return value === undefined || value === null || value === '' ? key : value;
}

// The legacy signature takes a language argument; it is ignored (see header).
export const useTranslation = (_language) => {
  const { i18n } = useI18nextTranslation();
  const language = normalizeLanguage(i18n.resolvedLanguage ?? i18n.language) ?? FALLBACK_LANGUAGE;
  const t = useCallback((key) => translateLegacy(key, language), [language]);
  return { t, language };
};

/** Languages the app supports (English and Spanish only). */
export const getAvailableLanguages = () => [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
];
