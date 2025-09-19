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

const { width, height } = Dimensions.get('window');

export default function LandingPage({ onGetStarted }) {
  const handleGetStarted = () => {
    if (onGetStarted) {
      onGetStarted();
    }
  };

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

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  backgroundImage: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  header: {
    paddingTop: 70,
    alignItems: 'center',
  },
  logoWithTitle: {
    height: 80,
  },
  mainContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  mainTitle: {
    fontSize: 40,
    fontWeight: 'bold',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 100,
    lineHeight: 45,
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  alarmContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 50,
    height: 200,
    width: 300,
  },
  alarmMark: {
    width: 280,
    height: 280,
  },
  description: {
    fontSize: 16,
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 50,
    lineHeight: 24,
    paddingHorizontal: 40,
    fontWeight: '500',
  },
  getStartedButton: {
    backgroundColor: '#3B82F6',
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 12,
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
  },
  getStartedText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#ffffff',
  },
});