import React from 'react';
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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
  const handleGetStarted = () => {
    if (onGetStarted) {
      onGetStarted();
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
      getStartedButton: {
        backgroundColor: '#3B82F6',
        paddingVertical: buttonDims.paddingVertical,
        paddingHorizontal: buttonDims.paddingHorizontal,
        borderRadius: buttonDims.borderRadius,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOffset: {
          width: 0,
          height: 4,
        },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 8,
        minWidth: isSmall ? scaleWidth(200) : scaleWidth(250),
      },
      getStartedText: {
        fontSize: buttonDims.fontSize,
        fontWeight: 'bold',
        color: '#ffffff',
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

          {/* Get Started Button */}
          <TouchableOpacity style={styles.getStartedButton} onPress={handleGetStarted}>
            <Text style={styles.getStartedText}>Get Started</Text>
          </TouchableOpacity>
        </View>
      </ImageBackground>
    </SafeAreaView>
  );
}
