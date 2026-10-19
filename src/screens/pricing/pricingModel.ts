/**
 * Pure view model of the Plans screen (owner: billing; docs/v1/ARCHITECTURE.md §20).
 *
 * Plan cards merge the catalog (src/services/billing.ts) with the live RevenueCat offering:
 * - store unconfigured -> exactly the old catalog-only view ("coming soon", nothing purchasable);
 * - store ready -> STORE price strings (never computed prices) + purchase buttons + trial copy.
 *   EVERY non-current paid card is purchasable: purchase() REPLACES the running subscription
 *   (section 20), so monthly<->yearly switches and tier downgrades are in-app purchases with
 *   their own "Switch ..." labels, never out-of-app dead ends;
 * - store load error -> catalog prices, an error banner with Retry, and NO purchase buttons
 *   (an honest non-purchasable state instead of a fake one).
 * Today's assistant usage summary is unchanged.
 */
import { formatUsd, getPlans, type BillingCycle, type PlanId, type PlanTier } from '../../services/billing';
import { PLAN_DAILY_AI_LIMITS, type AssistantUsage, type Plan as EntitlementPlan } from '../../core/aiContract';
import type { AppErrorCode } from '../../core/errors';
import { PLAY_PRODUCT_IDS, type StoreOffering, type StorePackage } from '../../core/contracts';
import type { Language } from '../../core/types';

/** What the screen knows about the RevenueCat offering. */
export type StoreState =
  | { kind: 'unconfigured' }
  | { kind: 'loading' }
  | { kind: 'ready'; offering: StoreOffering }
  | { kind: 'error'; code: AppErrorCode };

export const STORE_UNCONFIGURED: StoreState = { kind: 'unconfigured' };

/**
 * Which label the purchase button carries. 'buy' = a plain purchase or a tier UPGRADE ("Get
 * Pro"); the switch labels mark REPLACEMENT purchases: same tier, other billing cycle
 * ('switchToMonthly'/'switchToYearly') or a lower tier while a higher one is active
 * ('switchTier', "Switch to Pro"). purchase() replaces the running subscription in all cases.
 */
export type PurchaseAction = 'buy' | 'switchToMonthly' | 'switchToYearly' | 'switchTier';

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
  /** true when a purchase button is shown for this card (store ready + package + not current). */
  purchasable: boolean;
  /** The purchase button's label kind; null exactly when not purchasable. */
  purchaseLabel: PurchaseAction | null;
  /**
   * true only when THIS card's product is the active store subscription (activeProductId):
   * the "Manage subscription" action appears here and nowhere else - never on admin-granted
   * plans, which have no store subscription to manage.
   */
  manageable: boolean;
  /**
   * true when THIS card's product is active but was purchased on the OTHER platform's store
   * (otherStoreProductId): the card says where the subscription is managed instead of offering
   * Manage (dead sheet) or a purchase (second subscription).
   */
  managedExternally: boolean;
  /** Localized store price string ("$7.99", "€7,99") when the offering is loaded. */
  storePriceString: string | null;
  /** Yearly store package: localized per-month equivalent computed from priceAmountMicros. */
  storeMonthlyEquivalent: string | null;
  /** Store-configured free trial on this package (the "3-day free trial" copy). */
  hasFreeTrial: boolean;
  /** Store product id when the store package is known. */
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

const TIER_RANK: Readonly<Record<PlanTier, number>> = { free: 0, pro: 1, premium: 2 };

/** The purchase button label for a purchasable card, given the user's current tier. */
function purchaseActionOf(tier: PlanTier, cycle: BillingCycle | null, currentTier: PlanTier | null): PurchaseAction {
  if (currentTier !== null && tier === currentTier) {
    // Same tier, other billing cycle (the active cycle's card is current, not purchasable).
    return cycle === 'yearly' ? 'switchToYearly' : 'switchToMonthly';
  }
  if (currentTier !== null && currentTier !== 'free' && TIER_RANK[tier] < TIER_RANK[currentTier]) return 'switchTier';
  return 'buy';
}

/**
 * Cards for a billing cycle (Free first). `currentTier` null = unknown (nothing is marked).
 * `store` defaults to unconfigured, which reproduces the catalog-only screen exactly.
 * `activeProductId` (the purchased store product from CustomerInfo, when the store can tell)
 * narrows "Current plan" to the truly purchased (tier, cycle) card: every OTHER paid card is
 * then purchasable as a replacement (switch labels). null keeps the tier-based marking on both
 * cycles (unconfigured builds, admin-granted plans, store hiccups), which also keeps the owned
 * tier's cards non-purchasable - no switch is offered when the store cannot say what is active.
 * `otherStoreProductId` (a product purchased on the OTHER platform's store; CustomerInfo is
 * cross-store) blocks EVERY purchase - this store cannot replace the other store's running
 * subscription, so any purchase here would bill twice - and marks that product's card
 * managedExternally so the user is pointed at the right store.
 */
export function buildPlanCards(
  cycle: BillingCycle,
  currentTier: PlanTier | null,
  store: StoreState = STORE_UNCONFIGURED,
  language: Language = 'en',
  activeProductId: string | null = null,
  otherStoreProductId: string | null = null,
): PlanCard[] {
  const offering = store.kind === 'ready' ? store.offering : null;
  return getPlans(cycle).map((plan) => {
    const pkg = packageFor(offering, plan.tier, plan.cycle);
    const catalogProductId = plan.tier !== 'free' && plan.cycle !== null ? PLAY_PRODUCT_IDS[plan.tier][plan.cycle] : null;
    const tierMatches = currentTier !== null && plan.tier === currentTier;
    const knownActiveProductId = activeProductId ?? otherStoreProductId;
    const isCurrent = tierMatches && (knownActiveProductId === null || catalogProductId === null || catalogProductId === knownActiveProductId);
    // Every non-current paid card with a store package is purchasable: purchase() REPLACES the
    // running subscription (Android product change / iOS subscription group), so cycle switches
    // and tier downgrades are ordinary purchases here, never second subscriptions. EXCEPT while
    // an other-store subscription is active: nothing is purchasable then (see above).
    const purchasable = pkg !== null && plan.tier !== 'free' && !isCurrent && otherStoreProductId === null;
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
      purchaseLabel: purchasable ? purchaseActionOf(plan.tier, plan.cycle, currentTier) : null,
      // Manage only the ACTIVE store subscription's card: admin-granted plans (no store
      // subscription; activeProductId null) and other-store subscriptions (this platform's
      // store sheet cannot change them) get no dead store-management button.
      manageable: isCurrent && catalogProductId !== null && catalogProductId === activeProductId,
      managedExternally: catalogProductId !== null && catalogProductId === otherStoreProductId,
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
 * seconds; ACTIVATION_SLOW_AFTER_MS switches the copy to "taking longer than usual"). Only
 * UPGRADE purchases (and restores) enter 'activating': a non-upgrade replacement (cycle switch,
 * tier downgrade) may not change the entitlement plan at all - the CURRENT plan would satisfy
 * isActivated immediately and fake an instant success - so the screen confirms those with the
 * changeConfirmed toast instead (isUpgradePurchase below decides).
 */
export type PurchasePhase =
  | { kind: 'idle' }
  | { kind: 'purchasing'; tier: Exclude<PlanTier, 'free'>; cycle: BillingCycle }
  | { kind: 'restoring' }
  | { kind: 'activating'; tier: Exclude<PlanTier, 'free'> };

export const ACTIVATION_SLOW_AFTER_MS = 20_000;

/**
 * After this long in 'activating' the screen returns to idle with an honest "still processing"
 * message instead of spinning forever with Retry/Restore disabled. The wait can be legitimately
 * unbounded: a same-user restore emits NO webhook event (RevenueCat only sends state changes),
 * so a drifted entitlements/{uid} would never flip - and while Cloud Functions are not deployed
 * nothing writes the entitlement at all. The plan still updates whenever the next entitlement
 * write lands; leaving the screen was already allowed.
 */
export const ACTIVATION_TIMEOUT_MS = 120_000;

/** The 'activating' wait is over once the entitlement grants the purchased tier (or better). */
export function isActivated(pendingTier: Exclude<PlanTier, 'free'>, plan: EntitlementPlan): boolean {
  if (plan === 'premium') return true;
  return plan === 'pro' && pendingTier === 'pro';
}

/**
 * True when buying `tier` RAISES the current entitlement plan, so the screen should wait in
 * 'activating' for the webhook-written entitlement to flip. Non-upgrades (monthly<->yearly
 * switches, tier downgrades) may leave the plan unchanged - and iOS applies some of them only
 * at the next renewal - so there is nothing to wait for; the screen shows the changeConfirmed
 * toast and refreshes getActiveProducts() instead. An unknown current plan (entitlement not
 * loaded yet) is treated as an upgrade: waiting is the honest state.
 */
export function isUpgradePurchase(currentPlan: EntitlementPlan | null, tier: Exclude<PlanTier, 'free'>): boolean {
  if (currentPlan === null) return true;
  return TIER_RANK[tier] > TIER_RANK[currentPlan];
}

// ---------------------------------------------------------------------------------------------
// Per-platform store copy
// ---------------------------------------------------------------------------------------------

/**
 * pricing:store.* keys that differ per platform: naming the store ("Google Play" vs "the App
 * Store"), store-specific proration rules (changeConfirmedBody: Play credits unused time
 * immediately, the App Store applies non-upgrades at the next renewal with no credit) and
 * trial eligibility copy (trial: StoreKit reports the intro offer even to users who already
 * consumed it, so iOS promises it to new subscribers only).
 */
export type PlatformStoreCopy = 'loading' | 'loadError' | 'retryA11y' | 'restoreA11y' | 'manageA11y' | 'trial' | 'changeConfirmedBody';

/** The pricing:store key for this platform; the 'Ios' variants name the App Store. */
export function storeCopyKey(key: PlatformStoreCopy, ios: boolean): string {
  return `pricing:store.${key}${ios ? 'Ios' : ''}`;
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
      // The cached snapshot knows how many requests were USED today, but its plan/limit are from
      // the moment of the last request. The live entitlement wins: after an upgrade the card must
      // show "5 of 100", not yesterday's "5 of 5" (and after a downgrade, used is clamped).
      const planChanged = usage.plan !== plan;
      const limit = planChanged ? PLAN_DAILY_AI_LIMITS[plan] : Math.max(0, usage.limit);
      const used = Math.min(Math.max(0, usage.used), limit);
      return {
        kind: 'today',
        plan,
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
