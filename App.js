import React, { useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { Provider as PaperProvider } from 'react-native-paper';
import Toast from 'react-native-toast-message';
import { View, StyleSheet } from 'react-native';

// Import components
import MobileSidebar from './src/components/MobileSidebar';
import CustomHeader from './src/components/CustomHeader';

// Import API entities
import { User } from './src/api/entities';
import { UserPreferences } from './src/api/entities';

// Import screens
import Dashboard from './src/pages/Dashboard';
import CreateMeeting from './src/pages/CreateMeeting';
import Calendar from './src/pages/Calendar';
import Notes from './src/pages/Notes';
import Settings from './src/pages/Settings';
import AIChat from './src/pages/AIChat';
import AIInsights from './src/pages/AIInsights';
import ApiSettings from './src/pages/Apisettings';
import Privacy from './src/pages/Privacy';
import Terms from './src/pages/Terms';
import WhatsAppBot from './src/pages/WhatsAppBot';
import ChooseCreationMethod from './src/pages/ChooseCreationMethod';

const Stack = createStackNavigator();

// Wrapper components to pass language prop
const DashboardWithLanguage = (props) => <Dashboard {...props} language={props.route.params?.language || "en"} />;
const CreateMeetingWithLanguage = (props) => <CreateMeeting {...props} language={props.route.params?.language || "en"} />;
const CalendarWithLanguage = (props) => <Calendar {...props} language={props.route.params?.language || "en"} />;
const NotesWithLanguage = (props) => <Notes {...props} language={props.route.params?.language || "en"} />;
const SettingsWithLanguage = (props) => <Settings {...props} language={props.route.params?.language || "en"} />;
const AIChatWithLanguage = (props) => <AIChat {...props} language={props.route.params?.language || "en"} />;
const AIInsightsWithLanguage = (props) => <AIInsights {...props} language={props.route.params?.language || "en"} />;
const ApiSettingsWithLanguage = (props) => <ApiSettings {...props} language={props.route.params?.language || "en"} />;
const PrivacyWithLanguage = (props) => <Privacy {...props} language={props.route.params?.language || "en"} />;
const TermsWithLanguage = (props) => <Terms {...props} language={props.route.params?.language || "en"} />;
const WhatsAppBotWithLanguage = (props) => <WhatsAppBot {...props} language={props.route.params?.language || "en"} />;
const ChooseCreationMethodWithLanguage = (props) => <ChooseCreationMethod {...props} language={props.route.params?.language || "en"} />;

export default function App() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [user, setUser] = useState(null);
  const [language, setLanguageState] = useState("en");
  const [currentRouteName, setCurrentRouteName] = useState("Dashboard");

  useEffect(() => {
    const fetchUserAndPrefs = async () => {
      try {
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
      } catch (error) {
        console.error("User not logged in or error fetching data:", error);
      }
    };
    fetchUserAndPrefs();
  }, []);

  const setLanguage = async (lang) => {
    setLanguageState(lang);
    if (user) {
      try {
        const prefsList = await UserPreferences.filter({ created_by: user.email });
        if (prefsList.length > 0) {
          await UserPreferences.update(prefsList[0].id, { language: lang });
        } else {
          await UserPreferences.create({ created_by: user.email, language: lang });
        }
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

  return (
    <PaperProvider>
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
            <Stack.Screen 
              name="Calendar" 
              component={CalendarWithLanguage}
              options={{ title: 'Calendar' }}
              initialParams={{ language }}
            />
            <Stack.Screen 
              name="Notes" 
              component={NotesWithLanguage}
              options={{ title: 'Notes' }}
              initialParams={{ language }}
            />
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
    </PaperProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
}); 