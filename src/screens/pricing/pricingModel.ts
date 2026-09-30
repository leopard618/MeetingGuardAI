/**
 * Pure view model of the Plans screen (owner: billing; docs/ARCHITECTURE.md §20).
 *
 * Plan cards merge the catalog (src/services/billing.ts) with the live RevenueCat offering:
 * - store unconfigured -> exactly the old catalog-only view ("coming soon", nothing purchasable);
 * - store ready -> STORE price strings (never computed prices) + purchase buttons + trial copy;
 * - store load error -> catalog prices, an error banner with Retry, and NO purchase buttons
 *   (an honest non-purchasable state instead of a fake one).
 * Today's assistant usage summary is unchanged.
 */
import { formatUsd, getPlans, type BillingCycle, type PlanId, type PlanTier } from '../../services/billing';
import { PLAN_DAILY_AI_LIMITS, type AssistantUsage, type Plan as EntitlementPlan } from '../../core/aiContract';
import type { AppErrorCode } from '../../core/errors';
import type { StoreOffering, StorePackage } from '../../core/contracts';
import type { Language } from '../../core/types';

/** What the screen knows about the RevenueCat offering. */
export type StoreState =
  | { kind: 'unconfigured' }
  | { kind: 'loading' }
  | { kind: 'ready'; offering: StoreOffering }
  | { kind: 'error'; code: AppErrorCode };

export const STORE_UNCONFIGURED: StoreState = { kind: 'unconfigured' };

export interface PlanCard {
  id: PlanId;
  tier: PlanTier;
  cycle: BillingCycle | null;
  priceUsd: number;
  /** Yearly plans: effective monthly price (catalog). */
  monthlyEquivalentUsd: number | null;
  /** Yearly plans: discount against 12 monthly payments (catalog, or the store's when ready). */
  discountPercent: number | null;
  aiRequestsPerDay: number;
  popular: boolean;
  isCurrent: boolean;
  /** true when a purchase button is shown for this card (store ready + package present). */
  purchasable: boolean;
  /** Localized Google Play price string ("$7.99", "€7,99") when the offering is loaded. */
  storePriceString: string | null;
  /** Yearly store package: localized per-month equivalent computed from priceAmountMicros. */
  storeMonthlyEquivalent: string | null;
  /** Store-configured free trial on this package (the "3-day free trial" copy). */
  hasFreeTrial: boolean;
  /** Play product id when the store package is known (manage-subscription deep link). */
  productId: string | null;
}

function packageFor(offering: StoreOffering | null, tier: PlanTier, cycle: BillingCycle | null): StorePackage | null {
  if (!offering || tier === 'free' || cycle === null) return null;
  return offering.packages.find((pkg) => pkg.tier === tier && pkg.cycle === cycle) ?? null;
}

/** Store discount of yearly vs 12x monthly, when both packages are priced; null when unknown. */
export function computeStoreDiscount(monthlyMicros: number, yearlyMicros: number): number | null {
  if (!(monthlyMicros > 0) || !(yearlyMicros > 0)) return null;
  const percent = Math.round((1 - yearlyMicros / (monthlyMicros * 12)) * 100);
  return percent > 0 && percent < 100 ? percent : null;
}

/**
 * Cards for a billing cycle (Free first). `currentTier` null = unknown (nothing is marked).
 * `store` defaults to unconfigured, which reproduces the catalog-only screen exactly.
 */
export function buildPlanCards(cycle: BillingCycle, currentTier: PlanTier | null, store: StoreState = STORE_UNCONFIGURED, language: Language = 'en'): PlanCard[] {
  const offering = store.kind === 'ready' ? store.offering : null;
  return getPlans(cycle).map((plan) => {
    const pkg = packageFor(offering, plan.tier, plan.cycle);
    const isCurrent = currentTier !== null && plan.tier === currentTier;
    // Downgrades (premium -> pro) go through Google Play's manage page: buying the lower product
    // here would open a SECOND subscription instead of replacing the current one.
    const isDowngrade = currentTier === 'premium' && plan.tier === 'pro';
    const purchasable = pkg !== null && plan.tier !== 'free' && !isCurrent && !isDowngrade;
    const monthlyPkg = plan.cycle === 'yearly' ? packageFor(offering, plan.tier, 'monthly') : null;
    const storeDiscount = pkg && monthlyPkg ? computeStoreDiscount(monthlyPkg.priceAmountMicros, pkg.priceAmountMicros) : null;
    return {
      id: plan.id,
      tier: plan.tier,
      cycle: plan.cycle,
      priceUsd: plan.priceUsd,
      monthlyEquivalentUsd: pkg ? null : (plan.monthlyEquivalentUsd ?? null),
      discountPercent: pkg ? storeDiscount : (plan.discountPercent ?? null),
      aiRequestsPerDay: plan.aiRequestsPerDay,
      // No "Most popular" claim on a plan nobody can buy.
      popular: plan.popular && purchasable,
      isCurrent,
      purchasable,
      storePriceString: pkg?.priceString ?? null,
      storeMonthlyEquivalent:
        pkg && plan.cycle === 'yearly' ? formatStorePrice(pkg.priceAmountMicros / 12, pkg.currencyCode, language) : null,
      hasFreeTrial: pkg?.hasFreeTrial ?? false,
      productId: pkg?.productId ?? null,
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

/** A store amount (micros) in the store's own currency, e.g. per-month equivalents of yearly plans. */
export function formatStorePrice(amountMicros: number, currencyCode: string, language: Language): string {
  const amount = amountMicros / 1_000_000;
  try {
    return new Intl.NumberFormat(PRICE_LOCALES[language], {
      style: 'currency',
      currency: currencyCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currencyCode}`;
  }
}

// ---------------------------------------------------------------------------------------------
// Purchase flow phases (screen state; pure so tests can drive it)
// ---------------------------------------------------------------------------------------------

/**
 * What the purchase/restore UI is doing. 'activating' = the store purchase succeeded and we are
 * waiting for the webhook-written entitlement to reach the app (useEntitlement flips within
 * seconds; ACTIVATION_SLOW_AFTER_MS switches the copy to "taking longer than usual").
 */
export type PurchasePhase =
  | { kind: 'idle' }
  | { kind: 'purchasing'; tier: Exclude<PlanTier, 'free'>; cycle: BillingCycle }
  | { kind: 'restoring' }
  | { kind: 'activating'; tier: Exclude<PlanTier, 'free'> };

export const ACTIVATION_SLOW_AFTER_MS = 20_000;

/** The 'activating' wait is over once the entitlement grants the purchased tier (or better). */
export function isActivated(pendingTier: Exclude<PlanTier, 'free'>, plan: EntitlementPlan): boolean {
  if (plan === 'premium') return true;
  return plan === 'pro' && pendingTier === 'pro';
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
