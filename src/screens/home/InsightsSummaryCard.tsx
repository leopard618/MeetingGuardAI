/**
 * Dashboard insights: honest numbers computed on the device (meetings today / this week, meeting
 * time, and what deserves a look in the rest of the week), plus "Ask the assistant" (opens the
 * chat with a prefilled question; nothing is sent until the user taps send) and a link to the
 * full insights screen. Neutral Card under a SectionHeader; values titleM tabular-nums.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps, ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { Card, MGButton, SectionHeader } from '../../components/ui';
import { useT } from '../../i18n';
import { spacing, useAppTheme } from '../../theme';
import type { DashboardSummary } from '../insights/meetingInsights';
import { useFormatters } from '../shared/useFormatters';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export interface InsightsSummaryCardProps {
  summary: DashboardSummary;
  onAskAssistant(): void;
  onSeeAll(): void;
}

function Stat({ label, count, minutes }: { label: string; count: number; minutes: number }): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const fmt = useFormatters();
  return (
    <View style={styles.stat} accessible accessibilityLabel={`${label}: ${t('home:insights.meetings', { count })}, ${t('home:insights.time', { duration: fmt.duration(minutes) })}`}>
      <Text variant="labelMedium" style={{ color: colors.onSurfaceVariant }}>
        {label}
      </Text>
      <Text variant="titleMedium" style={styles.statValue}>
        {t('home:insights.meetings', { count })}
      </Text>
      <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
        {t('home:insights.time', { duration: fmt.duration(minutes) })}
      </Text>
    </View>
  );
}

function Issue({ icon, text, color, testID }: { icon: IconName; text: string; color: string; testID: string }): ReactElement {
  return (
    <View style={styles.issue} testID={testID}>
      <MaterialCommunityIcons name={icon} size={18} color={color} />
      <Text variant="bodyMedium" style={styles.issueText}>
        {text}
      </Text>
    </View>
  );
}

export function InsightsSummaryCard({ summary, onAskAssistant, onSeeAll }: InsightsSummaryCardProps): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const { upcoming } = summary;
  const hasIssues = upcoming.overlaps + upcoming.backToBack + upcoming.missingPlace + upcoming.withTips > 0;

  return (
    <View>
      <SectionHeader title={t('home:insights.title')} />
      <Card testID="insights-summary-card">
        <Text variant="bodySmall" style={[styles.subtitle, { color: colors.onSurfaceVariant }]}>
          {t('home:insights.subtitle')}
        </Text>
        <View style={styles.stats}>
          <Stat label={t('home:insights.today')} count={summary.today.count} minutes={summary.today.minutes} />
          <Stat label={t('home:insights.thisWeek')} count={summary.week.count} minutes={summary.week.minutes} />
        </View>

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
  subtitle: {
    marginBottom: spacing.sm,
  },
  stats: {
    flexDirection: 'row',
  },
  stat: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  statValue: {
    fontVariant: ['tabular-nums'],
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
