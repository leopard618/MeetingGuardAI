/**
 * Next meeting card: the meeting happening now (if any) and the next one, each with a live
 * countdown (every second in the last hour, every 30 s otherwise), a Join button only when the
 * meeting has a real http(s) link, and a Details button. Below them, the next all-day item
 * (birthday, holiday) when it comes no later than the next timed meeting.
 *
 * MG Indigo (2026-11-01, dark reference style): THE focal card is a surface card (charcoal in
 * dark, white in light) with faint orbit rings, an accent label, the title, a "route" row (now ->
 * start, or start -> end while running) joined by a dashed line with an icon in the middle (the
 * elapsed share fills the line in accent while the meeting runs), the countdown in accent titleL,
 * the first participants as initials, and ONE accent-filled button (Join when there is a link,
 * else Details; Details becomes ghost next to Join). The "no upcoming meetings" variant is the
 * same card with an icon row.
 */
import { useState, type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { Card, Icon, MGButton, OrbitRings, type IconName } from '../../components/ui';
import type { TranslateFn } from '../../core/contracts';
import type { Meeting, Participant } from '../../core/types';
import { useT } from '../../i18n';
import { componentMetrics, radii, spacing, useAppTheme, withAlpha } from '../../theme';
import { formatRelative } from '../../utils/format';
import { endMs, meetingJoinLink, startMs } from '../insights/meetingInsights';
import { useFormatters, type Formatters } from '../shared/useFormatters';
import { CLOCK_THRESHOLD_SECONDS, countdownDisplay, countdownTickMs, countdownTo, elapsedFraction, formatCountdownClock, participantInitial } from './homeModel';
import { useLiveNow } from '../shared/useLiveNow';

export interface NextMeetingCardProps {
  current: Meeting | null;
  next: Meeting | null;
  nextAllDay: Meeting | null;
  onOpen(meeting: Meeting): void;
  onJoin(url: string): void;
}

const MAX_FACES = 3;
const FACE = 28;
const DASHES = 14;

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

/** Dashed line between the two route points; `progress` (0..1) fills it in accent from the left. */
function RouteLine({ icon, progress, testID }: { icon: IconName; progress: number | null; testID?: string }): ReactElement {
  const { colors } = useAppTheme();
  const filled = progress === null ? 0 : Math.round(Math.min(1, Math.max(0, progress)) * DASHES);
  return (
    <View style={styles.routeLine} testID={testID}>
      <View style={styles.dashes}>
        {Array.from({ length: DASHES }, (_, index) => (
          <View key={index} style={[styles.dash, { backgroundColor: index < filled ? colors.primary : colors.outline }]} />
        ))}
      </View>
      <View style={[styles.routeIcon, { backgroundColor: colors.primaryContainer, borderColor: colors.surface }]}>
        <Icon name={icon} size={componentMetrics.iconMeta} color={colors.onPrimaryContainer} />
      </View>
    </View>
  );
}

function RoutePoint({ label, value, align }: { label: string; value: string; align: 'left' | 'right' }): ReactElement {
  const { colors } = useAppTheme();
  const alignStyle = align === 'right' ? styles.alignRight : null;
  return (
    <View style={styles.routePoint}>
      <Text variant="labelSmall" style={[alignStyle, { color: colors.onSurfaceVariant }]}>
        {label}
      </Text>
      <Text variant="titleSmall" style={[styles.routeValue, alignStyle]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function Faces({ participants }: { participants: readonly Participant[] }): ReactElement | null {
  const t = useT();
  const { colors } = useAppTheme();
  if (participants.length === 0) return null;
  const shown = participants.slice(0, MAX_FACES);
  const extra = participants.length - shown.length;
  return (
    <View style={styles.faces} accessible accessibilityLabel={t('home:next.participants', { count: participants.length })} testID="next-meeting-faces">
      {shown.map((participant, index) => (
        <View key={participant.email} style={[styles.face, index > 0 && styles.faceOverlap, { backgroundColor: colors.secondaryContainer, borderColor: colors.surface }]}>
          <Text variant="labelSmall" style={{ color: colors.onSecondaryContainer }}>
            {participantInitial(participant)}
          </Text>
        </View>
      ))}
      {extra > 0 ? (
        <Text variant="labelMedium" style={[styles.facesMore, { color: colors.onSurfaceVariant }]}>
          +{extra}
        </Text>
      ) : null}
    </View>
  );
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
  /** The meeting happening now: route = started -> ends, line filled by the elapsed share. */
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
  const end = new Date(endMs(meeting));

  return (
    <View testID={testID}>
      <View style={styles.labelRow}>
        <Text variant="labelLarge" style={{ color: colors.primary }}>
          {label}
        </Text>
        {address ? (
          <View style={styles.placeRow}>
            <Icon name="place" size={componentMetrics.iconMeta} color={colors.onSurfaceVariant} />
            <Text variant="labelMedium" style={[styles.placeText, { color: colors.onSurfaceVariant }]} numberOfLines={1}>
              {address}
            </Text>
          </View>
        ) : null}
      </View>
      <Text variant="titleLarge" style={styles.title} numberOfLines={2} testID={`${testID}-title`}>
        {meeting.title}
      </Text>
      <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
        {fmt.meetingRange(meeting)}
      </Text>

      {!meeting.allDay ? (
        <View style={styles.route}>
          <RoutePoint label={t(running ? 'home:next.started' : 'home:next.now')} value={fmt.time(running ? meeting.startAt : now)} align="left" />
          <RouteLine icon={link ? 'video' : 'calendar'} progress={progress} testID={running ? `${testID}-progress` : undefined} />
          <RoutePoint label={t(running ? 'home:next.ends' : 'home:next.starts')} value={fmt.time(running ? end : meeting.startAt)} align="right" />
        </View>
      ) : null}

      <View style={styles.footer}>
        <View style={styles.flex}>
          <Text variant="titleLarge" style={[styles.countdown, { color: colors.primary }]} testID={`${testID}-countdown`}>
            {countdown}
          </Text>
          <Faces participants={meeting.participants} />
        </View>
        <View style={styles.actions}>
          {link ? (
            <MGButton
              variant="ghost"
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
        <View style={[styles.emptyIcon, { backgroundColor: withAlpha(colors.primary, 0.14) }]}>
          <Icon name="calendar" size={componentMetrics.iconInline} color={colors.primary} />
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
    <Card style={styles.card} testID="next-meeting-card">
      <OrbitRings color={colors.primary} size={320} count={4} intensity={0.22} style={styles.rings} />
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
  card: {
    overflow: 'hidden',
  },
  rings: {
    top: -190,
    right: -140,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  placeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
  },
  placeText: {
    marginLeft: spacing.xs,
    flexShrink: 1,
  },
  title: {
    marginTop: spacing.sm,
  },
  route: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  routePoint: {
    minWidth: 64,
  },
  routeValue: {
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  alignRight: {
    textAlign: 'right',
  },
  routeLine: {
    flex: 1,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dashes: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dash: {
    width: 6,
    height: 2,
    borderRadius: radii.full,
  },
  routeIcon: {
    width: 28,
    height: 28,
    borderRadius: radii.full,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  countdown: {
    fontVariant: ['tabular-nums'],
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
  faces: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  face: {
    width: FACE,
    height: FACE,
    borderRadius: radii.full,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  faceOverlap: {
    marginLeft: -spacing.sm,
  },
  facesMore: {
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
