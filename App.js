import React, { useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { Provider as PaperProvider } from 'react-native-paper';
import Toast from 'react-native-toast-message';
import { View, StyleSheet, Text } from 'react-native';
import * as Sentry from '@sentry/react-native';

// Initialize Sentry for error tracking
Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN || 'https://5eea696ca12ece6f1c8d546d2c0a4452@o4509871473033216.ingest.de.sentry.io/4509877130952784',
  environment: __DEV__ ? 'development' : 'production',
  tracesSampleRate: 1.0,
});

import { ThemeProvider } from './src/contexts/ThemeContext';
import { AuthProvider, useAuth } from './src/contexts/AuthContext';
// Import components
import MobileSidebar from './src/components/MobileSidebar';
import CustomHeader from './src/components/CustomHeader';

// Import screens
import Auth from './src/pages/Auth';
// import Dashboard from './src/pages/Dashboard';
// import ModernCreateMeeting from './src/components/ModernCreateMeeting';
// import TotalMeetings from './src/pages/TotalMeetings';
// import MeetingDetails from './src/pages/MeetingDetails';
// import EditMeeting from './src/pages/EditMeeting';
// import Calendar from './src/pages/Calendar';
import Notes from './src/pages/Notes';
// import Settings from './src/pages/Settings';
// import AIChat from './src/pages/AIChat';
// import AIInsights from './src/pages/AIInsights';
// import ApiSettings from './src/pages/Apisettings';
import Privacy from './src/pages/Privacy';
import Terms from './src/pages/Terms';
import WhatsAppBot from './src/pages/WhatsAppBot';
import ChooseCreationMethod from './src/pages/ChooseCreationMethod';
// import CalendarSync from './src/pages/CalendarSync';
// import GoogleCalendarTest from './src/pages/GoogleCalendarTest';
// import GoogleCalendarTestComponent from './src/components/GoogleCalendarTest';
import NotificationDemo from './src/components/NotificationSystem/NotificationDemo';

// Temporary placeholder components
const Dashboard = () => (
  <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
    <Text>Dashboard - Coming Soon</Text>
  </View>
);

const ModernCreateMeeting = () => (
  <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
    <Text>Create Meeting - Coming Soon</Text>
  </View>
);

const Stack = createStackNavigator();

// Wrapper components to pass language prop
const AuthWithLanguage = (props) => <Auth {...props} language={props.route.params?.language || "en"} />;
const DashboardWithLanguage = (props) => <Dashboard {...props} language={props.route.params?.language || "en"} />;
const CreateMeetingWithLanguage = (props) => <ModernCreateMeeting {...props} language={props.route.params?.language || "en"} />;
// const TotalMeetingsWithLanguage = (props) => <TotalMeetings {...props} language={props.route.params?.language || "en"} />;
// const MeetingDetailsWithLanguage = (props) => <MeetingDetails {...props} language={props.route.params?.language || "en"} />;
// const EditMeetingWithLanguage = (props) => <EditMeeting {...props} language={props.route.params?.language || "en"} />;
// const CalendarWithLanguage = (props) => <Calendar {...props} language={props.route.params?.language || "en"} />;
const NotesWithLanguage = (props) => <Notes {...props} language={props.route.params?.language || "en"} />;
// const SettingsWithLanguage = (props) => <Settings {...props} language={props.route.params?.language || "en"} />;
// const AIChatWithLanguage = (props) => <AIChat {...props} language={props.route.params?.language || "en"} />;
// const AIInsightsWithLanguage = (props) => <AIInsights {...props} language={props.route.params?.language || "en"} />;
// const ApiSettingsWithLanguage = (props) => <ApiSettings {...props} language={props.route.params?.language || "en"} />;
const PrivacyWithLanguage = (props) => <Privacy {...props} language={props.route.params?.language || "en"} />;
const TermsWithLanguage = (props) => <Terms {...props} language={props.route.params?.language || "en"} />;
const WhatsAppBotWithLanguage = (props) => <WhatsAppBot {...props} language={props.route.params?.language || "en"} />;
const ChooseCreationMethodWithLanguage = (props) => <ChooseCreationMethod {...props} language={props.route.params?.language || "en"} />;
// const CalendarSyncWithLanguage = (props) => <CalendarSync {...props} language={props.route.params?.language || "en"} />;
// const GoogleCalendarTestWithLanguage = (props) => <GoogleCalendarTest {...props} language={props.route.params?.language || "en"} />;
// const GoogleCalendarTestComponentWithLanguage = (props) => <GoogleCalendarTestComponent {...props} language={props.route.params?.language || "en"} />;
const NotificationDemoWithLanguage = (props) => <NotificationDemo {...props} language={props.route.params?.language || "en"} />;

// App Navigator Component
function AppNavigator() {
  const { isAuthenticated, isLoading } = useAuth();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [user, setUser] = useState(null);
  const [language, setLanguageState] = useState("en");
  const [currentRouteName, setCurrentRouteName] = useState("Dashboard");

  useEffect(() => {
    const fetchUserAndPrefs = async () => {
      try {
        // For now, use mock data since User.me() might not be available
        const currentUser = { email: 'user@example.com' };
        setUser(currentUser);
        
        // Mock preferences for now
        setLanguageState("en");
        
        /* TODO: Uncomment when User and UserPreferences are properly set up
        const currentUser = await User.me();
        setUser(currentUser);
        const prefsList = await UserPreferences.filter({ created_by: currentUser.email });
        if (prefsList.length > 0) {
          setLanguageState(prefsList[0].language || "en");
        } else {
          // If no preferences, create them
          const newPrefs = await UserPreferences.create({ created_by: currentUser.email, language: "en" });
          setLanguageState(newPrefs.language);
        }
        */
      } catch (error) {
        console.error("User not logged in or error fetching data:", error);
      }
    };
    
    if (isAuthenticated) {
      fetchUserAndPrefs();
      
      // TODO: Initialize calendar sync manager when API is properly set up
      // calendarSyncManager.initialize().then((success) => {
      //   if (success) {
      //     console.log('Calendar sync manager initialized successfully');
      //   } else {
      //     console.log('Calendar sync manager initialization failed');
      //   }
      // }).catch((error) => {
      //   console.error('Error initializing calendar sync manager:', error);
      // });
    }
  }, [isAuthenticated]);

  const setLanguage = async (lang) => {
    setLanguageState(lang);
    if (user) {
      try {
        // For now, just update the state
        // TODO: Uncomment when UserPreferences are properly set up
        /*
        const prefsList = await UserPreferences.filter({ created_by: user.email });
        if (prefsList.length > 0) {
          await UserPreferences.update(prefsList[0].id, { language: lang });
        } else {
          await UserPreferences.create({ created_by: user.email, language: lang });
        }
        */
      } catch (error) {
        console.error("Error updating language preference:", error);
      }
    }
  };

  const toggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen);
  };

  const closeSidebar = () => {
    setIsSidebarOpen(false);
  };

  // Show loading screen while checking authentication
  if (isLoading) {
    return (
      <View style={styles.container}>
        {/* You can add a proper loading component here */}
      </View>
    );
  }

  // Show auth screen if not authenticated
  if (!isAuthenticated) {
    return (
      <View style={styles.container}>
        <Auth />
      </View>
    );
  }

  return (
    <PaperProvider>
      <ThemeProvider>
        <View style={styles.container}>
          <NavigationContainer
          onStateChange={(state) => {
            if (state && state.routes && state.routes.length > 0) {
              const currentRoute = state.routes[state.index];
              setCurrentRouteName(currentRoute.name);
            }
          }}
        >
          <Stack.Navigator 
            initialRouteName="Dashboard"
            screenOptions={{
              header: ({ route, navigation }) => (
                <CustomHeader
                  title={route.name}
                  onMenuPress={toggleSidebar}
                  showMenu={true}
                />
              ),
            }}
          >
            <Stack.Screen 
              name="Dashboard" 
              component={DashboardWithLanguage}
              options={{ title: 'Meeting Guard' }}
              initialParams={{ language }}
            />
            <Stack.Screen 
              name="ChooseCreationMethod" 
              component={ChooseCreationMethodWithLanguage}
              options={{ title: 'Choose Creation Method' }}
              initialParams={{ language }}
            />
            <Stack.Screen 
              name="CreateMeeting" 
              component={CreateMeetingWithLanguage}
              options={{ title: 'Create Meeting' }}
              initialParams={{ language }}
            />
            {/* Temporarily commented out due to API import issues
            <Stack.Screen 
              name="TotalMeetings" 
              component={TotalMeetingsWithLanguage}
              options={{ title: 'Total Meetings' }}
              initialParams={{ language }}
            />
            <Stack.Screen 
              name="MeetingDetails" 
              component={MeetingDetailsWithLanguage}
              options={{ title: 'Meeting Details' }}
              initialParams={{ language }}
            />
            <Stack.Screen 
              name="EditMeeting" 
              component={EditMeetingWithLanguage}
              options={{ title: 'Edit Meeting' }}
              initialParams={{ language }}
            />
            <Stack.Screen 
              name="Calendar" 
              component={CalendarWithLanguage}
              options={{ title: 'Calendar' }}
              initialParams={{ language }}
            />
            */}
            <Stack.Screen 
              name="Notes" 
              component={NotesWithLanguage}
              options={{ title: 'Notes' }}
              initialParams={{ language }}
            />
            {/* Temporarily commented out due to API import issues
            <Stack.Screen 
              name="Settings" 
              component={SettingsWithLanguage}
              options={{ title: 'Settings' }}
              initialParams={{ language }}
            />
            <Stack.Screen 
              name="AIChat" 
              component={AIChatWithLanguage}
              options={{ title: 'AI Chat' }}
              initialParams={{ language }}
            />
            <Stack.Screen 
              name="AIInsights" 
              component={AIInsightsWithLanguage}
              options={{ title: 'AI Insights' }}
              initialParams={{ language }}
            />
            <Stack.Screen 
              name="ApiSettings" 
              component={ApiSettingsWithLanguage}
              options={{ title: 'API Settings' }}
              initialParams={{ language }}
            />
            */}
            <Stack.Screen 
              name="Privacy" 
              component={PrivacyWithLanguage}
              options={{ title: 'Privacy Policy' }}
              initialParams={{ language }}
            />
            <Stack.Screen 
              name="Terms" 
              component={TermsWithLanguage}
              options={{ title: 'Terms of Service' }}
              initialParams={{ language }}
            />
            <Stack.Screen 
              name="WhatsAppBot" 
              component={WhatsAppBotWithLanguage}
              options={{ title: 'WhatsApp Bot' }}
              initialParams={{ language }}
            />
            {/* Temporarily commented out due to API import issues
            <Stack.Screen 
              name="CalendarSync" 
              component={CalendarSyncWithLanguage}
              options={{ title: 'Google Calendar Sync' }}
              initialParams={{ language }}
            />
            <Stack.Screen 
              name="GoogleCalendarTest" 
              component={GoogleCalendarTestWithLanguage}
              options={{ title: 'Google Calendar Test' }}
              initialParams={{ language }}
            />
            <Stack.Screen 
              name="GoogleCalendarTestComponent" 
              component={GoogleCalendarTestComponentWithLanguage}
              options={{ title: 'Google Calendar Test Component' }}
              initialParams={{ language }}
            />
            */}
            <Stack.Screen 
              name="NotificationDemo" 
              component={NotificationDemoWithLanguage}
              options={{ title: 'Notification Demo' }}
              initialParams={{ language }}
            />
          </Stack.Navigator>
          
          {/* Mobile Sidebar */}
          <MobileSidebar
            visible={isSidebarOpen}
            onClose={closeSidebar}
            language={language}
            setLanguage={setLanguage}
            currentRouteName={currentRouteName}
          />
          
          <StatusBar style="auto" />
          <Toast />
        </NavigationContainer>
        </View>
      </ThemeProvider>
    </PaperProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

// Main App Component
export default function App() {
  return (
    <AuthProvider>
      <PaperProvider>
        <ThemeProvider>
          <View style={styles.container}>
            <AppNavigator />
            <StatusBar style="auto" />
            <Toast />
          </View>
        </ThemeProvider>
      </PaperProvider>
    </AuthProvider>
  );
} 