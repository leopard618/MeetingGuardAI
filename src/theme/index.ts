/**
 * src/theme — the one import path for design values (owner: shell / Foundation).
 *
 * Usage in components:
 *   import { useAppTheme, spacing, radii, typography, componentMetrics } from '../../theme';
 *   const { colors, isDark } = useAppTheme();
 *
 * useAppTheme() delegates scheme resolution (system/light/dark + persistence) to ThemeContext
 * and returns the MG Indigo tokens for the resolved scheme. Provider-less surfaces
 * (ErrorBoundary fallback) and src/contexts/themeColors.ts import './tokens' directly instead —
 * this barrel imports ThemeContext, so importing it from the contexts layer would be a cycle.
 */
import { useMemo } from 'react';

import { useTheme, type ColorScheme } from '../contexts/ThemeContext';
import {
  componentMetrics,
  darkColors,
  lightColors,
  radii,
  spacing,
  typography,
  type MGColors,
  type MGComponentMetrics,
  type MGRadii,
  type MGSpacing,
  type MGTypography,
} from './tokens';

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
}

/**
 * MG Indigo tokens for the current scheme. Must be used below ThemeProvider (throws otherwise,
 * same contract as useTheme). Referentially stable per scheme.
 */
export function useAppTheme(): AppTheme {
  const { colorScheme } = useTheme();
  return useMemo(
    () => ({
      scheme: colorScheme,
      isDark: colorScheme === 'dark',
      colors: colorScheme === 'dark' ? darkColors : lightColors,
      typography,
      spacing,
      radii,
      metrics: componentMetrics,
    }),
    [colorScheme],
  );
}
