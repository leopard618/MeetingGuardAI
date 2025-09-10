import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '..\contexts\ThemeContext';

const ThemeTest = () => {
  const { isDarkMode, toggleTheme } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: isDarkMode ? '#1a1a1a' : '#ffffff' }]}>
      <Text style={[styles.text, { color: isDarkMode ? '#ffffff' : '#000000' }]}>
        Current Theme: {isDarkMode ? 'Dark' : 'Light'}
      </Text>
      <Text style={[styles.subtext, { color: isDarkMode ? '#a1a1aa' : '#666666' }]}>
        ThemeProvider is working correctly!
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 20,
    borderRadius: 8,
    margin: 10,
  },
  text: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtext: {
    fontSize: 14,
  },
});

export default ThemeTest; 