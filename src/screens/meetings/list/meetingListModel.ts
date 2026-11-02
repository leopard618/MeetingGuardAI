/**
 * PURE model of the meetings list (unit-tested; no React, no native modules).
 *
 * - Days are calendar days in the user's (device) time zone: a timed meeting belongs to the local
 *   day of its start, an all-day meeting to its own `date` (never shifted through UTC). "Today" is
 *   `todayInZone(zone, now)`, so it is right in every zone (the old list compared UTC dates).
 * - Filters: time (upcoming = not ended yet, so a meeting in progress stays visible; past = ended;
 *   all), source category (Meeting Guard / Google Calendar / device calendar) and a free-text
 *   search that ignores case and accents ("reunion" finds "Reunión").
 */
import { addDaysToLocalDate, isLocalDate, toLocalDateTime } from '../../../core/time';
import type { Meeting, MeetingSource } from '../../../core/types';

export const TIME_FILTERS = ['upcoming', 'past', 'all'] as const;
export type TimeFilter = (typeof TIME_FILTERS)[number];

export function isTimeFilter(value: unknown): value is TimeFilter {
  return typeof value === 'string' && (TIME_FILTERS as readonly string[]).includes(value);
}

export const SOURCE_FILTERS = ['all', 'meetingguard', 'google', 'device'] as const;
export type SourceFilter = (typeof SOURCE_FILTERS)[number];
/** Where a meeting comes from, as the UI groups it. */
export type SourceCategory = Exclude<SourceFilter, 'all'>;

export interface MeetingFilters {
  time: TimeFilter;
  source: SourceFilter;
  query: string;
}

export const DEFAULT_FILTERS: Readonly<MeetingFilters> = Object.freeze({ time: 'upcoming', source: 'all', query: '' });

export interface MeetingSection {
  /** "YYYY-MM-DD" in the list's time zone. */
  dayKey: string;
  data: Meeting[];
}

export type DayRelation = 'today' | 'tomorrow' | 'yesterday';

/** Meeting Guard meetings (manual, AI assistant, WhatsApp) vs. calendar imports. */
export function sourceCategory(source: MeetingSource): SourceCategory {
  if (source === 'google') return 'google';
  if (source === 'device') return 'device';
  return 'meetingguard';
}

export function meetingStartMs(meeting: Pick<Meeting, 'startAt'>): number {
  return Date.parse(meeting.startAt);
}

export function meetingEndMs(meeting: Pick<Meeting, 'startAt' | 'durationMinutes'>): number {
  return Date.parse(meeting.startAt) + Math.max(0, meeting.durationMinutes) * 60_000;
}

/** true while the meeting is running (timed meetings only). */
export function isInProgress(meeting: Pick<Meeting, 'startAt' | 'durationMinutes' | 'allDay'>, now: Date): boolean {
  if (meeting.allDay) return false;
  const time = now.getTime();
  return meetingStartMs(meeting) <= time && time < meetingEndMs(meeting);
}

/** Local day ("YYYY-MM-DD") the meeting starts on, as the user sees it. */
export function meetingDayKey(meeting: Pick<Meeting, 'startAt' | 'allDay' | 'date'>, timeZone: string): string {
  if (meeting.allDay && isLocalDate(meeting.date)) return meeting.date;
  return toLocalDateTime(meeting.startAt, timeZone).date;
}

/** Today / tomorrow / yesterday relative to `todayKey`, else null. */
export function dayRelation(dayKey: string, todayKey: string): DayRelation | null {
  if (dayKey === todayKey) return 'today';
  if (!isLocalDate(todayKey)) return null;
  if (dayKey === addDaysToLocalDate(todayKey, 1)) return 'tomorrow';
  if (dayKey === addDaysToLocalDate(todayKey, -1)) return 'yesterday';
  return null;
}

/** Lower case, trimmed, without accents. Falls back to plain lower case where normalize is missing. */
export function normalizeSearchText(value: string): string {
  const lower = value.toLowerCase().trim();
  try {
    return lower.normalize('NFD').replace(/[̀-ͯ]/g, '');
  } catch {
    return lower;
  }
}

function searchableText(meeting: Meeting): string {
  const parts: string[] = [meeting.title, meeting.description, meeting.notes ?? '', meeting.location?.address ?? ''];
  for (const participant of meeting.participants) {
    parts.push(participant.email, participant.name ?? '');
  }
  return normalizeSearchText(parts.join('\n'));
}

/** Every word of the query must appear somewhere in the meeting (title, description, notes, place, people). */
export function matchesSearch(meeting: Meeting, query: string): boolean {
  const words = normalizeSearchText(query).split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return true;
  const text = searchableText(meeting);
  return words.every((word) => text.includes(word));
}

export function matchesTime(meeting: Meeting, time: TimeFilter, now: Date): boolean {
  if (time === 'all') return true;
  const ended = meetingEndMs(meeting) <= now.getTime();
  return time === 'past' ? ended : !ended;
}

export function matchesSource(meeting: Meeting, source: SourceFilter): boolean {
  return source === 'all' || sourceCategory(meeting.source) === source;
}

export function filterMeetings(meetings: readonly Meeting[], filters: MeetingFilters, now: Date): Meeting[] {
  return meetings.filter(
    (meeting) => matchesTime(meeting, filters.time, now) && matchesSource(meeting, filters.source) && matchesSearch(meeting, filters.query),
  );
}

/** Within a day: all-day meetings first, then by start, then by title. */
export function compareWithinDay(a: Meeting, b: Meeting): number {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  const byStart = meetingStartMs(a) - meetingStartMs(b);
  if (byStart !== 0) return byStart;
  return a.title.localeCompare(b.title);
}

/**
 * Sections by local day. Days are ascending (upcoming, all) or descending (past: the most recent
 * day first); meetings inside a day are always in chronological order.
 */
export function groupMeetingsByDay(
  meetings: readonly Meeting[],
  options: { timeZone: string; order: 'asc' | 'desc' },
): MeetingSection[] {
  const byDay = new Map<string, Meeting[]>();
  for (const meeting of meetings) {
    const key = meetingDayKey(meeting, options.timeZone);
    const list = byDay.get(key);
    if (list) list.push(meeting);
    else byDay.set(key, [meeting]);
  }
  const keys = [...byDay.keys()].sort();
  if (options.order === 'desc') keys.reverse();
  return keys.map((dayKey) => ({ dayKey, data: (byDay.get(dayKey) ?? []).sort(compareWithinDay) }));
}

/** The whole pipeline of the list screen: filter, then group (past = most recent day first). */
export function buildMeetingSections(
  meetings: readonly Meeting[],
  filters: MeetingFilters,
  options: { timeZone: string; now: Date },
): MeetingSection[] {
  return groupMeetingsByDay(filterMeetings(meetings, filters, options.now), {
    timeZone: options.timeZone,
    order: filters.time === 'past' ? 'desc' : 'asc',
  });
}

export function hasActiveFilters(filters: MeetingFilters): boolean {
  return filters.source !== 'all' || normalizeSearchText(filters.query).length > 0;
}
