/**
 * Pure view model of the Plans screen (owner: shell): plan cards from the catalog
 * (src/services/billing.ts), prices in the UI language, and today's assistant usage.
 * Purchases are not available in this release: every paid card is informational.
 */
import { PURCHASES_AVAILABLE, formatUsd, getPlans, type BillingCycle, type PlanId, type PlanTier } from '../../services/billing';
import { PLAN_DAILY_AI_LIMITS, type AssistantUsage, type Plan as EntitlementPlan } from '../../core/aiContract';
import type { Language } from '../../core/types';

export interface PlanCard {
  id: PlanId;
  tier: PlanTier;
  cycle: BillingCycle | null;
  priceUsd: number;
  /** Yearly plans: effective monthly price. */
  monthlyEquivalentUsd: number | null;
  /** Yearly plans: discount against 12 monthly payments. */
  discountPercent: number | null;
  aiRequestsPerDay: number;
  popular: boolean;
  isCurrent: boolean;
  /** false while purchases are switched off (the card shows "Coming soon"). */
  purchasable: boolean;
}

/** Cards for a billing cycle (Free first). `currentTier` null = unknown (nothing is marked). */
export function buildPlanCards(cycle: BillingCycle, currentTier: PlanTier | null): PlanCard[] {
  return getPlans(cycle).map((plan) => {
    const purchasable = PURCHASES_AVAILABLE && plan.tier !== 'free';
    return {
      id: plan.id,
      tier: plan.tier,
      cycle: plan.cycle,
      priceUsd: plan.priceUsd,
      monthlyEquivalentUsd: plan.monthlyEquivalentUsd ?? null,
      discountPercent: plan.discountPercent ?? null,
      aiRequestsPerDay: plan.aiRequestsPerDay,
      // No "Most popular" claim on a plan nobody can buy yet.
      popular: plan.popular && purchasable,
      isCurrent: currentTier !== null && plan.tier === currentTier,
      purchasable,
    };
  });
}

const PRICE_LOCALES: Readonly<Record<Language, string>> = { en: 'en-US', es: 'es-ES' };

/** "$7.99" / "7,99 US$" (prices are in US dollars; the store shows the local price at purchase). */
export function formatPriceUsd(amount: number, language: Language): string {
  try {
    return new Intl.NumberFormat(PRICE_LOCALES[language], {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return formatUsd(amount);
  }
}

export type UsageSummary =
  | {
      kind: 'today';
      plan: EntitlementPlan;
      used: number;
      limit: number;
      remaining: number;
      /** 0..1 */
      fraction: number;
      resetsAt: string;
    }
  | { kind: 'plan'; plan: EntitlementPlan; limit: number };

/**
 * Today's usage when the last server answer is still for the current UTC day; otherwise only the
 * plan's daily limit is known (usage from another day, or no request on this device yet).
 */
export function summarizeUsage(usage: AssistantUsage | null, plan: EntitlementPlan, now: Date): UsageSummary {
  if (usage) {
    const resetsAt = new Date(usage.resetsAt).getTime();
    if (Number.isFinite(resetsAt) && resetsAt > now.getTime()) {
      const limit = Math.max(0, usage.limit);
      const used = Math.min(Math.max(0, usage.used), limit);
      return {
        kind: 'today',
        plan: usage.plan,
        used,
        limit,
        remaining: limit - used,
        fraction: limit > 0 ? used / limit : 1,
        resetsAt: usage.resetsAt,
      };
    }
  }
  return { kind: 'plan', plan, limit: PLAN_DAILY_AI_LIMITS[plan] };
}
