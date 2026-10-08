/**
 * TS wrapper of the local Expo module "MgNextMeetingWidget" (Android home-screen widget showing
 * the next meeting; docs/ARCHITECTURE.md §19). Mirrors NextMeetingWidgetModule in
 * src/core/contracts.ts but stays dependency-free towards src/ so the module is self-contained
 * (same pattern as modules/mg-fullscreen-alarm).
 *
 * On iOS / web / a binary without the native module (OTA updates never ship native code) every
 * function is a safe no-op and `isNativeModuleAvailable()` is false, so the feeder
 * (src/services/widget) can skip work without special-casing platforms.
 *
 * NATIVE SIDE: ./android (Kotlin), registered by expo-module.config.json as
 * com.meetingguard.nextmeetingwidget.MgNextMeetingWidgetModule. Contract details:
 * ARCHITECTURE §19 (SharedPreferences data handoff via WidgetStore, AppWidgetProvider +
 * RemoteViews in WidgetRenderer, inexact AlarmManager tick at startAtMs, BOOT_COMPLETED
 * restore, deep-link tap PendingIntent, res/values(-es) fallback strings). Native code ships
 * only in a store build (§15), never an OTA update.
 */
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

export interface MgWidgetMeetingData {
  title: string;
  /** Start instant, epoch ms (the native re-render boundary; not displayed). */
  startAtMs: number;
  /** Pre-formatted, localized time text (e.g. "3:00 PM"). */
  timeText: string;
  /** Pre-formatted, localized date text (e.g. "Today"). */
  dateText: string;
  /** Opened on tap ("meetingguardai://meeting/{id}"). */
  deepLink: string;
}

export interface MgWidgetStrings {
  emptyTitle: string;
  emptyBody: string;
  nowLabel: string;
}

interface NativeNextMeetingWidgetModule {
  hasWidgets(): Promise<boolean>;
  setNextMeeting(data: MgWidgetMeetingData | null): Promise<void>;
  setStrings(strings: MgWidgetStrings): Promise<void>;
  clear(): Promise<void>;
}

function loadNativeModule(): NativeNextMeetingWidgetModule | null {
  if (Platform.OS !== 'android') return null;
  try {
    return requireOptionalNativeModule<NativeNextMeetingWidgetModule>('MgNextMeetingWidget');
  } catch {
    return null;
  }
}

const nativeModule = loadNativeModule();

/** Native module present and platform android (false => every call below is a no-op). */
export function isNativeModuleAvailable(): boolean {
  return nativeModule !== null;
}

/** true when at least one widget instance is placed on a home screen (informational). */
export async function hasWidgets(): Promise<boolean> {
  if (nativeModule === null) return false;
  return nativeModule.hasWidgets();
}

/** Replaces the stored data (null = empty state) and re-renders every widget instance. */
export async function setNextMeeting(data: MgWidgetMeetingData | null): Promise<void> {
  if (nativeModule === null) return;
  await nativeModule.setNextMeeting(data);
}

/** Replaces the stored localized strings and re-renders. */
export async function setStrings(strings: MgWidgetStrings): Promise<void> {
  if (nativeModule === null) return;
  await nativeModule.setStrings(strings);
}

/** Clears data and strings (sign-out); the widget falls back to its bundled empty state. */
export async function clear(): Promise<void> {
  if (nativeModule === null) return;
  await nativeModule.clear();
}
