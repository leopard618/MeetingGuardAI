import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
} from "react-native";
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Card,
  Title,
  Paragraph,
  Button,
  TextInput,
  Divider,
} from "react-native-paper";
import { MaterialIcons } from "@expo/vector-icons";
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import RedirectURIDebug from '../components/RedirectURIDebug';
import OAuthTest from '../components/OAuthTest';
import { useTranslation } from '../components/translations.jsx';
import {
  getResponsiveFontSizes,
  getResponsiveSpacing,
  getResponsiveButtonDimensions,
  scaleWidth,
  scaleHeight,
  getDeviceType,
  isSmallDevice,
  isTabletOrLarger,
} from '../utils/responsive';

export default function Auth({ navigation }) {
  const { isDarkMode } = useTheme();
  const { signInWithGoogle } = useAuth();
  const { t } = useTranslation("en"); // Auth page is always in English for now
  const [isLoading, setIsLoading] = useState(false);
  const [logoutMessage, setLogoutMessage] = useState(null);

  // Check if user was automatically logged out
  React.useEffect(() => {
    const checkLogoutReason = async () => {
      try {
        const googleConnectionMonitor = (await import('../api/googleConnectionMonitor')).default;
        const reason = await googleConnectionMonitor.getLogoutReason();
        
        if (reason && reason.reason === 'google_disconnected') {
          setLogoutMessage({
            title: 'Google Calendar Disconnected',
            message: 'You were automatically signed out because your Google Calendar connection expired. Please sign in again to continue using the app.',
            type: 'warning'
          });
        }
      } catch (error) {
        console.log('Error checking logout reason:', error);
      }
    };
    
    checkLogoutReason();
  }, []);


  const handleGoogleSignIn = async () => {
    console.log('=== AUTH PAGE: GOOGLE SIGN IN CLICKED ===');
    setIsLoading(true);
    try {
      console.log('=== AUTH PAGE: CALLING signInWithGoogle ===');
      const result = await signInWithGoogle();
      console.log('=== AUTH PAGE: signInWithGoogle RESULT ===');
      console.log('Result:', result);
      
      if (result.success) {
        console.log('=== AUTH PAGE: GOOGLE SIGN IN SUCCESS ===');
        Alert.alert(
          "Success",
          "Google sign-in successful!",
          [
            {
              text: "OK",
              onPress: () => {
                console.log("Google authentication successful");
              },
            },
          ]
        );
      } else {
        console.log('=== AUTH PAGE: GOOGLE SIGN IN FAILED ===');
        console.log('Error:', result.error);
        Alert.alert("Error", result.error || t('auth.error'));
      }
    } catch (error) {
      console.log('=== AUTH PAGE: GOOGLE SIGN IN EXCEPTION ===');
      console.error('Exception:', error);
      Alert.alert("Error", t('auth.error'));
    } finally {
      setIsLoading(false);
    }
  };


  // Get responsive values
  const fonts = getResponsiveFontSizes();
  const spacing = getResponsiveSpacing();
  const buttonDims = getResponsiveButtonDimensions();
  const isSmall = isSmallDevice();
  const isTablet = isTabletOrLarger();

  const styles = getStyles(isDarkMode, fonts, spacing, buttonDims, isSmall, isTablet);

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardView}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Automatic Logout Warning */}
          {logoutMessage && (
            <Card style={[styles.warningCard, { backgroundColor: isDarkMode ? '#451a03' : '#fef3c7', marginBottom: 16 }]}>
              <Card.Content>
                <View style={styles.warningHeader}>
                  <MaterialIcons
                    name="warning"
                    size={24}
                    color={isDarkMode ? '#f59e0b' : '#d97706'}
                  />
                  <Text style={[styles.warningTitle, { color: isDarkMode ? '#f59e0b' : '#d97706' }]}>
                    {logoutMessage.title}
                  </Text>
                </View>
                <Text style={[styles.warningMessage, { color: isDarkMode ? '#fbbf24' : '#92400e' }]}>
                  {logoutMessage.message}
                </Text>
                <TouchableOpacity
                  style={styles.dismissButton}
                  onPress={() => setLogoutMessage(null)}
                >
                  <Text style={[styles.dismissText, { color: isDarkMode ? '#f59e0b' : '#d97706' }]}>
                    Dismiss
                  </Text>
                </TouchableOpacity>
              </Card.Content>
            </Card>
          )}
          
          <View style={styles.header}>
            <Image
              source={require('../../assets/icon.png')}
              style={styles.logoImage}
              resizeMode="contain"
            />
            <Title style={styles.appTitle}>{t('auth.title')}</Title>
          </View>

          <Card style={styles.card}>
            <Card.Content>
              <Title style={styles.formTitle}>
                {t('auth.signInTitle')}
              </Title>
              <Paragraph style={styles.formSubtitle}>
                {t('auth.signInSubtitle')}
              </Paragraph>

              <TouchableOpacity
                style={styles.googleButton}
                onPress={handleGoogleSignIn}
                disabled={isLoading}
              >
                <MaterialIcons
                  name="g-translate"
                  size={24}
                  color={isDarkMode ? "#ffffff" : "#000000"}
                />
                <Text style={styles.googleButtonText}>
                  {t('auth.signInWithGoogle')}
                </Text>
              </TouchableOpacity>
            </Card.Content>
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const getStyles = (isDarkMode, fonts, spacing, buttonDims, isSmall, isTablet) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: isDarkMode ? "#0f172a" : "#f8fafc",
    },
    keyboardView: {
      flex: 1,
    },
    scrollContent: {
      flexGrow: 1,
      justifyContent: "center",
      padding: isSmall ? spacing['lg'] : spacing['xl'],
    },
    header: {
      alignItems: "center",
      marginBottom: isSmall ? spacing['2xl'] : spacing['3xl'],
    },
    warningCard: {
      borderRadius: 12,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: isDarkMode ? '#f59e0b' : '#d97706',
    },
    warningHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 8,
    },
    warningTitle: {
      marginLeft: 8,
      fontSize: 16,
      fontWeight: '600',
    },
    warningMessage: {
      fontSize: 14,
      lineHeight: 20,
      marginBottom: 12,
    },
    dismissButton: {
      alignSelf: 'flex-end',
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    dismissText: {
      fontSize: 14,
      fontWeight: '500',
    },
    logoImage: {
      width: isSmall ? scaleWidth(150) : isTablet ? scaleWidth(250) : scaleWidth(200),
      height: isSmall ? scaleHeight(75) : isTablet ? scaleHeight(125) : scaleHeight(100),
    },
    appTitle: {
      fontSize: isSmall ? fonts['2xl'] : isTablet ? fonts['3xl'] + 4 : fonts['3xl'],
      fontWeight: "bold",
      marginTop: spacing['lg'],
      color: isDarkMode ? "#f1f5f9" : "#1e293b",
    },
    appSubtitle: {
      fontSize: isSmall ? fonts['md'] : fonts['lg'],
      marginTop: spacing['sm'],
      textAlign: "center",
      color: isDarkMode ? "#94a3b8" : "#64748b",
    },
    card: {
      backgroundColor: isDarkMode ? "#1e293b" : "#ffffff",
      borderRadius: isSmall ? spacing['lg'] : spacing['xl'],
      elevation: 4,
      shadowColor: isDarkMode ? "#000" : "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: isDarkMode ? 0.3 : 0.1,
      shadowRadius: 8,
      padding: isSmall ? spacing['lg'] : spacing['2xl'],
    },
    formTitle: {
      fontSize: isSmall ? fonts['xl'] : isTablet ? fonts['2xl'] + 2 : fonts['2xl'],
      fontWeight: "bold",
      marginBottom: spacing['sm'],
      color: isDarkMode ? "#f1f5f9" : "#1e293b",
      textAlign: "center",
    },
    formSubtitle: {
      fontSize: isSmall ? fonts['sm'] : fonts['md'],
      marginBottom: isSmall ? spacing['lg'] : spacing['2xl'],
      color: isDarkMode ? "#94a3b8" : "#64748b",
      textAlign: "center",
    },
    googleButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDarkMode ? '#374151' : '#ffffff',
      borderWidth: 1,
      borderColor: isDarkMode ? '#4b5563' : '#d1d5db',
      borderRadius: 8,
      paddingVertical: 12,
      paddingHorizontal: 16,
      marginBottom: 16,
      gap: 12,
    },
    googleButtonText: {
      fontSize: 16,
      fontWeight: '500',
      color: isDarkMode ? '#f1f5f9' : '#1e293b',
    },
    infoText: {
      fontSize: 14,
      color: isDarkMode ? '#94a3b8' : '#64748b',
      textAlign: 'center',
      marginTop: 16,
      lineHeight: 20,
    },
  }); 