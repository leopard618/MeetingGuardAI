/**
 * MG Indigo design tokens (owner: shell / Foundation). Single source of truth for every design
 * value in the app - see docs/v1/DESIGN_SYSTEM.md for intent and per-screen application.
 *
 * Pure module: no React, no react-native, no react-native-paper imports, so it can be consumed
 * by src/contexts/themeColors.ts (Paper theme construction), by components via the src/theme
 * barrel (useAppTheme), and by provider-less surfaces (ErrorBoundary fallback) directly.
 *
 * Every text/background pairing here was machine-checked for WCAG 2.1 AA (>= 4.5:1 text,
 * >= 3:1 graphics) in both schemes. Do not tweak individual values without re-checking.
 * The elevation levels MUST stay solid hexes: Paper's Surface breaks shadows on translucent
 * values.
 */

export type MGSchemeName = 'light' | 'dark';

/** Brand tonal ramp, tone 10 (darkest) to 95 (lightest). */
export const indigoRamp = {
  10: '#101273',
  20: '#26268F',
  30: '#34349E',
  40: '#4646D3',
  50: '#6A6BE8',
  60: '#8F94F3',
  70: '#AFB4FF',
  80: '#C7CCFA',
  90: '#E3E6FC',
  95: '#F0F1FE',
} as const;

/** Six solid surface steps feeding Paper's colors.elevation. */
export interface MGElevation {
  level0: string;
  level1: string;
  level2: string;
  level3: string;
  level4: string;
  level5: string;
}

/** Categorical data palette (insights bars, calendar source dots, note categories). */
export type MGChartPalette = readonly [string, string, string, string, string, string];

/** MAX alert overlay identity - mode-invariant (always dark), safety-critical, all pairs AA. */
export interface MGAlertMaxColors {
  bg: string;
  ring: string;
  ringBorder: string;
  heading: string;
  title: string;
  when: string;
  countdownTrack: string;
  countdownFill: string;
  ackBg: string;
  ackText: string;
  joinBg: string;
  joinText: string;
  snoozeBorder: string;
  snoozeText: string;
}

/** MEDIUM alert banner identity - mode-invariant. */
export interface MGAlertMediumColors {
  bg: string;
  accentBar: string;
  title: string;
  body: string;
  actionBg: string;
  actionText: string;
}

/** LIGHT alert toast identity - mode-invariant; AppToast reuses bg/title/body. */
export interface MGAlertLightColors {
  bg: string;
  icon: string;
  title: string;
  body: string;
  actionBg: string;
  actionText: string;
}

export const alertMax: MGAlertMaxColors = {
  bg: '#3D0A12',
  ring: '#E5484D',
  ringBorder: '#FF8A8F',
  heading: '#FFD3D6',
  title: '#FFFFFF',
  when: '#FFD9A0',
  countdownTrack: 'rgba(255,255,255,0.20)',
  countdownFill: '#FFD9A0',
  ackBg: '#FFFFFF',
  ackText: '#8F1D2C',
  joinBg: '#177245',
  joinText: '#FFFFFF',
  snoozeBorder: '#FF8A8F',
  snoozeText: '#FFD3D6',
};

export const alertMedium: MGAlertMediumColors = {
  bg: 'rgba(22,31,46,0.97)',
  accentBar: '#F5B950',
  title: '#FFFFFF',
  body: '#C4CEDC',
  actionBg: '#F5B950',
  actionText: '#402500',
};

export const alertLight: MGAlertLightColors = {
  bg: 'rgba(27,37,54,0.96)',
  icon: '#AFB4FF',
  title: '#F1F5FA',
  body: '#B9C4D4',
  actionBg: '#4646D3',
  actionText: '#FFFFFF',
};

/** Full per-scheme color set (MD3-compatible roles + MG extras + mode-invariant alert groups). */
export interface MGColors {
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  secondary: string;
  onSecondary: string;
  secondaryContainer: string;
  onSecondaryContainer: string;
  tertiary: string;
  onTertiary: string;
  tertiaryContainer: string;
  onTertiaryContainer: string;
  background: string;
  onBackground: string;
  surface: string;
  onSurface: string;
  surfaceVariant: string;
  onSurfaceVariant: string;
  /** Not in Paper's MD3Colors - MG extras (dark input bg / selected-active rows). */
  surfaceContainerLow: string;
  surfaceContainerHigh: string;
  /** Functional borders (inputs, unselected chips): >= 3:1 on surface. */
  outline: string;
  /** Decorative hairlines (card edges, dividers): deliberately below 3:1. */
  outlineVariant: string;
  inverseSurface: string;
  inverseOnSurface: string;
  inversePrimary: string;
  error: string;
  onError: string;
  errorContainer: string;
  onErrorContainer: string;
  success: string;
  onSuccess: string;
  successContainer: string;
  onSuccessContainer: string;
  warning: string;
  onWarning: string;
  warningContainer: string;
  onWarningContainer: string;
  info: string;
  onInfo: string;
  infoContainer: string;
  onInfoContainer: string;
  /** Disabled labels only (WCAG-exempt); never for real copy. */
  disabledText: string;
  surfaceDisabled: string;
  onSurfaceDisabled: string;
  shadow: string;
  scrim: string;
  backdrop: string;
  elevation: MGElevation;
  chart: MGChartPalette;
  alertMax: MGAlertMaxColors;
  alertMedium: MGAlertMediumColors;
  alertLight: MGAlertLightColors;
}

export const chartPalette: Readonly<Record<MGSchemeName, MGChartPalette>> = {
  light: ['#4646D3', '#0B7A6E', '#A8580B', '#BC3069', '#0A64A0', '#64748B'],
  dark: ['#8F94F3', '#3ECFBE', '#F0A64B', '#F383AE', '#5BB7F5', '#93A3B8'],
};

export const lightColors: MGColors = {
  primary: '#4646D3',
  onPrimary: '#FFFFFF',
  primaryContainer: '#E3E6FC',
  onPrimaryContainer: '#26268F',
  secondary: '#44566E',
  onSecondary: '#FFFFFF',
  secondaryContainer: '#E3E9F1',
  onSecondaryContainer: '#273548',
  tertiary: '#0B7A6E',
  onTertiary: '#FFFFFF',
  tertiaryContainer: '#D3F2F7',
  onTertiaryContainer: '#0F4E5A',
  background: '#F6F8FB',
  onBackground: '#0F172A',
  surface: '#FFFFFF',
  onSurface: '#0F172A',
  surfaceVariant: '#E7ECF3',
  onSurfaceVariant: '#49586C',
  surfaceContainerLow: '#FBFCFE',
  surfaceContainerHigh: '#E9EEF5',
  outline: '#7A8699',
  outlineVariant: '#E1E7EE',
  inverseSurface: '#2A3446',
  inverseOnSurface: '#EEF2F7',
  inversePrimary: '#AFB4FF',
  error: '#C62B2B',
  onError: '#FFFFFF',
  errorContainer: '#FBE1E1',
  onErrorContainer: '#7C1D1D',
  success: '#177245',
  onSuccess: '#FFFFFF',
  successContainer: '#D9F2E3',
  onSuccessContainer: '#0E4A2C',
  warning: '#96570A',
  onWarning: '#FFFFFF',
  warningContainer: '#FDEBD3',
  onWarningContainer: '#5C3400',
  info: '#0A64A0',
  onInfo: '#FFFFFF',
  infoContainer: '#DBEEFB',
  onInfoContainer: '#083A5C',
  disabledText: '#8D99AA',
  surfaceDisabled: 'rgba(15,23,42,0.12)',
  onSurfaceDisabled: '#8D99AA',
  shadow: '#000000',
  scrim: 'rgba(10,15,26,0.48)',
  backdrop: 'rgba(10,15,26,0.40)',
  elevation: {
    level0: 'transparent',
    level1: '#F7F7FD',
    level2: '#F2F3FB',
    level3: '#EDEFFA',
    level4: '#EBEDF9',
    level5: '#E8EAF8',
  },
  chart: chartPalette.light,
  alertMax,
  alertMedium,
  alertLight,
};

export const darkColors: MGColors = {
  primary: '#AFB4FF',
  onPrimary: '#101273',
  primaryContainer: '#34349E',
  onPrimaryContainer: '#E3E6FC',
  secondary: '#AEBED4',
  onSecondary: '#1C2B3E',
  secondaryContainer: '#32415A',
  onSecondaryContainer: '#DDE5EF',
  tertiary: '#3ECFBE',
  onTertiary: '#0A3A34',
  tertiaryContainer: '#0F515F',
  onTertiaryContainer: '#C6EEF6',
  background: '#0C1320',
  onBackground: '#E7EDF6',
  surface: '#131C2B',
  onSurface: '#E7EDF6',
  surfaceVariant: '#26334A',
  onSurfaceVariant: '#9AA8BE',
  surfaceContainerLow: '#18202F',
  surfaceContainerHigh: '#202B40',
  outline: '#5E6F8D',
  outlineVariant: '#27324A',
  inverseSurface: '#E7EDF6',
  inverseOnSurface: '#1B2433',
  inversePrimary: '#4646D3',
  error: '#FF9F9F',
  onError: '#4C0F0F',
  errorContainer: '#7C2222',
  onErrorContainer: '#FFD9D9',
  success: '#6CD9A0',
  onSuccess: '#0A3D26',
  successContainer: '#14543A',
  onSuccessContainer: '#C9F2DC',
  warning: '#F5B950',
  onWarning: '#402500',
  warningContainer: '#6B3F05',
  onWarningContainer: '#FFE3B3',
  info: '#79C0F7',
  onInfo: '#0A2A42',
  infoContainer: '#0D4A75',
  onInfoContainer: '#D3EAFB',
  disabledText: '#5F6E84',
  surfaceDisabled: 'rgba(231,237,246,0.12)',
  onSurfaceDisabled: '#5F6E84',
  shadow: '#000000',
  scrim: 'rgba(0,0,0,0.60)',
  backdrop: 'rgba(0,0,0,0.52)',
  elevation: {
    level0: 'transparent',
    level1: '#1B2333',
    level2: '#1F2737',
    level3: '#232C3E',
    level4: '#252E41',
    level5: '#293246',
  },
  chart: chartPalette.dark,
  alertMax,
  alertMedium,
  alertLight,
};

export const mgColors: Readonly<Record<MGSchemeName, MGColors>> = {
  light: lightColors,
  dark: darkColors,
};

/**
 * Canonical chart-palette index per meeting source (accent bars, calendar dots, timeline dots,
 * legends). Groups B, C and D must all read from this map so the hue for a source never forks.
 */
export const sourceColorIndex = {
  manual: 0,
  ai_chat: 1,
  google: 4,
  device: 5,
  outlook: 3,
  whatsapp: 2,
} as const;

/** Canonical chart-palette index per note category (NoteCard accent bar, filter-chip dots). */
export const noteCategoryColorIndex = {
  general: 5,
  work: 4,
  ideas: 2,
  personal: 3,
} as const;

/**
 * Exactly the color fields react-native-paper 5's MD3Colors knows (5.15.3 has no surfaceTint /
 * surfaceContainer* - our containers feed Paper only through elevation). Foundation builds the
 * Paper themes as { ...MD3LightTheme, roundness: 3, colors: { ...MD3LightTheme.colors,
 * ...paperColorOverrides.light } } (dark analogous).
 */
export interface MGPaperColorOverrides {
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  secondary: string;
  onSecondary: string;
  secondaryContainer: string;
  onSecondaryContainer: string;
  tertiary: string;
  onTertiary: string;
  tertiaryContainer: string;
  onTertiaryContainer: string;
  background: string;
  onBackground: string;
  surface: string;
  onSurface: string;
  surfaceVariant: string;
  onSurfaceVariant: string;
  surfaceDisabled: string;
  onSurfaceDisabled: string;
  outline: string;
  outlineVariant: string;
  error: string;
  onError: string;
  errorContainer: string;
  onErrorContainer: string;
  inverseSurface: string;
  inverseOnSurface: string;
  inversePrimary: string;
  shadow: string;
  scrim: string;
  backdrop: string;
  elevation: MGElevation;
}

function toPaperColors(c: MGColors): MGPaperColorOverrides {
  return {
    primary: c.primary,
    onPrimary: c.onPrimary,
    primaryContainer: c.primaryContainer,
    onPrimaryContainer: c.onPrimaryContainer,
    secondary: c.secondary,
    onSecondary: c.onSecondary,
    secondaryContainer: c.secondaryContainer,
    onSecondaryContainer: c.onSecondaryContainer,
    tertiary: c.tertiary,
    onTertiary: c.onTertiary,
    tertiaryContainer: c.tertiaryContainer,
    onTertiaryContainer: c.onTertiaryContainer,
    background: c.background,
    onBackground: c.onBackground,
    surface: c.surface,
    onSurface: c.onSurface,
    surfaceVariant: c.surfaceVariant,
    onSurfaceVariant: c.onSurfaceVariant,
    surfaceDisabled: c.surfaceDisabled,
    onSurfaceDisabled: c.onSurfaceDisabled,
    outline: c.outline,
    outlineVariant: c.outlineVariant,
    error: c.error,
    onError: c.onError,
    errorContainer: c.errorContainer,
    onErrorContainer: c.onErrorContainer,
    inverseSurface: c.inverseSurface,
    inverseOnSurface: c.inverseOnSurface,
    inversePrimary: c.inversePrimary,
    shadow: c.shadow,
    scrim: c.scrim,
    backdrop: c.backdrop,
    elevation: c.elevation,
  };
}

export const paperColorOverrides: Readonly<Record<MGSchemeName, MGPaperColorOverrides>> = {
  light: toPaperColors(lightColors),
  dark: toPaperColors(darkColors),
};

/** Assignable to react-native TextStyle.fontWeight. */
export type MGFontWeight = '400' | '500' | '600' | '700';

/** Spread directly into a StyleSheet text style. */
export interface MGTypeStyle {
  fontSize: number;
  lineHeight: number;
  fontWeight: MGFontWeight;
  letterSpacing: number;
}

export type MGTypographyVariant =
  | 'displayS'
  | 'headlineL'
  | 'headlineM'
  | 'headlineS'
  | 'titleL'
  | 'titleM'
  | 'titleS'
  | 'bodyL'
  | 'bodyM'
  | 'bodyS'
  | 'labelL'
  | 'labelM'
  | 'labelS';

export type MGTypography = Readonly<Record<MGTypographyVariant, MGTypeStyle>>;

export const typography: MGTypography = {
  displayS: { fontSize: 36, lineHeight: 44, fontWeight: '700', letterSpacing: 0 },
  headlineL: { fontSize: 28, lineHeight: 36, fontWeight: '700', letterSpacing: 0 },
  headlineM: { fontSize: 24, lineHeight: 32, fontWeight: '700', letterSpacing: 0 },
  headlineS: { fontSize: 20, lineHeight: 28, fontWeight: '600', letterSpacing: 0 },
  titleL: { fontSize: 20, lineHeight: 28, fontWeight: '600', letterSpacing: 0 },
  titleM: { fontSize: 16, lineHeight: 24, fontWeight: '600', letterSpacing: 0.1 },
  titleS: { fontSize: 14, lineHeight: 20, fontWeight: '600', letterSpacing: 0.1 },
  bodyL: { fontSize: 16, lineHeight: 24, fontWeight: '400', letterSpacing: 0.15 },
  bodyM: { fontSize: 14, lineHeight: 20, fontWeight: '400', letterSpacing: 0.25 },
  bodyS: { fontSize: 12, lineHeight: 16, fontWeight: '400', letterSpacing: 0.4 },
  labelL: { fontSize: 14, lineHeight: 20, fontWeight: '600', letterSpacing: 0.1 },
  labelM: { fontSize: 12, lineHeight: 16, fontWeight: '500', letterSpacing: 0.3 },
  labelS: { fontSize: 11, lineHeight: 16, fontWeight: '500', letterSpacing: 0.4 },
};

/** 4pt grid - the only spacing values allowed in StyleSheets. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
} as const;

export type MGSpacing = typeof spacing;

/**
 * Radius scale: xs badge, sm chip/small button, md input/list group/banner, lg card/toast,
 * xl FAB/modal, sheet = bottom-sheet top corners, full = pill/avatar.
 */
export const radii = {
  xs: 6,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  sheet: 28,
  full: 999,
} as const;

export type MGRadii = typeof radii;

/**
 * Alpha levels for pressed / ripple feedback (docs/v1/DESIGN_SYSTEM.md §8), applied with withAlpha:
 * cards ripple primary@10%, list rows onSurface@8%, 44dp icon buttons onSurface@12%.
 */
export const stateAlpha = {
  rippleOnCard: 0.1,
  rippleOnRow: 0.08,
  rippleOnIcon: 0.12,
} as const;

/** iOS pressed-state fallback opacity for Pressables that also have an `android_ripple`. */
export const pressedOpacity = 0.96;

/**
 * Visible pressed dim for Pressables WITHOUT an `android_ripple` (alert-overlay buttons, banner /
 * section-header text actions, bespoke pill buttons). 0.96 is imperceptible on Android, so
 * ripple-less controls use this instead on both platforms (docs/v1/DESIGN_SYSTEM.md §8).
 */
export const pressedDimOpacity = 0.75;

/**
 * `#RRGGBB` (or `#RGB`) -> `rgba(r,g,b,alpha)`. The only sanctioned way to derive a translucent
 * color (ripples, pressed tints) from a token. Non-hex input is returned unchanged.
 */
export function withAlpha(hex: string, alpha: number): string {
  const match = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex);
  if (!match) return hex;
  let digits = match[1] ?? '';
  if (digits.length === 3) digits = digits.replace(/./g, (d) => d + d);
  const r = parseInt(digits.slice(0, 2), 16);
  const g = parseInt(digits.slice(2, 4), 16);
  const b = parseInt(digits.slice(4, 6), 16);
  const a = Math.min(1, Math.max(0, alpha));
  return `rgba(${r},${g},${b},${a})`;
}

/** Fixed component metrics at 360dp-and-up (dp). Touch targets never below touchTargetMin. */
export const componentMetrics = {
  touchTargetMin: 44,
  screenGutter: 16,
  sectionGap: 24,
  cardPadding: 16,
  cardGap: 12,
  buttonHeight: 48,
  buttonHeightSmall: 40,
  alertButtonHeight: 52,
  inputHeight: 52,
  listRowMinHeight: 56,
  listRowTwoLineMinHeight: 72,
  listRowPaddingH: 16,
  listRowPaddingV: 12,
  /** Meta icons beside bodyS/labelM text (card meta rows, warning lines, pills). */
  iconMeta: 16,
  iconInline: 20,
  iconNav: 24,
  avatarSize: 40,
  fabSize: 56,
  headerMinHeight: 56,
  headerRippleRadius: 22,
  /** Bottom navigation bar of the Main group: row height above the safe-area inset; active pill behind the icon. */
  bottomBarHeight: 64,
  bottomBarPillWidth: 56,
  bottomBarPillHeight: 32,
  emptyStateCircle: 96,
  emptyStateIcon: 48,
  sheetHandleWidth: 32,
  sheetHandleHeight: 4,
  accentBarWidth: 4,
  sourceDotSize: 8,
  calendarDotSize: 5,
  calendarDayMinSize: 40,
} as const;

export type MGComponentMetrics = typeof componentMetrics;
