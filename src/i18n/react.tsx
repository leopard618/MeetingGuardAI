/**
 * React bindings of the i18n module. Every component that calls useT()/useLanguage() re-renders
 * when the language changes (react-i18next "languageChanged" binding), without remounting.
 */
import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { AppState } from 'react-native';

import type { TranslateFn, UseLanguageResult } from '../core/contracts';
import { toAppError } from '../core/errors';
import { createLogger } from '../core/logger';
import type { Language } from '../core/types';
import { normalizeLanguage } from './detect';
import { FALLBACK_LANGUAGE, SUPPORTED_LANGUAGES, i18n, initI18n, setLanguage, syncDeviceLanguage } from './i18n';

const log = createLogger('i18n');

type RawTranslate = (key: string, options?: Record<string, unknown>) => unknown;

/**
 * Provides the i18next instance to react-i18next, applies the persisted language on mount and
 * follows device-language changes while no explicit choice exists.
 */
export function I18nProvider({ children }: { children?: ReactNode }): ReactNode {
  useEffect(() => {
    void initI18n();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      syncDeviceLanguage().catch((error: unknown) => {
        log.warn('device language sync failed', toAppError(error).code);
      });
    });
    return () => subscription.remove();
  }, []);

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}

/** Translate function for the current language; its identity changes when the language changes. */
export function useT(): TranslateFn {
  const { t: fixedT } = useTranslation();
  return useCallback<TranslateFn>(
    (key, options) => {
      const result = (fixedT as unknown as RawTranslate)(key, options);
      return typeof result === 'string' ? result : key;
    },
    [fixedT],
  );
}

/** Current language + a setter for explicit user choices (source 'user'). */
export function useLanguage(): UseLanguageResult {
  const { i18n: instance } = useTranslation();
  const language: Language = normalizeLanguage(instance.resolvedLanguage ?? instance.language) ?? FALLBACK_LANGUAGE;
  const change = useCallback((next: Language) => setLanguage(next, { source: 'user' }), []);
  return useMemo(
    () => ({ language, setLanguage: change, supportedLanguages: SUPPORTED_LANGUAGES }),
    [language, change],
  );
}
