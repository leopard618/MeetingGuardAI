/**
 * Dashboard (route "Dashboard", the Main group's first screen):
 * - greeting in the UI language, offline banner (data-layer connectivity, NetInfo-based);
 * - next meeting (and the one happening now) with a live countdown, Join (real links only) and
 *   Details;
 * - quick actions (new meeting, new with AI, WhatsApp "coming soon");
 * - today's timeline with overlaps and back-to-back meetings highlighted;
 * - alert status (switch, intensity, next alert, permission, exact alarms, Do Not Disturb) linking
 *   to Settings > Alerts;
 * - insights computed on the device, "Ask the assistant" and the full insights screen.
 * Pull to refresh flushes the outbox, re-reads the meetings and runs a calendar sync.
 *
 * MG Indigo hierarchy (2026-10-30 refresh): a big greeting (headlineL, date in bodyM) with no app
 * bar above it, three stat tiles (today / tasks due / this week), THE focal card on the primary
 * gradient (NextMeetingCard), everything else neutral elevated Cards under sentence-case
 * SectionHeaders; blocks and rows reveal with the kit's mount animation. A load failure with nothing
 * cached shows ErrorState; cached content + failure shows an error Banner (ARCHITECTURE §13).
 */
import type { StackScreenProps } from '@react-navigation/stack';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { FlatList, Linking, StyleSheet, View, type ListRenderItem } from 'react-native';
import { Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

import { Banner, EmptyState, ErrorState, Reveal, SectionHeader, Skeleton } from '../../components/ui';
import type { RootStackParamList } from '../../core/contracts';
import { errorMessageKey, toAppError } from '../../core/errors';
import { createLogger } from '../../core/logger';
import { addDaysToLocalDate, getDeviceTimeZone, getZonedParts, todayInZone } from '../../core/time';
import type { Meeting, Task } from '../../core/types';
import { useLanguage, useT } from '../../i18n';
import { useAuth } from '../../services/auth';
import { calendarSyncEngine } from '../../services/calendar';
import { useMeetings, usePreferences, useTasks } from '../../services/data';
import { componentMetrics, radii, spacing, useAppTheme } from '../../theme';
import { computeDashboardSummary, weekStartForLanguage, type InsightContext } from '../insights/meetingInsights';
import { capitalizeFirst } from '../shared/text';
import { useFormatters } from '../shared/useFormatters';
import { isDueToday } from '../tasks/tasksModel';
import { AlertStatusCard } from './AlertStatusCard';
import { displayKeyOf, displayWindowForDays, expandMeetingsForDisplay } from '../meetings/occurrences';
import { StatsRow } from './StatsRow';
import { buildTodayTimeline, dayPeriodOf, findNextAllDay, findNowAndNext, firstNameOf, type TimelineItem } from './homeModel';
import { InsightsSummaryCard } from './InsightsSummaryCard';
import { NextMeetingCard } from './NextMeetingCard';
import { OfflineBanner } from './OfflineBanner';
import { QuickActions } from './QuickActions';
import { TasksTodayCard } from './TasksTodayCard';
import { TodayTimelineRow } from './TodayTimelineRow';
import { useLiveNow } from '../shared/useLiveNow';

const log = createLogger('home');

type Props = StackScreenProps<RootStackParamList, 'Dashboard'>;

/**
 * How far the dashboard expands recurring meetings: the summary's "this week" needs the whole
 * calendar week (up to 6 days back), today's timeline needs today, and "next" up to a year ahead.
 */
const DASHBOARD_PAST_DAYS = 7;
const DASHBOARD_FUTURE_DAYS = 370;

/** "Good morning, Ana" in the UI language for the hour in `timeZone`. */
function greetingText(now: Date, timeZone: string, displayName: string | null | undefined, t: ReturnType<typeof useT>): string {
  const name = firstNameOf(displayName);
  let hour = now.getHours();
  try {
    hour = getZonedParts(now, timeZone).hour;
  } catch {
    // Keep the runtime's hour.
  }
  const period = dayPeriodOf(hour);
  return name ? t(`home:greeting.${period}`, { name }) : t(`home:greeting.${period}NoName`);
}

export function DashboardScreen({ navigation }: Props): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { language } = useLanguage();
  const { meetings, isLoading, error, refresh } = useMeetings();
  const { tasks, update: updateTask } = useTasks();
  const { preferences } = usePreferences();
  const { authUser } = useAuth();
  const fmt = useFormatters();
  const now = useLiveNow(30_000);
  const timeZone = getDeviceTimeZone();
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const context = useMemo<InsightContext>(() => ({ now, timeZone, weekStartsOn: weekStartForLanguage(language) }), [now, timeZone, language]);
  // Recurring meetings appear as their occurrences (today's timeline, next meeting; occurrences.ts).
  // The window only moves with the local DAY, so the expansion is keyed on it, not on the 30 s clock.
  const todayKey = todayInZone(timeZone, now);
  const displayWindow = useMemo(
    () => displayWindowForDays(addDaysToLocalDate(todayKey, -DASHBOARD_PAST_DAYS + 1), addDaysToLocalDate(todayKey, DASHBOARD_FUTURE_DAYS - 1), timeZone),
    [todayKey, timeZone],
  );
  const displayMeetings = useMemo(() => expandMeetingsForDisplay(meetings, displayWindow), [meetings, displayWindow]);
  const timeline = useMemo(() => buildTodayTimeline(displayMeetings, context), [displayMeetings, context]);
  // The summary counts the same occurrence rows the timeline shows (a weekly series counts every
  // occurrence of this week, not just its stored master).
  const summary = useMemo(() => computeDashboardSummary(displayMeetings, context), [displayMeetings, context]);
  const { current, next } = useMemo(() => findNowAndNext(displayMeetings, now), [displayMeetings, now]);
  const nextAllDay = useMemo(() => findNextAllDay(displayMeetings, context, next), [displayMeetings, context, next]);
  // Nothing could be read (first launch offline, permission denied): say so instead of showing
  // "no meetings" empty states next to the error (a failure is not an empty list).
  const loadFailed = error !== null && !isLoading && meetings.length === 0;
  const showData = !isLoading && !loadFailed;
  const tasksDue = useMemo(() => tasks.filter((task) => isDueToday(task, now, timeZone)).length, [tasks, now, timeZone]);

  const openMeeting = useCallback((meeting: Meeting) => navigation.navigate('MeetingDetails', { meetingId: meeting.id }), [navigation]);

  const completeTask = useCallback(
    (task: Task): void => {
      updateTask(task.id, { status: 'done' }).catch((caught: unknown) => {
        const failure = toAppError(caught);
        log.warn('could not complete a task from the dashboard', failure.code);
        Toast.show({ type: 'error', text1: t(errorMessageKey(failure.code)) });
      });
    },
    [updateTask, t],
  );

  const join = useCallback(
    (url: string) => {
      Linking.openURL(url).catch((caught: unknown) => {
        log.warn('could not open the meeting link', toAppError(caught).code);
        Toast.show({ type: 'error', text1: t('home:next.openLinkFailed') });
      });
    },
    [t],
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [data, calendar] = await Promise.allSettled([refresh(), calendarSyncEngine.syncNow({ reason: 'manual' })]);
      if (data.status === 'rejected') {
        const failure = toAppError(data.reason);
        log.warn('meeting refresh failed', failure.code);
        Toast.show({ type: 'error', text1: t('home:refresh.failed', { reason: t(errorMessageKey(failure.code)) }) });
      }
      const calendarCode =
        calendar.status === 'rejected' ? toAppError(calendar.reason).code : (calendar.value.errors[0]?.code ?? null);
      if (calendarCode !== null && calendarCode !== 'cancelled') {
        log.warn('calendar sync failed', calendarCode);
        Toast.show({ type: 'error', text1: t('home:refresh.calendarFailed', { reason: t(errorMessageKey(calendarCode)) }) });
      }
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }, [refresh, t]);

  const renderItem = useCallback<ListRenderItem<TimelineItem>>(
    ({ item, index }) => (
      <Reveal index={index}>
        <TodayTimelineRow item={item} isLast={index === timeline.length - 1} onOpen={openMeeting} />
      </Reveal>
    ),
    [openMeeting, timeline.length],
  );

  const header = (
    <View>
      <Reveal style={styles.greeting}>
        <Text variant="headlineLarge" accessibilityRole="header" numberOfLines={2} testID="dashboard-greeting">
          {greetingText(now, timeZone, authUser?.displayName, t)}
        </Text>
        <Text variant="bodyMedium" style={[styles.greetingDate, { color: colors.onSurfaceVariant }]}>
          {capitalizeFirst(fmt.date(now, 'full'))}
        </Text>
      </Reveal>
      <StatsRow
        meetingsToday={showData ? summary.today.count : null}
        tasksDue={showData ? tasksDue : null}
        meetingsThisWeek={showData ? summary.week.count : null}
      />
      <OfflineBanner />
      {error ? (
        loadFailed ? (
          <ErrorState body={t('home:loadError', { reason: t(errorMessageKey(error.code)) })} onRetry={() => void onRefresh()} testID="dashboard-error" />
        ) : (
          <Banner
            tone="error"
            text={t('home:loadError', { reason: t(errorMessageKey(error.code)) })}
            action={{ label: t('common:actions.retry'), onPress: () => void onRefresh() }}
            style={styles.errorBanner}
            testID="dashboard-error"
          />
        )
      ) : null}
      {showData ? (
        <Reveal delay={60}>
          <NextMeetingCard current={current} next={next} nextAllDay={nextAllDay} onOpen={openMeeting} onJoin={join} />
        </Reveal>
      ) : null}
      {showData ? (
        <Reveal delay={120}>
          <TasksTodayCard
            tasks={tasks}
            now={now}
            deviceZone={timeZone}
            fmt={fmt}
            onToggle={completeTask}
            onOpenTasks={() => navigation.navigate('Tasks')}
          />
        </Reveal>
      ) : null}
      <Reveal delay={180}>
        <QuickActions
          onNewManual={() => navigation.navigate('CreateMeeting')}
          onNewWithAi={() => navigation.navigate('AIChat')}
          onWhatsApp={() => navigation.navigate('WhatsAppConnect')}
        />
      </Reveal>
      {loadFailed ? null : (
        <SectionHeader
          title={t('home:today.title')}
          trailing={
            showData ? (
              <Text variant="labelMedium" style={{ color: colors.onSurfaceVariant }} testID="today-count">
                {t('home:today.count', { count: summary.today.count })}
              </Text>
            ) : null
          }
        />
      )}
    </View>
  );

  // First load: timeline-shaped skeletons (the layout is known - §8), announced as loading.
  const empty = isLoading ? (
    <View accessible accessibilityLabel={t('home:loading')} testID="dashboard-loading">
      <Skeleton width="100%" height={72} radius={radii.md} style={styles.skeletonRow} />
      <Skeleton width="100%" height={72} radius={radii.md} style={styles.skeletonRow} />
      <Skeleton width="100%" height={72} radius={radii.md} style={styles.skeletonRow} />
    </View>
  ) : loadFailed ? null : (
    <EmptyState
      icon="calendar-blank-outline"
      title={t('home:today.empty')}
      body={t('home:today.emptyHint')}
      action={{ label: t('home:today.create'), onPress: () => navigation.navigate('CreateMeeting') }}
      testID="today-empty"
    />
  );

  const footer = isLoading ? null : (
    <View>
      <AlertStatusCard preferences={preferences} meetings={meetings} now={now} onOpenSettings={() => navigation.navigate('AlertSettings')} />
      {loadFailed ? null : (
        <InsightsSummaryCard
          summary={summary}
          onAskAssistant={() => navigation.navigate('AIChat', { prefill: t('home:insights.askPrompt') })}
          onSeeAll={() => navigation.navigate('AIInsights')}
        />
      )}
    </View>
  );

  return (
    <FlatList
      data={showData ? timeline : []}
      keyExtractor={(item) => displayKeyOf(item.meeting)}
      renderItem={renderItem}
      ListHeaderComponent={header}
      ListEmptyComponent={empty}
      ListFooterComponent={footer}
      refreshing={refreshing}
      onRefresh={() => void onRefresh()}
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxl }]}
      testID="dashboard-list"
    />
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: componentMetrics.screenGutter,
    paddingTop: spacing.md,
  },
  greeting: {
    marginBottom: spacing.lg,
  },
  greetingDate: {
    marginTop: spacing.xs,
  },
  errorBanner: {
    marginBottom: spacing.md,
  },
  skeletonRow: {
    marginBottom: spacing.sm,
  },
});
