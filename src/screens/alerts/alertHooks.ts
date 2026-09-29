/**
 * Hooks shared by the alert settings screens (onboarding step 3 and Settings > Alerts).
 * - useAlertPermission: notification permission through alertEngine (re-checked on focus and when
 *   the app returns from the system settings).
 * - useAlertSample: audible sample of the chosen settings through the alerts feedback player.
 */
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import Toast from 'react-native-toast-message';

import type { AlertPermissionStatus } from '../../core/contracts';
import { errorMessageKey, toAppError } from '../../core/errors';
import { createLogger } from '../../core/logger';
import { useLanguage, useT } from '../../i18n';
import { alertEngine, alertFeedback, type FeedbackHandle } from '../../services/alerts';
import type { AlertDraft } from '../onboarding/alertOptions';

const log = createLogger('alert-settings');

export interface AlertPermissionState {
  permission: AlertPermissionStatus | null;
  error: string | null;
  refresh(): void;
  request(): Promise<void>;
}

export function useAlertPermission(): AlertPermissionState {
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

  // Re-check when the screen is shown and when the user comes back from the system settings.
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

export interface AlertSample {
  playing: boolean;
  play(draft: AlertDraft): void;
  stop(): void;
}

/**
 * Audible sample of the chosen settings through the alerts area's feedback player (the same
 * sound / voice / vibration AlertHost uses). Stops after SAMPLE_DURATION_MS, on blur and on unmount.
 */
export function useAlertSample(): AlertSample {
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

  // Leaving the screen (blur or unmount) always silences the sample.
  useFocusEffect(useCallback(() => stop, [stop]));

  return { playing, play, stop };
}

/** Opens a system settings screen; failures become a toast. */
export function useOpenSystemSettings(): (open: () => Promise<void>) => void {
  const t = useT();
  return useCallback(
    (open: () => Promise<void>) => {
      open().catch((caught: unknown) => {
        const error = toAppError(caught);
        log.warn('could not open the system settings', error.code);
        Toast.show({ type: 'error', text1: t(errorMessageKey(error.code)) });
      });
    },
    [t],
  );
}
