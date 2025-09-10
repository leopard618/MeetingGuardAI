import React from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';

const ThemeToggle = ({ size = 24, style }) => {
  const { isDarkMode, toggleTheme } = useTheme();

  return (
    <TouchableOpacity
      style={[styles.toggle, style]}
      onPress={toggleTheme}
      activeOpacity={0.7}
    >
      <MaterialIcons
        name={isDarkMode ? "light-mode" : "dark-mode"}
        size={size}
        color={"#fbbf24"}
      />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  toggle: {
    padding: 8,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default ThemeToggle; 