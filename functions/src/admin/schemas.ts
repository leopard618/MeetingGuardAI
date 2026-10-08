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
  // v2 (docs/ADMIN.md §v2): time-series stats, runtime health and OpenAI key rotation.
  getStats: 'adminGetStats',
  getHealth: 'adminGetHealth',
  rotateOpenAiKey: 'adminRotateOpenAiKey',
} as const;

/**
 * Target uid of a WRITE request: same charset the RevenueCat webhook enforces (SAFE_DOC_ID in
 * functions/src/revenuecat/index.ts). Every Firebase-generated uid matches; a '/' (legal in
 * Admin-SDK-created uids) would otherwise splice extra path segments into the
 * `entitlements/${uid}` / `usage/${uid}/days/...` document paths.
 */
const uidSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);

/** uid as REPORTED in responses (listUsers must render whatever Auth returns, not reject it). */
const reportedUidSchema = z.string().min(1).max(200);

// ---- adminListUsers (paginated auth listing + entitlement/usage join) ------------------------

export const listUsersRequestSchema = z.object({
  /** Firebase Auth listUsers page token; null/absent = first page. */
  pageToken: z.string().min(1).max(1024).nullable().optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
});

export const adminUserRowSchema = z.object({
  uid: reportedUidSchema,
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

export type AdminUserRow = z.infer<typeof adminUserRowSchema>;
export type ListUsersResponse = z.infer<typeof listUsersResponseSchema>;

// ---- adminSetUserDisabled --------------------------------------------------------------------

export const setUserDisabledRequestSchema = z.object({
  uid: uidSchema,
  disabled: z.boolean(),
});

/** Disabling also revokes refresh tokens, so open sessions die within an hour. */
export const setUserDisabledResponseSchema = z.object({ uid: uidSchema, disabled: z.boolean() });

export type SetUserDisabledResponse = z.infer<typeof setUserDisabledResponseSchema>;

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

export type SetUserPlanResponse = z.infer<typeof setUserPlanResponseSchema>;

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

export type GetMetricsResponse = z.infer<typeof getMetricsResponseSchema>;

// =============================================================================================
// v2 contracts (ARCHITECT-OWNED: implementers build against these, they do not reshape them).
// Pipeline: the assistant handler aggregates per-UTC-day usage into a RANDOM shard document
// adminStats/ai/days/{yyyy-mm-dd}/shards/{0..N-1} (dayKey = usageDayKey(now), same key as the
// quota) with a single merge-set of FieldValue.increment transforms AFTER a successful OpenAI
// completion, wrapped in try/catch: a stats failure is logged (warn) and NEVER fails the user
// request. Sharding dodges Firestore's ~1 sustained write/s single-document limit (one hot day
// doc across concurrency 20 x maxInstances 20 would silently drop increments under bursts);
// adminGetStats sums the shards PLUS the pre-shard legacy day document when reading.
// firestore.rules: adminStats/** has an explicit client deny (Admin SDK only).
// =============================================================================================

/** UTC calendar day, the document id under adminStats/ai/days (and the stats bucket key). */
const statsDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Firestore document path of one aggregate day (collection: adminStats, doc: ai, sub: days). */
export function adminStatsAiDayPath(dayKey: string): string {
  return `adminStats/ai/days/${dayKey}`;
}

/** Write shards per day document (read path sums them, so this can grow without migration). */
export const AI_STATS_SHARD_COUNT = 10;

/** Path of one write shard of a day's aggregate (shard in 0..AI_STATS_SHARD_COUNT-1). */
export function adminStatsAiShardPath(dayKey: string, shard: number): string {
  return `${adminStatsAiDayPath(dayKey)}/shards/${shard}`;
}

/**
 * Shape of one aggregate document - both a write shard (adminStats/ai/days/{day}/shards/{n},
 * the only place the assistant writes since the shard change) and the pre-shard legacy day
 * document (adminStats/ai/days/{day}); the read path sums whichever exist per day.
 * `requests` counts completions OpenAI returned (billed work); token fields come from the
 * completion's usage object (0 when OpenAI omitted it). Written only by the assistant callable.
 * uniqueUsers/byModel were considered and SKIPPED for v2 (decision in docs/ADMIN.md §v2).
 */
export const adminStatsDayDocSchema = z.object({
  requests: z.number().int().min(0).catch(0),
  inputTokens: z.number().int().min(0).catch(0),
  outputTokens: z.number().int().min(0).catch(0),
  updatedAt: z.string().catch(''),
});

export type AdminStatsDayDoc = z.infer<typeof adminStatsDayDocSchema>;

// ---- adminGetStats (time series for the AI-usage charts + signups from Auth creationTime) ----

export const STATS_RANGES = [7, 14, 30, 90] as const;
export type StatsRange = (typeof STATS_RANGES)[number];

/** days = how many UTC calendar days INCLUDING today; the response is zero-filled per day. */
export const getStatsRequestSchema = z.object({
  days: z.union([z.literal(7), z.literal(14), z.literal(30), z.literal(90)]),
});

export const statsDayPointSchema = z.object({
  date: statsDateSchema,
  requests: z.number().int().min(0),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
});

export const signupsDayPointSchema = z.object({
  date: statsDateSchema,
  /** Firebase Auth users whose metadata.creationTime falls on this UTC day. */
  count: z.number().int().min(0),
});

/**
 * `days` and `signups` are oldest -> newest, EXACTLY `request.days` entries each (missing days
 * zero-filled server-side; the chart renderer never fills gaps). Signups are derived by paging
 * auth.listUsers and bucketing creationTime per UTC day - no new writes anywhere.
 * estCostUsd = null when pricing is unset (both params parse to 0); otherwise
 * totals.inputTokens/1e6*inPerM + totals.outputTokens/1e6*outPerM, rounded to 4 decimals.
 * Pricing params: OPENAI_PRICE_IN_PER_M / OPENAI_PRICE_OUT_PER_M (functions/src/config.ts).
 */
export const getStatsResponseSchema = z.object({
  days: z.array(statsDayPointSchema),
  signups: z.array(signupsDayPointSchema),
  totals: z.object({
    requests: z.number().int().min(0),
    inputTokens: z.number().int().min(0),
    outputTokens: z.number().int().min(0),
    signups: z.number().int().min(0),
  }),
  estCostUsd: z.number().min(0).nullable(),
  pricing: z.object({
    inPerM: z.number().min(0),
    outPerM: z.number().min(0),
    source: z.literal('param'),
  }),
});

export type StatsDayPoint = z.infer<typeof statsDayPointSchema>;
export type GetStatsResponse = z.infer<typeof getStatsResponseSchema>;

// ---- adminGetHealth (runtime configuration + secret state (+ optional real OpenAI ping)) -----

/** ping=true makes ONE minimal real OpenAI call (costs money): only the Settings button sends it. */
export const getHealthRequestSchema = z.object({ ping: z.boolean().optional() }).optional().nullable();

/**
 * secretRuntime mirrors OpenAiKeyStatus (functions/src/openaiKey.ts): mode 'rest' = key served
 * from Secret Manager REST (version = e.g. "3"), 'env-fallback' = REST failed or IAM missing and
 * the env-bound defineSecret value is in use. iamReady=false => Settings shows the exact grant
 * command (functions/README.md "OpenAI key rotation"). assistantPing is absent unless requested;
 * its error is a SHORT category string (e.g. "auth_failed (401)"), never a response body.
 */
export const getHealthResponseSchema = z.object({
  model: z.string(),
  /** Raw OPENAI_REASONING_EFFORT param value ('low', 'omit', ...). */
  reasoningEffort: z.string(),
  globalDailyLimit: z.number().int().min(0),
  secretRuntime: z.object({
    mode: z.enum(['rest', 'env-fallback']),
    version: z.string().nullable(),
    lastRotatedAt: z.string().nullable(),
    iamReady: z.boolean(),
  }),
  assistantPing: z
    .object({
      ok: z.boolean(),
      latencyMs: z.number().int().min(0),
      error: z.string().max(200).optional(),
    })
    .optional(),
});

export type GetHealthResponse = z.infer<typeof getHealthResponseSchema>;

// ---- adminRotateOpenAiKey --------------------------------------------------------------------

/**
 * SECURITY BAR: the key value must never appear in logs, errors, Firestore, responses or the
 * DOM longer than needed. Server flow (functions/src/admin/index.ts, v2):
 *  1. Validate the candidate against GET api.openai.com/v1/models (expect 200; a non-200 throws
 *     failed-precondition WITHOUT echoing anything the caller sent). modelAvailable = whether
 *     OPENAI_MODEL.value() is in the list - warn-not-block.
 *  2. Secret Manager REST addVersion on projects/<project>/secrets/OPENAI_API_KEY.
 *  3. Disable all PRIOR enabled versions (keep only the new one), then invalidate the in-memory
 *     key cache (other instances refresh within the 5-minute TTL or on the 401-retry path).
 */
export const rotateOpenAiKeyRequestSchema = z.object({
  newKey: z.string().trim().min(20).max(512),
});

/** version is the bare Secret Manager version number (e.g. "4"), not the full resource name. */
export const rotateOpenAiKeyResponseSchema = z.object({
  ok: z.literal(true),
  version: z.string(),
  modelAvailable: z.boolean(),
});

export type RotateOpenAiKeyResponse = z.infer<typeof rotateOpenAiKeyResponseSchema>;
