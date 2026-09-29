/**
 * Onboarding step 3: alert preferences + notification permission.
 * - Intensity (with a visual preview), sound type, volume, vibration, default reminder times,
 *   master switch; saved to Preferences on "Continue" (only changed fields). "Play a sample" plays
 *   the chosen sound / voice / vibration through the alerts feedback player.
 * - Notification permission through alertEngine (channels are created before the prompt there).
 * - Android 12+: exact alarms cannot be read from JS, so the step explains them and opens the
 *   system setting. iOS: explains Time Sensitive delivery.
 */
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';
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
import Toast from 'react-native-toast-message';

import type { AlertPermissionStatus } from '../../core/contracts';
import { errorMessageKey, toAppError } from '../../core/errors';
import { createLogger } from '../../core/logger';
import { ALERT_INTENSITIES, ALERT_SOUND_TYPES, type AlertIntensity, type AlertSoundType } from '../../core/types';
import { useLanguage, useT } from '../../i18n';
import { alertEngine, alertFeedback, type FeedbackHandle } from '../../services/alerts';
import { usePreferences } from '../../services/data';
import {
  VOLUME_LEVELS,
  alertTimeChoices,
  alertTimeLabel,
  buildAlertPreferencesPatch,
  draftFromPreferences,
  isDraftValid,
  nearestVolumeLevel,
  toggleAlertTime,
  type AlertDraft,
} from './alertOptions';
import { AlertPreview } from './AlertPreview';
import { OnboardingLayout, OnboardingSection, useOnboardingNavigation } from './OnboardingLayout';

const log = createLogger('onboarding');

function useAlertPermission(): {
  permission: AlertPermissionStatus | null;
  error: string | null;
  refresh(): void;
  request(): Promise<void>;
} {
  const t = useT();
  const [permission, setPermission] = useState<AlertPermissionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    alertEngine.getPermissionStatus().then(
      (status) => {
        setPermission(status);
        setError(null);
      },
      (caught: unknown) => {
        const appError = toAppError(caught);
        log.warn('could not read the notification permission', appError.code);
        setError(t(errorMessageKey(appError.code)));
      },
    );
  }, [t]);

  const request = useCallback(async () => {
    try {
      setPermission(await alertEngine.requestPermissions());
      setError(null);
    } catch (caught) {
      const appError = toAppError(caught);
      log.warn('notification permission request failed', appError.code);
      setError(t(errorMessageKey(appError.code)));
    }
  }, [t]);

  // Re-check when the step is shown and when the user comes back from the system settings.
  useFocusEffect(refresh);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  return { permission, error, refresh, request };
}

/** How long the audible sample plays before it stops by itself. */
const SAMPLE_DURATION_MS = 6_000;

/**
 * Audible sample of the chosen settings through the alerts area's feedback player (the same
 * sound / voice / vibration AlertHost uses). Stops after SAMPLE_DURATION_MS, on blur and on unmount.
 */
function useAlertSample(): { playing: boolean; play(draft: AlertDraft): void; stop(): void } {
  const t = useT();
  const { language } = useLanguage();
  const handle = useRef<FeedbackHandle | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [playing, setPlaying] = useState(false);

  const stop = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    handle.current?.stop();
    handle.current = null;
    setPlaying(false);
  }, []);

  const play = useCallback(
    (draft: AlertDraft) => {
      stop();
      try {
        handle.current = alertFeedback.start({
          intensity: draft.alertIntensity,
          soundType: draft.alertSoundType,
          volume: draft.alertVolume,
          vibrationEnabled: draft.vibrationEnabled,
          voice: draft.alertSoundType === 'sound_only' ? null : { text: t('onboarding:alerts.preview.lightText'), language },
        });
        setPlaying(true);
        timer.current = setTimeout(stop, SAMPLE_DURATION_MS);
      } catch (caught) {
        const error = toAppError(caught);
        log.warn('could not play the alert sample', error.code);
        Toast.show({ type: 'error', text1: t(errorMessageKey(error.code)) });
      }
    },
    [language, stop, t],
  );

  // Leaving the step (blur or unmount) always silences the sample.
  useFocusEffect(useCallback(() => stop, [stop]));

  return { playing, play, stop };
}

export function OnboardingAlertsScreen(): ReactElement {
  const t = useT();
  const theme = usePaperTheme();
  const { goNext } = useOnboardingNavigation('OnboardingAlerts');
  const { preferences, update } = usePreferences();
  const [draft, setDraft] = useState<AlertDraft>(() => draftFromPreferences(preferences));
  const [saving, setSaving] = useState(false);
  const { permission, error: permissionError, request } = useAlertPermission();
  const sample = useAlertSample();

  const patchDraft = (patch: Partial<AlertDraft>): void => {
    sample.stop();
    setDraft((current) => ({ ...current, ...patch }));
  };
  const valid = isDraftValid(draft);

  const saveAndContinue = async (): Promise<void> => {
    sample.stop();
    const patch = buildAlertPreferencesPatch(preferences, draft);
    if (Object.keys(patch).length === 0) {
      goNext();
      return;
    }
    setSaving(true);
    try {
      await update(patch);
      goNext();
    } catch (caught) {
      const error = toAppError(caught);
      log.error('could not save the alert preferences', error);
      Toast.show({ type: 'error', text1: t(errorMessageKey(error.code)) });
    } finally {
      setSaving(false);
    }
  };

  const openSettings = (open: () => Promise<void>): void => {
    open().catch((caught: unknown) => {
      const error = toAppError(caught);
      log.warn('could not open the system settings', error.code);
      Toast.show({ type: 'error', text1: t(errorMessageKey(error.code)) });
    });
  };

  const notificationsGranted = permission?.notifications === 'granted';
  const showOpenNotificationSettings = permission !== null && permission.notifications === 'denied' && !permission.canAskAgain;

  return (
    <OnboardingLayout
      step="OnboardingAlerts"
      title={t('onboarding:alerts.title')}
      subtitle={t('onboarding:alerts.subtitle')}
      primaryLabel={t('common:actions.continue')}
      onPrimary={() => {
        void saveAndContinue();
      }}
      primaryDisabled={!valid}
      primaryLoading={saving}
    >
      <View style={styles.switchRow}>
        <Text variant="titleMedium" style={styles.flex}>
          {t('onboarding:alerts.enabled')}
        </Text>
        <Switch value={draft.alertEnabled} onValueChange={(value) => patchDraft({ alertEnabled: value })} />
      </View>

      <View style={draft.alertEnabled ? undefined : styles.disabled} pointerEvents={draft.alertEnabled ? 'auto' : 'none'}>
        <OnboardingSection title={t('onboarding:alerts.intensity.label')}>
          <RadioButton.Group
            value={draft.alertIntensity}
            onValueChange={(value) => patchDraft({ alertIntensity: value as AlertIntensity })}
          >
            {ALERT_INTENSITIES.map((intensity) => (
              <TouchableRipple
                key={intensity}
                onPress={() => patchDraft({ alertIntensity: intensity })}
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
        </OnboardingSection>

        <OnboardingSection title={t('onboarding:alerts.sound.label')}>
          <SegmentedButtons
            value={draft.alertSoundType}
            onValueChange={(value) => patchDraft({ alertSoundType: value as AlertSoundType })}
            buttons={ALERT_SOUND_TYPES.map((type) => ({ value: type, label: t(`onboarding:alerts.sound.${type}`) }))}
          />
          <Text variant="titleSmall" style={styles.subheading}>
            {t('onboarding:alerts.volume')}
          </Text>
          <SegmentedButtons
            value={String(nearestVolumeLevel(draft.alertVolume))}
            onValueChange={(value) => patchDraft({ alertVolume: Number(value) })}
            buttons={VOLUME_LEVELS.map((level) => ({ value: String(level), label: `${Math.round(level * 100)}%` }))}
          />
          <View style={[styles.switchRow, styles.subheading]}>
            <Text variant="titleSmall" style={styles.flex}>
              {t('onboarding:alerts.vibration')}
            </Text>
            <Switch value={draft.vibrationEnabled} onValueChange={(value) => patchDraft({ vibrationEnabled: value })} />
          </View>
        </OnboardingSection>

        <OnboardingSection title={t('onboarding:alerts.times.label')}>
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
                  onPress={() => patchDraft({ defaultAlertTimes: toggleAlertTime(draft.defaultAlertTimes, minutes) })}
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
        </OnboardingSection>
      </View>

      <OnboardingSection title={t('onboarding:alerts.permission.title')}>
        <Text variant="bodyMedium">{t('onboarding:alerts.permission.description')}</Text>
        {notificationsGranted ? (
          <Text variant="labelLarge" style={[styles.status, { color: theme.colors.primary }]}>
            {t('onboarding:alerts.permission.granted')}
          </Text>
        ) : null}
        {permission?.notifications === 'provisional' ? (
          <HelperText type="info" visible>
            {t('onboarding:alerts.permission.provisional')}
          </HelperText>
        ) : null}
        {permission !== null && !notificationsGranted && !showOpenNotificationSettings ? (
          <Button
            mode="contained-tonal"
            icon="bell-ring-outline"
            style={styles.action}
            onPress={() => {
              void request();
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
        {permissionError ? (
          <HelperText type="error" visible>
            {permissionError}
          </HelperText>
        ) : null}
      </OnboardingSection>

      {Platform.OS === 'android' && permission?.exactAlarms === 'unknown' ? (
        <OnboardingSection title={t('onboarding:alerts.exactAlarms.title')}>
          <Text variant="bodyMedium">{t('onboarding:alerts.exactAlarms.description')}</Text>
          <Button
            mode="contained-tonal"
            icon="alarm"
            style={styles.action}
            onPress={() => openSettings(() => alertEngine.openExactAlarmSettings())}
          >
            {t('onboarding:alerts.exactAlarms.open')}
          </Button>
        </OnboardingSection>
      ) : null}

      {Platform.OS === 'ios' ? (
        <OnboardingSection title={t('onboarding:alerts.timeSensitive.title')}>
          <Text variant="bodyMedium">{t('onboarding:alerts.timeSensitive.description')}</Text>
        </OnboardingSection>
      ) : null}
    </OnboardingLayout>
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
