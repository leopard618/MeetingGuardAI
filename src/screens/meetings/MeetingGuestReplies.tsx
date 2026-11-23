/**
 * M14: "Guest replies" on meeting details. Shows what guests answered through the reply link
 * (accepted, declined, another time) and lets the owner approve a proposed time, which moves the
 * meeting through the normal meeting update (origin 'user'): the alarms reschedule and Google or
 * Outlook send the guests the updated invitation. Keeping the time changes nothing. The owner can
 * also add the link to the invitation, share it, or turn it off.
 */
import { useState, type ReactElement } from 'react';
import { Alert, Share, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import { Card, ListGroup, ListRow, MGButton, SectionHeader } from '../../components/ui';
import { toAppError } from '../../core/errors';
import { createLogger } from '../../core/logger';
import type { Meeting } from '../../core/types';
import { i18n, useT } from '../../i18n';
import { dataService, meetingRepository } from '../../services/data';
import { guestLinkUrl, guestService, hasGuestLink, useGuestAnswers, withGuestLink, withoutGuestLink, type GuestAnswer } from '../../services/guests';
import { spacing, useAppTheme } from '../../theme';
import { useFormatters } from '../shared/useFormatters';

const log = createLogger('guest-replies');

function guestLabel(answer: GuestAnswer, fallback: string): string {
  if (answer.guestName && answer.guestEmail) return `${answer.guestName} <${answer.guestEmail}>`;
  return answer.guestName ?? answer.guestEmail ?? fallback;
}

export function MeetingGuestReplies({ meeting }: { meeting: Meeting }): ReactElement | null {
  const t = useT();
  const { colors } = useAppTheme();
  const fmt = useFormatters();
  const answers = useGuestAnswers(meeting.id);
  const [busy, setBusy] = useState<string | null>(null);
  const linked = hasGuestLink(meeting.description ?? '');
  const canHaveLink = meeting.participants.length > 0 && meeting.recurrence === null && meeting.status !== 'cancelled';
  if (!canHaveLink && answers.length === 0) return null;

  const fail = (caught: unknown): void => {
    log.warn('guest action failed', toAppError(caught).code);
    Toast.show({ type: 'error', text1: t('meetings:guests.failed') });
  };

  const linkUrl = async (): Promise<string> => guestLinkUrl(await guestService.createLink(meeting.id), i18n.language);

  const addToInvite = async (): Promise<void> => {
    setBusy('add');
    try {
      const url = await linkUrl();
      await meetingRepository.update(meeting.id, { description: withGuestLink(meeting.description ?? '', t('meetings:guests.linkLine'), url) }, { origin: 'user' });
      Toast.show({ type: 'success', text1: t('meetings:guests.addToInviteDone') });
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(null);
    }
  };

  const share = async (): Promise<void> => {
    setBusy('share');
    try {
      const url = await linkUrl();
      await Share.share({ message: t('meetings:guests.shareMessage', { title: meeting.title, url }) });
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(null);
    }
  };

  const turnOff = (): void => {
    Alert.alert(t('meetings:guests.turnOffTitle'), t('meetings:guests.turnOffBody'), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      {
        text: t('meetings:guests.turnOff'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setBusy('off');
            try {
              await guestService.revokeLink(meeting.id);
              if (linked) await meetingRepository.update(meeting.id, { description: withoutGuestLink(meeting.description ?? '') }, { origin: 'user' });
              Toast.show({ type: 'success', text1: t('meetings:guests.turnOffDone') });
            } catch (caught) {
              fail(caught);
            } finally {
              setBusy(null);
            }
          })();
        },
      },
    ]);
  };

  const decide = async (answer: GuestAnswer, approve: boolean): Promise<void> => {
    const uid = dataService.getActiveUid();
    if (uid === null) return;
    setBusy(answer.id);
    try {
      if (approve && answer.proposedStartAt) {
        await meetingRepository.update(meeting.id, { startAt: answer.proposedStartAt }, { origin: 'user' });
        await guestService.decide(uid, answer.id, 'approved');
        for (const other of answers) {
          if (other.id !== answer.id && other.kind === 'proposed' && (other.state === 'new' || other.state === 'seen')) {
            await guestService.decide(uid, other.id, 'superseded').catch(() => undefined);
          }
        }
      } else {
        await guestService.decide(uid, answer.id, 'declined');
      }
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(null);
    }
  };

  const confirmApprove = (answer: GuestAnswer): void => {
    if (!answer.proposedStartAt) return;
    const time = fmt.dateTime(answer.proposedStartAt);
    Alert.alert(t('meetings:guests.approveTitle'), t('meetings:guests.approveBody', { time }), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      { text: t('meetings:guests.approveAction'), onPress: () => void decide(answer, true) },
    ]);
  };

  const statusOf = (answer: GuestAnswer): string => {
    if (answer.kind === 'accepted') return t('meetings:guests.accepted');
    if (answer.kind === 'declined') return t('meetings:guests.declined');
    return t('meetings:guests.proposed', { time: answer.proposedStartAt ? fmt.dateTime(answer.proposedStartAt) : '' });
  };

  return (
    <>
      <SectionHeader title={t('meetings:guests.section')} />
      {answers.length === 0 ? (
        <Text variant="bodyMedium" style={[styles.empty, { color: colors.onSurfaceVariant }]} testID="guest-replies-empty">
          {t('meetings:guests.empty')}
        </Text>
      ) : (
        <View style={styles.list}>
          {answers.map((answer) => {
            const open = answer.kind === 'proposed' && (answer.state === 'new' || answer.state === 'seen');
            const stale = open && answer.meetingStartAtSeen !== meeting.startAt;
            return (
              <Card key={answer.id} testID={`guest-reply-${answer.id}`}>
                <Text variant="titleSmall">{guestLabel(answer, t('meetings:guests.someone'))}</Text>
                <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
                  {statusOf(answer)}
                  {answer.state === 'approved' ? ` - ${t('meetings:guests.approved')}` : answer.kind === 'proposed' && answer.state === 'declined' ? ` - ${t('meetings:guests.kept')}` : ''}
                </Text>
                {answer.message ? (
                  <Text variant="bodyMedium" selectable style={styles.note}>
                    {t('meetings:guests.note', { message: answer.message })}
                  </Text>
                ) : null}
                {stale ? (
                  <Text variant="bodySmall" style={{ color: colors.error }}>
                    {t('meetings:guests.stale')}
                  </Text>
                ) : null}
                {open ? (
                  <View style={styles.buttons}>
                    <MGButton size="sm" onPress={() => confirmApprove(answer)} disabled={busy !== null} testID={`guest-reply-approve-${answer.id}`}>
                      {t('meetings:guests.approve')}
                    </MGButton>
                    <MGButton size="sm" variant="ghost" onPress={() => void decide(answer, false)} disabled={busy !== null} testID={`guest-reply-keep-${answer.id}`}>
                      {t('meetings:guests.keep')}
                    </MGButton>
                  </View>
                ) : null}
              </Card>
            );
          })}
        </View>
      )}
      {canHaveLink ? (
        <ListGroup>
          {!linked ? (
            <ListRow icon="link-plus" title={t('meetings:guests.addToInvite')} onPress={() => void addToInvite()} disabled={busy !== null} accessibilityRole="button" testID="guest-link-add" />
          ) : null}
          <ListRow icon="share-variant-outline" title={t('meetings:guests.share')} onPress={() => void share()} disabled={busy !== null} accessibilityRole="button" testID="guest-link-share" />
          <ListRow icon="link-off" tone="destructive" title={t('meetings:guests.turnOff')} onPress={turnOff} disabled={busy !== null} accessibilityRole="button" testID="guest-link-off" />
        </ListGroup>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  empty: { marginBottom: spacing.md },
  list: { gap: spacing.sm, marginBottom: spacing.md },
  note: { marginTop: spacing.xs },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
});
