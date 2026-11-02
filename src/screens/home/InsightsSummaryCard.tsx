/**
 * "Weekly summary" card (the client's mockup) under the "Your week" header. Left: the seven-day
 * bar row of meeting time (today in primary, weekday initials in the UI language). Right, behind
 * a divider: two stat rows, meetings and meeting time this week, each with "vs. <last week>" and a
 * delta pill (green when the load went down, red when it went up, none without a last week).
 * Below, compactly, what deserves a look in the rest of the week (overlaps, back-to-back, missing
 * links, preparation tips; each line with an icon and text) and a "See all insights" link. Honest
 * numbers computed on the device.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps, ReactElement } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { Card, Icon, MiniBars } from '../../components/ui';
import { useT } from '../../i18n';
import { componentMetrics, pressedDimOpacity, radii, spacing, typography, useAppTheme } from '../../theme';
import type { DashboardSummary, DayLoad, LoadSummary } from '../insights/meetingInsights';
import { useFormatters } from '../shared/useFormatters';
import { weekBars, weekDelta, weekdayInitial } from './homeModel';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export interface InsightsSummaryCardProps {
  summary: DashboardSummary;
  /** The previous calendar week, for the comparison. */
  lastWeek: LoadSummary;
  /** The current week, one entry per date (computePeriodInsights(..., 'week')). */
  days: readonly DayLoad[];
  /** Today's local date ("YYYY-MM-DD"), highlighted in the chart. */
  todayDate: string;
  /** BCP 47 tag for the weekday labels ("en-US", "es-ES"). */
  locale: string;
  onSeeAll(): void;
}

function DeltaPill({ delta, testID }: { delta: number | null; testID: string }): ReactElement | null {
  const { colors } = useAppTheme();
  if (delta === null) return null;
  const down = delta <= 0;
  const bg = down ? colors.successContainer : colors.errorContainer;
  const fg = down ? colors.onSuccessContainer : colors.onErrorContainer;
  return (
    <View style={[styles.pill, { backgroundColor: bg }]} testID={testID}>
      <Icon name={down ? 'chevronDown' : 'chevronUp'} size={12} color={fg} />
      <Text style={[styles.pillText, { color: fg }]}>{`${delta > 0 ? '+' : ''}${delta}%`}</Text>
    </View>
  );
}

function StatRow({ icon, value, compare, delta, testID }: { icon: 'calendar' | 'clock'; value: string; compare: string; delta: number | null; testID: string }): ReactElement {
  const { colors } = useAppTheme();
  return (
    <View style={styles.statRow} accessible accessibilityLabel={`${value}, ${compare}${delta === null ? '' : `, ${delta > 0 ? '+' : ''}${delta}%`}`}>
      <Icon name={icon} size={componentMetrics.iconInline} color={colors.onSurfaceVariant} />
      <View style={styles.statTexts}>
        <Text variant="titleMedium" style={styles.statValue} numberOfLines={1} testID={testID}>
          {value}
        </Text>
        <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }} numberOfLines={1}>
          {compare}
        </Text>
      </View>
      <DeltaPill delta={delta} testID={`${testID}-delta`} />
    </View>
  );
}

function Issue({ icon, text, color, testID }: { icon: IconName; text: string; color: string; testID: string }): ReactElement {
  return (
    <View style={styles.issue} testID={testID}>
      <MaterialCommunityIcons name={icon} size={componentMetrics.iconMeta} color={color} />
      <Text variant="bodySmall" style={styles.issueText}>
        {text}
      </Text>
    </View>
  );
}

export function InsightsSummaryCard({ summary, lastWeek, days, todayDate, locale, onSeeAll }: InsightsSummaryCardProps): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const fmt = useFormatters();
  const { upcoming, week } = summary;
  const hasIssues = upcoming.overlaps + upcoming.backToBack + upcoming.missingPlace + upcoming.withTips > 0;
  const bars = weekBars(days, todayDate, locale);
  const chartA11y = `${t('home:insights.chartA11y')}. ${days
    .map((day) => `${weekdayInitial(day.date ?? day.key, locale)}: ${t('home:insights.meetings', { count: day.count })}`)
    .join(', ')}`;

  return (
    <Card testID="insights-summary-card">
      <View style={styles.titleRow}>
        <Icon name="insights" size={componentMetrics.iconInline} color={colors.primary} />
        <Text variant="titleMedium">{t('home:insights.weeklySummary')}</Text>
      </View>
      <View style={styles.columns}>
        <View style={styles.chartColumn}>
          {bars.length > 0 ? <MiniBars bars={bars} height={72} accessibilityLabel={chartA11y} testID="week-chart" /> : null}
        </View>
        <View style={[styles.divider, { backgroundColor: colors.outlineVariant }]} />
        <View style={styles.stats}>
          <StatRow
            icon="calendar"
            value={t('home:insights.meetings', { count: week.count })}
            compare={t('home:insights.vsLastWeek', { value: t('home:insights.meetings', { count: lastWeek.count }) })}
            delta={weekDelta(week.count, lastWeek.count)}
            testID="week-meetings"
          />
          <View style={[styles.statSeparator, { backgroundColor: colors.outlineVariant }]} />
          <StatRow
            icon="clock"
            value={t('home:insights.total', { duration: fmt.duration(week.minutes) })}
            compare={t('home:insights.vsLastWeek', { value: fmt.duration(lastWeek.minutes) })}
            delta={weekDelta(week.minutes, lastWeek.minutes)}
            testID="week-minutes"
          />
        </View>
      </View>

      <View style={styles.issues}>
        {upcoming.overlaps > 0 ? (
          <Issue icon="alert-circle-outline" color={colors.error} text={t('home:insights.overlaps', { count: upcoming.overlaps })} testID="insight-overlaps" />
        ) : null}
        {upcoming.backToBack > 0 ? (
          <Issue icon="timer-sand" color={colors.tertiary} text={t('home:insights.backToBack', { count: upcoming.backToBack })} testID="insight-back-to-back" />
        ) : null}
        {upcoming.missingPlace > 0 ? (
          <Issue
            icon="map-marker-question-outline"
            color={colors.onSurfaceVariant}
            text={t('home:insights.missingPlace', { count: upcoming.missingPlace })}
            testID="insight-missing-place"
          />
        ) : null}
        {upcoming.withTips > 0 ? (
          <Issue icon="lightbulb-on-outline" color={colors.primary} text={t('home:insights.withTips', { count: upcoming.withTips })} testID="insight-tips" />
        ) : null}
        {!hasIssues ? (
          <Issue icon="check-circle-outline" color={colors.success} text={t('home:insights.allClear')} testID="insight-all-clear" />
        ) : null}
      </View>
      <Pressable
        onPress={onSeeAll}
        hitSlop={8}
        style={({ pressed }) => [styles.seeAll, pressed && styles.pressed]}
        accessibilityRole="button"
        testID="insights-see-all"
      >
        <Text style={[styles.seeAllText, { color: colors.primary }]}>{t('home:insights.seeAll')}</Text>
        <Icon name="forward" size={componentMetrics.iconMeta} color={colors.primary} />
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  columns: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginTop: spacing.md,
  },
  chartColumn: {
    flex: 1,
    paddingRight: spacing.md,
    justifyContent: 'flex-end',
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
  },
  stats: {
    flex: 1,
    paddingLeft: spacing.md,
    justifyContent: 'center',
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  statTexts: {
    flex: 1,
  },
  statValue: {
    fontVariant: ['tabular-nums'],
  },
  statSeparator: {
    height: StyleSheet.hairlineWidth,
    marginVertical: spacing.xs,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  pillText: {
    ...typography.labelS,
    fontVariant: ['tabular-nums'],
  },
  issues: {
    marginTop: spacing.md,
  },
  issue: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 2,
  },
  issueText: {
    marginLeft: spacing.sm,
    flex: 1,
  },
  seeAll: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: spacing.xs,
    marginTop: spacing.sm,
    minHeight: 28,
  },
  seeAllText: {
    ...typography.labelL,
  },
  pressed: {
    opacity: pressedDimOpacity,
  },
});
