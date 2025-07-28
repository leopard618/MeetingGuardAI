import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function ConfidenceBadge({ confidence, showIcon = true, size = "default" }) {
  const getConfidenceConfig = (confidence) => {
    if (confidence >= 90) {
      return {
        backgroundColor: '#DCFCE7',
        textColor: '#166534',
        borderColor: '#BBF7D0',
        icon: 'checkmark-circle',
        label: "High",
        labelEs: "Alta"
      };
    } else if (confidence >= 70) {
      return {
        backgroundColor: '#FEF3C7',
        textColor: '#92400E',
        borderColor: '#FDE68A',
        icon: 'warning',
        label: "Medium",
        labelEs: "Media"
      };
    } else {
      return {
        backgroundColor: '#FEE2E2',
        textColor: '#991B1B',
        borderColor: '#FECACA',
        icon: 'close-circle',
        label: "Low",
        labelEs: "Baja"
      };
    }
  };

  const config = getConfidenceConfig(confidence);
  
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
      {showIcon && (
        <Ionicons 
          name={config.icon} 
          size={size === 'sm' ? 12 : size === 'lg' ? 16 : 14} 
          color={config.textColor}
          style={styles.icon}
        />
      )}
      <Text style={[styles.text, { color: config.textColor }]}>
        {confidence}%
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