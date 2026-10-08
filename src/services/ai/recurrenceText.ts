/**
 * PURE recurrence-to-words helpers (unit-tested; no React / RN imports). Shared by the assistant
 * confirmation cards and the meeting screens, so a rule always reads the same everywhere:
 * "Repeats weekly on Monday, until Dec 31" / "Se repite cada semana los lunes, hasta el 31 dic".
 * All user-visible text comes from the "ai:recurrence.*" keys through the injected translator.
 */
import type { RecurrenceRule, RecurrenceWeekday } from '../../core/aiContract';
import type { TranslateFn } from '../../core/contracts';
import { weekdayOfLocalDate } from '../../core/recurrence';
import { isLocalDate, toLocalDateTime } from '../../core/time';

export interface RecurrenceTextOptions {
  /** Formats a local date "YYYY-MM-DD" for display (locale-aware; the caller's formatter). */
  formatDate(localDate: string): string;
  /**
   * The series' anchor date (Meeting.date / the draft's date): fills the default weekday of a
   * weekly rule and the default day of a monthly rule. Null when unknown (the defaults are then
   * left out of the text instead of guessed).
   */
  anchorDate?: string | null;
  /** Meeting time zone; the `until` instant is shown as its local calendar day there. */
  timezone?: string | null;
}

/** Local calendar day (in `timezone`) of the rule's inclusive `until` instant. */
export function untilLocalDate(untilIso: string, timezone: string | null | undefined): string {
  try {
    return toLocalDateTime(untilIso, timezone && timezone.length > 0 ? timezone : 'UTC').date;
  } catch {
    return untilIso.slice(0, 10);
  }
}

function weekdayNames(t: TranslateFn, rule: RecurrenceRule, anchorDate: string | null | undefined): string | null {
  let codes: readonly RecurrenceWeekday[] | null = rule.byWeekday;
  if ((codes === null || codes.length === 0) && anchorDate && isLocalDate(anchorDate)) {
    codes = [weekdayOfLocalDate(anchorDate)];
  }
  if (!codes || codes.length === 0) return null;
  return codes.map((code) => t(`ai:recurrence.weekday.${code}`)).join(', ');
}

function monthDayOf(rule: RecurrenceRule, anchorDate: string | null | undefined): number | null {
  if (rule.byMonthDay !== null) return rule.byMonthDay;
  if (anchorDate && isLocalDate(anchorDate)) return Number(anchorDate.slice(8, 10));
  return null;
}

/**
 * One sentence describing the rule ("Repeats every 2 weeks on Monday, Wednesday, until <date>").
 * Deterministic; safe for a null rule ("Does not repeat").
 */
export function recurrenceSummary(t: TranslateFn, rule: RecurrenceRule | null, options: RecurrenceTextOptions): string {
  if (rule === null) return t('ai:recurrence.none');
  let text = t(`ai:recurrence.${rule.freq}`, { count: rule.interval });
  if (rule.freq === 'weekly') {
    const days = weekdayNames(t, rule, options.anchorDate);
    if (days !== null) text = t('ai:recurrence.onWeekdays', { rule: text, days });
  }
  if (rule.freq === 'monthly') {
    const day = monthDayOf(rule, options.anchorDate);
    if (day !== null) text = t('ai:recurrence.onMonthDay', { rule: text, day });
  }
  if (rule.until !== null) {
    const date = options.formatDate(untilLocalDate(rule.until, options.timezone));
    return t('ai:recurrence.untilDate', { rule: text, date });
  }
  if (rule.count !== null) {
    return t('ai:recurrence.forTimes', { rule: text, count: rule.count });
  }
  return text;
}

/**
 * What a scoped update/delete applies to: "Only the occurrence on <date>" or "The whole repeating
 * series". Null when the scope line adds nothing (a one-off meeting without a scope).
 */
export function recurrenceScopeText(
  t: TranslateFn,
  input: {
    scope: 'occurrence' | 'series' | 'following' | undefined;
    occurrenceDate: string | null | undefined;
    /** Whether the targeted meeting is known to repeat (shows "whole series" even without a scope). */
    targetRecurring: boolean;
    formatDate(localDate: string): string;
  },
): string | null {
  if (input.scope === 'occurrence' && input.occurrenceDate && isLocalDate(input.occurrenceDate)) {
    return t('ai:recurrence.scopeOccurrence', { date: input.formatDate(input.occurrenceDate) });
  }
  if (input.scope === 'following' && input.occurrenceDate && isLocalDate(input.occurrenceDate)) {
    return t('ai:recurrence.scopeFollowing', { date: input.formatDate(input.occurrenceDate) });
  }
  if (input.scope === 'series' || (input.scope === undefined && input.targetRecurring)) {
    return t('ai:recurrence.scopeSeries');
  }
  return null;
}
