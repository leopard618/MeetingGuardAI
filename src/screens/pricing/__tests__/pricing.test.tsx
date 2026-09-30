import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
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
  buildPlanCards,
  computeStoreDiscount,
  formatPriceUsd,
  formatStorePrice,
  isActivated,
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
    manageUrl: jest.fn(() => 'https://play.google.com/store/account/subscriptions'),
  },
  registerPurchasesSessionHook: jest.fn(),
}));

const mockPurchasesService = purchasesService as jest.Mocked<typeof purchasesService>;

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

  it('never offers the current tier or a downgrade for purchase', () => {
    const asPro = buildPlanCards('monthly', 'pro', READY, 'en');
    expect(asPro.find((card) => card.id === 'pro_monthly')!.purchasable).toBe(false); // current
    expect(asPro.find((card) => card.id === 'premium_monthly')!.purchasable).toBe(true); // upgrade
    const asPremium = buildPlanCards('monthly', 'premium', READY, 'en');
    expect(asPremium.find((card) => card.id === 'pro_monthly')!.purchasable).toBe(false); // downgrade via Play
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

async function renderPricing() {
  await render(
    <I18nProvider>
      <ThemeProvider>
        <PaperProvider>
          <NavigationContainer>
            <Stack.Navigator screenOptions={{ headerShown: false }}>
              <Stack.Screen name="Pricing" component={PricingScreen} />
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
    expect(screen.getByText('Suscripciones próximamente')).toBeTruthy();
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
    mockPurchasesService.purchase.mockReset();
    mockPurchasesService.restore.mockReset();
  });

  it('loads the offering and shows store prices, trial copy and buy buttons', async () => {
    await renderPricing();
    expect(mockPurchasesService.configure).toHaveBeenCalledWith('uid-1');
    expect(screen.queryByText('Subscriptions coming soon')).toBeNull();
    const pro = screen.getByTestId('pricing-plan-pro_monthly');
    expect(within(pro).getByText('€7,99')).toBeTruthy();
    expect(within(pro).getByText('3-day free trial')).toBeTruthy();
    expect(within(pro).getByText('Get Pro')).toBeTruthy();
    expect(within(screen.getByTestId('pricing-plan-premium_monthly')).queryByText('3-day free trial')).toBeNull();
    expect(screen.getByText('Most popular')).toBeTruthy();
    expect(screen.getByTestId('pricing-restore')).toBeTruthy();
    expect(screen.queryByTestId('pricing-coming-soon-pro_monthly')).toBeNull();
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
    expect(screen.getByText('Payment received. Activating your plan…')).toBeTruthy();
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

  it('a current paid plan shows the manage-subscription action (Spanish copy)', async () => {
    await i18n.changeLanguage('es');
    mockPlan = 'premium';
    await renderPricing();
    const premium = screen.getByTestId('pricing-plan-premium_monthly');
    expect(within(premium).getByText('Plan actual')).toBeTruthy();
    expect(screen.getByTestId('pricing-manage')).toBeTruthy();
    expect(screen.getByText('Gestionar suscripción')).toBeTruthy();
    // The premium holder cannot "buy" pro (downgrades go through Google Play).
    expect(screen.queryByTestId('pricing-buy-pro_monthly')).toBeNull();
  });
});
