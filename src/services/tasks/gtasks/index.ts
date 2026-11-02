/**
 * Google Tasks task sync over the Google Tasks API v1 (owner: tasks/gtasks; V2 Stage 2, M8).
 *
 * Contract: `GoogleTasksSyncService` in src/core/contracts.ts.
 * - Account: the Google account signed in natively on this device (GoogleSignin); the tasks
 *   scope (GOOGLE_TASKS_SCOPES) is requested incrementally when the user starts turning the sync
 *   on (before the list chooser loads).
 * - Pull: tasks.list per synced list with a persisted updatedMin watermark in mg:{uid}:tasks.gtasks.
 *   Push: POST / PATCH / DELETE; link write-backs use origin 'tasks_gtasks' (never re-pushed).
 * - `isConfigured()` is the build switch: EXPO_PUBLIC_GOOGLE_TASKS_SYNC set to 'off' hides the
 *   card and the engine skips the provider (store builds, until Google verifies the scope).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { GoogleTasksSyncService } from '../../../core/contracts';
import { getDeviceTimeZone } from '../../../core/time';
import { t } from '../../../i18n';
import { authService } from '../../auth/authService';
import { createUserStateStore } from '../../calendar/stateStore';
import { calendarStatusStore } from '../../calendar/status';
import { dataService, preferencesRepository, tasksRepository } from '../../data';
import { createGoogleTasksApi } from './api';
import { createGoogleTasksSyncService, type GoogleTasksSyncServiceInternal } from './service';
import { defaultGtasksSyncState, GTASKS_STATE_NAME, gtasksSyncStateSchema } from './state';

const getUid = (): string | null => dataService.getActiveUid();

/**
 * Build switch read with a static expression (Expo inlines EXPO_PUBLIC_* at build time). Anything
 * but the literal 'off' keeps the sync available.
 */
export function isGoogleTasksSyncConfigured(): boolean {
  return process.env.EXPO_PUBLIC_GOOGLE_TASKS_SYNC !== 'off';
}

/** Internal service with the engine hooks (the calendar barrel registers it with the sync engine). */
export const gtasksInternal: GoogleTasksSyncServiceInternal = createGoogleTasksSyncService({
  api: createGoogleTasksApi({
    tokens: {
      getToken: () => authService.getGoogleAccessToken({ requireCalendar: false, requireTasks: true }),
      invalidate: (token) => authService.invalidateGoogleAccessToken(token),
    },
  }),
  tasks: tasksRepository,
  state: createUserStateStore({
    kv: AsyncStorage,
    name: GTASKS_STATE_NAME,
    getUid,
    schema: gtasksSyncStateSchema,
    defaults: defaultGtasksSyncState,
  }),
  auth: {
    isAccountConnected: () => authService.hasGoogleSession(),
    hasTasksScope: () => authService.hasTasksScope(),
    requestTasksScope: () => authService.requestTasksScope(),
  },
  preferences: preferencesRepository,
  status: calendarStatusStore,
  now: () => new Date(),
  defaultTimeZone: getDeviceTimeZone,
  untitledTitle: () => t('tasks:todo.untitledTask'),
  config: { enabled: isGoogleTasksSyncConfigured() },
});

/** Contract object (GoogleTasksSyncService); the extra engine hooks stay internal. */
export const googleTasksSyncService: GoogleTasksSyncService = {
  isConfigured: gtasksInternal.isConfigured,
  isAccountConnected: gtasksInternal.isAccountConnected,
  listLists: gtasksInternal.listLists,
  enable: gtasksInternal.enable,
  setList: gtasksInternal.setList,
  disable: gtasksInternal.disable,
  sync: gtasksInternal.sync,
};

export type { GoogleTasksSyncServiceInternal } from './service';
export type { GtasksQueueItem } from './sync';
