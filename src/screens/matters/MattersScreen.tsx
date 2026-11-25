/**
 * AI executive assistant, prototype (route "Matters", from Settings; A1 to A3 of the November 10
 * plan, docs/v1/ARCHITECTURE.md section 36). Shown only when EXPO_PUBLIC_MATTERS_ENABLED; the full
 * screens and settings come in A5.
 *
 * A3, voice: the matter can be dictated (source 'voice'); the questions or the read-back are then
 * said aloud, and a spoken "yes" confirms exactly like the button (assistant/voiceModel.ts
 * voiceCommand: whole short answers only, anything else is never a yes). Under the open matters,
 * AskPanel.tsx answers questions and confirms actions by voice or text.
 *
 * open:    A2: under the new-matter box, the open matters (active and paused); a tap opens the
 *          matter page (MatterPage.tsx: the cards waiting for the owner and the proposed tasks)
 * compose: the user's words -> matterDraft
 * draft:   the questions (answer -> matterRevise), or the read-back of the mandate and the first
 *          email exactly as it will be sent; "Confirm and send" sends the draft's hash
 *          (matterConfirm), "Change the draft" -> matterRevise, "Cancel this matter" -> matterCancel
 * done:    sent / sending (another call is sending it: "check again" = the same confirm, which never
 *          sends twice) / not sent (refused: retry = the same confirm) / unknown (no clear answer:
 *          it may have gone out, so no retry; the copy sentence only with a copy and not after a
 *          406) / cancelled; until cancelled, the matter can still be cancelled from here
 * A4 part 2, the owner's Microsoft mailbox: under the usage meter, "Connect your mailbox" (the
 * server's Microsoft sign-in in the system browser; the status is asked again when it comes back)
 * or the connected address with "Disconnect" (asks first). A draft shows "Send from my mailbox"
 * while one is connected; switching it redrafts the read-back and the first email (new hash).
 * "Watch this thread": the emails the owner forwarded from that mailbox wait under the mailbox
 * section; tapping one drafts the answer (the usual draft, with their email shown above it);
 * tapped again ("Draft ready") it opens that same draft; the close button removes one (asks
 * first). Nothing is sent until the owner confirms.
 * Every string lives in the "matters" namespace (EN + ES). Nothing typed is logged.
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { IconButton, Switch, Text, TextInput } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import { Banner, ListGroup, ListRow, MGButton } from '../../components/ui';
import type {
  MatterConfirmResponse,
  MatterDraftResponse,
  MatterMailboxResponse,
  MatterSendOutcome,
  MatterUsageResponse,
  MatterWatchItem,
  MatterWatchResponse,
} from '../../core/aiContract';
import { toAppError } from '../../core/errors';
import { getDeviceTimeZone } from '../../core/time';
import { toBaseLanguage } from '../../core/types';
import { useLanguage, useT } from '../../i18n';
import { matterService, openMailboxSignIn, type MatterOpenItem } from '../../services/matters';
import { spacing, useAppTheme } from '../../theme';
import { voiceCommand } from '../assistant/voiceModel';
import { ScreenBody, Section } from '../shared/Section';
import { AskPanel } from './AskPanel';
import { MatterPage } from './MatterPage';
import { matterErrorKey } from './matterErrors';
import { useMatterVoice } from './useMatterVoice';

export { matterErrorKey };


type Busy = 'prepare' | 'answer' | 'confirm' | 'cancel' | 'mailbox' | 'watch' | null;
type Done = { kind: 'sent' } | { kind: 'sending' } | { kind: 'not_sent' } | { kind: 'unknown'; inactiveRecipient: boolean } | { kind: 'cancelled' };

function doneFor(result: MatterConfirmResponse): Done {
  const kinds: Readonly<Record<MatterSendOutcome, Done>> = {
    sent: { kind: 'sent' },
    sending: { kind: 'sending' },
    failed: { kind: 'not_sent' },
    unknown: { kind: 'unknown', inactiveRecipient: result.unknownCause === 'inactive_recipient' },
  };
  return kinds[result.outcome];
}

export function MattersScreen(): ReactElement {
  const t = useT();
  const { language } = useLanguage();
  const { colors } = useAppTheme();
  const [request, setRequest] = useState('');
  const [answer, setAnswer] = useState('');
  const [draft, setDraft] = useState<MatterDraftResponse | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [openMatters, setOpenMatters] = useState<MatterOpenItem[] | null>(null);
  const [openMatterId, setOpenMatterId] = useState<string | null>(null);
  /** A4: the usage meter; null while unknown (it is a convenience: a failed read shows nothing). */
  const [usage, setUsage] = useState<MatterUsageResponse | null>(null);
  /** A4 part 2: the Microsoft mailbox; null while unknown (hidden then, like the meter). */
  const [mailbox, setMailbox] = useState<MatterMailboxResponse | null>(null);
  /** "Watch this thread": the forwarded emails waiting; null while unknown (hidden then). */
  const [watch, setWatch] = useState<MatterWatchResponse | null>(null);
  /** A3: the matter was dictated, so the assistant answers aloud. */
  const [spoken, setSpoken] = useState(false);
  const base = toBaseLanguage(language); // M12: the executive assistant stays en/es

  // every state update comes after the await (react-hooks/set-state-in-effect); the list is a
  // convenience, so a failed read (or the assistant off) simply shows none
  const loadOpen = useCallback(async (): Promise<void> => {
    const [list, meter, box, watching] = await Promise.all([
      matterService.listOpen().catch((): MatterOpenItem[] => []),
      Promise.resolve()
        .then(() => matterService.usage())
        .catch(() => null),
      Promise.resolve()
        .then(() => matterService.mailboxStatus())
        .catch(() => null),
      Promise.resolve()
        .then(() => matterService.watchList())
        .catch(() => null),
    ]);
    setOpenMatters(list);
    setUsage(meter);
    setMailbox(box);
    setWatch(watching);
  }, []);

  useEffect(() => {
    const start = (): void => {
      void loadOpen();
    };
    start();
  }, [loadOpen]);

  const run = useCallback(
    async (kind: Exclude<Busy, null>, action: () => Promise<void>): Promise<void> => {
      setBusy(kind);
      try {
        await action();
      } catch (caught: unknown) {
        Toast.show({ type: 'error', text1: t(matterErrorKey(toAppError(caught))) });
      } finally {
        setBusy(null);
      }
    },
    [t],
  );

  // the draft said aloud: its questions, or the read-back and how to confirm it
  const sayDraft = (next: MatterDraftResponse, aloud: boolean): void => {
    if (!aloud) return;
    voice.speak(next.draftHash ? `${next.readBack} ${t('matters:voice.sayYesSend')}` : next.questions.join(' '));
  };

  const prepare = (text: string = request, source: 'text' | 'voice' = spoken ? 'voice' : 'text'): Promise<void> =>
    run('prepare', async () => {
      const next = await matterService.draft({ text, source, language: base, timeZone: getDeviceTimeZone() });
      setDraft(next);
      setAnswer('');
      sayDraft(next, source === 'voice');
    });

  const sendAnswer = (text: string = answer): Promise<void> =>
    run('answer', async () => {
      if (!draft) return;
      const next = await matterService.revise(draft.matterId, text);
      setDraft(next);
      setAnswer('');
      sayDraft(next, spoken);
    });

  // A4 part 2: the sign-in happens in the browser; only the server knows how it ended
  const connectMailbox = (): Promise<void> =>
    run('mailbox', async () => {
      const link = await matterService.mailboxConnectLink(base);
      if (!link.authUrl) return;
      await openMailboxSignIn(link.authUrl);
      const status = await matterService.mailboxStatus();
      setMailbox(status);
      Toast.show({ type: status.connected ? 'success' : 'info', text1: t(status.connected ? 'matters:mailbox.connected' : 'matters:mailbox.notConnected') });
    });

  const disconnectMailbox = (): void => {
    Alert.alert(t('matters:mailbox.disconnectTitle'), t('matters:mailbox.disconnectMessage'), [
      { text: t('matters:mailbox.disconnectKeep'), style: 'cancel' },
      {
        text: t('matters:mailbox.disconnectConfirm'),
        style: 'destructive',
        onPress: () =>
          void run('mailbox', async () => {
            setMailbox(await matterService.mailboxDisconnect());
            Toast.show({ type: 'success', text1: t('matters:mailbox.disconnected') });
          }),
      },
    ]);
  };

  const sendFromMailbox = (on: boolean): Promise<void> =>
    run('mailbox', async () => {
      if (!draft) return;
      const result = await matterService.sendFrom(draft.matterId, on);
      setMailbox({ available: result.available, connected: result.connected, address: result.address });
      if (result.draft) setDraft(result.draft);
    });

  // "Watch this thread": the draft that answers a forwarded email (one model call, nothing sent)
  const openWatch = (item: MatterWatchItem): Promise<void> =>
    run('watch', async () => {
      const result = await matterService.watchDraft(item.watchId, base, getDeviceTimeZone());
      setWatch({ available: result.available, address: result.address, items: result.items });
      if (result.draft) {
        setDraft(result.draft);
        setAnswer('');
      }
    });

  const dismissWatch = (item: MatterWatchItem): void => {
    Alert.alert(t('matters:watch.dismissTitle'), t('matters:watch.dismissMessage'), [
      { text: t('matters:watch.dismissKeep'), style: 'cancel' },
      {
        text: t('matters:watch.dismissConfirm'),
        style: 'destructive',
        onPress: () =>
          void run('watch', async () => {
            setWatch(await matterService.watchDismiss(item.watchId));
            Toast.show({ type: 'success', text1: t('matters:watch.removed') });
          }),
      },
    ]);
  };

  const confirm = (): Promise<void> =>
    run('confirm', async () => {
      if (!draft?.draftHash) return;
      voice.stopSpeaking();
      const result = await matterService.confirm(draft.matterId, draft.draftHash);
      setDone(doneFor(result));
    });

  /** A finished dictation: the matter, an answer to its questions, or a yes to the read-back. */
  const heard = (text: string, autoSend: boolean): void => {
    setSpoken(true);
    if (!draft) {
      setRequest(text);
      if (autoSend) void prepare(text, 'voice');
      return;
    }
    const command = draft.draftHash ? voiceCommand(text, base) : null;
    if (command === 'confirm' && autoSend) {
      void confirm();
      return;
    }
    if (command === 'cancel') {
      voice.stopSpeaking();
      return;
    }
    setAnswer(text);
    if (autoSend) void sendAnswer(text);
  };

  const voice = useMatterVoice({
    language: base,
    onTranscript: (text) => (draft ? setAnswer(text) : setRequest(text)),
    onFinal: (text, meta) => heard(text, meta.autoSend),
    onProblem: (problem) => Toast.show({ type: 'info', text1: t(`ai:voice.${problem}`) }),
  });

  const cancel = (): Promise<void> =>
    run('cancel', async () => {
      if (!draft) return;
      await matterService.cancel(draft.matterId);
      setDone({ kind: 'cancelled' });
    });

  const startOver = (): void => {
    voice.stopSpeaking();
    setDraft(null);
    setDone(null);
    setRequest('');
    setAnswer('');
    setSpoken(false);
    void loadOpen();
  };

  const micButton = (
    <MGButton variant="tonal" icon={voice.listening ? 'stop' : 'microphone'} style={styles.action} onPress={voice.toggleMic} disabled={busy !== null} testID="matters-mic">
      {t(voice.listening ? 'matters:voice.stopListening' : 'matters:voice.speak')}
    </MGButton>
  );
  const stopButton = voice.speaking ? (
    <MGButton variant="tonal" icon="volume-off" style={styles.action} onPress={voice.stopSpeaking} testID="matters-stop-speaking">
      {t('matters:voice.stop')}
    </MGButton>
  ) : null;

  const closeMatter = (): void => {
    setOpenMatterId(null);
    void loadOpen();
  };

  if (!matterService.isEnabled()) {
    return (
      <ScreenBody>
        <Banner tone="info" text={t('matters:errors.unavailable')} testID="matters-off" />
      </ScreenBody>
    );
  }

  const cancelRow = (
    <ListGroup>
      <ListRow
        icon="close-circle-outline"
        title={t('matters:cancel')}
        tone="destructive"
        onPress={() => void cancel()}
        disabled={busy !== null}
        accessibilityRole="button"
        testID="matters-cancel"
      />
    </ListGroup>
  );

  if (done) {
    return (
      <ScreenBody>
        {done.kind === 'sent' ? <Banner tone="info" icon="check-circle-outline" text={t('matters:result.sent')} testID="matters-sent" /> : null}
        {done.kind === 'cancelled' ? <Banner tone="info" text={t('matters:result.cancelled')} testID="matters-cancelled" /> : null}
        {done.kind === 'not_sent' ? (
          <>
            <Banner tone="warning" text={t('matters:result.notSent')} testID="matters-not-sent" />
            <MGButton style={styles.action} onPress={() => void confirm()} loading={busy === 'confirm'} disabled={busy !== null} testID="matters-retry">
              {t('matters:result.retry')}
            </MGButton>
          </>
        ) : null}
        {done.kind === 'sending' ? (
          <>
            <Banner tone="info" text={t('matters:result.sending')} testID="matters-sending" />
            <MGButton style={styles.action} onPress={() => void confirm()} loading={busy === 'confirm'} disabled={busy !== null} testID="matters-check-again">
              {t('matters:result.checkAgain')}
            </MGButton>
          </>
        ) : null}
        {/* no retry: the email may have gone out, and it is never sent twice. "Your copy shows whether
            it arrived" only with a copy, and not after a 406: then the copy arrives, the contact's does not */}
        {done.kind === 'unknown' ? (
          <Banner
            tone="warning"
            text={t(draft?.firstEmail?.cc.length && !done.inactiveRecipient ? 'matters:result.unknown' : 'matters:result.unknownNoCopy')}
            testID="matters-unknown"
          />
        ) : null}
        <MGButton variant="tonal" style={styles.action} onPress={startOver} disabled={busy !== null} testID="matters-new">
          {t('matters:newMatter')}
        </MGButton>
        {done.kind !== 'cancelled' ? cancelRow : null}
      </ScreenBody>
    );
  }

  if (openMatterId) {
    return (
      <ScreenBody>
        <MatterPage matterId={openMatterId} onBack={closeMatter} />
      </ScreenBody>
    );
  }

  if (!draft) {
    return (
      <ScreenBody>
        <Text variant="bodyMedium" style={[styles.explainer, { color: colors.onSurfaceVariant }]}>
          {t('matters:intro')}
        </Text>
        <TextInput
          mode="outlined"
          label={t('matters:request.label')}
          placeholder={t('matters:request.placeholder')}
          value={request}
          onChangeText={setRequest}
          multiline
          numberOfLines={6}
          maxLength={2000}
          testID="matters-request"
        />
        <View style={styles.buttons}>
          <MGButton style={styles.action} onPress={() => void prepare()} loading={busy === 'prepare'} disabled={busy !== null || request.trim().length === 0} testID="matters-prepare">
            {t('matters:prepare')}
          </MGButton>
          {micButton}
          {stopButton}
        </View>
        {openMatters && openMatters.length > 0 ? (
          <Section title={t('matters:open.title')} testID="matters-open-list">
            <ListGroup>
              {openMatters.map((item) => (
                <ListRow
                  key={item.matterId}
                  icon="email-fast-outline"
                  title={item.title}
                  supporting={
                    item.pendingApprovals
                      ? t('matters:open.waiting', { count: item.pendingApprovals })
                      : t(`matters:open.status.${item.status}`)
                  }
                  trailing="chevron"
                  onPress={() => setOpenMatterId(item.matterId)}
                  accessibilityRole="button"
                  testID={`matters-open-${item.matterId}`}
                />
              ))}
            </ListGroup>
          </Section>
        ) : null}
        {usage ? (
          <View testID="matters-usage">
            {usage.today.capReached ? <Banner tone="warning" text={t('matters:usage.capReached')} testID="matters-usage-cap" /> : null}
            <Text variant="bodySmall" style={[styles.explainer, { color: colors.onSurfaceVariant }]}>
              {t('matters:usage.month', {
                matters: usage.matters.used,
                mattersLimit: usage.matters.limit,
                emails: usage.emails.used,
                emailsLimit: usage.emails.limit,
              })}
            </Text>
          </View>
        ) : null}
        {mailbox?.available ? (
          <Section title={t('matters:mailbox.title')} testID="matters-mailbox">
            <ListGroup>
              {mailbox.connected ? (
                <>
                  <ListRow
                    icon="microsoft-outlook"
                    title={t('matters:mailbox.connectedAs', { address: mailbox.address ?? '' })}
                    supporting={t('matters:mailbox.connectedHint')}
                    testID="matters-mailbox-address"
                  />
                  <ListRow
                    icon="link-variant-off"
                    title={t('matters:mailbox.disconnect')}
                    onPress={disconnectMailbox}
                    disabled={busy !== null}
                    accessibilityRole="button"
                    testID="matters-mailbox-disconnect"
                  />
                </>
              ) : (
                <ListRow
                  icon="microsoft-outlook"
                  title={t('matters:mailbox.connect')}
                  supporting={t('matters:mailbox.connectHint')}
                  trailing="chevron"
                  onPress={() => void connectMailbox()}
                  disabled={busy !== null}
                  accessibilityRole="button"
                  testID="matters-mailbox-connect"
                />
              )}
            </ListGroup>
          </Section>
        ) : null}
        {watch && (watch.available || watch.items.length > 0) ? (
          <Section title={t('matters:watch.title')} testID="matters-watch">
            <Text variant="bodySmall" style={[styles.explainer, { color: colors.onSurfaceVariant }]} testID="matters-watch-how">
              {watch.available && watch.address ? t('matters:watch.how', { address: watch.address }) : t('matters:watch.notAvailable')}
            </Text>
            {watch.items.length > 0 ? (
              <ListGroup>
                {watch.items.map((item) => (
                  <ListRow
                    key={item.watchId}
                    icon="email-arrow-right-outline"
                    title={t('matters:watch.itemTitle', {
                      from: item.fromName ?? item.fromEmail ?? t('matters:watch.unknownSender'),
                      subject: item.subject || t('matters:watch.noSubject'),
                    })}
                    supporting={item.drafted ? t('matters:watch.drafted') : item.preview || undefined}
                    trailing={
                      <IconButton
                        icon="close"
                        size={20}
                        onPress={() => dismissWatch(item)}
                        disabled={busy !== null}
                        accessibilityLabel={t('matters:watch.dismiss')}
                        testID={`matters-watch-dismiss-${item.watchId}`}
                      />
                    }
                    onPress={() => void openWatch(item)}
                    disabled={busy !== null || !watch.available}
                    accessibilityRole="button"
                    testID={`matters-watch-${item.watchId}`}
                  />
                ))}
              </ListGroup>
            ) : null}
          </Section>
        ) : null}
        {openMatters && openMatters.length > 0 ? (
          <Section title={t('matters:ask.title')} testID="matters-ask-section">
            <AskPanel
              onChanged={() => void loadOpen()}
              onNewMatter={(text) => {
                setRequest(text);
                void prepare(text, 'text');
              }}
            />
          </Section>
        ) : null}
      </ScreenBody>
    );
  }

  const answerBox = (label: string, button: string, testID: string): ReactElement => (
    <>
      <TextInput mode="outlined" label={label} value={answer} onChangeText={setAnswer} multiline maxLength={1000} testID={`${testID}-input`} />
      <MGButton
        variant={draft.questions.length ? 'filled' : 'tonal'}
        style={styles.action}
        onPress={() => void sendAnswer()}
        loading={busy === 'answer'}
        disabled={busy !== null || answer.trim().length === 0}
        testID={testID}
      >
        {button}
      </MGButton>
    </>
  );

  return (
    <ScreenBody>
      <Text variant="titleMedium" style={styles.title} testID="matters-title">
        {draft.title}
      </Text>
      <View style={styles.buttons}>
        {micButton}
        {stopButton}
      </View>
      {draft.forwarded ? (
        <Section title={t('matters:watch.theirEmail')} testID="matters-forwarded">
          <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
            {t('matters:email.from', {
              value: draft.forwarded.fromEmail
                ? `${draft.forwarded.fromName ? `${draft.forwarded.fromName} ` : ''}<${draft.forwarded.fromEmail}>`
                : (draft.forwarded.fromName ?? t('matters:watch.unknownSender')),
            })}
          </Text>
          <Text variant="bodyMedium" style={styles.subject}>
            {t('matters:email.subject', { value: draft.forwarded.subject || t('matters:watch.noSubject') })}
          </Text>
          <Text variant="bodyMedium" selectable>
            {draft.forwarded.text}
          </Text>
        </Section>
      ) : null}
      {draft.questions.length > 0 ? (
        <Section title={t('matters:questions.title')} testID="matters-questions">
          {draft.questions.map((question) => (
            <Text key={question} variant="bodyMedium" style={styles.line}>
              {question}
            </Text>
          ))}
          {answerBox(t('matters:questions.answerLabel'), t('matters:questions.send'), 'matters-answer')}
        </Section>
      ) : null}
      {draft.firstEmail && draft.draftHash ? (
        <>
          <Section title={t('matters:readBack.title')} testID="matters-readback">
            <Text variant="bodyMedium" selectable>
              {draft.readBack}
            </Text>
          </Section>
          {mailbox?.connected ? (
            <ListGroup>
              <ListRow
                icon="microsoft-outlook"
                title={t('matters:mailbox.sendFromMine')}
                supporting={draft.sendFrom === 'mailbox' ? (mailbox.address ?? '') : t('matters:mailbox.sendFromAssistant')}
                trailing={
                  <Switch
                    value={draft.sendFrom === 'mailbox'}
                    onValueChange={(on) => void sendFromMailbox(on)}
                    disabled={busy !== null}
                    testID="matters-send-from"
                  />
                }
                testID="matters-send-from-row"
              />
            </ListGroup>
          ) : null}
          <Section title={t('matters:email.title')} testID="matters-email">
            <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
              {t('matters:email.from', { value: draft.firstEmail.from })}
            </Text>
            <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
              {t('matters:email.to', { value: draft.firstEmail.to.join(', ') })}
            </Text>
            {draft.firstEmail.cc.length ? (
              <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                {t('matters:email.cc', { value: draft.firstEmail.cc.join(', ') })}
              </Text>
            ) : null}
            <Text variant="bodyMedium" style={styles.subject}>
              {t('matters:email.subject', { value: draft.firstEmail.subject })}
            </Text>
            <Text variant="bodyMedium" selectable>
              {draft.firstEmail.text}
            </Text>
          </Section>
          <MGButton onPress={() => void confirm()} loading={busy === 'confirm'} disabled={busy !== null} testID="matters-confirm">
            {t('matters:confirm')}
          </MGButton>
          <View style={styles.change}>{answerBox(t('matters:change.label'), t('matters:change.send'), 'matters-change')}</View>
        </>
      ) : null}
      {cancelRow}
    </ScreenBody>
  );
}

const styles = StyleSheet.create({
  explainer: { marginBottom: spacing.lg },
  title: { marginBottom: spacing.md },
  line: { marginBottom: spacing.sm },
  subject: { marginTop: spacing.sm, marginBottom: spacing.sm },
  action: { marginTop: spacing.md, marginBottom: spacing.md },
  change: { marginTop: spacing.lg },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.sm },
});
