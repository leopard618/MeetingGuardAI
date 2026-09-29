/**
 * App color tokens for both schemes (owner: shell), derived from the react-native-paper MD3 themes
 * the app renders with, so Paper components and hand-styled views always agree. Pure module (no
 * React): ThemeContext picks the palette for the resolved scheme.
 */
import { MD3DarkTheme, MD3LightTheme, type MD3Theme } from 'react-native-paper';

export type ThemeMode = 'system' | 'light' | 'dark';
export type ColorScheme = 'light' | 'dark';

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

export interface AppColors {
  /** Screen background. */
  background: string;
  /** Cards, sheets, header, sidebar. */
  surface: string;
  /** Slightly raised surfaces (selected rows, chips, inputs). */
  surfaceVariant: string;
  /** Primary text. */
  text: string;
  /** Secondary text (descriptions, captions). */
  textSecondary: string;
  /** Hairlines and outlines. */
  border: string;
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  danger: string;
  onDanger: string;
  success: string;
  warning: string;
  /** Warning banners (background / text on it). */
  warningContainer: string;
  onWarningContainer: string;
  /** Dimmed backdrop behind modals and the sidebar. */
  scrim: string;
}

function fromPaper(theme: MD3Theme, extras: Pick<AppColors, 'success' | 'warning' | 'warningContainer' | 'onWarningContainer' | 'scrim'>): AppColors {
  const { colors } = theme;
  return {
    background: colors.background,
    surface: colors.surface,
    surfaceVariant: colors.surfaceVariant,
    text: colors.onSurface,
    textSecondary: colors.onSurfaceVariant,
    border: colors.outlineVariant,
    primary: colors.primary,
    onPrimary: colors.onPrimary,
    primaryContainer: colors.primaryContainer,
    onPrimaryContainer: colors.onPrimaryContainer,
    danger: colors.error,
    onDanger: colors.onError,
    ...extras,
  };
}

export const APP_COLORS: Readonly<Record<ColorScheme, AppColors>> = {
  light: fromPaper(MD3LightTheme, {
    success: '#1B7F3B',
    warning: '#8A5300',
    warningContainer: '#FFEFD6',
    onWarningContainer: '#3D2400',
    scrim: 'rgba(0, 0, 0, 0.45)',
  }),
  dark: fromPaper(MD3DarkTheme, {
    success: '#7BDA95',
    warning: '#FFB951',
    warningContainer: '#4A3000',
    onWarningContainer: '#FFDDB0',
    scrim: 'rgba(0, 0, 0, 0.6)',
  }),
};

export const PAPER_THEMES: Readonly<Record<ColorScheme, MD3Theme>> = {
  light: MD3LightTheme,
  dark: MD3DarkTheme,
};
