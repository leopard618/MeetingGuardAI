/**
 * Data engine: one per app (index.ts creates the default instance). Owns the active data session:
 * the in-memory state, the per-user AsyncStorage cache, the outbox and the Firestore listeners.
 *
 * Write path (offline-first, docs/ARCHITECTURE.md §9):
 *   validate with the core builder -> persist cache doc + outbox entry (one AsyncStorage multiSet)
 *   -> apply to memory -> emit the app event -> resolve -> send to Firestore in the background.
 * Read path: memory (loaded from the cache at session start, kept current by onSnapshot).
 * All local writes run inside `writeLock`, so read-modify-write sequences never interleave and
 * `endSession` can drain pending cache writes before wiping.
 *
 * Nothing here fakes success: a failure is an AppError; an empty list is a real empty list.
 */
import type {
  CalendarProvider,
  DataService,
  ExternalMeetingUpsert,
  MeetingRange,
  MeetingRecurrenceOps,
  MeetingRepository,
  MigrationReport,
  MigrationService,
  NotesRepository,
  OutboxFlushResult,
  PreferencesRepository,
  SyncState,
  UserRepository,
} from '../../core/contracts';
import { AppError, toAppError, type AppErrorCode } from '../../core/errors';
import { appEvents, type AppEventMap, type EventBus, type Unsubscribe, type WriteOrigin } from '../../core/events';
import { ALERT_HORIZON_DAYS, firestorePaths, LEGACY_DATA_KEY, PREFERENCES_DOC_ID } from '../../core/identifiers';
import { createLogger } from '../../core/logger';
import { addMinutesIso, getDeviceTimeZone, toDate } from '../../core/time';
import {
  applyMeetingPatch,
  applyNotePatch,
  applyPreferencesPatch,
  buildMeeting,
  buildNote,
  createDefaultPreferences,
  DEFAULT_ENTITLEMENT,
  LANGUAGES,
  CANCELLED_OVERRIDE,
  mergePreferences,
  parseEntitlementDoc,
  scrubMeetingContent,
  TOMBSTONE_RETENTION_DAYS,
  tombstoneHasContent,
  tombstoneMeeting,
  userProfileSchema,
  withRecurrenceOverride,
  type AuthUser,
  type Entitlement,
  type Language,
  type Meeting,
  type MeetingCreateInput,
  type MeetingPatch,
  type Note,
  type NoteInput,
  type NotePatch,
  type PreferenceKey,
  type Preferences,
  type PreferencesPatch,
  type RecurrenceOverride,
  type UserProfile,
} from '../../core/types';
import { relinkLegacyAttachments } from './attachments';
import { cacheKeys, CACHE_VERSION, loadUserCache, readCachedMeetings, readCachedPreferences, wipeUserCache, type KeyValueStorage } from './cache';
import { decideCommit, shouldAcceptRemote } from './conflict';
import { findExternalMatch, planExternalUpserts, type ExternalUpsertResultWithInvalid } from './externalUpsert';
import { assertValidUid, isValidDocumentId } from './ids';
import {
  legacyPreferencesFromProfile,
  meetingToDoc,
  noteToDoc,
  preferencesToDoc,
  profileIdentityPatch,
  readRemoteMeeting,
  readRemoteNote,
  readRemoteProfile,
  type ReadContext,
} from './mapping';
import { planLegacyMigration, removeLegacyKeys } from './migration';
import { recurrenceEndsAt, splitRecurrenceAt, type SeriesSplit } from '../../core/recurrence';
import { isSeriesOccurrenceDate } from './recurrence';
import {
  ackEntry,
  dropEntry,
  EMPTY_OUTBOX,
  enqueueWrite,
  hasPending,
  orderedEntries,
  pendingEntries,
  recordFailure,
  requeueEntry,
  type OutboxEntry,
  type OutboxState,
  type OutboxWrite,
} from './outbox';
import type { ForegroundMonitor, NetworkMonitor } from './platform';
import type { CommitResult, RemoteCollectionSnapshot, RemoteData, RemoteDocSnapshot, RemoteStore } from './remote';
import { compareByStart, deepEqual, Mutex, nextTimestamp, withTimeout } from './util';

const log = createLogger('data');

/** Write origin of a calendar import (calendar_<provider>). */
function originForProvider(provider: CalendarProvider): WriteOrigin {
  return provider === 'device' ? 'calendar_device' : provider === 'outlook' ? 'calendar_outlook' : 'calendar_google';
}

// ---------------------------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------------------------

export type DataStatus = 'signed_out' | 'loading' | 'ready';
export type DataErrorSlot = 'meetings' | 'notes' | 'preferences' | 'entitlement';

/** Immutable view consumed by the React hooks (useSyncExternalStore). */
export interface DataSnapshot {
  uid: string | null;
  status: DataStatus;
  meetingsVersion: number;
  /** Every cached meeting incl. tombstones, sorted by startAt. */
  allMeetings: readonly Meeting[];
  /** Active meetings (not tombstoned), sorted by startAt. */
  activeMeetings: readonly Meeting[];
  meetingsById: ReadonlyMap<string, Meeting>;
  notesVersion: number;
  /** Pinned first, then updatedAt desc. */
  notes: readonly Note[];
  preferences: Preferences;
  /** Preferences are usable (server, cache, or the defaults fallback after a timeout). */
  preferencesLoaded: boolean;
  /**
   * Preferences come from the server or this device's cache, never from the timeout fallback.
   * The onboarding gate waits for this: defaults (onboardingCompleted false) shown to an existing
   * user on a slow network would send them through onboarding and overwrite their settings.
   */
  preferencesSettled: boolean;
  entitlement: Entitlement;
  entitlementLoaded: boolean;
  errors: Readonly<Record<DataErrorSlot, AppError | null>>;
  sync: SyncState;
}

export interface DataEngineTimeouts {
  /** One outbox send (transaction). */
  commitMs: number;
  /** One-shot reads (getDoc / getDocs). */
  fetchMs: number;
  /** Whole headless refresh. */
  headlessMs: number;
  /** Delay before a background flush after a local write. */
  flushDelayMs: number;
  /** Foreground: consider preferences loaded (defaults) when the server cannot be reached. */
  preferencesFallbackMs: number;
  /** Migration waits this long for the server preferences before deferring. */
  migrationPreferencesWaitMs: number;
  /** Base of the exponential retry backoff after a failed send. */
  retryBaseMs: number;
}

export const DEFAULT_TIMEOUTS: DataEngineTimeouts = {
  commitMs: 20_000,
  fetchMs: 12_000,
  headlessMs: 15_000,
  flushDelayMs: 250,
  preferencesFallbackMs: 8_000,
  migrationPreferencesWaitMs: 15_000,
  retryBaseMs: 15_000,
};

export interface DataEngineDeps {
  remote: RemoteStore;
  storage: KeyValueStorage;
  network?: NetworkMonitor;
  foreground?: ForegroundMonitor;
  events?: EventBus<AppEventMap>;
  now?: () => Date;
  /** Current UI language (i18n). Falls back to the last language:changed value, then 'en'. */
  getLanguage?: () => Language;
  getTimeZone?: () => string;
  newEntryId?: () => string;
  timeouts?: Partial<DataEngineTimeouts>;
}

// ---------------------------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------------------------

type ListenerKey = 'meetings' | 'notes' | 'preferences' | 'entitlement';

interface Session {
  uid: string;
  epoch: number;
  mode: 'foreground' | 'headless';
  user: AuthUser | null;
  ready: Promise<void>;
  loaded: boolean;
  meetings: Map<string, Meeting>;
  notes: Map<string, Note>;
  preferences: Preferences;
  /** Preferences are usable for gating (server seen, cached, or fallback after timeout). */
  preferencesKnown: boolean;
  /** The server state of preferences was seen (or created) on this device. */
  preferencesServerSeen: boolean;
  preferencesCached: boolean;
  entitlement: Entitlement;
  entitlementKnown: boolean;
  profile: UserProfile | null;
  outbox: OutboxState;
  meetingsBaseline: boolean;
  notesBaseline: boolean;
  listeners: Map<ListenerKey, Unsubscribe>;
  subscriptions: Unsubscribe[];
  timers: Set<ReturnType<typeof setTimeout>>;
  flushTimer: ReturnType<typeof setTimeout> | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  flushing: Promise<OutboxFlushResult> | null;
  bootstrappingPreferences: boolean;
  /**
   * Remote side paused (account deletion in progress): no Firestore listeners, no outbox sends.
   * Local reads keep working. See suspendRemote() / resumeRemote().
   */
  remoteSuspended: boolean;
  /** users/{uid}.preferences of a pre-rebuild profile, captured before the profile is rewritten. */
  legacyProfilePreferences: PreferencesPatch | null;
  migration: Promise<MigrationReport> | null;
  errors: Record<DataErrorSlot, AppError | null>;
  lastSyncedAt: string | null;
  /** `${kind}:${id}` whose next remote version must be accepted (after a rejected write). */
  forceServer: Set<string>;
  preferencesWaiters: Set<() => void>;
}

interface LocalChange {
  meetings?: readonly Meeting[];
  /** Meetings removed from memory and cache (tombstone purge; the outbox deletes them remotely). */
  removeMeetings?: readonly string[];
  notes?: readonly Note[];
  removeNotes?: readonly string[];
  preferences?: Preferences;
  profile?: UserProfile;
  writes?: readonly OutboxWrite[];
}

interface LocalWritePlan<T> {
  result: T;
  change: LocalChange | null;
  after?: () => void;
}

interface PersistRequest {
  meetingIds?: readonly string[];
  noteIds?: readonly string[];
  preferences?: boolean;
  entitlement?: boolean;
  profile?: boolean;
  outbox?: boolean;
}

const PERMANENT_FAILURES: ReadonlySet<AppErrorCode> = new Set<AppErrorCode>([
  'permission_denied',
  'invalid_input',
  'not_found',
  'unsupported',
  'not_configured',
]);
const NETWORK_FAILURES: ReadonlySet<AppErrorCode> = new Set<AppErrorCode>(['offline', 'timeout']);
/** Non-network failures of one entry before it is dropped (and reported). */
const MAX_SEND_ATTEMPTS = 10;
const MAX_RETRY_DELAY_MS = 10 * 60_000;
const PREFERENCE_KEYS = Object.keys(createDefaultPreferences()).filter((key) => key !== 'updatedAt') as PreferenceKey[];

function sortNotes(notes: Iterable<Note>): Note[] {
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? -1 : 1;
    return a.id < b.id ? -1 : a.id === b.id ? 0 : 1;
  });
}

function changedPreferenceKeys(before: Preferences, after: Preferences): PreferenceKey[] {
  return PREFERENCE_KEYS.filter((key) => !deepEqual(before[key], after[key]));
}

function pickPreferences(preferences: Preferences, keys: readonly PreferenceKey[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) out[key] = preferences[key];
  return out;
}

/**
 * A recurring master is in a `from`-bounded range while its series still runs: its own startAt is
 * the FIRST occurrence (docs/ARCHITECTURE.md §16), which can be far behind the window start while
 * future occurrences are still due (the consumers expand occurrences themselves and window them).
 * `recurrenceEndsAt` is the last occurrence's start (null = endless series); the occurrence's
 * duration is added so the final occurrence stays listed until it ends (its follow-up alert).
 * Invalid rules fall back to the plain startAt check instead of hiding the meeting.
 */
function seriesReachesBeyond(meeting: Meeting, fromMs: number): boolean {
  try {
    const endsAt = recurrenceEndsAt(meeting);
    return endsAt === null || Date.parse(endsAt) + meeting.durationMinutes * 60_000 >= fromMs;
  } catch {
    return Date.parse(meeting.startAt) >= fromMs;
  }
}

/** Filters/sorts meetings for list(range) and the hooks. Throws AppError('invalid_input') for bad bounds. */
export function filterMeetings(meetings: Iterable<Meeting>, range: MeetingRange = {}): Meeting[] {
  const fromMs = range.from !== undefined ? toDate(range.from).getTime() : null;
  const toMs = range.to !== undefined ? toDate(range.to).getTime() : null;
  const includeCancelled = range.includeCancelled ?? true;
  const includeDeleted = range.includeDeleted ?? false;
  const out: Meeting[] = [];
  for (const meeting of meetings) {
    if (!includeDeleted && meeting.deletedAt !== null) continue;
    if (!includeCancelled && meeting.status === 'cancelled') continue;
    const startMs = Date.parse(meeting.startAt);
    if (fromMs !== null && startMs < fromMs && !(meeting.recurrence !== null && seriesReachesBeyond(meeting, fromMs))) continue;
    if (toMs !== null && startMs >= toMs) continue;
    out.push(meeting);
  }
  return out.sort(compareByStart);
}

function isPermanentFailure(error: AppError): boolean {
  return PERMANENT_FAILURES.has(error.code);
}

/**
 * Meeting writes that carry phase-1 fields (recurrence / Outlook, stored sparsely: present only
 * when set). A 'permission_denied' for one of these most likely means the DEPLOYED Firestore
 * rules predate phase 1 (docs/HANDOFF.md §2 step 10), not a real ownership problem, so the entry
 * stays queued and retries (bounded by MAX_SEND_ATTEMPTS) instead of being dropped and rolled
 * back to the server copy - a rollback would DELETE a freshly created recurring meeting locally.
 */
function isRulesSkewEntry(entry: OutboxEntry): boolean {
  if (entry.kind !== 'meeting' || entry.data === null) return false;
  const doc = entry.data;
  if (doc.recurrence !== undefined || doc.recurrenceOverrides !== undefined || doc.seriesId !== undefined) return true;
  if (doc.source === 'outlook') return true;
  const external = doc.external;
  if (external !== null && typeof external === 'object' && !Array.isArray(external)) {
    return Object.keys(external as Record<string, unknown>).some((key) => key.startsWith('outlook'));
  }
  return false;
}

function isNetworkFailure(error: AppError): boolean {
  return NETWORK_FAILURES.has(error.code);
}

function randomEntryId(): string {
  return `ob_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------------------------

export class DataEngine {
  private readonly remote: RemoteStore;
  private readonly storage: KeyValueStorage;
  private readonly network: NetworkMonitor | undefined;
  private readonly foreground: ForegroundMonitor | undefined;
  private readonly events: EventBus<AppEventMap>;
  private readonly clock: () => Date;
  private readonly languageSource: (() => Language) | undefined;
  private readonly timeZoneSource: () => string;
  private readonly newEntryId: () => string;
  private readonly timeouts: DataEngineTimeouts;

  private session: Session | null = null;
  /** Cleanup of the last ended session (cache wipe); a new session waits for it. */
  private ending: Promise<void> | null = null;
  private epoch = 0;
  private readonly writeLock = new Mutex();
  private online: boolean | null = null;
  private lastLanguage: Language | null = null;

  private readonly snapshotListeners = new Set<() => void>();
  private snapshot: DataSnapshot | null = null;
  private meetingsVersion = 0;
  private notesVersion = 0;
  private sortedCache: { version: number; all: Meeting[]; active: Meeting[]; byId: Map<string, Meeting> } | null = null;
  private notesCache: { version: number; notes: Note[] } | null = null;

  constructor(deps: DataEngineDeps) {
    this.remote = deps.remote;
    this.storage = deps.storage;
    this.network = deps.network;
    this.foreground = deps.foreground;
    this.events = deps.events ?? appEvents;
    this.clock = deps.now ?? (() => new Date());
    this.languageSource = deps.getLanguage;
    this.timeZoneSource = deps.getTimeZone ?? getDeviceTimeZone;
    this.newEntryId = deps.newEntryId ?? randomEntryId;
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...(deps.timeouts ?? {}) };
    this.events.on('language:changed', (event) => {
      this.lastLanguage = event.language;
    });
  }

  // ---- environment ---------------------------------------------------------------------------

  private now(): Date {
    return this.clock();
  }

  private nowIso(): string {
    return this.clock().toISOString();
  }

  language(): Language {
    try {
      const value = this.languageSource?.();
      if (value && (LANGUAGES as readonly string[]).includes(value)) return value;
    } catch {
      // i18n not initialized (e.g. very early headless start): use the last known language.
    }
    return this.lastLanguage ?? 'en';
  }

  timeZone(): string {
    return this.timeZoneSource();
  }

  private defaultPreferences(): Preferences {
    return createDefaultPreferences({ language: this.language(), timezone: this.timeZone() });
  }

  private readContext(s: Session): ReadContext {
    return { uid: s.uid, timeZone: this.timeZone(), language: this.language() };
  }

  // ---- session helpers -----------------------------------------------------------------------

  private isCurrent(s: Session): boolean {
    return this.session === s && s.epoch === this.epoch;
  }

  private assertCurrent(s: Session): void {
    if (!this.isCurrent(s)) throw new AppError('unauthenticated', 'The data session ended');
  }

  /** The active session once its cache is loaded; AppError('unauthenticated') when there is none. */
  async readySession(): Promise<Session> {
    const s = this.session;
    if (!s) throw new AppError('unauthenticated', 'No active data session');
    await s.ready;
    this.assertCurrent(s);
    return s;
  }

  private addTimer(s: Session, delayMs: number, fn: () => void): void {
    const timer = setTimeout(() => {
      s.timers.delete(timer);
      if (this.isCurrent(s)) fn();
    }, delayMs);
    s.timers.add(timer);
  }

  getActiveUid(): string | null {
    return this.session?.uid ?? null;
  }

  getSessionUser(): AuthUser | null {
    return this.session?.user ?? null;
  }

  // ---- snapshot (React) ----------------------------------------------------------------------

  subscribeSnapshot = (listener: () => void): Unsubscribe => {
    this.snapshotListeners.add(listener);
    return () => {
      this.snapshotListeners.delete(listener);
    };
  };

  getSnapshot = (): DataSnapshot => {
    if (!this.snapshot) this.snapshot = this.buildSnapshot();
    return this.snapshot;
  };

  private notify(): void {
    this.snapshot = null;
    for (const listener of [...this.snapshotListeners]) {
      try {
        listener();
      } catch (error) {
        log.error('data subscriber failed', error);
      }
    }
  }

  private bumpMeetings(): void {
    this.meetingsVersion += 1;
  }

  private bumpNotes(): void {
    this.notesVersion += 1;
  }

  private buildSnapshot(): DataSnapshot {
    const s = this.session;
    if (!this.sortedCache || this.sortedCache.version !== this.meetingsVersion) {
      const all = s ? [...s.meetings.values()].sort(compareByStart) : [];
      this.sortedCache = {
        version: this.meetingsVersion,
        all,
        active: all.filter((meeting) => meeting.deletedAt === null),
        byId: new Map(s ? s.meetings : []),
      };
    }
    if (!this.notesCache || this.notesCache.version !== this.notesVersion) {
      this.notesCache = { version: this.notesVersion, notes: s ? sortNotes(s.notes.values()) : [] };
    }
    const status: DataStatus = !s ? 'signed_out' : s.loaded ? 'ready' : 'loading';
    return {
      uid: s?.uid ?? null,
      status,
      meetingsVersion: this.meetingsVersion,
      allMeetings: this.sortedCache.all,
      activeMeetings: this.sortedCache.active,
      meetingsById: this.sortedCache.byId,
      notesVersion: this.notesVersion,
      notes: this.notesCache.notes,
      preferences: s?.preferences ?? this.defaultPreferences(),
      preferencesLoaded: s?.preferencesKnown ?? false,
      preferencesSettled: s ? s.preferencesServerSeen || s.preferencesCached : false,
      entitlement: s?.entitlement ?? { ...DEFAULT_ENTITLEMENT },
      entitlementLoaded: s?.entitlementKnown ?? false,
      errors: s ? { ...s.errors } : { meetings: null, notes: null, preferences: null, entitlement: null },
      sync: this.getSyncState(),
    };
  }

  // ---- persistence ---------------------------------------------------------------------------

  /** Runs `build` inside the write lock, persists its change (cache + outbox) then applies it to memory. */
  private async localWrite<T>(s: Session, build: () => LocalWritePlan<T>): Promise<T> {
    const plan = await this.writeLock.run(async () => {
      this.assertCurrent(s);
      const built = build();
      if (built.change) await this.persistAndApply(s, built.change);
      return built;
    });
    plan.after?.();
    return plan.result;
  }

  /** Must run inside writeLock. */
  private async persistAndApply(s: Session, change: LocalChange): Promise<void> {
    let outbox = s.outbox;
    for (const write of change.writes ?? []) {
      outbox = enqueueWrite(outbox, write, { id: this.newEntryId(), now: this.nowIso() });
    }
    const pairs: [string, string][] = [];
    for (const meeting of change.meetings ?? []) {
      pairs.push([cacheKeys.meeting(s.uid, meeting.id), JSON.stringify(meetingToDoc(meeting))]);
    }
    for (const note of change.notes ?? []) {
      pairs.push([cacheKeys.note(s.uid, note.id), JSON.stringify(noteToDoc(note))]);
    }
    if (change.preferences) {
      pairs.push([
        cacheKeys.preferences(s.uid),
        JSON.stringify({ v: CACHE_VERSION, known: s.preferencesServerSeen, preferences: preferencesToDoc(change.preferences) }),
      ]);
    }
    if (change.profile) pairs.push([cacheKeys.profile(s.uid), JSON.stringify(change.profile)]);
    if (change.writes && change.writes.length > 0) pairs.push([cacheKeys.outbox(s.uid), JSON.stringify(outbox)]);
    const removeKeys = [
      ...(change.removeNotes ?? []).map((id) => cacheKeys.note(s.uid, id)),
      ...(change.removeMeetings ?? []).map((id) => cacheKeys.meeting(s.uid, id)),
    ];

    try {
      if (pairs.length > 0) await this.storage.multiSet(pairs);
      if (removeKeys.length > 0) await this.storage.multiRemove(removeKeys);
    } catch (error) {
      throw toAppError(error);
    }
    this.assertCurrent(s);

    s.outbox = outbox;
    if ((change.meetings && change.meetings.length > 0) || (change.removeMeetings && change.removeMeetings.length > 0)) {
      for (const meeting of change.meetings ?? []) s.meetings.set(meeting.id, meeting);
      for (const id of change.removeMeetings ?? []) s.meetings.delete(id);
      this.bumpMeetings();
    }
    if ((change.notes && change.notes.length > 0) || (change.removeNotes && change.removeNotes.length > 0)) {
      for (const note of change.notes ?? []) s.notes.set(note.id, note);
      for (const id of change.removeNotes ?? []) s.notes.delete(id);
      this.bumpNotes();
    }
    if (change.preferences) {
      s.preferences = change.preferences;
      s.preferencesCached = true;
    }
    if (change.profile) s.profile = change.profile;
  }

  /** Mirrors the CURRENT memory state of the given entries into the cache (after remote changes). */
  private persist(s: Session, request: PersistRequest): Promise<void> {
    return this.writeLock
      .run(async () => {
        if (!this.isCurrent(s)) return;
        const pairs: [string, string][] = [];
        const removeKeys: string[] = [];
        for (const id of request.meetingIds ?? []) {
          const meeting = s.meetings.get(id);
          if (meeting) pairs.push([cacheKeys.meeting(s.uid, id), JSON.stringify(meetingToDoc(meeting))]);
          else removeKeys.push(cacheKeys.meeting(s.uid, id));
        }
        for (const id of request.noteIds ?? []) {
          const note = s.notes.get(id);
          if (note) pairs.push([cacheKeys.note(s.uid, id), JSON.stringify(noteToDoc(note))]);
          else removeKeys.push(cacheKeys.note(s.uid, id));
        }
        if (request.preferences) {
          pairs.push([
            cacheKeys.preferences(s.uid),
            JSON.stringify({ v: CACHE_VERSION, known: s.preferencesServerSeen, preferences: s.preferences }),
          ]);
          s.preferencesCached = true;
        }
        if (request.entitlement) pairs.push([cacheKeys.entitlement(s.uid), JSON.stringify(s.entitlement)]);
        if (request.profile && s.profile) pairs.push([cacheKeys.profile(s.uid), JSON.stringify(s.profile)]);
        if (request.outbox) pairs.push([cacheKeys.outbox(s.uid), JSON.stringify(s.outbox)]);
        if (pairs.length > 0) await this.storage.multiSet(pairs);
        if (removeKeys.length > 0) await this.storage.multiRemove(removeKeys);
      })
      .catch((error: unknown) => {
        log.warn(`cache write failed (${toAppError(error).code})`);
      });
  }

  private mutateOutbox(s: Session, update: (state: OutboxState) => OutboxState): Promise<void> {
    return this.writeLock.run(async () => {
      if (!this.isCurrent(s)) return;
      const next = update(s.outbox);
      try {
        await this.storage.setItem(cacheKeys.outbox(s.uid), JSON.stringify(next));
      } catch (error) {
        throw toAppError(error);
      }
      if (this.isCurrent(s)) s.outbox = next;
    });
  }

  // ---- session lifecycle -----------------------------------------------------------------------

  async startSession(uid: string, options: { mode?: 'foreground' | 'headless'; user?: AuthUser } = {}): Promise<void> {
    assertValidUid(uid);
    if (!this.remote.isAvailable) throw new AppError('not_configured', 'Firebase is not configured');
    const mode = options.mode ?? 'foreground';
    if (options.user && options.user.uid !== uid) throw new AppError('invalid_input', 'Session user does not match uid');

    const existing = this.session;
    if (existing && existing.uid === uid) {
      if (options.user) existing.user = options.user;
      await existing.ready;
      if (mode === 'foreground' && existing.mode === 'headless' && this.isCurrent(existing)) {
        existing.mode = 'foreground';
        this.startForeground(existing);
      }
      return;
    }
    if (existing) await this.endSession({ wipeLocal: false });
    // A sign-out wipe of the same uid must finish before this session writes its cache/outbox.
    if (this.ending) await this.ending;
    if (this.session) {
      // Another start won the race while we were waiting.
      if (this.session.uid !== uid) throw new AppError('conflict', 'Another data session started');
      await this.session.ready;
      return;
    }

    let resolveReady: () => void = () => undefined;
    let rejectReady: (error: unknown) => void = () => undefined;
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    ready.catch(() => undefined);

    this.epoch += 1;
    const defaults = this.defaultPreferences();
    const s: Session = {
      uid,
      epoch: this.epoch,
      mode,
      user: options.user ?? null,
      ready,
      loaded: false,
      meetings: new Map(),
      notes: new Map(),
      preferences: defaults,
      preferencesKnown: false,
      preferencesServerSeen: false,
      preferencesCached: false,
      entitlement: { ...DEFAULT_ENTITLEMENT },
      entitlementKnown: false,
      profile: null,
      outbox: { ...EMPTY_OUTBOX, entries: [] },
      meetingsBaseline: false,
      notesBaseline: false,
      listeners: new Map(),
      subscriptions: [],
      timers: new Set(),
      flushTimer: null,
      retryTimer: null,
      flushing: null,
      bootstrappingPreferences: false,
      remoteSuspended: false,
      legacyProfilePreferences: null,
      migration: null,
      errors: { meetings: null, notes: null, preferences: null, entitlement: null },
      lastSyncedAt: null,
      forceServer: new Set(),
      preferencesWaiters: new Set(),
    };
    this.session = s;
    this.bumpMeetings();
    this.bumpNotes();
    this.notify();

    try {
      const cache = await loadUserCache(this.storage, uid, defaults);
      this.assertCurrent(s);
      s.meetings = cache.meetings;
      s.notes = cache.notes;
      s.outbox = cache.outbox;
      if (cache.preferences) {
        s.preferences = cache.preferences.preferences;
        s.preferencesCached = true;
        s.preferencesKnown = true;
        s.preferencesServerSeen = cache.preferences.known;
      }
      if (cache.entitlement) {
        s.entitlement = cache.entitlement;
        s.entitlementKnown = true;
      }
      s.profile = cache.profile;
      s.loaded = true;
      resolveReady();
    } catch (error) {
      const appError = toAppError(error);
      rejectReady(appError);
      if (this.session === s) {
        this.session = null;
        this.epoch += 1;
        this.bumpMeetings();
        this.bumpNotes();
        this.notify();
      }
      throw appError;
    }

    this.bumpMeetings();
    this.bumpNotes();
    this.notify();
    this.events.emit('meetings:changed', { uid, reason: 'cache_loaded' });
    this.events.emit('preferences:changed', { uid, preferences: s.preferences, changedKeys: [...PREFERENCE_KEYS], origin: 'cache' });

    if (mode === 'foreground') {
      this.startForeground(s);
    } else {
      await this.runHeadlessRefresh(s);
    }
  }

  async endSession(options: { wipeLocal: boolean }): Promise<void> {
    const s = this.session;
    if (!s) {
      if (this.ending) await this.ending;
      return;
    }
    this.session = null;
    this.epoch += 1;
    this.detach(s);
    const waiters = [...s.preferencesWaiters];
    s.preferencesWaiters.clear();
    for (const waiter of waiters) waiter();

    // Inside the write lock: runs after every pending cache write of the ended session and before
    // any write of the next one.
    const outcome: { error: AppError | null } = { error: null };
    const ending = this.writeLock.run(async () => {
      if (!options.wipeLocal) return;
      try {
        await wipeUserCache(this.storage, s.uid);
      } catch (error) {
        outcome.error = toAppError(error);
        log.error(`could not wipe the local data of the ended session (${outcome.error.code})`, outcome.error);
      }
    });
    this.ending = ending;
    await ending;
    if (this.ending === ending) this.ending = null;

    this.bumpMeetings();
    this.bumpNotes();
    this.notify();
    this.events.emit('meetings:changed', { uid: s.uid, reason: 'session_reset' });
    if (outcome.error) throw outcome.error;
  }

  private detach(s: Session): void {
    for (const unsubscribe of s.listeners.values()) this.safeUnsubscribe(unsubscribe);
    s.listeners.clear();
    for (const unsubscribe of s.subscriptions) this.safeUnsubscribe(unsubscribe);
    s.subscriptions = [];
    for (const timer of s.timers) clearTimeout(timer);
    s.timers.clear();
    if (s.flushTimer) clearTimeout(s.flushTimer);
    if (s.retryTimer) clearTimeout(s.retryTimer);
    s.flushTimer = null;
    s.retryTimer = null;
  }

  /**
   * Pauses the remote side of the active session: detaches the Firestore listeners and stops
   * every outbox send (a send already in flight finishes; nothing new starts). Local reads keep
   * working. Used while the server deletes the account: a live listener would otherwise see the
   * deleted preferences document as "not created yet" and write it again, and a queued write would
   * re-create its document. No-op without a session.
   */
  suspendRemote(): void {
    const s = this.session;
    if (!s || s.remoteSuspended) return;
    s.remoteSuspended = true;
    for (const unsubscribe of s.listeners.values()) this.safeUnsubscribe(unsubscribe);
    s.listeners.clear();
    if (s.flushTimer) clearTimeout(s.flushTimer);
    if (s.retryTimer) clearTimeout(s.retryTimer);
    s.flushTimer = null;
    s.retryTimer = null;
    this.notify();
  }

  /** Undoes suspendRemote() (the account deletion failed): listeners and outbox sends resume. */
  resumeRemote(): void {
    const s = this.session;
    if (!s || !s.remoteSuspended) return;
    s.remoteSuspended = false;
    this.attachListeners(s);
    this.scheduleFlush(s, 0);
    this.notify();
  }

  private safeUnsubscribe(unsubscribe: Unsubscribe): void {
    try {
      unsubscribe();
    } catch (error) {
      log.warn('listener cleanup failed', toAppError(error).code);
    }
  }

  private startForeground(s: Session): void {
    this.attachListeners(s);
    if (this.network) {
      s.subscriptions.push(this.network.subscribe((online) => this.handleConnectivity(s, online)));
      this.network
        .fetch()
        .then((online) => this.handleConnectivity(s, online))
        .catch((error: unknown) => log.warn('connectivity check failed', toAppError(error).code));
    }
    if (this.foreground) {
      s.subscriptions.push(this.foreground.subscribe(() => this.handleForeground(s)));
    }
    s.subscriptions.push(
      this.events.on('language:changed', (event) => {
        if (event.source !== 'user' || !this.isCurrent(s)) return;
        void this.updatePreferences({ language: event.language }).catch((error: unknown) => {
          log.warn(`could not store the language preference (${toAppError(error).code})`);
        });
      }),
    );
    if (!s.preferencesKnown) {
      this.addTimer(s, this.timeouts.preferencesFallbackMs, () => {
        if (s.preferencesKnown) return;
        log.info('preferences not reachable yet; using defaults until the server answers');
        this.markPreferencesKnown(s);
        this.notify();
      });
    }
    this.scheduleFlush(s, 0);
    void this.runForegroundMaintenance(s);
  }

  private async runForegroundMaintenance(s: Session): Promise<void> {
    try {
      if (s.user) await this.ensureProfile(s.user);
    } catch (error) {
      log.warn(`ensureProfile failed (${toAppError(error).code})`);
    }
    if (!this.isCurrent(s)) return;
    try {
      const report = await this.migrateLegacyLocalData(s.uid);
      if (!report.alreadyDone && (report.migratedMeetings > 0 || report.migratedNotes > 0 || report.errors.length > 0)) {
        log.info(`legacy migration: ${report.migratedMeetings} meetings, ${report.migratedNotes} notes, errors=${report.errors.join(',')}`);
      }
    } catch (error) {
      const appError = toAppError(error);
      if (appError.code !== 'unauthenticated') log.error(`legacy migration failed (${appError.code})`, appError);
    }
  }

  /**
   * Deleted meetings: tombstones written before content scrubbing are scrubbed (so a deleted
   * meeting's password / notes / third-party emails leave the server and every device), and
   * tombstones older than TOMBSTONE_RETENTION_DAYS are hard-deleted. Meetings with a queued
   * write are left alone. Returns how many were scrubbed / purged.
   */
  async maintainTombstones(s?: Session): Promise<{ scrubbed: number; purged: number }> {
    const session = s ?? (await this.readySession());
    const cutoffIso = addMinutesIso(this.now(), -TOMBSTONE_RETENTION_DAYS * 24 * 60);
    let scrubbed = 0;
    let purged = 0;
    await this.localWrite(session, () => {
      const updates: Meeting[] = [];
      const removals: string[] = [];
      const writes: OutboxWrite[] = [];
      for (const meeting of session.meetings.values()) {
        if (meeting.deletedAt === null || hasPending(session.outbox, 'meeting', meeting.id)) continue;
        if (meeting.deletedAt < cutoffIso) {
          removals.push(meeting.id);
          writes.push({ kind: 'meeting', docId: meeting.id, mode: 'delete', data: null, updatedAt: meeting.updatedAt, origin: 'system' });
        } else if (tombstoneHasContent(meeting)) {
          const updatedAt = nextTimestamp(this.now(), meeting.updatedAt);
          const clean: Meeting = { ...scrubMeetingContent(meeting), updatedAt };
          updates.push(clean);
          writes.push({
            kind: 'meeting',
            docId: meeting.id,
            mode: 'set',
            data: meetingToDoc(clean) as unknown as RemoteData,
            updatedAt,
            origin: 'system',
          });
        }
      }
      scrubbed = updates.length;
      purged = removals.length;
      if (writes.length === 0) return { result: undefined, change: null };
      return {
        result: undefined,
        change: { meetings: updates, removeMeetings: removals, writes },
        after: () => {
          this.notify();
          this.scheduleFlush(session);
        },
      };
    });
    if (scrubbed + purged > 0) log.info(`tombstones: ${scrubbed} scrubbed, ${purged} purged`);
    return { scrubbed, purged };
  }

  private handleConnectivity(s: Session, online: boolean | null): void {
    if (!this.isCurrent(s)) return;
    const wasOffline = this.online === false;
    this.online = online;
    this.notify();
    if (online !== false && wasOffline) {
      this.attachListeners(s);
      this.scheduleFlush(s, 0);
    }
  }

  private handleForeground(s: Session): void {
    if (!this.isCurrent(s)) return;
    this.attachListeners(s);
    this.scheduleFlush(s, 0);
  }

  // ---- Firestore listeners ---------------------------------------------------------------------

  /** Attaches every listener that is not running (idempotent; re-attaches after an error). */
  private attachListeners(s: Session): void {
    if (s.mode !== 'foreground' || s.remoteSuspended || !this.isCurrent(s)) return;
    const uid = s.uid;
    const attach = (key: ListenerKey, start: () => Unsubscribe): void => {
      if (s.listeners.has(key)) return;
      try {
        s.listeners.set(key, start());
      } catch (error) {
        this.onListenerError(s, key, toAppError(error));
      }
    };
    attach('meetings', () =>
      this.remote.listenCollection(
        firestorePaths.meetings(uid),
        (snapshot) => this.onMeetingsSnapshot(s, snapshot),
        (error) => this.onListenerError(s, 'meetings', error),
      ),
    );
    attach('notes', () =>
      this.remote.listenCollection(
        firestorePaths.notes(uid),
        (snapshot) => this.onNotesSnapshot(s, snapshot),
        (error) => this.onListenerError(s, 'notes', error),
      ),
    );
    attach('preferences', () =>
      this.remote.listenDoc(
        firestorePaths.preferences(uid),
        (snapshot) => this.onPreferencesSnapshot(s, snapshot),
        (error) => this.onListenerError(s, 'preferences', error),
      ),
    );
    attach('entitlement', () =>
      this.remote.listenDoc(
        firestorePaths.entitlement(uid),
        (snapshot) => this.onEntitlementSnapshot(s, snapshot),
        (error) => this.onListenerError(s, 'entitlement', error),
      ),
    );
  }

  private onListenerError(s: Session, key: ListenerKey, error: AppError): void {
    if (!this.isCurrent(s)) return;
    const unsubscribe = s.listeners.get(key);
    s.listeners.delete(key);
    if (unsubscribe) this.safeUnsubscribe(unsubscribe);
    s.errors[key] = error;
    log.warn(`${key} listener failed (${error.code}); showing cached data`);
    if (key === 'preferences' && !s.preferencesKnown) this.markPreferencesKnown(s);
    this.notify();
  }

  private mergeRemoteMeeting(
    s: Session,
    id: string,
    data: RemoteData | null,
    ctx: ReadContext,
    acc: { changedIds: string[]; migrations: Meeting[] },
  ): void {
    const read = readRemoteMeeting(id, data, ctx);
    if (read.kind === 'invalid') {
      log.warn(`skipping invalid meeting document ${id}`);
      return;
    }
    if (read.kind === 'legacy' && !hasPending(s.outbox, 'meeting', id)) acc.migrations.push(read.meeting);
    const incoming = read.meeting;
    const local = s.meetings.get(id);
    // A purged tombstone whose hard delete is still queued is never resurrected by a snapshot.
    if (!local && pendingEntries(s.outbox, 'meeting', id).some((entry) => entry.mode === 'delete')) return;
    const forced = s.forceServer.delete(`meeting:${id}`);
    if (!forced && !shouldAcceptRemote(local, incoming)) return;
    if (local && deepEqual(local, incoming)) return;
    s.meetings.set(id, incoming);
    acc.changedIds.push(id);
  }

  private onMeetingsSnapshot(s: Session, snapshot: RemoteCollectionSnapshot): void {
    if (!this.isCurrent(s) || s.remoteSuspended) return;
    const ctx = this.readContext(s);
    const acc = { changedIds: [] as string[], migrations: [] as Meeting[] };
    for (const change of snapshot.changes) {
      if (change.type === 'removed') {
        if (snapshot.fromCache || hasPending(s.outbox, 'meeting', change.id)) continue;
        if (s.meetings.delete(change.id)) acc.changedIds.push(change.id);
        continue;
      }
      this.mergeRemoteMeeting(s, change.id, change.data, ctx, acc);
    }
    let firstBaseline = false;
    if (!snapshot.fromCache) {
      if (!s.meetingsBaseline) {
        s.meetingsBaseline = true;
        firstBaseline = true;
        const serverIds = new Set(snapshot.ids);
        for (const id of [...s.meetings.keys()]) {
          if (!serverIds.has(id) && !hasPending(s.outbox, 'meeting', id)) {
            s.meetings.delete(id);
            acc.changedIds.push(id);
          }
        }
      }
      s.errors.meetings = null;
      s.lastSyncedAt = this.nowIso();
    }
    if (acc.changedIds.length > 0) {
      this.bumpMeetings();
      void this.persist(s, { meetingIds: acc.changedIds });
      this.events.emit('meetings:changed', { uid: s.uid, changedIds: acc.changedIds, reason: 'remote' });
    }
    this.notify();
    if (acc.migrations.length > 0) void this.enqueueMeetingMigrations(s, acc.migrations);
    if (firstBaseline) {
      // Once per session, when the server's meetings are known: scrub / purge tombstones.
      void this.maintainTombstones(s).catch((error: unknown) => {
        log.warn(`tombstone maintenance failed (${toAppError(error).code})`);
      });
    }
  }

  private async enqueueMeetingMigrations(s: Session, meetings: readonly Meeting[]): Promise<void> {
    try {
      await this.localWrite(s, () => {
        const pending = meetings.filter((meeting) => !hasPending(s.outbox, 'meeting', meeting.id));
        if (pending.length === 0) return { result: undefined, change: null };
        return {
          result: undefined,
          change: {
            writes: pending.map((meeting) => ({
              kind: 'meeting' as const,
              docId: meeting.id,
              mode: 'migrate' as const,
              data: meetingToDoc(meeting) as unknown as RemoteData,
              updatedAt: meeting.updatedAt,
              origin: 'migration' as const,
            })),
          },
          after: () => this.scheduleFlush(s),
        };
      });
    } catch (error) {
      log.warn(`could not queue the rewrite of legacy meetings (${toAppError(error).code})`);
    }
  }

  private onNotesSnapshot(s: Session, snapshot: RemoteCollectionSnapshot): void {
    if (!this.isCurrent(s) || s.remoteSuspended) return;
    const changedIds: string[] = [];
    for (const change of snapshot.changes) {
      if (change.type === 'removed') {
        if (snapshot.fromCache || hasPending(s.outbox, 'note', change.id)) continue;
        if (s.notes.delete(change.id)) changedIds.push(change.id);
        continue;
      }
      const incoming = readRemoteNote(change.id, change.data);
      if (!incoming) {
        log.warn(`skipping invalid note document ${change.id}`);
        continue;
      }
      const local = s.notes.get(change.id);
      // Notes are hard-deleted: a snapshot that still carries a note whose delete is waiting in
      // the outbox must not resurrect it (there is no tombstone for last-writer-wins to compare).
      if (!local && pendingEntries(s.outbox, 'note', change.id).some((entry) => entry.mode === 'delete')) continue;
      const forced = s.forceServer.delete(`note:${change.id}`);
      if (!forced && !shouldAcceptRemote(local, incoming)) continue;
      if (local && deepEqual(local, incoming)) continue;
      s.notes.set(change.id, incoming);
      changedIds.push(change.id);
    }
    if (!snapshot.fromCache) {
      if (!s.notesBaseline) {
        s.notesBaseline = true;
        const serverIds = new Set(snapshot.ids);
        for (const id of [...s.notes.keys()]) {
          if (!serverIds.has(id) && !hasPending(s.outbox, 'note', id)) {
            s.notes.delete(id);
            changedIds.push(id);
          }
        }
      }
      s.errors.notes = null;
      s.lastSyncedAt = this.nowIso();
    }
    if (changedIds.length > 0) {
      this.bumpNotes();
      void this.persist(s, { noteIds: changedIds });
    }
    this.notify();
  }

  private markPreferencesKnown(s: Session): void {
    s.preferencesKnown = true;
    const waiters = [...s.preferencesWaiters];
    s.preferencesWaiters.clear();
    for (const waiter of waiters) waiter();
  }

  /** Server preferences + the patches still waiting in the outbox (so local changes are not lost). */
  private withPendingPreferencePatches(s: Session, base: Preferences): Preferences {
    let next = base;
    for (const entry of pendingEntries(s.outbox, 'preferences', PREFERENCES_DOC_ID)) {
      if (entry.mode !== 'merge' || !entry.data) continue;
      next = mergePreferences({ ...next, ...entry.data }, next);
    }
    return next;
  }

  private applyRemotePreferences(s: Session, next: Preferences): void {
    const changedKeys = changedPreferenceKeys(s.preferences, next);
    const needsPersist = changedKeys.length > 0 || !s.preferencesServerSeen || next.updatedAt !== s.preferences.updatedAt;
    s.preferences = next;
    s.preferencesServerSeen = true;
    this.markPreferencesKnown(s);
    s.errors.preferences = null;
    if (needsPersist) void this.persist(s, { preferences: true });
    if (changedKeys.length > 0) {
      this.events.emit('preferences:changed', { uid: s.uid, preferences: next, changedKeys, origin: 'remote' });
    }
    this.notify();
  }

  private onPreferencesSnapshot(s: Session, snapshot: RemoteDocSnapshot): void {
    if (!this.isCurrent(s) || s.remoteSuspended || snapshot.fromCache) return;
    s.lastSyncedAt = this.nowIso();
    if (!snapshot.exists) {
      if (s.preferencesServerSeen && !this.hasPendingPreferencesCreate(s)) {
        // The document existed and is gone: it was deleted on the server (account deletion from
        // this or another device), not "not created yet". Re-creating it would resurrect the
        // settings of a deleted account, so keep the local copy and write nothing.
        log.warn('the preferences document was removed on the server; not re-creating it');
        return;
      }
      void this.bootstrapPreferences(s);
      return;
    }
    const merged = mergePreferences(snapshot.data, this.defaultPreferences());
    this.applyRemotePreferences(s, this.withPendingPreferencePatches(s, merged));
  }

  private hasPendingPreferencesCreate(s: Session): boolean {
    return pendingEntries(s.outbox, 'preferences', PREFERENCES_DOC_ID).some((entry) => entry.mode === 'create');
  }

  /** No preferences document yet: create it (importing the pre-rebuild users/{uid}.preferences once). */
  private async bootstrapPreferences(s: Session): Promise<void> {
    if (s.bootstrappingPreferences || s.remoteSuspended) return;
    if (this.hasPendingPreferencesCreate(s)) {
      s.preferencesServerSeen = true;
      this.markPreferencesKnown(s);
      this.notify();
      return;
    }
    s.bootstrappingPreferences = true;
    try {
      let legacyPatch: PreferencesPatch | null = s.legacyProfilePreferences;
      if (!legacyPatch && !s.preferencesCached) {
        try {
          const profile = await withTimeout(this.remote.getDoc(firestorePaths.user(s.uid)), this.timeouts.fetchMs, 'profile read');
          legacyPatch = legacyPreferencesFromProfile(profile.data);
        } catch (error) {
          log.warn(`could not read legacy preferences (${toAppError(error).code})`);
        }
      }
      await this.localWrite(s, () => {
        let base = s.preferences;
        if (legacyPatch) {
          try {
            base = applyPreferencesPatch(base, legacyPatch, nextTimestamp(this.now(), base.updatedAt)).preferences;
          } catch (error) {
            log.warn(`ignoring invalid legacy preferences (${toAppError(error).code})`);
          }
        }
        const changedKeys = changedPreferenceKeys(s.preferences, base);
        s.preferencesServerSeen = true;
        return {
          result: undefined,
          change: {
            preferences: base,
            writes: [
              {
                kind: 'preferences',
                docId: PREFERENCES_DOC_ID,
                mode: 'create',
                data: preferencesToDoc(base) as unknown as RemoteData,
                updatedAt: this.nowIso(),
                origin: 'system',
              },
            ],
          },
          after: () => {
            this.markPreferencesKnown(s);
            if (changedKeys.length > 0) {
              this.events.emit('preferences:changed', { uid: s.uid, preferences: base, changedKeys, origin: 'remote' });
            }
            this.notify();
            this.scheduleFlush(s);
          },
        };
      });
    } catch (error) {
      log.warn(`could not create the preferences document (${toAppError(error).code})`);
    } finally {
      s.bootstrappingPreferences = false;
    }
  }

  private onEntitlementSnapshot(s: Session, snapshot: RemoteDocSnapshot): void {
    if (!this.isCurrent(s) || s.remoteSuspended || snapshot.fromCache) return;
    this.applyEntitlement(s, snapshot.exists ? snapshot.data : null);
  }

  private applyEntitlement(s: Session, raw: RemoteData | null): Entitlement {
    let entitlement = parseEntitlementDoc(raw);
    if (!entitlement) {
      log.error('invalid entitlement document; treating the account as free');
      entitlement = { ...DEFAULT_ENTITLEMENT };
    }
    s.errors.entitlement = null;
    const changed = !s.entitlementKnown || !deepEqual(s.entitlement, entitlement);
    s.entitlement = entitlement;
    s.entitlementKnown = true;
    if (changed) {
      void this.persist(s, { entitlement: true });
      this.notify();
    }
    return entitlement;
  }

  // ---- headless ------------------------------------------------------------------------------

  private async runHeadlessRefresh(s: Session): Promise<void> {
    try {
      await withTimeout(
        (async () => {
          const online = this.network ? await this.network.fetch().catch(() => null) : null;
          this.online = online;
          if (online === false) return;
          const fromIso = addMinutesIso(this.now(), -24 * 60);
          const docs = await this.remote.queryStartingFrom(firestorePaths.meetings(s.uid), fromIso);
          if (!this.isCurrent(s)) return;
          this.applyFetchedMeetings(s, docs, { removeMissing: false });
          const prefs = await this.remote.getDoc(firestorePaths.preferences(s.uid));
          if (!this.isCurrent(s)) return;
          if (prefs.exists) {
            this.applyRemotePreferences(s, this.withPendingPreferencePatches(s, mergePreferences(prefs.data, this.defaultPreferences())));
          }
          await this.flushSession(s);
        })(),
        this.timeouts.headlessMs,
        'headless refresh',
      );
    } catch (error) {
      log.warn(`headless refresh failed (${toAppError(error).code}); using cached data`);
    }
  }

  private applyFetchedMeetings(s: Session, docs: readonly { id: string; data: RemoteData }[], options: { removeMissing: boolean }): void {
    const ctx = this.readContext(s);
    const acc = { changedIds: [] as string[], migrations: [] as Meeting[] };
    for (const item of docs) this.mergeRemoteMeeting(s, item.id, item.data, ctx, acc);
    if (options.removeMissing) {
      const serverIds = new Set(docs.map((item) => item.id));
      for (const id of [...s.meetings.keys()]) {
        if (!serverIds.has(id) && !hasPending(s.outbox, 'meeting', id)) {
          s.meetings.delete(id);
          acc.changedIds.push(id);
        }
      }
    }
    s.lastSyncedAt = this.nowIso();
    if (acc.changedIds.length > 0) {
      this.bumpMeetings();
      void this.persist(s, { meetingIds: acc.changedIds });
      this.events.emit('meetings:changed', { uid: s.uid, changedIds: acc.changedIds, reason: 'remote' });
    }
    this.notify();
    if (acc.migrations.length > 0) void this.enqueueMeetingMigrations(s, acc.migrations);
  }

  /** Pull-to-refresh: flush, then re-read the whole meetings collection. Throws on failure. */
  async refreshMeetings(): Promise<void> {
    const s = await this.readySession();
    await this.flushSession(s);
    const docs = await withTimeout(this.remote.getCollection(firestorePaths.meetings(s.uid)), this.timeouts.fetchMs, 'meetings refresh').catch(
      (error: unknown) => {
        throw toAppError(error);
      },
    );
    this.assertCurrent(s);
    this.applyFetchedMeetings(s, docs, { removeMissing: true });
  }

  // ---- outbox flush ----------------------------------------------------------------------------

  private scheduleFlush(s: Session, delayMs: number = this.timeouts.flushDelayMs): void {
    if (!this.isCurrent(s) || s.remoteSuspended || s.flushTimer) return;
    s.flushTimer = setTimeout(() => {
      s.flushTimer = null;
      if (!this.isCurrent(s)) return;
      this.flushSession(s).catch((error: unknown) => log.warn(`background flush failed (${toAppError(error).code})`));
    }, delayMs);
  }

  private scheduleRetry(s: Session, attempts: number): void {
    if (!this.isCurrent(s) || s.mode !== 'foreground' || s.remoteSuspended) return;
    if (s.retryTimer) clearTimeout(s.retryTimer);
    const delay = Math.min(MAX_RETRY_DELAY_MS, this.timeouts.retryBaseMs * 2 ** Math.max(0, attempts - 1));
    s.retryTimer = setTimeout(() => {
      s.retryTimer = null;
      if (this.isCurrent(s)) this.scheduleFlush(s, 0);
    }, delay);
  }

  async flushOutbox(): Promise<OutboxFlushResult> {
    const s = await this.readySession();
    return this.flushSession(s);
  }

  private flushSession(s: Session): Promise<OutboxFlushResult> {
    if (s.flushing) return s.flushing;
    const run = this.runFlush(s).finally(() => {
      s.flushing = null;
    });
    s.flushing = run;
    return run;
  }

  private docPath(uid: string, entry: OutboxEntry): string {
    switch (entry.kind) {
      case 'meeting':
        return firestorePaths.meeting(uid, entry.docId);
      case 'note':
        return firestorePaths.note(uid, entry.docId);
      case 'preferences':
        return firestorePaths.preferences(uid);
      case 'profile':
        return firestorePaths.user(uid);
      default:
        throw new AppError('invalid_input', 'Unknown outbox kind');
    }
  }

  private async runFlush(s: Session): Promise<OutboxFlushResult> {
    let flushed = 0;
    let rejected = 0;
    const synced: string[] = [];
    const remoteMeetingIds: string[] = [];
    const pendingCount = (): number => s.outbox.entries.length;

    if (!this.remote.isAvailable || this.online === false) {
      return { flushed, pending: pendingCount(), rejected };
    }
    for (;;) {
      if (!this.isCurrent(s) || s.remoteSuspended) break;
      const entry = orderedEntries(s.outbox)[0];
      if (!entry) break;
      let result: CommitResult;
      try {
        const defaults = this.defaultPreferences();
        result = await withTimeout(
          this.remote.commit(this.docPath(s.uid, entry), (current) => decideCommit(entry, current, { defaults })),
          this.timeouts.commitMs,
          'outbox send',
        );
      } catch (error) {
        const appError = toAppError(error);
        if (!this.isCurrent(s)) break;
        // Rules-version skew (phase-1 fields against older deployed rules) waits in the outbox
        // instead of being dropped; every other permanent rejection is final.
        const permanent = isPermanentFailure(appError) && !(appError.code === 'permission_denied' && isRulesSkewEntry(entry));
        if (permanent || (!isNetworkFailure(appError) && entry.attempts + 1 >= MAX_SEND_ATTEMPTS)) {
          log.error(`outbox ${entry.kind} write rejected (${appError.code}); restoring the server version`, appError);
          await this.mutateOutbox(s, (state) => dropEntry(state, entry.id));
          rejected += 1;
          await this.restoreFromServer(s, entry, remoteMeetingIds);
          continue;
        }
        log.warn(`outbox send failed (${appError.code}); will retry`);
        await this.mutateOutbox(s, (state) => recordFailure(state, entry.id, appError.code)).catch(() => undefined);
        this.scheduleRetry(s, entry.attempts + 1);
        break;
      }
      if (!this.isCurrent(s)) break;
      if (await this.afterCommit(s, entry, result, { synced, remoteMeetingIds })) flushed += 1;
    }

    if (this.isCurrent(s)) {
      if (flushed > 0) s.lastSyncedAt = this.nowIso();
      if (synced.length > 0) this.events.emit('meetings:changed', { uid: s.uid, changedIds: synced, reason: 'synced' });
      if (remoteMeetingIds.length > 0) {
        this.events.emit('meetings:changed', { uid: s.uid, changedIds: remoteMeetingIds, reason: 'remote' });
      }
      this.notify();
    }
    return { flushed, pending: this.isCurrent(s) ? pendingCount() : 0, rejected };
  }

  /** Applies the result of one send. Returns false when the entry stays queued (legacy replacement). */
  private async afterCommit(
    s: Session,
    entry: OutboxEntry,
    { current, decision }: CommitResult,
    acc: { synced: string[]; remoteMeetingIds: string[] },
  ): Promise<boolean> {
    if (decision.type === 'delete' && decision.followUp === 'create') {
      await this.mutateOutbox(s, (state) => requeueEntry(state, entry.id, 'create'));
      return false;
    }
    const outcome = decision.type === 'skip' ? 'skipped' : 'written';
    await this.mutateOutbox(s, (state) => ackEntry(state, entry, outcome));
    if (!this.isCurrent(s)) return true;

    switch (entry.kind) {
      case 'meeting': {
        if (decision.type === 'write') {
          acc.synced.push(entry.docId);
          return true;
        }
        // Server copy wins (already existed / newer / migrated elsewhere): adopt it unless a newer local write is queued.
        if (decision.type === 'skip' && current && !hasPending(s.outbox, 'meeting', entry.docId)) {
          const read = readRemoteMeeting(entry.docId, current, this.readContext(s));
          if (read.kind !== 'invalid' && !deepEqual(s.meetings.get(entry.docId), read.meeting)) {
            s.meetings.set(entry.docId, read.meeting);
            this.bumpMeetings();
            acc.remoteMeetingIds.push(entry.docId);
            void this.persist(s, { meetingIds: [entry.docId] });
          }
        }
        return true;
      }
      case 'note': {
        if (decision.type === 'skip' && current && !hasPending(s.outbox, 'note', entry.docId)) {
          const note = readRemoteNote(entry.docId, current);
          if (note && !deepEqual(s.notes.get(entry.docId), note)) {
            s.notes.set(entry.docId, note);
            this.bumpNotes();
            void this.persist(s, { noteIds: [entry.docId] });
          }
        }
        return true;
      }
      case 'preferences': {
        const serverDoc = decision.type === 'write' ? decision.data : current;
        if (serverDoc) {
          const merged = mergePreferences(serverDoc, this.defaultPreferences());
          this.applyRemotePreferences(s, this.withPendingPreferencePatches(s, merged));
        }
        return true;
      }
      case 'profile': {
        const legacyPreferences = legacyPreferencesFromProfile(current);
        if (legacyPreferences && !s.preferencesServerSeen) s.legacyProfilePreferences = legacyPreferences;
        const combined = decision.type === 'write' ? decision.data : { ...(current ?? {}), ...(decision.type === 'merge' ? decision.data : {}) };
        const profile = readRemoteProfile(s.uid, combined);
        if (profile) {
          s.profile = profile;
          void this.persist(s, { profile: true });
        }
        return true;
      }
      default:
        return true;
    }
  }

  /** After a permanently rejected write: re-read the server copy so the local state stops diverging. */
  private async restoreFromServer(s: Session, entry: OutboxEntry, remoteMeetingIds: string[]): Promise<void> {
    if (entry.kind !== 'meeting' && entry.kind !== 'note') return;
    const key = `${entry.kind}:${entry.docId}`;
    try {
      const snapshot = await withTimeout(this.remote.getDoc(this.docPath(s.uid, entry)), this.timeouts.fetchMs, 'server copy read');
      if (!this.isCurrent(s)) return;
      if (entry.kind === 'meeting') {
        const read = snapshot.exists ? readRemoteMeeting(entry.docId, snapshot.data, this.readContext(s)) : null;
        if (read && read.kind !== 'invalid') s.meetings.set(entry.docId, read.meeting);
        else s.meetings.delete(entry.docId);
        this.bumpMeetings();
        remoteMeetingIds.push(entry.docId);
        void this.persist(s, { meetingIds: [entry.docId] });
      } else {
        const note = snapshot.exists ? readRemoteNote(entry.docId, snapshot.data) : null;
        if (note) s.notes.set(entry.docId, note);
        else s.notes.delete(entry.docId);
        this.bumpNotes();
        void this.persist(s, { noteIds: [entry.docId] });
      }
    } catch (error) {
      log.warn(`could not re-read ${entry.kind} after a rejected write (${toAppError(error).code})`);
      s.forceServer.add(key);
    }
  }

  // ---- meetings ------------------------------------------------------------------------------

  async listMeetings(range?: MeetingRange): Promise<Meeting[]> {
    const s = await this.readySession();
    return filterMeetings(s.meetings.values(), range);
  }

  async getMeeting(id: string): Promise<Meeting | null> {
    const s = await this.readySession();
    const meeting = s.meetings.get(id);
    return meeting && meeting.deletedAt === null ? meeting : null;
  }

  async createMeeting(input: MeetingCreateInput, options: { origin?: WriteOrigin; id?: string } = {}): Promise<Meeting> {
    const s = await this.readySession();
    const origin = options.origin ?? 'user';
    if (options.id !== undefined && !isValidDocumentId(options.id)) {
      throw new AppError('invalid_input', 'Invalid meeting id');
    }
    let created = false;
    const meeting = await this.localWrite(s, () => {
      if (options.id !== undefined) {
        const existing = s.meetings.get(options.id);
        if (existing && existing.deletedAt === null) return { result: existing, change: null };
        if (existing) throw new AppError('conflict', 'A deleted meeting already uses this id');
      }
      const id = options.id ?? this.remote.newId(firestorePaths.meetings(s.uid));
      const built = buildMeeting(input, {
        id,
        userId: s.uid,
        now: this.now(),
        defaultTimezone: this.timeZone(),
        defaultLanguage: this.language(),
      });
      created = true;
      return {
        result: built,
        change: {
          meetings: [built],
          writes: [{ kind: 'meeting', docId: id, mode: 'create', data: meetingToDoc(built) as unknown as RemoteData, updatedAt: built.updatedAt, origin }],
        },
      };
    });
    if (created) this.afterMeetingWrite(s, [meeting.id], 'created', origin);
    return meeting;
  }

  async updateMeeting(id: string, patch: MeetingPatch, options: { origin?: WriteOrigin } = {}): Promise<Meeting> {
    const s = await this.readySession();
    const origin = options.origin ?? 'user';
    let changed = false;
    const meeting = await this.localWrite(s, () => {
      const current = s.meetings.get(id);
      if (!current || current.deletedAt !== null) throw new AppError('not_found', 'Meeting not found');
      const next = applyMeetingPatch(current, patch, nextTimestamp(this.now(), current.updatedAt));
      const { updatedAt: _a, ...nextRest } = next;
      const { updatedAt: _b, ...currentRest } = current;
      if (deepEqual(nextRest, currentRest)) return { result: current, change: null };
      changed = true;
      return {
        result: next,
        change: {
          meetings: [next],
          writes: [{ kind: 'meeting', docId: id, mode: 'set', data: meetingToDoc(next) as unknown as RemoteData, updatedAt: next.updatedAt, origin }],
        },
      };
    });
    if (changed) this.afterMeetingWrite(s, [id], 'updated', origin);
    return meeting;
  }

  async removeMeeting(id: string, options: { origin?: WriteOrigin } = {}): Promise<void> {
    const s = await this.readySession();
    const origin = options.origin ?? 'user';
    let removed = false;
    await this.localWrite(s, () => {
      const current = s.meetings.get(id);
      if (!current) throw new AppError('not_found', 'Meeting not found');
      if (current.deletedAt !== null) return { result: undefined, change: null };
      const tombstone = tombstoneMeeting(current, nextTimestamp(this.now(), current.updatedAt));
      removed = true;
      return {
        result: undefined,
        change: {
          meetings: [tombstone],
          writes: [
            { kind: 'meeting', docId: id, mode: 'set', data: meetingToDoc(tombstone) as unknown as RemoteData, updatedAt: tombstone.updatedAt, origin },
          ],
        },
      };
    });
    if (removed) this.afterMeetingWrite(s, [id], 'deleted', origin);
  }

  // ---- recurring meetings (MeetingRecurrenceOps; docs/ARCHITECTURE.md §16) -------------------

  /**
   * Shared write path of the occurrence operations: validates the meeting (present, active,
   * recurring, `localDateKey` addresses an occurrence of the series), computes the next override
   * with `compute` (undefined = nothing to change: resolve with the unchanged meeting) and writes
   * it through applyMeetingPatch, so updatedAt / schema validation / sparse serialization behave
   * exactly like every other meeting write.
   */
  private async writeOccurrenceOverride(
    id: string,
    localDateKey: string,
    origin: WriteOrigin,
    compute: (current: Meeting) => RecurrenceOverride | null | undefined,
    options: { allowStaleOverrideKey?: boolean } = {},
  ): Promise<Meeting> {
    const s = await this.readySession();
    let changed = false;
    const meeting = await this.localWrite(s, () => {
      const current = s.meetings.get(id);
      if (!current || current.deletedAt !== null) throw new AppError('not_found', 'Meeting not found');
      const rule = current.recurrence;
      if (rule === null) {
        throw new AppError('invalid_input', 'Not a recurring meeting', { details: { meetingId: id } });
      }
      const hasOverride = current.recurrenceOverrides?.[localDateKey] !== undefined;
      // restoreOccurrence may remove an override whose date the CURRENT rule no longer generates
      // (the rule was edited after the override was written); cancel/update never address such dates.
      const addressable =
        isSeriesOccurrenceDate({ ...current, recurrence: rule }, localDateKey) ||
        (options.allowStaleOverrideKey === true && hasOverride);
      if (!addressable) {
        throw new AppError('invalid_input', 'Not an occurrence of this series', { details: { meetingId: id, localDateKey } });
      }
      const nextOverride = compute(current);
      if (nextOverride === undefined) return { result: current, change: null };
      const overrides = withRecurrenceOverride(current.recurrenceOverrides, localDateKey, nextOverride);
      const next = applyMeetingPatch(current, { recurrenceOverrides: overrides }, nextTimestamp(this.now(), current.updatedAt));
      const { updatedAt: _a, ...nextRest } = next;
      const { updatedAt: _b, ...currentRest } = current;
      if (deepEqual(nextRest, currentRest)) return { result: current, change: null };
      changed = true;
      return {
        result: next,
        change: {
          meetings: [next],
          writes: [{ kind: 'meeting', docId: id, mode: 'set', data: meetingToDoc(next) as unknown as RemoteData, updatedAt: next.updatedAt, origin }],
        },
      };
    });
    if (changed) this.afterMeetingWrite(s, [id], 'updated', origin);
    return meeting;
  }

  /** MeetingRecurrenceOps.updateOccurrence: writes/merges a 'modified' override for one occurrence. */
  async updateOccurrence(
    id: string,
    localDateKey: string,
    patch: Pick<MeetingPatch, 'startAt' | 'durationMinutes' | 'title'>,
    options: { origin?: WriteOrigin } = {},
  ): Promise<Meeting> {
    // Normalize before the write closure so an invalid instant never half-applies (toDate throws).
    const startAt = patch.startAt !== undefined ? toDate(patch.startAt).toISOString() : undefined;
    return this.writeOccurrenceOverride(id, localDateKey, options.origin ?? 'user', (current) => {
      const existing = current.recurrenceOverrides?.[localDateKey];
      // Editing a cancelled occurrence restores it with the requested changes (an explicit edit
      // is the strongest signal the user wants it back); a 'modified' override is merged into.
      const base = existing?.status === 'modified' ? existing : null;
      const next: RecurrenceOverride = {
        status: 'modified',
        startAt: startAt ?? base?.startAt ?? null,
        durationMinutes: patch.durationMinutes ?? base?.durationMinutes ?? null,
        title: patch.title ?? base?.title ?? null,
      };
      if (base !== null && deepEqual(base, next)) return undefined;
      // An empty patch on an occurrence without changes would store a no-op override marking the
      // occurrence "overridden": nothing to do.
      if (existing === undefined && next.startAt === null && next.durationMinutes === null && next.title === null) {
        return undefined;
      }
      return next;
    });
  }

  /** MeetingRecurrenceOps.cancelOccurrence ("delete this occurrence"). Idempotent. */
  async cancelOccurrence(id: string, localDateKey: string, options: { origin?: WriteOrigin } = {}): Promise<Meeting> {
    return this.writeOccurrenceOverride(id, localDateKey, options.origin ?? 'user', (current) =>
      current.recurrenceOverrides?.[localDateKey]?.status === 'cancelled' ? undefined : { ...CANCELLED_OVERRIDE },
    );
  }

  /** MeetingRecurrenceOps.restoreOccurrence (back to the series pattern). Idempotent. */
  async restoreOccurrence(id: string, localDateKey: string, options: { origin?: WriteOrigin } = {}): Promise<Meeting> {
    return this.writeOccurrenceOverride(
      id,
      localDateKey,
      options.origin ?? 'user',
      (current) => (current.recurrenceOverrides?.[localDateKey] === undefined ? undefined : null),
      { allowStaleOverrideKey: true },
    );
  }

  /**
   * The tail of a series split ("this and following", §16): a NEW meeting anchored at the split
   * occurrence's ORIGINAL start with every content field copied from the master and the remaining
   * rule/overrides from core `splitRecurrenceAt`. External refs are NEVER copied (the tail must be
   * INSERTED into Google as a brand-new series event, `googleEventIdForMeeting(newId)`), and a
   * Google-imported master's tail becomes source 'manual': it is a locally created document now,
   * and the Google push refuses source 'google' without an event id.
   */
  private buildFollowingTail(s: Session, master: Meeting, split: SeriesSplit, tailId: string): Meeting {
    const input: MeetingCreateInput = {
      title: master.title,
      startAt: split.tailStartAt,
      source: master.source === 'google' ? 'manual' : master.source,
      description: master.description,
      durationMinutes: master.durationMinutes,
      timezone: master.timezone,
      allDay: master.allDay,
      location: master.location,
      conference: master.conference,
      participants: master.participants,
      confidence: master.confidence,
      language: master.language,
      preparationTips: master.preparationTips,
      customAlertTimes: master.customAlertTimes,
      alertIntensity: master.alertIntensity,
      notes: master.notes,
      status: master.status,
      recurrence: split.tailRule,
      recurrenceOverrides: split.tailOverrides,
      // seriesId defaults to the tail's own id: series identity is not shared across the split.
    };
    return buildMeeting(input, {
      id: tailId,
      userId: s.uid,
      now: this.now(),
      defaultTimezone: this.timeZone(),
      defaultLanguage: this.language(),
    });
  }

  /**
   * MeetingRecurrenceOps.editFollowing (§16 "this and following"): splits the series at
   * `fromDateKey` via core `splitRecurrenceAt` - the master is truncated (rule.until = 1 s before
   * the split occurrence's original start, count converted, overrides < split kept) and a NEW
   * tail meeting (overrides >= split moved over, remaining rule) is created with `patch` applied
   * to it. Both documents go through ONE localWrite (one cache + outbox persist), so an offline
   * kill never leaves a truncated master without its tail. A split at the FIRST occurrence
   * collapses to a plain series update (`created` null). `options.id` (idempotent creates) names
   * the tail's id.
   */
  async editFollowing(
    id: string,
    fromDateKey: string,
    patch: MeetingPatch,
    options: { origin?: WriteOrigin; id?: string } = {},
  ): Promise<{ master: Meeting; created: Meeting | null }> {
    const s = await this.readySession();
    const origin = options.origin ?? 'user';
    if (options.id !== undefined && !isValidDocumentId(options.id)) {
      throw new AppError('invalid_input', 'Invalid meeting id');
    }
    let wroteMaster = false;
    let wroteTail = false;
    const outcome = await this.localWrite<{ master: Meeting; created: Meeting | null }>(s, () => {
      const current = s.meetings.get(id);
      if (!current || current.deletedAt !== null) throw new AppError('not_found', 'Meeting not found');
      const split = splitRecurrenceAt(current, fromDateKey); // throws invalid_input as the contract requires
      if (split === 'series_edit') {
        // "This and following" from the first occurrence is the whole series: plain update.
        const next = applyMeetingPatch(current, patch, nextTimestamp(this.now(), current.updatedAt));
        const { updatedAt: _a, ...nextRest } = next;
        const { updatedAt: _b, ...currentRest } = current;
        if (deepEqual(nextRest, currentRest)) return { result: { master: current, created: null }, change: null };
        wroteMaster = true;
        return {
          result: { master: next, created: null },
          change: {
            meetings: [next],
            writes: [{ kind: 'meeting', docId: id, mode: 'set', data: meetingToDoc(next) as unknown as RemoteData, updatedAt: next.updatedAt, origin }],
          },
        };
      }
      if (options.id !== undefined && s.meetings.has(options.id)) {
        throw new AppError('conflict', 'A meeting already uses this id');
      }
      const nextMaster = applyMeetingPatch(
        current,
        { recurrence: split.masterRule, recurrenceOverrides: split.masterOverrides },
        nextTimestamp(this.now(), current.updatedAt),
      );
      const tailId = options.id ?? this.remote.newId(firestorePaths.meetings(s.uid));
      const built = this.buildFollowingTail(s, current, split, tailId);
      // The patch lands on the tail only (it edits the new series master); it is validated by
      // applyMeetingPatch BEFORE anything is persisted, so an invalid patch changes nothing.
      const tail = Object.keys(patch).length > 0 ? applyMeetingPatch(built, patch, built.updatedAt) : built;
      wroteMaster = true;
      wroteTail = true;
      return {
        result: { master: nextMaster, created: tail },
        change: {
          meetings: [nextMaster, tail],
          writes: [
            { kind: 'meeting', docId: id, mode: 'set', data: meetingToDoc(nextMaster) as unknown as RemoteData, updatedAt: nextMaster.updatedAt, origin },
            { kind: 'meeting', docId: tailId, mode: 'create', data: meetingToDoc(tail) as unknown as RemoteData, updatedAt: tail.updatedAt, origin },
          ],
        },
      };
    });
    if (wroteMaster) this.afterMeetingWrite(s, [id], 'updated', origin);
    if (wroteTail && outcome.created !== null) this.afterMeetingWrite(s, [outcome.created.id], 'created', origin);
    return outcome;
  }

  /**
   * MeetingRecurrenceOps.deleteFollowing (§16): truncates the series at `fromDateKey` exactly
   * like editFollowing but creates nothing - the split occurrence and everything after it
   * disappear, earlier occurrences and their overrides stay. A split at the FIRST occurrence
   * collapses to a plain series remove() and resolves null.
   */
  async deleteFollowing(id: string, fromDateKey: string, options: { origin?: WriteOrigin } = {}): Promise<Meeting | null> {
    const s = await this.readySession();
    const origin = options.origin ?? 'user';
    let removedSeries = false;
    let truncated = false;
    const outcome = await this.localWrite<Meeting | null>(s, () => {
      const current = s.meetings.get(id);
      if (!current || current.deletedAt !== null) throw new AppError('not_found', 'Meeting not found');
      const split = splitRecurrenceAt(current, fromDateKey); // throws invalid_input as the contract requires
      if (split === 'series_edit') {
        const tombstone = tombstoneMeeting(current, nextTimestamp(this.now(), current.updatedAt));
        removedSeries = true;
        return {
          result: null,
          change: {
            meetings: [tombstone],
            writes: [
              { kind: 'meeting', docId: id, mode: 'set', data: meetingToDoc(tombstone) as unknown as RemoteData, updatedAt: tombstone.updatedAt, origin },
            ],
          },
        };
      }
      const next = applyMeetingPatch(
        current,
        { recurrence: split.masterRule, recurrenceOverrides: split.masterOverrides },
        nextTimestamp(this.now(), current.updatedAt),
      );
      truncated = true;
      return {
        result: next,
        change: {
          meetings: [next],
          writes: [{ kind: 'meeting', docId: id, mode: 'set', data: meetingToDoc(next) as unknown as RemoteData, updatedAt: next.updatedAt, origin }],
        },
      };
    });
    if (removedSeries) this.afterMeetingWrite(s, [id], 'deleted', origin);
    if (truncated) this.afterMeetingWrite(s, [id], 'updated', origin);
    return outcome;
  }

  private afterMeetingWrite(s: Session, ids: string[], reason: 'created' | 'updated' | 'deleted' | 'imported', origin: WriteOrigin): void {
    this.notify();
    this.events.emit('meetings:changed', { uid: s.uid, changedIds: ids, reason, origin });
    this.scheduleFlush(s);
  }

  subscribeMeetings(listener: (meetings: Meeting[]) => void, onError?: (error: AppError) => void): Unsubscribe {
    let lastVersion = -1;
    let lastUid: string | null | undefined;
    let lastError: AppError | null = null;
    const deliver = (): void => {
      const snapshot = this.getSnapshot();
      if (snapshot.meetingsVersion !== lastVersion || snapshot.uid !== lastUid) {
        lastVersion = snapshot.meetingsVersion;
        lastUid = snapshot.uid;
        listener([...snapshot.activeMeetings]);
      }
      const error = snapshot.errors.meetings;
      if (onError && error && error !== lastError) onError(error);
      lastError = error;
    };
    deliver();
    return this.subscribeSnapshot(deliver);
  }

  async upsertExternal(items: readonly ExternalMeetingUpsert[]): Promise<ExternalUpsertResultWithInvalid> {
    const s = await this.readySession();
    if (items.length === 0) return { created: 0, updated: 0, removed: 0, unchanged: 0, changedIds: [], invalid: 0 };
    const changedByProvider = new Map<CalendarProvider, string[]>();
    let wrote = false;
    const result = await this.localWrite(s, () => {
      const plan = planExternalUpserts(items, s.meetings, {
        uid: s.uid,
        now: this.now(),
        defaultTimezone: this.timeZone(),
        defaultLanguage: this.language(),
      });
      for (const invalid of plan.invalidItems) {
        log.warn(`skipping calendar event #${invalid.index} (${invalid.reason})`);
      }
      if (plan.writes.length === 0) return { result: plan.result, change: null };
      wrote = true;
      const changed = new Set(plan.result.changedIds);
      for (const write of plan.writes) {
        if (!changed.has(write.meeting.id)) continue;
        changedByProvider.set(write.provider, [...(changedByProvider.get(write.provider) ?? []), write.meeting.id]);
      }
      return {
        result: plan.result,
        change: {
          meetings: plan.writes.map((write) => write.meeting),
          writes: plan.writes.map((write) => ({
            kind: 'meeting' as const,
            docId: write.meeting.id,
            mode: write.mode,
            data: meetingToDoc(write.meeting) as unknown as RemoteData,
            updatedAt: write.meeting.updatedAt,
            origin: originForProvider(write.provider),
          })),
        },
      };
    });
    if (wrote) {
      this.notify();
      for (const [provider, ids] of changedByProvider) {
        this.events.emit('meetings:changed', {
          uid: s.uid,
          changedIds: ids,
          reason: 'imported',
          origin: originForProvider(provider),
        });
      }
      this.scheduleFlush(s);
    }
    return result;
  }

  async findByExternalId(provider: CalendarProvider, externalId: string): Promise<Meeting | null> {
    const s = await this.readySession();
    return findExternalMatch(s.meetings, provider, externalId);
  }

  async getCachedUpcoming(uid: string, options: { horizonDays?: number; now?: Date } = {}): Promise<Meeting[]> {
    assertValidUid(uid);
    const now = options.now ?? this.now();
    const horizonDays = options.horizonDays ?? ALERT_HORIZON_DAYS;
    const s = this.session;
    const source = s && s.uid === uid && s.loaded ? [...s.meetings.values()] : await readCachedMeetings(this.storage, uid);
    const nowMs = now.getTime();
    const horizonMs = nowMs + horizonDays * 24 * 60 * 60_000;
    return source
      .filter((meeting) => {
        if (meeting.deletedAt !== null || meeting.status !== 'scheduled') return false;
        const startMs = Date.parse(meeting.startAt);
        if (startMs > horizonMs) return false;
        // A recurring master stays "upcoming" while its series runs, even when its own first
        // occurrence (its startAt) is long over (§16); the alert planner expands the occurrences.
        if (meeting.recurrence !== null) return seriesReachesBeyond(meeting, nowMs);
        const endMs = startMs + meeting.durationMinutes * 60_000;
        return endMs > nowMs;
      })
      .sort(compareByStart);
  }

  // ---- preferences -----------------------------------------------------------------------------

  async getPreferences(): Promise<Preferences> {
    const s = await this.readySession();
    return s.preferences;
  }

  async getCachedPreferences(uid: string): Promise<Preferences | null> {
    assertValidUid(uid);
    const s = this.session;
    if (s && s.uid === uid && s.loaded && (s.preferencesCached || s.preferencesServerSeen)) return s.preferences;
    return readCachedPreferences(this.storage, uid, this.defaultPreferences());
  }

  async updatePreferences(patch: PreferencesPatch, origin: WriteOrigin = 'user'): Promise<Preferences> {
    const s = await this.readySession();
    let changedKeys: PreferenceKey[] = [];
    const preferences = await this.localWrite(s, () => {
      const applied = applyPreferencesPatch(s.preferences, patch, nextTimestamp(this.now(), s.preferences.updatedAt));
      changedKeys = applied.changedKeys;
      if (changedKeys.length === 0) return { result: s.preferences, change: null };
      return {
        result: applied.preferences,
        change: {
          preferences: applied.preferences,
          writes: [
            {
              kind: 'preferences',
              docId: PREFERENCES_DOC_ID,
              mode: 'merge',
              data: pickPreferences(applied.preferences, changedKeys),
              updatedAt: applied.preferences.updatedAt ?? this.nowIso(),
              origin,
            },
          ],
        },
      };
    });
    if (changedKeys.length > 0) {
      this.notify();
      this.events.emit('preferences:changed', { uid: s.uid, preferences, changedKeys, origin: 'local' });
      this.scheduleFlush(s);
    }
    return preferences;
  }

  subscribePreferences(listener: (preferences: Preferences) => void): Unsubscribe {
    let last: Preferences | null = null;
    const deliver = (): void => {
      const { preferences } = this.getSnapshot();
      if (!last || !deepEqual(last, preferences)) {
        last = preferences;
        listener(preferences);
      }
    };
    deliver();
    return this.subscribeSnapshot(deliver);
  }

  /** Resolves true once preferences are known (server/cache), false after `timeoutMs`. */
  private waitForServerPreferences(s: Session, timeoutMs: number): Promise<boolean> {
    if (s.preferencesServerSeen) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        s.preferencesWaiters.delete(onKnown);
        resolve(this.isCurrent(s) && s.preferencesServerSeen);
      };
      const onKnown = (): void => {
        if (s.preferencesServerSeen || !this.isCurrent(s)) done();
        else s.preferencesWaiters.add(onKnown);
      };
      const timer = setTimeout(done, timeoutMs);
      s.preferencesWaiters.add(onKnown);
    });
  }

  // ---- notes -----------------------------------------------------------------------------------

  async listNotes(): Promise<Note[]> {
    const s = await this.readySession();
    return sortNotes(s.notes.values());
  }

  async getNote(id: string): Promise<Note | null> {
    const s = await this.readySession();
    return s.notes.get(id) ?? null;
  }

  async createNote(input: NoteInput): Promise<Note> {
    const s = await this.readySession();
    const note = await this.localWrite(s, () => {
      const id = this.remote.newId(firestorePaths.notes(s.uid));
      const built = buildNote(input, { id, userId: s.uid, now: this.now() });
      return {
        result: built,
        change: {
          notes: [built],
          writes: [{ kind: 'note', docId: id, mode: 'create', data: noteToDoc(built) as unknown as RemoteData, updatedAt: built.updatedAt, origin: 'user' }],
        },
      };
    });
    this.notify();
    this.scheduleFlush(s);
    return note;
  }

  async updateNote(id: string, patch: NotePatch): Promise<Note> {
    const s = await this.readySession();
    let changed = false;
    const note = await this.localWrite(s, () => {
      const current = s.notes.get(id);
      if (!current) throw new AppError('not_found', 'Note not found');
      const next = applyNotePatch(current, patch, nextTimestamp(this.now(), current.updatedAt));
      const doc = noteToDoc(next);
      const { updatedAt: _a, ...nextRest } = next;
      const { updatedAt: _b, ...currentRest } = current;
      if (deepEqual(nextRest, currentRest)) return { result: current, change: null };
      changed = true;
      return {
        result: next,
        change: { notes: [next], writes: [{ kind: 'note', docId: id, mode: 'set', data: doc as unknown as RemoteData, updatedAt: next.updatedAt, origin: 'user' }] },
      };
    });
    if (changed) {
      this.notify();
      this.scheduleFlush(s);
    }
    return note;
  }

  async removeNote(id: string): Promise<void> {
    const s = await this.readySession();
    await this.localWrite(s, () => {
      const current = s.notes.get(id);
      if (!current) throw new AppError('not_found', 'Note not found');
      return {
        result: undefined,
        change: {
          removeNotes: [id],
          writes: [{ kind: 'note', docId: id, mode: 'delete', data: null, updatedAt: nextTimestamp(this.now(), current.updatedAt), origin: 'user' }],
        },
      };
    });
    this.notify();
    this.scheduleFlush(s);
  }

  subscribeNotes(listener: (notes: Note[]) => void): Unsubscribe {
    let lastVersion = -1;
    let lastUid: string | null | undefined;
    const deliver = (): void => {
      const snapshot = this.getSnapshot();
      if (snapshot.notesVersion !== lastVersion || snapshot.uid !== lastUid) {
        lastVersion = snapshot.notesVersion;
        lastUid = snapshot.uid;
        listener([...snapshot.notes]);
      }
    };
    deliver();
    return this.subscribeSnapshot(deliver);
  }

  // ---- profile / entitlement -----------------------------------------------------------------

  async ensureProfile(user: AuthUser): Promise<UserProfile> {
    const s = await this.readySession();
    if (user.uid !== s.uid) throw new AppError('permission_denied', 'Profile user does not match the data session');
    const profile = await this.localWrite(s, () => {
      const nowIso = nextTimestamp(this.now(), s.profile?.updatedAt);
      const identity = profileIdentityPatch(user, nowIso);
      const next: UserProfile = {
        ...identity,
        createdAt: s.profile?.createdAt ?? nowIso,
        legacyMigratedAt: s.profile?.legacyMigratedAt ?? null,
      };
      const checked = userProfileSchema.safeParse(next);
      if (!checked.success) throw new AppError('invalid_input', 'Invalid profile', { cause: checked.error });
      return {
        result: checked.data,
        change: {
          profile: checked.data,
          writes: [
            {
              kind: 'profile',
              docId: s.uid,
              mode: 'merge',
              data: { ...identity, createdAt: checked.data.createdAt },
              updatedAt: nowIso,
              origin: 'system',
            },
          ],
        },
      };
    });
    s.user = user;
    this.scheduleFlush(s);
    return profile;
  }

  async getProfile(): Promise<UserProfile | null> {
    const s = await this.readySession();
    if (s.profile) return s.profile;
    let snapshot: { exists: boolean; data: RemoteData | null };
    try {
      snapshot = await withTimeout(this.remote.getDoc(firestorePaths.user(s.uid)), this.timeouts.fetchMs, 'profile read');
    } catch (error) {
      throw toAppError(error);
    }
    this.assertCurrent(s);
    const profile = snapshot.exists ? readRemoteProfile(s.uid, snapshot.data) : null;
    if (profile) {
      s.profile = profile;
      void this.persist(s, { profile: true });
    }
    return profile;
  }

  async getEntitlement(): Promise<Entitlement> {
    const s = await this.readySession();
    if (s.entitlementKnown) return s.entitlement;
    let snapshot: { exists: boolean; data: RemoteData | null };
    try {
      snapshot = await withTimeout(this.remote.getDoc(firestorePaths.entitlement(s.uid)), this.timeouts.fetchMs, 'entitlement read');
    } catch (error) {
      throw toAppError(error);
    }
    this.assertCurrent(s);
    return this.applyEntitlement(s, snapshot.exists ? snapshot.data : null);
  }

  subscribeEntitlement(listener: (entitlement: Entitlement) => void): Unsubscribe {
    let last: Entitlement | null = null;
    const deliver = (): void => {
      const { entitlement } = this.getSnapshot();
      if (!last || !deepEqual(last, entitlement)) {
        last = entitlement;
        listener(entitlement);
      }
    };
    deliver();
    return this.subscribeSnapshot(deliver);
  }

  // ---- sync state ------------------------------------------------------------------------------

  getSyncState(): SyncState {
    const s = this.session;
    return {
      online: this.online !== false,
      pendingWrites: s ? s.outbox.entries.length : 0,
      lastSyncedAt: s?.lastSyncedAt ?? null,
    };
  }

  subscribeSyncState(listener: (state: SyncState) => void): Unsubscribe {
    let last: SyncState | null = null;
    const deliver = (): void => {
      const { sync } = this.getSnapshot();
      if (!last || !deepEqual(last, sync)) {
        last = sync;
        listener(sync);
      }
    };
    deliver();
    return this.subscribeSnapshot(deliver);
  }

  async getPendingWriteCount(): Promise<number> {
    const s = this.session;
    if (!s) return 0;
    await s.ready;
    return s.outbox.entries.length;
  }

  // ---- legacy migration ------------------------------------------------------------------------

  async migrateLegacyLocalData(uid: string): Promise<MigrationReport> {
    assertValidUid(uid);
    const s = await this.readySession();
    if (s.uid !== uid) throw new AppError('unauthenticated', 'No data session for this user');
    if (!s.migration) {
      s.migration = this.runMigration(s).finally(() => {
        s.migration = null;
      });
    }
    return s.migration;
  }

  private async runMigration(s: Session): Promise<MigrationReport> {
    const report: MigrationReport = {
      alreadyDone: false,
      migratedMeetings: 0,
      migratedNotes: 0,
      preferencesMigrated: false,
      skipped: 0,
      removedLegacyKeys: 0,
      errors: [],
    };
    const addError = (code: AppErrorCode): void => {
      if (!report.errors.includes(code)) report.errors.push(code);
    };
    let marker: string | null;
    let rawBlob: string | null;
    try {
      marker = await this.storage.getItem(cacheKeys.migration(s.uid));
      rawBlob = marker === null ? await this.storage.getItem(LEGACY_DATA_KEY) : null;
    } catch (error) {
      throw toAppError(error);
    }
    if (marker !== null) return { ...report, alreadyDone: true };

    let deferred = false;
    let blob: unknown = null;
    if (rawBlob !== null) {
      try {
        blob = JSON.parse(rawBlob) as unknown;
      } catch {
        addError('invalid_input');
      }
    }

    const email = s.user?.email ?? s.profile?.email ?? null;
    if (blob !== null && email === null) {
      // Without the account email, records owned by this account would look foreign: keep the
      // legacy data untouched (no marker) until a session knows the email.
      deferred = true;
      addError('unauthenticated');
      blob = null;
    }

    if (blob !== null) {
      const plan = planLegacyMigration({
        blob,
        uid: s.uid,
        email,
        timeZone: this.timeZone(),
        language: this.language(),
        now: this.now(),
        existingMeetingIds: new Set(s.meetings.keys()),
        existingNoteIds: new Set(s.notes.keys()),
      });
      report.skipped = plan.skipped;
      plan.errors.forEach(addError);

      if (plan.meetings.length > 0 || plan.notes.length > 0) {
        await this.localWrite(s, () => {
          const meetings = plan.meetings.filter((meeting) => !s.meetings.has(meeting.id));
          const notes = plan.notes.filter((note) => !s.notes.has(note.id));
          report.migratedMeetings = meetings.length;
          report.migratedNotes = notes.length;
          report.skipped += plan.meetings.length - meetings.length + plan.notes.length - notes.length;
          const writes: OutboxWrite[] = [
            ...meetings.map((meeting) => ({
              kind: 'meeting' as const,
              docId: meeting.id,
              mode: 'create' as const,
              data: meetingToDoc(meeting) as unknown as RemoteData,
              updatedAt: meeting.updatedAt,
              origin: 'migration' as const,
            })),
            ...notes.map((note) => ({
              kind: 'note' as const,
              docId: note.id,
              mode: 'create' as const,
              data: noteToDoc(note) as unknown as RemoteData,
              updatedAt: note.updatedAt,
              origin: 'migration' as const,
            })),
          ];
          return {
            result: undefined,
            change: writes.length > 0 ? { meetings, notes, writes } : null,
            after: () => {
              this.notify();
              if (meetings.length > 0) {
                this.events.emit('meetings:changed', {
                  uid: s.uid,
                  changedIds: meetings.map((meeting) => meeting.id),
                  reason: 'created',
                  origin: 'migration',
                });
              }
              this.scheduleFlush(s);
            },
          };
        });
      }

      if (plan.preferencesPatch) {
        const known = await this.waitForServerPreferences(s, this.timeouts.migrationPreferencesWaitMs);
        this.assertCurrent(s);
        if (!known) {
          // Keep the legacy data and the marker unset: the next session retries (meetings/notes are skipped by id).
          deferred = true;
          addError('offline');
        } else if (s.preferences.updatedAt === null) {
          await this.updatePreferences(plan.preferencesPatch, 'migration');
          report.preferencesMigrated = true;
        }
      }

      if (!deferred) {
        try {
          report.removedLegacyKeys += await relinkLegacyAttachments(this.storage, s.uid, (oldId) => {
            const mapped = plan.meetingIdMap[oldId];
            if (mapped) return mapped;
            return s.meetings.has(oldId) ? oldId : null;
          });
          if (plan.remainingBlob) {
            await this.storage.setItem(LEGACY_DATA_KEY, JSON.stringify(plan.remainingBlob));
          } else {
            await this.storage.removeItem(LEGACY_DATA_KEY);
            report.removedLegacyKeys += 1;
          }
        } catch (error) {
          throw toAppError(error);
        }
      }
    }

    try {
      report.removedLegacyKeys += await removeLegacyKeys(this.storage);
      if (!deferred) {
        this.assertCurrent(s);
        await this.storage.setItem(cacheKeys.migration(s.uid), JSON.stringify({ v: 1, completedAt: this.nowIso(), report }));
      }
    } catch (error) {
      throw toAppError(error);
    }

    if (!deferred && (report.migratedMeetings > 0 || report.migratedNotes > 0 || report.preferencesMigrated)) {
      await this.markProfileMigrated(s).catch((error: unknown) => {
        log.warn(`could not record the migration on the profile (${toAppError(error).code})`);
      });
    }
    return report;
  }

  private async markProfileMigrated(s: Session): Promise<void> {
    await this.localWrite(s, () => {
      const nowIso = nextTimestamp(this.now(), s.profile?.updatedAt);
      const profile = s.profile ? { ...s.profile, legacyMigratedAt: s.profile.legacyMigratedAt ?? nowIso, updatedAt: nowIso } : undefined;
      return {
        result: undefined,
        change: {
          profile,
          writes: [
            {
              kind: 'profile',
              docId: s.uid,
              mode: 'merge',
              data: { uid: s.uid, legacyMigratedAt: nowIso, updatedAt: nowIso },
              updatedAt: nowIso,
              origin: 'migration',
            },
          ],
        },
        after: () => this.scheduleFlush(s),
      };
    });
  }

  // ---- facades (contract objects) --------------------------------------------------------------

  createRepositories(): {
    meetingRepository: MeetingRepository &
      MeetingRecurrenceOps & { upsertExternal(items: readonly ExternalMeetingUpsert[]): Promise<ExternalUpsertResultWithInvalid> };
    preferencesRepository: PreferencesRepository;
    notesRepository: NotesRepository;
    userRepository: UserRepository;
    migrationService: MigrationService;
    dataService: DataService;
  } {
    return {
      meetingRepository: {
        list: (range) => this.listMeetings(range),
        get: (id) => this.getMeeting(id),
        create: (input, options) => this.createMeeting(input, options),
        update: (id, patch, options) => this.updateMeeting(id, patch, options),
        remove: (id, options) => this.removeMeeting(id, options),
        updateOccurrence: (id, localDateKey, patch, options) => this.updateOccurrence(id, localDateKey, patch, options),
        cancelOccurrence: (id, localDateKey, options) => this.cancelOccurrence(id, localDateKey, options),
        restoreOccurrence: (id, localDateKey, options) => this.restoreOccurrence(id, localDateKey, options),
        editFollowing: (id, fromDateKey, patch, options) => this.editFollowing(id, fromDateKey, patch, options),
        deleteFollowing: (id, fromDateKey, options) => this.deleteFollowing(id, fromDateKey, options),
        subscribe: (listener, onError) => this.subscribeMeetings(listener, onError),
        upsertExternal: (items) => this.upsertExternal(items),
        findByExternalId: (provider, externalId) => this.findByExternalId(provider, externalId),
        flushOutbox: () => this.flushOutbox(),
        getCachedUpcoming: (uid, options) => this.getCachedUpcoming(uid, options),
      },
      preferencesRepository: {
        get: () => this.getPreferences(),
        getCached: (uid) => this.getCachedPreferences(uid),
        update: (patch) => this.updatePreferences(patch),
        subscribe: (listener) => this.subscribePreferences(listener),
      },
      notesRepository: {
        list: () => this.listNotes(),
        get: (id) => this.getNote(id),
        create: (input) => this.createNote(input),
        update: (id, patch) => this.updateNote(id, patch),
        remove: (id) => this.removeNote(id),
        subscribe: (listener) => this.subscribeNotes(listener),
      },
      userRepository: {
        ensureProfile: (user) => this.ensureProfile(user),
        getProfile: () => this.getProfile(),
        getEntitlement: () => this.getEntitlement(),
        subscribeEntitlement: (listener) => this.subscribeEntitlement(listener),
      },
      migrationService: {
        migrateLegacyLocalData: (uid) => this.migrateLegacyLocalData(uid),
      },
      dataService: {
        startSession: (uid, options) => this.startSession(uid, options),
        endSession: (options) => this.endSession(options),
        suspendRemote: () => this.suspendRemote(),
        resumeRemote: () => this.resumeRemote(),
        getActiveUid: () => this.getActiveUid(),
        getSyncState: () => this.getSyncState(),
        subscribeSyncState: (listener) => this.subscribeSyncState(listener),
        getPendingWriteCount: () => this.getPendingWriteCount(),
      },
    };
  }
}
