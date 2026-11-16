/**
 * The action items as written (docs/v2/M11-DESIGN.md section 2.5): free, no AI, always offered, so
 * a used-up allowance never blocks the feature. PURE.
 *
 * - Which: every unchecked item (checked false or null) of action_items, next_steps and
 *   waiting_on, and the checkbox items (checked false) of custom sections, in document order; over
 *   COMMITMENT_LIMITS.maxProposals the action-list items go first. Derived sections never count.
 * - Title: the item text without "(owner: ...)", "(responsable: ...)", "(waiting on: ...)" and
 *   the due marker, then cleanTitle; empty after that: left out. "<owner>: " for someone else.
 * - Owner: item.owner, else the waited-on name, checked as a name (isNameLike) and against the
 *   user's names (ownerIsUser).
 * - Due: only an absolute date that datesIn reads in item.dueText (exactly one), never a relative
 *   one, within the reference day minus 1 to plus 400; a time only from one clock form there.
 * - Confidence null; kind 'waiting_on' for the waiting_on section, else 'action'.
 * - The same flags (verify.ts), owner prefix and pre-selection (preselect.ts) as the AI list.
 *
 * Product text rule: ASCII punctuation only in this file.
 */
import { COMMITMENT_LIMITS } from '../shared/aiContract';
import { datesIn, type SummaryItem, type SummarySection } from '../summaries/sections';
import { readClockTimes, withinDueBounds } from './due';
import { ACTION_LIST_KINDS } from './payload';
import {
  cleanTitle,
  itemFlagsOf,
  matchVerbatim,
  ownerPrefixed,
  resolveOwner,
  stripItemMarkers,
  waitedOnOf,
  type VerifiedCommitment,
  type VerifiedDue,
} from './verify';

export interface AsWrittenInput {
  text: string;
  sections: readonly SummarySection[];
  /** YYYY-MM-DD (due.ts referenceDayOf), for the date bounds. */
  referenceDay: string;
  /** users/{uid}.displayName and the Auth display name. */
  userNames: readonly (string | null | undefined)[];
  /** Test seam: COMMITMENT_LIMITS.maxProposals by default. */
  maxProposals?: number;
}

function isAsWrittenItem(section: SummarySection, item: SummaryItem): boolean {
  if (section.derived || item.checked === true) return false;
  if (ACTION_LIST_KINDS.has(section.kind)) return true;
  return section.kind === 'custom' && item.checked === false;
}

/** The deadline of an item as written: one absolute date in its dueText (and one clock time), else null. */
function dueAsWritten(text: string, item: SummaryItem, referenceDay: string): VerifiedDue | null {
  if (item.dueText === null) return null;
  const dates = [...datesIn(item.dueText)];
  const date = dates.length === 1 ? dates[0] : undefined;
  if (date === undefined || !withinDueBounds(date, referenceDay)) return null;
  const times = readClockTimes(item.dueText);
  const found = matchVerbatim(text.slice(item.start, item.end), item.dueText);
  const quoteStart = found === null ? item.start : item.start + found.start;
  const quoteEnd = found === null ? item.end : item.start + found.end;
  return { date, time: times.length === 1 ? (times[0] ?? null) : null, quoteStart, quoteEnd };
}

/** The action items as written (see the module comment), in document order. */
export function asWrittenProposals(input: AsWrittenInput): VerifiedCommitment[] {
  const max = input.maxProposals ?? COMMITMENT_LIMITS.maxProposals;
  const candidates: { section: SummarySection; item: SummaryItem; order: number }[] = [];
  let order = 0;
  for (const section of input.sections) {
    for (const item of section.items) {
      order += 1;
      if (!isAsWrittenItem(section, item)) continue;
      if (input.text.slice(item.start, item.end) !== item.text) continue;
      candidates.push({ section, item, order });
    }
  }
  const chosen = [...candidates]
    .sort((a, b) => Number(!ACTION_LIST_KINDS.has(a.section.kind)) - Number(!ACTION_LIST_KINDS.has(b.section.kind)) || a.order - b.order)
    .slice(0, Math.max(0, max))
    .sort((a, b) => a.order - b.order);

  const out: VerifiedCommitment[] = [];
  for (const { section, item } of chosen) {
    const ownerText = item.owner ?? waitedOnOf(item.text);
    const owner = resolveOwner(ownerText, item.text, ownerText, input.userNames);
    let title = cleanTitle(stripItemMarkers(item.text));
    if (title.length === 0) continue;
    if (owner.role === 'other' && owner.owner !== null) title = ownerPrefixed(title, owner.owner);
    out.push({
      anchorId: item.id,
      anchorKind: 'item',
      sectionId: section.id,
      sectionKind: section.kind,
      sectionHeading: section.heading,
      quoteStart: item.start,
      quoteEnd: item.end,
      title,
      titleFromAnchor: true,
      owner: owner.owner,
      ownerRole: owner.role,
      due: dueAsWritten(input.text, item, input.referenceDay),
      kind: section.kind === 'waiting_on' ? 'waiting_on' : 'action',
      confidence: null,
      flags: itemFlagsOf(item, section, item.text, title, owner.guess),
    });
  }
  return out;
}
