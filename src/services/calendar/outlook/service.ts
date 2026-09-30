/**
 * OutlookCalendarService (contract in src/core/contracts.ts §17) built from injected
 * dependencies. Every operation is serialized (one Outlook sync at a time per app) and reports to
 * the shared status store. The Microsoft account is independent of the app's Google/Firebase
 * identity: "connected" means a refresh token is stored for the active uid.
 */
import { MICROSOFT_OAUTH, type CalendarPullResult, type OutlookCalendarService, type OutlookConnectResult } from '../../../core/contracts';
import { AppError, toAppError } from '../../../core/errors';
import type { AppEventMap, EventBus } from '../../../core/events';
import { DEEP_LINK_PREFIX, MS_AUTH_REDIRECT_PATH } from '../../../core/identifiers';
import { createLogger } from '../../../core/logger';
import type { Meeting } from '../../../core/types';
import { createMutex } from '../shared';
import type { CalendarStatusStore } from '../status';
import type { MicrosoftAuthPort } from './authAdapter';
import type { OutlookSyncState } from './state';
import {
  deleteOutlookEvent,
  enqueueOutlookPushes,
  enqueueUpcomingOwnMeetings,
  flushOutlookPushes,
  isOutlookPushable,
  pullOutlookChanges,
  pushOutlookMeeting,
  removeOutlookLinks,
  type FlushResult,
  type OutlookSyncDeps,
} from './sync';
import type { MicrosoftTokenManager } from './tokenManager';

const log = createLogger('calendar');

/** Exact URI registered on the Azure app registration (docs/SETUP.md §10). */
export const MS_REDIRECT_URI = `${DEEP_LINK_PREFIX}${MS_AUTH_REDIRECT_PATH}`;

export interface OutlookServiceDeps extends OutlookSyncDeps {
  tokens: MicrosoftTokenManager;
  auth: MicrosoftAuthPort;
  status: CalendarStatusStore;
  events: EventBus<AppEventMap>;
  getUid(): string | null;
  config: { clientId: string | null; tenant: string };
}

/** Contract methods plus the hooks the sync engine uses (mirror of GoogleCalendarServiceInternal). */
export interface OutlookCalendarServiceInternal extends OutlookCalendarService {
  /** Persists local changes to push (engine: meetings:changed with origin user/ai). */
  enqueue(meetingIds: readonly string[], op: 'upsert' | 'delete'): Promise<void>;
  /** Pushes queued changes. Throws calendar_not_connected when Outlook is not connected. */
  flushPending(): Promise<FlushResult>;
  /** Flush + pull, reported as one result (engine syncNow). */
  sync(options?: { full?: boolean }): Promise<CalendarPullResult>;
  /** Stored state (last sync time for the status on startup). */
  loadState(): Promise<OutlookSyncState>;
  /** Forgets the deltaLink and queue (never the tokens). */
  resetLocalState(): Promise<void>;
  /** Re-reads configuration + token presence into the status store. */
  refreshStatus(): Promise<{ configured: boolean; connected: boolean }>;
}

export function createOutlookCalendarService(deps: OutlookServiceDeps): OutlookCalendarServiceInternal {
  const mutex = createMutex();
  const configured = deps.config.clientId !== null;

  async function readAccountEmail(): Promise<string | null> {
    try {
      return (await deps.state.load()).accountEmail;
    } catch {
      // No active session (signed out): nothing to show.
      return null;
    }
  }

  async function refreshStatus(): Promise<{ configured: boolean; connected: boolean }> {
    if (!configured) return { configured: false, connected: false };
    const connected = await deps.tokens.hasRefreshToken();
    deps.status.patchOutlook({
      configured: true,
      connected,
      enabled: connected,
      accountEmail: connected ? await readAccountEmail() : null,
    });
    return { configured: true, connected };
  }

  async function ensureConnected(): Promise<void> {
    const { connected } = await refreshStatus();
    if (!configured) {
      throw new AppError('calendar_not_connected', 'Outlook is not configured (EXPO_PUBLIC_MSAL_CLIENT_ID missing)');
    }
    if (!connected) throw new AppError('calendar_not_connected', 'Outlook is not connected');
  }

  function emitSynced(result: CalendarPullResult | null, error: AppError | null): void {
    const uid = deps.getUid();
    if (!uid) return;
    deps.events.emit('calendar:synced', {
      uid,
      provider: 'outlook',
      created: result?.counts.created ?? 0,
      updated: result?.counts.updated ?? 0,
      removed: result?.counts.removed ?? 0,
      pushed: result?.counts.pushed ?? 0,
      error: error?.code ?? null,
    });
  }

  /** Runs a sync operation with the syncing flag and records its outcome. */
  async function tracked<T>(operation: () => Promise<T>, onSuccess?: (value: T) => void): Promise<T> {
    const done = deps.status.beginSync('outlook');
    try {
      const value = await operation();
      onSuccess?.(value);
      return value;
    } catch (error) {
      const appError = toAppError(error);
      if (appError.code !== 'cancelled') {
        deps.status.patchOutlook({ lastError: appError.code });
        await deps.state
          .update((current) => ({ ...current, lastError: appError.code }))
          .catch((stateError: unknown) => log.warn('Could not store the Outlook sync error', toAppError(stateError).code));
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
          const flushed = await flushOutlookPushes(deps);
          if (flushed.blockedBy !== null) {
            // Same cause would fail the pull (offline or token problem): report it once.
            throw new AppError(flushed.blockedBy, 'Outlook sync is blocked');
          }
          const pulled = await pullOutlookChanges(deps, { full });
          return {
            ...pulled,
            counts: { ...pulled.counts, pushed: flushed.pushed, failed: flushed.failed },
          };
        },
        (value) => deps.status.patchOutlook({ lastSyncAt: value.syncedAt, lastError: null }),
      );
      emitSynced(result, null);
      return result;
    } catch (error) {
      const appError = toAppError(error);
      emitSynced(null, appError);
      throw appError;
    }
  }

  async function connectLocked(): Promise<OutlookConnectResult> {
    const clientId = deps.config.clientId;
    if (clientId === null) {
      throw new AppError('not_configured', 'EXPO_PUBLIC_MSAL_CLIENT_ID is not set');
    }
    // Pin the uid across the browser round-trip: if the app account changes while the prompt or
    // the token exchange is pending (sign out -> sign in as someone else), the grant must NOT be
    // stored under the new uid - that would sync user A's Outlook calendar into user B's data.
    const uid = deps.getUid();
    if (uid === null) {
      throw new AppError('unauthenticated', 'No active session for the Outlook connect');
    }
    const prompt = await deps.auth.promptForCode({
      clientId,
      tenant: deps.config.tenant,
      scopes: MICROSOFT_OAUTH.scopes,
      redirectUri: MS_REDIRECT_URI,
    });
    if (prompt.type === 'cancelled') return { status: 'cancelled', initialSync: null };
    if (prompt.type === 'failed') {
      log.warn('Microsoft sign-in failed', { message: prompt.message ?? 'unknown' });
      return { status: 'failed', initialSync: null };
    }
    if (deps.getUid() !== uid) {
      log.warn('The app account changed during the Microsoft sign-in; discarding the grant');
      return { status: 'cancelled', initialSync: null };
    }

    let accountEmail: string | null = null;
    try {
      const grant = await deps.tokens.exchangeCode(prompt.code, prompt.codeVerifier, MS_REDIRECT_URI);
      if (deps.getUid() !== uid) {
        log.warn('The app account changed during the Microsoft token exchange; discarding the grant');
        return { status: 'cancelled', initialSync: null };
      }
      await deps.tokens.adoptGrant(grant);
      // A new connection starts from a clean slate (full listing, no stale queue).
      await deps.state.clear();
      try {
        const me = await deps.api.getMe();
        accountEmail = me.mail ?? me.userPrincipalName ?? null;
      } catch (error) {
        log.warn('Could not read the Microsoft account profile', toAppError(error).code);
      }
      await deps.state.update((current) => ({ ...current, accountEmail }));
    } catch (error) {
      const appError = toAppError(error);
      log.warn('Microsoft token exchange failed', { code: appError.code });
      await deps.tokens.clear().catch(() => undefined);
      deps.status.patchOutlook({ configured: true, connected: false, enabled: false, lastError: appError.code });
      return { status: 'failed', initialSync: null };
    }
    deps.status.patchOutlook({ configured: true, connected: true, enabled: true, accountEmail, lastError: null });

    let initialSync: CalendarPullResult | null = null;
    try {
      initialSync = await tracked(
        async () => {
          const pulled = await pullOutlookChanges(deps, { full: true });
          await enqueueUpcomingOwnMeetings(deps);
          const flushed = await flushOutlookPushes(deps);
          if (flushed.blockedBy !== null) deps.status.patchOutlook({ lastError: flushed.blockedBy });
          return { ...pulled, counts: { ...pulled.counts, pushed: flushed.pushed, failed: flushed.failed } };
        },
        (value) => deps.status.patchOutlook({ lastSyncAt: value.syncedAt }),
      );
      emitSynced(initialSync, null);
    } catch (error) {
      // Connected; the first sync failed (shown through status.lastError, retried by the engine).
      const appError = toAppError(error);
      log.warn('Initial Outlook sync failed', { code: appError.code });
      emitSynced(null, appError);
    }
    return { status: 'connected', initialSync };
  }

  const service: OutlookCalendarServiceInternal = {
    isConfigured() {
      return configured;
    },

    async isConnected() {
      const { connected } = await refreshStatus();
      return connected;
    },

    connect() {
      return mutex.run(connectLocked);
    },

    disconnect(options = {}) {
      return mutex.run(async () => {
        await deps.tokens.clear();
        deps.status.patchOutlook({ connected: false, enabled: false, accountEmail: null, lastError: null });
        const done = deps.status.beginSync('outlook');
        try {
          const { removed, unlinked } = await removeOutlookLinks(deps);
          log.info('Outlook disconnected', { removed, unlinked });
          await deps.state.clear();
        } finally {
          done();
        }
        if (options.revoke) {
          // Graph has no programmatic consent revoke: open the Microsoft account page instead.
          await deps.auth.openConsentPage();
        }
      });
    },

    pushMeeting(meeting: Meeting) {
      return mutex.run(async () => {
        await ensureConnected();
        if (!isOutlookPushable(meeting) && meeting.deletedAt === null && meeting.status === 'scheduled') {
          throw new AppError('unsupported', 'This meeting is not pushed to Outlook', {
            details: { source: meeting.source, recurring: meeting.recurrence !== null },
          });
        }
        const outcome = await pushOutlookMeeting(deps, meeting);
        return outcome.meeting;
      });
    },

    removeMeeting(meeting: Meeting) {
      if (meeting.external.outlookEventId === null) return Promise.resolve();
      return mutex.run(async () => {
        await ensureConnected();
        await deleteOutlookEvent(deps, meeting);
      });
    },

    pullChanges(options = {}) {
      return mutex.run(async () => {
        await ensureConnected();
        try {
          const result = await tracked(
            () => pullOutlookChanges(deps, { full: options.full === true }),
            (value) => deps.status.patchOutlook({ lastSyncAt: value.syncedAt, lastError: null }),
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

    enqueue(meetingIds, op) {
      return enqueueOutlookPushes(deps, meetingIds, op);
    },

    flushPending() {
      return mutex.run(async () => {
        await ensureConnected();
        return tracked(
          () => flushOutlookPushes(deps),
          (result) => {
            if (result.blockedBy !== null) deps.status.patchOutlook({ lastError: result.blockedBy });
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
