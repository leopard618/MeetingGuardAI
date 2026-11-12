/**
 * Resting-content card (owner: shell / Foundation; docs/v1/DESIGN_SYSTEM.md §5).
 *
 * Variants:
 * - elevated (default): surface, r-xxl, p-16, soft indigo shadow in light; in dark a tonal step
 *   (elevation level1) with the outlineVariant hairline, because shadows vanish on dark surfaces.
 * - outlined: the flat card (surface + 1px hairline, no shadow) for dense lists.
 * `accent="primary"` is the ONE focal card a screen may have (primaryContainer, no border).
 * With `onPress` the card dims while pressed (plain Pressable, no ripple, so the host needs no
 * overflow clipping and its shadow renders on Android too).
 */
import type { ReactElement, ReactNode } from 'react';
import { StyleSheet, View, type AccessibilityProps, type StyleProp, type ViewStyle } from 'react-native';

import { componentMetrics, radii, useAppTheme } from '../../theme';
import { PressableScale } from './PressableScale';

export type CardAccent = 'none' | 'primary';
export type CardVariant = 'elevated' | 'outlined';

export interface CardProps extends AccessibilityProps {
  children?: ReactNode;
  onPress?: () => void;
  /** "primary" tints the card primaryContainer (one focal card per screen). */
  accent?: CardAccent;
  /** Default "elevated". */
  variant?: CardVariant;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Card({
  children,
  onPress,
  accent = 'none',
  variant = 'elevated',
  disabled = false,
  style,
  testID,
  ...accessibility
}: CardProps): ReactElement {
  const { colors, elevated } = useAppTheme();

  let surface: StyleProp<ViewStyle>;
  if (accent === 'primary') {
    surface = { backgroundColor: colors.primaryContainer, borderWidth: 0 };
  } else if (variant === 'outlined') {
    surface = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.outlineVariant };
  } else {
    surface = elevated;
  }

  if (!onPress) {
    return (
      <View style={[styles.card, surface, style]} testID={testID} {...accessibility}>
        {children}
      </View>
    );
  }

  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      style={[styles.card, surface, style]}
      testID={testID}
      {...accessibility}
      accessibilityRole={accessibility.accessibilityRole ?? 'button'}
      accessibilityState={{ disabled: disabled || undefined, ...accessibility.accessibilityState }}
    >
      {children}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.xxl,
    padding: componentMetrics.cardPadding,
  },
});
