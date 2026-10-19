/**
 * Default wiring of the AI area (singletons used by the public barrel and the hook).
 * Layer L5: imports core, i18n, format, the data and calendar barrels and src/config/firebase
 * (through ./firebaseTransport). Never imports the auth barrel.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { appEvents } from '../../core/events';
import { createLogger } from '../../core/logger';
import { getDeviceTimeZone } from '../../core/time';
import { getLanguage } from '../../i18n';
import { googleCalendarService } from '../calendar';
import { dataEngine, dataService, meetingRepository, tasksRepository } from '../data';
import { zoomService } from '../zoom';

import { createActionExecutor, type AiActionExecutor } from './actionExecutor';
import { createAssistantClient } from './assistantClient';
import { createAssistantController, type SessionSource } from './controller';
import { createExecutedStore } from './executedStore';
import { getFirebaseAssistantTransport, netInfoConnectivity } from './firebaseTransport';
import { createAssistantFormatter } from './formatter';
import { reactNativeShareAdapter } from './shareAdapter';
import { createThreadStore } from './threadStore';
import type { AssistantController } from './types';

const log = createLogger('ai');

/** Active data-session uid; null when there is none (or the data layer is unavailable). */
function activeUid(): string | null {
  try {
    return dataService.getActiveUid();
  } catch (error) {
    log.warn('data session unavailable', error);
    return null;
  }
}

export const assistantClient = createAssistantClient({
  getTransport: getFirebaseAssistantTransport,
  connectivity: netInfoConnectivity,
});

export const actionExecutor: AiActionExecutor = createActionExecutor({
  meetings: meetingRepository,
  tasks: tasksRepository,
  calendar: googleCalendarService,
  sharing: reactNativeShareAdapter,
  zoom: zoomService,
  executed: createExecutedStore(AsyncStorage),
  getUid: activeUid,
  getFormatter: () => createAssistantFormatter({ use24Hour: dataEngine.getSnapshot().preferences.use24HourClock }),
});

const sessionSource: SessionSource = {
  getActiveUid: activeUid,
  subscribe(listener) {
    const offStarted = appEvents.on('session:started', ({ uid }) => listener(uid));
    const offEnded = appEvents.on('session:ended', () => listener(null));
    return () => {
      offStarted();
      offEnded();
    };
  },
};

/** Meetings changed elsewhere (other screen, sync, another device): refresh the open proposals. */
const PREVIEW_REFRESH_DEBOUNCE_MS = 500;

let controller: AssistantController | null = null;

/** The app-wide conversation controller (created on first use, bound to the data session). */
export function getAssistantController(): AssistantController {
  if (!controller) {
    const created = createAssistantController({
      client: assistantClient,
      executor: actionExecutor,
      store: createThreadStore(AsyncStorage),
      session: sessionSource,
      getContext: () => ({ language: getLanguage(), timezone: getDeviceTimeZone(), now: new Date() }),
    });
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refreshSoon = (): void => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void created.refreshPreviews();
      }, PREVIEW_REFRESH_DEBOUNCE_MS);
    };
    appEvents.on('meetings:changed', refreshSoon);
    // Tasks changed elsewhere (Tasks screen, sync, another device): open task proposals refresh.
    tasksRepository.subscribe(refreshSoon);
    controller = created;
  }
  return controller;
}
