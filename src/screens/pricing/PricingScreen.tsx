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
import { Badge } from '../../components/ui';
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
import { componentMetrics, pressedDimOpacity, pressedOpacity, radii, spacing, typography } from '../../theme';
import { useFormatters } from '../shared/useFormatters';
import {
  ACTIVATION_SLOW_AFTER_MS,
  ACTIVATION_TIMEOUT_MS,
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
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.outlineVariant }]} testID="pricing-usage">
      <Text style={[styles.cardTitle, { color: colors.onSurface }]} accessibilityRole="header">
        {t('pricing:usage.title')}
      </Text>
      <Text style={[styles.body, { color: colors.onSurfaceVariant }]}>{t('pricing:usage.plan', { plan })}</Text>
      {summary.kind === 'today' ? (
        <>
          <Text style={[styles.usageNumbers, { color: colors.onSurface }]}>
            {t('pricing:usage.today', { used: summary.used, limit: summary.limit })}
          </Text>
          <ProgressBar
            progress={summary.fraction}
            color={summary.remaining === 0 ? colors.error : colors.primary}
            style={styles.progress}
            accessibilityLabel={t('pricing:usage.today', { used: summary.used, limit: summary.limit })}
          />
          <Text style={[styles.caption, { color: colors.onSurfaceVariant }]}>
            {summary.remaining === 0
              ? t('pricing:usage.exhausted', { time: fmt.dateTime(summary.resetsAt) })
              : t('pricing:usage.resets', { time: fmt.dateTime(summary.resetsAt) })}
          </Text>
          <Text style={[styles.caption, { color: colors.onSurfaceVariant }]}>{t('pricing:usage.thisDevice')}</Text>
        </>
      ) : (
        <>
          <Text style={[styles.usageNumbers, { color: colors.onSurface }]}>{t('pricing:usage.perDay', { count: summary.limit })}</Text>
          <Text style={[styles.caption, { color: colors.onSurfaceVariant }]}>{t('pricing:usage.unknownToday')}</Text>
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
        { backgroundColor: colors.surface, borderColor: card.popular ? colors.primary : colors.outlineVariant },
        card.popular && styles.popularCard,
      ]}
      testID={`pricing-plan-${card.id}`}
    >
      <View style={styles.planHeader}>
        <Text style={[styles.planName, { color: colors.onSurface }]} accessibilityRole="header">
          {name}
        </Text>
        {card.isCurrent ? (
          <Badge tone="primary" label={t('pricing:currentPlan')} />
        ) : card.popular ? (
          <Badge tone="primary" label={t('pricing:popular')} />
        ) : null}
      </View>
      <Text style={[styles.body, { color: colors.onSurfaceVariant }]}>{t(`pricing:plans.${card.tier}.description`)}</Text>

      <View style={styles.priceRow} accessible accessibilityLabel={period ? t('pricing:priceA11y', { price, period }) : price}>
        <Text style={[styles.price, { color: colors.onSurface }]}>{price}</Text>
        {period ? <Text style={[styles.period, { color: colors.onSurfaceVariant }]}>{` / ${period}`}</Text> : null}
      </View>
      {monthlyEquivalent !== null ? (
        <Text style={[styles.caption, { color: colors.onSurfaceVariant }]}>{t('pricing:monthlyEquivalent', { price: monthlyEquivalent })}</Text>
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
            <Ionicons
              name="checkmark-circle"
              size={componentMetrics.iconInline}
              color={colors.success}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
            <Text style={[styles.featureText, { color: colors.onSurface }]}>{feature}</Text>
          </View>
        ))}
      </View>

      {card.purchasable ? (
        <Pressable
          style={({ pressed }) => [styles.actionButton, { backgroundColor: colors.primary, opacity: pressed ? pressedDimOpacity : busy ? pressedOpacity : 1 }]}
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

      {card.switchCycleHint ? (
        <Text
          style={[styles.caption, { color: colors.onSurfaceVariant }]}
          accessibilityLabel={t('pricing:store.switchCycleHint')}
          testID={`pricing-switch-cycle-${card.id}`}
        >
          {t('pricing:store.switchCycleHint')}
        </Text>
      ) : null}

      {card.downgradeHint ? (
        <Text
          style={[styles.caption, { color: colors.onSurfaceVariant }]}
          accessibilityLabel={t('pricing:store.downgradeHint')}
          testID={`pricing-downgrade-${card.id}`}
        >
          {t('pricing:store.downgradeHint')}
        </Text>
      ) : null}

      {configured && card.isCurrent && card.tier !== 'free' ? (
        <Pressable
          style={({ pressed }) => [styles.secondaryButton, { borderColor: colors.outline, opacity: pressed ? pressedDimOpacity : 1 }]}
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
          style={[styles.comingSoon, { backgroundColor: colors.surfaceDisabled }]}
          accessible
          accessibilityRole="button"
          accessibilityState={{ disabled: true }}
          accessibilityLabel={t('pricing:comingSoonA11y', { plan: name })}
          testID={`pricing-coming-soon-${card.id}`}
        >
          <Text style={[styles.comingSoonText, { color: colors.disabledText }]}>{t('pricing:comingSoon')}</Text>
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
      <View style={[styles.banner, { backgroundColor: colors.surface, borderColor: colors.outlineVariant, borderWidth: 1 }]} testID="pricing-store-loading">
        <ActivityIndicator color={colors.primary} accessibilityElementsHidden importantForAccessibility="no" />
        <View style={styles.bannerText}>
          <Text style={[styles.body, { color: colors.onSurfaceVariant }]}>{t('pricing:store.loading')}</Text>
        </View>
      </View>
    );
  }
  if (store.kind === 'error') {
    return (
      <View style={[styles.banner, { backgroundColor: colors.errorContainer }]} testID="pricing-store-error">
        <Ionicons name="cloud-offline-outline" size={componentMetrics.iconInline} color={colors.onErrorContainer} accessibilityElementsHidden importantForAccessibility="no" />
        <View style={styles.bannerText}>
          <Text style={[styles.bannerTitle, { color: colors.onErrorContainer }]} accessibilityRole="header">
            {t('pricing:store.loadErrorTitle')}
          </Text>
          <Text style={[styles.body, { color: colors.onErrorContainer }]}>{t('pricing:store.loadError')}</Text>
          <Pressable
            style={({ pressed }) => [styles.retryButton, { borderColor: colors.onErrorContainer, opacity: pressed ? pressedDimOpacity : 1 }]}
            onPress={onRetry}
            accessibilityRole="button"
            accessibilityLabel={t('pricing:store.retryA11y')}
            testID="pricing-store-retry"
          >
            <Text style={[styles.secondaryButtonText, { color: colors.onErrorContainer }]}>{t('pricing:store.retry')}</Text>
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
  /** The PURCHASED Play product (CustomerInfo), when the store can tell; null = unknown. */
  const [activeProductId, setActiveProductId] = useState<string | null>(null);
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
      // Which product is actually purchased (marks the true cycle's card; never throws).
      const productId = await purchasesService.getActiveProductId();
      if (mountedRef.current) {
        setActiveProductId(productId);
        setStore({ kind: 'ready', offering });
      }
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
  // subscribed here) grants the purchased tier; after a while the copy switches to "slow",
  // and after ACTIVATION_TIMEOUT_MS the screen honestly returns to idle: the entitlement may
  // never flip here (a same-user restore emits no webhook event; functions not deployed), and
  // staying in 'activating' would keep Retry/Restore disabled forever. The plan still updates
  // automatically whenever the entitlement write lands.
  useEffect(() => {
    if (phase.kind !== 'activating') return;
    const tier = phase.tier;
    const timer = setTimeout(() => {
      if (mountedRef.current) setSlow(true);
    }, ACTIVATION_SLOW_AFTER_MS);
    const timeout = setTimeout(() => {
      if (!mountedRef.current) return;
      Toast.show({ type: 'info', text1: t('pricing:store.activationTimeoutTitle'), text2: t('pricing:store.activationTimeout') });
      setPhase(IDLE);
      setSlow(false);
    }, ACTIVATION_TIMEOUT_MS);
    const unsubscribe = userRepository.subscribeEntitlement((entitlement) => {
      if (!isActivated(tier, effectivePlan(entitlement))) return;
      Toast.show({ type: 'success', text1: t('pricing:store.activated', { plan: t(`pricing:plans.${tier}.name`) }) });
      if (mountedRef.current) {
        setPhase(IDLE);
        setSlow(false);
      }
      // The purchased product changed: refresh which card carries the "Current plan" badge.
      purchasesService
        .getActiveProductId()
        .then((productId) => {
          if (mountedRef.current) setActiveProductId(productId);
        })
        .catch(() => undefined);
    });
    return () => {
      clearTimeout(timer);
      clearTimeout(timeout);
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
    // Deep link to the purchased product when known; the generic subscriptions list otherwise.
    Linking.openURL(purchasesService.manageUrl(activeProductId ?? undefined)).catch((caught: unknown) => {
      log.warn('could not open the Play subscriptions page', toAppError(caught).code);
      Toast.show({ type: 'error', text1: t(errorMessageKey('unsupported')) });
    });
  }, [activeProductId, t]);

  const cards = useMemo(
    () => buildPlanCards(cycle, isLoaded ? plan : null, store, language, activeProductId),
    [cycle, isLoaded, plan, store, language, activeProductId],
  );
  const summary = useMemo(() => summarizeUsage(usage, plan, now), [usage, plan, now]);
  const columnStyle = { width: layout.contentWidth, alignSelf: 'center' as const };
  const busy = phase.kind !== 'idle';

  const header = (
    <View style={columnStyle}>
      {!configured && plan !== 'free' ? (
        // An admin-granted paid plan with purchases still closed: confirm the plan instead of the
        // Free-oriented "coming soon" warning (which would wrongly imply the user is on Free).
        <View style={[styles.banner, { backgroundColor: colors.successContainer }]} testID="pricing-granted-banner">
          <Ionicons name="checkmark-circle-outline" size={componentMetrics.iconInline} color={colors.onSuccessContainer} accessibilityElementsHidden importantForAccessibility="no" />
          <View style={styles.bannerText}>
            <Text style={[styles.bannerTitle, { color: colors.onSuccessContainer }]} accessibilityRole="header">
              {t('pricing:grantedTitle', { plan: t(`pricing:plans.${plan}.name`) })}
            </Text>
            <Text style={[styles.body, { color: colors.onSuccessContainer }]}>{t('pricing:grantedBody')}</Text>
          </View>
        </View>
      ) : !configured ? (
        <View style={[styles.banner, { backgroundColor: colors.warningContainer }]} testID="pricing-coming-soon-banner">
          <Ionicons name="time-outline" size={componentMetrics.iconInline} color={colors.onWarningContainer} accessibilityElementsHidden importantForAccessibility="no" />
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
          style={({ pressed }) => [styles.secondaryButton, { borderColor: colors.outline, opacity: pressed ? pressedDimOpacity : busy ? pressedOpacity : 1 }]}
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
      <Text style={[styles.footer, { color: colors.onSurfaceVariant }]}>{t('pricing:footer')}</Text>
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
    paddingTop: spacing.lg,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: radii.md,
    padding: componentMetrics.cardPadding,
    marginBottom: componentMetrics.cardGap,
  },
  bannerText: {
    flex: 1,
    marginLeft: spacing.md,
  },
  bannerTitle: {
    ...typography.labelL,
    marginBottom: spacing.xs,
  },
  card: {
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: componentMetrics.cardPadding,
    marginBottom: componentMetrics.cardGap,
  },
  popularCard: {
    borderWidth: 2,
  },
  cardTitle: {
    ...typography.titleM,
    marginBottom: spacing.xs,
  },
  body: {
    ...typography.bodyM,
  },
  usageNumbers: {
    ...typography.headlineM,
    fontVariant: ['tabular-nums'],
    marginTop: spacing.sm,
  },
  progress: {
    height: spacing.sm,
    borderRadius: radii.full,
    marginVertical: spacing.sm,
  },
  caption: {
    ...typography.bodyS,
    marginTop: spacing.xs,
  },
  cycles: {
    marginVertical: spacing.sm,
  },
  planHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  planName: {
    ...typography.titleM,
    marginRight: spacing.sm,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    marginTop: spacing.md,
  },
  price: {
    ...typography.headlineM,
    fontVariant: ['tabular-nums'],
  },
  period: {
    ...typography.bodyS,
  },
  savings: {
    ...typography.labelL,
    marginTop: spacing.xs,
  },
  trial: {
    ...typography.labelL,
    marginTop: spacing.xs,
  },
  features: {
    marginTop: spacing.md,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  featureText: {
    ...typography.bodyM,
    flex: 1,
    marginLeft: spacing.sm,
  },
  actionButton: {
    minHeight: componentMetrics.buttonHeight,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  actionButtonText: {
    ...typography.labelL,
  },
  secondaryButton: {
    minHeight: componentMetrics.buttonHeight,
    borderRadius: radii.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  secondaryButtonText: {
    ...typography.labelL,
  },
  retryButton: {
    minHeight: componentMetrics.touchTargetMin,
    borderRadius: radii.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    alignSelf: 'flex-start',
  },
  comingSoon: {
    minHeight: componentMetrics.buttonHeight,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  comingSoonText: {
    ...typography.labelL,
  },
  footer: {
    ...typography.bodyS,
    textAlign: 'center',
    marginTop: spacing.md,
  },
});

export default PricingScreen;
