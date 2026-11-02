/**
 * Next meeting card: the meeting happening now (if any) and the next one, each with a live
 * countdown (every second in the last hour, every 30 s otherwise), a Join button only when the
 * meeting has a real http(s) link, and a Details button. Below them, the next all-day item
 * (birthday, holiday) when it comes no later than the next timed meeting.
 *
 * Flat style (November 1, 2026): a plain surface Card. Each block: the label in primary, the
 * title, a clock line with the range and the place, the countdown in primary titleM, a thin
 * elapsed bar while the meeting runs, and the buttons at the right (Details outline + Join filled
 * when there is a link, else Details filled). No decoration, no motion. The "no upcoming
 * meetings" variant is the same card with an icon row.
 */
import { useState, type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { Card, Icon, MGButton } from '../../components/ui';
import type { TranslateFn } from '../../core/contracts';
import type { Meeting } from '../../core/types';
import { useT } from '../../i18n';
import { componentMetrics, radii, spacing, useAppTheme, withAlpha } from '../../theme';
import { formatRelative } from '../../utils/format';
import { endMs, meetingJoinLink, startMs } from '../insights/meetingInsights';
import { useFormatters, type Formatters } from '../shared/useFormatters';
import { CLOCK_THRESHOLD_SECONDS, countdownDisplay, countdownTickMs, countdownTo, elapsedFraction, formatCountdownClock } from './homeModel';
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
  running,
  now,
  onOpen,
  onJoin,
  testID,
}: {
  meeting: Meeting;
  label: string;
  countdown: string;
  running: boolean;
  now: Date;
  onOpen(meeting: Meeting): void;
  onJoin(url: string): void;
  testID: string;
}): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const fmt = useFormatters();
  const link = meetingJoinLink(meeting);
  const address = meeting.location?.address?.trim() ?? '';
  const progress = running ? elapsedFraction(meeting, now) : null;

  return (
    <View testID={testID}>
      <Text variant="labelLarge" style={{ color: colors.primary }}>
        {label}
      </Text>
      <Text variant="titleLarge" style={styles.title} numberOfLines={2} testID={`${testID}-title`}>
        {meeting.title}
      </Text>
      <View style={styles.metaRow}>
        <Icon name="clock" size={componentMetrics.iconMeta} color={colors.onSurfaceVariant} />
        <Text variant="bodySmall" style={[styles.metaText, { color: colors.onSurfaceVariant }]} numberOfLines={1}>
          {fmt.meetingRange(meeting)}
        </Text>
      </View>
      {address ? (
        <View style={styles.metaRow}>
          <Icon name="place" size={componentMetrics.iconMeta} color={colors.onSurfaceVariant} />
          <Text variant="bodySmall" style={[styles.metaText, { color: colors.onSurfaceVariant }]} numberOfLines={1}>
            {address}
          </Text>
        </View>
      ) : null}
      {progress !== null ? (
        <View style={[styles.track, { backgroundColor: withAlpha(colors.primary, 0.2) }]} testID={`${testID}-progress`}>
          <View style={[styles.fill, { backgroundColor: colors.primary, width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` }]} />
        </View>
      ) : null}
      <View style={styles.footer}>
        <Text variant="titleMedium" style={[styles.countdown, { color: colors.primary }]} testID={`${testID}-countdown`}>
          {countdown}
        </Text>
        <View style={styles.actions}>
          {link ? (
            <MGButton
              variant="outline"
              size="sm"
              onPress={() => onOpen(meeting)}
              style={styles.action}
              accessibilityLabel={t('home:next.detailsA11y', { title: meeting.title })}
              testID={`${testID}-details`}
            >
              {t('home:next.details')}
            </MGButton>
          ) : null}
          {link ? (
            <MGButton
              variant="filled"
              size="sm"
              icon="video"
              onPress={() => onJoin(link)}
              style={styles.action}
              accessibilityLabel={t('home:next.joinA11y', { title: meeting.title })}
              testID={`${testID}-join`}
            >
              {t('home:next.join')}
            </MGButton>
          ) : (
            <MGButton
              variant="filled"
              size="sm"
              icon="information-outline"
              onPress={() => onOpen(meeting)}
              style={styles.action}
              accessibilityLabel={t('home:next.detailsA11y', { title: meeting.title })}
              testID={`${testID}-details`}
            >
              {t('home:next.details')}
            </MGButton>
          )}
        </View>
      </View>
    </View>
  );
}

function AllDayBlock({ meeting, onOpen }: { meeting: Meeting; onOpen(meeting: Meeting): void }): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const fmt = useFormatters();
  return (
    <View style={styles.allDay} testID="next-all-day">
      <View style={styles.flex}>
        <Text variant="labelLarge" style={{ color: colors.primary }}>
          {t('home:next.allDayTitle')}
        </Text>
        <Text variant="titleMedium" style={styles.allDayTitle} numberOfLines={2} testID="next-all-day-title">
          {meeting.title}
        </Text>
        <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
          {fmt.meetingRange(meeting)}
        </Text>
      </View>
      <MGButton
        variant="ghost"
        size="sm"
        onPress={() => onOpen(meeting)}
        accessibilityLabel={t('home:next.detailsA11y', { title: meeting.title })}
        testID="next-all-day-details"
      >
        {t('home:next.details')}
      </MGButton>
    </View>
  );
}

export function NextMeetingCard({ current, next, nextAllDay, onOpen, onJoin }: NextMeetingCardProps): ReactElement {
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

  if (!current && !next && !nextAllDay) {
    return (
      <Card style={styles.emptyCard} testID="next-meeting-card">
        <View style={[styles.emptyIcon, { backgroundColor: colors.primaryContainer }]}>
          <Icon name="calendar" size={componentMetrics.iconInline} color={colors.onPrimaryContainer} />
        </View>
        <View style={styles.flex}>
          <Text variant="titleMedium">{t('home:next.none')}</Text>
          <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
            {t('home:next.noneHint')}
          </Text>
        </View>
      </Card>
    );
  }

  const divider = { backgroundColor: colors.outlineVariant };

  return (
    <Card testID="next-meeting-card">
      {current ? (
        <MeetingBlock meeting={current} label={t('home:next.current')} countdown={endsText(current, now, t, fmt)} running now={now} onOpen={onOpen} onJoin={onJoin} testID="current-meeting" />
      ) : null}
      {current && next ? <View style={[styles.divider, divider]} /> : null}
      {next ? (
        <MeetingBlock meeting={next} label={t('home:next.title')} countdown={startsText(next, now, t, fmt)} running={false} now={now} onOpen={onOpen} onJoin={onJoin} testID="next-meeting" />
      ) : null}
      {nextAllDay && (current || next) ? <View style={[styles.divider, divider]} /> : null}
      {nextAllDay ? <AllDayBlock meeting={nextAllDay} onOpen={onOpen} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  title: {
    marginTop: spacing.xs,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  metaText: {
    marginLeft: spacing.xs,
    flex: 1,
  },
  track: {
    height: 4,
    borderRadius: radii.full,
    marginTop: spacing.md,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radii.full,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  countdown: {
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  action: {
    marginLeft: spacing.xs,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: spacing.lg,
  },
  allDay: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  allDayTitle: {
    marginTop: spacing.xs,
  },
  emptyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  emptyIcon: {
    width: componentMetrics.avatarSize,
    height: componentMetrics.avatarSize,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
