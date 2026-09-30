/**
 * Load by day: one horizontal bar per day (week) or per weekday (month totals), one hue
 * (chart[0]), bars anchored at the start with rounded ends, and the exact values written next to
 * each bar (the numbers never depend on reading the bar length). Label and value columns are
 * flexible (minWidth, wrap) so scaled or Spanish text never truncates; only the bar shrinks.
 */
import type { ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { Card, SectionHeader } from '../../components/ui';
import { useT } from '../../i18n';
import { radii, spacing, useAppTheme } from '../../theme';
import { useFormatters } from '../shared/useFormatters';
import { barFraction, type PeriodInsights } from './meetingInsights';

export function LoadByDay({ insights }: { insights: PeriodInsights }): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const fmt = useFormatters();

  return (
    <View>
      <SectionHeader title={t('insights:load.title')} />
      <Card testID="insights-load">
        {insights.period === 'month' ? (
          <Text variant="bodySmall" style={[styles.hint, { color: colors.onSurfaceVariant }]}>
            {t('insights:load.monthHint')}
          </Text>
        ) : null}
        {insights.days.map((day) => {
          const dayName = t(`insights:weekday.${day.weekday}`);
          const label = day.date ? `${dayName} ${Number(day.date.slice(8, 10))}` : dayName;
          const longName = day.date ? fmt.date(day.date, 'full') : t(`insights:weekdayLong.${day.weekday}`);
          const meetingsText = t('insights:meetings', { count: day.count });
          const durationText = fmt.duration(day.minutes);
          const fraction = barFraction(day, insights.days);
          return (
            <View
              key={day.key}
              style={styles.row}
              accessible
              accessibilityLabel={t('insights:load.rowA11y', { day: longName, meetings: meetingsText, duration: durationText })}
              testID={`load-${day.key}`}
            >
              <Text variant="labelMedium" style={[styles.label, { color: colors.onSurfaceVariant }]}>
                {label}
              </Text>
              <View style={[styles.track, { backgroundColor: colors.surfaceVariant }]}>
                {fraction > 0 ? (
                  <View style={[styles.bar, { width: `${Math.max(4, Math.round(fraction * 100))}%`, backgroundColor: colors.chart[0] }]} />
                ) : null}
              </View>
              <Text variant="bodySmall" style={[styles.value, { color: colors.onSurfaceVariant }]}>
                {day.count > 0 ? `${day.count} · ${durationText}` : '0'}
              </Text>
            </View>
          );
        })}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: {
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: spacing.xxxl,
  },
  label: {
    minWidth: 48,
    flexShrink: 0,
    fontVariant: ['tabular-nums'],
  },
  track: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 48,
    height: spacing.sm,
    borderRadius: radii.full,
    overflow: 'hidden',
    marginHorizontal: spacing.sm,
  },
  bar: {
    height: '100%',
    borderRadius: radii.full,
  },
  value: {
    minWidth: 56,
    flexShrink: 1,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
});
