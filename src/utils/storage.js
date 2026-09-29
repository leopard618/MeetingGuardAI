/**
 * COMPAT SHIM (stage 3 removes it).
 *
 * - `storage`: thin AsyncStorage wrapper. Errors are no longer swallowed (the old version returned
 *   null / did nothing on failure). `clear()` is refused because it would also delete the Firebase
 *   sign-in session and every user's offline data.
 * - `userStorage`: the old local user table (plaintext passwords, fake Google users) is gone;
 *   identity comes from Firebase Auth. Only reading the signed-in user is supported.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { legacyUser, unsupportedLegacyApi } from '../services/data/legacyFacade';

const LEGACY_CURRENT_USER_KEY = 'current_user';

export const storage = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
  getAllKeys: () => AsyncStorage.getAllKeys(),
  clear: async () => unsupportedLegacyApi('storage.clear'),
};

export const userStorage = {
  getAllUsers: async () => unsupportedLegacyApi('userStorage.getAllUsers'),
  saveAllUsers: async () => unsupportedLegacyApi('userStorage.saveAllUsers'),
  userExists: async () => unsupportedLegacyApi('userStorage.userExists'),
  signUp: async () => unsupportedLegacyApi('userStorage.signUp'),
  signIn: async () => unsupportedLegacyApi('userStorage.signIn'),
  addGoogleUser: async () => unsupportedLegacyApi('userStorage.addGoogleUser'),
  setCurrentUser: async () => unsupportedLegacyApi('userStorage.setCurrentUser'),

  /** The signed-in user (legacy shape) or null when nobody is signed in. */
  getCurrentUser: async () => legacyUser.current(),

  /** Removes the legacy "current_user" key (identity now lives in Firebase Auth). */
  clearCurrentUser: () => AsyncStorage.removeItem(LEGACY_CURRENT_USER_KEY),
};

export default userStorage;
