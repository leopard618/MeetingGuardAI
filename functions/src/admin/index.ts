/**
 * Admin callables (owner: admin; contract in ./schemas.ts, docs/ARCHITECTURE.md §21).
 *
 * Every callable requires an authenticated caller whose ID token carries the custom claim
 * `admin: true` (set with functions/scripts/set-admin-claim.mjs). Handlers are pure functions
 * over an `AdminPorts` interface so unit tests never touch Firebase; the thin `onCall` wrappers
 * at the bottom bind the real Admin SDK.
 *
 * All reads/writes go through the Admin SDK, which bypasses firestore.rules by design:
 * entitlements/{uid} and usage/{uid}/days stay server-only (the rules are not weakened).
 */
import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/https';
import { AggregateField } from 'firebase-admin/firestore';
import OpenAI from 'openai';
import { z } from 'zod';

import {
  ASSISTANT_GLOBAL_DAILY_LIMIT,
  FUNCTIONS_REGION,
  OPENAI_API_KEY,
  OPENAI_MODEL,
  OPENAI_PRICE_IN_PER_M,
  OPENAI_PRICE_OUT_PER_M,
  OPENAI_REASONING_EFFORT,
  parsePricePerM,
} from '../config';
import { toUpstreamError } from '../assistant/llm';
import { isUserNotFound } from '../deleteAccount';
import { adminAuth, adminDb } from '../firebase';
import { googleAuthSecretRotator, instanceOpenAiKeyProvider, type OpenAiKeyStatus } from '../openaiKey';
import { planSchema, usageDayKey, type Plan } from '../shared/aiContract';
import { resolveEffectivePlan } from '../shared/entitlement';
import {
  adminStatsAiDayPath,
  adminStatsDayDocSchema,
  getHealthRequestSchema,
  getHealthResponseSchema,
  getMetricsRequestSchema,
  getMetricsResponseSchema,
  getStatsRequestSchema,
  getStatsResponseSchema,
  listUsersRequestSchema,
  listUsersResponseSchema,
  rotateOpenAiKeyRequestSchema,
  rotateOpenAiKeyResponseSchema,
  setUserDisabledRequestSchema,
  setUserPlanRequestSchema,
  type GetHealthResponse,
  type GetStatsResponse,
  type ListUsersResponse,
  type GetMetricsResponse,
  type RotateOpenAiKeyResponse,
  type SetUserDisabledResponse,
  type SetUserPlanResponse,
} from './schemas';

// ---------------------------------------------------------------------------------------------
// Caller / authorization
// ---------------------------------------------------------------------------------------------

export interface AdminCaller {
  uid: string;
  /** request.auth.token.admin === true (custom claim inside the ID token). */
  isAdmin: boolean;
}

/** unauthenticated without auth; permission-denied without the admin claim. */
export function requireAdmin(caller: AdminCaller | null): asserts caller is AdminCaller {
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in to use the admin API.');
  if (!caller.isAdmin) throw new HttpsError('permission-denied', 'This account is not an administrator.');
}

// ---------------------------------------------------------------------------------------------
// Ports (everything the handlers need from Auth + Firestore)
// ---------------------------------------------------------------------------------------------

export interface AdminAuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  disabled: boolean;
  /** ISO strings (Auth metadata parsed), null when absent/unparsable. */
  createdAt: string | null;
  lastSignInAt: string | null;
}

export interface AdminEntitlementWrite {
  plan: Plan;
  status: 'active';
  expiresAt: string | null;
  source: 'admin';
  updatedAt: string;
}

export interface AdminPorts {
  /** One Firebase Auth listUsers page. */
  listAuthUsers(pageSize: number, pageToken: string | null): Promise<{ users: AdminAuthUser[]; nextPageToken: string | null }>;
  /** Raw entitlements/{uid} data for the given uids; missing documents are absent from the map. */
  getEntitlements(uids: string[]): Promise<Map<string, unknown>>;
  /** usage/{uid}/days/{dayKey}.count for the given uids; missing/malformed documents are absent. */
  getUsageCounts(uids: string[], dayKey: string): Promise<Map<string, number>>;
  /** Resolves false when the Auth user does not exist. */
  setAuthUserDisabled(uid: string, disabled: boolean): Promise<boolean>;
  /** Revokes refresh tokens; a missing user is a no-op. */
  revokeRefreshTokens(uid: string): Promise<void>;
  /** True when the Auth user exists. */
  userExists(uid: string): Promise<boolean>;
  /** Replaces entitlements/{uid} (full document, not a merge). */
  writeEntitlement(uid: string, doc: AdminEntitlementWrite): Promise<void>;
  /** Total Firebase Auth users (paged count). */
  countAuthUsers(): Promise<number>;
  /** Raw data of every entitlements document (small collection: only ever-paying/admin-set users). */
  listAllEntitlements(): Promise<unknown[]>;
  /** Sum of usage day counters (collection group 'days') with updatedAt >= sinceIso. */
  sumUsageCountsSince(sinceIso: string): Promise<number>;
}

// ---------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------

/** Lenient reader of an entitlement document for DISPLAY (effective plan comes from resolveEffectivePlan). */
const entitlementDisplaySchema = z.object({
  status: z.enum(['active', 'grace_period', 'expired', 'revoked']).catch('active'),
  expiresAt: z.string().nullable().catch(null),
  source: z.string().catch('unknown'),
});

interface EntitlementDisplay {
  plan: Plan;
  entitlementStatus: 'active' | 'grace_period' | 'expired' | 'revoked';
  entitlementSource: string;
  expiresAt: string | null;
}

/** Missing document => free/active/'none'; invalid document => free but the raw fields still show. */
export function entitlementDisplayOf(raw: unknown, now: Date): EntitlementDisplay {
  const effective = resolveEffectivePlan(raw, now);
  if (raw === undefined || raw === null) {
    return { plan: 'free', entitlementStatus: 'active', entitlementSource: 'none', expiresAt: null };
  }
  const partial = entitlementDisplaySchema.safeParse(raw);
  const display = partial.success ? partial.data : { status: 'active' as const, expiresAt: null, source: 'unknown' };
  return {
    plan: effective.plan,
    entitlementStatus: display.status,
    entitlementSource: display.source,
    expiresAt: typeof display.expiresAt === 'string' ? display.expiresAt : null,
  };
}

/** UTC midnight of `date` shifted by `dayOffset` days, as an ISO string (compares with updatedAt). */
export function utcDayStartIso(date: Date, dayOffset = 0): string {
  const shifted = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + dayOffset));
  return shifted.toISOString();
}

function invalidArgument(callable: string): HttpsError {
  return new HttpsError('invalid-argument', `Invalid ${callable} request.`);
}

/** Rethrows HttpsError as-is; logs and wraps anything else as `internal`. */
function wrapUnexpected(callable: string, uid: string, error: unknown): never {
  if (error instanceof HttpsError) throw error;
  logger.error(`${callable}.failed`, {
    uid,
    errorName: error instanceof Error ? error.name : typeof error,
    errorMessage: error instanceof Error ? error.message.slice(0, 300) : '',
  });
  throw new HttpsError('internal', 'The admin operation failed. Please try again.');
}

// ---------------------------------------------------------------------------------------------
// Handlers (exported for unit tests)
// ---------------------------------------------------------------------------------------------

export const DEFAULT_LIST_PAGE_SIZE = 50;

export async function handleListUsers(
  caller: AdminCaller | null,
  data: unknown,
  ports: AdminPorts,
  now: Date = new Date(),
): Promise<ListUsersResponse> {
  requireAdmin(caller);
  const parsed = listUsersRequestSchema.safeParse(data ?? {});
  if (!parsed.success) throw invalidArgument('adminListUsers');
  const pageSize = parsed.data.pageSize ?? DEFAULT_LIST_PAGE_SIZE;
  const pageToken = parsed.data.pageToken ?? null;
  try {
    const page = await ports.listAuthUsers(pageSize, pageToken);
    const uids = page.users.map((user) => user.uid);
    const dayKey = usageDayKey(now);
    const [entitlements, usage] = await Promise.all([ports.getEntitlements(uids), ports.getUsageCounts(uids, dayKey)]);
    const users = page.users.map((user) => ({
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      disabled: user.disabled,
      createdAt: user.createdAt,
      lastSignInAt: user.lastSignInAt,
      ...entitlementDisplayOf(entitlements.get(user.uid), now),
      usageToday: usage.get(user.uid) ?? 0,
    }));
    return listUsersResponseSchema.parse({ users, nextPageToken: page.nextPageToken });
  } catch (error) {
    wrapUnexpected('adminListUsers', caller.uid, error);
  }
}

export async function handleSetUserDisabled(
  caller: AdminCaller | null,
  data: unknown,
  ports: AdminPorts,
): Promise<SetUserDisabledResponse> {
  requireAdmin(caller);
  const parsed = setUserDisabledRequestSchema.safeParse(data);
  if (!parsed.success) throw invalidArgument('adminSetUserDisabled');
  const { uid, disabled } = parsed.data;
  if (uid === caller.uid) {
    throw new HttpsError('failed-precondition', 'You cannot disable or enable your own account.', {
      reason: 'own_account',
    });
  }
  try {
    const found = await ports.setAuthUserDisabled(uid, disabled);
    if (!found) throw new HttpsError('not-found', 'No user with this uid exists.');
    // Disabling alone keeps existing ID tokens alive for up to an hour; revoking the refresh
    // tokens caps every open session at that hour.
    if (disabled) await ports.revokeRefreshTokens(uid);
    logger.info('adminSetUserDisabled.completed', { adminUid: caller.uid, uid, disabled });
    return { uid, disabled };
  } catch (error) {
    wrapUnexpected('adminSetUserDisabled', caller.uid, error);
  }
}

export async function handleSetUserPlan(
  caller: AdminCaller | null,
  data: unknown,
  ports: AdminPorts,
  now: Date = new Date(),
): Promise<SetUserPlanResponse> {
  requireAdmin(caller);
  const parsed = setUserPlanRequestSchema.safeParse(data);
  if (!parsed.success) throw invalidArgument('adminSetUserPlan');
  const { uid, plan, expiresAt } = parsed.data;
  try {
    if (!(await ports.userExists(uid))) throw new HttpsError('not-found', 'No user with this uid exists.');
    // Written for 'free' too: an explicit downgrade must override a stale paid document.
    await ports.writeEntitlement(uid, {
      plan: planSchema.parse(plan),
      status: 'active',
      expiresAt,
      source: 'admin',
      updatedAt: now.toISOString(),
    });
    logger.info('adminSetUserPlan.completed', { adminUid: caller.uid, uid, plan });
    return { uid, plan };
  } catch (error) {
    wrapUnexpected('adminSetUserPlan', caller.uid, error);
  }
}

export async function handleGetMetrics(
  caller: AdminCaller | null,
  data: unknown,
  ports: AdminPorts,
  now: Date = new Date(),
): Promise<GetMetricsResponse> {
  requireAdmin(caller);
  if (!getMetricsRequestSchema.safeParse(data).success) throw invalidArgument('adminGetMetrics');
  try {
    const todayStart = utcDayStartIso(now);
    // 7 UTC calendar days including today (updatedAt is always the counter's own day).
    const weekStart = utcDayStartIso(now, -6);
    const [totalUsers, entitlementDocs, today, last7Days] = await Promise.all([
      ports.countAuthUsers(),
      ports.listAllEntitlements(),
      ports.sumUsageCountsSince(todayStart),
      ports.sumUsageCountsSince(weekStart),
    ]);
    let pro = 0;
    let premium = 0;
    for (const doc of entitlementDocs) {
      const plan = resolveEffectivePlan(doc, now).plan;
      if (plan === 'pro') pro += 1;
      else if (plan === 'premium') premium += 1;
    }
    return getMetricsResponseSchema.parse({
      totalUsers,
      planCounts: { free: Math.max(0, totalUsers - pro - premium), pro, premium },
      assistantRequests: { today, last7Days },
    });
  } catch (error) {
    wrapUnexpected('adminGetMetrics', caller.uid, error);
  }
}

// ---------------------------------------------------------------------------------------------
// Firebase-backed ports
// ---------------------------------------------------------------------------------------------

function toIso(value: string | undefined): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

export function firebaseAdminPorts(): AdminPorts {
  const db = adminDb();
  const auth = adminAuth();
  return {
    async listAuthUsers(pageSize, pageToken) {
      const result = await auth.listUsers(pageSize, pageToken ?? undefined);
      return {
        users: result.users.map((user) => ({
          uid: user.uid,
          email: user.email ?? null,
          displayName: user.displayName ?? null,
          disabled: user.disabled,
          createdAt: toIso(user.metadata.creationTime),
          lastSignInAt: toIso(user.metadata.lastSignInTime),
        })),
        nextPageToken: result.pageToken ?? null,
      };
    },
    async getEntitlements(uids) {
      const map = new Map<string, unknown>();
      if (uids.length === 0) return map;
      const snapshots = await db.getAll(...uids.map((uid) => db.doc(`entitlements/${uid}`)));
      snapshots.forEach((snapshot, index) => {
        const uid = uids[index];
        if (uid !== undefined && snapshot.exists) map.set(uid, snapshot.data());
      });
      return map;
    },
    async getUsageCounts(uids, dayKey) {
      const map = new Map<string, number>();
      if (uids.length === 0) return map;
      const snapshots = await db.getAll(...uids.map((uid) => db.doc(`usage/${uid}/days/${dayKey}`)));
      snapshots.forEach((snapshot, index) => {
        const uid = uids[index];
        if (uid === undefined || !snapshot.exists) return;
        const count: unknown = snapshot.get('count');
        if (typeof count === 'number' && Number.isInteger(count) && count > 0) map.set(uid, count);
      });
      return map;
    },
    async setAuthUserDisabled(uid, disabled) {
      try {
        await auth.updateUser(uid, { disabled });
        return true;
      } catch (error) {
        if (isUserNotFound(error)) return false;
        throw error;
      }
    },
    async revokeRefreshTokens(uid) {
      try {
        await auth.revokeRefreshTokens(uid);
      } catch (error) {
        if (!isUserNotFound(error)) throw error;
      }
    },
    async userExists(uid) {
      try {
        await auth.getUser(uid);
        return true;
      } catch (error) {
        if (isUserNotFound(error)) return false;
        throw error;
      }
    },
    async writeEntitlement(uid, doc) {
      await db.doc(`entitlements/${uid}`).set(doc);
    },
    async countAuthUsers() {
      let total = 0;
      let pageToken: string | undefined;
      do {
        const page = await auth.listUsers(1000, pageToken);
        total += page.users.length;
        pageToken = page.pageToken;
      } while (pageToken);
      return total;
    },
    async listAllEntitlements() {
      const snapshot = await db.collection('entitlements').select('plan', 'status', 'expiresAt').get();
      return snapshot.docs.map((doc) => doc.data());
    },
    async sumUsageCountsSince(sinceIso) {
      // Needs the collection-group ASCENDING index on days.updatedAt (firestore.indexes.json).
      const snapshot = await db
        .collectionGroup('days')
        .where('updatedAt', '>=', sinceIso)
        .aggregate({ total: AggregateField.sum('count') })
        .get();
      const total = snapshot.data().total;
      return typeof total === 'number' && Number.isFinite(total) ? Math.max(0, Math.round(total)) : 0;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Callables (export names ARE the callable names; they must match ADMIN_CALLABLES)
// ---------------------------------------------------------------------------------------------

function callerOf(auth: { uid: string; token: Record<string, unknown> } | undefined): AdminCaller | null {
  if (!auth) return null;
  return { uid: auth.uid, isAdmin: auth.token.admin === true };
}

/** App Check stays off, like the other callables (see assistant/index.ts). */
const ADMIN_CALLABLE_OPTIONS = {
  region: FUNCTIONS_REGION,
  enforceAppCheck: false,
  timeoutSeconds: 60,
  memory: '256MiB',
  maxInstances: 5,
} as const;

export const adminListUsers = onCall(ADMIN_CALLABLE_OPTIONS, (request): Promise<ListUsersResponse> =>
  handleListUsers(callerOf(request.auth), request.data, firebaseAdminPorts()),
);

export const adminSetUserDisabled = onCall(ADMIN_CALLABLE_OPTIONS, (request): Promise<SetUserDisabledResponse> =>
  handleSetUserDisabled(callerOf(request.auth), request.data, firebaseAdminPorts()),
);

export const adminSetUserPlan = onCall(ADMIN_CALLABLE_OPTIONS, (request): Promise<SetUserPlanResponse> =>
  handleSetUserPlan(callerOf(request.auth), request.data, firebaseAdminPorts()),
);

export const adminGetMetrics = onCall(ADMIN_CALLABLE_OPTIONS, (request): Promise<GetMetricsResponse> =>
  handleGetMetrics(callerOf(request.auth), request.data, firebaseAdminPorts()),
);

// =============================================================================================
// v2: adminGetStats / adminGetHealth / adminRotateOpenAiKey (docs/ADMIN.md §v2).
// The v1 code above is untouched; everything below is additive.
// =============================================================================================

// ---------------------------------------------------------------------------------------------
// v2 ports
// ---------------------------------------------------------------------------------------------

export interface AdminStatsPorts {
  /** Raw adminStats/ai/days documents for the given day keys; missing days absent from the map. */
  getStatsDays(dayKeys: string[]): Promise<Map<string, unknown>>;
  /** creationTime (ISO) of every Firebase Auth user (paged listUsers; unparsable times dropped). */
  listAuthCreationTimes(): Promise<string[]>;
  /** Pricing params in USD per 1M tokens (0 = unset; functions/src/config.ts). */
  pricing(): { inPerM: number; outPerM: number };
}

export interface AssistantPingResult {
  ok: boolean;
  latencyMs: number;
  /** SHORT category string (e.g. "configuration (401)"), never a response body. */
  error?: string;
}

export interface AdminHealthPorts {
  runtimeConfig(): { model: string; reasoningEffort: string; globalDailyLimit: number };
  /** Secret runtime state (functions/src/openaiKey.ts status(); never the key value). */
  keyStatus(): Promise<OpenAiKeyStatus>;
  /** ONE minimal real OpenAI chat completion (costs money); resolves instead of throwing. */
  pingAssistant(): Promise<AssistantPingResult>;
}

export interface AdminRotatePorts {
  /** GET api.openai.com/v1/models with the candidate key; throws only when OpenAI is unreachable. */
  fetchOpenAiModels(candidateKey: string): Promise<{ status: number; modelIds: string[] }>;
  configuredModel(): string;
  /** Secret Manager addVersion; resolves the new BARE version number. */
  addSecretVersion(value: string): Promise<{ version: string }>;
  /** Bare numbers of every currently ENABLED version (including the one just added). */
  listEnabledSecretVersions(): Promise<string[]>;
  disableSecretVersion(version: string): Promise<void>;
  /** Busts this instance's key cache (others refresh within the TTL or on 401-retry). */
  invalidateKeyCache(): void;
}

// ---------------------------------------------------------------------------------------------
// v2 pure helpers
// ---------------------------------------------------------------------------------------------

/** The last `days` UTC day keys INCLUDING `now`'s day, oldest -> newest (the chart x-axis). */
export function statsDayKeys(now: Date, days: number): string[] {
  const keys: string[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    keys.push(usageDayKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset))));
  }
  return keys;
}

// ---------------------------------------------------------------------------------------------
// v2 handlers (exported for unit tests)
// ---------------------------------------------------------------------------------------------

export async function handleGetStats(
  caller: AdminCaller | null,
  data: unknown,
  ports: AdminStatsPorts,
  now: Date = new Date(),
): Promise<GetStatsResponse> {
  requireAdmin(caller);
  const parsed = getStatsRequestSchema.safeParse(data);
  if (!parsed.success) throw invalidArgument('adminGetStats');
  try {
    const dayKeys = statsDayKeys(now, parsed.data.days);
    const [docs, creationTimes] = await Promise.all([ports.getStatsDays(dayKeys), ports.listAuthCreationTimes()]);
    const days = dayKeys.map((date) => {
      const raw = docs.get(date);
      const doc = raw === undefined ? null : adminStatsDayDocSchema.safeParse(raw);
      return {
        date,
        requests: doc?.success ? doc.data.requests : 0,
        inputTokens: doc?.success ? doc.data.inputTokens : 0,
        outputTokens: doc?.success ? doc.data.outputTokens : 0,
      };
    });
    const signupCounts = new Map<string, number>();
    for (const iso of creationTimes) {
      const ms = Date.parse(iso);
      if (Number.isNaN(ms)) continue;
      const key = usageDayKey(new Date(ms));
      signupCounts.set(key, (signupCounts.get(key) ?? 0) + 1);
    }
    const signups = dayKeys.map((date) => ({ date, count: signupCounts.get(date) ?? 0 }));
    const totals = {
      requests: days.reduce((sum, day) => sum + day.requests, 0),
      inputTokens: days.reduce((sum, day) => sum + day.inputTokens, 0),
      outputTokens: days.reduce((sum, day) => sum + day.outputTokens, 0),
      signups: signups.reduce((sum, day) => sum + day.count, 0),
    };
    const { inPerM, outPerM } = ports.pricing();
    // null when pricing is unset (both 0) => the dashboard hides the cost tile; 4 decimals.
    const estCostUsd =
      inPerM === 0 && outPerM === 0
        ? null
        : Math.round(((totals.inputTokens / 1e6) * inPerM + (totals.outputTokens / 1e6) * outPerM) * 10_000) / 10_000;
    return getStatsResponseSchema.parse({ days, signups, totals, estCostUsd, pricing: { inPerM, outPerM, source: 'param' } });
  } catch (error) {
    wrapUnexpected('adminGetStats', caller.uid, error);
  }
}

export async function handleGetHealth(
  caller: AdminCaller | null,
  data: unknown,
  ports: AdminHealthPorts,
): Promise<GetHealthResponse> {
  requireAdmin(caller);
  const parsed = getHealthRequestSchema.safeParse(data);
  if (!parsed.success) throw invalidArgument('adminGetHealth');
  // ping:true makes ONE real (billed) OpenAI call; the dashboard sends it only from the
  // Settings "Test assistant" button, never on page load.
  const ping = parsed.data?.ping === true;
  try {
    const config = ports.runtimeConfig();
    const secretRuntime = await ports.keyStatus();
    return getHealthResponseSchema.parse({
      model: config.model,
      reasoningEffort: config.reasoningEffort,
      globalDailyLimit: Math.max(0, config.globalDailyLimit),
      secretRuntime,
      ...(ping ? { assistantPing: await ports.pingAssistant() } : {}),
    });
  } catch (error) {
    wrapUnexpected('adminGetHealth', caller.uid, error);
  }
}

/**
 * SECURITY (grep: never-log-openai-key): `newKey` is the OpenAI API key candidate. It must NEVER
 * be logged, embedded in an error message, written to Firestore or echoed in the response. Every
 * error thrown here is a fixed string plus at most an HTTP status; the network failure below
 * deliberately DROPS the caught error so no request detail can ride along into wrapUnexpected.
 */
export async function handleRotateOpenAiKey(
  caller: AdminCaller | null,
  data: unknown,
  ports: AdminRotatePorts,
): Promise<RotateOpenAiKeyResponse> {
  requireAdmin(caller);
  const parsed = rotateOpenAiKeyRequestSchema.safeParse(data);
  if (!parsed.success) throw invalidArgument('adminRotateOpenAiKey');
  const newKey = parsed.data.newKey;
  try {
    // 1. Validate the candidate against OpenAI BEFORE storing anything.
    let models: { status: number; modelIds: string[] };
    try {
      models = await ports.fetchOpenAiModels(newKey);
    } catch {
      throw new HttpsError('unavailable', 'OpenAI could not be reached to validate the key. Nothing was changed.');
    }
    if (models.status === 401) {
      throw new HttpsError('failed-precondition', 'OpenAI rejected this key (HTTP 401). Nothing was changed.', {
        reason: 'invalid_key',
      });
    }
    if (models.status !== 200) {
      throw new HttpsError(
        'failed-precondition',
        `OpenAI answered HTTP ${models.status} while validating the key. Nothing was changed.`,
      );
    }
    const model = ports.configuredModel();
    const modelAvailable = models.modelIds.includes(model);
    if (!modelAvailable) logger.warn('adminRotateOpenAiKey.model_missing', { model }); // warn-not-block
    // 2. Store, 3. keep only the new version enabled, 4. bust this instance's cache.
    const { version } = await ports.addSecretVersion(newKey);
    const enabled = await ports.listEnabledSecretVersions();
    const prior = enabled.filter((candidate) => candidate !== version);
    for (const priorVersion of prior) {
      await ports.disableSecretVersion(priorVersion);
    }
    ports.invalidateKeyCache();
    logger.info('adminRotateOpenAiKey.completed', {
      adminUid: caller.uid,
      version,
      modelAvailable,
      disabledVersions: prior.length,
    });
    return rotateOpenAiKeyResponseSchema.parse({ ok: true, version, modelAvailable });
  } catch (error) {
    wrapUnexpected('adminRotateOpenAiKey', caller.uid, error);
  }
}

// ---------------------------------------------------------------------------------------------
// v2 Firebase/OpenAI-backed ports
// ---------------------------------------------------------------------------------------------

/** OpenAI validation (rotation) is one small GET; the ping is one tiny completion. */
export const ROTATE_VALIDATE_TIMEOUT_MS = 5_000;
export const ASSISTANT_PING_TIMEOUT_MS = 10_000;

export function firebaseStatsPorts(): AdminStatsPorts {
  const db = adminDb();
  const auth = adminAuth();
  return {
    async getStatsDays(dayKeys) {
      const map = new Map<string, unknown>();
      if (dayKeys.length === 0) return map;
      const snapshots = await db.getAll(...dayKeys.map((dayKey) => db.doc(adminStatsAiDayPath(dayKey))));
      snapshots.forEach((snapshot, index) => {
        const dayKey = dayKeys[index];
        if (dayKey !== undefined && snapshot.exists) map.set(dayKey, snapshot.data());
      });
      return map;
    },
    async listAuthCreationTimes() {
      const times: string[] = [];
      let pageToken: string | undefined;
      do {
        const page = await auth.listUsers(1000, pageToken);
        for (const user of page.users) {
          const iso = toIso(user.metadata.creationTime);
          if (iso !== null) times.push(iso);
        }
        pageToken = page.pageToken;
      } while (pageToken);
      return times;
    },
    pricing() {
      return {
        inPerM: parsePricePerM(OPENAI_PRICE_IN_PER_M.value()),
        outPerM: parsePricePerM(OPENAI_PRICE_OUT_PER_M.value()),
      };
    },
  };
}

function adminHealthPorts(): AdminHealthPorts {
  const provider = instanceOpenAiKeyProvider();
  return {
    runtimeConfig: () => ({
      model: OPENAI_MODEL.value(),
      reasoningEffort: OPENAI_REASONING_EFFORT.value(),
      globalDailyLimit: ASSISTANT_GLOBAL_DAILY_LIMIT.value(),
    }),
    keyStatus: () => provider.status(),
    async pingAssistant() {
      const startedAt = Date.now();
      try {
        const { key } = await provider.get();
        const client = new OpenAI({ apiKey: key, timeout: ASSISTANT_PING_TIMEOUT_MS, maxRetries: 0 });
        await client.chat.completions.create(
          {
            model: OPENAI_MODEL.value(),
            messages: [{ role: 'user', content: 'ping' }],
            // 16, not 1: reasoning models can answer empty at 1 token; the cost is still ~zero.
            max_completion_tokens: 16,
            store: false,
          },
          { signal: AbortSignal.timeout(ASSISTANT_PING_TIMEOUT_MS) },
        );
        return { ok: true, latencyMs: Date.now() - startedAt };
      } catch (error) {
        // Category + status only (never a response body, never the key).
        const upstream = toUpstreamError(error);
        return {
          ok: false,
          latencyMs: Date.now() - startedAt,
          error: upstream.status !== null ? `${upstream.kind} (${upstream.status})` : upstream.kind,
        };
      }
    },
  };
}

function adminRotatePorts(): AdminRotatePorts {
  const provider = instanceOpenAiKeyProvider();
  const rotator = googleAuthSecretRotator();
  return {
    async fetchOpenAiModels(candidateKey) {
      const response = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${candidateKey}` },
        signal: AbortSignal.timeout(ROTATE_VALIDATE_TIMEOUT_MS),
      });
      if (!response.ok) return { status: response.status, modelIds: [] };
      const body = (await response.json()) as { data?: Array<{ id?: unknown }> };
      const modelIds: string[] = [];
      for (const entry of body.data ?? []) {
        if (typeof entry.id === 'string' && entry.id.length > 0) modelIds.push(entry.id);
      }
      return { status: response.status, modelIds };
    },
    configuredModel: () => OPENAI_MODEL.value(),
    addSecretVersion: (value) => rotator.addVersion(value),
    listEnabledSecretVersions: () => rotator.listEnabledVersions(),
    disableSecretVersion: (version) => rotator.disableVersion(version),
    invalidateKeyCache: () => provider.invalidate(),
  };
}

// ---------------------------------------------------------------------------------------------
// v2 callables
// ---------------------------------------------------------------------------------------------

export const adminGetStats = onCall(ADMIN_CALLABLE_OPTIONS, (request): Promise<GetStatsResponse> =>
  handleGetStats(callerOf(request.auth), request.data, firebaseStatsPorts()),
);

/** Binds the secret: the key provider's env fallback and the optional ping read it. */
export const adminGetHealth = onCall(
  { ...ADMIN_CALLABLE_OPTIONS, secrets: [OPENAI_API_KEY] },
  (request): Promise<GetHealthResponse> => handleGetHealth(callerOf(request.auth), request.data, adminHealthPorts()),
);

export const adminRotateOpenAiKey = onCall(ADMIN_CALLABLE_OPTIONS, (request): Promise<RotateOpenAiKeyResponse> =>
  handleRotateOpenAiKey(callerOf(request.auth), request.data, adminRotatePorts()),
);
