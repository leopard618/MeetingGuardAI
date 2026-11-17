/**
 * One open matter (A2, test build only; docs/v1/ARCHITECTURE.md section 36): the cards waiting for
 * the owner and the commitments the assistant proposed. The full timeline and settings come in
 * A3 and A5; notifications in A8 (in A2 the owner sees the cards when opening the app).
 *
 * - A reply_draft card shows the whole email exactly as it would be sent; "Send this reply"
 *   sends its hash back (matterDecide), so only the version on screen can go out.
 * - Other cards are information or a decision for the owner (goal_reached: mark the matter done).
 * - A proposed commitment becomes an ordinary task on "Add to my tasks" (with the device zone).
 * Every string lives in the "matters" namespace (EN + ES). Nothing is logged.
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import { Banner, ListGroup, ListRow, MGButton } from '../../components/ui';
import type { MatterDecideResponse } from '../../core/aiContract';
import { toAppError } from '../../core/errors';
import { getDeviceTimeZone } from '../../core/time';
import { useT } from '../../i18n';
import { matterService, type MatterPage as MatterPageData } from '../../services/matters';
import { spacing, useAppTheme } from '../../theme';
import { Section } from '../shared/Section';
import { matterErrorKey } from './matterErrors';

export interface MatterPageProps {
  matterId: string;
  onBack(): void;
}

const RESULT_KEYS: Readonly<Record<string, string>> = {
  sent: 'matters:page.sent',
  sending: 'matters:page.sending',
  failed: 'matters:page.notSent',
  unknown: 'matters:page.unknown',
};

export function MatterPage({ matterId, onBack }: MatterPageProps): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const [page, setPage] = useState<MatterPageData | null | 'missing' | 'error'>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // every state update comes after the await (react-hooks/set-state-in-effect)
  const load = useCallback(async (): Promise<void> => {
    // a failed read is not a missing matter: it says so and offers to try again
    const next = await matterService.getPage(matterId).then(
      (found): MatterPageData | 'missing' => found ?? 'missing',
      (caught: unknown): 'error' => {
        Toast.show({ type: 'error', text1: t(matterErrorKey(toAppError(caught))) });
        return 'error';
      },
    );
    setPage(next);
  }, [matterId, t]);

  useEffect(() => {
    const start = (): void => {
      void load();
    };
    start();
  }, [load]);

  const act = async (key: string, action: () => Promise<MatterDecideResponse | void>, success?: (result: MatterDecideResponse) => string | null): Promise<void> => {
    setBusy(key);
    try {
      const result = await action();
      const message = result && success ? success(result) : null;
      if (message) Toast.show({ type: result && result.outcome && result.outcome !== 'sent' ? 'info' : 'success', text1: message });
      await load();
    } catch (caught: unknown) {
      Toast.show({ type: 'error', text1: t(matterErrorKey(toAppError(caught))) });
    } finally {
      setBusy(null);
    }
  };

  type Card = MatterPageData['approvals'][number];
  type Proposal = MatterPageData['proposals'][number];

  const decideCard = (card: Card, action: 'approve' | 'decline'): Promise<void> =>
    act(`${action}-${card.id}`, () =>
      matterService.decide({ matterId, target: 'approval', id: card.id, action, ...(action === 'approve' && card.draftHash ? { draftHash: card.draftHash } : {}) }),
    (result) => (result.outcome ? t(RESULT_KEYS[result.outcome] ?? 'matters:page.sent') : null),
    );

  const decideProposal = (proposal: Proposal, action: 'accept' | 'drop'): Promise<void> =>
    act(`${action}-${proposal.id}`, () =>
      matterService.decide({ matterId, target: 'proposal', id: proposal.id, action, ...(action === 'accept' ? { timeZone: getDeviceTimeZone() } : {}) }),
    (result) => (result.status === 'accepted' ? t('matters:page.accepted') : null),
    );

  const cancel = (): Promise<void> =>
    act('cancel', async () => {
      await matterService.cancel(matterId);
      onBack();
    });

  const back = (
    <MGButton variant="tonal" style={styles.action} onPress={onBack} disabled={busy !== null} testID="matters-back">
      {t('matters:page.back')}
    </MGButton>
  );

  if (page === null) return <View testID="matters-page-loading">{back}</View>;
  if (page === 'error') {
    return (
      <View testID="matters-page">
        <Banner tone="warning" text={t('matters:page.loadFailed')} testID="matters-page-error" />
        <MGButton style={styles.action} onPress={() => void load()} testID="matters-page-retry">
          {t('matters:result.retry')}
        </MGButton>
        {back}
      </View>
    );
  }
  if (page === 'missing') {
    return (
      <View testID="matters-page">
        <Banner tone="warning" text={t('matters:page.notFound')} testID="matters-page-missing" />
        {back}
      </View>
    );
  }

  const muted = { color: colors.onSurfaceVariant };
  return (
    <View testID="matters-page">
      {back}
      <Text variant="titleMedium" style={styles.title}>
        {page.matter.title}
      </Text>
      <Text variant="bodySmall" style={[styles.line, muted]}>
        {t(`matters:open.status.${page.matter.status}`)}
      </Text>

      <Section title={t('matters:page.cardsTitle')} testID="matters-cards">
        {page.approvals.length === 0 ? (
          <Text variant="bodyMedium" style={muted}>
            {t('matters:page.noCards')}
          </Text>
        ) : null}
        {page.approvals.map((card) => {
          const verb = card.kind === 'reply_draft' || card.kind === 'goal_reached' ? card.kind : 'default';
          return (
            <View key={card.id} style={styles.card} testID={`matters-card-${card.id}`}>
              <Text variant="titleSmall">{t(`matters:card.kind.${card.kind}`)}</Text>
              {card.reason ? (
                <Text variant="bodySmall" style={[styles.line, muted]}>
                  {t(`matters:card.reason.${card.reason}`)}
                </Text>
              ) : null}
              {card.from ? (
                <Text variant="bodySmall" style={muted}>
                  {t(card.kind === 'bounce' ? 'matters:card.address' : 'matters:card.from', { value: card.from })}
                </Text>
              ) : null}
              {card.quote ? (
                <Text variant="bodyMedium" style={styles.line} selectable>
                  {t('matters:card.quote', { value: card.quote })}
                </Text>
              ) : null}
              {card.guardFlags.length ? (
                <Banner
                  tone="warning"
                  text={`${t('matters:card.guard.title')} ${card.guardFlags.map((flag) => t(`matters:card.guard.${flag}`)).join(', ')}`}
                  testID={`matters-card-guard-${card.id}`}
                />
              ) : null}
              {card.draft ? (
                <View style={styles.draft}>
                  <Text variant="bodySmall" style={muted}>
                    {t('matters:email.to', { value: card.draft.to.join(', ') })}
                  </Text>
                  {card.draft.cc.length ? (
                    <Text variant="bodySmall" style={muted}>
                      {t('matters:email.cc', { value: card.draft.cc.join(', ') })}
                    </Text>
                  ) : null}
                  <Text variant="bodyMedium" style={styles.subject}>
                    {t('matters:email.subject', { value: card.draft.subject })}
                  </Text>
                  <Text variant="bodyMedium" selectable>
                    {card.draft.text}
                  </Text>
                </View>
              ) : null}
              <View style={styles.row}>
                <MGButton
                  style={styles.rowButton}
                  onPress={() => void decideCard(card, 'approve')}
                  loading={busy === `approve-${card.id}`}
                  disabled={busy !== null}
                  testID={`matters-card-approve-${card.id}`}
                >
                  {t(`matters:card.approve.${verb}`)}
                </MGButton>
                <MGButton
                  variant="tonal"
                  style={styles.rowButton}
                  onPress={() => void decideCard(card, 'decline')}
                  loading={busy === `decline-${card.id}`}
                  disabled={busy !== null}
                  testID={`matters-card-decline-${card.id}`}
                >
                  {t(`matters:card.decline.${verb}`)}
                </MGButton>
              </View>
            </View>
          );
        })}
      </Section>

      {page.proposals.length ? (
        <Section title={t('matters:page.proposalsTitle')} testID="matters-proposals">
          {page.proposals.map((proposal) => (
            <View key={proposal.id} style={styles.card} testID={`matters-proposal-${proposal.id}`}>
              <Text variant="titleSmall">{proposal.title}</Text>
              {proposal.due ? (
                <Text variant="bodySmall" style={muted}>
                  {t('matters:page.proposalDue', { value: proposal.due.time ? `${proposal.due.date} ${proposal.due.time}` : proposal.due.date })}
                </Text>
              ) : null}
              <Text variant="bodySmall" style={[styles.line, muted]} selectable>
                {t('matters:card.quote', { value: proposal.quote })}
              </Text>
              <View style={styles.row}>
                <MGButton
                  style={styles.rowButton}
                  onPress={() => void decideProposal(proposal, 'accept')}
                  loading={busy === `accept-${proposal.id}`}
                  disabled={busy !== null}
                  testID={`matters-proposal-accept-${proposal.id}`}
                >
                  {t('matters:page.accept')}
                </MGButton>
                <MGButton
                  variant="tonal"
                  style={styles.rowButton}
                  onPress={() => void decideProposal(proposal, 'drop')}
                  loading={busy === `drop-${proposal.id}`}
                  disabled={busy !== null}
                  testID={`matters-proposal-drop-${proposal.id}`}
                >
                  {t('matters:page.drop')}
                </MGButton>
              </View>
            </View>
          ))}
        </Section>
      ) : null}

      <ListGroup>
        <ListRow
          icon="close-circle-outline"
          title={t('matters:cancel')}
          tone="destructive"
          onPress={() => void cancel()}
          disabled={busy !== null}
          accessibilityRole="button"
          testID="matters-page-cancel"
        />
      </ListGroup>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { marginBottom: spacing.xs },
  line: { marginBottom: spacing.sm },
  subject: { marginTop: spacing.sm, marginBottom: spacing.sm },
  action: { marginTop: spacing.sm, marginBottom: spacing.md },
  card: { marginBottom: spacing.lg },
  draft: { marginTop: spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm },
  rowButton: { marginRight: spacing.sm, marginBottom: spacing.sm },
});
