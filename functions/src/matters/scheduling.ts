/**
 * A3: which time a contact picked or proposed, read by CODE from their own words (docs/v1/
 * ARCHITECTURE.md section 36). Pure.
 *
 * The model only points: the words of the reply that say the time (time_words, which must be in
 * the email verbatim) and, when it was one of the offered times, its number (offered_choice). Code
 * then decides:
 * - a number that names an offered time is that time, unless the words name another day or clock
 *   time (then nothing: the owner decides);
 * - otherwise the words must give exactly ONE date (commitments/due.ts resolveDue, counted from the
 *   day the email arrived in the mandate's zone) and exactly ONE clock time (readClockTimes);
 *   "Tuesday or Wednesday", "next Friday" (two readings), "in the morning" or "at 10" (a bare
 *   number) give nothing;
 * - a time equal to an offered one is that offered slot; any other gets the mandate's duration.
 * Anything else is null, and the reply becomes a card (unclear_time). A time read here is still
 * checked against the mandate and the calendar (availability.ts fitSlot) before anything is booked.
 *
 * readRange reads WHEN the contact would like to meet, for the offer: "next week" or "this week"
 * (EN and ES), the dates resolveDue reads ("Tuesday", "Tuesday or Wednesday", "November 24"), and
 * mornings or afternoons. The offer keeps to it (availability.ts offerSlots). readRangeOf reads
 * the model's time words and the contact's whole sentence, so "Any afternoon next week?" keeps
 * the afternoon even when the time words are only "next week".
 */
import { readClockTimes, resolveDue, weekdayOf } from '../commitments/due';
import { addDaysToLocalDate, isLocalDate, todayInZone, toLocalDateTime, zonedDateTimeToUtcIso } from '../shared/time';
import type { TimeRange } from './availability';
import type { Slot } from './model';

const NEXT_WEEK = /\b(?:next week|la semana que viene|la proxima semana|la semana proxima)\b/;
const THIS_WEEK = /\b(?:this week|esta semana)\b/;
const MORNING = /\b(?:mornings?|por la manana|en la manana|por las mananas)\b/;
const AFTERNOON = /\b(?:afternoons?|por la tarde|en la tarde|por las tardes)\b/;

/** Lower case, accents folded ("mañana" -> "manana"). */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** When the contact would like to meet, from their own words; null when the words do not say. */
export function readRange(words: string | null, emailAt: string, zone: string): TimeRange | null {
  if (!words) return null;
  const text = fold(words);
  const day = todayInZone(zone, new Date(emailAt));
  const morning = MORNING.test(text);
  const afternoon = AFTERNOON.test(text);
  const part = morning && !afternoon ? 'morning' : afternoon && !morning ? 'afternoon' : null;
  let dates: string[] | null = null;
  if (NEXT_WEEK.test(text)) {
    const monday = addDaysToLocalDate(day, (8 - weekdayOf(day)) % 7 || 7);
    dates = Array.from({ length: 7 }, (_, i) => addDaysToLocalDate(monday, i));
  } else if (THIS_WEEK.test(text)) {
    const untilSunday = (7 - weekdayOf(day)) % 7;
    dates = Array.from({ length: untilSunday + 1 }, (_, i) => addDaysToLocalDate(day, i));
  } else {
    const reading = resolveDue(words, day);
    const found = [...new Set(reading.dates.filter(isLocalDate))].sort();
    if (reading.kind !== 'none' && found.length >= 1 && found.length <= 7) dates = found;
  }
  return dates || part ? { dates, part } : null;
}

/** readRange of several texts (the time words first, then the sentence): the first dates and the first part found. */
export function readRangeOf(texts: readonly (string | null)[], emailAt: string, zone: string): TimeRange | null {
  let dates: string[] | null = null;
  let part: TimeRange['part'] = null;
  for (const text of texts) {
    const range = readRange(text, emailAt, zone);
    dates = dates ?? range?.dates ?? null;
    part = part ?? range?.part ?? null;
  }
  return dates || part ? { dates, part } : null;
}

export function resolvePick(input: {
  /** The contact's words for the time, verbatim from the email; null when the model gave none. */
  words: string | null;
  /** The number of the offered time (1-based); null when none. */
  choice: number | null;
  offered: readonly Slot[];
  /** When the email arrived ("Tuesday" counts from that day). */
  emailAt: string;
  zone: string;
  durationMinutes: number;
}): Slot | null {
  const { words, offered, zone } = input;
  const day = todayInZone(zone, new Date(input.emailAt));
  const reading = words ? resolveDue(words, day) : null;
  const dates = reading ? reading.dates.filter(isLocalDate) : [];
  const times = words ? readClockTimes(words) : [];

  const choice = input.choice;
  if (choice !== null && Number.isInteger(choice) && choice >= 1 && choice <= offered.length) {
    const slot = offered[choice - 1]!;
    const local = toLocalDateTime(new Date(slot.start), zone);
    // the words may confirm the offered time, never contradict it
    if (dates.length > 1 || (dates.length === 1 && dates[0] !== local.date)) return null;
    if (times.length > 1 || (times.length === 1 && times[0] !== local.time)) return null;
    return slot;
  }
  if (dates.length !== 1 || times.length !== 1) return null;
  let startIso: string;
  try {
    startIso = zonedDateTimeToUtcIso(dates[0]!, times[0]!, zone);
  } catch {
    return null;
  }
  const start = Date.parse(startIso);
  const same = offered.find((slot) => Date.parse(slot.start) === start);
  if (same) return same;
  return { start: new Date(start).toISOString(), end: new Date(start + input.durationMinutes * 60_000).toISOString() };
}
