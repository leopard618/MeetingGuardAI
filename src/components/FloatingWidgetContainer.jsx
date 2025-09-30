import React, { useState, useEffect } from 'react';
import { View, StyleSheet, AppState } from 'react-native';
import FloatingMeetingWidget from './FloatingMeetingWidget';
import FloatingWidgetManager from '../services/FloatingWidgetManager';

const FloatingWidgetContainer = ({ navigation, onNavigateToMeeting }) => {
  const [nextMeeting, setNextMeeting] = useState(null);
  const [widgetVisible, setWidgetVisible] = useState(false);
  const [appState, setAppState] = useState(AppState.currentState);

  useEffect(() => {
    // Initialize the floating widget manager
    const initializeWidget = async () => {
      await FloatingWidgetManager.initialize();
      
      // Set up callbacks
      FloatingWidgetManager.setCallbacks({
        onMeetingUpdate: (meeting) => {
          setNextMeeting(meeting);
          updateWidgetVisibility(meeting);
        },
        onWidgetPress: handleWidgetPress,
        onWidgetClose: handleWidgetClose,
      });
      
      // Get initial data
      const widgetData = FloatingWidgetManager.getWidgetData();
      setNextMeeting(widgetData.nextMeeting);
      updateWidgetVisibility(widgetData.nextMeeting);
    };

    initializeWidget();

    // Listen for app state changes
    const appStateSubscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      appStateSubscription?.remove();
      FloatingWidgetManager.cleanup();
    };
  }, []);

  const updateWidgetVisibility = (meeting) => {
    const shouldShow = FloatingWidgetManager.shouldShowWidget();
    setWidgetVisible(shouldShow && appState !== 'active');
  };

  const handleAppStateChange = (nextAppState) => {
    setAppState(nextAppState);
    
    // Show widget when app goes to background, hide when active
    if (nextAppState === 'background' || nextAppState === 'inactive') {
      const shouldShow = FloatingWidgetManager.shouldShowWidget();
      setWidgetVisible(shouldShow);
    } else if (nextAppState === 'active') {
      setWidgetVisible(false);
    }
  };

  const handleWidgetPress = (meeting) => {
    console.log('🎯 Widget pressed, navigating to meeting:', meeting?.title);
    
    // Hide widget
    setWidgetVisible(false);
    
    // Navigate to meeting details or dashboard
    if (meeting && onNavigateToMeeting) {
      onNavigateToMeeting(meeting);
    } else if (navigation) {
      // Default navigation to dashboard or meetings list
      navigation.navigate('Dashboard');
    }
  };

  const handleWidgetClose = () => {
    console.log('❌ Widget closed by user');
    setWidgetVisible(false);
    
    // Temporarily disable widget for 1 hour
    setTimeout(() => {
      const shouldShow = FloatingWidgetManager.shouldShowWidget();
      if (shouldShow && appState !== 'active') {
        setWidgetVisible(true);
      }
    }, 60 * 60 * 1000); // 1 hour
  };

  const handleToggleWidget = async (enabled) => {
    await FloatingWidgetManager.setEnabled(enabled);
    
    if (enabled) {
      const shouldShow = FloatingWidgetManager.shouldShowWidget();
      setWidgetVisible(shouldShow && appState !== 'active');
    } else {
      setWidgetVisible(false);
    }
  };

  // Expose toggle function for settings
  React.useImperativeHandle(React.createRef(), () => ({
    toggleWidget: handleToggleWidget,
    isEnabled: () => FloatingWidgetManager.getWidgetData().isEnabled,
    getNextMeeting: () => nextMeeting,
  }));

  return (
    <View style={styles.container} pointerEvents="box-none">
      {widgetVisible && (
        <FloatingMeetingWidget
          nextMeeting={nextMeeting}
          onPress={() => handleWidgetPress(nextMeeting)}
          onClose={handleWidgetClose}
          visible={widgetVisible}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 999,
    elevation: 999,
  },
});

export default FloatingWidgetContainer;
