/**
 * Compile-time conformance checks (TYPE-ONLY: erased at runtime, so core still has no runtime
 * dependency on services). `npx tsc --noEmit` fails if:
 *   - a public module stops exporting a promised name, or its type drifts from the contract;
 *   - a domain interface in types.ts drifts from its zod schema.
 * Implementers must keep these checks green; the architect/integrator owns this file.
 */
import type { ReactNode } from 'react';
import type { z } from 'zod';

import type * as AiModule from '../services/ai';
import type * as AlertsModule from '../services/alerts';
import type * as AlertTasksModule from '../services/alerts/tasks';
import type * as AuthModule from '../services/auth';
import type * as AuthServiceModule from '../services/auth/authService';
import type * as CalendarModule from '../services/calendar';
import type * as DataModule from '../services/data';
import type * as AlertUiModule from '../components/alerts';
import type * as I18nModule from '../i18n';
import type * as NavigationModule from '../navigation';
import type * as OnboardingModule from '../screens/onboarding';
import type * as FormatModule from '../utils/format';
import type * as ZoomModule from '../services/zoom';
import type {
  ActionExecutor,
  AlertEngine,
  AssistantClient,
  AuthContextValue,
  AuthService,
  BackgroundTasksModule,
  CalendarStatus,
  CalendarSyncEngine,
  ComputeAlertPlan,
  DataService,
  DeviceCalendarService,
  FormatApi,
  FullScreenAlarmModule,
  GoogleCalendarService,
  I18nApi,
  MeetingRange,
  MeetingRecurrenceOps,
  MeetingRepository,
  MigrationService,
  NavigationApi,
  NotesRepository,
  OutlookCalendarService,
  PreferencesRepository,
  SessionManager,
  SyncState,
  TranslateFn,
  UseAssistantOptions,
  UseAssistantResult,
  UseEntitlementResult,
  UseLanguageResult,
  UseMeetingResult,
  UseMeetingsResult,
  UseNotesResult,
  UsePendingAlertsResult,
  UsePreferencesResult,
  UserRepository,
  UseZoomStatusResult,
  ZoomService,
} from './contracts';
import type {
  Entitlement,
  Meeting,
  Note,
  Preferences,
  UserProfile,
  entitlementSchema,
  meetingSchema,
  noteSchema,
  preferencesSchema,
  userProfileSchema,
} from './types';

type Assert<T extends true> = T;
type Extends<A, B> = [A] extends [B] ? true : false;
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Component<P> = (props: P) => ReactNode;

// ---- domain interfaces == zod schemas ------------------------------------------------------
export type DomainSchemaConformance = [
  Assert<Equals<Meeting, z.infer<typeof meetingSchema>>>,
  Assert<Equals<Preferences, z.infer<typeof preferencesSchema>>>,
  Assert<Equals<UserProfile, z.infer<typeof userProfileSchema>>>,
  Assert<Equals<Entitlement, z.infer<typeof entitlementSchema>>>,
  Assert<Equals<Note, z.infer<typeof noteSchema>>>,
];

// ---- data ------------------------------------------------------------------------------------
export type DataConformance = [
  Assert<Extends<typeof DataModule.meetingRepository, MeetingRepository>>,
  Assert<Extends<typeof DataModule.meetingRepository, MeetingRecurrenceOps>>,
  Assert<Extends<typeof DataModule.preferencesRepository, PreferencesRepository>>,
  Assert<Extends<typeof DataModule.notesRepository, NotesRepository>>,
  Assert<Extends<typeof DataModule.userRepository, UserRepository>>,
  Assert<Extends<typeof DataModule.migrationService, MigrationService>>,
  Assert<Extends<typeof DataModule.dataService, DataService>>,
  Assert<Extends<typeof DataModule.DataProvider, Component<{ children?: ReactNode }>>>,
  Assert<Extends<typeof DataModule.useMeetings, (range?: MeetingRange) => UseMeetingsResult>>,
  Assert<Extends<typeof DataModule.useMeeting, (id: string | null | undefined) => UseMeetingResult>>,
  Assert<Extends<typeof DataModule.usePreferences, () => UsePreferencesResult>>,
  Assert<Extends<typeof DataModule.useNotes, () => UseNotesResult>>,
  Assert<Extends<typeof DataModule.useEntitlement, () => UseEntitlementResult>>,
  Assert<Extends<typeof DataModule.useSyncState, () => SyncState>>,
];

// ---- auth ------------------------------------------------------------------------------------
export type AuthConformance = [
  Assert<Extends<typeof AuthServiceModule.authService, AuthService>>,
  Assert<Extends<typeof AuthModule.authService, AuthService>>,
  Assert<Extends<typeof AuthModule.sessionManager, SessionManager>>,
  Assert<Extends<typeof AuthModule.AuthProvider, Component<{ children?: ReactNode }>>>,
  Assert<Extends<typeof AuthModule.useAuth, () => AuthContextValue>>,
];

// ---- calendar --------------------------------------------------------------------------------
export type CalendarConformance = [
  Assert<Extends<typeof CalendarModule.googleCalendarService, GoogleCalendarService>>,
  Assert<Extends<typeof CalendarModule.outlookCalendarService, OutlookCalendarService>>,
  Assert<Extends<typeof CalendarModule.deviceCalendarService, DeviceCalendarService>>,
  Assert<Extends<typeof CalendarModule.calendarSyncEngine, CalendarSyncEngine>>,
  Assert<Extends<typeof CalendarModule.useCalendarStatus, () => CalendarStatus>>,
];

// ---- alerts ----------------------------------------------------------------------------------
export type AlertsConformance = [
  Assert<Extends<typeof AlertsModule.alertEngine, AlertEngine>>,
  Assert<Extends<typeof AlertsModule.computeAlertPlan, ComputeAlertPlan>>,
  Assert<Extends<typeof AlertsModule.fullScreenAlarm, FullScreenAlarmModule>>,
  Assert<Extends<typeof AlertsModule.usePendingAlerts, () => UsePendingAlertsResult>>,
  Assert<Extends<typeof AlertTasksModule.registerBackgroundTasks, BackgroundTasksModule['registerBackgroundTasks']>>,
  Assert<Extends<typeof AlertTasksModule.unregisterBackgroundTasks, BackgroundTasksModule['unregisterBackgroundTasks']>>,
  Assert<Extends<typeof AlertUiModule.AlertHost, Component<Record<string, never>>>>,
];

// ---- i18n / format / navigation ----------------------------------------------------------------
export type I18nConformance = [
  Assert<Extends<typeof I18nModule.initI18n, I18nApi['initI18n']>>,
  Assert<Extends<typeof I18nModule.t, TranslateFn>>,
  Assert<Extends<typeof I18nModule.getLanguage, I18nApi['getLanguage']>>,
  Assert<Extends<typeof I18nModule.setLanguage, I18nApi['setLanguage']>>,
  Assert<Extends<typeof I18nModule.I18nProvider, Component<{ children?: ReactNode }>>>,
  Assert<Extends<typeof I18nModule.useT, () => TranslateFn>>,
  Assert<Extends<typeof I18nModule.useLanguage, () => UseLanguageResult>>,
  Assert<Extends<typeof FormatModule.formatDate, FormatApi['formatDate']>>,
  Assert<Extends<typeof FormatModule.formatTime, FormatApi['formatTime']>>,
  Assert<Extends<typeof FormatModule.formatDateTime, FormatApi['formatDateTime']>>,
  Assert<Extends<typeof FormatModule.formatRelative, FormatApi['formatRelative']>>,
  Assert<Extends<typeof FormatModule.formatDuration, FormatApi['formatDuration']>>,
  Assert<Extends<typeof FormatModule.formatMeetingTimeRange, FormatApi['formatMeetingTimeRange']>>,
  Assert<Extends<typeof FormatModule.uses24HourClock, FormatApi['uses24HourClock']>>,
  Assert<Extends<typeof NavigationModule.navigate, NavigationApi['navigate']>>,
  Assert<Extends<typeof NavigationModule.openDeepLink, NavigationApi['openDeepLink']>>,
  Assert<Extends<typeof NavigationModule.isNavigationReady, NavigationApi['isReady']>>,
  Assert<Extends<typeof NavigationModule.RootNavigator, Component<Record<string, never>>>>,
  Assert<Extends<typeof OnboardingModule.OnboardingLanguageScreen, Component<never>>>,
  Assert<Extends<typeof OnboardingModule.OnboardingCalendarsScreen, Component<never>>>,
  Assert<Extends<typeof OnboardingModule.OnboardingAlertsScreen, Component<never>>>,
  Assert<Extends<typeof OnboardingModule.OnboardingAssistantScreen, Component<never>>>,
  Assert<Extends<typeof OnboardingModule.OnboardingFirstMeetingScreen, Component<never>>>,
];

// ---- ai ----------------------------------------------------------------------------------------
export type AiConformance = [
  Assert<Extends<typeof AiModule.assistantClient, AssistantClient>>,
  Assert<Extends<typeof AiModule.actionExecutor, ActionExecutor>>,
  Assert<Extends<typeof AiModule.useAssistant, (options?: UseAssistantOptions) => UseAssistantResult>>,
];

// ---- zoom --------------------------------------------------------------------------------------
export type ZoomConformance = [
  Assert<Extends<typeof ZoomModule.zoomService, ZoomService>>,
  Assert<Extends<typeof ZoomModule.useZoomStatus, () => UseZoomStatusResult>>,
];
