/**
 * CALENDAR area public API (owner: calendar).
 *
 * Layer L4: imports core, i18n, the data barrel and src/services/auth/authService (never the auth
 * barrel). Contract: CALENDAR section of src/core/contracts.ts. Details: docs/v1/ARCHITECTURE.md §7.
 *
 * - googleCalendarService: two-way sync with the user's primary Google Calendar (REST with
 *   GoogleSignin access tokens; no secrets, tokens never stored).
 * - outlookCalendarService: two-way sync with the Microsoft account's default calendar over
 *   Microsoft Graph (./outlook; registered with the engine only when EXPO_PUBLIC_MSAL_CLIENT_ID
 *   is set).
 * - deviceCalendarService: Apple / Android calendars through expo-calendar (object API).
 * - calendarSyncEngine: per-session orchestration (session manager calls start/stop).
 * - useCalendarStatus(): live status for the settings UI.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';

import type {
  CalendarStatus,
  CalendarSyncEngine,
  DeviceCalendarService,
  GoogleCalendarService,
} from '../../core/contracts';
import { toAppError } from '../../core/errors';
import { appEvents, type Unsubscribe } from '../../core/events';
import { GLOBAL_STORAGE_KEYS } from '../../core/identifiers';
import { createLogger } from '../../core/logger';
import { getDeviceTimeZone } from '../../core/time';
import { t } from '../../i18n';
import { authService } from '../auth/authService';
import { dataService, meetingRepository, preferencesRepository } from '../data';
import { createExpoCalendarPort } from './device/adapter';
import { generateDeviceKey, isValidDeviceKey } from './device/mapping';
import { createDeviceCalendarService } from './device/service';
import { createCalendarSyncEngine, type AppStateStatus } from './engine';
import { createGoogleCalendarApi } from './google/api';
import { createGoogleCalendarService } from './google/service';
import { todoInternal, todoSyncService } from '../tasks/todo';
import { outlookCalendarService, outlookInternal } from './outlook';
import {
  createUserStateStore,
  defaultDeviceSyncState,
  defaultGoogleSyncState,
  DEVICE_STATE_NAME,
  deviceSyncStateSchema,
  GOOGLE_STATE_NAME,
  googleSyncStateSchema,
} from './stateStore';
import { calendarStatusStore } from './status';

const log = createLogger('calendar');

/**
 * Device-wide (not per-user) key that scopes device calendar ids to this installation. It must
 * survive sign-out, so it lives outside the mg:{uid}: prefix that the data layer wipes.
 */
const DEVICE_CALENDAR_KEY_STORAGE = GLOBAL_STORAGE_KEYS.deviceCalendarKey;

const getUid = (): string | null => dataService.getActiveUid();
const now = (): Date => new Date();
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const untitledTitle = (): string => t('calendar:google.untitledEvent');

let deviceKeyPromise: Promise<string> | null = null;
function deviceKey(): Promise<string> {
  if (!deviceKeyPromise) {
    deviceKeyPromise = (async () => {
      const stored = await AsyncStorage.getItem(DEVICE_CALENDAR_KEY_STORAGE);
      if (isValidDeviceKey(stored)) return stored;
      const key = generateDeviceKey();
      await AsyncStorage.setItem(DEVICE_CALENDAR_KEY_STORAGE, key);
      return key;
    })();
    deviceKeyPromise.catch(() => {
      // Retry on the next call instead of caching a failure.
      deviceKeyPromise = null;
    });
  }
  return deviceKeyPromise;
}

// Shared instance (status.ts): the outlook wiring reports to the same store.
const status = calendarStatusStore;

const googleApi = createGoogleCalendarApi({
  tokens: {
    getToken: () => authService.getGoogleAccessToken({ requireCalendar: true }),
    invalidate: (token) => authService.invalidateGoogleAccessToken(token),
  },
});

const googleInternal = createGoogleCalendarService({
  api: googleApi,
  meetings: meetingRepository,
  preferences: preferencesRepository,
  auth: authService,
  state: createUserStateStore({
    kv: AsyncStorage,
    name: GOOGLE_STATE_NAME,
    getUid,
    schema: googleSyncStateSchema,
    defaults: defaultGoogleSyncState,
  }),
  status,
  events: appEvents,
  getUid,
  now,
  sleep,
  defaultTimeZone: getDeviceTimeZone,
  untitledTitle,
});

const deviceInternal = createDeviceCalendarService({
  port: createExpoCalendarPort(),
  meetings: meetingRepository,
  preferences: preferencesRepository,
  state: createUserStateStore({
    kv: AsyncStorage,
    name: DEVICE_STATE_NAME,
    getUid,
    schema: deviceSyncStateSchema,
    defaults: defaultDeviceSyncState,
  }),
  deviceKey,
  platform: Platform.OS === 'ios' ? 'ios' : 'android',
  deviceTimeZone: getDeviceTimeZone,
  untitledTitle,
  now,
  status,
  events: appEvents,
  getUid,
});

/** Optional auth extension (AuthServiceImpl.onGoogleAccessChanged); absent => not used. */
function googleAccessHook(): ((listener: () => void) => Unsubscribe) | undefined {
  const candidate = (authService as { onGoogleAccessChanged?: unknown }).onGoogleAccessChanged;
  if (typeof candidate !== 'function') return undefined;
  return (listener) => (candidate as (listener: () => void) => Unsubscribe).call(authService, listener);
}

const engine = createCalendarSyncEngine({
  google: googleInternal,
  device: deviceInternal,
  // The Outlook and To Do providers only exist for the engine when the build is configured for them.
  outlook: outlookInternal.isConfigured() ? outlookInternal : undefined,
  todo: todoInternal.isConfigured() ? todoInternal : undefined,
  preferences: preferencesRepository,
  getActiveUid: getUid,
  status,
  events: appEvents,
  appState: {
    currentState: () => AppState.currentState as AppStateStatus,
    subscribe: (listener) => {
      const subscription = AppState.addEventListener('change', (state) => listener(state as AppStateStatus));
      return () => subscription.remove();
    },
  },
  connectivity: {
    subscribe: (listener) => NetInfo.addEventListener((state) => listener(state.isConnected === true)),
  },
  onGoogleAccessChanged: googleAccessHook(),
  now,
});

/** Contract object (GoogleCalendarService); the extra engine hooks stay internal. */
export const googleCalendarService: GoogleCalendarService = {
  isConnected: googleInternal.isConnected,
  connect: googleInternal.connect,
  disconnect: googleInternal.disconnect,
  pushMeeting: googleInternal.pushMeeting,
  removeMeeting: googleInternal.removeMeeting,
  pullChanges: googleInternal.pullChanges,
  createMeetLink: googleInternal.createMeetLink,
};

/** Contract object (OutlookCalendarService; ./outlook owns the wiring). */
export { outlookCalendarService };

/** Contract object (TodoSyncService; ../tasks/todo owns the wiring, same Microsoft account). */
export { todoSyncService };

export const deviceCalendarService: DeviceCalendarService = {
  getPermission: deviceInternal.getPermission,
  requestPermission: deviceInternal.requestPermission,
  listCalendars: deviceInternal.listCalendars,
  importFrom: deviceInternal.importFrom,
  exportMeeting: deviceInternal.exportMeeting,
  removeExported: deviceInternal.removeExported,
};

export const calendarSyncEngine: CalendarSyncEngine = {
  start: engine.start,
  stop: engine.stop,
  syncNow: engine.syncNow,
  onMeetingChanged: engine.onMeetingChanged,
  getStatus: engine.getStatus,
  subscribeStatus: engine.subscribeStatus,
};

/** Live calendar status (connected, syncing, last sync, last error, permission, selection). */
export function useCalendarStatus(): CalendarStatus {
  return useSyncExternalStore(engine.subscribeStatus, engine.getStatus, engine.getStatus);
}

// Safety net next to the session manager's explicit calls (both are idempotent).
appEvents.on('session:started', ({ uid }) => {
  try {
    engine.start(uid);
  } catch (error) {
    log.error('Calendar sync could not start', toAppError(error));
  }
});
appEvents.on('session:ended', () => engine.stop());

export type {
  GoogleConnectResult,
  OutlookConnectResult,
  CalendarStatus,
  DeviceCalendarInfo,
  CalendarSyncReport,
} from '../../core/contracts';
