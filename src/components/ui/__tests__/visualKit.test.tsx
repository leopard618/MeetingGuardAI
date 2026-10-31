/**
 * Visual refresh kit: gradients, press feedback, reveals and the gradient FAB render, keep their
 * roles and labels, fire their handlers, and hold still under "reduce motion".
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { AccessibilityInfo, processColor, Text } from 'react-native';
import { PaperProvider } from 'react-native-paper';

import { PAPER_THEMES } from '../../../contexts/themeColors';
import { ThemeProvider } from '../../../contexts/ThemeContext';
import { I18nProvider } from '../../../i18n';
import { gradients, lightColors } from '../../../theme';
import { AuroraBackdrop } from '../AuroraBackdrop';
import { Card } from '../Card';
import { Glow } from '../Glow';
import { Shimmer } from '../Shimmer';
import { Sparkles } from '../Sparkles';
import { GradientFab } from '../GradientFab';
import { GradientSurface } from '../GradientSurface';
import { MGButton } from '../MGButton';
import { PressableScale } from '../PressableScale';
import { Reveal, revealDelay } from '../Reveal';

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

describe('GradientSurface', () => {
  it('draws the scheme gradient of the requested variant', async () => {
    await renderKit(
      <GradientSurface variant="hero" testID="hero">
        <Text>Inside</Text>
      </GradientSurface>,
    );
    expect(screen.getByText('Inside')).toBeTruthy();
    // The native view receives processed colors.
    expect(screen.getByTestId('hero').props.colors).toEqual(gradients.light.hero.map((stop) => processColor(stop)));
  });
});

describe('PressableScale', () => {
  it('fires onPress and keeps the accessibility role', async () => {
    const onPress = jest.fn();
    await renderKit(
      <PressableScale onPress={onPress} accessibilityRole="button" testID="press">
        <Text>Tap</Text>
      </PressableScale>,
    );
    const node = screen.getByTestId('press');
    expect(node.props.accessibilityRole).toBe('button');
    await act(async () => {
      fireEvent(node, 'pressIn');
      fireEvent(node, 'pressOut');
      fireEvent.press(node);
    });
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('Reveal', () => {
  it('staggers rows up to the cap', () => {
    expect(revealDelay(0, 0)).toBe(0);
    expect(revealDelay(0, 3)).toBe(120);
    expect(revealDelay(100, 50)).toBe(100 + 8 * 40);
  });

  it('renders its children (static under reduce motion)', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValueOnce(true);
    await renderKit(
      <Reveal testID="reveal">
        <Text>Shown</Text>
      </Reveal>,
    );
    expect(screen.getByText('Shown')).toBeTruthy();
  });
});

describe('GradientFab', () => {
  it('is an extended button with the label as its accessible name', async () => {
    const onPress = jest.fn();
    await renderKit(<GradientFab icon="plus" label="New meeting" onPress={onPress} testID="fab" />);
    const fab = screen.getByTestId('fab');
    expect(fab.props.accessibilityRole).toBe('button');
    expect(fab.props.accessibilityLabel).toBe('New meeting');
    expect(screen.getByText('New meeting')).toBeTruthy();
    await act(async () => {
      fireEvent.press(fab);
    });
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('Card variants', () => {
  it('outlined keeps the hairline, gradient paints the primary ramp', async () => {
    await renderKit(
      <>
        <Card variant="outlined" testID="outlined">
          <Text>Flat</Text>
        </Card>
        <Card variant="gradient" testID="gradient">
          <Text>Bold</Text>
        </Card>
      </>,
    );
    const outlined = screen.getByTestId('outlined');
    const flat = Array.isArray(outlined.props.style) ? Object.assign({}, ...outlined.props.style.flat(Infinity).filter(Boolean)) : outlined.props.style;
    expect(flat.borderWidth).toBe(1);
    expect(flat.borderColor).toBe(lightColors.outlineVariant);
    expect(screen.getByText('Bold')).toBeTruthy();
  });
});

describe('MGButton filled (gradient)', () => {
  it('shows the icon and label, reports busy while loading, and blocks presses then', async () => {
    const onPress = jest.fn();
    const view = await renderKit(
      <MGButton icon="video" onPress={onPress} testID="join">
        Join
      </MGButton>,
    );
    expect(screen.getByText('Join')).toBeTruthy();
    expect(screen.getByTestId('join').props.accessibilityRole).toBe('button');
    await act(async () => {
      fireEvent.press(screen.getByTestId('join'));
    });
    expect(onPress).toHaveBeenCalledTimes(1);

    await view.rerender(
      wrap(
        <MGButton icon="video" loading onPress={onPress} testID="join">
          Join
        </MGButton>,
      ),
    );
    await act(async () => undefined);
    expect(screen.getByTestId('join').props.accessibilityState).toEqual(expect.objectContaining({ busy: true }));
    await act(async () => {
      fireEvent.press(screen.getByTestId('join'));
    });
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('light and spark effects', () => {
  it('render as decorative layers that take no touches and no focus', async () => {
    await renderKit(
      <>
        <Glow color="#4646D3" size={120} testID="glow" />
        <Shimmer testID="shimmer" />
        <Sparkles color="#FFFFFF" size={96} testID="sparks" />
        <AuroraBackdrop testID="aurora" />
        <Card variant="glass" testID="glass">
          <Text>Glass</Text>
        </Card>
      </>,
    );
    for (const id of ['glow', 'shimmer', 'sparks', 'aurora']) {
      // Decorative layers are hidden from the accessibility tree, so the query must include them.
      const node = screen.getByTestId(id, { includeHiddenElements: true });
      expect(node.props.pointerEvents).toBe('none');
      expect(node.props.accessibilityElementsHidden).toBe(true);
    }
    expect(screen.getByText('Glass')).toBeTruthy();
  });
});
