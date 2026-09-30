/**
 * Guarded loader for the OPTIONAL `react-native-purchases` dependency (owner: billing; §20).
 *
 * The SDK is installed by the integrator (`npx expo install react-native-purchases`) and ships
 * native code, so it only works in a dev/store build. This module never imports it statically:
 * - without the npm package (unit tests, a checkout before the integrator pass) the require
 *   throws and `loadPurchasesSdk()` returns null;
 * - with the JS package but without the native module (Expo Go, iOS in this release) the
 *   `NativeModules.RNPurchases` check fails and it also returns null.
 * Callers (src/services/purchases/service.ts) treat null as "purchases unconfigured".
 *
 * The `...Like` interfaces are the minimal surface we call, typed locally like the optional
 * expo-auth-session modules in calendar/outlook/authAdapter.ts. After the SDK is installed the
 * integrator's tsc run still passes because these are structural subsets of the real types.
 */
import { NativeModules, Platform } from 'react-native';

/** Subscription period phase price; `price` 0 = free phase (the 3-day trial). */
export interface RcPricingPhaseLike {
  price?: number | null;
}

export interface RcSubscriptionOptionLike {
  freePhase?: RcPricingPhaseLike | null;
  introPhase?: RcPricingPhaseLike | null;
}

export interface RcStoreProductLike {
  /** Android subscriptions: "productId" or "productId:basePlanId". */
  identifier: string;
  /** Localized price string straight from Google Play (e.g. "$7.99", "€7,99"). */
  priceString: string;
  /** Price in major currency units (7.99). */
  price: number;
  currencyCode: string;
  /** Cross-platform intro price; price 0 = free trial. */
  introPrice?: RcPricingPhaseLike | null;
  /** Android: the option purchases default to (its freePhase is the trial). */
  defaultOption?: RcSubscriptionOptionLike | null;
}

export interface RcPackageLike {
  /** RevenueCat package identifier (e.g. "$rc_monthly" or a custom id). */
  identifier: string;
  product: RcStoreProductLike;
}

export interface RcOfferingLike {
  identifier: string;
  availablePackages: RcPackageLike[];
}

export interface RcOfferingsLike {
  current: RcOfferingLike | null;
}

export interface RcEntitlementInfoLike {
  isActive?: boolean;
}

export interface RcCustomerInfoLike {
  entitlements: {
    /** Keyed by RevenueCat entitlement id; ours are exactly 'pro' and 'premium'. */
    active: Record<string, RcEntitlementInfoLike>;
  };
}

export interface RcPurchaseResultLike {
  customerInfo: RcCustomerInfoLike;
  productIdentifier?: string;
}

export interface PurchasesSdkLike {
  /** v8+: synchronous; older/newer versions may return a promise - both are awaited. */
  configure(configuration: { apiKey: string; appUserID?: string | null }): unknown;
  /** Switches the current app user (used when a different Firebase uid signs in). */
  logIn(appUserID: string): Promise<{ customerInfo: RcCustomerInfoLike }>;
  getOfferings(): Promise<RcOfferingsLike>;
  /** MUST receive a package object returned by getOfferings (the bridge maps its fields). */
  purchasePackage(pkg: RcPackageLike): Promise<RcPurchaseResultLike>;
  restorePurchases(): Promise<RcCustomerInfoLike>;
}

interface PurchasesModuleLike {
  default?: PurchasesSdkLike;
}

let cached: PurchasesSdkLike | null | undefined;

/**
 * The SDK, or null when the package or its native module is unavailable. Android-only by
 * contract (§20 ships Google Play products only).
 */
export function loadPurchasesSdk(): PurchasesSdkLike | null {
  if (cached !== undefined) return cached;
  cached = null;
  if (Platform.OS !== 'android') return cached;
  try {
    // Optional dependency: the integrator installs react-native-purchases; a static import
    // would break tsc/tests until then, and the whole feature is env-gated anyway.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional native dependency
    const mod = require('react-native-purchases') as PurchasesModuleLike;
    const sdk = mod?.default;
    if (!sdk || typeof sdk.configure !== 'function' || typeof sdk.getOfferings !== 'function') return cached;
    // The JS package loads fine in builds without the native module (Expo Go); every call would
    // then reject, so treat a missing TurboModule as "not installed".
    if ((NativeModules as Record<string, unknown>).RNPurchases == null) return cached;
    cached = sdk;
  } catch {
    cached = null;
  }
  return cached;
}

/** Test hook: clears the module cache so a jest mock of react-native-purchases is re-read. */
export function resetPurchasesSdkCacheForTests(): void {
  cached = undefined;
}
