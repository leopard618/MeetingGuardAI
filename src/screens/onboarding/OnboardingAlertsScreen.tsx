/**
 * Onboarding step 3: alert preferences + notification permission.
 * - Intensity (with a visual preview), sound type, volume, vibration, default reminder times,
 *   master switch (src/screens/alerts/AlertPreferencesForm, shared with Settings > Alerts); saved
 *   to Preferences on "Continue" (only changed fields). "Play a sample" plays the chosen sound /
 *   voice / vibration through the alerts feedback player.
 * - Notification permission through alertEngine (channels are created before the prompt there).
 * - Android 12+: exact alarms cannot be read from JS, so the step explains them and opens the
 *   system setting; with MAXIMUM intensity it also offers the channel's "Override Do Not Disturb".
 *   iOS: explains Time Sensitive delivery and Focus.
 */
import { useState, type ReactElement } from 'react';
import Toast from 'react-native-toast-message';

import { errorMessageKey, toAppError } from '../../core/errors';
import { createLogger } from '../../core/logger';
import { useT } from '../../i18n';
import { usePreferences } from '../../services/data';
import { useAlertPermission, useAlertSample } from '../alerts/alertHooks';
import { AlertDeliverySection, AlertPreferencesForm } from '../alerts/AlertPreferencesForm';
import { buildAlertPreferencesPatch, draftFromPreferences, isDraftValid, type AlertDraft } from './alertOptions';
import { OnboardingLayout, useOnboardingNavigation } from './OnboardingLayout';

const log = createLogger('onboarding');

export function OnboardingAlertsScreen(): ReactElement {
  const t = useT();
  const { goNext } = useOnboardingNavigation('OnboardingAlerts');
  const { preferences, update } = usePreferences();
  const [draft, setDraft] = useState<AlertDraft>(() => draftFromPreferences(preferences));
  const [saving, setSaving] = useState(false);
  const permission = useAlertPermission();
  const sample = useAlertSample();
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
      <AlertPreferencesForm draft={draft} onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))} sample={sample} />
      <AlertDeliverySection permission={permission} intensity={draft.alertIntensity} />
    </OnboardingLayout>
  );
}
