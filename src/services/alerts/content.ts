/**
 * Notification content (owner: alerts). PURE given its injected deps (t / formatTime): no Expo or
 * React Native imports, unit-tested.
 *
 * - renderAlertSpec(): the localized title/body + payload + platform hints of one notification.
 * - Every interpolated value is a plain string (never an object => never "[object Object]").
 * - `data.hash` covers everything that ends up on the device (fire time, text, language, sound,
 *   channel, category, link), so reconcile reschedules exactly when something visible changed.
 */
import { z } from 'zod';

import type { DesiredNotification } from '../../core/contracts';
import {
  NOTIFICATION_CATEGORIES,
  REFILL_NOTIFICATION_ID,
  assistantDeepLink,
  channelFor,
  meetingDeepLink,
  snoozeNotificationId,
} from '../../core/identifiers';
import { LOCAL_DATE_KEY_PATTERN, MEETING_ID_PATTERN } from '../../core/aiContract';
import { alertIntensitySchema, languageSchema, type Meeting } from '../../core/types';
import { CHANNEL_VIBRATION, notificationSoundFor } from './constants';
import type {
  AlertIntensity,
  AlertNotificationSpec,
  AlertTextDeps,
  AndroidPriorityName,
  InterruptionLevelName,
  MeetingSummary,
  NotificationKind,
  RefillNotificationData,
  RefillNotificationSpec,
  StoredAlertData,
} from './types';

export const ALERT_DATA_VERSION = 1 as const;
const MINUTE_MS = 60_000;
const MAX_TITLE_CHARS = 120;
const MAX_LOCATION_CHARS = 80;

// ---------------------------------------------------------------------------------------------
// Payload parsing
// ---------------------------------------------------------------------------------------------

const isoString = z.string().refine((value) => Number.isFinite(Date.parse(value)), 'invalid date');

const storedAlertDataSchema = z.object({
  v: z.literal(ALERT_DATA_VERSION),
  kind: z.enum(['alert', 'followup', 'snooze']),
  meetingId: z.string().regex(MEETING_ID_PATTERN),
  /** Occurrence date key for recurring-meeting notifications; absent for one-offs. */
  localDateKey: z.string().regex(LOCAL_DATE_KEY_PATTERN).optional(),
  offsetMinutes: z.number().int().min(0).nullable(),
  intensity: alertIntensitySchema,
  startAt: isoString,
  url: z.string().min(1),
  hash: z.string().min(1),
  fireAt: isoString,
  title: z.string(),
  language: languageSchema,
  durationMinutes: z.number().int().positive(),
});

/**
 * Parses notification content.data. Accepts the object, or the JSON string some platforms deliver
 * (Android headless tasks pass `dataString`). null for anything that is not a v1 Meeting Guard payload.
 */
export function parseAlertData(raw: unknown): StoredAlertData | null {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const parsed = storedAlertDataSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** content.data from a notification-like object ({ data } or { dataString }). */
export function extractContentData(content: unknown): unknown {
  if (typeof content !== 'object' || content === null) return null;
  const record = content as { data?: unknown; dataString?: unknown };
  if (typeof record.data === 'object' && record.data !== null && Object.keys(record.data).length > 0) {
    return record.data;
  }
  if (typeof record.dataString === 'string') return record.dataString;
  return record.data ?? null;
}

// ---------------------------------------------------------------------------------------------
// Hash (FNV-1a 32-bit; stable, dependency-free)
// ---------------------------------------------------------------------------------------------

export function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------------------------

/** Collapses whitespace and truncates (notification titles must stay short and single-line). */
export function cleanText(value: unknown, maxChars: number): string {
  if (typeof value !== 'string') return '';
  const collapsed = value.replace(/\s+/g, ' ').trim();
  return collapsed.length > maxChars ? `${collapsed.slice(0, maxChars - 1).trimEnd()}...` : collapsed;
}

const NO_ESCAPE = { interpolation: { escapeValue: false } } as const;

/** "in 15 minutes" / "in 2 hours" / "in 1 day" (localized, pluralized). */
export function leadText(minutes: number, t: AlertTextDeps['t']): string {
  const value = Math.max(0, Math.round(minutes));
  if (value > 0 && value % 1440 === 0) return t('alerts:lead.days', { count: value / 1440, ...NO_ESCAPE });
  if (value > 0 && value % 60 === 0) return t('alerts:lead.hours', { count: value / 60, ...NO_ESCAPE });
  return t('alerts:lead.minutes', { count: value, ...NO_ESCAPE });
}

/** Localized conference provider label (used when a meeting has no address). */
export function providerLabel(provider: string, t: AlertTextDeps['t']): string {
  switch (provider) {
    case 'zoom':
      return t('alerts:provider.zoom');
    case 'teams':
      return t('alerts:provider.teams');
    case 'google_meet':
      return t('alerts:provider.google_meet');
    default:
      return t('alerts:provider.other');
  }
}

/** Address, else the conference provider label, else null. */
export function meetingLocationText(meeting: Pick<Meeting, 'location' | 'conference'>, t: AlertTextDeps['t']): string | null {
  const address = cleanText(meeting.location?.address ?? '', MAX_LOCATION_CHARS);
  if (address) return address;
  if (meeting.conference) return providerLabel(meeting.conference.provider, t);
  if (meeting.location?.virtualUrl) return providerLabel('other', t);
  return null;
}

/** Real join link: conference.url, else location.virtualUrl; null when unknown (never fabricated). */
export function meetingJoinUrl(meeting: Pick<Meeting, 'location' | 'conference'>): string | null {
  return meeting.conference?.url ?? meeting.location?.virtualUrl ?? null;
}

export function summarizeMeeting(meeting: Meeting, t: AlertTextDeps['t']): MeetingSummary {
  return {
    id: meeting.id,
    title: meeting.title,
    startAt: meeting.startAt,
    durationMinutes: meeting.durationMinutes,
    language: meeting.language,
    locationText: meetingLocationText(meeting, t),
  };
}

// ---------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------

export interface RenderInput {
  identifier: string;
  kind: NotificationKind;
  meetingId: string;
  /** Occurrence date key when the notification belongs to one occurrence of a recurring meeting. */
  localDateKey?: string;
  offsetMinutes: number | null;
  fireAt: string;
  intensity: AlertIntensity;
}

function interruptionLevelFor(kind: NotificationKind, intensity: AlertIntensity): InterruptionLevelName {
  if (kind === 'followup') return 'active';
  return intensity === 'light' ? 'active' : 'timeSensitive';
}

function androidPriorityFor(kind: NotificationKind, intensity: AlertIntensity): AndroidPriorityName {
  if (kind === 'followup') return 'default';
  if (intensity === 'max') return 'max';
  return intensity === 'medium' ? 'high' : 'default';
}

function renderTitle(input: RenderInput, meeting: MeetingSummary, title: string, deps: AlertTextDeps): string {
  const startMs = Date.parse(meeting.startAt);
  const fireMs = Date.parse(input.fireAt);
  if (input.kind === 'followup') return deps.t('alerts:notification.followUpTitle', { title, ...NO_ESCAPE });
  const minutesToStart =
    input.kind === 'alert' && input.offsetMinutes !== null
      ? input.offsetMinutes
      : Math.round((startMs - fireMs) / MINUTE_MS);
  if (minutesToStart > 0) {
    const lead = leadText(minutesToStart, deps.t);
    return input.kind === 'snooze'
      ? deps.t('alerts:notification.snoozeTitle', { title, lead, ...NO_ESCAPE })
      : deps.t('alerts:notification.upcomingTitle', { title, lead, ...NO_ESCAPE });
  }
  if (minutesToStart === 0) return deps.t('alerts:notification.nowTitle', { title, ...NO_ESCAPE });
  return deps.t('alerts:notification.startedTitle', { title, ...NO_ESCAPE });
}

function renderBody(input: RenderInput, meeting: MeetingSummary, deps: AlertTextDeps): string {
  if (input.kind === 'followup') return deps.t('alerts:notification.followUpBody', NO_ESCAPE);
  const time = deps.formatTime(meeting.startAt, {
    language: deps.language,
    timeZone: deps.timeZone,
    use24Hour: deps.use24Hour,
  });
  const location = cleanText(meeting.locationText ?? '', MAX_LOCATION_CHARS);
  return location
    ? deps.t('alerts:notification.bodyWithLocation', { time, location, ...NO_ESCAPE })
    : deps.t('alerts:notification.body', { time, ...NO_ESCAPE });
}

/** Renders one notification (text, payload, platform hints, hash). Throws only if deps throw. */
export function renderAlertSpec(input: RenderInput, meeting: MeetingSummary, deps: AlertTextDeps): AlertNotificationSpec {
  const title = cleanText(meeting.title, MAX_TITLE_CHARS) || deps.t('alerts:notification.untitled');
  const notificationTitle = renderTitle(input, meeting, title, deps);
  const body = renderBody(input, meeting, deps);
  const channelId = channelFor(input.kind === 'followup' ? 'followup' : input.intensity, deps.vibrationEnabled);
  const categoryId = input.kind === 'followup' ? NOTIFICATION_CATEGORIES.followup : NOTIFICATION_CATEGORIES.alert;
  const sound = notificationSoundFor(input.kind, input.intensity);
  const interruptionLevel = interruptionLevelFor(input.kind, input.intensity);
  const androidPriority = androidPriorityFor(input.kind, input.intensity);
  // MAX and MEDIUM must not be swiped away ("minimizable, not dismissible"); the tap / Open /
  // Snooze actions and the tray sweep (30 min after the meeting ends) still remove them.
  const sticky = input.kind !== 'followup' && input.intensity !== 'light';
  const vibrate = deps.vibrationEnabled
    ? [...(input.kind === 'followup' ? CHANNEL_VIBRATION.followup : CHANNEL_VIBRATION[input.intensity])]
    : [];
  const url =
    input.kind === 'followup' ? assistantDeepLink({ followUpMeetingId: meeting.id }) : meetingDeepLink(meeting.id);

  const hash = fnv1a32(
    JSON.stringify([
      ALERT_DATA_VERSION,
      input.identifier,
      input.fireAt,
      notificationTitle,
      body,
      channelId,
      categoryId,
      sound,
      interruptionLevel,
      androidPriority,
      sticky,
      vibrate,
      url,
      input.intensity,
      deps.language,
      meeting.language,
      meeting.startAt,
      meeting.durationMinutes,
    ]),
  );

  const data: StoredAlertData = {
    v: ALERT_DATA_VERSION,
    kind: input.kind,
    meetingId: input.meetingId,
    ...(input.localDateKey !== undefined ? { localDateKey: input.localDateKey } : {}),
    offsetMinutes: input.kind === 'alert' ? input.offsetMinutes : null,
    intensity: input.intensity,
    startAt: meeting.startAt,
    url,
    hash,
    fireAt: input.fireAt,
    title,
    language: meeting.language,
    durationMinutes: meeting.durationMinutes,
  };

  return {
    identifier: input.identifier,
    kind: input.kind,
    meetingId: input.meetingId,
    fireAt: input.fireAt,
    intensity: input.intensity,
    channelId,
    categoryId,
    title: notificationTitle,
    body,
    sound,
    interruptionLevel,
    androidPriority,
    vibrate,
    sticky,
    data,
  };
}

/** Renders a planner item. For occurrence items, `meeting` must carry the OCCURRENCE's values. */
export function renderPlanItem(item: DesiredNotification, meeting: MeetingSummary, deps: AlertTextDeps): AlertNotificationSpec {
  return renderAlertSpec(
    {
      identifier: item.identifier,
      kind: item.kind,
      meetingId: item.meetingId,
      ...(item.localDateKey !== undefined ? { localDateKey: item.localDateKey } : {}),
      offsetMinutes: item.offsetMinutes,
      fireAt: item.fireAt,
      intensity: item.intensity,
    },
    meeting,
    deps,
  );
}

/**
 * Renders the snooze notification "mg:{id}:snooze" firing at `fireAt`. For a snoozed occurrence
 * of a recurring meeting, `localDateKey` names it (kept in the payload so the reconcile can keep
 * validating the snooze against that occurrence).
 */
export function renderSnoozeSpec(
  meeting: MeetingSummary,
  intensity: AlertIntensity,
  fireAt: string,
  deps: AlertTextDeps,
  localDateKey?: string,
): AlertNotificationSpec {
  return renderAlertSpec(
    {
      identifier: snoozeNotificationId(meeting.id),
      kind: 'snooze',
      meetingId: meeting.id,
      ...(localDateKey !== undefined ? { localDateKey } : {}),
      offsetMinutes: null,
      fireAt,
      intensity,
    },
    meeting,
    deps,
  );
}

// ---------------------------------------------------------------------------------------------
// Refill reminder
// ---------------------------------------------------------------------------------------------

const refillDataSchema = z.object({
  v: z.literal(ALERT_DATA_VERSION),
  kind: z.literal('refill'),
  fireAt: isoString,
  hash: z.string().min(1),
});

/** Parses the payload of the refill reminder (object or JSON string); null otherwise. */
export function parseRefillData(raw: unknown): RefillNotificationData | null {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const parsed = refillDataSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * "Open Meeting Guard to keep your alerts up to date" (the OS budget cut real alerts). Low-key
 * follow-up channel, no actions; tapping it opens the app, which reconciles the alert window.
 */
export function renderRefillSpec(fireAt: string, deps: AlertTextDeps): RefillNotificationSpec {
  const title = deps.t('alerts:refill.title', NO_ESCAPE);
  const body = deps.t('alerts:refill.body', NO_ESCAPE);
  const channelId = channelFor('followup', deps.vibrationEnabled);
  const vibrate = deps.vibrationEnabled ? [...CHANNEL_VIBRATION.followup] : [];
  const hash = fnv1a32(JSON.stringify([ALERT_DATA_VERSION, REFILL_NOTIFICATION_ID, fireAt, title, body, channelId, vibrate, deps.language]));
  return {
    identifier: REFILL_NOTIFICATION_ID,
    kind: 'refill',
    fireAt,
    channelId,
    categoryId: null,
    title,
    body,
    sound: 'default',
    interruptionLevel: 'active',
    androidPriority: 'default',
    vibrate,
    sticky: false,
    data: { v: ALERT_DATA_VERSION, kind: 'refill', fireAt, hash },
  };
}

/** Rebuilds a MeetingSummary from a stored payload (headless snooze without a data session). */
export function summaryFromAlertData(data: StoredAlertData): MeetingSummary {
  return {
    id: data.meetingId,
    title: data.title,
    startAt: data.startAt,
    durationMinutes: data.durationMinutes,
    language: data.language,
    locationText: null,
  };
}
