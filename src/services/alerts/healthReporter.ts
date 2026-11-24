/**
 * M14: the alerts health report (reportAlertHealth callable) for the admin alerts health view.
 * What this phone knows about its own alarms, never meeting data: the notification permission,
 * exact and full-screen alarms on Android, how many alarms are scheduled, when they were last
 * planned, the platform and the app version. Sent once per session, a short while after the
 * session starts (the first reconcile has run by then), and only when something changed or the
 * last report is older than a day. Failures are silent: the next session tries again.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { httpsCallable } from 'firebase/functions';
import { Platform } from 'react-native';

import { CALLABLES, reportAlertHealthRequestSchema, type ReportAlertHealthRequest } from '../../core/aiContract';
import type { AlertEngineStatus } from '../../core/contracts';
import { appEvents, type AppEventMap, type EventBus } from '../../core/events';
import { GLOBAL_STORAGE_KEYS } from '../../core/identifiers';
import { functions } from '../../config/firebase';

/** A report older than this is sent again even when nothing changed (the admin view flags plans older than a day). */
const RESEND_MS = 12 * 3_600_000;
export const HEALTH_REPORT_DELAY_MS = 30_000;

interface StoredState {
  installationId: string;
  lastHash: string | null;
  lastAt: number | null;
}

export interface HealthReporterDeps {
  getStatus(): Promise<AlertEngineStatus>;
  send(request: ReportAlertHealthRequest): Promise<void>;
  storage: Pick<typeof AsyncStorage, 'getItem' | 'setItem'>;
  platform: 'ios' | 'android' | 'web';
  appVersion: string;
  now: () => number;
  newId: () => string;
}

function randomId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 24; i += 1) id += alphabet[Math.floor(Math.random() * alphabet.length)];
  return id;
}

/** The report from the engine status (pure). */
export function healthReportOf(status: AlertEngineStatus, installationId: string, platform: HealthReporterDeps['platform'], appVersion: string): ReportAlertHealthRequest {
  const permission = status.permission;
  const notifications = permission === null ? 'undetermined' : permission.notifications === 'provisional' ? 'granted' : permission.notifications;
  const exact = permission?.exactAlarms;
  const fsi = status.fullScreenAlarms ?? null;
  return {
    installationId,
    platform,
    appVersion: appVersion.slice(0, 32) || 'unknown',
    notifications,
    exactAlarms: exact === 'granted' ? true : exact === 'denied' ? false : fsi !== null ? fsi.exactAllowed : null,
    fullScreen: platform === 'android' && fsi !== null ? fsi.fullScreenAllowed : null,
    batteryUnrestricted: null,
    scheduledCount: Math.max(0, Math.min(10_000, Math.round(status.pendingCount))),
    lastReconcileAt: status.lastReconcileAt,
  };
}

function hashOf(report: ReportAlertHealthRequest, uid: string | null): string {
  // lastReconcileAt changes on every reconcile; the hash keys on the state that matters and the
  // account (another account on this phone reports at once).
  const { lastReconcileAt: _ignored, ...rest } = report;
  return JSON.stringify({ uid, ...rest });
}

async function readState(deps: HealthReporterDeps): Promise<StoredState> {
  try {
    const raw = await deps.storage.getItem(GLOBAL_STORAGE_KEYS.alertHealth);
    const parsed = raw ? (JSON.parse(raw) as Partial<StoredState>) : {};
    if (typeof parsed.installationId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(parsed.installationId)) {
      return { installationId: parsed.installationId, lastHash: parsed.lastHash ?? null, lastAt: parsed.lastAt ?? null };
    }
  } catch {
    // a fresh id below
  }
  return { installationId: deps.newId(), lastHash: null, lastAt: null };
}

/** One report if due. Returns whether it was sent. Never throws. */
export async function reportAlertHealthOnce(deps: HealthReporterDeps, uid: string | null = null): Promise<boolean> {
  try {
    const state = await readState(deps);
    const status = await deps.getStatus();
    if (!status.initialized) return false;
    const report = reportAlertHealthRequestSchema.parse(healthReportOf(status, state.installationId, deps.platform, deps.appVersion));
    const hash = hashOf(report, uid);
    const now = deps.now();
    if (state.lastHash === hash && state.lastAt !== null && now - state.lastAt < RESEND_MS) return false;
    await deps.send(report);
    await deps.storage.setItem(GLOBAL_STORAGE_KEYS.alertHealth, JSON.stringify({ installationId: state.installationId, lastHash: hash, lastAt: now }));
    return true;
  } catch {
    return false;
  }
}

export function startAlertHealthReporter(
  getStatus: () => Promise<AlertEngineStatus>,
  events: Pick<EventBus<AppEventMap>, 'on'> = appEvents,
  overrides: Partial<HealthReporterDeps> = {},
): () => void {
  const deps: HealthReporterDeps = {
    getStatus,
    async send(request) {
      if (!functions) throw new Error('not configured');
      await httpsCallable(functions, CALLABLES.reportAlertHealth, { timeout: 15_000 })(request);
    },
    storage: AsyncStorage,
    platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web',
    appVersion: Constants.expoConfig?.version ?? '',
    now: () => Date.now(),
    newId: randomId,
    ...overrides,
  };
  let timer: ReturnType<typeof setTimeout> | null = null;
  const off = events.on('session:started', ({ uid }) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void reportAlertHealthOnce(deps, uid);
    }, HEALTH_REPORT_DELAY_MS);
  });
  return () => {
    if (timer !== null) clearTimeout(timer);
    off();
  };
}
