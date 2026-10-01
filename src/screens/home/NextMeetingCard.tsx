/**
 * Next meeting card: the meeting happening now (if any) and the next one, each with a live
 * countdown (every second in the last hour, every 30 s otherwise), a Join button only when the
 * meeting has a real http(s) link, and a Details button.
 *
 * MG Indigo: this is the dashboard's single focal card — Card accent="primary"
 * (primaryContainer / onPrimaryContainer), countdown headlineS tabular-nums, Join filled small.
 * The "no upcoming meetings" variant stays a neutral card (nothing to focus on).
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useState, type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { Card, MGButton } from '../../components/ui';
import type { TranslateFn } from '../../core/contracts';
import type { Meeting } from '../../core/types';
import { useT } from '../../i18n';
import { componentMetrics, spacing, useAppTheme, withAlpha } from '../../theme';
import { formatRelative } from '../../utils/format';
import { endMs, meetingJoinLink, startMs } from '../insights/meetingInsights';
import { useFormatters, type Formatters } from '../shared/useFormatters';
import { CLOCK_THRESHOLD_SECONDS, countdownDisplay, countdownTickMs, countdownTo, formatCountdownClock } from './homeModel';
import { useLiveNow } from '../shared/useLiveNow';

export interface NextMeetingCardProps {
  current: Meeting | null;
  next: Meeting | null;
  onOpen(meeting: Meeting): void;
  onJoin(url: string): void;
}

function relativeText(value: string, fmt: Formatters, now: Date): string {
  try {
    return formatRelative(value, { ...fmt.options, now });
  } catch {
    return fmt.dateTime(value);
  }
}

/** "Starts in 4:05" / "Starts in 2 h 5 min" / "Starts tomorrow" / "Starting now". */
export function startsText(meeting: Meeting, now: Date, t: TranslateFn, fmt: Formatters): string {
  const display = countdownDisplay(startMs(meeting), now.getTime());
  switch (display.kind) {
    case 'now':
      return t('home:next.startingNow');
    case 'clock':
      return t('home:next.startsIn', { time: display.text });
    case 'duration':
      return t('home:next.startsIn', { time: fmt.duration(display.minutes) });
    case 'relative':
      return t('home:next.startsWhen', { when: relativeText(meeting.startAt, fmt, now) });
  }
}

/** "Ends in 12:03" / "Ends in 1 h 10 min" (a ticking clock in the last hour). */
export function endsText(meeting: Meeting, now: Date, t: TranslateFn, fmt: Formatters): string {
  const left = countdownTo(endMs(meeting), now.getTime());
  const time =
    left.totalSeconds < CLOCK_THRESHOLD_SECONDS ? formatCountdownClock(left) : fmt.duration(Math.ceil(left.totalSeconds / 60));
  return t('home:next.endsIn', { time });
}

function MeetingBlock({
  meeting,
  label,
  countdown,
  onOpen,
  onJoin,
  testID,
}: {
  meeting: Meeting;
  label: string;
  countdown: string;
  onOpen(meeting: Meeting): void;
  onJoin(url: string): void;
  testID: string;
}): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const fmt = useFormatters();
  const link = meetingJoinLink(meeting);
  const address = meeting.location?.address?.trim() ?? '';
  const onCard = colors.onPrimaryContainer;

  return (
    <View testID={testID}>
      <Text variant="labelLarge" style={{ color: onCard }}>
        {label}
      </Text>
      <Text variant="titleMedium" style={[styles.title, { color: onCard }]} numberOfLines={2} testID={`${testID}-title`}>
        {meeting.title}
      </Text>
      <Text variant="bodySmall" style={{ color: onCard }}>
        {fmt.meetingRange(meeting)}
      </Text>
      {address ? (
        <View style={styles.placeRow}>
          <MaterialCommunityIcons name="map-marker-outline" size={componentMetrics.iconMeta} color={onCard} />
          <Text variant="bodySmall" style={[styles.placeText, { color: onCard }]} numberOfLines={1}>
            {address}
          </Text>
        </View>
      ) : null}
      <Text variant="headlineSmall" style={[styles.countdown, { color: onCard }]} testID={`${testID}-countdown`}>
        {countdown}
      </Text>
      <View style={styles.actions}>
        {link ? (
          <MGButton
            size="sm"
            icon="video"
            onPress={() => onJoin(link)}
            style={styles.action}
            accessibilityLabel={t('home:next.joinA11y', { title: meeting.title })}
            testID={`${testID}-join`}
          >
            {t('home:next.join')}
          </MGButton>
        ) : null}
        <MGButton
          variant={link ? 'ghost' : 'filled'}
          size="sm"
          icon="information-outline"
          textColor={link ? onCard : undefined}
          onPress={() => onOpen(meeting)}
          style={styles.action}
          accessibilityLabel={t('home:next.detailsA11y', { title: meeting.title })}
          testID={`${testID}-details`}
        >
          {t('home:next.details')}
        </MGButton>
      </View>
    </View>
  );
}

export function NextMeetingCard({ current, next, onOpen, onJoin }: NextMeetingCardProps): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const fmt = useFormatters();
  const [tickMs, setTickMs] = useState(30_000);
  const now = useLiveNow(tickMs);
  // Tick every second while either countdown is in its last hour.
  const wanted = Math.min(
    countdownTickMs(next ? startMs(next) : null, now.getTime()),
    countdownTickMs(current ? endMs(current) : null, now.getTime()),
  );
  if (wanted !== tickMs) setTickMs(wanted);

  if (!current && !next) {
    return (
      <Card testID="next-meeting-card">
        <Text variant="labelLarge" style={{ color: colors.primary }}>
          {t('home:next.title')}
        </Text>
        <Text variant="titleMedium" style={styles.title}>
          {t('home:next.none')}
        </Text>
        <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
          {t('home:next.noneHint')}
        </Text>
      </Card>
    );
  }

  return (
    <Card accent="primary" testID="next-meeting-card">
      {current ? (
        <MeetingBlock
          meeting={current}
          label={t('home:next.current')}
          countdown={endsText(current, now, t, fmt)}
          onOpen={onOpen}
          onJoin={onJoin}
          testID="current-meeting"
        />
      ) : null}
      {current && next ? <View style={[styles.divider, { backgroundColor: withAlpha(colors.onPrimaryContainer, 0.16) }]} /> : null}
      {next ? (
        <MeetingBlock
          meeting={next}
          label={t('home:next.title')}
          countdown={startsText(next, now, t, fmt)}
          onOpen={onOpen}
          onJoin={onJoin}
          testID="next-meeting"
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  title: {
    marginTop: spacing.xs,
  },
  placeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  placeText: {
    marginLeft: spacing.xs,
    flex: 1,
  },
  countdown: {
    marginTop: spacing.sm,
    fontVariant: ['tabular-nums'],
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.sm,
  },
  action: {
    marginRight: spacing.sm,
    marginTop: spacing.xs,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: spacing.md,
  },
});
