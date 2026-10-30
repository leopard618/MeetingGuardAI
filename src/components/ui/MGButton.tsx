/**
 * The app's one button (owner: shell / Foundation; docs/v1/DESIGN_SYSTEM.md §5). Height 48 (md) /
 * 40 (sm), labelL, pill radius (small buttons r-sm).
 *
 * Variants: filled (the one primary action: PRIMARY GRADIENT with press-scale feedback), tonal
 * (secondary emphasis), outline, ghost (low emphasis / dialog actions), destructive (ghost-style
 * red text; confirmation stays with the caller).
 *
 * The filled button is bespoke (Paper's Button cannot paint a gradient) and supports the props
 * the app uses: onPress, disabled, loading, a MaterialCommunityIcons `icon` name, children text,
 * style / contentStyle / labelStyle, textColor, accessibility props and testID. A disabled filled
 * button, or one with a custom icon renderer, falls back to Paper's contained button so it keeps
 * Paper's disabled look. The other variants wrap Paper's Button so loading / icon / disabled /
 * accessibility keep working.
 *
 * Known Paper limitation: Paper's Button hard-codes `accessibilityState={{ disabled }}` on its
 * touchable, so a custom `accessibilityState` (e.g. `busy`) passed to a Paper-backed variant never
 * reaches the node.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps, ReactElement } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Button } from 'react-native-paper';

import { componentMetrics, radii, stateAlpha, typography, useAppTheme, withAlpha } from '../../theme';
import { GradientSurface } from './GradientSurface';
import { PressableScale } from './PressableScale';

export type MGButtonVariant = 'filled' | 'tonal' | 'outline' | 'ghost' | 'destructive';
export type MGButtonSize = 'md' | 'sm';

export interface MGButtonProps extends Omit<ComponentProps<typeof Button>, 'mode'> {
  /** Default "filled". */
  variant?: MGButtonVariant;
  /** Default "md" (48dp); "sm" is 40dp visual with the touch target kept by hitSlop. */
  size?: MGButtonSize;
}

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

const PAPER_MODE: Record<MGButtonVariant, 'contained' | 'contained-tonal' | 'outlined' | 'text'> = {
  filled: 'contained',
  tonal: 'contained-tonal',
  outline: 'outlined',
  ghost: 'text',
  destructive: 'text',
};

const ICON_SIZE: Record<MGButtonSize, number> = { md: componentMetrics.iconInline, sm: 18 };

export function MGButton({
  variant = 'filled',
  size = 'md',
  style,
  contentStyle,
  labelStyle,
  ...rest
}: MGButtonProps): ReactElement {
  const { colors, onGradient } = useAppTheme();
  const destructive = variant === 'destructive';

  if (variant === 'filled' && !rest.disabled && (rest.icon === undefined || typeof rest.icon === 'string')) {
    const {
      onPress,
      loading,
      icon,
      children,
      textColor,
      accessibilityLabel,
      accessibilityHint,
      accessibilityState,
      testID,
    } = rest;
    const color = textColor ?? onGradient.primary;
    return (
      <PressableScale
        onPress={onPress}
        disabled={loading === true}
        hitSlop={size === 'sm' ? 4 : undefined}
        style={[size === 'sm' ? styles.shapeSm : styles.shape, styles.filledHost, style as StyleProp<ViewStyle>]}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ busy: loading || undefined, ...accessibilityState }}
        testID={testID}
      >
        <GradientSurface style={[styles.filledContent, size === 'sm' ? styles.contentSm : styles.content, contentStyle as StyleProp<ViewStyle>]}>
          {loading ? (
            <ActivityIndicator size="small" color={color} style={styles.filledIcon} />
          ) : icon ? (
            <MaterialCommunityIcons name={icon as IconName} size={ICON_SIZE[size]} color={color} style={styles.filledIcon} />
          ) : null}
          <View style={styles.filledLabelWrap}>
            <Text style={[styles.label, { color }, labelStyle]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {children}
            </Text>
          </View>
        </GradientSurface>
      </PressableScale>
    );
  }

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
  filledHost: {
    overflow: 'hidden',
  },
  filledContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: componentMetrics.cardPadding + 8,
  },
  filledIcon: {
    marginRight: 8,
  },
  filledLabelWrap: {
    flexShrink: 1,
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
