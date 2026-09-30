/**
 * PurchasesService implementation over react-native-purchases (owner: billing; §20).
 *
 * Factory with injected deps so unit tests never touch the real SDK. The public instance is
 * wired in ./index.ts. Behavior contract (src/core/contracts.ts PurchasesService):
 * - isConfigured() is true only with the EXPO_PUBLIC_REVENUECAT_ANDROID_KEY set AND the SDK +
 *   native module present (Android store/dev builds). Everything else = today's catalog-only UI.
 * - configure(uid) is idempotent per uid; a different uid (new Firebase session) switches the
 *   RevenueCat app user via logIn(uid). logOut is never called (it would create an anonymous
 *   RevenueCat user whose webhook events could not be attributed to a Firebase uid).
 * - THE CLIENT NEVER WRITES entitlements/{uid}: after 'purchased' the webhook
 *   (functions/src/revenuecat) writes the entitlement and useEntitlement() flips within seconds.
 */
import { AppError, isAppError } from '../../core/errors';
import { createLogger } from '../../core/logger';
import {
  PLAY_PRODUCT_IDS,
  type BillingCycle,
  type PaidPlanTier,
  type PurchaseOutcome,
  type PurchasesService,
  type RestoreOutcome,
  type StoreOffering,
  type StorePackage,
} from '../../core/contracts';
import type { PurchasesSdkLike, RcCustomerInfoLike, RcPackageLike, RcProductChangeInfoLike, RcStoreProductLike } from './sdk';

const log = createLogger('purchases');

/** Google Play subscription management (deep link when the product is known). */
export const PLAY_SUBSCRIPTIONS_URL = 'https://play.google.com/store/account/subscriptions';
export const ANDROID_PACKAGE = 'com.meetingguard.ai';

/**
 * react-native-purchases PRORATION_MODE.IMMEDIATE_WITH_TIME_PRORATION (numeric value 1, from
 * @revenuecat/purchases-typescript-internal): a tier upgrade replaces the running subscription
 * immediately and the unused time of the old one is credited - Google's recommended mode for
 * upgrades. Declared locally because the SDK is an optional dependency (never imported
 * statically, see ./sdk.ts).
 */
export const PLAY_PRORATION_IMMEDIATE_WITH_TIME_PRORATION = 1;

export interface PurchasesServiceDeps {
  /** The loaded SDK, or null when unavailable (package missing, no native module, not Android). */
  sdk(): PurchasesSdkLike | null;
  /** EXPO_PUBLIC_REVENUECAT_ANDROID_KEY, or null when unset/invalid. */
  androidKey(): string | null;
}

// ---------------------------------------------------------------------------------------------
// RevenueCat error mapping (react-native-purchases PurchasesError)
// ---------------------------------------------------------------------------------------------

/** PURCHASES_ERROR_CODE values we branch on (numeric, but delivered as strings on Android). */
const RC_CODE_PURCHASE_CANCELLED = 1;
const RC_CODE_NETWORK = 10;
const RC_CODE_OFFLINE = 35;

function rcErrorCode(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const raw = (error as { code?: unknown }).code;
  const numeric = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
  return Number.isFinite(numeric) ? numeric : null;
}

/** The user dismissed the Google Play purchase sheet ('cancelled' is not an error, §errors). */
export function isRcUserCancelled(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && (error as { userCancelled?: unknown }).userCancelled === true) return true;
  return rcErrorCode(error) === RC_CODE_PURCHASE_CANCELLED;
}

export function mapRcError(error: unknown, message: string): AppError {
  if (isAppError(error)) return error;
  const code = rcErrorCode(error);
  if (code === RC_CODE_NETWORK || code === RC_CODE_OFFLINE) {
    return new AppError('offline', message, { cause: error });
  }
  return new AppError('upstream_error', message, {
    cause: error,
    details: code !== null ? { rcCode: code } : undefined,
    retryable: true,
  });
}

// ---------------------------------------------------------------------------------------------
// Offering mapping (pure helpers, exported for tests)
// ---------------------------------------------------------------------------------------------

/** "pro_monthly:p1m" -> "pro_monthly" (Android product ids may carry a base-plan suffix). */
export function productIdOf(product: Pick<RcStoreProductLike, 'identifier'>): string {
  const [id] = product.identifier.split(':');
  return id ?? product.identifier;
}

const PRODUCT_TO_PLAN: ReadonlyMap<string, { tier: PaidPlanTier; cycle: BillingCycle }> = new Map(
  (Object.entries(PLAY_PRODUCT_IDS) as [PaidPlanTier, Record<BillingCycle, string>][]).flatMap(([tier, cycles]) =>
    (Object.entries(cycles) as [BillingCycle, string][]).map(([cycle, productId]) => [productId, { tier, cycle }] as const),
  ),
);

/** Store-configured free trial on this package (Android default option free phase or intro at 0). */
export function packageHasFreeTrial(product: RcStoreProductLike): boolean {
  const freePhase = product.defaultOption?.freePhase;
  if (freePhase !== null && freePhase !== undefined) return true;
  const intro = product.introPrice;
  return intro !== null && intro !== undefined && (intro.price ?? 0) === 0;
}

/** Maps one RevenueCat package to our StorePackage; null for products outside the catalog. */
export function toStorePackage(pkg: RcPackageLike): StorePackage | null {
  const productId = productIdOf(pkg.product);
  const plan = PRODUCT_TO_PLAN.get(productId);
  if (!plan) return null;
  if (typeof pkg.product.priceString !== 'string' || pkg.product.priceString === '') return null;
  return {
    tier: plan.tier,
    cycle: plan.cycle,
    productId,
    priceString: pkg.product.priceString,
    priceAmountMicros: Math.round((pkg.product.price ?? 0) * 1_000_000),
    currencyCode: pkg.product.currencyCode ?? 'USD',
    hasFreeTrial: packageHasFreeTrial(pkg.product),
  };
}

/** 'premium' wins over 'pro' (a premium customer is also entitled to pro features). */
export function tierFromCustomerInfo(info: RcCustomerInfoLike): PaidPlanTier | null {
  const active = info.entitlements?.active ?? {};
  if ('premium' in active) return 'premium';
  if ('pro' in active) return 'pro';
  return null;
}

/**
 * The CATALOG product ids currently active on the store account (base-plan suffixes stripped,
 * non-catalog products ignored, premium products first, deduplicated). Normally zero or one;
 * two would mean a double subscription that Play should have replaced.
 */
export function activeCatalogProductIds(info: RcCustomerInfoLike): string[] {
  const ids = new Set<string>();
  for (const raw of info.activeSubscriptions ?? []) {
    if (typeof raw !== 'string') continue;
    const productId = productIdOf({ identifier: raw });
    if (PRODUCT_TO_PLAN.has(productId)) ids.add(productId);
  }
  return [...ids].sort((a, b) => {
    const tierOf = (id: string): number => (PRODUCT_TO_PLAN.get(id)?.tier === 'premium' ? 0 : 1);
    return tierOf(a) - tierOf(b) || a.localeCompare(b);
  });
}

// ---------------------------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------------------------

export function createPurchasesService(deps: PurchasesServiceDeps): PurchasesService {
  let configuredUid: string | null = null;
  /** Serializes configure/logIn so a fast sign-out/sign-in cannot interleave SDK calls. */
  let configuring: Promise<void> = Promise.resolve();

  function isConfigured(): boolean {
    return deps.androidKey() !== null && deps.sdk() !== null;
  }

  function requireSdk(): { sdk: PurchasesSdkLike; apiKey: string } {
    const sdk = deps.sdk();
    const apiKey = deps.androidKey();
    if (!sdk || apiKey === null) {
      throw new AppError('not_configured', 'Purchases are not configured in this build');
    }
    return { sdk, apiKey };
  }

  async function currentOffering(sdk: PurchasesSdkLike): Promise<StoreOffering> {
    let offerings;
    try {
      offerings = await sdk.getOfferings();
    } catch (error) {
      throw mapRcError(error, 'Could not load the RevenueCat offerings');
    }
    const current = offerings.current;
    const packages = (current?.availablePackages ?? []).map(toStorePackage).filter((pkg): pkg is StorePackage => pkg !== null);
    if (!current || packages.length === 0) {
      // Dashboard misconfiguration (no current offering / products outside the catalog):
      // an honest failure so the UI shows catalog prices without purchase buttons.
      throw new AppError('upstream_error', 'RevenueCat returned no usable current offering', {
        details: { offeringId: current?.identifier ?? null, rawPackages: current?.availablePackages.length ?? 0 },
      });
    }
    return { offeringId: current.identifier, packages };
  }

  return {
    isConfigured,

    async configure(uid: string): Promise<void> {
      if (!isConfigured()) return; // Contract: safe no-op when not configured.
      const { sdk, apiKey } = requireSdk();
      const run = configuring
        .catch(() => undefined) // A previous failure never poisons the chain.
        .then(async () => {
          if (configuredUid === uid) return;
          try {
            if (configuredUid === null) {
              await Promise.resolve(sdk.configure({ apiKey, appUserID: uid }));
            } else {
              await sdk.logIn(uid);
            }
            configuredUid = uid;
          } catch (error) {
            throw mapRcError(error, 'RevenueCat configure failed');
          }
        });
      configuring = run;
      return run;
    },

    async getOffering(): Promise<StoreOffering> {
      const { sdk } = requireSdk();
      await configuring.catch(() => undefined);
      return currentOffering(sdk);
    },

    async purchase(tier: PaidPlanTier, cycle: BillingCycle): Promise<PurchaseOutcome> {
      const { sdk } = requireSdk();
      await configuring.catch(() => undefined);
      const productId = PLAY_PRODUCT_IDS[tier][cycle];
      // The bridge needs the ORIGINAL package object, so resolve it fresh from the offerings.
      let offerings;
      try {
        offerings = await sdk.getOfferings();
      } catch (error) {
        throw mapRcError(error, 'Could not load the RevenueCat offerings');
      }
      const rawPackage = (offerings.current?.availablePackages ?? []).find((pkg) => productIdOf(pkg.product) === productId);
      if (!rawPackage) {
        throw new AppError('upstream_error', 'The requested package is not in the current offering', {
          details: { productId, offeringId: offerings.current?.identifier ?? null },
        });
      }
      // A DIFFERENT catalog product already active means this purchase is a tier upgrade (or a
      // cycle change): Google Play only replaces the running subscription when the old product
      // id is passed - without it the user ends up paying for TWO subscriptions. When the store
      // cannot answer, the purchase is aborted (retryable) instead of risking a double billing.
      let info: RcCustomerInfoLike;
      try {
        info = await sdk.getCustomerInfo();
      } catch (error) {
        throw mapRcError(error, 'Could not read the current subscriptions before purchasing');
      }
      const oldProductId = activeCatalogProductIds(info).find((id) => id !== productId) ?? null;
      const productChange: RcProductChangeInfoLike | null =
        oldProductId !== null
          ? { oldProductIdentifier: oldProductId, prorationMode: PLAY_PRORATION_IMMEDIATE_WITH_TIME_PRORATION }
          : null;
      try {
        await sdk.purchasePackage(rawPackage, null, productChange);
      } catch (error) {
        if (isRcUserCancelled(error)) return { status: 'cancelled' };
        throw mapRcError(error, 'The purchase could not be completed');
      }
      log.info('purchase completed', { productId, replaced: oldProductId });
      // entitlements/{uid} is written by the webhook; the UI polls useEntitlement() (§20).
      return { status: 'purchased', tier, cycle };
    },

    async restore(): Promise<RestoreOutcome> {
      const { sdk } = requireSdk();
      await configuring.catch(() => undefined);
      let info: RcCustomerInfoLike;
      try {
        info = await sdk.restorePurchases();
      } catch (error) {
        throw mapRcError(error, 'Purchases could not be restored');
      }
      const tier = tierFromCustomerInfo(info);
      if (tier === null) return { status: 'nothing_to_restore' };
      log.info('restore found an active entitlement', { tier });
      return { status: 'restored', tier };
    },

    async getActiveProductId(): Promise<string | null> {
      // Best effort (contract: never throws): the pricing UI uses it to mark the purchased
      // (tier, cycle) card; null just means "unknown" and the UI falls back to tier-based state.
      const sdk = deps.sdk();
      if (!sdk || deps.androidKey() === null) return null;
      try {
        await configuring.catch(() => undefined);
        const info = await sdk.getCustomerInfo();
        return activeCatalogProductIds(info)[0] ?? null;
      } catch (error) {
        log.warn('could not read the active subscriptions', mapRcError(error, 'getCustomerInfo failed').code);
        return null;
      }
    },

    manageUrl(productId?: string): string {
      if (productId === undefined) return PLAY_SUBSCRIPTIONS_URL;
      return `${PLAY_SUBSCRIPTIONS_URL}?sku=${encodeURIComponent(productId)}&package=${ANDROID_PACKAGE}`;
    },
  };
}
