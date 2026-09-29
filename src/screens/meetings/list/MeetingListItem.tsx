/**
 * One meeting row (meetings list and calendar agenda): time in the user's zone and clock
 * preference, title, place / video call, where it comes from, "Now" and "Cancelled" markers.
 * Tap opens the details; long-press or the "more" button opens the action sheet; screen-reader
 * users get the same edit / delete actions as accessibility actions.
 */
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { memo, type ReactElement } from 'react';
import { Pressable, StyleSheet, View, type AccessibilityActionEvent } from 'react-native';
import { IconButton, Text, useTheme as usePaperTheme, type MD3Theme } from 'react-native-paper';

import type { TranslateFn } from '../../../core/contracts';
import { endIso, toLocalDateTime } from '../../../core/time';
import type { Meeting } from '../../../core/types';
import { useT } from '../../../i18n';
import type { Formatters } from '../../shared/useFormatters';
import { isInProgress, sourceCategory, type SourceCategory } from './meetingListModel';

const MINUTES_PER_DAY = 1440;

/** Dot / accent color of a source category (theme-aware). */
export function sourceColor(category: SourceCategory, theme: MD3Theme): string {
  if (category === 'google') return theme.dark ? '#8AB4F8' : '#1A73E8';
  if (category === 'device') return theme.colors.tertiary;
  return theme.colors.primary;
}

/**
 * Time of a meeting inside its day section: "3:00 – 4:00 PM" style start / end times, "All day",
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
  return `${fmt.time(meeting.startAt, timeZone)} – ${fmt.time(end, timeZone)}`;
}

function placeText(meeting: Meeting, t: TranslateFn): { icon: 'map-marker-outline' | 'video-outline'; text: string } | null {
  if (meeting.location?.address) return { icon: 'map-marker-outline', text: meeting.location.address };
  if (meeting.conference) return { icon: 'video-outline', text: t(`alerts:provider.${meeting.conference.provider}`) };
  if (meeting.location?.virtualUrl) return { icon: 'video-outline', text: t('meetings:list.online') };
  return null;
}

export interface MeetingListItemProps {
  meeting: Meeting;
  now: Date;
  timeZone: string;
  /** The screen's formatters (UI language + clock preference). */
  fmt: Formatters;
  deleting?: boolean;
  onOpen(meeting: Meeting): void;
  onMore(meeting: Meeting): void;
  onEdit(meeting: Meeting): void;
  onDelete(meeting: Meeting): void;
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
  const theme = usePaperTheme();
  const category = sourceCategory(meeting.source);
  const accent = sourceColor(category, theme);
  const when = meetingTimeText(meeting, fmt, timeZone, t);
  const place = placeText(meeting, t);
  const cancelled = meeting.status === 'cancelled';
  const live = !cancelled && isInProgress(meeting, now);
  const source = t(`meetings:source.${meeting.source}`);
  const muted = theme.colors.onSurfaceVariant;

  const labelParts = [meeting.title, when];
  if (live) labelParts.push(t('meetings:list.now'));
  if (cancelled) labelParts.push(t('meetings:details.cancelled'));
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
        { backgroundColor: theme.colors.elevation.level1, borderColor: theme.colors.outlineVariant },
        deleting && styles.deleting,
      ]}
    >
      <Pressable
        style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}
        android_ripple={{ color: theme.colors.surfaceVariant }}
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
          <Text variant="labelLarge" style={{ color: live ? theme.colors.primary : muted }} testID={`meeting-row-time-${meeting.id}`}>
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
              <MaterialCommunityIcons name={place.icon} size={16} color={muted} style={styles.metaIcon} />
              <Text variant="bodySmall" numberOfLines={1} style={[styles.flex, { color: muted }]}>
                {place.text}
              </Text>
            </View>
          ) : null}
          <View style={styles.badges}>
            {live ? (
              <Text variant="labelSmall" style={[styles.badge, { backgroundColor: theme.colors.primaryContainer, color: theme.colors.onPrimaryContainer }]}>
                {t('meetings:list.now')}
              </Text>
            ) : null}
            {cancelled ? (
              <Text variant="labelSmall" style={[styles.badge, { backgroundColor: theme.colors.errorContainer, color: theme.colors.onErrorContainer }]}>
                {t('meetings:details.cancelled')}
              </Text>
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
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    marginHorizontal: 16,
    marginBottom: 10,
    overflow: 'hidden',
  },
  deleting: {
    opacity: 0.5,
  },
  pressable: {
    flex: 1,
    flexDirection: 'row',
    minHeight: 64,
  },
  pressed: {
    opacity: 0.85,
  },
  accent: {
    width: 5,
  },
  body: {
    flex: 1,
    paddingVertical: 10,
    paddingLeft: 12,
    paddingRight: 4,
  },
  flex: {
    flex: 1,
  },
  cancelledTitle: {
    textDecorationLine: 'line-through',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  metaIcon: {
    marginRight: 4,
  },
  badges: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: 4,
  },
  badge: {
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
    marginRight: 6,
    overflow: 'hidden',
  },
  source: {
    flexShrink: 1,
  },
  more: {
    margin: 0,
    marginRight: 4,
  },
});
