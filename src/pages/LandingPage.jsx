import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  ImageBackground,
  Image,
  StatusBar,
  Dimensions,
  Alert,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import {
  getResponsiveFontSizes,
  getResponsiveSpacing,
  getResponsiveButtonDimensions,
  scaleWidth,
  scaleHeight,
  getDeviceType,
  isSmallDevice,
  isTabletOrLarger,
  SCREEN_DIMENSIONS,
} from '../utils/responsive';

const { width, height } = Dimensions.get('window');

export default function LandingPage({ onGetStarted }) {
  const { signInWithGoogle } = useAuth();
  const [isLoading, setIsLoading] = useState(false);

  const handleGoogleSignIn = async () => {
    console.log('=== LANDING PAGE: GOOGLE SIGN IN CLICKED ===');
    setIsLoading(true);
    try {
      console.log('=== LANDING PAGE: CALLING signInWithGoogle ===');
      const result = await signInWithGoogle();
      console.log('=== LANDING PAGE: signInWithGoogle RESULT ===');
      console.log('Result:', result);
      
      if (result.success) {
        console.log('=== LANDING PAGE: GOOGLE SIGN IN SUCCESS ===');
        // Authentication state will automatically trigger navigation to dashboard
        console.log('Google authentication successful - will navigate to dashboard');
      } else {
        console.log('=== LANDING PAGE: GOOGLE SIGN IN FAILED ===');
        console.log('Error:', result.error);
        Alert.alert('Error', result.error || 'Google sign-in failed. Please try again.');
      }
    } catch (error) {
      console.log('=== LANDING PAGE: GOOGLE SIGN IN EXCEPTION ===');
      console.error('Exception:', error);
      Alert.alert('Error', 'Google sign-in failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // Get responsive values
  const fonts = getResponsiveFontSizes();
  const spacing = getResponsiveSpacing();
  const buttonDims = getResponsiveButtonDimensions();
  const deviceType = getDeviceType();
  const isSmall = isSmallDevice();
  const isTablet = isTabletOrLarger();

  // Create responsive styles
  const getStyles = () => {
    return StyleSheet.create({
      container: {
        flex: 1,
      },
      backgroundImage: {
        flex: 1,
        width: '100%',
        height: '100%',
      },
      header: {
        paddingTop: isSmall ? spacing['2xl'] : spacing['4xl'],
        alignItems: 'center',
        paddingHorizontal: spacing['lg'],
      },
      logoWithTitle: {
        height: isSmall ? scaleHeight(60) : isTablet ? scaleHeight(100) : scaleHeight(80),
        width: isSmall ? scaleWidth(200) : isTablet ? scaleWidth(300) : scaleWidth(250),
      },
      mainContent: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: spacing['lg'],
      },
      mainTitle: {
        fontSize: isSmall ? fonts['3xl'] : isTablet ? fonts['4xl'] + 8 : fonts['4xl'],
        fontWeight: 'bold',
        color: '#ffffff',
        textAlign: 'center',
        marginBottom: isSmall ? spacing['3xl'] : spacing['4xl'],
        lineHeight: isSmall ? fonts['3xl'] + 8 : isTablet ? fonts['4xl'] + 12 : fonts['4xl'] + 8,
        textShadowColor: 'rgba(0, 0, 0, 0.5)',
        textShadowOffset: { width: 0, height: 2 },
        textShadowRadius: 4,
        paddingHorizontal: spacing['md'],
      },
      alarmContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: isSmall ? spacing['2xl'] : spacing['3xl'],
        height: isSmall ? scaleHeight(150) : isTablet ? scaleHeight(250) : scaleHeight(200),
        width: isSmall ? scaleWidth(250) : isTablet ? scaleWidth(350) : scaleWidth(300),
      },
      alarmMark: {
        width: isSmall ? scaleWidth(200) : isTablet ? scaleWidth(300) : scaleWidth(280),
        height: isSmall ? scaleHeight(200) : isTablet ? scaleHeight(300) : scaleHeight(280),
      },
      description: {
        fontSize: isSmall ? fonts['md'] : isTablet ? fonts['lg'] + 2 : fonts['lg'],
        color: '#ffffff',
        textAlign: 'center',
        marginBottom: isSmall ? spacing['2xl'] : spacing['3xl'],
        lineHeight: isSmall ? fonts['md'] + 6 : isTablet ? fonts['lg'] + 8 : fonts['lg'] + 6,
        paddingHorizontal: isSmall ? spacing['lg'] : spacing['2xl'],
        fontWeight: '500',
      },
      googleSignInButton: {
        backgroundColor: '#ffffff',
        paddingVertical: buttonDims.paddingVertical,
        paddingHorizontal: buttonDims.paddingHorizontal,
        borderRadius: buttonDims.borderRadius,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        shadowColor: '#000',
        shadowOffset: {
          width: 0,
          height: 4,
        },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 8,
        minWidth: isSmall ? scaleWidth(200) : scaleWidth(250),
        gap: 12,
        opacity: isLoading ? 0.7 : 1,
      },
      googleSignInText: {
        fontSize: buttonDims.fontSize,
        fontWeight: 'bold',
        color: '#1f2937',
      },
      googleIcon: {
        marginRight: 4,
      },
    });
  };

  const styles = getStyles();

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      
      <ImageBackground
        source={require('../../assets/bg.jpg')}
        style={styles.backgroundImage}
        resizeMode="cover"
      >
        {/* Header with Logo - using mark_with_title.png */}
        <View style={styles.header}>
          <Image
            source={require('../../assets/mark_with_title.png')}
            style={styles.logoWithTitle}
            resizeMode="contain"
          />
        </View>

        {/* Main Content */}
        <View style={styles.mainContent}>
          {/* Main Headline */}
          <Text style={styles.mainTitle}>
            Impossible-to-Ignore{'\n'}Alerts
          </Text>

          {/* Central Alarm Mark - using alarm_mark.png */}
          <View style={styles.alarmContainer}>
            <Image
              source={require('../../assets/alarm_mark.png')}
              style={styles.alarmMark}
              resizeMode="contain"
            />
          </View>

          {/* Description Text */}
          <Text style={styles.description}>
            Smart, multi-sensory notifications remind you across all devices. Never miss a meeting again!
          </Text>

          {/* Google Sign In Button */}
          <TouchableOpacity 
            style={styles.googleSignInButton} 
            onPress={handleGoogleSignIn}
            disabled={isLoading}
          >
            <MaterialIcons
              name="g-translate"
              size={24}
              color="#1f2937"
              style={styles.googleIcon}
            />
            <Text style={styles.googleSignInText}>
              {isLoading ? 'Signing in...' : 'Sign in with Google'}
            </Text>
          </TouchableOpacity>
        </View>
      </ImageBackground>
    </SafeAreaView>
  );
}
