/**
 * App-root in-app alert presenter (owner: alerts) - layer L7.
 *
 * Rendered ONCE inside NavigationContainer (after RootNavigator). Subscribes to
 * alertEngine.subscribeActiveAlerts (fed by delivered notifications while foregrounded, the in-app
 * timer, and unhandled alerts still in the tray) and shows:
 *   MAX     full-screen modal, explicit action required, looping alarm with volume ramp, EN/ES
 *           voice, vibration, auto-snooze countdown;
 *   MEDIUM  persistent banner that can be minimized (not dismissed), pulse animation;
 *   LIGHT   toast, dismissible after 3 s; post-meeting follow-ups use the same toast with
 *           "Open assistant".
 * Join opens the real conference URL; details / assistant go through the navigation deep links.
 * "Running late" (M9) resolves the alert like Details and opens the running-late sheet for the
 * alert's occurrence (RunningLateHost, mounted next to this host).
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { Alert, Linking, StyleSheet, View } from 'react-native';

import type { TranslateFn } from '../../core/contracts';
import { errorMessageKey, toAppError } from '../../core/errors';
import { assistantDeepLink, meetingDeepLink } from '../../core/identifiers';
import { createLogger } from '../../core/logger';
import { useLanguage, useT } from '../../i18n';
import { openDeepLink } from '../../navigation';
import { openRunningLate } from '../../screens/meetings/RunningLateSheet';
import {
  LIGHT_AUTO_HIDE_MS,
  LIGHT_DISMISS_AFTER_MS,
  MAX_AUTO_SNOOZE_SECONDS,
  alertEngine,
  snoozeChoices,
  type ActiveAlertView,
  type FeedbackRequest,
  type ResolveAction,
} from '../../services/alerts';
import { formatTime } from '../../utils/format';
import { buildAlertDisplay, type AlertDisplayModel } from './alertDisplay';
import { useNow } from './hooks';
import { LightAlertToast } from './LightAlertToast';
import { MaxAlertModal } from './MaxAlertModal';
import { MediumAlertBanner } from './MediumAlertBanner';

const log = createLogger('alerts.host');
const DISPLAY_REFRESH_MS = 15_000;

function feedbackFor(alert: ActiveAlertView, display: AlertDisplayModel): FeedbackRequest {
  const isFollowUp = alert.kind === 'followup';
  return {
    intensity: isFollowUp ? 'followup' : alert.intensity,
    soundType: alert.prefs.soundType,
    volume: alert.prefs.volume,
    vibrationEnabled: alert.prefs.vibrationEnabled,
    voice: isFollowUp ? null : { text: display.voiceText, language: display.voiceLanguage },
  };
}

function openLink(url: string): boolean {
  try {
    return openDeepLink(url);
  } catch (error) {
    log.error('navigation from an alert failed', error);
    return false;
  }
}

interface AlertActions {
  resolve(alert: ActiveAlertView, action: ResolveAction, snoozeMinutes?: number): void;
  join(alert: ActiveAlertView): void;
  details(alert: ActiveAlertView): void;
  assistant(alert: ActiveAlertView): void;
  runningLate(alert: ActiveAlertView): void;
}

function useAlertActions(t: TranslateFn): AlertActions {
  return useMemo<AlertActions>(() => {
    const resolve = (alert: ActiveAlertView, action: ResolveAction, snoozeMinutes?: number) => {
      alertEngine
        .resolveActiveAlert(alert.key, action, snoozeMinutes !== undefined ? { snoozeMinutes } : {})
        .catch((error: unknown) => {
          const appError = toAppError(error);
          log.error(`could not ${action} the alert (${appError.code})`, appError);
          if (action === 'snooze') Alert.alert(t('alerts:errors.snoozeFailed'), t(errorMessageKey(appError.code)));
        });
    };
    return {
      resolve,
      join(alert) {
        const url = alert.joinUrl;
        resolve(alert, 'open');
        if (!url) return;
        Linking.openURL(url).catch((error: unknown) => {
          log.warn('could not open the meeting link', error);
          Alert.alert(t('alerts:errors.openLinkFailed'));
        });
      },
      details(alert) {
        resolve(alert, 'open');
        if (!openLink(meetingDeepLink(alert.meetingId))) log.warn('meeting deep link was not handled');
      },
      assistant(alert) {
        resolve(alert, 'open');
        if (!openLink(assistantDeepLink({ followUpMeetingId: alert.meetingId }))) {
          log.warn('assistant deep link was not handled');
        }
      },
      runningLate(alert) {
        // The alarm stops (the user is acting on it) and the full-screen modal unmounts, so the
        // sheet, a Portal below it, becomes visible. The alert's startAt names the occurrence.
        resolve(alert, 'open');
        openRunningLate({ meetingId: alert.meetingId, startAt: alert.startAt });
      },
    };
  }, [t]);
}

function ActiveAlerts({ alerts }: { alerts: ActiveAlertView[] }): ReactElement {
  const t = useT();
  const { language } = useLanguage();
  const now = useNow(DISPLAY_REFRESH_MS);
  const actions = useAlertActions(t);

  const display = useCallback(
    (alert: ActiveAlertView): AlertDisplayModel =>
      buildAlertDisplay(
        {
          title: alert.title,
          startAt: alert.startAt,
          durationMinutes: alert.durationMinutes,
          locationText: alert.locationText,
          joinUrl: alert.joinUrl,
          language: alert.language,
        },
        { t, formatTime, uiLanguage: language, use24Hour: alert.prefs.use24HourClock, now },
      ),
    [t, language, now],
  );

  const max = alerts.find((alert) => alert.kind !== 'followup' && alert.intensity === 'max');
  const medium = alerts.find((alert) => alert.kind !== 'followup' && alert.intensity === 'medium');
  const light = alerts.find((alert) => alert.kind === 'followup' || alert.intensity === 'light');

  const mediumDisplay = medium ? display(medium) : null;
  const lightDisplay = light ? display(light) : null;
  const maxDisplay = max ? display(max) : null;

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {medium && mediumDisplay ? (
        <MediumAlertBanner
          key={medium.key}
          display={mediumDisplay}
          snoozeMinutes={medium.prefs.snoozeMinutes}
          feedback={feedbackFor(medium, mediumDisplay)}
          onAcknowledge={() => actions.resolve(medium, 'acknowledge')}
          onSnooze={(minutes) => actions.resolve(medium, 'snooze', minutes)}
          onJoin={medium.joinUrl ? () => actions.join(medium) : null}
          onDetails={() => actions.details(medium)}
          onRunningLate={medium.meeting ? () => actions.runningLate(medium) : null}
        />
      ) : null}
      {light && lightDisplay ? (
        <LightAlertToast
          key={light.key}
          variant={light.kind === 'followup' ? 'followup' : 'light'}
          display={lightDisplay}
          feedback={feedbackFor(light, lightDisplay)}
          dismissAfterMs={LIGHT_DISMISS_AFTER_MS}
          autoHideMs={light.kind === 'followup' ? null : LIGHT_AUTO_HIDE_MS}
          onDismiss={() => actions.resolve(light, 'acknowledge')}
          onOpen={light.kind === 'followup' ? () => actions.assistant(light) : () => actions.details(light)}
        />
      ) : null}
      {max && maxDisplay ? (
        <MaxAlertModal
          key={max.key}
          display={maxDisplay}
          snoozeOptions={snoozeChoices(max.prefs.snoozeMinutes)}
          autoSnoozeSeconds={MAX_AUTO_SNOOZE_SECONDS}
          feedback={feedbackFor(max, maxDisplay)}
          onAcknowledge={() => actions.resolve(max, 'acknowledge')}
          onSnooze={(minutes) => actions.resolve(max, 'snooze', minutes)}
          onJoin={max.joinUrl ? () => actions.join(max) : null}
          onDetails={() => actions.details(max)}
          onRunningLate={max.meeting ? () => actions.runningLate(max) : null}
        />
      ) : null}
    </View>
  );
}

/** Takes no props. Render once inside NavigationContainer, after RootNavigator. */
export function AlertHost(): ReactElement | null {
  const [alerts, setAlerts] = useState<ActiveAlertView[]>(() => alertEngine.getActiveAlerts());
  useEffect(() => alertEngine.subscribeActiveAlerts(setAlerts), []);
  if (alerts.length === 0) return null;
  return <ActiveAlerts alerts={alerts} />;
}

export default AlertHost;
