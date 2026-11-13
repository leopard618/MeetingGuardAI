/**
 * Scoring for the commitments eval over ten synthetic recaps (docs/v2/M11-DESIGN.md section 8
 * "Eval", section 10 day 5). PURE: no Firebase, no network, no logging. The script
 * scripts/eval-commitments.mjs loads the compiled copy from lib/ (after `npm run build`), runs the
 * real prompt, the real model and the real checks, and prints what this module counts; the unit
 * test runs the same pipeline offline with a "perfect model" (perfectProposals) so the fixtures
 * and the scoring stay consistent. Nothing in the functions entry point imports this file.
 *
 * Pass, per recap: every expected (not optional) commitment proposed and kept, with its owner and
 * date when the fixture states them; nothing from a forbidden text (a TLDR, an update); no link,
 * email address or phone number in any title; the flags the fixture names. Reported, not judged:
 * the share of titles that fell back to the anchor's own words (to tune the verb list on data),
 * finish_reason 'length', and the tokens.
 *
 * Product text rule: ASCII punctuation only in this file.
 */
import { z } from 'zod';

import { COMMITMENT_FLAGS } from '../shared/aiContract';
import { LINK_RE, type SummarySection } from '../summaries/sections';
import { collapseWhitespace, fold } from './text';
import { hasBareHost, type VerifiedCommitment, type VerifyCounts } from './verify';

// ---------------------------------------------------------------------------------------------
// The fixture file (scripts/eval-commitments/recaps.json)
// ---------------------------------------------------------------------------------------------

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const evalExpectedSchema = z.object({
  /** Words of the anchor (item text or sentence), whitespace-insensitive: which commitment this is. */
  match: z.string().min(3),
  /** The owner the suggestion must carry (null: none); absent: not checked. */
  owner: z.string().nullable().optional(),
  /** The deadline words the perfect model cites. */
  dueQuote: z.string().min(1).optional(),
  /** The date the perfect model sends when it differs from the expected one (a wrong guess the checks must clear). */
  modelDueDate: isoDay.optional(),
  /** The date the suggestion must carry after the checks (null: none); absent: not checked. */
  dueDate: isoDay.nullable().optional(),
  /** One of these dates ("next Friday", "next week"). */
  dueDateOneOf: z.array(isoDay).min(1).optional(),
  kind: z.enum(['action', 'waiting_on']).optional(),
  /** Flags the suggestion must carry when it is proposed. */
  flags: z.array(z.enum(COMMITMENT_FLAGS)).optional(),
  /** A good model may leave it out (checked only when proposed). */
  optional: z.boolean().optional(),
});
export type EvalExpected = z.infer<typeof evalExpectedSchema>;

export const evalRecapSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]{1,40}$/),
  language: z.enum(['en', 'es']),
  description: z.string(),
  meeting: z
    .object({ title: z.string().min(1), startAt: z.string().min(1), timezone: z.string().min(1), occurrenceDate: isoDay.nullable() })
    .nullable(),
  summaryDate: isoDay.nullable(),
  userNames: z.array(z.string()),
  lines: z.array(z.string()).min(1),
  expected: z.array(evalExpectedSchema),
  /** Texts no suggestion may quote. */
  forbidden: z.array(z.string().min(3)),
});
export type EvalRecap = z.infer<typeof evalRecapSchema>;

export const evalFileSchema = z.object({ version: z.literal(1), note: z.string().optional(), recaps: z.array(evalRecapSchema).min(1) });
export type EvalFile = z.infer<typeof evalFileSchema>;

/** The recaps of the fixture file; throws on a file that does not match. */
export function parseEvalFile(raw: unknown): EvalRecap[] {
  return evalFileSchema.parse(raw).recaps;
}

/** The recap's text (the lines joined as the parser receives them). */
export function recapText(recap: EvalRecap): string {
  return recap.lines.join('\n');
}

// ---------------------------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------------------------

function key(value: string): string {
  return fold(collapseWhitespace(value));
}

const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
/** 7 or more digits with spaces, dots, dashes or parentheses between them (dates are not titles' business here). */
const PHONE_RE = /\+?\(?\d(?:[\d\s().-]*\d){6,}/;

/** A title that still carries a link, an email address, a phone-like run or a bare host name. */
export function titleHasContact(title: string): boolean {
  return LINK_RE.test(title) || EMAIL_RE.test(title) || hasBareHost(title) || PHONE_RE.test(title.replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' '));
}

export interface EvalRun {
  /** The stored text the offsets point into. */
  text: string;
  /** verifyProposals' result (or the items as written). */
  commitments: readonly VerifiedCommitment[];
  counts: VerifyCounts | null;
  /** The model call failed or its output could not be read (a reason code), else null. */
  failure: string | null;
  finishReason: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
}

export interface ExpectationResult {
  /** 1-based position in the fixture's expected list (the script prints positions, not text). */
  index: number;
  optional: boolean;
  found: boolean;
  ownerOk: boolean | null;
  dueOk: boolean | null;
  kindOk: boolean | null;
  flagsOk: boolean | null;
}

export interface EvalScore {
  id: string;
  language: 'en' | 'es';
  proposed: number;
  kept: number;
  dropped: Partial<Record<string, number>>;
  cleared: Partial<Record<string, number>>;
  titleFallbacks: number;
  ownerReplaced: number;
  expected: number;
  found: number;
  missing: number[];
  wrongOwner: number[];
  wrongDue: number[];
  wrongKind: number[];
  missingFlags: number[];
  forbiddenHits: number;
  titlesWithContact: number;
  failure: string | null;
  finishReason: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  pass: boolean;
}

function quoteOf(text: string, commitment: VerifiedCommitment): string {
  return text.slice(commitment.quoteStart, commitment.quoteEnd);
}

function expectationResult(text: string, commitments: readonly VerifiedCommitment[], expected: EvalExpected, index: number): ExpectationResult {
  const wanted = key(expected.match);
  const hit = commitments.find((commitment) => key(quoteOf(text, commitment)).includes(wanted));
  const optional = expected.optional === true;
  if (hit === undefined) return { index, optional, found: false, ownerOk: null, dueOk: null, kindOk: null, flagsOk: null };
  let ownerOk: boolean | null = null;
  if (expected.owner !== undefined) ownerOk = expected.owner === null ? hit.owner === null : hit.owner !== null && key(hit.owner) === key(expected.owner);
  let dueOk: boolean | null = null;
  if (expected.dueDateOneOf !== undefined) dueOk = hit.due !== null && expected.dueDateOneOf.includes(hit.due.date);
  else if (expected.dueDate !== undefined) dueOk = expected.dueDate === null ? hit.due === null : hit.due?.date === expected.dueDate;
  const kindOk = expected.kind === undefined ? null : hit.kind === expected.kind;
  const flagsOk = expected.flags === undefined ? null : expected.flags.every((flag) => hit.flags.includes(flag));
  return { index, optional, found: true, ownerOk, dueOk, kindOk, flagsOk };
}

/** One recap's score (see the module comment). Counts and positions only. */
export function scoreRecap(recap: EvalRecap, run: EvalRun): EvalScore {
  const results = recap.expected.map((expected, index) => expectationResult(run.text, run.commitments, expected, index + 1));
  const required = results.filter((result) => !result.optional);
  const forbidden = recap.forbidden.map(key);
  const forbiddenHits = run.commitments.filter((commitment) => forbidden.some((text) => key(quoteOf(run.text, commitment)).includes(text))).length;
  const titlesWithContact = run.commitments.filter((commitment) => titleHasContact(commitment.title)).length;
  const missing = required.filter((result) => !result.found).map((result) => result.index);
  const wrongOwner = results.filter((result) => result.ownerOk === false).map((result) => result.index);
  const wrongDue = results.filter((result) => result.dueOk === false).map((result) => result.index);
  const wrongKind = results.filter((result) => result.kindOk === false).map((result) => result.index);
  const missingFlags = results.filter((result) => result.flagsOk === false).map((result) => result.index);
  const pass =
    run.failure === null &&
    missing.length === 0 &&
    wrongOwner.length === 0 &&
    wrongDue.length === 0 &&
    wrongKind.length === 0 &&
    missingFlags.length === 0 &&
    forbiddenHits === 0 &&
    titlesWithContact === 0;
  return {
    id: recap.id,
    language: recap.language,
    proposed: run.counts?.proposed ?? run.commitments.length,
    kept: run.counts?.kept ?? run.commitments.length,
    dropped: { ...(run.counts?.dropped ?? {}) },
    cleared: { ...(run.counts?.cleared ?? {}) },
    titleFallbacks: run.counts?.titleFallbacks ?? run.commitments.filter((commitment) => commitment.titleFromAnchor).length,
    ownerReplaced: run.counts?.ownerReplaced ?? 0,
    expected: required.length,
    found: required.filter((result) => result.found).length,
    missing,
    wrongOwner,
    wrongDue,
    wrongKind,
    missingFlags,
    forbiddenHits,
    titlesWithContact,
    failure: run.failure,
    finishReason: run.finishReason,
    promptTokens: run.promptTokens,
    completionTokens: run.completionTokens,
    pass,
  };
}

export interface EvalSummary {
  recaps: number;
  passed: number;
  proposed: number;
  kept: number;
  titleFallbacks: number;
  /** titleFallbacks / kept (0 when nothing was kept). */
  fallbackShare: number;
  lengthFinishes: number;
  failures: number;
  promptTokens: number;
  completionTokens: number;
}

export function summarizeScores(scores: readonly EvalScore[]): EvalSummary {
  const sum = (pick: (score: EvalScore) => number): number => scores.reduce((total, score) => total + pick(score), 0);
  const kept = sum((score) => score.kept);
  const titleFallbacks = sum((score) => score.titleFallbacks);
  return {
    recaps: scores.length,
    passed: scores.filter((score) => score.pass).length,
    proposed: sum((score) => score.proposed),
    kept,
    titleFallbacks,
    fallbackShare: kept === 0 ? 0 : titleFallbacks / kept,
    lengthFinishes: scores.filter((score) => score.finishReason === 'length').length,
    failures: scores.filter((score) => score.failure !== null).length,
    promptTokens: sum((score) => score.promptTokens ?? 0),
    completionTokens: sum((score) => score.completionTokens ?? 0),
  };
}

// ---------------------------------------------------------------------------------------------
// The perfect model (offline self-check of the fixtures)
// ---------------------------------------------------------------------------------------------

/**
 * The proposals an ideal model would make for the recap's expected commitments: the item id (or
 * the prose section id with the matched words as the quote), the anchor's words as the title, the
 * fixture's owner, due words and date. An expectation that matches nothing is left out (the test
 * then reports it missing).
 */
export function perfectProposals(recap: EvalRecap, text: string, sections: readonly SummarySection[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const expected of recap.expected) {
    const wanted = key(expected.match);
    const base = {
      owner: expected.owner ?? null,
      kind: expected.kind ?? 'action',
      due_quote: expected.dueQuote ?? null,
      due_date: expected.modelDueDate ?? expected.dueDate ?? expected.dueDateOneOf?.[0] ?? null,
      due_time: null,
      confidence: 90,
    };
    const item = sections.filter((section) => !section.derived).flatMap((section) => section.items).find((entry) => key(entry.text).includes(wanted));
    if (item !== undefined) {
      out.push({ anchor_id: item.id, quote: null, title: item.text, ...base });
      continue;
    }
    const prose = sections.find((section) => !section.derived && section.items.length === 0 && key(text.slice(section.start, section.end)).includes(wanted));
    if (prose !== undefined) out.push({ anchor_id: prose.id, quote: expected.match, title: expected.match, ...base });
  }
  return out;
}
