import { render } from '@testing-library/react-native';
import { useColorScheme } from 'react-native';

import { ThemeProvider } from '../../../contexts/ThemeContext';
import { ThemedDateTimePicker } from '../ThemedDateTimePicker';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: jest.fn(() => 'dark'),
}));

const mockPicker = jest.fn();
jest.mock('@react-native-community/datetimepicker', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    mockPicker(props);
    return null;
  },
}));

const mockColorScheme = useColorScheme as jest.Mock;
const VALUE = new Date('2026-11-09T20:00:00.000Z');

function lastProps(): Record<string, unknown> {
  return mockPicker.mock.calls[mockPicker.mock.calls.length - 1]![0] as Record<string, unknown>;
}

describe('ThemedDateTimePicker', () => {
  beforeEach(() => {
    mockPicker.mockClear();
    mockColorScheme.mockReturnValue('dark');
  });

  it('follows the app theme, not the phone: a dark phone with the light app gets a light picker', async () => {
    await render(
      <ThemeProvider initialMode="light">
        <ThemedDateTimePicker value={VALUE} mode="time" display="spinner" onChange={() => undefined} />
      </ThemeProvider>,
    );
    expect(lastProps()).toMatchObject({ themeVariant: 'light', mode: 'time', display: 'spinner' });
  });

  it('a dark app gets a dark picker', async () => {
    mockColorScheme.mockReturnValue('light');
    await render(
      <ThemeProvider initialMode="dark">
        <ThemedDateTimePicker value={VALUE} mode="date" onChange={() => undefined} />
      </ThemeProvider>,
    );
    expect(lastProps()).toMatchObject({ themeVariant: 'dark', mode: 'date' });
  });
});
