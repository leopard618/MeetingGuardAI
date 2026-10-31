import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Pressable, Text, useColorScheme } from 'react-native';

import { darkColors, lightColors } from '../../theme/tokens';
import { PAPER_THEMES } from '../themeColors';
import {
  APP_COLORS,
  THEME_STORAGE_KEY,
  ThemeProvider,
  isThemeMode,
  loadStoredThemeMode,
  resolveColorScheme,
  useAppThemes,
  useTheme,
} from '../ThemeContext';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: jest.fn(() => 'light'),
}));

const mockColorScheme = useColorScheme as jest.Mock;

function Probe() {
  const theme = useTheme();
  const themes = useAppThemes();
  return (
    <>
      <Text testID="state">{`${theme.themeMode}|${theme.colorScheme}|${theme.isLoaded}|${themes.statusBarStyle}`}</Text>
      <Text testID="background">{theme.colors.background}</Text>
      <Pressable testID="toggle" onPress={theme.toggleTheme} />
      <Pressable testID="system" onPress={() => theme.setThemeMode('system')} />
    </>
  );
}

async function renderProbe() {
  await render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
  await act(async () => undefined);
}

beforeEach(async () => {
  await AsyncStorage.clear();
  mockColorScheme.mockReturnValue('light');
});

describe('pure helpers', () => {
  it('resolves the rendered scheme from the choice and the OS scheme', () => {
    expect(resolveColorScheme('dark', 'light')).toBe('dark');
    expect(resolveColorScheme('light', 'dark')).toBe('light');
    expect(resolveColorScheme('system', 'dark')).toBe('dark');
    expect(resolveColorScheme('system', 'light')).toBe('light');
    expect(resolveColorScheme('system', null)).toBe('light');
    expect(resolveColorScheme('system', 'unspecified')).toBe('light');
  });

  it('recognizes theme modes', () => {
    expect(isThemeMode('system')).toBe(true);
    expect(isThemeMode('dark')).toBe(true);
    expect(isThemeMode('sepia')).toBe(false);
    expect(isThemeMode(null)).toBe(false);
  });

  it('derives both palettes and the Paper themes from the MG tokens', () => {
    expect(APP_COLORS.light.background).toBe(lightColors.background);
    expect(APP_COLORS.dark.background).toBe(darkColors.background);
    expect(APP_COLORS.dark.text).toBe(darkColors.onSurface);
    expect(APP_COLORS.light.border).toBe(lightColors.outlineVariant);
    expect(APP_COLORS.light.danger).toBe(lightColors.error);
    expect(PAPER_THEMES.light.colors.primary).toBe(lightColors.primary);
    expect(PAPER_THEMES.dark.colors.primary).toBe(darkColors.primary);
    expect(PAPER_THEMES.light.colors.elevation.level1).toBe(lightColors.elevation.level1);
    expect(PAPER_THEMES.light.fonts.titleMedium.fontFamily).toBe('PlusJakartaSans_600SemiBold');
  });

  it('migrates the legacy "theme" key once', async () => {
    await AsyncStorage.setItem('theme', 'dark');
    await expect(loadStoredThemeMode()).resolves.toBe('dark');
    await expect(AsyncStorage.getItem(THEME_STORAGE_KEY)).resolves.toBe('dark');
    await expect(AsyncStorage.getItem('theme')).resolves.toBeNull();
  });
});

describe('ThemeProvider', () => {
  it('follows the OS scheme by default', async () => {
    mockColorScheme.mockReturnValue('dark');
    await renderProbe();
    expect(screen.getByTestId('state').props.children).toBe('system|dark|true|light');
    expect(screen.getByTestId('background').props.children).toBe(APP_COLORS.dark.background);
  });

  it('applies the stored choice', async () => {
    await AsyncStorage.setItem(THEME_STORAGE_KEY, 'dark');
    await renderProbe();
    expect(screen.getByTestId('state').props.children).toBe('dark|dark|true|light');
  });

  it('persists an explicit choice and can go back to the system scheme', async () => {
    await renderProbe();
    await act(async () => {
      fireEvent.press(screen.getByTestId('toggle'));
    });
    expect(screen.getByTestId('state').props.children).toBe('dark|dark|true|light');
    await expect(AsyncStorage.getItem(THEME_STORAGE_KEY)).resolves.toBe('dark');

    await act(async () => {
      fireEvent.press(screen.getByTestId('system'));
    });
    expect(screen.getByTestId('state').props.children).toBe('system|light|true|dark');
    await expect(AsyncStorage.getItem(THEME_STORAGE_KEY)).resolves.toBe('system');
  });

  it('keeps a choice made while the stored one is still loading', async () => {
    await AsyncStorage.setItem(THEME_STORAGE_KEY, 'light');
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const getItem = jest.spyOn(AsyncStorage, 'getItem').mockImplementationOnce(async () => {
      await gate;
      return 'light';
    });
    await render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId('toggle'));
    });
    await act(async () => {
      release();
    });
    expect(screen.getByTestId('state').props.children).toBe('dark|dark|true|light');
    getItem.mockRestore();
  });

  it('throws a clear error outside the provider', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(render(<Probe />)).rejects.toThrow('useTheme must be used within a ThemeProvider');
    spy.mockRestore();
  });
});
