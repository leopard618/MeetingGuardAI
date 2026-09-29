/**
 * Month grid of the calendar screen: 6 x 7 day cells with one dot per meeting source on the day,
 * today outlined, the selected day filled. Every cell is a button whose label reads the full date,
 * the number of meetings and "today" / "selected".
 */
import { memo, useState, type ReactElement } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { Text, useTheme as usePaperTheme } from 'react-native-paper';

import type { Meeting } from '../../core/types';
import { useT } from '../../i18n';
import { sourceColor } from '../meetings/list/MeetingListItem';
import { useFormatters } from '../shared/useFormatters';
import { dayDots, type GridDay } from './calendarModel';

const MIN_CELL_HEIGHT = 44;
const MAX_CELL_HEIGHT = 56;
/** Day numbers may grow with the system font size, up to what a cell can hold. */
const MAX_FONT_SCALE = 1.4;

export interface MonthGridProps {
  grid: readonly GridDay[];
  weekdays: readonly { short: string; full: string }[];
  index: ReadonlyMap<string, Meeting[]>;
  selectedKey: string;
  todayKey: string;
  onSelect(key: string): void;
}

function MonthGridComponent({ grid, weekdays, index, selectedKey, todayKey, onSelect }: MonthGridProps): ReactElement {
  const t = useT();
  const theme = usePaperTheme();
  const fmt = useFormatters();
  const dimensions = useWindowDimensions();
  const [width, setWidth] = useState(Math.max(0, Math.min(dimensions.width, 560) - 32));
  const cellWidth = width / 7;
  const cellHeight = Math.min(MAX_CELL_HEIGHT, Math.max(MIN_CELL_HEIGHT, cellWidth));

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
            style={[styles.weekday, { width: cellWidth, color: theme.colors.onSurfaceVariant }]}
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
          const selected = day.key === selectedKey;
          const today = day.key === todayKey;
          const numberColor = selected
            ? theme.colors.onPrimary
            : today
              ? theme.colors.primary
              : day.inMonth
                ? theme.colors.onSurface
                : theme.colors.onSurfaceDisabled;
          const label = [
            fmt.date(day.key, 'full'),
            count > 0 ? t('calendarView:meetingCount', { count }) : t('calendarView:noMeetings'),
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
                  selected && { backgroundColor: theme.colors.primary },
                  !selected && today && { borderColor: theme.colors.primary, borderWidth: 1.5 },
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
                    style={[styles.dot, { backgroundColor: sourceColor(category, theme), opacity: day.inMonth ? 1 : 0.5 }]}
                    testID={`calendar-dot-${day.key}-${category}`}
                  />
                ))}
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
    paddingVertical: 6,
  },
  cell: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  number: {
    minWidth: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  bold: {
    fontWeight: '700',
  },
  dots: {
    flexDirection: 'row',
    height: 8,
    marginTop: 2,
    alignItems: 'center',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginHorizontal: 1,
  },
});
