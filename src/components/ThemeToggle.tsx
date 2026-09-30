/**
 * Light / dark switch (owner: shell). Pressing it makes an explicit choice opposite to the scheme
 * on screen (ThemeContext persists it); "follow the system" is chosen in Settings or the sidebar.
 * 44dp target, surfaceVariant circle, onSurface@12% ripple (docs/DESIGN_SYSTEM.md §6).
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactElement } from 'react';
import { Platform, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '../contexts/ThemeContext';
import { useT } from '../i18n';
import { componentMetrics, radii, stateAlpha, withAlpha } from '../theme';

export interface ThemeToggleProps {
  size?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function ThemeToggle({ size = componentMetrics.iconNav, style, testID = 'theme-toggle' }: ThemeToggleProps): ReactElement {
  const { isDarkMode, toggleTheme, colors } = useTheme();
  const t = useT();
  return (
    <Pressable
      onPress={toggleTheme}
      android_ripple={{ color: withAlpha(colors.onSurface, stateAlpha.rippleOnIcon), borderless: true, radius: componentMetrics.headerRippleRadius }}
      style={({ pressed }) => [styles.button, { backgroundColor: colors.surfaceVariant }, pressed && Platform.OS !== 'android' && styles.pressed, style]}
      accessibilityRole="button"
      accessibilityLabel={t(isDarkMode ? 'shell:header.lightMode' : 'shell:header.darkMode')}
      hitSlop={4}
      testID={testID}
    >
      <Ionicons name={isDarkMode ? 'sunny-outline' : 'moon-outline'} size={size} color={colors.onSurface} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: componentMetrics.touchTargetMin,
    height: componentMetrics.touchTargetMin,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
});

export default ThemeToggle;
