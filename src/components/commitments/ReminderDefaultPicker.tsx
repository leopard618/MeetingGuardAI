/**
 * "Reminder for items without a date" (owner: summaries-app; M11, docs/v2/M11-DESIGN.md section
 * 3.2 point 3, decision 11; Francisco, Nov 12 2026): Tomorrow 9:00 (the default) | The day after
 * tomorrow 9:00 | Next Monday 9:00 | Pick a date and time | No reminder, labelled "Your choice. The
 * summary gives no date.", and the notice when several suggestions share it ("8 reminders tomorrow
 * at 9:00").
 *
 * The caller computes the labels (12 or 24 h) and what each relative choice means in the task zone
 * when Accept is tapped; this component only reports the choice. "Pick a date and time" opens the
 * app's themed native picker (src/screens/shared/ThemedDateTimePicker.tsx): a date, then a time
 * (Android dialogs one after the other; iOS inline spinners with Done). The picked value is the
 * device's wall clock. Generic, so Sven's A2 reuses it.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useState, type ReactElement } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Chip, HelperText, Text } from 'react-native-paper';

import { Card, MGButton } from '../ui';
import { ThemedDateTimePicker, type DateTimePickerEvent } from '../../screens/shared/ThemedDateTimePicker';
import { componentMetrics, spacing, useAppTheme } from '../../theme';
import { pickedDate, pickedTime, type ReminderDefault, type ReminderDefaultKind } from './commitmentEditModel';

export interface ReminderDefaultOption {
  kind: Exclude<ReminderDefaultKind, 'picked'>;
  label: string;
}

export interface ReminderDefaultPickerProps {
  /** "Reminder for items without a date". */
  title: string;
  /** "Your choice. The summary gives no date." */
  hint: string;
  /** Tomorrow, the day after tomorrow, next Monday and No reminder, in the order shown ("Pick" goes before "No reminder"). */
  options: readonly ReminderDefaultOption[];
  /** "Pick a date and time", or the picked date and time once chosen. */
  pickLabel: string;
  value: ReminderDefault;
  onChange(value: ReminderDefault): void;
  /** "8 reminders tomorrow at 9:00" (several suggestions share the choice). */
  notice?: string | null;
  /** "Reminders set for the same time arrive together." */
  noticeHint?: string | null;
  /** "That time has already passed. Pick a later one." */
  error?: string | null;
  /** The iOS spinner's confirm button ("Done"). */
  doneLabel: string;
  /** The iOS spinner's cancel button. */
  cancelLabel: string;
  disabled?: boolean;
  /** The earliest pickable date (today). */
  now?: Date;
  testID?: string;
}

interface Picking {
  step: 'date' | 'time';
  value: Date;
}

/** The picker's start value: the picked date and time, else 9:00 tomorrow (device wall clock). */
function startValue(value: ReminderDefault, now: Date): Date {
  if (value.kind === 'picked') {
    const [year = 2000, month = 1, day = 1] = value.date.split('-').map(Number);
    const [hour = 9, minute = 0] = value.time.split(':').map(Number);
    return new Date(year, month - 1, day, hour, minute, 0, 0);
  }
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0, 0);
}

export function ReminderDefaultPicker({
  title,
  hint,
  options,
  pickLabel,
  value,
  onChange,
  notice = null,
  noticeHint = null,
  error = null,
  doneLabel,
  cancelLabel,
  disabled = false,
  now,
  testID = 'reminder-default',
}: ReminderDefaultPickerProps): ReactElement {
  const { colors } = useAppTheme();
  const [picking, setPicking] = useState<Picking | null>(null);
  const ios = Platform.OS === 'ios';
  const optionsBeforePick = options.filter((option) => option.kind !== 'none');
  const noneOption = options.find((option) => option.kind === 'none') ?? null;

  const commit = (picked: Date): void => {
    setPicking(null);
    onChange({ kind: 'picked', date: pickedDate(picked), time: pickedTime(picked) });
  };

  const onPicked = (event: DateTimePickerEvent, picked?: Date): void => {
    if (picking === null) return;
    if (ios) {
      if (picked) setPicking({ step: picking.step, value: picked });
      return;
    }
    // Android: one dialog per step; a dismissed dialog cancels the whole pick.
    if (event.type !== 'set' || !picked) {
      setPicking(null);
      return;
    }
    if (picking.step === 'date') {
      const next = new Date(picking.value.getTime());
      next.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
      setPicking({ step: 'time', value: next });
    } else {
      commit(picked);
    }
  };

  const iosDone = (): void => {
    if (picking === null) return;
    if (picking.step === 'date') setPicking({ step: 'time', value: picking.value });
    else commit(picking.value);
  };

  const chip = (kind: ReminderDefaultKind, label: string, onPress: () => void): ReactElement => (
    <Chip
      key={kind}
      selected={value.kind === kind}
      showSelectedOverlay
      onPress={onPress}
      disabled={disabled}
      style={styles.chip}
      accessibilityRole="radio"
      accessibilityState={{ checked: value.kind === kind, disabled }}
      testID={`${testID}-${kind}`}
    >
      {label}
    </Chip>
  );

  return (
    <Card style={styles.card} testID={testID}>
      <Text variant="titleSmall" accessibilityRole="header">
        {title}
      </Text>
      <Text variant="bodySmall" style={[styles.line, { color: colors.onSurfaceVariant }]}>
        {hint}
      </Text>
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={title}>
        {optionsBeforePick.map((option) => chip(option.kind, option.label, () => onChange({ kind: option.kind } as ReminderDefault)))}
        {chip('picked', pickLabel, () => setPicking({ step: 'date', value: startValue(value, now ?? new Date()) }))}
        {noneOption !== null ? chip('none', noneOption.label, () => onChange({ kind: 'none' })) : null}
      </View>

      {picking !== null ? (
        <View testID={`${testID}-picker`}>
          <ThemedDateTimePicker
            key={picking.step}
            value={picking.value}
            mode={picking.step}
            minimumDate={picking.step === 'date' ? (now ?? new Date()) : undefined}
            onChange={onPicked}
            {...(ios ? { display: 'spinner' as const } : {})}
            testID={`${testID}-picker-${picking.step}`}
          />
          {ios ? (
            <View style={styles.pickerActions}>
              <MGButton variant="ghost" size="sm" onPress={() => setPicking(null)} testID={`${testID}-picker-cancel`}>
                {cancelLabel}
              </MGButton>
              <MGButton variant="tonal" size="sm" onPress={iosDone} testID={`${testID}-picker-done`}>
                {doneLabel}
              </MGButton>
            </View>
          ) : null}
        </View>
      ) : null}

      {error !== null ? (
        <HelperText type="error" visible accessibilityLiveRegion="polite" style={styles.error} testID={`${testID}-error`}>
          {error}
        </HelperText>
      ) : null}

      {notice !== null ? (
        <View style={styles.notice} testID={`${testID}-notice`}>
          <MaterialCommunityIcons
            name="bell-ring-outline"
            size={componentMetrics.iconMeta}
            color={colors.primary}
            style={styles.noticeIcon}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
          <View style={styles.flex}>
            <Text variant="bodyMedium">{notice}</Text>
            {noticeHint !== null ? (
              <Text variant="bodySmall" style={[styles.line, { color: colors.onSurfaceVariant }]}>
                {noticeHint}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.md,
  },
  flex: {
    flex: 1,
  },
  line: {
    marginTop: spacing.xs,
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
  pickerActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  error: {
    paddingHorizontal: 0,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  noticeIcon: {
    marginTop: 2,
  },
});
