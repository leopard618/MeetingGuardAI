/**
 * Microsoft To Do task sync over Microsoft Graph (owner: tasks/todo; V2 Stage 2, M7).
 *
 * Contract: `TodoSyncService` in src/core/contracts.ts and docs/v1/ARCHITECTURE.md §28.
 * - Account: the Microsoft account the Outlook sync connects (same refresh token, consent
 *   Calendars.ReadWrite + Tasks.ReadWrite). No To Do without the Outlook card's Connect.
 * - Pull: /me/todo/lists/{id}/tasks/delta per synced list with the links persisted in
 *   mg:{uid}:tasks.todo; 410 => full listing. Push: POST / PATCH / DELETE; link write-backs use
 *   origin 'tasks_todo' (never re-pushed).
 * - `isConfigured()` is false without EXPO_PUBLIC_MSAL_CLIENT_ID: the UI hides the To Do card
 *   and the engine skips the provider entirely.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { env } from '../../../config/env';
import type { TodoSyncService } from '../../../core/contracts';
import { getDeviceTimeZone } from '../../../core/time';
import { t } from '../../../i18n';
import { microsoftTokenManager } from '../../calendar/outlook';
import { createUserStateStore } from '../../calendar/stateStore';
import { calendarStatusStore } from '../../calendar/status';
import { dataService, preferencesRepository, tasksRepository } from '../../data';
import { createTodoGraphApi } from './api';
import { createTodoSyncService, type TodoSyncServiceInternal } from './service';
import { defaultTodoSyncState, TODO_STATE_NAME, todoSyncStateSchema } from './state';

const getUid = (): string | null => dataService.getActiveUid();

/** Internal service with the engine hooks (the calendar barrel registers it with the sync engine). */
export const todoInternal: TodoSyncServiceInternal = createTodoSyncService({
  api: createTodoGraphApi({
    tokens: {
      getToken: () => microsoftTokenManager.getAccessToken(),
      invalidate: (token) => microsoftTokenManager.invalidateAccessToken(token),
    },
  }),
  tasks: tasksRepository,
  state: createUserStateStore({
    kv: AsyncStorage,
    name: TODO_STATE_NAME,
    getUid,
    schema: todoSyncStateSchema,
    defaults: defaultTodoSyncState,
  }),
  hasRefreshToken: () => microsoftTokenManager.hasRefreshToken(),
  preferences: preferencesRepository,
  status: calendarStatusStore,
  now: () => new Date(),
  defaultTimeZone: getDeviceTimeZone,
  untitledTitle: () => t('tasks:todo.untitledTask'),
  config: { clientId: env.msal.clientId },
});

/** Contract object (TodoSyncService); the extra engine hooks stay internal. */
export const todoSyncService: TodoSyncService = {
  isConfigured: todoInternal.isConfigured,
  isAccountConnected: todoInternal.isAccountConnected,
  listLists: todoInternal.listLists,
  enable: todoInternal.enable,
  setList: todoInternal.setList,
  disable: todoInternal.disable,
  sync: todoInternal.sync,
};

export type { TodoSyncServiceInternal } from './service';
export type { TodoQueueItem } from './sync';
