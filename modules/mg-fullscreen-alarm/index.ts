/**
 * TS wrapper of the local Expo module "MgFullscreenAlarm" (Android only; native side in
 * ./android). On iOS / web / a binary without the module (OTA updates never ship native code)
 * every function is a safe no-op and `isNativeModuleAvailable()` is false, so callers
 * (src/services/alerts/fsi.ts) can fall back to expo-notifications.
 *
 * The shapes mirror FullScreenAlarmSpec / FullScreenAlarmStatus in src/core/contracts.ts; this
 * file stays dependency-free towards src/ so the module remains self-contained.
 */
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

export interface MgFullScreenAlarmSpec {
  /** MeetingGuard notification identifier ("mg:..."); also the tray tag of the fired alarm. */
  id: string;
  /** Fire time, epoch ms. */
  atMs: number;
  title: string;
  body: string;
  /** Opened by the full-screen intent and the tap ("meetingguardai://meeting/{id}"). */
  deepLink: string;
  /** Existing Android notification channel the alarm posts on. */
  channelId: string;
}

export interface MgFullScreenAlarmStatus {
  exactAllowed: boolean;
  fullScreenAllowed: boolean;
  notificationsAllowed: boolean;
}

interface NativeFullScreenAlarmModule {
  setAlarms(alarms: MgFullScreenAlarmSpec[]): Promise<void>;
  clearAlarms(ids: string[] | null): Promise<void>;
  getStatus(): Promise<MgFullScreenAlarmStatus>;
  openFullScreenIntentSettings(): Promise<void>;
}

function loadNativeModule(): NativeFullScreenAlarmModule | null {
  if (Platform.OS !== 'android') return null;
  try {
    return requireOptionalNativeModule<NativeFullScreenAlarmModule>('MgFullscreenAlarm');
  } catch {
    return null;
  }
}

const nativeModule = loadNativeModule();

/** Status reported when the native module is missing (callers must fall back). */
export const UNAVAILABLE_STATUS: MgFullScreenAlarmStatus = {
  exactAllowed: false,
  fullScreenAllowed: false,
  notificationsAllowed: false,
};

/** True only on Android in a binary that includes the native module. */
export function isNativeModuleAvailable(): boolean {
  return nativeModule !== null;
}

/** DECLARATIVE: replaces the whole pending set. No-op when the module is missing. */
export async function setAlarms(alarms: readonly MgFullScreenAlarmSpec[]): Promise<void> {
  if (!nativeModule) return;
  await nativeModule.setAlarms([...alarms]);
}

/** Cancels the given ids (and their tray copies), or every pending alarm when omitted. */
export async function clearAlarms(ids?: readonly string[]): Promise<void> {
  if (!nativeModule) return;
  await nativeModule.clearAlarms(ids === undefined ? null : [...ids]);
}

export async function getStatus(): Promise<MgFullScreenAlarmStatus> {
  if (!nativeModule) return { ...UNAVAILABLE_STATUS };
  const raw = await nativeModule.getStatus();
  // Guard against bridge oddities: only real `true` counts as allowed.
  return {
    exactAllowed: raw?.exactAllowed === true,
    fullScreenAllowed: raw?.fullScreenAllowed === true,
    notificationsAllowed: raw?.notificationsAllowed === true,
  };
}

/** Android 14+: the "Allow full-screen notifications" system page. No-op elsewhere. */
export async function openFullScreenIntentSettings(): Promise<void> {
  if (!nativeModule) return;
  await nativeModule.openFullScreenIntentSettings();
}
