/**
 * Insights (route "AIInsights"): weekly / monthly numbers computed on the device from the
 * meetings (./meetingInsights): meetings, time in meetings, average length, busiest day, load by
 * day, where meetings come from, overlapping and back-to-back meetings, and upcoming meetings
 * worth a look. Optional AI suggestions through the assistant (explained first; they use the
 * daily AI limit).
 */
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { StackScreenProps } from '@react-navigation/stack';
import { useMemo, useState, type ReactElement } from 'react';
import { Pressable, SectionList, StyleSheet, View, type SectionListData } from 'react-native';
import { ActivityIndicator, Button, SegmentedButtons, Text, useTheme as usePaperTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

import type { RootStackParamList } from '../../core/contracts';
import { errorMessageKey, toAppError } from '../../core/errors';
import { createLogger } from '../../core/logger';
import { getDeviceTimeZone } from '../../core/time';
import type { Meeting } from '../../core/types';
import { useLanguage, useT } from '../../i18n';
import { useMeetings } from '../../services/data';
import { OfflineBanner } from '../home/OfflineBanner';
import { useLiveNow } from '../shared/useLiveNow';
import { Section } from '../shared/Section';
import { useFormatters } from '../shared/useFormatters';
import { AiSuggestionsSection } from './AiSuggestionsSection';
import { LoadByDay } from './LoadByDay';
import {
  computePeriodInsights,
  weekStartForLanguage,
  type InsightPeriod,
  type MeetingPair,
  type PeriodInsights,
} from './meetingInsights';

const log = createLogger('insights');

type Props = StackScreenProps<RootStackParamList, 'AIInsights'>;

type PairSection = { key: 'overlaps' | 'backToBack'; title: string; hint: string | null; empty: string; data: MeetingPair[] };

function StatRow({ label, value, testID }: { label: string; value: string; testID?: string }): ReactElement {
  const theme = usePaperTheme();
  return (
    <View style={styles.statRow} accessible accessibilityLabel={`${label}: ${value}`} testID={testID}>
      <Text variant="bodyMedium" style={[styles.flex, { color: theme.colors.onSurfaceVariant }]}>
        {label}
      </Text>
      <Text variant="titleSmall" style={styles.statValue}>
        {value}
      </Text>
    </View>
  );
}

function Stats({ insights }: { insights: PeriodInsights }): ReactElement {
  const t = useT();
  const theme = usePaperTheme();
  const fmt = useFormatters();
  const busiest = insights.busiestDay;
  return (
    <Section>
      <StatRow label={t('insights:stats.meetings')} value={String(insights.count)} testID="stat-meetings" />
      <StatRow label={t('insights:stats.time')} value={fmt.duration(insights.totalMinutes)} testID="stat-time" />
      <StatRow
        label={t('insights:stats.average')}
        value={insights.averageMinutes === null ? t('insights:stats.averageNone') : fmt.duration(insights.averageMinutes)}
      />
      {busiest ? (
        <StatRow
          label={t('insights:stats.busiest')}
          value={t('insights:stats.busiestValue', {
            date: fmt.date(busiest.date, 'medium'),
            meetings: t('insights:meetings', { count: busiest.count }),
            duration: fmt.duration(busiest.minutes),
          })}
          testID="stat-busiest"
        />
      ) : null}
      {insights.allDayCount > 0 ? (
        <Text variant="bodySmall" style={[styles.note, { color: theme.colors.onSurfaceVariant }]}>
          {t('insights:stats.allDay', { count: insights.allDayCount })}
        </Text>
      ) : null}
    </Section>
  );
}

function Sources({ insights }: { insights: PeriodInsights }): ReactElement | null {
  const t = useT();
  if (insights.sources.length === 0) return null;
  return (
    <Section title={t('insights:sources.title')} testID="insights-sources">
      {insights.sources.map((entry) => (
        <StatRow key={entry.source} label={t(`insights:sources.${entry.source}`)} value={String(entry.count)} />
      ))}
    </Section>
  );
}

function Attention({ insights }: { insights: PeriodInsights }): ReactElement {
  const t = useT();
  const theme = usePaperTheme();
  const missing = insights.missingPlace.length;
  const tips = insights.withTips.length;
  return (
    <Section title={t('insights:attention.title')} testID="insights-attention">
      {missing > 0 ? (
        <View style={styles.issue}>
          <MaterialCommunityIcons name="map-marker-question-outline" size={18} color={theme.colors.onSurfaceVariant} />
          <Text variant="bodyMedium" style={styles.issueText}>
            {t('insights:attention.missingPlace', { count: missing })}
          </Text>
        </View>
      ) : (
        <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
          {t('insights:attention.none')}
        </Text>
      )}
      {tips > 0 ? (
        <View style={styles.issue}>
          <MaterialCommunityIcons name="lightbulb-on-outline" size={18} color={theme.colors.primary} />
          <Text variant="bodyMedium" style={styles.issueText}>
            {t('insights:attention.withTips', { count: tips })}
          </Text>
        </View>
      ) : null}
    </Section>
  );
}

function PairRow({ pair, kind, onOpen }: { pair: MeetingPair; kind: PairSection['key']; onOpen(meeting: Meeting): void }): ReactElement {
  const t = useT();
  const theme = usePaperTheme();
  const fmt = useFormatters();
  const text =
    kind === 'overlaps'
      ? t('insights:conflicts.pair', { first: pair.first.title, second: pair.second.title })
      : t('insights:backToBack.item', { first: pair.first.title, second: pair.second.title });
  return (
    <View
      style={[styles.pair, { borderColor: kind === 'overlaps' ? theme.colors.error : theme.colors.outlineVariant, backgroundColor: theme.colors.elevation.level1 }]}
      testID={`pair-${kind}-${pair.first.id}-${pair.second.id}`}
    >
      <View style={styles.pairHeader}>
        <MaterialCommunityIcons
          name={kind === 'overlaps' ? 'alert-circle-outline' : 'timer-sand'}
          size={18}
          color={kind === 'overlaps' ? theme.colors.error : theme.colors.tertiary}
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
          style={({ pressed }) => [styles.pairMeeting, pressed && { backgroundColor: theme.colors.surfaceVariant }]}
        >
          <View style={styles.flex}>
            <Text variant="bodyMedium" numberOfLines={1}>
              {meeting.title}
            </Text>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
              {fmt.meetingRange(meeting)}
            </Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={20} color={theme.colors.onSurfaceVariant} />
        </Pressable>
      ))}
    </View>
  );
}

export function AIInsightsScreen({ navigation }: Props): ReactElement {
  const t = useT();
  const theme = usePaperTheme();
  const insets = useSafeAreaInsets();
  const fmt = useFormatters();
  const { language } = useLanguage();
  const { meetings, isLoading, error, refresh } = useMeetings();
  const [period, setPeriod] = useState<InsightPeriod>('week');
  const [retrying, setRetrying] = useState(false);
  const now = useLiveNow(60_000);
  const timeZone = getDeviceTimeZone();

  const insights = useMemo(
    () => computePeriodInsights(meetings, period, { now, timeZone, weekStartsOn: weekStartForLanguage(language) }),
    [language, meetings, now, period, timeZone],
  );

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
      <Text variant="bodySmall" style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}>
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
        <View style={[styles.errorBox, { backgroundColor: theme.colors.errorContainer }]} accessibilityRole="alert" testID="insights-error">
          <Text variant="bodyMedium" style={{ color: theme.colors.onErrorContainer }}>
            {t('insights:loadError', { reason: t(errorMessageKey(error.code)) })}
          </Text>
          <Button
            mode="text"
            compact
            onPress={() => void retry()}
            loading={retrying}
            disabled={retrying}
            textColor={theme.colors.onErrorContainer}
            style={styles.retry}
            testID="insights-retry"
          >
            {t('common:actions.retry')}
          </Button>
        </View>
      ) : null}
      {isLoading ? (
        <View style={styles.loading} testID="insights-loading">
          <ActivityIndicator />
          <Text variant="bodyMedium" style={[styles.loadingText, { color: theme.colors.onSurfaceVariant }]}>
            {t('insights:loading')}
          </Text>
        </View>
      ) : loadFailed ? null : hasMeetings ? (
        <View>
          <Stats insights={insights} />
          <LoadByDay insights={insights} />
          <Sources insights={insights} />
          <Attention insights={insights} />
        </View>
      ) : (
        <Section testID="insights-empty">
          <Text variant="titleSmall">{t('insights:empty')}</Text>
          <Text variant="bodySmall" style={[styles.note, { color: theme.colors.onSurfaceVariant }]}>
            {t('insights:emptyHint')}
          </Text>
        </Section>
      )}
    </View>
  );

  return (
    <SectionList<MeetingPair, PairSection>
      sections={sections}
      keyExtractor={(pair, index) => `${pair.first.id}:${pair.second.id}:${index}`}
      renderItem={({ item, section }) => <PairRow pair={item} kind={section.key} onOpen={openMeeting} />}
      renderSectionHeader={({ section }: { section: SectionListData<MeetingPair, PairSection> }) => (
        <View style={[styles.sectionHeader, { backgroundColor: theme.colors.background }]}>
          <Text variant="titleMedium" accessibilityRole="header">
            {section.title}
          </Text>
          {section.hint ? (
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
              {section.hint}
            </Text>
          ) : null}
        </View>
      )}
      renderSectionFooter={({ section }: { section: SectionListData<MeetingPair, PairSection> }) =>
        section.data.length === 0 ? (
          <Text variant="bodyMedium" style={[styles.sectionEmpty, { color: theme.colors.onSurfaceVariant }]}>
            {section.empty}
          </Text>
        ) : (
          <View style={styles.sectionGap} />
        )
      }
      ListHeaderComponent={header}
      ListFooterComponent={hasMeetings ? <AiSuggestionsSection period={period} onOpenAssistant={() => navigation.navigate('AIChat')} /> : null}
      stickySectionHeadersEnabled={false}
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
      testID="insights-list"
    />
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  flex: {
    flex: 1,
  },
  subtitle: {
    marginBottom: 12,
  },
  periods: {
    marginBottom: 8,
  },
  range: {
    marginBottom: 12,
  },
  errorBox: {
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  retry: {
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  loading: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  loadingText: {
    marginTop: 12,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  statValue: {
    marginLeft: 12,
    flexShrink: 1,
    textAlign: 'right',
  },
  note: {
    marginTop: 8,
  },
  issue: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  issueText: {
    marginLeft: 8,
    flex: 1,
  },
  sectionHeader: {
    paddingTop: 8,
    paddingBottom: 8,
  },
  sectionEmpty: {
    marginBottom: 16,
  },
  sectionGap: {
    height: 8,
  },
  pair: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 8,
  },
  pairHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  pairMeeting: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingVertical: 4,
    borderRadius: 8,
  },
});
