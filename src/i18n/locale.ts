/**
 * Per-language locale data (M12), in one place so screens stop hard-coding en/es ternaries.
 * Layer L1: imports only core and date-fns. Every table is keyed by AppLanguage, so adding a
 * language fails to compile until each table has it.
 *
 * - LOCALE_TAGS: the BCP-47 tag for Intl (numbers, prices, dates) and for speech (STT/TTS).
 *   Portuguese is Brazilian Portuguese (pt-BR) under the language code 'pt'.
 * - DATE_FNS_LOCALES: the date-fns locale per language.
 * - weekStartsOnFor: first day of the week (0 = Sunday, 1 = Monday). en keeps Sunday and es keeps
 *   Monday (the behaviour before M12); pt-BR starts on Sunday, fr and de on Monday.
 * - DEFAULT_24_HOUR: the clock used when neither the preference nor the device says.
 */
import type { Locale } from 'date-fns';
import { de, enUS, es, fr, ptBR } from 'date-fns/locale';

import type { AppLanguage } from '../core/types';

export const LOCALE_TAGS: Readonly<Record<AppLanguage, string>> = {
  en: 'en-US',
  es: 'es-ES',
  pt: 'pt-BR',
  fr: 'fr-FR',
  de: 'de-DE',
};

export const DATE_FNS_LOCALES: Readonly<Record<AppLanguage, Locale>> = { en: enUS, es, pt: ptBR, fr, de };

const WEEK_STARTS_ON: Readonly<Record<AppLanguage, 0 | 1>> = { en: 0, es: 1, pt: 0, fr: 1, de: 1 };

/** First day of the week for a UI language: 0 = Sunday (en, pt), 1 = Monday (es, fr, de). */
export function weekStartsOnFor(language: AppLanguage): 0 | 1 {
  return WEEK_STARTS_ON[language] ?? 0;
}

/** Clock used when neither the preference nor the device says: en 12 h; es, pt, fr and de 24 h. */
export const DEFAULT_24_HOUR: Readonly<Record<AppLanguage, boolean>> = {
  en: false,
  es: true,
  pt: true,
  fr: true,
  de: true,
};

/** Speech recognition / text-to-speech locale for a UI language ("pt" -> "pt-BR"); en-US when unknown. */
export function speechLocale(language: AppLanguage): string {
  return LOCALE_TAGS[language] ?? LOCALE_TAGS.en;
}
