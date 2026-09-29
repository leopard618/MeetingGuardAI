/**
 * Headless entry (owner: alerts) - layer L7.
 *
 * index.js imports this module BEFORE registerRootComponent (after './src/i18n'):
 *     import './src/services/alerts/tasks';
 * At module scope it:
 *   - installs the foreground notification presentation handler (alertEngine);
 *   - defines BACKGROUND_TASKS.refresh (expo-background-task): withHeadlessSession ->
 *     calendarSyncEngine.syncNow({ reason: 'background', headless: true }) -> alertEngine.reconcile('background');
 *   - defines BACKGROUND_TASKS.notificationResponse (expo-notifications registerTaskAsync): Android
 *     runs it for action buttons tapped while the app is not in the foreground (snooze);
 *   - registers both on 'session:started' and unregisters them on 'session:ended'.
 * The refresh task only refreshes the rolling window of already-scheduled notifications: alert
 * delivery never depends on it. A failure to load data aborts the reconcile without touching the
 * schedule (never "cancel everything because the list came back empty").
 */
import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

import type { BackgroundTasksModule } from '../../core/contracts';
import { toAppError } from '../../core/errors';
import { appEvents } from '../../core/events';
import { BACKGROUND_REFRESH_INTERVAL_MINUTES, BACKGROUND_TASKS } from '../../core/identifiers';
import { createLogger } from '../../core/logger';
import { sessionManager } from '../auth';
import { calendarSyncEngine } from '../calendar';
import { alertEngine } from './engine';
import { toIncomingResponse } from './expoNotificationsPort';

const log = createLogger('alerts.tasks');

/** OS minimum for expo-background-task (WorkManager / BGTaskScheduler). */
const MIN_BACKGROUND_INTERVAL_MINUTES = 15;

/** Body of BACKGROUND_TASKS.refresh (exported for tests / manual triggering). */
export async function runBackgroundRefresh(): Promise<BackgroundTask.BackgroundTaskResult> {
  try {
    const result = await sessionManager.withHeadlessSession(async () => {
      try {
        const report = await calendarSyncEngine.syncNow({ reason: 'background', headless: true });
        if (report.errors.length > 0) {
          log.warn(`background calendar sync finished with errors: ${report.errors.map((e) => `${e.provider}:${e.code}`).join(', ')}`);
        }
      } catch (error) {
        // Calendar problems must not prevent the alert window from being refreshed.
        log.warn(`background calendar sync failed (${toAppError(error).code})`, error);
      }
      return alertEngine.reconcile('background');
    });
    if (result === null) log.info('background refresh: nobody is signed in');
    else if (result.skipped) log.info(`background refresh: reconcile skipped (${result.skipped})`);
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (error) {
    log.error('background refresh failed', error);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
}

/** Body of BACKGROUND_TASKS.notificationResponse (Android action buttons, app not in foreground). */
export async function runNotificationResponseTask(body: TaskManager.TaskManagerTaskBody<unknown>): Promise<void> {
  if (body.error) {
    log.error(`notification response task error: ${body.error.message}`);
    return;
  }
  const response = toIncomingResponse(body.data);
  if (!response) return; // remote-notification payloads: this app does not use push
  try {
    await alertEngine.handleNotificationResponse(response, 'background');
  } catch (error) {
    log.error('could not handle a background notification action', error);
  }
}

export const registerBackgroundTasks: BackgroundTasksModule['registerBackgroundTasks'] = async () => {
  const failures: unknown[] = [];
  try {
    if (!(await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASKS.notificationResponse))) {
      await Notifications.registerTaskAsync(BACKGROUND_TASKS.notificationResponse);
    }
  } catch (error) {
    failures.push(error);
    log.error('could not register the notification response task', error);
  }
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status !== BackgroundTask.BackgroundTaskStatus.Available) {
      log.warn('background refresh is restricted by the OS; alerts are refreshed when the app opens');
    } else if (!(await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASKS.refresh))) {
      await BackgroundTask.registerTaskAsync(BACKGROUND_TASKS.refresh, {
        minimumInterval: Math.max(MIN_BACKGROUND_INTERVAL_MINUTES, BACKGROUND_REFRESH_INTERVAL_MINUTES),
      });
    }
  } catch (error) {
    failures.push(error);
    log.error('could not register the background refresh task', error);
  }
  if (failures.length > 0) throw toAppError(failures[0]);
};

export const unregisterBackgroundTasks: BackgroundTasksModule['unregisterBackgroundTasks'] = async () => {
  const failures: unknown[] = [];
  try {
    if (await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASKS.refresh)) {
      await BackgroundTask.unregisterTaskAsync(BACKGROUND_TASKS.refresh);
    }
  } catch (error) {
    failures.push(error);
  }
  try {
    if (await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASKS.notificationResponse)) {
      await Notifications.unregisterTaskAsync(BACKGROUND_TASKS.notificationResponse);
    }
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0) {
    log.error('could not unregister background tasks', failures[0]);
    throw toAppError(failures[0]);
  }
};

// ---- module scope (runs once per JS runtime, before the root component) ----------------------
try {
  alertEngine.installPresentationHandler();
  if (!TaskManager.isTaskDefined(BACKGROUND_TASKS.refresh)) {
    TaskManager.defineTask(BACKGROUND_TASKS.refresh, () => runBackgroundRefresh());
  }
  if (!TaskManager.isTaskDefined(BACKGROUND_TASKS.notificationResponse)) {
    TaskManager.defineTask<unknown>(BACKGROUND_TASKS.notificationResponse, (body) => runNotificationResponseTask(body));
  }
} catch (error) {
  log.error('could not define the alert background tasks', error);
}

appEvents.on('session:started', () => {
  registerBackgroundTasks().catch(() => undefined); // failures are logged above
});
appEvents.on('session:ended', () => {
  unregisterBackgroundTasks().catch(() => undefined);
});
