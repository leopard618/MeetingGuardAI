/**
 * NAVIGATION public API (owner: i18n-nav). Layer L7.
 *
 * - One root stack whose screen group follows the app gate (./gate): splash; signed out -> Auth
 *   (Landing, Privacy, Terms); signed in && preferences loaded && !onboardingCompleted ->
 *   Onboarding (5 steps); otherwise -> Main. Screen components are MODULE-LEVEL (./screens).
 * - Every screen is TypeScript and reads the live language itself (useT / useLanguage).
 * - MeetingDetails/EditMeeting read the live meeting from `meetingId` (deep link or in-app).
 * - navigate()/openDeepLink() queue intents until the target route is mounted; `linking` routes
 *   meetingguardai:// URLs and notification taps (DEFAULT | mg-open | mg-assistant) through them.
 */
export {
  clearPendingNavigation,
  flushPendingNavigation,
  getPendingNavigation,
  intentForDeepLink,
  isNavigationReady,
  isRouteMounted,
  navigate,
  navigateToTopLevel,
  navigationRef,
  onNavigationReady,
  openDeepLink,
  useCurrentRouteName,
  type NavigationIntent,
} from './navigationService';
export { handleNotificationResponse, linking, urlForNotificationResponse } from './linking';
export { RootNavigator, useAppGate } from './RootNavigator';
export { computeGate, type AppGate, type GateInput } from './gate';
export {
  ONBOARDING_STEPS,
  ROUTES,
  isOnboardingStep,
  nextOnboardingStep,
  previousOnboardingStep,
  type OnboardingStep,
} from './routes';
