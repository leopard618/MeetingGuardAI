/**
 * Settings > Alerts (route "AlertSettings"): every alert preference after onboarding — master
 * switch, intensity, sound type, volume, vibration, default reminder times, snooze length,
 * post-meeting follow-ups, 12 h / 24 h clock — plus notification permission, exact alarms and the
 * "Override Do Not Disturb" setting of the MAXIMUM channel. Saved with usePreferences().update
 * (only the changed fields); the alert engine reschedules everything from preferences:changed.
 */
import { useNavigation } from '@react-navigation/native';
import { useState, type ReactElement } from 'react';
import Toast from 'react-native-toast-message';

import { errorMessageKey, toAppError } from '../../core/errors';
import { createLogger } from '../../core/logger';
import { useT } from '../../i18n';
import { usePreferences } from '../../services/data';
import { ScreenBody } from '../shared/Section';
import { useAlertPermission, useAlertSample } from './alertHooks';
import { AlertDeliverySection, AlertExtraSettings, AlertPreferencesForm } from './AlertPreferencesForm';
import {
  buildAlertSettingsPatch,
  isSettingsDraftValid,
  settingsDraftFromPreferences,
  type AlertSettingsDraft,
} from './alertSettings';

const log = createLogger('alert-settings');

export function AlertSettingsScreen(): ReactElement {
  const t = useT();
  const navigation = useNavigation();
  const { preferences, update } = usePreferences();
  const [draft, setDraft] = useState<AlertSettingsDraft>(() => settingsDraftFromPreferences(preferences));
  const [saving, setSaving] = useState(false);
  const permission = useAlertPermission();
  const sample = useAlertSample();
  const patch = buildAlertSettingsPatch(preferences, draft);
  const dirty = Object.keys(patch).length > 0;
  const valid = isSettingsDraftValid(draft);

  const change = (value: Partial<AlertSettingsDraft>): void => {
    setDraft((current) => ({ ...current, ...value }));
  };

  const save = async (): Promise<void> => {
    sample.stop();
    if (!dirty) {
      navigation.goBack();
      return;
    }
    setSaving(true);
    try {
      await update(patch);
      Toast.show({ type: 'success', text1: t('alerts:settings.saved') });
      navigation.goBack();
    } catch (caught) {
      const error = toAppError(caught);
      log.error('could not save the alert settings', error);
      Toast.show({ type: 'error', text1: t(errorMessageKey(error.code)) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScreenBody
      primaryLabel={t('common:actions.save')}
      onPrimary={() => {
        void save();
      }}
      primaryDisabled={!valid}
      primaryLoading={saving}
      primaryTestID="alert-settings-save"
    >
      <AlertPreferencesForm draft={draft} onChange={change} sample={sample} />
      <AlertExtraSettings draft={draft} onChange={change} />
      <AlertDeliverySection permission={permission} intensity={draft.alertIntensity} />
    </ScreenBody>
  );
}
