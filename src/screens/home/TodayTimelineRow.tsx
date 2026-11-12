/**
 * One row of today's timeline: time, title, state (done / now / cancelled) and conflict hints
 * (overlap in the error color, "starts right after" with a tertiary icon, always with an icon and
 * text so the meaning never depends on color alone). Tapping opens the meeting.
 *
 * Vertical timeline (client, November 1 evening): no cards. A time column on the left, then a
 * rail with a dot (source color per the §2 map; primary and larger for the meeting happening now;
 * error for a conflict) joined to the neighbours by a thin vertical line (none above the first
 * row, none below the last), then the title, the range, the state pill and the hints, and a
 * chevron. Rows sit directly on the screen background.
 */
import type { ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { Badge, Icon, PressableScale } from '../../components/ui';
import type { Meeting } from '../../core/types';
import { useT } from '../../i18n';
import { componentMetrics, radii, sourceColorIndex, spacing, useAppTheme } from '../../theme';
import { endMs } from '../insights/meetingInsights';
import { useFormatters } from '../shared/useFormatters';
import type { TimelineItem } from './homeModel';

export interface TodayTimelineRowProps {
  item: TimelineItem;
  isFirst?: boolean;
  isLast: boolean;
  onOpen(meeting: Meeting): void;
}

const DOT = 12;
const DOT_NOW = 16;
const RAIL_WIDTH = 24;
const LINE_WIDTH = 2;

export function TodayTimelineRow({ item, isFirst = false, isLast, onOpen }: TodayTimelineRowProps): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const fmt = useFormatters();
  const { meeting, state, overlapsWith, followsRightAfter } = item;
  const cancelled = meeting.status === 'cancelled';
  const conflict = !cancelled && overlapsWith.length > 0;
  const isNow = state === 'now' && !cancelled;
  const dimmed = state === 'past' || cancelled;

  const timeLabel = meeting.allDay ? t('home:today.allDay') : fmt.time(meeting.startAt);
  const rangeLabel = meeting.allDay ? '' : `${fmt.time(meeting.startAt)} - ${fmt.time(new Date(endMs(meeting)))}`;
  const stateLabel = cancelled
    ? t('home:today.cancelled')
    : state === 'past'
      ? t('home:today.done')
      : state === 'now' && !meeting.allDay
        ? t('home:today.now')
        : '';
  const overlapText =
    overlapsWith.length === 1
      ? t('home:today.overlapsWith', { title: overlapsWith[0]!.title })
      : t('home:today.overlapsMany', { count: overlapsWith.length });
  const rightAfterText = followsRightAfter ? t('home:today.rightAfter', { title: followsRightAfter.title }) : '';
  const a11yState = [stateLabel, conflict ? overlapText : '', !cancelled ? rightAfterText : ''].filter(Boolean).join('. ');

  const dotColor = conflict ? colors.error : isNow ? colors.primary : colors.chart[sourceColorIndex[meeting.source]];
  const dotSize = isNow ? DOT_NOW : DOT;
  const lineColor = colors.outlineVariant;

  return (
    <PressableScale
      onPress={() => onOpen(meeting)}
      accessibilityRole="button"
      accessibilityLabel={t('home:today.itemA11y', { time: meeting.allDay ? timeLabel : rangeLabel, title: meeting.title, state: a11yState })}
      style={styles.row}
      testID={`timeline-${meeting.id}`}
    >
      <View style={styles.timeColumn}>
        <Text
          variant={meeting.allDay ? 'labelMedium' : 'titleSmall'}
          style={[styles.time, { color: dimmed ? colors.onSurfaceVariant : colors.onSurface }]}
          numberOfLines={2}
        >
          {timeLabel}
        </Text>
      </View>
      <View style={styles.rail}>
        <View style={[styles.lineTop, { backgroundColor: isFirst ? 'transparent' : lineColor }]} />
        <View style={[styles.dot, { width: dotSize, height: dotSize, backgroundColor: dotColor, borderColor: colors.background }, dimmed && styles.dotDimmed]} />
        <View style={[styles.lineBottom, { backgroundColor: isLast ? 'transparent' : lineColor }]} />
      </View>
      <View style={styles.content}>
        <Text
          variant="titleMedium"
          numberOfLines={2}
          style={[dimmed && { color: colors.onSurfaceVariant }, cancelled && styles.cancelled]}
        >
          {meeting.title}
        </Text>
        {rangeLabel ? (
          <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
            {rangeLabel}
          </Text>
        ) : null}
        {stateLabel ? <Badge label={stateLabel} tone={isNow ? 'primary' : 'neutral'} style={styles.badge} /> : null}
        {conflict ? (
          <View style={styles.hintRow} testID={`timeline-${meeting.id}-overlap`}>
            <Icon name="alert" size={componentMetrics.iconMeta} color={colors.error} />
            <Text variant="bodySmall" style={[styles.hintText, { color: colors.error }]}>
              {overlapText}
            </Text>
          </View>
        ) : null}
        {!cancelled && followsRightAfter ? (
          <View style={styles.hintRow}>
            <Icon name="clock" size={componentMetrics.iconMeta} color={colors.tertiary} />
            <Text variant="bodySmall" style={[styles.hintText, { color: colors.onSurfaceVariant }]}>
              {rightAfterText}
            </Text>
          </View>
        ) : null}
      </View>
      <Icon name="chevronRight" size={componentMetrics.iconMeta} color={colors.onSurfaceVariant} style={styles.chevron} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  timeColumn: {
    width: 76,
    paddingTop: spacing.md,
    paddingRight: spacing.sm,
    alignItems: 'flex-end',
  },
  time: {
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  rail: {
    width: RAIL_WIDTH,
    alignItems: 'center',
  },
  lineTop: {
    width: LINE_WIDTH,
    height: spacing.md + 4,
  },
  dot: {
    borderRadius: radii.full,
    borderWidth: 2,
  },
  dotDimmed: {
    opacity: 0.5,
  },
  lineBottom: {
    width: LINE_WIDTH,
    flex: 1,
  },
  content: {
    flex: 1,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    paddingLeft: spacing.sm,
  },
  cancelled: {
    textDecorationLine: 'line-through',
  },
  badge: {
    marginTop: spacing.xs,
    borderRadius: radii.full,
  },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  hintText: {
    marginLeft: spacing.sm,
    flex: 1,
  },
  chevron: {
    marginTop: spacing.md + 2,
    marginLeft: spacing.sm,
  },
});
