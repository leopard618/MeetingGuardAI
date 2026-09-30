/**
 * The app's one button (owner: shell / Foundation; docs/DESIGN_SYSTEM.md §5). Wraps Paper's
 * Button so loading / icon / disabled / accessibility keep working, and pins the MG shape and
 * type: height 48 (md) / 40 (sm), labelL, pill radius (small buttons r-sm).
 *
 * Variants: filled (the one primary action), tonal (secondary emphasis), outline, ghost (low
 * emphasis / dialog actions), destructive (ghost-style red text; confirmation stays with the
 * caller).
 *
 * Known Paper limitation: Paper's Button hard-codes `accessibilityState={{ disabled }}` on its
 * touchable, so a custom `accessibilityState` (e.g. `busy`) passed here never reaches the node.
 * Where a test or screen reader needs `busy`/other states, keep a bespoke Pressable styled to
 * this spec instead (LandingScreen sign-in, pricing buy buttons, confirmation modal footer).
 */
import type { ComponentProps, ReactElement } from 'react';
import { StyleSheet } from 'react-native';
import { Button } from 'react-native-paper';

import { componentMetrics, radii, stateAlpha, typography, useAppTheme, withAlpha } from '../../theme';

export type MGButtonVariant = 'filled' | 'tonal' | 'outline' | 'ghost' | 'destructive';
export type MGButtonSize = 'md' | 'sm';

export interface MGButtonProps extends Omit<ComponentProps<typeof Button>, 'mode'> {
  /** Default "filled". */
  variant?: MGButtonVariant;
  /** Default "md" (48dp); "sm" is 40dp visual with the touch target kept by hitSlop. */
  size?: MGButtonSize;
}

const PAPER_MODE: Record<MGButtonVariant, 'contained' | 'contained-tonal' | 'outlined' | 'text'> = {
  filled: 'contained',
  tonal: 'contained-tonal',
  outline: 'outlined',
  ghost: 'text',
  destructive: 'text',
};

export function MGButton({
  variant = 'filled',
  size = 'md',
  style,
  contentStyle,
  labelStyle,
  ...rest
}: MGButtonProps): ReactElement {
  const { colors } = useAppTheme();
  const destructive = variant === 'destructive';
  return (
    <Button
      mode={PAPER_MODE[variant]}
      textColor={destructive ? colors.error : undefined}
      rippleColor={destructive ? withAlpha(colors.error, stateAlpha.rippleOnCard) : undefined}
      hitSlop={size === 'sm' ? 4 : undefined}
      style={[size === 'sm' ? styles.shapeSm : styles.shape, style]}
      contentStyle={[size === 'sm' ? styles.contentSm : styles.content, contentStyle]}
      labelStyle={[styles.label, labelStyle]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  shape: {
    borderRadius: radii.full,
  },
  shapeSm: {
    borderRadius: radii.sm,
  },
  content: {
    minHeight: componentMetrics.buttonHeight,
  },
  contentSm: {
    minHeight: componentMetrics.buttonHeightSmall,
  },
  label: {
    ...typography.labelL,
  },
});
