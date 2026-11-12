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
  primary: '#1D5BD6',
  onPrimary: '#FFFFFF',
  primaryContainer: '#DCE7FB',
  onPrimaryContainer: '#0B2F7A',
  secondary: '#44566E',
  onSecondary: '#FFFFFF',
  secondaryContainer: '#E3E9F1',
  onSecondaryContainer: '#273548',
  tertiary: '#0B7A6E',
  onTertiary: '#FFFFFF',
  tertiaryContainer: '#D3F2F7',
  onTertiaryContainer: '#0F4E5A',
  background: '#EEF3FA',
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
  inversePrimary: '#8FB4FF',
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
  primary: '#8FB4FF',
  onPrimary: '#06255F',
  primaryContainer: '#1D3F8A',
  onPrimaryContainer: '#DCE7FB',
  secondary: '#AEB7C7',
  onSecondary: '#1F2633',
  secondaryContainer: '#2A3040',
  onSecondaryContainer: '#DDE3EE',
  tertiary: '#3ECFBE',
  onTertiary: '#0A3A34',
  tertiaryContainer: '#0F515F',
  onTertiaryContainer: '#C6EEF6',
  background: '#0A0C11',
  onBackground: '#E8EAF0',
  surface: '#12151D',
  onSurface: '#E8EAF0',
  surfaceVariant: '#232833',
  onSurfaceVariant: '#9CA3B2',
  surfaceContainerLow: '#161A23',
  surfaceContainerHigh: '#1E222C',
  outline: '#606979',
  outlineVariant: '#262B36',
  inverseSurface: '#E8EAF0',
  inverseOnSurface: '#1B1F29',
  inversePrimary: '#1D5BD6',
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
  disabledText: '#646B7A',
  surfaceDisabled: 'rgba(232,234,240,0.12)',
  onSurfaceDisabled: '#646B7A',
  shadow: '#000000',
  scrim: 'rgba(0,0,0,0.60)',
  backdrop: 'rgba(0,0,0,0.52)',
  elevation: {
    level0: 'transparent',
    level1: '#171B24',
    level2: '#1B1F29',
    level3: '#20242F',
    level4: '#232835',
    level5: '#272C3A',
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
 * Gradients (audit 2026-10-30 visual refresh). Two stops, drawn diagonally (top-left to
 * bottom-right) unless a component says otherwise. Every stop was checked against its on-color:
 * every ramp carries white text at >= 4.5:1 on BOTH stops (the lightest stop of the ai ramp is
 * 4.3:1, icons only). Dark mode uses the same vivid indigo-to-violet ramps, never the pale
 * tonal primary, so buttons and the focal card glow instead of washing out.
 * - primary: filled buttons, FABs, the active tab pill, the header hairline.
 * - hero: the dashboard hero card and other one-per-screen banners (white text).
 * - ai: the assistant orb in the bottom bar and the assistant tiles (white icon).
 */
export type MGGradientStops = readonly [string, string];

export interface MGGradients {
  primary: MGGradientStops;
  hero: MGGradientStops;
  ai: MGGradientStops;
}

export const gradients: Readonly<Record<MGSchemeName, MGGradients>> = {
  light: {
    primary: ['#1D5BD6', '#2F7BF0'],
    hero: ['#E3EBFA', '#CFDDF7'],
    ai: ['#1D5BD6', '#2F7BF0'],
  },
  dark: {
    primary: ['#2F6BE6', '#4A8CF5'],
    hero: ['#0A1458', '#1F3FB5'],
    ai: ['#2F6BE6', '#4A8CF5'],
  },
};

/** Text and icon color on each gradient. */
export const onGradient: Readonly<Record<MGSchemeName, Readonly<Record<keyof MGGradients, string>>>> = {
  light: { primary: '#FFFFFF', hero: '#FFFFFF', ai: '#FFFFFF' },
  dark: { primary: '#FFFFFF', hero: '#FFFFFF', ai: '#FFFFFF' },
};

/**
 * Soft elevation for resting cards (light scheme only; dark surfaces use a tonal step plus the
 * outlineVariant hairline because shadows vanish on dark backgrounds). Indigo-tinted so the
 * shadow reads as depth, not dirt.
 */
export const softShadow = {
  shadowColor: '#101273',
  shadowOpacity: 0.08,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 6 },
  elevation: 2,
} as const;

/** Stronger, colored shadow for floating controls (FAB, assistant orb). */
export const floatingShadow = {
  shadowColor: '#4646D3',
  shadowOpacity: 0.32,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 6 },
  elevation: 8,
} as const;

/** Motion (ms) and the one press spring. Every animation skips itself under "reduce motion". */
export const motion = {
  fast: 120,
  base: 220,
  slow: 320,
  reveal: 360,
  /** Staggered list reveals: per-row delay and the largest row index that still waits. */
  staggerMs: 40,
  staggerMaxIndex: 8,
  pressScale: 0.97,
  spring: { damping: 18, stiffness: 320, mass: 0.7 },
} as const;

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

/** Semantic weights of the type scale. */
export type MGFontWeight = '400' | '500' | '600' | '700' | '800';

/**
 * Plus Jakarta Sans (visual refresh, October 30, 2026): one family name per weight, as expo-font
 * registers them (@expo-google-fonts/plus-jakarta-sans, loaded in AppRoot). A style sets the
 * family of its weight and keeps `fontWeight: '400'`, because Android would otherwise stack a
 * synthetic bold on an already-bold file. Until the fonts are loaded the system font shows.
 */
export const fontFamilies: Readonly<Record<MGFontWeight, string>> = {
  '400': 'PlusJakartaSans_400Regular',
  '500': 'PlusJakartaSans_500Medium',
  '600': 'PlusJakartaSans_600SemiBold',
  '700': 'PlusJakartaSans_700Bold',
  '800': 'PlusJakartaSans_800ExtraBold',
};

/** Spread directly into a StyleSheet text style. */
export interface MGTypeStyle {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  /** Always '400': the weight lives in the family (see fontFamilies). */
  fontWeight: '400';
  letterSpacing: number;
}

function type(weight: MGFontWeight, fontSize: number, lineHeight: number, letterSpacing: number): MGTypeStyle {
  return { fontFamily: fontFamilies[weight], fontSize, lineHeight, fontWeight: '400', letterSpacing };
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

/** Headlines tight and heavy, body relaxed: the editorial contrast of current planner apps. */
export const typography: MGTypography = {
  displayS: type('800', 40, 48, -0.8),
  headlineL: type('800', 32, 40, -0.6),
  headlineM: type('700', 26, 34, -0.4),
  headlineS: type('700', 22, 30, -0.2),
  titleL: type('700', 20, 28, -0.2),
  titleM: type('600', 16, 24, 0),
  titleS: type('600', 14, 20, 0),
  bodyL: type('400', 16, 24, 0.1),
  bodyM: type('400', 14, 20, 0.15),
  bodyS: type('400', 12, 16, 0.2),
  labelL: type('600', 14, 20, 0.1),
  labelM: type('500', 12, 16, 0.2),
  labelS: type('500', 11, 16, 0.3),
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
 * Radius scale: xs badge, sm chip/small button, md input/list group/banner, lg toast,
 * xl FAB/modal, xxl card / floating tab bar, sheet = bottom-sheet top corners, full = pill/avatar.
 */
export const radii = {
  xs: 6,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  /** Resting cards and the floating tab bar. */
  xxl: 24,
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
