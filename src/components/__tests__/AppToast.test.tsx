import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { MD3DarkTheme, MD3LightTheme, PaperProvider } from 'react-native-paper';

import { alertLight, darkColors } from '../../theme/tokens';
import { AppToast, TOAST_MESSAGE_LINES, TOAST_TITLE_LINES, toastConfig } from '../AppToast';

const LONG_REASON =
  'Falló la sincronización del calendario: MeetingGuard necesita permiso para acceder a tu Google Calendar.';

it('wraps long texts instead of cutting them to one line', async () => {
  await render(
    <PaperProvider theme={MD3LightTheme}>
      <AppToast tone="error" text1={LONG_REASON} text2="Abre Ajustes > Sincronización de calendarios." />
    </PaperProvider>,
  );
  expect(screen.getByText(LONG_REASON).props.numberOfLines).toBe(TOAST_TITLE_LINES);
  expect(screen.getByTestId('app-toast-message').props.numberOfLines).toBe(TOAST_MESSAGE_LINES);
  expect(TOAST_TITLE_LINES).toBeGreaterThan(1);
});

it('keeps the mode-invariant MG card in BOTH themes, with a semantic accent per tone', async () => {
  await render(
    <PaperProvider theme={MD3DarkTheme}>
      <AppToast tone="success" text1="Meeting created." />
    </PaperProvider>,
  );
  const success = StyleSheet.flatten(screen.getByTestId('app-toast-success').props.style);
  expect(success.backgroundColor).toBe(alertLight.bg);
  expect(success.borderLeftColor).toBe(darkColors.success);
  expect(success.backgroundColor).not.toBe('#FFF');

  await render(
    <PaperProvider theme={MD3LightTheme}>
      <AppToast tone="error" text1="Could not save." />
    </PaperProvider>,
  );
  const error = StyleSheet.flatten(screen.getByTestId('app-toast-error').props.style);
  expect(error.backgroundColor).toBe(alertLight.bg);
  expect(error.borderLeftColor).toBe(darkColors.error);
});

it('has a layout for every toast type the app shows', () => {
  expect(Object.keys(toastConfig).sort()).toEqual(['error', 'info', 'success']);
});
