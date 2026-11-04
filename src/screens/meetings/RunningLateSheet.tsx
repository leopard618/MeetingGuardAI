/**
 * Running late sheet (V2 Stage 2, M9; docs/v1/ARCHITECTURE.md section 33).
 *
 * ONE sheet for every entry point (dashboard card, meeting details, the MAX alarm and the MEDIUM
 * banner): `openRunningLate(target)` sets a tiny module store and `RunningLateHost`, rendered
 * once in AppRoot next to AlertHost, shows the sheet inside a Portal for the live meeting
 * (`useMeeting`, so an edit arriving meanwhile is seen). Steps:
 *   1. compose: pick 5 / 10 / 15 / 30 minutes; the message (UI language, title, new time) is
 *      prefilled and editable; "Share message" opens the OS share sheet, "Email participants"
 *      the mail composer with the participants as recipients.
 *   2. move: what the phone reported (confirmed on iOS, handed over elsewhere; a dismissed sheet
 *      sends nothing and stays on step 1) and the SEPARATE question "Move the meeting to
 *      <time>?": Move (origin 'user'; one occurrence only for a series) or Keep the time.
 * "Just move the meeting" skips the message for the case where people were already told.
 */
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactElement } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import { Chip, HelperText, Modal, Portal, Text, TextInput, useTheme as usePaperTheme } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import { MGButton, SheetHandle } from '../../components/ui';
import { errorMessageKey, toAppError } from '../../core/errors';
import { createLogger } from '../../core/logger';
import { useWindowInsets } from '../../hooks/useWindowInsets';
import { useT } from '../../i18n';
import { buildMailtoUrl } from '../../services/ai/presentation';
import { reactNativeShareAdapter } from '../../services/ai/shareAdapter';
import { useMeeting } from '../../services/data';
import { radii, spacing } from '../../theme';
import { capitalizeFirst } from '../shared/text';
import { useFormatters } from '../shared/useFormatters';
import type { DisplayMeeting } from './occurrences';
import {
  RUNNING_LATE_DELAYS,
  buildRunningLateMessage,
  newTimeText,
  participantNames,
  resolveRunningLateMeeting,
  runningLateMove,
  runningLateNewStart,
  shareOutcome,
  type RunningLateShareOutcome,
  type RunningLateTarget,
} from './runningLate';
import { applyScopedWrite } from './scopedWrite';

const log = createLogger('meetings');
const MESSAGE_MAX_CHARS = 1000;

// ---- store ------------------------------------------------------------------------------------

type Listener = () => void;
let currentTarget: RunningLateTarget | null = null;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Opens the sheet for a meeting (dashboard row, details master, or the alert's occurrence). */
export function openRunningLate(target: RunningLateTarget): void {
  currentTarget = target;
  notify();
}

export function closeRunningLate(): void {
  if (currentTarget === null) return;
  currentTarget = null;
  notify();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function useRunningLateTarget(): RunningLateTarget | null {
  return useSyncExternalStore(subscribe, () => currentTarget, () => currentTarget);
}

// ---- host -------------------------------------------------------------------------------------

/** Takes no props. Render once inside PaperProvider (AppRoot, next to AlertHost). */
export function RunningLateHost(): ReactElement {
  const target = useRunningLateTarget();
  return (
    <Portal>
      {target ? <Loader key={`${target.meetingId}:${target.startAt ?? 'next'}`} target={target} onDismiss={closeRunningLate} /> : null}
    </Portal>
  );
}

function Loader({ target, onDismiss }: { target: RunningLateTarget; onDismiss(): void }): ReactElement | null {
  const t = useT();
  const { meeting: master, isLoading } = useMeeting(target.meetingId);
  // Resolved once per opening (the key above): the row the user acted on, not whatever the
  // meeting becomes after the move itself.
  const [openedAt] = useState(() => new Date());
  const meeting = useMemo(() => (master ? resolveRunningLateMeeting(master, target.startAt, openedAt) : null), [master, target.startAt, openedAt]);
  const gone = !isLoading && meeting === null;
  useEffect(() => {
    if (!gone) return;
    Toast.show({ type: 'info', text1: t('meetings:runningLate.unavailable') });
    onDismiss();
  }, [gone, onDismiss, t]);
  if (!meeting) return null;
  return <RunningLateSheet meeting={meeting} onDismiss={onDismiss} />;
}

// ---- sheet ------------------------------------------------------------------------------------

type Step = 'compose' | 'move';

export interface RunningLateSheetProps {
  meeting: DisplayMeeting;
  onDismiss(): void;
}

export function RunningLateSheet({ meeting, onDismiss }: RunningLateSheetProps): ReactElement {
  const t = useT();
  const theme = usePaperTheme();
  const fmt = useFormatters();
  const insets = useWindowInsets();
  const [step, setStep] = useState<Step>('compose');
  const [minutes, setMinutes] = useState<number | null>(null);
  const [newStartAt, setNewStartAt] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<RunningLateShareOutcome | null>(null);
  const names = participantNames(meeting);
  const recipients = meeting.participants.map((participant) => participant.email);
  const isSeries = meeting.occurrence !== undefined && meeting.recurrence !== null;
  const isDevice = meeting.source === 'device';
  const isGoogle = meeting.source === 'google' || meeting.external.googleEventId !== null;
  const isOutlook = meeting.source === 'outlook' || meeting.external.outlookEventId !== null;
  const now = new Date();
  const timeText = newStartAt !== null ? newTimeText(fmt, newStartAt, now) : '';

  const pick = (delay: number): void => {
    const at = new Date();
    const start = runningLateNewStart(meeting.startAt, delay, at);
    setMinutes(delay);
    setNewStartAt(start);
    // A new delay rewrites the message: the delay and the time inside it would be wrong otherwise.
    setMessage(buildRunningLateMessage(t, fmt, meeting, delay, start, at));
  };

  const shareTitle = t('meetings:runningLate.shareTitle', { title: meeting.title, interpolation: { escapeValue: false } });
  const text = message.trim();

  const share = async (): Promise<void> => {
    if (text === '') return;
    setBusy(true);
    try {
      const result = await reactNativeShareAdapter.shareText({ title: shareTitle, message: text });
      const reported = shareOutcome(result, Platform.OS);
      if (reported === 'dismissed') {
        Toast.show({ type: 'info', text1: t('meetings:runningLate.nothingSent') });
        return;
      }
      setOutcome(reported);
      setStep('move');
    } catch (caught) {
      log.warn('could not open the share sheet', toAppError(caught).code);
      Toast.show({ type: 'error', text1: t('meetings:runningLate.shareFailed') });
    } finally {
      setBusy(false);
    }
  };

  const email = async (): Promise<void> => {
    if (text === '' || recipients.length === 0) return;
    setBusy(true);
    try {
      await Linking.openURL(buildMailtoUrl(recipients, { subject: shareTitle, body: text }));
      // The composer never reports back: handed over is all the app knows.
      setOutcome('handed_over');
      setStep('move');
    } catch (caught) {
      log.warn('could not open the mail composer', toAppError(caught).code);
      Toast.show({ type: 'error', text1: t('meetings:runningLate.mailFailed') });
    } finally {
      setBusy(false);
    }
  };

  const move = async (): Promise<void> => {
    if (newStartAt === null) return;
    setBusy(true);
    try {
      await applyScopedWrite(runningLateMove(meeting, newStartAt));
      Toast.show({ type: 'success', text1: t('meetings:runningLate.moved', { time: timeText }) });
      onDismiss();
    } catch (caught) {
      const error = toAppError(caught);
      log.warn('could not move a meeting (running late)', error.code);
      Toast.show({ type: 'error', text1: t(errorMessageKey(error.code)) });
      setBusy(false);
    }
  };

  const moveNotes = [
    isSeries ? t('meetings:runningLate.moveNoteSeries') : t('meetings:runningLate.moveNote'),
    isDevice ? t('meetings:runningLate.moveNoteDevice') : isGoogle ? t('meetings:runningLate.moveNoteGoogle') : isOutlook ? t('meetings:runningLate.moveNoteOutlook') : null,
  ].filter((note): note is string => note !== null);

  return (
    <Modal
      visible
      onDismiss={busy ? undefined : onDismiss}
      style={styles.modal}
      contentContainerStyle={[styles.sheet, { backgroundColor: theme.colors.elevation.level3, paddingBottom: insets.bottom + spacing.lg }]}
    >
      <View testID="running-late-sheet">
        <SheetHandle />
        <Text variant="titleMedium" accessibilityRole="header" style={styles.heading}>
          {t('meetings:runningLate.title')}
        </Text>
        <Text variant="bodySmall" style={[styles.subheading, { color: theme.colors.onSurfaceVariant }]} numberOfLines={2} testID="running-late-meeting">
          {`${meeting.title} · ${capitalizeFirst(fmt.meetingRange(meeting))}`}
        </Text>

        {step === 'compose' ? (
          <View>
            <Text variant="titleSmall" style={[styles.label, { color: theme.colors.onSurfaceVariant }]}>
              {t('meetings:runningLate.howLate')}
            </Text>
            <View style={styles.chips}>
              {RUNNING_LATE_DELAYS.map((delay) => (
                <Chip
                  key={delay}
                  selected={minutes === delay}
                  mode={minutes === delay ? 'flat' : 'outlined'}
                  style={styles.chip}
                  onPress={() => pick(delay)}
                  disabled={busy}
                  testID={`running-late-delay-${delay}`}
                >
                  {t('meetings:runningLate.delay', { count: delay })}
                </Chip>
              ))}
            </View>
            {newStartAt !== null ? (
              <View>
                <Text variant="bodyMedium" style={styles.newTime} testID="running-late-new-time">
                  {t('meetings:runningLate.newTime', { time: timeText })}
                </Text>
                <TextInput
                  mode="outlined"
                  label={t('meetings:runningLate.messageLabel')}
                  value={message}
                  onChangeText={setMessage}
                  multiline
                  maxLength={MESSAGE_MAX_CHARS}
                  outlineStyle={styles.inputOutline}
                  style={styles.message}
                  disabled={busy}
                  testID="running-late-message"
                />
                <HelperText type="info" visible style={styles.helper}>
                  {names.length > 0
                    ? `${t('meetings:runningLate.shareHint')} ${t('meetings:runningLate.participantsHint', { names: names.join(', '), interpolation: { escapeValue: false } })}`
                    : t('meetings:runningLate.shareHint')}
                </HelperText>
                <MGButton icon="share-variant" onPress={() => void share()} loading={busy} disabled={busy || text === ''} style={styles.primary} testID="running-late-share">
                  {t('meetings:runningLate.share')}
                </MGButton>
                {recipients.length > 0 ? (
                  <MGButton variant="outline" icon="email-outline" onPress={() => void email()} disabled={busy || text === ''} style={styles.secondary} testID="running-late-email">
                    {t('meetings:runningLate.emailParticipants')}
                  </MGButton>
                ) : null}
              </View>
            ) : null}
            <View style={styles.footer}>
              <MGButton variant="ghost" onPress={onDismiss} disabled={busy} testID="running-late-cancel">
                {t('common:actions.cancel')}
              </MGButton>
              {newStartAt !== null ? (
                <MGButton variant="ghost" onPress={() => setStep('move')} disabled={busy} testID="running-late-just-move">
                  {t('meetings:runningLate.justMove')}
                </MGButton>
              ) : null}
            </View>
          </View>
        ) : (
          <View>
            {outcome !== null ? (
              <Text variant="bodyMedium" style={styles.outcome} testID={`running-late-outcome-${outcome}`}>
                {outcome === 'confirmed' ? t('meetings:runningLate.outcomeConfirmed') : t('meetings:runningLate.outcomeHandedOver')}
              </Text>
            ) : null}
            <Text variant="titleSmall" style={styles.question} testID="running-late-move-question">
              {t('meetings:runningLate.moveQuestion', { time: timeText })}
            </Text>
            {moveNotes.map((note) => (
              <Text key={note} variant="bodySmall" style={[styles.note, { color: theme.colors.onSurfaceVariant }]}>
                {note}
              </Text>
            ))}
            <View style={styles.footer}>
              <MGButton variant="ghost" onPress={onDismiss} disabled={busy} testID="running-late-keep">
                {t('meetings:runningLate.keepTime')}
              </MGButton>
              <MGButton onPress={() => void move()} loading={busy} disabled={busy} testID="running-late-move">
                {t('meetings:runningLate.move', { time: timeText })}
              </MGButton>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modal: {
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    paddingTop: spacing.xs,
    paddingHorizontal: spacing.lg,
  },
  heading: {
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },
  subheading: {
    marginBottom: spacing.md,
  },
  label: {
    marginBottom: spacing.xs,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  chip: {
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
  },
  newTime: {
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  message: {
    minHeight: 96,
  },
  inputOutline: {
    borderRadius: radii.md,
  },
  helper: {
    paddingHorizontal: 0,
  },
  primary: {
    marginTop: spacing.sm,
  },
  secondary: {
    marginTop: spacing.sm,
  },
  outcome: {
    marginBottom: spacing.md,
  },
  question: {
    marginBottom: spacing.xs,
  },
  note: {
    marginTop: spacing.xs,
  },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    marginTop: spacing.md,
    gap: spacing.sm,
  },
});
