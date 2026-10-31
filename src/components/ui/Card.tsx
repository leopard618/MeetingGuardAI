/**
 * Resting-content card (owner: shell / Foundation; docs/v1/DESIGN_SYSTEM.md §5).
 *
 * Variants:
 * - elevated (default): surface, r-xxl, p-16, soft indigo shadow in light; in dark a tonal step
 *   (elevation level1) with the outlineVariant hairline, because shadows vanish on dark surfaces.
 * - outlined: the former flat card (surface + 1px hairline, no shadow) for dense lists.
 * - gradient: the primary gradient; text inside uses `useAppTheme().onGradient.primary`.
 * `accent="primary"` is the ONE focal card a screen may have (primaryContainer, no border).
 * With `onPress` the card springs to 97 percent while pressed and ripples primary@10% (Android).
 */
import type { ReactElement, ReactNode } from 'react';
import { StyleSheet, View, type AccessibilityProps, type StyleProp, type ViewStyle } from 'react-native';

import { componentMetrics, radii, stateAlpha, useAppTheme, withAlpha } from '../../theme';
import { GradientSurface } from './GradientSurface';
import { PressableScale } from './PressableScale';

export type CardAccent = 'none' | 'primary';
export type CardVariant = 'elevated' | 'outlined' | 'gradient';

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
  } else if (variant === 'gradient') {
    surface = styles.gradientHost;
  } else {
    surface = elevated;
  }

  const body = variant === 'gradient' && accent !== 'primary' ? <GradientSurface style={styles.gradientFill}>{children}</GradientSurface> : children;

  if (!onPress) {
    return (
      <View style={[styles.card, surface, style]} testID={testID} {...accessibility}>
        {body}
      </View>
    );
  }

  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      android_ripple={{ color: withAlpha(colors.primary, stateAlpha.rippleOnCard) }}
      style={[styles.card, surface, style]}
      testID={testID}
      {...accessibility}
      accessibilityRole={accessibility.accessibilityRole ?? 'button'}
      accessibilityState={{ disabled: disabled || undefined, ...accessibility.accessibilityState }}
    >
      {body}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.xxl,
    padding: componentMetrics.cardPadding,
    // Keeps the Android ripple (and a gradient fill) inside the rounded corners.
    overflow: 'hidden',
  },
  gradientHost: {
    padding: 0,
    borderWidth: 0,
  },
  gradientFill: {
    padding: componentMetrics.cardPadding,
  },
});
