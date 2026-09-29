/**
 * Test fixtures for the alerts area (not imported by app code).
 * A real i18next instance with the alerts namespace (EN + ES) so tests exercise the actual strings.
 */
import { createInstance } from 'i18next';

import type { FormatOptions, TranslateFn } from '../../../core/contracts';
import { toLocalDateTime } from '../../../core/time';
import { buildMeeting, createDefaultPreferences, type Meeting, type MeetingCreateInput, type Preferences } from '../../../core/types';
import en from '../../../i18n/locales/en/alerts.json';
import es from '../../../i18n/locales/es/alerts.json';
import type { AlertTextDeps } from '../types';

const instance = createInstance();
void instance.init({
  resources: { en: { alerts: en }, es: { alerts: es } },
  lng: 'en',
  fallbackLng: 'en',
  ns: ['alerts'],
  defaultNS: 'alerts',
  interpolation: { escapeValue: false },
  initAsync: false,
});

export function translator(language: 'en' | 'es' = 'en'): TranslateFn {
  const fixed = instance.getFixedT(language);
  return (key, options) => fixed(key, options as Record<string, unknown>) as unknown as string;
}

/** "HH:mm" in the requested zone (deterministic stand-in for src/utils/format formatTime). */
export function fakeFormatTime(value: string, options: FormatOptions): string {
  return toLocalDateTime(value, options.timeZone ?? 'UTC').time;
}

export function textDeps(language: 'en' | 'es' = 'en', timeZone = 'UTC'): AlertTextDeps {
  return { t: translator(language), formatTime: fakeFormatTime, language, timeZone, use24Hour: true };
}

export const NOW = new Date('2026-10-05T12:00:00.000Z');

export function minutesFrom(base: Date, minutes: number): string {
  return new Date(base.getTime() + minutes * 60_000).toISOString();
}

export function makeMeeting(
  id: string,
  startAt: string,
  overrides: Partial<MeetingCreateInput> = {},
  patch: Partial<Meeting> = {},
): Meeting {
  const meeting = buildMeeting(
    { title: `Meeting ${id}`, startAt, source: 'manual', ...overrides },
    { id, userId: 'user-1', now: '2026-10-01T00:00:00.000Z', defaultTimezone: 'UTC', defaultLanguage: 'en' },
  );
  return { ...meeting, ...patch };
}

export function makePrefs(overrides: Partial<Preferences> = {}): Preferences {
  return { ...createDefaultPreferences({ language: 'en', timezone: 'UTC' }), ...overrides };
}
