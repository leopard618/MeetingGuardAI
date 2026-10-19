/**
 * One task in the Tasks list. The round check toggle completes / reopens; the body (title,
 * description, due line, people) opens the editor; the linked meeting and delete are separate
 * controls, so screen readers can reach each of them.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { memo, type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { IconButton, Text, TouchableRipple, useTheme as usePaperTheme } from 'react-native-paper';

import type { Meeting, Task } from '../../core/types';
import { useT } from '../../i18n';
import { componentMetrics, radii, spacing } from '../../theme';

export interface TaskCardProps {
  task: Task;
  /** The linked meeting; undefined when the task has no link, null when the meeting is gone. */
  meeting: Meeting | null | undefined;
  meetingWhen: string;
  /** Rendered due line ("Due tomorrow at 4:00 PM"), '' without a due date. */
  dueText: string;
  overdue: boolean;
  onToggleStatus(task: Task): void;
  onOpen(task: Task): void;
  onDelete(task: Task): void;
  onOpenMeeting(meetingId: string): void;
}

function TaskCardView({ task, meeting, meetingWhen, dueText, overdue, onToggleStatus, onOpen, onDelete, onOpenMeeting }: TaskCardProps): ReactElement {
  const t = useT();
  const theme = usePaperTheme();
  const done = task.status === 'done';
  const accent = overdue ? theme.colors.error : done ? theme.colors.outlineVariant : theme.colors.primary;

  return (
    <View
      style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outlineVariant, borderLeftColor: accent }]}
      testID={`task-card-${task.id}`}
    >
      <View style={styles.row}>
        <IconButton
          icon={done ? 'check-circle' : 'circle-outline'}
          size={28}
          iconColor={done ? theme.colors.primary : theme.colors.onSurfaceVariant}
          onPress={() => onToggleStatus(task)}
          accessibilityLabel={t(done ? 'tasks:card.reopen' : 'tasks:card.complete', { title: task.title })}
          testID={`task-toggle-${task.id}`}
        />
        <TouchableRipple
          onPress={() => onOpen(task)}
          accessibilityRole="button"
          accessibilityLabel={t('tasks:card.open', { title: task.title })}
          style={styles.body}
          borderless={false}
          testID={`task-open-${task.id}`}
        >
          <View>
            <Text variant="titleMedium" numberOfLines={2} style={done ? [styles.doneTitle, { color: theme.colors.onSurfaceVariant }] : null}>
              {task.title}
            </Text>
            {task.description.trim().length > 0 ? (
              <Text variant="bodyMedium" numberOfLines={2} style={[styles.preview, { color: theme.colors.onSurfaceVariant }]}>
                {task.description}
              </Text>
            ) : null}
            {dueText ? (
              <View style={styles.metaRow}>
                <MaterialCommunityIcons
                  name={overdue ? 'alert-circle-outline' : 'clock-outline'}
                  size={componentMetrics.iconMeta}
                  color={overdue ? theme.colors.error : theme.colors.onSurfaceVariant}
                />
                <Text
                  variant="labelMedium"
                  numberOfLines={1}
                  style={[styles.metaText, { color: overdue ? theme.colors.error : theme.colors.onSurfaceVariant }]}
                >
                  {dueText}
                </Text>
                {task.reminderMinutesBefore !== null && !done ? (
                  <MaterialCommunityIcons name="bell-outline" size={componentMetrics.iconMeta} color={theme.colors.onSurfaceVariant} />
                ) : null}
              </View>
            ) : null}
            {task.people.length > 0 ? (
              <View style={styles.metaRow}>
                <MaterialCommunityIcons name="account-outline" size={componentMetrics.iconMeta} color={theme.colors.onSurfaceVariant} />
                <Text variant="labelMedium" numberOfLines={1} style={[styles.metaText, { color: theme.colors.onSurfaceVariant }]}>
                  {task.people.map((person) => person.name).join(', ')}
                </Text>
              </View>
            ) : null}
          </View>
        </TouchableRipple>
        <IconButton
          icon="delete-outline"
          size={20}
          iconColor={theme.colors.error}
          onPress={() => onDelete(task)}
          accessibilityLabel={t('tasks:card.delete', { title: task.title })}
          testID={`task-delete-${task.id}`}
        />
      </View>

      {meeting ? (
        <TouchableRipple
          onPress={() => onOpenMeeting(meeting.id)}
          accessibilityRole="link"
          accessibilityLabel={t('tasks:card.meeting', { title: meeting.title })}
          style={[styles.meetingLink, { backgroundColor: theme.colors.secondaryContainer }]}
          testID={`task-meeting-${task.id}`}
        >
          <View style={styles.meetingRow}>
            <MaterialCommunityIcons name="calendar-clock" size={componentMetrics.iconMeta} color={theme.colors.onSecondaryContainer} />
            <View style={styles.meetingText}>
              <Text variant="labelLarge" numberOfLines={1} style={{ color: theme.colors.onSecondaryContainer }}>
                {meeting.title}
              </Text>
              {meetingWhen ? (
                <Text variant="bodySmall" numberOfLines={1} style={{ color: theme.colors.onSecondaryContainer }}>
                  {meetingWhen}
                </Text>
              ) : null}
            </View>
          </View>
        </TouchableRipple>
      ) : meeting === null ? (
        <View style={[styles.meetingRow, styles.unavailable]}>
          <MaterialCommunityIcons name="calendar-remove-outline" size={componentMetrics.iconMeta} color={theme.colors.onSurfaceVariant} />
          <Text variant="bodySmall" style={[styles.meetingText, { color: theme.colors.onSurfaceVariant }]}>
            {t('tasks:card.meetingUnavailable')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export const TaskCard = memo(TaskCardView);

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderLeftWidth: componentMetrics.accentBarWidth,
    marginBottom: componentMetrics.cardGap,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  body: {
    flex: 1,
    paddingVertical: spacing.md,
    paddingRight: spacing.sm,
  },
  doneTitle: {
    textDecorationLine: 'line-through',
  },
  preview: {
    marginTop: spacing.xs,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  metaText: {
    marginLeft: spacing.xs,
    marginRight: spacing.md,
    flexShrink: 1,
  },
  meetingLink: {
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    minHeight: componentMetrics.touchTargetMin,
    justifyContent: 'center',
  },
  meetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  unavailable: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  meetingText: {
    flex: 1,
    marginLeft: spacing.sm,
  },
});
