import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer } from '@react-navigation/native';

import { createStackNavigator } from '@react-navigation/stack';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Linking, Platform, Text } from 'react-native';
import type { ReactElement } from 'react';
import { PaperProvider } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import { PLANS } from '../../../services/billing';
import { ThemeProvider } from '../../../contexts/ThemeContext';
import { AppError } from '../../../core/errors';
import { PLAN_DAILY_AI_LIMITS, type AssistantUsage } from '../../../core/aiContract';
import type { StoreOffering } from '../../../core/contracts';
import { I18nProvider, i18n } from '../../../i18n';
import { purchasesService } from '../../../services/purchases';
import { PricingScreen } from '../PricingScreen';
import {
  ACTIVATION_TIMEOUT_MS,
  buildPlanCards,
  computeStoreDiscount,
  formatPriceUsd,
  formatStorePrice,
  isActivated,
  isUpgradePurchase,
  storeCopyKey,
  summarizeUsage,
  type StoreState,
} from '../pricingModel';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'UTC', uses24hourClock: false }]),
}));

jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));

let mockPlan: 'free' | 'pro' | 'premium' = 'free';
let mockUsage: AssistantUsage | null = null;
const mockEntitlementListeners: ((entitlement: unknown) => void)[] = [];

function mockEntitlementDoc(plan: 'free' | 'pro' | 'premium') {
  return { plan, status: 'active', expiresAt: null, source: 'revenuecat', updatedAt: '2026-09-28T00:00:00.000Z' };
}

/** Simulates the webhook writing entitlements/{uid}: the repository listeners fire. */
function emitEntitlement(plan: 'free' | 'pro' | 'premium') {
  mockPlan = plan;
  mockEntitlementListeners.forEach((listener) => listener(mockEntitlementDoc(plan)));
}

jest.mock('../../../services/data', () => {
  const { createDefaultPreferences } = jest.requireActual('../../../core/types');
  return {
    useEntitlement: () => ({ plan: mockPlan, isLoaded: true, entitlement: { plan: mockPlan } }),
    usePreferences: () => ({ preferences: createDefaultPreferences({ language: 'en', timezone: 'UTC' }), isLoaded: true, error: null }),
    userRepository: {
      subscribeEntitlement: (listener: (entitlement: unknown) => void) => {
        mockEntitlementListeners.push(listener);
        listener(mockEntitlementDoc(mockPlan)); // like the real repo: called immediately
        return () => {
          const index = mockEntitlementListeners.indexOf(listener);
          if (index >= 0) mockEntitlementListeners.splice(index, 1);
        };
      },
    },
  };
});
jest.mock('../../../services/ai', () => ({
  useAssistant: () => ({ usage: mockUsage }),
}));
jest.mock('../../../services/auth', () => ({
  useAuth: () => ({ authUser: { uid: 'uid-1' } }),
}));

jest.mock('../../../services/purchases', () => ({
  purchasesService: {
    isConfigured: jest.fn((): boolean => false),
    configure: jest.fn(async (): Promise<void> => undefined),
    getOffering: jest.fn(),
    purchase: jest.fn(),
    restore: jest.fn(),
    getActiveProductId: jest.fn(async (): Promise<string | null> => null),
    getActiveProducts: jest.fn(async (): Promise<{ sameStore: string | null; otherStore: string | null }> => ({ sameStore: null, otherStore: null })),
    manageUrl: jest.fn(() => 'https://play.google.com/store/account/subscriptions'),
    showManageSubscriptions: jest.fn(async (): Promise<boolean> => false),
  },
  registerPurchasesSessionHook: jest.fn(),
}));

const mockPurchasesService = purchasesService as jest.Mocked<typeof purchasesService>;

/** The screen reads active products via getActiveProducts; this mocks a same-store product. */
function mockActiveProduct(sameStore: string | null, otherStore: string | null = null): void {
  mockPurchasesService.getActiveProducts.mockResolvedValue({ sameStore, otherStore });
}

const NOW = new Date('2026-09-28T10:00:00.000Z');
const TOMORROW_UTC = '2026-09-29T00:00:00.000Z';

const OFFERING: StoreOffering = {
  offeringId: 'default',
  packages: [
    { tier: 'pro', cycle: 'monthly', productId: 'pro_monthly', priceString: '€7,99', priceAmountMicros: 7_990_000, currencyCode: 'EUR', hasFreeTrial: true },
    { tier: 'pro', cycle: 'yearly', productId: 'pro_yearly', priceString: '€71,91', priceAmountMicros: 71_910_000, currencyCode: 'EUR', hasFreeTrial: true },
    { tier: 'premium', cycle: 'monthly', productId: 'premium_monthly', priceString: '€14,99', priceAmountMicros: 14_990_000, currencyCode: 'EUR', hasFreeTrial: false },
    { tier: 'premium', cycle: 'yearly', productId: 'premium_yearly', priceString: '€134,91', priceAmountMicros: 134_910_000, currencyCode: 'EUR', hasFreeTrial: false },
  ],
};
const READY: StoreState = { kind: 'ready', offering: OFFERING };

describe('pricing model', () => {
  it('uses the contract prices, the 25% yearly discount and the server quotas', () => {
    expect(PLANS.find((plan) => plan.id === 'pro_monthly')?.priceUsd).toBe(7.99);
    expect(PLANS.find((plan) => plan.id === 'premium_monthly')?.priceUsd).toBe(14.99);
    const yearly = buildPlanCards('yearly', 'free');
    expect(yearly.map((card) => card.id)).toEqual(['free', 'pro_yearly', 'premium_yearly']);
    const proYearly = yearly[1]!;
    expect(proYearly.priceUsd).toBeCloseTo(7.99 * 12 * 0.75, 2);
    expect(proYearly.discountPercent).toBe(25);
    expect(yearly.map((card) => card.aiRequestsPerDay)).toEqual([
      PLAN_DAILY_AI_LIMITS.free,
      PLAN_DAILY_AI_LIMITS.pro,
      PLAN_DAILY_AI_LIMITS.premium,
    ]);
  });

  it('marks the current plan and offers no purchase while the store is unconfigured', () => {
    const cards = buildPlanCards('monthly', 'pro');
    expect(cards.filter((card) => card.isCurrent).map((card) => card.id)).toEqual(['pro_monthly']);
    expect(cards.some((card) => card.purchasable)).toBe(false);
    expect(buildPlanCards('monthly', null).some((card) => card.isCurrent)).toBe(false);
    // No "Most popular" claim while nothing can be bought.
    expect(cards.some((card) => card.popular)).toBe(false);
  });

  it('with the offering loaded, cards carry store prices, trials and purchase buttons', () => {
    const cards = buildPlanCards('monthly', 'free', READY, 'en');
    const pro = cards.find((card) => card.id === 'pro_monthly')!;
    expect(pro).toMatchObject({ purchasable: true, popular: true, storePriceString: '€7,99', hasFreeTrial: true, productId: 'pro_monthly' });
    const premium = cards.find((card) => card.id === 'premium_monthly')!;
    expect(premium.hasFreeTrial).toBe(false);
    expect(cards.find((card) => card.id === 'free')!.purchasable).toBe(false);
    // Yearly: store per-month equivalent and store-derived discount replace the catalog values.
    const proYearly = buildPlanCards('yearly', 'free', READY, 'en').find((card) => card.id === 'pro_yearly')!;
    expect(proYearly.storeMonthlyEquivalent).toBe(formatStorePrice(71_910_000 / 12, 'EUR', 'en'));
    expect(proYearly.discountPercent).toBe(25);
    expect(proYearly.monthlyEquivalentUsd).toBeNull();
  });

  it('offers every non-current paid card with the right label (buy, switch cycle, switch tier)', () => {
    const asPro = buildPlanCards('monthly', 'pro', READY, 'en', 'pro_monthly');
    expect(asPro.find((card) => card.id === 'pro_monthly')!).toMatchObject({ isCurrent: true, purchasable: false, purchaseLabel: null });
    expect(asPro.find((card) => card.id === 'premium_monthly')!).toMatchObject({ purchasable: true, purchaseLabel: 'buy' }); // upgrade
    // The OTHER cycle of the purchased tier is a purchasable switch, never an untrue badge.
    const yearlyView = buildPlanCards('yearly', 'pro', READY, 'en', 'pro_monthly');
    expect(yearlyView.find((card) => card.id === 'pro_yearly')!).toMatchObject({
      isCurrent: false,
      purchasable: true,
      purchaseLabel: 'switchToYearly',
    });
    const monthlyView = buildPlanCards('monthly', 'premium', READY, 'en', 'premium_yearly');
    expect(monthlyView.find((card) => card.id === 'premium_monthly')!).toMatchObject({ purchasable: true, purchaseLabel: 'switchToMonthly' });
    // A tier downgrade is an in-app replacement purchase too ("Switch to Pro").
    expect(monthlyView.find((card) => card.id === 'pro_monthly')!).toMatchObject({ purchasable: true, purchaseLabel: 'switchTier' });
    expect(monthlyView.find((card) => card.id === 'free')!.purchasable).toBe(false);
  });

  it('keeps the tier-based badge on BOTH cycles when the active product is unknown (no switch offered)', () => {
    // Unconfigured builds, admin-granted plans and store hiccups: the store cannot say which
    // product is active, so neither cycle card sells a "switch" (it could open a second sub).
    const yearly = buildPlanCards('yearly', 'pro', READY, 'en');
    expect(yearly.find((card) => card.id === 'pro_yearly')!).toMatchObject({ isCurrent: true, purchasable: false, manageable: false });
    const monthly = buildPlanCards('monthly', 'pro', READY, 'en');
    expect(monthly.find((card) => card.id === 'pro_monthly')!).toMatchObject({ isCurrent: true, purchasable: false });
  });

  it('marks only the truly purchased card manageable (never admin-granted plans or Free)', () => {
    const cards = buildPlanCards('monthly', 'pro', READY, 'en', 'pro_monthly');
    expect(cards.find((card) => card.id === 'pro_monthly')!.manageable).toBe(true);
    expect(cards.find((card) => card.id === 'free')!.manageable).toBe(false);
    const otherCycle = buildPlanCards('yearly', 'pro', READY, 'en', 'pro_monthly');
    expect(otherCycle.find((card) => card.id === 'pro_yearly')!.manageable).toBe(false);
    // Admin-granted: a paid plan without a store subscription has nothing to manage.
    const granted = buildPlanCards('monthly', 'pro', READY, 'en', null);
    expect(granted.find((card) => card.id === 'pro_monthly')!.manageable).toBe(false);
  });

  it('an OTHER-store subscription blocks every purchase and marks its card managed externally', () => {
    // CustomerInfo is cross-store: a Play-purchased pro on an iPhone (or vice versa) cannot be
    // replaced by this store - any purchase would open a second, parallel subscription.
    const cards = buildPlanCards('monthly', 'pro', READY, 'en', null, 'pro_monthly');
    expect(cards.some((card) => card.purchasable)).toBe(false);
    expect(cards.some((card) => card.popular)).toBe(false);
    const pro = cards.find((card) => card.id === 'pro_monthly')!;
    expect(pro).toMatchObject({ isCurrent: true, managedExternally: true, manageable: false });
    // The other cycle card is NOT wrongly badged as current (the active product is known).
    const yearly = buildPlanCards('yearly', 'pro', READY, 'en', null, 'pro_monthly');
    expect(yearly.find((card) => card.id === 'pro_yearly')!).toMatchObject({
      isCurrent: false,
      purchasable: false,
      managedExternally: false,
    });
  });

  it('classifies upgrades (wait for the entitlement) vs replacements (confirm immediately)', () => {
    expect(isUpgradePurchase('free', 'pro')).toBe(true);
    expect(isUpgradePurchase('free', 'premium')).toBe(true);
    expect(isUpgradePurchase('pro', 'premium')).toBe(true);
    expect(isUpgradePurchase('pro', 'pro')).toBe(false); // cycle switch
    expect(isUpgradePurchase('premium', 'pro')).toBe(false); // downgrade
    expect(isUpgradePurchase('premium', 'premium')).toBe(false); // cycle switch
    expect(isUpgradePurchase(null, 'pro')).toBe(true); // unknown plan: waiting is honest
  });

  it('resolves per-platform store copy keys', () => {
    expect(storeCopyKey('loading', false)).toBe('pricing:store.loading');
    expect(storeCopyKey('loading', true)).toBe('pricing:store.loadingIos');
    expect(storeCopyKey('manageA11y', true)).toBe('pricing:store.manageA11yIos');
    expect(storeCopyKey('restoreA11y', false)).toBe('pricing:store.restoreA11y');
    // Trial eligibility and proration rules differ per store, so their copy is platform-keyed.
    expect(storeCopyKey('trial', true)).toBe('pricing:store.trialIos');
    expect(storeCopyKey('changeConfirmedBody', true)).toBe('pricing:store.changeConfirmedBodyIos');
    expect(storeCopyKey('changeConfirmedBody', false)).toBe('pricing:store.changeConfirmedBody');
  });

  it('a store load error keeps catalog prices and nothing purchasable', () => {
    const cards = buildPlanCards('monthly', 'free', { kind: 'error', code: 'offline' }, 'en');
    expect(cards.some((card) => card.purchasable)).toBe(false);
    expect(cards.find((card) => card.id === 'pro_monthly')!.storePriceString).toBeNull();
  });

  it('computes the store discount only when both prices are known and sane', () => {
    expect(computeStoreDiscount(7_990_000, 71_910_000)).toBe(25);
    expect(computeStoreDiscount(0, 71_910_000)).toBeNull();
    expect(computeStoreDiscount(7_990_000, 7_990_000 * 12)).toBeNull();
  });

  it('activation completes when the entitlement reaches the purchased tier (or better)', () => {
    expect(isActivated('pro', 'free')).toBe(false);
    expect(isActivated('pro', 'pro')).toBe(true);
    expect(isActivated('pro', 'premium')).toBe(true);
    expect(isActivated('premium', 'pro')).toBe(false);
    expect(isActivated('premium', 'premium')).toBe(true);
  });

  it('formats US dollar prices in the UI language', () => {
    expect(formatPriceUsd(7.99, 'en')).toBe('$7.99');
    expect(formatPriceUsd(0, 'en')).toBe('$0');
    expect(formatPriceUsd(7.99, 'es')).toMatch(/^7,99\sUS\$$/);
  });

  it("summarizes today's usage only while it is for the current UTC day", () => {
    const usage: AssistantUsage = { used: 7, limit: 5, plan: 'free', resetsAt: TOMORROW_UTC };
    expect(summarizeUsage(usage, 'free', NOW)).toEqual({
      kind: 'today',
      plan: 'free',
      used: 5,
      limit: 5,
      remaining: 0,
      fraction: 1,
      resetsAt: TOMORROW_UTC,
    });
    const stale: AssistantUsage = { used: 2, limit: 5, plan: 'free', resetsAt: '2026-09-28T00:00:00.000Z' };
    expect(summarizeUsage(stale, 'pro', NOW)).toEqual({ kind: 'plan', plan: 'pro', limit: PLAN_DAILY_AI_LIMITS.pro });
    expect(summarizeUsage(null, 'free', NOW)).toEqual({ kind: 'plan', plan: 'free', limit: 5 });
  });
});

const Stack = createStackNavigator();
// App Store rule 3.1.2: the Plans screen links to the legal pages. The stubs stand in for the
// real legal screens so the link press is proven by what ends up on screen.
function LegalStub(): ReactElement {
  return <Text testID="legal-stub">legal</Text>;
}

async function renderPricing() {
  await render(
    <I18nProvider>
      <ThemeProvider>
        <PaperProvider>
          <NavigationContainer>
            <Stack.Navigator screenOptions={{ headerShown: false, animation: 'none' }}>
              <Stack.Screen name="Pricing" component={PricingScreen} />
              <Stack.Screen name="Privacy" component={LegalStub} />
              <Stack.Screen name="Terms" component={LegalStub} />
            </Stack.Navigator>
          </NavigationContainer>
        </PaperProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
  await act(async () => undefined);
}

const toastShow = Toast.show as jest.Mock;

describe('PricingScreen (purchases unconfigured)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    await i18n.changeLanguage('en');
    mockPlan = 'free';
    mockUsage = null;
    mockEntitlementListeners.length = 0;
    mockPurchasesService.isConfigured.mockReturnValue(false);
  });

  it('says subscriptions are coming soon and shows no purchase action', async () => {
    await renderPricing();
    expect(screen.getByText('Subscriptions coming soon')).toBeTruthy();
    expect(within(screen.getByTestId('pricing-plan-free')).getByText('Current plan')).toBeTruthy();
    expect(within(screen.getByTestId('pricing-plan-pro_monthly')).getByText('$7.99')).toBeTruthy();
    expect(within(screen.getByTestId('pricing-plan-pro_monthly')).getByText('100 AI assistant requests per day')).toBeTruthy();
    expect(screen.getByTestId('pricing-coming-soon-pro_monthly').props.accessibilityState).toEqual({ disabled: true });
    expect(screen.queryByText(/Unlimited/i)).toBeNull();
    expect(screen.queryByText('Most popular')).toBeNull();
    expect(screen.queryByTestId('pricing-buy-pro_monthly')).toBeNull();
    expect(screen.queryByTestId('pricing-restore')).toBeNull();
    expect(screen.getByText('Today\'s count appears after you use the assistant.')).toBeTruthy();
    expect(mockPurchasesService.getOffering).not.toHaveBeenCalled();
  });

  it("shows today's assistant usage when it is known", async () => {
    mockUsage = { used: 3, limit: 5, plan: 'free', resetsAt: '2999-01-01T00:00:00.000Z' };
    await renderPricing();
    expect(screen.getByText('3 of 5 requests used')).toBeTruthy();
  });

  it('switches to yearly prices', async () => {
    await renderPricing();
    await act(async () => {
      fireEvent.press(screen.getByText('Yearly'));
    });
    const proYearly = screen.getByTestId('pricing-plan-pro_yearly');
    expect(within(proYearly).getByText('$71.91')).toBeTruthy();
    expect(within(proYearly).getByText('Save 25%')).toBeTruthy();
    expect(within(proYearly).getByText('Billed yearly · $5.99 per month')).toBeTruthy();
  });

  it('follows the UI language', async () => {
    await i18n.changeLanguage('es');
    mockPlan = 'pro';
    await renderPricing();
    // A granted paid plan replaces the Free-oriented coming-soon warning with a confirmation.
    expect(screen.getByText('Tu plan Pro está activo')).toBeTruthy();
    expect(screen.queryByTestId('pricing-coming-soon-banner')).toBeNull();
    expect(within(screen.getByTestId('pricing-plan-pro_monthly')).getByText('Plan actual')).toBeTruthy();
  });
});

describe('PricingScreen (purchases configured)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    await i18n.changeLanguage('en');
    mockPlan = 'free';
    mockUsage = null;
    mockEntitlementListeners.length = 0;
    toastShow.mockClear();
    mockPurchasesService.isConfigured.mockReturnValue(true);
    mockPurchasesService.configure.mockResolvedValue(undefined);
    mockPurchasesService.getOffering.mockResolvedValue(OFFERING);
    mockActiveProduct(null);
    mockPurchasesService.purchase.mockReset();
    mockPurchasesService.restore.mockReset();
  });

  it('loads the offering and shows store prices, trial copy and buy buttons', async () => {
    await renderPricing();
    expect(mockPurchasesService.configure).toHaveBeenCalledWith('uid-1');
    expect(screen.queryByText('Subscriptions coming soon')).toBeNull();
    const pro = screen.getByTestId('pricing-plan-pro_monthly');
    expect(within(pro).getByText('€7,99')).toBeTruthy();
    // iOS (the jest default platform): StoreKit reports the intro offer even to users who
    // already consumed the trial, so the copy promises it to NEW subscribers only.
    expect(within(pro).getByText('New subscribers: 3-day free trial')).toBeTruthy();
    expect(within(pro).getByText('Get Pro')).toBeTruthy();
    expect(within(screen.getByTestId('pricing-plan-premium_monthly')).queryByTestId('pricing-trial-premium_monthly')).toBeNull();
    expect(screen.getByText('Most popular')).toBeTruthy();
    expect(screen.getByTestId('pricing-restore')).toBeTruthy();
    expect(screen.queryByTestId('pricing-coming-soon-pro_monthly')).toBeNull();
  });

  it('states the renewal terms and links to the privacy policy and terms of use (App Store 3.1.2)', async () => {
    await renderPricing();
    expect(screen.getByTestId('pricing-renewal').props.children).toContain('renew automatically');
    expect(screen.getByTestId('pricing-privacy')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('pricing-terms'));
    });
    // The transition (animation 'none') still settles on a timer; let it finish in the test.
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
    expect(screen.getByTestId('legal-stub')).toBeTruthy();
  });

  it('shows catalog prices, an error banner with Retry and NO buy buttons when the offering fails', async () => {
    mockPurchasesService.getOffering.mockRejectedValueOnce(new AppError('offline'));
    await renderPricing();
    expect(screen.getByTestId('pricing-store-error')).toBeTruthy();
    expect(within(screen.getByTestId('pricing-plan-pro_monthly')).getByText('$7.99')).toBeTruthy();
    expect(screen.queryByTestId('pricing-buy-pro_monthly')).toBeNull();
    // Retry recovers to the purchasable state.
    await act(async () => {
      fireEvent.press(screen.getByTestId('pricing-store-retry'));
    });
    expect(screen.queryByTestId('pricing-store-error')).toBeNull();
    expect(screen.getByTestId('pricing-buy-pro_monthly')).toBeTruthy();
  });

  it('purchase success shows the activating state until the entitlement flips', async () => {
    mockPurchasesService.purchase.mockResolvedValue({ status: 'purchased', tier: 'pro', cycle: 'monthly' });
    await renderPricing();
    await act(async () => {
      fireEvent.press(screen.getByTestId('pricing-buy-pro_monthly'));
    });
    expect(mockPurchasesService.purchase).toHaveBeenCalledWith('pro', 'monthly');
    expect(screen.getByTestId('pricing-activating')).toBeTruthy();
    expect(screen.getByText('Payment received. Activating your plan...')).toBeTruthy();
    // The webhook wrote entitlements/{uid}; the entitlement listener fires with 'pro'.
    await act(async () => {
      emitEntitlement('pro');
    });
    expect(screen.queryByTestId('pricing-activating')).toBeNull();
    expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  it('a cancelled purchase is silent', async () => {
    mockPurchasesService.purchase.mockResolvedValue({ status: 'cancelled' });
    await renderPricing();
    await act(async () => {
      fireEvent.press(screen.getByTestId('pricing-buy-premium_monthly'));
    });
    expect(screen.queryByTestId('pricing-activating')).toBeNull();
    expect(toastShow).not.toHaveBeenCalled();
  });

  it('a failed purchase shows a localized error and returns to idle', async () => {
    mockPurchasesService.purchase.mockRejectedValue(new AppError('upstream_error'));
    await renderPricing();
    await act(async () => {
      fireEvent.press(screen.getByTestId('pricing-buy-pro_monthly'));
    });
    expect(toastShow).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', text1: "The purchase didn't go through" }),
    );
    expect(screen.queryByTestId('pricing-activating')).toBeNull();
    expect(screen.getByTestId('pricing-buy-pro_monthly')).toBeTruthy();
  });

  it('restore reports when there is nothing to restore', async () => {
    mockPurchasesService.restore.mockResolvedValue({ status: 'nothing_to_restore' });
    await renderPricing();
    await act(async () => {
      fireEvent.press(screen.getByTestId('pricing-restore'));
    });
    expect(toastShow).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'info', text1: 'No previous purchases were found for this account.' }),
    );
    expect(screen.queryByTestId('pricing-activating')).toBeNull();
  });

  it('restore of an active purchase waits for the entitlement like a purchase', async () => {
    mockPurchasesService.restore.mockResolvedValue({ status: 'restored', tier: 'premium' });
    await renderPricing();
    await act(async () => {
      fireEvent.press(screen.getByTestId('pricing-restore'));
    });
    expect(screen.getByTestId('pricing-activating')).toBeTruthy();
  });

  it('a current store-bought plan shows manage + the "Switch to Pro" downgrade purchase (Spanish copy)', async () => {
    await i18n.changeLanguage('es');
    mockPlan = 'premium';
    mockActiveProduct('premium_monthly');
    await renderPricing();
    const premium = screen.getByTestId('pricing-plan-premium_monthly');
    expect(within(premium).getByText('Plan actual')).toBeTruthy();
    expect(screen.getByTestId('pricing-manage')).toBeTruthy();
    expect(screen.getByText('Gestionar suscripción')).toBeTruthy();
    // The downgrade is an in-app replacement purchase now, labeled as a switch.
    expect(screen.getByTestId('pricing-buy-pro_monthly')).toBeTruthy();
    expect(screen.getByText('Cambiar a Pro')).toBeTruthy();
  });

  it('an admin-granted paid plan shows NO manage button (no store subscription behind it)', async () => {
    mockPlan = 'premium';
    mockActiveProduct(null);
    await renderPricing();
    expect(within(screen.getByTestId('pricing-plan-premium_monthly')).getByText('Current plan')).toBeTruthy();
    expect(screen.queryByTestId('pricing-manage')).toBeNull();
    // Without a known active product, no tier-mate switch is offered either.
    expect(screen.queryByTestId('pricing-buy-premium_monthly')).toBeNull();
  });

  it('an other-store subscription blocks all purchases and names the store where it is managed', async () => {
    mockPlan = 'pro';
    mockActiveProduct(null, 'pro_monthly');
    await renderPricing();
    // Nothing is purchasable (a purchase here would open a second, parallel subscription) and
    // there is no Manage (this platform's store sheet cannot change the other store's sub).
    expect(screen.queryByTestId('pricing-buy-premium_monthly')).toBeNull();
    expect(screen.queryByTestId('pricing-buy-pro_monthly')).toBeNull();
    expect(screen.queryByTestId('pricing-manage')).toBeNull();
    // iOS build (the jest default platform): the subscription lives in Google Play.
    expect(screen.getByTestId('pricing-other-store-pro_monthly')).toBeTruthy();
    expect(screen.getByText('This subscription was purchased in Google Play and can only be changed there.')).toBeTruthy();
  });

  it("the other billing cycle of the purchased tier is a purchasable switch, not 'Current plan'", async () => {
    mockPlan = 'pro';
    mockActiveProduct('pro_monthly');
    await renderPricing();
    await act(async () => {
      fireEvent.press(screen.getByTestId('pricing-cycle-yearly'));
    });
    const proYearly = screen.getByTestId('pricing-plan-pro_yearly');
    expect(within(proYearly).queryByText('Current plan')).toBeNull();
    expect(within(proYearly).getByTestId('pricing-buy-pro_yearly')).toBeTruthy();
    expect(within(proYearly).getByText('Switch to yearly billing')).toBeTruthy();
    // The truly purchased cycle keeps the badge and the manage action.
    await act(async () => {
      fireEvent.press(screen.getByTestId('pricing-cycle-monthly'));
    });
    expect(within(screen.getByTestId('pricing-plan-pro_monthly')).getByText('Current plan')).toBeTruthy();
    expect(screen.getByTestId('pricing-manage')).toBeTruthy();
  });

  it('a cycle switch confirms immediately (no activating wait) and refreshes the active product', async () => {
    mockPlan = 'pro';
    mockActiveProduct('pro_monthly');
    mockPurchasesService.purchase.mockResolvedValue({ status: 'purchased', tier: 'pro', cycle: 'yearly' });
    await renderPricing();
    await act(async () => {
      fireEvent.press(screen.getByTestId('pricing-cycle-yearly'));
    });
    mockActiveProduct('pro_yearly');
    await act(async () => {
      fireEvent.press(screen.getByTestId('pricing-buy-pro_yearly'));
    });
    expect(mockPurchasesService.purchase).toHaveBeenCalledWith('pro', 'yearly');
    // The CURRENT plan already satisfies the entitlement, so 'activating' would fake success.
    expect(screen.queryByTestId('pricing-activating')).toBeNull();
    // iOS (jest default): the body must NOT promise Play's automatic time credit - App Store
    // non-upgrades apply at the next renewal with no crediting.
    expect(toastShow).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        text1: 'Change confirmed',
        text2: 'Your plan change is recorded in the App Store. It takes effect at your next renewal.',
      }),
    );
    // The purchased-card badge moved to the yearly card after the refresh.
    expect(within(screen.getByTestId('pricing-plan-pro_yearly')).getByText('Current plan')).toBeTruthy();
  });

  it('a tier downgrade also confirms immediately instead of activating', async () => {
    mockPlan = 'premium';
    mockActiveProduct('premium_monthly');
    mockPurchasesService.purchase.mockResolvedValue({ status: 'purchased', tier: 'pro', cycle: 'monthly' });
    await renderPricing();
    await act(async () => {
      fireEvent.press(screen.getByTestId('pricing-buy-pro_monthly'));
    });
    expect(mockPurchasesService.purchase).toHaveBeenCalledWith('pro', 'monthly');
    expect(screen.queryByTestId('pricing-activating')).toBeNull();
    expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', text1: 'Change confirmed' }));
  });

  it('manage prefers the iOS native sheet and falls back to the store URL when it is unavailable', async () => {
    const openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    try {
      mockPlan = 'premium';
      mockActiveProduct('premium_monthly');
      (mockPurchasesService.showManageSubscriptions as jest.Mock).mockResolvedValueOnce(true);
      await renderPricing();
      await act(async () => {
        fireEvent.press(screen.getByTestId('pricing-manage'));
      });
      expect(openUrl).not.toHaveBeenCalled(); // the sheet handled it
      (mockPurchasesService.showManageSubscriptions as jest.Mock).mockResolvedValueOnce(false);
      await act(async () => {
        fireEvent.press(screen.getByTestId('pricing-manage'));
      });
      expect(mockPurchasesService.manageUrl).toHaveBeenCalledWith('premium_monthly');
      expect(openUrl).toHaveBeenCalledWith('https://play.google.com/store/account/subscriptions');
    } finally {
      openUrl.mockRestore();
    }
  });

  it('names the App Store in the load-error copy on iOS (the jest default platform)', async () => {
    mockPurchasesService.getOffering.mockRejectedValueOnce(new AppError('offline'));
    await renderPricing();
    expect(
      screen.getByText("We couldn't load the prices from the App Store, so purchases are paused for now. The prices below are for reference only."),
    ).toBeTruthy();
  });

  it('names Google Play in the load-error copy on Android', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(Platform, 'OS');
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
    try {
      mockPurchasesService.getOffering.mockRejectedValueOnce(new AppError('offline'));
      await renderPricing();
      expect(
        screen.getByText("We couldn't load the prices from Google Play, so purchases are paused for now. The prices below are for reference only."),
      ).toBeTruthy();
    } finally {
      if (descriptor) Object.defineProperty(Platform, 'OS', descriptor);
    }
  });

  it('activating times out honestly back to idle when the entitlement never flips', async () => {
    jest.useFakeTimers();
    try {
      mockPurchasesService.purchase.mockResolvedValue({ status: 'purchased', tier: 'pro', cycle: 'monthly' });
      await renderPricing();
      await act(async () => {
        fireEvent.press(screen.getByTestId('pricing-buy-pro_monthly'));
      });
      expect(screen.getByTestId('pricing-activating')).toBeTruthy();
      await act(async () => {
        jest.advanceTimersByTime(ACTIVATION_TIMEOUT_MS + 1_000);
      });
      expect(screen.queryByTestId('pricing-activating')).toBeNull();
      expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({ type: 'info', text1: 'Still processing' }));
      // Retry/Restore are usable again instead of being disabled forever.
      expect(screen.getByTestId('pricing-buy-pro_monthly')).toBeTruthy();
      expect(screen.getByTestId('pricing-restore')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });
});
