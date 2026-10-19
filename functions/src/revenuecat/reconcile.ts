/**
 * Entitlement self-heal against the RevenueCat REST API (owner: billing; docs/v1/ARCHITECTURE.md
 * §20, setup docs/v1/SETUP.md §11). Closes the known webhook gaps: a same-user Restore emits NO
 * webhook event, deliveries can be missed while functions were undeployed, and an admin write
 * can drift from the store truth.
 *
 * `adminReconcileEntitlement({ uid })` (admin custom claim required, like every admin callable):
 * GET https://api.revenuecat.com/v1/subscribers/{uid} with the SECRET API key
 * (REVENUECAT_SECRET_KEY - a Secret Manager secret bound ONLY to this callable), map the
 * subscriber to the SAME entitlements/{uid} document shape the webhook writes
 * (`EntitlementWrite` from ./mapping), and write ONLY on drift. A 404 (no subscriber at all)
 * counts as "the store backs nothing", not as an error. On-demand only by design: a
 * scheduled sweep would call RevenueCat for every subscriber daily and mass-write silently;
 * drift is rare and user-visible, so the admin Users table gets a per-user "Reconcile" button
 * instead. A future sweep can reuse `entitlementFromSubscriber` + `decideReconcile` unchanged.
 *
 * Deploy gating (the exact ZOOM_ENABLED / WHATSAPP_ENABLED pattern): the callable is exported
 * ONLY while the non-secret REVENUECAT_RECONCILE_ENABLED param is true at deploy time, so a
 * default deploy never references REVENUECAT_SECRET_KEY and cannot fail on a missing secret.
 * Owner order (docs/v1/SETUP.md §11): set the secret FIRST, then
 * REVENUECAT_RECONCILE_ENABLED=true in functions/.env.<projectId>, then deploy.
 *
 * Reconcile vs the other writers (docs/v1/HANDOFF.md §6 precedence):
 * - An ACTIVE (or in-grace) store subscription is ground truth and overwrites anything,
 *   including an admin grant - exactly like the next webhook event would.
 * - An EMPTY or lapsed RevenueCat state never overwrites an admin grant (`source: 'admin'`):
 *   comped users have no store subscription and must survive a reconcile.
 * - A stored `source: 'revenuecat'` document that RevenueCat no longer backs is expired
 *   (the healed missed-EXPIRATION case).
 * - The read-decide-write runs in ONE Firestore transaction, and the decision additionally
 *   backs off (`storedNewerThanSnapshot`) when the stored document was written from newer
 *   information than the REST snapshot (`request_date_ms`): a webhook event or an admin write
 *   landing between the GET and the write is never clobbered by the stale snapshot.
 * - The written document carries `eventTimestampMs: null`, so EVERY future webhook event
 *   passes the stale-event guard (`shouldApplyEntitlementWrite`) and wins over a reconcile.
 * - SANDBOX subscriptions are ignored unless the REVENUECAT_ALLOW_SANDBOX param is true
 *   (same license-tester gate as the webhook); an entitlement whose backing subscription
 *   record cannot be found at all is treated as UNVERIFIABLE (not as production) while that
 *   gate is closed - fail closed in the money path, except RevenueCat promotional grants
 *   (product id prefix 'rc_promo'), which have no subscription record by design.
 */
import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/https';
import { defineBoolean, defineSecret } from 'firebase-functions/params';
import { z } from 'zod';

import { FUNCTIONS_REGION } from '../config';
import { adminDb } from '../firebase';
import { requireAdmin, type AdminCaller } from '../admin';
import { planFromEvent, type EntitlementWrite } from './mapping';
import { ENTITLEMENTS_COLLECTION, REVENUECAT_ALLOW_SANDBOX } from './index';

/**
 * RevenueCat SECRET API key ("sk_..."; dashboard -> Project -> API keys). Server-only, bound to
 * NOTHING but adminReconcileEntitlement. Never log it, never echo it in errors or responses.
 */
export const REVENUECAT_SECRET_KEY = defineSecret('REVENUECAT_SECRET_KEY');

/**
 * Master switch of the reconciliation callable. NON-SECRET on purpose, exactly like ZOOM_ENABLED:
 * with the default false the callable is not exported, the deploy never references
 * REVENUECAT_SECRET_KEY, and `firebase deploy --only functions` cannot fail on it.
 */
export const REVENUECAT_RECONCILE_ENABLED = defineBoolean('REVENUECAT_RECONCILE_ENABLED', {
  default: false,
  description: 'Enables adminReconcileEntitlement. Set the REVENUECAT_SECRET_KEY secret BEFORE setting this to true (SETUP 11).',
});

/** Mirrors the webhook's SAFE_DOC_ID (functions/src/revenuecat/index.ts): Firestore-safe uids. */
const UID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;

export const adminReconcileEntitlementRequestSchema = z.object({
  uid: z.string().regex(UID_PATTERN),
});

export const RECONCILE_OUTCOMES = ['updated', 'unchanged', 'skipped_admin', 'no_data'] as const;
export type ReconcileOutcome = (typeof RECONCILE_OUTCOMES)[number];

export const adminReconcileEntitlementResponseSchema = z.object({
  uid: z.string(),
  outcome: z.enum(RECONCILE_OUTCOMES),
  /** The RESULTING stored document after the call ('free'/'active' when none exists). */
  plan: z.enum(['free', 'pro', 'premium']),
  status: z.enum(['active', 'grace_period', 'expired', 'revoked']),
  expiresAt: z.string().nullable(),
});
export type AdminReconcileEntitlementResponse = z.infer<typeof adminReconcileEntitlementResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Pure pieces (unit-tested without Firebase or the network)
// ---------------------------------------------------------------------------------------------

/** Lenient reader of GET /v1/subscribers/{uid}: only the fields the mapping needs. */
const restEntitlementSchema = z.object({
  expires_date: z.string().nullable().optional(),
  grace_period_expires_date: z.string().nullable().optional(),
  purchase_date: z.string().nullable().optional(),
  product_identifier: z.string().nullable().optional(),
});

const restSubscriptionSchema = z.object({
  expires_date: z.string().nullable().optional(),
  grace_period_expires_date: z.string().nullable().optional(),
  billing_issues_detected_at: z.string().nullable().optional(),
  unsubscribe_detected_at: z.string().nullable().optional(),
  refunded_at: z.string().nullable().optional(),
  is_sandbox: z.boolean().nullable().optional(),
  store: z.string().nullable().optional(),
  period_type: z.string().nullable().optional(),
});

export const restSubscriberSchema = z.object({
  subscriber: z.object({
    entitlements: z.record(z.string(), restEntitlementSchema).optional(),
    subscriptions: z.record(z.string(), restSubscriptionSchema).optional(),
  }),
});

export type SubscriberMapping =
  | { kind: 'write'; write: EntitlementWrite }
  | { kind: 'none'; reason: 'no_entitlements' | 'sandbox_only' | 'unverified' }
  | { kind: 'malformed' };

function parseMs(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * RevenueCat promotional grants ("granted entitlements"; product ids "rc_promo_<ent>_<dur>")
 * have NO subscriber.subscriptions record by design - they are dashboard grants, not store
 * purchases, and are never sandbox.
 */
function isPromotionalProduct(productId: string | null | undefined): boolean {
  return typeof productId === 'string' && productId.startsWith('rc_promo');
}

/**
 * Maps one REST subscriber to the entitlement document the webhook would have produced.
 * 'premium' wins over 'pro' (planFromEvent); the backing subscription (looked up by the
 * entitlement's product_identifier, base-plan suffixes tolerated) supplies sandbox/refund/grace.
 */
export function entitlementFromSubscriber(raw: unknown, now: Date, options: { allowSandbox?: boolean } = {}): SubscriberMapping {
  const parsed = restSubscriberSchema.safeParse(raw);
  if (!parsed.success) return { kind: 'malformed' };
  const { entitlements = {}, subscriptions = {} } = parsed.data.subscriber;

  const subscriptionFor = (productId: string | null | undefined): z.infer<typeof restSubscriptionSchema> | null => {
    if (typeof productId !== 'string' || productId === '') return null;
    if (subscriptions[productId]) return subscriptions[productId];
    // Android REST keys may carry a base-plan suffix ("pro_monthly:p1m") on either side.
    const bare = productId.split(':')[0] ?? productId;
    for (const [key, value] of Object.entries(subscriptions)) {
      if ((key.split(':')[0] ?? key) === bare) return value;
    }
    return null;
  };

  let sandboxSkipped = 0;
  let unverifiedSkipped = 0;
  const eligible: string[] = [];
  for (const [id, entry] of Object.entries(entitlements)) {
    const sub = subscriptionFor(entry.product_identifier);
    if (sub?.is_sandbox === true && options.allowSandbox !== true) {
      sandboxSkipped += 1;
      continue;
    }
    if (sub === null && options.allowSandbox !== true && !isPromotionalProduct(entry.product_identifier)) {
      // No backing subscription record: sandbox vs production CANNOT be verified. Fail closed
      // (the webhook keys off event.environment and has no such hole); the admin can override
      // with the REVENUECAT_ALLOW_SANDBOX param during the license-tester phase.
      unverifiedSkipped += 1;
      continue;
    }
    eligible.push(id);
  }
  if (eligible.length === 0) {
    if (sandboxSkipped > 0) return { kind: 'none', reason: 'sandbox_only' };
    if (unverifiedSkipped > 0) return { kind: 'none', reason: 'unverified' };
    return { kind: 'none', reason: 'no_entitlements' };
  }

  // The REST subscriber keeps PREVIOUSLY granted entitlements (past expires_date) next to the
  // current one, e.g. {premium: expired, pro: active} after an in-app downgrade. The plan must
  // come from what CURRENTLY grants (active or in grace, not refunded); the lapsed set only
  // decides when nothing grants at all (the fully lapsed subscriber keeps mapping to expired).
  const grantsNow = (id: string): boolean => {
    const candidate = entitlements[id];
    if (candidate === undefined) return false;
    const sub = subscriptionFor(candidate.product_identifier);
    if (typeof sub?.refunded_at === 'string') return false;
    const expiry = parseMs(candidate.expires_date);
    if (expiry === null || expiry > now.getTime()) return true;
    const grace = parseMs(candidate.grace_period_expires_date) ?? parseMs(sub?.grace_period_expires_date);
    return grace !== null && grace > now.getTime();
  };
  const granting = eligible.filter(grantsNow);
  const pool = granting.length > 0 ? granting : eligible;

  const chosenId = pool.includes('premium') ? 'premium' : pool.includes('pro') ? 'pro' : pool[0] ?? '';
  const entry = entitlements[chosenId];
  const plan = planFromEvent({ entitlement_ids: pool, product_id: entry?.product_identifier ?? null, new_product_id: null });
  if (plan === null || entry === undefined) return { kind: 'none', reason: 'no_entitlements' };

  const sub = subscriptionFor(entry.product_identifier);
  const updatedAt = now.toISOString();
  const expiresMs = parseMs(entry.expires_date);
  const expiresAt = expiresMs !== null ? new Date(expiresMs).toISOString() : null;

  if (typeof sub?.refunded_at === 'string') {
    return { kind: 'write', write: { plan, status: 'revoked', expiresAt, source: 'revenuecat', updatedAt } };
  }
  if (expiresMs === null || expiresMs > now.getTime()) {
    return { kind: 'write', write: { plan, status: 'active', expiresAt, source: 'revenuecat', updatedAt } };
  }
  const graceMs = parseMs(entry.grace_period_expires_date) ?? parseMs(sub?.grace_period_expires_date);
  if (graceMs !== null && graceMs > now.getTime()) {
    return {
      kind: 'write',
      write: { plan, status: 'grace_period', expiresAt: new Date(graceMs).toISOString(), source: 'revenuecat', updatedAt },
    };
  }
  return { kind: 'write', write: { plan, status: 'expired', expiresAt, source: 'revenuecat', updatedAt } };
}

/** Lenient reader of the STORED entitlements/{uid} document for the drift comparison. */
const storedEntitlementSchema = z.object({
  plan: z.enum(['free', 'pro', 'premium']),
  status: z.enum(['active', 'grace_period', 'expired', 'revoked']),
  expiresAt: z.string().nullable().optional(),
  source: z.string().optional(),
});

export type ReconcileDecision =
  | { kind: 'write'; write: EntitlementWrite; outcome: 'updated' }
  | { kind: 'skip'; outcome: 'unchanged' | 'skipped_admin' | 'no_data' };

/**
 * Drift rule (write ONLY on drift; precedence in the header):
 * - mapping 'write': unchanged when plan+status+expiresAt already match; otherwise write -
 *   EXCEPT a non-active mapping over `source: 'admin'` (stale store history never kills a comp).
 * - mapping 'none' (RevenueCat backs nothing): expire a stored STILL-GRANTING 'revenuecat'
 *   document (the missed-EXPIRATION heal); admin documents are skipped; anything else unchanged.
 * - mapping 'sandbox_only' / 'unverified': no verified production truth to apply -> 'no_data'.
 */
export function decideReconcile(stored: unknown, mapping: SubscriberMapping, now: Date): ReconcileDecision {
  const parsedStored = stored === undefined || stored === null ? null : storedEntitlementSchema.safeParse(stored);
  const doc = parsedStored?.success ? parsedStored.data : null;
  const storedSource = doc?.source ?? (parsedStored === null ? null : 'unknown');

  if (mapping.kind === 'malformed') return { kind: 'skip', outcome: 'no_data' };
  if (mapping.kind === 'none') {
    if (mapping.reason === 'sandbox_only' || mapping.reason === 'unverified') return { kind: 'skip', outcome: 'no_data' };
    if (parsedStored === null) return { kind: 'skip', outcome: 'unchanged' };
    if (storedSource === 'admin') return { kind: 'skip', outcome: 'skipped_admin' };
    if (doc !== null && doc.source === 'revenuecat' && (doc.status === 'active' || doc.status === 'grace_period')) {
      return {
        kind: 'write',
        outcome: 'updated',
        write: { plan: doc.plan, status: 'expired', expiresAt: doc.expiresAt ?? null, source: 'revenuecat', updatedAt: now.toISOString() },
      };
    }
    return { kind: 'skip', outcome: 'unchanged' };
  }

  const desired = mapping.write;
  const granting = desired.status === 'active' || desired.status === 'grace_period';
  if (storedSource === 'admin' && !granting) return { kind: 'skip', outcome: 'skipped_admin' };
  // No stored document + a non-granting store state are the same effective 'free': creating an
  // expired document for every long-lapsed customer would be noise, not a heal.
  if (parsedStored === null && !granting) return { kind: 'skip', outcome: 'unchanged' };
  if (doc !== null && doc.plan === desired.plan && doc.status === desired.status && (doc.expiresAt ?? null) === desired.expiresAt) {
    return { kind: 'skip', outcome: 'unchanged' };
  }
  return { kind: 'write', outcome: 'updated', write: desired };
}

// ---------------------------------------------------------------------------------------------
// Handler over injectable ports (tests use fakes)
// ---------------------------------------------------------------------------------------------

/**
 * When the REST snapshot was taken: the top-level `request_date_ms` of GET /v1/subscribers
 * (RevenueCat stamps every response). Falls back to `fallbackMs` (the handler's `now`, which
 * predates the GET - conservative: an earlier snapshot time only makes the guard back off more).
 */
export function restSnapshotMs(body: unknown, fallbackMs: number): number {
  if (typeof body === 'object' && body !== null) {
    const raw = (body as { request_date_ms?: unknown }).request_date_ms;
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  }
  return fallbackMs;
}

/**
 * True when the STORED document was written from information NEWER than the REST snapshot:
 * a webhook event (eventTimestampMs) or an admin write (parseable updatedAt) landed after
 * request_date_ms, so a reconcile write would clobber fresher truth with stale REST state.
 * Documents without a comparable timestamp never count as newer (pre-guard documents and
 * earlier reconciles, which carry eventTimestampMs null).
 */
export function storedNewerThanSnapshot(stored: unknown, snapshotMs: number): boolean {
  if (typeof stored !== 'object' || stored === null) return false;
  const doc = stored as { source?: unknown; eventTimestampMs?: unknown; updatedAt?: unknown };
  if (typeof doc.eventTimestampMs === 'number' && doc.eventTimestampMs > snapshotMs) return true;
  if (doc.source === 'admin' && typeof doc.updatedAt === 'string') {
    const ms = Date.parse(doc.updatedAt);
    if (Number.isFinite(ms) && ms > snapshotMs) return true;
  }
  return false;
}

export interface ReconcilePorts {
  /** GET /v1/subscribers/{uid}; body is the parsed JSON on 200, null otherwise. */
  fetchSubscriber(uid: string): Promise<{ status: number; body: unknown }>;
  /**
   * Reads the CURRENT entitlements/{uid} document, calls `decide` on it and applies the
   * returned write (nothing on null) ATOMICALLY - one Firestore transaction, so a concurrent
   * webhook or admin write cannot be clobbered by a decision taken on a stale read. Resolves
   * with the stored document the final decision saw. `decide` must stay pure: the transaction
   * may retry it.
   */
  reconcileEntitlement(uid: string, decide: (stored: unknown) => Record<string, unknown> | null): Promise<unknown>;
  allowSandbox(): boolean;
  now?(): Date;
}

export async function handleAdminReconcileEntitlement(
  caller: AdminCaller | null,
  data: unknown,
  ports: ReconcilePorts,
): Promise<AdminReconcileEntitlementResponse> {
  requireAdmin(caller);
  const parsed = adminReconcileEntitlementRequestSchema.safeParse(data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid adminReconcileEntitlement request.');
  const { uid } = parsed.data;
  const now = ports.now ? ports.now() : new Date();

  let fetched: { status: number; body: unknown };
  try {
    fetched = await ports.fetchSubscriber(uid);
  } catch {
    // Deliberately drops the caught error: nothing from the request (key included) may leak.
    throw new HttpsError('unavailable', 'RevenueCat could not be reached. Nothing was changed.');
  }
  if (fetched.status === 401 || fetched.status === 403) {
    throw new HttpsError('failed-precondition', 'RevenueCat rejected the API key (check REVENUECAT_SECRET_KEY). Nothing was changed.');
  }
  if (fetched.status !== 200 && fetched.status !== 404) {
    throw new HttpsError('unavailable', `RevenueCat answered HTTP ${fetched.status}. Nothing was changed.`);
  }

  // 404 = RevenueCat has NO record of this app user id (rare: the GET normally creates unknown
  // customers; a deleted customer still 404s). That is a definite "the store backs nothing", not
  // an error: it runs the same decision as an empty subscriber, healing a stale still-granting
  // document while admin comps stay protected.
  const mapping: SubscriberMapping =
    fetched.status === 404
      ? { kind: 'none', reason: 'no_entitlements' }
      : entitlementFromSubscriber(fetched.body, now, { allowSandbox: ports.allowSandbox() });
  const snapshotMs = restSnapshotMs(fetched.body, now.getTime());

  // Decide and write atomically. `decisionFor` is pure, so the transaction can retry it and
  // re-running it on the stored document the committed run saw reproduces the same decision.
  const decisionFor = (current: unknown): { decision: ReconcileDecision; raced: boolean } => {
    const candidate = decideReconcile(current, mapping, now);
    if (candidate.kind === 'write' && storedNewerThanSnapshot(current, snapshotMs)) {
      // A webhook event or admin write landed AFTER the REST snapshot was taken: it is newer
      // truth than this snapshot. Back off; a re-run reconciles against the fresh state.
      return { decision: { kind: 'skip', outcome: 'unchanged' }, raced: true };
    }
    return { decision: candidate, raced: false };
  };
  const stored = await ports.reconcileEntitlement(uid, (current) => {
    const inTx = decisionFor(current).decision;
    // eventTimestampMs null: every future webhook event beats a reconcile (stale-event guard).
    return inTx.kind === 'write' ? { ...inTx.write, eventTimestampMs: null, reconciledAt: now.toISOString() } : null;
  });
  const { decision, raced } = decisionFor(stored);

  const storedParsed = stored === undefined || stored === null ? null : storedEntitlementSchema.safeParse(stored);
  const resultDoc = decision.kind === 'write' ? decision.write : storedParsed?.success ? storedParsed.data : null;
  const outcome: ReconcileOutcome = decision.kind === 'write' ? 'updated' : decision.outcome;
  // Audit line: who reconciled whom and what it did (never the API key, never raw bodies).
  logger.info('revenuecat.reconciled', {
    adminUid: caller.uid,
    uid,
    outcome,
    raced,
    mapping: mapping.kind === 'write' ? mapping.write.status : mapping.kind,
    plan: resultDoc?.plan ?? 'free',
    status: resultDoc?.status ?? 'active',
  });
  return adminReconcileEntitlementResponseSchema.parse({
    uid,
    outcome,
    plan: resultDoc?.plan ?? 'free',
    status: resultDoc?.status ?? 'active',
    expiresAt: resultDoc?.expiresAt ?? null,
  });
}

// ---------------------------------------------------------------------------------------------
// Firebase/REST-backed ports + the gated callable
// ---------------------------------------------------------------------------------------------

export const RECONCILE_FETCH_TIMEOUT_MS = 10_000;

export function restReconcilePorts(): ReconcilePorts {
  const db = adminDb();
  return {
    async fetchSubscriber(uid) {
      const response = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(uid)}`, {
        headers: { Authorization: `Bearer ${REVENUECAT_SECRET_KEY.value()}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(RECONCILE_FETCH_TIMEOUT_MS),
      });
      const body: unknown = response.status === 200 ? await response.json() : null;
      return { status: response.status, body };
    },
    async reconcileEntitlement(uid, decide) {
      const ref = db.collection(ENTITLEMENTS_COLLECTION).doc(uid);
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        const current = snapshot.exists ? snapshot.data() : null;
        const doc = decide(current);
        if (doc !== null) tx.set(ref, doc);
        return current;
      });
    },
    allowSandbox: () => REVENUECAT_ALLOW_SANDBOX.value() === true,
  };
}

/**
 * Whether the REVENUECAT_RECONCILE_ENABLED param is true while this module is LOADED (CLI
 * discovery and runtime read the same env var that backs the param). Deploy-time only: the
 * handler wrapper reads REVENUECAT_RECONCILE_ENABLED.value() instead.
 */
export function reconcileEnabledAtLoad(): boolean {
  const raw = process.env.REVENUECAT_RECONCILE_ENABLED;
  return typeof raw === 'string' && raw.trim().toLowerCase() === 'true';
}

function makeAdminReconcileEntitlement() {
  return onCall(
    {
      region: FUNCTIONS_REGION,
      secrets: [REVENUECAT_SECRET_KEY],
      enforceAppCheck: false,
      timeoutSeconds: 30,
      memory: '256MiB',
      maxInstances: 5,
    },
    (request): Promise<AdminReconcileEntitlementResponse> => {
      if (REVENUECAT_RECONCILE_ENABLED.value() !== true) {
        // Stale deployment or a manually flipped param: fail soft, never reach RevenueCat.
        throw new HttpsError('failed-precondition', 'Entitlement reconciliation is not enabled on this deployment.');
      }
      const caller: AdminCaller | null = request.auth ? { uid: request.auth.uid, isAdmin: request.auth.token.admin === true } : null;
      return handleAdminReconcileEntitlement(caller, request.data, restReconcilePorts());
    },
  );
}

/**
 * Exported only while REVENUECAT_RECONCILE_ENABLED is true at deploy time, so the default deploy
 * never references REVENUECAT_SECRET_KEY (undefined exports are skipped by the functions
 * loader). Flipping the param back to false makes the next deploy OFFER to delete the function.
 */
export const adminReconcileEntitlement = reconcileEnabledAtLoad() ? makeAdminReconcileEntitlement() : undefined;
