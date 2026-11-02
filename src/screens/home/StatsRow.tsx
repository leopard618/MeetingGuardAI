/**
 * Dashboard numbers at a glance: meetings today, tasks due, meetings this week, as ONE compact
 * glass strip over the aurora (three segments: tinted icon circle, tabular value, small label,
 * hairline separators) instead of three tall tiles. Sits between the greeting and the next-meeting
 * card (docs/v1/DESIGN_SYSTEM.md §7, Group B). Values are null while the data is loading or
 * failed: the segment then shows a dash and no count for screen readers.
 */
import type { ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Card, Icon, Reveal, type IconName } from '../../components/ui';
import { useT } from '../../i18n';
import { radii, spacing, typography, useAppTheme } from '../../theme';

export interface StatsRowProps {
  meetingsToday: number | null;
  tasksDue: number | null;
  meetingsThisWeek: number | null;
}

function Segment({ icon, label, value, tint, onTint, testID }: { icon: IconName; label: string; value: number | null; tint: string; onTint: string; testID: string }): ReactElement {
  const { colors } = useAppTheme();
  return (
    <View style={styles.segment} accessible accessibilityLabel={value === null ? label : `${label}: ${value}`} testID={testID}>
      <View style={[styles.iconCircle, { backgroundColor: tint }]}>
        <Icon name={icon} size={16} color={onTint} />
      </View>
      <View style={styles.texts}>
        <Text style={[styles.value, { color: colors.onSurface }]} maxFontSizeMultiplier={1.3} testID={`${testID}-value`}>
          {value === null ? '-' : String(value)}
        </Text>
        <Text style={[styles.label, { color: colors.onSurfaceVariant }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
          {label}
        </Text>
      </View>
    </View>
  );
}

export function StatsRow({ meetingsToday, tasksDue, meetingsThisWeek }: StatsRowProps): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const divider = { backgroundColor: colors.outlineVariant };
  return (
    <Reveal index={1}>
      <Card variant="glass" style={styles.strip} testID="dashboard-stats">
        <Segment icon="calendar" label={t('home:stats.today')} value={meetingsToday} tint={colors.primaryContainer} onTint={colors.onPrimaryContainer} testID="stat-today" />
        <View style={[styles.divider, divider]} />
        <Segment icon="tasks" label={t('home:stats.tasksDue')} value={tasksDue} tint={colors.tertiaryContainer} onTint={colors.onTertiaryContainer} testID="stat-tasks" />
        <View style={[styles.divider, divider]} />
        <Segment icon="activity" label={t('home:stats.thisWeek')} value={meetingsThisWeek} tint={colors.secondaryContainer} onTint={colors.onSecondaryContainer} testID="stat-week" />
      </Card>
    </Reveal>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.lg,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xs,
    gap: spacing.sm,
  },
  iconCircle: {
    width: 30,
    height: 30,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  texts: {
    flex: 1,
  },
  value: {
    ...typography.titleL,
    fontVariant: ['tabular-nums'],
  },
  label: {
    ...typography.labelS,
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    height: 28,
  },
});
