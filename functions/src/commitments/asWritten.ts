/**
 * The action items as written (docs/v2/M11-DESIGN.md section 2.5): free, no AI, always offered, so
 * a used-up allowance never blocks the feature. PURE.
 *
 * - Which: every unchecked item (checked false or null) of action_items, next_steps and
 *   waiting_on, and the checkbox items (checked false) of custom sections, in document order; over
 *   COMMITMENT_LIMITS.maxProposals the action-list items go first. Derived sections never count.
 * - Title: the item text without "(owner: ...)", "(responsable: ...)", "(waiting on: ...)" and
 *   the due marker (also a trailing "-> Due Wednesday", Fathom's Next Steps form), then
 *   cleanTitle; empty after that: left out. "<owner>: " for someone else.
 * - Owner: item.owner, else the waited-on name, else a name labelling the line ("Dana: Send the
 *   deck", labelOwnerOf), checked as a name (isNameLike) and against the user's names (ownerIsUser).
 * - Due: from item.dueText, else the trailing "Due ..." words: an absolute date that datesIn reads
 *   (exactly one), else resolveDue's single reading of the words (a weekday is the first one after
 *   the meeting's day; the same code reading as the AI list, never the model), within the
 *   reference day minus 1 to plus 400; a time only from one clock form there.
 * - Duplicates: two lines of one summary that say the same task ("Fix login page issue" in Action
 *   items and "Dana: Fix login page bug -> Due Wednesday" in Next steps) are one suggestion: the
 *   one with more facts (owner, due) is kept, else the first (sameTaskWords). Only across
 *   sections: one section listing a line twice keeps both (each has its own key).
 * - Confidence null; kind 'waiting_on' for the waiting_on section, else 'action'.
 * - The same flags (verify.ts), owner prefix and pre-selection (preselect.ts) as the AI list.
 *
 * Product text rule: ASCII punctuation only in this file.
 */
import { COMMITMENT_LIMITS } from '../shared/aiContract';
import { datesIn, type SummaryItem, type SummarySection } from '../summaries/sections';
import { readClockTimes, resolveDue, withinDueBounds } from './due';
import { fold } from './text';
import { ACTION_LIST_KINDS } from './payload';
import {
  cleanTitle,
  isNameLike,
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

/**
 * A name labelling the line ("Dana: Send the deck", "Dana Lee: ..."): 1 to 3 capitalized words
 * before a colon, accepted only when isNameLike ("All:", "Note:" and title verbs are not names).
 */
const LABEL_OWNER_RE = /^[ \t]*(\p{Lu}[\p{L}'.-]*(?:[ \t]+\p{Lu}[\p{L}'.-]*){0,2})[ \t]*:[ \t]+(\S.*)$/u;

export function labelOwnerOf(text: string): { owner: string; rest: string } | null {
  const m = LABEL_OWNER_RE.exec(text);
  const owner = m?.[1]?.trim() ?? '';
  const rest = m?.[2]?.trim() ?? '';
  if (owner === '' || rest === '' || !isNameLike(owner)) return null;
  return { owner, rest };
}

/** A due written at the end after an arrow or a dash, or alone: "-> Due Wednesday.", "\u2192 Due by Friday". */
const TRAILING_DUE_RE = /[ \t]*(?:\u2192|->|=>|\u2014|\u2013|[ \t]-)?[ \t]*\bdue[ \t]+(?:by[ \t]+|on[ \t]+)?([^()\n;|:]{1,60}?)[ \t]*[.!]?[ \t]*$/iu;

/** The trailing due words of a line and the line without them, or null. */
export function trailingDueOf(text: string): { dueText: string; rest: string } | null {
  const m = TRAILING_DUE_RE.exec(text);
  const dueText = m?.[1]?.trim() ?? '';
  if (m === null || dueText === '') return null;
  return { dueText, rest: text.slice(0, m.index).trim() };
}

/** The deadline of an item as written (see the module comment), else null. */
function dueAsWritten(text: string, item: SummaryItem, dueText: string | null, referenceDay: string): VerifiedDue | null {
  if (dueText === null) return null;
  const absolute = [...datesIn(dueText)];
  const reading = absolute.length > 0 ? absolute : resolveDue(dueText, referenceDay).dates;
  const date = reading.length === 1 ? reading[0] : undefined;
  if (date === undefined || !withinDueBounds(date, referenceDay)) return null;
  const times = readClockTimes(dueText);
  const found = matchVerbatim(text.slice(item.start, item.end), dueText);
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
  const words: { words: Set<string>; sectionId: string }[] = [];
  for (const { section, item } of chosen) {
    const label = item.owner === null && waitedOnOf(item.text) === null ? labelOwnerOf(item.text) : null;
    const ownerText = item.owner ?? waitedOnOf(item.text) ?? label?.owner ?? null;
    const owner = resolveOwner(ownerText, item.text, ownerText, input.userNames);
    let base = stripItemMarkers(label?.rest ?? item.text);
    const trailing = item.dueText === null ? trailingDueOf(base) : null;
    if (trailing !== null) base = trailing.rest;
    let title = cleanTitle(base);
    if (title.length === 0) continue;
    const taskWords = taskWordsOf(title);
    if (owner.role === 'other' && owner.owner !== null) title = ownerPrefixed(title, owner.owner);
    const due = dueAsWritten(input.text, item, item.dueText ?? trailing?.dueText ?? null, input.referenceDay);
    // Two lines of the same task: keep the one with more facts, in the place of the first.
    // Only across sections (Action items and Next steps): a section listing a line twice keeps both.
    const twin = words.findIndex((other) => other.sectionId !== section.id && sameTaskWords(other.words, taskWords));
    const twinOf = twin >= 0 ? out[twin] : undefined;
    if (twinOf !== undefined) {
      if (factsOf(owner.owner, due) <= factsOf(twinOf.owner, twinOf.due)) continue;
      out.splice(twin, 1);
      words.splice(twin, 1);
    }
    words.push({ words: taskWords, sectionId: section.id });
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
      due,
      kind: section.kind === 'waiting_on' ? 'waiting_on' : 'action',
      confidence: null,
      flags: itemFlagsOf(item, section, item.text, title, owner.guess),
    });
  }
  return out;
}

/** Words that say nothing about which task it is. */
const FILLER_WORDS: ReadonlySet<string> = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'onto', 'our', 'your', 'their', 'its', 'all', 'due', 'are', 'was',
  'por', 'para', 'con', 'los', 'las', 'del', 'una', 'uno', 'que', 'sus',
]);

/** The task's own words: 3+ letters, folded, fillers out. */
function taskWordsOf(title: string): Set<string> {
  return new Set(
    fold(title)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 3 && !FILLER_WORDS.has(word)),
  );
}

/** At least 3 shared words, and at least 60% of the shorter line's: the same task said twice. */
function sameTaskWords(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  const smaller = Math.min(a.size, b.size);
  return smaller > 0 && shared >= 3 && shared / smaller >= 0.6;
}

function factsOf(owner: string | null, due: VerifiedDue | null): number {
  return (owner !== null ? 1 : 0) + (due !== null ? 1 : 0);
}
