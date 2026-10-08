/**
 * In-app purchases via RevenueCat (owner: billing; docs/ARCHITECTURE.md §20).
 *
 * Contract: PurchasesService in src/core/contracts.ts; implementation in ./service.ts (factory,
 * unit-tested with a fake SDK), optional-dependency loading in ./sdk.ts.
 *
 * - Configured ONLY when the RUNNING platform's public SDK key is set
 *   (EXPO_PUBLIC_REVENUECAT_ANDROID_KEY on Android, EXPO_PUBLIC_REVENUECAT_APPLE_KEY on iOS)
 *   and the react-native-purchases native module is present (store/dev builds; Expo Go, web and
 *   unit tests are unconfigured, so the Pricing screen keeps its catalog-only behavior). Each
 *   platform ignores the other's key: Android can sell while iOS is still closed, and vice
 *   versa.
 * - `configure(uid)` runs on session start (the 'session:started' hook below), so RevenueCat's
 *   `app_user_id` in webhook events IS the Firebase uid. There is NO logOut on session end
 *   (contract: the next session's configure/logIn switches the user; logOut would create an
 *   anonymous RevenueCat user).
 * - THE CLIENT NEVER WRITES entitlements/{uid}: the RevenueCat webhook
 *   (functions/src/revenuecat) is the only purchase writer; the app reads through
 *   useEntitlement().
 *
 * This module is imported statically by the Pricing screen (registered in src/navigation), so
 * the session hook below is attached during app start, before any session begins.
 */
import { Platform } from 'react-native';

import { appEvents } from '../../core/events';
import { createLogger } from '../../core/logger';
import { toAppError } from '../../core/errors';
import type { PurchasesService } from '../../core/contracts';
import { env } from '../../config/env';
import { createPurchasesService } from './service';
import { loadPurchasesSdk } from './sdk';

const log = createLogger('purchases');

export const purchasesService: PurchasesService = createPurchasesService({
  sdk: loadPurchasesSdk,
  // The RUNNING platform's key only; other platforms (web) get null = unconfigured.
  apiKey: () =>
    Platform.OS === 'ios' ? env.revenueCat.appleKey : Platform.OS === 'android' ? env.revenueCat.androidKey : null,
  platform: () => (Platform.OS === 'ios' ? 'ios' : 'android'),
});

let sessionHookRegistered = false;

/** Idempotent: attaches the session-start configure hook once (called at module scope). */
export function registerPurchasesSessionHook(): void {
  if (sessionHookRegistered) return;
  sessionHookRegistered = true;
  appEvents.on('session:started', ({ uid }) => {
    if (!purchasesService.isConfigured()) return;
    purchasesService.configure(uid).catch((error: unknown) => {
      // Never let a store hiccup break the session; the Pricing screen retries on demand.
      log.warn('RevenueCat configure on session start failed', toAppError(error).code);
    });
  });
}

registerPurchasesSessionHook();
