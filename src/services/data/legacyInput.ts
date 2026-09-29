/**
 * Readers for PRE-REBUILD data (owner: data): the v1.0.9 AsyncStorage blob migrated once per
 * account (migration.ts) and old-shape Firestore documents converted on read (mapping.ts):
 * snake_case preferences, `date`/`time`/`duration` meetings, "Manual"/"ChatGPT" source labels,
 * `location.virtualLink`, `preparation_tips`. PURE (no React Native / Firebase).
 *
 * Input direction only: the app never writes these shapes again.
 */
import { httpUrlSchema, type ConferenceDetails, type ConferenceProvider, type Language, type LocationType } from '../../core/aiContract';
import { AppError } from '../../core/errors';
import { isLocalDate, toLocalDateTime, zonedDateTimeToUtcIso } from '../../core/time';
import {
  DEFAULT_MEETING_DURATION_MINUTES,
  MEETING_SOURCES,
  type AlertIntensity,
  type MeetingCreateInput,
  type MeetingSource,
  type ParticipantInput,
  type PreferencesPatch,
} from '../../core/types';

// ---------------------------------------------------------------------------------------------
// Sources, intensities, providers
// ---------------------------------------------------------------------------------------------

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

/** 'maximum' | 'max' | 'medium' | 'light' => AlertIntensity; anything else => null. */
export function fromLegacyIntensity(raw: unknown): AlertIntensity | null {
  if (raw === 'maximum' || raw === 'max') return 'max';
  if (raw === 'medium' || raw === 'light') return raw;
  return null;
}

/** "Zoom" | "zoom" | "Teams" | "Microsoft Teams" | "Google Meet" | "meet" ... => provider. */
function normalizeConferenceProvider(raw: unknown): ConferenceProvider {
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
function parseLegacyDate(raw: unknown, timeZone: string): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const value = raw.trim();
  if (isLocalDate(value)) return value;
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return toLocalDateTime(parsed, timeZone).date;
  }
  return null;
}

function legacyStartAt(record: LegacyRecord, timeZone: string): string | null {
  const explicit = str(record.startAt) ?? str(record.startTime);
  if (explicit && !Number.isNaN(new Date(explicit).getTime())) return new Date(explicit).toISOString();
  const date = parseLegacyDate(record.date, timeZone);
  const time = parseLegacyTime(record.time);
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
 * Converts a pre-rebuild meeting (v1.0.9 local data or an old-shape Firestore document) into a
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

// ---------------------------------------------------------------------------------------------
// Preferences (users/{uid}.preferences map and the v1.0.9 blob)
// ---------------------------------------------------------------------------------------------

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
