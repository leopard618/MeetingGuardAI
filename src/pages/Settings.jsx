
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

export default function Settings({ navigation, language = "en" }) {
  const [user, setUser] = useState(null);
  const [preferences, setPreferences] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

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
        meetings: "Meeting reminders",
        tasks: "Task reminders",
        insights: "AI insights",
        updates: "App updates",
      },
      privacySettings: {
        title: "Privacy & Security",
        dataCollection: "Data collection",
        analytics: "Analytics",
        crashReports: "Crash reports",
        location: "Location services",
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
        meetings: "Recordatorios de reuniones",
        tasks: "Recordatorios de tareas",
        insights: "Insights de IA",
        updates: "Actualizaciones de la app",
      },
      privacySettings: {
        title: "Privacidad y Seguridad",
        dataCollection: "Recopilación de datos",
        analytics: "Analíticas",
        crashReports: "Reportes de errores",
        location: "Servicios de ubicación",
      },
    },
  };

  useEffect(() => {
    loadUserData();
  }, []);

  const loadUserData = async () => {
    setIsLoading(true);
    try {
      const [userData, prefsData] = await Promise.all([
        User.me(),
        UserPreferences.filter({ created_by: userData?.email || "default" })
      ]);
      
      setUser(userData);
      if (prefsData.length > 0) {
        setPreferences(prefsData[0]);
      } else {
        // Create default preferences
        const defaultPrefs = await UserPreferences.create({
          created_by: userData?.email || "default",
          language: language,
          theme: "light",
          alert_enabled: true,
          notification_meetings: true,
          notification_tasks: true,
          notification_insights: true,
          notification_updates: false,
          privacy_data_collection: true,
          privacy_analytics: true,
          privacy_crash_reports: true,
          privacy_location: false,
        });
        setPreferences(defaultPrefs);
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

  const handleLogout = () => {
    Alert.alert(
      "Confirm Logout",
      t[language].confirmLogout,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Logout", style: "destructive", onPress: () => {
          // Handle logout logic here
          navigation.navigate('Dashboard');
        }},
      ]
    );
  };

  const updatePreference = (key, value) => {
    setPreferences(prev => ({
      ...prev,
      [key]: value
    }));
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

  const renderNotificationSettings = () => (
    <Card style={styles.section}>
      <Card.Content>
        <Title style={styles.sectionTitle}>{t[language].notificationSettings.title}</Title>
        
        <List.Item
          title={t[language].notificationSettings.meetings}
          left={(props) => <List.Icon {...props} icon="calendar" />}
          right={() => (
            <Switch
              value={preferences?.notification_meetings || false}
              onValueChange={(value) => updatePreference('notification_meetings', value)}
            />
          )}
        />
        
        <List.Item
          title={t[language].notificationSettings.tasks}
          left={(props) => <List.Icon {...props} icon="checkbox-marked" />}
          right={() => (
            <Switch
              value={preferences?.notification_tasks || false}
              onValueChange={(value) => updatePreference('notification_tasks', value)}
            />
          )}
        />
        
        <List.Item
          title={t[language].notificationSettings.insights}
          left={(props) => <List.Icon {...props} icon="brain" />}
          right={() => (
            <Switch
              value={preferences?.notification_insights || false}
              onValueChange={(value) => updatePreference('notification_insights', value)}
            />
          )}
        />
        
        <List.Item
          title={t[language].notificationSettings.updates}
          left={(props) => <List.Icon {...props} icon="update" />}
          right={() => (
            <Switch
              value={preferences?.notification_updates || false}
              onValueChange={(value) => updatePreference('notification_updates', value)}
            />
          )}
        />
      </Card.Content>
    </Card>
  );

  const renderPrivacySettings = () => (
    <Card style={styles.section}>
      <Card.Content>
        <Title style={styles.sectionTitle}>{t[language].privacySettings.title}</Title>
        
        <List.Item
          title={t[language].privacySettings.dataCollection}
          left={(props) => <List.Icon {...props} icon="database" />}
          right={() => (
            <Switch
              value={preferences?.privacy_data_collection || false}
              onValueChange={(value) => updatePreference('privacy_data_collection', value)}
            />
          )}
        />
        
        <List.Item
          title={t[language].privacySettings.analytics}
          left={(props) => <List.Icon {...props} icon="chart-line" />}
          right={() => (
            <Switch
              value={preferences?.privacy_analytics || false}
              onValueChange={(value) => updatePreference('privacy_analytics', value)}
            />
          )}
        />
        
        <List.Item
          title={t[language].privacySettings.crashReports}
          left={(props) => <List.Icon {...props} icon="bug" />}
          right={() => (
            <Switch
              value={preferences?.privacy_crash_reports || false}
              onValueChange={(value) => updatePreference('privacy_crash_reports', value)}
            />
          )}
        />
        
        <List.Item
          title={t[language].privacySettings.location}
          left={(props) => <List.Icon {...props} icon="map-marker" />}
          right={() => (
            <Switch
              value={preferences?.privacy_location || false}
              onValueChange={(value) => updatePreference('privacy_location', value)}
            />
          )}
        />
      </Card.Content>
    </Card>
  );

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
            left={(props) => <List.Icon {...props} icon="api" />}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
          />
        </TouchableOpacity>
        
        <Divider />
        
        <TouchableOpacity
          onPress={() => navigation.navigate('Privacy')}
          style={styles.navItem}
        >
          <List.Item
            title="Privacy Policy"
            description="Read our privacy policy"
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
            left={(props) => <List.Icon {...props} icon="file-document" />}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
          />
        </TouchableOpacity>
        
        <Divider />
        
        <List.Item
          title={t[language].about}
          description={`${t[language].version} 1.0.0`}
          left={(props) => <List.Icon {...props} icon="information" />}
        />
      </Card.Content>
    </Card>
  );

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
          <MaterialIcons name="arrow-back" size={24} color="#1e293b" />
        </TouchableOpacity>
        
        <View style={styles.headerContent}>
          <Title style={styles.title}>{t[language].title}</Title>
          <Paragraph style={styles.subtitle}>{t[language].subtitle}</Paragraph>
        </View>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {renderProfileSection()}
        {renderNotificationSettings()}
        {renderPrivacySettings()}
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
          
          <Button
            mode="outlined"
            onPress={handleLogout}
            style={styles.logoutButton}
            textColor="#ef4444"
          >
            {t[language].logout}
          </Button>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F2F2F7",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 20,
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  backButton: {
    marginRight: 16,
    padding: 4,
  },
  headerContent: {
    flex: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: "#64748b",
  },
  content: {
    flex: 1,
    padding: 20,
  },
  section: {
    marginBottom: 20,
    elevation: 2,
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
  },
  profileEmail: {
    fontSize: 14,
    color: "#64748b",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 16,
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
  },
  logoutButton: {
    borderColor: "#ef4444",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: "#64748b",
  },
});
