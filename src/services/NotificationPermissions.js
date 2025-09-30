import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

// Configure notification behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function registerForPushNotificationsAsync() {
  let token;

  // Configure Android notification channel for maximum priority
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('meeting-alerts', {
      name: 'Meeting Alerts',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
      sound: 'default',
      enableVibrate: true,
      enableLights: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      bypassDnd: true, // Bypass Do Not Disturb for critical meeting alerts
    });

    // Create a high-priority channel for imminent meetings
    await Notifications.setNotificationChannelAsync('urgent-meeting-alerts', {
      name: 'Urgent Meeting Alerts',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 100, 50, 100, 50, 100, 50, 100],
      lightColor: '#FF0000',
      sound: 'default',
      enableVibrate: true,
      enableLights: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      bypassDnd: true,
    });
  }

  if (Device.isDevice) {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: true,
          allowSound: true,
          allowAnnouncements: true,
          allowCriticalAlerts: true, // For iOS critical alerts
        },
      });
      finalStatus = status;
    }
    
    if (finalStatus !== 'granted') {
      console.warn('Push notification permission not granted');
      return null;
    }
    
    // Get the push token
    try {
      const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
      if (!projectId) {
        throw new Error('Project ID not found');
      }
      
      token = (await Notifications.getExpoPushTokenAsync({
        projectId,
      })).data;
      
      console.log('✅ Push token obtained:', token);
    } catch (error) {
      console.error('Failed to get push token:', error);
      return null;
    }
  } else {
    console.warn('Must use physical device for Push Notifications');
    return null;
  }

  return token;
}

export async function checkNotificationPermissions() {
  const { status } = await Notifications.getPermissionsAsync();
  return status === 'granted';
}

export async function requestCriticalAlertPermissions() {
  if (Platform.OS === 'ios') {
    try {
      const { status } = await Notifications.requestPermissionsAsync({
        ios: {
          allowCriticalAlerts: true,
        },
      });
      return status === 'granted';
    } catch (error) {
      console.error('Failed to request critical alert permissions:', error);
      return false;
    }
  }
  return true; // Android doesn't need special critical alert permissions
}
