/**
 * One row of today's timeline: time, title, state (done / now / cancelled) and conflict hints
 * (overlap in the error color, "starts right after" in the tertiary color, always with an icon and
 * text so the meaning never depends on color alone). Tapping opens the meeting.
 */
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ReactElement } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text, useTheme as usePaperTheme } from 'react-native-paper';

import type { Meeting } from '../../core/types';
import { useT } from '../../i18n';
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
  const theme = usePaperTheme();
  const fmt = useFormatters();
  const { meeting, state, overlapsWith, followsRightAfter } = item;
  const cancelled = meeting.status === 'cancelled';
  const conflict = !cancelled && overlapsWith.length > 0;

  const timeLabel = meeting.allDay ? t('home:today.allDay') : fmt.time(meeting.startAt);
  const rangeLabel = meeting.allDay ? '' : `${fmt.time(meeting.startAt)} – ${fmt.time(new Date(endMs(meeting)))}`;
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

  const dotColor = conflict ? theme.colors.error : state === 'now' ? theme.colors.primary : theme.colors.outline;

  return (
    <Pressable
      onPress={() => onOpen(meeting)}
      accessibilityRole="button"
      accessibilityLabel={t('home:today.itemA11y', { time: meeting.allDay ? timeLabel : rangeLabel, title: meeting.title, state: a11yState })}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.colors.surfaceVariant }]}
      testID={`timeline-${meeting.id}`}
    >
      <View style={styles.timeColumn}>
        <Text
          variant="labelLarge"
          style={{ color: state === 'now' ? theme.colors.primary : theme.colors.onSurfaceVariant }}
          numberOfLines={2}
        >
          {timeLabel}
        </Text>
      </View>
      <View style={styles.rail}>
        <View style={[styles.dot, { backgroundColor: dotColor }]} />
        {!isLast ? <View style={[styles.line, { backgroundColor: theme.colors.outlineVariant }]} /> : null}
      </View>
      <View
        style={[
          styles.content,
          { borderColor: conflict ? theme.colors.error : theme.colors.outlineVariant, backgroundColor: theme.colors.elevation.level1 },
          conflict && styles.conflictBorder,
          (state === 'past' || cancelled) && styles.dimmed,
        ]}
      >
        <Text variant="titleSmall" numberOfLines={2} style={cancelled ? styles.cancelled : undefined}>
          {meeting.title}
        </Text>
        {rangeLabel ? (
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            {rangeLabel}
          </Text>
        ) : null}
        {stateLabel ? (
          <Text variant="labelSmall" style={[styles.badge, { color: state === 'now' && !cancelled ? theme.colors.primary : theme.colors.onSurfaceVariant }]}>
            {stateLabel}
          </Text>
        ) : null}
        {conflict ? (
          <View style={styles.hintRow} testID={`timeline-${meeting.id}-overlap`}>
            <MaterialCommunityIcons name="alert-circle-outline" size={16} color={theme.colors.error} />
            <Text variant="bodySmall" style={[styles.hintText, { color: theme.colors.error }]}>
              {overlapText}
            </Text>
          </View>
        ) : null}
        {!cancelled && followsRightAfter ? (
          <View style={styles.hintRow}>
            <MaterialCommunityIcons name="timer-sand" size={16} color={theme.colors.tertiary} />
            <Text variant="bodySmall" style={[styles.hintText, { color: theme.colors.tertiary }]}>
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
    borderRadius: 12,
  },
  timeColumn: {
    width: 72,
    paddingTop: 12,
    paddingRight: 4,
  },
  rail: {
    width: 16,
    alignItems: 'center',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 16,
  },
  line: {
    flex: 1,
    width: 2,
    marginTop: 4,
  },
  content: {
    flex: 1,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    marginLeft: 8,
    marginBottom: 8,
  },
  conflictBorder: {
    borderWidth: 1.5,
  },
  dimmed: {
    opacity: 0.6,
  },
  cancelled: {
    textDecorationLine: 'line-through',
  },
  badge: {
    marginTop: 4,
    textTransform: 'uppercase',
  },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  hintText: {
    marginLeft: 6,
    flex: 1,
  },
});
