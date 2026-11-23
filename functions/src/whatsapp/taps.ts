/**
 * M13: the answers to the buttons of the messages the bot starts, and the delivery and template
 * status updates Meta sends to the webhook (docs/v2/WhatsApp-Templates-2026-11-12.md sections 3,
 * 4 and 7). A tap carries `<prefix>:<sendId>` and is honoured only when that send belongs to the
 * account linked to this phone, went to this phone, and is still valid. No tap costs an AI action
 * (the debrief is charged when it runs, like a typed message).
 */
import * as logger from 'firebase-functions/logger';

import { WHATSAPP_OUTBOUND_TUNING } from '../config';
import type { AppLanguage } from '../shared/aiContract';
import { dayRangeUtc, isValidTimeZone, todayInZone } from '../shared/time';
import type { TaskStore } from './executor';
import { MAX_TEXT_CHARS, type WhatsappSender } from './send';
import { atTime, parseTap, templateLanguageOf, type TapAction } from './templates';
import { fill, outboundTexts } from './outboundTexts';
import { newSend, type OutboundStore, type SendRecord, type SendStatus } from './outboundStore';
import { renderDayList, userZone, type OutboundReader } from './outbound';

export interface TapDeps {
  store: OutboundStore;
  reader: OutboundReader;
  sender: WhatsappSender;
  tasks?: TaskStore;
  now: () => Date;
}

export type TapResult = { handled: false } | { handled: true; commitments?: true };

async function say(deps: TapDeps, phone: string, text: string): Promise<void> {
  try {
    await deps.sender.sendText(phone, text);
  } catch (error) {
    logger.warn('whatsapp.tap_reply_failed', { errorName: error instanceof Error ? error.name : typeof error });
  }
}

function valid(send: SendRecord | null, uid: string, phone: string, now: Date): send is SendRecord {
  if (send === null || send.uid !== uid || send.phone !== phone) return false;
  if (send.tapExpiresAt === null || Date.parse(send.tapExpiresAt) < now.getTime()) return false;
  return send.status === 'sent' || send.status === 'delivered' || send.status === 'read';
}

/**
 * Routes a button payload. `{ handled: false }` for a payload that is not ours (the webhook then
 * tries its other buttons); `commitments` asks the webhook to run the typed "commitments" flow.
 */
export async function handleTap(payload: string, phone: string, uid: string, language: AppLanguage, deps: TapDeps): Promise<TapResult> {
  const tap = parseTap(payload);
  if (tap === null) return { handled: false };
  const texts = outboundTexts(language);
  const now = deps.now();
  const send = await deps.store.get(tap.sendId);
  if (!valid(send, uid, phone, now)) {
    if (tap.action !== 'skip') await say(deps, phone, texts.outdated);
    logger.info('whatsapp.tap_refused', { sendId: tap.sendId, action: tap.action });
    return { handled: true };
  }
  logger.info('whatsapp.tap', { sendId: send.sendId, action: tap.action, kind: send.kind });
  return route(tap.action, send, phone, uid, language, deps);
}

async function route(action: TapAction, send: SendRecord, phone: string, uid: string, language: AppLanguage, deps: TapDeps): Promise<TapResult> {
  const texts = outboundTexts(language);
  const now = deps.now();
  switch (action) {
    case 'skip':
      return { handled: true };
    case 'agenda': {
      const [prefs, { record }] = await Promise.all([deps.reader.prefs(uid), deps.store.getMessages(uid)]);
      const zone = userZone(record, prefs) ?? 'UTC';
      const date = send.target.date ?? todayInZone(zone, now);
      const range = dayRangeUtc(date, zone);
      const [items, tasks] = await Promise.all([deps.reader.dayItems(uid, range.from, range.to), deps.reader.openTasks(uid)]);
      const blocks: string[] = [];
      const seen = new Set<string>();
      for (const item of items) {
        // A series shows once per occurrence; formatMeetingForShare shows the master's time, so
        // occurrences get their own line instead.
        if (item.occurrenceDate !== null) {
          const time = item.allDay ? '' : ` ${atTime(templateLanguageOf(language), new Date(item.startAt), zone).replace(/^(at|a las|a la) /, '')}`;
          blocks.push(`*${item.title}*${time}`);
          continue;
        }
        if (seen.has(item.meetingId)) continue;
        seen.add(item.meetingId);
        const block = await deps.reader.meetingBlock(uid, item.meetingId, language);
        if (block !== null) blocks.push(block);
      }
      const text = renderDayList({
        date,
        zone,
        language,
        meetingBlocks: blocks,
        tasks,
        texts: { header: texts.dayHeader, empty: texts.dayEmpty, tasksHeader: texts.dayTasksHeader, dueAt: texts.taskDueAt, overdue: texts.taskOverdue, more: texts.more },
        maxChars: MAX_TEXT_CHARS,
      });
      await say(deps, phone, text);
      return { handled: true };
    }
    case 'debrief': {
      const meetingId = send.target.meetingId;
      if (!meetingId) {
        await say(deps, phone, texts.meetingGone);
        return { handled: true };
      }
      await deps.store.armDebrief(phone, {
        uid,
        meetingId,
        occurrenceDate: send.target.occurrenceDate ?? null,
        title: send.target.title ?? '',
        expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
      });
      await say(deps, phone, fill(texts.debriefAsk, { title: send.target.title ?? '' }));
      return { handled: true };
    }
    case 'meeting': {
      const block = send.target.meetingId ? await deps.reader.meetingBlock(uid, send.target.meetingId, language) : null;
      await say(deps, phone, block ?? texts.meetingGone);
      return { handled: true };
    }
    case 'commit':
      return { handled: true, commitments: true };
    case 'done': {
      const taskId = send.target.taskId;
      const task = taskId ? await deps.reader.task(uid, taskId) : null;
      if (task === null || deps.tasks === undefined || taskId === undefined) {
        await say(deps, phone, texts.taskGone);
        return { handled: true };
      }
      if (task.status === 'done') {
        await say(deps, phone, texts.taskAlreadyDone);
        return { handled: true };
      }
      const nowIso = now.toISOString();
      // The fields taskChangesToFieldUpdates writes (the app rejects done without completedAt).
      await deps.tasks.updateTaskFields(uid, taskId, { status: 'done', completedAt: nowIso, updatedAt: nowIso, pushPending: true });
      await deps.store.dropQueuedForUid(uid, ['task', 'followup']).catch(() => 0);
      await say(deps, phone, fill(texts.markedDone, { title: task.title }));
      return { handled: true };
    }
    case 'later': {
      const taskId = send.target.taskId;
      const task = taskId ? await deps.reader.task(uid, taskId) : null;
      if (task === null || taskId === undefined || task.status !== 'open') {
        await say(deps, phone, task?.status === 'done' ? texts.taskAlreadyDone : texts.taskGone);
        return { handled: true };
      }
      const dueAt = new Date(now.getTime() + WHATSAPP_OUTBOUND_TUNING.snoozeMinutes * 60_000);
      await deps.store.queue(
        newSend({ dedupeKey: `rem:${uid}:${taskId}:later:${send.sendId}`, uid, kind: send.kind, target: { taskId, fireAt: 'snooze' }, dueAt: dueAt.toISOString(), now }),
      );
      const [prefs, { record }] = await Promise.all([deps.reader.prefs(uid), deps.store.getMessages(uid)]);
      const zone = userZone(record, prefs) ?? (isValidTimeZone(task.timezone) ? task.timezone : 'UTC');
      const time = atTime(templateLanguageOf(language), dueAt, zone).replace(/^(at|a las|a la) /, '');
      await say(deps, phone, fill(texts.remindAgain, { time }));
      return { handled: true };
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Status webhooks: message statuses and template status, quality and category updates
// ---------------------------------------------------------------------------------------------

export interface StatusEvent {
  wamid: string;
  status: SendStatus;
  errorCode: number | null;
}

export interface TemplateEvent {
  name: string;
  language: string;
  status?: string;
  category?: string;
  quality?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

/** The statuses and template updates of a webhook payload (tolerant: Meta may add fields). */
export function extractStatusEvents(payload: unknown): { statuses: StatusEvent[]; templates: TemplateEvent[] } {
  const statuses: StatusEvent[] = [];
  const templates: TemplateEvent[] = [];
  const root = asRecord(payload);
  if (!root || root.object !== 'whatsapp_business_account' || !Array.isArray(root.entry)) return { statuses, templates };
  for (const entryItem of root.entry) {
    const entry = asRecord(entryItem);
    if (!entry || !Array.isArray(entry.changes)) continue;
    for (const changeItem of entry.changes) {
      const change = asRecord(changeItem);
      const value = asRecord(change?.value);
      if (!change || !value) continue;
      if (change.field === 'messages' && Array.isArray(value.statuses)) {
        for (const item of value.statuses) {
          const status = asRecord(item);
          if (!status || typeof status.id !== 'string' || typeof status.status !== 'string') continue;
          if (!['sent', 'delivered', 'read', 'failed'].includes(status.status)) continue;
          const firstError = asRecord(Array.isArray(status.errors) ? status.errors[0] : null);
          statuses.push({ wamid: status.id, status: status.status as SendStatus, errorCode: typeof firstError?.code === 'number' ? firstError.code : null });
        }
      }
      const name = typeof value.message_template_name === 'string' ? value.message_template_name : null;
      const language = typeof value.message_template_language === 'string' ? value.message_template_language : null;
      if (name === null || language === null) continue;
      if (change.field === 'message_template_status_update' && typeof value.event === 'string') {
        templates.push({ name, language, status: value.event });
      } else if (change.field === 'template_category_update' && typeof value.new_category === 'string') {
        templates.push({ name, language, category: value.new_category });
      } else if (change.field === 'message_template_quality_update' && typeof value.new_quality_score === 'string') {
        templates.push({ name, language, quality: value.new_quality_score });
      }
    }
  }
  return { statuses, templates };
}

export async function applyStatusEvents(payload: unknown, store: OutboundStore, now: Date): Promise<void> {
  const { statuses, templates } = extractStatusEvents(payload);
  for (const status of statuses) {
    try {
      await store.updateStatusByWamid(status.wamid, status.status, status.errorCode);
      if (status.status === 'failed') logger.warn('whatsapp.outbound_undelivered', { code: status.errorCode });
    } catch (error) {
      logger.warn('whatsapp.status_update_failed', { errorName: error instanceof Error ? error.name : typeof error });
    }
  }
  for (const template of templates) {
    const patch: Record<string, unknown> = { updatedAt: now.toISOString() };
    if (template.status !== undefined) patch.status = template.status;
    if (template.category !== undefined) patch.category = template.category;
    if (template.quality !== undefined) patch.quality = template.quality;
    await store.setTemplate(template.name, template.language, patch);
    // A category change away from UTILITY stops the template (the gate reads it); say so loudly.
    if (template.category !== undefined && template.category !== 'UTILITY') logger.error('whatsapp.template_recategorized', { ...template });
    if (template.status !== undefined && template.status !== 'APPROVED') logger.warn('whatsapp.template_status', { ...template });
  }
}
