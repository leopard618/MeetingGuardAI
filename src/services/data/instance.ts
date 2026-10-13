/**
 * The app-wide data engine and its contract facades (wired to Firebase, AsyncStorage, NetInfo,
 * AppState and the i18n language). Import from the barrel (src/services/data), not from here.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { db } from '../../config/firebase';
import { getLanguage } from '../../i18n';
import { createAttachmentStore } from './attachments';
import { DataEngine } from './engine';
import { createFirestoreRemote } from './firestoreRemote';
import { appStateMonitor, netInfoMonitor } from './platform';

export const dataEngine = new DataEngine({
  remote: createFirestoreRemote(db),
  storage: AsyncStorage,
  network: netInfoMonitor,
  foreground: appStateMonitor,
  getLanguage,
});

const repositories = dataEngine.createRepositories();

export const meetingRepository = repositories.meetingRepository;
export const preferencesRepository = repositories.preferencesRepository;
export const notesRepository = repositories.notesRepository;
export const tasksRepository = repositories.tasksRepository;
export const userRepository = repositories.userRepository;
export const migrationService = repositories.migrationService;
export const dataService = repositories.dataService;

/** Device-local attachment metadata of the signed-in user (used by src/services/attachments). */
export const attachmentStore = createAttachmentStore(AsyncStorage, () => dataEngine.getActiveUid());
