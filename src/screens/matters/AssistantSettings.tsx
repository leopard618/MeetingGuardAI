/**
 * A5: the executive assistant's settings, a page of the matters screen (Settings > AI executive
 * assistant > Assistant settings). The assistant's own address, the connected Microsoft mailbox
 * (moved here from the matters screen), and the owner's defaults: follow-ups, working hours and
 * days, the language of the emails, the signature, the copy rule (a full copy or a daily summary,
 * never off), how long a matter runs, the meeting length, briefings before booked meetings, and the
 * usage meter. Working hours and the signature apply to every matter at once; the rest to new ones,
 * or also to the running matters when the owner turns on "Also change my running matters" (asked
 * once more before saving). Saved with matterSettings; the server checks every value again.
 *
 * Design: grouped cards with a short hint each, times picked with the phone's time picker (no
 * typing), a plain summary of the follow-ups, and Save fixed at the bottom while something changed;
 * leaving with changes not saved asks first.
 * Every string lives in the "matters" namespace (EN + ES).
 */
import { useState, type ReactElement } from 'react';
import { Alert, Platform, StyleSheet, View } from 'react-native';
import { Chip, IconButton, ProgressBar, SegmentedButtons, Switch, Text, TextInput, TouchableRipple } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import { Banner, ListGroup, ListRow, MGButton } from '../../components/ui';
import { matterPrefsSchema, type MatterMailboxResponse, type MatterPrefs, type MatterSettingsResponse, type MatterUsageResponse } from '../../core/aiContract';
import { toAppError } from '../../core/errors';
import { getDeviceTimeZone } from '../../core/time';
import { useT } from '../../i18n';
import { matterService, openMailboxSignIn } from '../../services/matters';
import { radii, spacing, useAppTheme } from '../../theme';
import { ScreenBody, Section } from '../shared/Section';
import { ThemedDateTimePicker as DateTimePicker, type DateTimePickerEvent } from '../shared/ThemedDateTimePicker';
import { matterErrorKey } from './matterErrors';

export interface AssistantSettingsProps {
  settings: MatterSettingsResponse;
  mailbox: MatterMailboxResponse | null;
  usage: MatterUsageResponse | null;
  language: 'en' | 'es';
  onBack(): void;
  onSaved(settings: MatterSettingsResponse): void;
  onMailbox(mailbox: MatterMailboxResponse): void;
}

const DAYS = [1, 2, 3, 4, 5, 6, 0] as const;
const LENGTHS = [null, 3, 7, 14, 30] as const;
const MEETING_MINUTES = [15, 30, 45, 60] as const;
const BRIEFING_MINUTES = [0, 15, 30, 60] as const;
type TimeKey = 'workStart' | 'workEnd' | 'summaryTime';

const pad2 = (n: number) => String(n).padStart(2, '0');
const toDate = (hhmm: string): Date => {
  const date = new Date();
  date.setHours(Number(hhmm.slice(0, 2)) || 0, Number(hhmm.slice(3, 5)) || 0, 0, 0);
  return date;
};
const toHhmm = (date: Date): string => `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
const same = (a: MatterPrefs, b: MatterPrefs): boolean => JSON.stringify(a) === JSON.stringify(b);

function Stepper({ label, value, min, max, onChange, testID }: { label: string; value: number; min: number; max: number; onChange(next: number): void; testID: string }): ReactElement {
  return (
    <View style={styles.stepper} testID={testID}>
      <Text variant="bodyLarge" style={styles.grow}>
        {label}
      </Text>
      <IconButton icon="minus" mode="outlined" size={18} onPress={() => onChange(Math.max(min, value - 1))} disabled={value <= min} accessibilityLabel={`${label} -`} testID={`${testID}-minus`} />
      <Text variant="titleMedium" style={styles.stepValue} testID={`${testID}-value`}>
        {value}
      </Text>
      <IconButton icon="plus" mode="outlined" size={18} onPress={() => onChange(Math.min(max, value + 1))} disabled={value >= max} accessibilityLabel={`${label} +`} testID={`${testID}-plus`} />
    </View>
  );
}

/** A time shown as a button; tapping it opens the phone's time picker. */
function TimeButton({ label, value, onPress, testID }: { label: string; value: string; onPress(): void; testID: string }): ReactElement {
  const { colors } = useAppTheme();
  return (
    <TouchableRipple onPress={onPress} style={[styles.timeButton, { borderColor: colors.outline }]} accessibilityRole="button" accessibilityLabel={`${label} ${value}`} testID={testID}>
      <View>
        <Text variant="labelMedium" style={{ color: colors.onSurfaceVariant }}>
          {label}
        </Text>
        <Text variant="titleLarge">{value}</Text>
      </View>
    </TouchableRipple>
  );
}

function Hint({ children }: { children: string }): ReactElement {
  const { colors } = useAppTheme();
  return (
    <Text variant="bodySmall" style={[styles.hint, { color: colors.onSurfaceVariant }]}>
      {children}
    </Text>
  );
}

function Label({ children }: { children: string }): ReactElement {
  return (
    <Text variant="labelLarge" style={styles.label}>
      {children}
    </Text>
  );
}

export function AssistantSettings({ settings, mailbox, usage, language, onBack, onSaved, onMailbox }: AssistantSettingsProps): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const [saved, setSaved] = useState<MatterPrefs>(settings.prefs);
  const [prefs, setPrefs] = useState<MatterPrefs>(settings.prefs);
  const [busy, setBusy] = useState<'save' | 'mailbox' | null>(null);
  const [picking, setPicking] = useState<TimeKey | null>(null);
  const [applyToOpen, setApplyToOpen] = useState(false);
  const [openMatters, setOpenMatters] = useState(settings.openMatters ?? 0);
  const set = <K extends keyof MatterPrefs>(key: K, value: MatterPrefs[K]): void => setPrefs((current) => ({ ...current, [key]: value }));
  const dirty = !same(prefs, saved) || applyToOpen;

  const run = async (kind: 'save' | 'mailbox', action: () => Promise<void>): Promise<void> => {
    setBusy(kind);
    try {
      await action();
    } catch (caught: unknown) {
      Toast.show({ type: 'error', text1: t(matterErrorKey(toAppError(caught))) });
    } finally {
      setBusy(null);
    }
  };

  const doSave = (): Promise<void> =>
    run('save', async () => {
      const result = await matterService.saveSettings(prefs, getDeviceTimeZone(), applyToOpen);
      setSaved(result.prefs);
      setPrefs(result.prefs);
      setApplyToOpen(false);
      if (result.openMatters !== undefined) setOpenMatters(result.openMatters);
      onSaved(result);
      Toast.show({ type: 'success', text1: result.applied ? t('matters:settings.applied', { count: result.applied }) : t('matters:settings.saved') });
    });

  const save = (): void => {
    if (!matterPrefsSchema.safeParse(prefs).success) {
      Toast.show({ type: 'error', text1: t('matters:settings.invalid') });
      return;
    }
    if (!applyToOpen || openMatters === 0) {
      void doSave();
      return;
    }
    Alert.alert(t('matters:settings.applyTitle'), t('matters:settings.applyMessage', { count: openMatters }), [
      { text: t('matters:settings.applyCancel'), style: 'cancel' },
      { text: t('matters:settings.applyConfirm'), onPress: () => void doSave() },
    ]);
  };

  const back = (): void => {
    if (!dirty) {
      onBack();
      return;
    }
    Alert.alert(t('matters:settings.discardTitle'), t('matters:settings.discardMessage'), [
      { text: t('matters:settings.discardKeep'), style: 'cancel' },
      { text: t('matters:settings.discardConfirm'), style: 'destructive', onPress: onBack },
    ]);
  };

  const connect = (): Promise<void> =>
    run('mailbox', async () => {
      const link = await matterService.mailboxConnectLink(language);
      if (!link.authUrl) return;
      await openMailboxSignIn(link.authUrl);
      const status = await matterService.mailboxStatus();
      onMailbox(status);
      Toast.show({ type: status.connected ? 'success' : 'info', text1: t(status.connected ? 'matters:mailbox.connected' : 'matters:mailbox.notConnected') });
    });

  const disconnect = (): void => {
    Alert.alert(t('matters:mailbox.disconnectTitle'), t('matters:mailbox.disconnectMessage'), [
      { text: t('matters:mailbox.disconnectKeep'), style: 'cancel' },
      {
        text: t('matters:mailbox.disconnectConfirm'),
        style: 'destructive',
        onPress: () =>
          void run('mailbox', async () => {
            onMailbox(await matterService.mailboxDisconnect());
            Toast.show({ type: 'success', text1: t('matters:mailbox.disconnected') });
          }),
      },
    ]);
  };

  const toggleDay = (day: number): void => {
    const has = prefs.workDays.includes(day);
    if (has && prefs.workDays.length === 1) return;
    set('workDays', has ? prefs.workDays.filter((d) => d !== day) : [...prefs.workDays, day].sort());
  };

  const onTimePicked = (event: DateTimePickerEvent, value?: Date): void => {
    const key = picking;
    // Android closes its dialog and answers once; iOS keeps the spinner open until Done
    if (Platform.OS === 'android') setPicking(null);
    if (!key || event.type === 'dismissed' || !value) return;
    set(key, toHhmm(value));
  };

  const picker = (key: TimeKey): ReactElement | null =>
    picking === key ? (
      <View>
        <DateTimePicker value={toDate(prefs[key])} mode="time" onChange={onTimePicked} {...(Platform.OS === 'ios' ? { display: 'spinner' as const } : {})} testID={`matters-settings-${key}-picker`} />
        {Platform.OS === 'ios' ? (
          <MGButton variant="ghost" onPress={() => setPicking(null)} testID={`matters-settings-${key}-done`}>
            {t('matters:settings.pickDone')}
          </MGButton>
        ) : null}
      </View>
    ) : null;

  const meter = (labelKey: string, used: number, limit: number, testID: string): ReactElement => (
    <View style={styles.meter} testID={testID}>
      <Text variant="bodyMedium">{t(labelKey, { used, limit })}</Text>
      <ProgressBar progress={limit > 0 ? Math.min(1, used / limit) : 0} color={limit > 0 && used >= limit ? colors.error : colors.primary} style={styles.bar} />
    </View>
  );

  return (
    <ScreenBody primaryLabel={dirty ? t('matters:settings.save') : undefined} onPrimary={dirty ? save : undefined} primaryLoading={busy === 'save'} primaryDisabled={busy !== null} primaryTestID="matters-settings-save">
      <View testID="matters-settings">
        <MGButton variant="ghost" icon="arrow-left" style={styles.back} onPress={back} disabled={busy !== null} testID="matters-settings-back">
          {t('matters:page.back')}
        </MGButton>
        <Text variant="headlineSmall" accessibilityRole="header">
          {t('matters:settings.title')}
        </Text>
        <Hint>{t('matters:settings.subtitle')}</Hint>

        <Section title={t('matters:settings.identity')} testID="matters-settings-identity">
          <ListGroup>
            <ListRow icon="email-outline" title={settings.address} supporting={t('matters:settings.addressHint')} testID="matters-settings-address" />
            {mailbox?.available ? (
              mailbox.connected ? (
                <>
                  <ListRow icon="microsoft-outlook" title={t('matters:mailbox.connectedAs', { address: mailbox.address ?? '' })} supporting={t('matters:mailbox.connectedHint')} testID="matters-mailbox-address" />
                  <ListRow
                    icon="email-fast-outline"
                    title={t('matters:settings.sendFromMailbox')}
                    trailing={<Switch value={prefs.sendFrom === 'mailbox'} onValueChange={(on) => set('sendFrom', on ? 'mailbox' : 'assistant')} testID="matters-settings-send-from" />}
                    testID="matters-settings-send-from-row"
                  />
                  <ListRow icon="link-variant-off" title={t('matters:mailbox.disconnect')} tone="destructive" onPress={disconnect} disabled={busy !== null} accessibilityRole="button" testID="matters-mailbox-disconnect" />
                </>
              ) : (
                <ListRow
                  icon="microsoft-outlook"
                  title={t('matters:mailbox.connect')}
                  supporting={t('matters:mailbox.connectHint')}
                  trailing="chevron"
                  onPress={() => void connect()}
                  disabled={busy !== null}
                  accessibilityRole="button"
                  testID="matters-mailbox-connect"
                />
              )
            ) : null}
          </ListGroup>
        </Section>

        <Section title={t('matters:settings.followUps')} testID="matters-settings-follow-ups">
          <Hint>{t('matters:settings.followUpsHint')}</Hint>
          <Stepper label={t('matters:settings.everyDays')} value={prefs.followUpEveryDays} min={1} max={14} onChange={(v) => set('followUpEveryDays', v)} testID="matters-settings-every" />
          <Stepper label={t('matters:settings.maxCount')} value={prefs.followUpMaxCount} min={0} max={10} onChange={(v) => set('followUpMaxCount', v)} testID="matters-settings-max" />
          <View style={[styles.summary, { backgroundColor: colors.surfaceVariant }]}>
            <Text variant="bodyMedium" testID="matters-settings-follow-summary">
              {prefs.followUpMaxCount === 0 ? t('matters:settings.followUpsOff') : t('matters:settings.followUpsSummary', { every: prefs.followUpEveryDays, max: prefs.followUpMaxCount })}
            </Text>
          </View>
        </Section>

        <Section title={t('matters:settings.hours')} testID="matters-settings-hours">
          <Hint>{t('matters:settings.hoursHint')}</Hint>
          <View style={styles.row}>
            <TimeButton label={t('matters:settings.from')} value={prefs.workStart} onPress={() => setPicking('workStart')} testID="matters-settings-start" />
            <TimeButton label={t('matters:settings.to')} value={prefs.workEnd} onPress={() => setPicking('workEnd')} testID="matters-settings-end" />
          </View>
          {picker('workStart')}
          {picker('workEnd')}
          {prefs.workStart >= prefs.workEnd ? <Banner tone="warning" text={t('matters:settings.invalid')} testID="matters-settings-hours-invalid" /> : null}
          <Label>{t('matters:settings.workDays')}</Label>
          <View style={styles.chips}>
            {DAYS.map((day) => (
              <Chip key={day} selected={prefs.workDays.includes(day)} showSelectedCheck={false} mode={prefs.workDays.includes(day) ? 'flat' : 'outlined'} onPress={() => toggleDay(day)} style={styles.chip} testID={`matters-settings-day-${day}`}>
                {t(`matters:settings.days.${day}`)}
              </Chip>
            ))}
          </View>
        </Section>

        <Section title={t('matters:settings.emails')} testID="matters-settings-emails">
          <Hint>{t('matters:settings.emailsHint')}</Hint>
          <Label>{t('matters:settings.language')}</Label>
          <SegmentedButtons
            value={prefs.emailLanguage}
            onValueChange={(v) => set('emailLanguage', v as MatterPrefs['emailLanguage'])}
            buttons={[
              { value: 'auto', label: t('matters:settings.languageAuto'), testID: 'matters-settings-language-auto' },
              { value: 'en', label: t('matters:settings.languageEn'), testID: 'matters-settings-language-en' },
              { value: 'es', label: t('matters:settings.languageEs'), testID: 'matters-settings-language-es' },
            ]}
          />
          <TextInput
            mode="outlined"
            outlineStyle={{ borderRadius: radii.md }}
            style={styles.field}
            label={t('matters:settings.signature')}
            placeholder={t('matters:settings.signaturePlaceholder')}
            value={prefs.signature}
            onChangeText={(v) => set('signature', v.replace(/[\r\n]+/g, ' '))}
            maxLength={120}
            testID="matters-settings-signature"
          />
          <Label>{t('matters:settings.copy')}</Label>
          <SegmentedButtons
            value={prefs.copyOwner}
            onValueChange={(v) => set('copyOwner', v as MatterPrefs['copyOwner'])}
            buttons={[
              { value: 'cc', label: t('matters:settings.copyCc'), icon: 'email-multiple-outline', testID: 'matters-settings-copy-cc' },
              { value: 'daily_summary', label: t('matters:settings.copySummary'), icon: 'calendar-today', testID: 'matters-settings-copy-summary' },
            ]}
          />
          <Hint>{t('matters:settings.copyHint')}</Hint>
          {prefs.copyOwner === 'daily_summary' ? (
            <>
              <View style={styles.row}>
                <TimeButton label={t('matters:settings.summaryTime')} value={prefs.summaryTime} onPress={() => setPicking('summaryTime')} testID="matters-settings-summary-time" />
              </View>
              {picker('summaryTime')}
            </>
          ) : null}
        </Section>

        <Section title={t('matters:settings.defaults')} testID="matters-settings-defaults">
          <Hint>{t('matters:settings.defaultsHint')}</Hint>
          <Label>{t('matters:settings.length')}</Label>
          <View style={styles.chips}>
            {LENGTHS.map((days) => (
              <Chip key={String(days)} selected={prefs.defaultDays === days} onPress={() => set('defaultDays', days)} style={styles.chip} testID={`matters-settings-length-${days ?? 'ask'}`}>
                {days === null ? t('matters:settings.lengthAsk') : t('matters:settings.lengthDays', { count: days })}
              </Chip>
            ))}
          </View>
          <Label>{t('matters:settings.meeting')}</Label>
          <View style={styles.chips}>
            {MEETING_MINUTES.map((minutes) => (
              <Chip key={minutes} selected={prefs.meetingMinutes === minutes} onPress={() => set('meetingMinutes', minutes)} style={styles.chip} testID={`matters-settings-meeting-${minutes}`}>
                {t('matters:settings.minutes', { count: minutes })}
              </Chip>
            ))}
          </View>
          <Label>{t('matters:settings.briefing')}</Label>
          <View style={styles.chips}>
            {BRIEFING_MINUTES.map((minutes) => (
              <Chip key={minutes} selected={prefs.briefingMinutes === minutes} onPress={() => set('briefingMinutes', minutes)} style={styles.chip} testID={`matters-settings-briefing-${minutes}`}>
                {minutes === 0 ? t('matters:settings.briefingOff') : t('matters:settings.minutes', { count: minutes })}
              </Chip>
            ))}
          </View>
          {openMatters > 0 ? (
            <ListGroup style={styles.applyGroup}>
              <ListRow
                icon="update"
                title={t('matters:settings.applyOpen', { count: openMatters })}
                supporting={t('matters:settings.applyOpenHint')}
                trailing={<Switch value={applyToOpen} onValueChange={setApplyToOpen} testID="matters-settings-apply-open" />}
                testID="matters-settings-apply-open-row"
              />
            </ListGroup>
          ) : (
            <Hint>{t('matters:settings.appliesHint')}</Hint>
          )}
        </Section>

        {usage ? (
          <Section title={t('matters:settings.usage')} testID="matters-settings-usage">
            {usage.today.capReached ? <Banner tone="warning" text={t('matters:usage.capReached')} /> : null}
            {meter('matters:settings.usageMatters', usage.matters.used, usage.matters.limit, 'matters-settings-usage-matters')}
            {meter('matters:settings.usageEmails', usage.emails.used, usage.emails.limit, 'matters-settings-usage-emails')}
            {usage.voiceMinutes.limit > 0 ? meter('matters:settings.usageVoice', usage.voiceMinutes.used, usage.voiceMinutes.limit, 'matters-settings-usage-voice') : null}
          </Section>
        ) : null}

        {dirty ? <Hint>{t('matters:settings.unsaved')}</Hint> : null}
      </View>
    </ScreenBody>
  );
}

const styles = StyleSheet.create({
  back: { alignSelf: 'flex-start', marginBottom: spacing.sm },
  hint: { marginTop: spacing.xs, marginBottom: spacing.md },
  label: { marginTop: spacing.md, marginBottom: spacing.sm },
  row: { flexDirection: 'row', columnGap: spacing.md, marginBottom: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: { marginRight: spacing.sm, marginBottom: spacing.sm },
  field: { marginTop: spacing.md },
  stepper: { flexDirection: 'row', alignItems: 'center', minHeight: 48 },
  stepValue: { minWidth: 28, textAlign: 'center' },
  grow: { flex: 1 },
  summary: { borderRadius: radii.md, padding: spacing.md, marginTop: spacing.sm },
  timeButton: { flex: 1, borderWidth: 1, borderRadius: radii.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, maxWidth: 180 },
  applyGroup: { marginTop: spacing.md },
  meter: { marginBottom: spacing.md },
  bar: { height: 6, borderRadius: 3, marginTop: spacing.xs },
});
