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
import { RefreshControl, ScrollView, SectionList, StyleSheet, View, type SectionListData } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Chip,
  FAB,
  HelperText,
  Searchbar,
  SegmentedButtons,
  Text,
  useTheme as usePaperTheme,
} from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { RootStackParamList } from '../../../core/contracts';
import { errorMessageKey } from '../../../core/errors';
import { getDeviceTimeZone, todayInZone } from '../../../core/time';
import type { Meeting } from '../../../core/types';
import { useT } from '../../../i18n';
import { useMeetings } from '../../../services/data';
import { useFormatters } from '../../shared/useFormatters';
import { MeetingActionsSheet, useMeetingActions } from './meetingActions';
import { MeetingListItem } from './MeetingListItem';
import {
  DEFAULT_FILTERS,
  SOURCE_FILTERS,
  TIME_FILTERS,
  buildMeetingSections,
  dayRelation,
  hasActiveFilters,
  isTimeFilter,
  type MeetingFilters,
  type MeetingSection,
  type SourceFilter,
} from './meetingListModel';
import { useMeetingsRefresh } from './useMeetingsRefresh';
import { useNow } from './useNow';

type Props = StackScreenProps<RootStackParamList, 'TotalMeetings'>;

export function MeetingsListScreen({ navigation }: Props): ReactElement {
  const t = useT();
  const theme = usePaperTheme();
  const insets = useSafeAreaInsets();
  const fmt = useFormatters();
  const now = useNow();
  const timeZone = getDeviceTimeZone();
  const { meetings, isLoading, error, refresh } = useMeetings();
  const [filters, setFilters] = useState<MeetingFilters>(DEFAULT_FILTERS);
  const [sheetMeeting, setSheetMeeting] = useState<Meeting | null>(null);
  const actions = useMeetingActions();
  const { refreshing, onRefresh } = useMeetingsRefresh(refresh);

  const todayKey = todayInZone(timeZone, now);
  const sections = useMemo(() => buildMeetingSections(meetings, filters, { timeZone, now }), [meetings, filters, timeZone, now]);
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
    return relation ? `${t(`meetings:list.${relation}`)} · ${fmt.date(dayKey, 'long')}` : fmt.date(dayKey, 'full');
  };

  const renderSectionHeader = ({ section }: { section: SectionListData<Meeting, MeetingSection> }): ReactElement => (
    <View style={[styles.sectionHeader, { backgroundColor: theme.colors.background }]}>
      <Text variant="titleSmall" accessibilityRole="header" style={styles.flex} testID={`meetings-section-${section.dayKey}`}>
        {sectionTitle(section.dayKey)}
      </Text>
      <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
        {t('meetings:list.count', { count: section.data.length })}
      </Text>
    </View>
  );

  const renderItem = ({ item }: { item: Meeting }): ReactElement => (
    <MeetingListItem
      meeting={item}
      now={now}
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
          <Text variant="bodyMedium" style={styles.stateText}>
            {t('meetings:list.loading')}
          </Text>
        </View>
      );
    }
    if (error && meetings.length === 0) {
      return (
        <View style={styles.state} testID="meetings-error">
          <Text variant="titleMedium" style={styles.stateText} accessibilityRole="header">
            {t('meetings:list.errorTitle')}
          </Text>
          <Text variant="bodyMedium" style={[styles.stateText, { color: theme.colors.onSurfaceVariant }]}>
            {t(errorMessageKey(error.code))}
          </Text>
          <Button mode="contained" style={styles.stateButton} onPress={onRefresh} loading={refreshing} disabled={refreshing}>
            {t('common:actions.retry')}
          </Button>
        </View>
      );
    }
    const variant = meetings.length === 0 ? 'none' : filtered ? 'noMatches' : filters.time;
    return (
      <View style={styles.state} testID={`meetings-empty-${variant}`}>
        <Text variant="titleMedium" style={styles.stateText} accessibilityRole="header">
          {t(`meetings:list.empty.${variant}.title`)}
        </Text>
        <Text variant="bodyMedium" style={[styles.stateText, { color: theme.colors.onSurfaceVariant }]}>
          {t(`meetings:list.empty.${variant}.message`)}
        </Text>
        {variant === 'noMatches' ? (
          <Button mode="outlined" style={styles.stateButton} onPress={clearFilters} testID="meetings-clear-filters">
            {t('meetings:list.clearFilters')}
          </Button>
        ) : variant === 'upcoming' ? (
          <Button mode="outlined" style={styles.stateButton} onPress={() => setTime('past')}>
            {t('meetings:list.showPast')}
          </Button>
        ) : (
          <Button mode="contained" style={styles.stateButton} onPress={createMeeting}>
            {t('meetings:list.newMeeting')}
          </Button>
        )}
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={[styles.controls, { paddingLeft: insets.left + 16, paddingRight: insets.right + 16 }]}>
        <Searchbar
          value={filters.query}
          onChangeText={setQuery}
          placeholder={t('meetings:list.searchPlaceholder')}
          accessibilityLabel={t('meetings:list.searchLabel')}
          clearAccessibilityLabel={t('meetings:list.clearSearch')}
          style={styles.search}
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
              showSelectedOverlay
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
            style={[styles.resultCount, { color: theme.colors.onSurfaceVariant }]}
            accessibilityLiveRegion="polite"
            testID="meetings-result-count"
          >
            {t('meetings:list.count', { count: resultCount })}
          </Text>
        ) : null}
        {error && meetings.length > 0 ? (
          <HelperText type="error" visible testID="meetings-error-banner">
            {t(errorMessageKey(error.code))}
          </HelperText>
        ) : null}
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(meeting) => meeting.id}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        ListEmptyComponent={renderEmpty}
        stickySectionHeadersEnabled
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={12}
        contentContainerStyle={{ paddingBottom: insets.bottom + 96, flexGrow: 1 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[theme.colors.primary]}
            tintColor={theme.colors.primary}
            progressBackgroundColor={theme.colors.surface}
          />
        }
        testID="meetings-list"
      />

      <FAB
        icon="plus"
        label={t('meetings:list.newMeeting')}
        onPress={createMeeting}
        style={[styles.fab, { bottom: insets.bottom + 16, right: insets.right + 16 }]}
        accessibilityLabel={t('meetings:list.newMeeting')}
        testID="meetings-new"
      />

      <MeetingActionsSheet meeting={sheetMeeting} actions={actions} onDismiss={() => setSheetMeeting(null)} />
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
    paddingTop: 12,
  },
  search: {
    marginBottom: 10,
  },
  segments: {
    marginBottom: 8,
  },
  chips: {
    paddingVertical: 2,
  },
  chip: {
    marginRight: 8,
  },
  resultCount: {
    marginTop: 6,
    marginBottom: 2,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
  },
  state: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 48,
  },
  stateText: {
    marginTop: 8,
    textAlign: 'center',
  },
  stateButton: {
    marginTop: 16,
  },
  fab: {
    position: 'absolute',
  },
});
