/**
 * Plan catalog (subscriptions) - purchases are DISABLED in this release.
 *
 * In-app subscriptions will be built later with a maintained store SDK and server-side
 * entitlement validation. Until then:
 *   - the user's plan is the server-owned entitlement (entitlements/{uid}, read-only in the app;
 *     a missing document means Free),
 *   - no purchase flow is exposed and there are NO external payment links anywhere in the app.
 *
 * This module is the single source of truth for the plan catalog shown in the UI.
 * Contract pricing: Free (5 AI requests/day), Pro $7.99/month, Premium $14.99/month,
 * annual plans = 25% discount on 12 x monthly (Pro $71.91/yr, Premium $134.91/yr).
 * Daily AI quotas are the server-enforced ones (core/aiContract PLAN_DAILY_AI_LIMITS).
 */
import { PLAN_DAILY_AI_LIMITS } from '../core/aiContract';

export type PlanTier = 'free' | 'pro' | 'premium';
export type BillingCycle = 'monthly' | 'yearly';
export type PlanId = 'free' | 'pro_monthly' | 'pro_yearly' | 'premium_monthly' | 'premium_yearly';

export interface Plan {
  id: PlanId;
  tier: PlanTier;
  /** null for the Free plan (available in both billing cycles). */
  cycle: BillingCycle | null;
  /** Price in USD for one billing period. */
  priceUsd: number;
  /** For yearly plans: the effective monthly price in USD. */
  monthlyEquivalentUsd?: number;
  /** For yearly plans: discount vs. paying monthly for 12 months. */
  discountPercent?: number;
  /** Daily AI request quota (server-enforced, see PLAN_DAILY_AI_LIMITS). */
  aiRequestsPerDay: number;
  popular: boolean;
}

/** Purchases are switched off until the new billing stack ships. */
export const PURCHASES_AVAILABLE = false;

export const FREE_AI_REQUESTS_PER_DAY = PLAN_DAILY_AI_LIMITS.free;
export const ANNUAL_DISCOUNT_PERCENT = 25;

// 12 x $7.99 = $95.88 -> -25% = $71.91 ; 12 x $14.99 = $179.88 -> -25% = $134.91
export const PLANS: readonly Plan[] = [
  { id: 'free', tier: 'free', cycle: null, priceUsd: 0, aiRequestsPerDay: FREE_AI_REQUESTS_PER_DAY, popular: false },
  { id: 'pro_monthly', tier: 'pro', cycle: 'monthly', priceUsd: 7.99, aiRequestsPerDay: PLAN_DAILY_AI_LIMITS.pro, popular: true },
  {
    id: 'pro_yearly',
    tier: 'pro',
    cycle: 'yearly',
    priceUsd: 71.91,
    monthlyEquivalentUsd: 5.99,
    discountPercent: ANNUAL_DISCOUNT_PERCENT,
    aiRequestsPerDay: PLAN_DAILY_AI_LIMITS.pro,
    popular: true,
  },
  { id: 'premium_monthly', tier: 'premium', cycle: 'monthly', priceUsd: 14.99, aiRequestsPerDay: PLAN_DAILY_AI_LIMITS.premium, popular: false },
  {
    id: 'premium_yearly',
    tier: 'premium',
    cycle: 'yearly',
    priceUsd: 134.91,
    monthlyEquivalentUsd: 11.24,
    discountPercent: ANNUAL_DISCOUNT_PERCENT,
    aiRequestsPerDay: PLAN_DAILY_AI_LIMITS.premium,
    popular: false,
  },
];

export const formatUsd = (amount: number): string => `$${amount.toFixed(2).replace(/\.00$/, '')}`;

/** Plans to display for a billing cycle (Free is always included first). */
export const getPlans = (cycle: BillingCycle): Plan[] =>
  PLANS.filter((plan) => plan.cycle === null || plan.cycle === cycle);
