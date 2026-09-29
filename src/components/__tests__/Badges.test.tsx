import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { ConfidenceBadge, confidenceLevel, normalizeConfidence } from '../ConfidenceBadge';
import { SourceBadge, sourceKey } from '../SourceBadge';

jest.mock('../../i18n', () => {
  const { createTranslator } = jest.requireActual('../../services/ai/__fixtures__/aiTestKit');
  const t = createTranslator('en');
  return { t, useT: () => t };
});

let mockDarkMode = false;
jest.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({ isDarkMode: mockDarkMode }),
}));

beforeEach(() => {
  mockDarkMode = false;
});

describe('ConfidenceBadge', () => {
  it('maps values to levels and clamps them', () => {
    expect(confidenceLevel(95)).toBe('high');
    expect(confidenceLevel(90)).toBe('high');
    expect(confidenceLevel(75)).toBe('medium');
    expect(confidenceLevel(69)).toBe('low');
    expect(normalizeConfidence(120)).toBe(100);
    expect(normalizeConfidence(-4)).toBe(0);
    expect(normalizeConfidence(87.6)).toBe(88);
    expect(normalizeConfidence(null)).toBeNull();
    expect(normalizeConfidence(Number.NaN)).toBeNull();
  });

  it('renders the value with an accessible description', async () => {
    await render(<ConfidenceBadge confidence={92} />);
    expect(screen.getByText('92%')).toBeTruthy();
    expect(screen.getByLabelText('AI confidence 92% (High)')).toBeTruthy();
  });

  it('renders nothing when the confidence is unknown', async () => {
    await render(<ConfidenceBadge confidence={null} />);
    expect(screen.queryByTestId('confidence-badge')).toBeNull();
  });

  it('uses dark colors in dark mode', async () => {
    const { unmount } = await render(<ConfidenceBadge confidence={50} />);
    const light = StyleSheet.flatten(screen.getByTestId('confidence-badge').props.style).backgroundColor;
    await unmount();
    mockDarkMode = true;
    await render(<ConfidenceBadge confidence={50} />);
    const dark = StyleSheet.flatten(screen.getByTestId('confidence-badge').props.style).backgroundColor;
    expect(dark).not.toBe(light);
  });
});

describe('SourceBadge', () => {
  it('accepts domain keys and legacy labels', () => {
    expect(sourceKey('google')).toBe('google');
    expect(sourceKey('ai_chat')).toBe('ai_chat');
    expect(sourceKey('ChatGPT')).toBe('ai_chat');
    expect(sourceKey('IA')).toBe('ai_chat');
    expect(sourceKey('Google Calendar')).toBe('google');
    expect(sourceKey('WhatsApp')).toBe('whatsapp');
    expect(sourceKey('Device')).toBe('device');
    expect(sourceKey('something else')).toBe('manual');
    expect(sourceKey(null)).toBe('manual');
  });

  it('renders the localized label with an accessible description', async () => {
    await render(<SourceBadge source="google" size="sm" />);
    expect(screen.getByText('Google Calendar')).toBeTruthy();
    expect(screen.getByLabelText('Source: Google Calendar')).toBeTruthy();
  });
});
