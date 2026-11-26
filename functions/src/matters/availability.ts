/**
 * A3: free times in the owner's calendar (docs/v1/ARCHITECTURE.md section 36). Decided by CODE
 * only; the model never sees the calendar and never chooses a time.
 *
 * Busy: the owner's meetings in Meeting Guard AI (users/{uid}/meetings), which include the events
 * the app imports from Google Calendar, Outlook and the phone's calendar as of its last sync.
 * Recurring meetings are expanded (shared/recurrence.ts), with their cancelled and moved
 * occurrences. Tombstones and cancelled meetings are free. All-day events are free: calendars
 * create them as "free" by default (birthdays, holidays, reminders).
 *
 * Where a meeting may go (allowedRanges):
 * - the mandate's windows; a window of whole days ("Tuesday or Wednesday") only within working
 *   hours on those days, a window with clock times exactly as given;
 * - without windows: working hours, Monday to Friday 9:00 to 18:00, in the mandate's zone;
 * - never sooner than AVAILABILITY.minLeadMinutes from now, never after the end date.
 * A time is free when no busy interval, widened by bufferMinutes on both sides, overlaps it.
 *
 * When the contact says when they would like to meet ("next week", "Tuesday afternoon"; read by
 * scheduling.ts readRange), the offer keeps to it (offerSlots); when it has no free time, the
 * offer is the free times nearest to it, and the email says so.
 *
 * Pure, except loadBusy (one read through the assistant's MeetingReader).
 */
import type { MeetingReader, MeetingRecord } from '../assistant/context';
import { expandOccurrences, type RecurrenceOverrides } from '../shared/recurrence';
import { addDaysToLocalDate, getZonedParts, toLocalDateTime, zonedDateTimeToUtcIso } from '../shared/time';
import type { Mandate, Slot } from './model';
import { DEFAULT_WORKING_HOURS, type WorkingHours } from './schedule';

export const AVAILABILITY = {
  /** Kept free before and after every busy meeting. */
  bufferMinutes: 15,
  /** No time is offered or booked sooner than this from now. */
  minLeadMinutes: 4 * 60,
  /** Offered times start on these steps (UTC minutes; :00 and :30 in whole and half hour zones). */
  stepMinutes: 30,
  /** Times offered on the same day (a contact who named one day) are at least this far apart. */
  spreadMinutes: 120,
  /** How far ahead free times are looked for (and at most the end date). */
  horizonDays: 30,
  /** Meetings read per query (the assistant's own bounded reader). */
  queryLimit: 500,
  recurringLimit: 100,
} as const;

const MINUTE = 60_000;
const DAY = 86_400_000;

export interface Interval {
  start: number;
  end: number;
}

/** RecurrenceOverrides from the assistant's lenient reader (only status and a new start are known there). */
function overridesOf(record: MeetingRecord): RecurrenceOverrides | null {
  const raw = record.doc.recurrenceOverrides;
  if (!raw) return null;
  const out: RecurrenceOverrides = {};
  for (const [key, value] of Object.entries(raw)) {
    out[key] = { status: value.status === 'cancelled' ? 'cancelled' : 'modified', startAt: value.startAt ?? null, durationMinutes: null, title: null };
  }
  return out;
}

/**
 * The busy intervals of these meetings that overlap [fromMs, toMs), sorted. A document read
 * twice (a recurring master inside the start window) counts once; one that does not expand is
 * skipped (it cannot make a time look busy, but a broken document never blocks the calendar).
 */
export function busyIntervals(records: readonly MeetingRecord[], fromMs: number, toMs: number): Interval[] {
  const seen = new Set<string>();
  const out: Interval[] = [];
  const fromIso = new Date(fromMs).toISOString();
  const toIso = new Date(toMs).toISOString();
  for (const record of records) {
    if (seen.has(record.id)) continue;
    seen.add(record.id);
    const doc = record.doc;
    if (doc.deletedAt !== null || doc.status === 'cancelled' || doc.allDay) continue;
    const start = Date.parse(doc.startAt);
    if (!Number.isFinite(start)) continue;
    const minutes = Math.max(1, Math.round(doc.durationMinutes));
    if (doc.recurrence) {
      try {
        const local = toLocalDateTime(new Date(start), doc.timezone);
        const occurrences = expandOccurrences(
          {
            id: record.id,
            title: doc.title,
            date: local.date,
            time: local.time,
            timezone: doc.timezone,
            durationMinutes: minutes,
            allDay: false,
            recurrence: doc.recurrence,
            recurrenceOverrides: overridesOf(record),
          },
          fromIso,
          toIso,
        );
        for (const o of occurrences) out.push({ start: Date.parse(o.startAt), end: Date.parse(o.endAt) });
      } catch {
        // an invalid rule or zone: skipped
      }
      continue;
    }
    const end = start + minutes * MINUTE;
    if (end > fromMs && start < toMs) out.push({ start, end });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Whether a local "00:00" start marks a window of whole days. */
function isWholeDayWindow(startMs: number, zone: string): boolean {
  const p = getZonedParts(new Date(startMs), zone);
  return p.hour === 0 && p.minute === 0;
}

/** Working hours of one local date, as an interval (A5: the owner's hours from the settings). */
function workingHoursOf(date: string, zone: string, hours: WorkingHours): Interval {
  return {
    start: Date.parse(zonedDateTimeToUtcIso(date, hours.start, zone)),
    end: Date.parse(zonedDateTimeToUtcIso(date, hours.end, zone)),
  };
}

function isWorkingDay(date: string, zone: string, hours: WorkingHours): boolean {
  const noon = Date.parse(zonedDateTimeToUtcIso(date, '12:00', zone));
  return hours.days.includes(getZonedParts(new Date(noon), zone).weekday);
}

/** The local dates from the day of fromMs to the day of toMs (at most horizonDays + 2). */
function localDates(fromMs: number, toMs: number, zone: string): string[] {
  const last = toLocalDateTime(new Date(toMs), zone).date;
  const out: string[] = [];
  let date = toLocalDateTime(new Date(fromMs), zone).date;
  for (let i = 0; i < AVAILABILITY.horizonDays + 2 && date <= last; i += 1) {
    out.push(date);
    date = addDaysToLocalDate(date, 1);
  }
  return out;
}

function clip(list: Interval[], fromMs: number, toMs: number): Interval[] {
  return list
    .map((i) => ({ start: Math.max(i.start, fromMs), end: Math.min(i.end, toMs) }))
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start);
}

/** Where a meeting of this mandate may go, between fromMs and toMs (see the module comment). */
export function allowedRanges(meeting: NonNullable<Mandate['meeting']>, zone: string, fromMs: number, toMs: number, hours: WorkingHours = DEFAULT_WORKING_HOURS): Interval[] {
  if (toMs <= fromMs) return [];
  const out: Interval[] = [];
  if (meeting.windows.length === 0) {
    // A5: the owner's working hours and days (quiet days are never offered)
    for (const date of localDates(fromMs, toMs, zone)) if (isWorkingDay(date, zone, hours)) out.push(workingHoursOf(date, zone, hours));
    return clip(out, fromMs, toMs);
  }
  for (const window of meeting.windows) {
    const start = Date.parse(window.start);
    const end = Date.parse(window.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    if (isWholeDayWindow(start, zone)) {
      // "Tuesday or Wednesday": those days, within working hours (any weekday the user named)
      for (const date of localDates(start, end - 1, zone)) {
        const day = workingHoursOf(date, zone, hours);
        out.push({ start: Math.max(day.start, start), end: Math.min(day.end, end) });
      }
    } else {
      out.push({ start, end });
    }
  }
  return clip(out, fromMs, toMs);
}

/** The bounds every offered or booked time must keep: from now + the lead time to the end date. */
export function searchBounds(now: Date, endsAt: string): { fromMs: number; toMs: number } {
  const fromMs = now.getTime() + AVAILABILITY.minLeadMinutes * MINUTE;
  const toMs = Math.min(Date.parse(endsAt), now.getTime() + AVAILABILITY.horizonDays * DAY);
  return { fromMs, toMs };
}

function overlapsBusy(start: number, end: number, busy: readonly Interval[]): boolean {
  const buffer = AVAILABILITY.bufferMinutes * MINUTE;
  return busy.some((b) => b.start - buffer < end && b.end + buffer > start);
}

/**
 * Up to `count` free times of `durationMinutes`, earliest first: at most one per local day (so the
 * contact gets a real choice), or, with `perDay`, up to that many a day at least
 * AVAILABILITY.spreadMinutes apart (a contact who named one day).
 */
export function freeSlots(input: { busy: readonly Interval[]; allowed: readonly Interval[]; durationMinutes: number; zone: string; count: number; perDay?: number }): Slot[] {
  const duration = input.durationMinutes * MINUTE;
  const step = AVAILABILITY.stepMinutes * MINUTE;
  const spread = AVAILABILITY.spreadMinutes * MINUTE;
  const perDay = Math.max(1, input.perDay ?? 1);
  const taken = new Map<string, number>();
  const out: Slot[] = [];
  for (const range of input.allowed) {
    let notBefore = -Infinity;
    for (let start = Math.ceil(range.start / step) * step; start + duration <= range.end; start += step) {
      if (out.length >= input.count) return out;
      const day = toLocalDateTime(new Date(start), input.zone).date;
      if ((taken.get(day) ?? 0) >= perDay) break; // this range's day is full: the next range
      if (start < notBefore || overlapsBusy(start, start + duration, input.busy)) continue;
      taken.set(day, (taken.get(day) ?? 0) + 1);
      out.push({ start: new Date(start).toISOString(), end: new Date(start + duration).toISOString() });
      notBefore = start + spread;
    }
  }
  return out.slice(0, input.count);
}

/** When the contact would like to meet (scheduling.ts readRange): some days, a part of the day, or both. */
export interface TimeRange {
  /** Local dates (YYYY-MM-DD); null: any day. */
  dates: string[] | null;
  /** morning: until 12:00; afternoon: from 12:00; null: the whole day. */
  part: 'morning' | 'afternoon' | null;
}

/** The intervals a range covers (its dates, or every day from fromMs to toMs), earliest first. */
export function rangeIntervals(range: TimeRange, zone: string, fromMs: number, toMs: number): Interval[] {
  const dates = range.dates ?? localDates(fromMs, toMs, zone);
  const out: Interval[] = [];
  for (const date of dates) {
    const start = Date.parse(zonedDateTimeToUtcIso(date, range.part === 'afternoon' ? '12:00' : '00:00', zone));
    const end = Date.parse(range.part === 'morning' ? zonedDateTimeToUtcIso(date, '12:00', zone) : zonedDateTimeToUtcIso(addDaysToLocalDate(date, 1), '00:00', zone));
    if (end > start) out.push({ start, end });
  }
  return out.sort((a, b) => a.start - b.start);
}

function intersect(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const x of a) {
    for (const y of b) {
      const start = Math.max(x.start, y.start);
      const end = Math.min(x.end, y.end);
      if (end > start) out.push({ start, end });
    }
  }
  return out.sort((p, q) => p.start - q.start);
}

/**
 * The times to offer. Without a range: the earliest free times (freeSlots). With one: the free
 * times inside it; when it has none, the free times nearest to it (`nearest`, which the email says).
 */
export function offerSlots(input: {
  busy: readonly Interval[];
  allowed: readonly Interval[];
  durationMinutes: number;
  zone: string;
  count: number;
  range: TimeRange | null;
  fromMs: number;
  toMs: number;
}): { slots: Slot[]; nearest: boolean } {
  const base = { busy: input.busy, durationMinutes: input.durationMinutes, zone: input.zone };
  const wanted = input.range ? rangeIntervals(input.range, input.zone, input.fromMs, input.toMs) : [];
  if (wanted.length === 0) return { slots: freeSlots({ ...base, allowed: input.allowed, count: input.count }), nearest: false };
  // one named day ("Tuesday works"): a choice of times that day
  const perDay = input.range?.dates?.length === 1 ? input.count : 1;
  const inside = freeSlots({ ...base, allowed: intersect(input.allowed, wanted), count: input.count, perDay });
  if (inside.length > 0) return { slots: inside, nearest: false };
  const first = wanted[0]!.start;
  const last = wanted[wanted.length - 1]!.end;
  const distance = (slot: Slot): number => {
    const start = Date.parse(slot.start);
    return start < first ? first - start : start > last ? start - last : 0;
  };
  const slots = freeSlots({ ...base, allowed: input.allowed, count: AVAILABILITY.horizonDays + 2 })
    .sort((a, b) => distance(a) - distance(b))
    .slice(0, input.count)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  return { slots, nearest: slots.length > 0 };
}

export type SlotFit = 'ok' | 'after_end' | 'outside_windows' | 'slot_busy';

/** Whether one time may be booked: inside the bounds and an allowed range, and free. */
export function fitSlot(slot: Slot, input: { busy: readonly Interval[]; allowed: readonly Interval[]; fromMs: number; endsAtMs: number }): SlotFit {
  const start = Date.parse(slot.start);
  const end = Date.parse(slot.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 'outside_windows';
  if (end > input.endsAtMs) return 'after_end';
  if (start < input.fromMs) return 'outside_windows';
  if (!input.allowed.some((r) => r.start <= start && r.end >= end)) return 'outside_windows';
  if (overlapsBusy(start, end, input.busy)) return 'slot_busy';
  return 'ok';
}

/** The owner's busy intervals in [fromMs, toMs), read through the assistant's bounded reader. */
export async function loadBusy(reader: MeetingReader, uid: string, fromMs: number, toMs: number, except: ReadonlySet<string> = new Set()): Promise<Interval[]> {
  if (toMs <= fromMs) return [];
  // a meeting that started up to a day earlier can still run into the range
  const fromIso = new Date(fromMs - DAY).toISOString();
  const toIso = new Date(toMs).toISOString();
  const [inRange, recurring] = await Promise.all([
    reader.listByStartRange(uid, fromIso, toIso, AVAILABILITY.queryLimit),
    reader.listRecurring ? reader.listRecurring(uid, AVAILABILITY.recurringLimit) : Promise.resolve([]),
  ]);
  // A3 feedback: moving the booked meeting leaves the meeting itself out (it is not in its own way)
  return busyIntervals([...inRange, ...recurring].filter((record) => !except.has(record.id)), fromMs, toMs);
}
