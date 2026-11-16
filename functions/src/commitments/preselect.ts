/**
 * Pre-selection (docs/v2/M11-DESIGN.md decision 9, section 2.6; section 15 findings 13, 14 and
 * 27). PURE. Computed when get answers, from the trust facts the loader returns at that moment,
 * never stored at preparation: an upgrade in place that keeps the bytes but raises the row (a hand
 * forward replaced by the vendor's identical copy) changes the ticks without a model call.
 *
 * Summary level (trustRowOf):
 * | Row                                              | Pre-selected | Select all | Reason               |
 * | 7: vendor signed, bound, fresh, no instruction   | per item     | yes        | none                 |
 * | 8: vendor signed, bound, not fresh               | nothing      | yes        | old_summary          |
 * | 9: vendor signed, not addressed to the user      | nothing      | NO         | not_addressed_to_you |
 * | 10: forwarded by hand                            | nothing      | yes        | forwarded            |
 * | any other row with possibleInstruction           | nothing      | yes (*)    | possible_instruction |
 * (*) "Select all" never ticks an item flagged possible_instruction (selectAllTargets). Row 9 keeps
 * its own reason and no "Select all" even with instruction-like text: whose meeting it is comes
 * first.
 *
 * Item level, only where the summary allows it: an item anchor (never a sentence) of action_items,
 * next_steps or waiting_on, still open, without the flags possible_instruction, has_link,
 * truncated, payment_like, suggested, checklist or similar_added (owner_guess does not block), with
 * a confidence of at least 60 (the items as written have none and pass). The owner does not matter
 * (decision 10). The reason an item stays unticked is for its chip, the logs and the tests.
 *
 * Product text rule: ASCII punctuation only in this file.
 */
import type { CommitmentFlag, CommitmentPreselect, CommitmentPreselectReason, CommitmentStatus } from '../shared/aiContract';
import { trustRowOf, type SummaryTrust } from '../summaries/model';
import type { SectionKind } from '../summaries/sections';
import { ACTION_LIST_KINDS } from './payload';
import type { CommitmentAnchorKind } from './verify';

/** COMMITMENTS_TUNING.preselectMinConfidence's default (config.ts carries the deployed value). */
export const DEFAULT_PRESELECT_MIN_CONFIDENCE = 60;

/** The flags that keep an item unticked, in the order their reason is reported. */
const BLOCKING_FLAGS = [
  'possible_instruction',
  'payment_like',
  'suggested',
  'checklist',
  'similar_added',
  'has_link',
  'truncated',
] as const satisfies readonly CommitmentFlag[];

/** The summary-level row of the table above. */
export function summaryPreselect(trust: Pick<SummaryTrust, 'tier' | 'recipientBound' | 'fresh'>, possibleInstruction: boolean): CommitmentPreselect {
  const row = trustRowOf(trust);
  if (row === 9) return { allowed: false, selectAll: false, reason: 'not_addressed_to_you' };
  if (possibleInstruction) return { allowed: false, selectAll: true, reason: 'possible_instruction' };
  const reasons: Readonly<Record<7 | 8 | 10, CommitmentPreselectReason | null>> = { 7: null, 8: 'old_summary', 10: 'forwarded' };
  const reason = reasons[row];
  return { allowed: reason === null, selectAll: true, reason };
}

export type UntickReason =
  | 'summary'
  | 'not_open'
  | 'sentence'
  | 'section'
  | 'low_confidence'
  | 'possible_instruction'
  | 'payment_like'
  | 'suggested'
  | 'checklist'
  | 'similar_added'
  | 'has_link'
  | 'truncated';

export interface PreselectItem {
  anchorKind: CommitmentAnchorKind;
  sectionKind: SectionKind;
  flags: readonly CommitmentFlag[];
  /** null for the items as written (always enough). */
  confidence: number | null;
  /** Default open (a freshly prepared suggestion). */
  status?: CommitmentStatus;
}

/** Whether one suggestion is ticked when the screen opens, and if not, why. */
export function itemPreselect(
  item: PreselectItem,
  summary: CommitmentPreselect,
  minConfidence: number = DEFAULT_PRESELECT_MIN_CONFIDENCE,
): { preselected: boolean; reason: UntickReason | null } {
  if ((item.status ?? 'open') !== 'open') return { preselected: false, reason: 'not_open' };
  const flag = BLOCKING_FLAGS.find((blocking) => item.flags.includes(blocking));
  if (flag !== undefined) return { preselected: false, reason: flag };
  if (item.anchorKind !== 'item') return { preselected: false, reason: 'sentence' };
  if (!ACTION_LIST_KINDS.has(item.sectionKind)) return { preselected: false, reason: 'section' };
  if (item.confidence !== null && item.confidence < minConfidence) return { preselected: false, reason: 'low_confidence' };
  if (!summary.allowed) return { preselected: false, reason: 'summary' };
  return { preselected: true, reason: null };
}

/**
 * What "Select all" ticks: nothing on row 9 (no Select all), otherwise every open suggestion except
 * those flagged possible_instruction. Returns the indexes of `items`.
 */
export function selectAllTargets(items: readonly Pick<PreselectItem, 'flags' | 'status'>[], summary: CommitmentPreselect): number[] {
  if (!summary.selectAll) return [];
  const out: number[] = [];
  items.forEach((item, index) => {
    if ((item.status ?? 'open') === 'open' && !item.flags.includes('possible_instruction')) out.push(index);
  });
  return out;
}
