/**
 * Alert preferences form shared by onboarding step 3 and Settings > Alerts:
 * master switch, intensity (+ visual preview and an audible sample), sound type (with the
 * "voice needs the app open" note), volume, vibration and default reminder times. `extended`
 * (settings screen) adds the snooze length, post-meeting follow-ups and the 12 h / 24 h clock.
 *
 * AlertDeliverySection: notification permission, Android exact alarms and the MAX channel's
 * "Override Do Not Disturb" setting, and the iOS Focus explanation.
 */
import type { ReactElement } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import {
  Button,
  Chip,
  HelperText,
  RadioButton,
  SegmentedButtons,
  Switch,
  Text,
  TouchableRipple,
  useTheme as usePaperTheme,
} from 'react-native-paper';

import { ALERT_INTENSITIES, ALERT_SOUND_TYPES, type AlertIntensity, type AlertSoundType } from '../../core/types';
import { useT } from '../../i18n';
import { alertEngine } from '../../services/alerts';
import { AlertPreview } from '../onboarding/AlertPreview';
import {
  VOLUME_LEVELS,
  alertTimeChoices,
  alertTimeLabel,
  isDraftValid,
  nearestVolumeLevel,
  toggleAlertTime,
  type AlertDraft,
} from '../onboarding/alertOptions';
import { Section } from '../shared/Section';
import type { AlertPermissionState, AlertSample } from './alertHooks';
import { useOpenSystemSettings } from './alertHooks';
import { CLOCK_OPTIONS, clockOptionOf, snoozeChoices, is24HourFromOption, type AlertSettingsDraft, type ClockOption } from './alertSettings';

export interface AlertPreferencesFormProps<D extends AlertDraft> {
  draft: D;
  onChange(patch: Partial<D>): void;
  sample: AlertSample;
}

export function AlertPreferencesForm<D extends AlertDraft>({ draft, onChange, sample }: AlertPreferencesFormProps<D>): ReactElement {
  const t = useT();
  const theme = usePaperTheme();
  const valid = isDraftValid(draft);
  const patch = (value: Partial<AlertDraft>): void => {
    sample.stop();
    onChange(value as Partial<D>);
  };

  return (
    <View>
      <View style={styles.switchRow}>
        <Text variant="titleMedium" style={styles.flex}>
          {t('onboarding:alerts.enabled')}
        </Text>
        <Switch
          value={draft.alertEnabled}
          onValueChange={(value) => patch({ alertEnabled: value })}
          accessibilityLabel={t('onboarding:alerts.enabled')}
          testID="alerts-enabled"
        />
      </View>

      <View style={draft.alertEnabled ? undefined : styles.disabled} pointerEvents={draft.alertEnabled ? 'auto' : 'none'}>
        <Section title={t('onboarding:alerts.intensity.label')}>
          <RadioButton.Group value={draft.alertIntensity} onValueChange={(value) => patch({ alertIntensity: value as AlertIntensity })}>
            {ALERT_INTENSITIES.map((intensity) => (
              <TouchableRipple
                key={intensity}
                onPress={() => patch({ alertIntensity: intensity })}
                accessibilityRole="radio"
                accessibilityState={{ selected: draft.alertIntensity === intensity }}
              >
                <View style={styles.radioRow}>
                  <RadioButton value={intensity} />
                  <View style={styles.flex}>
                    <Text variant="titleSmall">{t(`onboarding:alerts.intensity.${intensity}.title`)}</Text>
                    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                      {t(`onboarding:alerts.intensity.${intensity}.description`)}
                    </Text>
                  </View>
                </View>
              </TouchableRipple>
            ))}
          </RadioButton.Group>
          <Text variant="labelMedium" style={[styles.previewLabel, { color: theme.colors.onSurfaceVariant }]}>
            {t('onboarding:alerts.preview.label')}
          </Text>
          <AlertPreview intensity={draft.alertIntensity} />
          <Button
            mode="outlined"
            icon={sample.playing ? 'stop' : 'play'}
            style={styles.action}
            onPress={() => (sample.playing ? sample.stop() : sample.play(draft))}
          >
            {t(sample.playing ? 'onboarding:alerts.preview.stop' : 'onboarding:alerts.preview.play')}
          </Button>
        </Section>

        <Section title={t('onboarding:alerts.sound.label')}>
          <SegmentedButtons
            value={draft.alertSoundType}
            onValueChange={(value) => patch({ alertSoundType: value as AlertSoundType })}
            buttons={ALERT_SOUND_TYPES.map((type) => ({ value: type, label: t(`onboarding:alerts.sound.${type}`) }))}
          />
          {draft.alertSoundType !== 'sound_only' ? (
            <HelperText type="info" visible>
              {t('alerts:settings.voiceNeedsApp')}
            </HelperText>
          ) : null}
          <Text variant="titleSmall" style={styles.subheading}>
            {t('onboarding:alerts.volume')}
          </Text>
          <SegmentedButtons
            value={String(nearestVolumeLevel(draft.alertVolume))}
            onValueChange={(value) => patch({ alertVolume: Number(value) })}
            buttons={VOLUME_LEVELS.map((level) => ({ value: String(level), label: `${Math.round(level * 100)}%` }))}
          />
          <View style={[styles.switchRow, styles.subheading]}>
            <Text variant="titleSmall" style={styles.flex}>
              {t('onboarding:alerts.vibration')}
            </Text>
            <Switch
              value={draft.vibrationEnabled}
              onValueChange={(value) => patch({ vibrationEnabled: value })}
              accessibilityLabel={t('onboarding:alerts.vibration')}
              testID="alerts-vibration"
            />
          </View>
        </Section>

        <Section title={t('onboarding:alerts.times.label')}>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            {t('onboarding:alerts.times.hint')}
          </Text>
          <View style={styles.chips}>
            {alertTimeChoices(draft.defaultAlertTimes).map((minutes) => {
              const label = alertTimeLabel(minutes);
              const selected = draft.defaultAlertTimes.includes(minutes);
              return (
                <Chip
                  key={minutes}
                  selected={selected}
                  showSelectedCheck
                  mode={selected ? 'flat' : 'outlined'}
                  style={styles.chip}
                  onPress={() => patch({ defaultAlertTimes: toggleAlertTime(draft.defaultAlertTimes, minutes) })}
                >
                  {t(label.key, label.options)}
                </Chip>
              );
            })}
          </View>
          {!valid ? (
            <HelperText type="error" visible>
              {t('onboarding:alerts.times.required')}
            </HelperText>
          ) : null}
        </Section>
      </View>
    </View>
  );
}

/** Settings-only fields: snooze length, post-meeting follow-ups, clock. */
export function AlertExtraSettings({
  draft,
  onChange,
}: {
  draft: AlertSettingsDraft;
  onChange(patch: Partial<AlertSettingsDraft>): void;
}): ReactElement {
  const t = useT();
  const theme = usePaperTheme();
  return (
    <View>
      <Section title={t('alerts:settings.snooze.label')}>
        <SegmentedButtons
          value={String(draft.snoozeMinutes)}
          onValueChange={(value) => onChange({ snoozeMinutes: Number(value) })}
          buttons={snoozeChoices(draft.snoozeMinutes).map((minutes) => ({
            value: String(minutes),
            label: t('alerts:settings.snooze.minutes', { count: minutes }),
          }))}
        />
      </Section>

      <Section title={t('alerts:settings.followUp.label')}>
        <View style={styles.switchRow}>
          <Text variant="bodyMedium" style={[styles.flex, { color: theme.colors.onSurfaceVariant }]}>
            {t('alerts:settings.followUp.description')}
          </Text>
          <Switch
            value={draft.followUpEnabled}
            onValueChange={(value) => onChange({ followUpEnabled: value })}
            accessibilityLabel={t('alerts:settings.followUp.label')}
            testID="alerts-followup"
          />
        </View>
      </Section>

      <Section title={t('alerts:settings.clock.label')}>
        <SegmentedButtons
          value={clockOptionOf(draft.use24HourClock)}
          onValueChange={(value) => onChange({ use24HourClock: is24HourFromOption(value as ClockOption) })}
          buttons={CLOCK_OPTIONS.map((option) => ({ value: option, label: t(`alerts:settings.clock.${option}`) }))}
        />
      </Section>
    </View>
  );
}

/**
 * Delivery: notification permission, exact alarms (Android 12+), Do Not Disturb override of the
 * MAX channel (Android) / Focus and Time Sensitive (iOS).
 */
export function AlertDeliverySection({
  permission,
  intensity,
}: {
  permission: AlertPermissionState;
  intensity: AlertIntensity;
}): ReactElement {
  const t = useT();
  const theme = usePaperTheme();
  const openSettings = useOpenSystemSettings();
  const status = permission.permission;
  const notificationsGranted = status?.notifications === 'granted';
  const showOpenNotificationSettings = status !== null && status.notifications === 'denied' && !status.canAskAgain;

  return (
    <View>
      <Section title={t('onboarding:alerts.permission.title')}>
        <Text variant="bodyMedium">{t('onboarding:alerts.permission.description')}</Text>
        {notificationsGranted ? (
          <Text variant="labelLarge" style={[styles.status, { color: theme.colors.primary }]}>
            {t('onboarding:alerts.permission.granted')}
          </Text>
        ) : null}
        {status?.notifications === 'provisional' ? (
          <HelperText type="info" visible>
            {t('onboarding:alerts.permission.provisional')}
          </HelperText>
        ) : null}
        {status !== null && !notificationsGranted && !showOpenNotificationSettings ? (
          <Button
            mode="contained-tonal"
            icon="bell-ring-outline"
            style={styles.action}
            onPress={() => {
              void permission.request();
            }}
          >
            {t('onboarding:alerts.permission.allow')}
          </Button>
        ) : null}
        {showOpenNotificationSettings ? (
          <View>
            <HelperText type="error" visible>
              {t('onboarding:alerts.permission.denied')}
            </HelperText>
            <Button mode="text" onPress={() => openSettings(() => alertEngine.openNotificationSettings())}>
              {t('common:actions.openSettings')}
            </Button>
          </View>
        ) : null}
        {permission.error ? (
          <HelperText type="error" visible>
            {permission.error}
          </HelperText>
        ) : null}
      </Section>

      {Platform.OS === 'android' && status?.exactAlarms === 'unknown' ? (
        <Section title={t('onboarding:alerts.exactAlarms.title')}>
          <Text variant="bodyMedium">{t('onboarding:alerts.exactAlarms.description')}</Text>
          <Button
            mode="contained-tonal"
            icon="alarm"
            style={styles.action}
            onPress={() => openSettings(() => alertEngine.openExactAlarmSettings())}
          >
            {t('onboarding:alerts.exactAlarms.open')}
          </Button>
        </Section>
      ) : null}

      {Platform.OS === 'android' && intensity === 'max' ? (
        <Section title={t('alerts:settings.dnd.title')}>
          <Text variant="bodyMedium">{t('alerts:settings.dnd.androidDescription')}</Text>
          <Button
            mode="contained-tonal"
            icon="bell-alert-outline"
            style={styles.action}
            onPress={() => openSettings(() => alertEngine.openAlarmChannelSettings())}
            testID="alerts-dnd-open"
          >
            {t('alerts:settings.dnd.open')}
          </Button>
        </Section>
      ) : null}

      {Platform.OS === 'ios' ? (
        <Section title={t('onboarding:alerts.timeSensitive.title')}>
          <Text variant="bodyMedium">{t('onboarding:alerts.timeSensitive.description')}</Text>
          <Text variant="bodyMedium" style={styles.status}>
            {t('alerts:settings.dnd.iosDescription')}
          </Text>
          <Button mode="text" onPress={() => openSettings(() => alertEngine.openAlarmChannelSettings())}>
            {t('common:actions.openSettings')}
          </Button>
        </Section>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 4,
  },
  disabled: {
    opacity: 0.4,
  },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  previewLabel: {
    marginTop: 12,
  },
  subheading: {
    marginTop: 16,
    marginBottom: 8,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  chip: {
    marginRight: 8,
    marginBottom: 8,
  },
  action: {
    marginTop: 12,
    alignSelf: 'flex-start',
  },
  status: {
    marginTop: 12,
  },
});
