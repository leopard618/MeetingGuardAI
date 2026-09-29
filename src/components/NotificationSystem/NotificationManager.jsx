/**
 * COMPAT SHIM (owner: alerts; stage 3 removes it). Legacy props API kept for Dashboard.jsx and
 * Settings.jsx (intensity preview): { meeting, isOpen, onClose, onSnooze, onPostpone, language,
 * alertType, intensity }.
 *
 * Real meeting alerts are no longer rendered by screens: AlertHost (src/components/alerts) shows
 * them app-wide from the alert engine. This shim renders the same MAX / MEDIUM / LIGHT components
 * for a legacy meeting object (toLegacyMeetingView shape or { title, date, time, location }).
 * `onPostpone` is not supported by the new alerts (no postpone button is shown). `language` is
 * ignored: text follows the app language (src/i18n).
 */
import React, { useMemo } from 'react';

import { fromLegacyIntensity } from '../../core/legacy';
import { DEFAULT_PREFERENCES } from '../../core/types';
import { useLanguage, useT } from '../../i18n';
import { LIGHT_AUTO_HIDE_MS, LIGHT_DISMISS_AFTER_MS, MAX_AUTO_SNOOZE_SECONDS, snoozeChoices } from '../../services/alerts';
import { formatTime } from '../../utils/format';
import { buildAlertDisplay, displayInputFromLegacyMeeting } from '../alerts/alertDisplay';
import { useNow } from '../alerts/hooks';
import { LightAlertToast } from '../alerts/LightAlertToast';
import { MaxAlertModal } from '../alerts/MaxAlertModal';
import { MediumAlertBanner } from '../alerts/MediumAlertBanner';

/** Legacy alertType -> intensity (used only when no intensity prop is given). */
function intensityFromAlertType(alertType) {
  switch (alertType) {
    case '5min':
    case '1min':
    case 'now':
      return 'max';
    case '15min':
      return 'medium';
    default:
      return 'light';
  }
}

function PreviewAlert({ meeting, intensity, onClose, onSnooze }) {
  const t = useT();
  const { language } = useLanguage();
  const now = useNow(15_000);
  const input = useMemo(() => displayInputFromLegacyMeeting(meeting, language), [meeting, language]);
  const display = useMemo(
    () => (input ? buildAlertDisplay(input, { t, formatTime, uiLanguage: language, use24Hour: null, now }) : null),
    [input, t, language, now],
  );
  if (!display) return null;

  const feedback = {
    intensity,
    soundType: DEFAULT_PREFERENCES.alertSoundType,
    volume: DEFAULT_PREFERENCES.alertVolume,
    vibrationEnabled: DEFAULT_PREFERENCES.vibrationEnabled,
    voice: { text: display.voiceText, language: display.voiceLanguage },
  };
  const close = () => onClose && onClose();
  const snooze = (minutes) => (onSnooze ? onSnooze(minutes) : close());
  const snoozeOptions = snoozeChoices(DEFAULT_PREFERENCES.snoozeMinutes);

  if (intensity === 'max') {
    return (
      <MaxAlertModal
        display={display}
        snoozeOptions={snoozeOptions}
        autoSnoozeSeconds={MAX_AUTO_SNOOZE_SECONDS}
        feedback={feedback}
        onAcknowledge={close}
        onSnooze={snooze}
        onJoin={null}
        onDetails={null}
      />
    );
  }
  if (intensity === 'medium') {
    return (
      <MediumAlertBanner
        display={display}
        snoozeMinutes={snoozeOptions[0]}
        feedback={feedback}
        onAcknowledge={close}
        onSnooze={snooze}
        onJoin={null}
        onDetails={null}
      />
    );
  }
  return (
    <LightAlertToast
      variant="light"
      display={display}
      feedback={feedback}
      dismissAfterMs={LIGHT_DISMISS_AFTER_MS}
      autoHideMs={LIGHT_AUTO_HIDE_MS}
      onDismiss={close}
      onOpen={null}
    />
  );
}

export default function NotificationManager({ meeting, isOpen, onClose, onSnooze, alertType = '15min', intensity = null }) {
  if (!isOpen || !meeting) return null;
  const resolved = fromLegacyIntensity(intensity) ?? intensityFromAlertType(alertType);
  return <PreviewAlert meeting={meeting} intensity={resolved} onClose={onClose} onSnooze={onSnooze} />;
}
