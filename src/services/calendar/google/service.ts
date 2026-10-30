/**
 * GoogleCalendarService (contract in src/core/contracts.ts) built from injected dependencies.
 * Every operation is serialized (one Google sync at a time per app) and reports to the status store.
 */
import type {
  AuthService,
  CalendarPullResult,
  GoogleCalendarService,
  GoogleConnectResult,
  PreferencesRepository,
} from '../../../core/contracts';
import { AppError, toAppError } from '../../../core/errors';
import type { AppEventMap, EventBus } from '../../../core/events';
import { createLogger } from '../../../core/logger';
import type { ConferenceDetails, Meeting } from '../../../core/types';
import { createMutex } from '../shared';
import { defaultGoogleSyncState, type GoogleSyncState } from '../stateStore';
import type { CalendarStatusStore } from '../status';
import {
  deleteGoogleEvent,
  enqueueGooglePushes,
  enqueueUpcomingOwnMeetings,
  flushGooglePushes,
  pullGoogleChanges,
  pushGoogleMeeting,
  removeGoogleLinks,
  type FlushResult,
  type GoogleSyncDeps,
} from './sync';

const log = createLogger('calendar');

export interface GoogleServiceDeps extends GoogleSyncDeps {
  auth: Pick<AuthService, 'hasCalendarScope' | 'requestCalendarScope' | 'revokeGoogleAccess'>;
  preferences: Pick<PreferencesRepository, 'get' | 'update'>;
  status: CalendarStatusStore;
  events: EventBus<AppEventMap>;
  getUid(): string | null;
}

/** Contract methods plus the hooks the sync engine uses. */
export interface GoogleCalendarServiceInternal extends GoogleCalendarService {
  /** Persists local changes to push (engine: meetings:changed with origin user/ai). */
  enqueue(meetingIds: readonly string[], op: 'upsert' | 'delete'): Promise<void>;
  /** Pushes queued changes. Throws calendar_not_connected when sync is off. */
  flushPending(): Promise<FlushResult>;
  /** Flush + pull, reported as one result (engine syncNow). */
  sync(options?: { full?: boolean }): Promise<CalendarPullResult>;
  /** Stored state (last sync time for the status on startup). */
  loadState(): Promise<GoogleSyncState>;
  /** Forgets the sync token and queue (sync was turned off on another device). */
  resetLocalState(): Promise<void>;
  /** Re-reads prefs + scope into the status store. */
  refreshStatus(): Promise<{ enabled: boolean; hasScope: boolean }>;
}

export function createGoogleCalendarService(deps: GoogleServiceDeps): GoogleCalendarServiceInternal {
  const mutex = createMutex();

  async function refreshStatus(): Promise<{ enabled: boolean; hasScope: boolean }> {
    const prefs = await deps.preferences.get();
    const hasScope = await deps.auth.hasCalendarScope();
    deps.status.patchGoogle({ enabled: prefs.googleCalendarSyncEnabled, hasScope });
    return { enabled: prefs.googleCalendarSyncEnabled, hasScope };
  }

  async function ensureConnected(): Promise<void> {
    const { enabled, hasScope } = await refreshStatus();
    if (!enabled) throw new AppError('calendar_not_connected', 'Google Calendar sync is off');
    if (!hasScope) {
      throw new AppError('calendar_not_connected', 'The Google Calendar permission is missing', {
        details: { reason: 'scope_missing' },
      });
    }
  }

  function emitSynced(result: CalendarPullResult | null, error: AppError | null): void {
    const uid = deps.getUid();
    if (!uid) return;
    deps.events.emit('calendar:synced', {
      uid,
      provider: 'google',
      created: result?.counts.created ?? 0,
      updated: result?.counts.updated ?? 0,
      removed: result?.counts.removed ?? 0,
      pushed: result?.counts.pushed ?? 0,
      error: error?.code ?? null,
    });
  }

  /** Runs a sync operation with the syncing flag and records its outcome. */
  async function tracked<T>(operation: () => Promise<T>, onSuccess?: (value: T) => void): Promise<T> {
    const done = deps.status.beginSync('google');
    try {
      const value = await operation();
      onSuccess?.(value);
      return value;
    } catch (error) {
      const appError = toAppError(error);
      if (appError.code !== 'cancelled') {
        deps.status.patchGoogle({ lastError: appError.code });
        await deps.state
          .update((current) => ({ ...current, lastError: appError.code }))
          .catch((stateError: unknown) => log.warn('Could not store the sync error', toAppError(stateError).code));
      }
      throw appError;
    } finally {
      done();
    }
  }

  async function syncLocked(full: boolean): Promise<CalendarPullResult> {
    await ensureConnected();
    try {
      const result = await tracked(
        async () => {
          const flushed = await flushGooglePushes(deps);
          if (flushed.blockedBy !== null) {
            // Same cause would fail the pull (offline, token or scope problem): report it once.
            throw new AppError(flushed.blockedBy, 'Google Calendar sync is blocked');
          }
          const pulled = await pullGoogleChanges(deps, { full });
          return {
            ...pulled,
            counts: { ...pulled.counts, pushed: flushed.pushed, failed: flushed.failed },
          };
        },
        (value) => deps.status.patchGoogle({ lastSyncAt: value.syncedAt, lastError: null }),
      );
      emitSynced(result, null);
      return result;
    } catch (error) {
      const appError = toAppError(error);
      emitSynced(null, appError);
      throw appError;
    }
  }

  const service: GoogleCalendarServiceInternal = {
    async isConnected() {
      const { enabled, hasScope } = await refreshStatus();
      return enabled && hasScope;
    },

    connect() {
      return mutex.run(async (): Promise<GoogleConnectResult> => {
        let granted: boolean;
        try {
          granted = await deps.auth.requestCalendarScope();
        } catch (error) {
          const appError = toAppError(error);
          if (appError.code === 'cancelled') return { status: 'cancelled', initialSync: null };
          throw appError;
        }
        if (!granted) {
          deps.status.patchGoogle({ hasScope: false });
          return { status: 'scope_denied', initialSync: null };
        }
        // A new connection starts from a clean slate (full listing, fresh hashes), but the queued
        // pushes survive: edits and deletes made while the scope was lost must still reach Google.
        await deps.state.update((current) => ({ ...defaultGoogleSyncState(), pending: current.pending }));
        await deps.preferences.update({ googleCalendarSyncEnabled: true });
        deps.status.patchGoogle({ enabled: true, hasScope: true, lastError: null });

        let initialSync: CalendarPullResult | null = null;
        try {
          initialSync = await tracked(
            async () => {
              const pulled = await pullGoogleChanges(deps, { full: true });
              await enqueueUpcomingOwnMeetings(deps);
              const flushed = await flushGooglePushes(deps);
              if (flushed.blockedBy !== null) deps.status.patchGoogle({ lastError: flushed.blockedBy });
              return { ...pulled, counts: { ...pulled.counts, pushed: flushed.pushed, failed: flushed.failed } };
            },
            (value) => deps.status.patchGoogle({ lastSyncAt: value.syncedAt }),
          );
          emitSynced(initialSync, null);
        } catch (error) {
          // Connected; the first sync failed (shown through status.lastError, retried by the engine).
          const appError = toAppError(error);
          log.warn('Initial Google Calendar sync failed', { code: appError.code });
          emitSynced(null, appError);
        }
        return { status: 'connected', initialSync };
      });
    },

    disconnect(options = {}) {
      return mutex.run(async () => {
        await deps.preferences.update({ googleCalendarSyncEnabled: false });
        deps.status.patchGoogle({ enabled: false, lastError: null });
        const done = deps.status.beginSync('google');
        try {
          const { removed, unlinked } = await removeGoogleLinks(deps);
          log.info('Google Calendar disconnected', { removed, unlinked });
          await deps.state.clear();
        } finally {
          done();
        }
        if (options.revoke) {
          await deps.auth.revokeGoogleAccess();
          deps.status.patchGoogle({ hasScope: false });
        }
      });
    },

    pushMeeting(meeting: Meeting) {
      return mutex.run(async () => {
        await ensureConnected();
        const outcome = await pushGoogleMeeting(deps, meeting);
        return outcome.meeting;
      });
    },

    removeMeeting(meeting: Meeting) {
      if (meeting.external.googleEventId === null) return Promise.resolve();
      return mutex.run(async () => {
        await ensureConnected();
        await deleteGoogleEvent(deps, meeting);
      });
    },

    pullChanges(options = {}) {
      return mutex.run(async () => {
        await ensureConnected();
        try {
          const result = await tracked(
            () => pullGoogleChanges(deps, { full: options.full === true }),
            (value) => deps.status.patchGoogle({ lastSyncAt: value.syncedAt, lastError: null }),
          );
          emitSynced(result, null);
          return result;
        } catch (error) {
          const appError = toAppError(error);
          emitSynced(null, appError);
          throw appError;
        }
      });
    },

    createMeetLink(meetingId: string) {
      return mutex.run(async (): Promise<ConferenceDetails> => {
        await ensureConnected();
        const meeting = await deps.meetings.get(meetingId);
        if (!meeting || meeting.deletedAt !== null) {
          throw new AppError('not_found', 'Meeting not found', { details: { meetingId } });
        }
        if (meeting.conference?.provider === 'google_meet' && meeting.conference.url !== null) {
          return meeting.conference;
        }
        if (meeting.source === 'device') {
          throw new AppError('unsupported', 'Device calendar meetings cannot get a Meet link');
        }
        if (meeting.status === 'cancelled') {
          throw new AppError('invalid_input', 'Cancelled meetings do not get a Meet link');
        }
        const outcome = await pushGoogleMeeting(deps, meeting, { requestMeetLink: true });
        const conference = outcome.meeting.conference;
        if (!conference || conference.provider !== 'google_meet' || conference.url === null) {
          throw new AppError('upstream_error', 'Google Calendar did not create a Meet link', { retryable: true });
        }
        return conference;
      });
    },

    enqueue(meetingIds, op) {
      return enqueueGooglePushes(deps, meetingIds, op);
    },

    flushPending() {
      return mutex.run(async () => {
        await ensureConnected();
        return tracked(
          () => flushGooglePushes(deps),
          (result) => {
            if (result.blockedBy !== null) deps.status.patchGoogle({ lastError: result.blockedBy });
          },
        );
      });
    },

    sync(options = {}) {
      return mutex.run(() => syncLocked(options.full === true));
    },

    loadState() {
      return deps.state.load();
    },

    resetLocalState() {
      return mutex.run(() => deps.state.clear());
    },

    refreshStatus,
  };
  return service;
}
