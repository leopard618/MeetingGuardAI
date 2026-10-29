/**
 * Full-screen task editor (create and edit): title, description, due date + time (native
 * pickers), reminder choice, optional linked meeting (MeetingPicker) and delete. People set by
 * the assistant are shown read-only. While the Microsoft To Do sync is on, the editor shows which
 * list the task goes to (changeable) and what To Do does not keep. Closing with unsaved changes
 * asks first. Persistence is the caller's job (`onSubmit`).
 */
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useEffect, useState, type ReactElement } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Chip, HelperText, IconButton, Text, TextInput, useTheme as usePaperTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MGButton } from '../../components/ui';
import type { TodoList } from '../../core/contracts';
import type { Meeting, Task } from '../../core/types';
import { useT } from '../../i18n';
import { componentMetrics, radii, spacing } from '../../theme';
import { MeetingPicker } from '../notes/MeetingPicker';
import type { Formatters } from '../shared/useFormatters';
import {
  REMINDER_CHOICES,
  TASK_DESCRIPTION_MAX,
  TASK_TITLE_MAX,
  dateToDueDate,
  dateToDueTime,
  draftFromTask,
  isDraftDirty,
  newTaskDraft,
  pickerStartDate,
  validateTaskDraft,
  type TaskDraft,
  type TaskDraftError,
} from './tasksModel';

/** Microsoft To Do sync as the editor sees it (null = off: no list box). */
export interface TaskEditorTodo {
  /** The list new tasks go to by default (Preferences.todoListId). */
  defaultList: { id: string; name: string } | null;
  listLists(): Promise<TodoList[]>;
}

export interface TaskEditorProps {
  /** null = a new task. */
  task: Task | null;
  todo?: TaskEditorTodo | null;
  meetings: readonly Meeting[];
  meetingsById: ReadonlyMap<string, Meeting>;
  fmt: Formatters;
  onClose(): void;
  /** Saves the draft; resolves true when saved (the caller then closes the editor). */
  onSubmit(draft: TaskDraft): Promise<boolean>;
  /** Only for an existing task. */
  onDelete?(task: Task): void;
  /** Why the last save / delete failed (toasts hide behind the editor's Modal). */
  errorMessage?: string | null;
}

export function reminderLabelKey(minutes: number | null): { key: string; count?: number } {
  if (minutes === null) return { key: 'tasks:editor.reminderNone' };
  if (minutes === 0) return { key: 'tasks:editor.reminderAtDue' };
  if (minutes === 1440) return { key: 'tasks:editor.reminderDayBefore' };
  return { key: 'tasks:editor.reminderMinutes', count: minutes };
}

export function TaskEditor({
  task,
  todo = null,
  meetings,
  meetingsById,
  fmt,
  onClose,
  onSubmit,
  onDelete,
  errorMessage = null,
}: TaskEditorProps): ReactElement {
  const t = useT();
  const theme = usePaperTheme();
  const insets = useSafeAreaInsets();
  const [original] = useState<TaskDraft>(() => (task ? draftFromTask(task) : newTaskDraft()));
  const [draft, setDraft] = useState<TaskDraft>(original);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [pickerMode, setPickerMode] = useState<'date' | 'time' | null>(null);
  const [now] = useState(() => new Date());
  const errors = validateTaskDraft(draft);
  const dirty = isDraftDirty(draft, original);
  const change = (patch: Partial<TaskDraft>): void => setDraft((current) => ({ ...current, ...patch }));
  const [todoLists, setTodoLists] = useState<{ lists: TodoList[]; loading: boolean; failed: boolean } | null>(null);
  const [choosingList, setChoosingList] = useState(false);

  useEffect(() => {
    // The lists are needed to name a non-default list and to offer a change; one cheap call.
    if (todo === null || todoLists !== null) return;
    let cancelled = false;
    setTodoLists({ lists: [], loading: true, failed: false });
    todo
      .listLists()
      .then((lists) => {
        if (!cancelled) setTodoLists({ lists, loading: false, failed: false });
      })
      .catch(() => {
        if (!cancelled) setTodoLists({ lists: [], loading: false, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [todo, todoLists]);

  const todoListName = (): string => {
    if (todo === null) return '';
    if (draft.todoListId === null || draft.todoListId === todo.defaultList?.id) {
      return todo.defaultList ? t('tasks:editor.todoListDefault', { name: todo.defaultList.name }) : t('tasks:editor.todoNoList');
    }
    const named = todoLists?.lists.find((list) => list.id === draft.todoListId);
    if (named) return named.name;
    return todoLists?.loading ? t('tasks:editor.todoLoading') : t('tasks:editor.todoOtherList');
  };

  const errorText = (error: TaskDraftError | undefined): string | null => {
    if (!submitted || !error) return null;
    return t(`tasks:errors.${error}`, { max: error === 'descriptionTooLong' ? TASK_DESCRIPTION_MAX : TASK_TITLE_MAX });
  };

  const requestClose = (): void => {
    if (picking) {
      setPicking(false);
      return;
    }
    if (pickerMode !== null) {
      setPickerMode(null);
      return;
    }
    if (saving) return;
    if (!dirty) {
      onClose();
      return;
    }
    Alert.alert(t('tasks:editor.discardTitle'), t('tasks:editor.discardMessage'), [
      { text: t('tasks:editor.keepEditing'), style: 'cancel' },
      { text: t('tasks:editor.discard'), style: 'destructive', onPress: onClose },
    ]);
  };

  const save = async (): Promise<void> => {
    setSubmitted(true);
    if (Object.keys(errors).length > 0) return;
    if (task && !dirty) {
      onClose();
      return;
    }
    setSaving(true);
    const saved = await onSubmit(draft);
    if (!saved) setSaving(false);
  };

  const onPicked = (event: DateTimePickerEvent, value?: Date): void => {
    const mode = pickerMode;
    // Android fires one event and the picker must be re-armed manually; iOS keeps it inline.
    if (Platform.OS === 'android') setPickerMode(null);
    if (event.type !== 'set' || !value || mode === null) return;
    if (mode === 'date') change({ dueDate: dateToDueDate(value) });
    else change({ dueTime: dateToDueTime(value) });
  };

  const dueSummary = (): string => {
    if (draft.dueDate === null) return t('tasks:editor.noDueDate');
    const date = fmt.date(`${draft.dueDate}T00:00:00`);
    if (draft.dueTime === null) return date;
    return t('tasks:editor.dueAt', { date, time: fmt.time(`${draft.dueDate}T${draft.dueTime}:00`) });
  };

  const linkedMeeting = draft.meetingId ? (meetingsById.get(draft.meetingId) ?? null) : undefined;
  const titleError = errorText(errors.title);
  const descriptionError = errorText(errors.description);

  return (
    <Modal visible animationType="slide" onRequestClose={requestClose} statusBarTranslucent navigationBarTranslucent>
      <View style={[styles.container, { backgroundColor: theme.colors.background, paddingTop: insets.top }]} testID="task-editor">
        {picking ? (
          <MeetingPicker
            meetings={meetings}
            selectedId={draft.meetingId}
            fmt={fmt}
            now={now}
            onBack={() => setPicking(false)}
            onSelect={(meetingId) => {
              change({ meetingId });
              setPicking(false);
            }}
          />
        ) : (
          <>
            <View style={[styles.header, { borderBottomColor: theme.colors.outlineVariant }]}>
              <IconButton icon="close" onPress={requestClose} accessibilityLabel={t('tasks:editor.close')} disabled={saving} testID="task-editor-close" />
              <Text variant="titleLarge" accessibilityRole="header" style={styles.headerTitle} numberOfLines={1}>
                {task ? t('tasks:editor.editTitle') : t('tasks:editor.newTitle')}
              </Text>
              <MGButton variant="ghost" size="sm" onPress={() => void save()} loading={saving} disabled={saving} testID="task-editor-save">
                {t('tasks:editor.save')}
              </MGButton>
            </View>
            <KeyboardAvoidingView behavior="padding" style={styles.container}>
              <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
                {errorMessage ? (
                  <HelperText type="error" visible accessibilityLiveRegion="polite" style={styles.saveError} testID="task-editor-error">
                    {errorMessage}
                  </HelperText>
                ) : null}
                <TextInput
                  mode="outlined"
                  outlineStyle={styles.inputOutline}
                  label={t('tasks:editor.titleLabel')}
                  value={draft.title}
                  onChangeText={(title) => change({ title })}
                  maxLength={TASK_TITLE_MAX}
                  error={titleError !== null}
                  autoFocus={task === null}
                  returnKeyType="next"
                  accessibilityLabel={t('tasks:editor.titleLabel')}
                  testID="task-title-input"
                />
                <HelperText type="error" visible={titleError !== null}>
                  {titleError ?? ''}
                </HelperText>

                <TextInput
                  mode="outlined"
                  outlineStyle={styles.inputOutline}
                  label={t('tasks:editor.descriptionLabel')}
                  placeholder={t('tasks:editor.descriptionPlaceholder')}
                  value={draft.description}
                  onChangeText={(description) => change({ description })}
                  multiline
                  maxLength={TASK_DESCRIPTION_MAX}
                  error={descriptionError !== null}
                  style={styles.description}
                  textAlignVertical="top"
                  accessibilityLabel={t('tasks:editor.descriptionLabel')}
                  testID="task-description-input"
                />
                <HelperText type="error" visible={descriptionError !== null}>
                  {descriptionError ?? ''}
                </HelperText>

                <View style={[styles.box, { borderColor: theme.colors.outlineVariant, backgroundColor: theme.colors.surface }]}>
                  <Text variant="labelLarge">{t('tasks:editor.dueSection')}</Text>
                  <Text variant="bodyLarge" style={styles.boxValue} testID="task-due-summary">
                    {dueSummary()}
                  </Text>
                  <View style={styles.boxActions}>
                    <Button mode="outlined" icon="calendar" onPress={() => setPickerMode('date')} style={styles.boxButton} testID="task-pick-date">
                      {draft.dueDate ? t('tasks:editor.changeDate') : t('tasks:editor.pickDate')}
                    </Button>
                    {draft.dueDate ? (
                      <Button mode="outlined" icon="clock-outline" onPress={() => setPickerMode('time')} style={styles.boxButton} testID="task-pick-time">
                        {draft.dueTime ? t('tasks:editor.changeTime') : t('tasks:editor.pickTime')}
                      </Button>
                    ) : null}
                    {draft.dueDate ? (
                      <Button
                        mode="text"
                        icon="close-circle-outline"
                        onPress={() => change({ dueDate: null, dueTime: null, reminderMinutesBefore: null })}
                        style={styles.boxButton}
                        testID="task-clear-due"
                      >
                        {t('tasks:editor.clearDue')}
                      </Button>
                    ) : null}
                  </View>
                  {pickerMode !== null ? (
                    <DateTimePicker
                      value={pickerStartDate(draft, now)}
                      mode={pickerMode}
                      onChange={onPicked}
                      {...(Platform.OS === 'ios' ? { display: 'spinner' as const } : {})}
                      testID="task-due-picker"
                    />
                  ) : null}
                  {Platform.OS === 'ios' && pickerMode !== null ? (
                    <Button mode="text" onPress={() => setPickerMode(null)} testID="task-picker-done">
                      {t('tasks:editor.pickerDone')}
                    </Button>
                  ) : null}
                </View>

                <View style={[styles.box, { borderColor: theme.colors.outlineVariant, backgroundColor: theme.colors.surface }]}>
                  <Text variant="labelLarge">{t('tasks:editor.reminder')}</Text>
                  {draft.dueTime === null ? (
                    <Text variant="bodyMedium" style={[styles.boxValue, { color: theme.colors.onSurfaceVariant }]}>
                      {t('tasks:editor.reminderNeedsTime')}
                    </Text>
                  ) : (
                    <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={t('tasks:editor.reminder')}>
                      {REMINDER_CHOICES.map((minutes) => {
                        const label = reminderLabelKey(minutes);
                        return (
                          <Chip
                            key={String(minutes)}
                            selected={draft.reminderMinutesBefore === minutes}
                            showSelectedOverlay
                            onPress={() => change({ reminderMinutesBefore: minutes })}
                            style={styles.chip}
                            accessibilityRole="radio"
                            testID={`task-reminder-${String(minutes)}`}
                          >
                            {t(label.key, label.count !== undefined ? { count: label.count } : undefined)}
                          </Chip>
                        );
                      })}
                    </View>
                  )}
                </View>

                {task && task.people.length > 0 ? (
                  <View style={[styles.box, { borderColor: theme.colors.outlineVariant, backgroundColor: theme.colors.surface }]}>
                    <Text variant="labelLarge">{t('tasks:editor.people')}</Text>
                    <View style={styles.chips}>
                      {task.people.map((person, index) => (
                        <Chip key={`${person.name}-${index}`} icon="account-outline" style={styles.chip}>
                          {person.name}
                        </Chip>
                      ))}
                    </View>
                  </View>
                ) : null}

                <View style={[styles.box, { borderColor: theme.colors.outlineVariant, backgroundColor: theme.colors.surface }]}>
                  <Text variant="labelLarge">{t('tasks:editor.meeting')}</Text>
                  {linkedMeeting ? (
                    <View style={styles.boxValue}>
                      <Text variant="bodyLarge" numberOfLines={2} testID="task-linked-meeting">
                        {linkedMeeting.title}
                      </Text>
                      <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                        {fmt.meetingRange(linkedMeeting)}
                      </Text>
                    </View>
                  ) : (
                    <Text variant="bodyMedium" style={[styles.boxValue, { color: theme.colors.onSurfaceVariant }]}>
                      {linkedMeeting === null ? t('tasks:card.meetingUnavailable') : t('tasks:editor.meetingNone')}
                    </Text>
                  )}
                  <View style={styles.boxActions}>
                    <Button mode="outlined" icon="calendar-search" onPress={() => setPicking(true)} style={styles.boxButton} testID="task-link-meeting">
                      {draft.meetingId ? t('tasks:editor.changeMeeting') : t('tasks:editor.linkMeeting')}
                    </Button>
                    {draft.meetingId ? (
                      <Button
                        mode="text"
                        icon="link-variant-off"
                        onPress={() => change({ meetingId: null })}
                        accessibilityLabel={t('tasks:editor.unlinkA11y')}
                        style={styles.boxButton}
                        testID="task-unlink-meeting"
                      >
                        {t('tasks:editor.unlinkMeeting')}
                      </Button>
                    ) : null}
                  </View>
                </View>

                {todo !== null ? (
                  <View style={[styles.box, { borderColor: theme.colors.outlineVariant, backgroundColor: theme.colors.surface }]} testID="task-todo-box">
                    <Text variant="labelLarge">{t('tasks:editor.todoSection')}</Text>
                    <Text variant="bodyLarge" style={styles.boxValue} testID="task-todo-list">
                      {todoListName()}
                    </Text>
                    {choosingList ? (
                      todoLists?.failed ? (
                        <Text variant="bodyMedium" style={[styles.boxValue, { color: theme.colors.error }]}>
                          {t('tasks:editor.todoListsFailed')}
                        </Text>
                      ) : (
                        <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={t('tasks:editor.todoSection')}>
                          {(todoLists?.lists ?? []).map((list) => {
                            const selected = (draft.todoListId ?? todo.defaultList?.id ?? null) === list.id;
                            return (
                              <Chip
                                key={list.id}
                                selected={selected}
                                showSelectedOverlay
                                onPress={() => {
                                  change({ todoListId: list.id === todo.defaultList?.id && draft.todoListId === null ? null : list.id });
                                  setChoosingList(false);
                                }}
                                style={styles.chip}
                                accessibilityRole="radio"
                                testID={`task-todo-list-${list.id}`}
                              >
                                {list.name}
                              </Chip>
                            );
                          })}
                        </View>
                      )
                    ) : (
                      <View style={styles.boxActions}>
                        <Button
                          mode="outlined"
                          icon="format-list-checks"
                          onPress={() => setChoosingList(true)}
                          disabled={todoLists === null || todoLists.loading}
                          style={styles.boxButton}
                          testID="task-todo-change-list"
                        >
                          {t('tasks:editor.todoChangeList')}
                        </Button>
                      </View>
                    )}
                    <Text variant="bodySmall" style={[styles.boxValue, { color: theme.colors.onSurfaceVariant }]} testID="task-todo-hint">
                      {t('tasks:editor.todoHint')}
                    </Text>
                  </View>
                ) : null}

                {task && onDelete ? (
                  <Button
                    mode="outlined"
                    icon="delete-outline"
                    textColor={theme.colors.error}
                    onPress={() => onDelete(task)}
                    disabled={saving}
                    style={styles.delete}
                    testID="task-editor-delete"
                  >
                    {t('tasks:editor.delete')}
                  </Button>
                ) : null}
              </ScrollView>
            </KeyboardAvoidingView>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: componentMetrics.headerMinHeight,
    paddingRight: componentMetrics.screenGutter,
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
  },
  headerTitle: {
    flex: 1,
  },
  body: {
    paddingHorizontal: componentMetrics.screenGutter,
    paddingTop: componentMetrics.screenGutter,
  },
  inputOutline: {
    borderRadius: radii.md,
  },
  description: {
    minHeight: 120,
  },
  box: {
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: componentMetrics.cardPadding,
    marginBottom: componentMetrics.screenGutter,
  },
  boxValue: {
    marginTop: spacing.sm,
  },
  boxActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: componentMetrics.cardGap,
  },
  boxButton: {
    marginRight: spacing.sm,
    marginBottom: spacing.xs,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.sm,
  },
  chip: {
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
  },
  delete: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
  },
  saveError: {
    marginBottom: spacing.sm,
  },
});
