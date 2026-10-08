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
});

export interface ResolvedPlan {
  plan: Plan;
  /** false when the document exists but does not match the entitlement schema. */
  valid: boolean;
}

export function resolveEffectivePlan(raw: unknown, now: Date): ResolvedPlan {
  if (raw === undefined || raw === null) return { plan: 'free', valid: true };
  const parsed = entitlementDocSchema.safeParse(raw);
  if (!parsed.success) return { plan: 'free', valid: false };
  const { plan, status, expiresAt } = parsed.data;
  if (status === 'expired' || status === 'revoked') return { plan: 'free', valid: true };
  if (expiresAt !== null && expiresAt !== undefined) {
    const expiry = Date.parse(expiresAt);
    if (Number.isNaN(expiry)) return { plan: 'free', valid: false };
    if (expiry <= now.getTime()) return { plan: 'free', valid: true };
  }
  return { plan, valid: true };
}
