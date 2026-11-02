/**
 * src/theme - the one import path for design values (owner: shell / Foundation).
 *
 * Usage in components:
 *   import { useAppTheme, spacing, radii, typography, componentMetrics } from '../../theme';
 *   const { colors, isDark } = useAppTheme();
 *
 * useAppTheme() delegates scheme resolution (system/light/dark + persistence) to ThemeContext
 * and returns the MG Indigo tokens for the resolved scheme. Provider-less surfaces
 * (ErrorBoundary fallback) and src/contexts/themeColors.ts import './tokens' directly instead - 
 * this barrel imports ThemeContext, so importing it from the contexts layer would be a cycle.
 */
import { useMemo } from 'react';
import { useColorScheme, type ViewStyle } from 'react-native';

import { resolveColorScheme, useOptionalTheme, type ColorScheme } from '../contexts/ThemeContext';
import {
  componentMetrics,
  darkColors,
  gradients,
  lightColors,
  radii,
  softShadow,
  spacing,
  typography,
  type MGColors,
  type MGComponentMetrics,
  type MGGradients,
  type MGRadii,
  type MGSpacing,
  type MGTypography,
} from './tokens';

export * from './contrast';
export * from './tokens';

/** Everything a screen needs to style itself, resolved for the scheme being rendered. */
export interface AppTheme {
  scheme: ColorScheme;
  isDark: boolean;
  colors: MGColors;
  typography: MGTypography;
  spacing: MGSpacing;
  radii: MGRadii;
  metrics: MGComponentMetrics;
  gradients: MGGradients;
  /** Text / icon color on each gradient. */
  onGradient: Readonly<Record<keyof MGGradients, string>>;
  /** Resting card surface: soft indigo shadow in light, tonal step + hairline in dark. */
  elevated: ViewStyle;
}

/** Style of a resting elevated surface (Card default, meeting rows, timeline cards). */
export function elevatedSurface(scheme: ColorScheme): ViewStyle {
  if (scheme === 'dark') {
    return { backgroundColor: darkColors.elevation.level1, borderWidth: 1, borderColor: darkColors.outlineVariant };
  }
  return { backgroundColor: lightColors.surface, borderWidth: 0, ...softShadow };
}

/**
 * MG Indigo tokens for the current scheme. Below ThemeProvider it follows the user's choice
 * (system/light/dark, persisted); without one (bare test harnesses, surfaces above the
 * providers) it follows the OS scheme, so kit components never crash a partial tree.
 * Referentially stable per scheme.
 */
export function useAppTheme(): AppTheme {
  const context = useOptionalTheme();
  const systemScheme = useColorScheme();
  const colorScheme: ColorScheme = context ? context.colorScheme : resolveColorScheme('system', systemScheme);
  return useMemo(
    () => ({
      scheme: colorScheme,
      isDark: colorScheme === 'dark',
      colors: colorScheme === 'dark' ? darkColors : lightColors,
      typography,
      spacing,
      radii,
      metrics: componentMetrics,
      gradients: gradients[colorScheme],
      // The accent surface is solid primary since November 1, 2026: text on it is onPrimary.
      onGradient: {
        primary: (colorScheme === 'dark' ? darkColors : lightColors).onPrimary,
        hero: (colorScheme === 'dark' ? darkColors : lightColors).onPrimary,
        ai: (colorScheme === 'dark' ? darkColors : lightColors).onPrimary,
      },
      elevated: elevatedSurface(colorScheme),
    }),
    [colorScheme],
  );
}
