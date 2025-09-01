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
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import RedirectURIDebug from "@/components/RedirectURIDebug";
import OAuthTest from "@/components/OAuthTest";

export default function Auth({ navigation }) {
  const { isDarkMode } = useTheme();
  const { login, signup, signInWithGoogle } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    confirmPassword: "",
    name: "",
  });
  const [isLoading, setIsLoading] = useState(false);
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
    es: {
      title: "MeetingGuard",
      subtitle: "Asegura tus reuniones con IA",
      loginTitle: "Bienvenido de Vuelta",
      signupTitle: "Crear Cuenta",
      loginSubtitle: "Inicia sesión para continuar a tu panel",
      signupSubtitle: "Crea tu cuenta para comenzar",
      email: "Correo Electrónico",
      password: "Contraseña",
      confirmPassword: "Confirmar Contraseña",
      name: "Nombre Completo",
      login: "Iniciar Sesión",
      signup: "Registrarse",
      forgotPassword: "¿Olvidaste tu contraseña?",
      noAccount: "¿No tienes una cuenta?",
      hasAccount: "¿Ya tienes una cuenta?",
      signUpHere: "Regístrate aquí",
      signInHere: "Inicia sesión aquí",
      emailPlaceholder: "Ingresa tu correo electrónico",
      passwordPlaceholder: "Ingresa tu contraseña",
      namePlaceholder: "Ingresa tu nombre completo",
      loginSuccess: "¡Inicio de sesión exitoso!",
      signupSuccess: "¡Cuenta creada exitosamente!",
      error: "Ocurrió un error. Por favor intenta de nuevo.",
      invalidEmail: "Por favor ingresa un correo electrónico válido",
      passwordMismatch: "Las contraseñas no coinciden",
      weakPassword: "La contraseña debe tener al menos 6 caracteres",
      emptyFields: "Por favor completa todos los campos",
      orContinueWith: "O continúa con",
      signInWithGoogle: "Iniciar sesión con Google",
      signUpWithGoogle: "Registrarse con Google",
    },
  };

  const validateForm = () => {
    const { email, password, confirmPassword, name } = formData;
    
    if (!email || !password || (!isLogin && (!name || !confirmPassword))) {
      Alert.alert("Error", t.en.emptyFields);
      return false;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      Alert.alert("Error", t.en.invalidEmail);
      return false;
    }

    if (password.length < 6) {
      Alert.alert("Error", t.en.weakPassword);
      return false;
    }

    if (!isLogin && password !== confirmPassword) {
      Alert.alert("Error", t.en.passwordMismatch);
      return false;
    }

    return true;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;

    setIsLoading(true);
    try {
      let result;
      
      if (isLogin) {
        result = await login(formData.email, formData.password);
      } else {
        result = await signup(formData.name, formData.email, formData.password);
      }
      
             if (result.success) {
         Alert.alert(
           "Success",
           isLogin ? t.en.loginSuccess : t.en.signupSuccess,
           [
             {
               text: "OK",
               onPress: () => {
                 // Authentication state will automatically trigger navigation
                 console.log("Authentication successful");
               },
             },
           ]
         );
       } else {
         Alert.alert("Error", result.error || t.en.error);
       }
    } catch (error) {
      Alert.alert("Error", t.en.error);
    } finally {
      setIsLoading(false);
    }
  };

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
        Alert.alert("Error", result.error || t.en.error);
      }
    } catch (error) {
      console.log('=== AUTH PAGE: GOOGLE SIGN IN EXCEPTION ===');
      console.error('Exception:', error);
      Alert.alert("Error", t.en.error);
    } finally {
      setIsLoading(false);
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

          {/* Debug Component - Remove after fixing */}
          {/* <RedirectURIDebug /> */}

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
                  left={<TextInput.Icon icon="lock-check" />}
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
                style={styles.submitButton}
                loading={isLoading}
                disabled={isLoading}
              >
                {isLogin ? t.en.login : t.en.signup}
              </Button>

              <View style={styles.dividerContainer}>
                <View style={styles.divider} />
                <Text style={styles.dividerText}>{t.en.orContinueWith}</Text>
                <View style={styles.divider} />
              </View>

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
                  {isLogin ? t.en.signInWithGoogle : t.en.signUpWithGoogle}
                </Text>
              </TouchableOpacity>

              {isLogin && (
                <TouchableOpacity style={styles.forgotPassword}>
                  <Text style={styles.forgotPasswordText}>
                    {t.en.forgotPassword}
                  </Text>
                </TouchableOpacity>
              )}
            </Card.Content>
          </Card>

          <View style={styles.switchContainer}>
             <Text style={styles.switchText}>
               {isLogin ? t.en.noAccount : t.en.hasAccount}
             </Text>
             <TouchableOpacity onPress={toggleMode}>
               <Text style={styles.switchLink}>
                 {isLogin ? t.en.signUpHere : t.en.signInHere}
               </Text>
             </TouchableOpacity>
           </View>
           
                       {/* Temporary debug button - remove in production */}
            {/* <TouchableOpacity 
              style={styles.debugButton}
              onPress={async () => {
                await AsyncStorage.clear();
                console.log("Storage cleared");
              }}
            >
              <Text style={styles.debugButtonText}>Clear Storage (Debug)</Text>
            </TouchableOpacity> */}
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
      marginBottom: 40,
    },
    appTitle: {
      fontSize: 28,
      fontWeight: "bold",
      marginTop: 16,
      color: isDarkMode ? "#f1f5f9" : "#1e293b",
    },
    appSubtitle: {
      fontSize: 16,
      marginTop: 8,
      textAlign: "center",
      color: isDarkMode ? "#94a3b8" : "#64748b",
    },
    card: {
      backgroundColor: isDarkMode ? "#1e293b" : "#ffffff",
      borderRadius: 16,
      elevation: 4,
      shadowColor: isDarkMode ? "#000" : "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: isDarkMode ? 0.3 : 0.1,
      shadowRadius: 8,
    },
    formTitle: {
      fontSize: 24,
      fontWeight: "bold",
      marginBottom: 8,
      color: isDarkMode ? "#f1f5f9" : "#1e293b",
    },
    formSubtitle: {
      fontSize: 14,
      marginBottom: 24,
      color: isDarkMode ? "#94a3b8" : "#64748b",
    },
    input: {
      marginBottom: 16,
      backgroundColor: isDarkMode ? "#334155" : "#f8fafc",
    },
    submitButton: {
      marginTop: 8,
      marginBottom: 16,
      paddingVertical: 8,
      borderRadius: 8,
    },
    dividerContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      marginVertical: 20,
    },
    divider: {
      flex: 1,
      height: 1,
      backgroundColor: isDarkMode ? '#475569' : '#e2e8f0',
    },
    dividerText: {
      marginHorizontal: 16,
      color: isDarkMode ? '#94a3b8' : '#64748b',
      fontSize: 14,
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
    forgotPassword: {
      alignItems: "center",
      marginTop: 8,
    },
    forgotPasswordText: {
      color: isDarkMode ? "#60a5fa" : "#3b82f6",
      fontSize: 14,
    },
    switchContainer: {
      flexDirection: "row",
      justifyContent: "center",
      alignItems: "center",
      marginTop: 24,
      gap: 4,
    },
    switchText: {
      color: isDarkMode ? "#94a3b8" : "#64748b",
      fontSize: 14,
    },
         switchLink: {
       color: isDarkMode ? "#60a5fa" : "#3b82f6",
       fontSize: 14,
       fontWeight: "600",
     },
     debugButton: {
       marginTop: 16,
       padding: 12,
       backgroundColor: isDarkMode ? "#dc2626" : "#ef4444",
       borderRadius: 8,
       alignItems: "center",
     },
     debugButtonText: {
       color: "#ffffff",
       fontSize: 12,
       fontWeight: "500",
     },
  }); 