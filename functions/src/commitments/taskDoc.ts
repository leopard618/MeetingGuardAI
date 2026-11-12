/**
 * The task an accepted suggestion becomes (docs/v2/M11-DESIGN.md decision 5, section 3.4; section
 * 15 findings 11, 18, 19 and 29). PURE: the transaction that writes it is decide's.
 *
 * Existing task fields only (no new TaskSource, no new key: src/core/types.ts taskSchema and
 * firestore.rules isValidTask hasOnly), so every 1.6.0 phone shows the task, schedules its
 * reminder and pushes it to To Do and Google Tasks:
 *   userId, title, description, dueDate, dueTime, timezone, reminderMinutesBefore, status 'open',
 *   meetingId, people, completedAt null, source 'ai_chat', pushPending true, createdAt, updatedAt.
 * - title: the suggestion's title (cleaned and prefixed) unless the user edited it; an edited title
 *   is taken as typed within the 200 (taskTitleFor), never stripped of what the user wrote.
 * - description: the origin line (commitmentOriginLine), never summary text.
 * - meetingId: the match's meeting (the master id for a series; a task has no occurrence field,
 *   the occurrence's date is in the origin line), null when the meeting document is missing or a
 *   tombstone (taskMeetingIdOf).
 * - people: [] when the owner is the user or nobody, else [{name, email: null}], name at most 100.
 * - timezone (chooseTaskZone): a TIME stated in the summary keeps the meeting's zone, because "by
 *   17:00" was said in the meeting's time. Otherwise the app's request zone; on WhatsApp the
 *   preferences zone only when set and not UTC (what a missing value reads as), else the meeting's
 *   zone, else no zone at all: then no default date, time or reminder (never 9:00 UTC, which is
 *   3:00 in Mexico City).
 * - Defaults (defaultSchedule; WhatsApp, and the phone before any edit): a stated date and time,
 *   reminder 60 minutes before; a stated date only, 9:00 that day with the reminder at the time; no
 *   date, tomorrow 9:00 in the task zone (the next LOCAL date at decide time); a stated date already
 *   past, the date (and stated time) kept and no reminder. A reminder that would already lie in the
 *   past is left out (at the due time instead of 60 minutes before when that is still ahead).
 *
 * Product text rule: ASCII punctuation only in this file; Spanish text keeps its accents.
 */
import {
  AI_TASK_LIMITS,
  COMMITMENT_LIMITS,
  MEETING_ID_PATTERN,
  aiTaskDraftSchema,
  timeZoneSchema,
  type CommitmentMode,
} from '../shared/aiContract';
import { addDaysToLocalDate, isLocalDate, isLocalTime, isValidTimeZone, todayInZone, zonedDateTimeToUtcIso } from '../shared/time';
import { sliceSafe } from '../summaries/sanitize';
import { collapseWhitespace } from './text';

/** The keys of a commitment task document: a subset of firestore.rules isValidTask's hasOnly list. */
export const COMMITMENT_TASK_KEYS = [
  'userId',
  'title',
  'description',
  'dueDate',
  'dueTime',
  'timezone',
  'reminderMinutesBefore',
  'status',
  'meetingId',
  'people',
  'completedAt',
  'source',
  'pushPending',
  'createdAt',
  'updatedAt',
] as const;

export interface CommitmentTaskDoc {
  userId: string;
  title: string;
  description: string;
  dueDate: string | null;
  dueTime: string | null;
  timezone: string;
  reminderMinutesBefore: number | null;
  status: 'open';
  meetingId: string | null;
  people: { name: string; email: null }[];
  completedAt: null;
  source: 'ai_chat';
  pushPending: true;
  createdAt: string;
  updatedAt: string;
}

/** The default reminder (decision 11): 9:00, at the time; a stated time, 60 minutes before. */
export const COMMITMENT_REMINDER_DEFAULTS = { timeOfDay: '09:00', minutesBeforeStatedTime: 60, minutesBeforeDefaultTime: 0 } as const;

// ---------------------------------------------------------------------------------------------
// Zone
// ---------------------------------------------------------------------------------------------

export type TaskChannel = 'app' | 'whatsapp';
export type TaskZoneSource = 'meeting' | 'request' | 'preferences' | 'none';

export interface TaskZoneInput {
  channel: TaskChannel;
  /** The summary states a time (the due's time came from its words). */
  statedTime: boolean;
  /** match.meetingSnapshot.timezone, or null for a kept summary. */
  meetingZone: string | null;
  /** The decide request's zone (the device zone); null on WhatsApp. */
  requestZone: string | null;
  /** users/{uid}/settings/preferences.timezone as stored, or null when not set. */
  preferencesZone: string | null;
}

export interface TaskZone {
  /** null: no usable zone, so no default date, time or reminder. */
  zone: string | null;
  source: TaskZoneSource;
}

function usable(zone: string | null | undefined): zone is string {
  return typeof zone === 'string' && timeZoneSchema.safeParse(zone).success && isValidTimeZone(zone);
}

/** 'UTC' is what a missing preferences zone reads as (whatsapp/session.ts getPreferences). */
function isUtcAlias(zone: string): boolean {
  return ['utc', 'etc/utc', 'etc/gmt', 'gmt', 'etc/uct', 'uct', 'etc/universal', 'universal', 'etc/zulu', 'zulu'].includes(zone.toLowerCase());
}

/** The task's zone (see the module comment). */
export function chooseTaskZone(input: TaskZoneInput): TaskZone {
  if (input.statedTime && usable(input.meetingZone)) return { zone: input.meetingZone, source: 'meeting' };
  if (input.channel === 'app') {
    if (usable(input.requestZone)) return { zone: input.requestZone, source: 'request' };
    if (usable(input.preferencesZone)) return { zone: input.preferencesZone, source: 'preferences' };
  } else if (usable(input.preferencesZone) && !isUtcAlias(input.preferencesZone)) {
    return { zone: input.preferencesZone, source: 'preferences' };
  }
  if (usable(input.meetingZone)) return { zone: input.meetingZone, source: 'meeting' };
  return { zone: null, source: 'none' };
}

// ---------------------------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------------------------

export interface ScheduleInput {
  /** The date (and time) the summary states, after the checks; null when it states none. */
  due: { date: string; time: string | null } | null;
  /** chooseTaskZone's zone. */
  zone: string | null;
  /** Decide time. */
  now: Date;
}

export type ReminderSource = 'summary' | 'default' | 'none';

export interface Schedule {
  dueDate: string | null;
  dueTime: string | null;
  reminderMinutesBefore: number | null;
  /** The stated date has passed (shown as overdue). */
  overdue: boolean;
  /** summary: the date came from the summary; default: the user's default choice; none: no date. */
  source: ReminderSource;
}

function instantMs(date: string, time: string, zone: string): number {
  return Date.parse(zonedDateTimeToUtcIso(date, time, zone));
}

/** The reminder offset that still lies ahead, or null. */
function reminderAhead(date: string, time: string, zone: string, preferred: number, now: Date): number | null {
  const at = instantMs(date, time, zone);
  if (at - preferred * 60_000 > now.getTime()) return preferred;
  return at > now.getTime() ? 0 : null;
}

/** The default schedule of an accepted suggestion (see the module comment). */
export function defaultSchedule(input: ScheduleInput): Schedule {
  const { due, zone, now } = input;
  const statedDate = due !== null && isLocalDate(due.date) ? due.date : null;
  const statedTime = statedDate !== null && due !== null && due.time !== null && isLocalTime(due.time) ? due.time : null;
  if (zone === null || !usable(zone)) {
    // No zone: keep a stated date only; no time and no reminder in a zone nobody chose.
    const today = todayInZone('UTC', now);
    return { dueDate: statedDate, dueTime: null, reminderMinutesBefore: null, overdue: statedDate !== null && statedDate < today, source: statedDate !== null ? 'summary' : 'none' };
  }
  const today = todayInZone(zone, now);
  if (statedDate !== null) {
    if (statedDate < today) return { dueDate: statedDate, dueTime: statedTime, reminderMinutesBefore: null, overdue: true, source: 'summary' };
    if (statedTime !== null) {
      return {
        dueDate: statedDate,
        dueTime: statedTime,
        reminderMinutesBefore: reminderAhead(statedDate, statedTime, zone, COMMITMENT_REMINDER_DEFAULTS.minutesBeforeStatedTime, now),
        overdue: false,
        source: 'summary',
      };
    }
    const time = COMMITMENT_REMINDER_DEFAULTS.timeOfDay;
    const reminder = reminderAhead(statedDate, time, zone, COMMITMENT_REMINDER_DEFAULTS.minutesBeforeDefaultTime, now);
    return reminder === null
      ? { dueDate: statedDate, dueTime: null, reminderMinutesBefore: null, overdue: false, source: 'summary' }
      : { dueDate: statedDate, dueTime: time, reminderMinutesBefore: reminder, overdue: false, source: 'summary' };
  }
  return {
    dueDate: addDaysToLocalDate(today, 1),
    dueTime: COMMITMENT_REMINDER_DEFAULTS.timeOfDay,
    reminderMinutesBefore: COMMITMENT_REMINDER_DEFAULTS.minutesBeforeDefaultTime,
    overdue: false,
    source: 'default',
  };
}

// ---------------------------------------------------------------------------------------------
// Meeting link, title, origin line
// ---------------------------------------------------------------------------------------------

/**
 * The task's meetingId: the match's meeting id (the master for a series) while that meeting's
 * document exists and is no tombstone (deletedAt set or status 'deleted'); else null.
 */
export function taskMeetingIdOf(meetingId: string | null, meetingDoc: Record<string, unknown> | null | undefined): string | null {
  if (meetingId === null || !MEETING_ID_PATTERN.test(meetingId)) return null;
  if (meetingDoc === null || meetingDoc === undefined) return null;
  const tombstone = (meetingDoc.deletedAt !== undefined && meetingDoc.deletedAt !== null) || meetingDoc.status === 'deleted';
  return tombstone ? null : meetingId;
}

/** The title written: the user's edit as typed (trimmed, within 200), else the suggestion's. */
export function taskTitleFor(suggestionTitle: string, draftTitle: string | null | undefined): string {
  const edited = typeof draftTitle === 'string' ? sliceSafe(draftTitle.trim(), COMMITMENT_LIMITS.maxTitleChars).trim() : '';
  return edited.length > 0 ? edited : suggestionTitle;
}

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'] as const;

function originDate(date: string, language: 'en' | 'es'): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return language === 'es' ? `${d} ${MONTHS_ES[m - 1] ?? ''} ${y}` : `${MONTHS_EN[m - 1] ?? ''} ${d}, ${y}`;
}

export interface OriginLineInput {
  /** The request's (or the WhatsApp user's) language; anything but Spanish reads English (M12 adds more). */
  language: string | null;
  mode: CommitmentMode;
  /** The user's own calendar title of the meeting; null for a kept summary. */
  meetingTitle: string | null;
  /** The meeting's (or occurrence's) local date, else the summary's date; null when unknown. */
  date: string | null;
}

/**
 * The task description (section 11): where the task came from, never summary text. The meeting
 * title is the user's own calendar title, cut to 200 characters.
 */
export function commitmentOriginLine(input: OriginLineInput): string {
  const language: 'en' | 'es' = typeof input.language === 'string' && input.language.toLowerCase().startsWith('es') ? 'es' : 'en';
  const title = input.meetingTitle === null ? '' : sliceSafe(collapseWhitespace(input.meetingTitle), 200).trim();
  const date = input.date !== null && isLocalDate(input.date) ? originDate(input.date, language) : null;
  const ai = input.mode === 'ai';
  if (language === 'es') {
    const tail = ai ? 'Sugerida por Meeting Guard AI, agregada por ti.' : 'Agregada por ti.';
    const what = ai ? 'De la minuta de tu asistente de notas' : 'De las tareas de la minuta de tu asistente de notas';
    if (title.length > 0) return `${what} sobre ${title}${date === null ? '' : ` (${date})`}. ${tail}`;
    const kept = ai ? 'De una minuta de tu asistente de notas' : 'De las tareas de una minuta de tu asistente de notas';
    return `${kept}${date === null ? '' : ` con fecha ${date}`}. ${tail}`;
  }
  const tail = ai ? 'Suggested by Meeting Guard AI, added by you.' : 'Added by you.';
  if (title.length > 0) {
    const what = ai ? "From your notetaker's summary of" : "From the action items of your notetaker's summary of";
    return `${what} ${title}${date === null ? '' : ` (${date})`}. ${tail}`;
  }
  const kept = ai ? 'From a notetaker summary' : 'From the action items of a notetaker summary';
  return `${kept}${date === null ? '' : ` dated ${date}`}. ${tail}`;
}

// ---------------------------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------------------------

export interface CommitmentTaskInput {
  uid: string;
  /** Final (taskTitleFor). */
  title: string;
  /** The origin line (commitmentOriginLine). */
  description: string;
  dueDate: string | null;
  dueTime: string | null;
  /** chooseTaskZone's zone; 'UTC' when it chose none (then no time and no reminder). */
  timezone: string;
  reminderMinutesBefore: number | null;
  /** taskMeetingIdOf. */
  meetingId: string | null;
  /** null: nobody named; isUser: the user (no people entry). */
  owner: { name: string; isUser: boolean } | null;
  now: Date;
}

export type CommitmentTaskFailure = 'invalid_uid' | 'invalid_task' | 'invalid_zone' | 'invalid_owner';

export type CommitmentTaskResult = { ok: true; doc: CommitmentTaskDoc } | { ok: false; reason: CommitmentTaskFailure };

const UID_PATTERN = /^[^/]{1,128}$/;

/**
 * The task document (see the module comment), checked like the assistant's drafts
 * (aiTaskDraftSchema: title, description, due invariants, reminder, meeting id, people) plus the
 * zone, the uid and the owner's 100 characters. A failure is a wiring or request error (the
 * caller answers invalid_request); nothing is written.
 */
export function buildCommitmentTaskDoc(input: CommitmentTaskInput): CommitmentTaskResult {
  if (typeof input.uid !== 'string' || !UID_PATTERN.test(input.uid)) return { ok: false, reason: 'invalid_uid' };
  if (!usable(input.timezone)) return { ok: false, reason: 'invalid_zone' };
  let people: { name: string; email: null }[] = [];
  if (input.owner !== null && !input.owner.isUser) {
    const name = collapseWhitespace(input.owner.name);
    if (name.length === 0 || name.length > COMMITMENT_LIMITS.maxOwnerChars) return { ok: false, reason: 'invalid_owner' };
    people = [{ name, email: null }];
  }
  const draft = aiTaskDraftSchema.safeParse({
    title: input.title,
    description: input.description,
    dueDate: input.dueDate,
    dueTime: input.dueTime,
    reminderMinutesBefore: input.reminderMinutesBefore,
    meetingId: input.meetingId,
    people,
  });
  if (!draft.success || input.title.trim().length === 0) return { ok: false, reason: 'invalid_task' };
  // The contract patterns accept "2026-02-30"; a task date must be a real calendar date.
  if ((input.dueDate !== null && !isLocalDate(input.dueDate)) || (input.dueTime !== null && !isLocalTime(input.dueTime))) {
    return { ok: false, reason: 'invalid_task' };
  }
  if (input.reminderMinutesBefore !== null && input.reminderMinutesBefore > AI_TASK_LIMITS.maxReminderMinutes) return { ok: false, reason: 'invalid_task' };
  const nowIso = input.now.toISOString();
  return {
    ok: true,
    doc: {
      userId: input.uid,
      title: draft.data.title,
      description: draft.data.description,
      dueDate: draft.data.dueDate,
      dueTime: draft.data.dueTime,
      timezone: input.timezone,
      reminderMinutesBefore: draft.data.reminderMinutesBefore,
      status: 'open',
      meetingId: draft.data.meetingId,
      people,
      completedAt: null,
      source: 'ai_chat',
      pushPending: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
  };
}
