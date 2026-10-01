/**
 * One row of today's timeline: time, title, state (done / now / cancelled) and conflict hints
 * (overlap in the error color, "starts right after" with a tertiary icon, always with an icon and
 * text so the meaning never depends on color alone). Tapping opens the meeting.
 *
 * MG Indigo: the rail dot takes the meeting's source color (§2 map), the meeting happening now
 * gets a primary dot and a surfaceContainerHigh-tinted card; conflicts keep the error border.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ReactElement } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { Badge } from '../../components/ui';
import type { Meeting } from '../../core/types';
import { useT } from '../../i18n';
import { componentMetrics, pressedOpacity, radii, sourceColorIndex, spacing, stateAlpha, useAppTheme, withAlpha } from '../../theme';
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

  const dotColor = isNow ? colors.primary : colors.chart[sourceColorIndex[meeting.source]];
  // Conflict cards stay on surface so the error border and text keep their checked contrast.
  const tinted = isNow && !conflict;

  return (
    <Pressable
      onPress={() => onOpen(meeting)}
      accessibilityRole="button"
      accessibilityLabel={t('home:today.itemA11y', { time: meeting.allDay ? timeLabel : rangeLabel, title: meeting.title, state: a11yState })}
      android_ripple={{ color: withAlpha(colors.onSurface, stateAlpha.rippleOnRow) }}
      style={({ pressed }) => [styles.row, pressed && Platform.OS !== 'android' && styles.pressed]}
      testID={`timeline-${meeting.id}`}
    >
      <View style={styles.timeColumn}>
        <Text variant="labelMedium" style={[styles.time, { color: colors.onSurfaceVariant }]} numberOfLines={2}>
          {timeLabel}
        </Text>
      </View>
      <View style={styles.rail}>
        <View style={[styles.dot, { backgroundColor: dotColor }]} />
        {!isLast ? <View style={[styles.line, { backgroundColor: colors.outlineVariant }]} /> : null}
      </View>
      <View
        style={[
          styles.content,
          {
            borderColor: conflict ? colors.error : tinted ? colors.surfaceContainerHigh : colors.outlineVariant,
            backgroundColor: tinted ? colors.surfaceContainerHigh : colors.surface,
          },
          conflict && styles.conflictBorder,
        ]}
      >
        <Text
          variant="titleSmall"
          numberOfLines={2}
          style={[
            (state === 'past' || cancelled) && { color: colors.onSurfaceVariant },
            cancelled && styles.cancelled,
          ]}
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
            <MaterialCommunityIcons name="alert-circle-outline" size={componentMetrics.iconMeta} color={colors.error} />
            <Text variant="bodySmall" style={[styles.hintText, { color: colors.error }]}>
              {overlapText}
            </Text>
          </View>
        ) : null}
        {!cancelled && followsRightAfter ? (
          <View style={styles.hintRow}>
            <MaterialCommunityIcons name="timer-sand" size={componentMetrics.iconMeta} color={colors.tertiary} />
            <Text variant="bodySmall" style={[styles.hintText, { color: colors.onSurfaceVariant }]}>
              {rightAfterText}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderRadius: radii.md,
    // Keeps the Android ripple inside the rounded corners.
    overflow: 'hidden',
  },
  pressed: {
    opacity: pressedOpacity,
  },
  timeColumn: {
    minWidth: 56,
    paddingTop: spacing.md,
    paddingRight: spacing.xs,
  },
  time: {
    fontVariant: ['tabular-nums'],
  },
  rail: {
    width: spacing.lg,
    alignItems: 'center',
  },
  dot: {
    width: componentMetrics.sourceDotSize,
    height: componentMetrics.sourceDotSize,
    borderRadius: radii.full,
    marginTop: spacing.lg,
  },
  line: {
    flex: 1,
    width: 2,
    marginTop: spacing.xs,
  },
  content: {
    flex: 1,
    borderRadius: radii.md,
    borderWidth: 1,
    padding: spacing.md,
    marginLeft: spacing.sm,
    marginBottom: spacing.sm,
  },
  conflictBorder: {
    borderWidth: 1.5,
  },
  cancelled: {
    textDecorationLine: 'line-through',
  },
  badge: {
    marginTop: spacing.xs,
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
});
