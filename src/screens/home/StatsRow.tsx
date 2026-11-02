/**
 * Dashboard numbers at a glance: meetings today, tasks due, meetings this week, as three compact
 * tiles (accent icon top-left, big tabular number, small label) under the "Overview" header, the
 * way the reference dashboards show their status counts. Values are null while the data is
 * loading or failed: the tile then shows a dash and no count for screen readers.
 */
import type { ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Card, Icon, Reveal, type IconName } from '../../components/ui';
import { useT } from '../../i18n';
import { radii, spacing, typography, useAppTheme, withAlpha } from '../../theme';

export interface StatsRowProps {
  meetingsToday: number | null;
  tasksDue: number | null;
  meetingsThisWeek: number | null;
}

function Tile({ icon, label, value, index, testID }: { icon: IconName; label: string; value: number | null; index: number; testID: string }): ReactElement {
  const { colors, isDark } = useAppTheme();
  return (
    <Reveal index={index} style={styles.tileWrap}>
      <Card style={styles.tile} accessibilityLabel={value === null ? label : `${label}: ${value}`} testID={testID}>
        <View style={[styles.iconBox, { backgroundColor: withAlpha(colors.primary, isDark ? 0.16 : 0.12) }]}>
          <Icon name={icon} size={18} color={colors.primary} />
        </View>
        <Text style={[styles.value, { color: colors.onSurface }]} maxFontSizeMultiplier={1.3} testID={`${testID}-value`}>
          {value === null ? '-' : String(value)}
        </Text>
        <Text style={[styles.label, { color: colors.onSurfaceVariant }]} numberOfLines={2} maxFontSizeMultiplier={1.3}>
          {label}
        </Text>
      </Card>
    </Reveal>
  );
}

export function StatsRow({ meetingsToday, tasksDue, meetingsThisWeek }: StatsRowProps): ReactElement {
  const t = useT();
  return (
    <View style={styles.row} testID="dashboard-stats">
      <Tile icon="calendar" label={t('home:stats.today')} value={meetingsToday} index={0} testID="stat-today" />
      <Tile icon="tasks" label={t('home:stats.tasksDue')} value={tasksDue} index={1} testID="stat-tasks" />
      <Tile icon="activity" label={t('home:stats.thisWeek')} value={meetingsThisWeek} index={2} testID="stat-week" />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  tileWrap: {
    flex: 1,
  },
  tile: {
    padding: spacing.md,
    minHeight: 104,
  },
  iconBox: {
    width: 32,
    height: 32,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: {
    ...typography.headlineM,
    marginTop: spacing.sm,
    fontVariant: ['tabular-nums'],
  },
  label: {
    ...typography.labelM,
    marginTop: 2,
  },
});
