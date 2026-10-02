/**
 * WhatsApp webhook logic (docs/ARCHITECTURE.md §27), independent of Firebase wiring.
 *
 * POST order: 1) signature over the RAW body (./signature.ts) - the shell answers 401 before
 * anything else runs; 2) per-message dedupe (whatsappEvents create-once absorbs Meta
 * redelivery); 3) statuses/echoes ignored; 4) INLINE processing, then 200. Inline instead of a
 * task queue: dedupe makes redelivery safe, v2 allows 60 s and the assistant deadline is 50 s;
 * the documented risk (§27) is Meta pausing the subscription on slow responses - revisit then.
 *
 * Replies are LOG AND DROP on failure (never retried). Logs carry uid, wamid and phoneLogId
 * only - never message text, titles or phone numbers.
 */
import * as logger from 'firebase-functions/logger';
import { HttpsError } from 'firebase-functions/https';

import {
  AI_LIMITS,
  WHATSAPP_LINK_CODE_PATTERN,
  WHATSAPP_PHONE_PATTERN,
  isMutatingAction,
  type AiAction,
  type AssistantRequest,
  type AssistantResponse,
  type Language,
} from '../shared/aiContract';
import { WHATSAPP_TUNING } from '../config';
import { isValidTimeZone } from '../assistant/time';
import { executeConfirmedActions, formatMeetingForShare, formatMeetingList, type ExecutorDeps } from './executor';
import { bilingual, botStrings, formatConfirmPrompt } from './messages';
import { eventDocId, hashLinkCode, phoneLogId } from './signature';
import { emptySession, pushTurn, withFreshContext, type WhatsappSession, type WhatsappStore } from './session';
import type { WhatsappSender } from './send';

export const CONFIRM_BUTTON_PREFIX = 'wa_confirm:';
export const CANCEL_BUTTON_PREFIX = 'wa_cancel:';

// ---------------------------------------------------------------------------------------------
// Payload extraction (tolerant: Meta may add fields at any time)
// ---------------------------------------------------------------------------------------------

export interface InboundMessage {
  wamid: string;
  /** Sender wa_id: E.164 digits. */
  from: string;
  type: string;
  text: string | null;
  buttonReplyId: string | null;
  profileName: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

/** Flattens entry[].changes[].value.messages[] of a webhook payload; statuses are dropped here. */
export function extractInboundMessages(payload: unknown): InboundMessage[] {
  const root = asRecord(payload);
  if (!root || root.object !== 'whatsapp_business_account' || !Array.isArray(root.entry)) return [];
  const result: InboundMessage[] = [];
  for (const entryItem of root.entry) {
    const entry = asRecord(entryItem);
    if (!entry || !Array.isArray(entry.changes)) continue;
    for (const changeItem of entry.changes) {
      const change = asRecord(changeItem);
      if (!change || change.field !== 'messages') continue;
      const value = asRecord(change.value);
      if (!value || !Array.isArray(value.messages)) continue; // statuses-only deliveries land here
      const contact = asRecord(Array.isArray(value.contacts) ? value.contacts[0] : null);
      const profile = asRecord(contact?.profile);
      const profileName = typeof profile?.name === 'string' ? profile.name.slice(0, 200) : null;
      for (const messageItem of value.messages) {
        const message = asRecord(messageItem);
        if (!message || typeof message.id !== 'string' || typeof message.from !== 'string') continue;
        const text = asRecord(message.text);
        const interactive = asRecord(message.interactive);
        const buttonReply = asRecord(interactive?.button_reply);
        result.push({
          wamid: message.id,
          from: message.from,
          type: typeof message.type === 'string' ? message.type : 'unknown',
          text: typeof text?.body === 'string' ? text.body : null,
          buttonReplyId: typeof buttonReply?.id === 'string' ? buttonReply.id : null,
          profileName,
        });
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// Deps
// ---------------------------------------------------------------------------------------------

export interface WebhookDeps {
  store: WhatsappStore;
  sender: WhatsappSender;
  /** runAssistant behind buildAssistantDeps: same quota, same budget as the app callable. */
  assistant: (uid: string, request: AssistantRequest) => Promise<AssistantResponse>;
  executor: ExecutorDeps;
  /** WHATSAPP_USER_DAILY_LIMIT.value() */
  dailyLimit: number;
  /** Bot number digits (echo filter), '' when unknown. */
  displayNumber: string;
  now: () => Date;
  /** Test seam for the confirm-button nonce. */
  newNonce?: () => string;
}

function defaultNonce(): string {
  return Math.random().toString(36).slice(2, 10);
}

async function safeSend(deps: WebhookDeps, phone: string, wamid: string, work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    logger.warn('whatsapp.send_failed', {
      phone: phoneLogId(phone),
      wamid,
      errorName: error instanceof Error ? error.name : typeof error,
      status: typeof (error as { status?: unknown }).status === 'number' ? (error as { status: number }).status : null,
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Confirm / cancel recognition
// ---------------------------------------------------------------------------------------------

/** Lower-cases and strips accents so "Sí" and "si" match. */
function normalizeAnswer(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

const CONFIRM_WORDS = new Set(['1', 'yes', 'si', 'ok', 'confirm', 'confirmar', 'confirmo']);
const CANCEL_WORDS = new Set(['2', 'no', 'cancel', 'cancelar', 'cancela']);

export type TextAnswer = 'confirm' | 'cancel' | null;

export function textAnswerOf(text: string): TextAnswer {
  const normalized = normalizeAnswer(text);
  if (CONFIRM_WORDS.has(normalized)) return 'confirm';
  if (CANCEL_WORDS.has(normalized)) return 'cancel';
  return null;
}

// ---------------------------------------------------------------------------------------------
// Message processing
// ---------------------------------------------------------------------------------------------

async function handleConfirm(
  phone: string,
  wamid: string,
  nonce: string | null,
  language: Language,
  timezone: string,
  deps: WebhookDeps,
): Promise<void> {
  const s = botStrings(language);
  const claim = await deps.store.claimPendingActions(phone, nonce, deps.now());
  if (claim.status === 'none') {
    await safeSend(deps, phone, wamid, () => deps.sender.sendText(phone, s.actionsExpired));
    return;
  }
  if (claim.status === 'expired') {
    await safeSend(deps, phone, wamid, () => deps.sender.sendText(phone, s.actionsExpired));
    return;
  }
  const result = await executeConfirmedActions(claim.uid, claim.actions, deps.executor, timezone);
  logger.info('whatsapp.actions_executed', {
    uid: claim.uid,
    wamid,
    promptMsgId: claim.promptMsgId,
    ...result,
  });
  const parts: string[] = [];
  if (result.applied > 0) parts.push(s.confirmed);
  if (result.unsupported > 0) parts.push(s.actionUnsupported);
  if (result.applied === 0 && result.failed > 0) parts.push(s.error);
  const reply = parts.length > 0 ? parts.join('\n') : s.confirmed;
  await safeSend(deps, phone, wamid, () => deps.sender.sendText(phone, reply));
}

async function handleCancel(phone: string, wamid: string, nonce: string | null, language: Language, deps: WebhookDeps): Promise<void> {
  const s = botStrings(language);
  const claim = await deps.store.claimPendingActions(phone, nonce, deps.now());
  const reply = claim.status === 'none' ? s.actionsExpired : s.cancelled;
  await safeSend(deps, phone, wamid, () => deps.sender.sendText(phone, reply));
}

async function handleUnlinked(message: InboundMessage, session: WhatsappSession, deps: WebhookDeps): Promise<void> {
  const phone = message.from;
  const text = message.text?.trim() ?? '';
  if (WHATSAPP_LINK_CODE_PATTERN.test(text)) {
    const redeemed = await deps.store.redeemLinkCode(hashLinkCode(text), phone, message.profileName, deps.now());
    if (redeemed.status === 'linked') {
      session.uid = redeemed.uid;
      await deps.store.putSession(phone, session);
      logger.info('whatsapp.linked', { uid: redeemed.uid, phone: phoneLogId(phone), wamid: message.wamid });
      await safeSend(deps, phone, message.wamid, () => deps.sender.sendText(phone, bilingual('linkSuccess')));
      return;
    }
    if (redeemed.status === 'expired') {
      await deps.store.putSession(phone, session);
      await safeSend(deps, phone, message.wamid, () => deps.sender.sendText(phone, bilingual('codeExpired')));
      return;
    }
    // Invalid code: fall through to the link prompt (capped below).
  }
  if (session.counts.unlinkedReplies < WHATSAPP_TUNING.unlinkedRepliesPerDay) {
    session.counts = { ...session.counts, unlinkedReplies: session.counts.unlinkedReplies + 1 };
    await deps.store.putSession(phone, session);
    await safeSend(deps, phone, message.wamid, () => deps.sender.sendText(phone, bilingual('linkPrompt')));
  } else {
    await deps.store.putSession(phone, session);
  }
}

function quotaReason(error: unknown): string | null {
  if (!(error instanceof HttpsError)) return null;
  const details = asRecord(error.details);
  return typeof details?.reason === 'string' ? details.reason : null;
}

async function handleBridge(
  message: InboundMessage,
  session: WhatsappSession,
  uid: string,
  language: Language,
  timezone: string,
  deps: WebhookDeps,
): Promise<void> {
  const phone = message.from;
  const s = botStrings(language);
  const now = deps.now();
  const userText = (message.text ?? '').slice(0, AI_LIMITS.maxMessageChars);
  session.turns = pushTurn(session.turns, { role: 'user', text: userText, atIso: now.toISOString() });

  const request: AssistantRequest = {
    messages: session.turns.map((turn) => ({ role: turn.role, content: turn.text })),
    language,
    timezone,
    nowIso: now.toISOString(),
    mode: 'chat',
    followUpMeetingId: null,
  };

  let response: AssistantResponse;
  try {
    response = await deps.assistant(uid, request);
  } catch (error) {
    const reason = quotaReason(error);
    logger.info('whatsapp.assistant_failed', { uid, wamid: message.wamid, reason: reason ?? 'error' });
    session.updatedAt = now.toISOString();
    await deps.store.putSession(phone, session);
    const text = reason === 'quota_exceeded' ? s.quotaExceeded : s.error;
    await safeSend(deps, phone, message.wamid, () => deps.sender.sendText(phone, text));
    return;
  }

  // Partition the proposals: share/list answer immediately; occurrence/following need the app;
  // the rest wait for an explicit Confirm.
  const executable: AiAction[] = [];
  let unsupportedScoped = 0;
  const shareBlocks: string[] = [];
  for (const action of response.actions) {
    if (action.type === 'list') {
      const blocks = await formatMeetingList(uid, action.meetingIds, language, deps.executor);
      shareBlocks.push(blocks.length > 0 ? blocks.join('\n\n') : s.listEmpty);
    } else if (action.type === 'share_meeting') {
      const block = await formatMeetingForShare(uid, action.meetingId, language, deps.executor);
      if (block !== null) shareBlocks.push(block);
    } else if ((action.type === 'update_meeting' || action.type === 'delete_meeting') && (action.scope === 'occurrence' || action.scope === 'following')) {
      unsupportedScoped += 1;
    } else if (isMutatingAction(action)) {
      executable.push(action);
    }
  }

  const replyText = response.reply.trim();
  if (replyText.length > 0) {
    session.turns = pushTurn(session.turns, { role: 'assistant', text: replyText.slice(0, AI_LIMITS.maxMessageChars), atIso: now.toISOString() });
    await safeSend(deps, phone, message.wamid, () => deps.sender.sendText(phone, replyText));
  }
  for (const block of shareBlocks) {
    await safeSend(deps, phone, message.wamid, () => deps.sender.sendText(phone, block));
  }
  if (unsupportedScoped > 0) {
    await safeSend(deps, phone, message.wamid, () => deps.sender.sendText(phone, s.actionUnsupported));
  }

  if (executable.length > 0) {
    const nonce = (deps.newNonce ?? defaultNonce)();
    session.pendingActions = executable;
    session.pendingNonce = nonce;
    session.promptMsgId = message.wamid;
    session.actionsExpireAt = new Date(now.getTime() + WHATSAPP_TUNING.actionsTtlMinutes * 60_000).toISOString();
    session.updatedAt = now.toISOString();
    await deps.store.putSession(phone, session);
    const body = formatConfirmPrompt(language, executable.map((action) => action.summary));
    await safeSend(deps, phone, message.wamid, () =>
      deps.sender.sendButtons(phone, body, [
        { id: `${CONFIRM_BUTTON_PREFIX}${nonce}`, title: s.buttons.confirm },
        { id: `${CANCEL_BUTTON_PREFIX}${nonce}`, title: s.buttons.cancel },
      ]),
    );
  } else {
    session.pendingActions = null;
    session.pendingNonce = null;
    session.promptMsgId = null;
    session.actionsExpireAt = null;
    session.updatedAt = now.toISOString();
    await deps.store.putSession(phone, session);
  }
}

/** One inbound message, end to end. Never throws (errors are logged; Meta always gets its 200). */
export async function processInboundMessage(message: InboundMessage, deps: WebhookDeps): Promise<void> {
  const phone = message.from;
  if (!WHATSAPP_PHONE_PATTERN.test(phone)) return;
  if (deps.displayNumber.length > 0 && phone === deps.displayNumber) return; // our own echo
  if (!(await deps.store.claimEvent(eventDocId(message.wamid), deps.now()))) return; // redelivery

  const now = deps.now();
  const stored = await deps.store.getSession(phone);
  const session = withFreshContext(stored ?? emptySession(now), now);
  session.counts = { ...session.counts, inbound: session.counts.inbound + 1 };
  session.updatedAt = now.toISOString();

  // Per-phone daily cap (§27): one notice right past the limit, then silence.
  if (session.counts.inbound > deps.dailyLimit) {
    await deps.store.putSession(phone, session);
    if (session.counts.inbound === deps.dailyLimit + 1) {
      logger.info('whatsapp.flood_capped', { phone: phoneLogId(phone), wamid: message.wamid });
      await safeSend(deps, phone, message.wamid, () => deps.sender.sendText(phone, bilingual('floodNotice')));
    }
    return;
  }

  const uid = await deps.store.getLinkUid(phone);
  session.uid = uid;
  if (uid === null) {
    await handleUnlinked(message, session, deps);
    return;
  }

  const prefs = await deps.store.getPreferences(uid);
  const language = prefs.language;
  const timezone = isValidTimeZone(prefs.timezone) ? prefs.timezone : 'UTC';

  // Button taps.
  if (message.buttonReplyId !== null) {
    await deps.store.putSession(phone, session); // persist counters; the claim tx owns the rest
    if (message.buttonReplyId.startsWith(CONFIRM_BUTTON_PREFIX)) {
      await handleConfirm(phone, message.wamid, message.buttonReplyId.slice(CONFIRM_BUTTON_PREFIX.length), language, timezone, deps);
      return;
    }
    if (message.buttonReplyId.startsWith(CANCEL_BUTTON_PREFIX)) {
      await handleCancel(phone, message.wamid, message.buttonReplyId.slice(CANCEL_BUTTON_PREFIX.length), language, deps);
      return;
    }
    return; // unknown button id: ignore
  }

  // Text fallback for the pending proposal (1/yes/si/ok vs 2/no/cancel).
  if (message.text !== null && session.pendingActions !== null) {
    const answer = textAnswerOf(message.text);
    if (answer !== null) {
      await deps.store.putSession(phone, session);
      if (answer === 'confirm') {
        await handleConfirm(phone, message.wamid, null, language, timezone, deps);
      } else {
        await handleCancel(phone, message.wamid, null, language, deps);
      }
      return;
    }
  }

  if (message.text === null || message.text.trim().length === 0) {
    await deps.store.putSession(phone, session);
    await safeSend(deps, phone, message.wamid, () => deps.sender.sendText(phone, botStrings(language).unsupportedType));
    return;
  }

  await handleBridge(message, session, uid, language, timezone, deps);
}

/** The POST body after a valid signature. Processes every message; failures are per-message. */
export async function processWebhookPayload(payload: unknown, deps: WebhookDeps): Promise<void> {
  for (const message of extractInboundMessages(payload)) {
    try {
      await processInboundMessage(message, deps);
    } catch (error) {
      logger.error('whatsapp.message_failed', {
        wamid: message.wamid,
        phone: phoneLogId(message.from),
        errorName: error instanceof Error ? error.name : typeof error,
      });
    }
  }
}
