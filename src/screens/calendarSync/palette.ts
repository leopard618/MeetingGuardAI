/**
 * Colors of the calendar sync screen and the "Connect Google Calendar" prompt, following the
 * app theme (ThemeContext: system / light / dark).
 */
import { useTheme } from '../../contexts/ThemeContext';
import type { Tone } from './calendarSyncModel';

export interface CalendarPalette {
  background: string;
  card: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  onAccent: string;
  disabled: string;
  success: string;
  successSurface: string;
  onSuccessSurface: string;
  warning: string;
  danger: string;
  backdrop: string;
}

const LIGHT: CalendarPalette = {
  background: '#f8fafc',
  card: '#ffffff',
  border: '#e2e8f0',
  text: '#1e293b',
  muted: '#64748b',
  accent: '#2563eb',
  onAccent: '#ffffff',
  disabled: '#94a3b8',
  success: '#059669',
  successSurface: '#d1fae5',
  onSuccessSurface: '#065f46',
  warning: '#b45309',
  danger: '#dc2626',
  backdrop: 'rgba(0, 0, 0, 0.5)',
};

const DARK: CalendarPalette = {
  background: '#0f172a',
  card: '#1e293b',
  border: '#334155',
  text: '#f1f5f9',
  muted: '#94a3b8',
  accent: '#60a5fa',
  onAccent: '#0b1220',
  disabled: '#475569',
  success: '#34d399',
  successSurface: '#065f46',
  onSuccessSurface: '#d1fae5',
  warning: '#fbbf24',
  danger: '#f87171',
  backdrop: 'rgba(0, 0, 0, 0.65)',
};

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
