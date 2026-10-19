/**
 * Card for one action the assistant proposed, under the reply that proposed it.
 * - list: the matching meetings (tap to open);
 * - every other type: type, status, summary, the first warning, progress / result, and the
 *   Review / Dismiss / Try again / Open meeting buttons. Nothing runs from here: "Review" opens
 *   the confirmation sheet.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ReactElement } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { ProposedActionState } from '../../core/contracts';
import {
  actionIconName,
  describeResult,
  describeWarnings,
  feedbackColors,
  formatWhen, occurrenceForListRow,
  isDestructiveAction,
  type AssistantPalette,
} from '../../services/ai/presentation';
import type { AiActionPreview, AiActionResult, AssistantFormatter } from '../../services/ai/types';
import { componentMetrics, radii, spacing, typography } from '../../theme';
import { chatStyles, PILL_MAX_FONT_SCALE, SMALL_HIT_SLOP } from './ChatPieces';

export interface ActionCardProps {
  state: ProposedActionState;
  fmt: AssistantFormatter;
  palette: AssistantPalette;
  onReview: (actionId: string) => void;
  onReject: (actionId: string) => void;
  onOpenMeeting: (meetingId: string) => void;
}

/** The meeting a finished action can open (a single created / changed / shared meeting). */
export function openableMeetingId(state: ProposedActionState): string | null {
  const result = state.result;
  if (!result || result.status !== 'done' || state.action.type === 'delete_meeting') return null;
  return result.meetingIds.length === 1 ? (result.meetingIds[0] ?? null) : null;
}

/** 32dp tertiaryContainer circle around the action-type glyph (errorContainer when destructive). */
function ActionIcon({ state, palette }: { state: ProposedActionState; palette: AssistantPalette }): ReactElement {
  const destructive = isDestructiveAction(state.action);
  return (
    <View style={[styles.iconCircle, { backgroundColor: destructive ? palette.dangerSurface : palette.accentSurface }]}>
      <MaterialCommunityIcons
        name={actionIconName(state.action.type)}
        size={componentMetrics.iconInline}
        color={destructive ? palette.onDangerSurface : palette.onAccentSurface}
      />
    </View>
  );
}

function ListCard({ state, fmt, palette, onOpenMeeting }: Omit<ActionCardProps, 'onReview' | 'onReject'>): ReactElement {
  const { action } = state;
  const preview = state.preview as AiActionPreview | null;
  const meetings = preview?.meetings ?? [];
  return (
    <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]} testID={`action-${action.id}`}>
      <View style={styles.cardHeader}>
        <ActionIcon state={state} palette={palette} />
        <Text style={[styles.cardTitle, { color: palette.text }]} numberOfLines={2}>
          {action.summary}
        </Text>
      </View>
      {!preview ? <ActivityIndicator size="small" color={palette.primary} /> : null}
      {preview && meetings.length === 0 ? (
        <Text style={[styles.cardNote, { color: palette.textMuted }]}>{fmt.t('ai:actions.listEmpty')}</Text>
      ) : null}
      {meetings.map((meeting) => {
        // A repeating meeting stores its FIRST occurrence; show the one this answer is about.
        const when = formatWhen(fmt, occurrenceForListRow(meeting));
        return (
          <Pressable
            key={meeting.id}
            onPress={() => onOpenMeeting(meeting.id)}
            style={[styles.listItem, { borderColor: palette.border }]}
            accessibilityRole="button"
            accessibilityLabel={fmt.t('ai:actions.a11yMeeting', { title: meeting.title, when })}
            accessibilityHint={fmt.t('ai:actions.openMeeting')}
            testID={`action-meeting-${meeting.id}`}
          >
            <View style={styles.flex}>
              <Text style={[styles.listItemTitle, { color: palette.text }]} numberOfLines={1}>
                {meeting.title}
              </Text>
              <Text style={[styles.cardNote, { color: palette.textMuted }]} numberOfLines={1}>
                {when}
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={20} color={palette.textMuted} />
          </Pressable>
        );
      })}
      {preview && preview.missingMeetingIds.length > 0 ? (
        <Text style={[styles.cardNote, { color: palette.warning }]}>
          {fmt.t('ai:warnings.meeting_not_found', { count: preview.missingMeetingIds.length })}
        </Text>
      ) : null}
    </View>
  );
}

function taskDueLine(fmt: AssistantFormatter, task: { dueDate: string | null; dueTime: string | null; status: string }): string {
  if (task.status === 'done') return fmt.t('ai:actions.taskDone');
  if (task.dueDate === null) return '';
  const date = fmt.date(`${task.dueDate}T00:00:00`);
  return task.dueTime === null ? date : `${date} ${fmt.time(`${task.dueDate}T${task.dueTime}:00`)}`;
}

function TaskListCard({ state, fmt, palette }: Pick<ActionCardProps, 'state' | 'fmt' | 'palette'>): ReactElement {
  const { action } = state;
  const preview = state.preview as AiActionPreview | null;
  const tasks = preview?.tasks ?? [];
  return (
    <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]} testID={`action-${action.id}`}>
      <View style={styles.cardHeader}>
        <ActionIcon state={state} palette={palette} />
        <Text style={[styles.cardTitle, { color: palette.text }]} numberOfLines={2}>
          {action.summary}
        </Text>
      </View>
      {!preview ? <ActivityIndicator size="small" color={palette.primary} /> : null}
      {preview && tasks.length === 0 ? (
        <Text style={[styles.cardNote, { color: palette.textMuted }]}>{fmt.t('ai:actions.taskListEmpty')}</Text>
      ) : null}
      {tasks.map((task) => {
        const due = taskDueLine(fmt, task);
        return (
          <View key={task.id} style={[styles.listItem, { borderColor: palette.border }]} testID={`action-task-${task.id}`}>
            <MaterialCommunityIcons
              name={task.status === 'done' ? 'check-circle' : 'circle-outline'}
              size={20}
              color={task.status === 'done' ? palette.primary : palette.textMuted}
            />
            <View style={[styles.flex, styles.taskText]}>
              <Text style={[styles.listItemTitle, { color: palette.text }]} numberOfLines={1}>
                {task.title}
              </Text>
              {due ? (
                <Text style={[styles.cardNote, { color: palette.textMuted }]} numberOfLines={1}>
                  {due}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
      {preview && (preview.missingTaskIds?.length ?? 0) > 0 ? (
        <Text style={[styles.cardNote, { color: palette.warning }]}>
          {fmt.t('ai:warnings.task_not_found', { count: preview.missingTaskIds?.length ?? 1 })}
        </Text>
      ) : null}
    </View>
  );
}

export function ActionCard({ state, fmt, palette, onReview, onReject, onOpenMeeting }: ActionCardProps): ReactElement {
  if (state.action.type === 'list') {
    return <ListCard state={state} fmt={fmt} palette={palette} onOpenMeeting={onOpenMeeting} />;
  }
  if (state.action.type === 'list_tasks') {
    return <TaskListCard state={state} fmt={fmt} palette={palette} />;
  }

  const { action, status } = state;
  const preview = state.preview as AiActionPreview | null;
  const destructive = isDestructiveAction(action);
  const accent = destructive ? palette.danger : palette.primary;
  const warnings = preview && status === 'proposed' ? describeWarnings(fmt, preview) : [];
  const result = state.result as AiActionResult | null;
  const feedback = result && (status === 'done' || status === 'failed') ? describeResult(fmt, result) : null;
  const feedbackStyle = feedback ? feedbackColors(palette, feedback.tone) : null;
  const openableId = openableMeetingId(state);
  const typeLabel = fmt.t(`ai:actions.type.${action.type}`);
  const statusLabel = fmt.t(`ai:actions.status.${status}`);

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: palette.surface, borderColor: status === 'proposed' ? accent : palette.border },
        status === 'rejected' ? styles.cardMuted : null,
      ]}
      testID={`action-${action.id}`}
    >
      <View style={styles.cardHeader} accessible accessibilityLabel={`${typeLabel}, ${statusLabel}`}>
        <ActionIcon state={state} palette={palette} />
        <Text style={[styles.cardType, { color: accent }]}>{typeLabel}</Text>
        <View style={[styles.statusChip, { backgroundColor: palette.surfaceAlt }]}>
          <Text style={[styles.statusText, { color: palette.textMuted }]} maxFontSizeMultiplier={PILL_MAX_FONT_SCALE}>
            {statusLabel}
          </Text>
        </View>
      </View>
      <Text style={[styles.cardTitle, { color: palette.text }]}>{action.summary}</Text>
      {warnings.length > 0 ? (
        <View style={styles.warningLine}>
          <MaterialCommunityIcons name="alert-outline" size={componentMetrics.iconMeta} color={palette.warning} />
          <Text style={[styles.cardNote, styles.flex, { color: palette.warning }]} numberOfLines={2}>
            {warnings[0]}
            {warnings.length > 1 ? ` ${fmt.t('ai:actions.moreWarnings', { count: warnings.length - 1 })}` : ''}
          </Text>
        </View>
      ) : null}

      {status === 'executing' ? (
        <View style={styles.working} accessibilityLiveRegion="polite">
          <ActivityIndicator size="small" color={accent} />
          <Text style={[styles.cardNote, { color: palette.textMuted }]}>{statusLabel}</Text>
        </View>
      ) : null}

      {feedback && feedbackStyle ? (
        <View style={[styles.feedback, { backgroundColor: feedbackStyle.background }]} accessibilityLiveRegion="polite">
          <Text style={[styles.cardNote, { color: feedbackStyle.color }]}>{feedback.message}</Text>
        </View>
      ) : null}

      <View style={chatStyles.buttonRow}>
        {status === 'proposed' || status === 'failed' ? (
          <>
            <Pressable
              onPress={() => onReject(action.id)}
              hitSlop={SMALL_HIT_SLOP}
              style={[chatStyles.smallButton, chatStyles.secondaryButton, { borderColor: palette.outline }]}
              accessibilityRole="button"
              testID={`action-dismiss-${action.id}`}
            >
              <Text style={[chatStyles.smallButtonText, { color: palette.text }]}>{fmt.t('ai:actions.dismiss')}</Text>
            </Pressable>
            <Pressable
              onPress={() => onReview(action.id)}
              hitSlop={SMALL_HIT_SLOP}
              style={[chatStyles.smallButton, { backgroundColor: accent }]}
              accessibilityRole="button"
              testID={`action-review-${action.id}`}
            >
              <Text style={[chatStyles.smallButtonText, { color: destructive ? palette.onDanger : palette.onPrimary }]}>
                {status === 'failed' ? fmt.t('ai:actions.tryAgain') : fmt.t('ai:actions.review')}
              </Text>
            </Pressable>
          </>
        ) : null}
        {openableId ? (
          <Pressable
            onPress={() => onOpenMeeting(openableId)}
            hitSlop={SMALL_HIT_SLOP}
            style={[chatStyles.smallButton, chatStyles.secondaryButton, { borderColor: palette.outline }]}
            accessibilityRole="button"
            testID={`action-open-${action.id}`}
          >
            <Text style={[chatStyles.smallButtonText, { color: palette.text }]}>{fmt.t('ai:actions.openMeeting')}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  // Full width inside the chat gutter (the old 40dp left inset wasted a tenth of a 360dp screen).
  card: {
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardMuted: {
    opacity: 0.6,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardType: {
    flex: 1,
    ...typography.labelL,
  },
  cardTitle: {
    flex: 1,
    ...typography.bodyM,
  },
  cardNote: {
    ...typography.bodyS,
  },
  statusChip: {
    borderRadius: radii.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  statusText: {
    ...typography.labelM,
  },
  warningLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  working: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  feedback: {
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: componentMetrics.touchTargetMin,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.sm,
  },
  listItemTitle: {
    ...typography.titleS,
  },
  taskText: {
    marginLeft: spacing.sm,
  },
});
