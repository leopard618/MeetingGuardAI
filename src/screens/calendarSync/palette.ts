/**
 * Colors of the calendar sync screen and the "Connect Google Calendar" prompt, following the
 * app theme (ThemeContext: system / light / dark). Every value is an MG Indigo token
 * (src/theme/tokens.ts) — the old blue/slate literals are gone (docs/DESIGN_SYSTEM.md §7 D).
 */
import { useTheme } from '../../contexts/ThemeContext';
// Tokens are imported directly (not the src/theme barrel): this module is consumed by screens
// whose tests mock ThemeContext, so it must not depend on the barrel's hook wiring.
import { mgColors, type MGColors } from '../../theme/tokens';
import type { Tone } from './calendarSyncModel';

export interface CalendarPalette {
  background: string;
  card: string;
  /** outlineVariant: decorative card edges and row hairlines. */
  border: string;
  text: string;
  muted: string;
  accent: string;
  onAccent: string;
  /** surfaceDisabled: the fill of a disabled button (label = disabledText). */
  disabled: string;
  /** Disabled labels only (WCAG-exempt). */
  disabledText: string;
  success: string;
  successSurface: string;
  onSuccessSurface: string;
  warning: string;
  warningSurface: string;
  onWarningSurface: string;
  /** surfaceVariant + onSurface: the neutral status badge. */
  neutralSurface: string;
  danger: string;
  backdrop: string;
}

function paletteFromTokens(c: MGColors): CalendarPalette {
  return {
    background: c.background,
    card: c.surface,
    border: c.outlineVariant,
    text: c.onSurface,
    muted: c.onSurfaceVariant,
    accent: c.primary,
    onAccent: c.onPrimary,
    disabled: c.surfaceDisabled,
    disabledText: c.disabledText,
    success: c.success,
    successSurface: c.successContainer,
    onSuccessSurface: c.onSuccessContainer,
    warning: c.warning,
    warningSurface: c.warningContainer,
    onWarningSurface: c.onWarningContainer,
    neutralSurface: c.surfaceVariant,
    danger: c.error,
    backdrop: c.backdrop,
  };
}

const LIGHT: CalendarPalette = paletteFromTokens(mgColors.light);

const DARK: CalendarPalette = paletteFromTokens(mgColors.dark);

export function calendarPalette(isDarkMode: boolean): CalendarPalette {
  return isDarkMode ? DARK : LIGHT;
}

export function useCalendarPalette(): CalendarPalette {
  const { isDarkMode } = useTheme();
  return calendarPalette(isDarkMode);
}

export function toneColor(palette: CalendarPalette, tone: Tone): string {
  if (tone === 'success') return palette.success;
  if (tone === 'warning') return palette.warning;
  return palette.muted;
}

/** Container pair for the provider status badge (AA text in both schemes). */
export function toneBadgeColors(palette: CalendarPalette, tone: Tone): { color: string; background: string } {
  if (tone === 'success') return { color: palette.onSuccessSurface, background: palette.successSurface };
  if (tone === 'warning') return { color: palette.onWarningSurface, background: palette.warningSurface };
  return { color: palette.text, background: palette.neutralSurface };
}
