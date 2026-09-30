/**
 * In-app purchases via RevenueCat (owner: billing; docs/ARCHITECTURE.md §20).
 *
 * Contract: PurchasesService in src/core/contracts.ts. This is the STUB shipped until the
 * billing pass lands: `isConfigured()` is false, so the Pricing screen keeps exactly today's
 * behavior (catalog display, "subscriptions coming soon", no purchase flow).
 *
 * The real implementation (billing pass):
 * - react-native-purchases (>= 10.x; peer RN >= 0.73, no Expo config plugin needed - a dev
 *   build / store build carries the native SDK, Expo Go falls back to its preview mode which we
 *   treat as unconfigured).
 * - Configured ONLY when EXPO_PUBLIC_REVENUECAT_ANDROID_KEY is set, Platform.OS === 'android'
 *   and the native module is present. configure(uid) runs on session start so app_user_id in
 *   webhook events is the Firebase uid.
 * - THE CLIENT NEVER WRITES entitlements/{uid}: the RevenueCat webhook
 *   (functions/src/revenuecat) is the only writer; the app reads through useEntitlement().
 */
import { AppError, notImplemented } from '../../core/errors';
import type { BillingCycle, PaidPlanTier, PurchaseOutcome, PurchasesService, RestoreOutcome, StoreOffering } from '../../core/contracts';

const PLAY_SUBSCRIPTIONS_URL = 'https://play.google.com/store/account/subscriptions';
const ANDROID_PACKAGE = 'com.meetingguard.ai';

export const purchasesService: PurchasesService = {
  isConfigured(): boolean {
    // STUB (billing pass): env key + platform + native module checks land with the real service.
    return false;
  },

  async configure(uid: string): Promise<void> {
    void uid; // Safe no-op while unconfigured (contract: configure never throws when unconfigured).
  },

  async getOffering(): Promise<StoreOffering> {
    throw new AppError('not_configured', 'Purchases are not configured in this build');
  },

  async purchase(tier: PaidPlanTier, cycle: BillingCycle): Promise<PurchaseOutcome> {
    void tier;
    void cycle;
    throw notImplemented('purchasesService.purchase');
  },

  async restore(): Promise<RestoreOutcome> {
    throw notImplemented('purchasesService.restore');
  },

  manageUrl(productId?: string): string {
    if (productId === undefined) return PLAY_SUBSCRIPTIONS_URL;
    return `${PLAY_SUBSCRIPTIONS_URL}?sku=${encodeURIComponent(productId)}&package=${ANDROID_PACKAGE}`;
  },
};
