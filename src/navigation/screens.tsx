/**
 * MODULE-LEVEL screen components for the root stack. Nothing here is created during render, so a
 * navigation, sidebar or language change never remounts a screen (fixes the old remount storm).
 *
 * - Legacy stage-3 screens get the live `language` prop through withLanguage().
 * - TypeScript screens (src/screens): meeting details and the create / edit form (they read the
 *   live meeting from `meetingId` or a legacy `meeting` param), settings (account deletion) and
 *   alert settings.
 * - Landing gets the Terms/Privacy consent notice and a language switch (before sign-in).
 * - Privacy / Terms outside the Main group (no header there) get the top safe-area inset.
 */
import type { ComponentType, ReactElement } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text, useTheme as usePaperTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useLanguage, useT } from '../i18n';
import AIChat from '../pages/AIChat';
import { AIInsightsScreen as AIInsights } from '../screens/insights/AIInsightsScreen';
import { CalendarScreen as CalendarView } from '../screens/calendar/CalendarScreen';
import CalendarSync from '../pages/CalendarSync';
import { ChooseCreationMethodScreen as ChooseCreationMethod } from '../screens/create/ChooseCreationMethodScreen';
import { DashboardScreen as Dashboard } from '../screens/home/DashboardScreen';
import LegacyLandingPage from '../pages/LandingPage';
import Notes from '../pages/Notes';
import Pricing from '../pages/Pricing';
import Privacy from '../pages/Privacy';
import Terms from '../pages/Terms';
import { MeetingsListScreen as MeetingsList } from '../screens/meetings/list/MeetingsListScreen';
import { AlertSettingsScreen as AlertSettings } from '../screens/alerts/AlertSettingsScreen';
import { MeetingDetailsScreen as MeetingDetails } from '../screens/meetings/MeetingDetailsScreen';
import { MeetingFormScreen } from '../screens/meetings/MeetingFormScreen';
import { SettingsScreen as Settings } from '../screens/settings/SettingsScreen';
import { ConsentNotice } from './ConsentNotice';
import { withLanguage, type LegacyComponent, type WithLanguageProps } from './withLanguage';

// ---- Main group --------------------------------------------------------------------------------

export const DashboardScreen = Dashboard;
export const ChooseCreationMethodScreen = ChooseCreationMethod;
export const CreateMeetingScreen = MeetingFormScreen;
export const TotalMeetingsScreen = MeetingsList;
export const CalendarScreen = CalendarView;
export const NotesScreen = withLanguage(Notes);
export const SettingsScreen = Settings;
/** "Profile" shows the settings screen (account section first). */
export const ProfileScreen = Settings;
export const AlertSettingsScreen = AlertSettings;
export const AIChatScreen = withLanguage(AIChat);
export const AIInsightsScreen = AIInsights;
export const PrivacyScreen = withLanguage(Privacy);
export const TermsScreen = withLanguage(Terms);
export const CalendarSyncScreen = withLanguage(CalendarSync);
export const PricingScreen = withLanguage(Pricing);

// ---- Meetings (TypeScript): live meeting from `meetingId` or a legacy `meeting` param ----------

export const MeetingDetailsScreen = MeetingDetails;
export const EditMeetingScreen = MeetingFormScreen;

// ---- Auth group -----------------------------------------------------------------------------

const LandingPage = LegacyLandingPage as LegacyComponent;

function LandingFooter(): ReactElement {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { language, setLanguage, supportedLanguages } = useLanguage();
  return (
    <View style={[StyleSheet.absoluteFill, styles.landingOverlay]} pointerEvents="box-none">
      <View style={[styles.landingFooter, { marginBottom: insets.bottom + 12 }]}>
        <View style={styles.languageRow} accessibilityRole="radiogroup">
          {supportedLanguages.map((code) => {
            const selected = code === language;
            return (
              <TouchableOpacity
                key={code}
                onPress={() => {
                  void setLanguage(code);
                }}
                style={[styles.languageChip, selected && styles.languageChipSelected]}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
              >
                <Text style={[styles.languageChipText, selected && styles.languageChipTextSelected]}>
                  {t(`common:language.${code}`)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <ConsentNotice color="#F8FAFC" />
      </View>
    </View>
  );
}

export function LandingScreen(): ReactElement {
  return (
    <View style={styles.fill}>
      <LandingPage />
      <LandingFooter />
    </View>
  );
}

function withTopInset(Screen: ComponentType<WithLanguageProps>, name: string): ComponentType<WithLanguageProps> {
  function TopInsetScreen(props: WithLanguageProps): ReactElement {
    const insets = useSafeAreaInsets();
    const theme = usePaperTheme();
    return (
      <View style={[styles.fill, { paddingTop: insets.top, backgroundColor: theme.colors.background }]}>
        <Screen {...props} />
      </View>
    );
  }
  TopInsetScreen.displayName = `${name}Standalone`;
  return TopInsetScreen;
}

/** Privacy / Terms in the Auth and Onboarding groups (no Main header above them). */
export const StandalonePrivacyScreen = withTopInset(PrivacyScreen, 'Privacy');
export const StandaloneTermsScreen = withTopInset(TermsScreen, 'Terms');

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  landingOverlay: {
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  landingFooter: {
    marginHorizontal: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
    alignItems: 'center',
  },
  languageRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  languageChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(248, 250, 252, 0.6)',
    marginHorizontal: 4,
  },
  languageChipSelected: {
    backgroundColor: '#F8FAFC',
    borderColor: '#F8FAFC',
  },
  languageChipText: {
    color: '#F8FAFC',
    fontSize: 13,
  },
  languageChipTextSelected: {
    color: '#0F172A',
    fontWeight: '600',
  },
});
