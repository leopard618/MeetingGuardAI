/**
 * Deadlines read by code, never by the model (docs/v2/M11-DESIGN.md decision 11, section 2.4
 * check 6, section 15 finding 6). PURE: no Firebase, no logging; the reference day comes from the
 * caller (the meeting's local date, see referenceDayOf), never from the clock.
 *
 * Shared by the M11 summaries (verify.ts, asWritten.ts, prompt.ts, the commitments handler) and the
 * assistant matters (functions/src/matters, A2): it imports only shared/textDates.ts,
 * shared/time.ts and ./text.ts, never functions/src/summaries. Deliberately NOT here: section
 * anchors and offsets, the summary parser's "(due: ...)" marker syntax (sections.ts DUE_PAREN_RE
 * and DUE_INLINE_RE), and the keyed ids and digests of ids.ts (built from summary ids and HMACs
 * under the summaries Keyring, shared/sealed.ts).
 *
 * resolveDue(dueQuote, referenceDay, language) reads the summary's own words for a deadline:
 * - an absolute date with a year (datesIn: "2026-11-21", "Nov 21, 2026", "21 de noviembre de
 *   2026"): those dates;
 * - a month and day without a year ("Nov 21", "21 de noviembre"): the first such date on or after
 *   the reference day minus 1 (so it crosses New Year);
 * - a numeric date without a month name ("10/11", "10/11/2026"): kept only when the D/M and M/D
 *   readings agree ("11/11") or only one of them is a real date ("25/11"); otherwise ambiguous and
 *   cleared, because an EN and an ES recap read it differently;
 * - relative EN and ES phrases, counted from the reference day: today, tomorrow (manana, but not
 *   "por la manana"), the day after tomorrow, a weekday ("by Friday" is the first Friday AFTER the
 *   reference day; "next Friday" may be that one or the one after), this week and end of the week
 *   (the Friday of the reference week), the weekend (that Friday to Sunday), next week (its Monday
 *   or its Friday), end of the month, in N days or weeks (en N dias o semanas);
 * - anything else: nothing (the date is cleared, never guessed).
 * The first of these kinds that finds anything decides. The language is accepted for M12 (more
 * languages); EN and ES are always both read, since recaps mix them.
 *
 * readClockTimes reads only clock forms ("15:20", "3 pm", "3:20 PM", "15h20"): a bare number
 * ("by 5") is no time.
 *
 * Product text rule: ASCII punctuation only in this file.
 */
import { datesIn, MONTHS } from '../shared/textDates';
import { addDaysToLocalDate, isLocalDate, isValidTimeZone, toLocalDateTime, zonedDateTimeToUtcIso } from '../shared/time';
import { collapseWhitespace, fold } from './text';

/** A due date must lie within the reference day minus 1 to plus 400 days. */
export const DUE_BOUNDS = { daysBefore: 1, daysAfter: 400 } as const;

/** Longest due quote read (the contract's quote cap). */
export const MAX_DUE_QUOTE_CHARS = 300;

export type DueReadingKind = 'none' | 'absolute' | 'month_day' | 'numeric' | 'relative' | 'ambiguous';

export interface DueReading {
  kind: DueReadingKind;
  /** The dates the words allow, ascending, deduplicated; empty for none and ambiguous. */
  dates: string[];
}

const NONE: DueReading = { kind: 'none', dates: [] };

// ---------------------------------------------------------------------------------------------
// Local date arithmetic (UTC calendar math on YYYY-MM-DD)
// ---------------------------------------------------------------------------------------------

function parts(date: string): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return [y, m, d];
}

/** 0 Sunday to 6 Saturday. */
export function weekdayOf(date: string): number {
  const [y, m, d] = parts(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function plusDays(date: string, days: number): string {
  return addDaysToLocalDate(date, days);
}

function isoOf(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const value = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return year >= 2000 && year <= 2099 && isLocalDate(value) ? value : null;
}

function lastDayOfMonth(date: string): string {
  const [y, m] = parts(date);
  const day = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return isoOf(y, m, day) ?? date;
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = parts(from);
  const [y2, m2, d2] = parts(to);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/** True when `date` lies within the reference day minus 1 to plus 400 days (DUE_BOUNDS). */
export function withinDueBounds(date: string, referenceDay: string): boolean {
  if (!isLocalDate(date) || !isLocalDate(referenceDay)) return false;
  const offset = daysBetween(referenceDay, date);
  return offset >= -DUE_BOUNDS.daysBefore && offset <= DUE_BOUNDS.daysAfter;
}

/** The first date for month/day on or after the reference day minus 1 (this year or the next). */
function yearless(month: number, day: number, referenceDay: string): string | null {
  const [year] = parts(referenceDay);
  const floor = plusDays(referenceDay, -1);
  for (const candidateYear of [year, year + 1, year + 2, year + 3, year + 4]) {
    const candidate = isoOf(candidateYear, month, day);
    if (candidate !== null && candidate >= floor) return candidate;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Month names, weekdays, numbers
// ---------------------------------------------------------------------------------------------

const MONTH_ALT = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join('|');

// On the folded text (lowercase, no accents). "Nov 21", "November 21st", "noviembre 21".
const MONTH_DAY_RE = new RegExp(`(?<![\\p{L}\\d])(${MONTH_ALT})\\.?[ \\t]+(\\d{1,2})(?:st|nd|rd|th)?(?![\\d:])`, 'gu');
// "21 Nov", "21 de noviembre", "21st of November".
const DAY_MONTH_RE = new RegExp(`(?<![\\d/.:-])(\\d{1,2})(?:st|nd|rd|th)?[ \\t]+(?:(?:de|of)[ \\t]+)?(${MONTH_ALT})(?![\\p{L}])\\.?`, 'gu');
// "10/11/2026", "10.11.26", "10-11-2026".
const NUMERIC_YEAR_RE = /(?<![\d/.-])(\d{1,2})([/.-])(\d{1,2})\2(\d{4}|\d{2})(?![\d/.-])/g;
// "10/11" (slash only: "10-11" reads as a range, "10.11" as a number).
const NUMERIC_RE = /(?<![\d/.-])(\d{1,2})\/(\d{1,2})(?![\d/])/g;

const WEEKDAYS_EN: Readonly<Record<string, number>> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tues: 2, tue: 2, wednesday: 3, wed: 3,
  thursday: 4, thurs: 4, thur: 4, thu: 4, friday: 5, fri: 5, saturday: 6, sat: 6,
};
const WEEKDAYS_ES: Readonly<Record<string, number>> = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6,
};
const WEEKDAY_NUMBER: Readonly<Record<string, number>> = { ...WEEKDAYS_EN, ...WEEKDAYS_ES };
const WEEKDAY_ALT = Object.keys(WEEKDAY_NUMBER)
  .sort((a, b) => b.length - a.length)
  .join('|');

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
};
const NUMBER_ALT = Object.keys(NUMBER_WORDS)
  .sort((a, b) => b.length - a.length)
  .join('|');

function countOf(token: string): number | null {
  if (/^\d{1,3}$/.test(token)) return Number(token);
  return NUMBER_WORDS[token] ?? null;
}

// ---------------------------------------------------------------------------------------------
// Relative phrases
// ---------------------------------------------------------------------------------------------

/** The first `weekday` strictly after the reference day ("by Friday" on a Friday is next week's). */
function firstAfter(referenceDay: string, weekday: number): string {
  const delta = (weekday - weekdayOf(referenceDay) + 7) % 7 || 7;
  return plusDays(referenceDay, delta);
}

/** The Friday of the reference week (the day itself on a Friday; the next one on a weekend). */
function endOfWeek(referenceDay: string): string {
  return plusDays(referenceDay, (5 - weekdayOf(referenceDay) + 7) % 7);
}

/** The coming weekend: its Friday, Saturday and Sunday. */
function weekend(referenceDay: string): string[] {
  const saturday = plusDays(referenceDay, (6 - weekdayOf(referenceDay) + 7) % 7);
  return [plusDays(saturday, -1), saturday, plusDays(saturday, 1)];
}

/** The Monday and the Friday of the next calendar week (Monday first). */
function nextWeek(referenceDay: string): string[] {
  const monday = firstAfter(referenceDay, 1);
  return [monday, plusDays(monday, 4)];
}

type Resolver = (referenceDay: string, match: RegExpExecArray) => string[] | null;

interface Phrase {
  re: RegExp;
  resolve: Resolver;
}

const W = '(?<![\\p{L}\\p{N}])';
const E = '(?![\\p{L}\\p{N}])';

function phrase(pattern: string, resolve: Resolver): Phrase {
  return { re: new RegExp(`${W}(?:${pattern})${E}`, 'gu'), resolve };
}

function weekdayFrom(token: string | undefined): number | null {
  if (token === undefined) return null;
  const weekday = WEEKDAY_NUMBER[token];
  return weekday === undefined ? null : weekday;
}

/**
 * Ordered: longer and more specific phrases first. Each match is blanked out of the working text,
 * so "next Friday" is never read again as "Friday", nor "pasado manana" as "manana".
 */
const PHRASES: readonly Phrase[] = [
  // The day after tomorrow.
  phrase('the day after tomorrow|day after tomorrow|pasado manana', (r) => [plusDays(r, 2)]),
  // Next <weekday>: that one or the one after.
  phrase(`next[ \\t]+(${WEEKDAY_ALT})`, (r, m) => {
    const weekday = weekdayFrom(m[1]);
    return weekday === null ? null : [firstAfter(r, weekday), plusDays(firstAfter(r, weekday), 7)];
  }),
  phrase(`(?:el[ \\t]+)?(?:proximo|proxima)[ \\t]+(${WEEKDAY_ALT})`, (r, m) => {
    const weekday = weekdayFrom(m[1]);
    return weekday === null ? null : [firstAfter(r, weekday), plusDays(firstAfter(r, weekday), 7)];
  }),
  phrase(`(?:el[ \\t]+)?(${WEEKDAY_ALT})[ \\t]+(?:que[ \\t]+viene|proximo)`, (r, m) => {
    const weekday = weekdayFrom(m[1]);
    return weekday === null ? null : [firstAfter(r, weekday), plusDays(firstAfter(r, weekday), 7)];
  }),
  // In N days or weeks.
  phrase(`(?:in|within|en|dentro[ \\t]+de)[ \\t]+(\\d{1,3}|${NUMBER_ALT})[ \\t]+(days?|weeks?|dias?|semanas?)`, (r, m) => {
    const count = countOf(m[1] ?? '');
    if (count === null) return null;
    const weeks = /^(?:week|semana)/.test(m[2] ?? '');
    const days = weeks ? count * 7 : count;
    return days > DUE_BOUNDS.daysAfter ? null : [plusDays(r, days)];
  }),
  // End of the month.
  phrase('end[ \\t]+of[ \\t]+(?:the[ \\t]+|this[ \\t]+)?month|eom|month[ \\t-]end|(?:fin|final|finales)[ \\t]+(?:de|del)[ \\t]+mes', (r) => [lastDayOfMonth(r)]),
  // End of the week: its Friday ("fin de la semana"; "fin de semana" alone is the weekend, below).
  phrase('end[ \\t]+of[ \\t]+(?:the[ \\t]+|this[ \\t]+)?week|eow|this[ \\t]+week|(?:fin|final|finales)[ \\t]+de[ \\t]+la[ \\t]+semana|esta[ \\t]+semana', (r) => [endOfWeek(r)]),
  phrase('(?:this[ \\t]+|the[ \\t]+)?weekend|(?:el[ \\t]+)?(?:fin|finales)[ \\t]+de[ \\t]+semana|(?:el[ \\t]+)?finde', (r) => weekend(r)),
  // Next week: its Monday or its Friday.
  phrase('next[ \\t]+week|(?:la[ \\t]+)?(?:proxima[ \\t]+semana|semana[ \\t]+proxima|semana[ \\t]+que[ \\t]+viene)', (r) => nextWeek(r)),
  // Today.
  phrase('today|tonight|end[ \\t]+of[ \\t]+(?:the[ \\t]+)?day|eod|cob|close[ \\t]+of[ \\t]+business|hoy|esta[ \\t]+noche|(?:al[ \\t]+)?(?:fin|final)[ \\t]+del[ \\t]+dia', (r) => [r]),
  // Tomorrow (EN). The Spanish "manana" is handled below: "por la manana" is the morning.
  phrase('tomorrow', (r) => [plusDays(r, 1)]),
  // A weekday on its own ("by Friday", "el viernes"): the first one after the reference day.
  phrase(`(${WEEKDAY_ALT})`, (r, m) => {
    const weekday = weekdayFrom(m[1]);
    return weekday === null ? null : [firstAfter(r, weekday)];
  }),
];

/** "manana" is tomorrow unless it is the morning: "la manana", "esta manana", "las mananas". */
const MANANA_RE = /(?<![\p{L}\p{N}])(la|las|esta|una|cada)?([ \t]+)?mananas?(?![\p{L}\p{N}])/gu;

function blank(text: string, index: number, length: number): string {
  return text.slice(0, index) + ' '.repeat(length) + text.slice(index + length);
}

function readRelative(folded: string, referenceDay: string): string[] {
  let work = folded;
  const out: string[] = [];
  for (const { re, resolve } of PHRASES) {
    re.lastIndex = 0;
    const found: RegExpExecArray[] = [];
    for (let m = re.exec(work); m !== null; m = re.exec(work)) {
      found.push(m);
      if (m[0].length === 0) re.lastIndex += 1;
    }
    for (const m of found) {
      const dates = resolve(referenceDay, m);
      if (dates !== null) out.push(...dates);
      work = blank(work, m.index, m[0].length);
    }
  }
  for (const m of work.matchAll(MANANA_RE)) {
    const article = m[1];
    if (article === undefined && !m[0].trimStart().startsWith('mananas')) out.push(plusDays(referenceDay, 1));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// resolveDue
// ---------------------------------------------------------------------------------------------

function sortedUnique(dates: readonly string[]): string[] {
  return [...new Set(dates)].sort();
}

function twoDigitYear(token: string): number {
  return token.length === 2 ? 2000 + Number(token) : Number(token);
}

/**
 * Reads a due quote (see the module comment). `referenceDay` is YYYY-MM-DD; an invalid one, or a
 * quote that is empty or longer than MAX_DUE_QUOTE_CHARS, reads as nothing.
 */
export function resolveDue(dueQuote: string | null | undefined, referenceDay: string, language?: string | null): DueReading {
  void language;
  if (typeof dueQuote !== 'string' || !isLocalDate(referenceDay)) return NONE;
  const quote = collapseWhitespace(dueQuote.normalize('NFKC'));
  if (quote.length === 0 || quote.length > MAX_DUE_QUOTE_CHARS) return NONE;

  const absolute = datesIn(quote);
  if (absolute.size > 0) return { kind: 'absolute', dates: sortedUnique([...absolute]) };

  const folded = fold(quote);
  const monthDay: string[] = [];
  for (const m of folded.matchAll(MONTH_DAY_RE)) {
    const date = yearless(MONTHS[m[1] ?? ''] ?? 0, Number(m[2]), referenceDay);
    if (date !== null) monthDay.push(date);
  }
  for (const m of folded.matchAll(DAY_MONTH_RE)) {
    const date = yearless(MONTHS[m[2] ?? ''] ?? 0, Number(m[1]), referenceDay);
    if (date !== null) monthDay.push(date);
  }
  if (monthDay.length > 0) return { kind: 'month_day', dates: sortedUnique(monthDay) };

  const numeric: string[] = [];
  let ambiguous = false;
  const take = (readings: readonly (string | null)[]): void => {
    const valid = sortedUnique(readings.filter((date): date is string => date !== null));
    if (valid.length === 1 && valid[0] !== undefined) numeric.push(valid[0]);
    else if (valid.length > 1) ambiguous = true;
  };
  for (const m of folded.matchAll(NUMERIC_YEAR_RE)) {
    const a = Number(m[1]);
    const b = Number(m[3]);
    const year = twoDigitYear(m[4] ?? '');
    take([isoOf(year, b, a), isoOf(year, a, b)]);
  }
  for (const m of folded.matchAll(NUMERIC_RE)) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    take([a >= 1 && a <= 31 && b >= 1 && b <= 12 ? yearless(b, a, referenceDay) : null, a >= 1 && a <= 12 && b >= 1 && b <= 31 ? yearless(a, b, referenceDay) : null]);
  }
  if (ambiguous) return { kind: 'ambiguous', dates: [] };
  if (numeric.length > 0) return { kind: 'numeric', dates: sortedUnique(numeric) };

  const relative = readRelative(folded, referenceDay);
  if (relative.length > 0) return { kind: 'relative', dates: sortedUnique(relative) };
  return NONE;
}

// ---------------------------------------------------------------------------------------------
// Clock times
// ---------------------------------------------------------------------------------------------

// "15:20", "3:20 PM", "3:20 p.m."
const CLOCK_COLON_RE = /(?<![\d:])([01]?\d|2[0-3]):([0-5]\d)(?![\d:])(?:[ \t]*([ap])\.?[ \t]*m(?![\p{L}])\.?)?/giu;
// "3 pm", "3pm", "11 a.m."
const CLOCK_MERIDIEM_RE = /(?<![\d:.])(1[0-2]|0?[1-9])[ \t]*([ap])\.?[ \t]*m(?![\p{L}])\.?/giu;
// "15h20"
const CLOCK_H_RE = /(?<![\d:])([01]?\d|2[0-3])h([0-5]\d)(?!\d)/giu;

function hhmm(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function withMeridiem(hour: number, meridiem: string | undefined): number | null {
  if (meridiem === undefined) return hour;
  if (hour < 1 || hour > 12) return null;
  if (meridiem.toLowerCase() === 'a') return hour === 12 ? 0 : hour;
  return hour === 12 ? 12 : hour + 12;
}

/** The clock times written in `value` as HH:MM (24 h), in order, deduplicated. A bare number is no time. */
export function readClockTimes(value: string | null | undefined): string[] {
  if (typeof value !== 'string' || value.length === 0) return [];
  const text = value.normalize('NFKC');
  const found: { at: number; time: string }[] = [];
  for (const m of text.matchAll(CLOCK_COLON_RE)) {
    const hour = withMeridiem(Number(m[1]), m[3]);
    if (hour !== null) found.push({ at: m.index ?? 0, time: hhmm(hour, Number(m[2])) });
  }
  for (const m of text.matchAll(CLOCK_MERIDIEM_RE)) {
    const hour = withMeridiem(Number(m[1]), m[2]);
    if (hour !== null) found.push({ at: m.index ?? 0, time: hhmm(hour, 0) });
  }
  for (const m of text.matchAll(CLOCK_H_RE)) {
    found.push({ at: m.index ?? 0, time: hhmm(Number(m[1]), Number(m[2])) });
  }
  return [...new Set(found.sort((a, b) => a.at - b.at).map((entry) => entry.time))];
}

// ---------------------------------------------------------------------------------------------
// The reference day (section 2.2)
// ---------------------------------------------------------------------------------------------

export type ReferenceSource = 'meeting' | 'summary_date' | 'anchor' | 'received';

export interface ReferenceDay {
  /** YYYY-MM-DD: what "by Friday" is counted from. */
  day: string;
  /** The zone the day was read in. */
  zone: string;
  /** The reference instant (ISO): for the model's date table. */
  instant: string;
  source: ReferenceSource;
}

export interface ReferenceInput {
  /** The matched meeting as filed (its start is the occurrence's for a series); null when kept. */
  meetingSnapshot: { startAt: string; timezone: string } | null;
  summaryDate: string | null;
  anchorAt: string | null;
  receivedAt: string;
  /** users/{uid}/settings/preferences.timezone when set and valid, else null. */
  preferencesTimeZone: string | null;
}

function validZone(zone: string | null | undefined): zone is string {
  return typeof zone === 'string' && zone.length > 0 && isValidTimeZone(zone);
}

function instantMs(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * The reference day, first available: the meeting's start in the meeting's zone; the summary's
 * date (at 12:00 in the preferences zone); the anchor (the signed Date or the forward's Date) and
 * last the receipt time, both in the preferences zone. A zone Intl does not know falls back to the
 * preferences zone, then UTC. So "by Friday" counts from the meeting, never from the day the user
 * opens the review.
 */
export function referenceDayOf(input: ReferenceInput): ReferenceDay {
  const fallbackZone = validZone(input.preferencesTimeZone) ? input.preferencesTimeZone : 'UTC';
  const snapshot = input.meetingSnapshot;
  const startMs = instantMs(snapshot?.startAt);
  if (snapshot !== null && startMs !== null) {
    const zone = validZone(snapshot.timezone) ? snapshot.timezone : fallbackZone;
    return { day: toLocalDateTime(startMs, zone).date, zone, instant: new Date(startMs).toISOString(), source: 'meeting' };
  }
  if (input.summaryDate !== null && isLocalDate(input.summaryDate)) {
    return { day: input.summaryDate, zone: fallbackZone, instant: zonedNoon(input.summaryDate, fallbackZone), source: 'summary_date' };
  }
  const anchorMs = instantMs(input.anchorAt);
  if (anchorMs !== null) {
    return { day: toLocalDateTime(anchorMs, fallbackZone).date, zone: fallbackZone, instant: new Date(anchorMs).toISOString(), source: 'anchor' };
  }
  const receivedMs = instantMs(input.receivedAt) ?? 0;
  return { day: toLocalDateTime(receivedMs, fallbackZone).date, zone: fallbackZone, instant: new Date(receivedMs).toISOString(), source: 'received' };
}

/** 12:00 local: never inside a DST gap, and the same local date in every zone. */
function zonedNoon(date: string, zone: string): string {
  return zonedDateTimeToUtcIso(date, '12:00', zone);
}

/** True when a local due date has passed: before today's local date in `zone` (UTC when null or unknown). */
export function isOverdue(dueDate: string, zone: string | null, now: Date): boolean {
  if (!isLocalDate(dueDate)) return false;
  const today = toLocalDateTime(now, validZone(zone) ? zone : 'UTC').date;
  return dueDate < today;
}
