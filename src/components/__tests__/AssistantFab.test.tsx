/**
 * Floating assistant button: stays inside the window and the safe areas, starts bottom-right,
 * restores a saved spot, ignores corrupt storage, opens the chat on a tap and hides on the chat
 * screen.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../contexts/ThemeContext';
import { I18nProvider } from '../../i18n';
import { AssistantFab, clampPosition, defaultPosition, FAB_SIZE, parseStoredPosition, POSITION_KEY, type FabBounds } from '../AssistantFab';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'UTC', uses24hourClock: false }]),
}));

const mockNavigate = jest.fn();
jest.mock('../../navigation/navigationService', () => ({
  navigate: (name: string, params?: unknown) => mockNavigate(name, params),
}));

/** What PanResponder reads from a responder event (no active touches: a plain tap). */
const TOUCH_EVENT = {
  nativeEvent: { touches: [], changedTouches: [], pageX: 0, pageY: 0, timestamp: 1 },
  touchHistory: { touchBank: [], numberActiveTouches: 0, indexOfSingleActiveTouch: 0, mostRecentTimeStamp: 1 },
};

const BOUNDS: FabBounds = { width: 400, height: 800, insets: { top: 40, bottom: 20, left: 0, right: 0 } };

function wrap(element: ReactElement): ReactElement {
  return (
    <I18nProvider>
      <ThemeProvider initialMode="dark">{element}</ThemeProvider>
    </I18nProvider>
  );
}

beforeEach(async () => {
  await AsyncStorage.clear();
  mockNavigate.mockReset();
});

describe('clampPosition', () => {
  it('keeps the button inside the window, clear of the safe areas and the margin', () => {
    expect(clampPosition({ x: -50, y: -50 }, BOUNDS)).toEqual({ x: 16, y: 56 });
    expect(clampPosition({ x: 9999, y: 9999 }, BOUNDS)).toEqual({ x: 400 - 16 - FAB_SIZE, y: 800 - 20 - 16 - FAB_SIZE });
    expect(clampPosition({ x: 100, y: 300 }, BOUNDS)).toEqual({ x: 100, y: 300 });
    expect(clampPosition({ x: Number.NaN, y: 300 }, BOUNDS).x).toBe(400 - 16 - FAB_SIZE);
  });

  it('starts bottom-right', () => {
    expect(defaultPosition(BOUNDS)).toEqual({ x: 400 - 16 - FAB_SIZE, y: 800 - 20 - 16 - FAB_SIZE });
  });
});

describe('parseStoredPosition', () => {
  it('accepts a saved point and rejects anything else', () => {
    expect(parseStoredPosition(JSON.stringify({ x: 12, y: 34 }))).toEqual({ x: 12, y: 34 });
    expect(parseStoredPosition('{"x":"a"}')).toBeNull();
    expect(parseStoredPosition('not json')).toBeNull();
    expect(parseStoredPosition(null)).toBeNull();
  });
});

describe('AssistantFab', () => {
  it('renders with its label and hint and opens the chat on a tap', async () => {
    await render(wrap(<AssistantFab />));
    await act(async () => undefined);
    const fab = await screen.findByTestId('assistant-fab');
    expect(fab.props.accessibilityLabel).toBe('Open the AI assistant');
    expect(fab.props.accessibilityHint).toBe('Long press and drag to move it');
    await act(async () => {
      fireEvent(fab, 'responderGrant', TOUCH_EVENT);
      fireEvent(fab, 'responderRelease', TOUCH_EVENT);
    });
    expect(mockNavigate).toHaveBeenCalledWith('AIChat', undefined);
  });

  it('restores the saved spot and renders nothing while hidden', async () => {
    await AsyncStorage.setItem(POSITION_KEY, JSON.stringify({ x: 30, y: 200 }));
    await render(wrap(<AssistantFab />));
    const fab = await screen.findByTestId('assistant-fab');
    const style = Object.assign({}, ...[fab.props.style].flat(Infinity).filter(Boolean)) as { left: number; top: number };
    expect(style.left).toBe(30);
    expect(style.top).toBe(200);

    screen.unmount();
    await render(wrap(<AssistantFab hidden />));
    await act(async () => undefined);
    expect(screen.queryByTestId('assistant-fab')).toBeNull();
  });
});
