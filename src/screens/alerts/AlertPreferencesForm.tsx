/**
 * Alert preferences form shared by onboarding step 3 and Settings > Alerts:
 * master switch, intensity (+ visual preview and an audible sample), sound type (with the
 * "voice needs the app open" note), volume, vibration and default reminder times. `extended`
 * (settings screen) adds the snooze length, post-meeting follow-ups and the daily briefing.
 *
 * AlertDeliverySection: notification permission, Android exact alarms and the MAX channel's
 * "Override Do Not Disturb" setting, and the iOS Focus explanation.
 */
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useState, type ReactElement } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Button, Chip, HelperText, RadioButton, SegmentedButtons, Switch, Text, TouchableRipple } from 'react-native-paper';

import { Badge, MGButton } from '../../components/ui';
import { ALERT_INTENSITIES, ALERT_SOUND_TYPES, type AlertIntensity, type AlertSoundType } from '../../core/types';
import { FEATURES } from '../../core/features';
import { useT } from '../../i18n';
import { alertEngine, fullScreenAlarm } from '../../services/alerts';
import { radii, spacing, useAppTheme } from '../../theme';
import { AlertPreview } from '../onboarding/AlertPreview';
import { dateToDueTime } from '../tasks/tasksModel';
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
import { useFullScreenAlarmStatus, useOpenSystemSettings } from './alertHooks';
import { briefingTimeToDate, snoozeChoices, type AlertSettingsDraft } from './alertSettings';

export interface AlertPreferencesFormProps<D extends AlertDraft> {
  draft: D;
  onChange(patch: Partial<D>): void;
  sample: AlertSample;
}

export function AlertPreferencesForm<D extends AlertDraft>({ draft, onChange, sample }: AlertPreferencesFormProps<D>): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
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
            {ALERT_INTENSITIES.map((intensity) => {
              const selected = draft.alertIntensity === intensity;
              return (
                <TouchableRipple
                  key={intensity}
                  onPress={() => patch({ alertIntensity: intensity })}
                  style={[styles.radioOption, selected && { backgroundColor: colors.surfaceContainerHigh }]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                >
                  <View style={styles.radioRow}>
                    <RadioButton value={intensity} />
                    <View style={styles.flex}>
                      <Text variant="titleSmall">{t(`onboarding:alerts.intensity.${intensity}.title`)}</Text>
                      <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                        {t(`onboarding:alerts.intensity.${intensity}.description`)}
                      </Text>
                    </View>
                  </View>
                </TouchableRipple>
              );
            })}
          </RadioButton.Group>
          <Text variant="labelMedium" style={[styles.previewLabel, { color: colors.onSurfaceVariant }]}>
            {t('onboarding:alerts.preview.label')}
          </Text>
          <AlertPreview intensity={draft.alertIntensity} />
          <MGButton
            variant="tonal"
            icon={sample.playing ? 'stop' : 'play'}
            style={styles.action}
            onPress={() => (sample.playing ? sample.stop() : sample.play(draft))}
          >
            {t(sample.playing ? 'onboarding:alerts.preview.stop' : 'onboarding:alerts.preview.play')}
          </MGButton>
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
          <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
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

/** Settings-only fields: snooze length, post-meeting follow-ups and the daily briefing. */
export function AlertExtraSettings({
  draft,
  onChange,
}: {
  draft: AlertSettingsDraft;
  onChange(patch: Partial<AlertSettingsDraft>): void;
}): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const [pickingTime, setPickingTime] = useState(false);

  function onTimePicked(event: DateTimePickerEvent, value?: Date): void {
    // Android closes the dialog itself and fires once; iOS keeps the picker inline.
    if (Platform.OS === 'android') setPickingTime(false);
    if (event.type === 'dismissed' || !value) return;
    onChange({ briefingTime: dateToDueTime(value) });
  }

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
          <Text variant="bodyMedium" style={[styles.flex, { color: colors.onSurfaceVariant }]}>
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
      <Section title={t('alerts:settings.briefing.label')}>
        <View style={styles.switchRow}>
          <Text variant="bodyMedium" style={[styles.flex, { color: colors.onSurfaceVariant }]}>
            {t('alerts:settings.briefing.description')}
          </Text>
          <Switch
            value={draft.briefingEnabled}
            onValueChange={(value) => onChange({ briefingEnabled: value })}
            accessibilityLabel={t('alerts:settings.briefing.label')}
            testID="alerts-briefing"
          />
        </View>
        {draft.briefingEnabled ? (
          <View>
            <Button mode="outlined" onPress={() => setPickingTime(true)} testID="alerts-briefing-time">
              {t('alerts:settings.briefing.at', { time: draft.briefingTime })}
            </Button>
            {pickingTime ? (
              <DateTimePicker
                value={briefingTimeToDate(draft.briefingTime)}
                mode="time"
                onChange={onTimePicked}
                {...(Platform.OS === 'ios' ? { display: 'spinner' as const } : {})}
                testID="alerts-briefing-picker"
              />
            ) : null}
            {Platform.OS === 'ios' && pickingTime ? (
              <Button mode="text" onPress={() => setPickingTime(false)} testID="alerts-briefing-picker-done">
                {t('alerts:settings.briefing.done')}
              </Button>
            ) : null}
          </View>
        ) : null}
      </Section>

      {FEATURES.statusNotification ? (
        <Section title={t('alerts:settings.statusNotification.label')}>
          <View style={styles.switchRow}>
            <Text variant="bodyMedium" style={[styles.flex, { color: colors.onSurfaceVariant }]}>
              {t('alerts:settings.statusNotification.description')}
            </Text>
            <Switch
              value={draft.statusNotificationEnabled}
              onValueChange={(value) => onChange({ statusNotificationEnabled: value })}
              accessibilityLabel={t('alerts:settings.statusNotification.label')}
              testID="alerts-status-notification"
            />
          </View>
        </Section>
      ) : null}
    </View>
  );
}

/**
 * Delivery: notification permission, exact alarms (Android 12+; a real granted/denied read when
 * the mg-fullscreen-alarm module is in the binary), full-screen alarms (Android with the module;
 * revocable on Android 14+), Do Not Disturb override of the MAX channel (Android) / Focus and
 * Time Sensitive (iOS).
 */
export function AlertDeliverySection({
  permission,
  intensity,
}: {
  permission: AlertPermissionState;
  intensity: AlertIntensity;
}): ReactElement {
  const t = useT();
  const openSettings = useOpenSystemSettings();
  const fullScreen = useFullScreenAlarmStatus();
  const status = permission.permission;
  const notificationsGranted = status?.notifications === 'granted';
  const showOpenNotificationSettings = status !== null && status.notifications === 'denied' && !status.canAskAgain;
  // Without the native module there is no JS read of the exact-alarm state: null = unknown.
  const exactAllowed = fullScreen.available && fullScreen.status !== null ? fullScreen.status.exactAllowed : null;

  return (
    <View>
      <Section title={t('onboarding:alerts.permission.title')}>
        <Text variant="bodyMedium">{t('onboarding:alerts.permission.description')}</Text>
        {notificationsGranted ? (
          <Badge tone="success" label={t('onboarding:alerts.permission.granted')} style={styles.status} />
        ) : null}
        {status?.notifications === 'provisional' ? (
          <HelperText type="info" visible>
            {t('onboarding:alerts.permission.provisional')}
          </HelperText>
        ) : null}
        {status !== null && !notificationsGranted && !showOpenNotificationSettings ? (
          <MGButton
            variant="tonal"
            icon="bell-ring-outline"
            style={styles.action}
            onPress={() => {
              void permission.request();
            }}
          >
            {t('onboarding:alerts.permission.allow')}
          </MGButton>
        ) : null}
        {showOpenNotificationSettings ? (
          <View>
            <HelperText type="error" visible>
              {t('onboarding:alerts.permission.denied')}
            </HelperText>
            <MGButton variant="ghost" style={styles.action} onPress={() => openSettings(() => alertEngine.openNotificationSettings())}>
              {t('common:actions.openSettings')}
            </MGButton>
          </View>
        ) : null}
        {permission.error ? (
          <HelperText type="error" visible>
            {permission.error}
          </HelperText>
        ) : null}
      </Section>

      {status?.exactAlarms === 'unknown' ? (
        <Section title={t('onboarding:alerts.exactAlarms.title')}>
          {exactAllowed === true ? (
            <Badge tone="success" label={t('alerts:settings.exactAlarms.granted')} testID="alerts-exact-granted" />
          ) : (
            <View>
              <Text variant="bodyMedium">{t('onboarding:alerts.exactAlarms.description')}</Text>
              <MGButton
                variant="tonal"
                icon="alarm"
                style={styles.action}
                onPress={() => openSettings(() => alertEngine.openExactAlarmSettings())}
              >
                {t('onboarding:alerts.exactAlarms.open')}
              </MGButton>
            </View>
          )}
        </Section>
      ) : null}

      {fullScreen.available ? (
        <Section title={t('alerts:settings.fullScreen.title')}>
          <Text variant="bodyMedium">{t('alerts:settings.fullScreen.description')}</Text>
          {fullScreen.status !== null ? (
            fullScreen.status.fullScreenAllowed ? (
              <Badge tone="success" label={t('alerts:settings.fullScreen.allowed')} style={styles.status} testID="alerts-fullscreen-allowed" />
            ) : (
              // fullScreenAllowed can only be false on Android 14+, where the system settings
              // page (openFullScreenIntentSettings) exists.
              <View>
                <HelperText type="error" visible>
                  {t('alerts:settings.fullScreen.denied')}
                </HelperText>
                <MGButton
                  variant="tonal"
                  icon="cellphone-lock"
                  style={styles.action}
                  onPress={() => openSettings(() => fullScreenAlarm.openFullScreenIntentSettings())}
                  testID="alerts-fullscreen-open"
                >
                  {t('alerts:settings.fullScreen.open')}
                </MGButton>
              </View>
            )
          ) : null}
        </Section>
      ) : null}

      {Platform.OS === 'android' && intensity === 'max' ? (
        <Section title={t('alerts:settings.dnd.title')}>
          <Text variant="bodyMedium">{t('alerts:settings.dnd.androidDescription')}</Text>
          <MGButton
            variant="tonal"
            icon="bell-alert-outline"
            style={styles.action}
            onPress={() => openSettings(() => alertEngine.openAlarmChannelSettings())}
            testID="alerts-dnd-open"
          >
            {t('alerts:settings.dnd.open')}
          </MGButton>
        </Section>
      ) : null}

      {Platform.OS === 'ios' ? (
        <Section title={t('onboarding:alerts.timeSensitive.title')}>
          <Text variant="bodyMedium">{t('onboarding:alerts.timeSensitive.description')}</Text>
          <Text variant="bodyMedium" style={styles.status}>
            {t('alerts:settings.dnd.iosDescription')}
          </Text>
          <MGButton variant="ghost" style={styles.action} onPress={() => openSettings(() => alertEngine.openAlarmChannelSettings())}>
            {t('common:actions.openSettings')}
          </MGButton>
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
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  disabled: {
    opacity: 0.4,
  },
  radioOption: {
    borderRadius: radii.sm,
    paddingHorizontal: spacing.xs,
  },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  previewLabel: {
    marginTop: spacing.md,
  },
  subheading: {
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.sm,
  },
  chip: {
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
  },
  action: {
    marginTop: spacing.md,
    alignSelf: 'flex-start',
  },
  status: {
    marginTop: spacing.md,
  },
});
