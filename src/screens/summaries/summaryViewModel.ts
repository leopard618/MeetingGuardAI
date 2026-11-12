/**
 * Pure view model of the summary view screen (route "SummaryView" { summaryId };
 * docs/v2/M10-DESIGN.md section 9) and of MeetingSummarySection on Meeting details: which state to
 * show, the origin, trust, match and date lines as i18n references, the actions a summary offers,
 * the target of the "Choose a meeting" / "Move" sheet, and the sections split into plain text
 * blocks and item lines. No React, no Firebase: unit tests import this file directly.
 *
 * Display only. The summary text is never turned into actions here: links, email addresses and
 * phone numbers stay plain text, and nothing from a summary is ever logged.
 */
import {
  SUMMARY_LIMITS,
  type SummaryDetail,
  type SummaryItem,
  type SummaryListItem,
  type SummarySection,
  type SummarySectionKind,
  type SummaryStatusResponse,
  type SummaryTier,
} from '../../core/aiContract';
import type { AppError } from '../../core/errors';
import { isSummariesAvailable, isSummariesUnavailableError, summaryErrorReason } from '../../services/summaries/summaryCore';

import type { AttachMeetingTarget } from './AttachMeetingSheet';
import { inboxReasonKey, summaryChipKey, summaryErrorMessageKey } from './summaryText';

/** An i18n key with its interpolation values (all plain strings). */
export interface TextRef {
  key: string;
  params?: Readonly<Record<string, string>>;
}

// ---- Screen state --------------------------------------------------------------------------------

export type SummaryViewState = 'loading' | 'error' | 'unavailable' | 'gone' | 'ready';

export interface SummaryViewStateInput {
  /** useSummaryStatus().status (null while unknown). */
  status: SummaryStatusResponse | null;
  /** useSummaryStatus().error. */
  statusError: AppError | null;
  /** useSummary(...).summary. */
  summary: SummaryDetail | null;
  /** useSummary(...).error. */
  error: AppError | null;
  /** useSummary(...).loading. */
  loading: boolean;
}

/**
 * - loading: the status or the first summaryRead get is in flight;
 * - error: nothing to show and the last ask failed (Try again);
 * - unavailable: the feature is off or the caller is not in the pilot, or summaryRead is not
 *   deployed (functions/not-found without details maps to not_enabled);
 * - gone: the summary was deleted (here, or not_found from the server): the screen goes back;
 * - ready: a summary to show (a cached copy stays on screen when a later ask fails).
 */
export function summaryViewState(input: SummaryViewStateInput): SummaryViewState {
  if (input.status === null) return input.statusError === null ? 'loading' : 'error';
  if (!isSummariesAvailable(input.status) || isSummariesUnavailableError(input.error)) return 'unavailable';
  if (input.summary !== null) return 'ready';
  if (input.loading) return 'loading';
  if (input.error === null || summaryErrorReason(input.error) === 'not_found') return 'gone';
  return 'error';
}

/** The message of the error state (the summary error first, else the status error). */
export function summaryViewErrorKey(input: Pick<SummaryViewStateInput, 'error' | 'statusError'>): string {
  const error = input.error ?? input.statusError;
  return error !== null ? summaryErrorMessageKey(error) : 'summaries:errors.generic';
}

// ---- Header and origin ---------------------------------------------------------------------------

/** The title line, else the cleaned subject; null when the summary has neither (show common.untitled). */
export function summaryTitle(summary: Pick<SummaryListItem, 'title'> & Partial<Pick<SummaryDetail, 'titleLine'>>): string | null {
  const title = (summary.title ?? summary.titleLine ?? '').trim();
  return title === '' ? null : title;
}

/** The origin chip of a row or the view header; null for a row without a tier (refused rows). */
export function originChip(tier: SummaryTier | null): { key: string; tone: 'primary' | 'neutral' } | null {
  if (tier === null) return null;
  return { key: summaryChipKey(tier), tone: tier === 'vendor_verified' ? 'primary' : 'neutral' };
}

/**
 * Who wrote it and how it was checked (M10 section 9): "Written by your notetaker (<domain>),
 * received <time>. Signature checked." for a vendor-signed summary (the domain is the d= of the
 * passing signature, never a display name), or "Forwarded from <address>. The notetaker's own
 * signature could not be checked." plus the received line for a hand forward.
 */
export function originLines(
  summary: Pick<SummaryDetail, 'tier' | 'senderDomain' | 'forwardedBy'>,
  receivedText: string,
): TextRef[] {
  const received: TextRef = { key: 'summaries:common.received', params: { time: receivedText } };
  if (summary.tier === 'vendor_verified') {
    return [
      summary.senderDomain !== null
        ? { key: 'summaries:common.origin.vendor', params: { domain: summary.senderDomain, time: receivedText } }
        : { key: 'summaries:common.origin.vendorNoDomain', params: { time: receivedText } },
    ];
  }
  if (summary.tier === 'user_forwarded') {
    return [
      summary.forwardedBy !== null
        ? { key: 'summaries:common.origin.forwarded', params: { address: summary.forwardedBy } }
        : { key: 'summaries:common.origin.forwardedNoAddress' },
      received,
    ];
  }
  return [received];
}

/**
 * The weaker trust facts of a vendor-signed summary, fixed at receipt and kept after filing (red
 * team finding 7): not sent to a listed mailbox, or not fresh. Left out while the inbox reason
 * already says the same thing.
 */
export function trustNoteKeys(
  summary: Pick<SummaryListItem, 'tier' | 'recipientBound' | 'fresh' | 'status' | 'inboxReason'>,
): string[] {
  if (summary.tier !== 'vendor_verified') return [];
  const reason = summary.status === 'inbox' ? summary.inboxReason : null;
  const notes: string[] = [];
  if (!summary.recipientBound && reason !== 'not_addressed_to_you') notes.push('summaries:view.trust.notBound');
  if (!summary.fresh && reason !== 'old_summary') notes.push('summaries:view.trust.notFresh');
  return notes;
}

// ---- Filing --------------------------------------------------------------------------------------

/** The meeting it is filed under (title and start), or where it waits. */
export function matchLine(summary: Pick<SummaryListItem, 'status' | 'match'>, formatStart: (iso: string) => string): TextRef {
  if (summary.status === 'matched') {
    if (summary.match === null) return { key: 'summaries:common.status.matched' };
    const snapshot = summary.match.meetingSnapshot;
    return {
      key: `summaries:view.match.${summary.match.method}`,
      params: { title: snapshot.title, time: formatStart(snapshot.startAt) },
    };
  }
  if (summary.status === 'kept') return { key: 'summaries:view.match.kept' };
  return { key: 'summaries:view.match.inbox' };
}

/** Why it waits in the inbox (status inbox only). */
export function inboxReasonLineKey(summary: Pick<SummaryListItem, 'status' | 'inboxReason'>): string | null {
  return summary.status === 'inbox' && summary.inboxReason !== null ? inboxReasonKey(summary.inboxReason) : null;
}

/** "Date in the summary: <date>" or "No date in the summary". */
export function summaryDateLine(summaryDate: string | null, formatDate: (localDate: string) => string): TextRef {
  return summaryDate !== null
    ? { key: 'summaries:common.summaryDate', params: { date: formatDate(summaryDate) } }
    : { key: 'summaries:common.noSummaryDate' };
}

export interface SummaryViewActions {
  /** Filed: back to the inbox, and that meeting is not suggested again (detach). */
  notThisMeeting: boolean;
  /** Filed: the sheet in 'move' mode. */
  move: boolean;
  /** Inbox or kept: the sheet in 'file' mode. */
  choose: boolean;
  /** Inbox: "Keep without a meeting". */
  keep: boolean;
}

/** Which filing buttons a summary offers (Copy text and Delete are always there). */
export function summaryViewActions(summary: Pick<SummaryListItem, 'status' | 'match'>): SummaryViewActions {
  const filed = summary.status === 'matched' && summary.match !== null;
  return {
    notThisMeeting: filed,
    move: filed,
    choose: summary.status === 'inbox' || summary.status === 'kept',
    keep: summary.status === 'inbox',
  };
}

/**
 * What AttachMeetingSheet needs: 'move' for a filed summary (marking its meeting and, for a
 * series, the occurrence it is filed under), else 'file'.
 */
export function attachTargetFor(
  summary: Pick<SummaryListItem, 'summaryId' | 'summaryDate' | 'receivedAt' | 'status' | 'match'>,
): AttachMeetingTarget {
  const match = summary.status === 'matched' ? summary.match : null;
  return {
    summaryId: summary.summaryId,
    summaryDate: summary.summaryDate,
    receivedAt: summary.receivedAt,
    mode: match !== null ? 'move' : 'file',
    currentMeetingId: match?.meetingId ?? null,
    currentOccurrenceDate: match?.occurrenceDate ?? null,
  };
}

// ---- Sections ------------------------------------------------------------------------------------

export type SummaryViewBlock =
  | { kind: 'text'; key: string; text: string }
  | { kind: 'item'; key: string; text: string; item: SummaryItem };

export interface SummaryViewSection {
  /** The section id (stable React key). */
  id: string;
  kind: SummarySectionKind;
  /** The heading exactly as written; null when headingKey (or nothing, for the preamble) shows instead. */
  heading: string | null;
  /** i18n key shown instead of a verbatim heading: the TLDR and summary sections, a body without headings. */
  headingKey: string | null;
  /** The notetaker's own digest (tldr, summary): shown with view.tldrNote, never as ground truth. */
  derived: boolean;
  blocks: SummaryViewBlock[];
}

export const SUMMARY_DERIVED_HEADING_KEY = 'summaries:view.tldrHeading';
export const SUMMARY_TEXT_HEADING_KEY = 'summaries:view.textHeading';

const DERIVED_KINDS: ReadonlySet<SummarySectionKind> = new Set<SummarySectionKind>(['tldr', 'summary']);

/** Only markup, punctuation or blanks: nothing worth a line of its own. */
const NOTHING_LEFT = /^[\s*_~`#:.!?|=()[\]-]*$/;

/**
 * What follows the heading on its own line: content of an inline heading ("TL;DR: The team ..."),
 * or nothing once the closing markup ("**Launch Readiness**"), a count ("Action items (3)") and
 * the colon are gone.
 */
function headingLineRest(rest: string): string {
  const cleaned = rest
    .replace(/^[*_~`]+/, '')
    .replace(/^\s*\(\d{1,4}\)/, '')
    .replace(/^[\s*_~`:]+/, '')
    .trim();
  return NOTHING_LEFT.test(cleaned) ? '' : cleaned;
}

/**
 * Free text between two items, or between a section edge and an item. Before an item, the item's
 * own line prefix (indent, bullet, number, checkbox) is dropped: it is what follows the last line
 * break of the gap.
 */
function freeText(gap: string, beforeItem: boolean): string {
  let body = gap;
  if (beforeItem) {
    const lastBreak = body.lastIndexOf('\n');
    body = lastBreak === -1 ? '' : body.slice(0, lastBreak);
  }
  return body
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

/** An item as one plain line: the hard-wrapped continuation lines joined with a space. */
export function itemDisplayText(item: Pick<SummaryItem, 'text'>): string {
  return item.text.replace(/[ \t]*\r?\n[ \t]*/g, ' ').trim();
}

/** The first line of a text block when it repeats the title shown above it. */
function withoutLine(value: string, line: string | null): string {
  if (line === null) return value;
  const breakAt = value.indexOf('\n');
  const first = (breakAt === -1 ? value : value.slice(0, breakAt)).trim();
  if (first !== line.trim()) return value;
  return breakAt === -1 ? '' : value.slice(breakAt + 1).trim();
}

function sectionBlocks(text: string, section: SummarySection, dropLine: string | null): SummaryViewBlock[] {
  const end = Math.min(Math.max(section.end, section.start), text.length);
  const blocks: SummaryViewBlock[] = [];
  const pushText = (value: string): void => {
    if (value !== '') blocks.push({ kind: 'text', key: `${section.id}:t${blocks.length}`, text: value });
  };
  let cursor = Math.min(section.start, end);
  if (section.heading !== null) {
    const breakAt = text.indexOf('\n', cursor);
    const lineEnd = breakAt === -1 || breakAt > end ? end : breakAt;
    // The heading sits at the section start (server invariant); otherwise the whole line is the heading.
    const headingEnd = text.startsWith(section.heading, cursor) ? cursor + section.heading.length : lineEnd;
    pushText(headingLineRest(text.slice(Math.min(headingEnd, lineEnd), lineEnd)));
    cursor = lineEnd;
  }
  const items = section.items
    .filter((item) => item.start >= cursor && item.end <= end && item.start <= item.end)
    .sort((a, b) => a.start - b.start);
  for (const item of items) {
    if (item.start < cursor) continue;
    pushText(freeText(text.slice(cursor, item.start), true));
    blocks.push({ kind: 'item', key: `${section.id}:${item.id}`, text: itemDisplayText(item), item });
    cursor = item.end;
  }
  pushText(freeText(text.slice(cursor, end), false));

  // The preamble (or a body without headings) starts with the title line, already shown above.
  const first = blocks[0];
  if (dropLine !== null && first?.kind === 'text') {
    const rest = withoutLine(first.text, dropLine);
    if (rest === '') blocks.shift();
    else blocks[0] = { ...first, text: rest };
  }
  return blocks;
}

function headingOf(section: SummarySection): { heading: string | null; headingKey: string | null } {
  if (section.derived || DERIVED_KINDS.has(section.kind)) return { heading: null, headingKey: SUMMARY_DERIVED_HEADING_KEY };
  if (section.kind === 'preamble') return { heading: null, headingKey: null };
  if (section.kind !== 'body' && section.heading !== null && section.heading.trim() !== '') {
    return { heading: section.heading.trim(), headingKey: null };
  }
  return { heading: null, headingKey: SUMMARY_TEXT_HEADING_KEY };
}

/**
 * The sections in text order, each with its heading (verbatim, or "Your notetaker's own summary"
 * for the TLDR and summary sections) and its content as plain text blocks and item lines. Text
 * outside the items (sub-labels, paragraphs) is kept; empty sections are left out. A summary
 * without sections (never stored, but safe) shows its whole text as one body section.
 */
export function viewSections(summary: Pick<SummaryDetail, 'text' | 'sections' | 'title' | 'titleLine'>): SummaryViewSection[] {
  const title = summaryTitle(summary);
  const dropLine = summary.titleLine !== null && title !== null && summary.titleLine.trim() === title ? summary.titleLine : null;
  const sections: SummarySection[] =
    summary.sections.length > 0
      ? [...summary.sections].sort((a, b) => a.start - b.start)
      : [{ id: 'body', kind: 'body', heading: null, derived: false, start: 0, end: summary.text.length, items: [] }];
  const result: SummaryViewSection[] = [];
  for (const section of sections) {
    const opening = section.kind === 'preamble' || section.kind === 'body';
    const blocks = sectionBlocks(summary.text, section, opening ? dropLine : null);
    if (blocks.length === 0) continue;
    const { heading, headingKey } = headingOf(section);
    result.push({
      id: section.id,
      kind: section.kind,
      heading,
      headingKey,
      derived: headingKey === SUMMARY_DERIVED_HEADING_KEY,
      blocks,
    });
  }
  return result;
}

export interface SummaryItemView {
  /** view.checkbox.done / open, or null when the line has no checkbox. */
  checkKey: string | null;
  /** "Owner: Bish", "Due: Friday", as written; empty when the summary names neither. */
  meta: TextRef[];
  /** The reads-like-an-instruction notice (shown as plain text only), or null. */
  warningKey: string | null;
}

export function summaryItemView(item: Pick<SummaryItem, 'checked' | 'owner' | 'dueText' | 'flags'>): SummaryItemView {
  const meta: TextRef[] = [];
  if (item.owner !== null && item.owner.trim() !== '') meta.push({ key: 'summaries:view.owner', params: { owner: item.owner.trim() } });
  if (item.dueText !== null && item.dueText.trim() !== '') meta.push({ key: 'summaries:view.due', params: { due: item.dueText.trim() } });
  return {
    checkKey: item.checked === null ? null : item.checked ? 'summaries:view.checkbox.done' : 'summaries:view.checkbox.open',
    meta,
    warningKey: item.flags.includes('possible_instruction') ? 'summaries:view.flag.possible_instruction' : null,
  };
}

const LINK_PATTERN = /\bhttps?:\/\/|\bwww\./i;

/** The summary holds links: the screen says they are plain text (copy one to open it). */
export function hasPlainLinks(summary: Pick<SummaryDetail, 'text' | 'sections'>): boolean {
  return (
    summary.sections.some((section) => section.items.some((item) => item.flags.includes('has_link'))) ||
    LINK_PATTERN.test(summary.text)
  );
}

/** The server cut a very long summary (text, section or item caps reached). */
export function looksTruncated(summary: Pick<SummaryDetail, 'text' | 'sections'>): boolean {
  if (summary.text.length >= SUMMARY_LIMITS.maxTextChars) return true;
  if (summary.sections.length >= SUMMARY_LIMITS.maxSections) return true;
  const items = summary.sections.reduce((total, section) => total + section.items.length, 0);
  return items >= SUMMARY_LIMITS.maxItems;
}

// ---- Meeting details section ---------------------------------------------------------------------

/**
 * The rows MeetingSummarySection shows, or null to render nothing: hidden unless available, while
 * nothing is known yet, when summaryRead is not deployed or the caller left the pilot
 * (not_enabled / not_allowed), and when nothing is filed under the meeting. Other failures keep
 * the cached rows (and show nothing when none are cached).
 */
export function meetingSummaryRows(
  available: boolean,
  items: readonly SummaryListItem[] | null,
  error: AppError | null,
): readonly SummaryListItem[] | null {
  if (!available || items === null || isSummariesUnavailableError(error)) return null;
  const filed = items.filter((item) => item.status === 'matched');
  return filed.length > 0 ? filed : null;
}
