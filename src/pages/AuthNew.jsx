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

  const t = {
    en: {
      title: "MeetingGuard",
      subtitle: "Secure your meetings with AI",
      loginTitle: "Welcome Back",
      signupTitle: "Create Account",
      loginSubtitle: "Sign in to continue to your dashboard",
      signupSubtitle: "Create your account to get started",
      email: "Email",
      password: "Password",
      confirmPassword: "Confirm Password",
      name: "Full Name",
      login: "Sign In",
      signup: "Sign Up",
      forgotPassword: "Forgot Password?",
      noAccount: "Don't have an account?",
      hasAccount: "Already have an account?",
      signUpHere: "Sign up here",
      signInHere: "Sign in here",
      emailPlaceholder: "Enter your email",
      passwordPlaceholder: "Enter your password",
      namePlaceholder: "Enter your full name",
      loginSuccess: "Login successful!",
      signupSuccess: "Account created successfully!",
      error: "An error occurred. Please try again.",
      invalidEmail: "Please enter a valid email address",
      passwordMismatch: "Passwords do not match",
      weakPassword: "Password must be at least 6 characters",
      emptyFields: "Please fill in all fields",
      orContinueWith: "Or continue with",
      signInWithGoogle: "Sign in with Google",
      signUpWithGoogle: "Sign up with Google",
    },
  };

  const validateForm = () => {
    if (!formData.email || !formData.password) {
      Alert.alert("Error", t.en.emptyFields);
      return false;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      Alert.alert("Error", t.en.invalidEmail);
      return false;
    }

    if (formData.password.length < 6) {
      Alert.alert("Error", t.en.weakPassword);
      return false;
    }

    if (!isLogin && formData.password !== formData.confirmPassword) {
      Alert.alert("Error", t.en.passwordMismatch);
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
          Alert.alert("Success", t.en.loginSuccess);
        } else {
          Alert.alert("Error", result.error || t.en.error);
        }
      } else {
        const result = await signup(formData.email, formData.password, formData.name);
        if (result.success) {
          Alert.alert("Success", t.en.signupSuccess);
        } else {
          Alert.alert("Error", result.error || t.en.error);
        }
      }
    } catch (error) {
      Alert.alert("Error", t.en.error);
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
            <Title style={styles.appTitle}>{t.en.title}</Title>
            <Paragraph style={styles.appSubtitle}>{t.en.subtitle}</Paragraph>
          </View>

          <Card style={styles.card}>
            <Card.Content>
              <Title style={styles.formTitle}>
                {isLogin ? t.en.loginTitle : t.en.signupTitle}
              </Title>
              <Paragraph style={styles.formSubtitle}>
                {isLogin ? t.en.loginSubtitle : t.en.signupSubtitle}
              </Paragraph>

              {!isLogin && (
                <TextInput
                  label={t.en.name}
                  value={formData.name}
                  onChangeText={(text) =>
                    setFormData({ ...formData, name: text })
                  }
                  mode="outlined"
                  style={styles.input}
                  placeholder={t.en.namePlaceholder}
                  left={<TextInput.Icon icon="account-circle" />}
                />
              )}

              <TextInput
                label={t.en.email}
                value={formData.email}
                onChangeText={(text) =>
                  setFormData({ ...formData, email: text })
                }
                mode="outlined"
                style={styles.input}
                placeholder={t.en.emailPlaceholder}
                keyboardType="email-address"
                autoCapitalize="none"
                left={<TextInput.Icon icon="email" />}
              />

              <TextInput
                label={t.en.password}
                value={formData.password}
                onChangeText={(text) =>
                  setFormData({ ...formData, password: text })
                }
                mode="outlined"
                style={styles.input}
                placeholder={t.en.passwordPlaceholder}
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
                  label={t.en.confirmPassword}
                  value={formData.confirmPassword}
                  onChangeText={(text) =>
                    setFormData({ ...formData, confirmPassword: text })
                  }
                  mode="outlined"
                  style={styles.input}
                  placeholder={t.en.passwordPlaceholder}
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
                {isLogin ? t.en.login : t.en.signup}
              </Button>

              <Divider style={styles.divider} />

              <Paragraph style={styles.orText}>{t.en.orContinueWith}</Paragraph>

              <Button
                mode="outlined"
                onPress={handleGoogleSignIn}
                loading={isLoading}
                disabled={isLoading}
                style={styles.googleButton}
                icon="google"
              >
                {isLogin ? t.en.signInWithGoogle : t.en.signUpWithGoogle}
              </Button>

              <TouchableOpacity onPress={toggleMode} style={styles.toggleContainer}>
                <Text style={styles.toggleText}>
                  {isLogin ? t.en.noAccount : t.en.hasAccount}{" "}
                  <Text style={styles.toggleLink}>
                    {isLogin ? t.en.signUpHere : t.en.signInHere}
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

