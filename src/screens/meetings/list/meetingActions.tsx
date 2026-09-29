/**
 * Row actions shared by the meetings list and the calendar agenda: open, edit, delete (with a
 * confirmation that says what happens in Google Calendar / the device calendar), and the action
 * sheet that long-press and the "more" button open.
 *
 * Deletes go through meetingRepository.remove with origin 'user' (soft delete; the calendar engine
 * removes a synced event from Google Calendar; a device-calendar import stays in the device
 * calendar and the user is told so). Success is only reported after the repository resolved.
 */
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { List, Modal, Portal, Text, useTheme as usePaperTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

import type { RootStackParamList } from '../../../core/contracts';
import { errorMessageKey, toAppError } from '../../../core/errors';
import { createLogger } from '../../../core/logger';
import type { Meeting } from '../../../core/types';
import { useT } from '../../../i18n';
import { meetingRepository } from '../../../services/data';

const log = createLogger('meetings');

export interface MeetingActions {
  open(meeting: Meeting): void;
  edit(meeting: Meeting): void;
  /** Asks for confirmation, then deletes. */
  confirmDelete(meeting: Meeting): void;
  /** Id of the meeting being deleted, or null. */
  deletingId: string | null;
}

/** The confirmation text for a delete (what happens in the connected calendars). */
export function deleteMessageKey(meeting: Pick<Meeting, 'source' | 'external'>): string {
  if (meeting.source === 'device') return 'meetings:details.deleteMessageDevice';
  if (meeting.source === 'google' || meeting.external.googleEventId !== null) return 'meetings:details.deleteMessageGoogle';
  return 'meetings:details.deleteMessage';
}

export function useMeetingActions(): MeetingActions {
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const t = useT();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const open = useCallback((meeting: Meeting) => navigation.navigate('MeetingDetails', { meetingId: meeting.id }), [navigation]);
  const edit = useCallback((meeting: Meeting) => navigation.navigate('EditMeeting', { meetingId: meeting.id }), [navigation]);

  const remove = useCallback(
    async (meeting: Meeting): Promise<void> => {
      setDeletingId(meeting.id);
      try {
        await meetingRepository.remove(meeting.id, { origin: 'user' });
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

  const confirmDelete = useCallback(
    (meeting: Meeting) => {
      Alert.alert(t('meetings:details.deleteTitle', { title: meeting.title }), t(deleteMessageKey(meeting)), [
        { text: t('common:actions.cancel'), style: 'cancel' },
        { text: t('meetings:details.delete'), style: 'destructive', onPress: () => void remove(meeting) },
      ]);
    },
    [t, remove],
  );

  return useMemo(() => ({ open, edit, confirmDelete, deletingId }), [open, edit, confirmDelete, deletingId]);
}

/** Bottom action sheet for one meeting (long-press or the row's "more" button). */
export function MeetingActionsSheet({
  meeting,
  actions,
  onDismiss,
}: {
  meeting: Meeting | null;
  actions: MeetingActions;
  onDismiss(): void;
}): ReactElement {
  const t = useT();
  const theme = usePaperTheme();
  const insets = useSafeAreaInsets();

  const run = (action: (meeting: Meeting) => void) => () => {
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
          { backgroundColor: theme.colors.elevation.level3, marginBottom: insets.bottom + 12 },
        ]}
      >
        {meeting ? (
          <View testID="meeting-actions-sheet">
            <Text variant="titleMedium" numberOfLines={2} accessibilityRole="header" style={styles.title}>
              {meeting.title}
            </Text>
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
    marginHorizontal: 12,
    borderRadius: 20,
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  title: {
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
});
