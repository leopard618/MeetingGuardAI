/**
 * OTA update state (expo-updates, EAS Update). Layer L1 (no app services).
 *
 * The native runtime does the work: `checkAutomatically: ON_LOAD` downloads a newer update for
 * this runtime (runtimeVersion policy "appVersion") in the background at a cold start, and
 * `fallbackToCacheTimeout: 0` never delays the launch; the update runs from the next cold start.
 * If a downloaded update crashes before it finishes launching, expo-updates falls back to the
 * previous working update or the embedded bundle ("emergency launch"). That fallback is reported
 * here, so a bad release shows up in Sentry and can be rolled back (docs/DEPLOYMENT.md).
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
  /** true when expo-updates fell back because the latest update failed to launch. */
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

/** Called once at app start: reports an emergency launch (a failed OTA update) to Sentry. */
export function reportUpdateLaunch(info: UpdateInfo = getUpdateInfo()): void {
  if (reported) return;
  reported = true;
  if (!info.enabled) return;
  if (info.emergencyLaunch) {
    log.error('emergency launch: the latest update failed to start, running the previous bundle', new Error(Updates.emergencyLaunchReason ?? 'unknown reason'));
    return;
  }
  log.info('running', info.embedded ? 'embedded bundle' : `update ${info.updateId ?? '-'}`, `channel ${info.channel ?? '-'}`);
}

/** TEST ONLY. */
export function resetUpdateReportForTests(): void {
  reported = false;
}
