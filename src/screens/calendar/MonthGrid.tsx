/**
 * Month grid of the calendar screen: 6 x 7 day cells with one dot per meeting source on the day,
 * today tinted (primaryContainer), the selected day filled (primary). Every cell is a button
 * whose label reads the full date, the number of meetings and "today" / "selected". Day circles
 * scale with the available width and never drop below 40dp (docs/DESIGN_SYSTEM.md §7).
 */
import { memo, useState, type ReactElement } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { Text } from 'react-native-paper';

import type { Meeting } from '../../core/types';
import { useT } from '../../i18n';
import { componentMetrics, radii, spacing, useAppTheme } from '../../theme';
import { sourceColor } from '../meetings/list/MeetingListItem';
import { useFormatters } from '../shared/useFormatters';
import { dayDots, type GridDay } from './calendarModel';

/** Day numbers may grow with the system font size, up to what a cell can hold. */
const MAX_FONT_SCALE = 1.4;
/** Largest day circle; below componentMetrics.calendarDayMinSize it never shrinks. */
const MAX_CIRCLE = 48;

export interface MonthGridProps {
  grid: readonly GridDay[];
  weekdays: readonly { short: string; full: string }[];
  index: ReadonlyMap<string, Meeting[]>;
  /** Days with at least one OPEN task due (rendered as a hollow dot, distinct from meetings). */
  taskDays?: ReadonlySet<string>;
  selectedKey: string;
  todayKey: string;
  onSelect(key: string): void;
}

function MonthGridComponent({ grid, weekdays, index, taskDays, selectedKey, todayKey, onSelect }: MonthGridProps): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const fmt = useFormatters();
  const dimensions = useWindowDimensions();
  const [width, setWidth] = useState(Math.max(0, Math.min(dimensions.width, 560) - 32));
  const cellWidth = width / 7;
  // The day circle grows with the cell (min 40dp); the cell leaves room for the dot row below.
  const circleSize = Math.min(MAX_CIRCLE, Math.max(componentMetrics.calendarDayMinSize, cellWidth - spacing.xs));
  const cellHeight = circleSize + componentMetrics.calendarDotSize + spacing.md;

  const onLayout = (event: LayoutChangeEvent): void => {
    const next = event.nativeEvent.layout.width;
    if (next > 0 && Math.abs(next - width) > 0.5) setWidth(next);
  };

  return (
    <View onLayout={onLayout} testID="calendar-grid">
      <View style={styles.row} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {weekdays.map((weekday) => (
          <Text
            key={weekday.full}
            variant="labelMedium"
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={[styles.weekday, { width: cellWidth, color: colors.onSurfaceVariant }]}
          >
            {weekday.short}
          </Text>
        ))}
      </View>
      <View style={styles.row}>
        {grid.map((day) => {
          const meetings = index.get(day.key);
          const count = meetings?.length ?? 0;
          const dots = dayDots(meetings);
          const hasTasks = taskDays?.has(day.key) ?? false;
          const selected = day.key === selectedKey;
          const today = day.key === todayKey;
          const numberColor = selected
            ? colors.onPrimary
            : today
              ? colors.onPrimaryContainer
              : day.inMonth
                ? colors.onSurface
                : colors.onSurfaceDisabled;
          const label = [
            fmt.date(day.key, 'full'),
            count > 0 ? t('calendarView:meetingCount', { count }) : t('calendarView:noMeetings'),
            hasTasks ? t('calendarView:hasTasks') : null,
            today ? t('calendarView:todayMarker') : null,
          ]
            .filter((part): part is string => part !== null && part !== '')
            .join(', ');
          return (
            <Pressable
              key={day.key}
              onPress={() => onSelect(day.key)}
              style={[styles.cell, { width: cellWidth, height: cellHeight }]}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ selected }}
              testID={`calendar-day-${day.key}`}
            >
              <View
                style={[
                  styles.number,
                  { minWidth: circleSize, height: circleSize, borderRadius: radii.full },
                  selected && { backgroundColor: colors.primary },
                  !selected && today && { backgroundColor: colors.primaryContainer },
                ]}
              >
                <Text
                  variant="bodyMedium"
                  maxFontSizeMultiplier={MAX_FONT_SCALE}
                  style={[{ color: numberColor }, (selected || today) && styles.bold]}
                >
                  {day.day}
                </Text>
              </View>
              <View style={styles.dots} testID={`calendar-dots-${day.key}`}>
                {dots.map((category) => (
                  <View
                    key={category}
                    style={[styles.dot, { backgroundColor: sourceColor(category, colors), opacity: day.inMonth ? 1 : 0.5 }]}
                    testID={`calendar-dot-${day.key}-${category}`}
                  />
                ))}
                {hasTasks ? (
                  <View
                    style={[styles.dot, styles.taskDot, { borderColor: colors.tertiary, opacity: day.inMonth ? 1 : 0.5 }]}
                    testID={`calendar-taskdot-${day.key}`}
                  />
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export const MonthGrid = memo(MonthGridComponent);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  weekday: {
    textAlign: 'center',
    paddingVertical: spacing.sm,
  },
  cell: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  number: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  bold: {
    fontWeight: '700',
  },
  dots: {
    flexDirection: 'row',
    height: componentMetrics.calendarDotSize + spacing.xs,
    marginTop: spacing.xs,
    alignItems: 'center',
    gap: spacing.xs,
  },
  dot: {
    width: componentMetrics.calendarDotSize,
    height: componentMetrics.calendarDotSize,
    borderRadius: radii.full,
  },
  // Tasks are a hollow ring, so a day with both meetings and tasks reads at a glance.
  taskDot: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
  },
});
