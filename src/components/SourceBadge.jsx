import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function SourceBadge({ source, size = "default" }) {
  const getSourceConfig = (source) => {
    switch (source) {
      case "ChatGPT":
        return {
          backgroundColor: '#F3E8FF',
          textColor: '#7C3AED',
          borderColor: '#DDD6FE',
          icon: 'bulb',
          label: "ChatGPT"
        };
      case "WhatsApp":
        return {
          backgroundColor: '#DCFCE7',
          textColor: '#166534',
          borderColor: '#BBF7D0',
          icon: 'chatbubble',
          label: "WhatsApp"
        };
      case "IA":
        return {
          backgroundColor: '#FED7AA',
          textColor: '#EA580C',
          borderColor: '#FDBA74',
          icon: 'construct',
          label: "IA"
        };
      default:
        return {
          backgroundColor: '#F1F5F9',
          textColor: '#475569',
          borderColor: '#E2E8F0',
          icon: 'person',
          label: "Manual"
        };
    }
  };

  const config = getSourceConfig(source);
  
  const sizeStyles = {
    sm: { fontSize: 12, paddingHorizontal: 8, paddingVertical: 4 },
    default: { fontSize: 14, paddingHorizontal: 10, paddingVertical: 6 },
    lg: { fontSize: 16, paddingHorizontal: 12, paddingVertical: 8 }
  };

  return (
    <View style={[
      styles.badge,
      {
        backgroundColor: config.backgroundColor,
        borderColor: config.borderColor,
        ...sizeStyles[size]
      }
    ]}>
      <Ionicons 
        name={config.icon} 
        size={size === 'sm' ? 12 : size === 'lg' ? 16 : 14} 
        color={config.textColor}
        style={styles.icon}
      />
      <Text style={[styles.text, { color: config.textColor }]}>
        {config.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  icon: {
    marginRight: 4,
  },
  text: {
    fontWeight: '500',
  },
});