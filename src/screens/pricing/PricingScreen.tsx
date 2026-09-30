/**
 * Plans (owner: billing; docs/ARCHITECTURE.md §20).
 *
 * State machine (pricingModel.ts):
 * - purchases UNCONFIGURED (no EXPO_PUBLIC_REVENUECAT_ANDROID_KEY / no native SDK): the old
 *   honest catalog view - "coming soon" banner, informational cards, no purchase UI.
 * - CONFIGURED: loads the current RevenueCat offering; cards show the STORE price strings and
 *   purchase buttons ("3-day free trial" copy only when the store reports the intro offer).
 *   A load failure shows catalog prices + an error banner with Retry and NO purchase buttons.
 * - Purchase: 'cancelled' is silent; success shows an "activating" banner until the
 *   webhook-written entitlement (useEntitlement) flips - the client NEVER writes entitlements.
 * - Restore + Manage subscription (Google Play) appear only while configured.
 * - Prices from src/services/billing.ts stay the fallback; daily assistant quotas as enforced
 *   by the server (PLAN_DAILY_AI_LIMITS); today's usage from useAssistant().usage.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { ActivityIndicator, FlatList, Linking, Pressable, StyleSheet, Text, View, type ListRenderItem } from 'react-native';
import { ProgressBar, SegmentedButtons } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

import type { BillingCycle } from '../../services/billing';
import { useTheme, type AppColors } from '../../contexts/ThemeContext';
import { createLogger } from '../../core/logger';
import { errorMessageKey, toAppError } from '../../core/errors';
import { useResponsive } from '../../hooks/useResponsive';
import { useLanguage, useT } from '../../i18n';
import type { TranslateFn } from '../../core/contracts';
import { useAssistant } from '../../services/ai';
import { useAuth } from '../../services/auth';
import { effectivePlan } from '../../core/types';
import { useEntitlement, userRepository } from '../../services/data';
import { purchasesService } from '../../services/purchases';
import { useFormatters } from '../shared/useFormatters';
import {
  ACTIVATION_SLOW_AFTER_MS,
  STORE_UNCONFIGURED,
  buildPlanCards,
  formatPriceUsd,
  isActivated,
  summarizeUsage,
  type PlanCard,
  type PurchasePhase,
  type StoreState,
  type UsageSummary,
} from './pricingModel';

const log = createLogger('pricing');

const CYCLES: readonly BillingCycle[] = ['monthly', 'yearly'];
const IDLE: PurchasePhase = { kind: 'idle' };

function UsageCard({ summary, colors }: { summary: UsageSummary; colors: AppColors }): ReactElement {
  const t = useT();
  const fmt = useFormatters();
  const plan = t(`pricing:plans.${summary.plan}.name`);
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]} testID="pricing-usage">
      <Text style={[styles.cardTitle, { color: colors.text }]} accessibilityRole="header">
        {t('pricing:usage.title')}
      </Text>
      <Text style={[styles.body, { color: colors.textSecondary }]}>{t('pricing:usage.plan', { plan })}</Text>
      {summary.kind === 'today' ? (
        <>
          <Text style={[styles.usageNumbers, { color: colors.text }]}>
            {t('pricing:usage.today', { used: summary.used, limit: summary.limit })}
          </Text>
          <ProgressBar
            progress={summary.fraction}
            color={summary.remaining === 0 ? colors.danger : colors.primary}
            style={styles.progress}
            accessibilityLabel={t('pricing:usage.today', { used: summary.used, limit: summary.limit })}
          />
          <Text style={[styles.caption, { color: colors.textSecondary }]}>
            {summary.remaining === 0
              ? t('pricing:usage.exhausted', { time: fmt.dateTime(summary.resetsAt) })
              : t('pricing:usage.resets', { time: fmt.dateTime(summary.resetsAt) })}
          </Text>
          <Text style={[styles.caption, { color: colors.textSecondary }]}>{t('pricing:usage.thisDevice')}</Text>
        </>
      ) : (
        <>
          <Text style={[styles.usageNumbers, { color: colors.text }]}>{t('pricing:usage.perDay', { count: summary.limit })}</Text>
          <Text style={[styles.caption, { color: colors.textSecondary }]}>{t('pricing:usage.unknownToday')}</Text>
        </>
      )}
    </View>
  );
}

interface PlanCardViewProps {
  card: PlanCard;
  colors: AppColors;
  language: 'en' | 'es';
  configured: boolean;
  busy: boolean;
  purchasingThis: boolean;
  onBuy: (card: PlanCard) => void;
  onManage: () => void;
}

function PlanCardView({ card, colors, language, configured, busy, purchasingThis, onBuy, onManage }: PlanCardViewProps): ReactElement {
  const t = useT();
  const name = t(`pricing:plans.${card.tier}.name`);
  const price = card.storePriceString ?? formatPriceUsd(card.priceUsd, language);
  const period = card.cycle === 'yearly' ? t('pricing:perYear') : card.cycle === 'monthly' ? t('pricing:perMonth') : null;
  const monthlyEquivalent =
    card.storeMonthlyEquivalent ?? (card.monthlyEquivalentUsd !== null ? formatPriceUsd(card.monthlyEquivalentUsd, language) : null);
  const features = [
    t('pricing:features.requests', { count: card.aiRequestsPerDay }),
    ...(card.tier === 'free' ? [t('pricing:features.meetings'), t('pricing:features.calendars')] : [t('pricing:features.everythingFree')]),
  ];

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: card.popular ? colors.primary : colors.border },
        card.popular && styles.popularCard,
      ]}
      testID={`pricing-plan-${card.id}`}
    >
      <View style={styles.planHeader}>
        <Text style={[styles.planName, { color: colors.text }]} accessibilityRole="header">
          {name}
        </Text>
        {card.isCurrent ? (
          <View style={[styles.badge, { backgroundColor: colors.primaryContainer }]}>
            <Text style={[styles.badgeText, { color: colors.onPrimaryContainer }]}>{t('pricing:currentPlan')}</Text>
          </View>
        ) : card.popular ? (
          <View style={[styles.badge, { backgroundColor: colors.primary }]}>
            <Text style={[styles.badgeText, { color: colors.onPrimary }]}>{t('pricing:popular')}</Text>
          </View>
        ) : null}
      </View>
      <Text style={[styles.body, { color: colors.textSecondary }]}>{t(`pricing:plans.${card.tier}.description`)}</Text>

      <View style={styles.priceRow} accessible accessibilityLabel={period ? t('pricing:priceA11y', { price, period }) : price}>
        <Text style={[styles.price, { color: colors.text }]}>{price}</Text>
        {period ? <Text style={[styles.period, { color: colors.textSecondary }]}>{` / ${period}`}</Text> : null}
      </View>
      {monthlyEquivalent !== null ? (
        <Text style={[styles.caption, { color: colors.textSecondary }]}>{t('pricing:monthlyEquivalent', { price: monthlyEquivalent })}</Text>
      ) : null}
      {card.discountPercent !== null ? (
        <Text style={[styles.savings, { color: colors.success }]}>{t('pricing:save', { percent: card.discountPercent })}</Text>
      ) : null}
      {card.hasFreeTrial ? (
        <Text style={[styles.trial, { color: colors.primary }]} testID={`pricing-trial-${card.id}`}>
          {t('pricing:store.trial')}
        </Text>
      ) : null}

      <View style={styles.features}>
        {features.map((feature) => (
          <View key={feature} style={styles.featureRow}>
            <Ionicons name="checkmark-circle" size={20} color={colors.success} accessibilityElementsHidden importantForAccessibility="no" />
            <Text style={[styles.featureText, { color: colors.text }]}>{feature}</Text>
          </View>
        ))}
      </View>

      {card.purchasable ? (
        <Pressable
          style={({ pressed }) => [styles.actionButton, { backgroundColor: colors.primary, opacity: busy || pressed ? 0.6 : 1 }]}
          onPress={() => onBuy(card)}
          disabled={busy}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy, busy: purchasingThis }}
          accessibilityLabel={t('pricing:store.buyA11y', { plan: name, price, period: period ?? '' })}
          testID={`pricing-buy-${card.id}`}
        >
          {purchasingThis ? (
            <ActivityIndicator color={colors.onPrimary} accessibilityElementsHidden importantForAccessibility="no" />
          ) : (
            <Text style={[styles.actionButtonText, { color: colors.onPrimary }]}>{t('pricing:store.buy', { plan: name })}</Text>
          )}
        </Pressable>
      ) : null}

      {configured && card.isCurrent && card.tier !== 'free' ? (
        <Pressable
          style={({ pressed }) => [styles.secondaryButton, { borderColor: colors.primary, opacity: pressed ? 0.6 : 1 }]}
          onPress={onManage}
          accessibilityRole="button"
          accessibilityLabel={t('pricing:store.manageA11y')}
          testID="pricing-manage"
        >
          <Text style={[styles.secondaryButtonText, { color: colors.primary }]}>{t('pricing:store.manage')}</Text>
        </Pressable>
      ) : null}

      {!configured && card.tier !== 'free' && !card.isCurrent ? (
        <View
          style={[styles.comingSoon, { borderColor: colors.border, backgroundColor: colors.surfaceVariant }]}
          accessible
          accessibilityRole="button"
          accessibilityState={{ disabled: true }}
          accessibilityLabel={t('pricing:comingSoonA11y', { plan: name })}
          testID={`pricing-coming-soon-${card.id}`}
        >
          <Text style={[styles.comingSoonText, { color: colors.textSecondary }]}>{t('pricing:comingSoon')}</Text>
        </View>
      ) : null}
    </View>
  );
}

function StoreBanner({ store, phase, slow, colors, t, onRetry }: { store: StoreState; phase: PurchasePhase; slow: boolean; colors: AppColors; t: TranslateFn; onRetry: () => void }): ReactElement | null {
  if (phase.kind === 'activating') {
    return (
      <View
        style={[styles.banner, { backgroundColor: colors.primaryContainer }]}
        testID="pricing-activating"
        accessible
        accessibilityLiveRegion="polite"
        accessibilityLabel={slow ? t('pricing:store.activatingSlow') : t('pricing:store.activating')}
      >
        <ActivityIndicator color={colors.onPrimaryContainer} accessibilityElementsHidden importantForAccessibility="no" />
        <View style={styles.bannerText}>
          <Text style={[styles.bannerTitle, { color: colors.onPrimaryContainer }]}>{t('pricing:store.activatingTitle')}</Text>
          <Text style={[styles.body, { color: colors.onPrimaryContainer }]}>
            {slow ? t('pricing:store.activatingSlow') : t('pricing:store.activating')}
          </Text>
        </View>
      </View>
    );
  }
  if (store.kind === 'loading') {
    return (
      <View style={[styles.banner, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth }]} testID="pricing-store-loading">
        <ActivityIndicator color={colors.primary} accessibilityElementsHidden importantForAccessibility="no" />
        <View style={styles.bannerText}>
          <Text style={[styles.body, { color: colors.textSecondary }]}>{t('pricing:store.loading')}</Text>
        </View>
      </View>
    );
  }
  if (store.kind === 'error') {
    return (
      <View style={[styles.banner, { backgroundColor: colors.surface, borderColor: colors.danger, borderWidth: 1 }]} testID="pricing-store-error">
        <Ionicons name="cloud-offline-outline" size={22} color={colors.danger} accessibilityElementsHidden importantForAccessibility="no" />
        <View style={styles.bannerText}>
          <Text style={[styles.bannerTitle, { color: colors.text }]} accessibilityRole="header">
            {t('pricing:store.loadErrorTitle')}
          </Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>{t('pricing:store.loadError')}</Text>
          <Pressable
            style={({ pressed }) => [styles.retryButton, { borderColor: colors.primary, opacity: pressed ? 0.6 : 1 }]}
            onPress={onRetry}
            accessibilityRole="button"
            accessibilityLabel={t('pricing:store.retryA11y')}
            testID="pricing-store-retry"
          >
            <Text style={[styles.secondaryButtonText, { color: colors.primary }]}>{t('pricing:store.retry')}</Text>
          </Pressable>
        </View>
      </View>
    );
  }
  return null;
}

export function PricingScreen(): ReactElement {
  const t = useT();
  const { colors } = useTheme();
  const { language } = useLanguage();
  const insets = useSafeAreaInsets();
  const layout = useResponsive();
  const { plan, isLoaded } = useEntitlement();
  const { usage } = useAssistant();
  const { authUser } = useAuth();
  const [cycle, setCycle] = useState<BillingCycle>('monthly');

  const configured = purchasesService.isConfigured();
  const [store, setStore] = useState<StoreState>(() => (configured ? { kind: 'loading' } : STORE_UNCONFIGURED));
  const [phase, setPhase] = useState<PurchasePhase>(IDLE);
  const [slow, setSlow] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const uid = authUser?.uid ?? null;
  // No synchronous setState here: the initial state is already 'loading'; the Retry handler
  // resets it before re-calling (react-hooks/set-state-in-effect).
  const loadOffering = useCallback(async () => {
    if (!configured) return;
    try {
      if (uid !== null) await purchasesService.configure(uid);
      const offering = await purchasesService.getOffering();
      if (mountedRef.current) setStore({ kind: 'ready', offering });
    } catch (caught) {
      const error = toAppError(caught);
      log.warn('offering load failed', error.code);
      if (mountedRef.current) setStore({ kind: 'error', code: error.code });
    }
  }, [configured, uid]);

  useEffect(() => {
    const load = () => {
      loadOffering().catch((error: unknown) => log.warn('offering load rejected', toAppError(error).code));
    };
    load();
  }, [loadOffering]);

  const onRetry = useCallback(() => {
    setStore({ kind: 'loading' });
    void loadOffering();
  }, [loadOffering]);

  // "Now" for the usage day, refreshed whenever the screen comes into focus.
  const [now, setNow] = useState(() => new Date());
  useFocusEffect(useCallback(() => setNow(new Date()), []));

  // The 'activating' wait ends when the webhook-written entitlement (an external system,
  // subscribed here) grants the purchased tier; after a while the copy switches to "slow".
  useEffect(() => {
    if (phase.kind !== 'activating') return;
    const tier = phase.tier;
    const timer = setTimeout(() => {
      if (mountedRef.current) setSlow(true);
    }, ACTIVATION_SLOW_AFTER_MS);
    const unsubscribe = userRepository.subscribeEntitlement((entitlement) => {
      if (!isActivated(tier, effectivePlan(entitlement))) return;
      Toast.show({ type: 'success', text1: t('pricing:store.activated', { plan: t(`pricing:plans.${tier}.name`) }) });
      if (mountedRef.current) {
        setPhase(IDLE);
        setSlow(false);
      }
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [phase, t]);

  const onBuy = useCallback(
    async (card: PlanCard) => {
      if (phase.kind !== 'idle' || card.tier === 'free' || card.cycle === null) return;
      const tier = card.tier;
      setSlow(false);
      setPhase({ kind: 'purchasing', tier, cycle: card.cycle });
      try {
        const outcome = await purchasesService.purchase(tier, card.cycle);
        if (!mountedRef.current) return;
        if (outcome.status === 'cancelled') {
          setPhase(IDLE); // The user closed the Play sheet: silent (§errors 'cancelled').
          return;
        }
        setPhase({ kind: 'activating', tier });
      } catch (caught) {
        const error = toAppError(caught);
        log.warn('purchase failed', error.code);
        if (!mountedRef.current) return;
        Toast.show({ type: 'error', text1: t('pricing:store.purchaseFailed'), text2: t(errorMessageKey(error.code)) });
        setPhase(IDLE);
      }
    },
    [phase.kind, t],
  );

  const onRestore = useCallback(async () => {
    if (phase.kind !== 'idle') return;
    setSlow(false);
    setPhase({ kind: 'restoring' });
    try {
      const outcome = await purchasesService.restore();
      if (!mountedRef.current) return;
      if (outcome.status === 'nothing_to_restore') {
        Toast.show({ type: 'info', text1: t('pricing:store.nothingToRestore') });
        setPhase(IDLE);
      } else {
        Toast.show({ type: 'success', text1: t('pricing:store.restored') });
        setPhase({ kind: 'activating', tier: outcome.tier });
      }
    } catch (caught) {
      const error = toAppError(caught);
      log.warn('restore failed', error.code);
      if (!mountedRef.current) return;
      Toast.show({ type: 'error', text1: t('pricing:store.restoreFailed'), text2: t(errorMessageKey(error.code)) });
      setPhase(IDLE);
    }
  }, [phase.kind, t]);

  const onManage = useCallback(() => {
    Linking.openURL(purchasesService.manageUrl()).catch((caught: unknown) => {
      log.warn('could not open the Play subscriptions page', toAppError(caught).code);
      Toast.show({ type: 'error', text1: t(errorMessageKey('unsupported')) });
    });
  }, [t]);

  const cards = useMemo(() => buildPlanCards(cycle, isLoaded ? plan : null, store, language), [cycle, isLoaded, plan, store, language]);
  const summary = useMemo(() => summarizeUsage(usage, plan, now), [usage, plan, now]);
  const columnStyle = { width: layout.contentWidth, alignSelf: 'center' as const };
  const busy = phase.kind !== 'idle';

  const header = (
    <View style={columnStyle}>
      {!configured ? (
        <View style={[styles.banner, { backgroundColor: colors.warningContainer }]} testID="pricing-coming-soon-banner">
          <Ionicons name="time-outline" size={22} color={colors.onWarningContainer} accessibilityElementsHidden importantForAccessibility="no" />
          <View style={styles.bannerText}>
            <Text style={[styles.bannerTitle, { color: colors.onWarningContainer }]} accessibilityRole="header">
              {t('pricing:comingSoonTitle')}
            </Text>
            <Text style={[styles.body, { color: colors.onWarningContainer }]}>{t('pricing:comingSoonBody')}</Text>
          </View>
        </View>
      ) : (
        <StoreBanner store={store} phase={phase} slow={slow} colors={colors} t={t} onRetry={onRetry} />
      )}

      <UsageCard summary={summary} colors={colors} />

      <SegmentedButtons
        value={cycle}
        onValueChange={(value) => setCycle(value === 'yearly' ? 'yearly' : 'monthly')}
        buttons={CYCLES.map((value) => ({
          value,
          label: t(`pricing:cycle.${value}`),
          accessibilityLabel: t(`pricing:cycle.${value}A11y`),
          testID: `pricing-cycle-${value}`,
        }))}
        style={styles.cycles}
      />
    </View>
  );

  const renderItem: ListRenderItem<PlanCard> = ({ item }) => (
    <View style={columnStyle}>
      <PlanCardView
        card={item}
        colors={colors}
        language={language}
        configured={configured}
        busy={busy}
        purchasingThis={phase.kind === 'purchasing' && phase.tier === item.tier && phase.cycle === item.cycle}
        onBuy={(card) => void onBuy(card)}
        onManage={onManage}
      />
    </View>
  );

  const footer = (
    <View style={columnStyle}>
      {configured ? (
        <Pressable
          style={({ pressed }) => [styles.secondaryButton, { borderColor: colors.primary, opacity: busy || pressed ? 0.6 : 1 }]}
          onPress={() => void onRestore()}
          disabled={busy}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy, busy: phase.kind === 'restoring' }}
          accessibilityLabel={t('pricing:store.restoreA11y')}
          testID="pricing-restore"
        >
          {phase.kind === 'restoring' ? (
            <ActivityIndicator color={colors.primary} accessibilityElementsHidden importantForAccessibility="no" />
          ) : (
            <Text style={[styles.secondaryButtonText, { color: colors.primary }]}>{t('pricing:store.restore')}</Text>
          )}
        </Pressable>
      ) : null}
      <Text style={[styles.footer, { color: colors.textSecondary }]}>{t('pricing:footer')}</Text>
    </View>
  );

  return (
    <FlatList
      style={{ backgroundColor: colors.background }}
      data={cards}
      keyExtractor={(card) => card.id}
      renderItem={renderItem}
      ListHeaderComponent={header}
      ListFooterComponent={footer}
      contentContainerStyle={[styles.content, { paddingHorizontal: layout.gutter, paddingBottom: insets.bottom + 24 }]}
      testID="pricing-screen"
    />
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: 16,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  bannerText: {
    flex: 1,
    marginLeft: 12,
  },
  bannerTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    marginBottom: 12,
  },
  popularCard: {
    borderWidth: 2,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 4,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
  },
  usageNumbers: {
    fontSize: 20,
    fontWeight: '700',
    marginTop: 8,
  },
  progress: {
    height: 8,
    borderRadius: 4,
    marginVertical: 8,
  },
  caption: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  cycles: {
    marginVertical: 8,
  },
  planHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
  },
  planName: {
    fontSize: 20,
    fontWeight: '700',
    marginRight: 8,
  },
  badge: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    marginTop: 12,
  },
  price: {
    fontSize: 28,
    fontWeight: '800',
  },
  period: {
    fontSize: 15,
  },
  savings: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: 4,
  },
  trial: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: 4,
  },
  features: {
    marginTop: 12,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  featureText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
    marginLeft: 8,
  },
  actionButton: {
    minHeight: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  actionButtonText: {
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryButton: {
    minHeight: 48,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  retryButton: {
    minHeight: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    paddingHorizontal: 16,
    alignSelf: 'flex-start',
  },
  comingSoon: {
    minHeight: 48,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  comingSoonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  footer: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 12,
  },
});

export default PricingScreen;
