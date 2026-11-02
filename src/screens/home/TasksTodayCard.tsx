/**
 * Dashboard tasks card (client request): the day's tasks next to the day's meetings, in the LEFT
 * half of the row it shares with the quick actions. A compact surface card: "Tasks" with the open
 * count, up to MAX_ROWS open tasks due today or overdue (rounded-square checkbox that completes
 * the task on tap, one-line title, "Overdue" / due time / "Today" under it, overdue in the error
 * color), and "View all" at the bottom. Hidden only while nothing is known yet (the dashboard
 * skeleton covers loading).
 */
import { memo, type ReactElement } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { Card, Icon, PressableScale } from '../../components/ui';
import type { Task } from '../../core/types';
import { useT } from '../../i18n';
import { componentMetrics, pressedDimOpacity, radii, spacing, typography, useAppTheme } from '../../theme';
import { isDueToday, isOverdue, taskDueInstant } from '../tasks/tasksModel';
import type { Formatters } from '../shared/useFormatters';

const MAX_ROWS = 3;
const CHECK = 20;

export interface TasksTodayCardProps {
  tasks: readonly Task[];
  now: Date;
  deviceZone: string;
  fmt: Formatters;
  onToggle(task: Task): void;
  onOpenTasks(): void;
  style?: object;
}

function TasksTodayCardView({ tasks, now, deviceZone, fmt, onToggle, onOpenTasks, style }: TasksTodayCardProps): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const openCount = tasks.reduce((count, task) => (task.status === 'open' ? count + 1 : count), 0);
  // Repository order is already open-by-due first, so the first matches are the most urgent.
  const dueNow = tasks.filter((task) => isDueToday(task, now, deviceZone)).slice(0, MAX_ROWS);

  return (
    <Card style={[styles.card, style]} testID="dashboard-tasks">
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: colors.onSurface }]} accessibilityRole="header">
          {t('home:tasks.title')}
        </Text>
        <Text style={[styles.count, { color: colors.onSurfaceVariant }]} testID="dashboard-tasks-count">
          {t('home:tasks.openCount', { count: openCount })}
        </Text>
      </View>
      <View style={styles.body} testID="dashboard-tasks-card">
        {dueNow.length === 0 ? (
          <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }} testID="dashboard-tasks-empty">
            {openCount > 0 ? t('home:tasks.nothingDueToday') : t('home:tasks.empty')}
          </Text>
        ) : (
          dueNow.map((task) => {
            const overdue = isOverdue(task, now, deviceZone);
            return (
              <View key={task.id} style={styles.row}>
                <Pressable
                  onPress={() => onToggle(task)}
                  hitSlop={10}
                  style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={t('tasks:card.complete', { title: task.title })}
                  testID={`dashboard-task-toggle-${task.id}`}
                >
                  <View style={[styles.check, { borderColor: overdue ? colors.error : colors.outline }]} />
                </Pressable>
                <PressableScale
                  onPress={onOpenTasks}
                  style={styles.texts}
                  accessibilityRole="button"
                  accessibilityLabel={t('tasks:card.open', { title: task.title })}
                  testID={`dashboard-task-${task.id}`}
                >
                  <Text variant="bodyMedium" numberOfLines={1}>
                    {task.title}
                  </Text>
                  <Text variant="labelSmall" style={{ color: overdue ? colors.error : colors.onSurfaceVariant }}>
                    {overdue ? t('home:tasks.overdue') : task.dueTime ? fmt.time(taskDueInstant(task)) : t('home:tasks.today')}
                  </Text>
                </PressableScale>
              </View>
            );
          })
        )}
      </View>
      <Pressable
        onPress={onOpenTasks}
        hitSlop={8}
        style={({ pressed }) => [styles.viewAll, pressed && styles.pressed]}
        accessibilityRole="button"
        testID="dashboard-tasks-all"
      >
        <Text style={[styles.viewAllText, { color: colors.primary }]}>{t('home:tasks.viewAll')}</Text>
        <Icon name="chevronRight" size={componentMetrics.iconMeta} color={colors.primary} />
      </Pressable>
    </Card>
  );
}

export const TasksTodayCard = memo(TasksTodayCardView);

const styles = StyleSheet.create({
  card: {
    padding: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  headerTitle: {
    ...typography.titleS,
  },
  count: {
    ...typography.labelS,
  },
  body: {
    flex: 1,
    marginTop: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 40,
  },
  toggle: {
    width: 32,
    height: 40,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  check: {
    width: CHECK,
    height: CHECK,
    borderRadius: radii.xs,
    borderWidth: 2,
  },
  texts: {
    flex: 1,
    paddingVertical: spacing.xs,
  },
  pressed: {
    opacity: pressedDimOpacity,
  },
  viewAll: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    minHeight: 28,
  },
  viewAllText: {
    ...typography.labelM,
  },
});
