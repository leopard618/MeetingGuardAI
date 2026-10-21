/**
 * Month grid of the calendar screen: six rows of seven day cells with one dot per meeting source
 * on the day, today ringed in primary, the selected day filled (primary). Every cell is a button
 * whose label reads the full date, the number of meetings and "today" / "selected". Day circles
 * scale with the available width and never drop below 40dp (docs/v1/DESIGN_SYSTEM.md §7).
 *
 * Layout: each week is its own row and every cell is `flex: 1`. A wrapping row of fixed-width
 * cells (width / 7 each) overflowed by a fraction of a pixel on some phones and pushed the
 * seventh day onto the next line; flex rows cannot do that.
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
const MAX_CIRCLE = 44;
const DAYS_PER_WEEK = 7;
/** Horizontal padding of the grid card, on each side. */
const GRID_PADDING = spacing.sm;

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

/** The grid split into weeks; the model always yields whole weeks, this just groups them. */
export function weeksOf<T>(days: readonly T[]): T[][] {
  const weeks: T[][] = [];
  for (let start = 0; start < days.length; start += DAYS_PER_WEEK) {
    weeks.push(days.slice(start, start + DAYS_PER_WEEK));
  }
  return weeks;
}

function MonthGridComponent({ grid, weekdays, index, taskDays, selectedKey, todayKey, onSelect }: MonthGridProps): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const fmt = useFormatters();
  const dimensions = useWindowDimensions();
  const [width, setWidth] = useState(Math.max(0, Math.min(dimensions.width, 560) - 2 * componentMetrics.screenGutter));
  const cellWidth = (width - 2 * GRID_PADDING) / DAYS_PER_WEEK;
  // The day circle grows with the cell (min 40dp); the cell leaves room for the dot row below.
  const circleSize = Math.min(MAX_CIRCLE, Math.max(componentMetrics.calendarDayMinSize, Math.floor(cellWidth - spacing.xs)));
  const cellHeight = circleSize + componentMetrics.calendarDotSize + spacing.md;

  const onLayout = (event: LayoutChangeEvent): void => {
    const next = event.nativeEvent.layout.width;
    if (next > 0 && Math.abs(next - width) > 0.5) setWidth(next);
  };

  return (
    <View
      onLayout={onLayout}
      style={[styles.card, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.outlineVariant }]}
      testID="calendar-grid"
    >
      <View style={styles.row} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {weekdays.map((weekday) => (
          <Text
            key={weekday.full}
            variant="labelSmall"
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={[styles.weekday, { color: colors.onSurfaceVariant }]}
          >
            {weekday.short}
          </Text>
        ))}
      </View>
      {weeksOf(grid).map((week) => (
        <View key={week[0]?.key ?? 'empty'} style={styles.row}>
          {week.map((day) => {
            const meetings = index.get(day.key);
            const count = meetings?.length ?? 0;
            const dots = dayDots(meetings);
            const hasTasks = taskDays?.has(day.key) ?? false;
            const selected = day.key === selectedKey;
            const today = day.key === todayKey;
            const numberColor = selected
              ? colors.onPrimary
              : today
                ? colors.primary
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
                style={[styles.cell, { height: cellHeight }]}
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityState={{ selected }}
                testID={`calendar-day-${day.key}`}
              >
                <View
                  style={[
                    styles.number,
                    { width: circleSize, height: circleSize, borderRadius: radii.full },
                    selected && { backgroundColor: colors.primary },
                    !selected && today && { borderWidth: 1.5, borderColor: colors.primary },
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
      ))}
    </View>
  );
}

export const MonthGrid = memo(MonthGridComponent);

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.lg,
    paddingHorizontal: GRID_PADDING,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
  },
  weekday: {
    flex: 1,
    textAlign: 'center',
    paddingVertical: spacing.sm,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  cell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  number: {
    alignItems: 'center',
    justifyContent: 'center',
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
