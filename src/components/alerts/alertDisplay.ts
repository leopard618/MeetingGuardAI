/**
 * Display model for the in-app alerts (owner: alerts). PURE given t / formatTime (unit-tested).
 * Every text, the voice readout included, follows the UI language (instant EN/ES switching): the
 * meeting's stored language is only the language it was created in, and a Spanish screen with an
 * English voice (or the reverse) is confusing. The title itself is read as written.
 */
import type { FormatOptions, TranslateFn } from '../../core/contracts';
import type { Language } from '../../core/types';
// Same area (alerts): the pure content helpers are imported directly to keep this module light.
import { cleanText, leadText } from '../../services/alerts/content';

const MINUTE_MS = 60_000;
const NOW_WINDOW_MS = 30_000;

export interface AlertDisplayInput {
  title: string;
  startAt: string;
  durationMinutes: number;
  locationText: string | null;
  joinUrl: string | null;
  /** Meeting language (informational; the voice follows the UI language). */
  language: Language;
}

export interface AlertDisplayDeps {
  t: TranslateFn;
  formatTime(value: string, options: FormatOptions): string;
  /** UI language. */
  uiLanguage: Language;
  use24Hour: boolean | null;
  now: Date;
}

export type AlertPhase = 'upcoming' | 'now' | 'started';

export interface AlertDisplayModel {
  title: string;
  phase: AlertPhase;
  /** Whole minutes until start (upcoming) or since start (started); 0 for 'now'. */
  minutes: number;
  whenText: string;
  timeText: string;
  locationText: string | null;
  joinUrl: string | null;
  voiceText: string;
  voiceLanguage: Language;
}

const NO_ESCAPE = { interpolation: { escapeValue: false } } as const;

export function alertPhase(startAt: string, now: Date): { phase: AlertPhase; minutes: number } {
  const diff = Date.parse(startAt) - now.getTime();
  if (!Number.isFinite(diff) || Math.abs(diff) <= NOW_WINDOW_MS) return { phase: 'now', minutes: 0 };
  if (diff > 0) return { phase: 'upcoming', minutes: Math.max(1, Math.ceil(diff / MINUTE_MS)) };
  return { phase: 'started', minutes: Math.max(1, Math.floor(-diff / MINUTE_MS)) };
}

export function buildAlertDisplay(input: AlertDisplayInput, deps: AlertDisplayDeps): AlertDisplayModel {
  const { t } = deps;
  const title = cleanText(input.title, 200) || t('alerts:notification.untitled');
  const { phase, minutes } = alertPhase(input.startAt, deps.now);
  const endAt = new Date(Date.parse(input.startAt) + input.durationMinutes * MINUTE_MS).toISOString();
  const uiFormat: FormatOptions = { language: deps.uiLanguage, use24Hour: deps.use24Hour };

  const whenText =
    phase === 'upcoming'
      ? t('alerts:when.startsIn', { lead: leadText(minutes, t), ...NO_ESCAPE })
      : phase === 'now'
        ? t('alerts:when.now')
        : t('alerts:when.started', { count: minutes });
  const timeText = t('alerts:when.timeRange', {
    start: deps.formatTime(input.startAt, uiFormat),
    end: deps.formatTime(endAt, uiFormat),
    ...NO_ESCAPE,
  });
  const locationText = input.locationText ? cleanText(input.locationText, 120) : null;

  // Voice: UI language, like every other alert text.
  const voiceLanguage = deps.uiLanguage;
  const tv: TranslateFn = (key, options) => t(key, { ...options, lng: voiceLanguage });
  const voiceTime = deps.formatTime(input.startAt, { language: voiceLanguage, use24Hour: deps.use24Hour });
  let voiceText =
    phase === 'upcoming'
      ? tv('alerts:voice.upcoming', { title, lead: leadText(minutes, tv), time: voiceTime, ...NO_ESCAPE })
      : phase === 'now'
        ? tv('alerts:voice.now', { title, ...NO_ESCAPE })
        : tv('alerts:voice.started', { title, ...NO_ESCAPE });
  if (locationText) voiceText = `${voiceText} ${tv('alerts:voice.location', { location: locationText, ...NO_ESCAPE })}`;

  return {
    title,
    phase,
    minutes,
    whenText,
    timeText,
    locationText,
    joinUrl: input.joinUrl,
    voiceText,
    voiceLanguage,
  };
}
