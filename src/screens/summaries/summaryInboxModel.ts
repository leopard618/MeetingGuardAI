/**
 * Pure view model of the summary inbox (route "SummaryInbox"; docs/v2/M10-DESIGN.md section 9):
 * which view to show for the status and list answers, what each "Waiting for a meeting" card
 * carries (title, dates, origin chip, reason, up to 3 one-tap suggestions, never on
 * not_addressed_to_you cards), the "Filed recently" rows and the "Refused" rows (one per day with
 * a count). No React, no Firebase: unit tests import it directly. Nothing here logs anything.
 */
import {
  SUMMARY_LIMITS,
  type SummaryListItem,
  type SummaryRefusedReason,
  type SummaryStatusResponse,
  type SummarySuggestion,
} from '../../core/aiContract';
import type { AppError } from '../../core/errors';
import { isLocalDate } from '../../core/time';
import type { AttachSummaryRequest } from '../../services/summaries/summariesService';
import { isSummariesAvailable, isSummariesUnavailableError } from '../../services/summaries/summaryCore';

import type { AttachMeetingTarget } from './attachMeetingModel';
import { inboxReasonKey, summaryChipKey } from './summaryText';

// ---- Which view ----------------------------------------------------------------------------------

export type SummaryInboxView = 'loading' | 'unavailable' | 'error' | 'empty' | 'content';

/** The slice of a useSummaryList answer the view decision needs. */
export interface InboxListState {
  items: readonly SummaryListItem[] | null;
  error: AppError | null;
}

export interface InboxViewInput {
  status: SummaryStatusResponse | null;
  statusError: AppError | null;
  waiting: InboxListState;
  recent: InboxListState;
}

export interface InboxViewResult {
  view: SummaryInboxView;
  /** The error the 'error' view explains (null for every other view). */
  error: AppError | null;
}

/**
 * - unavailable: the feature is off or the caller is not in the pilot (status, or a not_enabled /
 *   not_allowed answer from any call: a missing summaryRead reaches the app as not_enabled);
 * - loading: the status or the inbox list (or, with an empty inbox, the recent list) is unknown;
 * - error: the status or the inbox list failed with nothing to show;
 * - empty: nothing waiting and nothing filed (the Refused section still shows below);
 * - content: everything else (a failed recent list shows its own inline retry).
 */
export function inboxView(input: InboxViewInput): InboxViewResult {
  const { status, statusError, waiting, recent } = input;
  if ([statusError, waiting.error, recent.error].some((error) => isSummariesUnavailableError(error))) {
    return { view: 'unavailable', error: null };
  }
  if (status === null) return statusError !== null ? { view: 'error', error: statusError } : { view: 'loading', error: null };
  if (!isSummariesAvailable(status)) return { view: 'unavailable', error: null };
  if (waiting.items === null) return waiting.error !== null ? { view: 'error', error: waiting.error } : { view: 'loading', error: null };
  if (waiting.items.length === 0) {
    if (recent.items === null) return recent.error !== null ? { view: 'content', error: null } : { view: 'loading', error: null };
    if (recent.items.length === 0) return { view: 'empty', error: null };
  }
  return { view: 'content', error: null };
}

// ---- Waiting cards ------------------------------------------------------------------------------

export interface InboxCardModel {
  summaryId: string;
  /** The summary's title; null shows summaries:common.untitled. */
  title: string | null;
  /** The date written in the summary (YYYY-MM-DD), or null (summaries:common.noSummaryDate). */
  summaryDate: string | null;
  receivedAt: string;
  /** The origin chip (summaries:common.chip.*), or null when the row carries no tier. */
  chipKey: string | null;
  /** Why it waits (summaries:common.inboxReason.*), or null. */
  reasonKey: string | null;
  /** One-tap "File under ..." meetings, best first, at most SUMMARY_LIMITS.maxSuggestions. */
  suggestions: readonly SummarySuggestion[];
  /** not_addressed_to_you: never one-tap filing (red team finding 7); the card says why. */
  showNoSuggestionsNote: boolean;
}

/** The one-tap suggestions a card may show: none on not_addressed_to_you, at most 3, no repeats. */
export function fileUnderSuggestions(item: Pick<SummaryListItem, 'inboxReason' | 'suggestions'>): SummarySuggestion[] {
  if (item.inboxReason === 'not_addressed_to_you') return [];
  const seen = new Set<string>();
  const out: SummarySuggestion[] = [];
  for (const suggestion of item.suggestions) {
    const key = suggestionKey(suggestion);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(suggestion);
    if (out.length >= SUMMARY_LIMITS.maxSuggestions) break;
  }
  return out;
}

export function inboxCardModel(item: SummaryListItem): InboxCardModel {
  return {
    summaryId: item.summaryId,
    title: item.title !== null && item.title.trim() !== '' ? item.title : null,
    summaryDate: item.summaryDate,
    receivedAt: item.receivedAt,
    chipKey: item.tier !== null ? summaryChipKey(item.tier) : null,
    reasonKey: item.inboxReason !== null ? inboxReasonKey(item.inboxReason) : null,
    suggestions: fileUnderSuggestions(item),
    showNoSuggestionsNote: item.inboxReason === 'not_addressed_to_you',
  };
}

/** A stable key for a suggestion (a series can be suggested on two days with the same id). */
export function suggestionKey(suggestion: Pick<SummarySuggestion, 'meetingId' | 'occurrenceDate'>): string {
  return `${suggestion.meetingId}|${suggestion.occurrenceDate ?? ''}`;
}

/** summaryAction attach for a one-tap suggestion (the master id and the ORIGINAL date for a series). */
export function attachRequestForSuggestion(summaryId: string, suggestion: SummarySuggestion): AttachSummaryRequest {
  return { summaryId, meetingId: suggestion.meetingId, occurrenceDate: suggestion.occurrenceDate };
}

/** "Choose a meeting" on an inbox card opens the sheet in 'file' mode. */
export function attachTargetForItem(item: Pick<SummaryListItem, 'summaryId' | 'summaryDate' | 'receivedAt'>): AttachMeetingTarget {
  return { summaryId: item.summaryId, summaryDate: item.summaryDate, receivedAt: item.receivedAt, mode: 'file', currentMeetingId: null };
}

// ---- Filed recently -----------------------------------------------------------------------------

export interface RecentRowModel {
  summaryId: string;
  /** The summary's title; null shows summaries:common.untitled. */
  title: string | null;
  /** status matched: the meeting's title when it was filed; null for kept. */
  filedUnder: string | null;
  kept: boolean;
  receivedAt: string;
}

export function recentRowModel(item: SummaryListItem): RecentRowModel {
  const filedUnder = item.status === 'matched' && item.match !== null ? item.match.meetingSnapshot.title : null;
  return {
    summaryId: item.summaryId,
    title: item.title !== null && item.title.trim() !== '' ? item.title : null,
    filedUnder,
    kept: item.status === 'kept',
    receivedAt: item.receivedAt,
  };
}

// ---- Refused ------------------------------------------------------------------------------------

export interface RefusedDayRow {
  /** The UTC day (YYYY-MM-DD) the refusals were counted on. */
  day: string;
  count: number;
  /** The latest reason that day (null for a row the server could not read). */
  reason: SummaryRefusedReason | null;
  /** The d= of a passing signature only; null shows "From an unknown sender". */
  senderDomain: string | null;
}

/** The server's refused row id is "refused-YYYY-MM-DD" (functions/src/summaries/model.ts). */
const REFUSED_ROW_ID = /^refused-(\d{4}-\d{2}-\d{2})$/;

/** The UTC day of a refused row: from its id, else from its latest refusal time; null when neither reads. */
export function refusedDayOf(item: Pick<SummaryListItem, 'summaryId' | 'receivedAt'>): string | null {
  const fromId = REFUSED_ROW_ID.exec(item.summaryId)?.[1];
  if (fromId !== undefined && isLocalDate(fromId)) return fromId;
  const at = Date.parse(item.receivedAt);
  return Number.isFinite(at) ? new Date(at).toISOString().slice(0, 10) : null;
}

/**
 * One row per UTC day, newest day first. The server already answers one row per day; rows that
 * share a day anyway are merged (counts added, the newest row's reason and sender kept).
 */
export function refusedDayRows(items: readonly SummaryListItem[]): RefusedDayRow[] {
  const byDay = new Map<string, RefusedDayRow & { latest: number }>();
  for (const item of items) {
    if (item.status !== 'refused') continue;
    const day = refusedDayOf(item);
    if (day === null) continue;
    const latest = Date.parse(item.receivedAt);
    const at = Number.isFinite(latest) ? latest : 0;
    const count = item.count ?? 1;
    const existing = byDay.get(day);
    if (!existing) {
      byDay.set(day, { day, count, reason: item.refusedReason, senderDomain: item.senderDomain, latest: at });
      continue;
    }
    existing.count += count;
    if (at > existing.latest) {
      existing.latest = at;
      existing.reason = item.refusedReason;
      existing.senderDomain = item.senderDomain;
    }
  }
  return [...byDay.values()]
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))
    .map(({ day, count, reason, senderDomain }) => ({ day, count, reason, senderDomain }));
}
