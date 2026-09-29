/**
 * CalendarSyncEngine (contract in src/core/contracts.ts): per-session orchestration.
 *
 * - start(uid) (session manager, also on 'session:started'): subscribes to meetings:changed /
 *   preferences:changed, AppState (pull on foreground + every 5 min while active) and connectivity.
 * - LOCAL writes (origin 'user' | 'ai') are queued for Google (persisted) and for the device export
 *   calendar, then pushed after a short debounce. Remote, imported and calendar-origin writes are
 *   never pushed (loop prevention).
 * - syncNow() (UI "Sync now", background task, foreground/interval/connectivity): Google flush +
 *   pull, device import + export. At most one run at a time; calls made while a run is in flight
 *   are coalesced into ONE follow-up run that starts when it ends (the running one read its
 *   preferences when it started, so a settings change during it must not be lost).
 */
import type {
  CalendarStatus,
  CalendarSyncEngine,
  CalendarSyncReason,
  CalendarSyncReport,
  PreferencesRepository,
} from '../../core/contracts';
import { AppError, toAppError } from '../../core/errors';
import type { AppEventMap, EventBus, MeetingsChangedEvent, PreferencesChangedEvent, Unsubscribe } from '../../core/events';
import { createLogger } from '../../core/logger';
import type { Preferences } from '../../core/types';
import type { DeviceCalendarServiceInternal } from './device/service';
import type { GoogleCalendarServiceInternal } from './google/service';
import type { CalendarStatusStore } from './status';

const log = createLogger('calendar');

export const PUSH_DEBOUNCE_MS = 2000;
export const FOREGROUND_INTERVAL_MS = 5 * 60 * 1000;
/** Minimum spacing of automatic (non-manual) syncs. */
export const AUTO_SYNC_THROTTLE_MS = 2 * 60 * 1000;

export type AppStateStatus = 'active' | 'background' | 'inactive' | 'unknown' | 'extension';

export interface EngineDeps {
  google: GoogleCalendarServiceInternal;
  device: DeviceCalendarServiceInternal;
  preferences: Pick<PreferencesRepository, 'get'>;
  getActiveUid(): string | null;
  status: CalendarStatusStore;
  events: EventBus<AppEventMap>;
  appState?: {
    currentState(): AppStateStatus;
    subscribe(listener: (state: AppStateStatus) => void): Unsubscribe;
  };
  connectivity?: {
    subscribe(listener: (online: boolean) => void): Unsubscribe;
  };
  /** Optional auth hook: Google access changed (sign-in, scope grant, revoke). */
  onGoogleAccessChanged?: (listener: () => void) => Unsubscribe;
  now(): Date;
  timers?: {
    setTimeout(callback: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
    setInterval(callback: () => void, ms: number): unknown;
    clearInterval(handle: unknown): void;
  };
}

const LOCAL_REASONS: ReadonlySet<MeetingsChangedEvent['reason']> = new Set(['created', 'updated', 'deleted']);

export function isPushableChange(event: MeetingsChangedEvent): boolean {
  return (
    (event.origin === 'user' || event.origin === 'ai') &&
    LOCAL_REASONS.has(event.reason) &&
    event.changedIds !== undefined &&
    event.changedIds.length > 0
  );
}

export interface CalendarSyncEngineInternal extends CalendarSyncEngine {
  /** Pushes queued local changes now (tests / explicit calls). */
  flushLocalChanges(): Promise<void>;
  isStarted(): boolean;
}

export function createCalendarSyncEngine(deps: EngineDeps): CalendarSyncEngineInternal {
  const timers = deps.timers ?? {
    setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
    clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    setInterval: (callback: () => void, ms: number) => setInterval(callback, ms),
    clearInterval: (handle: unknown) => clearInterval(handle as ReturnType<typeof setInterval>),
  };

  let uid: string | null = null;
  /** Bumped on start/stop: async work from an earlier session must not touch this one. */
  let generation = 0;
  let subscriptions: Unsubscribe[] = [];
  let preferences: Preferences | null = null;
  let debounceHandle: unknown = null;
  let intervalHandle: unknown = null;
  let inflight: Promise<CalendarSyncReport> | null = null;
  /** The coalesced follow-up of the run in flight (shared by every call made meanwhile). */
  let followUp: Promise<CalendarSyncReport> | null = null;
  let followUpOptions: { reason: CalendarSyncReason; headless: boolean } | null = null;
  let lastAutoSyncAt = 0;
  const pendingGoogle = new Map<string, 'upsert' | 'delete'>();
  const pendingDevice = new Set<string>();
  let flushing: Promise<void> | null = null;

  function isCurrent(gen: number): boolean {
    return gen === generation && uid !== null;
  }

  async function currentPreferences(): Promise<Preferences> {
    if (preferences) return preferences;
    preferences = await deps.preferences.get();
    return preferences;
  }

  async function applyPreferencesToStatus(prefs: Preferences): Promise<void> {
    const own = await deps.device.ownSelection(prefs);
    deps.status.patchGoogle({ enabled: prefs.googleCalendarSyncEnabled });
    deps.status.patchDevice({
      enabled: own.importIds.length > 0 || own.exportId !== null,
      importCalendarIds: own.importIds,
      exportCalendarId: own.exportId,
    });
  }

  // ---- local changes -------------------------------------------------------------------------

  function scheduleFlush(): void {
    if (debounceHandle !== null) timers.clearTimeout(debounceHandle);
    debounceHandle = timers.setTimeout(() => {
      debounceHandle = null;
      void flushLocalChanges();
    }, PUSH_DEBOUNCE_MS);
  }

  async function flushLocalChanges(): Promise<void> {
    if (flushing) {
      await flushing;
      if (pendingGoogle.size === 0 && pendingDevice.size === 0) return;
    }
    const gen = generation;
    const run = (async () => {
      const prefs = await currentPreferences();
      const googleBatch = [...pendingGoogle.entries()];
      pendingGoogle.clear();
      const deviceBatch = [...pendingDevice];
      pendingDevice.clear();

      if (prefs.googleCalendarSyncEnabled && googleBatch.length > 0) {
        try {
          const upserts = googleBatch.filter(([, op]) => op === 'upsert').map(([id]) => id);
          const deletes = googleBatch.filter(([, op]) => op === 'delete').map(([id]) => id);
          // Persist first: a failed / offline push is retried by later syncs, even after a restart.
          await deps.google.enqueue(upserts, 'upsert');
          await deps.google.enqueue(deletes, 'delete');
          if (isCurrent(gen)) await deps.google.flushPending();
        } catch (error) {
          log.warn('Pushing local changes to Google failed', { code: toAppError(error).code });
        }
      }
      if (deviceBatch.length > 0 && isCurrent(gen)) {
        const own = await deps.device.ownSelection(prefs);
        if (own.exportId !== null) {
          try {
            await deps.device.syncExports({ meetingIds: deviceBatch });
          } catch (error) {
            log.warn('Exporting local changes to the device calendar failed', { code: toAppError(error).code });
          }
        }
      }
    })();
    flushing = run;
    try {
      await run;
    } finally {
      if (flushing === run) flushing = null;
    }
  }

  /**
   * Persists Google pushes right away (the debounce only delays the network flush): a meeting
   * created or deleted just before the app is killed must still reach Google on a later sync.
   * Re-enqueueing the same id in flushLocalChanges is harmless (same op, and an unchanged
   * Google-visible hash is never re-sent).
   */
  function persistGooglePushes(ids: readonly string[], op: 'upsert' | 'delete'): void {
    const gen = generation;
    void currentPreferences()
      .then(async (prefs) => {
        if (!isCurrent(gen) || !prefs.googleCalendarSyncEnabled) return;
        await deps.google.enqueue(ids, op);
      })
      .catch((error: unknown) => log.warn('Could not queue local changes for Google', { code: toAppError(error).code }));
  }

  function onMeetingChanged(event: MeetingsChangedEvent): void {
    if (uid === null || event.uid !== uid) return;
    if (isPushableChange(event)) {
      const op = event.reason === 'deleted' ? 'delete' : 'upsert';
      const ids = event.changedIds ?? [];
      for (const id of ids) {
        pendingGoogle.set(id, op);
        pendingDevice.add(id);
      }
      persistGooglePushes(ids, op);
      scheduleFlush();
      return;
    }
    // Edits synced from another device: refresh this device's exported copies.
    if (event.reason === 'remote' && event.changedIds && event.changedIds.length > 0) {
      for (const id of event.changedIds) pendingDevice.add(id);
      scheduleFlush();
    }
  }

  // ---- preferences ---------------------------------------------------------------------------

  function onPreferencesChanged(event: PreferencesChangedEvent): void {
    if (uid === null || event.uid !== uid) return;
    const previous = preferences;
    preferences = event.preferences;
    const gen = generation;
    void applyPreferencesToStatus(event.preferences).catch((error: unknown) =>
      log.warn('Could not refresh the calendar status', { code: toAppError(error).code }),
    );
    if (event.origin === 'cache' || previous === null) return;

    const keys = new Set(event.changedKeys);
    if (keys.has('googleCalendarSyncEnabled') && !event.preferences.googleCalendarSyncEnabled && event.origin === 'remote') {
      // Turned off on another device (which already removed the imported meetings).
      void deps.google.resetLocalState().catch((error: unknown) =>
        log.warn('Could not reset the Google sync state', { code: toAppError(error).code }),
      );
    }
    const googleTurnedOn = keys.has('googleCalendarSyncEnabled') && event.preferences.googleCalendarSyncEnabled;
    const deviceChanged = keys.has('deviceCalendarImportIds') || keys.has('deviceCalendarExportId');
    if ((googleTurnedOn || deviceChanged) && isCurrent(gen)) {
      void syncNow({ reason: 'preferences' }).catch((error: unknown) =>
        log.warn('Calendar sync after a settings change failed', { code: toAppError(error).code }),
      );
    }
  }

  // ---- sync ----------------------------------------------------------------------------------

  async function runSync(options: { reason: CalendarSyncReason; headless: boolean }): Promise<CalendarSyncReport> {
    const activeUid = uid ?? deps.getActiveUid();
    if (activeUid === null) throw new AppError('unauthenticated', 'No active session for calendar sync');
    const prefs = options.headless ? await deps.preferences.get() : await currentPreferences();
    await applyPreferencesToStatus(prefs);
    const report: CalendarSyncReport = { google: null, device: null, errors: [] };

    if (prefs.googleCalendarSyncEnabled) {
      try {
        report.google = await deps.google.sync();
      } catch (error) {
        report.errors.push({ provider: 'google', code: toAppError(error).code });
      }
    }

    const own = await deps.device.ownSelection(prefs);
    try {
      const result = await deps.device.sync();
      // Cleanup-only runs (nothing selected on this device) are not reported as a device sync.
      if (own.importIds.length > 0 || own.exportId !== null) report.device = result;
    } catch (error) {
      report.errors.push({ provider: 'device', code: toAppError(error).code });
    }
    log.debug('Calendar sync finished', { reason: options.reason, errors: report.errors.length });
    return report;
  }

  function startRun(options: { reason: CalendarSyncReason; headless: boolean }): Promise<CalendarSyncReport> {
    const run = runSync(options);
    inflight = run;
    const clear = (): void => {
      if (inflight === run) inflight = null;
    };
    run.then(clear, clear);
    return run;
  }

  function syncNow(options: { reason?: CalendarSyncReason; headless?: boolean } = {}): Promise<CalendarSyncReport> {
    const requested = { reason: options.reason ?? 'manual', headless: options.headless === true };
    const running = inflight;
    if (!running) return startRun(requested);
    // Latest reason wins; a foreground request upgrades a headless follow-up.
    followUpOptions = {
      reason: requested.reason,
      headless: followUpOptions ? followUpOptions.headless && requested.headless : requested.headless,
    };
    if (!followUp) {
      const next = running
        .then(
          () => undefined,
          () => undefined,
        )
        .then(() => {
          const nextOptions = followUpOptions ?? requested;
          followUp = null;
          followUpOptions = null;
          return startRun(nextOptions);
        });
      followUp = next;
    }
    return followUp;
  }

  function autoSync(reason: CalendarSyncReason): void {
    const now = deps.now().getTime();
    if (now - lastAutoSyncAt < AUTO_SYNC_THROTTLE_MS) return;
    lastAutoSyncAt = now;
    void syncNow({ reason }).catch((error: unknown) =>
      log.warn('Automatic calendar sync failed', { reason, code: toAppError(error).code }),
    );
  }

  function startInterval(): void {
    if (intervalHandle !== null) return;
    intervalHandle = timers.setInterval(() => autoSync('foreground'), FOREGROUND_INTERVAL_MS);
  }

  function stopInterval(): void {
    if (intervalHandle === null) return;
    timers.clearInterval(intervalHandle);
    intervalHandle = null;
  }

  async function initialize(gen: number): Promise<void> {
    const [googleState, deviceState] = await Promise.all([deps.google.loadState(), deps.device.loadState()]);
    if (!isCurrent(gen)) return;
    deps.status.patchGoogle({ lastSyncAt: googleState.lastSyncAt, lastError: googleState.lastError });
    deps.status.patchDevice({ lastSyncAt: deviceState.lastSyncAt, lastError: deviceState.lastError });
    const prefs = await currentPreferences();
    if (!isCurrent(gen)) return;
    await applyPreferencesToStatus(prefs);
    await Promise.all([
      deps.google.refreshStatus().catch((error: unknown) =>
        log.warn('Could not read the Google Calendar permission', { code: toAppError(error).code }),
      ),
      deps.device.getPermission().catch((error: unknown) =>
        log.warn('Could not read the calendar permission', { code: toAppError(error).code }),
      ),
    ]);
    if (!isCurrent(gen)) return;
    lastAutoSyncAt = deps.now().getTime();
    await syncNow({ reason: 'session_start' });
  }

  const engine: CalendarSyncEngineInternal = {
    start(nextUid) {
      if (uid === nextUid) return;
      if (uid !== null) engine.stop();
      uid = nextUid;
      generation += 1;
      const gen = generation;
      subscriptions = [
        deps.events.on('meetings:changed', (event) => onMeetingChanged(event)),
        deps.events.on('preferences:changed', (event) => onPreferencesChanged(event)),
      ];
      if (deps.appState) {
        subscriptions.push(
          deps.appState.subscribe((state) => {
            if (state === 'active') {
              startInterval();
              void deps.device.getPermission().catch((error: unknown) =>
                log.warn('Could not read the calendar permission', { code: toAppError(error).code }),
              );
              autoSync('foreground');
            } else {
              stopInterval();
            }
          }),
        );
        if (deps.appState.currentState() === 'active') startInterval();
      }
      if (deps.connectivity) {
        let wasOnline: boolean | null = null;
        subscriptions.push(
          deps.connectivity.subscribe((online) => {
            if (online && wasOnline === false) autoSync('connectivity');
            wasOnline = online;
          }),
        );
      }
      if (deps.onGoogleAccessChanged) {
        subscriptions.push(
          deps.onGoogleAccessChanged(() => {
            void deps.google.refreshStatus().catch((error: unknown) =>
              log.warn('Could not read the Google Calendar permission', { code: toAppError(error).code }),
            );
          }),
        );
      }
      void initialize(gen).catch((error: unknown) =>
        log.warn('Calendar sync start failed', { code: toAppError(error).code }),
      );
    },

    stop() {
      if (uid === null) return;
      uid = null;
      generation += 1;
      subscriptions.forEach((unsubscribe) => unsubscribe());
      subscriptions = [];
      if (debounceHandle !== null) timers.clearTimeout(debounceHandle);
      debounceHandle = null;
      stopInterval();
      pendingGoogle.clear();
      pendingDevice.clear();
      preferences = null;
      lastAutoSyncAt = 0;
      deps.status.reset();
    },

    syncNow,
    onMeetingChanged,
    getStatus: (): CalendarStatus => deps.status.get(),
    subscribeStatus: (listener) => deps.status.subscribe(listener),
    flushLocalChanges,
    isStarted: () => uid !== null,
  };
  return engine;
}
