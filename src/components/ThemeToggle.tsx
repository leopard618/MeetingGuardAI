/**
 * Light / dark switch (owner: shell). Pressing it makes an explicit choice opposite to the scheme
 * on screen (ThemeContext persists it); "follow the system" is chosen in Settings or the sidebar.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactElement } from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '../contexts/ThemeContext';
import { useT } from '../i18n';

export interface ThemeToggleProps {
  size?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function ThemeToggle({ size = 22, style, testID = 'theme-toggle' }: ThemeToggleProps): ReactElement {
  const { isDarkMode, toggleTheme, colors } = useTheme();
  const t = useT();
  return (
    <Pressable
      onPress={toggleTheme}
      style={({ pressed }) => [styles.button, { backgroundColor: colors.surfaceVariant }, pressed && styles.pressed, style]}
      accessibilityRole="button"
      accessibilityLabel={t(isDarkMode ? 'shell:header.lightMode' : 'shell:header.darkMode')}
      hitSlop={4}
      testID={testID}
    >
      <Ionicons name={isDarkMode ? 'sunny-outline' : 'moon-outline'} size={size} color={colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
});

export default ThemeToggle;
