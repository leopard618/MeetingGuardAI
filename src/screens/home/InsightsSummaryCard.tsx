/**
 * Dashboard week card ("Your week"): honest numbers computed on the device. The week's meeting
 * count and time in large type, a mini bar chart of meeting time per day (today on the primary
 * gradient, labels in the UI language), what deserves a look in the rest of the week (overlaps,
 * back-to-back, missing links, preparation tips; each line with an icon and text), "Ask the
 * assistant" (opens the chat with a prefilled question; nothing is sent until the user taps send)
 * and a link to the full insights screen. Neutral Card under a SectionHeader.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps, ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { Card, MGButton, MiniBars, SectionHeader } from '../../components/ui';
import { useT } from '../../i18n';
import { componentMetrics, spacing, useAppTheme } from '../../theme';
import type { DashboardSummary, DayLoad } from '../insights/meetingInsights';
import { useFormatters } from '../shared/useFormatters';
import { weekBars, weekdayInitial } from './homeModel';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export interface InsightsSummaryCardProps {
  summary: DashboardSummary;
  /** The current week, one entry per date (computePeriodInsights(..., 'week')). */
  days: readonly DayLoad[];
  /** Today's local date ("YYYY-MM-DD"), highlighted in the chart. */
  todayDate: string;
  /** BCP 47 tag for the weekday labels ("en-US", "es-ES"). */
  locale: string;
  onAskAssistant(): void;
  onSeeAll(): void;
}

function Issue({ icon, text, color, testID }: { icon: IconName; text: string; color: string; testID: string }): ReactElement {
  return (
    <View style={styles.issue} testID={testID}>
      <MaterialCommunityIcons name={icon} size={componentMetrics.iconInline} color={color} />
      <Text variant="bodyMedium" style={styles.issueText}>
        {text}
      </Text>
    </View>
  );
}

export function InsightsSummaryCard({ summary, days, todayDate, locale, onAskAssistant, onSeeAll }: InsightsSummaryCardProps): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const fmt = useFormatters();
  const { upcoming, week, today } = summary;
  const hasIssues = upcoming.overlaps + upcoming.backToBack + upcoming.missingPlace + upcoming.withTips > 0;
  const bars = weekBars(days, todayDate, locale);
  const chartA11y = `${t('home:insights.chartA11y')}. ${days
    .map((day) => `${weekdayInitial(day.date ?? day.key, locale)}: ${t('home:insights.meetings', { count: day.count })}`)
    .join(', ')}`;

  return (
    <View>
      <SectionHeader title={t('home:insights.title')} />
      <Card testID="insights-summary-card">
        <View style={styles.headline}>
          <View style={styles.flex} accessible accessibilityLabel={`${t('home:insights.thisWeek')}: ${t('home:insights.meetings', { count: week.count })}, ${t('home:insights.time', { duration: fmt.duration(week.minutes) })}`}>
            <Text variant="headlineSmall" style={styles.value}>
              {t('home:insights.meetings', { count: week.count })}
            </Text>
            <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
              {t('home:insights.time', { duration: fmt.duration(week.minutes) })}
            </Text>
          </View>
          <View style={styles.todayStat} accessible accessibilityLabel={`${t('home:insights.today')}: ${t('home:insights.meetings', { count: today.count })}`}>
            <Text variant="labelMedium" style={{ color: colors.onSurfaceVariant }}>
              {t('home:insights.today')}
            </Text>
            <Text variant="titleMedium" style={styles.value}>
              {t('home:insights.meetings', { count: today.count })}
            </Text>
          </View>
        </View>
        {bars.length > 0 ? <MiniBars bars={bars} height={64} accessibilityLabel={chartA11y} style={styles.chart} testID="week-chart" /> : null}

        <Text variant="titleSmall" style={[styles.heading, { color: colors.onSurfaceVariant }]}>
          {t('home:insights.restOfWeek')}
        </Text>
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
          <Issue icon="check-circle-outline" color={colors.primary} text={t('home:insights.allClear')} testID="insight-all-clear" />
        ) : null}

        <View style={styles.actions}>
          <MGButton variant="tonal" size="sm" icon="robot-outline" onPress={onAskAssistant} style={styles.action} testID="insights-ask-assistant">
            {t('home:insights.ask')}
          </MGButton>
          <MGButton variant="ghost" size="sm" icon="chart-bar" onPress={onSeeAll} style={styles.action} testID="insights-see-all">
            {t('home:insights.seeAll')}
          </MGButton>
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  headline: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.md,
  },
  todayStat: {
    alignItems: 'flex-end',
  },
  value: {
    fontVariant: ['tabular-nums'],
  },
  chart: {
    marginTop: spacing.lg,
  },
  heading: {
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  issue: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  issueText: {
    marginLeft: spacing.sm,
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.md,
  },
  action: {
    marginRight: spacing.sm,
    marginTop: spacing.xs,
  },
});
