/**
 * App color tokens and Paper themes for both schemes (owner: shell), built from the MG Indigo
 * design tokens (src/theme/tokens.ts) so Paper components and hand-styled views always agree.
 * Pure module (no React): ThemeContext picks the palette for the resolved scheme.
 *
 * NOTE: this file imports `src/theme/tokens` DIRECTLY, never the `src/theme` barrel - the barrel
 * imports ThemeContext, which imports this file (cycle otherwise).
 *
 * `AppColors` extends the full MG color set with the legacy field names the pre-redesign screens
 * read (`text`, `textSecondary`, `border`, `danger`, `onDanger`), so every existing
 * `useTheme().colors` consumer compiles unchanged while new code uses the MD3-role names.
 */
import { configureFonts, MD3DarkTheme, MD3LightTheme, type MD3Theme } from 'react-native-paper';

import { darkColors, lightColors, paperColorOverrides, typography, type MGColors, type MGSchemeName } from '../theme/tokens';

export type ThemeMode = 'system' | 'light' | 'dark';
export type ColorScheme = MGSchemeName;

export const THEME_MODES: readonly ThemeMode[] = ['system', 'light', 'dark'];

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === 'string' && (THEME_MODES as readonly string[]).includes(value);
}

/**
 * Scheme to render: an explicit choice wins; 'system' follows the OS (anything other than 'dark',
 * including an unknown / unspecified OS scheme, renders light).
 */
export function resolveColorScheme(mode: ThemeMode, systemScheme: string | null | undefined): ColorScheme {
  if (mode === 'light' || mode === 'dark') return mode;
  return systemScheme === 'dark' ? 'dark' : 'light';
}

export interface AppColors extends MGColors {
  /** Legacy alias of `onSurface` (primary text). */
  text: string;
  /** Legacy alias of `onSurfaceVariant` (secondary text). */
  textSecondary: string;
  /** Legacy alias of `outlineVariant` (decorative hairlines). */
  border: string;
  /** Legacy alias of `error`. */
  danger: string;
  /** Legacy alias of `onError`. */
  onDanger: string;
}

function toAppColors(colors: MGColors): AppColors {
  return {
    ...colors,
    text: colors.onSurface,
    textSecondary: colors.onSurfaceVariant,
    border: colors.outlineVariant,
    danger: colors.error,
    onDanger: colors.onError,
  };
}

export const APP_COLORS: Readonly<Record<ColorScheme, AppColors>> = {
  light: toAppColors(lightColors),
  dark: toAppColors(darkColors),
};

/**
 * Weight bumps so Paper `<Text variant>` matches the token type scale (docs/v1/DESIGN_SYSTEM.md §3);
 * MD3 default sizes stay as they are.
 */
const MG_FONTS = configureFonts({
  config: {
    displaySmall: { fontWeight: typography.displayS.fontWeight },
    headlineLarge: { fontWeight: typography.headlineL.fontWeight },
    headlineMedium: { fontWeight: typography.headlineM.fontWeight },
    headlineSmall: { fontWeight: typography.headlineM.fontWeight },
    titleLarge: { fontWeight: typography.titleL.fontWeight },
    titleMedium: { fontWeight: typography.titleM.fontWeight },
    titleSmall: { fontWeight: typography.titleS.fontWeight },
    labelLarge: { fontWeight: typography.labelL.fontWeight },
  },
});

/** MG Indigo MD3 themes: every Paper color role overridden from tokens (no stock-purple leaks). */
export const MG_LIGHT_THEME: MD3Theme = {
  ...MD3LightTheme,
  roundness: 3,
  fonts: MG_FONTS,
  colors: {
    ...MD3LightTheme.colors,
    ...paperColorOverrides.light,
    // Spread into Paper's own elevation object to keep MD3ElevationColors' index signature.
    elevation: { ...MD3LightTheme.colors.elevation, ...paperColorOverrides.light.elevation },
  },
};

export const MG_DARK_THEME: MD3Theme = {
  ...MD3DarkTheme,
  roundness: 3,
  fonts: MG_FONTS,
  colors: {
    ...MD3DarkTheme.colors,
    ...paperColorOverrides.dark,
    elevation: { ...MD3DarkTheme.colors.elevation, ...paperColorOverrides.dark.elevation },
  },
};

export const PAPER_THEMES: Readonly<Record<ColorScheme, MD3Theme>> = {
  light: MG_LIGHT_THEME,
  dark: MG_DARK_THEME,
};
