import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';

import { PLANS } from '../../../services/billing';
import { ThemeProvider } from '../../../contexts/ThemeContext';
import { PLAN_DAILY_AI_LIMITS, type AssistantUsage } from '../../../core/aiContract';
import { I18nProvider, i18n } from '../../../i18n';
import { PricingScreen } from '../PricingScreen';
import { buildPlanCards, formatPriceUsd, summarizeUsage } from '../pricingModel';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'UTC', uses24hourClock: false }]),
}));

let mockPlan: 'free' | 'pro' | 'premium' = 'free';
let mockUsage: AssistantUsage | null = null;

jest.mock('../../../services/data', () => {
  const { createDefaultPreferences } = jest.requireActual('../../../core/types');
  return {
    useEntitlement: () => ({ plan: mockPlan, isLoaded: true, entitlement: { plan: mockPlan } }),
    usePreferences: () => ({ preferences: createDefaultPreferences({ language: 'en', timezone: 'UTC' }), isLoaded: true, error: null }),
  };
});
jest.mock('../../../services/ai', () => ({
  useAssistant: () => ({ usage: mockUsage }),
}));

const NOW = new Date('2026-09-28T10:00:00.000Z');
const TOMORROW_UTC = '2026-09-29T00:00:00.000Z';

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

  it('marks the current plan and never offers a purchase', () => {
    const cards = buildPlanCards('monthly', 'pro');
    expect(cards.filter((card) => card.isCurrent).map((card) => card.id)).toEqual(['pro_monthly']);
    expect(cards.some((card) => card.purchasable)).toBe(false);
    expect(buildPlanCards('monthly', null).some((card) => card.isCurrent)).toBe(false);
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

describe('PricingScreen', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    await i18n.changeLanguage('en');
    mockPlan = 'free';
    mockUsage = null;
  });

  it('says subscriptions are coming soon and shows no purchase action', async () => {
    await renderPricing();
    expect(screen.getByText('Subscriptions coming soon')).toBeTruthy();
    expect(within(screen.getByTestId('pricing-plan-free')).getByText('Current plan')).toBeTruthy();
    expect(within(screen.getByTestId('pricing-plan-pro_monthly')).getByText('$7.99')).toBeTruthy();
    expect(within(screen.getByTestId('pricing-plan-pro_monthly')).getByText('100 AI assistant requests per day')).toBeTruthy();
    expect(screen.getByTestId('pricing-coming-soon-pro_monthly').props.accessibilityState).toEqual({ disabled: true });
    expect(screen.queryByText(/Unlimited/i)).toBeNull();
    expect(screen.getByText('Today\'s count appears after you use the assistant.')).toBeTruthy();
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
