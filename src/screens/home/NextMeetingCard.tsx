/**
 * Next meeting card: the meeting happening now (if any) and the next one, each with a live
 * countdown (every second in the last hour, every 30 s otherwise), a Join button only when the
 * meeting has a real http(s) link, and a Details button.
 */
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState, type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text, useTheme as usePaperTheme } from 'react-native-paper';

import type { TranslateFn } from '../../core/contracts';
import type { Meeting } from '../../core/types';
import { useT } from '../../i18n';
import { formatRelative } from '../../utils/format';
import { endMs, meetingJoinLink, startMs } from '../insights/meetingInsights';
import { Section } from '../shared/Section';
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
  const theme = usePaperTheme();
  const fmt = useFormatters();
  const link = meetingJoinLink(meeting);
  const address = meeting.location?.address?.trim() ?? '';

  return (
    <View testID={testID}>
      <Text variant="labelLarge" style={{ color: theme.colors.primary }}>
        {label}
      </Text>
      <Text variant="titleLarge" style={styles.title} numberOfLines={2} testID={`${testID}-title`}>
        {meeting.title}
      </Text>
      <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
        {fmt.meetingRange(meeting)}
      </Text>
      {address ? (
        <View style={styles.placeRow}>
          <MaterialCommunityIcons name="map-marker-outline" size={16} color={theme.colors.onSurfaceVariant} />
          <Text variant="bodySmall" style={[styles.placeText, { color: theme.colors.onSurfaceVariant }]} numberOfLines={1}>
            {address}
          </Text>
        </View>
      ) : null}
      <Text variant="titleMedium" style={[styles.countdown, { color: theme.colors.primary }]} testID={`${testID}-countdown`}>
        {countdown}
      </Text>
      <View style={styles.actions}>
        {link ? (
          <Button
            mode="contained"
            icon="video"
            onPress={() => onJoin(link)}
            style={styles.action}
            accessibilityLabel={t('home:next.joinA11y', { title: meeting.title })}
            testID={`${testID}-join`}
          >
            {t('home:next.join')}
          </Button>
        ) : null}
        <Button
          mode={link ? 'outlined' : 'contained-tonal'}
          icon="information-outline"
          onPress={() => onOpen(meeting)}
          style={styles.action}
          accessibilityLabel={t('home:next.detailsA11y', { title: meeting.title })}
          testID={`${testID}-details`}
        >
          {t('home:next.details')}
        </Button>
      </View>
    </View>
  );
}

export function NextMeetingCard({ current, next, onOpen, onJoin }: NextMeetingCardProps): ReactElement {
  const t = useT();
  const theme = usePaperTheme();
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
      <Section testID="next-meeting-card">
        <Text variant="labelLarge" style={{ color: theme.colors.primary }}>
          {t('home:next.title')}
        </Text>
        <Text variant="titleMedium" style={styles.title}>
          {t('home:next.none')}
        </Text>
        <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
          {t('home:next.noneHint')}
        </Text>
      </Section>
    );
  }

  return (
    <Section testID="next-meeting-card">
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
      {current && next ? <View style={[styles.divider, { backgroundColor: theme.colors.outlineVariant }]} /> : null}
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
    </Section>
  );
}

const styles = StyleSheet.create({
  title: {
    marginTop: 4,
    marginBottom: 2,
  },
  placeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  placeText: {
    marginLeft: 4,
    flex: 1,
  },
  countdown: {
    marginTop: 8,
    fontVariant: ['tabular-nums'],
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  action: {
    marginRight: 8,
    marginTop: 4,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 12,
  },
});
