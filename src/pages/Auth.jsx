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

export default function Auth({ navigation }) {
  const { isDarkMode } = useTheme();
  const { login, signup, signInWithGoogle } = useAuth();
  const { t } = useTranslation("en"); // Auth page is always in English for now
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

  const validateForm = () => {
    const { email, password, confirmPassword, name } = formData;
    
    if (!email || !password || (!isLogin && (!name || !confirmPassword))) {
      Alert.alert("Error", t('auth.emptyFields'));
      return false;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      Alert.alert("Error", t('auth.invalidEmail'));
      return false;
    }

    if (password.length < 6) {
      Alert.alert("Error", t('auth.weakPassword'));
      return false;
    }

    if (!isLogin && password !== confirmPassword) {
      Alert.alert("Error", t('auth.passwordMismatch'));
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
           isLogin ? t('auth.loginSuccess') : t('auth.signupSuccess'),
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
         Alert.alert("Error", result.error || t('auth.error'));
       }
    } catch (error) {
      Alert.alert("Error", t('auth.error'));
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
            <Image
              source={require('../../assets/icon.png')}
              style={styles.logoImage}
              resizeMode="contain"
            />
            <Title style={styles.appTitle}>{t('auth.title')}</Title>
          </View>

          {/* Debug Component - Remove after fixing */}
          {/* <RedirectURIDebug /> */}

          <Card style={styles.card}>
            <Card.Content>
              {/* <Title style={styles.formTitle}>
                {isLogin ? t('auth.loginTitle') : t('auth.signupTitle')}
              </Title>
              <Paragraph style={styles.formSubtitle}>
                {isLogin ? t('auth.loginSubtitle') : t('auth.signupSubtitle')}
              </Paragraph> */}

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
                {isLogin ? t('auth.login') : t('auth.signup')}
              </Button>

              <View style={styles.dividerContainer}>
                <View style={styles.divider} />
                <Text style={styles.dividerText}>{t('auth.orContinueWith')}</Text>
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
                  {isLogin ? t('auth.signInWithGoogle') : t('auth.signUpWithGoogle')}
                </Text>
              </TouchableOpacity>

              {isLogin && (
                <TouchableOpacity style={styles.forgotPassword}>
                  <Text style={styles.forgotPasswordText}>
                    {t('auth.forgotPassword')}
                  </Text>
                </TouchableOpacity>
              )}
            </Card.Content>
          </Card>

          <View style={styles.switchContainer}>
             <Text style={styles.switchText}>
               {isLogin ? t('auth.noAccount') : t('auth.hasAccount')}
             </Text>
             <TouchableOpacity onPress={toggleMode}>
               <Text style={styles.switchLink}>
                 {isLogin ? t('auth.signUpHere') : t('auth.signInHere')}
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
    logoImage: {
      width: 200,
      height: 100,
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