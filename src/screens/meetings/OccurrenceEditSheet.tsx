/**
 * Scoped edit sheet for one occurrence row (§16): title, date, time and duration. Two scopes,
 * chosen in useMeetingActions().edit:
 * - 'occurrence' ("This meeting only"): saving writes a 'modified' override on the master through
 *   MeetingRecurrenceOps.updateOccurrence (origin 'user'); the rest of the series never changes.
 * - 'following' ("This and following"): saving splits the series at this occurrence through
 *   MeetingRecurrenceOps.editFollowing; the changes land on the NEW tail series and every earlier
 *   occurrence keeps its old values.
 * Rendered by the screens next to MeetingActionsSheet.
 */
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useState, type ReactElement } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Button, Chip, HelperText, Modal, Portal, Text, TextInput, useTheme as usePaperTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

import type { MeetingRecurrenceOps, MeetingRepository } from '../../core/contracts';
import { AppError, errorMessageKey, toAppError } from '../../core/errors';
import { createLogger } from '../../core/logger';
import { getDeviceTimeZone } from '../../core/time';
import { useT } from '../../i18n';
import { meetingRepository } from '../../services/data';
import { capitalizeFirst } from '../shared/text';
import { useFormatters } from '../shared/useFormatters';
import type { OccurrenceEditTarget } from './list/meetingActions';
import { DURATION_OPTIONS, dateFromPicker, pickerDateOf, timeFromPicker } from './meetingForm';
import { isOccurrenceDraftValid, occurrenceEditDraftOf, occurrenceEditPatch, type OccurrenceEditDraft } from './occurrences';

const log = createLogger('meetings');

function updateOccurrenceOp(): MeetingRecurrenceOps['updateOccurrence'] {
  const repository = meetingRepository as MeetingRepository & Partial<MeetingRecurrenceOps>;
  const op = repository.updateOccurrence;
  if (!op) throw new AppError('not_implemented', 'Recurring-meeting operations are not available');
  return op.bind(repository);
}

function editFollowingOp(): MeetingRecurrenceOps['editFollowing'] {
  const repository = meetingRepository as MeetingRepository & Partial<MeetingRecurrenceOps>;
  const op = repository.editFollowing;
  if (!op) throw new AppError('not_implemented', 'Recurring-meeting operations are not available');
  return op.bind(repository);
}

export interface OccurrenceEditSheetProps {
  target: OccurrenceEditTarget | null;
  onDismiss(): void;
}

export function OccurrenceEditSheet({ target, onDismiss }: OccurrenceEditSheetProps): ReactElement {
  return (
    <Portal>
      {target ? (
        <SheetBody key={`${target.entry.id}:${target.localDateKey}:${target.scope}`} target={target} onDismiss={onDismiss} />
      ) : null}
    </Portal>
  );
}

function SheetBody({ target, onDismiss }: { target: OccurrenceEditTarget; onDismiss(): void }): ReactElement {
  const t = useT();
  const theme = usePaperTheme();
  const fmt = useFormatters();
  const insets = useSafeAreaInsets();
  const deviceZone = getDeviceTimeZone();
  const { entry, localDateKey, scope } = target;
  const [draft, setDraft] = useState<OccurrenceEditDraft>(() => occurrenceEditDraftOf(entry));
  const [picker, setPicker] = useState<'date' | 'time' | null>(null);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const valid = isOccurrenceDraftValid(draft);
  const change = (patch: Partial<OccurrenceEditDraft>): void => setDraft((current) => ({ ...current, ...patch }));

  const onPicked = (event: DateTimePickerEvent, value?: Date): void => {
    const mode = picker;
    setPicker(Platform.OS === 'ios' ? mode : null);
    if (event.type !== 'set' || !value || mode === null) return;
    if (mode === 'date') change({ date: dateFromPicker(value) });
    else change({ time: timeFromPicker(value) });
  };

  const save = async (): Promise<void> => {
    setSubmitted(true);
    if (!valid) return;
    const patch = occurrenceEditPatch(entry, draft);
    if (Object.keys(patch).length === 0) {
      // Nothing changed: no override to write - and no reason to split the series in two
      // identical halves for a 'following' edit either.
      onDismiss();
      return;
    }
    setSaving(true);
    try {
      if (scope === 'following') {
        await editFollowingOp()(entry.id, localDateKey, patch, { origin: 'user' });
        Toast.show({ type: 'success', text1: t('meetings:actions.followingUpdated') });
      } else {
        await updateOccurrenceOp()(entry.id, localDateKey, patch, { origin: 'user' });
        Toast.show({ type: 'success', text1: t('meetings:occurrence.updated') });
      }
      onDismiss();
    } catch (caught) {
      const error = toAppError(caught);
      log.warn(scope === 'following' ? 'could not edit this-and-following occurrences' : 'could not update an occurrence', error.code);
      Toast.show({ type: 'error', text1: t(errorMessageKey(error.code)) });
      setSaving(false);
    }
  };

  const durationChoices = [...new Set([...DURATION_OPTIONS, draft.durationMinutes])].sort((a, b) => a - b);
  const dayLabel = capitalizeFirst(fmt.date(draft.date, 'full'));

  return (
    <Modal
      visible
      onDismiss={saving ? undefined : onDismiss}
      style={styles.modal}
      contentContainerStyle={[styles.sheet, { backgroundColor: theme.colors.elevation.level3, marginBottom: insets.bottom + 12 }]}
    >
      <View testID="occurrence-edit-sheet">
        <Text variant="titleMedium" accessibilityRole="header" style={styles.heading}>
          {scope === 'following' ? t('meetings:actions.scopeFollowing') : t('meetings:occurrence.editTitle')}
        </Text>
        <Text variant="bodySmall" style={[styles.subheading, { color: theme.colors.onSurfaceVariant }]}>
          {scope === 'following'
            ? // Shared recurrence phrasing (ai:recurrence.*): "This and the following occurrences
              // from <date>" - the same wording the assistant's confirmation cards use.
              t('ai:recurrence.scopeFollowing', { date: fmt.date(localDateKey, 'long') })
            : t('meetings:occurrence.editSubtitle', { date: fmt.date(localDateKey, 'long') })}
        </Text>
        <TextInput
          mode="outlined"
          label={t('meetings:occurrence.titleLabel')}
          value={draft.title}
          onChangeText={(value) => change({ title: value })}
          maxLength={200}
          error={submitted && !valid && draft.title.trim().length === 0}
          testID="occurrence-edit-title"
        />
        <Text variant="bodyLarge" style={styles.when} testID="occurrence-edit-when">
          {`${dayLabel} · ${fmt.time(pickerDateOf(draft))}`}
        </Text>
        {entry.timezone !== deviceZone ? (
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            {t('meetings:form.timeZone', { zone: entry.timezone })}
          </Text>
        ) : null}
        <View style={styles.buttonRow}>
          <Button mode="outlined" icon="calendar" onPress={() => setPicker('date')} style={styles.inlineButton} testID="occurrence-edit-pick-date">
            {t('meetings:occurrence.dateLabel')}
          </Button>
          <Button mode="outlined" icon="clock-outline" onPress={() => setPicker('time')} style={styles.inlineButton} testID="occurrence-edit-pick-time">
            {t('meetings:occurrence.timeLabel')}
          </Button>
        </View>
        {picker !== null ? (
          <View>
            <DateTimePicker
              value={pickerDateOf(draft)}
              mode={picker}
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={onPicked}
              is24Hour={fmt.options.use24Hour ?? undefined}
            />
            {Platform.OS === 'ios' ? (
              <Button mode="text" style={styles.alignStart} onPress={() => setPicker(null)}>
                {t('common:actions.done')}
              </Button>
            ) : null}
          </View>
        ) : null}
        <Text variant="titleSmall" style={styles.durationLabel}>
          {t('meetings:occurrence.durationLabel')}
        </Text>
        <View style={styles.chips}>
          {durationChoices.map((minutes) => (
            <Chip
              key={minutes}
              selected={draft.durationMinutes === minutes}
              mode={draft.durationMinutes === minutes ? 'flat' : 'outlined'}
              style={styles.chip}
              onPress={() => change({ durationMinutes: minutes })}
            >
              {fmt.duration(minutes)}
            </Chip>
          ))}
        </View>
        {submitted && !valid ? (
          <HelperText type="error" visible testID="occurrence-edit-error">
            {t('meetings:occurrence.invalid')}
          </HelperText>
        ) : null}
        <View style={styles.footer}>
          <Button mode="outlined" onPress={onDismiss} disabled={saving} style={styles.footerButton} testID="occurrence-edit-cancel">
            {t('common:actions.cancel')}
          </Button>
          <Button
            mode="contained"
            onPress={() => {
              void save();
            }}
            loading={saving}
            disabled={saving}
            style={styles.footerButton}
            testID="occurrence-edit-save"
          >
            {t('meetings:form.saveChanges')}
          </Button>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modal: {
    justifyContent: 'flex-end',
  },
  sheet: {
    marginHorizontal: 12,
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  heading: {
    marginBottom: 2,
  },
  subheading: {
    marginBottom: 12,
  },
  when: {
    marginTop: 12,
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  inlineButton: {
    marginRight: 8,
    marginBottom: 8,
  },
  alignStart: {
    alignSelf: 'flex-start',
  },
  durationLabel: {
    marginTop: 8,
    marginBottom: 4,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  chip: {
    marginRight: 8,
    marginBottom: 8,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 12,
    gap: 12,
  },
  footerButton: {
    minWidth: 120,
  },
});
