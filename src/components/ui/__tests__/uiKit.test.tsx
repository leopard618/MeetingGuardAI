/**
 * Render tests for the MG component kit (docs/v1/DESIGN_SYSTEM.md §5): every component renders
 * under the real providers, presses fire, disabled/selected states surface through
 * accessibilityState, and the semantic tones map to the documented Container token pairs.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { StyleSheet, Text } from 'react-native';
import { PaperProvider } from 'react-native-paper';

import { PAPER_THEMES } from '../../../contexts/themeColors';
import { ThemeProvider } from '../../../contexts/ThemeContext';
import { I18nProvider } from '../../../i18n';
import { lightColors } from '../../../theme/tokens';
import {
  Badge,
  Banner,
  Card,
  EmptyState,
  ErrorState,
  ListGroup,
  ListRow,
  LoadingState,
  MGButton,
  SectionHeader,
  SheetHandle,
  Skeleton,
} from '../index';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'UTC', uses24hourClock: false }]),
}));

async function renderKit(element: ReactElement) {
  await render(
    <I18nProvider>
      <ThemeProvider>
        <PaperProvider theme={PAPER_THEMES.light}>{element}</PaperProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
  await act(async () => undefined);
}

function backgroundOf(testID: string): string | undefined {
  const style = StyleSheet.flatten(screen.getByTestId(testID).props.style) as { backgroundColor?: string };
  return style.backgroundColor;
}

describe('MGButton', () => {
  it('renders every variant and fires onPress', async () => {
    const onPress = jest.fn();
    await renderKit(
      <>
        <MGButton onPress={onPress} testID="btn-filled">
          Save
        </MGButton>
        <MGButton variant="tonal" testID="btn-tonal">
          Tonal
        </MGButton>
        <MGButton variant="outline" testID="btn-outline">
          Outline
        </MGButton>
        <MGButton variant="ghost" size="sm" testID="btn-ghost">
          Ghost
        </MGButton>
        <MGButton variant="destructive" testID="btn-destructive">
          Delete
        </MGButton>
      </>,
    );
    for (const label of ['Save', 'Tonal', 'Outline', 'Ghost', 'Delete']) expect(screen.getByText(label)).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('btn-filled'));
    });
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('blocks presses while disabled', async () => {
    const onPress = jest.fn();
    await renderKit(
      <MGButton onPress={onPress} disabled testID="btn-disabled">
        Save
      </MGButton>,
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId('btn-disabled'));
    });
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('Card', () => {
  it('renders children on a bordered surface', async () => {
    await renderKit(
      <Card testID="card">
        <Text>Inside</Text>
      </Card>,
    );
    expect(screen.getByText('Inside')).toBeTruthy();
    expect(backgroundOf('card')).toBe(lightColors.surface);
  });

  it('tints the focal card with accent="primary"', async () => {
    await renderKit(
      <Card accent="primary" testID="focal">
        <Text>Next meeting</Text>
      </Card>,
    );
    expect(backgroundOf('focal')).toBe(lightColors.primaryContainer);
  });

  it('is pressable with a button role when onPress is given', async () => {
    const onPress = jest.fn();
    await renderKit(
      <Card onPress={onPress} testID="pressable-card">
        <Text>Open</Text>
      </Card>,
    );
    const card = screen.getByTestId('pressable-card');
    expect(card.props.accessibilityRole).toBe('button');
    await act(async () => {
      fireEvent.press(card);
    });
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('SectionHeader', () => {
  it('renders the title as a header with an optional action', async () => {
    const onPress = jest.fn();
    await renderKit(<SectionHeader title="Today" action={{ label: 'See all', onPress }} testID="header" />);
    expect(screen.getByRole('header', { name: 'Today' })).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('header-action'));
    });
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders a plain trailing node', async () => {
    await renderKit(<SectionHeader title="Today" trailing={<Text>4 meetings</Text>} testID="header-trailing" />);
    expect(screen.getByRole('header', { name: 'Today' })).toBeTruthy();
    expect(screen.getByText('4 meetings')).toBeTruthy();
  });
});

describe('ListGroup / ListRow', () => {
  it('renders rows with title, supporting text and chevron', async () => {
    const onPress = jest.fn();
    await renderKit(
      <ListGroup testID="group">
        <ListRow icon="calendar" title="Calendar" supporting="Google" trailing="chevron" onPress={onPress} testID="row-1" />
        <ListRow title="Notes" trailing={<Text>3</Text>} testID="row-2" />
      </ListGroup>,
    );
    expect(screen.getByText('Calendar')).toBeTruthy();
    expect(screen.getByText('Google')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('row-1'));
    });
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('exposes selected and disabled through accessibilityState', async () => {
    const onPress = jest.fn();
    await renderKit(
      <>
        <ListRow title="Active" selected onPress={jest.fn()} testID="row-selected" />
        <ListRow title="Off" disabled onPress={onPress} testID="row-disabled" />
      </>,
    );
    expect(screen.getByTestId('row-selected').props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
    expect(screen.getByTestId('row-disabled').props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
    await act(async () => {
      fireEvent.press(screen.getByTestId('row-disabled'));
    });
    expect(onPress).not.toHaveBeenCalled();
  });

  it('tints selected rows with surfaceContainerHigh', async () => {
    await renderKit(<ListRow title="Active" selected testID="row-tinted" />);
    expect(backgroundOf('row-tinted')).toBe(lightColors.surfaceContainerHigh);
  });

  it('renders destructive rows with the error title color', async () => {
    const onPress = jest.fn();
    await renderKit(<ListRow icon="trash-can-outline" title="Delete account" tone="destructive" onPress={onPress} testID="row-destructive" />);
    const title = StyleSheet.flatten(screen.getByText('Delete account').props.style) as { color?: string };
    expect(title.color).toBe(lightColors.error);
    await act(async () => {
      fireEvent.press(screen.getByTestId('row-destructive'));
    });
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('EmptyState / ErrorState / LoadingState / Skeleton', () => {
  it('renders the empty state with an action', async () => {
    const onPress = jest.fn();
    await renderKit(
      <EmptyState icon="calendar-blank-outline" title="No meetings" body="Create your first meeting." action={{ label: 'Create', onPress }} testID="empty" />,
    );
    // The title is a heading anchor for screen-reader navigation (parity with the
    // per-screen empty titles the kit replaced).
    expect(screen.getByRole('header', { name: 'No meetings' })).toBeTruthy();
    expect(screen.getByText('Create your first meeting.')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('empty-action'));
    });
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders the error state with a localized Retry', async () => {
    const onRetry = jest.fn();
    await renderKit(<ErrorState body="Something failed." onRetry={onRetry} testID="error" />);
    expect(screen.getByText('Something failed.')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByText('Try again'));
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('disables Retry while loading', async () => {
    const onRetry = jest.fn();
    await renderKit(<ErrorState body="Something failed." onRetry={onRetry} loading testID="error-loading" />);
    await act(async () => {
      fireEvent.press(screen.getByText('Try again'));
    });
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('renders the loading spinner and the skeleton block', async () => {
    await renderKit(
      <>
        <LoadingState testID="loading" />
        <Skeleton width="100%" height={24} testID="skeleton" />
      </>,
    );
    expect(screen.getByTestId('loading')).toBeTruthy();
    // Hidden from accessibility by design, so it must be queried with hidden elements included.
    expect(screen.queryByTestId('skeleton')).toBeNull();
    const skeleton = screen.getByTestId('skeleton', { includeHiddenElements: true });
    expect(skeleton.props.accessibilityElementsHidden).toBe(true);
  });
});

describe('Badge', () => {
  it('maps tones to the documented Container pairs', async () => {
    await renderKit(
      <>
        <Badge label="Neutral" testID="badge-neutral" />
        <Badge label="Active" tone="success" testID="badge-success" />
        <Badge label="Off" tone="warning" testID="badge-warning" />
      </>,
    );
    expect(screen.getByText('Active')).toBeTruthy();
    expect(backgroundOf('badge-neutral')).toBe(lightColors.surfaceVariant);
    expect(backgroundOf('badge-success')).toBe(lightColors.successContainer);
    expect(backgroundOf('badge-warning')).toBe(lightColors.warningContainer);
  });
});

describe('Banner', () => {
  it('announces itself and fires the action', async () => {
    const onPress = jest.fn();
    await renderKit(<Banner tone="warning" title="Offline" text="You are offline." action={{ label: 'Sync', onPress }} testID="banner" />);
    expect(screen.getByText('Offline')).toBeTruthy();
    const banner = screen.getByTestId('banner');
    expect(banner.props.accessibilityRole).toBe('alert');
    expect(screen.getByText('You are offline.')).toBeTruthy();
    expect(backgroundOf('banner')).toBe(lightColors.warningContainer);
    await act(async () => {
      fireEvent.press(screen.getByTestId('banner-action'));
    });
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('SheetHandle', () => {
  it('renders decorative-only', async () => {
    await renderKit(<SheetHandle />);
    // No text, no accessible elements: nothing to query by role.
    expect(screen.queryByRole('button')).toBeNull();
  });
});
