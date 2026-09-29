/**
 * MODULE-LEVEL screen components for the root stack. Nothing here is created during render, so a
 * navigation, sidebar or language change never remounts a screen (fixes the old remount storm).
 *
 * - Legacy stage-3 screens get the live `language` prop through withLanguage().
 * - MeetingDetails / EditMeeting resolve a deep-link `meetingId` into the legacy `meeting` param
 *   (toLegacyMeetingView) because those screens read route.params.meeting.
 * - Landing gets the Terms/Privacy consent notice and a language switch (before sign-in).
 * - Privacy / Terms outside the Main group (no header there) get the top safe-area inset.
 */
import type { StackScreenProps } from '@react-navigation/stack';
import { useMemo, type ComponentType, type ReactElement } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { ActivityIndicator, Button, Text, useTheme as usePaperTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import ModernCreateMeeting from '../components/ModernCreateMeeting';
import type { RootStackParamList } from '../core/contracts';
import { toLegacyMeetingView } from '../core/legacy';
import { useLanguage, useT } from '../i18n';
import AIChat from '../pages/AIChat';
import AIInsights from '../pages/AIInsights';
import Calendar from '../pages/Calendar';
import CalendarSync from '../pages/CalendarSync';
import ChooseCreationMethod from '../pages/ChooseCreationMethod';
import Dashboard from '../pages/Dashboard';
import EditMeeting from '../pages/EditMeeting';
import LegacyLandingPage from '../pages/LandingPage';
import MeetingDetails from '../pages/MeetingDetails';
import Notes from '../pages/Notes';
import Pricing from '../pages/Pricing';
import Privacy from '../pages/Privacy';
import Settings from '../pages/Settings';
import Terms from '../pages/Terms';
import TotalMeetings from '../pages/TotalMeetings';
import WhatsAppBot from '../pages/WhatsAppBot';
import { useMeeting } from '../services/data';
import { ConsentNotice } from './ConsentNotice';
import { navigateToTopLevel } from './navigationService';
import { withLanguage, type LegacyComponent, type WithLanguageProps } from './withLanguage';

// ---- Main group: legacy screens with the live language prop ---------------------------------

export const DashboardScreen = withLanguage(Dashboard);
export const ChooseCreationMethodScreen = withLanguage(ChooseCreationMethod);
export const CreateMeetingScreen = withLanguage(ModernCreateMeeting);
export const TotalMeetingsScreen = withLanguage(TotalMeetings);
export const CalendarScreen = withLanguage(Calendar);
export const NotesScreen = withLanguage(Notes);
export const SettingsScreen = withLanguage(Settings);
/** "Profile" shows the settings screen (account section). */
export const ProfileScreen = withLanguage(Settings);
export const AIChatScreen = withLanguage(AIChat);
export const AIInsightsScreen = withLanguage(AIInsights);
export const PrivacyScreen = withLanguage(Privacy);
export const TermsScreen = withLanguage(Terms);
export const WhatsAppBotScreen = withLanguage(WhatsAppBot);
export const CalendarSyncScreen = withLanguage(CalendarSync);
export const PricingScreen = withLanguage(Pricing);

// ---- MeetingDetails / EditMeeting: meetingId -> legacy meeting ------------------------------

type MeetingRouteProps = StackScreenProps<RootStackParamList, 'MeetingDetails' | 'EditMeeting'>;

function MeetingStatus({ loading }: { loading: boolean }): ReactElement {
  const t = useT();
  const theme = usePaperTheme();
  return (
    <View style={[styles.centered, { backgroundColor: theme.colors.background }]}>
      {loading ? (
        <>
          <ActivityIndicator size="large" />
          <Text variant="bodyMedium" style={styles.statusText}>
            {t('navigation:meeting.loading')}
          </Text>
        </>
      ) : (
        <>
          <Text variant="titleMedium" style={styles.statusText} accessibilityRole="header">
            {t('navigation:meeting.notFoundTitle')}
          </Text>
          <Text variant="bodyMedium" style={styles.statusText}>
            {t('navigation:meeting.notFoundMessage')}
          </Text>
          <Button mode="contained" style={styles.statusButton} onPress={() => navigateToTopLevel('Dashboard')}>
            {t('navigation:meeting.backToDashboard')}
          </Button>
        </>
      )}
    </View>
  );
}

function createMeetingRouteScreen(Legacy: LegacyComponent, name: string): ComponentType<MeetingRouteProps> {
  const LegacyWithLanguage = withLanguage(Legacy);
  function MeetingRouteScreen({ navigation, route }: MeetingRouteProps): ReactElement {
    const passedMeeting = route.params?.meeting;
    const meetingId = route.params?.meetingId;
    const lookupId = passedMeeting === undefined && typeof meetingId === 'string' ? meetingId : null;
    const { meeting, isLoading } = useMeeting(lookupId);

    // Legacy screens read route.params.meeting: give them the resolved meeting (kept live).
    const resolvedRoute = useMemo(() => {
      if (passedMeeting !== undefined) return route;
      if (meeting === null) return null;
      return { ...route, params: { ...route.params, meeting: toLegacyMeetingView(meeting) } };
    }, [meeting, passedMeeting, route]);

    if (resolvedRoute === null) {
      return <MeetingStatus loading={lookupId !== null && isLoading} />;
    }
    return <LegacyWithLanguage navigation={navigation} route={resolvedRoute} />;
  }
  MeetingRouteScreen.displayName = `${name}Screen`;
  return MeetingRouteScreen;
}

export const MeetingDetailsScreen = createMeetingRouteScreen(MeetingDetails, 'MeetingDetails');
export const EditMeetingScreen = createMeetingRouteScreen(EditMeeting, 'EditMeeting');

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
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  statusText: {
    marginTop: 12,
    textAlign: 'center',
  },
  statusButton: {
    marginTop: 20,
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
