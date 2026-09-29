/**
 * Load by day: one horizontal bar per day (week) or per weekday (month totals), one hue, bars
 * anchored at the start with rounded ends, and the exact values written next to each bar (the
 * numbers never depend on reading the bar length).
 */
import type { ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, useTheme as usePaperTheme } from 'react-native-paper';

import { useT } from '../../i18n';
import { Section } from '../shared/Section';
import { useFormatters } from '../shared/useFormatters';
import { barFraction, type PeriodInsights } from './meetingInsights';

export function LoadByDay({ insights }: { insights: PeriodInsights }): ReactElement {
  const t = useT();
  const theme = usePaperTheme();
  const fmt = useFormatters();

  return (
    <Section title={t('insights:load.title')} testID="insights-load">
      {insights.period === 'month' ? (
        <Text variant="bodySmall" style={[styles.hint, { color: theme.colors.onSurfaceVariant }]}>
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
            <Text variant="labelMedium" style={styles.label} numberOfLines={1}>
              {label}
            </Text>
            <View style={[styles.track, { backgroundColor: theme.colors.surfaceVariant }]}>
              {fraction > 0 ? (
                <View style={[styles.bar, { width: `${Math.max(4, Math.round(fraction * 100))}%`, backgroundColor: theme.colors.primary }]} />
              ) : null}
            </View>
            <Text variant="bodySmall" style={[styles.value, { color: theme.colors.onSurfaceVariant }]} numberOfLines={1}>
              {day.count > 0 ? `${day.count} · ${durationText}` : '0'}
            </Text>
          </View>
        );
      })}
    </Section>
  );
}

const styles = StyleSheet.create({
  hint: {
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 32,
  },
  label: {
    width: 56,
  },
  track: {
    flex: 1,
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
    marginHorizontal: 8,
  },
  bar: {
    height: 10,
    borderRadius: 5,
  },
  value: {
    width: 96,
    textAlign: 'right',
  },
});
