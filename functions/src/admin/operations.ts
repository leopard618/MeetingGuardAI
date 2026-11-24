/**
 * M13 and M14 admin dashboard additions (Complete-Plan-2026-11-10.md part 2): the WhatsApp panel,
 * the alerts health view and the user page. Read-only (viewer claim), like adminGetStats.
 *
 * - adminGetWhatsapp: linked users, opt-ins per switch, STOPs, the sends of the last 7 days by kind
 *   and status, the 50 most recent sends (ids, kinds, codes; never text or phone numbers), the
 *   template states Meta reported against the registry, and the templates mode.
 * - adminGetAlertsHealth: the alerts health the app reports (alertHealth/{uid}, written by the
 *   reportAlertHealth callable): how many phones have notifications or exact alarms off, and how
 *   many have not planned their alarms for more than a day.
 * - adminGetUser {uid}: one account: sign-in record, plan, AI usage, WhatsApp state (last 4
 *   digits only), recent sends and the alerts health of each phone.
 */
import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/https';
import { getAuth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';

import { FUNCTIONS_REGION, WHATSAPP_ENABLED, WHATSAPP_TEMPLATES_MODE } from '../config';
import { adminDb } from '../firebase';
import { readUsageRoot } from '../assistant/quota';
import { WHATSAPP_MESSAGE_SWITCHES, reportAlertHealthRequestSchema, type ReportAlertHealthResponse } from '../shared/aiContract';
import { templatesModeOf } from '../whatsapp/outbound';
import { parseMessagesRecord, WHATSAPP_SENDS_COLLECTION, WHATSAPP_TEMPLATES_COLLECTION } from '../whatsapp/outboundStore';
import { TEMPLATES } from '../whatsapp/templates';
import { entitlementDisplayOf, requireViewer, type AdminCaller } from './index';

export const ALERT_HEALTH_COLLECTION = 'alertHealth';
const DAY_MS = 86_400_000;

function callerOf(auth: { uid: string; token: Record<string, unknown> } | undefined): AdminCaller | null {
  if (!auth) return null;
  const isAdmin = auth.token.admin === true;
  return { uid: auth.uid, isAdmin, isViewer: isAdmin || auth.token.adminRole === 'viewer' };
}

const OPTIONS = { region: FUNCTIONS_REGION, enforceAppCheck: false, timeoutSeconds: 60, memory: '256MiB', maxInstances: 5 } as const;

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function wrap(callable: string, uid: string, error: unknown): never {
  if (error instanceof HttpsError) throw error;
  logger.error(`${callable}.failed`, { uid, errorName: error instanceof Error ? error.name : typeof error });
  throw new HttpsError('internal', 'The admin operation failed. Please try again.');
}

// ---------------------------------------------------------------------------------------------
// WhatsApp panel
// ---------------------------------------------------------------------------------------------

export interface WhatsappPanel {
  mode: 'off' | 'preview' | 'live';
  linkedUsers: number;
  optedIn: number;
  switches: Record<string, number>;
  stoppedLast30Days: number;
  sends7d: Record<string, Record<string, number>>;
  recent: { sendId: string; kind: string; status: string; reason: string | null; errorCode: number | null; createdAt: string | null; sentAt: string | null; uid: string }[];
  templates: { name: string; language: string; status: string | null; category: string | null; ttlSeconds: number | null; expectedTtlSeconds: number; usable: boolean }[];
}

export function computeWhatsappPanel(
  users: Record<string, unknown>[],
  sends: { id: string; data: Record<string, unknown> }[],
  templates: { id: string; data: Record<string, unknown> }[],
  mode: WhatsappPanel['mode'],
  now: Date,
): WhatsappPanel {
  const switches: Record<string, number> = Object.fromEntries(WHATSAPP_MESSAGE_SWITCHES.map((key) => [key, 0]));
  let linkedUsers = 0;
  let optedIn = 0;
  let stopped = 0;
  for (const user of users) {
    const phone = str(user.phoneE164);
    if (phone === null) continue;
    linkedUsers += 1;
    const record = parseMessagesRecord(user.messages);
    if (record.phoneE164 !== phone) continue;
    if (WHATSAPP_MESSAGE_SWITCHES.some((key) => record.switches[key])) optedIn += 1;
    for (const key of WHATSAPP_MESSAGE_SWITCHES) if (record.switches[key]) switches[key]! += 1;
    if (record.stoppedAt !== null && now.getTime() - Date.parse(record.stoppedAt) < 30 * DAY_MS) stopped += 1;
  }
  const sends7d: Record<string, Record<string, number>> = {};
  const sorted = [...sends].sort((a, b) => String(b.data.createdAt ?? '').localeCompare(String(a.data.createdAt ?? '')));
  for (const { data } of sorted) {
    const kind = str(data.kind) ?? 'unknown';
    const status = str(data.status) ?? 'unknown';
    sends7d[kind] ??= {};
    sends7d[kind]![status] = (sends7d[kind]![status] ?? 0) + 1;
  }
  const recent = sorted.slice(0, 50).map(({ id, data }) => ({
    sendId: id,
    kind: str(data.kind) ?? 'unknown',
    status: str(data.status) ?? 'unknown',
    reason: str(data.reason),
    errorCode: typeof data.errorCode === 'number' ? data.errorCode : null,
    createdAt: str(data.createdAt),
    sentAt: str(data.sentAt),
    uid: str(data.uid) ?? '',
  }));
  const byKey = new Map(templates.map((template) => [template.id, template.data]));
  const rows: WhatsappPanel['templates'] = [];
  for (const definition of Object.values(TEMPLATES)) {
    for (const language of ['en', 'es']) {
      const data = byKey.get(`${definition.name}_${language}`) ?? {};
      const status = str(data.status);
      const category = str(data.category);
      const ttlSeconds = typeof data.ttlSeconds === 'number' ? data.ttlSeconds : null;
      rows.push({
        name: definition.name,
        language,
        status,
        category,
        ttlSeconds,
        expectedTtlSeconds: definition.ttlSeconds,
        usable: status === 'APPROVED' && category === 'UTILITY' && (ttlSeconds === null || ttlSeconds === definition.ttlSeconds),
      });
    }
  }
  return { mode, linkedUsers, optedIn, switches, stoppedLast30Days: stopped, sends7d, recent, templates: rows };
}

export const adminGetWhatsapp = onCall(OPTIONS, async (request): Promise<WhatsappPanel> => {
  const caller = callerOf(request.auth);
  requireViewer(caller);
  try {
    const db = adminDb();
    const now = new Date();
    const since = new Date(now.getTime() - 7 * DAY_MS).toISOString();
    const [users, sends, templates] = await Promise.all([
      db.collection('whatsappUsers').select('phoneE164', 'messages').limit(5000).get(),
      db.collection(WHATSAPP_SENDS_COLLECTION).where('createdAt', '>=', since).select('kind', 'status', 'reason', 'errorCode', 'createdAt', 'sentAt', 'uid').limit(5000).get(),
      db.collection(WHATSAPP_TEMPLATES_COLLECTION).get(),
    ]);
    const mode = WHATSAPP_ENABLED.value() === true ? templatesModeOf(WHATSAPP_TEMPLATES_MODE.value()) : 'off';
    return computeWhatsappPanel(
      users.docs.map((doc) => doc.data() as Record<string, unknown>),
      sends.docs.map((doc) => ({ id: doc.id, data: doc.data() as Record<string, unknown> })),
      templates.docs.map((doc) => ({ id: doc.id, data: doc.data() as Record<string, unknown> })),
      mode,
      now,
    );
  } catch (error) {
    wrap('adminGetWhatsapp', caller.uid, error);
  }
});

// ---------------------------------------------------------------------------------------------
// Alerts health (M14): what the phones report (alertHealth/{uid}, one entry per installation)
// ---------------------------------------------------------------------------------------------

/** One installation's report as stored: the request without its id, plus the server time. */
export const alertHealthEntrySchema = reportAlertHealthRequestSchema.omit({ installationId: true }).extend({ reportedAt: z.string().max(40) });
export type AlertHealthEntry = z.infer<typeof alertHealthEntrySchema>;

export interface AlertsHealthView {
  users: number;
  installations: number;
  notificationsOff: number;
  exactAlarmsOff: number;
  fullScreenOff: number;
  batteryRestricted: number;
  stalePlans: number;
  noAlarms: number;
  byPlatform: Record<string, number>;
  byVersion: Record<string, number>;
  /** The phones that need attention (uid and the reasons), at most 100. */
  attention: { uid: string; installation: string; platform: string; appVersion: string; reasons: string[]; reportedAt: string }[];
}

export function parseAlertHealthDoc(raw: unknown): Record<string, AlertHealthEntry> {
  const installations = (typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).installations : null) as Record<string, unknown> | null;
  const result: Record<string, AlertHealthEntry> = {};
  if (installations === null || typeof installations !== 'object') return result;
  for (const [id, value] of Object.entries(installations)) {
    const parsed = alertHealthEntrySchema.safeParse(value);
    if (parsed.success) result[id] = parsed.data;
  }
  return result;
}

export function computeAlertsHealth(docs: { uid: string; data: unknown }[], now: Date): AlertsHealthView {
  const view: AlertsHealthView = {
    users: 0,
    installations: 0,
    notificationsOff: 0,
    exactAlarmsOff: 0,
    fullScreenOff: 0,
    batteryRestricted: 0,
    stalePlans: 0,
    noAlarms: 0,
    byPlatform: {},
    byVersion: {},
    attention: [],
  };
  for (const { uid, data } of docs) {
    const entries = parseAlertHealthDoc(data);
    const ids = Object.keys(entries);
    if (ids.length === 0) continue;
    view.users += 1;
    for (const id of ids) {
      const entry = entries[id]!;
      view.installations += 1;
      view.byPlatform[entry.platform] = (view.byPlatform[entry.platform] ?? 0) + 1;
      view.byVersion[entry.appVersion] = (view.byVersion[entry.appVersion] ?? 0) + 1;
      const reasons: string[] = [];
      if (entry.notifications !== 'granted') {
        view.notificationsOff += 1;
        reasons.push('notifications_off');
      }
      if (entry.exactAlarms === false) {
        view.exactAlarmsOff += 1;
        reasons.push('exact_alarms_off');
      }
      if (entry.fullScreen === false) {
        view.fullScreenOff += 1;
        reasons.push('full_screen_off');
      }
      if (entry.batteryUnrestricted === false) {
        view.batteryRestricted += 1;
        reasons.push('battery_restricted');
      }
      const last = entry.lastReconcileAt ? Date.parse(entry.lastReconcileAt) : NaN;
      if (!Number.isFinite(last) || now.getTime() - last > DAY_MS) {
        view.stalePlans += 1;
        reasons.push('stale_plan');
      }
      if (entry.scheduledCount === 0) {
        view.noAlarms += 1;
        reasons.push('no_alarms');
      }
      if (reasons.length > 0 && view.attention.length < 100) {
        view.attention.push({ uid, installation: id, platform: entry.platform, appVersion: entry.appVersion, reasons, reportedAt: entry.reportedAt });
      }
    }
  }
  return view;
}

/** Installations kept per account (the newest reports win). */
export const MAX_ALERT_INSTALLATIONS = 5;

/** The merge of one report into alertHealth/{uid}.installations (pure). */
export function mergeAlertHealth(raw: unknown, installationId: string, entry: AlertHealthEntry): Record<string, AlertHealthEntry> {
  const installations = { ...parseAlertHealthDoc(raw), [installationId]: entry };
  const kept = Object.entries(installations)
    .sort((a, b) => b[1].reportedAt.localeCompare(a[1].reportedAt))
    .slice(0, MAX_ALERT_INSTALLATIONS);
  return Object.fromEntries(kept);
}

/** reportAlertHealth: any signed-in user, for their own account only (no secrets). */
export const reportAlertHealth = onCall(
  { region: FUNCTIONS_REGION, enforceAppCheck: false, timeoutSeconds: 10, memory: '256MiB', maxInstances: 10 },
  async (request): Promise<ReportAlertHealthResponse> => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
    const parsed = reportAlertHealthRequestSchema.safeParse(request.data ?? {});
    if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid reportAlertHealth request.');
    const { installationId, ...rest } = parsed.data;
    const db = adminDb();
    const ref = db.doc(`${ALERT_HEALTH_COLLECTION}/${request.auth.uid}`);
    const entry: AlertHealthEntry = { ...rest, reportedAt: new Date().toISOString() };
    await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      tx.set(ref, { installations: mergeAlertHealth(snapshot.exists ? snapshot.data() : undefined, installationId, entry), updatedAt: entry.reportedAt });
    });
    return { ok: true };
  },
);

export const adminGetAlertsHealth = onCall(OPTIONS, async (request): Promise<AlertsHealthView> => {
  const caller = callerOf(request.auth);
  requireViewer(caller);
  try {
    const snapshot = await adminDb().collection(ALERT_HEALTH_COLLECTION).limit(5000).get();
    return computeAlertsHealth(
      snapshot.docs.map((doc) => ({ uid: doc.id, data: doc.data() })),
      new Date(),
    );
  } catch (error) {
    wrap('adminGetAlertsHealth', caller.uid, error);
  }
});

// ---------------------------------------------------------------------------------------------
// The user page
// ---------------------------------------------------------------------------------------------

const getUserRequestSchema = z.object({ uid: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/) });

export interface UserPage {
  uid: string;
  email: string | null;
  displayName: string | null;
  disabled: boolean;
  providers: string[];
  createdAt: string | null;
  lastSignInAt: string | null;
  plan: string;
  entitlementStatus: string;
  entitlementSource: string;
  expiresAt: string | null;
  usage: { introUsed: number; introStartedAt: string | null; cycleUsed: number; cycleKey: string | null };
  whatsapp: { linked: boolean; last4: string | null; switches: Record<string, boolean>; stoppedAt: string | null; optedInAt: string | null };
  sends: WhatsappPanel['recent'];
  alerts: { installation: string; entry: AlertHealthEntry }[];
  counts: { meetings: number; tasks: number; summaries: number };
}

async function countOf(db: Firestore, path: string): Promise<number> {
  try {
    return (await db.collection(path).count().get()).data().count;
  } catch {
    return -1;
  }
}

export const adminGetUser = onCall(OPTIONS, async (request): Promise<UserPage> => {
  const caller = callerOf(request.auth);
  requireViewer(caller);
  const parsed = getUserRequestSchema.safeParse(request.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid adminGetUser request.');
  const { uid } = parsed.data;
  try {
    const db = adminDb();
    const now = new Date();
    let record: Awaited<ReturnType<ReturnType<typeof getAuth>['getUser']>>;
    try {
      record = await getAuth().getUser(uid);
    } catch {
      throw new HttpsError('not-found', 'No such user.');
    }
    const [entitlement, usage, whatsappUser, sends, health, meetings, tasks, summaries] = await Promise.all([
      db.doc(`entitlements/${uid}`).get(),
      db.doc(`usage/${uid}`).get(),
      db.doc(`whatsappUsers/${uid}`).get(),
      db.collection(WHATSAPP_SENDS_COLLECTION).where('uid', '==', uid).limit(200).get(),
      db.doc(`${ALERT_HEALTH_COLLECTION}/${uid}`).get(),
      countOf(db, `users/${uid}/meetings`),
      countOf(db, `users/${uid}/tasks`),
      countOf(db, `users/${uid}/meetingSummaries`),
    ]);
    const display = entitlementDisplayOf(entitlement.exists ? entitlement.data() : undefined, now);
    const root = readUsageRoot(usage.exists ? usage.data() : undefined);
    const wa = (whatsappUser.exists ? whatsappUser.data() : {}) as Record<string, unknown>;
    const phone = str(wa.phoneE164);
    const messages = parseMessagesRecord(wa.messages);
    const panel = computeWhatsappPanel([], sends.docs.map((doc) => ({ id: doc.id, data: doc.data() as Record<string, unknown> })), [], 'off', now);
    return {
      uid,
      email: record.email ?? null,
      displayName: record.displayName ?? null,
      disabled: record.disabled,
      providers: record.providerData.map((provider) => provider.providerId),
      createdAt: record.metadata.creationTime ? new Date(record.metadata.creationTime).toISOString() : null,
      lastSignInAt: record.metadata.lastSignInTime ? new Date(record.metadata.lastSignInTime).toISOString() : null,
      plan: display.plan,
      entitlementStatus: display.entitlementStatus,
      entitlementSource: display.entitlementSource,
      expiresAt: display.expiresAt,
      usage: { introUsed: root.introUsed, introStartedAt: root.introStartedAt, cycleUsed: root.cycleUsed, cycleKey: root.cycleKey },
      whatsapp: {
        linked: phone !== null,
        last4: phone === null ? null : phone.slice(-4),
        switches: phone !== null && messages.phoneE164 === phone ? { ...messages.switches } : {},
        stoppedAt: messages.stoppedAt,
        optedInAt: messages.optedInAt,
      },
      sends: panel.recent.slice(0, 20),
      alerts: Object.entries(parseAlertHealthDoc(health.exists ? health.data() : undefined)).map(([installation, entry]) => ({ installation, entry })),
      counts: { meetings, tasks, summaries },
    };
  } catch (error) {
    wrap('adminGetUser', caller.uid, error);
  }
});
