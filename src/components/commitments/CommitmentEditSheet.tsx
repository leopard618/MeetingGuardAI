/**
 * Edit one suggested task before it is added (owner: summaries-app; M11, docs/v2/M11-DESIGN.md
 * section 3.3): the title (at most 200), whose task it is (you, the person the source names,
 * someone else, nobody), the due date and time with the app's themed native picker
 * (src/screens/shared/ThemedDateTimePicker.tsx), and the reminder, with the task invariants the
 * task editor enforces: a time needs a date, a reminder needs a time. TaskEditor is not reused: it
 * starts only from a Task or a new draft.
 *
 * When the owner changes and the title was not edited, the title follows: the old "<owner>: "
 * prefix comes off and the new one goes on, exactly as the server rebuilds it (decision 10,
 * section 16), so the user sees the title the task gets. A title the user typed is kept as typed.
 *
 * The edit lives in the caller's memory only (never stored); Save hands back only what differs
 * from the suggestion (commitmentEditModel.ts editFromSheet). Closing with changes asks first.
 * Generic (decision 15): Sven's A2 opens the same sheet for commitments from emails.
 */
import { useMemo, useState, type ReactElement } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Chip, HelperText, IconButton, Text, TextInput } from 'react-native-paper';

import { MGButton } from '../ui';
import { COMMITMENT_LIMITS, type CommitmentOwner } from '../../core/aiContract';
import { useWindowInsets } from '../../hooks/useWindowInsets';
import { useT } from '../../i18n';
import { ThemedDateTimePicker, type DateTimePickerEvent } from '../../screens/shared/ThemedDateTimePicker';
import { componentMetrics, radii, spacing, useAppTheme } from '../../theme';
import {
  COMMITMENT_REMINDER_CHOICES,
  NO_SCHEDULE,
  defaultOwnerChoice,
  editFromSheet,
  editedTitle,
  ownerChoiceKinds,
  pickedDate,
  pickedTime,
  reminderChoiceLabel,
  retitleForOwner,
  sameOwnerChoice,
  sameSchedule,
  schedulePickerValue,
  validateCommitmentEdit,
  type CommitmentEdit,
  type CommitmentOwnerChoice,
  type CommitmentOwnerKind,
  type CommitmentSchedule,
} from './commitmentEditModel';

export interface CommitmentEditTarget {
  /** Stable id of the suggestion (the sheet starts fresh for another one). */
  id: string;
  /** The suggestion as proposed: its title ("<owner>: ..." for someone else) and owner. */
  suggestion: { title: string; owner: CommitmentOwner | null };
  /** The edit made earlier on this screen, if any. */
  edit: CommitmentEdit | null;
  /** The schedule the sheet opens with: the edit's, else the default the caller computed now. */
  schedule: CommitmentSchedule;
  /** Under the due line while the schedule is untouched ("17:00 meeting time (Europe/Madrid)"). */
  dueNote?: string | null;
}

export interface CommitmentEditSheetProps {
  /** null: closed. */
  target: CommitmentEditTarget | null;
  /** A local date (YYYY-MM-DD) as the user reads it. */
  formatDate(localDate: string): string;
  /** An HH:MM wall-clock time in the user's 12 or 24 h format. */
  formatTime(hhmm: string): string;
  onCancel(): void;
  /** The edit to keep (null: back to the suggestion as proposed). */
  onSave(edit: CommitmentEdit | null): void;
}

export function CommitmentEditSheet({ target, ...rest }: CommitmentEditSheetProps): ReactElement | null {
  if (target === null) return null;
  return <EditSheetBody key={target.id} target={target} {...rest} />;
}

function EditSheetBody({ target, formatDate, formatTime, onCancel, onSave }: Omit<CommitmentEditSheetProps, 'target'> & { target: CommitmentEditTarget }): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const insets = useWindowInsets();
  const { suggestion } = target;
  const [now] = useState(() => new Date());
  const initialOwner = target.edit?.owner ?? defaultOwnerChoice(suggestion.owner);
  const initialTitle = editedTitle(suggestion, target.edit);
  const [title, setTitle] = useState(initialTitle);
  const [titleTouched, setTitleTouched] = useState(target.edit?.title !== undefined);
  const [ownerKind, setOwnerKind] = useState<CommitmentOwnerKind>(initialOwner.kind);
  const [otherName, setOtherName] = useState(initialOwner.kind === 'other' ? initialOwner.name : '');
  const [schedule, setSchedule] = useState<CommitmentSchedule>(target.schedule);
  const [scheduleTouched, setScheduleTouched] = useState(false);
  const [pickerMode, setPickerMode] = useState<'date' | 'time' | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const ownerOf = (kind: CommitmentOwnerKind, name: string): CommitmentOwnerChoice => (kind === 'other' ? { kind, name } : { kind });
  const owner = ownerOf(ownerKind, otherName);
  const kinds = useMemo(() => ownerChoiceKinds(suggestion.owner), [suggestion.owner]);
  const errors = validateCommitmentEdit({ title, owner, schedule });
  const dirty = title !== initialTitle || !sameOwnerChoice(owner, initialOwner) || (scheduleTouched && !sameSchedule(schedule, target.schedule));

  const chooseOwner = (kind: CommitmentOwnerKind, name: string = otherName): void => {
    setOwnerKind(kind);
    if (!titleTouched) setTitle(retitleForOwner(suggestion.title, suggestion.owner, ownerOf(kind, name)));
  };

  const changeSchedule = (next: CommitmentSchedule): void => {
    setSchedule(next);
    setScheduleTouched(true);
  };

  const requestClose = (): void => {
    if (pickerMode !== null) {
      setPickerMode(null);
      return;
    }
    if (!dirty) {
      onCancel();
      return;
    }
    Alert.alert(t('summaries:commitments.edit.discardTitle'), t('summaries:commitments.edit.discardBody'), [
      { text: t('summaries:commitments.edit.keepEditing'), style: 'cancel' },
      { text: t('summaries:commitments.edit.discard'), style: 'destructive', onPress: onCancel },
    ]);
  };

  const save = (): void => {
    setSubmitted(true);
    if (Object.keys(errors).length > 0) return;
    onSave(editFromSheet({ suggestion, previous: target.edit, title, owner, schedule, scheduleTouched }));
  };

  const onPicked = (event: DateTimePickerEvent, value?: Date): void => {
    const mode = pickerMode;
    // Android fires one event per dialog; iOS keeps the spinner open until Done.
    if (Platform.OS === 'android') setPickerMode(null);
    if (event.type !== 'set' || !value || mode === null) return;
    if (mode === 'date') {
      changeSchedule({ ...schedule, dueDate: pickedDate(value) });
    } else if (schedule.dueDate !== null) {
      // A first time gets a reminder at that time (the screen's default); a chosen one is kept.
      changeSchedule({ ...schedule, dueTime: pickedTime(value), reminderMinutesBefore: schedule.dueTime === null ? 0 : schedule.reminderMinutesBefore });
    }
  };

  const titleError =
    submitted && errors.title !== undefined
      ? t(`summaries:commitments.edit.${errors.title}`, { max: COMMITMENT_LIMITS.maxTitleChars })
      : null;
  const ownerError = submitted && errors.owner !== undefined ? t('summaries:commitments.edit.ownerOtherRequired') : null;
  const dueLine =
    schedule.dueDate === null
      ? t('summaries:commitments.edit.clearDate')
      : schedule.dueTime === null
        ? t('summaries:commitments.due.date', { date: formatDate(schedule.dueDate) })
        : t('summaries:commitments.due.dateTime', { date: formatDate(schedule.dueDate), time: formatTime(schedule.dueTime) });
  const box = [styles.box, { borderColor: colors.outlineVariant, backgroundColor: colors.surface }];
  const muted = { color: colors.onSurfaceVariant };

  const ownerLabel = (kind: CommitmentOwnerKind): string => {
    switch (kind) {
      case 'you':
        return t('summaries:commitments.edit.ownerYou');
      case 'named':
        return t('summaries:commitments.edit.ownerNamed', { name: suggestion.owner?.name ?? '' });
      case 'other':
        return t('summaries:commitments.edit.ownerOther');
      case 'nobody':
        return t('summaries:commitments.edit.ownerNobody');
    }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={requestClose} statusBarTranslucent navigationBarTranslucent>
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]} testID="commitment-edit-sheet">
        <View style={[styles.header, { borderBottomColor: colors.outlineVariant }]}>
          <IconButton icon="close" onPress={requestClose} accessibilityLabel={t('summaries:commitments.edit.cancel')} testID="commitment-edit-close" />
          <Text variant="titleLarge" accessibilityRole="header" style={styles.headerTitle} numberOfLines={1}>
            {t('summaries:commitments.edit.title')}
          </Text>
          <MGButton variant="ghost" size="sm" onPress={save} testID="commitment-edit-save">
            {t('summaries:commitments.edit.save')}
          </MGButton>
        </View>
        <KeyboardAvoidingView behavior="padding" style={styles.container}>
          <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.xxl }]} keyboardShouldPersistTaps="handled">
            <TextInput
              mode="outlined"
              outlineStyle={styles.inputOutline}
              label={t('summaries:commitments.edit.titleLabel')}
              value={title}
              onChangeText={(value) => {
                setTitle(value);
                setTitleTouched(true);
              }}
              maxLength={COMMITMENT_LIMITS.maxTitleChars}
              multiline
              error={titleError !== null}
              accessibilityLabel={t('summaries:commitments.edit.titleLabel')}
              testID="commitment-edit-title"
            />
            <HelperText type="error" visible={titleError !== null}>
              {titleError ?? ''}
            </HelperText>

            <View style={box}>
              <Text variant="labelLarge">{t('summaries:commitments.edit.owner')}</Text>
              <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={t('summaries:commitments.edit.owner')}>
                {kinds.map((kind) => (
                  <Chip
                    key={kind}
                    selected={ownerKind === kind}
                    showSelectedOverlay
                    onPress={() => chooseOwner(kind)}
                    style={styles.chip}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: ownerKind === kind }}
                    testID={`commitment-edit-owner-${kind}`}
                  >
                    {ownerLabel(kind)}
                  </Chip>
                ))}
              </View>
              {ownerKind === 'other' ? (
                <>
                  <TextInput
                    mode="outlined"
                    outlineStyle={styles.inputOutline}
                    label={t('summaries:commitments.edit.ownerOtherLabel')}
                    value={otherName}
                    onChangeText={(value) => {
                      setOtherName(value);
                      if (!titleTouched) setTitle(retitleForOwner(suggestion.title, suggestion.owner, { kind: 'other', name: value }));
                    }}
                    maxLength={COMMITMENT_LIMITS.maxOwnerChars}
                    error={ownerError !== null}
                    accessibilityLabel={t('summaries:commitments.edit.ownerOtherLabel')}
                    style={styles.boxValue}
                    testID="commitment-edit-owner-name"
                  />
                  <HelperText type="error" visible={ownerError !== null}>
                    {ownerError ?? ''}
                  </HelperText>
                </>
              ) : null}
              {ownerKind === 'named' || ownerKind === 'other' ? (
                <Text variant="bodySmall" style={[styles.boxValue, muted]} testID="commitment-edit-owner-hint">
                  {t('summaries:commitments.edit.ownerHint')}
                </Text>
              ) : null}
            </View>

            <View style={box}>
              <Text variant="labelLarge">{t('summaries:commitments.edit.due')}</Text>
              <Text variant="bodyLarge" style={styles.boxValue} testID="commitment-edit-due">
                {dueLine}
              </Text>
              {!scheduleTouched && target.dueNote ? (
                <Text variant="bodySmall" style={[styles.boxValue, muted]}>
                  {target.dueNote}
                </Text>
              ) : null}
              <View style={styles.boxActions}>
                <Button mode="outlined" icon="calendar" onPress={() => setPickerMode('date')} style={styles.boxButton} testID="commitment-edit-pick-date">
                  {t('summaries:commitments.edit.pickDate')}
                </Button>
                {schedule.dueDate !== null ? (
                  <Button mode="outlined" icon="clock-outline" onPress={() => setPickerMode('time')} style={styles.boxButton} testID="commitment-edit-pick-time">
                    {t('summaries:commitments.edit.pickTime')}
                  </Button>
                ) : null}
                {schedule.dueTime !== null ? (
                  <Button
                    mode="text"
                    icon="clock-remove-outline"
                    onPress={() => changeSchedule({ ...schedule, dueTime: null, reminderMinutesBefore: null })}
                    style={styles.boxButton}
                    testID="commitment-edit-clear-time"
                  >
                    {t('summaries:commitments.edit.clearTime')}
                  </Button>
                ) : null}
                {schedule.dueDate !== null ? (
                  <Button mode="text" icon="close-circle-outline" onPress={() => changeSchedule(NO_SCHEDULE)} style={styles.boxButton} testID="commitment-edit-clear-date">
                    {t('summaries:commitments.edit.clearDate')}
                  </Button>
                ) : null}
              </View>
              {schedule.dueDate === null ? (
                <Text variant="bodySmall" style={[styles.boxValue, muted]}>
                  {t('summaries:commitments.edit.timeNeedsDate')}
                </Text>
              ) : null}
              {pickerMode !== null ? (
                <ThemedDateTimePicker
                  key={pickerMode}
                  value={schedulePickerValue(schedule, now)}
                  mode={pickerMode}
                  onChange={onPicked}
                  {...(Platform.OS === 'ios' ? { display: 'spinner' as const } : {})}
                  testID="commitment-edit-picker"
                />
              ) : null}
              {Platform.OS === 'ios' && pickerMode !== null ? (
                <Button mode="text" onPress={() => setPickerMode(null)} testID="commitment-edit-picker-done">
                  {t('tasks:editor.pickerDone')}
                </Button>
              ) : null}
            </View>

            <View style={box}>
              <Text variant="labelLarge">{t('summaries:commitments.edit.reminder')}</Text>
              {schedule.dueTime === null ? (
                <Text variant="bodyMedium" style={[styles.boxValue, muted]} testID="commitment-edit-reminder-needs-time">
                  {t('summaries:commitments.edit.reminderNeedsTime')}
                </Text>
              ) : (
                <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={t('summaries:commitments.edit.reminder')}>
                  {COMMITMENT_REMINDER_CHOICES.map((minutes) => {
                    const label = reminderChoiceLabel(minutes);
                    return (
                      <Chip
                        key={String(minutes)}
                        selected={schedule.reminderMinutesBefore === minutes}
                        showSelectedOverlay
                        onPress={() => changeSchedule({ ...schedule, reminderMinutesBefore: minutes })}
                        style={styles.chip}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: schedule.reminderMinutesBefore === minutes }}
                        testID={`commitment-edit-reminder-${String(minutes)}`}
                      >
                        {t(label.key, label.count !== undefined ? { count: label.count } : undefined)}
                      </Chip>
                    );
                  })}
                </View>
              )}
            </View>

            <View style={styles.footer}>
              <MGButton variant="ghost" onPress={requestClose} testID="commitment-edit-cancel">
                {t('summaries:commitments.edit.cancel')}
              </MGButton>
              <MGButton onPress={save} testID="commitment-edit-save-bottom">
                {t('summaries:commitments.edit.save')}
              </MGButton>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
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
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
});
