/**
 * Next meeting card (the client's mockup, November 1, 2026): a white card pulled up over the
 * hero. Left column: "NEXT MEETING" in spaced capitals (primary), the title, a meta row with the
 * date, the time range and "Online" (when the meeting has a link) or the place, then the first
 * participants as initials with "+N". Right column, behind a vertical divider: "Starts in" (or
 * "Ends in") small, the time left large in primary, and the one filled button (Join when there
 * is a link, else Details) with a chevron. A thin elapsed bar sits under the left column while a
 * meeting runs. The mockup's 3D calendar (DASHBOARD_ART.nextMeeting) sits top-right when its
 * picture exists.
 *
 * The meeting happening now (if any) and the next one are two blocks separated by a hairline;
 * below them the next all-day item (birthday, holiday) when it comes no later than the next
 * timed meeting. Countdowns tick every second in the last hour, every 30 s otherwise. The "no
 * upcoming meetings" variant is the same card with an icon row.
 */
import { useState, type ReactElement } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { Card, Icon, MGButton } from '../../components/ui';
import type { TranslateFn } from '../../core/contracts';
import type { Meeting, Participant } from '../../core/types';
import { useT } from '../../i18n';
import { componentMetrics, radii, spacing, typography, useAppTheme, withAlpha } from '../../theme';
import { formatRelative } from '../../utils/format';
import { DASHBOARD_ART } from './dashboardArt';
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

export interface CountdownParts {
  /** "Starts in" / "Ends in" / "Starts" ('' for "Starting now"). */
  label: string;
  /** "4:05" / "2 h 5 min" / "tomorrow" / "Starting now". */
  value: string;
}

const MAX_FACES = 3;
const FACE = 32;

function relativeText(value: string, fmt: Formatters, now: Date): string {
  try {
    return formatRelative(value, { ...fmt.options, now });
  } catch {
    return fmt.dateTime(value);
  }
}

/** Countdown to the start: "Starts in" + "4:05" / "2 h 5 min", "Starts" + "tomorrow", or "Starting now". */
export function startsParts(meeting: Meeting, now: Date, t: TranslateFn, fmt: Formatters): CountdownParts {
  const display = countdownDisplay(startMs(meeting), now.getTime());
  switch (display.kind) {
    case 'now':
      return { label: '', value: t('home:next.startingNow') };
    case 'clock':
      return { label: t('home:next.startsInLabel'), value: display.text };
    case 'duration':
      return { label: t('home:next.startsInLabel'), value: fmt.duration(display.minutes) };
    case 'relative':
      return { label: t('home:next.startsLabel'), value: relativeText(meeting.startAt, fmt, now) };
  }
}

/** Countdown to the end: "Ends in" + "12:03" / "1 h 10 min" (a ticking clock in the last hour). */
export function endsParts(meeting: Meeting, now: Date, t: TranslateFn, fmt: Formatters): CountdownParts {
  const left = countdownTo(endMs(meeting), now.getTime());
  const value =
    left.totalSeconds < CLOCK_THRESHOLD_SECONDS ? formatCountdownClock(left) : fmt.duration(Math.ceil(left.totalSeconds / 60));
  return { label: t('home:next.endsInLabel'), value };
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
          <Text variant="labelMedium" style={{ color: colors.onSecondaryContainer }}>
            {participantInitial(participant)}
          </Text>
        </View>
      ))}
      {extra > 0 ? (
        <View style={[styles.face, styles.faceOverlap, { backgroundColor: colors.secondaryContainer, borderColor: colors.surface }]}>
          <Text variant="labelMedium" style={{ color: colors.onSecondaryContainer }}>
            +{extra}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function Meta({ icon, text }: { icon: 'calendar' | 'clock' | 'video' | 'place'; text: string }): ReactElement {
  const { colors } = useAppTheme();
  return (
    <View style={styles.meta}>
      <Icon name={icon} size={componentMetrics.iconMeta} color={colors.onSurfaceVariant} />
      <Text variant="bodySmall" style={[styles.metaText, { color: colors.onSurfaceVariant }]} numberOfLines={1}>
        {text}
      </Text>
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
  countdown: CountdownParts;
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
  // "Mon, Nov 2 · 4:00 - 5:00 PM": the day label and the clock range come from the one range formatter.
  const range = fmt.meetingRange(meeting);
  const split = range.indexOf(' · ');
  // A meeting that crosses midnight (or an all-day one) has no separator: show the range once.
  const dateText = split > 0 ? range.slice(0, split) : range;
  const rangeText = split > 0 ? range.slice(split + 3) : null;

  return (
    <View style={styles.block} testID={testID}>
      <View style={styles.left}>
        <Text style={[styles.label, { color: colors.primary }]} maxFontSizeMultiplier={1.3}>
          {label.toUpperCase()}
        </Text>
        <Text variant="headlineSmall" style={styles.title} numberOfLines={2} testID={`${testID}-title`}>
          {meeting.title}
        </Text>
        <View style={styles.metaRow}>
          <Meta icon="calendar" text={dateText} />
          {rangeText ? <Meta icon="clock" text={rangeText} /> : null}
          {link ? <Meta icon="video" text={t('home:next.online')} /> : address ? <Meta icon="place" text={address} /> : null}
        </View>
        <Faces participants={meeting.participants} />
        {progress !== null ? (
          <View style={[styles.track, { backgroundColor: withAlpha(colors.primary, 0.18) }]} testID={`${testID}-progress`}>
            <View style={[styles.fill, { backgroundColor: colors.primary, width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` }]} />
          </View>
        ) : null}
      </View>
      <View style={[styles.divider, { backgroundColor: colors.outlineVariant }]} />
      <View style={styles.right}>
        {countdown.label ? (
          <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }} numberOfLines={1} testID={`${testID}-countdown-label`}>
            {countdown.label}
          </Text>
        ) : null}
        <Text style={[styles.countdown, { color: colors.primary }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} maxFontSizeMultiplier={1.2} testID={`${testID}-countdown`}>
          {countdown.value}
        </Text>
        {link ? (
          <MGButton
            variant="filled"
            size="sm"
            icon="video"
            onPress={() => onJoin(link)}
            style={styles.button}
            accessibilityLabel={t('home:next.joinA11y', { title: meeting.title })}
            testID={`${testID}-join`}
          >
            {t('home:next.join')}
          </MGButton>
        ) : (
          <MGButton
            variant="filled"
            size="sm"
            icon="play-circle-outline"
            onPress={() => onOpen(meeting)}
            style={styles.button}
            accessibilityLabel={t('home:next.detailsA11y', { title: meeting.title })}
            testID={`${testID}-details`}
          >
            {t('home:next.details')}
          </MGButton>
        )}
        {link ? (
          <MGButton
            variant="ghost"
            size="sm"
            onPress={() => onOpen(meeting)}
            style={styles.secondary}
            accessibilityLabel={t('home:next.detailsA11y', { title: meeting.title })}
            testID={`${testID}-details`}
          >
            {t('home:next.details')}
          </MGButton>
        ) : null}
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
        <Text style={[styles.label, { color: colors.primary }]}>{t('home:next.allDayTitle').toUpperCase()}</Text>
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

  const separator = { backgroundColor: colors.outlineVariant };

  return (
    <Card style={styles.card} testID="next-meeting-card">
      {DASHBOARD_ART.nextMeeting ? (
        <Image source={DASHBOARD_ART.nextMeeting} style={styles.decoration} resizeMode="contain" accessibilityIgnoresInvertColors />
      ) : null}
      {current ? (
        <MeetingBlock meeting={current} label={t('home:next.current')} countdown={endsParts(current, now, t, fmt)} running now={now} onOpen={onOpen} onJoin={onJoin} testID="current-meeting" />
      ) : null}
      {current && next ? <View style={[styles.separator, separator]} /> : null}
      {next ? (
        <MeetingBlock meeting={next} label={t('home:next.title')} countdown={startsParts(next, now, t, fmt)} running={false} now={now} onOpen={onOpen} onJoin={onJoin} testID="next-meeting" />
      ) : null}
      {nextAllDay && (current || next) ? <View style={[styles.separator, separator]} /> : null}
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
    padding: spacing.lg,
  },
  decoration: {
    position: 'absolute',
    top: -12,
    right: -8,
    width: 112,
    height: 112,
  },
  block: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  left: {
    flex: 1,
    paddingRight: spacing.md,
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    marginVertical: spacing.xs,
  },
  right: {
    width: 148,
    paddingLeft: spacing.md,
    paddingTop: spacing.xxl,
    justifyContent: 'flex-end',
  },
  label: {
    ...typography.labelM,
    letterSpacing: 2,
  },
  title: {
    marginTop: spacing.xs,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.sm,
    columnGap: spacing.md,
    rowGap: spacing.xs,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metaText: {
    marginLeft: spacing.xs,
    flexShrink: 1,
  },
  faces: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
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
    marginLeft: -spacing.xs,
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
  countdown: {
    ...typography.headlineS,
    fontVariant: ['tabular-nums'],
  },
  button: {
    marginTop: spacing.sm,
    alignSelf: 'stretch',
  },
  secondary: {
    marginTop: spacing.xs,
    alignSelf: 'stretch',
  },
  separator: {
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
