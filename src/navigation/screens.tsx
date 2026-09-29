/**
 * MODULE-LEVEL screen components for the root stack. Nothing here is created during render, so a
 * navigation, sidebar or language change never remounts a screen (fixes the old remount storm).
 *
 * - Every screen reads the live language itself (useT / useLanguage); withLanguage() is unused.
 * - TypeScript screens (src/screens): meeting details and the create / edit form (they read the
 *   live meeting from `meetingId` or a legacy `meeting` param), settings (account deletion) and
 *   alert settings.
 * - Landing (src/screens/auth) has the language switch and the Terms/Privacy consent itself.
 * - Privacy / Terms (src/screens/legal): outside the Main group (no header there) the standalone
 *   variants draw their own top bar.
 */
import { AssistantScreen } from '../screens/assistant/AssistantScreen';
import { AIInsightsScreen as AIInsights } from '../screens/insights/AIInsightsScreen';
import { CalendarScreen as CalendarView } from '../screens/calendar/CalendarScreen';
import { CalendarSyncScreen as CalendarSync } from '../screens/calendarSync/CalendarSyncScreen';
import { ChooseCreationMethodScreen as ChooseCreationMethod } from '../screens/create/ChooseCreationMethodScreen';
import { DashboardScreen as Dashboard } from '../screens/home/DashboardScreen';
import { MeetingsListScreen as MeetingsList } from '../screens/meetings/list/MeetingsListScreen';
import { AlertSettingsScreen as AlertSettings } from '../screens/alerts/AlertSettingsScreen';
import { LandingScreen as Landing } from '../screens/auth/LandingScreen';
import {
  PrivacyScreen as Privacy,
  StandalonePrivacyScreen as StandalonePrivacy,
  StandaloneTermsScreen as StandaloneTerms,
  TermsScreen as Terms,
} from '../screens/legal';
import { MeetingDetailsScreen as MeetingDetails } from '../screens/meetings/MeetingDetailsScreen';
import { MeetingFormScreen } from '../screens/meetings/MeetingFormScreen';
import { NotesScreen as NotesView } from '../screens/notes/NotesScreen';
import { PricingScreen as Pricing } from '../screens/pricing/PricingScreen';
import { SettingsScreen as Settings } from '../screens/settings/SettingsScreen';

// ---- Main group --------------------------------------------------------------------------------

export const DashboardScreen = Dashboard;
export const ChooseCreationMethodScreen = ChooseCreationMethod;
export const CreateMeetingScreen = MeetingFormScreen;
export const TotalMeetingsScreen = MeetingsList;
export const CalendarScreen = CalendarView;
export const NotesScreen = NotesView;
export const SettingsScreen = Settings;
/** "Profile" shows the settings screen (account section first). */
export const ProfileScreen = Settings;
export const AlertSettingsScreen = AlertSettings;
export const AIChatScreen = AssistantScreen;
export const AIInsightsScreen = AIInsights;
export const PrivacyScreen = Privacy;
export const TermsScreen = Terms;
export const CalendarSyncScreen = CalendarSync;
export const PricingScreen = Pricing;

// ---- Meetings (TypeScript): live meeting from `meetingId` or a legacy `meeting` param ----------

export const MeetingDetailsScreen = MeetingDetails;
export const EditMeetingScreen = MeetingFormScreen;

// ---- Auth group -----------------------------------------------------------------------------

export const LandingScreen = Landing;

/** Privacy / Terms in the Auth and Onboarding groups (no Main header above them). */
export const StandalonePrivacyScreen = StandalonePrivacy;
export const StandaloneTermsScreen = StandaloneTerms;
