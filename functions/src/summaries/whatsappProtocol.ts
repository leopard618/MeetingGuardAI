/**
 * The protocol between the WhatsApp webhook and the private summaryWhatsApp worker
 * (docs/v2/M11-DESIGN.md sections 4.1 to 4.3; section 15 findings 4, 9, 10, 12 and 25). PURE: zod,
 * node:crypto and the contract only. The webhook side (functions/src/whatsapp/summaryPort.ts and
 * summaryRoute.ts) and the session (whatsapp/session.ts) import this file, so it must never import
 * the sealing code, the data key, the reader or anything that opens a summary.
 *
 * - The webhook sends {op 'offer'} when a linked pilot user writes "commitments" (or "compromisos"),
 *   and {op 'reply', offer, selection} for a reply to a live offer. The worker resolves the uid from
 *   whatsappLinks/{phone} itself; nothing in the request names a uid.
 * - The worker answers the text to send, the buttons (only when something is marked) and what to do
 *   with the stored offer (set, refresh, clear or keep).
 * - The stored offer (whatsappSessions/{phone}.summaryOffer) holds ids only: the summary id, the
 *   extraction key, the shown anchors by their stable numbers, which numbers were marked and open,
 *   and whether the reply AI is offered. Never a title, a quote, a name or a date.
 *
 * Product text rule: ASCII punctuation only in this file.
 */
import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  COMMITMENT_LIMITS,
  WHATSAPP_PHONE_PATTERN,
  commitmentAnchorIdSchema,
  commitmentKeySchema,
  isoDateTimeSchema,
  languageSchema,
  summaryIdSchema,
} from '../shared/aiContract';
import { MAX_BUTTONS, MAX_BUTTON_TITLE_CHARS, MAX_INTERACTIVE_BODY_CHARS, MAX_TEXT_CHARS } from '../whatsapp/send';

/** The worker's function name (its URL ends with it). */
export const SUMMARY_WHATSAPP_FUNCTION = 'summaryWhatsApp';

/** Button ids: the prefix and the offer id (interactive.button_reply.id comes back as written). */
export const SUMMARY_ALL_BUTTON_PREFIX = 'wa_sum_all:';
export const SUMMARY_NONE_BUTTON_PREFIX = 'wa_sum_none:';

const HEX16 = /^[0-9a-f]{16}$/;

/** The first 16 hex of sha256 of the uid: an offer made for another uid is refused (relink). */
export function uidTagOf(uid: string): string {
  return createHash('sha256').update(uid, 'utf8').digest('hex').slice(0, 16);
}

const numberSchema = z.number().int().min(1).max(999);

/**
 * Whether the reply AI is offered: 'none' (the list is the AI list), 'offered' (the items as written,
 * the message carries the AI notice: the reply AI prepares with OpenAI, one AI action the first
 * time), 'prepared' (the items as written while an AI list of the same text already exists: the reply
 * AI shows it, no model call).
 */
export const SUMMARY_OFFER_AI_STATES = ['none', 'offered', 'prepared'] as const;
export type SummaryOfferAi = (typeof SUMMARY_OFFER_AI_STATES)[number];

/** whatsappSessions/{phone}.summaryOffer: ids only (see the module comment). */
export const summaryOfferSchema = z.object({
  offerId: z.string().regex(HEX16),
  uidTag: z.string().regex(HEX16),
  summaryId: summaryIdSchema,
  /** The extraction key the list was made from (decide answers stale for an old one). */
  key: commitmentKeySchema,
  /** Every numbered line the message showed: its stable number and its anchor id. */
  anchors: z.array(z.object({ n: numberSchema, a: commitmentAnchorIdSchema })).max(COMMITMENT_LIMITS.maxProposals),
  /** Numbers shown marked [x] (ALL adds these). */
  marked: z.array(numberSchema).max(COMMITMENT_LIMITS.maxProposals),
  /** Numbers shown open (NONE drops these). */
  open: z.array(numberSchema).max(COMMITMENT_LIMITS.maxProposals),
  ai: z.enum(SUMMARY_OFFER_AI_STATES),
  expiresAt: isoDateTimeSchema,
});
export type SummaryOffer = z.infer<typeof summaryOfferSchema>;

/** The stored offer, or null for none or a shape this version does not know. */
export function parseSummaryOffer(raw: unknown): SummaryOffer | null {
  if (raw === null || raw === undefined) return null;
  const parsed = summaryOfferSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Whether the offer still lives at `now` for this uid. */
export function isLiveOffer(offer: SummaryOffer | null, uid: string, now: Date): offer is SummaryOffer {
  if (offer === null) return false;
  const expires = Date.parse(offer.expiresAt);
  return Number.isFinite(expires) && expires > now.getTime() && offer.uidTag === uidTagOf(uid);
}

/** A reply to a live offer, as the webhook read it (NO, CANCEL and CANCELAR never reach the worker). */
export const summarySelectionSchema = z.discriminatedUnion('kind', [
  /** ALL or TODOS, or the "Add marked" button: the marked numbers of the offer. */
  z.object({ kind: z.literal('all') }),
  /** "1 3", "1,3", "1 y 3": add those. */
  z.object({ kind: z.literal('numbers'), numbers: z.array(numberSchema).min(1).max(COMMITMENT_LIMITS.maxDecisionsPerCall) }),
  /** DROP or QUITAR plus numbers. */
  z.object({ kind: z.literal('drop'), numbers: z.array(numberSchema).min(1).max(COMMITMENT_LIMITS.maxDecisionsPerCall) }),
  /** NONE or NINGUNO, or the "None" button: drops every open line shown (restorable in the app). */
  z.object({ kind: z.literal('none') }),
  /** AI or IA, only while the offer offers it. */
  z.object({ kind: z.literal('ai') }),
]);
export type SummarySelection = z.infer<typeof summarySelectionSchema>;

const phoneSchema = z.string().regex(WHATSAPP_PHONE_PATTERN);

export const summaryWhatsAppRequestSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('offer'), phoneE164: phoneSchema, language: languageSchema }),
  z.object({ op: z.literal('reply'), phoneE164: phoneSchema, language: languageSchema, offer: summaryOfferSchema, selection: summarySelectionSchema }),
]);
export type SummaryWhatsAppRequest = z.infer<typeof summaryWhatsAppRequestSchema>;

/** What a worker answer did (logged by both sides; never content). */
export const SUMMARY_WHATSAPP_OUTCOMES = [
  'offered',
  'nothing_to_offer',
  'no_summary',
  'preparing',
  'offer_cap',
  'decided',
  'nothing_marked',
  'unknown_numbers',
  'stale',
  'expired',
  'wrong_account',
  'not_found',
  'quota_exceeded',
  'ai_unavailable',
  'ai_empty',
  'not_enabled',
  'not_linked',
  'not_allowed',
  'unavailable',
] as const;
export type SummaryWhatsAppOutcome = (typeof SUMMARY_WHATSAPP_OUTCOMES)[number];

const buttonSchema = z.object({ id: z.string().min(1).max(256), title: z.string().min(1).max(MAX_BUTTON_TITLE_CHARS) });

export const summaryWhatsAppResponseSchema = z.object({
  outcome: z.enum(SUMMARY_WHATSAPP_OUTCOMES),
  /** The message to send (our text is ASCII; titles and quotes from the summary verbatim, one line each). */
  text: z.string().min(1).max(MAX_TEXT_CHARS),
  /** Sent after the text, only when something is marked. */
  buttons: z
    .object({ body: z.string().min(1).max(MAX_INTERACTIVE_BODY_CHARS), items: z.array(buttonSchema).min(1).max(MAX_BUTTONS) })
    .nullable(),
  /**
   * set: arm this new offer (and disarm any pending proposal in the same write). refresh: replace the
   * stored offer only while it is still this offerId. clear: remove the stored offer only while it is
   * still the one the request named. keep: leave it.
   */
  offer: z.discriminatedUnion('action', [
    z.object({ action: z.literal('set'), offer: summaryOfferSchema }),
    z.object({ action: z.literal('refresh'), offer: summaryOfferSchema }),
    z.object({ action: z.literal('clear') }),
    z.object({ action: z.literal('keep') }),
  ]),
});
export type SummaryWhatsAppResponse = z.infer<typeof summaryWhatsAppResponseSchema>;
