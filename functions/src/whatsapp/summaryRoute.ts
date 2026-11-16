/**
 * The webhook's routing of suggested tasks (docs/v2/M11-DESIGN.md section 4.1; section 15 findings
 * 9, 10 and 25; section 13 hazards 34 to 37). Called by webhook.ts processInboundMessage for linked
 * users only, and only while WebhookDeps.summaries exists (SUMMARIES_ENABLED at load).
 *
 * - Pilot users only (allowed(uid), read per message). Everyone else, and these words from non-pilot
 *   users, reach the assistant exactly as before: both functions answer false and change nothing.
 * - Trigger: "commitments" or "compromisos" (also "tasks from my summary", "tareas de mi minuta");
 *   M12: pt "compromissos" ("tarefas do meu resumo"), fr "engagements" ("taches de mon compte
 *   rendu"), de "zusagen" ("aufgaben aus meinem protokoll"). Every language's words work for every
 *   user. Exact phrases after normalizing (lowercase, accents and a trailing . ! or ? removed, spaces
 *   collapsed). The worker answers the list and the offer to store.
 * - While an offer lives (its own expiresAt, made for this uid): ALL (TODOS, TODAS, TOUS, TOUTES,
 *   ALLE), numbers ("1 3", "1,3", "1 y 3", "1 e 3", "1 et 3", "1 und 3"), DROP (QUITAR, REMOVER,
 *   TIRAR, RETIRER, SUPPRIMER, ENTFERNEN) plus numbers, NONE (NINGUNO, NENHUMA, AUCUNE, KEINE), and
 *   AI (IA, KI) when the offer offers it, go to the worker. NO, CANCEL, CANCELAR, NAO, NON, ANNULER,
 *   NEIN and ABBRECHEN close the offer here and change nothing. The words of whatsappRender.ts
 *   footers must stay in these sets (test/unit/whatsappSummaryRoute.test.ts checks it).
 *   ALL with nothing marked answers "Nothing is marked" without a call. Any other text leaves the
 *   offer alone and goes to the assistant. A bare "2" is item 2: no pending proposal can be armed
 *   while an offer is (each arming write clears the other).
 * - Nothing of this exchange enters session.turns (finding 9): this file never calls saveTurns,
 *   pushTurn or the assistant, and writes only session.summaryOffer (SummaryOfferStore).
 * - The offer is stored before its text is sent; a text that cannot be sent disarms it again, so a
 *   stray later "1" can never act on a list the user never saw. The buttons follow the text; a
 *   failed button send is logged and dropped (the text carries the same replies).
 * Logs: `whatsapp.summary` {uid, wamid, op, kind, outcome, offer}; never text, titles or numbers.
 */
import * as logger from 'firebase-functions/logger';

import type { AppLanguage } from '../shared/aiContract';
import {
  SUMMARY_ALL_BUTTON_PREFIX,
  SUMMARY_NONE_BUTTON_PREFIX,
  isLiveOffer,
  type SummaryOffer,
  type SummarySelection,
  type SummaryWhatsAppRequest,
} from '../summaries/whatsappProtocol';
import { summaryBotStrings } from './messages';
import type { WhatsappSender } from './send';
import type { WhatsappSession } from './session';
import { phoneLogId } from './signature';
import { portTimeoutMs, type SummaryRouteDeps } from './summaryPort';
import type { InboundMessage } from './webhook';

// ---------------------------------------------------------------------------------------------
// Reading the text
// ---------------------------------------------------------------------------------------------

const COMBINING_MARKS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, 'g');

/** Lowercase, accents removed, spaces collapsed, a trailing . ! or ? removed. */
export function normalizeSummaryText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(/\s+/g, ' ')
    .replace(/[.!?]+$/, '')
    .trim();
}

/** The phrases that ask for the suggested tasks (EN, ES, PT, FR, DE), normalized. */
export const SUMMARY_TRIGGER_PHRASES: ReadonlySet<string> = new Set([
  'commitments',
  'compromisos',
  'tasks from my summary',
  'tareas de mi minuta',
  // M12: pt-BR, fr, de (accents are removed before the lookup).
  'compromissos',
  'tarefas do meu resumo',
  'engagements',
  'taches de mon compte rendu',
  'zusagen',
  'aufgaben aus meinem protokoll',
]);

export function isSummaryTrigger(text: string): boolean {
  return SUMMARY_TRIGGER_PHRASES.has(normalizeSummaryText(text));
}

export type SummaryReply =
  | { kind: 'close' }
  | { kind: 'all' }
  | { kind: 'none' }
  | { kind: 'ai' }
  | { kind: 'numbers'; numbers: number[] }
  | { kind: 'drop'; numbers: number[] };

// M12: the pt, fr and de words are folded like the text (lowercase, no accents: 'nao' is "nao").
// 'non' and 'nein' act only while an offer lives, exactly like 'no'.
export const ALL_WORDS: ReadonlySet<string> = new Set(['all', 'todos', 'todas', 'tous', 'toutes', 'alle']);
export const NONE_WORDS: ReadonlySet<string> = new Set(['none', 'ninguno', 'ninguna', 'nenhum', 'nenhuma', 'aucun', 'aucune', 'keine', 'keiner']);
export const CLOSE_WORDS: ReadonlySet<string> = new Set(['no', 'cancel', 'cancelar', 'cancela', 'nao', 'non', 'annuler', 'nein', 'abbrechen']);
export const AI_WORDS: ReadonlySet<string> = new Set(['ai', 'ia', 'ki']);
export const DROP_WORDS: ReadonlySet<string> = new Set(['drop', 'quitar', 'remover', 'tirar', 'retirer', 'supprimer', 'entfernen']);
const JOINERS = new Set(['y', 'and', 'e', '&', 'et', 'und']);
/** At most this many numbers in one reply (one decide call). */
const MAX_REPLY_NUMBERS = 30;

function numbersOf(tokens: readonly string[]): number[] | null {
  const numbers: number[] = [];
  for (const token of tokens) {
    if (JOINERS.has(token)) continue;
    if (!/^[0-9]{1,3}$/.test(token)) return null;
    const value = Number(token);
    if (value < 1) return null;
    if (!numbers.includes(value)) numbers.push(value);
  }
  return numbers.length > 0 ? numbers.slice(0, MAX_REPLY_NUMBERS) : null;
}

/** A reply to a live offer, or null for any other text (which then goes to the assistant). */
export function parseSummaryReply(text: string): SummaryReply | null {
  const normalized = normalizeSummaryText(text);
  if (normalized.length === 0 || normalized.length > 200) return null;
  if (ALL_WORDS.has(normalized)) return { kind: 'all' };
  if (NONE_WORDS.has(normalized)) return { kind: 'none' };
  if (CLOSE_WORDS.has(normalized)) return { kind: 'close' };
  if (AI_WORDS.has(normalized)) return { kind: 'ai' };
  const tokens = normalized.replace(/[,;]/g, ' ').split(' ').filter((token) => token.length > 0);
  const first = tokens[0];
  if (first !== undefined && DROP_WORDS.has(first)) {
    const numbers = numbersOf(tokens.slice(1));
    return numbers === null ? null : { kind: 'drop', numbers };
  }
  const numbers = numbersOf(tokens);
  return numbers === null ? null : { kind: 'numbers', numbers };
}

function selectionOf(reply: Exclude<SummaryReply, { kind: 'close' }>): SummarySelection {
  return reply;
}

// ---------------------------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------------------------

export interface SummaryRouteInput {
  message: InboundMessage;
  session: WhatsappSession;
  uid: string;
  /** The app language (M12: en, es, pt, fr or de); only the suggested-tasks texts use it. */
  language: AppLanguage;
  /** When the webhook batch started (epoch ms), for the port timeout; null when unknown. */
  batchStartedMs: number | null;
}

export interface SummaryRouteEnv {
  summaries: SummaryRouteDeps;
  sender: WhatsappSender;
  now: () => Date;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function logOutcome(input: SummaryRouteInput, fields: Record<string, unknown>): void {
  logger.info('whatsapp.summary', { uid: input.uid, wamid: input.message.wamid, ...fields });
}

async function sendText(input: SummaryRouteInput, env: SummaryRouteEnv, body: string): Promise<boolean> {
  try {
    await env.sender.sendText(input.message.from, body);
    return true;
  } catch (error) {
    logger.warn('whatsapp.send_failed', {
      phone: phoneLogId(input.message.from),
      wamid: input.message.wamid,
      errorName: errorName(error),
      status: typeof (error as { status?: unknown }).status === 'number' ? (error as { status: number }).status : null,
    });
    return false;
  }
}

/** One worker call and everything after it: the offer write, the text, the buttons. */
async function callWorker(input: SummaryRouteInput, env: SummaryRouteEnv, request: SummaryWhatsAppRequest): Promise<void> {
  const phone = input.message.from;
  const texts = summaryBotStrings(input.language);
  const kind = request.op === 'reply' ? request.selection.kind : null;
  const elapsed = input.batchStartedMs === null ? 0 : env.now().getTime() - input.batchStartedMs;
  const timeoutMs = portTimeoutMs(elapsed);
  const result = await env.summaries.port.call(request, timeoutMs);
  if (result.kind === 'timeout') {
    await sendText(input, env, request.op === 'offer' || kind === 'ai' ? texts.stillPreparing : texts.replyTimeout);
    logOutcome(input, { op: request.op, kind, outcome: 'port_timeout', timeoutMs });
    return;
  }
  if (result.kind === 'unreachable') {
    await sendText(input, env, texts.unavailable);
    logOutcome(input, { op: request.op, kind, outcome: 'port_unreachable', reason: result.reason, status: result.status });
    return;
  }
  const response = result.response;
  const action = response.offer;
  try {
    if (action.action === 'set') await env.summaries.offers.armSummaryOffer(phone, action.offer);
    else if (action.action === 'refresh') await env.summaries.offers.refreshSummaryOffer(phone, action.offer);
    else if (action.action === 'clear' && request.op === 'reply') await env.summaries.offers.clearSummaryOffer(phone, request.offer.offerId);
  } catch (error) {
    logger.warn('whatsapp.summary_offer_failed', { uid: input.uid, wamid: input.message.wamid, action: action.action, errorName: errorName(error) });
    // A list whose replies would not be recognized is not sent.
    if (action.action === 'set') {
      await sendText(input, env, texts.unavailable);
      logOutcome(input, { op: request.op, kind, outcome: 'offer_unsaved' });
      return;
    }
  }
  const sent = await sendText(input, env, response.text);
  if (!sent && action.action === 'set') {
    // The user never saw the list: disarm it so a stray later "1" cannot act on it.
    try {
      await env.summaries.offers.clearSummaryOffer(phone, action.offer.offerId);
    } catch (error) {
      logger.warn('whatsapp.summary_disarm_failed', { uid: input.uid, wamid: input.message.wamid, errorName: errorName(error) });
    }
  }
  if (sent && response.buttons !== null) {
    try {
      await env.sender.sendButtons(phone, response.buttons.body, response.buttons.items);
    } catch (error) {
      logger.warn('whatsapp.send_failed', { phone: phoneLogId(phone), wamid: input.message.wamid, errorName: errorName(error), status: null });
    }
  }
  logOutcome(input, { op: request.op, kind, outcome: response.outcome, offer: action.action, sent });
}

function liveOffer(input: SummaryRouteInput, env: SummaryRouteEnv): SummaryOffer | null {
  const offer = input.session.summaryOffer;
  return isLiveOffer(offer, input.uid, env.now()) ? offer : null;
}

/**
 * A text from a linked user: true when it was a suggested-tasks message (handled here), false to
 * let it reach the assistant unchanged.
 */
export async function routeSummaryText(input: SummaryRouteInput, env: SummaryRouteEnv): Promise<boolean> {
  if (!env.summaries.allowed(input.uid)) return false;
  const text = input.message.text ?? '';
  const texts = summaryBotStrings(input.language);
  const offer = liveOffer(input, env);
  if (offer !== null) {
    const reply = parseSummaryReply(text);
    if (reply !== null && !(reply.kind === 'ai' && offer.ai === 'none')) {
      if (reply.kind === 'close') {
        try {
          await env.summaries.offers.clearSummaryOffer(input.message.from, offer.offerId);
        } catch (error) {
          logger.warn('whatsapp.summary_offer_failed', { uid: input.uid, wamid: input.message.wamid, action: 'clear', errorName: errorName(error) });
        }
        await sendText(input, env, texts.closed);
        logOutcome(input, { op: 'reply', kind: 'close', outcome: 'closed' });
        return true;
      }
      if (reply.kind === 'all' && offer.marked.length === 0) {
        await sendText(input, env, texts.nothingMarked);
        logOutcome(input, { op: 'reply', kind: 'all', outcome: 'nothing_marked' });
        return true;
      }
      await callWorker(input, env, { op: 'reply', phoneE164: input.message.from, language: input.language, offer, selection: selectionOf(reply) });
      return true;
    }
  }
  if (isSummaryTrigger(text)) {
    await callWorker(input, env, { op: 'offer', phoneE164: input.message.from, language: input.language });
    return true;
  }
  return false;
}

/** A button tap: true for the suggested-tasks buttons (handled here), false for any other id. */
export async function routeSummaryButton(input: SummaryRouteInput, env: SummaryRouteEnv): Promise<boolean> {
  const id = input.message.buttonReplyId;
  if (id === null) return false;
  const kind = id.startsWith(SUMMARY_ALL_BUTTON_PREFIX) ? 'all' : id.startsWith(SUMMARY_NONE_BUTTON_PREFIX) ? 'none' : null;
  if (kind === null || !env.summaries.allowed(input.uid)) return false;
  const offerId = id.slice(kind === 'all' ? SUMMARY_ALL_BUTTON_PREFIX.length : SUMMARY_NONE_BUTTON_PREFIX.length);
  const texts = summaryBotStrings(input.language);
  const offer = liveOffer(input, env);
  if (offer === null || offer.offerId !== offerId) {
    await sendText(input, env, texts.expired);
    logOutcome(input, { op: 'reply', kind, outcome: 'expired_button' });
    return true;
  }
  if (kind === 'all' && offer.marked.length === 0) {
    await sendText(input, env, texts.nothingMarked);
    logOutcome(input, { op: 'reply', kind, outcome: 'nothing_marked' });
    return true;
  }
  await callWorker(input, env, { op: 'reply', phoneE164: input.message.from, language: input.language, offer, selection: { kind } });
  return true;
}
