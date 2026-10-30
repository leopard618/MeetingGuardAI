/**
 * All meetings (route "TotalMeetings"): every active meeting from the data layer (MeetingGuard,
 * AI assistant, Google Calendar and device-calendar imports), grouped by day in the user's time
 * zone (Today / Tomorrow / Yesterday / dates), with search, time and source filters,
 * pull-to-refresh (data layer + calendar sync), and open / edit / delete actions (tap, long-press,
 * the "more" button, or the screen reader's actions).
 *
 * There is no "Clear all": the old one only wiped a local cache and reported success.
 */
import type { StackScreenProps } from '@react-navigation/stack';
import { useMemo, useState, type ReactElement } from 'react';
import { Animated, RefreshControl, ScrollView, SectionList, StyleSheet, View, type SectionListData } from 'react-native';
import { ActivityIndicator, Chip, FAB, Searchbar, SegmentedButtons, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Banner, EmptyState, ErrorState, MGButton } from '../../../components/ui';
import type { RootStackParamList } from '../../../core/contracts';
import { errorMessageKey } from '../../../core/errors';
import { addDaysToLocalDate, getDeviceTimeZone, todayInZone } from '../../../core/time';
import type { Meeting } from '../../../core/types';
import { useT } from '../../../i18n';
import { useMeetings } from '../../../services/data';
import { componentMetrics, spacing, useAppTheme } from '../../../theme';
import { useFormatters } from '../../shared/useFormatters';
import { capitalizeFirst } from '../../shared/text';
import { useLiveNow } from '../../shared/useLiveNow';
import {
  LIST_FUTURE_DAYS,
  LIST_PAST_DAYS,
  displayKeyOf,
  displayWindowForDays,
  expandMeetingsForDisplay,
  type DisplayMeeting,
} from '../occurrences';
import { OccurrenceEditSheet } from '../OccurrenceEditSheet';
import { MeetingActionsSheet, useMeetingActions } from './meetingActions';
import { MeetingListItem } from './MeetingListItem';
import {
  DEFAULT_FILTERS,
  SOURCE_FILTERS,
  TIME_FILTERS,
  buildMeetingSections,
  dayRelation,
  hasActiveFilters,
  isInProgress,
  isTimeFilter,
  type MeetingFilters,
  type MeetingSection,
  type SourceFilter,
} from './meetingListModel';
import { useMeetingsRefresh } from './useMeetingsRefresh';
import { FAB_SLIDE_DP, useHideOnScroll } from './useHideOnScroll';

type Props = StackScreenProps<RootStackParamList, 'TotalMeetings'>;

/** Empty-state icon per variant (kit EmptyState, §8). */
const EMPTY_ICONS = {
  none: 'calendar-blank-outline',
  noMatches: 'calendar-search',
  upcoming: 'calendar-check-outline',
  past: 'calendar-clock-outline',
  all: 'calendar-blank-outline',
} as const;

export function MeetingsListScreen({ navigation }: Props): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const fmt = useFormatters();
  const now = useLiveNow(60_000);
  const timeZone = getDeviceTimeZone();
  const { meetings, isLoading, error, refresh } = useMeetings();
  const [filters, setFilters] = useState<MeetingFilters>(DEFAULT_FILTERS);
  const [sheetMeeting, setSheetMeeting] = useState<DisplayMeeting | null>(null);
  const actions = useMeetingActions();
  const { refreshing, onRefresh } = useMeetingsRefresh(refresh);
  const fab = useHideOnScroll();

  const todayKey = todayInZone(timeZone, now);
  // Recurring meetings render one row per occurrence (bounded window; occurrences.ts). The window
  // only moves with the local day, so the expansion is keyed on it, not on the minute clock.
  const displayWindow = useMemo(
    () => displayWindowForDays(addDaysToLocalDate(todayKey, -LIST_PAST_DAYS + 1), addDaysToLocalDate(todayKey, LIST_FUTURE_DAYS - 1), timeZone),
    [todayKey, timeZone],
  );
  const displayMeetings = useMemo(() => expandMeetingsForDisplay(meetings, displayWindow), [meetings, displayWindow]);
  const sections = useMemo(
    () => buildMeetingSections(displayMeetings, filters, { timeZone, now }),
    [displayMeetings, filters, timeZone, now],
  );
  const resultCount = useMemo(() => sections.reduce((total, section) => total + section.data.length, 0), [sections]);
  const filtered = hasActiveFilters(filters);

  const setTime = (value: string): void => {
    if (isTimeFilter(value)) setFilters((current) => ({ ...current, time: value }));
  };
  const setSource = (source: SourceFilter): void => setFilters((current) => ({ ...current, source }));
  const setQuery = (query: string): void => setFilters((current) => ({ ...current, query }));
  const clearFilters = (): void => setFilters((current) => ({ ...DEFAULT_FILTERS, time: current.time }));
  const createMeeting = (): void => navigation.navigate('ChooseCreationMethod');

  const sectionTitle = (dayKey: string): string => {
    const relation = dayRelation(dayKey, todayKey);
    return relation ? `${t(`meetings:list.${relation}`)} · ${fmt.date(dayKey, 'long')}` : capitalizeFirst(fmt.date(dayKey, 'full'));
  };

  const renderSectionHeader = ({ section }: { section: SectionListData<Meeting, MeetingSection> }): ReactElement => (
    <View style={[styles.sectionHeader, { backgroundColor: colors.background }]}>
      <Text
        variant="titleSmall"
        accessibilityRole="header"
        style={[styles.flex, { color: colors.onSurfaceVariant }]}
        testID={`meetings-section-${section.dayKey}`}
      >
        {sectionTitle(section.dayKey)}
      </Text>
      <Text variant="labelMedium" style={{ color: colors.onSurfaceVariant }}>
        {t('meetings:list.count', { count: section.data.length })}
      </Text>
    </View>
  );

  const renderItem = ({ item }: { item: Meeting }): ReactElement => (
    <MeetingListItem
      meeting={item}
      inProgress={isInProgress(item, now)}
      timeZone={timeZone}
      fmt={fmt}
      deleting={actions.deletingId === item.id}
      onOpen={actions.open}
      onMore={setSheetMeeting}
      onEdit={actions.edit}
      onDelete={actions.confirmDelete}
    />
  );

  const renderEmpty = (): ReactElement => {
    if (isLoading && meetings.length === 0) {
      return (
        <View style={styles.state} testID="meetings-loading">
          <ActivityIndicator size="large" />
          <Text variant="bodyMedium" style={[styles.stateText, { color: colors.onSurfaceVariant }]}>
            {t('meetings:list.loading')}
          </Text>
        </View>
      );
    }
    if (error && meetings.length === 0) {
      return (
        <ErrorState
          title={t('meetings:list.errorTitle')}
          body={t(errorMessageKey(error.code))}
          onRetry={() => {
            if (!refreshing) onRefresh();
          }}
          loading={refreshing}
          style={styles.state}
          testID="meetings-error"
        />
      );
    }
    const variant = meetings.length === 0 ? 'none' : filtered ? 'noMatches' : filters.time;
    return (
      <View style={styles.state} testID={`meetings-empty-${variant}`}>
        <EmptyState
          icon={EMPTY_ICONS[variant]}
          title={t(`meetings:list.empty.${variant}.title`)}
          body={t(`meetings:list.empty.${variant}.message`)}
          style={styles.emptyBody}
        />
        {variant === 'noMatches' ? (
          <MGButton variant="tonal" onPress={clearFilters} testID="meetings-clear-filters">
            {t('meetings:list.clearFilters')}
          </MGButton>
        ) : variant === 'upcoming' ? (
          <MGButton variant="tonal" onPress={() => setTime('past')}>
            {t('meetings:list.showPast')}
          </MGButton>
        ) : (
          <MGButton onPress={createMeeting}>{t('meetings:list.newMeeting')}</MGButton>
        )}
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.controls, { paddingLeft: insets.left + componentMetrics.screenGutter, paddingRight: insets.right + componentMetrics.screenGutter }]}>
        <Searchbar
          value={filters.query}
          onChangeText={setQuery}
          placeholder={t('meetings:list.searchPlaceholder')}
          accessibilityLabel={t('meetings:list.searchLabel')}
          clearAccessibilityLabel={t('meetings:list.clearSearch')}
          style={[styles.search, { backgroundColor: colors.surfaceVariant }]}
          autoCorrect={false}
          returnKeyType="search"
          testID="meetings-search"
        />
        <SegmentedButtons
          value={filters.time}
          onValueChange={setTime}
          density="small"
          style={styles.segments}
          buttons={TIME_FILTERS.map((value) => ({
            value,
            label: t(`meetings:list.time.${value}`),
            testID: `meetings-time-${value}`,
          }))}
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          accessibilityLabel={t('meetings:list.sourceLabel')}
        >
          {SOURCE_FILTERS.map((value) => (
            <Chip
              key={value}
              selected={filters.source === value}
              mode={filters.source === value ? 'flat' : 'outlined'}
              compact
              onPress={() => setSource(value)}
              style={styles.chip}
              accessibilityLabel={t('meetings:list.sourceChip', { source: t(`meetings:list.source.${value}`) })}
              testID={`meetings-source-${value}`}
            >
              {t(`meetings:list.source.${value}`)}
            </Chip>
          ))}
        </ScrollView>
        {meetings.length > 0 ? (
          <Text
            variant="labelMedium"
            style={[styles.resultCount, { color: colors.onSurfaceVariant }]}
            accessibilityLiveRegion="polite"
            testID="meetings-result-count"
          >
            {t('meetings:list.count', { count: resultCount })}
          </Text>
        ) : null}
        {error && meetings.length > 0 ? (
          <Banner tone="error" text={t(errorMessageKey(error.code))} style={styles.errorBanner} testID="meetings-error-banner" />
        ) : null}
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(meeting) => displayKeyOf(meeting)}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        ListEmptyComponent={renderEmpty}
        stickySectionHeadersEnabled
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={12}
        onScroll={fab.onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: insets.bottom + 96, flexGrow: 1 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[colors.primary]}
            tintColor={colors.primary}
            progressBackgroundColor={colors.surface}
          />
        }
        testID="meetings-list"
      />

      <Animated.View
        pointerEvents={fab.shown ? 'auto' : 'none'}
        importantForAccessibility={fab.shown ? 'yes' : 'no-hide-descendants'}
        accessibilityElementsHidden={!fab.shown}
        style={[
          styles.fab,
          { bottom: insets.bottom + componentMetrics.screenGutter, right: insets.right + componentMetrics.screenGutter },
          {
            opacity: fab.visible,
            transform: [{ translateY: fab.visible.interpolate({ inputRange: [0, 1], outputRange: [FAB_SLIDE_DP, 0] }) }],
          },
        ]}
      >
        <FAB
          icon="plus"
          label={t('meetings:list.newMeeting')}
          onPress={createMeeting}
          accessibilityLabel={t('meetings:list.newMeeting')}
          testID="meetings-new"
        />
      </Animated.View>

      <MeetingActionsSheet meeting={sheetMeeting} actions={actions} onDismiss={() => setSheetMeeting(null)} />
      <OccurrenceEditSheet target={actions.occurrenceEdit} onDismiss={actions.dismissOccurrenceEdit} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  controls: {
    paddingTop: spacing.md,
  },
  search: {
    marginBottom: spacing.md,
  },
  segments: {
    marginBottom: spacing.sm,
  },
  chips: {
    paddingVertical: spacing.xs,
  },
  chip: {
    marginRight: spacing.sm,
  },
  resultCount: {
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  errorBanner: {
    marginBottom: spacing.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: componentMetrics.screenGutter,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.md,
  },
  state: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxxl,
    paddingVertical: spacing.xxl,
  },
  stateText: {
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  emptyBody: {
    paddingBottom: spacing.xl,
  },
  fab: {
    position: 'absolute',
  },
});
