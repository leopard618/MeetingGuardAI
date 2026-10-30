/**
 * Dashboard hero: the greeting on the `hero` gradient with today's numbers (meetings today, open
 * tasks due) as translucent chips. The one banner of the screen (docs/v1/DESIGN_SYSTEM.md §7,
 * Group B); the next-meeting card below it stays a neutral elevated card with a gradient accent.
 * Text is white on both stops (checked >= 4.5:1), chips white@18% with white text.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps, ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { GradientSurface, Reveal } from '../../components/ui';
import { useT } from '../../i18n';
import { componentMetrics, radii, spacing, typography, useAppTheme, withAlpha } from '../../theme';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export interface HeroCardProps {
  /** "Good morning, Ana" (already translated). */
  greeting: string;
  /** Today's date, already formatted and capitalized. */
  dateLabel: string;
  /** null while the meetings are loading or failed to load (no chip). */
  meetingsToday: number | null;
  /** null while tasks are unknown (no chip). */
  tasksDue: number | null;
  testID?: string;
}

function Chip({ icon, label, color, testID }: { icon: IconName; label: string; color: string; testID: string }): ReactElement {
  return (
    <View style={[styles.chip, { backgroundColor: withAlpha(color, 0.18) }]} testID={testID}>
      <MaterialCommunityIcons name={icon} size={componentMetrics.iconMeta} color={color} />
      <Text style={[styles.chipText, { color }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
        {label}
      </Text>
    </View>
  );
}

export function HeroCard({ greeting, dateLabel, meetingsToday, tasksDue, testID = 'dashboard-hero' }: HeroCardProps): ReactElement {
  const t = useT();
  const { onGradient } = useAppTheme();
  const color = onGradient.hero;
  const showChips = meetingsToday !== null || tasksDue !== null;
  const allClear = meetingsToday === 0 && (tasksDue === null || tasksDue === 0);

  return (
    <Reveal>
      <GradientSurface variant="hero" style={styles.card} testID={testID}>
        <View style={styles.glowA} pointerEvents="none" />
        <View style={styles.glowB} pointerEvents="none" />
        <Text style={[styles.greeting, { color }]} accessibilityRole="header" testID="dashboard-greeting">
          {greeting}
        </Text>
        <Text style={[styles.date, { color: withAlpha(color, 0.85) }]}>{dateLabel}</Text>
        {showChips ? (
          <View style={styles.chips}>
            {meetingsToday !== null && !allClear ? (
              <Chip icon="calendar-today" label={t('home:hero.meetings', { count: meetingsToday })} color={color} testID="hero-meetings" />
            ) : null}
            {tasksDue !== null && tasksDue > 0 ? (
              <Chip icon="checkbox-marked-circle-outline" label={t('home:hero.tasks', { count: tasksDue })} color={color} testID="hero-tasks" />
            ) : null}
            {allClear ? <Chip icon="weather-sunny" label={t('home:hero.allClear')} color={color} testID="hero-all-clear" /> : null}
          </View>
        ) : null}
      </GradientSurface>
    </Reveal>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.xl,
    padding: spacing.xl,
    overflow: 'hidden',
  },
  // Soft light blooms in the corners (white at 10 / 6 percent) so the gradient reads as a surface.
  glowA: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
    top: -70,
    right: -50,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  glowB: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    bottom: -60,
    left: 40,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  greeting: {
    ...typography.headlineM,
  },
  date: {
    ...typography.bodyM,
    marginTop: spacing.xs,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    minHeight: 32,
    borderRadius: radii.full,
  },
  chipText: {
    ...typography.labelM,
  },
});
