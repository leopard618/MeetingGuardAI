/**
 * Resting-content card (owner: shell / Foundation; docs/v1/DESIGN_SYSTEM.md §5): surface, r-lg,
 * 1px outlineVariant hairline, p-16, elevation 0 (depth = border, never border + shadow).
 * `accent="primary"` is the ONE focal card a screen may have (primaryContainer, no border).
 * With `onPress` it ripples primary@10% (Android) / dims to 0.96 (iOS).
 */
import type { ReactElement, ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View, type AccessibilityProps, type StyleProp, type ViewStyle } from 'react-native';

import { componentMetrics, pressedOpacity, radii, stateAlpha, useAppTheme, withAlpha } from '../../theme';

export type CardAccent = 'none' | 'primary';

export interface CardProps extends AccessibilityProps {
  children?: ReactNode;
  onPress?: () => void;
  /** "primary" tints the card primaryContainer (one focal card per screen). */
  accent?: CardAccent;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Card({ children, onPress, accent = 'none', disabled = false, style, testID, ...accessibility }: CardProps): ReactElement {
  const { colors } = useAppTheme();
  const surface: ViewStyle =
    accent === 'primary'
      ? { backgroundColor: colors.primaryContainer, borderColor: colors.primaryContainer }
      : { backgroundColor: colors.surface, borderColor: colors.outlineVariant };

  if (!onPress) {
    return (
      <View style={[styles.card, surface, style]} testID={testID} {...accessibility}>
        {children}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      android_ripple={{ color: withAlpha(colors.primary, stateAlpha.rippleOnCard) }}
      style={({ pressed }) => [
        styles.card,
        styles.pressable,
        surface,
        pressed && Platform.OS !== 'android' && styles.pressed,
        style,
      ]}
      testID={testID}
      {...accessibility}
      accessibilityRole={accessibility.accessibilityRole ?? 'button'}
      accessibilityState={{ disabled: disabled || undefined, ...accessibility.accessibilityState }}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: componentMetrics.cardPadding,
  },
  pressable: {
    // Keeps the Android ripple inside the rounded corners (elevation is 0, nothing to clip).
    overflow: 'hidden',
  },
  pressed: {
    opacity: pressedOpacity,
  },
});
