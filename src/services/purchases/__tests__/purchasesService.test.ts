/**
 * PurchasesService unit tests (owner: billing; §20) with a fake react-native-purchases SDK -
 * every path: configuration gating per platform key, uid switching, offering mapping, purchase
 * outcomes (incl. user-cancelled and the Android-only product change), restore outcomes,
 * manage URLs / the iOS manage sheet and RevenueCat error mapping. The service is
 * platform-free: the platform arrives as an injected dep, so no Platform mocking here.
 */
import { AppError } from '../../../core/errors';
import { APP_STORE_PRODUCT_IDS, PLAY_PRODUCT_IDS } from '../../../core/contracts';
import {
  APPLE_SUBSCRIPTIONS_URL,
  PLAY_PRORATION_IMMEDIATE_WITH_TIME_PRORATION,
  activeCatalogProductIds,
  createPurchasesService,
  isRcUserCancelled,
  mapRcError,
  packageHasFreeTrial,
  productIdOf,
  splitActiveByStore,
  storeOfActiveProduct,
  tierFromCustomerInfo,
  toStorePackage,
} from '../service';
import type { PurchasesSdkLike, RcCustomerInfoLike, RcOfferingsLike, RcPackageLike, RcProductChangeInfoLike } from '../sdk';

const API_KEY = 'goog_TestPublicSdkKey01';
const APPLE_KEY = 'appl_TestPublicSdkKey01';

function pkg(productId: string, overrides: Partial<RcPackageLike['product']> = {}): RcPackageLike {
  return {
    identifier: `$rc_${productId}`,
    product: {
      identifier: productId,
      priceString: '$7.99',
      price: 7.99,
      currencyCode: 'USD',
      introPrice: null,
      defaultOption: null,
      ...overrides,
    },
  };
}

function customerInfo(activeIds: string[], activeSubscriptions: string[] = []): RcCustomerInfoLike {
  return {
    entitlements: { active: Object.fromEntries(activeIds.map((id) => [id, { isActive: true }])) },
    activeSubscriptions,
  };
}

/** CustomerInfo whose entitlement carries the per-store metadata (productIdentifier + store). */
function storeTaggedInfo(entitlementId: string, productIdentifier: string, store: string): RcCustomerInfoLike {
  return {
    entitlements: { active: { [entitlementId]: { isActive: true, productIdentifier, store } } },
    activeSubscriptions: [productIdentifier],
  };
}

function fakeSdk(offerings: RcOfferingsLike = { current: null }): PurchasesSdkLike & {
  calls: string[];
  purchaseError: unknown;
  offeringsError: unknown;
  restoreInfo: RcCustomerInfoLike;
  restoreError: unknown;
  customerInfoState: RcCustomerInfoLike;
  customerInfoError: unknown;
  manageSheetError: unknown;
  lastPurchasedPackage: RcPackageLike | null;
  lastProductChange: RcProductChangeInfoLike | null | undefined;
} {
  const sdk = {
    calls: [] as string[],
    purchaseError: null as unknown,
    offeringsError: null as unknown,
    restoreInfo: customerInfo([]),
    restoreError: null as unknown,
    customerInfoState: customerInfo([]),
    customerInfoError: null as unknown,
    manageSheetError: null as unknown,
    lastPurchasedPackage: null as RcPackageLike | null,
    lastProductChange: undefined as RcProductChangeInfoLike | null | undefined,
    configure(configuration: { apiKey: string; appUserID?: string | null }): void {
      sdk.calls.push(`configure:${configuration.apiKey}:${configuration.appUserID ?? ''}`);
    },
    async logIn(appUserID: string) {
      sdk.calls.push(`logIn:${appUserID}`);
      return { customerInfo: customerInfo([]) };
    },
    async getOfferings() {
      sdk.calls.push('getOfferings');
      if (sdk.offeringsError !== null) throw sdk.offeringsError;
      return offerings;
    },
    async purchasePackage(purchased: RcPackageLike, _upgradeInfo?: null, productChangeInfo?: RcProductChangeInfoLike | null) {
      sdk.calls.push(`purchase:${purchased.product.identifier}`);
      sdk.lastPurchasedPackage = purchased;
      sdk.lastProductChange = productChangeInfo;
      if (sdk.purchaseError !== null) throw sdk.purchaseError;
      return { customerInfo: customerInfo(['pro']), productIdentifier: purchased.product.identifier };
    },
    async getCustomerInfo() {
      sdk.calls.push('getCustomerInfo');
      if (sdk.customerInfoError !== null) throw sdk.customerInfoError;
      return sdk.customerInfoState;
    },
    async invalidateCustomerInfoCache() {
      sdk.calls.push('invalidateCustomerInfoCache');
    },
    async restorePurchases() {
      sdk.calls.push('restore');
      if (sdk.restoreError !== null) throw sdk.restoreError;
      return sdk.restoreInfo;
    },
    async showManageSubscriptions() {
      sdk.calls.push('showManageSubscriptions');
      if (sdk.manageSheetError !== null) throw sdk.manageSheetError;
    },
  };
  return sdk;
}

function service(sdk: PurchasesSdkLike | null, apiKey: string | null = API_KEY, platform: 'android' | 'ios' = 'android') {
  return createPurchasesService({ sdk: () => sdk, apiKey: () => apiKey, platform: () => platform });
}

const FULL_OFFERING: RcOfferingsLike = {
  current: {
    identifier: 'default',
    availablePackages: [
      pkg('pro_monthly', { defaultOption: { freePhase: { price: 0 } } }),
      pkg('pro_yearly:p1y', { priceString: '$71.91', price: 71.91, introPrice: { price: 0 } }),
      pkg('premium_monthly', { priceString: '$14.99', price: 14.99 }),
      pkg('premium_yearly', { priceString: '$134.91', price: 134.91 }),
      pkg('legacy_lifetime'), // Outside the catalog: must be skipped.
    ],
  },
};

describe('configuration gating', () => {
  it('is unconfigured without the env key or without the SDK', () => {
    expect(service(fakeSdk(), null).isConfigured()).toBe(false);
    expect(service(null).isConfigured()).toBe(false);
    expect(service(fakeSdk()).isConfigured()).toBe(true);
    // Same rule on iOS: the (platform-resolved) key plus the SDK, nothing platform-specific.
    expect(service(fakeSdk(), APPLE_KEY, 'ios').isConfigured()).toBe(true);
    expect(service(fakeSdk(), null, 'ios').isConfigured()).toBe(false);
  });

  it('configure is a safe no-op when unconfigured', async () => {
    const sdk = fakeSdk();
    await expect(service(sdk, null).configure('uid-1')).resolves.toBeUndefined();
    expect(sdk.calls).toEqual([]);
  });

  it('getOffering / purchase / restore throw not_configured when unconfigured', async () => {
    const svc = service(null);
    await expect(svc.getOffering()).rejects.toMatchObject({ code: 'not_configured' });
    await expect(svc.purchase('pro', 'monthly')).rejects.toMatchObject({ code: 'not_configured' });
    await expect(svc.restore()).rejects.toMatchObject({ code: 'not_configured' });
  });
});

describe('configure', () => {
  it('configures once per uid with the Firebase uid as appUserID', async () => {
    const sdk = fakeSdk();
    const svc = service(sdk);
    await svc.configure('uid-1');
    await svc.configure('uid-1');
    expect(sdk.calls).toEqual([`configure:${API_KEY}:uid-1`]);
  });

  it('switches to a different uid with logIn (never logOut)', async () => {
    const sdk = fakeSdk();
    const svc = service(sdk);
    await svc.configure('uid-1');
    await svc.configure('uid-2');
    expect(sdk.calls).toEqual([`configure:${API_KEY}:uid-1`, 'logIn:uid-2']);
  });

  it('a configure failure is mapped and does not poison later calls', async () => {
    const sdk = fakeSdk();
    const failing = jest.fn(() => {
      throw { code: '10', message: 'network' };
    });
    (sdk as { configure: unknown }).configure = failing;
    const svc = service(sdk);
    await expect(svc.configure('uid-1')).rejects.toMatchObject({ code: 'offline' });
    (sdk as { configure: (c: { apiKey: string; appUserID?: string | null }) => void }).configure = (c) => {
      sdk.calls.push(`configure:${c.apiKey}:${c.appUserID ?? ''}`);
    };
    await expect(svc.configure('uid-1')).resolves.toBeUndefined();
    expect(sdk.calls).toContain(`configure:${API_KEY}:uid-1`);
  });
});

describe('getOffering', () => {
  it('maps catalog packages (base-plan suffixes stripped, trials detected, unknown products skipped)', async () => {
    const svc = service(fakeSdk(FULL_OFFERING));
    const offering = await svc.getOffering();
    expect(offering.offeringId).toBe('default');
    expect(offering.packages.map((p) => p.productId)).toEqual(['pro_monthly', 'pro_yearly', 'premium_monthly', 'premium_yearly']);
    const proMonthly = offering.packages[0]!;
    expect(proMonthly).toEqual({
      tier: 'pro',
      cycle: 'monthly',
      productId: 'pro_monthly',
      priceString: '$7.99',
      priceAmountMicros: 7_990_000,
      currencyCode: 'USD',
      hasFreeTrial: true, // via defaultOption.freePhase
    });
    const proYearly = offering.packages[1]!;
    expect(proYearly.cycle).toBe('yearly');
    expect(proYearly.hasFreeTrial).toBe(true); // via introPrice at 0
    expect(offering.packages[2]!.hasFreeTrial).toBe(false);
  });

  it('treats a missing/unusable current offering as an upstream error (no fake purchasable state)', async () => {
    await expect(service(fakeSdk({ current: null })).getOffering()).rejects.toMatchObject({ code: 'upstream_error' });
    const onlyUnknown: RcOfferingsLike = { current: { identifier: 'default', availablePackages: [pkg('weird_product')] } };
    await expect(service(fakeSdk(onlyUnknown)).getOffering()).rejects.toMatchObject({ code: 'upstream_error' });
  });

  it('maps RevenueCat network errors to offline', async () => {
    const sdk = fakeSdk(FULL_OFFERING);
    sdk.offeringsError = { code: '35', message: 'offline' };
    await expect(service(sdk).getOffering()).rejects.toMatchObject({ code: 'offline', retryable: true });
  });
});

describe('purchase', () => {
  it('purchases the ORIGINAL package object for the tier+cycle product (no product change without an active sub)', async () => {
    const sdk = fakeSdk(FULL_OFFERING);
    const svc = service(sdk);
    await expect(svc.purchase('premium', 'yearly')).resolves.toEqual({ status: 'purchased', tier: 'premium', cycle: 'yearly' });
    // The bridge needs the exact object returned by getOfferings, not a mapped copy.
    expect(sdk.lastPurchasedPackage).toBe(FULL_OFFERING.current!.availablePackages[3]);
    expect(sdk.lastProductChange).toBeNull();
  });

  it('passes the Google product change when a DIFFERENT catalog product is active (upgrade replaces, never double-bills)', async () => {
    const sdk = fakeSdk(FULL_OFFERING);
    sdk.customerInfoState = customerInfo(['pro'], ['pro_monthly:p1m']);
    const svc = service(sdk);
    await expect(svc.purchase('premium', 'monthly')).resolves.toEqual({ status: 'purchased', tier: 'premium', cycle: 'monthly' });
    expect(sdk.lastProductChange).toEqual({
      oldProductIdentifier: 'pro_monthly',
      prorationMode: PLAY_PRORATION_IMMEDIATE_WITH_TIME_PRORATION,
    });
    // The replacement read must be FRESH: an out-of-app resubscription inside the SDK's
    // CustomerInfo cache window would otherwise go unseen and a second subscription opened.
    expect(sdk.calls.indexOf('invalidateCustomerInfoCache')).toBeGreaterThanOrEqual(0);
    expect(sdk.calls.indexOf('invalidateCustomerInfoCache')).toBeLessThan(sdk.calls.indexOf('getCustomerInfo'));
  });

  it('works with SDKs that lack invalidateCustomerInfoCache (optional surface)', async () => {
    const sdk = fakeSdk(FULL_OFFERING) as ReturnType<typeof fakeSdk> & { invalidateCustomerInfoCache?: unknown };
    delete sdk.invalidateCustomerInfoCache;
    sdk.customerInfoState = customerInfo(['pro'], ['pro_monthly']);
    await expect(service(sdk).purchase('premium', 'monthly')).resolves.toEqual({ status: 'purchased', tier: 'premium', cycle: 'monthly' });
  });

  it('aborts with conflict when a subscription from the OTHER store is active (no cross-store double billing)', async () => {
    // Android device, Apple-purchased pro: Play cannot replace it; purchasing would bill twice.
    const sdk = fakeSdk(FULL_OFFERING);
    sdk.customerInfoState = storeTaggedInfo('pro', 'pro_monthly', 'APP_STORE');
    await expect(service(sdk).purchase('premium', 'monthly')).rejects.toMatchObject({
      code: 'conflict',
      details: { otherStoreProductId: 'pro_monthly' },
    });
    expect(sdk.lastPurchasedPackage).toBeNull();
    // iOS device, Play-purchased pro: same block on the StoreKit side.
    const iosSdk = fakeSdk(FULL_OFFERING);
    iosSdk.customerInfoState = storeTaggedInfo('pro', 'pro_monthly:p1m', 'PLAY_STORE');
    await expect(service(iosSdk, APPLE_KEY, 'ios').purchase('premium', 'monthly')).rejects.toMatchObject({ code: 'conflict' });
    expect(iosSdk.lastPurchasedPackage).toBeNull();
  });

  it('a SAME-store tagged subscription still drives the Android replacement normally', async () => {
    const sdk = fakeSdk(FULL_OFFERING);
    sdk.customerInfoState = storeTaggedInfo('pro', 'pro_monthly', 'PLAY_STORE');
    await expect(service(sdk).purchase('premium', 'monthly')).resolves.toEqual({ status: 'purchased', tier: 'premium', cycle: 'monthly' });
    expect(sdk.lastProductChange).toEqual({
      oldProductIdentifier: 'pro_monthly',
      prorationMode: PLAY_PRORATION_IMMEDIATE_WITH_TIME_PRORATION,
    });
  });

  it('does not pass a product change when the active product IS the one being bought', async () => {
    const sdk = fakeSdk(FULL_OFFERING);
    sdk.customerInfoState = customerInfo(['pro'], ['pro_monthly']);
    await service(sdk).purchase('pro', 'monthly');
    expect(sdk.lastProductChange).toBeNull();
  });

  it('aborts the purchase when the active subscriptions cannot be read (no double-billing risk)', async () => {
    const sdk = fakeSdk(FULL_OFFERING);
    sdk.customerInfoError = { code: '10', message: 'network' };
    await expect(service(sdk).purchase('premium', 'monthly')).rejects.toMatchObject({ code: 'offline' });
    expect(sdk.lastPurchasedPackage).toBeNull();
  });

  it('returns cancelled when the user closes the Play sheet (userCancelled flag or code 1)', async () => {
    const sdk = fakeSdk(FULL_OFFERING);
    sdk.purchaseError = { code: '1', userCancelled: true, message: 'cancelled' };
    await expect(service(sdk).purchase('pro', 'monthly')).resolves.toEqual({ status: 'cancelled' });
    sdk.purchaseError = { code: '1', message: 'cancelled' };
    await expect(service(sdk).purchase('pro', 'monthly')).resolves.toEqual({ status: 'cancelled' });
  });

  it('fails with upstream_error when the package is missing from the offering', async () => {
    const partial: RcOfferingsLike = { current: { identifier: 'default', availablePackages: [pkg('pro_monthly')] } };
    await expect(service(fakeSdk(partial)).purchase('premium', 'monthly')).rejects.toMatchObject({
      code: 'upstream_error',
      details: { productId: PLAY_PRODUCT_IDS.premium.monthly },
    });
  });

  it('maps store failures to AppError (retryable) and never fakes success', async () => {
    const sdk = fakeSdk(FULL_OFFERING);
    sdk.purchaseError = { code: '2', message: 'store problem' };
    await expect(service(sdk).purchase('pro', 'yearly')).rejects.toMatchObject({
      code: 'upstream_error',
      details: { rcCode: 2 },
      retryable: true,
    });
  });
});

describe('restore', () => {
  it('premium wins over pro; no active entitlement means nothing_to_restore', async () => {
    const sdk = fakeSdk(FULL_OFFERING);
    sdk.restoreInfo = customerInfo(['pro', 'premium']);
    await expect(service(sdk).restore()).resolves.toEqual({ status: 'restored', tier: 'premium' });
    sdk.restoreInfo = customerInfo(['pro']);
    await expect(service(sdk).restore()).resolves.toEqual({ status: 'restored', tier: 'pro' });
    sdk.restoreInfo = customerInfo([]);
    await expect(service(sdk).restore()).resolves.toEqual({ status: 'nothing_to_restore' });
  });

  it('maps restore failures', async () => {
    const sdk = fakeSdk(FULL_OFFERING);
    sdk.restoreError = { code: '10' };
    await expect(service(sdk).restore()).rejects.toMatchObject({ code: 'offline' });
  });
});

describe('getActiveProductId / getActiveProducts', () => {
  it('returns the active catalog product (premium first), or null when none / unreadable / unconfigured', async () => {
    const sdk = fakeSdk(FULL_OFFERING);
    sdk.customerInfoState = customerInfo(['premium'], ['premium_yearly:p1y', 'other_app_product']);
    await expect(service(sdk).getActiveProductId()).resolves.toBe('premium_yearly');
    sdk.customerInfoState = customerInfo([]);
    await expect(service(sdk).getActiveProductId()).resolves.toBeNull();
    sdk.customerInfoError = { code: '10' };
    await expect(service(sdk).getActiveProductId()).resolves.toBeNull(); // contract: never throws
    await expect(service(null).getActiveProductId()).resolves.toBeNull();
  });

  it('splits an other-store subscription out: not manageable here (sameStore null), named as otherStore', async () => {
    // iOS device, Play-purchased pro: the App Store sheet cannot manage it and no card may
    // offer a second subscription, so it must NOT surface as the same-store product.
    const sdk = fakeSdk(FULL_OFFERING);
    sdk.customerInfoState = storeTaggedInfo('pro', 'pro_monthly:p1m', 'PLAY_STORE');
    const svc = service(sdk, APPLE_KEY, 'ios');
    await expect(svc.getActiveProductId()).resolves.toBeNull();
    await expect(svc.getActiveProducts()).resolves.toEqual({ sameStore: null, otherStore: 'pro_monthly' });
    // Same product on its own platform: plain same-store.
    const androidSdk = fakeSdk(FULL_OFFERING);
    androidSdk.customerInfoState = storeTaggedInfo('pro', 'pro_monthly:p1m', 'PLAY_STORE');
    await expect(service(androidSdk).getActiveProducts()).resolves.toEqual({ sameStore: 'pro_monthly', otherStore: null });
    // Unconfigured / unreadable: both null, never throws.
    await expect(service(null).getActiveProducts()).resolves.toEqual({ sameStore: null, otherStore: null });
    const failing = fakeSdk(FULL_OFFERING);
    failing.customerInfoError = { code: '10' };
    await expect(service(failing).getActiveProducts()).resolves.toEqual({ sameStore: null, otherStore: null });
  });
});

describe('manageUrl', () => {
  it('deep-links to the product when known, otherwise the generic subscriptions page (Android)', () => {
    const svc = service(fakeSdk());
    expect(svc.manageUrl()).toBe('https://play.google.com/store/account/subscriptions');
    expect(svc.manageUrl('pro_monthly')).toBe(
      'https://play.google.com/store/account/subscriptions?sku=pro_monthly&package=com.meetingguard.ai',
    );
  });

  it('returns the App Store account page on iOS (no per-product deep link exists)', () => {
    const svc = service(fakeSdk(), APPLE_KEY, 'ios');
    expect(svc.manageUrl()).toBe(APPLE_SUBSCRIPTIONS_URL);
    expect(svc.manageUrl('pro_monthly')).toBe(APPLE_SUBSCRIPTIONS_URL);
  });
});

describe('iOS App Store semantics', () => {
  it('configures with the Apple key and the Firebase uid, like Android', async () => {
    const sdk = fakeSdk();
    await service(sdk, APPLE_KEY, 'ios').configure('uid-1');
    expect(sdk.calls).toEqual([`configure:${APPLE_KEY}:uid-1`]);
  });

  it('purchases WITHOUT a product change (one subscription group; StoreKit replaces by itself)', async () => {
    const sdk = fakeSdk(FULL_OFFERING);
    sdk.customerInfoState = customerInfo(['pro'], ['pro_monthly']); // would trigger a change on Android
    const svc = service(sdk, APPLE_KEY, 'ios');
    await expect(svc.purchase('premium', 'monthly')).resolves.toEqual({ status: 'purchased', tier: 'premium', cycle: 'monthly' });
    expect(sdk.lastProductChange).toBeNull();
    // The pre-purchase read still happens (fresh, for the cross-store guard) - it just never
    // produces a Google product change on iOS.
    expect(sdk.calls).toContain('getCustomerInfo');
    expect(sdk.calls.indexOf('invalidateCustomerInfoCache')).toBeLessThan(sdk.calls.indexOf('getCustomerInfo'));
  });

  it('showManageSubscriptions presents the native sheet and resolves true', async () => {
    const sdk = fakeSdk(FULL_OFFERING);
    await expect(service(sdk, APPLE_KEY, 'ios').showManageSubscriptions?.()).resolves.toBe(true);
    expect(sdk.calls).toContain('showManageSubscriptions');
  });

  it('showManageSubscriptions is false on Android, when unconfigured and on SDKs without the method', async () => {
    const androidSdk = fakeSdk(FULL_OFFERING);
    await expect(service(androidSdk).showManageSubscriptions?.()).resolves.toBe(false);
    expect(androidSdk.calls).toEqual([]);
    await expect(service(fakeSdk(), null, 'ios').showManageSubscriptions?.()).resolves.toBe(false);
    const legacySdk = fakeSdk(FULL_OFFERING) as PurchasesSdkLike & { showManageSubscriptions?: unknown };
    delete legacySdk.showManageSubscriptions;
    await expect(service(legacySdk, APPLE_KEY, 'ios').showManageSubscriptions?.()).resolves.toBe(false);
  });

  it('maps a failing manage sheet to AppError (the screen falls back to the URL)', async () => {
    const sdk = fakeSdk(FULL_OFFERING);
    sdk.manageSheetError = { code: '10' };
    await expect(service(sdk, APPLE_KEY, 'ios').showManageSubscriptions?.()).rejects.toMatchObject({ code: 'offline' });
  });
});

describe('pure helpers', () => {
  it('productIdOf strips Android base-plan suffixes', () => {
    expect(productIdOf({ identifier: 'pro_monthly:p1m' })).toBe('pro_monthly');
    expect(productIdOf({ identifier: 'pro_monthly' })).toBe('pro_monthly');
  });

  it('toStorePackage rejects products without a price string', () => {
    expect(toStorePackage(pkg('pro_monthly', { priceString: '' }))).toBeNull();
    expect(toStorePackage(pkg('not_ours'))).toBeNull();
  });

  it('packageHasFreeTrial requires a free phase or a zero-price intro', () => {
    expect(packageHasFreeTrial(pkg('pro_monthly').product)).toBe(false);
    expect(packageHasFreeTrial(pkg('pro_monthly', { introPrice: { price: 1.99 } }).product)).toBe(false);
    expect(packageHasFreeTrial(pkg('pro_monthly', { introPrice: { price: 0 } }).product)).toBe(true);
  });

  it('tierFromCustomerInfo ranks premium over pro', () => {
    expect(tierFromCustomerInfo(customerInfo(['premium', 'pro']))).toBe('premium');
    expect(tierFromCustomerInfo(customerInfo([]))).toBeNull();
  });

  it('activeCatalogProductIds strips base plans, drops foreign products, dedupes and ranks premium first', () => {
    expect(activeCatalogProductIds(customerInfo([], ['pro_monthly:p1m', 'pro_monthly', 'premium_yearly', 'other_thing']))).toEqual([
      'premium_yearly',
      'pro_monthly',
    ]);
    expect(activeCatalogProductIds(customerInfo([]))).toEqual([]);
    expect(activeCatalogProductIds({ entitlements: { active: {} } })).toEqual([]);
  });

  it('storeOfActiveProduct and splitActiveByStore resolve the per-store tags (unknown = same-store)', () => {
    const tagged = storeTaggedInfo('pro', 'pro_monthly:p1m', 'APP_STORE');
    expect(storeOfActiveProduct(tagged, 'pro_monthly')).toBe('APP_STORE');
    expect(storeOfActiveProduct(tagged, 'premium_monthly')).toBeNull();
    expect(splitActiveByStore(tagged, 'android')).toEqual({ sameStore: [], otherStore: ['pro_monthly'] });
    expect(splitActiveByStore(tagged, 'ios')).toEqual({ sameStore: ['pro_monthly'], otherStore: [] });
    // No store metadata (older SDK payloads, fakes): everything stays same-store, as before.
    const untagged = customerInfo(['pro'], ['pro_monthly']);
    expect(splitActiveByStore(untagged, 'android')).toEqual({ sameStore: ['pro_monthly'], otherStore: [] });
    expect(splitActiveByStore(untagged, 'ios')).toEqual({ sameStore: ['pro_monthly'], otherStore: [] });
  });

  it('isRcUserCancelled and mapRcError classify RevenueCat errors', () => {
    expect(isRcUserCancelled({ userCancelled: true })).toBe(true);
    expect(isRcUserCancelled({ code: 1 })).toBe(true);
    expect(isRcUserCancelled({ code: '2' })).toBe(false);
    expect(mapRcError({ code: '10' }, 'x').code).toBe('offline');
    expect(mapRcError({ code: 35 }, 'x').code).toBe('offline');
    expect(mapRcError({ code: '2' }, 'x').code).toBe('upstream_error');
    expect(mapRcError(new AppError('not_configured'), 'x').code).toBe('not_configured');
  });
});

describe('cross-store catalog contract', () => {
  it('App Store product ids are the SAME logical ids as the Play ones (shared RC entitlements)', () => {
    // One PRODUCT_TO_PLAN map, shared RevenueCat entitlements and the webhook's product-id
    // fallback all rely on the two stores using identical product ids (contracts.ts).
    expect(APP_STORE_PRODUCT_IDS).toEqual(PLAY_PRODUCT_IDS);
  });
});
