/**
 * WCAG 2.1 contrast math (owner: shell / Foundation). Pure module used by the design-system
 * guard tests (src/theme/__tests__/contrast.test.ts) to keep every documented token pairing at
 * AA in both schemes; also safe to use at runtime (no React, no react-native).
 *
 * Translucent colors (rgba tokens like scrims and the alert banner backgrounds) are composited
 * over an explicit base before the ratio is computed, because WCAG is defined on opaque colors.
 */

export interface RGBA {
  r: number;
  g: number;
  b: number;
  /** 0..1 */
  a: number;
}

/** Parses `#RGB`, `#RRGGBB`, `rgb(r,g,b)` or `rgba(r,g,b,a)`. Returns null for anything else. */
export function parseColor(value: string): RGBA | null {
  const hex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(value.trim());
  if (hex) {
    let digits = hex[1] ?? '';
    if (digits.length === 3) digits = digits.replace(/./g, (d) => d + d);
    return {
      r: parseInt(digits.slice(0, 2), 16),
      g: parseInt(digits.slice(2, 4), 16),
      b: parseInt(digits.slice(4, 6), 16),
      a: 1,
    };
  }
  const fn = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(value.trim());
  if (fn) {
    const [, r, g, b, a] = fn;
    return {
      r: Number(r),
      g: Number(g),
      b: Number(b),
      a: a === undefined ? 1 : Number(a),
    };
  }
  return null;
}

/** Alpha-composites `fg` over an opaque `bg` (source-over). */
export function compositeOver(fg: RGBA, bg: RGBA): RGBA {
  const a = fg.a + bg.a * (1 - fg.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  return {
    r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a,
    g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a,
    b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a,
    a,
  };
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of an (opaque) color. */
export function relativeLuminance(color: RGBA): number {
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

/**
 * WCAG contrast ratio (1..21) between a foreground and a background color string.
 * A translucent background is composited over `base` (default black, the worst realistic
 * underlay for our always-dark overlays); a translucent foreground over the resulting
 * background. Throws on unparseable input so a typo in a token can never pass silently.
 */
export function contrastRatio(foreground: string, background: string, base = '#000000'): number {
  const fg = parseColor(foreground);
  const bg = parseColor(background);
  const baseColor = parseColor(base);
  if (!fg || !bg || !baseColor) {
    throw new Error(`contrastRatio: unparseable color in (${foreground}, ${background}, ${base})`);
  }
  const opaqueBg = bg.a < 1 ? compositeOver(bg, { ...baseColor, a: 1 }) : bg;
  const opaqueFg = fg.a < 1 ? compositeOver(fg, opaqueBg) : fg;
  const l1 = relativeLuminance(opaqueFg);
  const l2 = relativeLuminance(opaqueBg);
  const [lighter, darker] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

/** AA thresholds: normal text 4.5:1, graphics / UI components 3:1. */
export const AA_TEXT = 4.5;
export const AA_GRAPHICS = 3;
