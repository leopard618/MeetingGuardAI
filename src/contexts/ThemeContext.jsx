/**
 * Theme mode (owner: i18n-nav): 'system' (default, follows the OS scheme live), 'light' or 'dark'.
 * The explicit choice is persisted in AsyncStorage ("mg:theme"; the legacy "theme" key is read
 * once and migrated). The stored value is only written when the user changes it, so loading can
 * never be overwritten by the initial default (the old race).
 *
 * Kept API: useTheme() => { isDarkMode, toggleTheme }; new: themeMode, setThemeMode, isLoaded.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';

import { GLOBAL_STORAGE_KEYS } from '../core/identifiers';
import { createLogger } from '../core/logger';

const log = createLogger('theme');

export const THEME_STORAGE_KEY = GLOBAL_STORAGE_KEYS.theme;
const LEGACY_THEME_STORAGE_KEY = 'theme';
const THEME_MODES = ['system', 'light', 'dark'];

const ThemeContext = createContext(null);

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

async function loadStoredMode() {
  const stored = await AsyncStorage.getItem(THEME_STORAGE_KEY);
  if (THEME_MODES.includes(stored)) return stored;
  const legacy = await AsyncStorage.getItem(LEGACY_THEME_STORAGE_KEY);
  if (legacy === 'dark' || legacy === 'light') {
    await AsyncStorage.setItem(THEME_STORAGE_KEY, legacy);
    await AsyncStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
    return legacy;
  }
  return null;
}

export const ThemeProvider = ({ children }) => {
  const systemScheme = useColorScheme();
  const [themeMode, setThemeModeState] = useState('system');
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    loadStoredMode()
      .then((mode) => {
        if (active && mode) setThemeModeState(mode);
      })
      .catch((error) => log.warn('could not read the saved theme', error?.message))
      .finally(() => {
        if (active) setIsLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const setThemeMode = useCallback((mode) => {
    if (!THEME_MODES.includes(mode)) return;
    setThemeModeState(mode);
    AsyncStorage.setItem(THEME_STORAGE_KEY, mode).catch((error) =>
      log.warn('could not save the theme', error?.message),
    );
  }, []);

  const isDarkMode = themeMode === 'system' ? systemScheme === 'dark' : themeMode === 'dark';

  const toggleTheme = useCallback(() => {
    setThemeMode(isDarkMode ? 'light' : 'dark');
  }, [isDarkMode, setThemeMode]);

  const value = useMemo(
    () => ({ isDarkMode, toggleTheme, themeMode, setThemeMode, isLoaded }),
    [isDarkMode, toggleTheme, themeMode, setThemeMode, isLoaded],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};
