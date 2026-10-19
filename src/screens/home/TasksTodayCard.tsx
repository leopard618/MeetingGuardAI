/**
 * Dashboard tasks card (client request): the day's tasks next to the day's meetings. Shows up to
 * MAX_ROWS open tasks that are due today or overdue (overdue in error color), a one-tap complete
 * toggle, the number of open tasks, and direct access to the Tasks screen. Hidden only while
 * nothing is known yet (the dashboard skeleton covers loading).
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { memo, type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { IconButton, Text, TouchableRipple } from 'react-native-paper';

import { Card, SectionHeader } from '../../components/ui';
import type { Task } from '../../core/types';
import { useT } from '../../i18n';
import { componentMetrics, spacing, useAppTheme } from '../../theme';
import { isDueToday, isOverdue } from '../tasks/tasksModel';
import type { Formatters } from '../shared/useFormatters';

const MAX_ROWS = 3;

export interface TasksTodayCardProps {
  tasks: readonly Task[];
  now: Date;
  deviceZone: string;
  fmt: Formatters;
  onToggle(task: Task): void;
  onOpenTasks(): void;
}

function TasksTodayCardView({ tasks, now, deviceZone, fmt, onToggle, onOpenTasks }: TasksTodayCardProps): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const openCount = tasks.reduce((count, task) => (task.status === 'open' ? count + 1 : count), 0);
  // Repository order is already open-by-due first, so the first matches are the most urgent.
  const dueNow = tasks.filter((task) => isDueToday(task, now, deviceZone)).slice(0, MAX_ROWS);

  return (
    <View testID="dashboard-tasks">
      <SectionHeader
        title={t('home:tasks.title')}
        trailing={
          <Text variant="labelMedium" style={{ color: colors.onSurfaceVariant }} testID="dashboard-tasks-count">
            {t('home:tasks.openCount', { count: openCount })}
          </Text>
        }
      />
      <Card style={styles.card} testID="dashboard-tasks-card">
        {dueNow.length === 0 ? (
          <Text variant="bodyMedium" style={[styles.emptyText, { color: colors.onSurfaceVariant }]} testID="dashboard-tasks-empty">
            {openCount > 0 ? t('home:tasks.nothingDueToday') : t('home:tasks.empty')}
          </Text>
        ) : (
          dueNow.map((task) => {
            const overdue = isOverdue(task, now, deviceZone);
            return (
              <View key={task.id} style={styles.row}>
                <IconButton
                  icon="circle-outline"
                  size={22}
                  iconColor={overdue ? colors.error : colors.onSurfaceVariant}
                  onPress={() => onToggle(task)}
                  accessibilityLabel={t('tasks:card.complete', { title: task.title })}
                  style={styles.toggle}
                  testID={`dashboard-task-toggle-${task.id}`}
                />
                <TouchableRipple
                  onPress={onOpenTasks}
                  style={styles.body}
                  accessibilityRole="button"
                  accessibilityLabel={t('tasks:card.open', { title: task.title })}
                  testID={`dashboard-task-${task.id}`}
                >
                  <View style={styles.textRow}>
                    <Text variant="bodyMedium" numberOfLines={1} style={styles.flex}>
                      {task.title}
                    </Text>
                    <Text variant="labelMedium" style={{ color: overdue ? colors.error : colors.onSurfaceVariant }}>
                      {overdue
                        ? t('home:tasks.overdue')
                        : task.dueTime
                          ? fmt.time(`${task.dueDate}T${task.dueTime}:00`)
                          : t('home:tasks.today')}
                    </Text>
                  </View>
                </TouchableRipple>
              </View>
            );
          })
        )}
        <TouchableRipple
          onPress={onOpenTasks}
          style={[styles.viewAll, { borderTopColor: colors.outlineVariant }]}
          accessibilityRole="button"
          testID="dashboard-tasks-all"
        >
          <View style={styles.viewAllRow}>
            <Text variant="labelLarge" style={{ color: colors.primary }}>
              {t('home:tasks.viewAll')}
            </Text>
            <MaterialCommunityIcons name="chevron-right" size={componentMetrics.iconMeta} color={colors.primary} />
          </View>
        </TouchableRipple>
      </Card>
    </View>
  );
}

export const TasksTodayCard = memo(TasksTodayCardView);

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  // The shared Card surface (same as the meetings and alerts cards); only local tweaks here.
  card: {
    paddingTop: spacing.xs,
    paddingBottom: 0,
    paddingHorizontal: 0,
    overflow: 'hidden',
  },
  emptyText: {
    paddingHorizontal: componentMetrics.cardPadding,
    paddingVertical: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  toggle: {
    margin: 0,
    marginLeft: spacing.xs,
  },
  body: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingRight: componentMetrics.cardPadding,
  },
  textRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  viewAll: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.xs,
  },
  viewAllRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: componentMetrics.touchTargetMin,
    gap: spacing.xs,
  },
});
