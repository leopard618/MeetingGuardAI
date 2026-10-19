/**
 * Full-screen alarm glue (owner: alerts/fsi pass) over the local Expo module
 * modules/mg-fullscreen-alarm. Contract: FullScreenAlarmModule in src/core/contracts.ts and
 * docs/v1/ARCHITECTURE.md §18.
 *
 * Engine integration contract (implemented in engineCore.ts):
 * - AlertEngineDeps gains optional `fsi?: FullScreenAlarmModule` (engine.ts wires this module).
 * - During reconcile, AFTER the desired specs are rendered: when platform is 'android' and
 *   fsi.isAvailable() and getStatus().fullScreenAllowed && notificationsAllowed, the desired
 *   entries with kind 'alert' and intensity 'max' are routed to `fsi.setAlarms(...)` (id =
 *   notification identifier, atMs = Date.parse(fireAt), deepLink = data.url, channelId =
 *   spec.channelId) and EXCLUDED from the expo-notifications desired set BEFORE the diff, so:
 *   each identifier is scheduled through exactly one path, stale expo copies of rerouted ids are
 *   cancelled by the ordinary diff, and setAlarms being declarative (replace-all) is the module
 *   side of the diff. Snoozes, follow-ups and non-MAX alerts stay on expo-notifications.
 * - When the module is unavailable or the permission is denied/revoked, the same entries fall
 *   back to the expo path in the SAME reconcile (never dropped), and `fsi.clearAlarms()` runs
 *   when FSI was active before but is not now.
 * - endSession()/cancelAll() also call `fsi.clearAlarms()`.
 * - getStatus() surfaces AlertEngineStatus.fullScreenAlarms; permission changes reconcile on
 *   AppState 'active' like the exact-alarm setting.
 *
 * On iOS / web / a binary without the native module (an OTA update can never add it),
 * isAvailable() is false and every method resolves as a safe no-op, so the engine keeps using
 * expo-notifications everywhere and an alert is never lost.
 */
import type { FullScreenAlarmModule, FullScreenAlarmSpec, FullScreenAlarmStatus } from '../../core/contracts';
import {
  clearAlarms as nativeClearAlarms,
  getStatus as nativeGetStatus,
  isNativeModuleAvailable,
  openFullScreenIntentSettings as nativeOpenFullScreenIntentSettings,
  setAlarms as nativeSetAlarms,
  UNAVAILABLE_STATUS,
  type MgFullScreenAlarmSpec,
} from '../../../modules/mg-fullscreen-alarm';

function toNativeSpec(spec: FullScreenAlarmSpec): MgFullScreenAlarmSpec {
  return {
    id: spec.id,
    atMs: spec.atMs,
    title: spec.title,
    body: spec.body,
    deepLink: spec.deepLink,
    channelId: spec.channelId,
  };
}

export const fullScreenAlarm: FullScreenAlarmModule = {
  isAvailable(): boolean {
    return isNativeModuleAvailable();
  },

  async setAlarms(alarms: readonly FullScreenAlarmSpec[]): Promise<void> {
    if (!isNativeModuleAvailable()) return;
    await nativeSetAlarms(alarms.map(toNativeSpec));
  },

  async clearAlarms(ids?: readonly string[]): Promise<void> {
    if (!isNativeModuleAvailable()) return;
    await nativeClearAlarms(ids);
  },

  async getStatus(): Promise<FullScreenAlarmStatus> {
    if (!isNativeModuleAvailable()) return { ...UNAVAILABLE_STATUS };
    return nativeGetStatus();
  },

  async openFullScreenIntentSettings(): Promise<void> {
    if (!isNativeModuleAvailable()) return;
    await nativeOpenFullScreenIntentSettings();
  },
};
