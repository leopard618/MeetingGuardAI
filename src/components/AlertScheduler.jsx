/**
 * COMPAT SHIM (owner: alerts; stage 3 removes it). Dashboard.jsx still renders
 * <AlertScheduler ref onTriggerAlert language alertsEnabled />.
 *
 * Alerts are no longer scheduled by a screen: the alert engine reconciles OS notifications on
 * every meeting / preference / session change and AlertHost shows in-app alerts app-wide. This
 * component renders nothing; its ref methods trigger an engine reconcile and resolve with the
 * ReconcileResult (they reject with an AppError when the reconcile fails). `onTriggerAlert`,
 * `language` and `alertsEnabled` are ignored (Preferences.alertEnabled drives the engine).
 */
import { forwardRef, useImperativeHandle } from 'react';

import { alertEngine } from '../services/alerts';

const AlertScheduler = forwardRef(function AlertScheduler(_props, ref) {
  useImperativeHandle(
    ref,
    () => ({
      scheduleAlertsForMeeting: () => alertEngine.reconcile('meetings_changed'),
      clearAlertsForMeeting: () => alertEngine.reconcile('meetings_changed'),
      refreshAlerts: () => alertEngine.reconcile('manual'),
    }),
    [],
  );
  return null;
});

export default AlertScheduler;
