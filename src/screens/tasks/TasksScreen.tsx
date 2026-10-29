/**
 * Tasks (route "Tasks", V2 Stage 1). Real, persisted tasks: the data layer's tasks repository
 * (Firestore users/{uid}/tasks with the per-user cache and outbox, so everything works offline
 * and syncs later). Reminders are scheduled by src/services/alerts/taskReminders.ts.
 *
 * - Search (title, description, people and the linked meeting's title) and state filters
 *   (open / today / overdue / done / all).
 * - Open tasks first by due (repository order); a tap on the circle completes / reopens.
 * - Create / edit in a full-screen editor: title, description, due date + time, reminder,
 *   optional linked meeting. Delete asks first; tasks are hard-deleted everywhere.
 */
import type { StackScreenProps } from '@react-navigation/stack';
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { Alert, Animated, FlatList, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Chip, FAB, Searchbar, Text, useTheme as usePaperTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

import { Banner, EmptyState, MGButton } from '../../components/ui';
import type { RootStackParamList } from '../../core/contracts';
import { errorMessageKey, toAppError } from '../../core/errors';
import { createLogger } from '../../core/logger';
import { getDeviceTimeZone } from '../../core/time';
import type { Meeting, Task } from '../../core/types';
import { useT } from '../../i18n';
import { todoSyncService, useCalendarStatus } from '../../services/calendar';
import { useMeetings, useSyncState, useTasks } from '../../services/data';
import { componentMetrics, spacing } from '../../theme';
import { FAB_SLIDE_DP, useHideOnScroll } from '../meetings/list/useHideOnScroll';
import { useFormatters } from '../shared/useFormatters';
import { useLiveNow } from '../shared/useLiveNow';
import { TaskCard } from './TaskCard';
import { TaskEditor, type TaskEditorTodo } from './TaskEditor';
import {
  TASK_FILTERS,
  countByFilter,
  draftToInput,
  draftToPatch,
  filterTasks,
  isOverdue,
  type TaskDraft,
  type TaskFilter,
} from './tasksModel';

const log = createLogger('tasks');

type Props = StackScreenProps<RootStackParamList, 'Tasks'>;

type EditorState = { mode: 'create' } | { mode: 'edit'; task: Task } | null;

const CLOCK_TICK_MS = 60_000;

const FILTER_ICONS: Record<TaskFilter, string> = {
  open: 'circle-outline',
  today: 'calendar-today',
  overdue: 'alert-circle-outline',
  done: 'check-circle-outline',
  all: 'format-list-checks',
};

export function TasksScreen({ navigation }: Props): ReactElement {
  const t = useT();
  const theme = usePaperTheme();
  const insets = useSafeAreaInsets();
  const fab = useHideOnScroll();
  const fmt = useFormatters();
  const now = useLiveNow(CLOCK_TICK_MS);
  const deviceZone = getDeviceTimeZone();
  const { tasks, isLoading, error, create, update, remove } = useTasks();
  const { meetings, isLoading: meetingsLoading } = useMeetings();
  const sync = useSyncState();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<TaskFilter>('open');
  const [editor, setEditor] = useState<EditorState>(null);
  const [editorError, setEditorError] = useState<string | null>(null);

  const meetingsById = useMemo(() => new Map(meetings.map((meeting) => [meeting.id, meeting])), [meetings]);
  const visible = useMemo(
    () =>
      filterTasks(tasks, {
        query,
        filter,
        now,
        deviceZone,
        meetingTitle: (id) => meetingsById.get(id)?.title ?? null,
      }),
    [tasks, query, filter, now, deviceZone, meetingsById],
  );
  const counts = useMemo(() => countByFilter(tasks, now, deviceZone), [tasks, now, deviceZone]);
  const filtered = query.trim().length > 0 || filter !== 'open';

  const linkedMeeting = useCallback(
    (task: Task): Meeting | null | undefined => {
      if (!task.meetingId || meetingsLoading) return undefined;
      return meetingsById.get(task.meetingId) ?? null;
    },
    [meetingsById, meetingsLoading],
  );

  const errorText = useCallback(
    (caught: unknown, what: string): string => {
      const appError = toAppError(caught);
      log.warn(what, appError.code);
      return t(errorMessageKey(appError.code));
    },
    [t],
  );

  const showError = useCallback(
    (caught: unknown, what: string): void => {
      Toast.show({ type: 'error', text1: errorText(caught, what) });
    },
    [errorText],
  );

  const openEditor = useCallback((next: Exclude<EditorState, null>): void => {
    setEditorError(null);
    setEditor(next);
  }, []);

  const deleteTask = useCallback(
    async (task: Task): Promise<void> => {
      try {
        await remove(task.id);
        setEditor((current) => (current?.mode === 'edit' && current.task.id === task.id ? null : current));
        Toast.show({ type: 'success', text1: t('tasks:toast.deleted') });
      } catch (caught) {
        if (editor?.mode === 'edit' && editor.task.id === task.id) setEditorError(errorText(caught, 'could not delete a task'));
        else showError(caught, 'could not delete a task');
      }
    },
    [remove, editor, errorText, showError, t],
  );

  const confirmDelete = useCallback(
    (task: Task): void => {
      Alert.alert(t('tasks:delete.title', { title: task.title }), t('tasks:delete.message'), [
        { text: t('common:actions.cancel'), style: 'cancel' },
        { text: t('tasks:delete.confirm'), style: 'destructive', onPress: () => void deleteTask(task) },
      ]);
    },
    [deleteTask, t],
  );

  const toggleStatus = useCallback(
    async (task: Task): Promise<void> => {
      try {
        await update(task.id, { status: task.status === 'done' ? 'open' : 'done' });
        Toast.show({ type: 'success', text1: t(task.status === 'done' ? 'tasks:toast.reopened' : 'tasks:toast.completed') });
      } catch (caught) {
        showError(caught, 'could not change a task status');
      }
    },
    [update, showError, t],
  );

  // Microsoft To Do (M7): the editor shows the target list while the sync is on.
  const todoStatus = useCalendarStatus().todo;
  const todoEnabled = todoStatus?.enabled === true;
  const todoListId = todoStatus?.listId ?? null;
  const todoListName = todoStatus?.listName ?? '';
  const todo = useMemo<TaskEditorTodo | null>(
    () =>
      todoEnabled
        ? { defaultList: todoListId !== null ? { id: todoListId, name: todoListName } : null, listLists: () => todoSyncService.listLists() }
        : null,
    [todoEnabled, todoListId, todoListName],
  );

  const openTask = useCallback((task: Task) => openEditor({ mode: 'edit', task }), [openEditor]);
  const onToggleStatus = useCallback((task: Task) => void toggleStatus(task), [toggleStatus]);
  const openMeeting = useCallback((meetingId: string) => navigation.navigate('MeetingDetails', { meetingId }), [navigation]);

  const submit = useCallback(
    async (draft: TaskDraft): Promise<boolean> => {
      if (!editor) return false;
      setEditorError(null);
      try {
        if (editor.mode === 'create') {
          await create(draftToInput(draft));
        } else {
          const patch = draftToPatch(editor.task, draft);
          if (patch) await update(editor.task.id, patch);
        }
        setEditor(null);
        Toast.show({ type: 'success', text1: t('tasks:toast.saved') });
        return true;
      } catch (caught) {
        setEditorError(errorText(caught, 'could not save a task'));
        return false;
      }
    },
    [editor, create, update, errorText, t],
  );

  const clearFilters = (): void => {
    setQuery('');
    setFilter('open');
  };

  const dueText = useCallback(
    (task: Task): string => {
      if (task.status === 'done') {
        return task.completedAt ? t('tasks:card.completed', { when: fmt.dateTime(task.completedAt) }) : '';
      }
      if (task.dueDate === null) return '';
      const date = fmt.date(`${task.dueDate}T00:00:00`);
      if (task.dueTime === null) return t('tasks:card.dueOn', { date });
      return t('tasks:card.dueAt', { date, time: fmt.time(`${task.dueDate}T${task.dueTime}:00`) });
    },
    [fmt, t],
  );

  const renderItem = useCallback(
    ({ item }: { item: Task }): ReactElement => {
      const meeting = linkedMeeting(item);
      return (
        <TaskCard
          task={item}
          meeting={meeting}
          meetingWhen={meeting ? fmt.meetingRange(meeting) : ''}
          dueText={dueText(item)}
          overdue={isOverdue(item, now, deviceZone)}
          onToggleStatus={onToggleStatus}
          onOpen={openTask}
          onDelete={confirmDelete}
          onOpenMeeting={openMeeting}
        />
      );
    },
    [linkedMeeting, fmt, dueText, now, deviceZone, onToggleStatus, openTask, confirmDelete, openMeeting],
  );

  const renderEmpty = (): ReactElement => {
    if (isLoading) {
      return (
        <View style={styles.centered} testID="tasks-loading">
          <ActivityIndicator size="large" />
          <Text variant="bodyMedium" style={styles.centeredText}>
            {t('tasks:list.loading')}
          </Text>
        </View>
      );
    }
    if (error && tasks.length === 0) {
      return (
        <View style={styles.centered}>
          <EmptyState icon="cloud-alert" tone="error" title={t('tasks:loadError.title')} body={t(errorMessageKey(error.code))} testID="tasks-error" />
        </View>
      );
    }
    if (tasks.length === 0) {
      return (
        <View style={styles.centered}>
          <EmptyState
            icon="checkbox-marked-circle-outline"
            title={t('tasks:empty.title')}
            body={t('tasks:empty.body')}
            action={{ label: t('tasks:empty.action'), onPress: () => openEditor({ mode: 'create' }) }}
            testID="tasks-empty"
          />
        </View>
      );
    }
    return (
      <View style={styles.centered}>
        <EmptyState icon="magnify" title={t('tasks:noMatches.title')} body={t('tasks:noMatches.body')} testID="tasks-no-matches" />
        {filtered ? (
          <MGButton variant="tonal" style={styles.clearButton} onPress={clearFilters} testID="tasks-clear-filters">
            {t('tasks:noMatches.action')}
          </MGButton>
        ) : null}
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={styles.top}>
        <Searchbar
          placeholder={t('tasks:search.placeholder')}
          value={query}
          onChangeText={setQuery}
          accessibilityLabel={t('tasks:search.placeholder')}
          clearAccessibilityLabel={t('tasks:search.clear')}
          testID="tasks-search"
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
          accessibilityRole="radiogroup"
          accessibilityLabel={t('tasks:filters.label')}
        >
          {TASK_FILTERS.map((option) => (
            <Chip
              key={option}
              selected={filter === option}
              showSelectedOverlay
              icon={FILTER_ICONS[option]}
              onPress={() => setFilter(option)}
              style={styles.filterChip}
              accessibilityRole="radio"
              testID={`tasks-filter-${option}`}
            >
              {t('tasks:filters.withCount', { label: t(`tasks:filters.${option}`), count: counts[option] })}
            </Chip>
          ))}
        </ScrollView>
        {!sync.online ? (
          <Banner tone="warning" icon="cloud-off-outline" text={t('data:sync.offline')} style={styles.notice} testID="tasks-offline" />
        ) : null}
        {error && tasks.length > 0 ? (
          <Banner tone="error" text={t(errorMessageKey(error.code))} style={styles.notice} testID="tasks-error-banner" />
        ) : null}
      </View>

      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListEmptyComponent={renderEmpty()}
        ListHeaderComponent={
          visible.length > 0 ? (
            <Text variant="labelMedium" style={[styles.count, { color: theme.colors.onSurfaceVariant }]} accessibilityRole="summary">
              {t('tasks:list.count', { count: visible.length })}
            </Text>
          ) : null
        }
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 96 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onScroll={fab.onScroll}
        scrollEventThrottle={16}
        testID="tasks-list"
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
        <FAB icon="plus" label={t('tasks:add')} accessibilityLabel={t('tasks:addA11y')} onPress={() => openEditor({ mode: 'create' })} testID="tasks-add" />
      </Animated.View>

      {editor ? (
        <TaskEditor
          task={editor.mode === 'edit' ? editor.task : null}
          todo={todo}
          meetings={meetings}
          meetingsById={meetingsById}
          fmt={fmt}
          onClose={() => setEditor(null)}
          onSubmit={submit}
          onDelete={confirmDelete}
          errorMessage={editorError}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  top: {
    paddingHorizontal: componentMetrics.screenGutter,
    paddingTop: spacing.md,
  },
  filters: {
    paddingVertical: spacing.md,
  },
  filterChip: {
    marginRight: spacing.sm,
  },
  list: {
    flexGrow: 1,
    paddingHorizontal: componentMetrics.screenGutter,
  },
  count: {
    marginBottom: spacing.sm,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
  centeredText: {
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  clearButton: {
    alignSelf: 'center',
  },
  notice: {
    marginBottom: spacing.sm,
  },
  fab: {
    position: 'absolute',
  },
});
