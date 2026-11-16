/**
 * Pure model of the "Review commitments" entry points (route "SummaryCommitments" { summaryId };
 * docs/v2/M11-DESIGN.md section 3.1): the top of SummaryView, the MeetingSummarySection rows and
 * the button beside Debrief on Meeting details. Which summaries offer it, its label and the facts
 * line under it, all from the summaryRead row's content-free commitments facts {state, open,
 * accepted} (the commitments service patches them after every answer, so the counts follow without
 * a re-list). No React, no Firebase: unit tests import this file directly.
 *
 * Offered only while summaryStatus says enabled and allowed (the pilot), and only for a summary
 * filed under a meeting or kept (an inbox summary cannot be reviewed until it is filed or kept;
 * the server answers not_found for it).
 */
import type { SummaryListCommitments, SummaryListItem } from '../../core/aiContract';

/** An i18n key with its interpolation values (count is a number, for the plural forms). */
export interface EntryText {
  key: string;
  params?: Readonly<Record<string, string | number>>;
}

export interface CommitmentsEntry {
  /** The summary the button opens (route SummaryCommitments { summaryId }). */
  summaryId: string;
  /** "Review commitments", or "Review commitments (5)" with the open count of a ready list. */
  label: EntryText;
  /** The line under the button: the state when it needs a word, and how many were added. */
  facts: readonly EntryText[];
}

/** Filed or kept, and the feature is on for this account. */
export function canReviewCommitments(item: Pick<SummaryListItem, 'status'>, available: boolean): boolean {
  return available && (item.status === 'matched' || item.status === 'kept');
}

/** The open count shows only on a current (ready) list; a stale one is read-only until prepared again. */
export function commitmentsEntryLabel(facts: SummaryListCommitments | undefined): EntryText {
  if (facts !== undefined && facts.state === 'ready' && facts.open > 0) {
    return { key: 'summaries:commitments.entry.reviewCount', params: { count: facts.open } };
  }
  return { key: 'summaries:commitments.entry.review' };
}

/**
 * Nothing before the first preparation (no facts, or state none). Then: "Being prepared",
 * "No commitments found" or "The summary changed: prepare the suggestions again (free)" when the
 * state needs a word, and "2 added to your tasks" once anything was accepted.
 */
export function commitmentsEntryFacts(facts: SummaryListCommitments | undefined): EntryText[] {
  if (facts === undefined) return [];
  const lines: EntryText[] = [];
  if (facts.state === 'preparing') lines.push({ key: 'summaries:commitments.entry.preparing' });
  else if (facts.state === 'empty') lines.push({ key: 'summaries:commitments.entry.empty' });
  else if (facts.state === 'stale') lines.push({ key: 'summaries:commitments.entry.stale' });
  if (facts.accepted > 0) lines.push({ key: 'summaries:commitments.entry.added', params: { count: facts.accepted } });
  return lines;
}

/** The entry of one summary, or null when it offers none. */
export function commitmentsEntryFor(
  item: Pick<SummaryListItem, 'summaryId' | 'status' | 'commitments'>,
  available: boolean,
): CommitmentsEntry | null {
  if (!canReviewCommitments(item, available)) return null;
  return { summaryId: item.summaryId, label: commitmentsEntryLabel(item.commitments), facts: commitmentsEntryFacts(item.commitments) };
}

/**
 * Meeting details, beside Debrief: the newest summary filed under the meeting (summaryRead lists
 * newest first; a series lists the summary of every occurrence under its master, and the newest
 * is the meeting that just ended). The older ones keep their own button in MeetingSummarySection.
 */
export function meetingCommitmentsEntry(rows: readonly SummaryListItem[] | null, available: boolean): CommitmentsEntry | null {
  if (rows === null) return null;
  for (const row of rows) {
    const entry = commitmentsEntryFor(row, available);
    if (entry !== null) return entry;
  }
  return null;
}
