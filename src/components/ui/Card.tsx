/**
 * Resting-content card (owner: shell / Foundation; docs/v1/DESIGN_SYSTEM.md §5).
 *
 * Variants:
 * - elevated (default): surface, r-xxl, p-16, soft indigo shadow in light; in dark a tonal step
 *   (elevation level1) with the outlineVariant hairline, because shadows vanish on dark surfaces.
 * - outlined: the flat card (surface + 1px hairline, no shadow) for dense lists.
 * - glass: translucent surface with a faint light border (stat pills, chips over the aurora).
 * - gradient: the primary gradient; text inside uses `useAppTheme().onGradient.primary`.
 * `accent="primary"` is the ONE focal card a screen may have (primaryContainer, no border).
 * With `onPress` the card springs to 97 percent while pressed (the scale is the feedback: no
 * ripple, so the host needs no overflow clipping and its shadow renders on Android too).
 */
import type { ReactElement, ReactNode } from 'react';
import { StyleSheet, View, type AccessibilityProps, type StyleProp, type ViewStyle } from 'react-native';

import { componentMetrics, radii, useAppTheme, withAlpha } from '../../theme';
import { GradientSurface } from './GradientSurface';
import { PressableScale } from './PressableScale';

export type CardAccent = 'none' | 'primary';
export type CardVariant = 'elevated' | 'outlined' | 'glass' | 'gradient';

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
  const { colors, elevated, isDark } = useAppTheme();

  let surface: StyleProp<ViewStyle>;
  if (accent === 'primary') {
    surface = { backgroundColor: colors.primaryContainer, borderWidth: 0 };
  } else if (variant === 'outlined') {
    surface = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.outlineVariant };
  } else if (variant === 'glass') {
    surface = {
      backgroundColor: isDark ? withAlpha('#FFFFFF', 0.06) : withAlpha('#FFFFFF', 0.72),
      borderWidth: 1,
      borderColor: isDark ? withAlpha('#FFFFFF', 0.1) : withAlpha('#FFFFFF', 0.9),
    };
  } else if (variant === 'gradient') {
    surface = styles.gradientHost;
  } else {
    surface = elevated;
  }

  const body =
    variant === 'gradient' && accent !== 'primary' ? (
      <GradientSurface style={styles.gradientFill}>{children}</GradientSurface>
    ) : (
      children
    );

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
  },
  gradientHost: {
    padding: 0,
    borderWidth: 0,
    // The gradient (and its light sweep) stays inside the corners; the host casts no shadow.
    overflow: 'hidden',
  },
  gradientFill: {
    padding: componentMetrics.cardPadding,
    borderRadius: radii.xxl,
  },
});
