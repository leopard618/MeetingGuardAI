/** Route names (single root stack whose screen groups switch with the app gate). */
import type { AuthStackParamList, MainStackParamList, OnboardingStackParamList, RouteName } from '../core/contracts';

/** Route names (keep in sync with RootStackParamList). */
export const ROUTES = {
  Landing: 'Landing',
  EmailAuth: 'EmailAuth',
  Privacy: 'Privacy',
  Terms: 'Terms',
  OnboardingLanguage: 'OnboardingLanguage',
  OnboardingCalendars: 'OnboardingCalendars',
  OnboardingAlerts: 'OnboardingAlerts',
  OnboardingAssistant: 'OnboardingAssistant',
  OnboardingFirstMeeting: 'OnboardingFirstMeeting',
  Dashboard: 'Dashboard',
  ChooseCreationMethod: 'ChooseCreationMethod',
  CreateMeeting: 'CreateMeeting',
  TotalMeetings: 'TotalMeetings',
  MeetingDetails: 'MeetingDetails',
  EditMeeting: 'EditMeeting',
  Calendar: 'Calendar',
  Notes: 'Notes',
  Tasks: 'Tasks',
  Settings: 'Settings',
  AlertSettings: 'AlertSettings',
  Profile: 'Profile',
  AIChat: 'AIChat',
  AIInsights: 'AIInsights',
  CalendarSync: 'CalendarSync',
  Pricing: 'Pricing',
  WhatsAppConnect: 'WhatsAppConnect',
  // M10: meeting summaries by email.
  SummaryConnect: 'SummaryConnect',
  SummaryInbox: 'SummaryInbox',
  SummaryView: 'SummaryView',
} as const satisfies { [K in RouteName]: K };

export const AUTH_ROUTES = ['Landing', 'EmailAuth', 'Privacy', 'Terms'] as const satisfies readonly (keyof AuthStackParamList)[];

/** Onboarding steps in order (progress indicator, next/previous, resume). */
export const ONBOARDING_STEPS = [
  'OnboardingLanguage',
  'OnboardingCalendars',
  'OnboardingAlerts',
  'OnboardingAssistant',
  'OnboardingFirstMeeting',
] as const satisfies readonly (keyof OnboardingStackParamList)[];
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const MAIN_INITIAL_ROUTE = 'Dashboard' satisfies keyof MainStackParamList;

export function isOnboardingStep(value: unknown): value is OnboardingStep {
  return typeof value === 'string' && (ONBOARDING_STEPS as readonly string[]).includes(value);
}

export function onboardingStepIndex(step: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(step);
}

export function nextOnboardingStep(step: OnboardingStep): OnboardingStep | null {
  return ONBOARDING_STEPS[onboardingStepIndex(step) + 1] ?? null;
}

export function previousOnboardingStep(step: OnboardingStep): OnboardingStep | null {
  const index = onboardingStepIndex(step);
  return index > 0 ? (ONBOARDING_STEPS[index - 1] ?? null) : null;
}
