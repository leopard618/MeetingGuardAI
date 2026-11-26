/**
 * Follow-up timing and the end date (A2; docs/v1/ARCHITECTURE.md section 36). Pure: matterTick
 * (replies.ts) applies it.
 *
 * - A follow-up is due everyDays after our last email that went out (lastOutboundAt), while no
 *   contact has answered since (lastInboundAt; an automatic reply never counts), fewer than
 *   maxCount follow-ups went out, and the end date has not passed.
 * - It goes out only in working hours in the mandate's zone: the owner's working hours and days
 *   (A5 settings; Monday to Friday, 9:00 to 18:00 by default), so never on a quiet day. Outside
 *   them it waits for the next working morning, computed in the zone, so a daylight saving change
 *   never moves it an hour.
 * - matterSchedule/{matterId}.nextActionAt is the next instant matterTick looks at the matter: the
 *   next follow-up, else the end date (to close the matter then).
 * - A3: no follow-up once the meeting is booked; after a resume the interval counts from the
 *   resume (resumedAt), so a matter paused for a week does not chase the moment it resumes.
 */
import { addDaysToLocalDate, getZonedParts, toLocalDateTime, zonedDateTimeToUtcIso } from '../shared/time';
import type { MatterDoc } from './model';

const DAY_MS = 86_400_000;

export const WORKING_HOURS = { startHour: 9, endHour: 18, days: [1, 2, 3, 4, 5] } as const;

/** A5: the owner's working hours ("HH:MM") and days (0 Sunday to 6 Saturday) for offering times. */
export interface WorkingHours {
  start: string;
  end: string;
  days: readonly number[];
}
export const DEFAULT_WORKING_HOURS: WorkingHours = { start: '09:00', end: '18:00', days: WORKING_HOURS.days };

const minutesOf = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Whether `now` is inside working hours in `zone` (A5: the owner's hours and days). */
export function inWorkingHours(now: Date, zone: string, hours: WorkingHours = DEFAULT_WORKING_HOURS): boolean {
  const parts = getZonedParts(now, zone);
  const minute = parts.hour * 60 + parts.minute;
  return hours.days.includes(parts.weekday) && minute >= minutesOf(hours.start) && minute < minutesOf(hours.end);
}

/** `now` when it is inside working hours, else the start of the next working day in `zone`. */
export function nextWorkingSlot(now: Date, zone: string, hours: WorkingHours = DEFAULT_WORKING_HOURS): Date {
  if (inWorkingHours(now, zone, hours)) return now;
  const parts = getZonedParts(now, zone);
  let date = toLocalDateTime(now, zone).date;
  // before the start on a working day: that morning
  const startToday = hours.days.includes(parts.weekday) && parts.hour * 60 + parts.minute < minutesOf(hours.start);
  if (!startToday) date = addDaysToLocalDate(date, 1);
  for (let i = 0; i < 8; i += 1) {
    const morning = new Date(zonedDateTimeToUtcIso(date, hours.start, zone));
    if (hours.days.includes(getZonedParts(morning, zone).weekday)) return morning;
    date = addDaysToLocalDate(date, 1);
  }
  return now;
}

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : null;
};

/** A contact answered after our last email: no follow-up until we write again. */
export function answeredSinceLastEmail(matter: Pick<MatterDoc, 'lastInboundAt' | 'lastOutboundAt'>): boolean {
  const inbound = ms(matter.lastInboundAt);
  const outbound = ms(matter.lastOutboundAt);
  return inbound !== null && (outbound === null || inbound >= outbound);
}

/** When the next follow-up is due (ignoring working hours), or null when none will be. */
export function followUpDueAt(matter: MatterDoc): number | null {
  const mandate = matter.mandate;
  if (!mandate || !matter.firstSentAt) return null;
  if (matter.followUpsSent >= mandate.followUp.maxCount) return null;
  // A3: once the meeting is booked the assistant stops chasing (the confirmation is our last email)
  if (matter.booking) return null;
  if (answeredSinceLastEmail(matter)) return null;
  const sent = ms(matter.lastOutboundAt) ?? ms(matter.firstSentAt);
  if (sent === null) return null;
  // A3: a resumed matter counts the interval from the resume, never chases at once
  const resumed = ms(matter.resumedAt);
  const last = resumed !== null && resumed > sent ? resumed : sent;
  const due = last + mandate.followUp.everyDays * DAY_MS;
  const end = Date.parse(mandate.endsAt);
  return due < end ? due : null;
}

/** matterSchedule's nextActionAt for a matter as it stands: the next follow-up, else its end date. */
export function nextActionAt(matter: MatterDoc): string | null {
  if (matter.status !== 'active' || !matter.mandate) return null;
  const due = followUpDueAt(matter);
  return new Date(due ?? Date.parse(matter.mandate.endsAt)).toISOString();
}
