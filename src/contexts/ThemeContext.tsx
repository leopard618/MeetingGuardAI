/**
 * Theme mode (owner: shell): 'light' (default for a fresh install, the client's mockup), 'dark'
 * or 'system' (follows the OS scheme live). A saved choice always wins over the default.
 *
 * - The explicit choice is persisted in AsyncStorage (GLOBAL_STORAGE_KEYS.theme, "mg:theme"; the
 *   legacy "theme" key is read once and migrated). It is written only when the user changes it,
 *   so a slow load can never overwrite the stored choice with the initial default.
 * - useTheme() exposes the mode, the resolved scheme and the color tokens of that scheme
 *   (./themeColors, built from the MG Indigo tokens in src/theme/tokens.ts).
 * - useAppThemes() gives the root composition (src/navigation/AppRoot.tsx) the matching Paper
 *   theme, React Navigation theme and status bar style, so every layer switches together.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DarkTheme as NavigationDarkTheme, DefaultTheme as NavigationLightTheme, type Theme as NavigationTheme } from '@react-navigation/native';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { adaptNavigationTheme, type MD3Theme } from 'react-native-paper';

import { toAppError } from '../core/errors';
import { GLOBAL_STORAGE_KEYS } from '../core/identifiers';
import { createLogger } from '../core/logger';
import { APP_COLORS, PAPER_THEMES, isThemeMode, resolveColorScheme, type AppColors, type ColorScheme, type ThemeMode } from './themeColors';

export { APP_COLORS, THEME_MODES, isThemeMode, resolveColorScheme } from './themeColors';
export type { AppColors, ColorScheme, ThemeMode } from './themeColors';

const log = createLogger('theme');

export const THEME_STORAGE_KEY = GLOBAL_STORAGE_KEYS.theme;
const LEGACY_THEME_STORAGE_KEY = 'theme';

export interface ThemeContextValue {
  /** The user's choice. */
  themeMode: ThemeMode;
  setThemeMode(mode: ThemeMode): void;
  /** Scheme being rendered (the choice, or the OS scheme for 'system'). */
  colorScheme: ColorScheme;
  isDarkMode: boolean;
  /** Switches to the opposite of the scheme being rendered (an explicit choice). */
  toggleTheme(): void;
  /** true once the stored choice was read (or reading it failed). */
  isLoaded: boolean;
  colors: AppColors;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

/** The theme when a ThemeProvider is mounted, else null (components that may render above it). */
export function useOptionalTheme(): ThemeContextValue | null {
  return useContext(ThemeContext);
}

/** Reads the stored choice (migrating the legacy key once). Exported for tests. */
export async function loadStoredThemeMode(): Promise<ThemeMode | null> {
  const stored = await AsyncStorage.getItem(THEME_STORAGE_KEY);
  if (isThemeMode(stored)) return stored;
  const legacy = await AsyncStorage.getItem(LEGACY_THEME_STORAGE_KEY);
  if (legacy === 'dark' || legacy === 'light') {
    await AsyncStorage.setItem(THEME_STORAGE_KEY, legacy);
    await AsyncStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
    return legacy;
  }
  return null;
}

export interface ThemeProviderProps {
  children?: ReactNode;
  /** Starting mode before the stored choice is read (tests / previews). */
  initialMode?: ThemeMode;
}

export function ThemeProvider({ children, initialMode = 'light' }: ThemeProviderProps): ReactElement {
  const systemScheme = useColorScheme();
  const [themeMode, setThemeModeState] = useState<ThemeMode>(initialMode);
  const [isLoaded, setIsLoaded] = useState(false);
  // A choice made while the stored one is still loading wins over the stored one.
  const userChangedRef = useRef(false);

  useEffect(() => {
    let active = true;
    loadStoredThemeMode()
      .then((mode) => {
        if (active && mode && !userChangedRef.current) setThemeModeState(mode);
      })
      .catch((error: unknown) => log.warn('could not read the saved theme', toAppError(error).code))
      .finally(() => {
        if (active) setIsLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const setThemeMode = useCallback((mode: ThemeMode) => {
    if (!isThemeMode(mode)) return;
    userChangedRef.current = true;
    setThemeModeState(mode);
    AsyncStorage.setItem(THEME_STORAGE_KEY, mode).catch((error: unknown) =>
      log.warn('could not save the theme', toAppError(error).code),
    );
  }, []);

  const colorScheme = resolveColorScheme(themeMode, systemScheme);
  const isDarkMode = colorScheme === 'dark';

  const toggleTheme = useCallback(() => {
    setThemeMode(isDarkMode ? 'light' : 'dark');
  }, [isDarkMode, setThemeMode]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      themeMode,
      setThemeMode,
      colorScheme,
      isDarkMode,
      toggleTheme,
      isLoaded,
      colors: APP_COLORS[colorScheme],
    }),
    [themeMode, setThemeMode, colorScheme, isDarkMode, toggleTheme, isLoaded],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

const { LightTheme: NAVIGATION_LIGHT, DarkTheme: NAVIGATION_DARK } = adaptNavigationTheme({
  reactNavigationLight: NavigationLightTheme,
  reactNavigationDark: NavigationDarkTheme,
  materialLight: PAPER_THEMES.light,
  materialDark: PAPER_THEMES.dark,
});

const NAVIGATION_THEMES: Readonly<Record<ColorScheme, NavigationTheme>> = {
  light: { ...NavigationLightTheme, ...NAVIGATION_LIGHT, fonts: NavigationLightTheme.fonts },
  dark: { ...NavigationDarkTheme, ...NAVIGATION_DARK, fonts: NavigationDarkTheme.fonts },
};

export interface AppThemes {
  colorScheme: ColorScheme;
  isDarkMode: boolean;
  paperTheme: MD3Theme;
  navigationTheme: NavigationTheme;
  /** expo-status-bar style: light content on dark backgrounds. */
  statusBarStyle: 'light' | 'dark';
}

/** Paper + React Navigation themes and the status bar style for the current scheme (AppRoot). */
export function useAppThemes(): AppThemes {
  const { colorScheme } = useTheme();
  return useMemo(
    () => ({
      colorScheme,
      isDarkMode: colorScheme === 'dark',
      paperTheme: PAPER_THEMES[colorScheme],
      navigationTheme: NAVIGATION_THEMES[colorScheme],
      statusBarStyle: colorScheme === 'dark' ? 'light' : 'dark',
    }),
    [colorScheme],
  );
}
