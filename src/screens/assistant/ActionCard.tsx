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
  formatWhen,
  isDestructiveAction,
  type AssistantPalette,
} from '../../services/ai/presentation';
import type { AiActionPreview, AiActionResult, AssistantFormatter } from '../../services/ai/types';
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

function ListCard({ state, fmt, palette, onOpenMeeting }: Omit<ActionCardProps, 'onReview' | 'onReject'>): ReactElement {
  const { action } = state;
  const preview = state.preview as AiActionPreview | null;
  const meetings = preview?.meetings ?? [];
  return (
    <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]} testID={`action-${action.id}`}>
      <View style={styles.cardHeader}>
        <MaterialCommunityIcons name={actionIconName(action.type)} size={18} color={palette.primary} />
        <Text style={[styles.cardTitle, { color: palette.text }]} numberOfLines={2}>
          {action.summary}
        </Text>
      </View>
      {!preview ? <ActivityIndicator size="small" color={palette.primary} /> : null}
      {preview && meetings.length === 0 ? (
        <Text style={[styles.cardNote, { color: palette.textMuted }]}>{fmt.t('ai:actions.listEmpty')}</Text>
      ) : null}
      {meetings.map((meeting) => {
        const when = formatWhen(fmt, meeting);
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

export function ActionCard({ state, fmt, palette, onReview, onReject, onOpenMeeting }: ActionCardProps): ReactElement {
  if (state.action.type === 'list') {
    return <ListCard state={state} fmt={fmt} palette={palette} onOpenMeeting={onOpenMeeting} />;
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
        <MaterialCommunityIcons name={actionIconName(action.type)} size={18} color={accent} />
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
          <MaterialCommunityIcons name="alert-outline" size={14} color={palette.warning} />
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
              style={[chatStyles.smallButton, chatStyles.secondaryButton, { borderColor: palette.border }]}
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
            style={[chatStyles.smallButton, chatStyles.secondaryButton, { borderColor: palette.border }]}
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
  card: {
    marginLeft: 40,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 8,
  },
  cardMuted: {
    opacity: 0.6,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cardType: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
  },
  cardTitle: {
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
  },
  cardNote: {
    fontSize: 13,
    lineHeight: 18,
  },
  statusChip: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  warningLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  working: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  feedback: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
  },
  listItemTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
});
