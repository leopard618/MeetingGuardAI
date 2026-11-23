/**
 * M13: the opt-in to the messages the bot starts (whatsappMessages callable), STOP from the chat,
 * and the WhatsApp reminders of tasks accepted from summaries
 * (docs/v2/WhatsApp-Templates-2026-11-12.md section 7).
 *
 * The record is tied to the phone linked when the user turned a switch on: a new number starts
 * with every switch off (Meta's opt-in is per phone number) and gets the welcome again. All
 * switches are off by default; STOP turns them all off and removes every queued message.
 */
import * as logger from 'firebase-functions/logger';

import {
  WHATSAPP_MESSAGE_SWITCHES,
  type WhatsappMessageSwitches,
  type WhatsappMessagesRequest,
  type WhatsappMessagesResponse,
} from '../shared/aiContract';
import { isValidTimeZone } from '../shared/time';
import {
  NO_SWITCHES,
  anySwitchOn,
  emptyMessagesRecord,
  newSend,
  sendIdOf,
  type MessagesRecord,
  type OutboundStore,
} from './outboundStore';
import { isSummaryTask, reminderDedupeKey, reminderFireAt, reminderKindOf, type OutboundReader, type TaskView, type TemplatesMode } from './outbound';

export interface OptInDeps {
  store: OutboundStore;
  reader: Pick<OutboundReader, 'openTasks' | 'linkUid' | 'isCommitmentsPilot'>;
  mode: TemplatesMode;
  /** WHATSAPP_ENABLED */
  enabled: boolean;
  now: () => Date;
}

export class OptInError extends Error {
  constructor(readonly reason: 'not_configured' | 'invalid_request') {
    super(reason);
    this.name = 'OptInError';
  }
}

/** What this account may switch on: commitments for the summaries pilot only; confirmations not yet (question 1). */
export function offeredSwitches(uid: string, reader: OptInDeps['reader']): WhatsappMessageSwitches {
  return { agenda: true, debrief: true, confirmations: false, commitments: reader.isCommitmentsPilot(uid), reminders: true };
}

async function linkedPhoneOf(uid: string, linkedPhone: string | null, deps: OptInDeps): Promise<string | null> {
  if (linkedPhone === null) return null;
  return (await deps.reader.linkUid(linkedPhone)) === uid ? linkedPhone : null;
}

export async function handleMessages(uid: string, request: WhatsappMessagesRequest, deps: OptInDeps): Promise<WhatsappMessagesResponse> {
  const available = deps.enabled && deps.mode !== 'off';
  const offered = offeredSwitches(uid, deps.reader);
  const { record: stored, linkedPhone: rawPhone } = await deps.store.getMessages(uid);
  const linkedPhone = await linkedPhoneOf(uid, rawPhone, deps);
  const samePhone = linkedPhone !== null && stored.phoneE164 === linkedPhone;
  const current = samePhone ? stored : emptyMessagesRecord();
  const now = deps.now();
  const zone = request.deviceTimeZone && isValidTimeZone(request.deviceTimeZone) ? request.deviceTimeZone : null;

  if (request.op === 'get') {
    if (samePhone && anySwitchOn(current.switches) && zone !== null && zone !== current.deviceTimeZone) {
      await deps.store.patchMessages(uid, { deviceTimeZone: zone });
    }
    return { available, linked: linkedPhone !== null, switches: samePhone ? current.switches : { ...NO_SWITCHES }, offered, stoppedAt: samePhone ? current.stoppedAt : null };
  }

  if (!available) throw new OptInError('not_configured');
  if (linkedPhone === null) throw new OptInError('invalid_request');

  const next: WhatsappMessageSwitches = { ...NO_SWITCHES };
  for (const key of WHATSAPP_MESSAGE_SWITCHES) next[key] = request.switches[key] === true && offered[key];
  const wasOn = anySwitchOn(current.switches);
  const nowOn = anySwitchOn(next);
  const nowIso = now.toISOString();
  const record: MessagesRecord = {
    ...current,
    phoneE164: linkedPhone,
    switches: next,
    wordingVersion: request.wordingVersion,
    updatedAt: nowIso,
    deviceTimeZone: zone ?? current.deviceTimeZone,
  };
  if (!wasOn && nowOn) {
    record.optedInAt = nowIso;
    record.debriefCursor = nowIso;
    record.debriefDay = null;
  }
  await deps.store.saveMessages(uid, record);

  if (!wasOn && nowOn) {
    await deps.store.queue(newSend({ dedupeKey: `welcome:${uid}:${linkedPhone}:${nowIso}`, uid, kind: 'welcome', target: {}, dueAt: nowIso, now }));
  }
  if (!nowOn) {
    await deps.store.dropQueuedForUid(uid);
  } else if (next.reminders && !current.switches.reminders) {
    await rebuildReminders(uid, deps);
  } else if (!next.reminders && current.switches.reminders) {
    await deps.store.dropQueuedForUid(uid, ['task', 'followup']);
  }
  logger.info('whatsapp.messages_set', { uid, on: WHATSAPP_MESSAGE_SWITCHES.filter((key) => next[key]) });
  return { available, linked: true, switches: next, offered, stoppedAt: record.stoppedAt };
}

/** STOP in the chat: every switch off and every queued message removed. */
export async function applyStop(uid: string, store: OutboundStore, now: Date): Promise<void> {
  const { record } = await store.getMessages(uid);
  await store.saveMessages(uid, { ...record, switches: { ...NO_SWITCHES }, stoppedAt: now.toISOString(), updatedAt: now.toISOString() });
  await store.dropQueuedForUid(uid);
}

// ---------------------------------------------------------------------------------------------
// Reminders of tasks accepted from summaries (3.5 / 3.6)
// ---------------------------------------------------------------------------------------------

function queuedReminder(uid: string, task: TaskView, fireAt: string, now: Date) {
  return newSend({ dedupeKey: reminderDedupeKey(uid, task.id, fireAt), uid, kind: reminderKindOf(task), target: { taskId: task.id, fireAt }, dueAt: fireAt, now });
}

/** When the Task reminders switch goes on: one entry per open summary task with a future reminder. */
export async function rebuildReminders(uid: string, deps: Pick<OptInDeps, 'store' | 'reader' | 'now'>): Promise<number> {
  const now = deps.now();
  let queued = 0;
  for (const task of await deps.reader.openTasks(uid)) {
    if (!isSummaryTask(task.id)) continue;
    const fireAt = reminderFireAt(task);
    if (fireAt === null || Date.parse(fireAt) <= now.getTime()) continue;
    await deps.store.upsertQueued(queuedReminder(uid, task, fireAt, now));
    queued += 1;
  }
  return queued;
}

/**
 * A task write (the whatsappTaskReminderSync trigger): the reminder of the old due time goes, the
 * new one is queued. Only tasks accepted from summaries, only while the switch is on.
 */
export async function syncTaskReminder(
  uid: string,
  taskId: string,
  before: TaskView | null,
  after: TaskView | null,
  deps: { store: OutboundStore; now: () => Date },
): Promise<'queued' | 'dropped' | 'ignored'> {
  if (!isSummaryTask(taskId)) return 'ignored';
  const beforeFire = before === null ? null : reminderFireAt(before);
  const afterFire = after === null ? null : reminderFireAt(after);
  if (beforeFire === afterFire && (before === null || after === null || reminderKindOf(before) === reminderKindOf(after))) return 'ignored';
  if (beforeFire !== null) await deps.store.dropQueued(sendIdOf(reminderDedupeKey(uid, taskId, beforeFire)));
  const { record, linkedPhone } = await deps.store.getMessages(uid);
  const now = deps.now();
  if (after === null || afterFire === null || !record.switches.reminders || record.phoneE164 !== linkedPhone || Date.parse(afterFire) <= now.getTime()) {
    return 'dropped';
  }
  await deps.store.upsertQueued(queuedReminder(uid, after, afterFire, now));
  return 'queued';
}

// ---------------------------------------------------------------------------------------------
// STOP (section 7): punctuation and emoji ignored; "no" and "cancel" stay confirm/cancel words
// ---------------------------------------------------------------------------------------------

const STOP_PHRASES: ReadonlySet<string> = new Set([
  'stop',
  'stopp',
  'parar',
  'detener',
  'baja',
  'arret',
  'unsubscribe',
  'darme de baja',
  'dar de baja',
  'no mas mensajes',
  'stop messages',
  'stop reminders',
]);

export function normalizeStopText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "STOP", "Stop.", "¡Baja!", "stop please", "baja por favor" (a short message starting with stop or baja). */
export function isStopRequest(text: string): boolean {
  const normalized = normalizeStopText(text);
  if (normalized.length === 0) return false;
  if (STOP_PHRASES.has(normalized)) return true;
  const words = normalized.split(' ');
  return (words[0] === 'stop' || words[0] === 'baja') && words.length <= 4;
}
