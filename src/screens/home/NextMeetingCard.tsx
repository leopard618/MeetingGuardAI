/**
 * Next meeting card: the meeting happening now (if any) and the next one, each with a live
 * countdown (every second in the last hour, every 30 s otherwise), a Join button only when the
 * meeting has a real http(s) link, and a Details button. Below them, the next all-day item
 * (birthday, holiday) when it comes no later than the next timed meeting.
 *
 * MG Indigo (2026-10-30 refresh): THE focal card of the dashboard, on the primary gradient with
 * white text (checked >= 4.5:1 on both stops), the countdown in headlineM tabular-nums, Join as
 * the inverse (white) pill, Details as ghost text. The "no upcoming meetings" variant stays a
 * neutral elevated card (nothing to focus on).
 */
import { useState, type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { Card, Glow, Icon, MGButton, Shimmer } from '../../components/ui';
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
  nextAllDay: Meeting | null;
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
  const { onGradient } = useAppTheme();
  const fmt = useFormatters();
  const link = meetingJoinLink(meeting);
  const address = meeting.location?.address?.trim() ?? '';
  const onCard = onGradient.primary;
  const muted = withAlpha(onCard, 0.82);

  return (
    <View testID={testID}>
      <Text variant="labelLarge" style={{ color: muted }}>
        {label}
      </Text>
      <Text variant="titleLarge" style={[styles.title, { color: onCard }]} numberOfLines={2} testID={`${testID}-title`}>
        {meeting.title}
      </Text>
      <Text variant="bodySmall" style={{ color: muted }}>
        {fmt.meetingRange(meeting)}
      </Text>
      {address ? (
        <View style={styles.placeRow}>
          <Icon name="place" size={componentMetrics.iconMeta} color={muted} />
          <Text variant="bodySmall" style={[styles.placeText, { color: muted }]} numberOfLines={1}>
            {address}
          </Text>
        </View>
      ) : null}
      <Text variant="headlineMedium" style={[styles.countdown, { color: onCard }]} testID={`${testID}-countdown`}>
        {countdown}
      </Text>
      <View style={styles.actions}>
        {link ? (
          <MGButton
            variant="inverse"
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
          variant={link ? 'ghost' : 'inverse'}
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

function AllDayBlock({ meeting, onOpen }: { meeting: Meeting; onOpen(meeting: Meeting): void }): ReactElement {
  const t = useT();
  const { onGradient } = useAppTheme();
  const fmt = useFormatters();
  const onCard = onGradient.primary;
  const muted = withAlpha(onCard, 0.82);
  return (
    <View testID="next-all-day">
      <Text variant="labelLarge" style={{ color: muted }}>
        {t('home:next.allDayTitle')}
      </Text>
      <Text variant="titleMedium" style={[styles.title, { color: onCard }]} numberOfLines={2} testID="next-all-day-title">
        {meeting.title}
      </Text>
      <Text variant="bodySmall" style={{ color: muted }}>
        {fmt.meetingRange(meeting)}
      </Text>
      <View style={styles.actions}>
        <MGButton
          variant="ghost"
          size="sm"
          icon="information-outline"
          textColor={onCard}
          onPress={() => onOpen(meeting)}
          style={styles.action}
          accessibilityLabel={t('home:next.detailsA11y', { title: meeting.title })}
          testID="next-all-day-details"
        >
          {t('home:next.details')}
        </MGButton>
      </View>
    </View>
  );
}

export function NextMeetingCard({ current, next, nextAllDay, onOpen, onJoin }: NextMeetingCardProps): ReactElement {
  const t = useT();
  const { colors, onGradient } = useAppTheme();
  const fmt = useFormatters();
  const [tickMs, setTickMs] = useState(30_000);
  const now = useLiveNow(tickMs);
  // Tick every second while either countdown is in its last hour.
  const wanted = Math.min(
    countdownTickMs(next ? startMs(next) : null, now.getTime()),
    countdownTickMs(current ? endMs(current) : null, now.getTime()),
  );
  if (wanted !== tickMs) setTickMs(wanted);

  if (!current && !next && !nextAllDay) {
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
    <View style={styles.focalWrap}>
      <Glow color={colors.primary} size={260} intensity={0.22} style={styles.focalGlow} />
      <Card variant="gradient" testID="next-meeting-card">
      <Shimmer />
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
      {current && next ? <View style={[styles.divider, { backgroundColor: withAlpha(onGradient.primary, 0.24) }]} /> : null}
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
      {nextAllDay && (current || next) ? (
        <View style={[styles.divider, { backgroundColor: withAlpha(onGradient.primary, 0.24) }]} />
      ) : null}
      {nextAllDay ? <AllDayBlock meeting={nextAllDay} onOpen={onOpen} /> : null}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  focalWrap: {
    position: 'relative',
  },
  focalGlow: {
    left: '50%',
    marginLeft: -130,
    bottom: -150,
  },
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
