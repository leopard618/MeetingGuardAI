/**
 * WCAG AA guard for the MG Indigo tokens: every documented pairing (docs/v1/DESIGN_SYSTEM.md §2/§9)
 * must hold in BOTH schemes. A token tweak that breaks a pairing fails here, not on a device.
 */
import { AA_GRAPHICS, AA_TEXT, compositeOver, contrastRatio, parseColor, relativeLuminance } from '../contrast';
import { alertLight, alertMax, alertMedium, darkColors, lightColors, mgColors, type MGColors } from '../tokens';

describe('contrast util', () => {
  it('parses hex and rgba colors', () => {
    expect(parseColor('#000000')).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('rgba(10,15,26,0.48)')).toEqual({ r: 10, g: 15, b: 26, a: 0.48 });
    expect(parseColor('rgb(1, 2, 3)')).toEqual({ r: 1, g: 2, b: 3, a: 1 });
    expect(parseColor('tomato')).toBeNull();
  });

  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
    expect(relativeLuminance({ r: 255, g: 255, b: 255, a: 1 })).toBeCloseTo(1, 5);
  });

  it('composites translucent colors before comparing', () => {
    const opaque = compositeOver({ r: 255, g: 255, b: 255, a: 0.5 }, { r: 0, g: 0, b: 0, a: 1 });
    expect(opaque.r).toBeCloseTo(127.5, 1);
    // A translucent background is resolved over the base, so the ratio is finite and stable.
    expect(contrastRatio('#FFFFFF', 'rgba(22,31,46,0.97)')).toBeGreaterThan(15);
  });

  it('throws on unparseable input instead of passing silently', () => {
    expect(() => contrastRatio('nope', '#FFFFFF')).toThrow('unparseable');
  });
});

/** [foreground key, background key] pairs that must be readable as TEXT (>= 4.5:1). */
const TEXT_PAIRS: readonly [keyof MGColors, keyof MGColors][] = [
  ['onSurface', 'surface'],
  ['onBackground', 'background'],
  ['onSurface', 'surfaceVariant'],
  ['onSurface', 'surfaceContainerLow'],
  ['onSurface', 'surfaceContainerHigh'],
  ['onSurfaceVariant', 'surface'],
  ['onSurfaceVariant', 'background'],
  ['onSurfaceVariant', 'surfaceVariant'],
  ['onSurfaceVariant', 'surfaceContainerLow'],
  ['onSurfaceVariant', 'surfaceContainerHigh'],
  ['onPrimary', 'primary'],
  ['onPrimaryContainer', 'primaryContainer'],
  ['onSecondary', 'secondary'],
  ['onSecondaryContainer', 'secondaryContainer'],
  ['onTertiary', 'tertiary'],
  ['onTertiaryContainer', 'tertiaryContainer'],
  ['onError', 'error'],
  ['onErrorContainer', 'errorContainer'],
  ['onSuccess', 'success'],
  ['onSuccessContainer', 'successContainer'],
  ['onWarning', 'warning'],
  ['onWarningContainer', 'warningContainer'],
  ['onInfo', 'info'],
  ['onInfoContainer', 'infoContainer'],
  ['inverseOnSurface', 'inverseSurface'],
  ['primary', 'surface'],
  ['error', 'surface'],
];

/** Functional non-text pairs (>= 3:1): outline borders and the categorical chart palette. */
const GRAPHIC_PAIRS: readonly [keyof MGColors, keyof MGColors][] = [
  ['outline', 'surface'],
  ['outline', 'background'],
  ['outline', 'surfaceContainerLow'],
];

describe.each(['light', 'dark'] as const)('%s scheme tokens', (scheme) => {
  const colors = mgColors[scheme];

  it.each(TEXT_PAIRS)('text pair %s on %s is AA', (fg, bg) => {
    expect(contrastRatio(colors[fg] as string, colors[bg] as string)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(GRAPHIC_PAIRS)('graphic pair %s on %s is AA', (fg, bg) => {
    expect(contrastRatio(colors[fg] as string, colors[bg] as string)).toBeGreaterThanOrEqual(AA_GRAPHICS);
  });

  it('keeps every chart color >= 3:1 on surface and background', () => {
    for (const color of colors.chart) {
      expect(contrastRatio(color, colors.surface)).toBeGreaterThanOrEqual(AA_GRAPHICS);
      expect(contrastRatio(color, colors.background)).toBeGreaterThanOrEqual(AA_GRAPHICS);
    }
  });

  it('keeps chart[0] >= 3:1 on surfaceVariant (LoadByDay bar fill on its track, §7)', () => {
    expect(contrastRatio(colors.chart[0], colors.surfaceVariant)).toBeGreaterThanOrEqual(AA_GRAPHICS);
  });
});

describe('mode-invariant alert overlay identities', () => {
  it('is the same object in both schemes (always-dark by design)', () => {
    expect(lightColors.alertMax).toBe(darkColors.alertMax);
    expect(lightColors.alertMedium).toBe(darkColors.alertMedium);
    expect(lightColors.alertLight).toBe(darkColors.alertLight);
  });

  it('MAX overlay text and buttons are AA', () => {
    expect(contrastRatio(alertMax.title, alertMax.bg)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(alertMax.heading, alertMax.bg)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(alertMax.when, alertMax.bg)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(alertMax.ackText, alertMax.ackBg)).toBeGreaterThanOrEqual(AA_TEXT);
    // The audit's 3.30:1 join button is resolved: #FFFFFF on #177245.
    expect(contrastRatio(alertMax.joinText, alertMax.joinBg)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(alertMax.snoozeText, alertMax.bg)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(alertMax.ring, alertMax.bg)).toBeGreaterThanOrEqual(AA_GRAPHICS);
    expect(contrastRatio(alertMax.countdownFill, alertMax.bg)).toBeGreaterThanOrEqual(AA_GRAPHICS);
  });

  it('MEDIUM banner text and action are AA', () => {
    expect(contrastRatio(alertMedium.title, alertMedium.bg)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(alertMedium.body, alertMedium.bg)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(alertMedium.actionText, alertMedium.actionBg)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(alertMedium.accentBar, alertMedium.bg)).toBeGreaterThanOrEqual(AA_GRAPHICS);
  });

  it('LIGHT toast text, action and the AppToast accent hues are AA on the dark card', () => {
    expect(contrastRatio(alertLight.title, alertLight.bg)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(alertLight.body, alertLight.bg)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(alertLight.actionText, alertLight.actionBg)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(alertLight.icon, alertLight.bg)).toBeGreaterThanOrEqual(AA_GRAPHICS);
    // AppToast semantic accents (docs/v1/DESIGN_SYSTEM.md §7 group D) = dark-scheme hues on the card.
    for (const accent of [darkColors.success, darkColors.error, darkColors.info, darkColors.warning]) {
      expect(contrastRatio(accent, alertLight.bg)).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });
});
