/**
 * WhatsApp webhook logic (docs/v1/ARCHITECTURE.md §27), independent of Firebase wiring.
 *
 * POST order: 1) signature over the RAW body (./signature.ts) - the shell answers 401 before
 * anything else runs; 2) per-message age check + dedupe (whatsappEvents create-once absorbs
 * Meta redelivery; older than the marker TTL is dropped unclaimed); 3) statuses/echoes ignored;
 * 4) INLINE processing within WHATSAPP_TUNING.inlineBudgetMs (function timeout 300 s covers a
 * whole worst-case batch; budget exhaustion answers 500 so Meta redelivers the unclaimed rest).
 * Inline instead of a task queue: dedupe makes redelivery safe; the documented risk (§27) is
 * Meta pausing the subscription on slow responses - revisit a Cloud Tasks hop then.
 *
 * Replies are LOG AND DROP on failure (never retried). Logs carry uid, wamid and phoneLogId
 * only - never message text, titles or phone numbers.
 */
import * as logger from 'firebase-functions/logger';
import { HttpsError } from 'firebase-functions/https';

import {
  AI_LIMITS,
  AI_CONTRACT_VERSION,
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
import { executeConfirmedActions, formatMeetingForShare, formatMeetingList, formatTaskList, type ExecutorDeps } from './executor';
import { bilingual, botStrings, formatConfirmPrompt } from './messages';
import { eventDocId, hashLinkCode, phoneLogId } from './signature';
import { emptySession, pushTurn, sessionPatch, withFreshContext, type WhatsappSession, type WhatsappStore } from './session';
import type { WhatsappSender } from './send';
// M11 (docs/v2/M11-DESIGN.md section 4.1): suggested tasks from summaries, pilot users only.
import type { SummaryRouteDeps } from './summaryPort';
import { routeSummaryButton, routeSummaryText } from './summaryRoute';

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
  /** Meta's messages[].timestamp (epoch seconds as a string), or null when absent. */
  timestamp: string | null;
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
          timestamp: typeof message.timestamp === 'string' ? message.timestamp : null,
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
  /**
   * M11: the summaryWhatsApp port and the offer store; absent while SUMMARIES_ENABLED is false at
   * load (whatsapp/summaryPort.ts summaryRouteDepsAtLoad), and then nothing below changes.
   */
  summaries?: SummaryRouteDeps;
}

function defaultNonce(): string {
  return Math.random().toString(36).slice(2, 10);
}

function logSendFailure(phone: string, wamid: string, error: unknown): void {
  logger.warn('whatsapp.send_failed', {
    phone: phoneLogId(phone),
    wamid,
    errorName: error instanceof Error ? error.name : typeof error,
    status: typeof (error as { status?: unknown }).status === 'number' ? (error as { status: number }).status : null,
  });
}

async function safeSend(deps: WebhookDeps, phone: string, wamid: string, work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    logSendFailure(phone, wamid, error);
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
  // Partial application is called out explicitly: "Done." alone would claim changes that never
  // happened (a meeting deleted meanwhile, a failed bulk member, schema drift).
  if (result.failed > 0) parts.push(result.applied > 0 ? s.partialFailure : s.error);
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
  const now = deps.now();
  if (WHATSAPP_LINK_CODE_PATTERN.test(text)) {
    // Hard brute-force ceiling, independent of the inbound cap: past it, codes are not even
    // tried (silent drop, nothing for a prober to measure).
    if (session.counts.codeFailures >= WHATSAPP_TUNING.codeFailuresPerPhonePerDay) return;
    const redeemed = await deps.store.redeemLinkCode(hashLinkCode(text), phone, message.profileName, now);
    if (redeemed.status === 'linked') {
      // redeemLinkCode stamped the session's uid inside its transaction.
      logger.info('whatsapp.linked', { uid: redeemed.uid, phone: phoneLogId(phone), wamid: message.wamid });
      await safeSend(deps, phone, message.wamid, () => deps.sender.sendText(phone, bilingual('linkSuccess')));
      return;
    }
    // Invalid and expired both answer codeExpired: accurate for a typo AND for a replaced or
    // stale code ("generate a new one" is the right next step either way), unlike the generic
    // link prompt which told the user to redo exactly what they just did. Counted against both
    // the failure ceiling above and the unlinked-reply cap below.
    await deps.store.recordCodeFailure(phone, now);
    const replies = await deps.store.recordUnlinkedReply(phone, now);
    if (replies <= WHATSAPP_TUNING.unlinkedRepliesPerDay) {
      await safeSend(deps, phone, message.wamid, () => deps.sender.sendText(phone, bilingual('codeExpired')));
    }
    return;
  }
  const replies = await deps.store.recordUnlinkedReply(phone, now);
  if (replies <= WHATSAPP_TUNING.unlinkedRepliesPerDay) {
    await safeSend(deps, phone, message.wamid, () => deps.sender.sendText(phone, bilingual('linkPrompt')));
  }
}

/**
 * A 6-digit text from an ALREADY linked phone: most likely a fresh link code (account switch,
 * recreated account, family device), which handleUnlinked can never see because the phone has a
 * link doc. Returns true when the message was consumed (relinked or expired reply); false lets
 * the text fall through to the assistant bridge ('invalid': it may be a genuine message).
 */
async function tryRelink(message: InboundMessage, session: WhatsappSession, language: Language, deps: WebhookDeps): Promise<boolean> {
  const phone = message.from;
  // Past the failure ceiling the webhook stops redeeming (anti brute force) and the digits are
  // treated as ordinary chat again.
  if (session.counts.codeFailures >= WHATSAPP_TUNING.codeFailuresPerPhonePerDay) return false;
  const text = message.text?.trim() ?? '';
  const redeemed = await deps.store.redeemLinkCode(hashLinkCode(text), phone, message.profileName, deps.now());
  if (redeemed.status === 'linked') {
    logger.info('whatsapp.relinked', { uid: redeemed.uid, phone: phoneLogId(phone), wamid: message.wamid });
    // Confirm in the NEW account's language (the redeeming user is that account's owner).
    const prefs = await deps.store.getPreferences(redeemed.uid);
    await safeSend(deps, phone, message.wamid, () => deps.sender.sendText(phone, botStrings(prefs.language).linkSuccess));
    return true;
  }
  await deps.store.recordCodeFailure(phone, deps.now());
  if (redeemed.status === 'expired') {
    await safeSend(deps, phone, message.wamid, () => deps.sender.sendText(phone, botStrings(language).codeExpired));
    return true;
  }
  return false;
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
  // The proposal this invocation's SNAPSHOT carried: only that one may be cleared at the end
  // (a proposal armed by a concurrent invocation must survive this turn).
  const snapshotNonce = session.pendingNonce;
  const userText = (message.text ?? '').slice(0, AI_LIMITS.maxMessageChars);
  session.turns = pushTurn(session.turns, { role: 'user', text: userText, atIso: now.toISOString() });

  const request: AssistantRequest = {
    messages: session.turns.map((turn) => ({ role: turn.role, content: turn.text })),
    language,
    timezone,
    nowIso: now.toISOString(),
    mode: 'chat',
    followUpMeetingId: null,
    // v5: this bridge executes task actions server-side (executor.ts), so it may receive them.
    contractVersion: AI_CONTRACT_VERSION,
  };

  let response: AssistantResponse;
  try {
    response = await deps.assistant(uid, request);
  } catch (error) {
    const reason = quotaReason(error);
    logger.info('whatsapp.assistant_failed', { uid, wamid: message.wamid, reason: reason ?? 'error' });
    session.updatedAt = now.toISOString();
    await deps.store.saveTurns(phone, sessionPatch(session));
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
    } else if (action.type === 'list_tasks') {
      const lines = await formatTaskList(uid, action.taskIds, language, deps.executor);
      shareBlocks.push(lines.length > 0 ? lines.join('\n') : s.taskListEmpty);
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
    session.updatedAt = now.toISOString();
    await deps.store.savePendingProposal(phone, sessionPatch(session), {
      pendingActions: executable,
      pendingNonce: nonce,
      promptMsgId: message.wamid,
      actionsExpireAt: new Date(now.getTime() + WHATSAPP_TUNING.actionsTtlMinutes * 60_000).toISOString(),
    });
    const body = formatConfirmPrompt(language, executable.map((action) => action.summary));
    try {
      await deps.sender.sendButtons(phone, body, [
        { id: `${CONFIRM_BUTTON_PREFIX}${nonce}`, title: s.buttons.confirm },
        { id: `${CANCEL_BUTTON_PREFIX}${nonce}`, title: s.buttons.cancel },
      ]);
    } catch (buttonsError) {
      // A client that cannot render interactive buttons (or a transient Graph error) must not
      // leave an INVISIBLE armed proposal: fall back to plain text - the body already carries
      // the "reply 1 to confirm or 2 to cancel" instruction.
      logSendFailure(phone, message.wamid, buttonsError);
      try {
        await deps.sender.sendText(phone, body);
      } catch (textError) {
        logSendFailure(phone, message.wamid, textError);
        // The user never saw the proposal: disarm it so a stray later "1" cannot confirm it.
        try {
          await deps.store.claimPendingActions(phone, nonce, deps.now());
          logger.info('whatsapp.proposal_disarmed', { uid, wamid: message.wamid, phone: phoneLogId(phone) });
        } catch (claimError) {
          logger.warn('whatsapp.disarm_failed', {
            uid,
            wamid: message.wamid,
            errorName: claimError instanceof Error ? claimError.name : typeof claimError,
          });
        }
      }
    }
  } else {
    session.updatedAt = now.toISOString();
    // Conditional: clears only the proposal this turn STARTED from (snapshotNonce), never one a
    // concurrent message armed moments ago - the race that used to swallow fresh proposals.
    await deps.store.clearStalePending(phone, sessionPatch(session), snapshotNonce);
  }
}

/**
 * True for a message older than the dedupe window: the whatsappEvents markers that absorb
 * replays are purged after eventTtlDays, so anything older must be dropped BEFORE claiming -
 * a captured signed payload replayed after the purge would otherwise process again.
 */
export function isStaleMessage(message: InboundMessage, now: Date): boolean {
  if (message.timestamp === null || !/^[0-9]{1,12}$/.test(message.timestamp)) return false; // tolerant: Meta owns the field
  const sentMs = Number(message.timestamp) * 1000;
  return now.getTime() - sentMs > WHATSAPP_TUNING.eventTtlDays * 86_400_000;
}

/**
 * One inbound message, end to end. Never throws (errors are logged; Meta always gets its 200).
 * `batch.startedMs` (M11) is when processWebhookPayload started, for the summary port's timeout.
 */
export async function processInboundMessage(message: InboundMessage, deps: WebhookDeps, batch?: { startedMs: number }): Promise<void> {
  const phone = message.from;
  if (!WHATSAPP_PHONE_PATTERN.test(phone)) return;
  if (deps.displayNumber.length > 0 && phone === deps.displayNumber) return; // our own echo
  if (isStaleMessage(message, deps.now())) {
    logger.info('whatsapp.stale_dropped', { wamid: message.wamid, phone: phoneLogId(phone) });
    return;
  }
  if (!(await deps.store.claimEvent(eventDocId(message.wamid), deps.now()))) return; // redelivery

  const now = deps.now();
  // Per-phone daily cap (§27), counted ATOMICALLY first (racing deliveries cannot undercount):
  // one notice right past the limit, then silence.
  const counts = await deps.store.recordInbound(phone, now);
  if (counts.inbound > deps.dailyLimit) {
    if (counts.inbound === deps.dailyLimit + 1) {
      logger.info('whatsapp.flood_capped', { phone: phoneLogId(phone), wamid: message.wamid });
      await safeSend(deps, phone, message.wamid, () => deps.sender.sendText(phone, bilingual('floodNotice')));
    }
    return;
  }

  const stored = await deps.store.getSession(phone);
  const session = withFreshContext(stored ?? emptySession(now), now);
  session.counts = counts;
  session.updatedAt = now.toISOString();

  const uid = await deps.store.getLinkUid(phone);
  session.uid = uid;
  if (uid === null) {
    await handleUnlinked(message, session, deps);
    return;
  }

  const prefs = await deps.store.getPreferences(uid);
  const language = prefs.language;
  const timezone = isValidTimeZone(prefs.timezone) ? prefs.timezone : 'UTC';

  // Button taps (counters are already persisted; the claim tx owns the pending fields).
  if (message.buttonReplyId !== null) {
    if (message.buttonReplyId.startsWith(CONFIRM_BUTTON_PREFIX)) {
      await handleConfirm(phone, message.wamid, message.buttonReplyId.slice(CONFIRM_BUTTON_PREFIX.length), language, timezone, deps);
      return;
    }
    if (message.buttonReplyId.startsWith(CANCEL_BUTTON_PREFIX)) {
      await handleCancel(phone, message.wamid, message.buttonReplyId.slice(CANCEL_BUTTON_PREFIX.length), language, deps);
      return;
    }
    // M11: the suggested-tasks buttons (wa_sum_all / wa_sum_none), pilot users only.
    if (deps.summaries !== undefined) {
      const routed = { message, session, uid, language, batchStartedMs: batch?.startedMs ?? null };
      if (await routeSummaryButton(routed, { summaries: deps.summaries, sender: deps.sender, now: deps.now })) return;
    }
    return; // unknown button id: ignore
  }

  // A 6-digit code from a linked phone: re-link (account switch on the same phone).
  if (message.text !== null && WHATSAPP_LINK_CODE_PATTERN.test(message.text.trim())) {
    if (await tryRelink(message, session, language, deps)) return;
    // 'invalid': fall through - it may be a genuine message for the assistant.
  }

  // Text fallback for the pending proposal (1/yes/si/ok vs 2/no/cancel).
  if (message.text !== null && session.pendingActions !== null) {
    const answer = textAnswerOf(message.text);
    if (answer !== null) {
      if (answer === 'confirm') {
        await handleConfirm(phone, message.wamid, null, language, timezone, deps);
      } else {
        await handleCancel(phone, message.wamid, null, language, deps);
      }
      return;
    }
  }

  if (message.text === null || message.text.trim().length === 0) {
    await safeSend(deps, phone, message.wamid, () => deps.sender.sendText(phone, botStrings(language).unsupportedType));
    return;
  }

  // M11: "commitments" and the replies to a live suggested-tasks offer, pilot users only. It runs
  // before the bridge and never touches session.turns (docs/v2/M11-DESIGN.md section 4.1 step 7).
  if (deps.summaries !== undefined) {
    const routed = { message, session, uid, language, batchStartedMs: batch?.startedMs ?? null };
    if (await routeSummaryText(routed, { summaries: deps.summaries, sender: deps.sender, now: deps.now })) return;
  }

  await handleBridge(message, session, uid, language, timezone, deps);
}

/**
 * The POST body after a valid signature. Processes messages in order; failures are per-message.
 * Returns false when the inline time budget ran out with messages still UNCLAIMED - the shell
 * then answers 500 so Meta redelivers the batch (dedupe absorbs the part processed here), and
 * no message is ever lost between its dedupe claim and its processing.
 */
export async function processWebhookPayload(payload: unknown, deps: WebhookDeps): Promise<boolean> {
  const startedMs = deps.now().getTime();
  const messages = extractInboundMessages(payload);
  let processed = 0;
  for (const message of messages) {
    if (processed > 0 && deps.now().getTime() - startedMs > WHATSAPP_TUNING.inlineBudgetMs) {
      logger.warn('whatsapp.budget_exhausted', { processed, remaining: messages.length - processed });
      return false;
    }
    try {
      await processInboundMessage(message, deps, { startedMs });
    } catch (error) {
      logger.error('whatsapp.message_failed', {
        wamid: message.wamid,
        phone: phoneLogId(message.from),
        errorName: error instanceof Error ? error.name : typeof error,
      });
      // The dedupe marker is already claimed, so Meta's redelivery would be dropped: tell the
      // user instead of going silent (best effort; a failed send is logged by safeSend).
      await safeSend(deps, message.from, message.wamid, () => deps.sender.sendText(message.from, bilingual('error')));
    }
    processed += 1;
  }
  return true;
}
