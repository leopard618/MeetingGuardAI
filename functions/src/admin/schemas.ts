/**
 * Admin callables: request/response schemas (owner: admin; docs/ARCHITECTURE.md §21).
 * zod lives in functions ONLY (the admin web app is plain JS and validates nothing itself).
 *
 * Every callable in functions/src/admin/index.ts:
 * - requires request.auth (unauthenticated otherwise) AND request.auth.token.admin === true
 *   (permission-denied otherwise). The claim is set with functions/scripts/set-admin-claim.mjs;
 *   claims travel inside the ID token, so the admin page forces getIdToken(true) after sign-in
 *   before deciding whether to show the UI.
 * - validates request.data with the *RequestSchema here (invalid-argument on failure).
 */
import { z } from 'zod';

import { PLANS } from '../shared/aiContract';

export const ADMIN_CALLABLES = {
  listUsers: 'adminListUsers',
  setUserDisabled: 'adminSetUserDisabled',
  setUserPlan: 'adminSetUserPlan',
  getMetrics: 'adminGetMetrics',
} as const;

const uidSchema = z.string().min(1).max(128);

// ---- adminListUsers (paginated auth listing + entitlement/usage join) ------------------------

export const listUsersRequestSchema = z.object({
  /** Firebase Auth listUsers page token; null/absent = first page. */
  pageToken: z.string().min(1).max(1024).nullable().optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
});

export const adminUserRowSchema = z.object({
  uid: uidSchema,
  email: z.string().nullable(),
  displayName: z.string().nullable(),
  disabled: z.boolean(),
  createdAt: z.string().nullable(),
  lastSignInAt: z.string().nullable(),
  /** Effective entitlement (missing doc => free/default). */
  plan: z.enum(PLANS),
  entitlementStatus: z.enum(['active', 'grace_period', 'expired', 'revoked']),
  entitlementSource: z.string(),
  expiresAt: z.string().nullable(),
  /** Assistant requests today (usage/{uid}/days/{UTC today}.count; 0 when absent). */
  usageToday: z.number().int().min(0),
});

export const listUsersResponseSchema = z.object({
  users: z.array(adminUserRowSchema),
  nextPageToken: z.string().nullable(),
});

// ---- adminSetUserDisabled --------------------------------------------------------------------

export const setUserDisabledRequestSchema = z.object({
  uid: uidSchema,
  disabled: z.boolean(),
});

/** Disabling also revokes refresh tokens, so open sessions die within an hour. */
export const setUserDisabledResponseSchema = z.object({ uid: uidSchema, disabled: z.boolean() });

// ---- adminSetUserPlan ------------------------------------------------------------------------

export const setUserPlanRequestSchema = z.object({
  uid: uidSchema,
  plan: z.enum(PLANS),
  /** null = no expiry (a manual grant that stays until changed). */
  expiresAt: z.iso.datetime().nullable(),
});

/**
 * Writes entitlements/{uid} { plan, status: 'active', expiresAt, source: 'admin', updatedAt }
 * via the Admin SDK (rules deny client writes; nothing is weakened). plan 'free' writes the
 * document too (an explicit downgrade must override a stale paid document).
 */
export const setUserPlanResponseSchema = z.object({ uid: uidSchema, plan: z.enum(PLANS) });

// ---- adminGetMetrics -------------------------------------------------------------------------

export const getMetricsRequestSchema = z.object({}).optional().nullable();

export const getMetricsResponseSchema = z.object({
  /** Firebase Auth user count (paged count). */
  totalUsers: z.number().int().min(0),
  /** Entitlement documents by CURRENT plan (users without a document count as free). */
  planCounts: z.object({ free: z.number().int(), pro: z.number().int(), premium: z.number().int() }),
  /**
   * Assistant requests: sum of usage day documents (collection group 'days',
   * updatedAt >= boundary; needs the collection-group index on days.updatedAt).
   */
  assistantRequests: z.object({ today: z.number().int().min(0), last7Days: z.number().int().min(0) }),
});
