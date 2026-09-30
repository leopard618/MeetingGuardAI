/**
 * Tiny typed, synchronous event bus used to decouple areas (data -> calendar/alerts/i18n, ...).
 *
 * Semantics:
 * - `emit` calls handlers synchronously in registration order, on a snapshot of the handler list.
 * - A throwing handler (or a rejected promise returned by an async handler) is reported through
 *   `onHandlerError` and never affects other handlers or the emitter.
 * - Events are notifications, not commands: handlers must be idempotent and must not assume they
 *   are the only listener. Ordering-sensitive work (session start/stop) is orchestrated explicitly
 *   by the session manager, not through events.
 */
import type { AppErrorCode } from './errors';
import { createLogger } from './logger';
import type { AlertIntensity, Language, Preferences, PreferenceKey } from './types';

// ---------------------------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------------------------

/** Who caused a data write. Calendar sync only pushes changes whose origin is 'user' or 'ai'. */
export type WriteOrigin = 'user' | 'ai' | 'calendar_google' | 'calendar_device' | 'calendar_outlook' | 'migration' | 'system';

export type MeetingsChangeReason =
  /** Local create/update/delete through MeetingRepository (see `origin`). */
  | 'created'
  | 'updated'
  | 'deleted'
  /** Firestore snapshot brought changes made on another device / by the server. */
  | 'remote'
  /** Calendar import through MeetingRepository.upsertExternal. */
  | 'imported'
  /** Per-user cache loaded at session start (first data available). */
  | 'cache_loaded'
  /** Outbox writes acknowledged by the server. */
  | 'synced'
  /** Session ended; the in-memory list is now empty. */
  | 'session_reset';

export interface MeetingsChangedEvent {
  uid: string;
  /** Affected meeting ids; undefined = anything may have changed (reload everything). */
  changedIds?: string[];
  reason: MeetingsChangeReason;
  /** Present for local writes ('created' | 'updated' | 'deleted' | 'imported'). */
  origin?: WriteOrigin;
}

export interface PreferencesChangedEvent {
  uid: string;
  preferences: Preferences;
  changedKeys: PreferenceKey[];
  /** local = written on this device; remote = snapshot from another device; cache = loaded at start. */
  origin: 'local' | 'remote' | 'cache';
}

export interface SessionStartedEvent {
  uid: string;
  /** true when the session was restored at app start (persisted Firebase session). */
  restored: boolean;
}

export interface SessionEndedEvent {
  uid: string;
  reason: 'sign_out' | 'account_deleted' | 'auth_lost';
}

export interface AlertFiredEvent {
  uid: string | null;
  meetingId: string;
  kind: 'alert' | 'followup' | 'snooze';
  /** Minutes before start for 'alert'; null otherwise. */
  offsetMinutes: number | null;
  intensity: AlertIntensity;
  /** How the app learned about it. */
  via: 'notification_received' | 'notification_response' | 'in_app_timer';
}

export interface CalendarSyncedEvent {
  uid: string;
  provider: 'google' | 'device' | 'outlook';
  created: number;
  updated: number;
  removed: number;
  pushed: number;
  /** null on success. */
  error: AppErrorCode | null;
}

export interface LanguageChangedEvent {
  language: Language;
  /** 'user' = explicit choice (persist to preferences); 'preferences' = applied from synced prefs; 'device' = initial device default. */
  source: 'user' | 'preferences' | 'device';
}

export interface AppEventMap {
  'meetings:changed': MeetingsChangedEvent;
  'preferences:changed': PreferencesChangedEvent;
  'session:started': SessionStartedEvent;
  'session:ended': SessionEndedEvent;
  'alerts:fired': AlertFiredEvent;
  'calendar:synced': CalendarSyncedEvent;
  'language:changed': LanguageChangedEvent;
}

export type AppEventName = keyof AppEventMap;

// ---------------------------------------------------------------------------------------------
// Bus
// ---------------------------------------------------------------------------------------------

export type EventHandler<P> = (payload: P) => void | Promise<void>;
export type Unsubscribe = () => void;

export interface EventBus<M extends object> {
  on<K extends keyof M>(event: K, handler: EventHandler<M[K]>): Unsubscribe;
  once<K extends keyof M>(event: K, handler: EventHandler<M[K]>): Unsubscribe;
  emit<K extends keyof M>(event: K, payload: M[K]): void;
  listenerCount(event?: keyof M): number;
  /** Removes every handler (tests only). */
  clear(): void;
}

export interface EventBusOptions {
  onHandlerError?: (error: unknown, event: string) => void;
}

const log = createLogger('events');

function defaultHandlerError(error: unknown, event: string): void {
  log.error(`handler for "${event}" failed`, error);
}

export function createEventBus<M extends object>(options: EventBusOptions = {}): EventBus<M> {
  const handlers = new Map<keyof M, Set<EventHandler<never>>>();
  const reportError = options.onHandlerError ?? defaultHandlerError;

  function on<K extends keyof M>(event: K, handler: EventHandler<M[K]>): Unsubscribe {
    let set = handlers.get(event);
    if (!set) {
      set = new Set();
      handlers.set(event, set);
    }
    set.add(handler as EventHandler<never>);
    return () => {
      handlers.get(event)?.delete(handler as EventHandler<never>);
    };
  }

  function once<K extends keyof M>(event: K, handler: EventHandler<M[K]>): Unsubscribe {
    const unsubscribe = on(event, (payload: M[K]) => {
      unsubscribe();
      return handler(payload);
    });
    return unsubscribe;
  }

  function emit<K extends keyof M>(event: K, payload: M[K]): void {
    const set = handlers.get(event);
    if (!set || set.size === 0) return;
    for (const handler of [...set]) {
      try {
        const result = (handler as EventHandler<M[K]>)(payload);
        if (result && typeof (result as Promise<void>).then === 'function') {
          (result as Promise<void>).catch((error: unknown) => reportError(error, String(event)));
        }
      } catch (error) {
        reportError(error, String(event));
      }
    }
  }

  function listenerCount(event?: keyof M): number {
    if (event !== undefined) return handlers.get(event)?.size ?? 0;
    let total = 0;
    handlers.forEach((set) => {
      total += set.size;
    });
    return total;
  }

  return {
    on,
    once,
    emit,
    listenerCount,
    clear: () => handlers.clear(),
  };
}

/** The app-wide bus. Import: `import { appEvents } from '<rel>/core/events'`. */
export const appEvents: EventBus<AppEventMap> = createEventBus<AppEventMap>();
