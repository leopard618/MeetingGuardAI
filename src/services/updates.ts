/**
 * OTA update state (expo-updates, EAS Update). Layer L1 (no app services).
 *
 * The native runtime does the work: `checkAutomatically: ON_LOAD` downloads a newer update for
 * this runtime (runtimeVersion policy "appVersion") in the background at a cold start, and
 * `fallbackToCacheTimeout: 0` never delays the launch; the update runs from the next cold start.
 *
 * What the two failure paths look like (expo-updates 57):
 * - A downloaded update that CRASHES on start is handled by expo-updates' error recovery: it is
 *   marked as failed and the app relaunches with the previous update (or the embedded bundle).
 *   `isEmergencyLaunch` stays false. The signal for a bad OTA update is therefore in Sentry: new
 *   crashes / errors grouped by the tag `expo.updates.update_id` right after a publish, and a
 *   falling crash-free rate (docs/v1/DEPLOYMENT.md §8).
 * - An "emergency launch" means expo-updates could not use its update store at all (database or
 *   directory failure) and started the embedded bundle. The Sentry SDK already reports it
 *   (`expoContextIntegration`: a warning event tagged `expo.updates.emergency_launch=true`) and
 *   tags every event with the update id, channel and runtime version, so this module only logs a
 *   warning (no second Sentry event).
 */
import * as Updates from 'expo-updates';

import { createLogger } from '../core/logger';

const log = createLogger('updates');

export interface UpdateInfo {
  /** false in development (Metro) and in builds without expo-updates configured. */
  enabled: boolean;
  /** EAS Update channel the build listens to (eas.json build profile), or null. */
  channel: string | null;
  runtimeVersion: string | null;
  /** Id of the running update; null or the embedded update's id when running the built-in bundle. */
  updateId: string | null;
  /** true when running the bundle shipped inside the binary (no OTA update applied). */
  embedded: boolean;
  /** true when expo-updates could not use its update store and started the embedded bundle. */
  emergencyLaunch: boolean;
}

export function getUpdateInfo(): UpdateInfo {
  return {
    enabled: Updates.isEnabled,
    channel: Updates.channel ?? null,
    runtimeVersion: Updates.runtimeVersion ?? null,
    updateId: Updates.updateId ?? null,
    embedded: Updates.isEmbeddedLaunch,
    emergencyLaunch: Updates.isEmergencyLaunch,
  };
}

/** "Update 1a2b3c4d · production" (short id) for the Settings footer; null for the built-in bundle. */
export function shortUpdateLabel(info: UpdateInfo): { id: string; channel: string } | null {
  if (!info.enabled || info.embedded || !info.updateId) return null;
  return { id: info.updateId.slice(0, 8), channel: info.channel ?? '-' };
}

let reported = false;

/**
 * Called once at app start: logs which bundle runs. An emergency launch is logged as a warning
 * only; Sentry's own Expo integration already sends the event (see the header).
 */
export function reportUpdateLaunch(info: UpdateInfo = getUpdateInfo()): void {
  if (reported) return;
  reported = true;
  if (!info.enabled) return;
  if (info.emergencyLaunch) {
    log.warn('emergency launch: the update store could not be used, running the embedded bundle', Updates.emergencyLaunchReason ?? 'unknown reason');
    return;
  }
  log.info('running', info.embedded ? 'embedded bundle' : `update ${info.updateId ?? '-'}`, `channel ${info.channel ?? '-'}`);
}

/** TEST ONLY. */
export function resetUpdateReportForTests(): void {
  reported = false;
}
