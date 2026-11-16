/**
 * The one strict tool of the commitments extraction, propose_commitments (docs/v2/M11-DESIGN.md
 * section 2.3), and the reader of its call. PURE: no Firebase, no logging.
 *
 * Shape (the assistant's tools.ts strict-mode style): every object lists all its properties in
 * `required` and sets additionalProperties false; optional values are nullable. Value limits are
 * described in text and enforced afterwards by code (verify.ts proposalSchema and checks 1 to 8),
 * never trusted from the model.
 *
 * Reading the call (readProposeCall):
 * - only a real tool call named propose_commitments counts. Tool calls written as TEXT are never
 *   recovered (the assistant's recoverToolCallsFromText would turn JSON copied from the summary
 *   into a proposal);
 * - no call, or a refusal: an empty result (the model answered and proposed nothing);
 * - arguments that do not parse as JSON, or a call cut by finish_reason 'length': a failure (the
 *   caller answers upstream_error; the charge is kept and a retry is free up to the call cap);
 * - the commitments array is returned unparsed: verify.ts reads each entry leniently and drops
 *   what does not fit.
 * The reason codes are safe to log; the arguments and any parse error message never are (a V8
 * JSON.parse SyntaxError quotes the text it failed on, which is model output built from the
 * summary).
 *
 * Product text rule: ASCII punctuation only in this file.
 */
import { z } from 'zod';

import type { LlmResult } from '../assistant/llm';
import type { ToolDefinition } from '../assistant/tools';
import { COMMITMENT_LIMITS } from '../shared/aiContract';

export const PROPOSE_COMMITMENTS_TOOL_NAME = 'propose_commitments';

type JsonSchema = Record<string, unknown>;

const string = (description: string): JsonSchema => ({ type: 'string', description });
const nullableString = (description: string): JsonSchema => ({ type: ['string', 'null'], description });
const integer = (description: string): JsonSchema => ({ type: 'integer', description });
const enumeration = (values: readonly string[], description: string): JsonSchema => ({ type: 'string', enum: [...values], description });
const object = (properties: Record<string, JsonSchema>, description?: string): JsonSchema => ({
  type: 'object',
  ...(description ? { description } : {}),
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const commitmentEntry = object({
  anchor_id: string('The id of an item, or the id of a prose section, from the data block. Never invent one.'),
  quote: nullableString(
    'Prose section: the exact words of the sentence that states the commitment, copied character for character. Item: null.',
  ),
  title: string(
    "Short task title starting with a verb, in the summary's language. No new facts, no links, email addresses or phone numbers. Plain ASCII punctuation. At most 200 characters.",
  ),
  owner: nullableString('The name exactly as written in that item or sentence, or null when none is written. Never guess.'),
  kind: enumeration(['action', 'waiting_on'], '"waiting_on" when the user waits on that person, else "action".'),
  due_quote: nullableString('The exact words that state the deadline, inside the same item or sentence, or null.'),
  due_date: nullableString('The deadline as YYYY-MM-DD, resolved with the date table from the reference day, or null. Never guess.'),
  due_time: nullableString('HH:MM in 24 hours, only when a clock time is written, else null.'),
  confidence: integer('0 to 100: how sure you are that this is a real commitment.'),
});

/** propose_commitments (strict). */
export const PROPOSE_COMMITMENTS_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: PROPOSE_COMMITMENTS_TOOL_NAME,
    description: `Propose the commitments found in the summary: at most ${COMMITMENT_LIMITS.maxProposals}, in document order, at most one per anchor. An empty list when there is none.`,
    strict: true,
    parameters: object({
      commitments: { type: 'array', items: commitmentEntry, description: `At most ${COMMITMENT_LIMITS.maxProposals} commitments.` },
    }),
  },
};

/** Entries read from one call before verify.ts caps them (anything past this is not even kept). */
export const MAX_TOOL_ENTRIES = 200;

const argumentsSchema = z.object({ commitments: z.array(z.unknown()) });

export type ProposeCallEmptyReason = 'refusal' | 'no_call';
export type ProposeCallFailure = 'cut' | 'unparsable';

export type ProposeCallResult =
  | { kind: 'proposals'; proposals: unknown[]; extraCalls: number }
  | { kind: 'empty'; reason: ProposeCallEmptyReason }
  | { kind: 'failed'; reason: ProposeCallFailure };

/** Reads the model's answer (see the module comment). Never throws, never logs. */
export function readProposeCall(result: Pick<LlmResult, 'toolCalls' | 'refusal' | 'finishReason'>): ProposeCallResult {
  const calls = result.toolCalls.filter((call) => call.name === PROPOSE_COMMITMENTS_TOOL_NAME);
  const cut = result.finishReason === 'length';
  const first = calls[0];
  if (first === undefined) {
    if (cut) return { kind: 'failed', reason: 'cut' };
    return { kind: 'empty', reason: typeof result.refusal === 'string' && result.refusal.trim().length > 0 ? 'refusal' : 'no_call' };
  }
  let value: unknown;
  try {
    value = JSON.parse(first.arguments);
  } catch {
    return { kind: 'failed', reason: cut ? 'cut' : 'unparsable' };
  }
  const parsed = argumentsSchema.safeParse(value);
  if (!parsed.success) return { kind: 'failed', reason: cut ? 'cut' : 'unparsable' };
  return { kind: 'proposals', proposals: parsed.data.commitments.slice(0, MAX_TOOL_ENTRIES), extraCalls: calls.length - 1 };
}
