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
  const { login, signup } = useAuth();
  const { user, isLoading, isSignedIn, signIn, signOut, redirectUri } = useGoogleAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    confirmPassword: "",
    name: "",
  });
  const [isLoadingForm, setIsLoadingForm] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const { t } = useTranslation("en"); // AuthNew page is always in English for now

  const validateForm = () => {
    if (!formData.email || !formData.password) {
      Alert.alert("Error", t('auth.emptyFields'));
      return false;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      Alert.alert("Error", t('auth.invalidEmail'));
      return false;
    }

    if (formData.password.length < 6) {
      Alert.alert("Error", t('auth.weakPassword'));
      return false;
    }

    if (!isLogin && formData.password !== formData.confirmPassword) {
      Alert.alert("Error", t('auth.passwordMismatch'));
      return false;
    }

    return true;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;

    setIsLoadingForm(true);
    try {
      if (isLogin) {
        const result = await login(formData.email, formData.password);
        if (result.success) {
          Alert.alert("Success", t('auth.loginSuccess'));
        } else {
          Alert.alert("Error", result.error || t('auth.error'));
        }
      } else {
        const result = await signup(formData.email, formData.password, formData.name);
        if (result.success) {
          Alert.alert("Success", t('auth.signupSuccess'));
        } else {
          Alert.alert("Error", result.error || t('auth.error'));
        }
      }
    } catch (error) {
      Alert.alert("Error", t('auth.error'));
    } finally {
      setIsLoadingForm(false);
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      console.log('Starting Google sign-in with redirect URI:', redirectUri);
      await signIn();
      
      // The success will be handled by the useGoogleAuth hook
      console.log('Google sign-in initiated successfully');
    } catch (error) {
      console.error('Google sign-in error:', error);
      Alert.alert("Error", `Google sign-in failed: ${error.message}`);
    }
  };

  const toggleMode = () => {
    setIsLogin(!isLogin);
    setFormData({
      email: "",
      password: "",
      confirmPassword: "",
      name: "",
    });
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
                {isLogin ? t('auth.loginTitle') : t('auth.signupTitle')}
              </Title>
              <Paragraph style={styles.formSubtitle}>
                {isLogin ? t('auth.loginSubtitle') : t('auth.signupSubtitle')}
              </Paragraph>

              {!isLogin && (
                <TextInput
                  label={t('auth.name')}
                  value={formData.name}
                  onChangeText={(text) =>
                    setFormData({ ...formData, name: text })
                  }
                  mode="outlined"
                  style={styles.input}
                  placeholder={t('auth.namePlaceholder')}
                  left={<TextInput.Icon icon="account-circle" />}
                />
              )}

              <TextInput
                 label={t('auth.email')}
                value={formData.email}
                onChangeText={(text) =>
                  setFormData({ ...formData, email: text })
                }
                mode="outlined"
                style={styles.input}
                 placeholder={t('auth.emailPlaceholder')}
                keyboardType="email-address"
                autoCapitalize="none"
                left={<TextInput.Icon icon="email" />}
              />

              <TextInput
                 label={t('auth.password')}
                value={formData.password}
                onChangeText={(text) =>
                  setFormData({ ...formData, password: text })
                }
                mode="outlined"
                style={styles.input}
                placeholder={t('auth.passwordPlaceholder')}
                secureTextEntry={!showPassword}
                left={<TextInput.Icon icon="lock" />}
                right={
                  <TextInput.Icon
                    icon={showPassword ? "eye-off" : "eye"}
                    onPress={() => setShowPassword(!showPassword)}
                  />
                }
              />

              {!isLogin && (
                <TextInput
                   label={t('auth.confirmPassword')}
                  value={formData.confirmPassword}
                  onChangeText={(text) =>
                    setFormData({ ...formData, confirmPassword: text })
                  }
                  mode="outlined"
                  style={styles.input}
                  placeholder={t('auth.passwordPlaceholder')}
                  secureTextEntry={!showConfirmPassword}
                  left={<TextInput.Icon icon="lock" />}
                  right={
                    <TextInput.Icon
                      icon={showConfirmPassword ? "eye-off" : "eye"}
                      onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                    />
                  }
                />
              )}

              <Button
                mode="contained"
                onPress={handleSubmit}
                loading={isLoadingForm}
                disabled={isLoadingForm}
                style={styles.submitButton}
              >
                {isLogin ? t('auth.login') : t('auth.signup')}
              </Button>

              <Divider style={styles.divider} />

               <Paragraph style={styles.orText}>{t('auth.orContinueWith')}</Paragraph>

              <Button
                mode="outlined"
                onPress={handleGoogleSignIn}
                loading={isLoading}
                disabled={isLoading}
                style={styles.googleButton}
                icon="google"
              >
                {isLogin ? t('auth.signInWithGoogle') : t('auth.signUpWithGoogle')}
              </Button>

              <TouchableOpacity onPress={toggleMode} style={styles.toggleContainer}>
                <Text style={styles.toggleText}>
                  {isLogin ? t('auth.noAccount') : t('auth.hasAccount')}{" "}
                  <Text style={styles.toggleLink}>
                    {isLogin ? t('auth.signUpHere') : t('auth.signInHere')}
                  </Text>
                </Text>
              </TouchableOpacity>
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
    },
    formSubtitle: {
      fontSize: 14,
      color: isDarkMode ? "#94a3b8" : "#64748b",
      marginBottom: 24,
    },
    input: {
      marginBottom: 16,
      backgroundColor: isDarkMode ? "#334155" : "#ffffff",
    },
    submitButton: {
      marginTop: 8,
      marginBottom: 16,
      paddingVertical: 8,
    },
    divider: {
      marginVertical: 20,
      backgroundColor: isDarkMode ? "#334155" : "#e2e8f0",
    },
    orText: {
      textAlign: "center",
      color: isDarkMode ? "#94a3b8" : "#64748b",
      marginBottom: 16,
    },
    googleButton: {
      marginBottom: 16,
      borderColor: isDarkMode ? "#60a5fa" : "#3b82f6",
    },
    toggleContainer: {
      alignItems: "center",
      marginTop: 16,
    },
    toggleText: {
      fontSize: 14,
      color: isDarkMode ? "#94a3b8" : "#64748b",
    },
    toggleLink: {
      color: isDarkMode ? "#60a5fa" : "#3b82f6",
      fontWeight: "bold",
    },
  });

