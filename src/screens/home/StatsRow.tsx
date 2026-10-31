/**
 * Dashboard numbers at a glance: meetings today, tasks due, meetings this week, as three compact
 * elevated tiles (big tabular value, small label, Feather icon in a tinted circle). Sits between
 * the greeting and the next-meeting card (docs/v1/DESIGN_SYSTEM.md §7, Group B). Values are null
 * while the data is loading or failed: the tile then shows a dash and no count for screen readers.
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

function Tile({ icon, label, value, tint, onTint, index, testID }: { icon: IconName; label: string; value: number | null; tint: string; onTint: string; index: number; testID: string }): ReactElement {
  const { colors } = useAppTheme();
  return (
    <Reveal index={index} style={styles.tileWrap}>
      <Card
        style={styles.tile}
        accessibilityLabel={value === null ? label : `${label}: ${value}`}
        testID={testID}
      >
        <View style={[styles.iconCircle, { backgroundColor: tint }]}>
          <Icon name={icon} size={18} color={onTint} />
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
  const { colors } = useAppTheme();
  return (
    <View style={styles.row} testID="dashboard-stats">
      <Tile icon="calendar" label={t('home:stats.today')} value={meetingsToday} tint={colors.primaryContainer} onTint={colors.onPrimaryContainer} index={0} testID="stat-today" />
      <Tile icon="tasks" label={t('home:stats.tasksDue')} value={tasksDue} tint={colors.tertiaryContainer} onTint={colors.onTertiaryContainer} index={1} testID="stat-tasks" />
      <Tile icon="activity" label={t('home:stats.thisWeek')} value={meetingsThisWeek} tint={colors.secondaryContainer} onTint={colors.onSecondaryContainer} index={2} testID="stat-week" />
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
    minHeight: 112,
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: radii.full,
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
