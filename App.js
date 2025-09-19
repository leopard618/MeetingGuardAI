import React, { useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { Provider as PaperProvider } from 'react-native-paper';
import Toast from 'react-native-toast-message';
import { View, StyleSheet } from 'react-native';
import { ThemeProvider } from './src/contexts/ThemeContext.jsx';
import { AuthProvider, useAuth } from './src/contexts/AuthContext.jsx';
import calendarSyncManager from './src/api/calendarSyncManager.js';
import googleCalendarInitializer from './src/api/googleCalendarInitializer.js';

// Import components
import MobileSidebar from './src/components/MobileSidebar.jsx';
import CustomHeader from './src/components/CustomHeader.jsx';

// Import API entities
import { User } from './src/api/entities.js';
import { UserPreferences } from './src/api/entities.js';

// Import screens
import LandingPage from './src/pages/LandingPage.jsx';
import Auth from './src/pages/Auth.jsx';
import Dashboard from './src/pages/Dashboard.jsx';
import ModernCreateMeeting from './src/components/ModernCreateMeeting.jsx';
import TotalMeetings from './src/pages/TotalMeetings.jsx';
import MeetingDetails from './src/pages/MeetingDetails.jsx';
import EditMeeting from './src/pages/EditMeeting.jsx';
import Calendar from './src/pages/Calendar.jsx';
import Notes from './src/pages/Notes.jsx';
import Settings from './src/pages/Settings.jsx';
import AIChat from './src/pages/AIChat.jsx';
import AIInsights from './src/pages/AIInsights.jsx';
import ApiSettings from './src/pages/Apisettings.jsx';
import Privacy from './src/pages/Privacy.jsx';
import Terms from './src/pages/Terms.jsx';
import WhatsAppBot from './src/pages/WhatsAppBot.jsx';
import ChooseCreationMethod from './src/pages/ChooseCreationMethod.jsx';
import CalendarSync from './src/pages/CalendarSync.jsx';
import GoogleCalendarTest from './src/pages/GoogleCalendarTest.jsx';
import GoogleCalendarTestComponent from './src/components/GoogleCalendarTest.jsx';
import NotificationDemo from './src/components/NotificationSystem/NotificationDemo.jsx';
import Pricing from './src/pages/Pricing.jsx';
import PaymentSuccess from './src/pages/PaymentSuccess.jsx';

const Stack = createStackNavigator();

// Wrapper components to pass language prop - now using current language state
const AuthWithLanguage = (props) => <Auth {...props} language={props.language || "en"} />;
const DashboardWithLanguage = (props) => <Dashboard {...props} language={props.language || "en"} />;
const CreateMeetingWithLanguage = (props) => <ModernCreateMeeting {...props} language={props.language || "en"} />;
const TotalMeetingsWithLanguage = (props) => <TotalMeetings {...props} language={props.language || "en"} />;
const MeetingDetailsWithLanguage = (props) => <MeetingDetails {...props} language={props.language || "en"} />;
const EditMeetingWithLanguage = (props) => <EditMeeting {...props} language={props.language || "en"} />;
const CalendarWithLanguage = (props) => <Calendar {...props} language={props.language || "en"} />;
const NotesWithLanguage = (props) => <Notes {...props} language={props.language || "en"} />;
const SettingsWithLanguage = (props) => <Settings {...props} language={props.language || "en"} />;
const ProfileWithLanguage = (props) => <Settings {...props} language={props.language || "en"} />;
const AIChatWithLanguage = (props) => <AIChat {...props} language={props.language || "en"} />;
const AIInsightsWithLanguage = (props) => <AIInsights {...props} language={props.language || "en"} />;
const ApiSettingsWithLanguage = (props) => <ApiSettings {...props} language={props.language || "en"} />;
const PrivacyWithLanguage = (props) => <Privacy {...props} language={props.language || "en"} />;
const TermsWithLanguage = (props) => <Terms {...props} language={props.language || "en"} />;
const WhatsAppBotWithLanguage = (props) => <WhatsAppBot {...props} language={props.language || "en"} />;
const ChooseCreationMethodWithLanguage = (props) => <ChooseCreationMethod {...props} language={props.language || "en"} />;
const CalendarSyncWithLanguage = (props) => <CalendarSync {...props} language={props.language || "en"} />;
const GoogleCalendarTestWithLanguage = (props) => <GoogleCalendarTest {...props} language={props.language || "en"} />;
const GoogleCalendarTestComponentWithLanguage = (props) => <GoogleCalendarTestComponent {...props} language={props.language || "en"} />;
const NotificationDemoWithLanguage = (props) => <NotificationDemo {...props} language={props.language || "en"} />;
const PricingWithLanguage = (props) => <Pricing {...props} language={props.language || "en"} />;
const PaymentSuccessWithLanguage = (props) => <PaymentSuccess {...props} language={props.language || "en"} />;

// App Navigator Component
function AppNavigator() {
  const { isAuthenticated, isLoading } = useAuth();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [user, setUser] = useState(null);
  const [language, setLanguageState] = useState("es");
  const [currentRouteName, setCurrentRouteName] = useState("Dashboard");
  const [showAuth, setShowAuth] = useState(false);

  // Define CalendarWithLanguage inside the function to access language state
  const CalendarWithLanguage = (props) => <Calendar {...props} language={language} />;
  
  // Define NotesWithLanguage inside the function to access language state
  const NotesWithLanguage = (props) => <Notes {...props} language={language} />;
  
  // Define SettingsWithLanguage inside the function to access language state
  const SettingsWithLanguage = (props) => <Settings {...props} language={language} />;

  useEffect(() => {
    const fetchUserAndPrefs = async () => {
      try {
        // For now, use mock data since User.me() might not be available
        const currentUser = { email: 'user@example.com' };
        setUser(currentUser);
        
        // Mock preferences for now - set to Spanish for testing
        setLanguageState("es");
        
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
      
      // Initialize calendar sync manager
      calendarSyncManager.initialize().then((success) => {
        if (success) {
          console.log('Calendar sync manager initialized successfully');
        } else {
          console.log('Calendar sync manager initialization failed');
        }
      }).catch((error) => {
        console.error('Error initializing calendar sync manager:', error);
      });
      
      // Initialize Google Calendar connection
      googleCalendarInitializer.initialize().then(result => {
        if (result.success) {
          console.log('✅ Google Calendar initialized successfully:', result.message);
        } else {
          console.log('⚠️ Google Calendar initialization failed:', result.message);
        }
      }).catch(error => {
        console.error('❌ Google Calendar initialization error:', error);
      });
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

  const toggleLanguage = () => {
    const newLanguage = language === 'en' ? 'es' : 'en';
    setLanguageState(newLanguage);
    
    // Force re-render of all screens by updating their params
    // This ensures all components get the new language prop
    console.log('Language toggled to:', newLanguage);
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

  // Show landing page or auth page if not authenticated
  if (!isAuthenticated) {
    return (
      <View style={styles.container}>
        {showAuth ? (
          <Auth />
        ) : (
          <LandingPage onGetStarted={() => setShowAuth(true)} />
        )}
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
                  language={language}
                  onLanguageToggle={toggleLanguage}
                />
              ),
            }}
          >
            <Stack.Screen 
              name="LandingPage" 
              component={LandingPage}
              options={{ headerShown: false }}
            />
            <Stack.Screen 
              name="Auth" 
              component={(props) => <AuthWithLanguage {...props} language={language} />}
              options={{ headerShown: false }}
            />
            <Stack.Screen 
              name="Dashboard" 
              component={(props) => <DashboardWithLanguage {...props} language={language} />}
              options={({ route }) => ({ title: language === 'es' ? 'Panel Principal' : 'Meeting Guard' })}
            />
            <Stack.Screen 
              name="ChooseCreationMethod" 
              component={(props) => <ChooseCreationMethodWithLanguage {...props} language={language} />}
              options={({ route }) => ({ title: language === 'es' ? 'Elegir Método' : 'ChooseMethod' })}
            />
            <Stack.Screen 
              name="CreateMeeting" 
              component={(props) => <CreateMeetingWithLanguage {...props} language={language} />}
              options={({ route }) => ({ title: language === 'es' ? 'Crear Reunión' : 'Create Meeting' })}
            />
            <Stack.Screen 
              name="TotalMeetings" 
              component={(props) => <TotalMeetingsWithLanguage {...props} language={language} />}
              options={({ route }) => ({ title: language === 'es' ? 'Todas las Reuniones' : 'Total Meetings' })}
            />
            <Stack.Screen 
              name="MeetingDetails" 
              component={MeetingDetailsWithLanguage}
              options={({ route }) => ({ title: language === 'es' ? 'Detalles de la Reunión' : 'Meeting Details' })}
              initialParams={{ language }}
            />
            <Stack.Screen 
              name="EditMeeting" 
              component={EditMeetingWithLanguage}
              options={({ route }) => ({ title: language === 'es' ? 'Editar Reunión' : 'Edit Meeting' })}
              initialParams={{ language }}
            />
            <Stack.Screen 
              name="Calendar" 
              component={CalendarWithLanguage}
              options={({ route }) => ({ title: language === 'es' ? 'Calendario' : 'Calendar' })}
              initialParams={{ language }}
            />
            <Stack.Screen 
              name="Notes" 
              component={NotesWithLanguage}
              options={({ route }) => ({ title: language === 'es' ? 'Notas' : 'Notes' })}
              initialParams={{ language }}
            />
            <Stack.Screen 
              name="Settings" 
              component={SettingsWithLanguage}
              options={({ route }) => ({ title: language === 'es' ? 'Configuración' : 'Settings' })}
              initialParams={{ language }}
            />
            <Stack.Screen 
              name="Profile" 
              component={ProfileWithLanguage}
              options={({ route }) => ({ title: language === 'es' ? 'Perfil' : 'Profile' })}
              initialParams={{ language }}
            />
            <Stack.Screen 
              name="AIChat" 
              component={(props) => <AIChatWithLanguage {...props} language={language} />}
              options={({ route }) => ({ title: language === 'es' ? 'Chat IA' : 'AI Chat' })}
            />
            <Stack.Screen 
              name="AIInsights" 
              component={AIInsightsWithLanguage}
              options={({ route }) => ({ title: language === 'es' ? 'Información IA' : 'AI Insights' })}
              initialParams={{ language }}
            />
            <Stack.Screen 
              name="ApiSettings" 
              component={ApiSettingsWithLanguage}
              options={({ route }) => ({ title: language === 'es' ? 'Configuración API' : 'API Settings' })}
              initialParams={{ language }}
            />
            <Stack.Screen 
              name="Privacy" 
              component={PrivacyWithLanguage}
              options={({ route }) => ({ title: language === 'es' ? 'Política de Privacidad' : 'Privacy Policy' })}
              initialParams={{ language }}
            />
            <Stack.Screen 
              name="Terms" 
              component={TermsWithLanguage}
              options={({ route }) => ({ title: language === 'es' ? 'Términos de Servicio' : 'Terms of Service' })}
              initialParams={{ language }}
            />
            <Stack.Screen 
              name="WhatsAppBot" 
              component={WhatsAppBotWithLanguage}
              options={({ route }) => ({ title: language === 'es' ? 'Bot WhatsApp' : 'WhatsApp Bot' })}
              initialParams={{ language }}
            />
            <Stack.Screen 
              name="CalendarSync" 
              component={CalendarSyncWithLanguage}
              options={({ route }) => ({ title: language === 'es' ? 'Sincronización Google Calendar' : 'Google Calendar Sync' })}
              initialParams={{ language }}
            />
            <Stack.Screen 
              name="GoogleCalendarTest" 
              component={GoogleCalendarTestWithLanguage}
              options={({ route }) => ({ title: language === 'es' ? 'Prueba Google Calendar' : 'Google Calendar Test' })}
              initialParams={{ language }}
            />
            <Stack.Screen 
              name="GoogleCalendarTestComponent" 
              component={GoogleCalendarTestComponentWithLanguage}
              options={({ route }) => ({ title: language === 'es' ? 'Componente Prueba Google Calendar' : 'Google Calendar Test Component' })}
              initialParams={{ language }}
            />
            <Stack.Screen 
              name="NotificationDemo" 
              component={NotificationDemoWithLanguage}
              options={({ route }) => ({ title: language === 'es' ? 'Demo de Notificaciones' : 'Notification Demo' })}
              initialParams={{ language }}
            />
            <Stack.Screen 
              name="Pricing" 
              component={PricingWithLanguage}
              options={({ route }) => ({ title: language === 'es' ? 'Planes de Precios' : 'Pricing Plans' })}
              initialParams={{ language }}
            />
            <Stack.Screen 
              name="PaymentSuccess" 
              component={PaymentSuccessWithLanguage}
              options={({ route }) => ({ title: language === 'es' ? 'Pago Exitoso' : 'Payment Successful' })}
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