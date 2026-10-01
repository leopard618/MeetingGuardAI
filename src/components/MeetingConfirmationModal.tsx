/**
 * Confirmation sheet for assistant actions. Nothing the assistant proposes runs before the user
 * confirms here. It shows exactly what will happen:
 * - create: every field of the new meeting;
 * - update: a before -> after diff of the fields that change;
 * - delete: the meeting, in destructive styling;
 * - share: the meeting, the channel and every recipient;
 * - bulk_update: the change and the list of affected meetings (before -> after times);
 * plus the warnings from actionExecutor.preview (missing meeting, past time, overlap, Meet link,
 * new people). Several actions ("confirm all") are listed one after the other with one button.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useMemo, type ReactElement } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SheetHandle } from './ui';
import type { AiAction } from '../core/aiContract';
import type { ProposedActionState } from '../core/contracts';
import { useLanguage, useT } from '../i18n';
import { createAssistantFormatter } from '../services/ai/formatter';
import {
  actionIconName,
  computeUpdateDiff,
  deleteWarningKey,
  describeBulk,
  describeChangeRows,
  describeDraft,
  describeMeeting,
  describeScopeRow,
  describeShare,
  describeWarnings,
  isDestructiveAction,
  type DetailRow,
  type DiffRow,
} from '../services/ai/presentation';
import type { AiActionPreview, AssistantFormatter } from '../services/ai/types';
import { componentMetrics, pressedDimOpacity, radii, spacing, typography, useAppTheme, type MGColors } from '../theme';
import { ConfidenceBadge } from './ConfidenceBadge';

function previewOf(state: ProposedActionState): AiActionPreview | null {
  return state.preview as AiActionPreview | null;
}

/** Label of the confirm button for the actions under review. */
export function confirmLabel(fmt: AssistantFormatter, actions: readonly ProposedActionState[]): string {
  if (actions.length > 1) return fmt.t('ai:confirm.confirmAll', { count: actions.length });
  const action = actions[0]?.action;
  if (!action) return fmt.t('ai:confirm.confirm');
  switch (action.type) {
    case 'create_meeting':
      return fmt.t('ai:confirm.button.create_meeting');
    case 'update_meeting':
      return fmt.t('ai:confirm.button.update_meeting');
    case 'delete_meeting':
      return fmt.t('ai:confirm.button.delete_meeting');
    case 'share_meeting':
      return action.channel === 'email' ? fmt.t('ai:confirm.button.share_email') : fmt.t('ai:confirm.button.share_meeting');
    case 'bulk_update':
      return fmt.t('ai:confirm.button.bulk_update', { count: action.meetingIds.length });
    default:
      return fmt.t('ai:confirm.confirm');
  }
}

/** Sheet title for the actions under review. */
export function confirmTitle(fmt: AssistantFormatter, actions: readonly ProposedActionState[]): string {
  if (actions.length > 1) return fmt.t('ai:confirm.titleMany', { count: actions.length });
  return fmt.t(`ai:confirm.title.${actions[0]?.action.type ?? 'create_meeting'}`);
}

function DetailRows({ rows, colors }: { rows: DetailRow[]; colors: MGColors }): ReactElement {
  return (
    <View style={styles.rows}>
      {rows.map((row, index) => (
        <View key={`${row.field}-${index}`} style={styles.row} accessible accessibilityLabel={`${row.label}: ${row.value}`}>
          <Text style={[styles.rowLabel, { color: colors.onSurfaceVariant }]}>{row.label}</Text>
          <Text style={[styles.rowValue, { color: colors.onSurface }]} selectable>
            {row.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

function DiffRows({ rows, colors, fmt }: { rows: DiffRow[]; colors: MGColors; fmt: AssistantFormatter }): ReactElement {
  if (rows.length === 0) {
    return <Text style={[styles.note, { color: colors.onSurfaceVariant }]}>{fmt.t('ai:confirm.noChanges')}</Text>;
  }
  return (
    <View style={styles.rows}>
      {rows.map((row, index) => (
        <View key={`${row.field}-${index}`} style={styles.row}>
          <Text style={[styles.rowLabel, { color: colors.onSurfaceVariant }]}>{row.label}</Text>
          <Text
            style={[styles.diffBefore, { color: colors.onSurfaceVariant }]}
            accessibilityLabel={fmt.t('ai:confirm.a11yBefore', { value: row.before })}
          >
            {row.before}
          </Text>
          <View style={styles.diffAfterRow}>
            <MaterialCommunityIcons name="arrow-right" size={componentMetrics.iconMeta} color={colors.onSurfaceVariant} style={styles.diffArrow} />
            <Text
              style={[styles.diffAfter, { color: colors.onSurface }]}
              accessibilityLabel={fmt.t('ai:confirm.a11yAfter', { value: row.after })}
            >
              {row.after}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function Warnings({ messages, colors }: { messages: string[]; colors: MGColors }): ReactElement | null {
  if (messages.length === 0) return null;
  return (
    <View style={[styles.notice, { backgroundColor: colors.warningContainer }]}>
      {messages.map((message, index) => (
        <View key={index} style={styles.noticeLine}>
          <MaterialCommunityIcons name="alert-outline" size={componentMetrics.iconMeta} color={colors.onWarningContainer} />
          <Text style={[styles.noticeText, { color: colors.onWarningContainer }]}>{message}</Text>
        </View>
      ))}
    </View>
  );
}

function LoadingDetails({ colors, fmt }: { colors: MGColors; fmt: AssistantFormatter }): ReactElement {
  return (
    <View style={styles.loading} accessibilityLiveRegion="polite">
      <ActivityIndicator size="small" color={colors.primary} />
      <Text style={[styles.note, { color: colors.onSurfaceVariant }]}>{fmt.t('ai:confirm.loadingDetails')}</Text>
    </View>
  );
}

function ShareBody({
  action,
  preview,
  fmt,
  colors,
}: {
  action: Extract<AiAction, { type: 'share_meeting' }>;
  preview: AiActionPreview | null;
  fmt: AssistantFormatter;
  colors: MGColors;
}): ReactElement {
  const meeting = preview?.meetings[0] ?? null;
  const share = describeShare(fmt, action);
  return (
    <>
      {meeting ? <DetailRows rows={describeMeeting(fmt, meeting)} colors={colors} /> : null}
      {!preview ? <LoadingDetails colors={colors} fmt={fmt} /> : null}
      <View style={styles.row}>
        <Text style={[styles.rowLabel, { color: colors.onSurfaceVariant }]}>{fmt.t('ai:confirm.channel')}</Text>
        <Text style={[styles.rowValue, { color: colors.onSurface }]}>{share.channel}</Text>
      </View>
      {share.recipients.length > 0 ? (
        <View style={styles.row}>
          <Text style={[styles.rowLabel, { color: colors.onSurfaceVariant }]}>
            {fmt.t('ai:confirm.recipients', { count: share.recipients.length })}
          </Text>
          <View style={styles.chips}>
            {share.recipients.map((email) => (
              <View key={email} style={[styles.chip, { backgroundColor: colors.surfaceContainerHigh, borderColor: colors.outlineVariant }]}>
                <MaterialCommunityIcons name="email-outline" size={componentMetrics.iconMeta} color={colors.onSurfaceVariant} />
                <Text style={[styles.chipText, { color: colors.onSurface }]} selectable>
                  {email}
                </Text>
              </View>
            ))}
          </View>
          <Text style={[styles.note, { color: colors.onSurfaceVariant }]}>{fmt.t('ai:confirm.emailNote')}</Text>
        </View>
      ) : null}
      {share.message ? (
        <View style={styles.row}>
          <Text style={[styles.rowLabel, { color: colors.onSurfaceVariant }]}>{fmt.t('ai:confirm.message')}</Text>
          <Text style={[styles.quote, { color: colors.onSurface, borderColor: colors.outlineVariant }]}>{share.message}</Text>
        </View>
      ) : null}
    </>
  );
}

function BulkBody({
  action,
  preview,
  fmt,
  colors,
}: {
  action: Extract<AiAction, { type: 'bulk_update' }>;
  preview: AiActionPreview | null;
  fmt: AssistantFormatter;
  colors: MGColors;
}): ReactElement {
  if (!preview) {
    return (
      <>
        {action.changes ? <DetailRows rows={describeChangeRows(fmt, action.changes)} colors={colors} /> : null}
        <LoadingDetails colors={colors} fmt={fmt} />
      </>
    );
  }
  const bulk = describeBulk(fmt, action, preview.meetings);
  return (
    <>
      {bulk.changes.map((line, index) => (
        <Text key={index} style={[styles.bulkChange, { color: colors.onSurface }]}>
          {line}
        </Text>
      ))}
      <Text style={[styles.rowLabel, styles.spaced, { color: colors.onSurfaceVariant }]}>
        {fmt.t('ai:confirm.affected', { count: bulk.items.length })}
      </Text>
      {bulk.items.map((item) => (
        <View key={item.meetingId} style={[styles.bulkItem, { borderColor: colors.outlineVariant }]}>
          <Text style={[styles.bulkTitle, { color: colors.onSurface }]}>{item.title}</Text>
          {item.after ? (
            <>
              <Text
                style={[styles.diffBefore, { color: colors.onSurfaceVariant }]}
                accessibilityLabel={fmt.t('ai:confirm.a11yBefore', { value: item.before })}
              >
                {item.before}
              </Text>
              <Text
                style={[styles.diffAfter, { color: colors.onSurface }]}
                accessibilityLabel={fmt.t('ai:confirm.a11yAfter', { value: item.after })}
              >
                {item.after}
              </Text>
            </>
          ) : (
            <Text style={[styles.note, { color: colors.onSurfaceVariant }]}>{item.before}</Text>
          )}
          {item.skipped ? (
            <Text style={[styles.note, { color: colors.onSurfaceVariant }]}>{fmt.t('ai:confirm.skippedAllDay')}</Text>
          ) : null}
        </View>
      ))}
    </>
  );
}

function ActionBody({
  action,
  preview,
  fmt,
  colors,
}: {
  action: AiAction;
  preview: AiActionPreview | null;
  fmt: AssistantFormatter;
  colors: MGColors;
}): ReactElement | null {
  const meeting = preview?.meetings[0] ?? null;
  switch (action.type) {
    case 'create_meeting':
      return <DetailRows rows={describeDraft(fmt, action.meeting)} colors={colors} />;
    case 'update_meeting': {
      const scopeRow = describeScopeRow(fmt, action, meeting);
      if (!preview) {
        return (
          <>
            {scopeRow ? <DetailRows rows={[scopeRow]} colors={colors} /> : null}
            <DetailRows rows={describeChangeRows(fmt, action.changes)} colors={colors} />
            <LoadingDetails colors={colors} fmt={fmt} />
          </>
        );
      }
      if (!meeting) return null;
      return (
        <>
          <Text style={[styles.meetingTitle, { color: colors.onSurface }]}>{meeting.title}</Text>
          {scopeRow ? <DetailRows rows={[scopeRow]} colors={colors} /> : null}
          <DiffRows rows={computeUpdateDiff(fmt, meeting, action.changes)} colors={colors} fmt={fmt} />
        </>
      );
    }
    case 'delete_meeting': {
      const synced = meeting !== null && (meeting.external.googleEventId !== null || meeting.external.deviceEventId !== null);
      const scopeRow = describeScopeRow(fmt, action, meeting);
      const warningText = fmt.t(deleteWarningKey(action, meeting, synced));
      return (
        <View style={[styles.notice, { backgroundColor: colors.errorContainer }]}>
          <View style={styles.noticeLine}>
            <MaterialCommunityIcons name="delete-alert-outline" size={componentMetrics.iconInline} color={colors.onErrorContainer} />
            <Text style={[styles.noticeText, styles.bold, { color: colors.onErrorContainer }]}>{warningText}</Text>
          </View>
          {scopeRow ? <DetailRows rows={[scopeRow]} colors={colors} /> : null}
          {meeting ? <DetailRows rows={describeMeeting(fmt, meeting)} colors={colors} /> : null}
          {!preview ? <LoadingDetails colors={colors} fmt={fmt} /> : null}
        </View>
      );
    }
    case 'share_meeting':
      return <ShareBody action={action} preview={preview} fmt={fmt} colors={colors} />;
    case 'bulk_update':
      return <BulkBody action={action} preview={preview} fmt={fmt} colors={colors} />;
    default:
      return null;
  }
}

function ActionDetails({
  state,
  fmt,
  colors,
  onReject,
}: {
  state: ProposedActionState;
  fmt: AssistantFormatter;
  colors: MGColors;
  onReject: ((actionId: string) => void) | null;
}): ReactElement {
  const { action } = state;
  const preview = previewOf(state);
  const destructive = isDestructiveAction(action);
  const warnings = preview ? describeWarnings(fmt, preview) : [];
  const accent = destructive ? colors.error : colors.primary;

  return (
    <View
      style={[styles.card, { backgroundColor: colors.surface, borderColor: destructive ? colors.error : colors.outlineVariant }]}
      testID={`confirm-action-${action.id}`}
    >
      <View style={styles.cardHeader}>
        <MaterialCommunityIcons name={actionIconName(action.type)} size={20} color={accent} />
        <Text style={[styles.cardType, { color: accent }]} accessibilityRole="header">
          {fmt.t(`ai:actions.type.${action.type}`)}
        </Text>
        <ConfidenceBadge confidence={action.confidence} size="sm" showIcon={false} />
      </View>
      <Text style={[styles.summary, { color: colors.onSurface }]}>{action.summary}</Text>
      <Warnings messages={warnings} colors={colors} />
      <ActionBody action={action} preview={preview} fmt={fmt} colors={colors} />
      {onReject ? (
        <Pressable
          onPress={() => onReject(action.id)}
          style={styles.inlineDismiss}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={fmt.t('ai:confirm.dismissOne')}
          testID={`confirm-dismiss-${action.id}`}
        >
          <Text style={[styles.inlineDismissText, { color: colors.onSurfaceVariant }]}>{fmt.t('ai:confirm.dismissOne')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export interface MeetingConfirmationModalProps {
  visible: boolean;
  actions: ProposedActionState[];
  onConfirm: () => void;
  onCancel: () => void;
  /** Shown per action when several are reviewed together ("Dismiss this one"). */
  onReject?: ((actionId: string) => void) | null;
  isBusy?: boolean;
  /** Preferences.use24HourClock (null = locale / device default). */
  use24Hour?: boolean | null;
}

export function MeetingConfirmationModal({
  visible,
  actions,
  onConfirm,
  onCancel,
  onReject = null,
  isBusy = false,
  use24Hour = null,
}: MeetingConfirmationModalProps): ReactElement {
  const t = useT();
  const { language } = useLanguage();
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const fmt = useMemo(() => createAssistantFormatter({ t, language, use24Hour }), [t, language, use24Hour]);

  const destructive = actions.some((state) => isDestructiveAction(state.action));
  const many = actions.length > 1;
  const confirmColor = destructive ? colors.error : colors.primary;
  const onConfirmColor = destructive ? colors.onError : colors.onPrimary;

  return (
    <Modal
      visible={visible && actions.length > 0}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View style={[styles.backdrop, { backgroundColor: colors.backdrop }]}>
        <Pressable
          style={styles.backdropTouch}
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel={fmt.t('ai:confirm.cancel')}
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surface,
              paddingBottom: spacing.lg + insets.bottom,
              paddingLeft: spacing.lg + insets.left,
              paddingRight: spacing.lg + insets.right,
            },
          ]}
          accessibilityViewIsModal
        >
          <SheetHandle />
          <Text style={[styles.title, { color: colors.onSurface }]} accessibilityRole="header">
            {confirmTitle(fmt, actions)}
          </Text>
          <Text style={[styles.subtitle, { color: colors.onSurfaceVariant }]}>{fmt.t('ai:confirm.subtitle')}</Text>
          <FlatList
            data={actions}
            keyExtractor={(state) => state.action.id}
            renderItem={({ item }) => <ActionDetails state={item} fmt={fmt} colors={colors} onReject={many ? onReject : null} />}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            ItemSeparatorComponent={Separator}
          />
          <View style={styles.footer}>
            <Pressable
              onPress={onCancel}
              style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
              accessibilityRole="button"
              testID="confirm-cancel"
            >
              <Text style={[styles.buttonText, { color: colors.primary }]}>{fmt.t('ai:confirm.cancel')}</Text>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              disabled={isBusy}
              style={({ pressed }) => [
                styles.button,
                { backgroundColor: confirmColor, opacity: isBusy ? 0.6 : pressed ? pressedDimOpacity : 1 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={confirmLabel(fmt, actions)}
              accessibilityState={{ disabled: isBusy, busy: isBusy }}
              testID="confirm-submit"
            >
              {isBusy ? (
                <ActivityIndicator size="small" color={onConfirmColor} />
              ) : (
                <Text style={[styles.buttonText, { color: onConfirmColor }]}>{confirmLabel(fmt, actions)}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Separator(): ReactElement {
  return <View style={styles.separator} />;
}

export default MeetingConfirmationModal;

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdropTouch: {
    flex: 1,
  },
  sheet: {
    maxHeight: '88%',
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    paddingTop: spacing.xs,
  },
  title: {
    ...typography.headlineS,
    marginTop: spacing.xs,
  },
  subtitle: {
    ...typography.bodyM,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  list: {
    flexGrow: 0,
  },
  listContent: {
    paddingBottom: spacing.md,
  },
  separator: {
    height: componentMetrics.cardGap,
  },
  card: {
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: componentMetrics.cardPadding,
    gap: componentMetrics.cardGap,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  cardType: {
    ...typography.labelL,
    flex: 1,
  },
  summary: {
    ...typography.bodyM,
  },
  meetingTitle: {
    ...typography.titleM,
  },
  rows: {
    gap: spacing.md,
  },
  row: {
    gap: spacing.xs,
  },
  rowLabel: {
    ...typography.bodyS,
  },
  rowValue: {
    ...typography.bodyL,
  },
  diffBefore: {
    ...typography.bodyM,
    textDecorationLine: 'line-through',
  },
  diffAfterRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  diffArrow: {
    marginTop: spacing.xs,
    marginRight: spacing.xs,
  },
  diffAfter: {
    ...typography.bodyL,
    flex: 1,
    fontWeight: '600',
  },
  notice: {
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  noticeLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  noticeText: {
    ...typography.bodyM,
    flex: 1,
  },
  bold: {
    fontWeight: '700',
  },
  note: {
    ...typography.bodyS,
  },
  loading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: radii.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  chipText: {
    ...typography.bodyS,
  },
  quote: {
    ...typography.bodyM,
    fontStyle: 'italic',
    borderLeftWidth: 3,
    paddingLeft: spacing.sm,
  },
  bulkChange: {
    ...typography.titleM,
  },
  spaced: {
    marginTop: spacing.sm,
  },
  bulkItem: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
  bulkTitle: {
    ...typography.titleM,
  },
  inlineDismiss: {
    alignSelf: 'flex-end',
    paddingVertical: spacing.xs,
  },
  inlineDismissText: {
    ...typography.labelL,
    textDecorationLine: 'underline',
  },
  footer: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingTop: spacing.sm,
  },
  button: {
    flex: 1,
    minHeight: componentMetrics.buttonHeight,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  buttonPressed: {
    opacity: pressedDimOpacity,
  },
  buttonText: {
    ...typography.labelL,
    textAlign: 'center',
  },
});
