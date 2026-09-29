/**
 * Stage-2 service contracts: the interfaces every area implements, the exact public module paths
 * and export names, navigation params, provider order and session lifecycle.
 *
 * Type-only dependencies on other core modules; no runtime imports of services (core never depends
 * on services). src/core/conformance.ts checks at compile time that each module exports what this
 * file promises.
 *
 * IMPORT RULES (avoid cycles; lower layers never import higher ones):
 *   L0 core            src/core/*
 *   L1 config, i18n    src/config/firebase.ts, src/i18n (events only towards data)
 *   L2 data            src/services/data
 *   L3 auth identity   src/services/auth/authService.ts   (NOT the auth barrel)
 *   L4 calendar, alerts engine
 *                      src/services/calendar, src/services/alerts (NOT alerts/tasks.ts)
 *   L5 ai              src/services/ai
 *   L6 session + React auth
 *                      src/services/auth (barrel: sessionManager, AuthProvider, useAuth)
 *   L7 entry/UI        index.js -> src/services/alerts/tasks.ts, App.js, src/navigation,
 *                      src/components/alerts, src/screens, src/pages, legacy shims
 * Areas import each other ONLY through the public paths in MODULES (never internal files).
 */
import type { ComponentType, ReactNode } from 'react';

import type {
  AiAction,
  AiActionType,
  AssistantRequest,
  AssistantResponse,
  AssistantUsage,
  CallableName,
  Language,
} from './aiContract';
import type { AppError, AppErrorCode } from './errors';
import type { MeetingsChangedEvent, Unsubscribe, WriteOrigin } from './events';
import type { AndroidChannelId, NotificationKind } from './identifiers';
import type { LegacyMeetingView } from './legacy';
import type {
  AlertIntensity,
  AuthUser,
  ConferenceDetails,
  Entitlement,
  Meeting,
  MeetingCreateInput,
  MeetingPatch,
  Note,
  NoteInput,
  NotePatch,
  Plan,
  Preferences,
  PreferencesPatch,
  UserProfile,
} from './types';

export type { Unsubscribe } from './events';

// =============================================================================================
// Module map (public entry points). Paths are relative to the repo root.
// =============================================================================================

export const MODULES = {
  core: {
    types: 'src/core/types.ts',
    aiContract: 'src/core/aiContract.ts',
    events: 'src/core/events.ts', // appEvents, createEventBus
    identifiers: 'src/core/identifiers.ts',
    errors: 'src/core/errors.ts', // AppError, toAppError, notImplemented
    logger: 'src/core/logger.ts', // createLogger, setErrorReporter
    time: 'src/core/time.ts',
    legacy: 'src/core/legacy.ts',
  },
  data: {
    // dataService, meetingRepository, preferencesRepository, notesRepository, userRepository,
    // migrationService, DataProvider, useMeetings, useMeeting, usePreferences, useNotes,
    // useEntitlement, useSyncState
    index: 'src/services/data/index.ts',
    firebase: 'src/config/firebase.ts', // app, auth, db, functions, isFirebaseReady (nullable)
  },
  auth: {
    // authService only (L3) - calendar/ai/data-free code imports THIS path
    authService: 'src/services/auth/authService.ts',
    // authService, sessionManager, AuthProvider, useAuth (L6)
    index: 'src/services/auth/index.ts',
    legacyContext: 'src/contexts/AuthContext.jsx', // compat re-export of AuthProvider/useAuth (stays .jsx)
  },
  calendar: {
    // googleCalendarService, deviceCalendarService, calendarSyncEngine, useCalendarStatus
    index: 'src/services/calendar/index.ts',
  },
  alerts: {
    // alertEngine, computeAlertPlan, usePendingAlerts
    index: 'src/services/alerts/index.ts',
    // side-effect module (TaskManager.defineTask at module scope) + registerBackgroundTasks,
    // unregisterBackgroundTasks. Imported by index.js BEFORE registerRootComponent.
    tasks: 'src/services/alerts/tasks.ts',
    // AlertHost (rendered once inside NavigationContainer)
    host: 'src/components/alerts/index.ts',
  },
  i18n: {
    // i18n, initI18n, t, getLanguage, setLanguage, SUPPORTED_LANGUAGES, I18N_NAMESPACES,
    // I18nProvider, useT, useLanguage
    index: 'src/i18n/index.ts',
    format: 'src/utils/format.ts', // formatDate, formatTime, formatDateTime, formatRelative, formatDuration, formatMeetingTimeRange, uses24HourClock
    legacyTranslations: 'src/components/translations.jsx', // useTranslation(language) compat
  },
  navigation: {
    // navigationRef, navigate, openDeepLink, linking, RootNavigator, ROUTES
    index: 'src/navigation/index.ts',
    onboarding: 'src/screens/onboarding/index.ts',
  },
  ai: {
    // assistantClient, actionExecutor, useAssistant
    index: 'src/services/ai/index.ts',
  },
  functions: {
    entry: 'functions/src/index.ts', // exports: assistant, deleteAccount
    contractCopy: 'functions/src/shared/aiContract.ts', // VERBATIM copy of src/core/aiContract.ts
  },
} as const;

// =============================================================================================
// DATA  (src/services/data)
// =============================================================================================

export interface MeetingRange {
  /** Inclusive lower bound on startAt (ISO). Default: no bound. */
  from?: string;
  /** Exclusive upper bound on startAt (ISO). Default: no bound. */
  to?: string;
  /** Include meetings with status 'cancelled' (default true). */
  includeCancelled?: boolean;
  /** Include tombstones (default false). Only sync code needs this. */
  includeDeleted?: boolean;
}

export interface WriteOptions {
  /** Default 'user'. Calendar sync pushes only 'user' and 'ai' writes. */
  origin?: WriteOrigin;
  /**
   * Caller-chosen document id for idempotent creates (MEETING_ID_PATTERN). If an ACTIVE meeting
   * with this id already exists, create() returns it unchanged instead of creating a duplicate; if
   * the id belongs to a deleted (tombstoned) meeting it throws AppError('conflict') rather than
   * silently resurrecting it.
   */
  id?: string;
}

/** A calendar event to import, matched by provider + externalId. */
export interface ExternalMeetingUpsert {
  provider: 'google' | 'device';
  /** Google event id / device event id. */
  externalId: string;
  calendarId: string;
  /** Google etag (null for device). */
  etag: string | null;
  /** Provider "updated" time (UTC ISO) for last-writer-wins; null when unknown. */
  providerUpdatedAt: string | null;
  /** true => the event was deleted/cancelled at the provider: tombstone the local meeting. */
  deleted: boolean;
  /** Required unless deleted. `source` is set by the repository ('google' | 'device'). */
  meeting: Omit<MeetingCreateInput, 'source' | 'external'> | null;
}

export interface UpsertExternalResult {
  created: number;
  updated: number;
  removed: number;
  unchanged: number;
  /** Items rejected by validation (logged and skipped; never written). */
  invalid: number;
  /** Ids of meetings created/updated/removed. */
  changedIds: string[];
}

export interface OutboxFlushResult {
  /** Writes acknowledged by the server in this flush. */
  flushed: number;
  /** Writes still pending (offline or retryable failure). */
  pending: number;
  /** Writes dropped because the server rejected them permanently (logged + reported). */
  rejected: number;
}

/**
 * Meetings of the signed-in user. Offline-first: reads come from the per-user cache (kept current
 * by a Firestore listener); writes apply to the cache immediately, go to an AsyncStorage outbox and
 * are sent to Firestore in the background. Every write emits `meetings:changed`.
 * All methods throw AppError('unauthenticated') when no data session is active.
 */
export interface MeetingRepository {
  /** Active (non-tombstoned) meetings sorted by startAt asc. Resolves from cache (never waits for network). */
  list(range?: MeetingRange): Promise<Meeting[]>;
  get(id: string): Promise<Meeting | null>;
  create(input: MeetingCreateInput, options?: WriteOptions): Promise<Meeting>;
  /** Throws AppError('not_found') if missing/tombstoned. */
  update(id: string, patch: MeetingPatch, options?: WriteOptions): Promise<Meeting>;
  /** Soft delete (tombstone). Idempotent. */
  remove(id: string, options?: WriteOptions): Promise<void>;
  /**
   * Live list of active meetings (called immediately with the current list). Signed out, the
   * listener receives `[]` instead of throwing (a hook mounted before the session starts).
   */
  subscribe(listener: (meetings: Meeting[]) => void, onError?: (error: AppError) => void): Unsubscribe;
  /** Calendar imports. Emits one `meetings:changed` { reason: 'imported', origin: calendar_* }. */
  upsertExternal(items: readonly ExternalMeetingUpsert[]): Promise<UpsertExternalResult>;
  /**
   * The meeting linked to a provider event. May return a TOMBSTONED meeting (an active one is
   * preferred) so callers can restore it instead of creating a duplicate.
   */
  findByExternalId(provider: 'google' | 'device', externalId: string): Promise<Meeting | null>;
  /** Sends pending writes now (also runs on reconnect / foreground / session start). */
  flushOutbox(): Promise<OutboxFlushResult>;
  /**
   * HEADLESS-SAFE: reads the per-user AsyncStorage cache only (no auth, no network). Active,
   * status 'scheduled' meetings whose end is after now, within `horizonDays` (default 14).
   */
  getCachedUpcoming(uid: string, options?: { horizonDays?: number; now?: Date }): Promise<Meeting[]>;
}

export interface PreferencesRepository {
  /** Merged with defaults field-by-field (mergePreferences). Never resets on read. */
  get(): Promise<Preferences>;
  /** HEADLESS-SAFE cache read; null if nothing cached for this uid. */
  getCached(uid: string): Promise<Preferences | null>;
  /** Validates (applyPreferencesPatch), writes through cache + outbox, emits preferences:changed. */
  update(patch: PreferencesPatch): Promise<Preferences>;
  subscribe(listener: (preferences: Preferences) => void): Unsubscribe;
}

export interface NotesRepository {
  /** Sorted: pinned first, then updatedAt desc. */
  list(): Promise<Note[]>;
  get(id: string): Promise<Note | null>;
  create(input: NoteInput): Promise<Note>;
  update(id: string, patch: NotePatch): Promise<Note>;
  /** Hard delete. */
  remove(id: string): Promise<void>;
  subscribe(listener: (notes: Note[]) => void): Unsubscribe;
}

export interface UserRepository {
  /** Creates users/{uid} once (no plan fields); later calls only update identity + lastLoginAt. */
  ensureProfile(user: AuthUser): Promise<UserProfile>;
  getProfile(): Promise<UserProfile | null>;
  /** Server-owned entitlements/{uid}; DEFAULT_ENTITLEMENT (free) if missing. Cached for offline. */
  getEntitlement(): Promise<Entitlement>;
  subscribeEntitlement(listener: (entitlement: Entitlement) => void): Unsubscribe;
}

export interface MigrationReport {
  alreadyDone: boolean;
  migratedMeetings: number;
  migratedNotes: number;
  preferencesMigrated: boolean;
  skipped: number;
  /** Legacy token/identity keys removed from AsyncStorage. */
  removedLegacyKeys: number;
  errors: AppErrorCode[];
}

export interface MigrationService {
  /**
   * Idempotent import of v1.0.9 local data (AsyncStorage "meetingguard_data") into the user's
   * Firestore data (ids "legacy_<oldId>" so re-runs never duplicate), then deletes legacy keys
   * (LEGACY_STORAGE_KEYS incl. plaintext Google tokens). Marker: mg:{uid}:migration + profile.legacyMigratedAt.
   */
  migrateLegacyLocalData(uid: string): Promise<MigrationReport>;
}

export interface SyncState {
  online: boolean;
  pendingWrites: number;
  /** Last time a Firestore snapshot or outbox ack was received. */
  lastSyncedAt: string | null;
}

export interface DataService {
  /**
   * Starts (idempotently) the data session for `uid`: loads the per-user cache, then
   * - 'foreground': attaches Firestore listeners (meetings, preferences, notes, entitlement),
   *   flushes the outbox, runs ensureProfile + migration in the background;
   * - 'headless': no listeners; one-shot fetch of upcoming meetings + preferences (with timeout)
   *   and outbox flush. A later foreground start upgrades the session.
   * Resolves once the cache is loaded (does NOT wait for the network). Emits meetings:changed
   * { reason: 'cache_loaded' } and preferences:changed { origin: 'cache' }.
   */
  startSession(uid: string, options?: { mode?: 'foreground' | 'headless'; user?: AuthUser }): Promise<void>;
  /** Detaches listeners and clears memory; `wipeLocal` deletes every `mg:{uid}:*` key. */
  endSession(options: { wipeLocal: boolean }): Promise<void>;
  getActiveUid(): string | null;
  getSyncState(): SyncState;
  subscribeSyncState(listener: (state: SyncState) => void): Unsubscribe;
  /** Outbox size (used before sign-out to warn about unsynced changes). */
  getPendingWriteCount(): Promise<number>;
}

// ---- React bindings (DataProvider must be inside AuthProvider) ------------------------------

export interface DataProviderProps {
  children?: ReactNode;
}

export interface UseMeetingsResult {
  meetings: Meeting[];
  /** true until the first cache load of the session. */
  isLoading: boolean;
  error: AppError | null;
  /** Flushes the outbox and re-reads (pull-to-refresh). */
  refresh(): Promise<void>;
}

export interface UseMeetingResult {
  meeting: Meeting | null;
  isLoading: boolean;
  error: AppError | null;
}

export interface UsePreferencesResult {
  preferences: Preferences;
  /** false until the session's preferences are known (cache or server); gate onboarding on it. */
  isLoaded: boolean;
  error: AppError | null;
  update(patch: PreferencesPatch): Promise<Preferences>;
}

export interface UseNotesResult {
  notes: Note[];
  isLoading: boolean;
  error: AppError | null;
  create(input: NoteInput): Promise<Note>;
  update(id: string, patch: NotePatch): Promise<Note>;
  remove(id: string): Promise<void>;
}

export interface UseEntitlementResult {
  entitlement: Entitlement;
  plan: Plan;
  isLoaded: boolean;
}

// =============================================================================================
// AUTH  (src/services/auth)
// =============================================================================================

export type SignInResult = { status: 'success'; user: AuthUser } | { status: 'cancelled' };

/** Identity + Google tokens (L3). No session orchestration here (see SessionManager). */
export interface AuthService {
  /** Configures GoogleSignin (webClientId/iosClientId from env, no scopes, offlineAccess false). Idempotent. */
  init(): void;
  readonly currentUser: AuthUser | null;
  /** Resolves after Firebase restored the persisted session (auth.authStateReady()). Headless-safe. */
  authReady(): Promise<AuthUser | null>;
  onAuthStateChanged(listener: (user: AuthUser | null) => void): Unsubscribe;
  /** Native Google sign-in -> GoogleAuthProvider.credential(idToken) -> signInWithCredential. Throws AppError (not on cancel). */
  signInWithGoogle(): Promise<SignInResult>;
  /** Email/password (review/demo accounts). */
  signInWithEmail(email: string, password: string): Promise<AuthUser>;
  signUpWithEmail(email: string, password: string, displayName: string): Promise<AuthUser>;
  sendPasswordReset(email: string): Promise<void>;
  /** LOW-LEVEL: GoogleSignin.signOut() + Firebase signOut(). Use sessionManager.signOut() from UI. */
  signOutProviders(): Promise<void>;
  /**
   * Fresh Google access token via GoogleSignin.getTokens() (native SDK refreshes; never stored).
   * Throws AppError('google_not_signed_in') / AppError('calendar_scope_missing') when requireCalendar.
   */
  getGoogleAccessToken(options: { requireCalendar: boolean }): Promise<string>;
  /** After a 401 from a Google API: clearCachedAccessToken(token) so the next getTokens() refreshes. */
  invalidateGoogleAccessToken(token: string): Promise<void>;
  hasCalendarScope(): Promise<boolean>;
  /** Incremental consent via GoogleSignin.addScopes (GOOGLE_CALENDAR_SCOPES). false = declined. */
  requestCalendarScope(): Promise<boolean>;
  /** GoogleSignin.revokeAccess() (disconnect calendar / account deletion). */
  revokeGoogleAccess(): Promise<void>;
  /** Calls the "deleteAccount" callable ({ confirm: true }). Local cleanup is the session manager's job. */
  deleteAccountOnServer(): Promise<void>;
}

/** Scopes requested incrementally for calendar sync. */
export const GOOGLE_CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar.events'] as const;

export type SessionStatus = 'initializing' | 'signed_out' | 'starting' | 'active' | 'ending';

export interface SessionState {
  status: SessionStatus;
  user: AuthUser | null;
  /** Last session start/stop failure (the session may still be active on cached data). */
  error: AppError | null;
}

/**
 * Orchestrates everything that depends on "who is signed in" (auth-owned, L6).
 *
 * START (Firebase user restored or signed in):
 *   1 state 'starting'
 *   2 await dataService.startSession(uid, { mode: 'foreground', user })
 *   3 appEvents.emit('session:started', { uid, restored })
 *   4 calendarSyncEngine.start(uid)                 (not awaited)
 *   5 void alertEngine.startSession(uid)            (reconciles; not awaited)
 *   6 state 'active'
 * END (signOut / deleteAccount / auth lost):
 *   1 state 'ending'
 *   2 await alertEngine.endSession()                (cancel all mg:* notifications, stop audio)
 *   3 calendarSyncEngine.stop()
 *   4 await dataService.endSession({ wipeLocal: true })
 *   5 await authService.signOutProviders()          (skipped for auth_lost)
 *   6 appEvents.emit('session:ended', { uid, reason })
 *   7 state 'signed_out'
 */
export interface SessionManager {
  /** Subscribes to Firebase auth state (idempotent). Called by AuthProvider on mount. */
  init(): void;
  getState(): SessionState;
  subscribe(listener: (state: SessionState) => void): Unsubscribe;
  /** Throws AppError('pending_writes') if unsynced writes exist and !force. */
  signOut(options?: { force?: boolean }): Promise<void>;
  /** deleteAccountOnServer() -> revokeGoogleAccess() -> END with reason 'account_deleted'. */
  deleteAccount(): Promise<void>;
  /**
   * HEADLESS entry for background tasks: waits for auth restore; if signed in, ensures a data
   * session (starting a 'headless' one if none is active; never ends it) and runs `fn(uid)`.
   * Resolves null when nobody is signed in or Firebase is not configured.
   */
  withHeadlessSession<T>(fn: (uid: string) => Promise<T>): Promise<T | null>;
}

/** Legacy `user` object shape screens read (user.id / user.email / user.name / user.picture). */
export interface LegacyAuthUserView {
  id: string;
  uid: string;
  email: string | null;
  name: string | null;
  displayName: string | null;
  picture: string | null;
  photoURL: string | null;
  emailVerified: boolean;
  providerIds: string[];
}

/** Legacy result shape of signInWithGoogle/Email (LandingPage checks `result.success`). */
export interface LegacySignInResult {
  success: boolean;
  cancelled?: boolean;
  user?: LegacyAuthUserView;
  /** Localized, user-presentable message. */
  error?: string;
}

/** useAuth() value (from src/services/auth, also re-exported by src/contexts/AuthContext.jsx). */
export interface AuthContextValue {
  status: SessionStatus;
  /** true while initializing / starting / ending or while a sign-in call is running. */
  isLoading: boolean;
  isAuthenticated: boolean;
  user: LegacyAuthUserView | null;
  authUser: AuthUser | null;
  entitlement: Entitlement;
  /** Effective plan (compat name). */
  userPlan: Plan;
  hasCalendarScope: boolean;
  signInWithGoogle(): Promise<LegacySignInResult>;
  signInWithEmail(email: string, password: string): Promise<LegacySignInResult>;
  signUpWithEmail(email: string, password: string, name: string): Promise<LegacySignInResult>;
  signOut(options?: { force?: boolean }): Promise<void>;
  /** Compat alias of signOut(). */
  logout(): Promise<void>;
  requestCalendarScope(): Promise<boolean>;
  deleteAccount(): Promise<void>;
  /** Compat: re-reads the entitlement (optional delay in ms). */
  refreshUserPlan(delayMs?: number): Promise<Plan>;
  forceRefreshUserPlan(): Promise<Plan>;
}

export interface AuthProviderProps {
  children?: ReactNode;
}

// =============================================================================================
// CALENDAR  (src/services/calendar)
// =============================================================================================

export type PermissionState = 'granted' | 'denied' | 'undetermined';

export interface CalendarSyncCounts {
  created: number;
  updated: number;
  removed: number;
  unchanged: number;
  /** Local meetings pushed to the provider. */
  pushed: number;
  failed: number;
}

export interface CalendarPullResult {
  provider: 'google' | 'device';
  /** true when a full resync ran (first sync or syncToken expired / 410 Gone). */
  fullSync: boolean;
  counts: CalendarSyncCounts;
  syncedAt: string;
}

export interface GoogleConnectResult {
  status: 'connected' | 'cancelled' | 'scope_denied';
  initialSync: CalendarPullResult | null;
}

/**
 * Google Calendar on device (REST with GoogleSignin access tokens; primary calendar).
 * - Push: events.insert with id googleEventIdForMeeting(meeting.id) (409 => get + patch), patch,
 *   delete; sendUpdates 'all' when the meeting has participants; stores external.google* refs
 *   through meetingRepository.update(..., { origin: 'calendar_google' }).
 * - Pull: events.list singleEvents=true with syncToken (full sync in CALENDAR_SYNC_WINDOW; 410 =>
 *   full resync) -> meetingRepository.upsertExternal (provider 'google'); cancelled => deleted.
 *   Events whose id decodes via meetingIdFromGoogleEventId update that meeting (no duplicate).
 * - 401 => authService.invalidateGoogleAccessToken(token) and retry once.
 * - Only runs when Preferences.googleCalendarSyncEnabled && hasCalendarScope(); otherwise methods
 *   throw AppError('calendar_not_connected').
 */
export interface GoogleCalendarService {
  isConnected(): Promise<boolean>;
  /** requestCalendarScope -> prefs.googleCalendarSyncEnabled = true -> initial full pull + push of upcoming local meetings. */
  connect(): Promise<GoogleConnectResult>;
  /**
   * prefs.googleCalendarSyncEnabled = false, clears sync state, tombstones source 'google'
   * meetings, clears external.google* refs of other meetings; revoke => revokeGoogleAccess().
   */
  disconnect(options?: { revoke?: boolean }): Promise<void>;
  /** Insert or patch. Returns the meeting with updated external refs. */
  pushMeeting(meeting: Meeting): Promise<Meeting>;
  /** events.delete for a pushed meeting (no-op if it has no googleEventId). */
  removeMeeting(meeting: Meeting): Promise<void>;
  pullChanges(options?: { full?: boolean }): Promise<CalendarPullResult>;
  /**
   * Real Google Meet link: ensures the meeting is pushed, patches it with
   * conferenceData.createRequest (conferenceDataVersion=1), stores meeting.conference
   * { provider: 'google_meet', url: hangoutLink } and returns it. Requires connection.
   */
  createMeetLink(meetingId: string): Promise<ConferenceDetails>;
}

export interface DeviceCalendarInfo {
  id: string;
  title: string;
  color: string | null;
  /** Account/source name (e.g. "iCloud", "user@gmail.com"). */
  sourceName: string | null;
  isPrimary: boolean;
  allowsModifications: boolean;
  /** Google account calendar synced to the device: excluded from import while Google sync is on (duplicates). */
  isGoogleAccount: boolean;
}

/** Apple/Android device calendars via expo-calendar NEW object API (never root legacy functions). */
export interface DeviceCalendarService {
  getPermission(): Promise<PermissionState>;
  requestPermission(): Promise<PermissionState>;
  listCalendars(): Promise<DeviceCalendarInfo[]>;
  /** Imports events in CALENDAR_SYNC_WINDOW from these calendars (unknown ids ignored) -> upsertExternal('device'). */
  importFrom(calendarIds: readonly string[]): Promise<CalendarPullResult>;
  /** Creates/updates the event in `calendarId`; stores external.deviceEventId/deviceCalendarId. */
  exportMeeting(meeting: Meeting, calendarId: string): Promise<Meeting>;
  removeExported(meeting: Meeting): Promise<void>;
}

export type CalendarSyncReason = 'session_start' | 'manual' | 'foreground' | 'background' | 'connectivity' | 'preferences';

export interface CalendarSyncReport {
  /** null when Google sync is off / not connected. */
  google: CalendarPullResult | null;
  /** null when no device calendars are selected / no permission. */
  device: CalendarPullResult | null;
  errors: { provider: 'google' | 'device'; code: AppErrorCode }[];
}

export interface ProviderStatus {
  enabled: boolean;
  syncing: boolean;
  lastSyncAt: string | null;
  lastError: AppErrorCode | null;
}

export interface CalendarStatus {
  google: ProviderStatus & { connected: boolean; hasScope: boolean };
  device: ProviderStatus & { permission: PermissionState; importCalendarIds: string[]; exportCalendarId: string | null };
}

/**
 * Per-session orchestration: subscribes to meetings:changed and pushes LOCAL changes
 * (origin 'user' | 'ai') to Google / the export device calendar; pulls on start, foreground
 * (throttled), connectivity regain and syncNow. Emits calendar:synced. Never pushes 'remote',
 * 'imported' or calendar-origin changes (loop prevention). Failed pushes are retried later from
 * the calendar state in mg:{uid}:calendar.google.
 */
export interface CalendarSyncEngine {
  start(uid: string): void;
  stop(): void;
  syncNow(options?: { reason?: CalendarSyncReason; headless?: boolean }): Promise<CalendarSyncReport>;
  /** Handler attached to 'meetings:changed' while started (exposed for tests / explicit calls). */
  onMeetingChanged(event: MeetingsChangedEvent): void;
  getStatus(): CalendarStatus;
  subscribeStatus(listener: (status: CalendarStatus) => void): Unsubscribe;
}

// =============================================================================================
// ALERTS  (src/services/alerts, src/components/alerts, src/services/alerts/tasks.ts)
// =============================================================================================

/** JSON stored in notification content.data (all MeetingGuard notifications). */
export interface AlertNotificationData {
  v: 1;
  kind: NotificationKind;
  meetingId: string;
  /** Minutes before start ('alert'); null for followup/snooze. */
  offsetMinutes: number | null;
  intensity: AlertIntensity;
  /** Meeting start (UTC ISO) at scheduling time. */
  startAt: string;
  /** Deep link opened on tap (meetingDeepLink / assistantDeepLink). */
  url: string;
  /** Hash of fireAt + rendered content + language: reconcile reschedules when it changes. */
  hash: string;
  /**
   * Written by the alerts area (StoredAlertData) and optional for readers: the exact fire time
   * (iOS turns DATE triggers into intervals), and what AlertHost needs to render without the
   * data layer (headless / cold start).
   */
  fireAt?: string;
  title?: string;
  language?: Language;
  durationMinutes?: number;
}

/** One desired OS notification (output of the pure planner; text is rendered separately). */
export interface DesiredNotification {
  identifier: string;
  kind: 'alert' | 'followup';
  meetingId: string;
  offsetMinutes: number | null;
  /** UTC ISO fire time (> now). */
  fireAt: string;
  intensity: AlertIntensity;
  channelId: AndroidChannelId;
  categoryId: string;
}

export interface AlertPlan {
  /** Sorted by fireAt asc, at most `budget` items. */
  items: DesiredNotification[];
  /** true when eligible notifications were left out by the budget/horizon. */
  truncated: boolean;
  /** fireAt of the last included item when truncated (reconcile again before it); else null. */
  refillBefore: string | null;
}

export interface AlertPlanOptions {
  /** Max items (default ALERT_NOTIFICATION_BUDGET minus active snoozes). */
  budget?: number;
  /** Default ALERT_HORIZON_DAYS. */
  horizonDays?: number;
}

/**
 * PURE planner (unit-tested, no Expo imports):
 * - prefs.alertEnabled false => empty plan (master switch; also no follow-ups).
 * - Eligible: deletedAt null, status 'scheduled', allDay false, fireAt > now, fireAt <= now + horizon.
 * - Alert offsets: meeting.customAlertTimes ?? prefs.defaultAlertTimes (deduped).
 * - Intensity: meeting.alertIntensity ?? prefs.alertIntensity; channel = channelForIntensity.
 * - Follow-up (prefs.followUpEnabled): fireAt = end + FOLLOW_UP_DELAY_MINUTES, channel followup.
 * - Ids: alertNotificationId / followUpNotificationId; sort by fireAt asc; cut at budget.
 */
export type ComputeAlertPlan = (
  meetings: readonly Meeting[],
  preferences: Preferences,
  now: Date,
  options?: AlertPlanOptions,
) => AlertPlan;

export interface AlertPermissionStatus {
  notifications: 'granted' | 'denied' | 'undetermined' | 'provisional';
  canAskAgain: boolean;
  /**
   * Android 12+: exact alarms are user-granted and there is no JS API to read the state, so this is
   * 'unknown' there (offer openExactAlarmSettings). 'not_required' on iOS / Android < 12.
   */
  exactAlarms: 'not_required' | 'unknown';
}

export type ReconcileReason =
  | 'app_start'
  | 'session_started'
  | 'meetings_changed'
  | 'preferences_changed'
  | 'language_changed'
  | 'foreground'
  | 'background'
  | 'snooze'
  | 'permission_changed'
  | 'manual';

export interface ReconcileResult {
  scheduled: number;
  cancelled: number;
  kept: number;
  truncated: boolean;
  /** Set when nothing could be scheduled. */
  skipped: 'no_session' | 'alerts_disabled' | 'no_permission' | null;
}

export interface ScheduledAlertInfo {
  identifier: string;
  meetingId: string;
  kind: NotificationKind;
  offsetMinutes: number | null;
  fireAt: string;
  intensity: AlertIntensity;
}

/** An alert currently shown by AlertHost. */
export interface ActiveAlert {
  /** Notification identifier (or the same id for in-app timer alerts). */
  key: string;
  meetingId: string;
  kind: NotificationKind;
  intensity: AlertIntensity;
  offsetMinutes: number | null;
  /** Resolved from the repository/cache; null if the meeting no longer exists. */
  meeting: Meeting | null;
  firedAt: string;
}

export interface AlertEngineStatus {
  initialized: boolean;
  permission: AlertPermissionStatus | null;
  pendingCount: number;
  nextAlertAt: string | null;
  lastReconcileAt: string | null;
  lastReconcileError: AppErrorCode | null;
}

/**
 * OS notifications are the source of truth. Every public method lazily runs init() first.
 * - init(): notification handler, Android channels (before any permission prompt), localized
 *   categories, received/response listeners, AppState foreground reconcile. Idempotent.
 * - reconcile(): serialized + debounced diff of getAllScheduledNotificationsAsync() vs
 *   computeAlertPlan() (never cancel-all-then-refill); keeps valid snoozes; cancels stale mg:* ids.
 * - Listens to meetings:changed / preferences:changed / language:changed while a session is active.
 * - In-app: foreground received notifications and an in-app timer push ActiveAlerts to AlertHost
 *   (MAX full-screen, MEDIUM banner, LIGHT toast); de-duplicated by identifier.
 */
export interface AlertEngine {
  init(): Promise<void>;
  requestPermissions(): Promise<AlertPermissionStatus>;
  getPermissionStatus(): Promise<AlertPermissionStatus>;
  /** Android 12+: IntentLauncher ActivityAction.REQUEST_SCHEDULE_EXACT_ALARM; no-op elsewhere. */
  openExactAlarmSettings(): Promise<void>;
  openNotificationSettings(): Promise<void>;
  startSession(uid: string): Promise<void>;
  endSession(): Promise<void>;
  reconcile(reason: ReconcileReason): Promise<ReconcileResult>;
  /** Cancels every pending mg:* notification and dismisses presented ones. */
  cancelAll(): Promise<void>;
  /** Schedules snoozeNotificationId(meetingId) in `minutes` (default prefs.snoozeMinutes). Headless-safe. */
  snooze(meetingId: string, minutes?: number): Promise<void>;
  getStatus(): Promise<AlertEngineStatus>;
  getScheduled(): Promise<ScheduledAlertInfo[]>;
  /** AlertHost state. Listener is called immediately with the current list. */
  subscribeActiveAlerts(listener: (alerts: ActiveAlert[]) => void): Unsubscribe;
  /**
   * User handled an ActiveAlert (records it as acknowledged so it never re-fires). The alerts
   * engine also accepts `{ snoozeMinutes }` as a third argument and exposes subscribeStatus,
   * getSnoozeChoices, getActiveAlerts, handleNotificationResponse and installPresentationHandler
   * (src/services/alerts/engineCore.ts).
   */
  resolveActiveAlert(key: string, action: 'acknowledge' | 'snooze' | 'open'): Promise<void>;
}

export interface UsePendingAlertsResult {
  pending: ScheduledAlertInfo[];
  next: ScheduledAlertInfo | null;
  permission: AlertPermissionStatus | null;
  isLoading: boolean;
  refresh(): Promise<void>;
}

/** src/services/alerts/tasks.ts */
export interface BackgroundTasksModule {
  /** Registers BACKGROUND_TASKS.refresh (expo-background-task) and the notification response task. Idempotent. */
  registerBackgroundTasks(): Promise<void>;
  unregisterBackgroundTasks(): Promise<void>;
}

// =============================================================================================
// I18N + FORMAT + NAVIGATION  (src/i18n, src/utils/format.ts, src/navigation)
// =============================================================================================

/** Namespaces; each area owns src/i18n/locales/{en,es}/<ns>.json. */
export const I18N_NAMESPACE_LIST = ['common', 'navigation', 'onboarding', 'data', 'auth', 'calendar', 'alerts', 'ai'] as const;
export type I18nNamespace = (typeof I18N_NAMESPACE_LIST)[number];

/**
 * Translate. KEYS ARE ALWAYS NAMESPACE-QUALIFIED: t('alerts:max.title', { minutes: 5 }).
 * Unqualified keys are not allowed in new code: the legacy translations test
 * (src/components/__tests__/translations.test.js) treats any dotted key without a namespace as a
 * translations.jsx key and fails when it is missing there.
 */
export type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

export interface I18nApi {
  /** Initializes i18next once (bundled resources, device language), then applies the persisted language. */
  initI18n(): Promise<void>;
  /** Usable outside React (headless notification text). */
  t: TranslateFn;
  getLanguage(): Language;
  /** Changes language instantly, persists GLOBAL_STORAGE_KEYS.language, emits language:changed. */
  setLanguage(language: Language, options?: { source?: 'user' | 'preferences' | 'device' }): Promise<void>;
}

export interface UseLanguageResult {
  language: Language;
  setLanguage(language: Language): Promise<void>;
  supportedLanguages: readonly Language[];
}

export type DateValue = Date | string | number;

export interface FormatOptions {
  /** Default: current UI language. */
  language?: Language;
  /** Default: device zone. */
  timeZone?: string;
  /** null/undefined = locale/device default (Preferences.use24HourClock). */
  use24Hour?: boolean | null;
}

export interface FormatApi {
  formatDate(value: DateValue, style?: 'short' | 'medium' | 'long' | 'full', options?: FormatOptions): string;
  formatTime(value: DateValue, options?: FormatOptions): string;
  formatDateTime(value: DateValue, options?: FormatOptions): string;
  /** "in 5 minutes" / "en 5 minutos", "yesterday" / "ayer". */
  formatRelative(value: DateValue, options?: FormatOptions & { now?: Date }): string;
  /** 90 => "1 h 30 min". */
  formatDuration(minutes: number, options?: FormatOptions): string;
  /** "Mon, Oct 5 · 3:00 – 4:00 PM" (all-day aware). */
  formatMeetingTimeRange(
    meeting: Pick<Meeting, 'startAt' | 'durationMinutes' | 'allDay' | 'date'>,
    options?: FormatOptions & { now?: Date },
  ): string;
  /** preference (Preferences.use24HourClock) > device setting > language default (en 12 h, es 24 h). */
  uses24HourClock(options?: { preference?: boolean | null; language?: Language }): boolean;
}

/** Route names and params (single root stack; groups switch on session/onboarding state). */
export type AuthStackParamList = {
  Landing: undefined;
  Privacy: undefined;
  Terms: undefined;
};

export type OnboardingStackParamList = {
  OnboardingLanguage: undefined;
  OnboardingCalendars: undefined;
  OnboardingAlerts: undefined;
  OnboardingAssistant: undefined;
  OnboardingFirstMeeting: undefined;
};

export type MainStackParamList = {
  Dashboard: undefined;
  ChooseCreationMethod: undefined;
  CreateMeeting: { meetingId?: string } | undefined;
  TotalMeetings: undefined;
  /** Deep link meeting/:meetingId gives meetingId; legacy screens pass `meeting`. */
  MeetingDetails: { meetingId?: string; meeting?: LegacyMeetingView };
  EditMeeting: { meetingId?: string; meeting?: LegacyMeetingView };
  Calendar: undefined;
  Notes: undefined;
  Settings: undefined;
  Profile: undefined;
  /** Deep link assistant?followup=<meetingId>. */
  AIChat: { followup?: string; prefill?: string } | undefined;
  AIInsights: undefined;
  Privacy: undefined;
  Terms: undefined;
  WhatsAppBot: undefined;
  CalendarSync: undefined;
  Pricing: undefined;
};

export type RootStackParamList = AuthStackParamList & OnboardingStackParamList & MainStackParamList;
export type RouteName = keyof RootStackParamList;

export interface NavigationApi {
  /** Navigates once the container is ready (queued before onReady / while signed out). */
  navigate<Name extends RouteName>(name: Name, params?: RootStackParamList[Name]): void;
  /** Routes a meetingguardai:// URL (notification data.url). false if unknown. */
  openDeepLink(url: string): boolean;
  isReady(): boolean;
}

// =============================================================================================
// AI  (src/services/ai)
// =============================================================================================

export interface AssistantClient {
  /**
   * httpsCallable(functions, CALLABLES.assistant, { timeout: ASSISTANT_CALL_TIMEOUT_MS }) in the
   * env region. Validates request + response with the zod schemas. Throws AppError with code
   * quota_exceeded | unauthenticated | invalid_input | upstream_error | offline | timeout |
   * not_configured (Firebase env missing) and details.usage for quota errors (read
   * HttpsError.details.reason first).
   * The ai area extends ActionPreview / ActionResult / UseAssistantResult with optional members
   * (src/services/ai/types.ts: overlapping, calendarConnected, skippedMeetingIds, meetLinkError,
   * recipients, confirmAll, canRetry, pendingActionIds, followUpInFlight).
   */
  send(request: AssistantRequest): Promise<AssistantResponse>;
}

export type ActionWarning =
  | 'meeting_not_found'
  | 'start_in_past'
  | 'overlaps_existing'
  | 'google_meet_needs_calendar'
  | 'no_recipients';

export interface ActionPreview {
  action: AiAction;
  /** Referenced meetings that exist (for the confirmation card). */
  meetings: Meeting[];
  missingMeetingIds: string[];
  warnings: ActionWarning[];
}

export type ActionResult =
  | {
      status: 'done';
      actionId: string;
      type: AiActionType;
      meetingIds: string[];
      /** true when this action id had already been executed (idempotent no-op). */
      duplicate: boolean;
      /** share_meeting: how it was actually delivered (never claimed otherwise). */
      delivery?: 'google_invite' | 'mail_composer' | 'system_share';
      /** create/update with google_meet and no url: whether a real Meet link was created. */
      meetLinkCreated?: boolean;
    }
  | { status: 'failed'; actionId: string; type: AiActionType; error: AppError };

/**
 * Executes CONFIRMED actions through meetingRepository (origin 'ai'), googleCalendarService
 * (Meet links, invites) and the OS share sheet / mail composer. Idempotent per action.id
 * (mg:{uid}:assistant.executed; create uses WriteOptions.id derived from the action id).
 */
export interface ActionExecutor {
  preview(action: AiAction): Promise<ActionPreview>;
  execute(action: AiAction): Promise<ActionResult>;
}

export interface AssistantChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  /** Ids of proposed actions attached to this assistant message. */
  actionIds: string[];
  suggestions: string[];
}

export interface ProposedActionState {
  action: AiAction;
  status: 'proposed' | 'executing' | 'done' | 'failed' | 'rejected';
  preview: ActionPreview | null;
  result: ActionResult | null;
}

export interface UseAssistantOptions {
  /** Starts a follow-up conversation for this meeting (mode 'followup'). */
  followUpMeetingId?: string | null;
}

export interface UseAssistantResult {
  messages: AssistantChatMessage[];
  actions: Record<string, ProposedActionState>;
  isSending: boolean;
  error: AppError | null;
  usage: AssistantUsage | null;
  send(text: string): Promise<void>;
  confirm(actionId: string): Promise<ActionResult>;
  reject(actionId: string): void;
  /** Re-sends the last failed request. */
  retry(): Promise<void>;
  /** Clears the persisted thread. */
  reset(): Promise<void>;
}

// =============================================================================================
// FUNCTIONS
// =============================================================================================

/** Callables (region = env.functionsRegion = EXPO_PUBLIC_FUNCTIONS_REGION, default us-central1). */
export const FUNCTIONS_CONTRACT: Readonly<Record<CallableName, { request: string; response: string }>> = {
  assistant: { request: 'assistantRequestSchema', response: 'assistantResponseSchema' },
  deleteAccount: { request: 'deleteAccountRequestSchema', response: 'deleteAccountResponseSchema' },
};

// =============================================================================================
// APP COMPOSITION
// =============================================================================================

/**
 * index.js import order (first lines):
 *   'react-native-gesture-handler' -> 'intl-pluralrules' -> './src/services/sentry'
 *   -> './src/i18n' (sync init) -> './src/services/alerts/tasks' (defineTask + notification
 *   handler at module scope) -> registerRootComponent(App)
 *
 * App.js provider order (outermost first), after the NotConfiguredScreen gate:
 *   ErrorBoundary > SafeAreaProvider > I18nProvider > ThemeProvider > PaperProvider
 *   > AuthProvider (sessionManager.init) > DataProvider
 *   > NavigationContainer(ref=navigationRef, linking) { RootNavigator, AlertHost } + Toast
 * App root effect: void alertEngine.init().
 */
export const PROVIDER_ORDER = [
  'ErrorBoundary',
  'SafeAreaProvider',
  'I18nProvider',
  'ThemeProvider',
  'PaperProvider',
  'AuthProvider',
  'DataProvider',
  'NavigationContainer',
] as const;

export type ProviderComponent<P = { children?: ReactNode }> = ComponentType<P>;
/** AlertHost takes no props. */
export type AlertHostComponent = ComponentType<Record<string, never>>;
export type ShareDelivery = NonNullable<Extract<ActionResult, { status: 'done' }>['delivery']>;
