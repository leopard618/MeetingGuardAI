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
import { useTranslation } from '../components/translations.jsx';
import { useGoogleAuth } from '../hooks/useGoogleAuth';

export default function AuthNew({ navigation }) {
  const { isDarkMode } = useTheme();
  const { signInWithGoogle } = useAuth();
  const { user, isLoading, isSignedIn, signIn, signOut, redirectUri } = useGoogleAuth();
  const [isLoadingAuth, setIsLoadingAuth] = useState(false);

  const { t } = useTranslation("en"); // AuthNew page is always in English for now


  const handleGoogleSignIn = async () => {
    console.log('=== AUTH NEW PAGE: GOOGLE SIGN IN CLICKED ===');
    setIsLoadingAuth(true);
    try {
      console.log('=== AUTH NEW PAGE: CALLING signInWithGoogle ===');
      const result = await signInWithGoogle();
      console.log('=== AUTH NEW PAGE: signInWithGoogle RESULT ===');
      console.log('Result:', result);
      
      if (result.success) {
        console.log('=== AUTH NEW PAGE: GOOGLE SIGN IN SUCCESS ===');
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
        console.log('=== AUTH NEW PAGE: GOOGLE SIGN IN FAILED ===');
        console.log('Error:', result.error);
        Alert.alert("Error", result.error || t('auth.error'));
      }
    } catch (error) {
      console.log('=== AUTH NEW PAGE: GOOGLE SIGN IN EXCEPTION ===');
      console.error('Exception:', error);
      Alert.alert("Error", t('auth.error'));
    } finally {
      setIsLoadingAuth(false);
    }
  };


  const styles = getStyles(isDarkMode);

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardView}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.header}>
            <MaterialIcons
              name="security"
              size={60}
              color={isDarkMode ? "#60a5fa" : "#3b82f6"}
            />
            <Title style={styles.appTitle}>{t('auth.title')}</Title>
            <Paragraph style={styles.appSubtitle}>{t('auth.subtitle')}</Paragraph>
          </View>

          <Card style={styles.card}>
            <Card.Content>
              <Title style={styles.formTitle}>
                {t('auth.signInTitle')}
              </Title>
              <Paragraph style={styles.formSubtitle}>
                {t('auth.signInSubtitle')}
              </Paragraph>

              <Button
                mode="outlined"
                onPress={handleGoogleSignIn}
                loading={isLoadingAuth}
                disabled={isLoadingAuth}
                style={styles.googleButton}
                icon="google"
              >
                {t('auth.signInWithGoogle')}
              </Button>

            </Card.Content>
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const getStyles = (isDarkMode) =>
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
      padding: 20,
    },
    header: {
      alignItems: "center",
      marginBottom: 30,
    },
    appTitle: {
      fontSize: 28,
      fontWeight: "bold",
      color: isDarkMode ? "#f1f5f9" : "#1e293b",
      marginTop: 10,
    },
    appSubtitle: {
      fontSize: 16,
      color: isDarkMode ? "#94a3b8" : "#64748b",
      textAlign: "center",
      marginTop: 5,
    },
    card: {
      backgroundColor: isDarkMode ? "#1e293b" : "#ffffff",
      borderRadius: 12,
      elevation: 4,
      shadowColor: isDarkMode ? "#000" : "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: isDarkMode ? 0.3 : 0.1,
      shadowRadius: 4,
    },
    formTitle: {
      fontSize: 24,
      fontWeight: "bold",
      color: isDarkMode ? "#f1f5f9" : "#1e293b",
      marginBottom: 8,
      textAlign: "center",
    },
    formSubtitle: {
      fontSize: 14,
      color: isDarkMode ? "#94a3b8" : "#64748b",
      marginBottom: 24,
      textAlign: "center",
    },
    googleButton: {
      marginBottom: 16,
      borderColor: isDarkMode ? "#60a5fa" : "#3b82f6",
    },
    infoText: {
      fontSize: 14,
      color: isDarkMode ? '#94a3b8' : '#64748b',
      textAlign: 'center',
      marginTop: 16,
      lineHeight: 20,
    },
  });

