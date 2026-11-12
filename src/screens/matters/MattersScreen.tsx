/**
 * AI executive assistant, prototype (route "Matters", from Settings; A1 of the November 10 plan,
 * docs/v1/ARCHITECTURE.md section 36). Shown only when EXPO_PUBLIC_MATTERS_ENABLED; the full
 * screens (matters list, timeline, approval cards, voice) come in A3 and A5.
 *
 * compose: the user's words -> matterDraft
 * draft:   the questions (answer -> matterRevise), or the read-back of the mandate and the first
 *          email exactly as it will be sent; "Confirm and send" sends the draft's hash
 *          (matterConfirm), "Change the draft" -> matterRevise, "Cancel this matter" -> matterCancel
 * done:    sent / not sent yet (retry = the same confirm, never a second email) / cancelled
 * Every string lives in the "matters" namespace (EN + ES). Nothing typed is logged.
 */
import { useCallback, useState, type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, TextInput } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import { Banner, ListGroup, ListRow, MGButton } from '../../components/ui';
import type { MatterDraftResponse } from '../../core/aiContract';
import { errorMessageKey, toAppError, type AppError } from '../../core/errors';
import { getDeviceTimeZone } from '../../core/time';
import { useLanguage, useT } from '../../i18n';
import { matterService } from '../../services/matters';
import { spacing, useAppTheme } from '../../theme';
import { ScreenBody, Section } from '../shared/Section';


type Busy = 'prepare' | 'answer' | 'confirm' | 'cancel' | null;
type Done = { kind: 'sent' } | { kind: 'not_sent' } | { kind: 'cancelled' };

/** The message key for a failed action (the server's reason first, then the generic one). */
export function matterErrorKey(error: AppError): string {
  const reason = (error.details as { reason?: unknown } | undefined)?.reason;
  if (reason === 'stale_draft') return 'matters:errors.stale';
  if (reason === 'not_allowed') return 'matters:errors.notAllowed';
  if (reason === 'not_configured' || error.code === 'not_configured') return 'matters:errors.unavailable';
  return errorMessageKey(error.code);
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

  const prepare = (): Promise<void> =>
    run('prepare', async () => {
      const next = await matterService.draft({ text: request, source: 'text', language, timeZone: getDeviceTimeZone() });
      setDraft(next);
      setAnswer('');
    });

  const sendAnswer = (): Promise<void> =>
    run('answer', async () => {
      if (!draft) return;
      const next = await matterService.revise(draft.matterId, answer);
      setDraft(next);
      setAnswer('');
    });

  const confirm = (): Promise<void> =>
    run('confirm', async () => {
      if (!draft?.draftHash) return;
      const result = await matterService.confirm(draft.matterId, draft.draftHash);
      setDone(result.sent ? { kind: 'sent' } : { kind: 'not_sent' });
    });

  const cancel = (): Promise<void> =>
    run('cancel', async () => {
      if (!draft) return;
      await matterService.cancel(draft.matterId);
      setDone({ kind: 'cancelled' });
    });

  const startOver = (): void => {
    setDraft(null);
    setDone(null);
    setRequest('');
    setAnswer('');
  };

  if (!matterService.isEnabled()) {
    return (
      <ScreenBody>
        <Banner tone="info" text={t('matters:errors.unavailable')} testID="matters-off" />
      </ScreenBody>
    );
  }

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
        <MGButton variant="tonal" style={styles.action} onPress={startOver} disabled={busy !== null} testID="matters-new">
          {t('matters:newMatter')}
        </MGButton>
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
        <MGButton style={styles.action} onPress={() => void prepare()} loading={busy === 'prepare'} disabled={busy !== null || request.trim().length === 0} testID="matters-prepare">
          {t('matters:prepare')}
        </MGButton>
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
});
