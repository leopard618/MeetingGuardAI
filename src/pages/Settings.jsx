
import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Alert,
  Switch,
} from "react-native";
import {
  Card,
  Title,
  Paragraph,
  Button,
  List,
  Divider,
  Avatar,
  ActivityIndicator,
} from "react-native-paper";
import { MaterialIcons, MaterialCommunityIcons } from "@expo/vector-icons";
import { User, UserPreferences } from "@/api/entities";
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import CalendarSyncSettings from '../components/CalendarSyncSettings.jsx';
import CalendarTest from "@/components/CalendarTest";

export default function Settings({ navigation, language = "en" }) {
  const { isDarkMode, toggleTheme } = useTheme();
  const { user: authUser } = useAuth();
  const [user, setUser] = useState(null);
  const [preferences, setPreferences] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [alertIntensity, setAlertIntensity] = useState('maximum');

  // Load alert intensity from preferences
  useEffect(() => {
    if (preferences?.alert_intensity) {
      setAlertIntensity(preferences.alert_intensity);
    }
  }, [preferences]);

  const t = {
    en: {
      title: "Settings",
      subtitle: "Customize your experience",
      profile: "Profile",
      account: "Account Settings",
      notifications: "Notifications",
      language: "Language",
      theme: "Theme",
      privacy: "Privacy & Security",
      about: "About",
      version: "Version",
      logout: "Logout",
      save: "Save Changes",
      saving: "Saving...",
      saved: "Settings saved successfully",
      error: "Error saving settings",
      confirmLogout: "Are you sure you want to logout?",
      languages: {
        en: "English",
        es: "Español",
        fr: "Français",
        de: "Deutsch",
        pt: "Português",
        zh: "中文",
        "zh-TW": "繁體中文",
      },
      themes: {
        light: "Light",
        dark: "Dark",
        auto: "Auto",
      },
      notificationSettings: {
        title: "Notification Settings",
        alertIntensity: "Alert Intensity",
        intensityLevels: {
          maximum: "Maximum - Full screen alerts",
          medium: "Medium - Banner alerts", 
          light: "Light - Toast notifications"
        }
      },
    },
    es: {
      title: "Configuración",
      subtitle: "Personaliza tu experiencia",
      profile: "Perfil",
      account: "Configuración de cuenta",
      notifications: "Notificaciones",
      language: "Idioma",
      theme: "Tema",
      privacy: "Privacidad y Seguridad",
      about: "Acerca de",
      version: "Versión",
      logout: "Cerrar sesión",
      save: "Guardar cambios",
      saving: "Guardando...",
      saved: "Configuración guardada exitosamente",
      error: "Error al guardar configuración",
      confirmLogout: "¿Estás seguro de que quieres cerrar sesión?",
      languages: {
        en: "English",
        es: "Español",
        fr: "Français",
        de: "Deutsch",
        pt: "Português",
        zh: "中文",
        "zh-TW": "繁體中文",
      },
      themes: {
        light: "Claro",
        dark: "Oscuro",
        auto: "Automático",
      },
      notificationSettings: {
        title: "Configuración de notificaciones",
        alertIntensity: "Intensidad de alertas",
        intensityLevels: {
          maximum: "Máxima - Alertas de pantalla completa",
          medium: "Media - Alertas de banner", 
          light: "Ligera - Notificaciones toast"
        }
      },
    },
  };

  useEffect(() => {
    loadUserData();
  }, [authUser]);

  const loadUserData = async () => {
    setIsLoading(true);
    try {
      // Use authenticated user data if available
      if (authUser) {
        const userData = {
          id: authUser.id,
          name: authUser.name,
          email: authUser.email,
          avatar: null,
          createdAt: authUser.createdAt,
          updatedAt: new Date().toISOString(),
        };
        
        setUser(userData);
        
        // Try to load preferences or create default ones
        try {
          const prefsData = await UserPreferences.filter({ created_by: authUser.email });
          if (prefsData.length > 0) {
            setPreferences(prefsData[0]);
          } else {
            // Create default preferences
            const defaultPrefs = await UserPreferences.create({
              created_by: authUser.email,
              language: language,
              theme: "light",
              alert_enabled: true,
              alert_intensity: 'maximum',
            });
            setPreferences(defaultPrefs);
          }
        } catch (prefsError) {
          console.error("Error loading preferences:", prefsError);
          // Create mock preferences for demo
          const mockPreferences = {
            id: "1",
            created_by: authUser.email,
            language: language,
            theme: "light",
            alert_enabled: true,
            alert_intensity: 'maximum',
          };
          setPreferences(mockPreferences);
        }
      }
    } catch (error) {
      console.error("Error loading user data:", error);
      Alert.alert("Error", "Failed to load user data");
    }
    setIsLoading(false);
  };

  const handleSaveSettings = async () => {
    if (!preferences) return;
    
    setIsSaving(true);
    try {
      await UserPreferences.update(preferences.id, preferences);
      Alert.alert("Success", t[language].saved);
    } catch (error) {
      console.error("Error saving settings:", error);
      Alert.alert("Error", t[language].error);
    }
    setIsSaving(false);
  };

  // Logout functionality moved to navigation bar

  const updatePreference = (key, value) => {
    setPreferences(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const showAlertIntensityPicker = () => {
    Alert.alert(
      t[language].notificationSettings.alertIntensity,
      "Choose alert intensity level:",
      [
        {
          text: t[language].notificationSettings.intensityLevels.maximum,
          onPress: () => updateAlertIntensity('maximum')
        },
        {
          text: t[language].notificationSettings.intensityLevels.medium,
          onPress: () => updateAlertIntensity('medium')
        },
        {
          text: t[language].notificationSettings.intensityLevels.light,
          onPress: () => updateAlertIntensity('light')
        },
        {
          text: "Cancel",
          style: "cancel"
        }
      ]
    );
  };

  const updateAlertIntensity = async (intensity) => {
    console.log('Updating alert intensity to:', intensity);
    setAlertIntensity(intensity);
    if (preferences) {
      try {
        console.log('Current preferences before update:', preferences);
        const updatedPrefs = await UserPreferences.update(preferences.id, {
          alert_intensity: intensity
        });
        console.log('Updated preferences after update:', updatedPrefs);
        setPreferences(updatedPrefs);
        Alert.alert("Success", `Alert intensity updated to ${intensity}`);
      } catch (error) {
        console.error("Error updating alert intensity:", error);
        Alert.alert("Error", "Failed to save alert intensity");
      }
    } else {
      console.log('No preferences found, cannot update');
      Alert.alert("Error", "No preferences found");
    }
  };

  const renderProfileSection = () => (
    <Card style={styles.section}>
      <Card.Content>
        <View style={styles.profileHeader}>
          <Avatar.Text 
            size={60} 
            label={user?.name?.charAt(0) || "U"} 
            style={styles.avatar}
          />
          <View style={styles.profileInfo}>
            <Title style={styles.profileName}>{user?.name || "User"}</Title>
            <Paragraph style={styles.profileEmail}>{user?.email || "user@example.com"}</Paragraph>
          </View>
        </View>
      </Card.Content>
    </Card>
  );

  const getTitleColor = () => (isDarkMode ? "#ffffff" : "#1e293b");

  const renderNotificationSettings = () => (
    <Card style={styles.section}>
      <Card.Content>
        <Title style={[styles.sectionTitle, { color: getTitleColor() }]}>
          {t[language].notificationSettings.title}
        </Title>
        
        {/* Only keep Alert Intensity - this is the only one that actually works */}
        <List.Item
          title={t[language].notificationSettings.alertIntensity}
          description={t[language].notificationSettings.intensityLevels[alertIntensity]}
          titleStyle={{ color: isDarkMode ? "#fff" : "#000" }}
          descriptionStyle={{ color: isDarkMode ? "#a1a1aa" : "#666" }}
          left={(props) => <List.Icon {...props} icon="bell-ring" />}
          onPress={() => showAlertIntensityPicker()}
        />
      </Card.Content>
    </Card>
  );

  const renderThemeSettings = () => (
    <Card style={styles.section}>
      <Card.Content>
        <Title style={[styles.sectionTitle, { color: getTitleColor() }]}>
          {t[language].theme}
        </Title>
        
        <List.Item
          title={isDarkMode ? t[language].themes.dark : t[language].themes.light}
          description={isDarkMode ? "Dark theme is enabled" : "Light theme is enabled"}
          titleStyle={{ color: isDarkMode ? "#fff" : "#000" }}
          left={(props) => (
            <List.Icon 
              {...props} 
              icon={isDarkMode ? "weather-night" : "weather-sunny"} 
            />
          )}
          right={() => (
            <Switch
              value={isDarkMode}
              onValueChange={toggleTheme}
            />
          )}
        />
      </Card.Content>
    </Card>
  );

  // Privacy settings removed - they were just UI placeholders without functionality

  const renderNavigationItems = () => (
    <Card style={styles.section}>
      <Card.Content>
        <TouchableOpacity
          onPress={() => navigation.navigate('ApiSettings')}
          style={styles.navItem}
        >
          <List.Item
            title="API Settings"
            description="Configure API keys and integrations"
            titleStyle={{ color: isDarkMode ? "#fff" : "#000" }}
            left={(props) => <List.Icon {...props} icon="api" />}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
          />
        </TouchableOpacity>
        
        <Divider />
        
        <TouchableOpacity
          onPress={() => navigation.navigate('CalendarSync')}
          style={styles.navItem}
        >
          <List.Item
            title="Google Calendar Sync"
            description="Configure calendar synchronization"
            titleStyle={{ color: isDarkMode ? "#fff" : "#000" }}
            left={(props) => <List.Icon {...props} icon="sync" />}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
          />
        </TouchableOpacity>
        
        <Divider />
        
        {/* <TouchableOpacity
          onPress={() => navigation.navigate('/CalendarTest')}
          style={styles.navItem}
        >
          <List.Item
            title="Calendar Integration Test"
            description="Test Google Calendar integration"
            titleStyle={{ color: isDarkMode ? "#fff" : "#000" }}
            left={(props) => <List.Icon {...props} icon="test-tube" />}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
          />
        </TouchableOpacity> */}
        
        {/* <Divider /> */}
        
        <TouchableOpacity
          onPress={() => navigation.navigate('Privacy')}
          style={styles.navItem}
        >
          <List.Item
            title="Privacy Policy"
            description="Read our privacy policy"
            titleStyle={{ color: isDarkMode ? "#fff" : "#000" }}
            left={(props) => <List.Icon {...props} icon="shield" />}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
          />
        </TouchableOpacity>
        
        <Divider />
        
        <TouchableOpacity
          onPress={() => navigation.navigate('Terms')}
          style={styles.navItem}
        >
          <List.Item
            title="Terms of Service"
            description="Read our terms of service"
            titleStyle={{ color: isDarkMode ? "#fff" : "#000" }}
            left={(props) => <List.Icon {...props} icon="file-document" />}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
          />
        </TouchableOpacity>
        
        <Divider />
        
        <List.Item
          title={t[language].about}
          description={`${t[language].version} 1.0.0`}
          titleStyle={{ color: isDarkMode ? "#fff" : "#000" }}
          left={(props) => <List.Icon {...props} icon="information" />}
        />
      </Card.Content>
    </Card>
  );

  const styles = getStyles(isDarkMode);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#3b82f6" />
          <Text style={styles.loadingText}>Loading settings...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <MaterialIcons name="arrow-back" size={24} color={isDarkMode ? "#ffffff" : "#1e293b"} />
        </TouchableOpacity>
        
        <View style={styles.headerContent}>
          <Title style={styles.title}>{t[language].title}</Title>
          <Paragraph style={styles.subtitle}>{t[language].subtitle}</Paragraph>
        </View>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {renderProfileSection()}
        {renderThemeSettings()}
        {renderNotificationSettings()}
        {renderNavigationItems()}
        
        <View style={styles.buttonContainer}>
          <Button
            mode="contained"
            onPress={handleSaveSettings}
            loading={isSaving}
            disabled={isSaving}
            style={styles.saveButton}
          >
            {isSaving ? t[language].saving : t[language].save}
          </Button>
          
          {/* Logout button moved to navigation bar */}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const getStyles = (isDarkMode) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: isDarkMode ? "#0a0a0a" : "#f8fafc",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 24,
    paddingTop: 32,
    backgroundColor: isDarkMode ? "#1a1a1a" : "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: isDarkMode ? "#262626" : "#e2e8f0",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: isDarkMode ? 0.3 : 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  backButton: {
    marginRight: 16,
    padding: 4,
  },
  headerContent: {
    flex: 1,
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    marginBottom: 4,
    color: isDarkMode ? "#ffffff" : "#1e293b",
  },
  subtitle: {
    fontSize: 14,
    color: isDarkMode ? "#a1a1aa" : "#64748b",
  },
  content: {
    flex: 1,
    padding: 20,
    color:isDarkMode ? "#ffffff" : "#1e293b",
  },
  section: {
    marginBottom: 20,
    elevation: 4,
    backgroundColor: isDarkMode ? "#1a1a1a" : "#ffffff",
    borderRadius: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: isDarkMode ? 0.3 : 0.1,
    shadowRadius: 12,
    color:isDarkMode ? "#ffffff" : "#1e293b",
  },
  profileHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  avatar: {
    marginRight: 16,
    backgroundColor: "#3b82f6",
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 4,
    color: isDarkMode ? "#ffffff" : "#1e293b",
  },
  profileEmail: {
    fontSize: 14,
    color: isDarkMode ? "#a1a1aa" : "#64748b",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 16,
    color: isDarkMode ? "#ffffff" : "#1e293b",
  },
  navItem: {
    marginVertical: 4,
  },
  buttonContainer: {
    marginTop: 20,
    marginBottom: 40,
    gap: 12,
  },
  saveButton: {
    marginBottom: 8,
    borderRadius: 12,
  },
  logoutButton: {
    borderColor: "#ef4444",
    borderRadius: 12,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: isDarkMode ? "#a1a1aa" : "#64748b",
  },
  divider: {
    marginVertical: 8,
    backgroundColor: isDarkMode ? "#262626" : "#e2e8f0",
  },
});
