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
 * MG Indigo hierarchy: greeting headlineL, ONE focal card (NextMeetingCard, primaryContainer),
 * everything else neutral Cards under sentence-case SectionHeaders. A load failure with nothing
 * cached shows ErrorState; cached content + failure shows an error Banner (ARCHITECTURE §13).
 */
import type { StackScreenProps } from '@react-navigation/stack';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { FlatList, Linking, StyleSheet, View, type ListRenderItem } from 'react-native';
import { Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

import { Banner, EmptyState, ErrorState, SectionHeader, Skeleton } from '../../components/ui';
import type { RootStackParamList } from '../../core/contracts';
import { errorMessageKey, toAppError } from '../../core/errors';
import { createLogger } from '../../core/logger';
import { getDeviceTimeZone, getZonedParts } from '../../core/time';
import type { Meeting } from '../../core/types';
import { useLanguage, useT } from '../../i18n';
import { useAuth } from '../../services/auth';
import { calendarSyncEngine } from '../../services/calendar';
import { useMeetings, usePreferences } from '../../services/data';
import { componentMetrics, radii, spacing, useAppTheme } from '../../theme';
import { computeDashboardSummary, weekStartForLanguage, type InsightContext } from '../insights/meetingInsights';
import { capitalizeFirst } from '../shared/text';
import { useFormatters } from '../shared/useFormatters';
import { AlertStatusCard } from './AlertStatusCard';
import { displayKeyOf, displayWindowAround, expandMeetingsForDisplay } from '../meetings/occurrences';
import { buildTodayTimeline, dayPeriodOf, findNowAndNext, firstNameOf, type TimelineItem } from './homeModel';
import { InsightsSummaryCard } from './InsightsSummaryCard';
import { NextMeetingCard } from './NextMeetingCard';
import { OfflineBanner } from './OfflineBanner';
import { QuickActions } from './QuickActions';
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

function Greeting({ now, timeZone }: { now: Date; timeZone: string }): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const fmt = useFormatters();
  const { authUser } = useAuth();
  const name = firstNameOf(authUser?.displayName);
  let hour = now.getHours();
  try {
    hour = getZonedParts(now, timeZone).hour;
  } catch {
    // Keep the runtime's hour.
  }
  const period = dayPeriodOf(hour);
  return (
    <View style={styles.greeting}>
      <Text variant="headlineLarge" accessibilityRole="header" testID="dashboard-greeting">
        {name ? t(`home:greeting.${period}`, { name }) : t(`home:greeting.${period}NoName`)}
      </Text>
      <Text variant="bodyMedium" style={[styles.greetingDate, { color: colors.onSurfaceVariant }]}>
        {capitalizeFirst(fmt.date(now, 'full'))}
      </Text>
    </View>
  );
}

export function DashboardScreen({ navigation }: Props): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { language } = useLanguage();
  const { meetings, isLoading, error, refresh } = useMeetings();
  const { preferences } = usePreferences();
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
  const displayMeetings = useMemo(
    () => expandMeetingsForDisplay(meetings, displayWindowAround(now, timeZone, DASHBOARD_PAST_DAYS, DASHBOARD_FUTURE_DAYS)),
    [meetings, timeZone, now],
  );
  const timeline = useMemo(() => buildTodayTimeline(displayMeetings, context), [displayMeetings, context]);
  // The summary counts the same occurrence rows the timeline shows (a weekly series counts every
  // occurrence of this week, not just its stored master).
  const summary = useMemo(() => computeDashboardSummary(displayMeetings, context), [displayMeetings, context]);
  const { current, next } = useMemo(() => findNowAndNext(displayMeetings, now), [displayMeetings, now]);
  // Nothing could be read (first launch offline, permission denied): say so instead of showing
  // "no meetings" empty states next to the error (a failure is not an empty list).
  const loadFailed = error !== null && !isLoading && meetings.length === 0;
  const showData = !isLoading && !loadFailed;

  const openMeeting = useCallback((meeting: Meeting) => navigation.navigate('MeetingDetails', { meetingId: meeting.id }), [navigation]);

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

  const header = (
    <View>
      <Greeting now={now} timeZone={timeZone} />
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
      {showData ? <NextMeetingCard current={current} next={next} onOpen={openMeeting} onJoin={join} /> : null}
      <QuickActions onNewManual={() => navigation.navigate('CreateMeeting')} onNewWithAi={() => navigation.navigate('AIChat')} />
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

  // First load: timeline-shaped skeletons (the layout is known — §8), announced as loading.
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
    marginBottom: spacing.md,
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
