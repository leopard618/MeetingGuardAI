/**
 * Calendar dates written in text, English and Spanish (moved from summaries/sections.ts; the M10
 * summaryDate rules of docs/v2/M10-DESIGN.md section 6). PURE: no imports, no Firebase, no
 * logging, no clock.
 *
 * Shared by the M10 and M11 summaries (summaries/sections.ts, commitments/due.ts, verify.ts and
 * asWritten.ts) and the assistant matters (functions/src/matters, A2). Not a contract pair: there
 * is no src/core copy and check:contract does not read it. Deliberately NOT here: the year-less
 * and numeric forms that only tell a date label from a heading (sections.ts isDateOnly), section
 * anchors and offsets, and anything keyed (the ids and digests of commitments/ids.ts, HMACs under
 * the summaries Keyring of shared/sealed.ts).
 *
 * Only dates with a year are read: ISO ("2026-10-16", "2026/10/16"), month first ("Oct 16, 2026",
 * "Friday, October 16th, 2026") and day first ("16 Oct 2026", "16 de octubre de 2026"), each kept
 * only when it is a real calendar date in 2000 to 2099. The regexes are global and used only with
 * matchAll and replace, which never leave lastIndex behind.
 *
 * Product text rule: ASCII punctuation only in this file.
 */

/** English and Spanish month names, lowercase, no accents; M10 sections and M11 resolveDue read them. */
export const MONTHS: Readonly<Record<string, number>> = {
  january: 1, jan: 1, enero: 1, ene: 1,
  february: 2, feb: 2, febrero: 2,
  march: 3, mar: 3, marzo: 3,
  april: 4, apr: 4, abril: 4, abr: 4,
  may: 5, mayo: 5,
  june: 6, jun: 6, junio: 6,
  july: 7, jul: 7, julio: 7,
  august: 8, aug: 8, agosto: 8, ago: 8,
  september: 9, sept: 9, sep: 9, septiembre: 9, setiembre: 9, set: 9,
  october: 10, oct: 10, octubre: 10,
  november: 11, nov: 11, noviembre: 11,
  december: 12, dec: 12, diciembre: 12, dic: 12,
};
const MONTH_ALT = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join('|');

// 2026-10-16 or 2026/10/16.
const ISO_DATE_RE = /(?<!\d)(\d{4})([-/])(\d{2})\2(\d{2})(?!\d)/g;
// Oct 16, 2026 / October 16th, 2026 / Friday, October 16, 2026.
const MONTH_FIRST_RE = new RegExp(`\\b(${MONTH_ALT})\\.?[ \\t]+(\\d{1,2})(?:st|nd|rd|th)?,?[ \\t]+(\\d{4})(?!\\d)`, 'gi');
// 16 Oct 2026 / 16 October 2026 / 16 de octubre de 2026 / vie, 16 oct. 2026.
const DAY_FIRST_RE = new RegExp(
  `(?<!\\d)(\\d{1,2})(?:st|nd|rd|th)?[ \\t]+(?:de[ \\t]+)?(${MONTH_ALT})\\.?,?[ \\t]+(?:del?[ \\t]+)?(\\d{4})(?!\\d)`,
  'gi',
);

function isoDate(year: number, month: number, day: number): string | null {
  if (year < 2000 || year > 2099 || month < 1 || month > 12 || day < 1) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Every valid calendar date written in `s` in a supported format, as YYYY-MM-DD. */
export function datesIn(s: string): Set<string> {
  const out = new Set<string>();
  const add = (d: string | null) => {
    if (d) out.add(d);
  };
  for (const m of s.matchAll(ISO_DATE_RE)) add(isoDate(Number(m[1]), Number(m[3]), Number(m[4])));
  for (const m of s.matchAll(MONTH_FIRST_RE)) add(isoDate(Number(m[3]), MONTHS[(m[1] ?? '').toLowerCase()] ?? 0, Number(m[2])));
  for (const m of s.matchAll(DAY_FIRST_RE)) add(isoDate(Number(m[3]), MONTHS[(m[2] ?? '').toLowerCase()] ?? 0, Number(m[1])));
  return out;
}

/** `s` with every ISO, month-first and day-first date form replaced by a space, valid or not (sections.ts). */
export function stripDates(s: string): string {
  return s.replace(ISO_DATE_RE, ' ').replace(MONTH_FIRST_RE, ' ').replace(DAY_FIRST_RE, ' ');
}
