/**
 * The stored extraction of a summary's commitments (docs/v2/M11-DESIGN.md sections 2.6, 2.7, 3.4
 * and 3.5; section 13 hazards 6, 8, 9, 10 and 25; section 15 findings 8, 15, 20, 21 and 27). PURE:
 * zod and node:crypto (through sealed.ts and commitments/ids.ts) only; no Firebase, no logging, no
 * clock (callers pass `now`). The transactions that write it are in ./commitmentsStore.ts.
 *
 * users/{uid}/meetingSummaries/{id}.extraction, the reserved top-level field (model.ts,
 * z.unknown().nullable(), so deployed M10 code parses any value). Plaintext structure only (ids,
 * offsets, states, task ids, keyed digests, stamps, counts); titles, owner names and dates are
 * content and live in one sealed blob per view, sealed with SUMMARY_CONTENT_PURPOSE and the AAD
 * summaryAad(ref) + ':extraction', so a blob moved to another user or summary fails to open.
 *
 *   v 1
 *   state, key, mode, preparedAt, counts {open, accepted, dropped}   the view in use (mode), read
 *                                                                    by summaryRead lists through a
 *                                                                    field mask (extraction.ts)
 *   contentDigest, parserVersion (in use), extractorVersion          the stamp of the views
 *   views {ai, as_written}   each null or {key, state, preparedAt, model, truncated, matchStamp,
 *                            preselect (as last shown), items[] (plaintext), sealed}
 *   decisions[]              by anchorKey, shared by both views and carried over to a new
 *                            extraction: {k, t, s, taskId, gen, at, fd, via, qs, qe}
 *   calls {n, digest, extractorVersion} | null    model calls for this content and extractor
 *   charge {at, dayKey, charges} | null           the one AI action of this summary
 *   lease {until, id} | null                      one AI preparation at a time
 *   updatedAt
 *
 * The extraction differs from the design's field list in one way, on purpose: the item statuses
 * are not inside items[] but in decisions[], keyed by the anchorKey. Both views (the AI list and
 * the items as written) then share one decision per line, an AI result is kept when the user
 * switches to the items as written (no model call when switching back), and a stale extraction
 * hands its decisions to the next one without copying them between lists.
 *
 * Validity: the views are current only while contentDigest, the parser version in use and
 * EXTRACTOR_VERSION match (commitments/extraction.ts isCurrentStamp); otherwise the answer is
 * 'stale' and prepare builds a new one, carrying every decision over by anchorKey (under every key
 * of the keyring, so a rotation loses nothing), and, while the text is the same (a parser or
 * extractor bump), an accepted line whose offsets overlap a new item by half or more.
 *
 * Product text rule: ASCII punctuation only in this file.
 */
import { z } from 'zod';

import {
  COMMITMENT_ANCHOR_KINDS,
  COMMITMENT_CHANNELS,
  COMMITMENT_FLAGS,
  COMMITMENT_LIMITS,
  COMMITMENT_MODES,
  COMMITMENT_STATUSES,
  SUMMARY_LIMITS,
  SUMMARY_SECTION_KINDS,
  commitmentAnchorIdSchema,
  commitmentFlagsSchema,
  commitmentKeySchema,
  commitmentPreselectSchema,
  isoDateTimeSchema,
  localDateKeySchema,
  localTimeKeySchema,
  meetingIdSchema,
  type CommitmentChannel,
  type CommitmentFlag,
  type CommitmentItem,
  type CommitmentMode,
  type CommitmentPreselect,
  type CommitmentStatus,
} from '../shared/aiContract';
import { isValidTimeZone } from '../shared/time';
import { SUMMARY_CONTENT_PURPOSE, SealedError, open, seal, summaryAad, type Keyring } from '../shared/sealed';
import { isOverdue } from '../commitments/due';
import { EXTRACTION_SCHEMA_VERSION, EXTRACTOR_VERSION, parserVersionInUse } from '../commitments/extraction';
import { anchorKeyCandidates, anchorKeyOf, anchorOccurrence, commitmentTaskId, textKeyCandidates, textKeyOf } from '../commitments/ids';
import { itemPreselect } from '../commitments/preselect';
import { fold, isCheckableWord, wordsOf } from '../commitments/text';
import type { VerifiedCommitment } from '../commitments/verify';
import type { SummaryRef } from './model';
import { sliceSafe } from './sanitize';
import type { SummarySection } from './sections';

// ---------------------------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------------------------

/** Decisions kept in one extraction: both views' lines plus accepted lines an upgrade removed. */
export const MAX_STORED_DECISIONS = 120;
/** A suggestion's generation: Undo and "Add again" each add one. */
export const MAX_GENERATION = 999;
/** The stored model name (OPENAI_MODEL; never a secret). */
const MAX_MODEL_NAME_CHARS = 100;

const HEX16 = /^[0-9a-f]{16}$/;
const HEX24 = /^[0-9a-f]{24}$/;
const SECTION_ID = /^s_[0-9a-f]{12}$/;
const LEASE_ID = /^[0-9a-f]{16,64}$/;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

const offset = z.number().int().min(0).max(SUMMARY_LIMITS.maxTextChars);
const countField = z.number().int().min(0).max(COMMITMENT_LIMITS.maxProposals);

// ---------------------------------------------------------------------------------------------
// Stored shapes
// ---------------------------------------------------------------------------------------------

/** One suggestion of a view (plaintext structure; its title, owner and date are in the view's blob). */
export const storedCommitmentItemSchema = z.object({
  /** anchorId: the summary item id, or 'q_' + 12 hex for a sentence. */
  a: commitmentAnchorIdSchema,
  ak: z.enum(COMMITMENT_ANCHOR_KINDS),
  /** anchorKey (24 hex, keyed digest of the anchor text and its occurrence). */
  k: z.string().regex(HEX24),
  /** textKey (24 hex, keyed digest of the meeting and the anchor text): the same line in another summary. */
  t: z.string().regex(HEX24),
  /** The stable 1-based number in this view, never reused (WhatsApp replies name it). */
  n: z.number().int().min(1).max(999),
  s: z.string().regex(SECTION_ID),
  sk: z.enum(SUMMARY_SECTION_KINDS),
  /** The quote is text.slice(qs, qe): the whole item or the whole sentence. */
  qs: offset,
  qe: offset,
  kind: z.enum(['action', 'waiting_on']),
  owner: z.enum(['me', 'other', 'none']),
  due: z.enum(['summary', 'none']),
  /** The due quote's offsets (the summary's own words for the deadline), or null. */
  dqs: offset.nullable(),
  dqe: offset.nullable(),
  conf: z.number().int().min(0).max(100).nullable(),
  /** Code flags; a value a later server adds is dropped here, never a failed parse. */
  flags: commitmentFlagsSchema,
  /** The title is the anchor's own words (the model's failed a check, or as written). */
  tfa: z.boolean(),
});
export type StoredCommitmentItem = z.infer<typeof storedCommitmentItemSchema>;

export const matchStampSchema = z.object({ meetingId: meetingIdSchema.nullable(), occurrenceDate: localDateKeySchema.nullable() });
export type MatchStamp = z.infer<typeof matchStampSchema>;

export const storedViewSchema = z.object({
  key: commitmentKeySchema,
  state: z.enum(['ready', 'empty']),
  preparedAt: isoDateTimeSchema,
  model: z.string().max(MAX_MODEL_NAME_CHARS).nullable(),
  truncated: z.boolean(),
  matchStamp: matchStampSchema,
  /** As last shown at preparation (logs and tests); get computes it again from the current trust facts. */
  preselect: commitmentPreselectSchema,
  items: z.array(storedCommitmentItemSchema).max(COMMITMENT_LIMITS.maxProposals),
  /** seal of {items: SealedViewItem[]} in item order; null for an empty view. */
  sealed: z.string().min(1).nullable(),
});
export type StoredView = z.infer<typeof storedViewSchema>;

export const storedDecisionSchema = z.object({
  k: z.string().regex(HEX24),
  t: z.string().regex(HEX24).nullable(),
  s: z.enum(COMMITMENT_STATUSES),
  /** accepted: the task's id ('sm_' + 32 hex); else null. */
  taskId: meetingIdSchema.nullable(),
  gen: z.number().int().min(0).max(MAX_GENERATION),
  at: isoDateTimeSchema.nullable(),
  /** accepted: 16 hex of the keyed digest of the task fields decide wrote (Undo); else null. */
  fd: z.string().regex(HEX16).nullable(),
  via: z.enum(COMMITMENT_CHANNELS).nullable(),
  /** The anchor's offsets when decided (offset carry-over after a parser bump of the same text). */
  qs: offset.nullable(),
  qe: offset.nullable(),
});
export type StoredDecision = z.infer<typeof storedDecisionSchema>;

const quotaChargesSchema = z.object({ day: z.boolean(), intro: z.boolean(), cycle: isoDateTimeSchema.nullable() });

/**
 * Loose on purpose: a field a later day adds (the WhatsApp worker's offers counter, section 4.3)
 * is kept through every read-modify-write of this version instead of making the whole field
 * unreadable (which would rebuild it and lose the decisions).
 */
export const storedExtractionSchema = z.looseObject({
  v: z.literal(EXTRACTION_SCHEMA_VERSION),
  state: z.enum(['ready', 'empty']).nullable(),
  key: commitmentKeySchema.nullable(),
  mode: z.enum(COMMITMENT_MODES).nullable(),
  preparedAt: isoDateTimeSchema.nullable(),
  contentDigest: z.string().min(1).max(128),
  parserVersion: z.number().int().min(0),
  extractorVersion: z.number().int().min(0),
  counts: z.object({ open: countField, accepted: countField, dropped: countField }),
  views: z.object({ ai: storedViewSchema.nullable(), as_written: storedViewSchema.nullable() }),
  decisions: z.array(storedDecisionSchema).max(MAX_STORED_DECISIONS),
  calls: z.object({ n: z.number().int().min(0), digest: z.string().min(1).max(128), extractorVersion: z.number().int().min(0) }).nullable(),
  charge: z.object({ at: isoDateTimeSchema, dayKey: z.string().regex(DAY_KEY), charges: quotaChargesSchema }).nullable(),
  lease: z.object({ until: isoDateTimeSchema, id: z.string().regex(LEASE_ID) }).nullable(),
  updatedAt: isoDateTimeSchema,
});
export type StoredExtraction = z.infer<typeof storedExtractionSchema>;

/** The stored extraction, or null for none or a shape this version does not know (it is then rebuilt). */
export function parseExtraction(raw: unknown): StoredExtraction | null {
  if (raw === null || raw === undefined) return null;
  const parsed = storedExtractionSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** The summary facts the stamp is compared with (the stored parser version, not the one in use). */
export interface SummaryStamp {
  contentDigest: string;
  parserVersion: number;
}

/** Whether the views describe this summary (content, parser in use, extractor). */
export function isCurrent(extraction: Pick<StoredExtraction, 'contentDigest' | 'parserVersion' | 'extractorVersion'>, summary: SummaryStamp): boolean {
  return (
    extraction.contentDigest === summary.contentDigest &&
    extraction.parserVersion === parserVersionInUse(summary.parserVersion) &&
    extraction.extractorVersion === EXTRACTOR_VERSION
  );
}

/** The view in use, or null. */
export function viewInUse(extraction: StoredExtraction | null): StoredView | null {
  if (extraction === null || extraction.mode === null) return null;
  return extraction.views[extraction.mode];
}

/** True while another preparation holds the lease. */
export function leaseAlive(extraction: StoredExtraction | null, now: Date, ownId: string | null = null): boolean {
  const lease = extraction?.lease ?? null;
  if (lease === null || lease.id === ownId) return false;
  return Date.parse(lease.until) > now.getTime();
}

/** Model calls already made for this content digest and extractor version. */
export function callsFor(extraction: StoredExtraction | null, contentDigest: string): number {
  const calls = extraction?.calls ?? null;
  if (calls === null || calls.digest !== contentDigest || calls.extractorVersion !== EXTRACTOR_VERSION) return 0;
  return calls.n;
}

/** An extraction with no view yet (written by the first lease). */
export function emptyExtraction(summary: SummaryStamp, now: Date): StoredExtraction {
  return {
    v: EXTRACTION_SCHEMA_VERSION,
    state: null,
    key: null,
    mode: null,
    preparedAt: null,
    contentDigest: summary.contentDigest,
    parserVersion: parserVersionInUse(summary.parserVersion),
    extractorVersion: EXTRACTOR_VERSION,
    counts: { open: 0, accepted: 0, dropped: 0 },
    views: { ai: null, as_written: null },
    decisions: [],
    calls: null,
    charge: null,
    lease: null,
    updatedAt: now.toISOString(),
  };
}

// ---------------------------------------------------------------------------------------------
// Decisions and counts
// ---------------------------------------------------------------------------------------------

/** The decision of a line, or null (an open line nobody touched). */
export function decisionOf(decisions: readonly StoredDecision[], anchorKey: string): StoredDecision | null {
  return decisions.find((decision) => decision.k === anchorKey) ?? null;
}

export function statusOf(decisions: readonly StoredDecision[], anchorKey: string): CommitmentStatus {
  return decisionOf(decisions, anchorKey)?.s ?? 'open';
}

export function countsOf(view: StoredView | null, decisions: readonly StoredDecision[]): StoredExtraction['counts'] {
  const counts = { open: 0, accepted: 0, dropped: 0 };
  for (const item of view?.items ?? []) counts[statusOf(decisions, item.k)] += 1;
  return counts;
}

/** The top-level mirror of the view in use (what lists read). */
export function mirrored(extraction: StoredExtraction): StoredExtraction {
  const view = viewInUse(extraction);
  if (view === null) return { ...extraction, state: null, key: null, preparedAt: null, counts: { open: 0, accepted: 0, dropped: 0 } };
  return { ...extraction, state: view.state, key: view.key, preparedAt: view.preparedAt, counts: countsOf(view, extraction.decisions) };
}

const STATUS_RANK: Readonly<Record<CommitmentStatus, number>> = { accepted: 3, dropped: 2, open: 1 };

/** The stronger of two decisions for one line (accepted over dropped over open, then the higher generation). */
function stronger(a: StoredDecision, b: StoredDecision): StoredDecision {
  const rank = STATUS_RANK[a.s] - STATUS_RANK[b.s];
  if (rank !== 0) return rank > 0 ? a : b;
  return b.gen > a.gen ? b : a;
}

/** One decision per anchorKey; open lines at generation 0 carry nothing and are left out. */
export function compactDecisions(decisions: readonly StoredDecision[], referenced: ReadonlySet<string>): StoredDecision[] {
  const byKey = new Map<string, StoredDecision>();
  for (const decision of decisions) {
    const known = byKey.get(decision.k);
    byKey.set(decision.k, known === undefined ? decision : stronger(known, decision));
  }
  const kept = [...byKey.values()].filter((decision) => !(decision.s === 'open' && decision.gen === 0));
  // Lines of the views first, then accepted lines an upgrade removed (newest first), then the rest.
  const weight = (decision: StoredDecision): number => (referenced.has(decision.k) ? 0 : decision.s === 'accepted' ? 1 : 2);
  kept.sort((a, b) => weight(a) - weight(b) || (b.at ?? '').localeCompare(a.at ?? ''));
  return kept.slice(0, MAX_STORED_DECISIONS);
}

/** Replaces (or adds) the decision of one line. */
export function withDecision(decisions: readonly StoredDecision[], next: StoredDecision): StoredDecision[] {
  return [...decisions.filter((decision) => decision.k !== next.k), next];
}

/** The task id of a line at its generation (commitments/ids.ts commitmentTaskId). */
export function taskIdOf(summaryId: string, anchorKey: string, gen: number): string {
  return commitmentTaskId(summaryId, anchorKey, gen);
}

// ---------------------------------------------------------------------------------------------
// Sealing
// ---------------------------------------------------------------------------------------------

/** What a view's blob holds per item, in item order. */
export interface SealedViewItem {
  a: string;
  title: string;
  owner: string | null;
  dueDate: string | null;
  dueTime: string | null;
}

const sealedViewSchema = z.object({
  items: z
    .array(
      z.object({
        a: commitmentAnchorIdSchema,
        title: z.string().min(1).max(COMMITMENT_LIMITS.maxTitleChars),
        owner: z.string().min(1).max(COMMITMENT_LIMITS.maxOwnerChars).nullable(),
        dueDate: localDateKeySchema.nullable(),
        dueTime: localTimeKeySchema.nullable(),
      }),
    )
    .max(COMMITMENT_LIMITS.maxProposals),
});

/** The AAD of every extraction blob of one summary. */
export function extractionAad(ref: SummaryRef): string {
  return `${summaryAad(ref)}:extraction`;
}

/** Seals a view's content; null for an empty view. Throws SealedError for a bad keyring or ref. */
export function sealView(keyring: Keyring, ref: SummaryRef, items: readonly SealedViewItem[]): string | null {
  if (items.length === 0) return null;
  const checked = sealedViewSchema.safeParse({ items });
  if (!checked.success) throw new Error('summaries.commitments: a view does not match the sealed schema');
  return seal(keyring, SUMMARY_CONTENT_PURPOSE, JSON.stringify(checked.data), extractionAad(ref));
}

/**
 * Opens a view's content, in item order. Throws SealedError: open_failed for another summary's or
 * user's blob, blob_malformed when the content does not parse or does not list the view's items.
 */
export function openView(keyring: Keyring, ref: SummaryRef, view: StoredView): SealedViewItem[] {
  if (view.sealed === null) {
    if (view.items.length > 0) throw new SealedError('blob_malformed', 'sealed extraction is missing');
    return [];
  }
  const plaintext = open(keyring, SUMMARY_CONTENT_PURPOSE, view.sealed, extractionAad(ref));
  let value: unknown;
  try {
    value = JSON.parse(plaintext);
  } catch {
    throw new SealedError('blob_malformed', 'sealed extraction is not valid');
  }
  const parsed = sealedViewSchema.safeParse(value);
  if (!parsed.success) throw new SealedError('blob_malformed', 'sealed extraction is not valid');
  const items = parsed.data.items;
  if (items.length !== view.items.length || items.some((item, index) => item.a !== view.items[index]?.a)) {
    throw new SealedError('blob_malformed', 'sealed extraction does not match its items');
  }
  return items;
}

// ---------------------------------------------------------------------------------------------
// Building a view (prepare)
// ---------------------------------------------------------------------------------------------

/** A title and owner of an accepted line of the earlier copy (after an upgrade in place). */
export interface EarlierAccepted {
  title: string;
  owner: string | null;
}

export interface NextExtractionInput {
  keyring: Keyring;
  ref: SummaryRef;
  /** The stored text every offset points into. */
  text: string;
  /** The summary as read in the final transaction. */
  summary: SummaryStamp;
  /** The extraction as read in the final transaction (null for none). */
  previous: StoredExtraction | null;
  mode: CommitmentMode;
  /** commitments/extraction key of the new view. */
  key: string;
  verified: readonly VerifiedCommitment[];
  /** The match's meeting (textKey scope), null for a kept summary. */
  meetingId: string | null;
  now: Date;
  model: string | null;
  truncated: boolean;
  matchStamp: MatchStamp;
  preselect: CommitmentPreselect;
  /** textKeys accepted in OTHER summaries of the same meeting (any key of the ring). */
  similarTextKeys: ReadonlySet<string>;
  /** This preparation's lease, released by the write (null when it took none). */
  leaseId: string | null;
}

export interface NextExtraction {
  extraction: StoredExtraction;
  /** Decisions carried over from a stale extraction (by key or by offsets), for the logs. */
  carried: number;
  /** Items marked similar_added. */
  similar: number;
}

interface Located {
  text: string;
  occurrence: number;
}

function locate(text: string, start: number, end: number): Located {
  return { text: text.slice(start, end), occurrence: anchorOccurrence(text, start, end) };
}

/** Moves every decision whose key is one of `candidates` onto candidates[0] (the primary). */
function rekey(decisions: StoredDecision[], candidates: readonly string[]): boolean {
  const primary = candidates[0];
  if (primary === undefined) return false;
  let found = false;
  for (let index = 0; index < decisions.length; index += 1) {
    const decision = decisions[index] as StoredDecision;
    if (candidates.includes(decision.k)) {
      found = true;
      if (decision.k !== primary) decisions[index] = { ...decision, k: primary };
    }
  }
  return found;
}

function overlapShare(decision: StoredDecision, start: number, end: number): number {
  if (decision.qs === null || decision.qe === null || decision.qe <= decision.qs) return 0;
  const overlap = Math.min(decision.qe, end) - Math.max(decision.qs, start);
  return overlap <= 0 ? 0 : overlap / (decision.qe - decision.qs);
}

function checkableWords(value: string): Set<string> {
  return new Set(wordsOf(value).filter(isCheckableWord));
}

/** Word overlap of two titles: shared 3+ letter words over the larger set (0 when either has none). */
export function titleOverlap(a: string, b: string): number {
  const left = checkableWords(a);
  const right = checkableWords(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / Math.max(left.size, right.size);
}

const SIMILAR_TITLE_SHARE = 0.6;

function sameOwner(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return fold(a).trim() === fold(b).trim();
}

/**
 * Accepted lines of an earlier copy whose task no new line carried over to: their title and owner
 * from the old views' blobs (opened at re-preparation). An old blob that does not open gives none.
 */
function earlierAcceptedOf(
  keyring: Keyring,
  ref: SummaryRef,
  previous: StoredExtraction,
  orphans: readonly StoredDecision[],
): EarlierAccepted[] {
  const wanted = new Set(orphans.map((decision) => decision.k));
  const out: EarlierAccepted[] = [];
  for (const view of [previous.views.ai, previous.views.as_written]) {
    if (view === null || view.items.length === 0) continue;
    let sealed: SealedViewItem[];
    try {
      sealed = openView(keyring, ref, view);
    } catch {
      continue;
    }
    view.items.forEach((item, index) => {
      const content = sealed[index];
      if (content !== undefined && wanted.has(item.k)) out.push({ title: content.title, owner: content.owner });
    });
  }
  return out;
}

function withFlag(flags: readonly CommitmentFlag[], flag: CommitmentFlag): CommitmentFlag[] {
  if (flags.includes(flag)) return [...flags];
  const set = new Set<CommitmentFlag>([...flags, flag]);
  return COMMITMENT_FLAGS.filter((value) => set.has(value));
}

/**
 * The extraction after a preparation wrote `verified` as the view of `mode` (see the module
 * comment). The other view is kept while the stamp is current; decisions are re-keyed to the
 * primary key and carried over; the lease of this preparation is released.
 */
export function nextExtraction(input: NextExtractionInput): NextExtraction {
  const { keyring, ref, text, previous, now } = input;
  const summaryId = ref.summaryId;
  const sameStamp = previous !== null && isCurrent(previous, input.summary);
  const sameText = previous !== null && previous.contentDigest === input.summary.contentDigest;
  const decisions: StoredDecision[] = [...(previous?.decisions ?? [])];

  // The other view survives while it still describes this text; its keys move to the primary key.
  const other: CommitmentMode = input.mode === 'ai' ? 'as_written' : 'ai';
  let kept: StoredView | null = sameStamp && previous !== null ? previous.views[other] : null;
  if (kept !== null) {
    kept = {
      ...kept,
      items: kept.items.map((item) => {
        const at = locate(text, item.qs, item.qe);
        const candidates = anchorKeyCandidates(keyring, summaryId, at.text, at.occurrence);
        rekey(decisions, candidates);
        return { ...item, k: candidates[0] ?? item.k };
      }),
    };
  }

  // The new view's lines, keyed under the primary key; decisions follow by key.
  const built = input.verified.map((commitment, index) => {
    const at = locate(text, commitment.quoteStart, commitment.quoteEnd);
    const candidates = anchorKeyCandidates(keyring, summaryId, at.text, at.occurrence);
    const k = candidates[0] ?? anchorKeyOf(keyring, summaryId, at.text, at.occurrence);
    const matched = rekey(decisions, candidates);
    return { commitment, index, k, matched, anchorText: at.text };
  });

  // Offset carry-over while the text is the same (a parser bump that cuts a line differently).
  const viewKeys = new Set<string>([...built.map((entry) => entry.k), ...(kept?.items.map((item) => item.k) ?? [])]);
  if (sameText && !sameStamp) {
    for (const entry of built) {
      if (entry.matched || decisionOf(decisions, entry.k) !== null) continue;
      const candidate = decisions.find(
        (decision) =>
          decision.s === 'accepted' && !viewKeys.has(decision.k) && overlapShare(decision, entry.commitment.quoteStart, entry.commitment.quoteEnd) >= 0.5,
      );
      if (candidate !== undefined) {
        const index = decisions.indexOf(candidate);
        decisions[index] = { ...candidate, k: entry.k, qs: entry.commitment.quoteStart, qe: entry.commitment.quoteEnd };
        entry.matched = true;
        viewKeys.add(entry.k);
      }
    }
  }
  const carried = sameStamp ? 0 : built.filter((entry) => statusOf(decisions, entry.k) !== 'open').length;

  // Duplicates the ids cannot see (marks only, never blocks).
  const orphans = decisions.filter((decision) => decision.s === 'accepted' && !viewKeys.has(decision.k));
  const earlier = previous !== null && !sameText && orphans.length > 0 ? earlierAcceptedOf(keyring, ref, previous, orphans) : [];
  let similar = 0;
  const items: StoredCommitmentItem[] = [];
  const sealedItems: SealedViewItem[] = [];
  for (const entry of built) {
    const c = entry.commitment;
    const t = textKeyOf(keyring, input.meetingId, entry.anchorText);
    let flags: CommitmentFlag[] = [...c.flags];
    if (statusOf(decisions, entry.k) === 'open') {
      const elsewhere = input.similarTextKeys.size > 0 && textKeyCandidates(keyring, input.meetingId, entry.anchorText).some((key) => input.similarTextKeys.has(key));
      const earlierCopy = earlier.some((old) => sameOwner(old.owner, c.owner) && titleOverlap(old.title, c.title) >= SIMILAR_TITLE_SHARE);
      if (elsewhere || earlierCopy) {
        flags = withFlag(flags, 'similar_added');
        similar += 1;
      }
    }
    items.push({
      a: c.anchorId,
      ak: c.anchorKind,
      k: entry.k,
      t,
      n: entry.index + 1,
      s: c.sectionId,
      sk: c.sectionKind,
      qs: c.quoteStart,
      qe: c.quoteEnd,
      kind: c.kind,
      owner: c.ownerRole,
      due: c.due === null ? 'none' : 'summary',
      dqs: c.due === null ? null : c.due.quoteStart,
      dqe: c.due === null ? null : c.due.quoteEnd,
      conf: c.confidence,
      flags,
      tfa: c.titleFromAnchor,
    });
    sealedItems.push({
      a: c.anchorId,
      title: c.title,
      owner: c.owner === null ? null : sliceSafe(c.owner, COMMITMENT_LIMITS.maxOwnerChars),
      dueDate: c.due?.date ?? null,
      dueTime: c.due?.time ?? null,
    });
  }

  const view: StoredView = {
    key: input.key,
    state: items.length > 0 ? 'ready' : 'empty',
    preparedAt: now.toISOString(),
    model: input.model === null ? null : sliceSafe(input.model, MAX_MODEL_NAME_CHARS),
    truncated: input.truncated,
    matchStamp: input.matchStamp,
    preselect: input.preselect,
    items,
    sealed: sealView(keyring, ref, sealedItems),
  };
  const views: StoredExtraction['views'] = input.mode === 'ai' ? { ai: view, as_written: kept } : { ai: kept, as_written: view };
  const referenced = new Set<string>([...items.map((item) => item.k), ...(kept?.items.map((item) => item.k) ?? [])]);
  const base = previous ?? emptyExtraction(input.summary, now);
  const lease = base.lease !== null && base.lease.id === input.leaseId ? null : base.lease;
  const extraction = mirrored({
    ...base,
    v: EXTRACTION_SCHEMA_VERSION,
    mode: input.mode,
    contentDigest: input.summary.contentDigest,
    parserVersion: parserVersionInUse(input.summary.parserVersion),
    extractorVersion: EXTRACTOR_VERSION,
    views,
    decisions: compactDecisions(decisions, referenced),
    lease,
    updatedAt: now.toISOString(),
  });
  return { extraction, carried, similar };
}

/** The extraction with `mode` in use (its view exists and is current); the counts follow. */
export function switchedTo(extraction: StoredExtraction, mode: CommitmentMode, now: Date): StoredExtraction {
  return mirrored({ ...extraction, mode, updatedAt: now.toISOString() });
}

// ---------------------------------------------------------------------------------------------
// The contract view (get, prepare and decide answers)
// ---------------------------------------------------------------------------------------------

export interface ContractItemsInput {
  view: StoredView;
  sealed: readonly SealedViewItem[];
  decisions: readonly StoredDecision[];
  /** The stored text (the view is current or the text is the same: the offsets point into it). */
  text: string;
  /** The sections in use, for the headings (a heading not found reads null). */
  sections: readonly Pick<SummarySection, 'id' | 'heading'>[];
  preselect: CommitmentPreselect;
  minConfidence: number;
  /** A stated time is in the meeting's zone; null for a kept summary or an unknown zone. */
  meetingZone: string | null;
  /** The zone "overdue" is judged in (the meeting's, else the preferences zone, else UTC). */
  overdueZone: string | null;
  /** Accepted task ids that still exist (one getAll at get time); null when not read. */
  existingTasks: ReadonlySet<string> | null;
  now: Date;
  /** false: the view is stale (read-only), nothing is pre-selected. */
  current: boolean;
}

function quoteOf(text: string, start: number | null, end: number | null, max: number): string | null {
  if (start === null || end === null || end <= start || end > text.length) return null;
  const quote = text.slice(start, end);
  return quote.trim().length === 0 || quote.length > max ? null : quote;
}

/** The suggestions in the contract shape (CommitmentItem[]), in document order. */
export function contractItemsOf(input: ContractItemsInput): CommitmentItem[] {
  const headings = new Map(input.sections.map((section) => [section.id, section.heading]));
  const zone = input.meetingZone !== null && isValidTimeZone(input.meetingZone) ? input.meetingZone : null;
  const out: CommitmentItem[] = [];
  input.view.items.forEach((item, index) => {
    const content = input.sealed[index];
    const quote = quoteOf(input.text, item.qs, item.qe, SUMMARY_LIMITS.maxItemChars);
    if (content === undefined || quote === null) return;
    const decision = decisionOf(input.decisions, item.k);
    const status = decision?.s ?? 'open';
    const flags = [...item.flags];
    const pre = itemPreselect(
      { anchorKind: item.ak, sectionKind: item.sk, flags, confidence: item.conf, status },
      input.preselect,
      input.minConfidence,
    );
    const heading = headings.get(item.s) ?? null;
    const accepted = status === 'accepted' && decision !== null && decision.taskId !== null;
    out.push({
      anchorId: item.a,
      number: item.n,
      anchorKind: item.ak,
      sectionKind: item.sk,
      sectionHeading: heading === null ? null : sliceSafe(heading, SUMMARY_LIMITS.maxHeadingChars),
      quote,
      title: content.title,
      owner: content.owner === null ? null : { name: content.owner, isUser: item.owner === 'me', guess: flags.includes('owner_guess') },
      due:
        content.dueDate === null
          ? null
          : {
              date: content.dueDate,
              time: content.dueTime,
              zone: content.dueTime === null ? null : zone,
              quote: quoteOf(input.text, item.dqs, item.dqe, COMMITMENT_LIMITS.maxQuoteChars),
              overdue: isOverdue(content.dueDate, input.overdueZone, input.now),
            },
      confidence: item.conf,
      flags,
      preselected: input.current && pre.preselected,
      status,
      taskId: accepted ? decision.taskId : null,
      taskExists: accepted ? (input.existingTasks === null ? true : input.existingTasks.has(decision.taskId as string)) : null,
      via: accepted ? decision.via : null,
    });
  });
  return out;
}

/** The accepted task ids of a view (get reads whether they still exist). */
export function acceptedTaskIds(view: StoredView | null, decisions: readonly StoredDecision[]): string[] {
  const ids: string[] = [];
  for (const item of view?.items ?? []) {
    const decision = decisionOf(decisions, item.k);
    if (decision !== null && decision.s === 'accepted' && decision.taskId !== null) ids.push(decision.taskId);
  }
  return ids;
}

/** A decision recorded by decide. */
export function decided(
  base: StoredDecision | null,
  next: { k: string; t: string | null; s: CommitmentStatus; taskId: string | null; gen: number; fd: string | null; via: CommitmentChannel | null; qs: number; qe: number },
  now: Date,
): StoredDecision {
  return {
    k: next.k,
    t: next.t ?? base?.t ?? null,
    s: next.s,
    taskId: next.taskId,
    gen: Math.min(MAX_GENERATION, next.gen),
    at: now.toISOString(),
    fd: next.fd,
    via: next.via,
    qs: next.qs,
    qe: next.qe,
  };
}
