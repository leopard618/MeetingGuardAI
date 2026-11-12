/**
 * The app's alert engine singleton (owner: alerts): engineCore wired to the real ports.
 * Layer L4: imports core, i18n + format (L1), data barrel (L2). Never imports ./tasks or the auth barrel.
 */
import type { FormatOptions, TranslateFn } from '../../core/contracts';
import { appEvents } from '../../core/events';
import { createLogger } from '../../core/logger';
import { getDeviceTimeZone } from '../../core/time';
import { getLanguage, t } from '../../i18n';
import { formatTime } from '../../utils/format';
import { dataService, meetingRepository, preferencesRepository, tasksRepository } from '../data';
import { createAlertEngine, type AlertEngineImpl } from './engineCore';
import { createExpoNotificationsPort } from './expoNotificationsPort';
import { alertFeedback } from './feedback';
import { fullScreenAlarm } from './fsi';
import { createAppStatePort, createAsyncStoragePort, createSettingsPort } from './platformPorts';
import { createBriefingScheduler, type BriefingScheduler } from './briefing';
import { createStatusNotification, type StatusNotification } from './statusNotification';
import { createTaskReminders, type TaskReminders } from './taskReminders';
import type { AlertDataPort, AlertI18nPort } from './types';

const dataPort: AlertDataPort = {
  getActiveUid: () => dataService.getActiveUid(),
  listMeetings: (range) => meetingRepository.list(range),
  getMeeting: (id) => meetingRepository.get(id),
  getPreferences: () => preferencesRepository.get(),
  getCachedUpcoming: (uid, options) => meetingRepository.getCachedUpcoming(uid, options),
  getCachedPreferences: (uid) => preferencesRepository.getCached(uid),
};

// Late-bound wrappers: i18n/format are resolved at call time (headless text rendering included).
const translate: TranslateFn = (key, options) => t(key, options);
const i18nPort: AlertI18nPort = {
  t: translate,
  getLanguage: () => getLanguage(),
  formatTime: (value: string, options: FormatOptions) => formatTime(value, options),
};

export const alertEngine: AlertEngineImpl = createAlertEngine({
  notifications: createExpoNotificationsPort(),
  data: dataPort,
  i18n: i18nPort,
  settings: createSettingsPort(),
  appState: createAppStatePort(),
  storage: createAsyncStoragePort(),
  feedback: alertFeedback,
  events: appEvents,
  logger: createLogger('alerts'),
  deviceTimeZone: getDeviceTimeZone,
  fsi: fullScreenAlarm,
});

/** Task reminders (V2 Stage 1): its own mgtask:* scheduler beside the engine; started with it. */
export const taskReminders: TaskReminders = createTaskReminders({
  notifications: createExpoNotificationsPort(),
  subscribeTasks: (listener) => tasksRepository.subscribe(listener),
  getPreferences: () => preferencesRepository.get(),
  i18n: i18nPort,
  events: appEvents,
  deviceTimeZone: getDeviceTimeZone,
});

/**
 * The optional daily briefing (V2 Stage 1, week 4): its own mgbrief:* scheduler, started with
 * the engine. It reads meetings and tasks itself so the background refresh can reconcile it
 * while the app is closed.
 */
export const briefingScheduler: BriefingScheduler = createBriefingScheduler({
  notifications: createExpoNotificationsPort(),
  fsi: fullScreenAlarm,
  getPreferences: () => preferencesRepository.get(),
  listMeetings: (range) => meetingRepository.list(range),
  listTasks: () => tasksRepository.list(),
  subscribeTasks: (listener) => tasksRepository.subscribe(listener),
  i18n: i18nPort,
  events: appEvents,
  appState: createAppStatePort(),
  deviceTimeZone: getDeviceTimeZone,
});

/**
 * The ongoing "alerts are on" notification. Off until the user asks for it in Settings > Alerts;
 * it is reassurance and a next-meeting readout, not what makes alarms fire.
 */
export const statusNotification: StatusNotification = createStatusNotification({
  notifications: createExpoNotificationsPort(),
  getPreferences: () => preferencesRepository.get(),
  listMeetings: (range) => meetingRepository.list(range),
  i18n: i18nPort,
  events: appEvents,
  appState: createAppStatePort(),
  deviceTimeZone: getDeviceTimeZone,
});
