/**
 * Review the suggested tasks of one filed or kept summary (route "SummaryCommitments"
 * { summaryId }; M11, docs/v2/M11-DESIGN.md sections 3, 11 and 16). Top to bottom:
 * 1. The origin block, always first: where the suggestions come from, "Meeting Guard AI did not
 *    attend this meeting." and "Written by AI ..." (or "exactly as your notetaker wrote them").
 * 2. The mode: the action items as written come first and are free (prepared on open when nothing
 *    is prepared yet); "Suggest tasks with AI" shows the one-time AI notice (decision 17) and uses
 *    1 AI action, the first time only; quota_exceeded offers Plans and the as-written list.
 * 3. The banners: why nothing is pre-selected, a long summary read only in part, a summary filed
 *    under another meeting since; a stale list is read-only with "Prepare again" (free).
 * 4. "Reminder for items without a date" (tomorrow 9:00 by default), with "8 reminders tomorrow at
 *    9:00" when several share it.
 * 5. One card per suggestion: checkbox, title, owner (a follow-up for someone else keeps the name
 *    in the title), due, flags as chips, the quote under "From the summary:" as plain text, Edit
 *    and Drop; accepted ones say "In your tasks" with Open task and Undo, a deleted task shows Add
 *    again, dropped ones collapse into a "Dropped" row with Restore.
 * 6. How long the summary is kept, the rules, and "Delete the summary, keep my tasks" once
 *    something was added. The sticky footer: "Accept all (8)" or "Add 5 selected", Select all
 *    (not on a summary sent to someone else), disabled offline.
 * States: loading, the as-written list being read, the AI notice, preparing on another device
 * (polled by the hook), quota, error, empty, stale.
 *
 * Data: useSummaryCommitments (memory only, cleared on session end), useSummary (the retention
 * date and whether the summary waits in the inbox), useSummaryStatus (everything shows only when
 * enabled and allowed; a summaryCommitments that is not deployed reads as not_enabled). A
 * commitments not_found asks summaryRead again before the screen goes back: an inbox summary
 * says "file it first" instead. "Added" is said only from the decide answer, and the list shown
 * after a decide is that answer's list; a decide that timed out says it could not be confirmed.
 * Edits and the selection live in this screen's memory only; leaving with edits asks first. The
 * only thing stored on the phone is the AI notice flag. Nothing from the summary is logged:
 * failures reach the user as i18n messages only.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { usePreventRemove } from '@react-navigation/native';
import type { StackScreenProps } from '@react-navigation/stack';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactElement } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

import {
  CommitmentCard,
  CommitmentEditSheet,
  DEFAULT_REMINDER,
  OriginBlock,
  ReminderDefaultPicker,
  type CommitmentCardAction,
  type CommitmentEdit,
  type CommitmentEditTarget,
  type ReminderDefault,
} from '../../components/commitments';
import { Badge, Card, EmptyState, ErrorState, LoadingState, MGButton, type BadgeTone } from '../../components/ui';
import type { CommitmentDecision, CommitmentDraft, CommitmentItem, CommitmentMode } from '../../core/aiContract';
import type { RootStackParamList, TranslateFn } from '../../core/contracts';
import { toAppError, type AppError } from '../../core/errors';
import { getDeviceTimeZone } from '../../core/time';
import { useT } from '../../i18n';
import { useAuth } from '../../services/auth';
import { useSyncState } from '../../services/data';
import { summariesService, useCommitmentsAiNotice, useSummary, useSummaryCommitments, useSummaryStatus } from '../../services/summaries';
import { commitmentErrorMessageKey, commitmentErrorReason } from '../../services/summaries/commitmentsCore';
import { componentMetrics, spacing, useAppTheme } from '../../theme';
import { useFormatters } from '../shared/useFormatters';
import {
  bannerRefs,
  buildAcceptDecisions,
  commitmentCardView,
  commitmentsFooter,
  commitmentsPhase,
  decideErrorKey,
  decideFeedback,
  dueZone,
  hasOpenEdits,
  headerRefs,
  initialSelection,
  isPickedDefaultPast,
  isReadOnly,
  isStillPreparingError,
  isTextRef,
  needsReminderDefault,
  originText,
  prepareAgainMode,
  quotaLines,
  reconcileSelection,
  reminderChoiceRef,
  reminderGroupRef,
  scheduleFor,
  selectAllAnchors,
  summaryKeptUntil,
  toggleSelection,
  type CommitmentCardStatus,
  type TextRef,
  type WallClockLabels,
} from './summaryCommitmentsModel';
import { SUMMARY_PROVIDER_RETENTION_DAYS, summaryErrorMessageKey } from './summaryText';

type Props = StackScreenProps<RootStackParamList, 'SummaryCommitments'>;
type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

type EditsByKey = Readonly<Record<string, Readonly<Record<string, CommitmentEdit>>>>;
type SelectionByKey = Readonly<Record<string, readonly string[]>>;

const NO_EDITS: Readonly<Record<string, CommitmentEdit>> = {};

/** A TextRef in the current language (params that are TextRefs first). */
function resolveRef(t: TranslateFn, ref: TextRef): string {
  if (ref.params === undefined) return t(ref.key);
  const params: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(ref.params)) params[name] = isTextRef(value) ? resolveRef(t, value) : value;
  return t(ref.key, params);
}

const CARD_STATUS: Readonly<Record<Exclude<CommitmentCardStatus, 'open'>, { key: string; tone: BadgeTone }>> = {
  accepted: { key: 'summaries:commitments.card.inTasks', tone: 'success' },
  removed: { key: 'summaries:commitments.card.removedFromTasks', tone: 'warning' },
  dropped: { key: 'summaries:commitments.card.dropped', tone: 'neutral' },
};

export function SummaryCommitmentsScreen({ navigation, route }: Props): ReactElement {
  const summaryId = route.params.summaryId;
  const t = useT();
  const tr = useCallback((ref: TextRef): string => resolveRef(t, ref), [t]);
  const { colors } = useAppTheme();
  const fmt = useFormatters();
  const insets = useSafeAreaInsets();
  const { online } = useSyncState();
  const { status, available, error: statusError, refresh: refreshStatus } = useSummaryStatus();
  const { summary, error: summaryError, loading: summaryLoading, refresh: refreshSummary } = useSummary(summaryId, { enabled: available });
  const { state: hookState, data, error, busy, prepare, decide, refresh } = useSummaryCommitments(summaryId, { enabled: available });
  // The AI notice is per account (decision 17, Apple 5.1.2(i)): a second account on this phone sees it too.
  const { authUser } = useAuth();
  const notice = useCommitmentsAiNotice(authUser?.uid ?? null);

  const [reminderDefault, setReminderDefault] = useState<ReminderDefault>(DEFAULT_REMINDER);
  const [selections, setSelections] = useState<SelectionByKey>({});
  const [edits, setEdits] = useState<EditsByKey>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [preparingMode, setPreparingMode] = useState<CommitmentMode | null>(null);
  const [prepareFailed, setPrepareFailed] = useState(false);
  const [showDropped, setShowDropped] = useState(false);
  const [pastPick, setPastPick] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [knownEmpty, setKnownEmpty] = useState<Partial<Record<CommitmentMode, true>>>({});
  /** This screen asked for a preparation at least once (render: the start card, not a spinner, after that). */
  const [prepareStarted, setPrepareStarted] = useState(false);
  const autoPreparedRef = useRef(false);
  /** The mode of the last list shown here ("Prepare again" uses it once the text changed). */
  const [lastMode, setLastMode] = useState<CommitmentMode | null>(null);
  /** The commitments not_found error that summaryRead was asked about again (see commitmentsPhase). */
  const [checkedNotFound, setCheckedNotFound] = useState<AppError | null>(null);
  /** The screen already went back (deleted here or elsewhere, or the user chose Leave). */
  const leftRef = useRef(false);
  /** A delete from this screen is in flight: its own toast says so, not "no longer here". */
  const deletingRef = useRef(false);

  const labels: WallClockLabels = useMemo(
    () => ({
      date: (localDate: string) => fmt.date(localDate, 'medium'),
      // An HH:MM wall clock in the user's 12 or 24 h format (UTC has no DST, so it reads as written).
      time: (hhmm: string) => fmt.time(`2000-01-03T${hhmm}:00.000Z`, 'UTC') || hhmm,
    }),
    [fmt],
  );

  if (data !== null && data.mode !== lastMode) setLastMode(data.mode);

  // summaryCommitments answers not_found for a summary moved back to the inbox too: ask summaryRead
  // again before saying it is gone (it says "file it first" for an inbox summary).
  const commitmentsNotFound = commitmentErrorReason(error) === 'not_found' ? error : null;
  useEffect(() => {
    if (commitmentsNotFound === null) return undefined;
    let active = true;
    void refreshSummary().then(() => {
      if (active) setCheckedNotFound(commitmentsNotFound);
    });
    return () => {
      active = false;
    };
  }, [commitmentsNotFound, refreshSummary]);

  const phase = commitmentsPhase({
    status,
    statusError,
    hookState,
    data,
    error,
    busy,
    summaryStatus: summary?.status ?? null,
    summaryError,
    summaryLoading,
    summaryChecked: commitmentsNotFound !== null && checkedNotFound === commitmentsNotFound,
  });
  const readOnly = isReadOnly(hookState);
  const listKey = data?.key ?? null;
  const currentEdits = listKey !== null ? (edits[listKey] ?? NO_EDITS) : NO_EDITS;
  const storedSelection = listKey !== null ? selections[listKey] : undefined;
  const selection = useMemo(() => {
    if (data === null) return [];
    return storedSelection === undefined ? initialSelection(data, readOnly) : reconcileSelection(storedSelection, data, readOnly);
  }, [data, storedSelection, readOnly]);
  const working = busy !== null || deleting;

  // ---- Leaving --------------------------------------------------------------------------------------

  const leave = useCallback((): void => {
    if (leftRef.current) return;
    leftRef.current = true;
    if (navigation.canGoBack()) navigation.goBack();
  }, [navigation]);

  // Deleted here or on another device: back to where the user came from (as the summary view does).
  useEffect(() => {
    if (phase !== 'gone' || leftRef.current || !navigation.canGoBack()) return;
    if (!deletingRef.current) Toast.show({ type: 'info', text1: t('summaries:view.notFound') });
    leave();
  }, [phase, navigation, leave, t]);

  // Edits live on this screen only: leaving with any asks first.
  usePreventRemove(hasOpenEdits(data, currentEdits) && !readOnly, ({ data: event }) => {
    if (leftRef.current) {
      navigation.dispatch(event.action);
      return;
    }
    Alert.alert(t('summaries:commitments.leave.title'), t('summaries:commitments.leave.body'), [
      { text: t('summaries:commitments.leave.stay'), style: 'cancel' },
      {
        text: t('summaries:commitments.leave.leave'),
        style: 'destructive',
        onPress: () => {
          leftRef.current = true;
          navigation.dispatch(event.action);
        },
      },
    ]);
  });

  // ---- Prepare ----------------------------------------------------------------------------------------

  const runPrepare = useCallback(
    async (mode: CommitmentMode): Promise<void> => {
      setNoticeOpen(false);
      setPrepareFailed(false);
      setPrepareStarted(true);
      setPreparingMode(mode);
      const answer = await prepare(mode);
      setPreparingMode(null);
      if (answer === null) setPrepareFailed(true);
      else if (answer.state === 'empty') setKnownEmpty((known) => (known[mode] ? known : { ...known, [mode]: true }));
    },
    [prepare],
  );

  /** Mode 'ai' only after this account saw the one-time AI notice (decision 17). */
  const requestMode = useCallback(
    (mode: CommitmentMode): void => {
      if (mode === 'ai' && notice.seen !== true) {
        setNoticeOpen(true);
        return;
      }
      void runPrepare(mode);
    },
    [notice.seen, runPrepare],
  );

  const continueNotice = useCallback(async (): Promise<void> => {
    await notice.markSeen();
    await runPrepare('ai');
  }, [notice, runPrepare]);

  const declineNotice = useCallback((): void => {
    setNoticeOpen(false);
    if (data?.mode !== 'as_written') void runPrepare('as_written');
  }, [data, runPrepare]);

  // Nothing prepared yet: the action items as written come first (free, no AI). Once only: a later
  // 'none' (another device's preparation failed) shows the start card with both buttons.
  useEffect(() => {
    if (phase !== 'none' || autoPreparedRef.current || busy !== null || error !== null) return;
    autoPreparedRef.current = true;
    void runPrepare('as_written');
  }, [phase, busy, error, runPrepare]);

  // ---- Selection and edits ---------------------------------------------------------------------------

  const updateSelection = useCallback(
    (change: (current: readonly string[]) => string[]): void => {
      if (data === null) return;
      const key = data.key;
      setSelections((previous) => {
        const stored = previous[key];
        const current = stored === undefined ? initialSelection(data, readOnly) : reconcileSelection(stored, data, readOnly);
        return { ...previous, [key]: change(current) };
      });
    },
    [data, readOnly],
  );

  const saveEdit = useCallback(
    (edit: CommitmentEdit | null): void => {
      if (data === null || editing === null) return;
      const key = data.key;
      const anchorId = editing;
      setEdits((previous) => {
        const forKey: Record<string, CommitmentEdit> = { ...(previous[key] ?? {}) };
        if (edit === null) delete forKey[anchorId];
        else forKey[anchorId] = edit;
        return { ...previous, [key]: forKey };
      });
      setEditing(null);
    },
    [data, editing],
  );

  const editTarget: CommitmentEditTarget | null = useMemo(() => {
    if (data === null || editing === null) return null;
    const item = data.items.find((candidate) => candidate.anchorId === editing);
    if (item === undefined || item.status !== 'open') return null;
    const edit = currentEdits[item.anchorId] ?? null;
    const zone = getDeviceTimeZone();
    const due = item.due;
    const meetingZone = due !== null && due.time !== null ? dueZone(due, zone) : zone;
    return {
      id: `${data.key}:${item.anchorId}`,
      suggestion: { title: item.title, owner: item.owner },
      edit,
      schedule: scheduleFor(item, edit, reminderDefault, new Date(), zone),
      dueNote:
        due !== null && due.time !== null && meetingZone !== zone
          ? t('summaries:commitments.due.meetingTime', { time: labels.time(due.time), zone: meetingZone })
          : null,
    };
  }, [data, editing, currentEdits, reminderDefault, labels, t]);

  // ---- Decide -----------------------------------------------------------------------------------------

  const runDecide = useCallback(
    async (decisions: CommitmentDecision[], drafts: Readonly<Record<string, CommitmentDraft>>, zone: string): Promise<void> => {
      if (data === null) return;
      const result = await decide(decisions, { key: data.key, timezone: zone });
      if (result.status === 'stale') {
        Toast.show({ type: 'info', text1: t('summaries:commitments.result.stale') });
        return;
      }
      if (result.status === 'failed') {
        // not_found closes the screen through its own state. A timeout may have been saved: the
        // message says so and the reloaded list shows it (never a plain "Try again").
        if (commitmentErrorReason(result.error) !== 'not_found') Toast.show({ type: 'error', text1: t(decideErrorKey(result.error)) });
        return;
      }
      const feedback = decideFeedback(result.results, drafts);
      if (feedback.changed) {
        Alert.alert(t('summaries:commitments.card.undo'), t('summaries:commitments.result.changed'), [
          { text: t('summaries:common.cancel'), style: 'cancel' },
          { text: t('summaries:commitments.card.openTask'), onPress: () => navigation.navigate('Tasks') },
        ]);
        return;
      }
      const [first, ...rest] = feedback.messages;
      if (first === undefined) return;
      Toast.show({ type: feedback.tone, text1: tr(first), text2: rest.length > 0 ? rest.map(tr).join(' ') : undefined });
    },
    [data, decide, navigation, t, tr],
  );

  const acceptAnchors = useCallback(
    async (anchors: readonly string[]): Promise<void> => {
      if (data === null || readOnly) return;
      const now = new Date();
      const zone = getDeviceTimeZone();
      const built = buildAcceptDecisions({ items: data.items, anchors, edits: currentEdits, choice: reminderDefault, now, deviceZone: zone });
      if (!built.ok) {
        if (built.reason === 'pastPick') setPastPick(true);
        else if (built.reason === 'invalid') Toast.show({ type: 'error', text1: t('summaries:commitments.errors.invalid_request') });
        return;
      }
      await runDecide(built.decisions, built.drafts, zone);
    },
    [data, readOnly, currentEdits, reminderDefault, runDecide, t],
  );

  const acceptSelected = useCallback(async (): Promise<void> => {
    setAccepting(true);
    try {
      await acceptAnchors(selection);
    } finally {
      setAccepting(false);
    }
  }, [acceptAnchors, selection]);

  const decideOne = useCallback(
    (item: CommitmentItem, decision: 'drop' | 'restore' | 'remove'): void => {
      void runDecide([{ anchorId: item.anchorId, decision }], {}, getDeviceTimeZone());
    },
    [runDecide],
  );

  // ---- Delete the summary, keep the tasks ---------------------------------------------------------------

  const deleteNow = useCallback(async (): Promise<void> => {
    deletingRef.current = true;
    setDeleting(true);
    try {
      await summariesService.deleteSummary(summaryId);
      Toast.show({ type: 'success', text1: t('summaries:commitments.keep.deleted') });
      leave();
    } catch (caught: unknown) {
      deletingRef.current = false;
      Toast.show({ type: 'error', text1: t(summaryErrorMessageKey(toAppError(caught))) });
    } finally {
      setDeleting(false);
    }
  }, [leave, summaryId, t]);

  const confirmDelete = useCallback((): void => {
    Alert.alert(
      t('summaries:commitments.keep.deleteTitle'),
      t('summaries:commitments.keep.deleteBody', { providerDays: SUMMARY_PROVIDER_RETENTION_DAYS }),
      [
        { text: t('summaries:common.cancel'), style: 'cancel' },
        {
          text: t('summaries:commitments.keep.deleteConfirm'),
          style: 'destructive',
          onPress: () => {
            void deleteNow();
          },
        },
      ],
      { cancelable: true },
    );
  }, [deleteNow, t]);

  // ---- Render ---------------------------------------------------------------------------------------------

  const muted = { color: colors.onSurfaceVariant };

  const noticeCard = (
    <Card accent="primary" style={styles.card} testID="commitments-notice">
      <Text variant="titleSmall" accessibilityRole="header">
        {t('summaries:commitments.notice.title')}
      </Text>
      <Text variant="bodyMedium" style={styles.line}>
        {t('summaries:commitments.notice.body')}
      </Text>
      <View style={styles.buttonRow}>
        <MGButton onPress={() => void continueNotice()} disabled={working} style={styles.rowButton} testID="commitments-notice-continue">
          {t('summaries:commitments.notice.continue')}
        </MGButton>
        <MGButton variant="ghost" onPress={declineNotice} disabled={working} style={styles.rowButton} testID="commitments-notice-as-written">
          {t('summaries:commitments.notice.asWritten')}
        </MGButton>
      </View>
    </Card>
  );

  const quota = quotaLines(error, (iso) => fmt.dateTime(iso));
  const quotaCard =
    quota !== null ? (
      <Card style={styles.card} testID="commitments-quota">
        <Text variant="titleSmall" accessibilityRole="header">
          {t('summaries:commitments.quota.title')}
        </Text>
        {quota.map((line) => (
          <Text key={line.key} variant="bodyMedium" style={styles.line}>
            {tr(line)}
          </Text>
        ))}
        <View style={styles.buttonRow}>
          <MGButton variant="tonal" icon="star-outline" onPress={() => navigation.navigate('Pricing')} style={styles.rowButton} testID="commitments-quota-plans">
            {t('summaries:commitments.quota.plans')}
          </MGButton>
          {data?.mode !== 'as_written' ? (
            <MGButton
              variant="ghost"
              onPress={() => void runPrepare('as_written')}
              disabled={working}
              style={styles.rowButton}
              testID="commitments-quota-as-written"
            >
              {t('summaries:commitments.quota.asWritten')}
            </MGButton>
          ) : null}
        </View>
      </Card>
    ) : null;

  const prepareError =
    prepareFailed && error !== null && quota === null ? (
      <IconLine icon="alert-circle-outline" iconColor={colors.error} text={t(commitmentErrorMessageKey(error))} testID="commitments-prepare-error" />
    ) : null;

  function renderList(): ReactElement {
    if (data === null) return <LoadingState />;
    const now = new Date();
    const zone = getDeviceTimeZone();
    const origin = originText(data, labels.date);
    const otherMode: CommitmentMode = data.mode === 'ai' ? 'as_written' : 'ai';
    // Both lists found nothing: no switch back and forth.
    const showSwitch = !(phase === 'empty' && knownEmpty[otherMode] === true);
    const banners = bannerRefs(data);
    const visible = data.items.filter((item) => item.status !== 'dropped');
    const dropped = data.items.filter((item) => item.status === 'dropped');
    const group = reminderGroupRef(data, selection, currentEdits, reminderDefault, labels);
    const pickPast = pastPick || isPickedDefaultPast(reminderDefault, now, zone);
    const keptUntil = summaryKeptUntil(summary?.receivedAt);
    const anyAccepted = data.items.some((item) => item.status === 'accepted');
    const chosen = new Set(selection);

    const renderCard = (item: CommitmentItem): ReactElement => {
      const view = commitmentCardView({ item, edit: currentEdits[item.anchorId], choice: reminderDefault, now, deviceZone: zone, labels });
      const actions: CommitmentCardAction[] = [];
      if (!readOnly) {
        switch (view.status) {
          case 'open':
            actions.push(
              { id: 'edit', label: t('summaries:commitments.card.edit'), icon: 'pencil-outline', onPress: () => setEditing(item.anchorId) },
              { id: 'drop', label: t('summaries:commitments.card.drop'), icon: 'close', onPress: () => decideOne(item, 'drop') },
            );
            break;
          case 'accepted':
            actions.push(
              { id: 'open-task', label: t('summaries:commitments.card.openTask'), icon: 'open-in-app', onPress: () => navigation.navigate('Tasks') },
              { id: 'undo', label: t('summaries:commitments.card.undo'), icon: 'undo', onPress: () => decideOne(item, 'remove') },
            );
            break;
          case 'removed':
            actions.push({
              id: 'add-again',
              label: t('summaries:commitments.card.addAgain'),
              icon: 'plus',
              variant: 'tonal',
              onPress: () => void acceptAnchors([item.anchorId]),
            });
            break;
          case 'dropped':
            actions.push({ id: 'restore', label: t('summaries:commitments.card.restore'), icon: 'restore', onPress: () => decideOne(item, 'restore') });
            break;
        }
      }
      const statusLabel = view.status !== 'open' ? CARD_STATUS[view.status] : null;
      const notes: string[] = [];
      if (view.edited) notes.push(t('summaries:commitments.card.edited'));
      if (readOnly) notes.push(t('summaries:commitments.card.readOnly'));
      return (
        <CommitmentCard
          key={item.anchorId}
          id={item.anchorId}
          title={view.title}
          quoteLabel={t('summaries:commitments.card.fromSummary')}
          quote={view.quote}
          owner={tr(view.owner)}
          ownerNote={view.ownerNote !== null ? tr(view.ownerNote) : null}
          due={view.due.map(tr)}
          section={view.section !== null ? tr(view.section) : null}
          chips={view.chips.map((chip) => ({ label: tr(chip.label), tone: chip.tone }))}
          reason={view.reason !== null ? tr(view.reason) : null}
          notes={notes}
          status={statusLabel !== null ? { label: t(statusLabel.key), tone: statusLabel.tone, detail: view.via !== null ? tr(view.via) : null } : null}
          selection={
            view.status === 'open' && !readOnly
              ? {
                  selected: chosen.has(item.anchorId),
                  onToggle: () => updateSelection((current) => toggleSelection(current, item.anchorId)),
                  accessibilityLabel: t('summaries:commitments.card.selectA11y', { title: view.title }),
                }
              : null
          }
          actions={actions}
          disabled={working}
        />
      );
    };

    return (
      <>
        <OriginBlock source={tr(origin.source)} notes={origin.notes.map(tr)} />

        {noticeOpen ? (
          noticeCard
        ) : (
          <View style={styles.modeRow} testID="commitments-mode-row">
            <Badge
              label={t(data.mode === 'ai' ? 'summaries:commitments.mode.ai' : 'summaries:commitments.mode.as_written')}
              tone={data.mode === 'ai' ? 'primary' : 'neutral'}
              testID="commitments-mode"
            />
            {preparingMode !== null ? (
              <View style={[styles.loadingRow, styles.line]} testID="commitments-switching">
                <ActivityIndicator size="small" />
                <Text variant="bodySmall" style={[styles.flex, muted]}>
                  {t(preparingMode === 'ai' ? 'summaries:commitments.loading.ai' : 'summaries:commitments.loading.asWritten')}
                </Text>
              </View>
            ) : showSwitch ? (
              <View style={styles.line}>
                <MGButton
                  variant={otherMode === 'ai' ? 'tonal' : 'outline'}
                  size="sm"
                  icon={otherMode === 'ai' ? 'text-box-search-outline' : 'format-list-bulleted'}
                  onPress={() => requestMode(otherMode)}
                  disabled={working}
                  style={styles.switchButton}
                  testID="commitments-switch-mode"
                >
                  {t(otherMode === 'ai' ? 'summaries:commitments.mode.switchToAi' : 'summaries:commitments.mode.switchToAsWritten')}
                </MGButton>
                <Text variant="bodySmall" style={[styles.line, muted]}>
                  {t(otherMode === 'ai' ? 'summaries:commitments.mode.aiCost' : 'summaries:commitments.mode.asWrittenFree')}
                </Text>
              </View>
            ) : null}
            {prepareError}
          </View>
        )}

        {quotaCard}

        {readOnly ? (
          <Card style={styles.card} testID="commitments-stale-list">
            <IconLine icon="history" iconColor={colors.warning} text={t('summaries:commitments.stale.readOnly')} variant="bodyMedium" />
            <Text variant="bodySmall" style={[styles.line, muted]}>
              {t('summaries:commitments.stale.free')}
            </Text>
            <MGButton
              variant="tonal"
              icon="refresh"
              onPress={() => requestMode(data.mode)}
              disabled={working}
              style={styles.topButton}
              testID="commitments-stale-prepare"
            >
              {t('summaries:commitments.stale.action')}
            </MGButton>
          </Card>
        ) : null}

        {banners.map((banner) => (
          <IconLine
            key={banner.key}
            icon="alert-outline"
            iconColor={colors.warning}
            text={tr(banner)}
            testID={`commitments-banner-${banner.key.split('.').pop() ?? 'notice'}`}
          />
        ))}

        {phase === 'empty' ? (
          <EmptyState
            icon="clipboard-text-search-outline"
            title={t('summaries:commitments.empty.title')}
            body={t(data.mode === 'ai' ? 'summaries:commitments.empty.ai' : 'summaries:commitments.empty.asWritten')}
            testID="commitments-empty"
          />
        ) : (
          <>
            <Text variant="labelLarge" style={[styles.header, muted]} testID="commitments-header">
              {headerRefs(data).map(tr).join(' · ')}
            </Text>

            {!readOnly && needsReminderDefault(data) ? (
              <ReminderDefaultPicker
                title={t('summaries:commitments.reminder.title')}
                hint={t('summaries:commitments.reminder.yourChoice')}
                options={[
                  { kind: 'tomorrow', label: tr(reminderChoiceRef({ kind: 'tomorrow' }, labels)) },
                  { kind: 'dayAfter', label: tr(reminderChoiceRef({ kind: 'dayAfter' }, labels)) },
                  { kind: 'nextMonday', label: tr(reminderChoiceRef({ kind: 'nextMonday' }, labels)) },
                  { kind: 'none', label: t('summaries:commitments.reminder.choice.none') },
                ]}
                pickLabel={reminderDefault.kind === 'picked' ? tr(reminderChoiceRef(reminderDefault, labels)) : t('summaries:commitments.reminder.choice.pick')}
                value={reminderDefault}
                onChange={(next) => {
                  setReminderDefault(next);
                  setPastPick(false);
                }}
                notice={group !== null ? tr(group) : null}
                noticeHint={group !== null ? t('summaries:commitments.reminder.groupHint') : null}
                error={pickPast ? t('summaries:commitments.reminder.pastPick') : null}
                doneLabel={t('tasks:editor.pickerDone')}
                cancelLabel={t('summaries:common.cancel')}
                disabled={working}
                now={now}
              />
            ) : null}

            {visible.map(renderCard)}

            {dropped.length > 0 ? (
              <View style={styles.droppedRow} testID="commitments-dropped">
                <Text variant="labelLarge" style={[styles.flex, muted]}>
                  {t('summaries:commitments.dropped.title', { count: dropped.length })}
                </Text>
                <MGButton variant="ghost" size="sm" onPress={() => setShowDropped((shown) => !shown)} testID="commitments-dropped-toggle">
                  {t(showDropped ? 'summaries:commitments.dropped.hide' : 'summaries:commitments.dropped.show')}
                </MGButton>
              </View>
            ) : null}
            {showDropped ? dropped.map(renderCard) : null}
          </>
        )}

        <View style={[styles.keep, { borderTopColor: colors.outlineVariant }]} testID="commitments-keep">
          {keptUntil !== null ? (
            <Text variant="bodySmall" style={muted} testID="commitments-kept-until">
              {t('summaries:commitments.keep.until', { date: fmt.date(keptUntil, 'medium') })}
            </Text>
          ) : null}
          <View style={styles.buttonRow}>
            <MGButton
              variant="ghost"
              size="sm"
              icon="shield-lock-outline"
              onPress={() => navigation.navigate('SummaryConnect')}
              style={styles.rowButton}
              testID="commitments-retention-link"
            >
              {t('summaries:commitments.keep.rules')}
            </MGButton>
            {anyAccepted ? (
              <MGButton
                variant="destructive"
                size="sm"
                icon="delete-outline"
                onPress={confirmDelete}
                loading={deleting}
                disabled={working}
                style={styles.rowButton}
                testID="commitments-delete"
              >
                {t('summaries:commitments.keep.deleteKeepTasks')}
              </MGButton>
            ) : null}
          </View>
        </View>
      </>
    );
  }

  let content: ReactElement;
  switch (phase) {
    case 'loading':
      content = <LoadingState testID="commitments-loading" />;
      break;
    case 'statusError':
      content = (
        <ErrorState
          body={t(statusError !== null ? summaryErrorMessageKey(statusError) : 'summaries:errors.generic')}
          onRetry={() => void refreshStatus()}
          testID="commitments-error"
        />
      );
      break;
    case 'unavailable':
      content = (
        <EmptyState
          icon="email-off-outline"
          title={t('summaries:common.unavailable.title')}
          body={t('summaries:common.unavailable.body')}
          testID="commitments-unavailable"
        />
      );
      break;
    case 'gone':
      content = (
        <EmptyState icon="email-remove-outline" title={t('summaries:view.notFound')} body={t('summaries:view.notFoundBody')} testID="commitments-gone" />
      );
      break;
    case 'notFiled':
      content = (
        <EmptyState icon="inbox-arrow-down" title={t('summaries:commitments.title')} body={t('summaries:commitments.errors.notFiled')} testID="commitments-not-filed" />
      );
      break;
    case 'error':
      content = (
        <ErrorState
          body={t(error !== null ? commitmentErrorMessageKey(error) : 'summaries:commitments.errors.generic')}
          onRetry={() => void refresh()}
          testID="commitments-error"
        />
      );
      break;
    case 'preparingSelf':
      content = (
        <LoadingLine
          text={t(preparingMode === 'ai' ? 'summaries:commitments.loading.ai' : 'summaries:commitments.loading.asWritten')}
          testID="commitments-preparing-self"
        />
      );
      break;
    case 'none':
      content =
        preparingMode !== null || (!prepareStarted && error === null) ? (
          <LoadingLine
            text={t(preparingMode === 'ai' ? 'summaries:commitments.loading.ai' : 'summaries:commitments.loading.asWritten')}
            testID="commitments-preparing-self"
          />
        ) : noticeOpen ? (
          noticeCard
        ) : (
          <Card style={styles.card} testID="commitments-start">
            <Text variant="titleSmall" accessibilityRole="header">
              {t('summaries:commitments.start.title')}
            </Text>
            <Text variant="bodyMedium" style={styles.line}>
              {t('summaries:commitments.start.body')}
            </Text>
            {prepareError}
            <View style={styles.buttonRow}>
              <MGButton onPress={() => void runPrepare('as_written')} disabled={working} style={styles.rowButton} testID="commitments-start-as-written">
                {t('summaries:commitments.start.asWritten')}
              </MGButton>
              <MGButton variant="tonal" onPress={() => requestMode('ai')} disabled={working} style={styles.rowButton} testID="commitments-start-ai">
                {t('summaries:commitments.start.ai')}
              </MGButton>
            </View>
            <Text variant="bodySmall" style={[styles.line, muted]} testID="commitments-start-costs">
              {t('summaries:commitments.start.costs')}
            </Text>
          </Card>
        );
      break;
    case 'preparing':
      content = (
        <Card style={styles.card} testID="commitments-preparing">
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" />
            <Text variant="titleSmall" style={styles.flex}>
              {t('summaries:commitments.preparing.title')}
            </Text>
          </View>
          <Text variant="bodyMedium" style={styles.line}>
            {t('summaries:commitments.preparing.body')}
          </Text>
          {error !== null ? (
            <>
              {isStillPreparingError(error) ? (
                <Text variant="bodySmall" style={[styles.line, muted]} testID="commitments-preparing-slow">
                  {t('summaries:commitments.preparing.slow')}
                </Text>
              ) : (
                <IconLine icon="alert-circle-outline" iconColor={colors.error} text={t(commitmentErrorMessageKey(error))} testID="commitments-preparing-error" />
              )}
              <MGButton variant="tonal" onPress={() => void refresh()} style={styles.topButton} testID="commitments-preparing-retry">
                {t('summaries:commitments.errors.retry')}
              </MGButton>
            </>
          ) : null}
        </Card>
      );
      break;
    case 'quota':
      content = quotaCard ?? <LoadingState />;
      break;
    case 'staleNoList': {
      const againMode = prepareAgainMode(lastMode);
      content = noticeOpen ? (
        noticeCard
      ) : (
        <>
          <Card style={styles.card} testID="commitments-stale">
            <Text variant="titleSmall" accessibilityRole="header">
              {t('summaries:commitments.stale.title')}
            </Text>
            <Text variant="bodyMedium" style={styles.line}>
              {t('summaries:commitments.stale.body')}
            </Text>
            <Text variant="bodySmall" style={[styles.line, muted]}>
              {t('summaries:commitments.stale.free')}
            </Text>
            {prepareError}
            <View style={styles.buttonRow}>
              <MGButton
                variant="tonal"
                icon="refresh"
                onPress={() => requestMode(againMode)}
                disabled={working}
                style={styles.rowButton}
                testID="commitments-stale-prepare"
              >
                {t('summaries:commitments.stale.action')}
              </MGButton>
              {/* The free list is always one tap away (decision 8); the quota card carries its own. */}
              {againMode === 'ai' && quota === null ? (
                <MGButton
                  variant="ghost"
                  onPress={() => void runPrepare('as_written')}
                  disabled={working}
                  style={styles.rowButton}
                  testID="commitments-stale-as-written"
                >
                  {t('summaries:commitments.mode.switchToAsWritten')}
                </MGButton>
              ) : null}
            </View>
          </Card>
          {quotaCard}
        </>
      );
      break;
    }
    case 'empty':
    case 'list':
      content = renderList();
      break;
  }

  const footer = phase === 'list' && data !== null && !readOnly ? commitmentsFooter({ commitments: data, selection, offline: !online }) : null;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: footer !== null ? spacing.xxl : insets.bottom + spacing.xxl }]}
        keyboardShouldPersistTaps="handled"
        testID="commitments-scroll"
      >
        {content}
      </ScrollView>
      {footer !== null && data !== null ? (
        <View
          style={[styles.footer, { paddingBottom: insets.bottom + spacing.md, borderTopColor: colors.outlineVariant, backgroundColor: colors.background }]}
          testID="commitments-footer"
        >
          {footer.hint !== null ? (
            <Text variant="bodySmall" style={[styles.footerHint, muted]} accessibilityLiveRegion="polite" testID="commitments-footer-hint">
              {tr(footer.hint)}
            </Text>
          ) : null}
          <View style={styles.footerRow}>
            {footer.showSelectAll ? (
              <MGButton
                variant="ghost"
                size="sm"
                onPress={() => updateSelection((current) => [...new Set([...current, ...selectAllAnchors(data)])])}
                disabled={working}
                testID="commitments-select-all"
              >
                {t('summaries:commitments.footer.selectAll')}
              </MGButton>
            ) : footer.showClear ? (
              <MGButton variant="ghost" size="sm" onPress={() => updateSelection(() => [])} disabled={working} testID="commitments-clear-selection">
                {t('summaries:commitments.footer.clearSelection')}
              </MGButton>
            ) : null}
            <MGButton
              onPress={() => void acceptSelected()}
              disabled={!footer.enabled || working}
              loading={accepting}
              style={styles.footerPrimary}
              testID="commitments-accept"
            >
              {accepting ? t('summaries:commitments.footer.adding') : tr(footer.label)}
            </MGButton>
          </View>
        </View>
      ) : null}
      <CommitmentEditSheet target={editTarget} formatDate={labels.date} formatTime={labels.time} onCancel={() => setEditing(null)} onSave={saveEdit} />
    </View>
  );
}

/** A spinner with the line that says what is happening. */
function LoadingLine({ text, testID }: { text: string; testID?: string }): ReactElement {
  const { colors } = useAppTheme();
  return (
    <View style={styles.loadingBlock} testID={testID}>
      <ActivityIndicator size="large" />
      <Text variant="bodyMedium" style={[styles.loadingText, { color: colors.onSurfaceVariant }]}>
        {text}
      </Text>
    </View>
  );
}

/** A short line with a leading meta icon (banners, notices). */
function IconLine({
  icon,
  iconColor,
  text,
  variant = 'bodySmall',
  testID,
}: {
  icon: IconName;
  iconColor: string;
  text: string;
  variant?: 'bodySmall' | 'bodyMedium';
  testID?: string;
}): ReactElement {
  const { colors } = useAppTheme();
  return (
    <View style={styles.iconLine}>
      <MaterialCommunityIcons
        name={icon}
        size={componentMetrics.iconMeta}
        color={iconColor}
        style={styles.iconLineIcon}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
      <Text variant={variant} style={[styles.flex, variant === 'bodySmall' ? { color: colors.onSurfaceVariant } : null]} testID={testID}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  body: {
    paddingHorizontal: componentMetrics.screenGutter,
    paddingTop: spacing.md,
  },
  flex: {
    flex: 1,
  },
  card: {
    marginTop: spacing.md,
  },
  line: {
    marginTop: spacing.xs,
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.md,
  },
  rowButton: {
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
  },
  topButton: {
    alignSelf: 'flex-start',
    marginTop: spacing.md,
  },
  modeRow: {
    marginTop: spacing.md,
  },
  switchButton: {
    alignSelf: 'flex-start',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  loadingBlock: {
    alignItems: 'center',
    paddingVertical: spacing.huge,
    paddingHorizontal: spacing.lg,
  },
  loadingText: {
    marginTop: spacing.lg,
    textAlign: 'center',
  },
  header: {
    marginTop: spacing.lg,
  },
  iconLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  iconLineIcon: {
    marginTop: 2,
  },
  droppedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  keep: {
    marginTop: spacing.xl,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footer: {
    paddingHorizontal: componentMetrics.screenGutter,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerHint: {
    marginBottom: spacing.sm,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  footerPrimary: {
    flexGrow: 1,
  },
});
