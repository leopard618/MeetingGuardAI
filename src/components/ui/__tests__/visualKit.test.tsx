/**
 * Flat kit (November 1, 2026): the accent surface is a solid primary block, press feedback is a
 * plain Pressable, Reveal renders at rest, the FAB keeps its accessible name, and the filled
 * button is Paper's contained button with the icon and label.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Text } from 'react-native';
import { PaperProvider } from 'react-native-paper';

import { PAPER_THEMES } from '../../../contexts/themeColors';
import { ThemeProvider } from '../../../contexts/ThemeContext';
import { I18nProvider } from '../../../i18n';
import { lightColors } from '../../../theme';
import { Card } from '../Card';
import { GradientFab } from '../GradientFab';
import { GradientSurface } from '../GradientSurface';
import { MGButton } from '../MGButton';
import { PressableScale } from '../PressableScale';
import { Reveal } from '../Reveal';

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

async function renderKit(element: ReactElement) {
  const view = await render(wrap(element));
  await act(async () => undefined);
  return view;
}

function flatStyle(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...(Array.isArray(style) ? style.flat(Infinity) : [style]).filter(Boolean)) as Record<string, unknown>;
}

describe('GradientSurface (solid accent)', () => {
  it('paints the primary color, no gradient', async () => {
    await renderKit(
      <GradientSurface variant="hero" testID="accent">
        <Text>Inside</Text>
      </GradientSurface>,
    );
    expect(screen.getByText('Inside')).toBeTruthy();
    const style = flatStyle(screen.getByTestId('accent').props.style);
    expect(style.backgroundColor).toBe(lightColors.primary);
    expect(screen.getByTestId('accent').props.colors).toBeUndefined();
  });
});

describe('PressableScale', () => {
  it('fires onPress and keeps the accessibility role', async () => {
    const onPress = jest.fn();
    await renderKit(
      <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel="Go" testID="press">
        <Text>Go</Text>
      </PressableScale>,
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId('press'));
    });
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Go').props.accessibilityRole).toBe('button');
  });
});

describe('Reveal', () => {
  it('renders its children at rest', async () => {
    await renderKit(
      <Reveal index={3} delay={100} testID="reveal">
        <Text>Row</Text>
      </Reveal>,
    );
    expect(screen.getByText('Row')).toBeTruthy();
    expect(flatStyle(screen.getByTestId('reveal').props.style).opacity).toBeUndefined();
  });
});

describe('GradientFab', () => {
  it('is an extended button with the label as its accessible name', async () => {
    const onPress = jest.fn();
    await renderKit(<GradientFab icon="plus" label="New meeting" onPress={onPress} testID="fab" />);
    expect(screen.getByLabelText('New meeting')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('fab'));
    });
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('Card', () => {
  it('outlined keeps the hairline; the default card is the elevated surface', async () => {
    await renderKit(
      <>
        <Card variant="outlined" testID="outlined">
          <Text>A</Text>
        </Card>
        <Card testID="elevated">
          <Text>B</Text>
        </Card>
      </>,
    );
    expect(flatStyle(screen.getByTestId('outlined').props.style).borderColor).toBe(lightColors.outlineVariant);
    expect(flatStyle(screen.getByTestId('elevated').props.style).backgroundColor).toBe(lightColors.surface);
  });
});

describe('MGButton filled', () => {
  it('shows the label and fires onPress', async () => {
    const onPress = jest.fn();
    await renderKit(
      <MGButton icon="plus" onPress={onPress} testID="filled">
        Create
      </MGButton>,
    );
    expect(screen.getByText('Create')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('filled'));
    });
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
