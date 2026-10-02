/**
 * Calendar-internal helpers shared by the Google and device providers. Pure (no Expo / RN imports).
 */
import { httpUrlSchema, type ConferenceDetails, type ConferenceProvider, type MeetingLocation } from '../../core/aiContract';
import { CALENDAR_SYNC_WINDOW } from '../../core/identifiers';
import { addMinutesIso, toDate, toLocalDateTime, type DateInput } from '../../core/time';
import type { Meeting, MeetingCreateInput, MeetingSource, ParticipantInput } from '../../core/types';

/** Import payload for MeetingRepository.upsertExternal (source/external are set by the repository). */
export type ExternalMeetingInput = Omit<MeetingCreateInput, 'source' | 'external'>;

// ---------------------------------------------------------------------------------------------
// Limits mirrored from the meeting schema (values that exceed them would be rejected on write)
// ---------------------------------------------------------------------------------------------

export const TITLE_MAX = 200;
export const DESCRIPTION_MAX = 4000;
export const ADDRESS_MAX = 500;
export const PASSWORD_MAX = 100;
export const PARTICIPANTS_MAX = 100;
export const PARTICIPANT_NAME_MAX = 200;
export const DURATION_MAX_MINUTES = 20_160;
export const MINUTES_PER_DAY = 1440;

/** Sources that MeetingGuard owns (pushed to Google, exported to the device calendar). */
export const OWN_MEETING_SOURCES: readonly MeetingSource[] = ['manual', 'ai_chat', 'whatsapp'];

export function isOwnMeeting(meeting: Pick<Meeting, 'source'>): boolean {
  return OWN_MEETING_SOURCES.includes(meeting.source);
}

export function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

export function clampDuration(minutes: number): number {
  if (!Number.isFinite(minutes)) return 60;
  return Math.min(DURATION_MAX_MINUTES, Math.max(1, Math.round(minutes)));
}

// ---------------------------------------------------------------------------------------------
// Sync window
// ---------------------------------------------------------------------------------------------

export interface SyncWindow {
  /** Inclusive lower bound (UTC ISO). */
  timeMin: string;
  /** Exclusive upper bound (UTC ISO). */
  timeMax: string;
}

export function syncWindow(now: DateInput): SyncWindow {
  return {
    timeMin: addMinutesIso(now, -CALENDAR_SYNC_WINDOW.pastDays * MINUTES_PER_DAY),
    timeMax: addMinutesIso(now, CALENDAR_SYNC_WINDOW.futureDays * MINUTES_PER_DAY),
  };
}

/** true when [startAt, startAt + duration) lies entirely inside the window (Android listEvents semantics). */
export function insideWindow(value: { startAt: string; durationMinutes: number }, window: SyncWindow): boolean {
  const start = toDate(value.startAt).getTime();
  const end = start + value.durationMinutes * 60_000;
  return start >= toDate(window.timeMin).getTime() && end <= toDate(window.timeMax).getTime();
}

/** true when [startAt, startAt + duration) overlaps the window (Google's timeMin/timeMax semantics). */
export function overlapsWindow(value: { startAt: string; durationMinutes: number }, window: SyncWindow): boolean {
  const start = toDate(value.startAt).getTime();
  const end = start + value.durationMinutes * 60_000;
  return start < toDate(window.timeMax).getTime() && end > toDate(window.timeMin).getTime();
}

// ---------------------------------------------------------------------------------------------
// Conference links and locations (plain-text representations shared by both providers)
// ---------------------------------------------------------------------------------------------

const URL_PATTERN = /https?:\/\/[^\s<>"'()[\]{}]+/gi;

function hostOf(url: string): string | null {
  const match = /^https?:\/\/([^/?#:]+)/i.exec(url);
  return match?.[1]?.toLowerCase() ?? null;
}

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** Provider of a join URL, or null when it is not a known conferencing link. */
export function conferenceProviderForUrl(url: string): ConferenceProvider | null {
  const host = hostOf(url);
  if (!host) return null;
  if (hostMatches(host, 'zoom.us') || hostMatches(host, 'zoomgov.com')) return 'zoom';
  if (hostMatches(host, 'teams.microsoft.com') || hostMatches(host, 'teams.live.com')) return 'teams';
  if (host === 'meet.google.com') return 'google_meet';
  return null;
}

export function isHttpUrl(value: string): boolean {
  return httpUrlSchema.safeParse(value).success;
}

/** First Zoom / Teams / Meet join link found in free text (descriptions may contain HTML). */
export function detectConferenceInText(...texts: (string | null | undefined)[]): ConferenceDetails | null {
  for (const text of texts) {
    if (!text) continue;
    for (const match of text.matchAll(URL_PATTERN)) {
      const url = match[0].replace(/[.,;:!?]+$/, '');
      const provider = conferenceProviderForUrl(url);
      if (provider && isHttpUrl(url)) return { provider, url, password: null };
    }
  }
  return null;
}

/**
 * Human-readable location text written to external calendars: the address, else the virtual URL,
 * else a non-Meet conference link (Google shows Meet links natively).
 */
/**
 * Attendee-visible join block for pushed events. Google invitations only show what is in the
 * event body, so non-Meet links (Zoom/Teams/other) and their passcodes are appended to the
 * description; the marker-free format below is stripped again on import (stripJoinBlock) so a
 * round trip never duplicates it. Meet links are excluded: Google renders those natively.
 */
const JOIN_LABELS: Readonly<Record<'en' | 'es', { join: string; passcode: string }>> = {
  en: { join: 'Join', passcode: 'Passcode' },
  es: { join: 'Unirse', passcode: 'Código de acceso' },
};

const JOIN_BLOCK_RE = /(?:\n{1,2})?(?:Join|Unirse): https?:\/\/\S+(?:\n(?:Passcode|Código de acceso): [^\n]+)?[ \t]*$/;

export function stripJoinBlock(text: string): string {
  return text.replace(JOIN_BLOCK_RE, '');
}

export function appendJoinBlock(
  description: string,
  conference: ConferenceDetails | null,
  language: 'en' | 'es',
): string {
  const base = stripJoinBlock(description);
  if (!conference?.url || conference.provider === 'google_meet') return base;
  const labels = JOIN_LABELS[language] ?? JOIN_LABELS.en;
  const block =
    `${labels.join}: ${conference.url}` +
    (conference.password ? `\n${labels.passcode}: ${conference.password}` : '');
  return base.length > 0 ? `${base}\n\n${block}` : block;
}

export function renderLocationText(location: MeetingLocation | null, conference: ConferenceDetails | null): string {
  if (location?.address) return location.address;
  if (location?.virtualUrl) return location.virtualUrl;
  if (conference?.url && conference.provider !== 'google_meet') return conference.url;
  return '';
}

/** Location from an external calendar's free-text location field. Conference links are not locations. */
export function deriveLocationFromText(text: string | null | undefined): MeetingLocation | null {
  const value = (text ?? '').trim();
  if (value.length === 0) return null;
  if (/^https?:\/\/\S+$/i.test(value)) {
    if (conferenceProviderForUrl(value)) return null;
    if (isHttpUrl(value)) return { type: 'virtual', address: null, virtualUrl: value };
  }
  return { type: 'physical', address: truncate(value, ADDRESS_MAX), virtualUrl: null };
}

// ---------------------------------------------------------------------------------------------
// Change detection
// ---------------------------------------------------------------------------------------------

/** FNV-1a 32-bit hash (hex). Used only to detect changes, never for security. */
export function stableHash(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** The meeting fields that external calendars show (MeetingGuard-only fields excluded). */
export interface ExternalVisibleFields {
  title: string;
  description?: string;
  startAt: string;
  durationMinutes?: number;
  timezone?: string;
  allDay?: boolean;
  location?: MeetingLocation | null;
  conference?: ConferenceDetails | null;
  participants?: readonly ParticipantInput[];
}

function normalizeParticipantsForHash(list: readonly ParticipantInput[] | undefined): { email: string; name: string | null }[] {
  const seen = new Map<string, string | null>();
  for (const item of list ?? []) {
    const email = item.email.trim().toLowerCase();
    if (seen.has(email)) continue;
    const name = item.name?.trim();
    seen.set(email, name ? name : null);
  }
  return [...seen.entries()].map(([email, name]) => ({ email, name })).sort((a, b) => a.email.localeCompare(b.email));
}

/**
 * Stable projection of the externally visible fields. Works for a stored Meeting and for a
 * MeetingCreateInput-like import payload (same normalization as buildMeeting).
 */
export function externalProjection(fields: ExternalVisibleFields, defaultTimeZone: string): Record<string, unknown> {
  const timezone = fields.timezone ?? defaultTimeZone;
  const startAt = toDate(fields.startAt).toISOString();
  return {
    title: fields.title.trim(),
    description: fields.description ?? '',
    startAt,
    date: fields.allDay ? toLocalDateTime(startAt, timezone).date : null,
    durationMinutes: fields.durationMinutes ?? 60,
    timezone,
    allDay: fields.allDay ?? false,
    location: fields.location ?? null,
    conference: fields.conference ?? null,
    participants: normalizeParticipantsForHash(fields.participants),
  };
}

export function externalHash(fields: ExternalVisibleFields, defaultTimeZone: string): string {
  return stableHash(externalProjection(fields, defaultTimeZone));
}

// ---------------------------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------------------------

export interface Mutex {
  /** Runs `task` after every previously queued task settled. */
  run<T>(task: () => Promise<T>): Promise<T>;
}

export function createMutex(): Mutex {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const result = tail.then(task, task);
      tail = result.catch(() => undefined);
      return result;
    },
  };
}

/** Splits a list into chunks of at most `size` items. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
