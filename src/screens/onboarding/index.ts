/**
 * Onboarding screens (owner: i18n-nav). Layer L7.
 *
 * Steps (route names in OnboardingStackParamList, order in src/navigation/routes ONBOARDING_STEPS):
 *   1 OnboardingLanguage      EN/ES (setLanguage, instant) + Terms/Privacy consent
 *   2 OnboardingCalendars     Google (googleCalendarService.connect) + device calendars
 *                             (deviceCalendarService.requestPermission/listCalendars -> prefs.deviceCalendarImportIds)
 *   3 OnboardingAlerts        intensity (+ preview), sound type, volume, vibration, default alert times;
 *                             alertEngine.requestPermissions(); Android 12+: openExactAlarmSettings()
 *   4 OnboardingAssistant     AI intro (capabilities, EN/ES examples, daily quota by plan, privacy)
 *   5 OnboardingFirstMeeting  manual form / AI assistant / skip -> prefs.onboardingCompleted = true
 * Steps are resumable (mg:{uid}:onboarding.step); calendars can be skipped; completion is the only gate.
 */
export { OnboardingLanguageScreen } from './OnboardingLanguageScreen';
export { OnboardingCalendarsScreen } from './OnboardingCalendarsScreen';
export { OnboardingAlertsScreen } from './OnboardingAlertsScreen';
export { OnboardingAssistantScreen } from './OnboardingAssistantScreen';
export { OnboardingFirstMeetingScreen } from './OnboardingFirstMeetingScreen';
export {
  clearOnboardingStep,
  loadOnboardingStep,
  onboardingStepKey,
  saveOnboardingStep,
  useOnboardingResume,
  type OnboardingResume,
} from './progress';
