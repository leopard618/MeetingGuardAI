/**
 * Dashboard tasks card (client request): the day's tasks next to the day's meetings. Shows up to
 * MAX_ROWS open tasks that are due today or overdue, a one-tap complete toggle (a rounded square
 * checkbox, red when overdue), a status pill ("Overdue" / the due time / "Today"), the number of
 * open tasks as a pill in the section header and "View all" as the header action. Hidden only
 * while nothing is known yet (the dashboard skeleton covers loading).
 */
import { memo, type ReactElement } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { Badge, Card, Icon, PressableScale } from '../../components/ui';
import type { Task } from '../../core/types';
import { useT } from '../../i18n';
import { componentMetrics, pressedDimOpacity, radii, spacing, typography, useAppTheme } from '../../theme';
import { isDueToday, isOverdue, taskDueInstant } from '../tasks/tasksModel';
import type { Formatters } from '../shared/useFormatters';

const MAX_ROWS = 3;
const CHECK = 24;

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
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: colors.onSurface }]} accessibilityRole="header">
          {t('home:tasks.title')}
        </Text>
        <Badge label={t('home:tasks.openCount', { count: openCount })} tone="neutral" style={styles.count} testID="dashboard-tasks-count" />
        <View style={styles.flex} />
        <Pressable
          onPress={onOpenTasks}
          hitSlop={12}
          style={({ pressed }) => [styles.viewAll, pressed && styles.pressed]}
          accessibilityRole="button"
          testID="dashboard-tasks-all"
        >
          <Text style={[styles.viewAllText, { color: colors.primary }]}>{t('home:tasks.viewAll')}</Text>
          <Icon name="chevronRight" size={componentMetrics.iconMeta} color={colors.primary} />
        </Pressable>
      </View>
      <Card style={styles.card} testID="dashboard-tasks-card">
        {dueNow.length === 0 ? (
          <Text variant="bodyMedium" style={[styles.emptyText, { color: colors.onSurfaceVariant }]} testID="dashboard-tasks-empty">
            {openCount > 0 ? t('home:tasks.nothingDueToday') : t('home:tasks.empty')}
          </Text>
        ) : (
          dueNow.map((task, index) => {
            const overdue = isOverdue(task, now, deviceZone);
            return (
              <View key={task.id} style={[styles.row, index > 0 && [styles.rowDivider, { borderTopColor: colors.outlineVariant }]]}>
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
                  style={styles.body}
                  accessibilityRole="button"
                  accessibilityLabel={t('tasks:card.open', { title: task.title })}
                  testID={`dashboard-task-${task.id}`}
                >
                  <Text variant="bodyLarge" numberOfLines={1} style={styles.flex}>
                    {task.title}
                  </Text>
                  <Badge
                    label={overdue ? t('home:tasks.overdue') : task.dueTime ? fmt.time(taskDueInstant(task)) : t('home:tasks.today')}
                    tone={overdue ? 'error' : 'neutral'}
                    maxFontSizeMultiplier={1.3}
                  />
                </PressableScale>
              </View>
            );
          })
        )}
      </Card>
    </View>
  );
}

export const TasksTodayCard = memo(TasksTodayCardView);

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xxl,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  headerTitle: {
    ...typography.titleM,
  },
  count: {
    borderRadius: radii.full,
  },
  viewAll: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: componentMetrics.touchTargetMin - 12,
  },
  viewAllText: {
    ...typography.labelL,
  },
  pressed: {
    opacity: pressedDimOpacity,
  },
  card: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  emptyText: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  toggle: {
    width: componentMetrics.touchTargetMin,
    height: componentMetrics.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  check: {
    width: CHECK,
    height: CHECK,
    borderRadius: radii.sm,
    borderWidth: 2,
  },
  body: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingRight: spacing.sm,
    minHeight: componentMetrics.listRowMinHeight - 8,
  },
});
