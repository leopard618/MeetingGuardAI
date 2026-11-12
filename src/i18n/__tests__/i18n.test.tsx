import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { appEvents, type LanguageChangedEvent, type PreferencesChangedEvent } from '../../core/events';
import { GLOBAL_STORAGE_KEYS } from '../../core/identifiers';
import { getDeviceTimeZone } from '../../core/time';
import { createDefaultPreferences } from '../../core/types';
import {
  I18nProvider,
  getLanguage,
  i18n,
  initI18n,
  languageFromPreferencesEvent,
  setLanguage,
  t,
  useLanguage,
  useT,
} from '..';
import { collapseMeridiemPeriod, resetI18nStateForTests } from '../i18n';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'es', languageTag: 'es-MX' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'America/Mexico_City', uses24hourClock: true }]),
}));

function prefsEvent(overrides: Partial<PreferencesChangedEvent> & { language?: 'en' | 'es'; updatedAt?: string | null }): PreferencesChangedEvent {
  const preferences = {
    ...createDefaultPreferences({ language: overrides.language ?? 'en', timezone: 'UTC' }),
    updatedAt: overrides.updatedAt === undefined ? '2026-09-28T10:00:00.000Z' : overrides.updatedAt,
  };
  return {
    uid: 'u1',
    preferences,
    changedKeys: overrides.changedKeys ?? ['language'],
    origin: overrides.origin ?? 'remote',
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  resetI18nStateForTests();
  await i18n.changeLanguage('es');
});

describe('initialization', () => {
  it('initializes synchronously with the device language (es-MX -> es)', () => {
    expect(i18n.isInitialized).toBe(true);
    expect(getLanguage()).toBe('es');
    expect(t('common:actions.continue')).toBe('Continuar');
  });

  it('registers expo-localization as the device time-zone provider', () => {
    expect(getDeviceTimeZone()).toBe('America/Mexico_City');
  });

  it('translates namespace-qualified keys, interpolates and pluralizes', () => {
    expect(t('onboarding:progress', { current: 2, total: 5 })).toBe('Paso 2 de 5');
    expect(t('common:format.days', { count: 1 })).toBe('1 día');
    expect(t('common:format.days', { count: 3 })).toBe('3 días');
    expect(t('common:format.days', { count: 3, lng: 'en' })).toBe('3 days');
  });

  it('returns the key for missing translations', () => {
    expect(t('common:does.not.exist')).toBe('common:does.not.exist');
  });

  it('restores the persisted language on initI18n', async () => {
    await AsyncStorage.setItem(GLOBAL_STORAGE_KEYS.language, 'en');
    const events: LanguageChangedEvent[] = [];
    const off = appEvents.on('language:changed', (event) => {
      events.push(event);
    });
    await initI18n();
    off();
    expect(getLanguage()).toBe('en');
    expect(events).toEqual([{ language: 'en', source: 'device' }]);
  });

  it('ignores an invalid persisted value', async () => {
    await AsyncStorage.setItem(GLOBAL_STORAGE_KEYS.language, 'fr');
    await initI18n();
    expect(getLanguage()).toBe('es');
  });
});

describe('setLanguage', () => {
  it('switches instantly, persists and emits language:changed', async () => {
    const events: LanguageChangedEvent[] = [];
    const off = appEvents.on('language:changed', (event) => {
      events.push(event);
    });
    await setLanguage('en');
    off();
    expect(getLanguage()).toBe('en');
    expect(t('common:actions.continue')).toBe('Continue');
    expect(await AsyncStorage.getItem(GLOBAL_STORAGE_KEYS.language)).toBe('en');
    expect(events).toEqual([{ language: 'en', source: 'user' }]);
  });

  it('does not emit when the language does not change', async () => {
    const handler = jest.fn();
    const off = appEvents.on('language:changed', handler);
    await setLanguage('es');
    off();
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not persist device-sourced changes', async () => {
    await setLanguage('en', { source: 'device' });
    expect(await AsyncStorage.getItem(GLOBAL_STORAGE_KEYS.language)).toBeNull();
  });

  it('rejects unsupported languages with invalid_input', async () => {
    await expect(setLanguage('fr' as never)).rejects.toMatchObject({ name: 'AppError', code: 'invalid_input' });
  });
});

describe('preferences sync', () => {
  it('applies remote language changes and the saved language at session start', () => {
    expect(languageFromPreferencesEvent(prefsEvent({ language: 'en' }), 'es')).toBe('en');
    expect(languageFromPreferencesEvent(prefsEvent({ language: 'en', origin: 'cache', changedKeys: [] }), 'es')).toBe('en');
  });

  it('ignores local writes, unchanged keys, never-saved defaults and the current language', () => {
    expect(languageFromPreferencesEvent(prefsEvent({ language: 'en', origin: 'local' }), 'es')).toBeNull();
    expect(languageFromPreferencesEvent(prefsEvent({ language: 'en', changedKeys: ['alertVolume'] }), 'es')).toBeNull();
    expect(languageFromPreferencesEvent(prefsEvent({ language: 'en', updatedAt: null }), 'es')).toBeNull();
    expect(languageFromPreferencesEvent(prefsEvent({ language: 'es' }), 'es')).toBeNull();
  });

  it('switches the UI when a preferences:changed event carries another language', async () => {
    const events: LanguageChangedEvent[] = [];
    const off = appEvents.on('language:changed', (event) => {
      events.push(event);
    });
    await act(async () => {
      appEvents.emit('preferences:changed', prefsEvent({ language: 'en' }));
    });
    off();
    expect(getLanguage()).toBe('en');
    expect(events).toEqual([{ language: 'en', source: 'preferences' }]);
    expect(await AsyncStorage.getItem(GLOBAL_STORAGE_KEYS.language)).toBe('en');
  });
});

describe('React bindings', () => {
  function Probe() {
    const translate = useT();
    const { language } = useLanguage();
    return <Text testID="new">{`${language}:${translate('common:actions.continue')}`}</Text>;
  }

  it('re-renders every subscriber on a language change without remounting', async () => {
    await render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId('new').props.children).toBe('es:Continuar');

    await act(async () => {
      await setLanguage('en');
    });
    expect(screen.getByTestId('new').props.children).toBe('en:Continue');
  });
});

describe('a.m. / p.m. at the end of a sentence', () => {
  it('collapses the doubled period and leaves everything else alone', () => {
    expect(collapseMeridiemPeriod('Más: 10 nov 2026, 6:00 p.m..')).toBe('Más: 10 nov 2026, 6:00 p.m.');
    expect(collapseMeridiemPeriod('la primera a las 9:00 a.\u00a0m..')).toBe('la primera a las 9:00 a.\u00a0m.');
    expect(collapseMeridiemPeriod('More Nov 10, 6:00 PM.')).toBe('More Nov 10, 6:00 PM.');
    expect(collapseMeridiemPeriod('Activating your plan...')).toBe('Activating your plan...');
    expect(collapseMeridiemPeriod('¿Empezamos a las 8:05 a.m.?')).toBe('¿Empezamos a las 8:05 a.m.?');
  });

  it('runs on every translation after interpolation', () => {
    expect(t('pricing:usage.exhausted.day', { lng: 'es', time: '10 nov 2026, 6:00 p.m.' })).toBe(
      'Ya usaste las acciones gratis de hoy. Más: 10 nov 2026, 6:00 p.m.',
    );
    expect(t('pricing:usage.exhausted.day', { lng: 'en', time: 'Nov 10, 2026, 6:00 PM' })).toBe(
      "You've used today's free actions. More Nov 10, 2026, 6:00 PM.",
    );
  });
});
