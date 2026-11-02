/**
 * The app's one button (owner: shell / Foundation; docs/v1/DESIGN_SYSTEM.md §5). Height 48 (md) /
 * 40 (sm), labelL, pill radius (small buttons r-sm). A thin wrapper over Paper's Button so
 * loading / icon / disabled / accessibility keep working.
 *
 * Variants: filled (the one primary action: solid primary, onPrimary text), tonal (secondary
 * emphasis), outline, ghost (low emphasis / dialog actions), destructive (ghost-style red text;
 * confirmation stays with the caller), inverse (onPrimary surface with primary text, for a button
 * on a primary surface).
 *
 * Known Paper limitation: Paper's Button hard-codes `accessibilityState={{ disabled }}` on its
 * touchable, so a custom `accessibilityState` (e.g. `busy`) never reaches the node.
 */
import type { ComponentProps, ReactElement } from 'react';
import { StyleSheet } from 'react-native';
import { Button } from 'react-native-paper';

import { componentMetrics, radii, stateAlpha, typography, useAppTheme, withAlpha } from '../../theme';

export type MGButtonVariant = 'filled' | 'tonal' | 'outline' | 'ghost' | 'destructive' | 'inverse';
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
  inverse: 'contained',
};

export function MGButton({ variant = 'filled', size = 'md', style, contentStyle, labelStyle, ...rest }: MGButtonProps): ReactElement {
  const { colors } = useAppTheme();
  const destructive = variant === 'destructive';
  const inverse = variant === 'inverse';
  // An explicit textColor (even undefined) must not wipe the variant default when the rest is spread.
  const { textColor, ...paperProps } = rest;
  return (
    <Button
      mode={PAPER_MODE[variant]}
      buttonColor={inverse ? colors.onPrimary : undefined}
      textColor={textColor ?? (destructive ? colors.error : inverse ? colors.primary : undefined)}
      rippleColor={destructive ? withAlpha(colors.error, stateAlpha.rippleOnCard) : inverse ? withAlpha(colors.primary, stateAlpha.rippleOnCard) : undefined}
      hitSlop={size === 'sm' ? 4 : undefined}
      style={[size === 'sm' ? styles.shapeSm : styles.shape, style]}
      contentStyle={[size === 'sm' ? styles.contentSm : styles.content, contentStyle]}
      labelStyle={[styles.label, labelStyle]}
      {...paperProps}
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
