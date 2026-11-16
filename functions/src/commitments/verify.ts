/**
 * The checks every proposed commitment passes in code (docs/v2/M11-DESIGN.md section 2.4; section
 * 15 findings 3, 5, 6, 7, 13, 14, 17 and 26). Code decides, the model suggests: each cited id,
 * quote, title, owner and date is checked against the stored text; a failure drops the proposal or
 * clears the field and is counted, never repaired, except the two verbatim fallbacks (an item's
 * quote is always the whole item and a sentence's the whole sentence; an ungrounded title becomes
 * the anchor's own words). PURE: no Firebase, no logging, no clock.
 *
 * Summary-specific: anchors are the parser's items and prose sections. The generic quote and title
 * checks (matchVerbatim, expandSentence, cleanTitle, groundTitle, ownerPrefixed, hasBareHost,
 * defangLinks) live in grounding.ts, shared with the assistant matters, and are re-exported here.
 *
 * In order, for each proposal (the model's order; the result is in document order):
 * 1. Anchor: an item id or a prose section id of the model's input (payload.ts). One per anchor,
 *    the first wins; at most COMMITMENT_LIMITS.maxProposals.
 * 2. Quote: an item's quote is the whole item (any span the model sends is ignored). A sentence is
 *    found with matchVerbatim (exact, then whitespace runs collapsed and typographic punctuation
 *    folded one for one, offsets mapped back) inside what the model was sent, then EXPANDED to the
 *    whole sentence (expandSentence); 20 to 300 characters or dropped. So "confirm the launch date"
 *    out of "Do not confirm the launch date until legal signs off." shows the whole sentence, and
 *    any span of one sentence gives the same anchor.
 * 3. Title: owner and due markers removed, cleanTitle (links, www, mailto, bare host names, email
 *    addresses, phone-like runs except ISO dates; punctuation folded to ASCII; one line; 200 max),
 *    then grounded word by word (groundTitle: every 3+ letter non-stopword in the anchor text except
 *    at most ONE word of TITLE_VERBS, and every digit run in it; never when the title or the anchor
 *    says "not"). Otherwise the anchor's own words without the markers. Then "<owner>: " for
 *    someone else's commitment (ownerPrefixed).
 * 4. Owner: the parser's item.owner wins when present; else a name-like span of the anchor text at
 *    word boundaries (1 to 5 words, each starting with a letter, at most 100 characters, no digit,
 *    '@' or link, not a stopword); anything else null. people[].email is always null (taskDoc.ts).
 * 5. Owner is the user: ownerIsUser ('me' on a full name, 'guess' on a first name only, which keeps
 *    the flag owner_guess and is treated as the user).
 * 6. Due: due_quote inside the anchor text; resolveDue reads it; due_date must be one of its dates
 *    and within the reference day minus 1 to plus 400; due_time only from a clock form in the quote.
 * 7. Confidence clamped to 0..100; kind 'action' unless 'waiting_on'.
 * 8. Flags from code: the parser's item flags (possible_instruction, has_link, truncated; computed
 *    for sentences), has_link for a bare host name, payment_like, suggested, checklist,
 *    owner_guess. None of them drops a proposal; preselect.ts says what they change.
 * Nothing else can come out: no meeting change, no sharing, no link, no email address, no
 * description written by the model.
 *
 * Product text rule: ASCII punctuation only in this file; other characters from code points.
 */
import { z } from 'zod';

import { COMMITMENT_FLAGS, COMMITMENT_LIMITS, type CommitmentFlag } from '../shared/aiContract';
import { isLocalDate, isLocalTime } from '../shared/time';
import {
  DUE_INLINE_RE,
  DUE_PAREN_RE,
  LINK_RE,
  OWNER_RE,
  findInstructionRanges,
  type SectionKind,
  type SummaryItem,
  type SummarySection,
} from '../summaries/sections';
import { readClockTimes, resolveDue, withinDueBounds } from './due';
import { cleanTitle, expandSentence, groundTitle, hasBareHost, matchVerbatim, ownerPrefixed, type Span } from './grounding';
import { sentenceAnchorId } from './ids';
import type { ModelInput } from './payload';
import { NOT_A_NAME, STOPWORDS, TITLE_VERBS, collapseWhitespace, escapeRegExp, fold } from './text';

export { resolveDue, readClockTimes } from './due';
export { cleanTitle, defangLinks, expandSentence, groundTitle, hasBareHost, matchVerbatim, ownerPrefixed, type GroundingResult, type Span } from './grounding';

const ch = (code: number): string => String.fromCharCode(code);

// ---------------------------------------------------------------------------------------------
// The model's proposal (the propose_commitments tool's array entries)
// ---------------------------------------------------------------------------------------------

/** One entry of the tool call, read leniently (an entry that does not parse is dropped as 'invalid'). */
export const proposalSchema = z.object({
  anchor_id: z.string().min(1).max(64),
  quote: z.string().max(4000).nullable().catch(null),
  title: z.string().max(2000).nullable().catch(null),
  owner: z.string().max(500).nullable().catch(null),
  kind: z.enum(['action', 'waiting_on']).catch('action'),
  due_quote: z.string().max(1000).nullable().catch(null),
  due_date: z.string().max(40).nullable().catch(null),
  due_time: z.string().max(40).nullable().catch(null),
  confidence: z.number().catch(0),
});
export type Proposal = z.infer<typeof proposalSchema>;

// ---------------------------------------------------------------------------------------------
// The result
// ---------------------------------------------------------------------------------------------

export type CommitmentAnchorKind = 'item' | 'sentence';
export type OwnerRole = 'me' | 'other' | 'none';

export interface VerifiedDue {
  /** YYYY-MM-DD. */
  date: string;
  /** HH:MM, only from a clock form in the quote. */
  time: string | null;
  /** The due quote's offsets in the text (the summary's own words for the deadline). */
  quoteStart: number;
  quoteEnd: number;
}

/** A proposal that passed the checks (content: titles, owners and dates are sealed when stored). */
export interface VerifiedCommitment {
  anchorId: string;
  anchorKind: CommitmentAnchorKind;
  sectionId: string;
  sectionKind: SectionKind;
  sectionHeading: string | null;
  /** The quote is text.slice(quoteStart, quoteEnd): the whole item or the whole sentence. */
  quoteStart: number;
  quoteEnd: number;
  /** Cleaned, grounded (or the anchor's own words) and prefixed for someone else. */
  title: string;
  /** The title is the anchor's own words (the model's failed a check, or as written). */
  titleFromAnchor: boolean;
  /** The owner as written, or null. */
  owner: string | null;
  /** 'me' also for a first-name guess (flag owner_guess). */
  ownerRole: OwnerRole;
  due: VerifiedDue | null;
  kind: 'action' | 'waiting_on';
  /** 0 to 100; null for the items as written. */
  confidence: number | null;
  /** Code flags, in COMMITMENT_FLAGS order. similar_added is set at prepare, never here. */
  flags: CommitmentFlag[];
}

export type DropReason = 'invalid' | 'over_cap' | 'unknown_anchor' | 'duplicate_anchor' | 'quote_missing' | 'quote_not_found' | 'sentence_length' | 'empty_title';
export type ClearReason =
  | 'owner_not_in_text'
  | 'owner_not_a_name'
  | 'due_without_quote'
  | 'due_quote_not_found'
  | 'due_unread'
  | 'due_ambiguous'
  | 'due_disagrees'
  | 'due_out_of_bounds'
  | 'time_without_date'
  | 'time_without_clock'
  | 'time_disagrees';

/** Counts only (safe to log): never a title, quote, owner or date. */
export interface VerifyCounts {
  proposed: number;
  kept: number;
  dropped: Partial<Record<DropReason, number>>;
  cleared: Partial<Record<ClearReason, number>>;
  titleFallbacks: number;
  /** The model named another owner than the item's "(owner: ...)". */
  ownerReplaced: number;
}

function bump<K extends string>(record: Partial<Record<K, number>>, key: K): void {
  record[key] = (record[key] ?? 0) + 1;
}

// ---------------------------------------------------------------------------------------------
// Check 3: titles (the parser's markers; cleanTitle, groundTitle and ownerPrefixed are in grounding.ts)
// ---------------------------------------------------------------------------------------------

const OWNER_MARKER_RE = new RegExp(OWNER_RE.source, 'giu');
const DUE_PAREN_MARKER_RE = new RegExp(DUE_PAREN_RE.source, 'giu');
const DUE_INLINE_MARKER_RE = new RegExp(DUE_INLINE_RE.source, 'giu');
/** "(waiting on: Acme)", "(waiting for: Acme)", "(esperando a: Acme)", "(en espera de: Acme)". */
const WAITING_RE = /\((?:waiting[ \t]+(?:on|for)|esperando(?:[ \t]+a)?|en[ \t]+espera(?:[ \t]+de)?|pendiente[ \t]+de)[ \t]*:[ \t]*([^()\n]+?)[ \t]*\)/iu;
const WAITING_MARKER_RE = new RegExp(WAITING_RE.source, 'giu');

/** The name in a "(waiting on: Name)" marker, or null. */
export function waitedOnOf(text: string): string | null {
  const found = WAITING_RE.exec(text)?.[1]?.trim() ?? '';
  return found.length > 0 ? found : null;
}

/** The anchor's own words: the owner, waiting-on and due markers removed (section 2.5). */
export function stripItemMarkers(value: string): string {
  return value
    .replace(OWNER_MARKER_RE, ' ')
    .replace(WAITING_MARKER_RE, ' ')
    .replace(DUE_PAREN_MARKER_RE, ' ')
    .replace(DUE_INLINE_MARKER_RE, (found) => (/^[\s,;(|-]/.test(found) ? found[0] ?? ' ' : ' '));
}

// ---------------------------------------------------------------------------------------------
// Checks 4 and 5: owners
// ---------------------------------------------------------------------------------------------

function bareWord(word: string): string {
  return fold(word).replace(/[^\p{L}]+/gu, '');
}

/**
 * A span that can be a person: 1 to 5 words, each starting with a letter, at most 100 characters,
 * no digit, '@' or link, and neither a stopword, a title verb nor a collective word as its first
 * word or its last ("to", "the", "Confirm", "Team").
 */
export function isNameLike(span: string | null | undefined): boolean {
  if (typeof span !== 'string') return false;
  const value = collapseWhitespace(span);
  if (value.length === 0 || value.length > COMMITMENT_LIMITS.maxOwnerChars) return false;
  if (/\p{Nd}/u.test(value) || value.includes('@') || LINK_RE.test(value) || hasBareHost(value)) return false;
  const words = value.split(' ');
  if (words.length > 5) return false;
  if (!words.every((word) => /^\p{L}/u.test(word))) return false;
  const reject = (word: string | undefined): boolean => {
    const bare = bareWord(word ?? '');
    return bare.length === 0 || STOPWORDS.has(bare) || TITLE_VERBS.has(bare) || NOT_A_NAME.has(bare);
  };
  return !reject(words[0]) && !reject(words[words.length - 1]);
}

/** The owner span as written in `text` (word boundaries, case-insensitive), or null. */
export function findOwnerInText(owner: string, text: string): string | null {
  const wanted = collapseWhitespace(owner);
  if (wanted.length === 0) return null;
  const pattern = escapeRegExp(wanted).replace(/ /g, '\\s+');
  const found = new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, 'iu').exec(text);
  return found === null ? null : collapseWhitespace(found[0]);
}

function nameKey(value: string): string[] {
  return fold(value)
    .replace(/[^\p{L}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter((word) => word.length > 0);
}

/**
 * Whether the owner is the user (check 5), against users/{uid}.displayName and the Auth display
 * name (accents and case ignored):
 * - 'me': both have two or more words and one is the other's leading words ("Francisco Gomez"
 *   against "Francisco Gomez Ruiz");
 * - 'guess': a one-word owner equal to the user's first name ("Francisco" against "Francisco
 *   Gomez"), shown as "You? (the summary says: Francisco)", because a colleague with the same first
 *   name is common;
 * - 'other': anything else, also "Cristina Reyes Sierra" against "Cristina" (a fuller name is
 *   somebody else unless the user says so).
 */
export function ownerIsUser(owner: string, names: readonly (string | null | undefined)[]): 'me' | 'guess' | 'other' {
  const ownerWords = nameKey(owner);
  if (ownerWords.length === 0) return 'other';
  const userNames = names.filter((name): name is string => typeof name === 'string').map(nameKey).filter((words) => words.length > 0);
  for (const words of userNames) {
    if (ownerWords.length < 2 || words.length < 2) continue;
    const shorter = ownerWords.length <= words.length ? ownerWords : words;
    const longer = shorter === ownerWords ? words : ownerWords;
    if (shorter.every((word, index) => longer[index] === word)) return 'me';
  }
  if (ownerWords.length === 1 && userNames.some((words) => words[0] === ownerWords[0])) return 'guess';
  return 'other';
}

// ---------------------------------------------------------------------------------------------
// Check 8: flags
// ---------------------------------------------------------------------------------------------

const CURRENCY_SIGNS = [0x24, 0x20ac, 0xa3, 0xa5, 0x20b9, 0x20a9, 0x20bd, 0x20ba, 0x20b1].map(ch).join('');
const CURRENCY_AMOUNT_RE = new RegExp(`[${escapeRegExp(CURRENCY_SIGNS)}][ \\t]?\\p{Nd}|\\p{Nd}[\\p{Nd}.,]*[ \\t]?[${escapeRegExp(CURRENCY_SIGNS)}]`, 'u');
const CURRENCY_CODE_RE =
  /(?<![\p{L}])(?:usd|eur|gbp|mxn|cop|ars|clp|pen|brl|cad|aud|jpy|chf|inr|uyu|pyg|dop|gtq|crc)(?![\p{L}])[ \t]?\p{Nd}|\p{Nd}[\p{Nd}.,]*[ \t]?(?:usd|eur|gbp|mxn|cop|ars|clp|pen|brl|cad|aud|jpy|chf|inr|uyu|pyg|dop|gtq|crc)(?![\p{L}])/iu;
/** An IBAN shape: two letters, two digits, then 11 to 30 letters or digits (spaces allowed). */
const IBAN_RE = /(?<![\p{L}\p{N}])[a-z]{2}\p{Nd}{2}(?:[ \t]?[a-z0-9]){11,30}(?![\p{L}\p{N}])/iu;
/** A card or account number: 12 or more digits, single spaces or dashes allowed between groups. */
const LONG_NUMBER_RE = /(?<!\p{Nd})\p{Nd}(?:[ -]?\p{Nd}){11,}(?!\p{Nd})/u;
/** Payment and credential words, on the folded text (EN and ES). */
const PAYMENT_WORDS_RE =
  /(?<![\p{L}])(?:pay|pays|paid|paying|payment|payments|wire|wired|wiring|transfer|transfers|transferred|deposit|deposits|deposited|gift[ \t]+cards?|passwords?|passcodes?|pagar|pago|pagos|pague|paguen|transferir|transferencia|transferencias|depositar|deposito|depositos|tarjetas?[ \t]+de[ \t]+regalo|contrasenas?|claves?)(?![\p{L}])/u;
/** "PIN" written in capitals (a lowercase "pin" is usually the verb). */
const PIN_RE = /(?<![\p{L}])PIN(?![\p{L}])/u;

/** payment_like (finding 13): an amount, an account-like number, or a payment or credential word. */
export function isPaymentLike(value: string): boolean {
  const text = value.normalize('NFKC');
  return (
    CURRENCY_AMOUNT_RE.test(text) ||
    CURRENCY_CODE_RE.test(text) ||
    IBAN_RE.test(text) ||
    LONG_NUMBER_RE.test(text) ||
    PIN_RE.test(text) ||
    PAYMENT_WORDS_RE.test(fold(text))
  );
}

/** suggested (finding 14): the heading names a suggestion ("Suggested next steps", "Pasos siguientes sugeridos"). */
export function isSuggestedHeading(heading: string | null): boolean {
  if (heading === null) return false;
  const key = fold(heading);
  return key.includes('suggest') || key.includes('suger');
}

/** Flags in COMMITMENT_FLAGS order, deduplicated. */
export function orderedFlags(flags: Iterable<CommitmentFlag>): CommitmentFlag[] {
  const set = new Set(flags);
  return COMMITMENT_FLAGS.filter((flag) => set.has(flag));
}

interface FlagInput {
  anchorText: string;
  title: string;
  section: Pick<SummarySection, 'kind' | 'heading'>;
  /** The item, for an item anchor; null for a sentence. */
  item: Pick<SummaryItem, 'flags' | 'checked'> | null;
  /** A sentence anchor overlaps instruction-like text. */
  sentenceInstruction: boolean;
  ownerGuess: boolean;
}

function flagsOf(input: FlagInput): CommitmentFlag[] {
  const flags: CommitmentFlag[] = [];
  if (input.item !== null) flags.push(...input.item.flags);
  else {
    if (input.sentenceInstruction) flags.push('possible_instruction');
    if (LINK_RE.test(input.anchorText)) flags.push('has_link');
  }
  if (hasBareHost(input.anchorText)) flags.push('has_link');
  if (isPaymentLike(input.anchorText) || isPaymentLike(input.title)) flags.push('payment_like');
  if (isSuggestedHeading(input.section.heading)) flags.push('suggested');
  if (input.item !== null && input.item.checked === false && input.section.kind === 'custom') flags.push('checklist');
  if (input.ownerGuess) flags.push('owner_guess');
  return orderedFlags(flags);
}

// ---------------------------------------------------------------------------------------------
// Check 6: dues
// ---------------------------------------------------------------------------------------------

interface DueCheck {
  due: VerifiedDue | null;
  cleared: ClearReason[];
}

function checkDue(p: Proposal, text: string, anchor: Span, referenceDay: string, language: string | null): DueCheck {
  const cleared: ClearReason[] = [];
  if (p.due_date === null) {
    if (p.due_time !== null) cleared.push('time_without_date');
    return { due: null, cleared };
  }
  if (p.due_quote === null || p.due_quote.trim() === '') return { due: null, cleared: ['due_without_quote'] };
  const found = matchVerbatim(text.slice(anchor.start, anchor.end), p.due_quote);
  if (found === null) return { due: null, cleared: ['due_quote_not_found'] };
  const quoteStart = anchor.start + found.start;
  const quoteEnd = anchor.start + found.end;
  const words = text.slice(quoteStart, quoteEnd);
  const reading = resolveDue(words, referenceDay, language);
  if (reading.kind === 'ambiguous') return { due: null, cleared: ['due_ambiguous'] };
  if (reading.dates.length === 0) return { due: null, cleared: ['due_unread'] };
  if (!isLocalDate(p.due_date) || !reading.dates.includes(p.due_date)) return { due: null, cleared: ['due_disagrees'] };
  if (!withinDueBounds(p.due_date, referenceDay)) return { due: null, cleared: ['due_out_of_bounds'] };
  let time: string | null = null;
  if (p.due_time !== null) {
    const times = readClockTimes(words);
    if (times.length === 0) cleared.push('time_without_clock');
    else if (!isLocalTime(p.due_time) || !times.includes(p.due_time)) cleared.push('time_disagrees');
    else time = p.due_time;
  }
  return { due: { date: p.due_date, time, quoteStart, quoteEnd }, cleared };
}

// ---------------------------------------------------------------------------------------------
// verifyProposals
// ---------------------------------------------------------------------------------------------

export interface VerifyInput {
  /** The stored text: every offset points into it. */
  text: string;
  /** Its sections (parsed again in memory when the stored parser version is older). */
  sections: readonly SummarySection[];
  /** What the model was shown (payload.ts selectModelInput). */
  input: ModelInput;
  /** The tool call's commitments, unparsed. */
  proposals: readonly unknown[];
  /** YYYY-MM-DD the relative dates count from (due.ts referenceDayOf). */
  referenceDay: string;
  /** The summary's language (a free string), or null. */
  language: string | null;
  /** users/{uid}.displayName and the Auth display name (nulls skipped). */
  userNames: readonly (string | null | undefined)[];
  /** Test seam: COMMITMENT_LIMITS.maxProposals by default. */
  maxProposals?: number;
}

export interface VerifyResult {
  /** In document order. */
  commitments: VerifiedCommitment[];
  counts: VerifyCounts;
}

/** Most entries read from one tool call (the tool allows 30; anything past this is not even parsed). */
const MAX_ENTRIES_READ = 200;

interface ResolvedOwner {
  owner: string | null;
  role: OwnerRole;
  guess: boolean;
}

/** Checks 4 and 5 for one anchor; the parser's item.owner wins when present. */
export function resolveOwner(
  modelOwner: string | null,
  anchorText: string,
  itemOwner: string | null,
  userNames: readonly (string | null | undefined)[],
): ResolvedOwner & { replaced: boolean; cleared: ClearReason | null } {
  let owner: string | null = null;
  let replaced = false;
  let cleared: ClearReason | null = null;
  if (itemOwner !== null) {
    owner = isNameLike(itemOwner) ? collapseWhitespace(itemOwner) : null;
    replaced = modelOwner !== null && modelOwner.trim() !== '' && fold(collapseWhitespace(modelOwner)) !== fold(collapseWhitespace(itemOwner));
    if (owner === null) cleared = 'owner_not_a_name';
  } else if (modelOwner !== null && modelOwner.trim() !== '') {
    const span = findOwnerInText(modelOwner, anchorText);
    if (span === null) cleared = 'owner_not_in_text';
    else if (!isNameLike(span)) cleared = 'owner_not_a_name';
    else owner = span;
  }
  if (owner === null) return { owner: null, role: 'none', guess: false, replaced, cleared };
  const who = ownerIsUser(owner, userNames);
  return { owner, role: who === 'other' ? 'other' : 'me', guess: who === 'guess', replaced, cleared };
}

/** The title of a suggestion: the candidate when it is clean and grounded, else the anchor's own words. */
export function titleFor(candidate: string | null, anchorText: string, owner: ResolvedOwner): { title: string; fromAnchor: boolean } | null {
  const cleaned = candidate === null ? '' : cleanTitle(stripItemMarkers(candidate));
  let title = cleaned;
  let fromAnchor = false;
  if (cleaned.length === 0 || groundTitle(cleaned, anchorText) !== 'grounded') {
    title = cleanTitle(stripItemMarkers(anchorText));
    fromAnchor = true;
  }
  if (title.length === 0) return null;
  if (owner.role === 'other' && owner.owner !== null) title = ownerPrefixed(title, owner.owner);
  return { title, fromAnchor };
}

/** Runs checks 1 to 8 over the model's proposals (see the module comment). Never throws on model output. */
export function verifyProposals(input: VerifyInput): VerifyResult {
  const counts: VerifyCounts = { proposed: input.proposals.length, kept: 0, dropped: {}, cleared: {}, titleFallbacks: 0, ownerReplaced: 0 };
  const max = input.maxProposals ?? COMMITMENT_LIMITS.maxProposals;
  const text = input.text;

  const sectionsById = new Map(input.sections.map((section) => [section.id, section]));
  const itemsById = new Map<string, { item: SummaryItem; section: SummarySection }>();
  for (const section of input.sections) for (const item of section.items) itemsById.set(item.id, { item, section });
  const itemScope = new Set(input.input.items.map((item) => item.id));
  const proseScope = new Map(input.input.prose.map((prose) => [prose.id, prose]));
  let instructionRanges: Array<[number, number]> | null = null;

  const kept: VerifiedCommitment[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of input.proposals.entries()) {
    if (index >= MAX_ENTRIES_READ) {
      bump(counts.dropped, 'over_cap');
      continue;
    }
    const parsed = proposalSchema.safeParse(raw);
    if (!parsed.success) {
      bump(counts.dropped, 'invalid');
      continue;
    }
    const p = parsed.data;
    if (kept.length >= max) {
      bump(counts.dropped, 'over_cap');
      continue;
    }

    // Check 1 and 2: the anchor and its quote.
    let anchorKind: CommitmentAnchorKind;
    let anchor: Span;
    let anchorId: string;
    let section: SummarySection;
    let item: SummaryItem | null = null;
    const cited = itemScope.has(p.anchor_id) ? itemsById.get(p.anchor_id) : undefined;
    const prose = proseScope.get(p.anchor_id);
    if (cited !== undefined && !cited.section.derived) {
      anchorKind = 'item';
      item = cited.item;
      section = cited.section;
      anchor = { start: item.start, end: item.end };
      anchorId = item.id;
    } else if (prose !== undefined && sectionsById.get(prose.id) !== undefined) {
      section = sectionsById.get(prose.id) as SummarySection;
      if (p.quote === null || p.quote.trim() === '') {
        bump(counts.dropped, 'quote_missing');
        continue;
      }
      const found = matchVerbatim(text.slice(prose.start, prose.end), p.quote);
      if (found === null) {
        bump(counts.dropped, 'quote_not_found');
        continue;
      }
      anchor = expandSentence(text, { start: prose.start + found.start, end: prose.start + found.end }, prose.start, prose.end);
      const length = anchor.end - anchor.start;
      if (length < COMMITMENT_LIMITS.minSentenceQuoteChars || length > COMMITMENT_LIMITS.maxQuoteChars) {
        bump(counts.dropped, 'sentence_length');
        continue;
      }
      anchorKind = 'sentence';
      anchorId = sentenceAnchorId(section.id, anchor.start, anchor.end);
    } else {
      bump(counts.dropped, 'unknown_anchor');
      continue;
    }
    if (seen.has(anchorId)) {
      bump(counts.dropped, 'duplicate_anchor');
      continue;
    }

    const anchorText = text.slice(anchor.start, anchor.end);

    // Checks 4 and 5: the owner.
    const owner = resolveOwner(p.owner, anchorText, item?.owner ?? null, input.userNames);
    if (owner.replaced) counts.ownerReplaced += 1;
    if (owner.cleared !== null) bump(counts.cleared, owner.cleared);

    // Check 3: the title.
    const titled = titleFor(p.title, anchorText, owner);
    if (titled === null) {
      bump(counts.dropped, 'empty_title');
      continue;
    }
    if (titled.fromAnchor) counts.titleFallbacks += 1;

    // Check 6: the due date and time.
    const due = checkDue(p, text, anchor, input.referenceDay, input.language);
    for (const reason of due.cleared) bump(counts.cleared, reason);

    // Check 8: flags.
    let sentenceInstruction = false;
    if (anchorKind === 'sentence') {
      instructionRanges ??= findInstructionRanges(text);
      sentenceInstruction = instructionRanges.some(([a, b]) => a < anchor.end && b > anchor.start);
    }
    const flags = flagsOf({ anchorText, title: titled.title, section, item, sentenceInstruction, ownerGuess: owner.guess });

    // Check 7: confidence and kind.
    const confidence = Number.isFinite(p.confidence) ? Math.min(100, Math.max(0, Math.round(p.confidence))) : 0;

    seen.add(anchorId);
    kept.push({
      anchorId,
      anchorKind,
      sectionId: section.id,
      sectionKind: section.kind,
      sectionHeading: section.heading,
      quoteStart: anchor.start,
      quoteEnd: anchor.end,
      title: titled.title,
      titleFromAnchor: titled.fromAnchor,
      owner: owner.owner,
      ownerRole: owner.role,
      due: due.due,
      kind: p.kind,
      confidence,
      flags,
    });
  }
  counts.kept = kept.length;
  return { commitments: kept.sort((a, b) => a.quoteStart - b.quoteStart), counts };
}

// ---------------------------------------------------------------------------------------------
// Shared with asWritten.ts
// ---------------------------------------------------------------------------------------------

/** Flags of an item anchor without a model (asWritten.ts). */
export function itemFlagsOf(
  item: Pick<SummaryItem, 'flags' | 'checked'>,
  section: Pick<SummarySection, 'kind' | 'heading'>,
  anchorText: string,
  title: string,
  ownerGuess: boolean,
): CommitmentFlag[] {
  return flagsOf({ anchorText, title, section, item, sentenceInstruction: false, ownerGuess });
}

export { STOPWORDS, TITLE_VERBS };
