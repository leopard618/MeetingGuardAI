/**
 * Server-side reader for entitlements/{uid} (written only by server/admin tooling).
 *
 * Mirrors `parseEntitlementDoc` + `effectivePlan` in src/core/types.ts (the app cannot share that
 * file with /functions because it imports app modules):
 * - missing document => free
 * - status expired/revoked, or expiresAt in the past => free
 * - invalid document => free, reported as `valid: false` so the caller can log it
 */
import { z } from 'zod';

import { planSchema, type Plan } from './aiContract';

const ENTITLEMENT_STATUSES = ['active', 'grace_period', 'expired', 'revoked'] as const;

const entitlementDocSchema = z.object({
  plan: planSchema,
  status: z.enum(ENTITLEMENT_STATUSES),
  expiresAt: z.string().nullable().optional(),
  /** When the current subscription started (ISO); the monthly AI allowance renews on its anniversary. */
  startedAt: z.string().nullable().optional(),
});

export interface ResolvedPlan {
  plan: Plan;
  /** false when the document exists but does not match the entitlement schema. */
  valid: boolean;
  /** Subscription start of a paid plan (null when unknown or free). */
  startedAt: string | null;
}

/** The entitlement document fields every writer produces. */
export interface EntitlementWriteBase {
  plan: Plan;
  status: (typeof ENTITLEMENT_STATUSES)[number];
  expiresAt: string | null;
}

/**
 * `startedAt` for a new entitlement write: the stored start is kept while the subscription runs
 * on (same plan, stored status active or grace), otherwise the candidate (the store's purchase
 * time, else the write time). Expired and revoked writes keep whatever was stored.
 */
export function withStartedAt<T extends EntitlementWriteBase>(stored: unknown, write: T, candidateIso: string): T & { startedAt: string | null } {
  const current = typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>) : null;
  const storedStartedAt = typeof current?.startedAt === 'string' && Number.isFinite(Date.parse(current.startedAt)) ? current.startedAt : null;
  if (write.status === 'expired' || write.status === 'revoked') return { ...write, startedAt: storedStartedAt };
  const continues =
    storedStartedAt !== null && current?.plan === write.plan && (current?.status === 'active' || current?.status === 'grace_period');
  return { ...write, startedAt: continues ? storedStartedAt : candidateIso };
}

export function resolveEffectivePlan(raw: unknown, now: Date): ResolvedPlan {
  if (raw === undefined || raw === null) return { plan: 'free', valid: true, startedAt: null };
  const parsed = entitlementDocSchema.safeParse(raw);
  if (!parsed.success) return { plan: 'free', valid: false, startedAt: null };
  const { plan, status, expiresAt, startedAt } = parsed.data;
  if (status === 'expired' || status === 'revoked') return { plan: 'free', valid: true, startedAt: null };
  if (expiresAt !== null && expiresAt !== undefined) {
    const expiry = Date.parse(expiresAt);
    if (Number.isNaN(expiry)) return { plan: 'free', valid: false, startedAt: null };
    if (expiry <= now.getTime()) return { plan: 'free', valid: true, startedAt: null };
  }
  const started = typeof startedAt === 'string' && Number.isFinite(Date.parse(startedAt)) ? startedAt : null;
  return { plan, valid: true, startedAt: plan === 'free' ? null : started };
}
