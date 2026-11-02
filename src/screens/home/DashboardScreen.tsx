/**
 * Dashboard (route "Dashboard", the Main group's first screen), laid out after the client's mockup
 * of November 1, 2026:
 * - the hero (DashboardHero): deep-blue block with the screen's own header row (menu, logo and
 *   wordmark, language pill) and the greeting (day part, first name, date); the stack header is
 *   hidden on this screen;
 * - the next-meeting card pulled up over the hero: the meeting happening now (if any) and the
 *   next one with a live countdown, Join (real links only) and Details;
 * - one row: the tasks card (left) beside the 2 x 2 quick actions (right);
 * - "Today": the timeline with overlaps and back-to-back meetings highlighted, or one empty card
 *   with a New meeting button;
 * - "Your week": the weekly summary (bars, this week vs. last week, what deserves a look);
 * - the "Ask the assistant" banner.
 * Pull to refresh flushes the outbox, re-reads the meetings and runs a calendar sync. A load
 * failure with nothing cached shows ErrorState; cached content + failure shows an error Banner
 * (ARCHITECTURE §13). No decoration beyond the mockup, no motion.
 */
import type { StackScreenProps } from '@react-navigation/stack';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { FlatList, Linking, StyleSheet, View, type ListRenderItem } from 'react-native';
import { Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

import { Banner, Card, ErrorState, Icon, MGButton, Skeleton } from '../../components/ui';
import type { RootStackParamList } from '../../core/contracts';
import { errorMessageKey, toAppError } from '../../core/errors';
import { createLogger } from '../../core/logger';
import { addDaysToLocalDate, getDeviceTimeZone, getZonedParts, todayInZone } from '../../core/time';
import type { Meeting, Task } from '../../core/types';
import { useLanguage, useT } from '../../i18n';
import { useAuth } from '../../services/auth';
import { calendarSyncEngine } from '../../services/calendar';
import { useMeetings, useTasks } from '../../services/data';
import { componentMetrics, radii, spacing, typography, useAppTheme } from '../../theme';
import { computeDashboardSummary, computePeriodInsights, weekStartForLanguage, type InsightContext, type LoadSummary } from '../insights/meetingInsights';
import { capitalizeFirst } from '../shared/text';
import { useFormatters } from '../shared/useFormatters';
import { AssistantBanner } from './AssistantBanner';
import { CARD_OVERLAP, DashboardHero } from './DashboardHero';
import { displayKeyOf, displayWindowForDays, expandMeetingsForDisplay } from '../meetings/occurrences';
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
 * How far the dashboard expands recurring meetings: the week card compares this calendar week
 * with the previous one (up to 13 days back), today's timeline needs today, and "next" up to a
 * year ahead.
 */
const DASHBOARD_PAST_DAYS = 14;
const DASHBOARD_FUTURE_DAYS = 370;
const DAY_MS = 86_400_000;

/** "Good morning" (day part in the UI language) and the first name for the hero. */
export function greetingParts(now: Date, timeZone: string, displayName: string | null | undefined, t: ReturnType<typeof useT>): { salute: string; name: string | null } {
  let hour = now.getHours();
  try {
    hour = getZonedParts(now, timeZone).hour;
  } catch {
    // Keep the runtime's hour.
  }
  return { salute: t(`home:greeting.${dayPeriodOf(hour)}NoName`), name: firstNameOf(displayName) };
}

function SectionTitle({ title, trailing }: { title: string; trailing?: ReactNode }): ReactElement {
  const { colors } = useAppTheme();
  return (
    <View style={styles.sectionTitle}>
      <Text style={[styles.sectionTitleText, { color: colors.onSurface }]} accessibilityRole="header">
        {title}
      </Text>
      {trailing ?? null}
    </View>
  );
}

export function DashboardScreen({ navigation }: Props): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { language } = useLanguage();
  const { meetings, isLoading, error, refresh } = useMeetings();
  const { tasks, update: updateTask } = useTasks();
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
  // Per-day load of the current week for the week card's chart, and last week for the comparison.
  const week = useMemo(() => computePeriodInsights(displayMeetings, 'week', context), [displayMeetings, context]);
  const lastWeek = useMemo<LoadSummary>(() => {
    const previous = computePeriodInsights(displayMeetings, 'week', { ...context, now: new Date(context.now.getTime() - 7 * DAY_MS) });
    return { count: previous.count, minutes: previous.totalMinutes };
  }, [displayMeetings, context]);
  const { current, next } = useMemo(() => findNowAndNext(displayMeetings, now), [displayMeetings, now]);
  const nextAllDay = useMemo(() => findNextAllDay(displayMeetings, context, next), [displayMeetings, context, next]);
  // Nothing could be read (first launch offline, permission denied): say so instead of showing
  // "no meetings" empty states next to the error (a failure is not an empty list).
  const loadFailed = error !== null && !isLoading && meetings.length === 0;
  const showData = !isLoading && !loadFailed;

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
    ({ item, index }) => <TodayTimelineRow item={item} isLast={index === timeline.length - 1} onOpen={openMeeting} />,
    [openMeeting, timeline.length],
  );

  const greeting = greetingParts(now, timeZone, authUser?.displayName, t);
  const header = (
    <View>
      <DashboardHero salute={greeting.salute} name={greeting.name} dateText={capitalizeFirst(fmt.date(now, 'full'))} />
      <View style={styles.overlap}>
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
        {showData ? <NextMeetingCard current={current} next={next} nextAllDay={nextAllDay} onOpen={openMeeting} onJoin={join} /> : null}
        <View style={styles.split}>
          <TasksTodayCard
            tasks={tasks}
            now={now}
            deviceZone={timeZone}
            fmt={fmt}
            onToggle={completeTask}
            onOpenTasks={() => navigation.navigate('Tasks')}
            style={styles.tasksHalf}
          />
          <QuickActions
            onNewManual={() => navigation.navigate('CreateMeeting')}
            onNewWithAi={() => navigation.navigate('AIChat')}
            onWhatsApp={() => navigation.navigate('WhatsAppConnect')}
            onNotes={() => navigation.navigate('Notes')}
            style={styles.actionsHalf}
          />
        </View>
        {loadFailed ? null : (
          <SectionTitle
            title={t('home:today.title')}
            trailing={
              showData ? (
                <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }} testID="today-count">
                  {t('home:today.count', { count: summary.today.count })}
                </Text>
              ) : null
            }
          />
        )}
      </View>
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
    <Card style={styles.todayEmpty} testID="today-empty">
      <View style={[styles.todayEmptyIcon, { backgroundColor: colors.primaryContainer }]}>
        <Icon name="calendar" size={componentMetrics.iconNav} color={colors.primary} />
      </View>
      <View style={styles.todayEmptyTexts}>
        <Text variant="titleMedium" numberOfLines={1}>
          {t('home:today.empty')}
        </Text>
        <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }} numberOfLines={2}>
          {t('home:today.emptyHint')}
        </Text>
      </View>
      <MGButton variant="outline" size="sm" icon="plus" onPress={() => navigation.navigate('CreateMeeting')} testID="today-empty-action">
        {t('home:today.create')}
      </MGButton>
    </Card>
  );

  const footer = isLoading ? null : (
    <View>
      {loadFailed ? null : (
        <>
          <SectionTitle
            title={t('home:insights.title')}
            trailing={
              <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }} testID="week-meta">
                {`${t('home:insights.meetings', { count: summary.week.count })} · ${t('home:insights.total', { duration: fmt.duration(summary.week.minutes) })}`}
              </Text>
            }
          />
          <InsightsSummaryCard
            summary={summary}
            lastWeek={lastWeek}
            days={week.days}
            todayDate={todayKey}
            locale={language === 'es' ? 'es-ES' : 'en-US'}
            onSeeAll={() => navigation.navigate('AIInsights')}
          />
        </>
      )}
      <AssistantBanner onPress={() => navigation.navigate('AIChat')} />
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
  },
  overlap: {
    marginTop: -CARD_OVERLAP,
  },
  split: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  tasksHalf: {
    flex: 11,
  },
  actionsHalf: {
    flex: 9,
  },
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginTop: spacing.xxl,
    marginBottom: spacing.md,
  },
  sectionTitleText: {
    ...typography.headlineS,
    flexShrink: 1,
  },
  errorBanner: {
    marginBottom: spacing.md,
  },
  skeletonRow: {
    marginBottom: spacing.sm,
  },
  todayEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  todayEmptyIcon: {
    width: 48,
    height: 48,
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayEmptyTexts: {
    flex: 1,
  },
});
