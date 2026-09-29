/**
 * Calendar (route "Calendar"): a month grid with one dot per meeting source on each day (every
 * meeting from the data layer: MeetingGuard, AI assistant, Google Calendar and device-calendar
 * imports; no direct Google API call here), the agenda of the selected day, and "New meeting on
 * <day>" which opens the manual form preset to that day. Days are local days in the user's zone.
 */
import type { StackScreenProps } from '@react-navigation/stack';
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Divider, IconButton, Text, useTheme as usePaperTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { RootStackParamList } from '../../core/contracts';
import { errorMessageKey } from '../../core/errors';
import { getDeviceTimeZone, todayInZone } from '../../core/time';
import type { Meeting } from '../../core/types';
import { useLanguage, useT } from '../../i18n';
import { useMeetings } from '../../services/data';
import { MeetingActionsSheet, useMeetingActions } from '../meetings/list/meetingActions';
import { MeetingListItem, sourceColor } from '../meetings/list/MeetingListItem';
import { dayRelation, type SourceCategory } from '../meetings/list/meetingListModel';
import { useMeetingsRefresh } from '../meetings/list/useMeetingsRefresh';
import { useFormatters } from '../shared/useFormatters';
import { useLiveNow } from '../shared/useLiveNow';
import {
  buildMonthGrid,
  dayKeyOf,
  indexMeetingsByDay,
  monthOf,
  monthTitle,
  sameMonth,
  shiftMonth,
  weekStartsOn,
  weekdayLabels,
  type MonthRef,
} from './calendarModel';
import { MonthGrid } from './MonthGrid';

type Props = StackScreenProps<RootStackParamList, 'Calendar'>;

const LEGEND: readonly SourceCategory[] = ['meetingguard', 'google', 'device'];

export function CalendarScreen({ navigation }: Props): ReactElement {
  const t = useT();
  const theme = usePaperTheme();
  const insets = useSafeAreaInsets();
  const fmt = useFormatters();
  const { language } = useLanguage();
  const now = useLiveNow(60_000);
  const timeZone = getDeviceTimeZone();
  const todayKey = todayInZone(timeZone, now);
  const [selectedKey, setSelectedKey] = useState(todayKey);
  const [visibleMonth, setVisibleMonth] = useState<MonthRef>(() => monthOf(todayKey));
  const [sheetMeeting, setSheetMeeting] = useState<Meeting | null>(null);
  const { meetings, isLoading, error, refresh } = useMeetings();
  const actions = useMeetingActions();
  const { refreshing, onRefresh } = useMeetingsRefresh(refresh);

  const firstWeekday = weekStartsOn(language);
  const index = useMemo(() => indexMeetingsByDay(meetings, timeZone), [meetings, timeZone]);
  const grid = useMemo(() => buildMonthGrid(visibleMonth, firstWeekday), [visibleMonth, firstWeekday]);
  const weekdays = useMemo(() => weekdayLabels(firstWeekday, language), [firstWeekday, language]);
  const dayMeetings = index.get(selectedKey) ?? [];
  const showingToday = selectedKey === todayKey && sameMonth(visibleMonth, monthOf(todayKey));

  const selectDay = useCallback((key: string) => {
    setSelectedKey(key);
    setVisibleMonth((current) => (sameMonth(current, monthOf(key)) ? current : monthOf(key)));
  }, []);

  const changeMonth = (delta: number): void => {
    const next = shiftMonth(visibleMonth, delta);
    setVisibleMonth(next);
    // Keep a selection inside the visible month: today when it is there, else the 1st.
    setSelectedKey(sameMonth(next, monthOf(todayKey)) ? todayKey : dayKeyOf(next.year, next.month, 1));
  };

  const goToToday = (): void => {
    setSelectedKey(todayKey);
    setVisibleMonth(monthOf(todayKey));
  };

  const createOnDay = (): void => navigation.navigate('CreateMeeting', { date: selectedKey });

  const relation = dayRelation(selectedKey, todayKey);
  const selectedDate = fmt.date(selectedKey, relation ? 'long' : 'full');
  const agendaTitle = relation ? `${t(`calendarView:relation.${relation}`)} · ${selectedDate}` : selectedDate;
  const shortDate = fmt.date(selectedKey, 'medium');
  const title = monthTitle(visibleMonth, language);

  const header = (
    <View style={[styles.header, { paddingLeft: insets.left + 16, paddingRight: insets.right + 16 }]}>
      <View style={styles.monthRow}>
        <IconButton
          icon="chevron-left"
          onPress={() => changeMonth(-1)}
          accessibilityLabel={t('calendarView:previousMonth')}
          hitSlop={4}
          testID="calendar-prev"
        />
        <Text variant="titleLarge" style={styles.monthTitle} accessibilityRole="header" accessibilityLiveRegion="polite" testID="calendar-month-title">
          {title}
        </Text>
        <IconButton
          icon="chevron-right"
          onPress={() => changeMonth(1)}
          accessibilityLabel={t('calendarView:nextMonth')}
          hitSlop={4}
          testID="calendar-next"
        />
      </View>
      {!showingToday ? (
        <Button mode="text" icon="calendar-today" onPress={goToToday} style={styles.todayButton} accessibilityLabel={t('calendarView:goToToday')} testID="calendar-today">
          {t('calendarView:today')}
        </Button>
      ) : null}
      <View style={styles.gridWrap}>
        <MonthGrid grid={grid} weekdays={weekdays} index={index} selectedKey={selectedKey} todayKey={todayKey} onSelect={selectDay} />
      </View>
      <View
        style={styles.legend}
        accessible
        accessibilityLabel={t('calendarView:legend.label', {
          sources: LEGEND.map((category) => t(`calendarView:legend.${category}`)).join(', '),
        })}
      >
        {LEGEND.map((category) => (
          <View key={category} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: sourceColor(category, theme) }]} />
            <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
              {t(`calendarView:legend.${category}`)}
            </Text>
          </View>
        ))}
      </View>
      <Divider style={styles.divider} />
      <View style={styles.agendaHeader}>
        <View style={styles.flex}>
          <Text variant="titleMedium" accessibilityRole="header" testID="calendar-agenda-title">
            {agendaTitle}
          </Text>
          <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
            {dayMeetings.length > 0 ? t('calendarView:meetingCount', { count: dayMeetings.length }) : t('calendarView:noMeetings')}
          </Text>
        </View>
      </View>
      <Button
        mode="contained-tonal"
        icon="plus"
        onPress={createOnDay}
        style={styles.createButton}
        accessibilityHint={t('calendarView:createOnDayHint')}
        testID="calendar-create"
      >
        {t('calendarView:createOnDay', { date: shortDate })}
      </Button>
      {error && meetings.length > 0 ? (
        <Text variant="bodySmall" style={[styles.inlineError, { color: theme.colors.error }]} testID="calendar-error-banner">
          {t(errorMessageKey(error.code))}
        </Text>
      ) : null}
    </View>
  );

  const renderEmpty = (): ReactElement => {
    if (isLoading && meetings.length === 0) {
      return (
        <View style={styles.state} testID="calendar-loading">
          <ActivityIndicator />
          <Text variant="bodyMedium" style={styles.stateText}>
            {t('calendarView:loading')}
          </Text>
        </View>
      );
    }
    if (error && meetings.length === 0) {
      return (
        <View style={styles.state} testID="calendar-error">
          <Text variant="titleSmall" style={styles.stateText}>
            {t('calendarView:errorTitle')}
          </Text>
          <Text variant="bodyMedium" style={[styles.stateText, { color: theme.colors.onSurfaceVariant }]}>
            {t(errorMessageKey(error.code))}
          </Text>
          <Button mode="outlined" style={styles.stateButton} onPress={onRefresh} loading={refreshing} disabled={refreshing}>
            {t('common:actions.retry')}
          </Button>
        </View>
      );
    }
    return (
      <View style={styles.state} testID="calendar-empty-day">
        <Text variant="bodyMedium" style={[styles.stateText, { color: theme.colors.onSurfaceVariant }]}>
          {t('calendarView:emptyDay')}
        </Text>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <FlatList
        data={dayMeetings}
        keyExtractor={(meeting) => meeting.id}
        ListHeaderComponent={header}
        ListEmptyComponent={renderEmpty}
        renderItem={({ item }) => (
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
        )}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[theme.colors.primary]}
            tintColor={theme.colors.primary}
            progressBackgroundColor={theme.colors.surface}
          />
        }
        testID="calendar-agenda"
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
  header: {
    paddingTop: 4,
  },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  monthTitle: {
    flex: 1,
    textAlign: 'center',
  },
  todayButton: {
    alignSelf: 'center',
  },
  gridWrap: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 8,
    marginVertical: 2,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 4,
  },
  divider: {
    marginTop: 12,
    marginBottom: 12,
  },
  agendaHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  createButton: {
    alignSelf: 'flex-start',
    marginTop: 10,
    marginBottom: 12,
  },
  inlineError: {
    marginBottom: 8,
  },
  state: {
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingVertical: 24,
  },
  stateText: {
    marginTop: 8,
    textAlign: 'center',
  },
  stateButton: {
    marginTop: 12,
  },
});
