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
import { Chip, HelperText, Modal, Portal, Text, TextInput, useTheme as usePaperTheme } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import { ListGroup, ListRow, MGButton, SheetHandle } from '../../components/ui';
import type { MeetingRecurrenceOps, MeetingRepository } from '../../core/contracts';
import { AppError, errorMessageKey, toAppError } from '../../core/errors';
import { createLogger } from '../../core/logger';
import { getDeviceTimeZone } from '../../core/time';
import { useWindowInsets } from '../../hooks/useWindowInsets';
import { useT } from '../../i18n';
import { meetingRepository } from '../../services/data';
import { radii, spacing } from '../../theme';
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
  const insets = useWindowInsets();
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
      contentContainerStyle={[
        styles.sheet,
        { backgroundColor: theme.colors.elevation.level3, paddingBottom: insets.bottom + spacing.lg },
      ]}
    >
      <View testID="occurrence-edit-sheet">
        <SheetHandle />
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
          outlineStyle={styles.inputOutline}
          error={submitted && !valid && draft.title.trim().length === 0}
          testID="occurrence-edit-title"
        />
        {entry.timezone !== deviceZone ? (
          <Text variant="bodySmall" style={[styles.zoneNote, { color: theme.colors.onSurfaceVariant }]}>
            {t('meetings:form.timeZone', { zone: entry.timezone })}
          </Text>
        ) : null}
        <ListGroup style={styles.pickerGroup} testID="occurrence-edit-when">
          <ListRow
            icon="calendar"
            title={t('meetings:occurrence.dateLabel')}
            supporting={dayLabel}
            trailing="chevron"
            onPress={() => setPicker('date')}
            testID="occurrence-edit-pick-date"
          />
          <ListRow
            icon="clock-outline"
            title={t('meetings:occurrence.timeLabel')}
            supporting={fmt.time(pickerDateOf(draft))}
            trailing="chevron"
            onPress={() => setPicker('time')}
            testID="occurrence-edit-pick-time"
          />
        </ListGroup>
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
              <MGButton variant="ghost" size="sm" style={styles.alignStart} onPress={() => setPicker(null)}>
                {t('common:actions.done')}
              </MGButton>
            ) : null}
          </View>
        ) : null}
        <Text variant="titleSmall" style={[styles.durationLabel, { color: theme.colors.onSurfaceVariant }]}>
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
          <MGButton variant="ghost" onPress={onDismiss} disabled={saving} style={styles.footerButton} testID="occurrence-edit-cancel">
            {t('common:actions.cancel')}
          </MGButton>
          <MGButton
            onPress={() => {
              void save();
            }}
            loading={saving}
            disabled={saving}
            style={styles.footerButton}
            testID="occurrence-edit-save"
          >
            {t('meetings:form.saveChanges')}
          </MGButton>
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
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    paddingTop: spacing.xs,
    paddingHorizontal: spacing.lg,
  },
  heading: {
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },
  subheading: {
    marginBottom: spacing.md,
  },
  inputOutline: {
    borderRadius: radii.md,
  },
  zoneNote: {
    marginTop: spacing.sm,
  },
  pickerGroup: {
    marginTop: spacing.md,
  },
  alignStart: {
    alignSelf: 'flex-start',
  },
  durationLabel: {
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  chip: {
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: spacing.md,
    gap: spacing.md,
  },
  footerButton: {
    minWidth: 120,
  },
});
