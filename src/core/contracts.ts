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
 *                      src/components, src/contexts, src/screens, src/services/attachments
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
  Task,
  TaskInput,
  TaskPatch,
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
    // conferenceCapability, teamsLinkOnCreateOnly (video-call link modes, §22)
    conference: 'src/core/conference.ts',
  },
  data: {
    // dataService, meetingRepository, preferencesRepository, notesRepository, userRepository,
    // migrationService, DataProvider, useMeetings, useMeeting, usePreferences, useNotes,
    // useEntitlement, useSyncState
    index: 'src/services/data/index.ts',
    firebase: 'src/config/firebase.ts', // app, auth, db, functions, isFirebaseReady (nullable)
    // Pre-rebuild data readers (v1.0.9 local-data migration, old-shape Firestore documents).
    legacyInput: 'src/services/data/legacyInput.ts',
  },
  auth: {
    // authService only (L3) - calendar/ai/data-free code imports THIS path
    authService: 'src/services/auth/authService.ts',
    // Microsoft refresh-token storage for Outlook sync (expo-secure-store; L3, no session code)
    microsoftTokens: 'src/services/auth/microsoftTokens.ts',
    // authService, sessionManager, AuthProvider, useAuth (L6)
    index: 'src/services/auth/index.ts',
  },
  calendar: {
    // googleCalendarService, deviceCalendarService, outlookCalendarService, calendarSyncEngine,
    // useCalendarStatus
    index: 'src/services/calendar/index.ts',
    // outlookCalendarService implementation (Microsoft Graph; stub until the outlook pass lands)
    outlook: 'src/services/calendar/outlook/index.ts',
  },
  alerts: {
    // alertEngine, computeAlertPlan, usePendingAlerts
    index: 'src/services/alerts/index.ts',
    // side-effect module (TaskManager.defineTask at module scope) + registerBackgroundTasks,
    // unregisterBackgroundTasks. Imported by index.js BEFORE registerRootComponent.
    tasks: 'src/services/alerts/tasks.ts',
    // AlertHost (rendered once inside NavigationContainer)
    host: 'src/components/alerts/index.ts',
    // fullScreenAlarm: FullScreenAlarmModule glue over the local Expo module
    // modules/mg-fullscreen-alarm (Android full-screen-intent alarms; no-op stub elsewhere).
    fsi: 'src/services/alerts/fsi.ts',
  },
  i18n: {
    // i18n, initI18n, t, getLanguage, setLanguage, SUPPORTED_LANGUAGES, I18N_NAMESPACES,
    // I18nProvider, useT, useLanguage
    index: 'src/i18n/index.ts',
    format: 'src/utils/format.ts', // formatDate, formatTime, formatDateTime, formatRelative, formatDuration, formatMeetingTimeRange, uses24HourClock
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
  zoom: {
    // zoomService, useZoomStatus (server-created Zoom links via the zoom* callables, §24)
    index: 'src/services/zoom/index.ts',
  },
  whatsapp: {
    // whatsappService, useWhatsAppStatus (account link to the WhatsApp bot, §27)
    index: 'src/services/whatsapp/index.ts',
  },
  attachments: {
    // attachmentService, useMeetingAttachments (device-local files; metadata in the data layer)
    index: 'src/services/attachments/index.ts',
  },
  shell: {
    // ThemeProvider, useTheme, useAppThemes (Paper + navigation + status bar themes)
    theme: 'src/contexts/ThemeContext.tsx',
    // ErrorBoundary (outermost provider; reports through the logger)
    errorBoundary: 'src/components/ErrorBoundary.tsx',
  },
  widget: {
    // TS wrapper of the local Expo module "MgNextMeetingWidget" (Android home-screen widget, §19)
    module: 'modules/mg-next-meeting-widget/index.ts',
    // registerWidgetFeeder + the pure next-entry model (feeds the widget from app events)
    index: 'src/services/widget/index.ts',
  },
  billing: {
    // Plan catalog (PLANS, PURCHASES_AVAILABLE); §20
    catalog: 'src/services/billing.ts',
    // purchasesService (react-native-purchases behind EXPO_PUBLIC_REVENUECAT_ANDROID_KEY)
    purchases: 'src/services/purchases/index.ts',
  },
  functions: {
    entry: 'functions/src/index.ts', // exports: assistant, deleteAccount (+ revenuecatWebhook, admin callables when wired)
    contractCopy: 'functions/src/shared/aiContract.ts', // VERBATIM copy of src/core/aiContract.ts
    revenuecat: 'functions/src/revenuecat/index.ts', // RevenueCat webhook (entitlements writer, §20)
    admin: 'functions/src/admin/index.ts', // admin callables (custom claim "admin", §21)
    zoom: 'functions/src/zoom/index.ts', // zoomStatus + zoomCreateMeeting/zoomSyncMeeting/zoomDeleteMeeting (§24)
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

/** Calendar providers that import into the meeting store (write origin `calendar_<provider>`). */
export type CalendarProvider = 'google' | 'device' | 'outlook';

/** A calendar event to import, matched by provider + externalId. */
export interface ExternalMeetingUpsert {
  provider: CalendarProvider;
  /** Google event id / device event id / Graph event id. */
  externalId: string;
  calendarId: string;
  /** Google etag / Graph changeKey (null for device). */
  etag: string | null;
  /** Provider "updated" time (UTC ISO) for last-writer-wins; null when unknown. */
  providerUpdatedAt: string | null;
  /** true => the event was deleted/cancelled at the provider: tombstone the local meeting. */
  deleted: boolean;
  /** Required unless deleted. `source` is set by the repository (= the provider). */
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
  findByExternalId(provider: CalendarProvider, externalId: string): Promise<Meeting | null>;
  /** Sends pending writes now (also runs on reconnect / foreground / session start). */
  flushOutbox(): Promise<OutboxFlushResult>;
  /**
   * HEADLESS-SAFE: reads the per-user AsyncStorage cache only (no auth, no network). Active,
   * status 'scheduled' meetings whose end is after now, within `horizonDays` (default 14).
   */
  getCachedUpcoming(uid: string, options?: { horizonDays?: number; now?: Date }): Promise<Meeting[]>;
}

/**
 * Recurring-meeting edit scopes on top of MeetingRepository (implemented by `meetingRepository`
 * alongside the base interface; exported through the data barrel). Scope 'series' is the plain
 * update()/remove(). All three validate that the meeting is recurring and that `localDateKey`
 * is an occurrence of the series (AppError('invalid_input') / 'not_found' otherwise), and emit
 * `meetings:changed` like any other write.
 */
export interface MeetingRecurrenceOps {
  /** Writes a 'modified' override for one occurrence (v1 surface: startAt, durationMinutes, title). */
  updateOccurrence(
    id: string,
    localDateKey: string,
    patch: Pick<MeetingPatch, 'startAt' | 'durationMinutes' | 'title'>,
    options?: WriteOptions,
  ): Promise<Meeting>;
  /** Writes a 'cancelled' override ("delete this occurrence"). Idempotent. */
  cancelOccurrence(id: string, localDateKey: string, options?: WriteOptions): Promise<Meeting>;
  /** Removes an override (the occurrence returns to the series pattern). Idempotent. */
  restoreOccurrence(id: string, localDateKey: string, options?: WriteOptions): Promise<Meeting>;
  /**
   * "This and following" EDIT (scope v2, §16): splits the series at `fromDateKey` (an ORIGINAL
   * occurrence local date; core splitRecurrenceAt): the master is truncated (rule.until = 1 s
   * before the split occurrence's original start, count converted, overrides < split kept) and a
   * NEW meeting (new id = new seriesId, startAt = the split occurrence's original start, content
   * copied, overrides >= split moved over, remaining rule) is created with `patch` applied to it.
   * When `fromDateKey` is the FIRST occurrence this collapses to a plain series update
   * (`created` is null). Both writes emit `meetings:changed` and sync like any user edit: Google
   * receives the truncated RRULE (UNTIL) on the old event and a brand-new series event; Outlook
   * is untouched (recurring meetings are never pushed to Graph, §17).
   * Throws AppError('invalid_input') when the meeting is not recurring or `fromDateKey` is not
   * an original occurrence date (off-pattern or past the series end); 'not_found' when missing.
   */
  editFollowing(
    id: string,
    fromDateKey: string,
    patch: MeetingPatch,
    options?: WriteOptions,
  ): Promise<{ master: Meeting; created: Meeting | null }>;
  /**
   * "This and following" DELETE: truncates the master exactly like editFollowing but creates
   * nothing (the split occurrence and everything after it disappear; earlier occurrences and
   * their overrides stay). When `fromDateKey` is the FIRST occurrence this collapses to a plain
   * series remove() and resolves null. Same validation and sync behavior as editFollowing.
   */
  deleteFollowing(id: string, fromDateKey: string, options?: WriteOptions): Promise<Meeting | null>;
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

export interface TasksRepository {
  /** Sorted: open before done; open by due (earliest first, no due date last), done by completedAt desc. */
  list(): Promise<Task[]>;
  get(id: string): Promise<Task | null>;
  create(input: TaskInput): Promise<Task>;
  update(id: string, patch: TaskPatch): Promise<Task>;
  /** Hard delete. */
  remove(id: string): Promise<void>;
  subscribe(listener: (tasks: Task[]) => void): Unsubscribe;
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
  /**
   * Pauses the remote side of the active session (account deletion in progress): Firestore
   * listeners detached, no outbox sends. Local reads keep working. No-op without a session.
   */
  suspendRemote(): void;
  /** Undoes suspendRemote() (listeners re-attached, outbox flushed). */
  resumeRemote(): void;
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

export interface UseTasksResult {
  tasks: Task[];
  isLoading: boolean;
  error: AppError | null;
  create(input: TaskInput): Promise<Task>;
  update(id: string, patch: TaskPatch): Promise<Task>;
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
  /**
   * Sign in with Apple, iOS ONLY (docs/v1/ARCHITECTURE.md §26). expo-apple-authentication:
   * availability check (isAvailableAsync) -> nonce (a raw random string; its SHA-256 hash from
   * expo-crypto goes to Apple's request) -> signInAsync({ requestedScopes: FULL_NAME + EMAIL,
   * nonce: <hash> }) -> OAuthProvider('apple.com').credential({ idToken: identityToken,
   * rawNonce }) -> signInWithCredential. Apple returns fullName/email only on the FIRST
   * authorization: when the Firebase user has no displayName yet, it is saved via updateProfile
   * (best effort, like signUpWithEmail). The credential's authorizationCode is stashed for
   * revokeAppleTokens() only AFTER the Firebase exchange succeeded (a failed exchange may mean
   * the code belongs to a different Apple ID). A second call while the sheet is presenting
   * joins the running flow (like signInWithGoogle). Cancel resolves { status: 'cancelled' }
   * (never an alert); on Android,
   * in builds without the native module or when isAvailableAsync() is false it throws
   * AppError('unsupported', details.reason 'apple_sign_in_unavailable').
   */
  signInWithApple(): Promise<SignInResult>;
  /** Email/password sign-in (EmailAuthScreen, §25). Errors map via authErrors.ts. */
  signInWithEmail(email: string, password: string): Promise<AuthUser>;
  /**
   * Creates the account, saves the display name (best effort) and sends the verification email
   * NON-BLOCKING (the assistant requires a verified account; the app offers a resend). The user
   * is signed in afterwards even if name/verification sending failed.
   */
  signUpWithEmail(email: string, password: string, displayName: string): Promise<AuthUser>;
  sendPasswordReset(email: string): Promise<void>;
  /** Re-sends the verification email to the signed-in user. Throws AppError('unauthenticated') when nobody is signed in. */
  resendVerification(): Promise<void>;
  /**
   * Reloads the Firebase user (refreshes emailVerified after the user clicked the link), notifies
   * auth listeners (session state follows) and returns the fresh AuthUser.
   */
  reloadUser(): Promise<AuthUser>;
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
  /**
   * Revokes the Apple refresh token with the authorizationCode captured by the LAST validated
   * Apple interaction in this process (signInWithApple or the Apple branch of reauthenticate).
   * Sends the Identity Toolkit `accounts:revokeToken` request with tokenType AUTHORIZATION_CODE
   * - the same call the native iOS SDK's revokeToken(withAuthorizationCode:) makes. (The JS
   * SDK's `revokeAccessToken(auth, token)` is NOT used: it labels its argument an Apple access
   * token, and Apple answers 200 to unrecognized token strings, so it would "succeed" without
   * revoking.) Required before deleting an apple.com account (App Review 5.1.1(v);
   * docs/v1/ARCHITECTURE.md §26). The code is single-use and short-lived: call this right after
   * reauthenticate(). Throws AppError('unauthenticated', details.reason
   * 'requires_recent_login') when no fresh code is stashed; the delete flow treats ANY failure
   * as BEST EFFORT (notice toast, then the deletion proceeds).
   */
  revokeAppleTokens(): Promise<void>;
  /**
   * Calls the "deleteAccount" callable ({ confirm: true }). Local cleanup is the session manager's
   * job. The server requires a recent sign-in: call reauthenticate() right before; otherwise it
   * fails with AppError('unauthenticated', details.reason 'requires_recent_login').
   */
  deleteAccountOnServer(): Promise<void>;
  /**
   * Confirms the signed-in user again (fresh auth_time for sensitive operations). Provider order:
   * apple.com FIRST on iOS when the native module is usable (the Apple sheet; it also refreshes
   * the authorizationCode that revokeAppleTokens() needs - §26), then google.com (the account
   * picker, reauthenticateWithCredential), then password accounts with `password`. 'cancelled'
   * when the user dismissed the Apple sheet or the Google picker. A different Apple ID / Google
   * account fails with auth/user-mismatch (reason 'user_mismatch').
   */
  reauthenticate(options?: { password?: string }): Promise<'done' | 'cancelled'>;
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

/** Result of the sign-in actions of useAuth() (the Landing screen checks `success` / `cancelled`). */
export interface SignInActionResult {
  success: boolean;
  cancelled?: boolean;
  user?: AuthUser;
  /** Localized, user-presentable message. */
  error?: string;
}

/** useAuth() value (src/services/auth). */
export interface AuthContextValue {
  status: SessionStatus;
  /** true while initializing / starting / ending or while a sign-in call is running. */
  isLoading: boolean;
  isAuthenticated: boolean;
  authUser: AuthUser | null;
  /** Server-owned entitlement (read-only; effectivePlan() gives the plan). */
  entitlement: Entitlement;
  hasCalendarScope: boolean;
  signInWithGoogle(): Promise<SignInActionResult>;
  /** iOS only (§26): authService.signInWithApple() wrapped like signInWithGoogle (cancel is not an error). */
  signInWithApple(): Promise<SignInActionResult>;
  signInWithEmail(email: string, password: string): Promise<SignInActionResult>;
  signUpWithEmail(email: string, password: string, name: string): Promise<SignInActionResult>;
  /** Throws AppError('pending_writes') when unsynced writes exist and !force (see useSignOutFlow). */
  signOut(options?: { force?: boolean }): Promise<void>;
  requestCalendarScope(): Promise<boolean>;
  deleteAccount(): Promise<void>;
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
  provider: CalendarProvider;
  /** true when a full resync ran (first sync or syncToken/deltaLink expired / 410 Gone). */
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

// ---- Outlook (Microsoft Graph) ---------------------------------------------------------------

/**
 * Microsoft OAuth constants (PKCE via expo-auth-session against the v2.0 endpoints
 * `https://login.microsoftonline.com/{tenant}/v2.0`). The client id comes from the optional
 * EXPO_PUBLIC_MSAL_CLIENT_ID (absent => the whole Outlook UI is hidden); the tenant from
 * EXPO_PUBLIC_MSAL_TENANT (default 'common'). Redirect: MS_AUTH_REDIRECT_PATH in identifiers.ts.
 * The refresh token is stored ONLY in expo-secure-store (SECURE_STORE_KEYS.microsoftRefreshToken);
 * access tokens stay in memory.
 */
export const MICROSOFT_OAUTH = {
  defaultTenant: 'common',
  scopes: ['openid', 'profile', 'offline_access', 'User.Read', 'Calendars.ReadWrite'],
  authority: (tenant: string): string => `https://login.microsoftonline.com/${tenant}/v2.0`,
} as const;

export interface OutlookConnectResult {
  status: 'connected' | 'cancelled' | 'failed';
  initialSync: CalendarPullResult | null;
}

/**
 * Outlook calendar sync over Microsoft Graph (default calendar of the signed-in Microsoft
 * account, which is independent of the app's Google/Firebase identity).
 * - Push: POST /me/events with a client `transactionId` ("mgev-" + meeting.id, idempotent across
 *   retries), PATCH / DELETE /me/events/{id}; Teams links via `isOnlineMeeting: true` +
 *   `onlineMeetingProvider: "teamsForBusiness"` when the meeting has conference
 *   { provider: 'teams', url: null } (the returned joinUrl is stored as the conference url).
 *   External refs (outlook*) are written back with origin 'calendar_outlook' (loop prevention).
 * - Pull: GET /me/calendarView/delta over CALENDAR_SYNC_WINDOW with the persisted deltaLink
 *   (USER_STORAGE.outlookCalendar); HTTP 410 => full resync. `@removed` => deleted upsert.
 *   Results go to meetingRepository.upsertExternal (provider 'outlook').
 * - Auth: refresh-token flow; a 401 refreshes once, an invalid_grant surfaces
 *   AppError('calendar_not_connected') and flips the status to disconnected.
 * - Methods other than isConfigured throw AppError('calendar_not_connected') when not connected,
 *   and isConfigured() is false when EXPO_PUBLIC_MSAL_CLIENT_ID is absent.
 */
export interface OutlookCalendarService {
  /** EXPO_PUBLIC_MSAL_CLIENT_ID present (Outlook UI hidden otherwise). */
  isConfigured(): boolean;
  isConnected(): Promise<boolean>;
  /** PKCE browser flow -> token exchange -> store refresh token -> initial full pull + push. */
  connect(): Promise<OutlookConnectResult>;
  /**
   * Clears tokens + sync state, tombstones source 'outlook' meetings, clears external.outlook*
   * refs of other meetings. `revoke` opens the Microsoft account-consent page (Graph has no
   * programmatic revoke for user consent).
   */
  disconnect(options?: { revoke?: boolean }): Promise<void>;
  /** Insert or patch. Returns the meeting with updated external refs. */
  pushMeeting(meeting: Meeting): Promise<Meeting>;
  /** DELETE for a pushed meeting (no-op if it has no outlookEventId). */
  removeMeeting(meeting: Meeting): Promise<void>;
  pullChanges(options?: { full?: boolean }): Promise<CalendarPullResult>;
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
  /** Absent/null when Outlook is not configured or not connected. */
  outlook?: CalendarPullResult | null;
  errors: { provider: CalendarProvider; code: AppErrorCode }[];
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
  /** Absent until the Outlook provider is registered (EXPO_PUBLIC_MSAL_CLIENT_ID present). */
  outlook?: ProviderStatus & { configured: boolean; connected: boolean; accountEmail: string | null };
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
  /** Occurrence date key for recurring-meeting notifications (matches the identifier); absent for one-offs. */
  localDateKey?: string;
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
  /** Occurrence date key when the item belongs to one occurrence of a recurring meeting. */
  localDateKey?: string;
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
  /**
   * Set when the budget cut real ALERTS (not just follow-ups or the horizon): one budget slot is
   * reserved for the "open MeetingGuard to keep your alerts up to date" notification, which fires
   * at this instant (before the scheduled window runs out). null otherwise.
   */
  refillReminderAt: string | null;
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
 * - Intensity: meeting.alertIntensity ?? prefs.alertIntensity; channel = channelForIntensity
 *   (no-vibration variant when prefs.vibrationEnabled is false).
 * - Follow-up (prefs.followUpEnabled): fireAt = end + FOLLOW_UP_DELAY_MINUTES, channel followup.
 * - Ids: alertNotificationId / followUpNotificationId; sorted by fireAt asc.
 * - Budget: alerts first (earliest first); follow-ups only use the space alerts leave. When the
 *   alerts alone do not fit, one slot is reserved for the refill reminder (refillReminderAt).
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
  /** Occurrence date key for recurring-meeting entries. */
  localDateKey?: string;
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
  /** Android with the mg-fullscreen-alarm module available; absent/null elsewhere. */
  fullScreenAlarms?: FullScreenAlarmStatus | null;
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
  /**
   * Android 8+: the system settings page of the MAX alert channel, where the user can turn on
   * "Override Do Not Disturb" (an app cannot grant bypassDnd itself). iOS: the app's notification
   * settings (Focus allow-lists are set by the user in iOS Settings).
   */
  openAlarmChannelSettings(): Promise<void>;
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

// ---- Full-screen alarm module (modules/mg-fullscreen-alarm; Android only) --------------------

/** One native alarm; `id` IS the notification identifier (mg:*), so the reconcile diff extends to it. */
export interface FullScreenAlarmSpec {
  id: string;
  /** Fire time, epoch ms. */
  atMs: number;
  title: string;
  body: string;
  /** Opened by the full-screen intent / tap (meetingDeepLink). */
  deepLink: string;
  /** Existing alert channel id (channelForIntensity); the native notification posts on it. */
  channelId: string;
}

export interface FullScreenAlarmStatus {
  /** AlarmManager.canScheduleExactAlarms() (true below Android 12). */
  exactAllowed: boolean;
  /** NotificationManager.canUseFullScreenIntent() (true below Android 14). */
  fullScreenAllowed: boolean;
  /** POST_NOTIFICATIONS granted. */
  notificationsAllowed: boolean;
}

/**
 * TS surface of the local Expo module "mg-fullscreen-alarm" (glue: src/services/alerts/fsi.ts).
 * Android: AlarmManager setExactAndAllowWhileIdle -> BroadcastReceiver -> full-screen-intent
 * notification on the meeting's existing alert channel; pending alarms persist in
 * SharedPreferences and a BOOT_COMPLETED receiver restores them natively. iOS / module missing:
 * isAvailable() false and every method a safe no-op for the caller (the engine falls back to
 * expo-notifications, so an alert is never lost - and never double-scheduled: each identifier is
 * scheduled through exactly ONE path per reconcile).
 */
export interface FullScreenAlarmModule {
  /** Native module present and platform android. Synchronous so reconcile can branch cheaply. */
  isAvailable(): boolean;
  /** DECLARATIVE: replaces the whole pending set (alarms not in `alarms` are cancelled natively). */
  setAlarms(alarms: readonly FullScreenAlarmSpec[]): Promise<void>;
  /** Cancels the given ids, or every pending alarm when omitted (session end). */
  clearAlarms(ids?: readonly string[]): Promise<void>;
  getStatus(): Promise<FullScreenAlarmStatus>;
  /** Android 14+: ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT settings screen; no-op elsewhere. */
  openFullScreenIntentSettings(): Promise<void>;
}

/** src/services/alerts/tasks.ts */
export interface BackgroundTasksModule {
  /** Registers BACKGROUND_TASKS.refresh (expo-background-task) and the notification response task. Idempotent. */
  registerBackgroundTasks(): Promise<void>;
  unregisterBackgroundTasks(): Promise<void>;
}

// ---- Next-meeting home-screen widget (modules/mg-next-meeting-widget; Android only, §19) -----

/**
 * What the widget renders (all text PRE-LOCALIZED and PRE-FORMATTED by JS: the native side
 * never formats dates or translates - it draws strings). null = no upcoming meeting.
 */
export interface WidgetMeetingData {
  title: string;
  /** Start instant, epoch ms (native re-render boundary; not displayed). */
  startAtMs: number;
  /** e.g. "3:00 PM" / "15:00" (user's clock preference applied by JS). */
  timeText: string;
  /** e.g. "Today" / "Mon, Oct 5" (localized by JS). */
  dateText: string;
  /** Opened on tap (meetingDeepLink). The empty state opens the app's launch intent. */
  deepLink: string;
}

/**
 * Static widget strings, localized by JS (the app language, not the system locale) and persisted
 * natively next to the data. The module's own res/values(-es) strings are only the fallback for
 * a widget added before the app ever ran. Keys live in the 'widget' i18n namespace.
 */
export interface WidgetStrings {
  /** Card title of the empty state ("No upcoming meetings"). */
  emptyTitle: string;
  /** Second line of the empty state ("Open MeetingGuard to plan one"). */
  emptyBody: string;
  /** Shown once `startAtMs` has passed ("Happening now"). */
  nowLabel: string;
}

/**
 * TS surface of the local Expo module "MgNextMeetingWidget" (glue: src/services/widget).
 * Android: SharedPreferences hold the last data + strings; an AppWidgetProvider renders them
 * with RemoteViews; `setNextMeeting` triggers an immediate update of every widget instance and
 * (for non-null data) schedules ONE inexact AlarmManager broadcast at `startAtMs`, so the
 * provider re-renders with the `nowLabel` presentation without JS running; BOOT_COMPLETED
 * re-renders and re-schedules from SharedPreferences. On iOS / a binary without the module,
 * isAvailable() is false and every method is a safe no-op.
 */
export interface NextMeetingWidgetModule {
  /** Native module present and platform android. Synchronous so callers can branch cheaply. */
  isAvailable(): boolean;
  /**
   * true when at least one widget instance is on a home screen. Informational only: the feeder
   * always writes (a widget added later must render current data immediately).
   */
  hasWidgets(): Promise<boolean>;
  /** Replaces the stored data (null = empty state) and re-renders every widget instance. */
  setNextMeeting(data: WidgetMeetingData | null): Promise<void>;
  /** Replaces the stored localized strings and re-renders. Called at start and on language change. */
  setStrings(strings: WidgetStrings): Promise<void>;
  /** Clears data AND strings (sign-out; the widget falls back to its res-string empty state). */
  clear(): Promise<void>;
}

/**
 * JS feeder (src/services/widget). `registerWidgetFeeder()` is idempotent, subscribes once to
 * appEvents and is imported from index.js AFTER alerts/tasks (so headless background runs feed
 * the widget too):
 * - session:started / meetings:changed / calendar:synced -> recompute + setNextMeeting
 * - language:changed / preferences:changed (clock format) -> setStrings + re-feed
 * - session:ended -> clear()
 * The next entry comes from the pure model (computeNextWidgetEntry): active, status 'scheduled',
 * non-all-day meetings and expanded recurring occurrences within the next 7 days, earliest
 * effective start AFTER now - 5 min (a meeting that just started stays "next" briefly with the
 * nowLabel presentation handled natively). Headless-safe (getCachedUpcoming when no session).
 */
export interface WidgetFeeder {
  registerWidgetFeeder(): void;
  /** Recompute + push now (background task hook; no-op when the module is unavailable). */
  refreshWidget(): Promise<void>;
}

// =============================================================================================
// I18N + FORMAT + NAVIGATION  (src/i18n, src/utils/format.ts, src/navigation)
// =============================================================================================

/** Namespaces; each area owns src/i18n/locales/{en,es}/<ns>.json. */
export const I18N_NAMESPACE_LIST = [
  'common',
  'navigation',
  'onboarding',
  'data',
  'auth',
  'calendar',
  'alerts',
  'ai',
  'settings',
  'meetings',
  'calendarView',
  'create',
  'notes',
  'tasks',
  'attachments',
  'home',
  'insights',
  'shell',
  'landing',
  'legal',
  'pricing',
  'widget',
  'whatsapp',
] as const;
export type I18nNamespace = (typeof I18N_NAMESPACE_LIST)[number];

/**
 * Translate. KEYS ARE ALWAYS NAMESPACE-QUALIFIED: t('alerts:max.title', { minutes: 5 }).
 * src/i18n/__tests__/keysUsed.test.ts fails on unqualified keys and on keys missing in EN or ES.
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
  /** "Mon, Oct 5 · 3:00 - 4:00 PM" (all-day aware). */
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
  /** Email/password sign-in and account creation (§25); reached from Landing only. */
  EmailAuth: undefined;
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
  /** `date` ("YYYY-MM-DD", device zone) presets the day of a new meeting ("New meeting on <day>"). */
  CreateMeeting: { date?: string } | undefined;
  TotalMeetings: undefined;
  /** Also the deep link meeting/:meetingId. */
  MeetingDetails: { meetingId: string };
  EditMeeting: { meetingId: string };
  Calendar: undefined;
  Notes: undefined;
  /** First-class tasks (V2 Stage 1). */
  Tasks: undefined;
  Settings: undefined;
  /** Settings > Alerts: every alert preference after onboarding. */
  AlertSettings: undefined;
  Profile: undefined;
  /**
   * Deep link assistant?followup=<meetingId>. `autoStart` is set ONLY by the app's own follow-up
   * notification (never parsed from a URL): an external link opens the chat and offers a button,
   * so no paid request is sent without a user action.
   */
  AIChat: { followup?: string; prefill?: string; autoStart?: boolean } | undefined;
  AIInsights: undefined;
  Privacy: undefined;
  Terms: undefined;
  CalendarSync: undefined;
  Pricing: undefined;
  /** Settings > WhatsApp: link this account to the WhatsApp bot (§27). */
  WhatsAppConnect: undefined;
};

export type RootStackParamList = AuthStackParamList & OnboardingStackParamList & MainStackParamList;
export type RouteName = keyof RootStackParamList;

export interface NavigationApi {
  /** Navigates once the container is ready (queued before onReady / while signed out). */
  navigate<Name extends RouteName>(name: Name, params?: RootStackParamList[Name]): void;
  /**
   * Routes a meetingguardai:// URL. false if unknown. `fromNotification` is passed only for the
   * app's own notification responses (it lets the follow-up assistant start by itself).
   */
  openDeepLink(url: string, options?: { fromNotification?: boolean }): boolean;
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
  | 'no_recipients'
  /** Recipients / participants that are not on the meeting yet (listed on the card). */
  | 'new_people'
  /** v5: a referenced task no longer exists. */
  | 'task_not_found';

export interface ActionPreview {
  action: AiAction;
  /** Referenced meetings that exist (for the confirmation card). */
  meetings: Meeting[];
  missingMeetingIds: string[];
  /** v5 task actions: the referenced tasks that exist (for the confirmation card). */
  tasks?: Task[];
  missingTaskIds?: string[];
  warnings: ActionWarning[];
}

export type ActionResult =
  | {
      status: 'done';
      actionId: string;
      type: AiActionType;
      meetingIds: string[];
      /** v5 task actions: the tasks touched (meetingIds stays [] for them). */
      taskIds?: string[];
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
/**
 * v6: values the CALLER resolves for one execution, kept outside the action itself so the
 * action's content - and therefore its idempotency key - never changes between attempts.
 */
export interface ActionExecutionContext {
  /**
   * What a create_task draft's `meetingActionId` resolved to: the id of the meeting that sibling
   * create_meeting action produced, or null when it has not run or failed. Null means the task is
   * created without the link; it is never a reason to refuse the task.
   */
  linkedMeetingId?: string | null;
}

export interface ActionExecutor {
  preview(action: AiAction): Promise<ActionPreview>;
  execute(action: AiAction, context?: ActionExecutionContext): Promise<ActionResult>;
}

export interface AssistantChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  /** Ids of proposed actions attached to this assistant message. */
  actionIds: string[];
  suggestions: string[];
  /** User messages: 'suggestion' when sent by tapping a suggestion chip (model-written text). */
  origin?: 'typed' | 'suggestion';
}

export interface ProposedActionState {
  action: AiAction;
  status: 'proposed' | 'executing' | 'done' | 'failed' | 'rejected';
  preview: ActionPreview | null;
  result: ActionResult | null;
}

export interface UseAssistantOptions {
  /** The meeting a follow-up conversation is about (mode 'followup'). */
  followUpMeetingId?: string | null;
  /**
   * Start the follow-up request by itself (only when the app's own follow-up notification opened
   * the chat). Otherwise the screen offers a button (startFollowUp).
   */
  autoStartFollowUp?: boolean;
}

export interface UseAssistantResult {
  messages: AssistantChatMessage[];
  actions: Record<string, ProposedActionState>;
  isSending: boolean;
  error: AppError | null;
  usage: AssistantUsage | null;
  /** `origin: 'suggestion'` for text sent by tapping a suggestion chip. */
  send(text: string, options?: { origin?: 'typed' | 'suggestion' }): Promise<void>;
  /** Requests the post-meeting follow-up for a meeting (once per meeting). */
  startFollowUp(meetingId: string): Promise<void>;
  confirm(actionId: string): Promise<ActionResult>;
  reject(actionId: string): void;
  /** Re-sends the last failed request. */
  retry(): Promise<void>;
  /** Clears the persisted thread. */
  reset(): Promise<void>;
}

// =============================================================================================
// ZOOM  (src/services/zoom; server-created Zoom links, §24)
// =============================================================================================

/** What zoomCreateMeeting returned (the server already wrote the same values to the doc). */
export interface ZoomLinkResult {
  url: string;
  password: string | null;
  /** Zoom's numeric meeting id as a string (= external.zoomMeetingId). */
  zoomMeetingId: string;
}

/**
 * Server-created Zoom links through the zoom* callables (CALLABLES.zoom*, aiContract.ts; design
 * in docs/v1/ARCHITECTURE.md §24). The service is stateful per SESSION: the zoomStatus answer and
 * per-meeting failures are cached in memory and cleared on `session:ended` (never persisted).
 * All methods are safe while Firebase is unconfigured (isAvailable resolves false).
 */
export interface ZoomService {
  /**
   * Whether the server-side Zoom integration is configured (zoomStatus callable). The first call
   * per session hits the server; later calls return the cached answer. Never throws: a failed
   * status call resolves false and stays un-cached, so a later call retries.
   */
  isAvailable(): Promise<boolean>;
  /**
   * The cached zoomStatus answer, synchronously for render (conferenceCapability's
   * `calendar.zoom`): true/false once known this session, null before the first answer.
   */
  getKnownAvailability(): boolean | null;
  /**
   * Creates the Zoom meeting for a SAVED meeting (provider 'zoom', url null) via
   * zoomCreateMeeting; the server writes conference.url/password + external.zoomMeetingId to the
   * document (Admin SDK) and the snapshot listener brings them to the app. Idempotent: a meeting
   * that already has a zoomMeetingId resolves with the stored link. Pending local writes are
   * flushed first (the server loads the doc from Firestore). Throws AppError not_configured |
   * not_found | quota_exceeded | upstream_error | offline; failures are remembered for
   * linkFailure() until a later success.
   */
  ensureLink(meetingId: string): Promise<ZoomLinkResult>;
  /**
   * After an edit: when `patch` touched title/startAt/durationMinutes/timezone and the meeting
   * has an external.zoomMeetingId, patches the Zoom meeting via zoomSyncMeeting. Never throws
   * (best effort; logged - the join url itself never changes on a Zoom update).
   */
  syncIfNeeded(meeting: Meeting, patch: MeetingPatch): Promise<void>;
  /**
   * After a deletion (tombstone): deletes the Zoom meeting via zoomDeleteMeeting when the
   * meeting carries an external.zoomMeetingId. Never throws (best effort; logged).
   */
  onMeetingDeleted(meeting: Pick<Meeting, 'id' | 'external'>): Promise<void>;
  /**
   * Last ensureLink failure for this meeting THIS SESSION (the details card swaps
   * "waiting" for "could not be created" + Retry); null after a success or for unknown ids.
   */
  linkFailure(meetingId: string): AppErrorCode | null;
}

/** useZoomStatus() - live view of ZoomService availability for screens. */
export interface UseZoomStatusResult {
  /** null while unknown (first ask in flight or failed); the hook asks once on mount. */
  configured: boolean | null;
  /** Forces a re-ask of zoomStatus (rarely needed; the cache lives for the session). */
  refresh(): Promise<void>;
}

// =============================================================================================
// WHATSAPP  (src/services/whatsapp; account link to the WhatsApp bot, §27)
// =============================================================================================

/** whatsappLinkStart's answer. Shown once in the connect screen; never persisted or logged. */
export interface WhatsAppLinkCode {
  /** 6 digits, zero-padded; the user sends it to the bot number from WhatsApp. */
  code: string;
  /** ISO instant the code stops working (drives the countdown and the regenerate state). */
  expiresAtIso: string;
}

/**
 * whatsappLinkStatus's answer. `enabled` = the server-side integration is configured
 * (WHATSAPP_ENABLED); `linked` = THIS account already has a WhatsApp number attached.
 */
export interface WhatsAppLinkStatus {
  enabled: boolean;
  linked: boolean;
  /** The bot's human-readable number; null while the integration is not configured. */
  displayNumber: string | null;
  /** "https://wa.me/<digits>"; null while the integration is not configured. */
  deepLink: string | null;
  /** Last digits of the phone linked to THIS account (masked owner visibility); null while unlinked. */
  linkedLast4: string | null;
}

/**
 * Account link to the WhatsApp bot through the whatsapp* callables (§27). Stateful per SESSION
 * like ZoomService: the whatsappLinkStatus answer is cached in memory and cleared on
 * 'session:ended' (never persisted). Firebase-unconfigured builds resolve a disabled status.
 */
export interface WhatsAppService {
  /**
   * The link status (cached per session; the first call per session hits the server). Throws
   * AppError (offline | timeout | unauthenticated | upstream_error ...) when the ask fails;
   * a failure is never cached, so a later call retries.
   */
  getStatus(): Promise<WhatsAppLinkStatus>;
  /** The cached status synchronously for render; null before the first answer this session. */
  getKnownStatus(): WhatsAppLinkStatus | null;
  /**
   * Mints a 6-digit one-time code via whatsappLinkStart. Throws AppError not_configured |
   * unauthenticated | quota_exceeded (max codes per day; details.reason 'rate_limited') |
   * offline | timeout | upstream_error.
   */
  startLink(): Promise<WhatsAppLinkCode>;
  /**
   * Removes the link via whatsappUnlink and flips the cached status to linked: false.
   * Throws AppError on failure (same taxonomy as startLink).
   */
  unlink(): Promise<void>;
}

/** useWhatsAppStatus() - live view of the WhatsAppService status for screens. */
export interface UseWhatsAppStatusResult {
  /** null while unknown (first ask in flight or failed); the hook asks once on mount. */
  status: WhatsAppLinkStatus | null;
  /** Failure of the last ask (null while loading or after a success); refresh() retries. */
  error: AppError | null;
  /** Re-asks whatsappLinkStatus; the cached answer stays visible until the new one arrives. */
  refresh(): Promise<void>;
}

// =============================================================================================
// BILLING  (src/services/billing.ts catalog + src/services/purchases; §20)
// =============================================================================================

/** Paid tiers map 1:1 to RevenueCat entitlement ids ('pro', 'premium'). */
export type PaidPlanTier = Exclude<Plan, 'free'>;
export type BillingCycle = 'monthly' | 'yearly';

/** Google Play product (subscription) ids; RevenueCat packages reference exactly these. */
export const PLAY_PRODUCT_IDS: Readonly<Record<PaidPlanTier, Record<BillingCycle, string>>> = {
  pro: { monthly: 'pro_monthly', yearly: 'pro_yearly' },
  premium: { monthly: 'premium_monthly', yearly: 'premium_yearly' },
};

/**
 * App Store product (auto-renewable subscription) ids - the SAME logical ids as Google Play, on
 * purpose: one `PRODUCT_TO_PLAN` mapping serves both stores, the RevenueCat entitlements
 * ('pro'/'premium') attach each store's products to the same plan, and the webhook's
 * product-id fallback (`planFromEvent`) keeps working for APP_STORE events. All four live in ONE
 * App Store subscription group (upgrade/crossgrade semantics; docs/v1/SETUP.md §11). A guard test
 * asserts the two tables never drift apart.
 */
export const APP_STORE_PRODUCT_IDS: Readonly<Record<PaidPlanTier, Record<BillingCycle, string>>> = {
  pro: { monthly: 'pro_monthly', yearly: 'pro_yearly' },
  premium: { monthly: 'premium_monthly', yearly: 'premium_yearly' },
};

/** One purchasable package resolved from the current RevenueCat offering. */
export interface StorePackage {
  tier: PaidPlanTier;
  cycle: BillingCycle;
  /** Play product id (PLAY_PRODUCT_IDS). */
  productId: string;
  /** Localized price string straight from the store (e.g. "$7.99", "€7,99"). Never computed. */
  priceString: string;
  /** Localized per-period price of yearly packages ("$5.99/mo" equivalents are computed by UI from priceAmountMicros). */
  priceAmountMicros: number;
  currencyCode: string;
  /** Store-configured intro offer (the 3-day free trial) present on this package. */
  hasFreeTrial: boolean;
}

export interface StoreOffering {
  /** RevenueCat offering identifier (the "current" offering). */
  offeringId: string;
  packages: StorePackage[];
}

export type PurchaseOutcome =
  /** Store purchase went through; entitlements/{uid} is written by the WEBHOOK (seconds later). */
  | { status: 'purchased'; tier: PaidPlanTier; cycle: BillingCycle }
  | { status: 'cancelled' };

export type RestoreOutcome =
  | { status: 'restored'; tier: PaidPlanTier }
  | { status: 'nothing_to_restore' };

/**
 * The active catalog products split by store. RevenueCat aggregates CustomerInfo across stores
 * per app_user_id (that is what makes the shared 'pro'/'premium' entitlements work), so a
 * subscription bought on the OTHER platform's store shows up here too: it cannot be managed or
 * replaced from this device, and buying anything while it is active would open a SECOND,
 * parallel subscription. `sameStore` drives the purchased-card badge and Manage; a non-null
 * `otherStore` blocks all purchases on this device and the UI names the other store instead.
 * Products whose store cannot be determined count as same-store (the pre-split behavior).
 */
export interface ActiveStoreProducts {
  sameStore: string | null;
  otherStore: string | null;
}

/**
 * react-native-purchases behind the optional platform SDK key: EXPO_PUBLIC_REVENUECAT_ANDROID_KEY
 * on Android, EXPO_PUBLIC_REVENUECAT_APPLE_KEY on iOS. The RUNNING platform's key absent, or the
 * native module missing, or another platform => isConfigured() false and the Pricing screen
 * behaves exactly like today: catalog display + "subscriptions coming soon".
 *
 * THE CLIENT NEVER WRITES entitlements/{uid}. The RevenueCat webhook (functions/src/revenuecat)
 * is the only writer for purchases; the app keeps reading the entitlement through the existing
 * useEntitlement()/effectivePlan(). After 'purchased' the UI shows a processing state until the
 * entitlement listener flips (webhook latency is seconds).
 *
 * configure(uid) runs on session start (Purchases.configure({ apiKey, appUserID: uid })), so
 * `app_user_id` in webhook events IS the Firebase uid. logOut on session end is NOT called
 * (RevenueCat would create an anonymous user); the next session's configure/logIn switches user.
 */
export interface PurchasesService {
  isConfigured(): boolean;
  /** Idempotent per uid. Safe no-op when not configured. */
  configure(uid: string): Promise<void>;
  /** Current offering mapped to StoreOffering; AppError('not_configured') when unconfigured, 'offline'/'upstream_error' on store failures. */
  getOffering(): Promise<StoreOffering>;
  /**
   * Launches the store purchase flow for the tier+cycle package of the current offering.
   * When a DIFFERENT catalog product is already active (a tier upgrade, a tier downgrade or a
   * monthly<->yearly cycle switch), the purchase is a REPLACEMENT, never a second subscription:
   * on Android the Google product change (oldProductIdentifier + IMMEDIATE_WITH_TIME_PRORATION)
   * is passed so Play swaps the running subscription and credits unused time; on iOS all four
   * products share one subscription group, so StoreKit applies its own upgrade/crossgrade rules
   * (downgrades and some crossgrades start at the next renewal) and no product change is passed.
   * Both platforms read a FRESH CustomerInfo first (cache invalidated); an active subscription
   * from the OTHER store aborts with AppError('conflict') - the stores cannot replace across
   * each other, so proceeding would open a second, parallel subscription.
   */
  purchase(tier: PaidPlanTier, cycle: BillingCycle): Promise<PurchaseOutcome>;
  /** Purchases.restorePurchases(); the webhook (TRANSFER/INITIAL_PURCHASE) updates the entitlement. */
  restore(): Promise<RestoreOutcome>;
  /**
   * The ACTIVE catalog product id purchased on THIS platform's store (premium over pro when
   * both appear), or null when none is active or the store cannot answer (never throws): lets
   * the pricing UI mark the truly purchased (tier, cycle) card and deep-link "Manage
   * subscription". Equals getActiveProducts().sameStore.
   */
  getActiveProductId(): Promise<string | null>;
  /**
   * Active catalog products split by store (see ActiveStoreProducts). Best effort like
   * getActiveProductId: never throws; both null when unknown or the store cannot answer.
   */
  getActiveProducts(): Promise<ActiveStoreProducts>;
  /**
   * Store subscription management deep link for the active product: Google Play's subscriptions
   * page (?sku=&package= when the product is known) on Android; on iOS the generic
   * https://apps.apple.com/account/subscriptions page (productId is ignored there).
   */
  manageUrl(productId?: string): string;
  /**
   * iOS only (optional until the app-pay pass implements it): presents the native App Store
   * manage-subscriptions sheet (Purchases.showManageSubscriptions). Resolves true when the sheet
   * was shown; false on Android / unconfigured builds, where the caller falls back to
   * Linking.openURL(manageUrl(...)).
   */
  showManageSubscriptions?(): Promise<boolean>;
}

// =============================================================================================
// FUNCTIONS
// =============================================================================================

/** Callables (region = env.functionsRegion = EXPO_PUBLIC_FUNCTIONS_REGION, default us-central1). */
export const FUNCTIONS_CONTRACT: Readonly<Record<CallableName, { request: string; response: string }>> = {
  assistant: { request: 'assistantRequestSchema', response: 'assistantResponseSchema' },
  deleteAccount: { request: 'deleteAccountRequestSchema', response: 'deleteAccountResponseSchema' },
  zoomStatus: { request: 'zoomStatusRequestSchema', response: 'zoomStatusResponseSchema' },
  zoomCreateMeeting: { request: 'zoomCreateMeetingRequestSchema', response: 'zoomCreateMeetingResponseSchema' },
  zoomSyncMeeting: { request: 'zoomSyncMeetingRequestSchema', response: 'zoomSyncMeetingResponseSchema' },
  zoomDeleteMeeting: { request: 'zoomDeleteMeetingRequestSchema', response: 'zoomDeleteMeetingResponseSchema' },
  whatsappLinkStart: { request: 'whatsappLinkStartRequestSchema', response: 'whatsappLinkStartResponseSchema' },
  whatsappLinkStatus: { request: 'whatsappLinkStatusRequestSchema', response: 'whatsappLinkStatusResponseSchema' },
  whatsappUnlink: { request: 'whatsappUnlinkRequestSchema', response: 'whatsappUnlinkResponseSchema' },
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
