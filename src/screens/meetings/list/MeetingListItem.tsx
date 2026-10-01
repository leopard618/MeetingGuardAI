/**
 * One meeting row (meetings list and calendar agenda): time in the user's zone and clock
 * preference, title, place / video call, where it comes from, "Now" and "Cancelled" markers.
 * Tap opens the details; long-press or the "more" button opens the action sheet; screen-reader
 * users get the same edit / delete actions as accessibility actions.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { memo, type ReactElement } from 'react';
import { Platform, Pressable, StyleSheet, View, type AccessibilityActionEvent } from 'react-native';
import { IconButton, Text } from 'react-native-paper';

import type { TranslateFn } from '../../../core/contracts';
import { endIso, toLocalDateTime } from '../../../core/time';
import type { Meeting, MeetingSource } from '../../../core/types';
import { useT } from '../../../i18n';
import { Badge } from '../../../components/ui';
import {
  componentMetrics,
  pressedOpacity,
  radii,
  sourceColorIndex,
  spacing,
  stateAlpha,
  typography,
  useAppTheme,
  withAlpha,
  type MGColors,
} from '../../../theme';
import type { Formatters } from '../../shared/useFormatters';
import type { DisplayMeeting } from '../occurrences';
import { isInProgress, type SourceCategory } from './meetingListModel';

const MINUTES_PER_DAY = 1440;

/** Dot / legend color of a source category (canonical §2 map: meetingguard = manual's hue). */
export function sourceColor(category: SourceCategory, colors: MGColors): string {
  if (category === 'google') return colors.chart[sourceColorIndex.google];
  if (category === 'device') return colors.chart[sourceColorIndex.device];
  return colors.chart[sourceColorIndex.manual];
}

/** Accent color of one meeting's exact source (row accent bars). */
export function meetingSourceColor(source: MeetingSource, colors: MGColors): string {
  return colors.chart[sourceColorIndex[source]];
}

/**
 * Time of a meeting inside its day section: "3:00 - 4:00 PM" style start / end times, "All day",
 * or the full range with dates when the meeting spans several days.
 */
export function meetingTimeText(meeting: Meeting, fmt: Formatters, timeZone: string, t: TranslateFn): string {
  if (meeting.allDay) {
    const days = Math.max(1, Math.round(meeting.durationMinutes / MINUTES_PER_DAY));
    return days === 1 ? t('common:format.allDay') : fmt.meetingRange(meeting, timeZone);
  }
  const end = endIso(meeting);
  if (end === meeting.startAt) return fmt.time(meeting.startAt, timeZone);
  const lastMinute = new Date(Date.parse(end) - 60_000);
  const sameDay = toLocalDateTime(meeting.startAt, timeZone).date === toLocalDateTime(lastMinute, timeZone).date;
  if (!sameDay) return fmt.meetingRange(meeting, timeZone);
  return `${fmt.time(meeting.startAt, timeZone)} - ${fmt.time(end, timeZone)}`;
}

function placeText(meeting: Meeting, t: TranslateFn): { icon: 'map-marker-outline' | 'video-outline'; text: string } | null {
  if (meeting.location?.address) return { icon: 'map-marker-outline', text: meeting.location.address };
  if (meeting.conference) return { icon: 'video-outline', text: t(`alerts:provider.${meeting.conference.provider}`) };
  if (meeting.location?.virtualUrl) return { icon: 'video-outline', text: t('meetings:list.online') };
  return null;
}

export interface MeetingListItemProps {
  /** A meeting, or one materialized occurrence of a recurring meeting (occurrences.ts). */
  meeting: DisplayMeeting;
  now: Date;
  timeZone: string;
  /** The screen's formatters (UI language + clock preference). */
  fmt: Formatters;
  deleting?: boolean;
  onOpen(meeting: DisplayMeeting): void;
  onMore(meeting: DisplayMeeting): void;
  onEdit(meeting: DisplayMeeting): void;
  onDelete(meeting: DisplayMeeting): void;
}

function MeetingListItemComponent({
  meeting,
  now,
  timeZone,
  fmt,
  deleting = false,
  onOpen,
  onMore,
  onEdit,
  onDelete,
}: MeetingListItemProps): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const accent = meetingSourceColor(meeting.source, colors);
  const when = meetingTimeText(meeting, fmt, timeZone, t);
  const place = placeText(meeting, t);
  const cancelled = meeting.status === 'cancelled';
  const live = !cancelled && isInProgress(meeting, now);
  const source = t(`meetings:source.${meeting.source}`);
  const muted = colors.onSurfaceVariant;
  const repeats = meeting.recurrence !== null;

  const labelParts = [meeting.title, when];
  if (live) labelParts.push(t('meetings:list.now'));
  if (cancelled) labelParts.push(t('meetings:details.cancelled'));
  if (repeats) labelParts.push(t('meetings:list.repeats'));
  if (place) labelParts.push(place.text);
  labelParts.push(source);

  const onAccessibilityAction = (event: AccessibilityActionEvent): void => {
    switch (event.nativeEvent.actionName) {
      case 'activate':
        onOpen(meeting);
        break;
      case 'longpress':
        onMore(meeting);
        break;
      case 'edit':
        onEdit(meeting);
        break;
      case 'delete':
        onDelete(meeting);
        break;
      default:
        break;
    }
  };

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.outlineVariant },
        deleting && styles.deleting,
      ]}
    >
      <Pressable
        style={({ pressed }) => [styles.pressable, pressed && Platform.OS !== 'android' && styles.pressed]}
        android_ripple={{ color: withAlpha(colors.onSurface, stateAlpha.rippleOnRow) }}
        onPress={() => onOpen(meeting)}
        onLongPress={() => onMore(meeting)}
        disabled={deleting}
        accessibilityRole="button"
        accessibilityLabel={labelParts.join(', ')}
        accessibilityHint={t('meetings:list.openHint')}
        accessibilityState={{ disabled: deleting, busy: deleting }}
        accessibilityActions={[
          { name: 'activate' },
          { name: 'longpress', label: t('meetings:list.moreActions', { title: meeting.title }) },
          { name: 'edit', label: t('meetings:actions.edit') },
          { name: 'delete', label: t('meetings:actions.delete') },
        ]}
        onAccessibilityAction={onAccessibilityAction}
        testID={`meeting-row-${meeting.id}`}
      >
        <View style={[styles.accent, { backgroundColor: accent }]} />
        <View style={styles.body}>
          <Text
            style={[styles.time, { color: live ? colors.primary : muted }]}
            testID={`meeting-row-time-${meeting.id}`}
          >
            {when}
          </Text>
          <Text
            variant="titleMedium"
            numberOfLines={2}
            style={cancelled ? [styles.cancelledTitle, { color: muted }] : undefined}
          >
            {meeting.title}
          </Text>
          {place ? (
            <View style={styles.metaRow}>
              <MaterialCommunityIcons name={place.icon} size={componentMetrics.iconMeta} color={muted} style={styles.metaIcon} />
              <Text variant="bodySmall" numberOfLines={1} style={[styles.flex, { color: muted }]}>
                {place.text}
              </Text>
            </View>
          ) : null}
          <View style={styles.badges}>
            {live ? <Badge label={t('meetings:list.now')} tone="primary" /> : null}
            {cancelled ? <Badge label={t('meetings:details.cancelled')} tone="error" /> : null}
            {repeats ? (
              <View style={styles.repeatBadge} testID={`meeting-row-repeats-${meeting.id}`}>
                <MaterialCommunityIcons name="repeat" size={componentMetrics.iconMeta} color={muted} />
                <Text variant="labelSmall" numberOfLines={1} style={{ color: muted }}>
                  {t('meetings:list.repeats')}
                </Text>
              </View>
            ) : null}
            <Text variant="labelSmall" numberOfLines={1} style={[styles.source, { color: muted }]}>
              {source}
            </Text>
          </View>
        </View>
      </Pressable>
      <IconButton
        icon="dots-vertical"
        onPress={() => onMore(meeting)}
        disabled={deleting}
        accessibilityLabel={t('meetings:list.moreActions', { title: meeting.title })}
        hitSlop={4}
        style={styles.more}
        testID={`meeting-row-more-${meeting.id}`}
      />
    </View>
  );
}

export const MeetingListItem = memo(MeetingListItemComponent);

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.lg,
    borderWidth: 1,
    marginHorizontal: componentMetrics.screenGutter,
    marginBottom: componentMetrics.cardGap,
    overflow: 'hidden',
  },
  deleting: {
    opacity: 0.5,
  },
  pressable: {
    flex: 1,
    flexDirection: 'row',
    minHeight: componentMetrics.listRowMinHeight,
  },
  pressed: {
    opacity: pressedOpacity,
  },
  accent: {
    width: componentMetrics.accentBarWidth,
    borderRadius: radii.full,
    marginVertical: spacing.md,
    marginLeft: spacing.sm,
  },
  body: {
    flex: 1,
    paddingVertical: spacing.md,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
  },
  flex: {
    flex: 1,
  },
  time: {
    ...typography.bodyM,
    fontVariant: ['tabular-nums'],
  },
  cancelledTitle: {
    textDecorationLine: 'line-through',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  metaIcon: {
    marginRight: spacing.xs,
  },
  badges: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: spacing.xs,
    gap: spacing.sm,
  },
  source: {
    flexShrink: 1,
  },
  repeatBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  more: {
    margin: 0,
    marginRight: spacing.xs,
  },
});
