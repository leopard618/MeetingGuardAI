/**
 * One open matter (A2 and A3, test build only; docs/v1/ARCHITECTURE.md section 36): the cards
 * waiting for the owner, the commitments the assistant proposed, and (A3) the booked meeting, the
 * timeline, the cost so far, pause and resume, and questions or changes by voice or text
 * (AskPanel.tsx). Notifications sent from the server come in A8.
 * A5: "Brief me" (in AskPanel: the briefing streamed and spoken as it arrives; autoBrief starts it
 * when the page opens from a briefing notification); a first email that did not go out says so,
 * with "Try again" (the same confirmed draft, by its hash) or cancel; "Add an email to this matter"
 * shows the matter's own address to forward an email of the conversation to.
 * Design (A5): the title with its status and what waits as badges, each card in its own outlined
 * card (an email shown as an email), the timeline as a line of dots, and pause, cancel and delete
 * together under "Manage this matter".
 *
 * - A reply_draft card shows the whole email exactly as it would be sent; "Send this reply"
 *   sends its hash back (matterDecide), so only the version on screen can go out.
 * - Other cards are information or a decision for the owner (goal_reached: mark the matter done).
 * - A proposed commitment becomes an ordinary task on "Add to my tasks" (with the device zone).
 * - A3: a time_proposal card shows the time; "Book this time" books it (the server re-checks the
 *   calendar first and answers not_allowed when it is no longer free).
 * - A4: "Delete this matter" asks first, then removes the matter with its emails and history.
 * - A3 feedback: on a running matter, "Move the meeting" and "Write to them" (ContactActions.tsx); the
 *   emails they prepare are reply_draft cards named "Email ready to send", sent like any reply.
 * Every string lives in the "matters" namespace (EN + ES). Nothing is logged.
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import { Badge, Banner, Card, ListGroup, ListRow, MGButton, type BadgeTone } from '../../components/ui';
import type { MatterDecideResponse } from '../../core/aiContract';
import { toAppError } from '../../core/errors';
import { getDeviceTimeZone } from '../../core/time';
import { toBaseLanguage } from '../../core/types';
import { useLanguage, useT } from '../../i18n';
import { matterService, type MatterPage as MatterPageData } from '../../services/matters';
import { radii, spacing, useAppTheme } from '../../theme';
import { Section } from '../shared/Section';
import { AskPanel } from './AskPanel';
import { ContactActions } from './ContactActions';
import { matterErrorKey } from './matterErrors';
import { formatCost, formatWhen, timelineDetail, timelineKey } from './matterFormat';

/** time_proposal reasons whose approval books the time (as the server's BOOKABLE_ON_APPROVE). */
const BOOKABLE = new Set<string | null>(['ask_before_booking', 'unverified_sender', 'outside_windows', 'after_end', null]);

/** A3 feedback: reply_draft cards the owner asked for (write to them, the meeting moved). */
const OWNER_EMAIL_REASONS = new Set<string | null>(['owner_message', 'meeting_moved']);

/** Information cards about a contact's email that got no reply: the owner may want to answer. */
const NO_REPLY_KINDS = new Set<string>(['new_person', 'outside_mandate', 'unclear', 'time_proposal', 'many_replies']);

export interface MatterPageProps {
  matterId: string;
  onBack(): void;
  /** A5: opened from a briefing notification: the briefing starts at once. */
  autoBrief?: boolean;
}

/** The status badge of the matter. */
const STATUS_TONES: Readonly<Record<string, BadgeTone>> = { draft: 'neutral', active: 'success', paused: 'warning', done: 'neutral', cancelled: 'neutral' };

const RESULT_KEYS: Readonly<Record<string, string>> = {
  sent: 'matters:page.sent',
  sending: 'matters:page.sending',
  failed: 'matters:page.notSent',
  unknown: 'matters:page.unknown',
};

export function MatterPage({ matterId, onBack, autoBrief = false }: MatterPageProps): ReactElement {
  const t = useT();
  const { language: appLanguage } = useLanguage();
  const language = toBaseLanguage(appLanguage);
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

  /** A4: asks first; the matter goes with its emails and history (the meeting and tasks stay). */
  const remove = (): void => {
    Alert.alert(t('matters:page.deleteTitle'), t('matters:page.deleteMessage'), [
      { text: t('matters:page.deleteKeep'), style: 'cancel' },
      {
        text: t('matters:page.deleteConfirm'),
        style: 'destructive',
        onPress: () => {
          setBusy('delete');
          matterService.remove(matterId).then(
            () => {
              Toast.show({ type: 'success', text1: t('matters:page.deleted') });
              onBack();
            },
            (caught: unknown) => {
              setBusy(null);
              Toast.show({ type: 'error', text1: t(matterErrorKey(toAppError(caught))) });
            },
          );
        },
      },
    ]);
  };

  /** A5: the first email again, exactly as confirmed (its hash); the server never sends it twice. */
  const retryFirst = (draftHash: string): Promise<void> =>
    act('retry-first', async () => {
      const result = await matterService.confirm(matterId, draftHash);
      Toast.show({ type: result.outcome === 'sent' ? 'success' : 'info', text1: t(RESULT_KEYS[result.outcome] ?? 'matters:page.sent') });
    });

  const setStatus = (action: 'pause' | 'resume'): Promise<void> =>
    act(action, async () => {
      await matterService.setStatus(matterId, action);
      Toast.show({ type: 'success', text1: t(`matters:ask.done.${action}`) });
    });

  const back = (
    <MGButton variant="ghost" icon="arrow-left" style={styles.action} onPress={onBack} disabled={busy !== null} testID="matters-back">
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
  const emailBox = { backgroundColor: colors.surfaceVariant };
  return (
    <View testID="matters-page">
      {back}
      <Text variant="headlineSmall" style={styles.title} accessibilityRole="header">
        {page.matter.title}
      </Text>
      <View style={styles.badges}>
        <Badge tone={STATUS_TONES[page.matter.status] ?? 'neutral'} label={t(`matters:open.status.${page.matter.status}`)} testID="matters-page-status-badge" />
        {page.approvals.length > 0 ? <Badge tone="warning" label={t('matters:page.needYou', { count: page.approvals.length })} testID="matters-page-need" /> : null}
      </View>
      {page.matter.meeting ? (
        <Banner tone="info" icon="calendar-check" text={t('matters:page.meetingBooked', { value: formatWhen(page.matter.meeting.start, language) })} testID="matters-page-meeting" />
      ) : null}
      {page.firstSend?.state === 'failed' ? (
        <View testID="matters-page-first-failed">
          <Banner tone="warning" text={t('matters:page.firstFailed')} />
          <View style={styles.row}>
            {page.firstSend.draftHash ? (
              <MGButton style={styles.rowButton} onPress={() => void retryFirst(page.firstSend!.draftHash!)} loading={busy === 'retry-first'} disabled={busy !== null} testID="matters-page-first-retry">
                {t('matters:result.retry')}
              </MGButton>
            ) : null}
            <MGButton variant="tonal" style={styles.rowButton} onPress={() => void cancel()} disabled={busy !== null} testID="matters-page-first-cancel">
              {t('matters:cancel')}
            </MGButton>
          </View>
        </View>
      ) : null}
      {page.firstSend?.state === 'unknown' ? <Banner tone="warning" text={t('matters:page.firstUnknown')} testID="matters-page-first-unknown" /> : null}

      <Section title={t('matters:page.cardsTitle')} testID="matters-cards">
        {page.approvals.length === 0 ? (
          <Text variant="bodyMedium" style={muted}>
            {t('matters:page.noCards')}
          </Text>
        ) : null}
        {page.approvals.map((card) => {
          const book = card.kind === 'time_proposal' && card.slot && BOOKABLE.has(card.reason ?? null);
          const ownerEmail = card.kind === 'reply_draft' && OWNER_EMAIL_REASONS.has(card.reason ?? null);
          const verb = book ? 'book' : ownerEmail ? 'owner_email' : card.kind === 'reply_draft' || card.kind === 'goal_reached' ? card.kind : 'default';
          // information only: one button that marks it as read (nothing is sent or booked)
          const info = verb === 'default';
          return (
            <Card key={card.id} variant="outlined" style={styles.card} testID={`matters-card-${card.id}`}>
              <Text variant="titleSmall">{t(ownerEmail ? 'matters:card.kind.owner_email' : `matters:card.kind.${card.kind}`)}</Text>
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
              {card.slot ? (
                <Text variant="bodyMedium" style={styles.line} testID={`matters-card-slot-${card.id}`}>
                  {t('matters:card.slot', { value: formatWhen(card.slot.start, language) })}
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
                <View style={[styles.draft, emailBox]}>
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
              {info && NO_REPLY_KINDS.has(card.kind) ? (
                <Text variant="bodySmall" style={[styles.line, muted]} testID={`matters-card-noreply-${card.id}`}>
                  {t('matters:card.noReply')}
                </Text>
              ) : null}
              <View style={styles.row}>
                <MGButton
                  style={styles.rowButton}
                  onPress={() => void decideCard(card, 'approve')}
                  loading={busy === `approve-${card.id}`}
                  disabled={busy !== null}
                  testID={`matters-card-approve-${card.id}`}
                >
                  {t(info ? 'matters:card.markRead' : `matters:card.approve.${verb}`)}
                </MGButton>
                {info ? null : (
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
                )}
              </View>
            </Card>
          );
        })}
      </Section>

      {page.proposals.length ? (
        <Section title={t('matters:page.proposalsTitle')} testID="matters-proposals">
          {page.proposals.map((proposal) => (
            <Card key={proposal.id} variant="outlined" style={styles.card} testID={`matters-proposal-${proposal.id}`}>
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
            </Card>
          ))}
        </Section>
      ) : null}

      {page.matter.status === 'active' ? (
        <ContactActions matterId={matterId} contacts={page.matter.contacts ?? []} meeting={page.matter.meeting ?? null} onChanged={() => void load()} />
      ) : null}

      {page.address && (page.matter.status === 'active' || page.matter.status === 'paused') ? (
        <Section title={t('matters:page.addEmailTitle')} testID="matters-page-add-email">
          <Text variant="bodySmall" style={muted}>
            {t('matters:page.addEmailHow')}
          </Text>
          <View style={[styles.address, emailBox]}>
            <Text variant="titleSmall" selectable testID="matters-page-address">
              {page.address}
            </Text>
          </View>
          <Text variant="bodySmall" style={muted}>
            {t('matters:page.addEmailCopy')}
          </Text>
        </Section>
      ) : null}
      <Section title={t('matters:ask.titleMatter')} testID="matters-page-ask">
        <AskPanel matterId={matterId} contactName={page.matter.contacts?.[0]} onChanged={() => void load()} autoBrief={autoBrief} testID="matters-page-ask-panel" />
      </Section>

      {page.events && page.events.length ? (
        <Section title={t('matters:timeline.title')} testID="matters-timeline">
          {page.events.map((item, index) => {
            const detail = timelineDetail(item);
            return (
              <View key={`${item.at}-${index}`} style={styles.event}>
                <View style={styles.rail}>
                  <View style={[styles.dot, { backgroundColor: index === 0 ? colors.primary : colors.outline }]} />
                  {index < page.events!.length - 1 ? <View style={[styles.railLine, { backgroundColor: colors.outlineVariant }]} /> : null}
                </View>
                <View style={styles.eventBody}>
                  <Text variant="bodySmall" style={muted}>
                    {formatWhen(item.at, language)}
                  </Text>
                  <Text variant="bodyMedium">{detail ? `${t(timelineKey(item))}: ${detail}` : t(timelineKey(item))}</Text>
                </View>
              </View>
            );
          })}
        </Section>
      ) : null}

      {page.usage ? (
        <Text variant="bodySmall" style={[styles.line, muted]} testID="matters-usage">
          {page.usage.costUsd !== null
            ? t('matters:page.cost', { value: formatCost(page.usage.costUsd), calls: page.usage.modelCalls, emails: page.usage.emails })
            : t('matters:page.usage', { calls: page.usage.modelCalls, emails: page.usage.emails })}
        </Text>
      ) : null}

      <Section title={t('matters:page.manage')} testID="matters-page-manage">
        <ListGroup>
          {page.matter.status === 'active' || page.matter.status === 'paused' ? (
            <ListRow
              icon={page.matter.status === 'active' ? 'pause-circle-outline' : 'play-circle-outline'}
              title={t(page.matter.status === 'active' ? 'matters:page.pause' : 'matters:page.resume')}
              onPress={() => void setStatus(page.matter.status === 'active' ? 'pause' : 'resume')}
              disabled={busy !== null}
              accessibilityRole="button"
              testID="matters-page-status"
            />
          ) : null}
          <ListRow
            icon="close-circle-outline"
            title={t('matters:cancel')}
            tone="destructive"
            onPress={() => void cancel()}
            disabled={busy !== null}
            accessibilityRole="button"
            testID="matters-page-cancel"
          />
          <ListRow
            icon="delete-outline"
            title={t('matters:page.delete')}
            tone="destructive"
            onPress={remove}
            disabled={busy !== null}
            accessibilityRole="button"
            testID="matters-page-delete"
          />
        </ListGroup>
      </Section>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { marginBottom: spacing.sm },
  badges: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.sm, rowGap: spacing.xs, marginBottom: spacing.md },
  line: { marginBottom: spacing.sm },
  subject: { marginTop: spacing.sm, marginBottom: spacing.sm },
  action: { alignSelf: 'flex-start', marginTop: spacing.sm, marginBottom: spacing.md },
  card: { marginBottom: spacing.md, padding: spacing.md },
  draft: { marginTop: spacing.sm, borderRadius: radii.md, padding: spacing.md },
  address: { borderRadius: radii.md, padding: spacing.md, marginTop: spacing.sm, marginBottom: spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm },
  rowButton: { marginRight: spacing.sm, marginBottom: spacing.sm },
  event: { flexDirection: 'row', columnGap: spacing.md },
  rail: { width: 12, alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  railLine: { width: 2, flex: 1, marginTop: 2 },
  eventBody: { flex: 1, paddingBottom: spacing.md },
});
