/**
 * Mappers between the domain model and the LEGACY shapes the stage-3 JS screens still use
 * (snake_case preferences, `date`/`time`/`duration`, "Manual"/"ChatGPT" source labels,
 * `location.virtualLink`, `preparation_tips`, `created_date`).
 *
 * Used by the compat shims (src/api/entities.js, src/api/googleCalendar.js, ...) and by the
 * v1.0.9 local-data migration. Delete together with the shims in stage 3.
 */
import { httpUrlSchema, type ConferenceDetails, type ConferenceProvider, type Language, type LocationType } from './aiContract';
import { AppError } from './errors';
import { getDeviceTimeZone, isLocalDate, toDate, toLocalDateTime, zonedDateTimeToUtcIso } from './time';
import {
  DEFAULT_MEETING_DURATION_MINUTES,
  MEETING_SOURCES,
  type AlertIntensity,
  type AlertSoundType,
  type Meeting,
  type MeetingCreateInput,
  type MeetingPatch,
  type MeetingSource,
  type MeetingStatus,
  type ParticipantInput,
  type ParticipantStatus,
  type Preferences,
  type PreferencesPatch,
} from './types';

// ---------------------------------------------------------------------------------------------
// Sources, intensities, providers
// ---------------------------------------------------------------------------------------------

export type LegacySourceLabel = 'Manual' | 'ChatGPT' | 'WhatsApp' | 'Google' | 'Device';

export const LEGACY_SOURCE_LABELS: Readonly<Record<MeetingSource, LegacySourceLabel>> = {
  manual: 'Manual',
  ai_chat: 'ChatGPT',
  whatsapp: 'WhatsApp',
  google: 'Google',
  device: 'Device',
};

const SOURCE_ALIASES: Readonly<Record<string, MeetingSource>> = {
  manual: 'manual',
  chatgpt: 'ai_chat',
  ai: 'ai_chat',
  ai_chat: 'ai_chat',
  'ai-chat': 'ai_chat',
  openai: 'ai_chat',
  whatsapp: 'whatsapp',
  google: 'google',
  google_calendar: 'google',
  googlecalendar: 'google',
  device: 'device',
  apple: 'device',
};

/** Accepts new keys and legacy labels ("ChatGPT", "WhatsApp", "Manual"...); unknown => 'manual'. */
export function normalizeMeetingSource(raw: unknown): MeetingSource {
  if (typeof raw !== 'string') return 'manual';
  if ((MEETING_SOURCES as readonly string[]).includes(raw)) return raw as MeetingSource;
  return SOURCE_ALIASES[raw.trim().toLowerCase().replace(/\s+/g, '_')] ?? 'manual';
}

export type LegacyAlertIntensity = 'maximum' | 'medium' | 'light';

export function toLegacyIntensity(intensity: AlertIntensity): LegacyAlertIntensity {
  return intensity === 'max' ? 'maximum' : intensity;
}

/** 'maximum' | 'max' | 'medium' | 'light' => AlertIntensity; anything else => null. */
export function fromLegacyIntensity(raw: unknown): AlertIntensity | null {
  if (raw === 'maximum' || raw === 'max') return 'max';
  if (raw === 'medium' || raw === 'light') return raw;
  return null;
}

const PROVIDER_LABELS: Readonly<Record<ConferenceProvider, string>> = {
  zoom: 'Zoom',
  teams: 'Microsoft Teams',
  google_meet: 'Google Meet',
  other: 'Online',
};

export function conferenceProviderLabel(provider: ConferenceProvider): string {
  return PROVIDER_LABELS[provider];
}

/** "Zoom" | "zoom" | "Teams" | "Microsoft Teams" | "Google Meet" | "meet" ... => provider. */
export function normalizeConferenceProvider(raw: unknown): ConferenceProvider {
  if (typeof raw !== 'string') return 'other';
  const key = raw.trim().toLowerCase();
  if (key.includes('zoom')) return 'zoom';
  if (key.includes('teams')) return 'teams';
  if (key.includes('meet') || key.includes('google')) return 'google_meet';
  return 'other';
}

function validHttpUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const parsed = httpUrlSchema.safeParse(raw.trim());
  return parsed.success ? parsed.data : null;
}

// ---------------------------------------------------------------------------------------------
// Meeting -> legacy view
// ---------------------------------------------------------------------------------------------

export interface LegacyLocationView {
  type: LocationType;
  address: string | null;
  virtualPlatform: string | null;
  virtualLink: string | null;
}

export interface LegacyParticipantView {
  email: string;
  name: string;
  status: ParticipantStatus | null;
}

/** The meeting object shape stage-3 screens read (from Meeting.list/get shims). */
export interface LegacyMeetingView {
  id: string;
  title: string;
  description: string;
  /** Local date in the DEVICE zone (all-day: the meeting's own date). */
  date: string;
  /** Local "HH:mm" in the device zone ("00:00" for all-day). */
  time: string;
  duration: number;
  /** ISO UTC start (Dashboard "next meeting" logic). */
  startTime: string;
  endTime: string;
  /** Google-event-like fields (Calendar.jsx reads meeting.start?.dateTime). */
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  timezone: string;
  allDay: boolean;
  location: LegacyLocationView | null;
  participants: LegacyParticipantView[];
  source: LegacySourceLabel;
  sourceKey: MeetingSource;
  confidence: number | null;
  language: Language;
  preparation_tips: string[];
  custom_alert_times: number[] | null;
  alert_intensity: AlertIntensity | null;
  conference_details: ConferenceDetails | null;
  notes: string | null;
  status: MeetingStatus;
  googleEventId: string | null;
  created_date: string;
  updated_date: string;
}

export function toLegacyMeetingView(meeting: Meeting, options: { timeZone?: string } = {}): LegacyMeetingView {
  const zone = options.timeZone ?? getDeviceTimeZone();
  const local = meeting.allDay ? { date: meeting.date, time: '00:00' } : toLocalDateTime(meeting.startAt, zone);
  const endTime = new Date(toDate(meeting.startAt).getTime() + meeting.durationMinutes * 60_000).toISOString();
  const platform = meeting.conference ? conferenceProviderLabel(meeting.conference.provider) : null;
  const link = meeting.conference?.url ?? meeting.location?.virtualUrl ?? null;

  let location: LegacyLocationView | null = null;
  if (meeting.location) {
    location = {
      type: meeting.location.type,
      address: meeting.location.address,
      virtualPlatform: platform,
      virtualLink: link,
    };
  } else if (meeting.conference) {
    location = { type: 'virtual', address: null, virtualPlatform: platform, virtualLink: link };
  }

  return {
    id: meeting.id,
    title: meeting.title,
    description: meeting.description,
    date: local.date,
    time: local.time,
    duration: meeting.durationMinutes,
    startTime: meeting.startAt,
    endTime,
    start: { dateTime: meeting.startAt, timeZone: meeting.timezone },
    end: { dateTime: endTime, timeZone: meeting.timezone },
    timezone: meeting.timezone,
    allDay: meeting.allDay,
    location,
    participants: meeting.participants.map((p) => ({ email: p.email, name: p.name ?? p.email, status: p.status })),
    source: LEGACY_SOURCE_LABELS[meeting.source],
    sourceKey: meeting.source,
    confidence: meeting.confidence,
    language: meeting.language,
    preparation_tips: [...meeting.preparationTips],
    custom_alert_times: meeting.customAlertTimes ? [...meeting.customAlertTimes] : null,
    alert_intensity: meeting.alertIntensity,
    conference_details: meeting.conference,
    notes: meeting.notes,
    status: meeting.status,
    googleEventId: meeting.external.googleEventId,
    created_date: meeting.createdAt,
    updated_date: meeting.updatedAt,
  };
}

// ---------------------------------------------------------------------------------------------
// Legacy payload -> domain input
// ---------------------------------------------------------------------------------------------

type LegacyRecord = Record<string, unknown>;

function asRecord(raw: unknown): LegacyRecord {
  return typeof raw === 'object' && raw !== null ? (raw as LegacyRecord) : {};
}

function str(raw: unknown): string | undefined {
  return typeof raw === 'string' ? raw : undefined;
}

/** "14:30", "9:05", "14:30:00", "2:30 PM", "2:30pm" => "HH:mm" (null if unparseable). */
export function parseLegacyTime(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const match = /^\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?\s*$/.exec(raw);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3]?.toLowerCase();
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === 'pm' && hour !== 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
  }
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** "YYYY-MM-DD" or an ISO date-time (converted to the local date in `timeZone`). */
export function parseLegacyDate(raw: unknown, timeZone: string): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const value = raw.trim();
  if (isLocalDate(value)) return value;
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return toLocalDateTime(parsed, timeZone).date;
  }
  return null;
}

function legacyStartAt(record: LegacyRecord, timeZone: string, fallback?: { date: string; time: string }): string | null {
  const explicit = str(record.startAt) ?? str(record.startTime);
  if (explicit && !Number.isNaN(new Date(explicit).getTime())) return new Date(explicit).toISOString();
  const date = parseLegacyDate(record.date, timeZone) ?? fallback?.date ?? null;
  const time = parseLegacyTime(record.time) ?? fallback?.time ?? null;
  if (!date || !time) return null;
  return zonedDateTimeToUtcIso(date, time, timeZone);
}

function legacyDuration(raw: unknown): number | undefined {
  const value = typeof raw === 'string' ? Number.parseInt(raw, 10) : raw;
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(20_160, Math.max(1, Math.round(value)));
}

function legacyTips(raw: unknown): string[] | undefined {
  if (Array.isArray(raw)) return raw.filter((tip): tip is string => typeof tip === 'string' && tip.trim() !== '').map((t) => t.trim().slice(0, 300));
  if (typeof raw === 'string') return raw.split(/\r?\n/).map((t) => t.trim()).filter((t) => t !== '').map((t) => t.slice(0, 300));
  return undefined;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function legacyParticipants(raw: unknown): { participants: ParticipantInput[]; dropped: string[] } {
  const participants: ParticipantInput[] = [];
  const dropped: string[] = [];
  if (!Array.isArray(raw)) return { participants, dropped };
  for (const item of raw) {
    const record = asRecord(item);
    const email = str(record.email)?.trim() ?? '';
    const name = str(record.name)?.trim() || str(record.displayName)?.trim() || null;
    if (EMAIL_PATTERN.test(email)) {
      participants.push({ email, name });
    } else if (name) {
      dropped.push(name);
    }
  }
  return { participants, dropped };
}

function legacyLocationAndConference(record: LegacyRecord): Pick<MeetingCreateInput, 'location' | 'conference'> {
  const rawLocation = record.location;
  const conferenceRecord = asRecord(record.conference_details ?? record.conference);
  let conference: ConferenceDetails | null = null;

  const conferenceUrl = validHttpUrl(conferenceRecord.url);
  if (conferenceUrl || conferenceRecord.provider) {
    conference = {
      provider: normalizeConferenceProvider(conferenceRecord.provider),
      url: conferenceUrl,
      password: str(conferenceRecord.password)?.slice(0, 100) ?? null,
    };
  }

  if (typeof rawLocation === 'string') {
    const address = rawLocation.trim();
    return { location: address ? { type: 'physical', address: address.slice(0, 500), virtualUrl: null } : null, conference };
  }
  const loc = asRecord(rawLocation);
  const type: LocationType = loc.type === 'virtual' || loc.type === 'hybrid' ? loc.type : 'physical';
  const addressRaw = str(loc.address)?.trim() ?? '';
  const address = addressRaw && addressRaw !== 'No location specified' ? addressRaw.slice(0, 500) : null;
  const link = validHttpUrl(loc.virtualLink ?? loc.virtual_link ?? loc.link);
  if (!conference && link) {
    conference = { provider: normalizeConferenceProvider(loc.virtualPlatform ?? loc.virtual_platform), url: link, password: null };
  }
  if (!address && type === 'physical') return { location: null, conference };
  return { location: { type, address, virtualUrl: null }, conference };
}

export interface LegacyInputContext {
  /** Zone the legacy date/time are expressed in (device zone). */
  timeZone: string;
  language: Language;
}

/**
 * Converts a legacy create payload (ModernCreateMeeting / v1.0.9 local data) into a
 * MeetingCreateInput. Participants without a valid email cannot be kept (Meeting requires an
 * email); their names are appended to `notes` and returned in `droppedParticipantNames`.
 * Throws AppError('invalid_input') when title or start cannot be determined.
 */
export function fromLegacyMeetingInput(
  raw: unknown,
  context: LegacyInputContext,
): { input: MeetingCreateInput; droppedParticipantNames: string[] } {
  const record = asRecord(raw);
  const title = str(record.title)?.trim();
  if (!title) throw new AppError('invalid_input', 'Meeting title is required');
  const startAt = legacyStartAt(record, context.timeZone);
  if (!startAt) throw new AppError('invalid_input', 'Meeting date and time are required');

  const { participants, dropped } = legacyParticipants(record.participants ?? record.attendees);
  const { location, conference } = legacyLocationAndConference(record);
  const confidenceRaw = record.confidence;
  const confidence =
    typeof confidenceRaw === 'number' && Number.isFinite(confidenceRaw)
      ? Math.min(100, Math.max(0, Math.round(confidenceRaw)))
      : null;
  const existingNotes = str(record.notes)?.trim() ?? '';
  const droppedNote = dropped.length > 0 ? `Participants: ${dropped.join(', ')}` : '';
  const notes = [existingNotes, droppedNote].filter((part) => part !== '').join('\n') || null;
  const alertTimes = Array.isArray(record.custom_alert_times)
    ? record.custom_alert_times.filter((n): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 10_080)
    : null;
  const language: Language = record.language === 'es' || record.language === 'en' ? record.language : context.language;

  const input: MeetingCreateInput = {
    title: title.slice(0, 200),
    startAt,
    source: normalizeMeetingSource(record.source),
    description: (str(record.description) ?? '').slice(0, 4000),
    durationMinutes: legacyDuration(record.duration ?? record.durationMinutes) ?? DEFAULT_MEETING_DURATION_MINUTES,
    timezone: context.timeZone,
    allDay: record.allDay === true,
    location,
    conference,
    participants,
    confidence,
    language,
    preparationTips: legacyTips(record.preparation_tips ?? record.preparationTips) ?? [],
    customAlertTimes: alertTimes && alertTimes.length > 0 ? alertTimes.slice(0, 10) : null,
    alertIntensity: fromLegacyIntensity(record.alert_intensity),
    notes,
  };
  return { input, droppedParticipantNames: dropped };
}

/**
 * Converts a legacy update payload (e.g. AIInsights `{ title, date, time, duration }` or
 * `{ confidence: 100 }`) into a MeetingPatch against `current`. Unknown keys are ignored.
 */
export function fromLegacyMeetingPatch(raw: unknown, current: Meeting, context: { timeZone: string }): MeetingPatch {
  const record = asRecord(raw);
  const patch: MeetingPatch = {};
  const title = str(record.title)?.trim();
  if (title) patch.title = title.slice(0, 200);
  if (typeof record.description === 'string') patch.description = record.description.slice(0, 4000);
  const duration = legacyDuration(record.duration ?? record.durationMinutes);
  if (duration !== undefined) patch.durationMinutes = duration;

  if ('date' in record || 'time' in record || 'startTime' in record || 'startAt' in record) {
    const currentLocal = current.allDay ? { date: current.date, time: '00:00' } : toLocalDateTime(current.startAt, context.timeZone);
    const startAt = legacyStartAt(record, context.timeZone, currentLocal);
    if (!startAt) throw new AppError('invalid_input', 'Invalid meeting date or time');
    patch.startAt = startAt;
    patch.timezone = context.timeZone;
  }
  if (typeof record.confidence === 'number' && Number.isFinite(record.confidence)) {
    patch.confidence = Math.min(100, Math.max(0, Math.round(record.confidence)));
  }
  if ('location' in record || 'conference_details' in record) {
    const { location, conference } = legacyLocationAndConference(record);
    patch.location = location;
    if (conference || 'conference_details' in record) patch.conference = conference;
  }
  if ('participants' in record) patch.participants = legacyParticipants(record.participants).participants;
  const tips = legacyTips(record.preparation_tips);
  if (tips) patch.preparationTips = tips;
  if (typeof record.notes === 'string' || record.notes === null) patch.notes = (record.notes as string | null) ?? null;
  const intensity = fromLegacyIntensity(record.alert_intensity);
  if (intensity) patch.alertIntensity = intensity;
  return patch;
}

// ---------------------------------------------------------------------------------------------
// Preferences <-> legacy snake_case view
// ---------------------------------------------------------------------------------------------

export interface LegacyPreferencesView {
  /** Constant: there is exactly one preferences document per user. */
  id: 'preferences';
  language: Language;
  timezone: string;
  alert_enabled: boolean;
  alert_intensity: LegacyAlertIntensity;
  alert_sound_type: AlertSoundType;
  alert_volume: number;
  vibration_enabled: boolean;
  google_calendar_sync_enabled: boolean;
  onboarding_completed: boolean;
  default_alert_times: number[];
}

export function toLegacyPreferencesView(prefs: Preferences): LegacyPreferencesView {
  return {
    id: 'preferences',
    language: prefs.language,
    timezone: prefs.timezone,
    alert_enabled: prefs.alertEnabled,
    alert_intensity: toLegacyIntensity(prefs.alertIntensity),
    alert_sound_type: prefs.alertSoundType,
    alert_volume: prefs.alertVolume,
    vibration_enabled: prefs.vibrationEnabled,
    google_calendar_sync_enabled: prefs.googleCalendarSyncEnabled,
    onboarding_completed: prefs.onboardingCompleted,
    default_alert_times: [...prefs.defaultAlertTimes],
  };
}

/**
 * Legacy snake_case patch => PreferencesPatch. Unknown/legacy-only keys (id, created_by, theme,
 * created_date, ...) are ignored; invalid values are dropped (validated again by the repository).
 */
export function fromLegacyPreferencesPatch(raw: unknown): PreferencesPatch {
  const record = asRecord(raw);
  const patch: PreferencesPatch = {};
  if (record.language === 'en' || record.language === 'es') patch.language = record.language;
  if (typeof record.timezone === 'string') patch.timezone = record.timezone;
  if (typeof record.alert_enabled === 'boolean') patch.alertEnabled = record.alert_enabled;
  const intensity = fromLegacyIntensity(record.alert_intensity);
  if (intensity) patch.alertIntensity = intensity;
  if (record.alert_sound_type === 'voice_and_sound' || record.alert_sound_type === 'voice_only' || record.alert_sound_type === 'sound_only') {
    patch.alertSoundType = record.alert_sound_type;
  }
  if (typeof record.alert_volume === 'number' && record.alert_volume >= 0 && record.alert_volume <= 1) {
    patch.alertVolume = record.alert_volume;
  }
  if (typeof record.vibration_enabled === 'boolean') patch.vibrationEnabled = record.vibration_enabled;
  if (typeof record.google_calendar_sync_enabled === 'boolean') {
    patch.googleCalendarSyncEnabled = record.google_calendar_sync_enabled;
  }
  if (typeof record.onboarding_completed === 'boolean') patch.onboardingCompleted = record.onboarding_completed;
  return patch;
}
