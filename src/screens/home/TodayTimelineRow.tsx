/**
 * One row of today's timeline: time, title, state (done / now / cancelled) and conflict hints
 * (overlap in the error color, "starts right after" with a tertiary icon, always with an icon and
 * text so the meaning never depends on color alone). Tapping opens the meeting.
 *
 * MG Indigo (2026-11-01 dashboard redesign): an open schedule list instead of bordered cards.
 * Bold tabular start time on the left, a 4dp accent bar in the meeting's source color (§2 map;
 * primary for the meeting happening now, error for a conflict), title and range, then the state
 * pill and hints. The row happening now sits on a surfaceContainerHigh tint; rows are separated
 * by a hairline (none after the last).
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
  isLast: boolean;
  onOpen(meeting: Meeting): void;
}

export function TodayTimelineRow({ item, isLast, onOpen }: TodayTimelineRowProps): ReactElement {
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

  const barColor = conflict ? colors.error : isNow ? colors.primary : colors.chart[sourceColorIndex[meeting.source]];

  return (
    <PressableScale
      onPress={() => onOpen(meeting)}
      accessibilityRole="button"
      accessibilityLabel={t('home:today.itemA11y', { time: meeting.allDay ? timeLabel : rangeLabel, title: meeting.title, state: a11yState })}
      style={[
        styles.row,
        isNow && { backgroundColor: colors.surfaceContainerHigh },
        !isLast && !isNow && [styles.rowDivider, { borderBottomColor: colors.outlineVariant }],
      ]}
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
      <View style={[styles.bar, { backgroundColor: barColor }, dimmed && styles.barDimmed]} />
      <View style={styles.content}>
        <Text
          variant="titleSmall"
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
    alignItems: 'center',
    borderRadius: radii.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRadius: 0,
  },
  timeColumn: {
    minWidth: 60,
    paddingRight: spacing.xs,
  },
  time: {
    fontVariant: ['tabular-nums'],
  },
  bar: {
    width: componentMetrics.accentBarWidth,
    alignSelf: 'stretch',
    minHeight: 36,
    borderRadius: radii.full,
    marginRight: spacing.md,
  },
  barDimmed: {
    opacity: 0.45,
  },
  content: {
    flex: 1,
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
    marginLeft: spacing.sm,
  },
});
