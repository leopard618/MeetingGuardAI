/**
 * The mini bar chart renders one labelled column per bar, speaks as one element and highlights
 * today in primary.
 */
import { act, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { PaperProvider } from 'react-native-paper';

import { PAPER_THEMES } from '../../../contexts/themeColors';
import { ThemeProvider } from '../../../contexts/ThemeContext';
import { I18nProvider } from '../../../i18n';
import { MiniBars } from '../MiniBars';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'UTC', uses24hourClock: false }]),
}));

function wrap(element: ReactElement): ReactElement {
  return (
    <I18nProvider>
      <ThemeProvider initialMode="light">
        <PaperProvider theme={PAPER_THEMES.light}>{element}</PaperProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}

describe('MiniBars', () => {
  it('renders one labelled column per bar and speaks the chart as one element', async () => {
    await render(
      wrap(
        <MiniBars
          bars={[
            { key: 'a', fraction: 0, label: 'S' },
            { key: 'b', fraction: 0.5, label: 'M', highlighted: true },
            { key: 'c', fraction: 1, label: 'T' },
          ]}
          accessibilityLabel="Meeting time per day"
          testID="chart"
        />,
      ),
    );
    await act(async () => undefined);
    const chart = screen.getByTestId('chart');
    expect(chart.props.accessibilityLabel).toBe('Meeting time per day');
    expect(chart.props.accessibilityRole).toBe('image');
    expect(screen.getByText('S', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText('M', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText('T', { includeHiddenElements: true })).toBeTruthy();
  });
});
