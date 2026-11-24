/**
 * M13: the Firebase shells of the messages the bot starts (docs/v2/WhatsApp-Templates-2026-11-12.md):
 *
 * - whatsappMessages (callable, always deployed, NO secrets): the opt-in record.
 * - whatsappTick (every 5 minutes): plans and sends. Binds WHATSAPP_ACCESS_TOKEN only, so it is
 *   exported only while WHATSAPP_ENABLED is true at deploy time (the webhook's rule, ./index.ts).
 * - whatsappTaskReminderSync (task writes): keeps the reminders of summary tasks in the send log.
 *   No secret; exported under the same rule so a disabled bot deploys no trigger.
 *
 * WHATSAPP_TEMPLATES_MODE (off | preview | live) is read per run: off sends nothing at all.
 */
import * as logger from 'firebase-functions/logger';
import { onCall } from 'firebase-functions/https';
import { onSchedule } from 'firebase-functions/scheduler';
import { onDocumentWritten } from 'firebase-functions/firestore';

import {
  FUNCTIONS_REGION,
  WHATSAPP_ACCESS_TOKEN,
  WHATSAPP_ENABLED,
  WHATSAPP_OUTBOUND_TUNING,
  WHATSAPP_PHONE_NUMBER_ID,
  WHATSAPP_TEMPLATES_MODE,
  WHATSAPP_TUNING,
  WHATSAPP_WABA_ID,
} from '../config';
import { adminDb } from '../firebase';
import { whatsappMessagesRequestSchema, type WhatsappMessagesResponse } from '../shared/aiContract';
import { whatsappError } from './link';
import { runTick, templatesModeOf, type OutboundDeps, type TaskView } from './outbound';
import { firestoreOutboundReader } from './outboundFirestore';
import { firestoreOutboundStore, type OutboundStore } from './outboundStore';
import { OptInError, handleMessages, syncTaskReminder } from './optin';
import { createGraphSender } from './send';
import { TEMPLATES } from './templates';

function enabledAtLoad(): boolean {
  const raw = process.env.WHATSAPP_ENABLED;
  return typeof raw === 'string' && raw.trim().toLowerCase() === 'true';
}

function mode() {
  return WHATSAPP_ENABLED.value() === true ? templatesModeOf(WHATSAPP_TEMPLATES_MODE.value()) : 'off';
}

/** whatsappMessages {op:'get'|'set', ...} -> the record (auth only; no secrets). */
export const whatsappMessages = onCall(
  { region: FUNCTIONS_REGION, enforceAppCheck: false, timeoutSeconds: 20, memory: '256MiB', maxInstances: 10 },
  async (request): Promise<WhatsappMessagesResponse> => {
    if (!request.auth) throw whatsappError('unauthenticated', 'Sign in first.');
    const parsed = whatsappMessagesRequestSchema.safeParse(request.data ?? {});
    if (!parsed.success) throw whatsappError('invalid_request', 'Invalid whatsappMessages request.');
    const db = adminDb();
    try {
      return await handleMessages(request.auth.uid, parsed.data, {
        store: firestoreOutboundStore(db),
        reader: firestoreOutboundReader(db),
        mode: mode(),
        enabled: WHATSAPP_ENABLED.value() === true,
        now: () => new Date(),
      });
    } catch (error) {
      if (error instanceof OptInError) {
        throw whatsappError(error.reason, error.reason === 'not_configured' ? 'WhatsApp messages are not available.' : 'Link WhatsApp first.');
      }
      throw error;
    }
  },
);

// ---------------------------------------------------------------------------------------------
// Template status sync (hourly, live mode, when the WhatsApp Business account id is set)
// ---------------------------------------------------------------------------------------------

export async function syncTemplateStates(store: OutboundStore, wabaId: string, token: string, now: Date, fetchImpl: typeof fetch = fetch): Promise<number> {
  if (!/^[0-9]{5,30}$/.test(wabaId)) return 0;
  const ours = new Set(Object.values(TEMPLATES).map((template) => template.name));
  const url = `https://graph.facebook.com/${WHATSAPP_TUNING.graphVersion}/${wabaId}/message_templates?fields=name,language,status,category,message_send_ttl_seconds&limit=200`;
  const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(WHATSAPP_TUNING.graphRequestTimeoutMs) });
  if (!response.ok) {
    await response.text().catch(() => '');
    logger.warn('whatsapp.template_sync_failed', { status: response.status });
    return 0;
  }
  const body = (await response.json().catch(() => null)) as { data?: Record<string, unknown>[] } | null;
  let synced = 0;
  for (const item of body?.data ?? []) {
    const name = typeof item.name === 'string' ? item.name : null;
    const language = typeof item.language === 'string' ? item.language : null;
    if (name === null || language === null || !ours.has(name)) continue;
    await store.setTemplate(name, language, {
      status: typeof item.status === 'string' ? item.status : null,
      category: typeof item.category === 'string' ? item.category : null,
      ttlSeconds: typeof item.message_send_ttl_seconds === 'number' ? item.message_send_ttl_seconds : null,
      updatedAt: now.toISOString(),
    });
    synced += 1;
  }
  return synced;
}

function makeTick() {
  return onSchedule(
    {
      schedule: `every ${WHATSAPP_OUTBOUND_TUNING.tickMinutes} minutes`,
      timeZone: 'Etc/UTC',
      region: FUNCTIONS_REGION,
      secrets: [WHATSAPP_ACCESS_TOKEN],
      timeoutSeconds: 240,
      memory: '256MiB',
      maxInstances: 1,
      retryCount: 0,
    },
    async () => {
      const currentMode = mode();
      if (currentMode === 'off') return;
      const db = adminDb();
      const store = firestoreOutboundStore(db);
      const now = new Date();
      if (currentMode === 'live' && now.getUTCMinutes() < WHATSAPP_OUTBOUND_TUNING.tickMinutes && WHATSAPP_WABA_ID.value().length > 0) {
        try {
          const synced = await syncTemplateStates(store, WHATSAPP_WABA_ID.value(), WHATSAPP_ACCESS_TOKEN.value(), now);
          logger.info('whatsapp.template_sync', { synced });
        } catch (error) {
          logger.warn('whatsapp.template_sync_failed', { errorName: error instanceof Error ? error.name : typeof error });
        }
      }
      const deps: OutboundDeps = {
        store,
        reader: firestoreOutboundReader(db),
        sender: createGraphSender({ phoneNumberId: WHATSAPP_PHONE_NUMBER_ID.value(), accessToken: WHATSAPP_ACCESS_TOKEN.value() }),
        mode: currentMode,
        now: () => new Date(),
      };
      const result = await runTick(deps);
      logger.info('whatsapp.tick', { mode: currentMode, ...result });
    },
  );
}

function taskViewOf(id: string, data: Record<string, unknown> | undefined): TaskView | null {
  if (data === undefined) return null;
  const str = (value: unknown) => (typeof value === 'string' && value.length > 0 ? value : null);
  const people = Array.isArray(data.people)
    ? data.people.map((p) => (typeof p === 'object' && p !== null ? str((p as Record<string, unknown>).name) : null)).filter((n): n is string => n !== null)
    : [];
  return {
    id,
    title: str(data.title) ?? '',
    status: str(data.status) ?? 'open',
    dueDate: str(data.dueDate),
    dueTime: str(data.dueTime),
    timezone: str(data.timezone) ?? 'UTC',
    reminderMinutesBefore: typeof data.reminderMinutesBefore === 'number' ? data.reminderMinutesBefore : null,
    people: people.map((name) => ({ name })),
  };
}

function makeReminderSync() {
  return onDocumentWritten(
    { document: 'users/{uid}/tasks/{taskId}', region: FUNCTIONS_REGION, memory: '256MiB', timeoutSeconds: 30, maxInstances: 10, retry: false },
    async (event) => {
      const { uid, taskId } = event.params;
      if (!uid || !taskId || !taskId.startsWith('sm_')) return;
      if (mode() === 'off') return;
      const before = event.data?.before?.exists ? taskViewOf(taskId, event.data.before.data()) : null;
      const after = event.data?.after?.exists ? taskViewOf(taskId, event.data.after.data()) : null;
      const outcome = await syncTaskReminder(uid, taskId, before, after, { store: firestoreOutboundStore(adminDb()), now: () => new Date() });
      if (outcome !== 'ignored') logger.info('whatsapp.reminder_sync', { uid, taskId, outcome });
    },
  );
}

export const whatsappTick = enabledAtLoad() ? makeTick() : undefined;
export const whatsappTaskReminderSync = enabledAtLoad() ? makeReminderSync() : undefined;
