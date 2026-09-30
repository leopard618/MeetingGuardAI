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
import { z } from 'zod';

import { FUNCTIONS_REGION } from '../config';
import { isUserNotFound } from '../deleteAccount';
import { adminAuth, adminDb } from '../firebase';
import { planSchema, usageDayKey, type Plan } from '../shared/aiContract';
import { resolveEffectivePlan } from '../shared/entitlement';
import {
  getMetricsRequestSchema,
  getMetricsResponseSchema,
  listUsersRequestSchema,
  listUsersResponseSchema,
  setUserDisabledRequestSchema,
  setUserPlanRequestSchema,
  type ListUsersResponse,
  type GetMetricsResponse,
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
