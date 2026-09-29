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

import { useTheme } from '../contexts/ThemeContext';
import type { AiAction } from '../core/aiContract';
import type { ProposedActionState } from '../core/contracts';
import { useLanguage, useT } from '../i18n';
import { createAssistantFormatter } from '../services/ai/formatter';
import {
  actionIconName,
  assistantPalette,
  computeUpdateDiff,
  describeBulk,
  describeChangeRows,
  describeDraft,
  describeMeeting,
  describeShare,
  describeWarnings,
  isDestructiveAction,
  type AssistantPalette,
  type DetailRow,
  type DiffRow,
} from '../services/ai/presentation';
import type { AiActionPreview, AssistantFormatter } from '../services/ai/types';
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

function DetailRows({ rows, palette }: { rows: DetailRow[]; palette: AssistantPalette }): ReactElement {
  return (
    <View style={styles.rows}>
      {rows.map((row, index) => (
        <View key={`${row.field}-${index}`} style={styles.row} accessible accessibilityLabel={`${row.label}: ${row.value}`}>
          <Text style={[styles.rowLabel, { color: palette.textMuted }]}>{row.label}</Text>
          <Text style={[styles.rowValue, { color: palette.text }]} selectable>
            {row.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

function DiffRows({ rows, palette, fmt }: { rows: DiffRow[]; palette: AssistantPalette; fmt: AssistantFormatter }): ReactElement {
  if (rows.length === 0) {
    return <Text style={[styles.note, { color: palette.textMuted }]}>{fmt.t('ai:confirm.noChanges')}</Text>;
  }
  return (
    <View style={styles.rows}>
      {rows.map((row, index) => (
        <View key={`${row.field}-${index}`} style={styles.row}>
          <Text style={[styles.rowLabel, { color: palette.textMuted }]}>{row.label}</Text>
          <Text
            style={[styles.diffBefore, { color: palette.textMuted }]}
            accessibilityLabel={fmt.t('ai:confirm.a11yBefore', { value: row.before })}
          >
            {row.before}
          </Text>
          <View style={styles.diffAfterRow}>
            <MaterialCommunityIcons name="arrow-right" size={14} color={palette.success} style={styles.diffArrow} />
            <Text
              style={[styles.diffAfter, { color: palette.text }]}
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

function Warnings({ messages, palette }: { messages: string[]; palette: AssistantPalette }): ReactElement | null {
  if (messages.length === 0) return null;
  return (
    <View style={[styles.notice, { backgroundColor: palette.warningSurface, borderColor: palette.warning }]}>
      {messages.map((message, index) => (
        <View key={index} style={styles.noticeLine}>
          <MaterialCommunityIcons name="alert-outline" size={16} color={palette.warning} />
          <Text style={[styles.noticeText, { color: palette.text }]}>{message}</Text>
        </View>
      ))}
    </View>
  );
}

function LoadingDetails({ palette, fmt }: { palette: AssistantPalette; fmt: AssistantFormatter }): ReactElement {
  return (
    <View style={styles.loading} accessibilityLiveRegion="polite">
      <ActivityIndicator size="small" color={palette.primary} />
      <Text style={[styles.note, { color: palette.textMuted }]}>{fmt.t('ai:confirm.loadingDetails')}</Text>
    </View>
  );
}

function ShareBody({
  action,
  preview,
  fmt,
  palette,
}: {
  action: Extract<AiAction, { type: 'share_meeting' }>;
  preview: AiActionPreview | null;
  fmt: AssistantFormatter;
  palette: AssistantPalette;
}): ReactElement {
  const meeting = preview?.meetings[0] ?? null;
  const share = describeShare(fmt, action);
  return (
    <>
      {meeting ? <DetailRows rows={describeMeeting(fmt, meeting)} palette={palette} /> : null}
      {!preview ? <LoadingDetails palette={palette} fmt={fmt} /> : null}
      <View style={styles.row}>
        <Text style={[styles.rowLabel, { color: palette.textMuted }]}>{fmt.t('ai:confirm.channel')}</Text>
        <Text style={[styles.rowValue, { color: palette.text }]}>{share.channel}</Text>
      </View>
      {share.recipients.length > 0 ? (
        <View style={styles.row}>
          <Text style={[styles.rowLabel, { color: palette.textMuted }]}>
            {fmt.t('ai:confirm.recipients', { count: share.recipients.length })}
          </Text>
          <View style={styles.chips}>
            {share.recipients.map((email) => (
              <View key={email} style={[styles.chip, { backgroundColor: palette.surfaceAlt, borderColor: palette.border }]}>
                <MaterialCommunityIcons name="email-outline" size={14} color={palette.textMuted} />
                <Text style={[styles.chipText, { color: palette.text }]} selectable>
                  {email}
                </Text>
              </View>
            ))}
          </View>
          <Text style={[styles.note, { color: palette.textMuted }]}>{fmt.t('ai:confirm.emailNote')}</Text>
        </View>
      ) : null}
      {share.message ? (
        <View style={styles.row}>
          <Text style={[styles.rowLabel, { color: palette.textMuted }]}>{fmt.t('ai:confirm.message')}</Text>
          <Text style={[styles.quote, { color: palette.text, borderColor: palette.border }]}>{share.message}</Text>
        </View>
      ) : null}
    </>
  );
}

function BulkBody({
  action,
  preview,
  fmt,
  palette,
}: {
  action: Extract<AiAction, { type: 'bulk_update' }>;
  preview: AiActionPreview | null;
  fmt: AssistantFormatter;
  palette: AssistantPalette;
}): ReactElement {
  if (!preview) {
    return (
      <>
        {action.changes ? <DetailRows rows={describeChangeRows(fmt, action.changes)} palette={palette} /> : null}
        <LoadingDetails palette={palette} fmt={fmt} />
      </>
    );
  }
  const bulk = describeBulk(fmt, action, preview.meetings);
  return (
    <>
      {bulk.changes.map((line, index) => (
        <Text key={index} style={[styles.bulkChange, { color: palette.text }]}>
          {line}
        </Text>
      ))}
      <Text style={[styles.rowLabel, styles.spaced, { color: palette.textMuted }]}>
        {fmt.t('ai:confirm.affected', { count: bulk.items.length })}
      </Text>
      {bulk.items.map((item) => (
        <View key={item.meetingId} style={[styles.bulkItem, { borderColor: palette.border }]}>
          <Text style={[styles.bulkTitle, { color: palette.text }]}>{item.title}</Text>
          {item.after ? (
            <>
              <Text
                style={[styles.diffBefore, { color: palette.textMuted }]}
                accessibilityLabel={fmt.t('ai:confirm.a11yBefore', { value: item.before })}
              >
                {item.before}
              </Text>
              <Text
                style={[styles.diffAfter, { color: palette.text }]}
                accessibilityLabel={fmt.t('ai:confirm.a11yAfter', { value: item.after })}
              >
                {item.after}
              </Text>
            </>
          ) : (
            <Text style={[styles.note, { color: palette.textMuted }]}>{item.before}</Text>
          )}
          {item.skipped ? <Text style={[styles.note, { color: palette.warning }]}>{fmt.t('ai:confirm.skippedAllDay')}</Text> : null}
        </View>
      ))}
    </>
  );
}

function ActionBody({
  action,
  preview,
  fmt,
  palette,
}: {
  action: AiAction;
  preview: AiActionPreview | null;
  fmt: AssistantFormatter;
  palette: AssistantPalette;
}): ReactElement | null {
  const meeting = preview?.meetings[0] ?? null;
  switch (action.type) {
    case 'create_meeting':
      return <DetailRows rows={describeDraft(fmt, action.meeting)} palette={palette} />;
    case 'update_meeting':
      if (!preview) {
        return (
          <>
            <DetailRows rows={describeChangeRows(fmt, action.changes)} palette={palette} />
            <LoadingDetails palette={palette} fmt={fmt} />
          </>
        );
      }
      if (!meeting) return null;
      return (
        <>
          <Text style={[styles.meetingTitle, { color: palette.text }]}>{meeting.title}</Text>
          <DiffRows rows={computeUpdateDiff(fmt, meeting, action.changes)} palette={palette} fmt={fmt} />
        </>
      );
    case 'delete_meeting': {
      const synced = meeting !== null && (meeting.external.googleEventId !== null || meeting.external.deviceEventId !== null);
      return (
        <View style={[styles.notice, { backgroundColor: palette.dangerSurface, borderColor: palette.danger }]}>
          <View style={styles.noticeLine}>
            <MaterialCommunityIcons name="delete-alert-outline" size={18} color={palette.danger} />
            <Text style={[styles.noticeText, styles.bold, { color: palette.danger }]}>
              {synced ? fmt.t('ai:confirm.deleteWarningSynced') : fmt.t('ai:confirm.deleteWarning')}
            </Text>
          </View>
          {meeting ? <DetailRows rows={describeMeeting(fmt, meeting)} palette={palette} /> : null}
          {!preview ? <LoadingDetails palette={palette} fmt={fmt} /> : null}
        </View>
      );
    }
    case 'share_meeting':
      return <ShareBody action={action} preview={preview} fmt={fmt} palette={palette} />;
    case 'bulk_update':
      return <BulkBody action={action} preview={preview} fmt={fmt} palette={palette} />;
    default:
      return null;
  }
}

function ActionDetails({
  state,
  fmt,
  palette,
  onReject,
}: {
  state: ProposedActionState;
  fmt: AssistantFormatter;
  palette: AssistantPalette;
  onReject: ((actionId: string) => void) | null;
}): ReactElement {
  const { action } = state;
  const preview = previewOf(state);
  const destructive = isDestructiveAction(action);
  const warnings = preview ? describeWarnings(fmt, preview) : [];
  const accent = destructive ? palette.danger : palette.primary;

  return (
    <View
      style={[styles.card, { backgroundColor: palette.surface, borderColor: destructive ? palette.danger : palette.border }]}
      testID={`confirm-action-${action.id}`}
    >
      <View style={styles.cardHeader}>
        <MaterialCommunityIcons name={actionIconName(action.type)} size={20} color={accent} />
        <Text style={[styles.cardType, { color: accent }]} accessibilityRole="header">
          {fmt.t(`ai:actions.type.${action.type}`)}
        </Text>
        <ConfidenceBadge confidence={action.confidence} size="sm" showIcon={false} />
      </View>
      <Text style={[styles.summary, { color: palette.text }]}>{action.summary}</Text>
      <Warnings messages={warnings} palette={palette} />
      <ActionBody action={action} preview={preview} fmt={fmt} palette={palette} />
      {onReject ? (
        <Pressable
          onPress={() => onReject(action.id)}
          style={styles.inlineDismiss}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={fmt.t('ai:confirm.dismissOne')}
          testID={`confirm-dismiss-${action.id}`}
        >
          <Text style={[styles.inlineDismissText, { color: palette.textMuted }]}>{fmt.t('ai:confirm.dismissOne')}</Text>
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
  const { isDarkMode } = useTheme();
  const insets = useSafeAreaInsets();
  const palette = assistantPalette(isDarkMode);
  const fmt = useMemo(() => createAssistantFormatter({ t, language, use24Hour }), [t, language, use24Hour]);

  const destructive = actions.some((state) => isDestructiveAction(state.action));
  const many = actions.length > 1;
  const confirmColor = destructive ? palette.danger : palette.primary;
  const onConfirmColor = destructive ? palette.onDanger : palette.onPrimary;

  return (
    <Modal
      visible={visible && actions.length > 0}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View style={[styles.backdrop, { backgroundColor: palette.backdrop }]}>
        <Pressable
          style={styles.backdropTouch}
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel={fmt.t('ai:confirm.cancel')}
        />
        <View
          style={[
            styles.sheet,
            { backgroundColor: palette.background, paddingBottom: 16 + insets.bottom, paddingLeft: 16 + insets.left, paddingRight: 16 + insets.right },
          ]}
          accessibilityViewIsModal
        >
          <View style={[styles.handle, { backgroundColor: palette.border }]} />
          <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
            {confirmTitle(fmt, actions)}
          </Text>
          <Text style={[styles.subtitle, { color: palette.textMuted }]}>{fmt.t('ai:confirm.subtitle')}</Text>
          <FlatList
            data={actions}
            keyExtractor={(state) => state.action.id}
            renderItem={({ item }) => <ActionDetails state={item} fmt={fmt} palette={palette} onReject={many ? onReject : null} />}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            ItemSeparatorComponent={Separator}
          />
          <View style={styles.footer}>
            <Pressable
              onPress={onCancel}
              style={[styles.button, styles.secondaryButton, { borderColor: palette.border }]}
              accessibilityRole="button"
              testID="confirm-cancel"
            >
              <Text style={[styles.buttonText, { color: palette.text }]}>{fmt.t('ai:confirm.cancel')}</Text>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              disabled={isBusy}
              style={[styles.button, { backgroundColor: confirmColor, opacity: isBusy ? 0.6 : 1 }]}
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
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 13,
    marginTop: 2,
    marginBottom: 12,
  },
  list: {
    flexGrow: 0,
  },
  listContent: {
    paddingBottom: 12,
  },
  separator: {
    height: 12,
  },
  card: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardType: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
  },
  summary: {
    fontSize: 15,
    lineHeight: 21,
  },
  meetingTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  rows: {
    gap: 10,
  },
  row: {
    gap: 2,
  },
  rowLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  rowValue: {
    fontSize: 15,
    lineHeight: 21,
  },
  diffBefore: {
    fontSize: 14,
    textDecorationLine: 'line-through',
  },
  diffAfterRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  diffArrow: {
    marginTop: 3,
    marginRight: 4,
  },
  diffAfter: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
  },
  notice: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    gap: 8,
  },
  noticeLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  noticeText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 19,
  },
  bold: {
    fontWeight: '700',
  },
  note: {
    fontSize: 13,
  },
  loading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chipText: {
    fontSize: 13,
  },
  quote: {
    fontSize: 14,
    fontStyle: 'italic',
    borderLeftWidth: 3,
    paddingLeft: 8,
  },
  bulkChange: {
    fontSize: 15,
    fontWeight: '600',
  },
  spaced: {
    marginTop: 6,
  },
  bulkItem: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
    gap: 2,
  },
  bulkTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  inlineDismiss: {
    alignSelf: 'flex-end',
    paddingVertical: 4,
  },
  inlineDismissText: {
    fontSize: 13,
    textDecorationLine: 'underline',
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
    paddingTop: 8,
  },
  button: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  secondaryButton: {
    borderWidth: 1,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '700',
  },
});
