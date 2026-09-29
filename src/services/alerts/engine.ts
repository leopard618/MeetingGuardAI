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
import { dataService, meetingRepository, preferencesRepository } from '../data';
import { createAlertEngine, type AlertEngineImpl } from './engineCore';
import { createExpoNotificationsPort } from './expoNotificationsPort';
import { alertFeedback } from './feedback';
import { createAppStatePort, createAsyncStoragePort, createSettingsPort } from './platformPorts';
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
});
