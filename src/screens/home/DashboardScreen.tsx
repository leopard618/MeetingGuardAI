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
 */
import type { StackScreenProps } from '@react-navigation/stack';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { FlatList, Linking, StyleSheet, View, type ListRenderItem } from 'react-native';
import { ActivityIndicator, Button, Text, useTheme as usePaperTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

import type { RootStackParamList } from '../../core/contracts';
import { errorMessageKey, toAppError } from '../../core/errors';
import { createLogger } from '../../core/logger';
import { getDeviceTimeZone, getZonedParts } from '../../core/time';
import type { Meeting } from '../../core/types';
import { useLanguage, useT } from '../../i18n';
import { useAuth } from '../../services/auth';
import { calendarSyncEngine } from '../../services/calendar';
import { useMeetings, usePreferences } from '../../services/data';
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

/** How far the dashboard expands recurring meetings: today's timeline + a year for "next". */
const DASHBOARD_PAST_DAYS = 1;
const DASHBOARD_FUTURE_DAYS = 370;

function Greeting({ now, timeZone }: { now: Date; timeZone: string }): ReactElement {
  const t = useT();
  const theme = usePaperTheme();
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
      <Text variant="headlineSmall" accessibilityRole="header" testID="dashboard-greeting">
        {name ? t(`home:greeting.${period}`, { name }) : t(`home:greeting.${period}NoName`)}
      </Text>
      <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
        {capitalizeFirst(fmt.date(now, 'full'))}
      </Text>
    </View>
  );
}

export function DashboardScreen({ navigation }: Props): ReactElement {
  const t = useT();
  const theme = usePaperTheme();
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
  const summary = useMemo(() => computeDashboardSummary(meetings, context), [meetings, context]);
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
        <View style={[styles.errorBox, { backgroundColor: theme.colors.errorContainer }]} accessibilityRole="alert" testID="dashboard-error">
          <Text variant="bodyMedium" style={{ color: theme.colors.onErrorContainer }}>
            {t('home:loadError', { reason: t(errorMessageKey(error.code)) })}
          </Text>
          <Button mode="text" compact onPress={() => void onRefresh()} textColor={theme.colors.onErrorContainer}>
            {t('common:actions.retry')}
          </Button>
        </View>
      ) : null}
      {showData ? <NextMeetingCard current={current} next={next} onOpen={openMeeting} onJoin={join} /> : null}
      <QuickActions onNewManual={() => navigation.navigate('CreateMeeting')} onNewWithAi={() => navigation.navigate('AIChat')} />
      {loadFailed ? null : (
        <View style={styles.sectionHeader}>
          <Text variant="titleMedium" accessibilityRole="header">
            {t('home:today.title')}
          </Text>
          {showData ? (
            <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }} testID="today-count">
              {t('home:today.count', { count: summary.today.count })}
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );

  const empty = isLoading ? (
    <View style={styles.loading} testID="dashboard-loading">
      <ActivityIndicator />
      <Text variant="bodyMedium" style={[styles.loadingText, { color: theme.colors.onSurfaceVariant }]}>
        {t('home:loading')}
      </Text>
    </View>
  ) : loadFailed ? null : (
    <View style={[styles.empty, { borderColor: theme.colors.outlineVariant }]} testID="today-empty">
      <Text variant="titleSmall">{t('home:today.empty')}</Text>
      <Text variant="bodySmall" style={[styles.emptyHint, { color: theme.colors.onSurfaceVariant }]}>
        {t('home:today.emptyHint')}
      </Text>
      <Button mode="contained-tonal" icon="plus" onPress={() => navigation.navigate('CreateMeeting')}>
        {t('home:today.create')}
      </Button>
    </View>
  );

  const footer = isLoading ? null : (
    <View style={styles.footer}>
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
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
      testID="dashboard-list"
    />
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  greeting: {
    marginBottom: 12,
  },
  errorBox: {
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  loading: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  loadingText: {
    marginTop: 12,
  },
  empty: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
    padding: 20,
  },
  emptyHint: {
    marginTop: 4,
    marginBottom: 12,
    textAlign: 'center',
  },
  footer: {
    marginTop: 16,
  },
});
