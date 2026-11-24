/**
 * Ask the assistant about the matters, by voice or text (A3; docs/v1/ARCHITECTURE.md section 36).
 * On the matters screen it covers every open matter; on a matter page (matterId) that matter.
 *
 * - The words go to matterAsk. A status answer is shown and, when the question was spoken, said
 *   aloud (interruptible: a tap on Stop, or simply talking over it; useMatterVoice.ts).
 * - An action (pause, resume, cancel, change, a new matter) is NEVER done by the server: the panel
 *   shows the server's confirmation question with Yes and Not now, and a spoken "yes" or "no"
 *   (assistant/voiceModel.ts voiceCommand: whole short answers only) works the same way.
 * - A change is drafted (matterChange), its read-back shown and said, and applied only on the
 *   owner's yes with its hash. A3 feedback: when the applied change touches what the contact was told
 *   (letThemKnow), the panel asks "Let them know?"; yes writes the email card (matterMessage).
 * - A3 feedback: move_meeting reads the new time (matterMove with the words) and shows it; only "Move it"
 *   (or a spoken yes) moves the meeting. message writes the email card (matterMessage). Every email
 *   is a card the owner sends on the matter page.
 * Every string lives in the "matters" namespace (EN + ES). Nothing typed or said is logged.
 */
import { useState, type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { Switch, Text, TextInput } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import { MGButton } from '../../components/ui';
import type { MatterAskResponse, MatterDraftResponse, MatterSlot } from '../../core/aiContract';
import { toAppError } from '../../core/errors';
import { toBaseLanguage } from '../../core/types';
import { useLanguage, useT } from '../../i18n';
import { matterService } from '../../services/matters';
import { spacing, useAppTheme } from '../../theme';
import { voiceCommand } from '../assistant/voiceModel';
import { matterErrorKey } from './matterErrors';
import { formatWhen } from './matterFormat';
import { isActionIntent } from './matterVoice';
import { useMatterVoice } from './useMatterVoice';

export interface AskPanelProps {
  /** The matter page it sits on; absent on the matters screen. */
  matterId?: string;
  /** Something changed (paused, resumed, cancelled, changed): reload. */
  onChanged(): void;
  /** The words are a new matter: the screen drafts it. */
  onNewMatter?(text: string): void;
  /** A3 feedback: the contact's name, for "Let them know?" (on a matter page). */
  contactName?: string | undefined;
  testID?: string;
}

type Busy = 'ask' | 'act' | 'confirmChange' | 'move' | 'letThemKnow' | null;

export function AskPanel({ matterId, onChanged, onNewMatter, contactName, testID = 'matters-ask' }: AskPanelProps): ReactElement {
  const t = useT();
  const { language: appLanguage } = useLanguage();
  const language = toBaseLanguage(appLanguage); // M12: the executive assistant stays en/es
  const { colors } = useAppTheme();
  const [question, setQuestion] = useState('');
  const [asked, setAsked] = useState('');
  const [reply, setReply] = useState<MatterAskResponse | null>(null);
  const [change, setChange] = useState<MatterDraftResponse | null>(null);
  /** A3 feedback: the owner's words of the change being drafted (for "Let them know?"). */
  const [changeWords, setChangeWords] = useState('');
  const [move, setMove] = useState<{ matterId: string; slot: MatterSlot; free: boolean } | null>(null);
  const [letThem, setLetThem] = useState<{ matterId: string; words: string } | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [natural, setNatural] = useState(false);
  const [spokenMode, setSpokenMode] = useState(false);

  const showError = (caught: unknown): void => {
    Toast.show({ type: 'error', text1: t(matterErrorKey(toAppError(caught))) });
  };

  const voice = useMatterVoice({
    language,
    onTranscript: (text) => setQuestion(text),
    onFinal: (text, meta) => void heard(text, meta.autoSend),
    onProblem: (problem) => Toast.show({ type: 'info', text1: t(`ai:voice.${problem}`) }),
    onNaturalFailed: () => Toast.show({ type: 'info', text1: t('matters:voice.naturalFailed') }),
  });

  const say = (text: string, spoken: boolean): void => {
    if (spoken) voice.speak(text, { natural, ...(matterId ? { matterId } : {}) });
  };

  const ask = async (text: string, spoken: boolean): Promise<void> => {
    const words = text.trim();
    if (!words) return;
    setBusy('ask');
    setSpokenMode(spoken);
    setChange(null);
    setMove(null);
    setLetThem(null);
    try {
      const answer = await matterService.ask({ text: words, language, ...(matterId ? { matterId } : {}) });
      setReply(answer);
      setAsked(words);
      setQuestion('');
      say(isActionIntent(answer.intent) ? `${answer.answer} ${t('matters:voice.sayYes')}` : answer.answer, spoken);
    } catch (caught: unknown) {
      showError(caught);
    } finally {
      setBusy(null);
    }
  };

  const act = async (): Promise<void> => {
    if (!reply) return;
    voice.stopSpeaking();
    if (reply.intent === 'new_matter') {
      setReply(null);
      onNewMatter?.(asked);
      return;
    }
    if (!reply.matterId) return;
    const id = reply.matterId;
    setBusy('act');
    try {
      if (reply.intent === 'pause' || reply.intent === 'resume') {
        await matterService.setStatus(id, reply.intent);
        Toast.show({ type: 'success', text1: t(`matters:ask.done.${reply.intent}`) });
        setReply(null);
        onChanged();
      } else if (reply.intent === 'cancel') {
        await matterService.cancel(id);
        Toast.show({ type: 'success', text1: t('matters:ask.done.cancel') });
        setReply(null);
        onChanged();
      } else if (reply.intent === 'change') {
        const drafted = await matterService.change(id, asked);
        setReply(null);
        setChange(drafted);
        setChangeWords(asked);
        say(drafted.draftHash ? `${drafted.readBack} ${t('matters:voice.sayYesChange')}` : drafted.questions.join(' '), spokenMode);
      } else if (reply.intent === 'move_meeting') {
        const read = await matterService.readNewTime(id, asked);
        if (read.slot) {
          setReply(null);
          setMove({ matterId: id, slot: read.slot, free: read.free });
          say(`${t('matters:move.newTime', { value: formatWhen(read.slot.start, language) })}. ${t(read.free ? 'matters:move.free' : 'matters:move.busy')} ${t('matters:voice.sayYesMove')}`, spokenMode);
        } else {
          setReply({ ...reply, intent: 'status', answer: read.question ?? '' });
          say(read.question ?? '', spokenMode);
        }
      } else if (reply.intent === 'message') {
        await writeToThem(id, asked, reply);
      }
    } catch (caught: unknown) {
      showError(caught);
    } finally {
      setBusy(null);
    }
  };

  /** A3 feedback: the owner's words become an email card (or a question back). */
  const writeToThem = async (id: string, words: string, context: MatterAskResponse | null): Promise<void> => {
    const written = await matterService.message(id, words);
    if (written.id) {
      setReply(null);
      Toast.show({ type: 'success', text1: t('matters:contact.written') });
      say(t('matters:contact.written'), spokenMode);
      onChanged();
    } else {
      setReply({ intent: 'status', matterId: id, title: context?.title ?? null, answer: written.question ?? '' });
      say(written.question ?? '', spokenMode);
    }
  };

  const confirmMove = async (): Promise<void> => {
    if (!move) return;
    voice.stopSpeaking();
    setBusy('move');
    try {
      const moved = await matterService.moveMeeting(move.matterId, move.slot.start);
      setMove(null);
      if (moved.moved) {
        Toast.show({ type: 'success', text1: t('matters:move.moved') });
        onChanged();
      } else if (moved.question) {
        setReply({ intent: 'status', matterId: move.matterId, title: null, answer: moved.question });
      }
    } catch (caught: unknown) {
      showError(caught);
    } finally {
      setBusy(null);
    }
  };

  const letThemKnow = async (): Promise<void> => {
    if (!letThem) return;
    voice.stopSpeaking();
    setBusy('letThemKnow');
    try {
      const target = letThem;
      setLetThem(null);
      await writeToThem(target.matterId, `${t('matters:letThemKnow.instruction')} ${target.words}`, null);
    } catch (caught: unknown) {
      showError(caught);
    } finally {
      setBusy(null);
    }
  };

  const confirmChange = async (): Promise<void> => {
    if (!change?.draftHash) return;
    voice.stopSpeaking();
    setBusy('confirmChange');
    try {
      const applied = await matterService.confirmChange(change.matterId, change.draftHash);
      Toast.show({ type: 'success', text1: t('matters:ask.done.change') });
      setChange(null);
      if (applied.letThemKnow) {
        setLetThem({ matterId: change.matterId, words: changeWords });
        say(t('matters:letThemKnow.question', { name: contactName ?? t('matters:contact.someone') }), spokenMode);
      }
      onChanged();
    } catch (caught: unknown) {
      showError(caught);
    } finally {
      setBusy(null);
    }
  };

  const answerChange = async (text: string): Promise<void> => {
    if (!change) return;
    setBusy('act');
    try {
      const drafted = await matterService.change(change.matterId, text);
      setChange(drafted);
      setChangeWords((before) => `${before}\n${text}`.trim());
      setQuestion('');
      say(drafted.draftHash ? `${drafted.readBack} ${t('matters:voice.sayYesChange')}` : drafted.questions.join(' '), spokenMode);
    } catch (caught: unknown) {
      showError(caught);
    } finally {
      setBusy(null);
    }
  };

  /** A finished dictation: a yes or no to what is on screen, else a new question. */
  const heard = async (text: string, autoSend: boolean): Promise<void> => {
    if (!autoSend) return; // stopped by the owner: the text stays for editing
    const command = voiceCommand(text, language);
    if (reply && isActionIntent(reply.intent) && command) {
      if (command === 'confirm') await act();
      else setReply(null);
      return;
    }
    if (change?.draftHash && command) {
      if (command === 'confirm') await confirmChange();
      else setChange(null);
      return;
    }
    if (move && command) {
      if (command === 'confirm') await confirmMove();
      else setMove(null);
      return;
    }
    if (letThem && command) {
      if (command === 'confirm') await letThemKnow();
      else setLetThem(null);
      return;
    }
    if (change && !change.draftHash) {
      await answerChange(text);
      return;
    }
    await ask(text, true);
  };

  const muted = { color: colors.onSurfaceVariant };
  const action = reply && isActionIntent(reply.intent) ? reply.intent : null;
  return (
    <View testID={testID}>
      <TextInput
        mode="outlined"
        label={t(matterId ? 'matters:ask.labelMatter' : 'matters:ask.label')}
        placeholder={t('matters:ask.placeholder')}
        value={question}
        onChangeText={setQuestion}
        multiline
        maxLength={2000}
        testID={`${testID}-input`}
      />
      <View style={styles.row}>
        <MGButton
          style={styles.rowButton}
          onPress={() => void (change && !change.draftHash ? answerChange(question) : ask(question, false))}
          loading={busy === 'ask'}
          disabled={busy !== null || question.trim().length === 0}
          testID={`${testID}-send`}
        >
          {t('matters:ask.send')}
        </MGButton>
        <MGButton variant="tonal" icon={voice.listening ? 'stop' : 'microphone'} style={styles.rowButton} onPress={voice.toggleMic} disabled={busy !== null} testID={`${testID}-mic`}>
          {t(voice.listening ? 'matters:voice.stopListening' : 'matters:voice.speak')}
        </MGButton>
        {voice.speaking ? (
          <MGButton variant="tonal" icon="volume-off" style={styles.rowButton} onPress={voice.stopSpeaking} testID={`${testID}-stop`}>
            {t('matters:voice.stop')}
          </MGButton>
        ) : null}
      </View>
      <View style={styles.switchRow}>
        <Text variant="bodySmall" style={muted}>
          {t('matters:voice.natural')}
        </Text>
        <Switch value={natural} onValueChange={setNatural} testID={`${testID}-natural`} />
      </View>

      {reply ? (
        <View style={styles.answer} testID={`${testID}-answer`}>
          <Text variant="bodyMedium" selectable>
            {reply.answer}
          </Text>
          {action ? (
            <View style={styles.row}>
              <MGButton style={styles.rowButton} onPress={() => void act()} loading={busy === 'act'} disabled={busy !== null} testID={`${testID}-yes`}>
                {t(`matters:ask.yes.${action}`)}
              </MGButton>
              <MGButton variant="tonal" style={styles.rowButton} onPress={() => setReply(null)} disabled={busy !== null} testID={`${testID}-no`}>
                {t('matters:ask.notNow')}
              </MGButton>
            </View>
          ) : null}
        </View>
      ) : null}

      {move ? (
        <View style={styles.answer} testID={`${testID}-move`}>
          <Text variant="titleSmall" style={styles.line}>
            {t('matters:move.newTime', { value: formatWhen(move.slot.start, language) })}
          </Text>
          <Text variant="bodySmall" style={[styles.line, muted]}>
            {t(move.free ? 'matters:move.free' : 'matters:move.busy')}
          </Text>
          <View style={styles.row}>
            <MGButton style={styles.rowButton} onPress={() => void confirmMove()} loading={busy === 'move'} disabled={busy !== null} testID={`${testID}-move-apply`}>
              {t('matters:move.apply')}
            </MGButton>
            <MGButton variant="tonal" style={styles.rowButton} onPress={() => setMove(null)} disabled={busy !== null} testID={`${testID}-move-drop`}>
              {t('matters:ask.notNow')}
            </MGButton>
          </View>
        </View>
      ) : null}

      {letThem ? (
        <View style={styles.answer} testID={`${testID}-let-them-know`}>
          <Text variant="bodyMedium" style={styles.line}>
            {t('matters:letThemKnow.question', { name: contactName ?? t('matters:contact.someone') })}
          </Text>
          <View style={styles.row}>
            <MGButton style={styles.rowButton} onPress={() => void letThemKnow()} loading={busy === 'letThemKnow'} disabled={busy !== null} testID={`${testID}-let-them-know-yes`}>
              {t('matters:letThemKnow.yes')}
            </MGButton>
            <MGButton variant="tonal" style={styles.rowButton} onPress={() => setLetThem(null)} disabled={busy !== null} testID={`${testID}-let-them-know-no`}>
              {t('matters:ask.notNow')}
            </MGButton>
          </View>
        </View>
      ) : null}

      {change ? (
        <View style={styles.answer} testID={`${testID}-change`}>
          {change.questions.map((item) => (
            <Text key={item} variant="bodyMedium" style={styles.line}>
              {item}
            </Text>
          ))}
          {change.draftHash ? (
            <>
              <Text variant="titleSmall" style={styles.line}>
                {t('matters:ask.changeTitle')}
              </Text>
              <Text variant="bodyMedium" selectable>
                {change.readBack}
              </Text>
              <View style={styles.row}>
                <MGButton style={styles.rowButton} onPress={() => void confirmChange()} loading={busy === 'confirmChange'} disabled={busy !== null} testID={`${testID}-change-confirm`}>
                  {t('matters:ask.confirmChange')}
                </MGButton>
                <MGButton variant="tonal" style={styles.rowButton} onPress={() => setChange(null)} disabled={busy !== null} testID={`${testID}-change-drop`}>
                  {t('matters:ask.notNow')}
                </MGButton>
              </View>
            </>
          ) : (
            <Text variant="bodySmall" style={muted}>
              {t('matters:ask.answerChange')}
            </Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm },
  rowButton: { marginRight: spacing.sm, marginBottom: spacing.sm },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  answer: { marginTop: spacing.sm, marginBottom: spacing.md },
  line: { marginBottom: spacing.sm },
});
