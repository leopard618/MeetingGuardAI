/**
 * Dashboard kit pieces render: the mini bar chart carries its spoken label and the weekday
 * labels, and the orbit rings draw the requested number of circles and take no touches.
 */
import { act, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { PaperProvider } from 'react-native-paper';

import { PAPER_THEMES } from '../../../contexts/themeColors';
import { ThemeProvider } from '../../../contexts/ThemeContext';
import { I18nProvider } from '../../../i18n';
import { MiniBars } from '../MiniBars';
import { OrbitRings } from '../OrbitRings';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'UTC', uses24hourClock: false }]),
}));

function wrap(element: ReactElement): ReactElement {
  return (
    <I18nProvider>
      <ThemeProvider>
        <PaperProvider theme={PAPER_THEMES.light}>{element}</PaperProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}

async function renderKit(element: ReactElement) {
  const view = await render(wrap(element));
  await act(async () => undefined);
  return view;
}

describe('MiniBars', () => {
  it('renders one labelled column per bar and speaks the chart as one element', async () => {
    await renderKit(
      <MiniBars
        bars={[
          { key: 'a', fraction: 0, label: 'S' },
          { key: 'b', fraction: 0.5, label: 'M', highlighted: true },
          { key: 'c', fraction: 1, label: 'T' },
        ]}
        accessibilityLabel="Meeting time per day"
        testID="chart"
      />,
    );
    const chart = screen.getByTestId('chart');
    expect(chart.props.accessibilityLabel).toBe('Meeting time per day');
    expect(chart.props.accessibilityRole).toBe('image');
    expect(screen.getByText('S', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText('M', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText('T', { includeHiddenElements: true })).toBeTruthy();
  });
});

describe('OrbitRings', () => {
  it('draws the requested rings as a decorative, touch-transparent layer', async () => {
    await renderKit(<OrbitRings color="#FFFFFF" size={200} count={5} testID="rings" />);
    const rings = screen.getByTestId('rings', { includeHiddenElements: true });
    expect(rings.props.pointerEvents).toBe('none');
    expect(rings.props.accessibilityElementsHidden).toBe(true);
    expect(rings.props.children).toHaveLength(5);
  });
});
