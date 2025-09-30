import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  PanResponder,
  Animated,
  TouchableOpacity,
  Alert,
  Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

const FloatingMeetingWidget = ({ 
  nextMeeting, 
  onPress, 
  onClose, 
  visible = true,
  initialPosition = { x: 50, y: 100 }
}) => {
  const [timeUntilMeeting, setTimeUntilMeeting] = useState('');
  const pan = useRef(new Animated.ValueXY(initialPosition)).current;
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current;

  // Create pan responder for dragging
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        pan.setOffset({
          x: pan.x._value,
          y: pan.y._value,
        });
      },
      onPanResponderMove: Animated.event(
        [null, { dx: pan.x, dy: pan.y }],
        { useNativeDriver: false }
      ),
      onPanResponderRelease: (evt, gestureState) => {
        pan.flattenOffset();
        
        // Snap to edges
        const { dx, dy } = gestureState;
        const finalX = pan.x._value;
        const finalY = pan.y._value;
        
        // Keep within screen bounds
        const boundedX = Math.max(0, Math.min(screenWidth - 60, finalX));
        const boundedY = Math.max(50, Math.min(screenHeight - 110, finalY));
        
        // Snap to left or right edge
        const snapX = boundedX < screenWidth / 2 ? 10 : screenWidth - 70;
        
        Animated.spring(pan, {
          toValue: { x: snapX, y: boundedY },
          useNativeDriver: false,
        }).start();
      },
    })
  ).current;

  // Calculate time until next meeting
  useEffect(() => {
    if (!nextMeeting) {
      setTimeUntilMeeting('');
      return;
    }

    const updateTimer = () => {
      const now = new Date();
      const meetingTime = new Date(nextMeeting.startTime || `${nextMeeting.date}T${nextMeeting.time}`);
      const diff = meetingTime - now;

      if (diff <= 0) {
        setTimeUntilMeeting('NOW');
      } else if (diff < 60000) { // Less than 1 minute
        setTimeUntilMeeting('<1m');
      } else if (diff < 3600000) { // Less than 1 hour
        const minutes = Math.floor(diff / 60000);
        setTimeUntilMeeting(`${minutes}m`);
      } else if (diff < 86400000) { // Less than 1 day
        const hours = Math.floor(diff / 3600000);
        const minutes = Math.floor((diff % 3600000) / 60000);
        setTimeUntilMeeting(hours > 0 ? `${hours}h` : `${minutes}m`);
      } else {
        const days = Math.floor(diff / 86400000);
        setTimeUntilMeeting(`${days}d`);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 30000); // Update every 30 seconds

    return () => clearInterval(interval);
  }, [nextMeeting]);

  // Handle visibility changes
  useEffect(() => {
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [visible]);

  const getWidgetColor = () => {
    if (!nextMeeting) return '#6b7280'; // Gray - no meetings
    
    const now = new Date();
    const meetingTime = new Date(nextMeeting.startTime || `${nextMeeting.date}T${nextMeeting.time}`);
    const diff = meetingTime - now;

    if (diff <= 0) return '#ef4444'; // Red - meeting now
    if (diff <= 300000) return '#f59e0b'; // Orange - 5 minutes
    if (diff <= 900000) return '#eab308'; // Yellow - 15 minutes
    return '#10b981'; // Green - upcoming
  };

  const getWidgetIcon = () => {
    if (!nextMeeting) return 'event-busy';
    
    const now = new Date();
    const meetingTime = new Date(nextMeeting.startTime || `${nextMeeting.date}T${nextMeeting.time}`);
    const diff = meetingTime - now;

    if (diff <= 0) return 'play-circle-filled'; // Meeting now
    if (diff <= 300000) return 'notification-important'; // 5 minutes
    return 'event'; // Upcoming
  };

  if (!visible) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          opacity,
          transform: pan.getTranslateTransform(),
        },
      ]}
      {...panResponder.panHandlers}
    >
      <TouchableOpacity
        style={[
          styles.floatingWidget,
          { backgroundColor: getWidgetColor() }
        ]}
        onPress={onPress}
        activeOpacity={0.8}
      >
        <View style={styles.widgetContent}>
          <MaterialIcons
            name={getWidgetIcon()}
            size={20}
            color="white"
          />
          {timeUntilMeeting && (
            <Text style={styles.timeText}>{timeUntilMeeting}</Text>
          )}
        </View>
      </TouchableOpacity>
      
      {/* Close button */}
      <TouchableOpacity
        style={styles.closeButton}
        onPress={onClose}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <MaterialIcons name="close" size={12} color="white" />
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    zIndex: 1000,
    elevation: 1000,
  },
  floatingWidget: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  widgetContent: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  timeText: {
    color: 'white',
    fontSize: 8,
    fontWeight: 'bold',
    textAlign: 'center',
    marginTop: 2,
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  closeButton: {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
});

export default FloatingMeetingWidget;
