/**
 * Row actions shared by the meetings list, the calendar agenda and the dashboard timeline: open,
 * edit, delete (with a confirmation that says what happens in Google Calendar / the device
 * calendar), and the action sheet that long-press and the "more" button open.
 *
 * Recurring meetings (§16): a row is one OCCURRENCE, so edit and delete first ask the scope -
 * "This meeting only" writes an override on the master (cancelOccurrence / the occurrence edit
 * sheet), "This and following" splits the series at that occurrence (deleteFollowing / the
 * occurrence edit sheet with scope 'following' -> editFollowing), "The whole series" edits or
 * soft-deletes the master. One-off meetings keep the old single-step flow. Deletes go through
 * meetingRepository with origin 'user'; success is only reported after the repository resolved.
 */
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Alert, Platform, StyleSheet, View, type AlertButton } from 'react-native';
import { List, Modal, Portal, Text, useTheme as usePaperTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

import { SheetHandle } from '../../../components/ui';
import { radii, spacing } from '../../../theme';

import type { MeetingRecurrenceOps, MeetingRepository, RootStackParamList } from '../../../core/contracts';
import { AppError, errorMessageKey, toAppError } from '../../../core/errors';
import { createLogger } from '../../../core/logger';
import type { Meeting } from '../../../core/types';
import { useT } from '../../../i18n';
import { meetingRepository } from '../../../services/data';
import { zoomService } from '../../../services/zoom';
import { useFormatters } from '../../shared/useFormatters';
import type { DisplayMeeting } from '../occurrences';

const log = createLogger('meetings');

/**
 * An occurrence row whose scoped edit is open in the occurrence sheet: "This meeting only"
 * (scope 'occurrence' -> updateOccurrence) or "This and following" (scope 'following' ->
 * editFollowing; the sheet's changes land on the new tail series, §16).
 */
export interface OccurrenceEditTarget {
  entry: DisplayMeeting;
  localDateKey: string;
  scope: 'occurrence' | 'following';
}

export interface MeetingActions {
  open(meeting: DisplayMeeting): void;
  /** Recurring occurrence rows ask for the scope first. */
  edit(meeting: DisplayMeeting): void;
  /** Asks for confirmation (and, for recurring occurrence rows, the scope), then deletes. */
  confirmDelete(meeting: DisplayMeeting): void;
  /** Id of the meeting being deleted, or null. */
  deletingId: string | null;
  /** Occurrence the user chose to edit "this meeting only", rendered by OccurrenceEditSheet. */
  occurrenceEdit: OccurrenceEditTarget | null;
  dismissOccurrenceEdit(): void;
}

/**
 * The recurrence ops land on meetingRepository together with this UI (rec-core); until both are
 * wired, occurrence-scoped actions fail with 'not_implemented' instead of pretending success.
 */
function recurrenceOps(): MeetingRecurrenceOps {
  const repository = meetingRepository as MeetingRepository & Partial<MeetingRecurrenceOps>;
  if (
    !repository.cancelOccurrence ||
    !repository.updateOccurrence ||
    !repository.restoreOccurrence ||
    !repository.editFollowing ||
    !repository.deleteFollowing
  ) {
    throw new AppError('not_implemented', 'Recurring-meeting operations are not available');
  }
  return repository as MeetingRepository & MeetingRecurrenceOps;
}

/**
 * Buttons of the occurrence/series scope dialogs. Android shows AT MOST three alert buttons, so
 * the three scope choices leave no room for an explicit Cancel there: the dialog is dismissed by
 * tapping outside or the back button (`cancelable: true`). iOS alerts cannot be dismissed that
 * way and stack any number of buttons, so iOS keeps the Cancel button.
 */
export function scopeDialogButtons(cancelText: string, scopeButtons: AlertButton[]): AlertButton[] {
  return Platform.OS === 'ios' ? [{ text: cancelText, style: 'cancel' }, ...scopeButtons] : scopeButtons;
}

/** The confirmation text for a delete (what happens in the connected calendars / the series). */
export function deleteMessageKey(meeting: Pick<Meeting, 'source' | 'external' | 'recurrence'>): string {
  if (meeting.source === 'device') return 'meetings:details.deleteMessageDevice';
  const google = meeting.source === 'google' || meeting.external.googleEventId !== null;
  if (meeting.recurrence !== null) {
    return google ? 'meetings:details.deleteMessageSeriesGoogle' : 'meetings:details.deleteMessageSeries';
  }
  return google ? 'meetings:details.deleteMessageGoogle' : 'meetings:details.deleteMessage';
}

/** Whether a row needs the occurrence/series question (a real occurrence of a recurring meeting). */
export function needsScopeChoice(meeting: DisplayMeeting): boolean {
  return meeting.occurrence !== undefined && meeting.recurrence !== null;
}

export function useMeetingActions(): MeetingActions {
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const t = useT();
  const fmt = useFormatters();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [occurrenceEdit, setOccurrenceEdit] = useState<OccurrenceEditTarget | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const open = useCallback((meeting: DisplayMeeting) => navigation.navigate('MeetingDetails', { meetingId: meeting.id }), [navigation]);
  const editSeries = useCallback((meeting: DisplayMeeting) => navigation.navigate('EditMeeting', { meetingId: meeting.id }), [navigation]);

  const edit = useCallback(
    (meeting: DisplayMeeting) => {
      const occurrence = meeting.occurrence;
      if (!occurrence || !needsScopeChoice(meeting)) {
        editSeries(meeting);
        return;
      }
      Alert.alert(
        t('meetings:actions.scopeEditTitle'),
        t('meetings:actions.scopeEditMessage', { title: meeting.title, date: fmt.date(occurrence.localDateKey, 'long') }),
        scopeDialogButtons(t('common:actions.cancel'), [
          {
            text: t('meetings:actions.scopeThisOnly'),
            onPress: () => setOccurrenceEdit({ entry: meeting, localDateKey: occurrence.localDateKey, scope: 'occurrence' }),
          },
          {
            text: t('meetings:actions.scopeFollowing'),
            onPress: () => setOccurrenceEdit({ entry: meeting, localDateKey: occurrence.localDateKey, scope: 'following' }),
          },
          { text: t('meetings:actions.scopeWholeSeries'), onPress: () => editSeries(meeting) },
        ]),
        { cancelable: true },
      );
    },
    [t, fmt, editSeries],
  );

  const removeSeries = useCallback(
    async (meeting: DisplayMeeting): Promise<void> => {
      setDeletingId(meeting.id);
      try {
        await meetingRepository.remove(meeting.id, { origin: 'user' });
        // §24: deleting the whole series also deletes the server-created Zoom meeting (best
        // effort; no-op without an external.zoomMeetingId, and the service never throws).
        // Occurrence-scoped deletes keep the series - and its reusable Zoom link - alive.
        void zoomService.onMeetingDeleted(meeting);
        Toast.show({
          type: 'success',
          text1: t('meetings:details.deleted'),
          text2: meeting.source === 'device' ? t('meetings:details.deletedDeviceNote') : undefined,
        });
      } catch (caught) {
        const error = toAppError(caught);
        log.warn('could not delete a meeting', error.code);
        Toast.show({ type: 'error', text1: t(errorMessageKey(error.code)) });
      } finally {
        if (mounted.current) setDeletingId(null);
      }
    },
    [t],
  );

  const removeOccurrence = useCallback(
    async (meeting: DisplayMeeting, localDateKey: string): Promise<void> => {
      setDeletingId(meeting.id);
      try {
        await recurrenceOps().cancelOccurrence(meeting.id, localDateKey, { origin: 'user' });
        Toast.show({ type: 'success', text1: t('meetings:actions.occurrenceDeleted') });
      } catch (caught) {
        const error = toAppError(caught);
        log.warn('could not cancel an occurrence', error.code);
        Toast.show({ type: 'error', text1: t(errorMessageKey(error.code)) });
      } finally {
        if (mounted.current) setDeletingId(null);
      }
    },
    [t],
  );

  const removeFollowing = useCallback(
    async (meeting: DisplayMeeting, localDateKey: string): Promise<void> => {
      setDeletingId(meeting.id);
      try {
        // Truncates the series before this occurrence (§16); from the FIRST occurrence it
        // removes the whole series (deleteFollowing resolves null) - the toast fits both.
        await recurrenceOps().deleteFollowing(meeting.id, localDateKey, { origin: 'user' });
        Toast.show({ type: 'success', text1: t('meetings:actions.followingDeleted') });
      } catch (caught) {
        const error = toAppError(caught);
        log.warn('could not delete this-and-following occurrences', error.code);
        Toast.show({ type: 'error', text1: t(errorMessageKey(error.code)) });
      } finally {
        if (mounted.current) setDeletingId(null);
      }
    },
    [t],
  );

  const confirmDelete = useCallback(
    (meeting: DisplayMeeting) => {
      const occurrence = meeting.occurrence;
      if (occurrence && needsScopeChoice(meeting)) {
        Alert.alert(
          t('meetings:actions.scopeDeleteTitle'),
          t('meetings:actions.scopeDeleteMessage', { title: meeting.title, date: fmt.date(occurrence.localDateKey, 'long') }),
          scopeDialogButtons(t('common:actions.cancel'), [
            {
              text: t('meetings:actions.scopeThisOnly'),
              style: 'destructive',
              onPress: () => void removeOccurrence(meeting, occurrence.localDateKey),
            },
            {
              text: t('meetings:actions.scopeFollowing'),
              style: 'destructive',
              onPress: () => void removeFollowing(meeting, occurrence.localDateKey),
            },
            {
              text: t('meetings:actions.scopeWholeSeries'),
              style: 'destructive',
              onPress: () => void removeSeries(meeting),
            },
          ]),
          { cancelable: true },
        );
        return;
      }
      Alert.alert(t('meetings:details.deleteTitle', { title: meeting.title }), t(deleteMessageKey(meeting)), [
        { text: t('common:actions.cancel'), style: 'cancel' },
        { text: t('meetings:details.delete'), style: 'destructive', onPress: () => void removeSeries(meeting) },
      ]);
    },
    [t, fmt, removeSeries, removeOccurrence, removeFollowing],
  );

  const dismissOccurrenceEdit = useCallback(() => setOccurrenceEdit(null), []);

  return useMemo(
    () => ({ open, edit, confirmDelete, deletingId, occurrenceEdit, dismissOccurrenceEdit }),
    [open, edit, confirmDelete, deletingId, occurrenceEdit, dismissOccurrenceEdit],
  );
}

/** Bottom action sheet for one meeting (long-press or the row's "more" button). */
export function MeetingActionsSheet({
  meeting,
  actions,
  onDismiss,
}: {
  meeting: DisplayMeeting | null;
  actions: MeetingActions;
  onDismiss(): void;
}): ReactElement {
  const t = useT();
  const theme = usePaperTheme();
  const insets = useSafeAreaInsets();

  const run = (action: (meeting: DisplayMeeting) => void) => () => {
    onDismiss();
    if (meeting) action(meeting);
  };

  return (
    <Portal>
      <Modal
        visible={meeting !== null}
        onDismiss={onDismiss}
        style={styles.modal}
        contentContainerStyle={[
          styles.sheet,
          { backgroundColor: theme.colors.elevation.level3, paddingBottom: insets.bottom + spacing.sm },
        ]}
      >
        {meeting ? (
          <View testID="meeting-actions-sheet">
            <SheetHandle />
            <Text variant="titleMedium" numberOfLines={2} accessibilityRole="header" style={styles.title}>
              {meeting.title}
            </Text>
            {needsScopeChoice(meeting) ? (
              <Text variant="bodySmall" style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]} testID="meeting-actions-repeats">
                {t('meetings:list.repeats')}
              </Text>
            ) : null}
            <List.Item
              title={t('meetings:actions.open')}
              left={(props) => <List.Icon {...props} icon="eye-outline" />}
              onPress={run(actions.open)}
              accessibilityRole="button"
              testID="meeting-action-open"
            />
            <List.Item
              title={t('meetings:actions.edit')}
              left={(props) => <List.Icon {...props} icon="pencil-outline" />}
              onPress={run(actions.edit)}
              accessibilityRole="button"
              testID="meeting-action-edit"
            />
            <List.Item
              title={t('meetings:actions.delete')}
              titleStyle={{ color: theme.colors.error }}
              left={(props) => <List.Icon {...props} icon="delete-outline" color={theme.colors.error} />}
              onPress={run(actions.confirmDelete)}
              disabled={actions.deletingId === meeting.id}
              accessibilityRole="button"
              testID="meeting-action-delete"
            />
            <List.Item
              title={t('common:actions.cancel')}
              left={(props) => <List.Icon {...props} icon="close" />}
              onPress={onDismiss}
              accessibilityRole="button"
              testID="meeting-action-cancel"
            />
          </View>
        ) : null}
      </Modal>
    </Portal>
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
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  title: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
  },
  subtitle: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xs,
  },
});
