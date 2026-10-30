/**
 * Calendar (route "Calendar"): a month grid with one dot per meeting source on each day (every
 * meeting from the data layer: MeetingGuard, AI assistant, Google Calendar and device-calendar
 * imports; no direct Google API call here), the agenda of the selected day, and a FAB that
 * creates a meeting preset to the selected day. Days are local days in the user's zone.
 */
import type { StackScreenProps } from '@react-navigation/stack';
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { Animated, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Divider, FAB, IconButton, Text, TouchableRipple } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

import { Banner, ErrorState, MGButton } from '../../components/ui';
import type { RootStackParamList } from '../../core/contracts';
import { errorMessageKey, toAppError } from '../../core/errors';
import { getDeviceTimeZone, todayInZone } from '../../core/time';
import type { Task } from '../../core/types';
import { useLanguage, useT } from '../../i18n';
import { useMeetings, useTasks } from '../../services/data';
import { componentMetrics, radii, spacing, useAppTheme } from '../../theme';
import { MeetingActionsSheet, useMeetingActions } from '../meetings/list/meetingActions';
import { MeetingListItem, sourceColor } from '../meetings/list/MeetingListItem';
import { dayRelation, isInProgress, type SourceCategory } from '../meetings/list/meetingListModel';
import { useMeetingsRefresh } from '../meetings/list/useMeetingsRefresh';
import { FAB_SLIDE_DP, useHideOnScroll } from '../meetings/list/useHideOnScroll';
import { displayKeyOf, displayWindowForDays, expandMeetingsForDisplay, type DisplayMeeting } from '../meetings/occurrences';
import { taskDueInstant } from '../tasks/tasksModel';
import { OccurrenceEditSheet } from '../meetings/OccurrenceEditSheet';
import { useFormatters } from '../shared/useFormatters';
import { capitalizeFirst } from '../shared/text';
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
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const fmt = useFormatters();
  const { language } = useLanguage();
  const now = useLiveNow(60_000);
  const timeZone = getDeviceTimeZone();
  const todayKey = todayInZone(timeZone, now);
  const [selectedKey, setSelectedKey] = useState(todayKey);
  const [visibleMonth, setVisibleMonth] = useState<MonthRef>(() => monthOf(todayKey));
  const [sheetMeeting, setSheetMeeting] = useState<DisplayMeeting | null>(null);
  const { meetings, isLoading, error, refresh } = useMeetings();
  const { tasks, update: updateTask } = useTasks();
  const actions = useMeetingActions();
  const { refreshing, onRefresh } = useMeetingsRefresh(refresh);
  const fab = useHideOnScroll();

  const firstWeekday = weekStartsOn(language);
  const grid = useMemo(() => buildMonthGrid(visibleMonth, firstWeekday), [visibleMonth, firstWeekday]);
  // Recurring meetings render one entry per occurrence inside the visible grid (occurrences.ts).
  const displayMeetings = useMemo(() => {
    const firstKey = grid[0]?.key;
    const lastKey = grid[grid.length - 1]?.key;
    if (!firstKey || !lastKey) return meetings;
    return expandMeetingsForDisplay(meetings, displayWindowForDays(firstKey, lastKey, timeZone));
  }, [meetings, grid, timeZone]);
  const index = useMemo(() => indexMeetingsByDay(displayMeetings, timeZone), [displayMeetings, timeZone]);
  // Dated tasks: a hollow dot on the grid (open ones) and a block in the day's agenda.
  const tasksByDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of tasks) {
      if (task.dueDate === null) continue;
      const list = map.get(task.dueDate) ?? [];
      list.push(task);
      map.set(task.dueDate, list);
    }
    return map;
  }, [tasks]);
  const taskDays = useMemo(() => {
    const days = new Set<string>();
    for (const [key, list] of tasksByDay) {
      if (list.some((task) => task.status === 'open')) days.add(key);
    }
    return days;
  }, [tasksByDay]);
  const dayTasks = tasksByDay.get(selectedKey) ?? [];
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

  const toggleTask = useCallback(
    async (task: Task): Promise<void> => {
      try {
        await updateTask(task.id, { status: task.status === 'done' ? 'open' : 'done' });
      } catch (caught) {
        Toast.show({ type: 'error', text1: t(errorMessageKey(toAppError(caught).code)) });
      }
    },
    [updateTask, t],
  );

  const relation = dayRelation(selectedKey, todayKey);
  const selectedDate = fmt.date(selectedKey, relation ? 'long' : 'full');
  const agendaTitle = relation ? `${t(`calendarView:relation.${relation}`)} · ${selectedDate}` : capitalizeFirst(selectedDate);
  const shortDate = fmt.date(selectedKey, 'medium');
  const title = monthTitle(visibleMonth, language);

  const header = (
    <View style={[styles.header, { paddingLeft: insets.left + componentMetrics.screenGutter, paddingRight: insets.right + componentMetrics.screenGutter }]}>
      {/* Month title on the left, the month arrows grouped on the right, "Today" between them
          only while another day or month is showing. One row, no centred title that jumps. */}
      <View style={styles.monthRow}>
        <Text variant="titleLarge" style={styles.monthTitle} accessibilityRole="header" accessibilityLiveRegion="polite" testID="calendar-month-title">
          {title}
        </Text>
        {!showingToday ? (
          <MGButton
            variant="ghost"
            size="sm"
            icon="calendar-today"
            onPress={goToToday}
            accessibilityLabel={t('calendarView:goToToday')}
            testID="calendar-today"
          >
            {t('calendarView:today')}
          </MGButton>
        ) : null}
        <View style={[styles.navGroup, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.outlineVariant }]}>
          <IconButton
            icon="chevron-left"
            onPress={() => changeMonth(-1)}
            accessibilityLabel={t('calendarView:previousMonth')}
            style={styles.navButton}
            hitSlop={4}
            testID="calendar-prev"
          />
          <IconButton
            icon="chevron-right"
            onPress={() => changeMonth(1)}
            accessibilityLabel={t('calendarView:nextMonth')}
            style={styles.navButton}
            hitSlop={4}
            testID="calendar-next"
          />
        </View>
      </View>
      <View style={styles.gridWrap}>
        <MonthGrid grid={grid} weekdays={weekdays} index={index} taskDays={taskDays} selectedKey={selectedKey} todayKey={todayKey} onSelect={selectDay} />
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
            <View style={[styles.legendDot, { backgroundColor: sourceColor(category, colors) }]} />
            <Text variant="labelMedium" style={{ color: colors.onSurfaceVariant }}>
              {t(`calendarView:legend.${category}`)}
            </Text>
          </View>
        ))}
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, styles.legendTaskDot, { borderColor: colors.tertiary }]} />
          <Text variant="labelMedium" style={{ color: colors.onSurfaceVariant }}>
            {t('calendarView:legend.tasks')}
          </Text>
        </View>
      </View>
      <Divider style={styles.divider} />
      <View style={styles.agendaHeader}>
        <View style={styles.flex}>
          <Text variant="titleMedium" accessibilityRole="header" testID="calendar-agenda-title">
            {agendaTitle}
          </Text>
          <Text variant="labelMedium" style={{ color: colors.onSurfaceVariant }}>
            {dayMeetings.length > 0 ? t('calendarView:meetingCount', { count: dayMeetings.length }) : t('calendarView:noMeetings')}
            {dayTasks.length > 0 ? ` · ${t('calendarView:taskCount', { count: dayTasks.length })}` : ''}
          </Text>
        </View>
      </View>
      {dayTasks.length > 0 ? (
        <View style={[styles.tasksBlock, { borderColor: colors.outlineVariant, backgroundColor: colors.surface }]} testID="calendar-day-tasks">
          {dayTasks.map((task) => {
            const done = task.status === 'done';
            return (
              <View key={task.id} style={styles.taskRow}>
                <IconButton
                  icon={done ? 'check-circle' : 'circle-outline'}
                  size={22}
                  iconColor={done ? colors.primary : colors.onSurfaceVariant}
                  onPress={() => void toggleTask(task)}
                  accessibilityLabel={t(done ? 'tasks:card.reopen' : 'tasks:card.complete', { title: task.title })}
                  style={styles.taskToggle}
                  testID={`calendar-task-toggle-${task.id}`}
                />
                <TouchableRipple
                  onPress={() => navigation.navigate('Tasks')}
                  style={styles.taskBody}
                  accessibilityRole="button"
                  accessibilityLabel={t('tasks:card.open', { title: task.title })}
                  testID={`calendar-task-${task.id}`}
                >
                  <View style={styles.taskTextRow}>
                    <Text
                      variant="bodyMedium"
                      numberOfLines={1}
                      style={[styles.flex, done && [styles.taskDone, { color: colors.onSurfaceVariant }]]}
                    >
                      {task.title}
                    </Text>
                    {task.dueTime ? (
                      <Text variant="labelMedium" style={{ color: colors.onSurfaceVariant }}>
                        {fmt.time(taskDueInstant(task))}
                      </Text>
                    ) : null}
                  </View>
                </TouchableRipple>
              </View>
            );
          })}
        </View>
      ) : null}
      {error && meetings.length > 0 ? (
        <Banner tone="error" text={t(errorMessageKey(error.code))} style={styles.inlineError} testID="calendar-error-banner" />
      ) : null}
    </View>
  );

  const renderEmpty = (): ReactElement => {
    if (isLoading && meetings.length === 0) {
      return (
        <View style={styles.state} testID="calendar-loading">
          <ActivityIndicator />
          <Text variant="bodyMedium" style={[styles.stateText, { color: colors.onSurfaceVariant }]}>
            {t('calendarView:loading')}
          </Text>
        </View>
      );
    }
    if (error && meetings.length === 0) {
      return (
        <ErrorState
          title={t('calendarView:errorTitle')}
          body={t(errorMessageKey(error.code))}
          onRetry={() => {
            if (!refreshing) onRefresh();
          }}
          loading={refreshing}
          testID="calendar-error"
        />
      );
    }
    return (
      <View style={styles.state} testID="calendar-empty-day">
        <Text variant="bodyMedium" style={[styles.stateText, { color: colors.onSurfaceVariant }]}>
          {t('calendarView:emptyDay')}
        </Text>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={dayMeetings}
        keyExtractor={(meeting) => displayKeyOf(meeting)}
        ListHeaderComponent={header}
        ListEmptyComponent={renderEmpty}
        renderItem={({ item }) => (
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
        )}
        onScroll={fab.onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[colors.primary]}
            tintColor={colors.primary}
            progressBackgroundColor={colors.surface}
          />
        }
        testID="calendar-agenda"
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
          onPress={createOnDay}
          accessibilityLabel={t('calendarView:createOnDay', { date: shortDate })}
          accessibilityHint={t('calendarView:createOnDayHint')}
          testID="calendar-create"
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
  header: {
    paddingTop: spacing.xs,
  },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    minHeight: componentMetrics.touchTargetMin,
  },
  monthTitle: {
    flex: 1,
    fontWeight: '700',
  },
  navGroup: {
    flexDirection: 'row',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.full,
  },
  navButton: {
    width: componentMetrics.touchTargetMin - 4,
    height: componentMetrics.touchTargetMin - 4,
    margin: 0,
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
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  legendDot: {
    width: componentMetrics.sourceDotSize,
    height: componentMetrics.sourceDotSize,
    borderRadius: radii.full,
    marginRight: spacing.xs,
  },
  legendTaskDot: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
  },
  tasksBlock: {
    borderWidth: 1,
    borderRadius: radii.md,
    paddingVertical: spacing.xs,
    marginBottom: spacing.md,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  taskToggle: {
    margin: 0,
  },
  taskBody: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingRight: spacing.md,
  },
  taskTextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  taskDone: {
    textDecorationLine: 'line-through',
  },
  divider: {
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  agendaHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  inlineError: {
    marginBottom: spacing.sm,
  },
  state: {
    alignItems: 'center',
    paddingHorizontal: spacing.xxxl,
    paddingVertical: spacing.xxl,
  },
  stateText: {
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  fab: {
    position: 'absolute',
  },
});
