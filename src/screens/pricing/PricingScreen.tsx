/**
 * Plans (owner: shell). Honest catalog while billing is off:
 * - "Subscriptions coming soon" banner; paid cards show a disabled "Coming soon" state; there are
 *   no purchase flows and no external payment links.
 * - Prices from src/api/billingService.ts (Free, Pro $7.99, Premium $14.99, 25% off yearly),
 *   daily assistant quotas as enforced by the server (PLAN_DAILY_AI_LIMITS).
 * - The current plan comes from the server-owned entitlement (useEntitlement); today's assistant
 *   usage from the last assistant answer on this device (useAssistant().usage), when it is for
 *   the current UTC day.
 */
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { FlatList, StyleSheet, Text, View, type ListRenderItem } from 'react-native';
import { ProgressBar, SegmentedButtons } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { BillingCycle } from '../../api/billingService';
import { useTheme, type AppColors } from '../../contexts/ThemeContext';
import { useResponsive } from '../../hooks/useResponsive';
import { useLanguage, useT } from '../../i18n';
import { useAssistant } from '../../services/ai';
import { useEntitlement } from '../../services/data';
import { useFormatters } from '../shared/useFormatters';
import { buildPlanCards, formatPriceUsd, summarizeUsage, type PlanCard, type UsageSummary } from './pricingModel';

const CYCLES: readonly BillingCycle[] = ['monthly', 'yearly'];

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

function PlanCardView({ card, colors, language }: { card: PlanCard; colors: AppColors; language: 'en' | 'es' }): ReactElement {
  const t = useT();
  const name = t(`pricing:plans.${card.tier}.name`);
  const price = formatPriceUsd(card.priceUsd, language);
  const period = card.cycle === 'yearly' ? t('pricing:perYear') : card.cycle === 'monthly' ? t('pricing:perMonth') : null;
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
      {card.monthlyEquivalentUsd !== null ? (
        <Text style={[styles.caption, { color: colors.textSecondary }]}>
          {t('pricing:monthlyEquivalent', { price: formatPriceUsd(card.monthlyEquivalentUsd, language) })}
        </Text>
      ) : null}
      {card.discountPercent !== null ? (
        <Text style={[styles.savings, { color: colors.success }]}>{t('pricing:save', { percent: card.discountPercent })}</Text>
      ) : null}

      <View style={styles.features}>
        {features.map((feature) => (
          <View key={feature} style={styles.featureRow}>
            <Ionicons name="checkmark-circle" size={20} color={colors.success} accessibilityElementsHidden importantForAccessibility="no" />
            <Text style={[styles.featureText, { color: colors.text }]}>{feature}</Text>
          </View>
        ))}
      </View>

      {card.tier !== 'free' && !card.purchasable && !card.isCurrent ? (
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

export function PricingScreen(): ReactElement {
  const t = useT();
  const { colors } = useTheme();
  const { language } = useLanguage();
  const insets = useSafeAreaInsets();
  const layout = useResponsive();
  const { plan, isLoaded } = useEntitlement();
  const { usage } = useAssistant();
  const [cycle, setCycle] = useState<BillingCycle>('monthly');

  // "Now" for the usage day, refreshed whenever the screen comes into focus.
  const [now, setNow] = useState(() => new Date());
  useFocusEffect(useCallback(() => setNow(new Date()), []));

  const cards = useMemo(() => buildPlanCards(cycle, isLoaded ? plan : null), [cycle, isLoaded, plan]);
  const summary = useMemo(() => summarizeUsage(usage, plan, now), [usage, plan, now]);
  const columnStyle = { width: layout.contentWidth, alignSelf: 'center' as const };

  const header = (
    <View style={columnStyle}>
      <View style={[styles.banner, { backgroundColor: colors.warningContainer }]} testID="pricing-coming-soon-banner">
        <Ionicons name="time-outline" size={22} color={colors.onWarningContainer} accessibilityElementsHidden importantForAccessibility="no" />
        <View style={styles.bannerText}>
          <Text style={[styles.bannerTitle, { color: colors.onWarningContainer }]} accessibilityRole="header">
            {t('pricing:comingSoonTitle')}
          </Text>
          <Text style={[styles.body, { color: colors.onWarningContainer }]}>{t('pricing:comingSoonBody')}</Text>
        </View>
      </View>

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
      <PlanCardView card={item} colors={colors} language={language} />
    </View>
  );

  return (
    <FlatList
      style={{ backgroundColor: colors.background }}
      data={cards}
      keyExtractor={(card) => card.id}
      renderItem={renderItem}
      ListHeaderComponent={header}
      ListFooterComponent={
        <Text style={[styles.footer, columnStyle, { color: colors.textSecondary }]}>{t('pricing:footer')}</Text>
      }
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
    marginTop: 4,
  },
});

export default PricingScreen;
