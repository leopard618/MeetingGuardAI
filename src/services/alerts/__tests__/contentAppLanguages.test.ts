/**
 * M12: a pt (pt-BR), fr or de UI language renders the notification text of that language (meeting
 * alerts, snoozes, the refill reminder), with every placeholder filled and the en/es behavior
 * unchanged. The expected strings are built from the locale files themselves, so a wording change
 * there does not break this test; a missing key or a placeholder left open does.
 */
import { createInstance } from 'i18next';

import type { TranslateFn } from '../../../core/contracts';
import de from '../../../i18n/locales/de/alerts.json';
import en from '../../../i18n/locales/en/alerts.json';
import fr from '../../../i18n/locales/fr/alerts.json';
import pt from '../../../i18n/locales/pt/alerts.json';
import { NOW, fakeFormatTime, makeMeeting, minutesFrom } from '../__fixtures__/alertFixtures';
import { renderAlertSpec, renderRefillSpec, renderSnoozeSpec, summarizeMeeting } from '../content';
import type { AlertTextDeps } from '../types';

const LOCALES = { en, pt, fr, de } as const;
type Lang = keyof typeof LOCALES;

const instance = createInstance();
void instance.init({
  resources: { en: { alerts: en }, pt: { alerts: pt }, fr: { alerts: fr }, de: { alerts: de } },
  lng: 'en',
  fallbackLng: 'en',
  ns: ['alerts'],
  defaultNS: 'alerts',
  interpolation: { escapeValue: false },
  initAsync: false,
});

function deps(language: Lang): AlertTextDeps {
  const fixed = instance.getFixedT(language);
  const t: TranslateFn = (key, options) => fixed(key, options as Record<string, unknown>) as unknown as string;
  return { t, formatTime: fakeFormatTime, language, timeZone: 'UTC', use24Hour: true, vibrationEnabled: true };
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => values[name] ?? `{{${name}}}`);
}

function alertInput(offset: number, startAt: string) {
  return {
    identifier: `mg:m1:${offset}`,
    kind: 'alert' as const,
    meetingId: 'm1',
    offsetMinutes: offset,
    fireAt: new Date(Date.parse(startAt) - offset * 60_000).toISOString(),
    intensity: 'max' as const,
  };
}

// Built from code points so this file contains none of the banned characters.
const BANNED = new RegExp(`[${[0x2014, 0x2013, 0x2026, 0x2018, 0x2019, 0x201c, 0x201d, 0x201e, 0x201a].map((code) => String.fromCodePoint(code)).join('')}]`);

describe('M12: notification text in pt, fr and de', () => {
  const startAt = minutesFrom(NOW, 90);
  const meeting = makeMeeting('m1', startAt, { title: 'Weekly sync', location: { type: 'physical', address: 'Room 4', virtualUrl: null } });

  it.each(['pt', 'fr', 'de'] as const)('%s: the alert title and body come from that language, every placeholder filled', (language) => {
    const strings = LOCALES[language];
    const d = deps(language);
    const spec = renderAlertSpec(alertInput(15, startAt), summarizeMeeting(meeting, d.t), d);
    const lead = fill(strings.lead.minutes_other, { count: '15' });
    expect(spec.title).toBe(fill(strings.notification.upcomingTitle, { title: 'Weekly sync', lead }));
    expect(spec.body).toBe(fill(strings.notification.bodyWithLocation, { time: '13:30', location: 'Room 4' }));
    expect(spec.title).not.toBe(renderAlertSpec(alertInput(15, startAt), summarizeMeeting(meeting, deps('en').t), deps('en')).title);
    // The payload's language is the MEETING's (voice readout), which stays en/es.
    expect(spec.data.language).toBe('en');
    for (const text of [spec.title, spec.body]) {
      expect(text).not.toMatch(/\{\{|\}\}/);
      expect(text).not.toMatch(BANNED);
    }
    // Singular and other lead forms resolve too (no raw key, no open placeholder).
    for (const offset of [1, 60, 1440, 0]) {
      const title = renderAlertSpec(alertInput(offset, startAt), summarizeMeeting(meeting, d.t), d).title;
      expect(title).toContain('Weekly sync');
      expect(title).not.toMatch(/\{\{|alerts:|lead\.|notification\./);
    }
  });

  it.each(['pt', 'fr', 'de'] as const)('%s: snoozes and the refill reminder speak that language; the hash follows the language', (language) => {
    const strings = LOCALES[language];
    const d = deps(language);
    const snooze = renderSnoozeSpec(summarizeMeeting(meeting, d.t), 'medium', minutesFrom(NOW, 80), d);
    expect(snooze.title).toBe(fill(strings.notification.snoozeTitle, { title: 'Weekly sync', lead: fill(strings.lead.minutes_other, { count: '10' }) }));
    const refill = renderRefillSpec(minutesFrom(NOW, 600), d);
    expect(refill.title).toBe(strings.refill.title);
    expect(refill.body).toBe(strings.refill.body);
    expect(refill.data.hash).not.toBe(renderRefillSpec(minutesFrom(NOW, 600), deps('en')).data.hash);
    const alert = renderAlertSpec(alertInput(15, startAt), summarizeMeeting(meeting, d.t), d);
    expect(alert.data.hash).not.toBe(renderAlertSpec(alertInput(15, startAt), summarizeMeeting(meeting, deps('en').t), deps('en')).data.hash);
  });
});
