/**
 * Insights (route "AIInsights"): weekly / monthly numbers computed on the device from the
 * meetings (./meetingInsights): meetings, time in meetings, average length, busiest day, load by
 * day, where meetings come from, overlapping and back-to-back meetings, and upcoming meetings
 * worth a look. Optional AI suggestions through the assistant (explained first; they use the
 * daily AI limit).
 *
 * MG Indigo: two-column stat tiles (value headlineM tabular-nums), source rows with the §2
 * source-color dots, neutral Cards under sentence-case SectionHeaders. A load failure with
 * nothing cached shows ErrorState; cached content + failure shows an error Banner.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { StackScreenProps } from '@react-navigation/stack';
import { useMemo, useState, type ReactElement } from 'react';
import { Platform, Pressable, SectionList, StyleSheet, View, type SectionListData } from 'react-native';
import { SegmentedButtons, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

import { Banner, Card, EmptyState, ErrorState, SectionHeader, Skeleton } from '../../components/ui';
import type { RootStackParamList } from '../../core/contracts';
import { errorMessageKey, toAppError } from '../../core/errors';
import { createLogger } from '../../core/logger';
import { getDeviceTimeZone } from '../../core/time';
import type { Meeting } from '../../core/types';
import { useLanguage, useT } from '../../i18n';
import { useMeetings } from '../../services/data';
import {
  componentMetrics,
  pressedOpacity,
  radii,
  sourceColorIndex,
  spacing,
  stateAlpha,
  useAppTheme,
  withAlpha,
} from '../../theme';
import { OfflineBanner } from '../home/OfflineBanner';
import { useLiveNow } from '../shared/useLiveNow';
import { useFormatters } from '../shared/useFormatters';
import { displayWindowForDays, expandMeetingsForDisplay } from '../meetings/occurrences';
import { AiSuggestionsSection } from './AiSuggestionsSection';
import { LoadByDay } from './LoadByDay';
import {
  computePeriodInsights,
  periodRange,
  weekStartForLanguage,
  type InsightContext,
  type InsightPeriod,
  type MeetingPair,
  type PeriodInsights,
} from './meetingInsights';

const log = createLogger('insights');

type Props = StackScreenProps<RootStackParamList, 'AIInsights'>;

type PairSection = { key: 'overlaps' | 'backToBack'; title: string; hint: string | null; empty: string; data: MeetingPair[] };

function StatTile({ label, value, wide = false, testID }: { label: string; value: string; wide?: boolean; testID?: string }): ReactElement {
  const { colors } = useAppTheme();
  return (
    <Card style={[styles.tile, wide && styles.tileWide]} accessible accessibilityLabel={`${label}: ${value}`} testID={testID}>
      <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
        {label}
      </Text>
      <Text variant={wide ? 'titleMedium' : 'headlineMedium'} style={styles.tileValue}>
        {value}
      </Text>
    </Card>
  );
}

function Stats({ insights }: { insights: PeriodInsights }): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const fmt = useFormatters();
  const busiest = insights.busiestDay;
  return (
    <View>
      <View style={styles.tileGrid}>
        <StatTile label={t('insights:stats.meetings')} value={String(insights.count)} testID="stat-meetings" />
        <StatTile label={t('insights:stats.time')} value={fmt.duration(insights.totalMinutes)} testID="stat-time" />
        <StatTile
          label={t('insights:stats.average')}
          value={insights.averageMinutes === null ? t('insights:stats.averageNone') : fmt.duration(insights.averageMinutes)}
        />
        {busiest ? (
          <StatTile
            label={t('insights:stats.busiest')}
            value={t('insights:stats.busiestValue', {
              date: fmt.date(busiest.date, 'medium'),
              meetings: t('insights:meetings', { count: busiest.count }),
              duration: fmt.duration(busiest.minutes),
            })}
            wide
            testID="stat-busiest"
          />
        ) : null}
      </View>
      {insights.allDayCount > 0 ? (
        <Text variant="bodySmall" style={[styles.note, { color: colors.onSurfaceVariant }]}>
          {t('insights:stats.allDay', { count: insights.allDayCount })}
        </Text>
      ) : null}
    </View>
  );
}

function Sources({ insights }: { insights: PeriodInsights }): ReactElement | null {
  const t = useT();
  const { colors } = useAppTheme();
  if (insights.sources.length === 0) return null;
  return (
    <View>
      <SectionHeader title={t('insights:sources.title')} />
      <Card testID="insights-sources">
        {insights.sources.map((entry) => (
          <View key={entry.source} style={styles.sourceRow} accessible accessibilityLabel={`${t(`insights:sources.${entry.source}`)}: ${entry.count}`}>
            <View style={[styles.sourceDot, { backgroundColor: colors.chart[sourceColorIndex[entry.source]] }]} />
            <Text variant="bodyMedium" style={styles.flex}>
              {t(`insights:sources.${entry.source}`)}
            </Text>
            <Text variant="titleSmall" style={styles.sourceCount}>
              {String(entry.count)}
            </Text>
          </View>
        ))}
      </Card>
    </View>
  );
}

function Attention({ insights }: { insights: PeriodInsights }): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const missing = insights.missingPlace.length;
  const tips = insights.withTips.length;
  return (
    <View>
      <SectionHeader title={t('insights:attention.title')} />
      <Card testID="insights-attention">
        {missing > 0 ? (
          <View style={styles.issue}>
            <MaterialCommunityIcons name="map-marker-question-outline" size={18} color={colors.onSurfaceVariant} />
            <Text variant="bodyMedium" style={styles.issueText}>
              {t('insights:attention.missingPlace', { count: missing })}
            </Text>
          </View>
        ) : (
          <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
            {t('insights:attention.none')}
          </Text>
        )}
        {tips > 0 ? (
          <View style={styles.issue}>
            <MaterialCommunityIcons name="lightbulb-on-outline" size={18} color={colors.primary} />
            <Text variant="bodyMedium" style={styles.issueText}>
              {t('insights:attention.withTips', { count: tips })}
            </Text>
          </View>
        ) : null}
      </Card>
    </View>
  );
}

function PairRow({ pair, kind, onOpen }: { pair: MeetingPair; kind: PairSection['key']; onOpen(meeting: Meeting): void }): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const fmt = useFormatters();
  const text =
    kind === 'overlaps'
      ? t('insights:conflicts.pair', { first: pair.first.title, second: pair.second.title })
      : t('insights:backToBack.item', { first: pair.first.title, second: pair.second.title });
  return (
    <Card
      style={[styles.pair, kind === 'overlaps' && { borderColor: colors.error }]}
      testID={`pair-${kind}-${pair.first.id}-${pair.second.id}`}
    >
      <View style={styles.pairHeader}>
        <MaterialCommunityIcons
          name={kind === 'overlaps' ? 'alert-circle-outline' : 'timer-sand'}
          size={18}
          color={kind === 'overlaps' ? colors.error : colors.tertiary}
        />
        <Text variant="titleSmall" style={styles.issueText}>
          {text}
        </Text>
      </View>
      {[pair.first, pair.second].map((meeting) => (
        <Pressable
          key={meeting.id}
          onPress={() => onOpen(meeting)}
          accessibilityRole="button"
          accessibilityLabel={t('insights:conflicts.openA11y', { title: meeting.title })}
          hitSlop={4}
          android_ripple={{ color: withAlpha(colors.onSurface, stateAlpha.rippleOnRow) }}
          style={({ pressed }) => [styles.pairMeeting, pressed && Platform.OS !== 'android' && { opacity: pressedOpacity }]}
        >
          <View style={styles.flex}>
            <Text variant="bodyMedium" numberOfLines={1}>
              {meeting.title}
            </Text>
            <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
              {fmt.meetingRange(meeting)}
            </Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurfaceVariant} />
        </Pressable>
      ))}
    </Card>
  );
}

export function AIInsightsScreen({ navigation }: Props): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const fmt = useFormatters();
  const { language } = useLanguage();
  const { meetings, isLoading, error, refresh } = useMeetings();
  const [period, setPeriod] = useState<InsightPeriod>('week');
  const [retrying, setRetrying] = useState(false);
  const now = useLiveNow(60_000);
  const timeZone = getDeviceTimeZone();

  const context = useMemo<InsightContext>(
    () => ({ now, timeZone, weekStartsOn: weekStartForLanguage(language) }),
    [language, now, timeZone],
  );
  // Recurring meetings count per OCCURRENCE (a weekly series adds every occurrence of the period
  // to the counts, load chart and conflicts), so the expansion window matches the period's days.
  const insights = useMemo(() => {
    const range = periodRange(period, context);
    const expanded = expandMeetingsForDisplay(meetings, displayWindowForDays(range.from, range.to, timeZone));
    return computePeriodInsights(expanded, period, context);
  }, [context, meetings, period, timeZone]);

  const openMeeting = (meeting: Meeting): void => navigation.navigate('MeetingDetails', { meetingId: meeting.id });
  const hasMeetings = !isLoading && insights.count > 0;
  // Nothing could be read: show the failure (with Retry), not an empty period.
  const loadFailed = error !== null && !isLoading && meetings.length === 0;

  const retry = async (): Promise<void> => {
    setRetrying(true);
    try {
      await refresh();
    } catch (caught) {
      const failure = toAppError(caught);
      log.warn('meeting refresh failed', failure.code);
      Toast.show({ type: 'error', text1: t('insights:loadError', { reason: t(errorMessageKey(failure.code)) }) });
    } finally {
      setRetrying(false);
    }
  };

  const sections: PairSection[] = hasMeetings
    ? [
        { key: 'overlaps', title: t('insights:conflicts.title'), hint: null, empty: t('insights:conflicts.none'), data: insights.overlaps },
        {
          key: 'backToBack',
          title: t('insights:backToBack.title'),
          hint: t('insights:backToBack.hint'),
          empty: t('insights:backToBack.none'),
          data: insights.backToBack,
        },
      ]
    : [];

  const header = (
    <View>
      <OfflineBanner />
      <Text variant="bodySmall" style={[styles.subtitle, { color: colors.onSurfaceVariant }]}>
        {t('insights:subtitle')}
      </Text>
      <SegmentedButtons
        value={period}
        onValueChange={(value) => setPeriod(value as InsightPeriod)}
        buttons={[
          { value: 'week', label: t('insights:period.week'), testID: 'period-week' },
          { value: 'month', label: t('insights:period.month'), testID: 'period-month' },
        ]}
        style={styles.periods}
      />
      <Text variant="labelLarge" style={styles.range} testID="insights-range">
        {t('insights:range', { from: fmt.date(insights.range.from, 'medium'), to: fmt.date(insights.range.to, 'medium') })}
      </Text>
      {error ? (
        loadFailed ? (
          <ErrorState
            body={t('insights:loadError', { reason: t(errorMessageKey(error.code)) })}
            onRetry={() => {
              if (!retrying) void retry();
            }}
            loading={retrying}
            testID="insights-error"
          />
        ) : (
          <Banner
            tone="error"
            text={t('insights:loadError', { reason: t(errorMessageKey(error.code)) })}
            action={{
              label: t('common:actions.retry'),
              onPress: () => {
                if (!retrying) void retry();
              },
            }}
            style={styles.errorBanner}
            testID="insights-error"
          />
        )
      ) : null}
      {isLoading ? (
        // First load: tile- and chart-shaped skeletons (the layout is known — §8).
        <View accessible accessibilityLabel={t('insights:loading')} testID="insights-loading">
          <View style={styles.skeletonRow}>
            <Skeleton width="48%" height={84} radius={radii.lg} />
            <Skeleton width="48%" height={84} radius={radii.lg} />
          </View>
          <View style={styles.skeletonRow}>
            <Skeleton width="48%" height={84} radius={radii.lg} />
            <Skeleton width="48%" height={84} radius={radii.lg} />
          </View>
          <Skeleton width="100%" height={160} radius={radii.lg} style={styles.skeletonBlock} />
        </View>
      ) : loadFailed ? null : hasMeetings ? (
        <View>
          <Stats insights={insights} />
          <LoadByDay insights={insights} />
          <Sources insights={insights} />
          <Attention insights={insights} />
        </View>
      ) : (
        <EmptyState icon="chart-line" title={t('insights:empty')} body={t('insights:emptyHint')} testID="insights-empty" />
      )}
    </View>
  );

  return (
    <SectionList<MeetingPair, PairSection>
      sections={sections}
      keyExtractor={(pair, index) => `${pair.first.id}:${pair.second.id}:${index}`}
      renderItem={({ item, section }) => <PairRow pair={item} kind={section.key} onOpen={openMeeting} />}
      renderSectionHeader={({ section }: { section: SectionListData<MeetingPair, PairSection> }) => (
        <View style={{ backgroundColor: colors.background }}>
          <SectionHeader title={section.title} />
          {section.hint ? (
            <Text variant="bodySmall" style={[styles.sectionHint, { color: colors.onSurfaceVariant }]}>
              {section.hint}
            </Text>
          ) : null}
        </View>
      )}
      renderSectionFooter={({ section }: { section: SectionListData<MeetingPair, PairSection> }) =>
        section.data.length === 0 ? (
          <Text variant="bodyMedium" style={[styles.sectionEmpty, { color: colors.onSurfaceVariant }]}>
            {section.empty}
          </Text>
        ) : (
          <View style={styles.sectionGap} />
        )
      }
      ListHeaderComponent={header}
      ListFooterComponent={hasMeetings ? <AiSuggestionsSection period={period} onOpenAssistant={() => navigation.navigate('AIChat')} /> : null}
      stickySectionHeadersEnabled={false}
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxl }]}
      testID="insights-list"
    />
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: componentMetrics.screenGutter,
    paddingTop: spacing.md,
  },
  flex: {
    flex: 1,
  },
  subtitle: {
    marginBottom: spacing.md,
  },
  periods: {
    marginBottom: spacing.sm,
  },
  range: {
    marginBottom: spacing.md,
  },
  errorBanner: {
    marginBottom: spacing.md,
  },
  skeletonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  skeletonBlock: {
    marginBottom: spacing.md,
  },
  tileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: componentMetrics.cardGap,
  },
  tile: {
    flexGrow: 1,
    flexBasis: '40%',
  },
  tileWide: {
    flexBasis: '100%',
  },
  tileValue: {
    marginTop: spacing.xs,
    fontVariant: ['tabular-nums'],
  },
  note: {
    marginTop: spacing.sm,
  },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: spacing.xxxl,
    gap: spacing.md,
  },
  sourceDot: {
    width: componentMetrics.sourceDotSize,
    height: componentMetrics.sourceDotSize,
    borderRadius: radii.full,
  },
  sourceCount: {
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  issue: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  issueText: {
    marginLeft: spacing.sm,
    flex: 1,
  },
  sectionHint: {
    marginBottom: spacing.sm,
  },
  sectionEmpty: {
    marginBottom: spacing.lg,
  },
  sectionGap: {
    height: spacing.sm,
  },
  pair: {
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  pairHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  pairMeeting: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: componentMetrics.touchTargetMin,
    paddingVertical: spacing.xs,
    borderRadius: radii.sm,
  },
});
