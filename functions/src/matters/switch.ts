/**
 * A4: the assistant's on/off switch, without a deploy (docs/v2/A4-THREAT-MODEL.md, "switching it
 * off at once").
 *
 * matterSettings/global { enabled, updatedAt, updatedBy } (server only; no client rule). A missing
 * document or field means ON: the deploy-time gates (MATTERS_ENABLED, MATTERS_ALLOWED_UIDS) still
 * decide first. Each instance reads it at most every MATTERS_TUNING.switchCacheMs, so a switch-off
 * reaches every instance within that time.
 *
 * Off means: every matter callable answers not_configured (matterCancel and matterDelete still
 * work, so an owner can always stop and remove their own matter); matterTick sends nothing, reads
 * nothing and books nothing (only the retention purge runs); a reply that arrives is stored and its
 * read waits in the read queue until the switch is on again. The inbound webhook keeps storing
 * replies, so nothing a contact writes is lost.
 *
 * matterAdminSwitch (admin dashboard): an admin turns it off or on; a viewer may read it.
 * matterAdminUsage (admin dashboard): each user's assistant cost per day (matterSpend), for a viewer.
 */
import { HttpsError } from 'firebase-functions/https';
import * as logger from 'firebase-functions/logger';
import { z } from 'zod';

import { usageDayKey } from '../shared/aiContract';

export interface SwitchState {
  enabled: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** The switch document as read (null = missing): only enabled === false turns it off. */
export function switchStateOf(data: unknown): SwitchState {
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    enabled: d.enabled !== false,
    updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : null,
    updatedBy: typeof d.updatedBy === 'string' ? d.updatedBy : null,
  };
}

/**
 * A short per-instance cache of the switch. A read that fails keeps the last known value (on at
 * first): an outage of one document read never stops the assistant, and never turns it back on
 * after a confirmed off either.
 */
export function createRuntimeSwitch(read: () => Promise<unknown>, cacheMs: number, now: () => number = Date.now) {
  let cached: { enabled: boolean; at: number } | null = null;
  return {
    async isOn(): Promise<boolean> {
      const t = now();
      if (cached && t - cached.at < cacheMs) return cached.enabled;
      try {
        cached = { enabled: switchStateOf(await read()).enabled, at: t };
      } catch (error) {
        logger.warn('matters.switch_read_failed', { errorName: error instanceof Error ? error.name : 'unknown' });
        cached = { enabled: cached?.enabled ?? true, at: t };
      }
      return cached.enabled;
    },
    clear(): void {
      cached = null;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The admin callables
// ---------------------------------------------------------------------------------------------

export interface AdminCaller {
  uid: string;
  isAdmin: boolean;
  isViewer: boolean;
}

/** The same claims as the admin dashboard (admin/index.ts): admin === true writes, adminRole 'viewer' reads. */
export function adminCallerOf(auth: { uid: string; token: Record<string, unknown> } | undefined): AdminCaller | null {
  if (!auth) return null;
  const isAdmin = auth.token.admin === true;
  return { uid: auth.uid, isAdmin, isViewer: isAdmin || auth.token.adminRole === 'viewer' };
}

function requireViewer(caller: AdminCaller | null): AdminCaller {
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in to use the admin API.');
  if (!caller.isViewer) throw new HttpsError('permission-denied', 'This account has no admin access.');
  return caller;
}

export interface AdminDeps {
  readSwitch(): Promise<unknown>;
  writeSwitch(state: { enabled: boolean; updatedAt: string; updatedBy: string }): Promise<void>;
  /** matterSpend documents of the days from `fromDay` to `toDay` (both "YYYY-MM-DD"). */
  listSpend(fromDay: string, toDay: string): Promise<unknown[]>;
  now(): Date;
}

export const matterAdminSwitchRequestSchema = z.object({ enabled: z.boolean().optional() }).strict();

/** Reads the switch; with `enabled`, an admin sets it (logged with the admin's uid). */
export async function handleMatterAdminSwitch(callerIn: AdminCaller | null, data: unknown, deps: AdminDeps): Promise<SwitchState> {
  const caller = requireViewer(callerIn);
  const parsed = matterAdminSwitchRequestSchema.safeParse(data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');
  if (parsed.data.enabled === undefined) return switchStateOf(await deps.readSwitch());
  if (!caller.isAdmin) throw new HttpsError('permission-denied', 'This account is not an administrator.');
  const state = { enabled: parsed.data.enabled, updatedAt: deps.now().toISOString(), updatedBy: caller.uid };
  await deps.writeSwitch(state);
  logger.warn('matters.switch_set', { enabled: state.enabled, by: caller.uid });
  return state;
}

export const matterAdminUsageRequestSchema = z.object({ days: z.number().int().min(1).max(31).optional() }).strict();

const spendDocSchema = z.object({
  uid: z.string().min(1),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  micros: z.number().catch(0),
  modelCalls: z.number().catch(0),
  inputTokens: z.number().catch(0),
  outputTokens: z.number().catch(0),
  speechChars: z.number().catch(0),
});

export interface MatterAdminUsageRow {
  uid: string;
  costUsd: number;
  todayUsd: number;
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  speechChars: number;
  activeDays: number;
}

export interface MatterAdminUsageResponse {
  fromDay: string;
  toDay: string;
  totalUsd: number;
  users: MatterAdminUsageRow[];
}

/** Rows shown at most (the highest cost first). */
export const ADMIN_USAGE_MAX_ROWS = 200;

const usd = (micros: number) => Math.round(micros) / 1_000_000;

/** Each user's assistant cost over the last `days` UTC days (today included), highest first. */
export async function handleMatterAdminUsage(callerIn: AdminCaller | null, data: unknown, deps: AdminDeps): Promise<MatterAdminUsageResponse> {
  requireViewer(callerIn);
  const parsed = matterAdminUsageRequestSchema.safeParse(data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');
  const days = parsed.data.days ?? 7;
  const now = deps.now();
  const toDay = usageDayKey(now);
  const fromDay = usageDayKey(new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000));
  const rows = new Map<string, MatterAdminUsageRow & { micros: number; today: number }>();
  for (const raw of await deps.listSpend(fromDay, toDay)) {
    const parsedDoc = spendDocSchema.safeParse(raw);
    if (!parsedDoc.success || parsedDoc.data.day < fromDay || parsedDoc.data.day > toDay) continue;
    const doc = parsedDoc.data;
    const row = rows.get(doc.uid) ?? { uid: doc.uid, costUsd: 0, todayUsd: 0, modelCalls: 0, inputTokens: 0, outputTokens: 0, speechChars: 0, activeDays: 0, micros: 0, today: 0 };
    row.micros += doc.micros;
    if (doc.day === toDay) row.today += doc.micros;
    row.modelCalls += doc.modelCalls;
    row.inputTokens += doc.inputTokens;
    row.outputTokens += doc.outputTokens;
    row.speechChars += doc.speechChars;
    row.activeDays += 1;
    rows.set(doc.uid, row);
  }
  const all = [...rows.values()].sort((a, b) => b.micros - a.micros);
  const total = all.reduce((sum, row) => sum + row.micros, 0);
  return {
    fromDay,
    toDay,
    totalUsd: usd(total),
    users: all.slice(0, ADMIN_USAGE_MAX_ROWS).map(({ micros, today, ...row }) => ({ ...row, costUsd: usd(micros), todayUsd: usd(today) })),
  };
}
