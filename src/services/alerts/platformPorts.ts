/**
 * React Native / Expo implementations of the small engine ports (owner: alerts):
 * settings screens (expo-intent-launcher on Android, Linking.openSettings on iOS), AppState,
 * AsyncStorage.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as IntentLauncher from 'expo-intent-launcher';
import { AppState, Linking, Platform } from 'react-native';

import { AppError, toAppError } from '../../core/errors';
import type { AlertSettingsPort, AppStateName, AppStatePort, KeyValueStorage } from './types';

/** Android package (app.config.js android.package); used for the exact-alarm settings deep link. */
const FALLBACK_ANDROID_PACKAGE = 'com.meetingguard.ai';

function androidPackage(): string {
  const fromConfig = Constants.expoConfig?.android?.package;
  return typeof fromConfig === 'string' && fromConfig.length > 0 ? fromConfig : FALLBACK_ANDROID_PACKAGE;
}

function androidApiLevel(): number {
  return Platform.OS === 'android' && typeof Platform.Version === 'number' ? Platform.Version : 0;
}

async function openAppSettings(): Promise<void> {
  try {
    await Linking.openSettings();
  } catch (error) {
    throw toAppError(error, 'unsupported');
  }
}

export function createSettingsPort(): AlertSettingsPort {
  const exactAlarmSettingsAvailable = Platform.OS === 'android' && androidApiLevel() >= 31;
  return {
    exactAlarmSettingsAvailable,

    async openExactAlarmSettings() {
      if (!exactAlarmSettingsAvailable) return;
      try {
        await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.REQUEST_SCHEDULE_EXACT_ALARM, {
          data: `package:${androidPackage()}`,
        });
      } catch {
        // Some OEM builds do not expose the exact-alarm screen: fall back to the app's settings page.
        await openAppSettings();
      }
    },

    async openNotificationSettings() {
      if (Platform.OS === 'android') {
        try {
          await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.APP_NOTIFICATION_SETTINGS, {
            extra: { 'android.provider.extra.APP_PACKAGE': androidPackage() },
          });
          return;
        } catch {
          await openAppSettings();
          return;
        }
      }
      if (Platform.OS === 'ios') {
        await openAppSettings();
        return;
      }
      throw new AppError('unsupported', 'Notification settings are not available on this platform');
    },
  };
}

function toAppStateName(value: string | null | undefined): AppStateName {
  switch (value) {
    case 'active':
    case 'background':
    case 'inactive':
    case 'extension':
      return value;
    default:
      return 'unknown';
  }
}

export function createAppStatePort(): AppStatePort {
  return {
    current: () => toAppStateName(AppState.currentState),
    subscribe(listener) {
      const subscription = AppState.addEventListener('change', (state) => listener(toAppStateName(state)));
      return () => subscription.remove();
    },
  };
}

export function createAsyncStoragePort(): KeyValueStorage {
  return {
    getItem: (key) => AsyncStorage.getItem(key),
    setItem: (key, value) => AsyncStorage.setItem(key, value),
  };
}
