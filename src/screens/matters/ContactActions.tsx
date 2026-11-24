/**
 * A3 feedback (the client's test of A3; docs/v1/ARCHITECTURE.md section 36): on a running matter's
 * page, two plain actions the owner can always find:
 *
 * - Move the meeting (when the assistant booked one): the owner types the new day and time, the
 *   server reads it (matterMove with text) and the page shows it, free or not. Only "Move it"
 *   moves the meeting (matterMove with that start). The email that tells the contact is then a
 *   card under "Waiting for you": it goes out only when the owner sends it.
 * - Write to them: the owner's words become an email card (matterMessage) to check and send.
 *
 * Nothing here sends an email. Every string lives in the "matters" namespace (EN + ES). Nothing
 * typed is logged.
 */
import { useState, type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, TextInput } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import { MGButton } from '../../components/ui';
import type { MatterSlot } from '../../core/aiContract';
import { toAppError } from '../../core/errors';
import { toBaseLanguage } from '../../core/types';
import { useLanguage, useT } from '../../i18n';
import { matterService } from '../../services/matters';
import { spacing, useAppTheme } from '../../theme';
import { Section } from '../shared/Section';
import { matterErrorKey } from './matterErrors';
import { formatWhen } from './matterFormat';

export interface ContactActionsProps {
  matterId: string;
  /** The contacts' names (the first one names the questions). */
  contacts: readonly string[];
  /** The meeting the assistant booked, if any. */
  meeting: MatterSlot | null;
  /** A card was added or the meeting moved: reload the page. */
  onChanged(): void;
}

type Busy = 'check' | 'move' | 'write' | null;

export function ContactActions({ matterId, contacts, meeting, onChanged }: ContactActionsProps): ReactElement {
  const t = useT();
  const { language: appLanguage } = useLanguage();
  const language = toBaseLanguage(appLanguage);
  const { colors } = useAppTheme();
  const [when, setWhen] = useState('');
  const [proposed, setProposed] = useState<{ slot: MatterSlot; free: boolean } | null>(null);
  const [moveNote, setMoveNote] = useState<string | null>(null);
  const [words, setWords] = useState('');
  const [writeNote, setWriteNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const name = contacts[0] ?? t('matters:contact.someone');
  const muted = { color: colors.onSurfaceVariant };

  const run = async (key: Busy, work: () => Promise<void>): Promise<void> => {
    setBusy(key);
    try {
      await work();
    } catch (caught: unknown) {
      Toast.show({ type: 'error', text1: t(matterErrorKey(toAppError(caught))) });
    } finally {
      setBusy(null);
    }
  };

  const check = (): Promise<void> =>
    run('check', async () => {
      const read = await matterService.readNewTime(matterId, when);
      setProposed(read.slot ? { slot: read.slot, free: read.free } : null);
      setMoveNote(read.slot ? null : read.question);
    });

  const move = (): Promise<void> =>
    run('move', async () => {
      if (!proposed) return;
      const moved = await matterService.moveMeeting(matterId, proposed.slot.start);
      if (!moved.moved) {
        setProposed(null);
        setMoveNote(moved.question);
        return;
      }
      setProposed(null);
      setWhen('');
      Toast.show({ type: 'success', text1: t('matters:move.moved') });
      onChanged();
    });

  const write = (): Promise<void> =>
    run('write', async () => {
      const written = await matterService.message(matterId, words);
      if (!written.id) {
        setWriteNote(written.question);
        return;
      }
      setWords('');
      setWriteNote(null);
      Toast.show({ type: 'success', text1: t('matters:contact.written') });
      onChanged();
    });

  return (
    <>
      {meeting ? (
        <Section title={t('matters:move.title')} testID="matters-move">
          <TextInput
            mode="outlined"
            label={t('matters:move.label')}
            placeholder={t('matters:move.placeholder')}
            value={when}
            onChangeText={(text) => {
              setWhen(text);
              setProposed(null);
            }}
            maxLength={300}
            testID="matters-move-input"
          />
          <View style={styles.row}>
            <MGButton style={styles.rowButton} onPress={() => void check()} loading={busy === 'check'} disabled={busy !== null || when.trim().length === 0} testID="matters-move-check">
              {t('matters:move.check')}
            </MGButton>
          </View>
          {moveNote ? (
            <Text variant="bodyMedium" style={styles.line} testID="matters-move-note">
              {moveNote}
            </Text>
          ) : null}
          {proposed ? (
            <View testID="matters-move-proposed">
              <Text variant="titleSmall" style={styles.line}>
                {t('matters:move.newTime', { value: formatWhen(proposed.slot.start, language) })}
              </Text>
              <Text variant="bodySmall" style={[styles.line, muted]} testID="matters-move-free">
                {t(proposed.free ? 'matters:move.free' : 'matters:move.busy')}
              </Text>
              <View style={styles.row}>
                <MGButton style={styles.rowButton} onPress={() => void move()} loading={busy === 'move'} disabled={busy !== null} testID="matters-move-apply">
                  {t('matters:move.apply')}
                </MGButton>
                <MGButton variant="tonal" style={styles.rowButton} onPress={() => setProposed(null)} disabled={busy !== null} testID="matters-move-drop">
                  {t('matters:ask.notNow')}
                </MGButton>
              </View>
            </View>
          ) : null}
        </Section>
      ) : null}

      <Section title={t('matters:contact.title')} testID="matters-contact">
        <TextInput
          mode="outlined"
          label={t('matters:contact.label', { name })}
          placeholder={t('matters:contact.placeholder')}
          value={words}
          onChangeText={setWords}
          multiline
          maxLength={1000}
          testID="matters-contact-input"
        />
        <View style={styles.row}>
          <MGButton style={styles.rowButton} onPress={() => void write()} loading={busy === 'write'} disabled={busy !== null || words.trim().length === 0} testID="matters-contact-write">
            {t('matters:contact.write')}
          </MGButton>
        </View>
        {writeNote ? (
          <Text variant="bodyMedium" style={styles.line} testID="matters-contact-note">
            {writeNote}
          </Text>
        ) : null}
      </Section>
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm },
  rowButton: { marginRight: spacing.sm, marginBottom: spacing.sm },
  line: { marginBottom: spacing.sm },
});
