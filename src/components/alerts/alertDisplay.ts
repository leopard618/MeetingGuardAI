/**
 * Display model for the in-app alerts (owner: alerts). PURE given t / formatTime (unit-tested).
 * Texts are localized in the UI language; the voice readout uses the MEETING language.
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
  /** Meeting language (voice). */
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

  // Voice: meeting language.
  const voiceLanguage = input.language;
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

// ---------------------------------------------------------------------------------------------
// Legacy meeting objects (src/components/NotificationSystem/NotificationManager.jsx shim)
// ---------------------------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function validHttpUrl(value: unknown): string | null {
  const text = str(value);
  return text && /^https?:\/\//i.test(text) ? text : null;
}

/**
 * Maps a legacy meeting view (toLegacyMeetingView shape, or the ad-hoc objects older screens build:
 * { title, date 'YYYY-MM-DD', time 'HH:mm', location: string | {...} }) to display input.
 * Local date/time are interpreted in the device zone. Returns null when no start time is known.
 */
export function displayInputFromLegacyMeeting(raw: unknown, fallbackLanguage: Language): AlertDisplayInput | null {
  const meeting = asRecord(raw);
  const startIso = str(meeting.startTime) ?? str(asRecord(meeting.start).dateTime);
  let startMs = startIso ? Date.parse(startIso) : Number.NaN;
  if (!Number.isFinite(startMs)) {
    const date = str(meeting.date);
    const time = str(meeting.time);
    if (date && time && /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{1,2}:\d{2}/.test(time)) {
      const [year, month, day] = date.split('-').map(Number) as [number, number, number];
      const [hour, minute] = time.split(':').map((part) => Number.parseInt(part, 10)) as [number, number];
      startMs = new Date(year, month - 1, day, hour, minute).getTime();
    }
  }
  if (!Number.isFinite(startMs)) return null;

  const location = meeting.location;
  const locationRecord = asRecord(location);
  const conference = asRecord(meeting.conference_details);
  const locationText =
    str(location) ?? str(locationRecord.address) ?? str(locationRecord.virtualPlatform) ?? null;
  const joinUrl = validHttpUrl(conference.url) ?? validHttpUrl(locationRecord.virtualLink);
  const duration = typeof meeting.duration === 'number' && meeting.duration > 0 ? meeting.duration : 60;
  const language = meeting.language === 'es' || meeting.language === 'en' ? meeting.language : fallbackLanguage;

  return {
    title: str(meeting.title) ?? '',
    startAt: new Date(startMs).toISOString(),
    durationMinutes: Math.round(duration),
    locationText,
    joinUrl,
    language,
  };
}
