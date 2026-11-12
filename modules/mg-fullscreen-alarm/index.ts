/**
 * TS wrapper of the local Expo module "MgFullscreenAlarm" (Android only; native side in
 * ./android). On iOS / web / a binary without the module (OTA updates never ship native code)
 * every function is a safe no-op and `isNativeModuleAvailable()` is false, so callers
 * (src/services/alerts/fsi.ts) can fall back to expo-notifications.
 *
 * The shapes mirror FullScreenAlarmSpec / FullScreenAlarmStatus / FiredFullScreenAlarm in
 * src/core/contracts.ts; this file stays dependency-free towards src/ so the module remains
 * self-contained.
 */
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

export interface MgFullScreenAlarmSpec {
  /** Meeting Guard AI notification identifier ("mg:..."); also the tray tag of the fired alarm. */
  id: string;
  /** Fire time, epoch ms. */
  atMs: number;
  title: string;
  body: string;
  /** Opened by the full-screen intent and the tap ("meetingguardai://meeting/{id}"). */
  deepLink: string;
  /** Existing Android notification channel the alarm posts on. */
  channelId: string;
  /** Alert payload as JSON text, handed back by getFired(); omitted/empty when there is none. */
  data?: string;
}

export interface MgFullScreenAlarmStatus {
  exactAllowed: boolean;
  fullScreenAllowed: boolean;
  notificationsAllowed: boolean;
}

/** An alarm that fired (its notification was posted) and has not been cleared by the app yet. */
export interface MgFiredAlarm {
  id: string;
  /** When the native receiver posted it, epoch ms. */
  firedAtMs: number;
  title: string;
  body: string;
  deepLink: string;
  /** The spec's `data` as given, '' when none. */
  data: string;
}

interface NativeFullScreenAlarmModule {
  setAlarms(alarms: MgFullScreenAlarmSpec[], scope: string | null): Promise<void>;
  clearAlarms(ids: string[] | null): Promise<void>;
  getStatus(): Promise<MgFullScreenAlarmStatus>;
  openFullScreenIntentSettings(): Promise<void>;
  getFired(scope: string | null): Promise<Partial<MgFiredAlarm>[] | null>;
  clearFired(ids: string[] | null): Promise<void>;
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

/**
 * DECLARATIVE: replaces the pending set, restricted to ids starting with `scope` when given (so
 * the engine's "mg:" alarms and the briefing's "mgbrief:" alarms never cancel each other).
 * No-op when the module is missing.
 */
export async function setAlarms(alarms: readonly MgFullScreenAlarmSpec[], scope?: string): Promise<void> {
  if (!nativeModule) return;
  await nativeModule.setAlarms(
    alarms.map((alarm) => ({ ...alarm, data: alarm.data ?? '' })),
    scope ?? null,
  );
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

/**
 * Alarms that fired and were not cleared yet, oldest first, restricted to ids starting with
 * `scope` when given. Empty when the module is missing. Records without an id are dropped.
 */
export async function getFired(scope?: string): Promise<MgFiredAlarm[]> {
  if (!nativeModule) return [];
  const raw = await nativeModule.getFired(scope ?? null);
  if (!Array.isArray(raw)) return [];
  const fired: MgFiredAlarm[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry.id !== 'string' || entry.id.length === 0) continue;
    const firedAtMs = typeof entry.firedAtMs === 'number' && Number.isFinite(entry.firedAtMs) ? entry.firedAtMs : 0;
    fired.push({
      id: entry.id,
      firedAtMs,
      title: typeof entry.title === 'string' ? entry.title : '',
      body: typeof entry.body === 'string' ? entry.body : '',
      deepLink: typeof entry.deepLink === 'string' ? entry.deepLink : '',
      data: typeof entry.data === 'string' ? entry.data : '',
    });
  }
  return fired;
}

/** Forgets the given fired records, or all of them when omitted (the tray copies stay). */
export async function clearFired(ids?: readonly string[]): Promise<void> {
  if (!nativeModule) return;
  await nativeModule.clearFired(ids === undefined ? null : [...ids]);
}
