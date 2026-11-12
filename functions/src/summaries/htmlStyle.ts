/**
 * CSS for the M10 HTML-to-text converter (./htmlText.ts; docs/v2/M10-DESIGN.md section 8, red-team
 * finding 16). PURE: no Firebase imports, no logging, nothing is fetched: a linked or imported
 * style sheet is read only from a data: URL, a web-font host's sheet is skipped, and any other
 * one refuses the document (stylesheetFromUrl, external_css). Unit-tested through
 * test/unit/summariesHtmlText.test.ts.
 *
 * It decides, from the inline styles and every style sheet, BEFORE anything is removed:
 * - Which elements are HIDDEN (their whole subtree is dropped): display:none; visibility hidden or
 *   collapse; opacity under 0.1; content-visibility:hidden; max-height of 0 or less; a box of at
 *   most 1px (height, max-height, width, max-width) together with overflow hidden or clip;
 *   off-screen offsets: left, top, margin-left, margin-top, text-indent and their logical forms
 *   at -500px (or -100%) and beyond, or at +2000px (or +100%) and beyond (the Kellum
 *   text-indent:100% included), right and bottom at 500px (or 100%) either way (a large positive
 *   right or bottom pushes the box off the top-left edge, review P3), the inset shorthands by
 *   side; a clip rect of no area; any clip-path but none, box keywords and an all-zero inset();
 *   transform scale, scale or zoom under 1/8, a rotateX/rotateY/rotate3d or rotate property of
 *   90 degrees, a skew within 30 degrees of 90, any matrix3d or perspective(), a translate of
 *   -500px or beyond or +2000px or beyond (translateX(-50%) centering is kept); a filter list
 *   that washes text out (filterHides: opacity under 0.1, brightness or contrast outside 0.5 to
 *   2, invert near 0.5, blur over 1px, a combined factor under 0.25, url() or an unknown
 *   function); any mask image; any mix-blend-mode but normal; mso-hide:all; an animation whose
 *   @keyframes hide (review S4).
 * - The smallest font size an element's own text can have (htmlText drops text under 2px). Font
 *   size is NOT a subtree rule: a container with font-size:0 whose children set their own size
 *   (the MJML column layout) keeps the children's text.
 * - The text color and the background behind it, from one cascade (see "Colors").
 *
 * Fail closed, toward dropping text:
 * - A hiding declaration anywhere wins: in any matching rule whatever its specificity, order or
 *   a later !important, and rules inside @media, @supports, @container, @layer, @scope,
 *   @document, @starting-style and ANY at-rule this module does not know (review S1) always apply
 *   (a print or mobile-only rule that hides text hides it here too). At-rule names are read with
 *   CSS escapes decoded ("@\6d edia" is @media). Only descriptor at-rules (@font-face, @page and
 *   the like, NON_STYLE_AT_RULES) are skipped.
 * - Selectors: type, universal, .class, #id, attribute selectors (all operators, values compared
 *   case-insensitively), compounds, :is() and :where() over plain compounds, the descendant and
 *   child combinators and selector lists are evaluated. Anything else is RELAXED to a superset of
 *   what it can match: other pseudo-classes, namespaces and the nesting "&" are dropped from
 *   their compound, and a sibling or column combinator drops the compound on its left (in
 *   "X A + B" B shares A's parent, so it also lies inside X: "X B" holds). So
 *   ".promo:first-child" hides every .promo and "u + #body .gmail-hide" every .gmail-hide (not
 *   the whole #body). A selector that does not parse at all falls back to every element carrying
 *   a class or id it names (else a type it names, else every element).
 * - A selector whose subject is a pseudo-element styles generated content that is never emitted
 *   (::before, ::after, ::marker...): it is ignored (review P4). ::first-line and ::first-letter
 *   style the element's own text, so their colors and sizes count, but they never hide the
 *   element. A subject (or ancestor) with :empty matches no text and is ignored.
 * - Classes and ids compare ASCII case-insensitively for hiding (quirks mode does; in standards
 *   mode this only widens a match); a match by case folding alone is never definite for colors.
 *   Identifiers starting with a digit (".2b") are not identifiers (review S2): such a selector
 *   falls back to its names. CSS escapes are decoded in selectors and values ("n\6f ne" is none);
 *   comments are removed.
 * - var(), env() and attr() in a property that can hide on its own count as hiding.
 * - A nested style rule (CSS nesting) is relaxed: "& .x" inside ".a" hides every .x.
 *
 * Colors (htmlText drops text whose paint color has a contrast ratio under 1.1 with the background
 * behind it, which covers exact equality and near-equal pairs such as #fefefe on white): text is
 * dropped when it is invisible in ANY light rendering (reviews S2 and P1). A matched selector is
 * DEFINITE when the rule certainly applies in every light rendering: evaluated exactly, names
 * matching as written, its whole selector list valid in a browser (no unknown pseudo, no bad
 * identifier, no empty entry, no || or namespace; otherwise a browser may drop the whole rule),
 * and no condition around it (@media other than plain all or screen, @supports, @container,
 * @layer, @scope and the rest). Every other match is POSSIBLE. htmlText then takes the definite
 * cascade (!important, inline, specificity, order; presentational hints such as <font color> and
 * bgcolor below every author rule) and every subset of the possible rules on top of it (their
 * specificity is an upper bound), so neither a guessed match, a decoy rule that never matches,
 * nor a rescue that only holds on mobile can make hidden text count as visible. Dark-mode blocks
 * never set colors: @media whose EVERY query requires prefers-color-scheme: dark (review P2: no
 * "not", no "or", no query without it), and Outlook's [data-ogsc] / [data-ogsb] hooks match no
 * element unless the message itself carries the attribute. Without any declared background up
 * the tree the canvas is white (every mail client's default), so white text with no background
 * is dropped. A color given by var() or an unsupported color function is unknown, and text over
 * an unknown background or in an unknown color is dropped. A background image paints behind the
 * text too: a gradient shows each stop and the midpoint of each pair of stops, a url() or other
 * image is unknown (review S4).
 *
 * Font sizes take the union of every matching rule, possible and dark-mode ones included (the
 * smallest wins), so any rule can shrink text away. Opacities multiply down the tree (htmlText).
 *
 * Known gaps (the full-text instruction scan in sections.ts stays the backstop): style sheets
 * other than data: URLs are never loaded (the document is refused instead); calc() lengths are
 * judged by their literals; a child's visibility:visible under a hidden parent is dropped with
 * it (fail closed); line-height 0 with overflow hidden, a custom font whose glyphs are blank,
 * a perspective property on an ancestor, and layout that moves text behind another element
 * (z-index, positioning over it, negative margins other than left and top), are not modeled;
 * dark-mode renderings are not modeled (only light ones); possible rules are combined per
 * element, so a responsive color scheme that changes a background and its text in one @media
 * block can drop that text (fail closed).
 *
 * Product text rule: this file contains only ASCII punctuation; other characters are \u escapes.
 */

import type { HtmlTextRefusal } from './sanitize';

// ---------------------------------------------------------------------------------------------
// Limits and the one error type
// ---------------------------------------------------------------------------------------------

/** Thrown when a document is over a limit or the parser no longer looks as pinned. Never carries content. */
export class HtmlLimitError extends Error {
  constructor(readonly reason: HtmlTextRefusal) {
    super(`summaries.html: ${reason}`);
    this.name = 'HtmlLimitError';
  }
}

export const STYLE_LIMITS = {
  /** Complex selectors kept across all style blocks (rules that can hide, size or color text). */
  maxSelectors: 4000,
  /** Nested blocks (@media inside @supports, nested rules). Deeper is too_complex. */
  maxNesting: 16,
  /** Compound tests across one document. More is too_complex. */
  maxMatchSteps: 20_000_000,
  /** Memo entries kept by the matcher (bounds its memory; past it, results are recomputed). */
  maxMemoEntries: 500_000,
  /** Compounds kept per complex selector: leftmost ones beyond are dropped (a superset). */
  maxCompounds: 32,
  /** data: style sheets read through <link> or @import per document. More is too_complex. */
  maxImports: 32,
  /** Their decoded characters together. More is too_complex. */
  maxImportedChars: 2 * 1024 * 1024,
} as const;

/** Text whose smallest possible font size is under this is invisible. */
export const MIN_FONT_PX = 2;
/** Scale factors (transform, scale, zoom) under this make text invisible (2px of 16px). */
const MIN_SCALE = 0.125;
/** Opacity (also filter opacity, and the product of nested opacities in htmlText) under this hides. */
export const MIN_OPACITY = 0.1;
/** Offsets at or beyond this many px to the left or top are off-screen (also right and bottom, either way). */
const OFFSCREEN_PX = 500;
/** Offsets that push a box this many px or more to the right or down (a scroll might reach it) are off-screen too. */
const OFFSCREEN_FAR_PX = 2000;
/** Offsets at or beyond this many percent or viewport units are off-screen. */
const OFFSCREEN_RELATIVE = 100;
/** A skew within this many degrees of 90 shears text past reading. */
const SKEW_EDGE_DEGREES = 30;
/** A blur over this many px makes text unreadable. */
const MAX_BLUR_PX = 1;
/** brightness() and contrast() outside this range wash text into its background. */
const FILTER_RANGE = { min: 0.5, max: 2 } as const;
/** The combined contrast factor of a filter list under this hides (0.25: black on white becomes two mid grays). */
const MIN_FILTER_FACTOR = 0.25;
/** Boxes at most this many px tall or wide clip their text when overflow is hidden. */
const TINY_BOX_PX = 1;

// ---------------------------------------------------------------------------------------------
// Text scanning
// ---------------------------------------------------------------------------------------------

function isWs(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d || code === 0x0c;
}

/** Index just past the string that starts at `i` (a quote). A newline or the end also ends it. */
function skipString(css: string, i: number): number {
  const quote = css.charCodeAt(i);
  let j = i + 1;
  while (j < css.length) {
    const c = css.charCodeAt(j);
    if (c === 0x5c) {
      j += 2;
      continue;
    }
    if (c === quote) return j + 1;
    if (c === 0x0a) return j;
    j += 1;
  }
  return css.length;
}

/** Removes CSS comments (outside strings). A comment is removed without leaving a space. */
export function stripCssComments(css: string): string {
  if (!css.includes('/*')) return css;
  const parts: string[] = [];
  let last = 0;
  let i = 0;
  while (i < css.length) {
    const c = css.charCodeAt(i);
    if (c === 0x22 || c === 0x27) {
      i = skipString(css, i);
      continue;
    }
    if (c === 0x5c) {
      i += 2;
      continue;
    }
    if (c === 0x2f && css.charCodeAt(i + 1) === 0x2a) {
      parts.push(css.slice(last, i));
      const end = css.indexOf('*/', i + 2);
      i = end === -1 ? css.length : end + 2;
      last = i;
      continue;
    }
    i += 1;
  }
  parts.push(css.slice(Math.min(last, css.length)));
  return parts.join('');
}

const HEX_ESCAPE_RE = /^[0-9a-fA-F]{1,6}/;

/**
 * Decodes CSS escapes: a backslash with 1 to 6 hex digits (and one optional whitespace after
 * them), or a backslash before any other character. A backslash before a newline or at the end
 * is dropped.
 */
export function unescapeCss(text: string): string {
  if (!text.includes('\\')) return text;
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const slash = text.indexOf('\\', i);
    if (slash === -1) {
      out.push(text.slice(i));
      break;
    }
    out.push(text.slice(i, slash));
    const hex = HEX_ESCAPE_RE.exec(text.slice(slash + 1, slash + 7));
    if (hex) {
      const cp = parseInt(hex[0], 16);
      out.push(cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? '\uFFFD' : String.fromCodePoint(cp));
      i = slash + 1 + hex[0].length;
      const next = text.charCodeAt(i);
      if (isWs(next)) i += next === 0x0d && text.charCodeAt(i + 1) === 0x0a ? 2 : 1;
      continue;
    }
    const next = text.charAt(slash + 1);
    if (next !== '' && next !== '\n') out.push(next);
    i = slash + 2;
  }
  return out.join('');
}

/**
 * Index of the first character of `stops` at the top level (outside strings, parentheses and
 * brackets) from `i`, or `end` when there is none.
 */
function scanTo(css: string, i: number, end: number, stops: string): number {
  let depth = 0;
  let j = i;
  while (j < end) {
    const c = css.charCodeAt(j);
    if (c === 0x22 || c === 0x27) {
      j = skipString(css, j);
      continue;
    }
    if (c === 0x5c) {
      j += 2;
      continue;
    }
    if (c === 0x28 || c === 0x5b) depth += 1;
    else if ((c === 0x29 || c === 0x5d) && depth > 0) depth -= 1;
    else if (depth === 0 && stops.includes(css.charAt(j))) return j;
    j += 1;
  }
  return end;
}

/** Index of the "}" that closes the block opened at `open` (a "{"), or `end` when it never closes. */
function blockEnd(css: string, open: number, end: number): number {
  let depth = 0;
  let i = open;
  while (i < end) {
    const c = css.charCodeAt(i);
    if (c === 0x22 || c === 0x27) {
      i = skipString(css, i);
      continue;
    }
    if (c === 0x5c) {
      i += 2;
      continue;
    }
    if (c === 0x7b) depth += 1;
    else if (c === 0x7d) {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return end;
}

/** Splits at top-level occurrences of `separator` (outside strings and parentheses). */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (;;) {
    const stop = scanTo(text, start, text.length, separator);
    parts.push(text.slice(start, stop));
    if (stop >= text.length) return parts;
    start = stop + 1;
  }
}

/** Whitespace-separated tokens at the top level (a function call stays one token). */
function topLevelWords(value: string): string[] {
  const words: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c === 0x28) depth += 1;
    else if (c === 0x29 && depth > 0) depth -= 1;
    if (depth === 0 && isWs(c)) {
      if (start !== -1) words.push(value.slice(start, i));
      start = -1;
    } else if (start === -1) {
      start = i;
    }
  }
  if (start !== -1) words.push(value.slice(start));
  return words;
}

interface FunctionCall {
  name: string;
  args: string;
}

/** The top-level function calls of a value, in order ("scale(0) translate(1px)"). */
function functionCalls(value: string): FunctionCall[] {
  const calls: FunctionCall[] = [];
  const re = /([a-z][a-z0-9-]*)\(/g;
  let match: RegExpExecArray | null;
  let from = 0;
  while ((match = re.exec(value)) !== null) {
    if (match.index < from) continue;
    const open = match.index + match[0].length - 1;
    let depth = 0;
    let close = value.length;
    for (let i = open; i < value.length; i++) {
      const c = value.charCodeAt(i);
      if (c === 0x28) depth += 1;
      else if (c === 0x29) {
        depth -= 1;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    calls.push({ name: match[1] ?? '', args: value.slice(open + 1, close) });
    from = close + 1;
    re.lastIndex = from;
  }
  return calls;
}

/** Function arguments split at commas, or at whitespace and "/" when there is no comma. */
function functionArgs(args: string): string[] {
  const byComma = splitTopLevel(args, ',').map((part) => part.trim());
  if (byComma.length > 1) return byComma.filter((part) => part.length > 0);
  return topLevelWords(args.replace(/\//g, ' / ')).filter((part) => part !== '/');
}

// ---------------------------------------------------------------------------------------------
// Numbers, lengths
// ---------------------------------------------------------------------------------------------

interface Dimension {
  n: number;
  /** Lowercased unit, "%" or "" (unitless). */
  unit: string;
}

const DIMENSION_RE = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)([a-z]*|%)$/;
const LITERAL_RE = /[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:[a-z]+|%)?/g;

function parseDimension(token: string): Dimension | null {
  const m = DIMENSION_RE.exec(token);
  if (!m || m[1] === undefined) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? { n, unit: m[2] ?? '' } : null;
}

/** px per unit for units with a fixed size (font-relative units at a 16px font; unitless is the quirks-mode px). */
const PX_PER_UNIT: Readonly<Record<string, number>> = {
  '': 1,
  px: 1,
  pt: 4 / 3,
  pc: 16,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
  em: 16,
  rem: 16,
  ex: 8,
  ch: 8,
  cap: 11,
  ic: 16,
  lh: 19,
  rlh: 19,
};

/** Percentages, viewport and container units: their px size depends on the layout. */
const RELATIVE_UNITS: ReadonlySet<string> = new Set([
  '%',
  'vw',
  'vh',
  'vi',
  'vb',
  'vmin',
  'vmax',
  'svw',
  'svh',
  'lvw',
  'lvh',
  'dvw',
  'dvh',
  'svmin',
  'svmax',
  'lvmin',
  'lvmax',
  'dvmin',
  'dvmax',
  'cqw',
  'cqh',
  'cqi',
  'cqb',
  'cqmin',
  'cqmax',
]);

/** px of a fixed-size dimension, or null for relative units and unknown ones. */
function dimensionPx(d: Dimension): number | null {
  const factor = PX_PER_UNIT[d.unit];
  return factor === undefined ? null : d.n * factor;
}

const UNRESOLVABLE_RE = /\b(?:var|env|attr)\(/;
const MATH_FUNCTION_RE = /^(?:calc|min|max|clamp)\(/;

function isUnresolvable(value: string): boolean {
  return UNRESOLVABLE_RE.test(value);
}

/** The numeric literals of a math function value ("calc(100% - 20px)" gives 100% and 20px). */
function literals(value: string): Dimension[] {
  const found: Dimension[] = [];
  // "a - b" subtracts: read the subtrahend as a negative literal.
  const spaced = value.replace(/\s-\s+/g, ' -');
  for (const match of spaced.matchAll(LITERAL_RE)) {
    const d = parseDimension(match[0]);
    if (d) found.push(d);
  }
  return found;
}

/** A length of at most `maxPx` (relative units: at most 0). Math functions: every literal is tiny. */
function isTinyLength(value: string, maxPx: number): boolean {
  const token = value.trim();
  if (MATH_FUNCTION_RE.test(token)) {
    const found = literals(token);
    return found.length > 0 && found.every((d) => isTinyDimension(d, maxPx));
  }
  const d = parseDimension(token);
  return d !== null && isTinyDimension(d, maxPx);
}

function isTinyDimension(d: Dimension, maxPx: number): boolean {
  if (RELATIVE_UNITS.has(d.unit)) return d.n <= 0;
  const px = dimensionPx(d);
  return px !== null && px <= maxPx;
}

/** At or beyond -OFFSCREEN_PX (or -100% / -100vw). Math functions: any literal that far negative. */
function isFarNegative(value: string): boolean {
  const token = value.trim();
  if (MATH_FUNCTION_RE.test(token)) return literals(token).some(isFarNegativeDimension);
  const d = parseDimension(token);
  return d !== null && isFarNegativeDimension(d);
}

function isFarNegativeDimension(d: Dimension): boolean {
  if (RELATIVE_UNITS.has(d.unit)) return d.n <= -OFFSCREEN_RELATIVE;
  const px = dimensionPx(d);
  return px !== null && px <= -OFFSCREEN_PX;
}

/**
 * Which way an offset property pushes its box: 'start' for left, top, margin-left, margin-top,
 * text-indent and their logical forms (negative goes off the top-left edge, where no scroll
 * reaches; a large positive value goes far right or down), 'end' for right and bottom (a positive
 * value goes off the top-left edge).
 */
type OffsetSide = 'start' | 'end';

function isFarOffsetDimension(d: Dimension, side: OffsetSide): boolean {
  if (RELATIVE_UNITS.has(d.unit)) return Math.abs(d.n) >= OFFSCREEN_RELATIVE;
  const px = dimensionPx(d);
  if (px === null) return false;
  if (side === 'end') return Math.abs(px) >= OFFSCREEN_PX;
  return px <= -OFFSCREEN_PX || px >= OFFSCREEN_FAR_PX;
}

/** An offset that moves its box off-screen (see OffsetSide). Math functions: any literal that far. */
function isFarOffset(value: string, side: OffsetSide): boolean {
  const token = value.trim();
  if (MATH_FUNCTION_RE.test(token)) return literals(token).some((d) => isFarOffsetDimension(d, side));
  const d = parseDimension(token);
  return d !== null && isFarOffsetDimension(d, side);
}

/** A translation off-screen: -500px (or -100%) and beyond, or +2000px and beyond. */
function isFarTranslate(value: string): boolean {
  if (isFarNegative(value)) return true;
  const token = value.trim();
  const far = (d: Dimension): boolean => {
    const px = dimensionPx(d);
    return px !== null && px >= OFFSCREEN_FAR_PX;
  };
  if (MATH_FUNCTION_RE.test(token)) return literals(token).some(far);
  const d = parseDimension(token);
  return d !== null && far(d);
}

/** A number or percentage under `limit` (as a fraction). Math functions: every literal is. */
function isFractionUnder(value: string, limit: number): boolean {
  const token = value.trim();
  const under = (d: Dimension): boolean => (d.unit === '%' ? d.n / 100 < limit : d.unit === '' ? d.n < limit : false);
  if (MATH_FUNCTION_RE.test(token)) {
    const found = literals(token);
    return found.length > 0 && found.every(under);
  }
  const d = parseDimension(token);
  return d !== null && under(d);
}

// ---------------------------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------------------------

/** An sRGB color: channels 0 to 255, alpha 0 to 1. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export type ColorValue = Rgba | 'currentcolor' | 'inherit' | 'initial' | 'unset' | 'unknown';

// The CSS named colors (CSS Color 4), name then rrggbb.
const NAMED_COLOR_TABLE =
  'aliceblue f0f8ff antiquewhite faebd7 aqua 00ffff aquamarine 7fffd4 azure f0ffff beige f5f5dc bisque ffe4c4 black 000000 ' +
  'blanchedalmond ffebcd blue 0000ff blueviolet 8a2be2 brown a52a2a burlywood deb887 cadetblue 5f9ea0 chartreuse 7fff00 ' +
  'chocolate d2691e coral ff7f50 cornflowerblue 6495ed cornsilk fff8dc crimson dc143c cyan 00ffff darkblue 00008b ' +
  'darkcyan 008b8b darkgoldenrod b8860b darkgray a9a9a9 darkgreen 006400 darkgrey a9a9a9 darkkhaki bdb76b darkmagenta 8b008b ' +
  'darkolivegreen 556b2f darkorange ff8c00 darkorchid 9932cc darkred 8b0000 darksalmon e9967a darkseagreen 8fbc8f ' +
  'darkslateblue 483d8b darkslategray 2f4f4f darkslategrey 2f4f4f darkturquoise 00ced1 darkviolet 9400d3 deeppink ff1493 ' +
  'deepskyblue 00bfff dimgray 696969 dimgrey 696969 dodgerblue 1e90ff firebrick b22222 floralwhite fffaf0 forestgreen 228b22 ' +
  'fuchsia ff00ff gainsboro dcdcdc ghostwhite f8f8ff gold ffd700 goldenrod daa520 gray 808080 green 008000 greenyellow adff2f ' +
  'grey 808080 honeydew f0fff0 hotpink ff69b4 indianred cd5c5c indigo 4b0082 ivory fffff0 khaki f0e68c lavender e6e6fa ' +
  'lavenderblush fff0f5 lawngreen 7cfc00 lemonchiffon fffacd lightblue add8e6 lightcoral f08080 lightcyan e0ffff ' +
  'lightgoldenrodyellow fafad2 lightgray d3d3d3 lightgreen 90ee90 lightgrey d3d3d3 lightpink ffb6c1 lightsalmon ffa07a ' +
  'lightseagreen 20b2aa lightskyblue 87cefa lightslategray 778899 lightslategrey 778899 lightsteelblue b0c4de ' +
  'lightyellow ffffe0 lime 00ff00 limegreen 32cd32 linen faf0e6 magenta ff00ff maroon 800000 mediumaquamarine 66cdaa ' +
  'mediumblue 0000cd mediumorchid ba55d3 mediumpurple 9370db mediumseagreen 3cb371 mediumslateblue 7b68ee ' +
  'mediumspringgreen 00fa9a mediumturquoise 48d1cc mediumvioletred c71585 midnightblue 191970 mintcream f5fffa ' +
  'mistyrose ffe4e1 moccasin ffe4b5 navajowhite ffdead navy 000080 oldlace fdf5e6 olive 808000 olivedrab 6b8e23 ' +
  'orange ffa500 orangered ff4500 orchid da70d6 palegoldenrod eee8aa palegreen 98fb98 paleturquoise afeeee ' +
  'palevioletred db7093 papayawhip ffefd5 peachpuff ffdab9 peru cd853f pink ffc0cb plum dda0dd powderblue b0e0e6 ' +
  'purple 800080 rebeccapurple 663399 red ff0000 rosybrown bc8f8f royalblue 4169e1 saddlebrown 8b4513 salmon fa8072 ' +
  'sandybrown f4a460 seagreen 2e8b57 seashell fff5ee sienna a0522d silver c0c0c0 skyblue 87ceeb slateblue 6a5acd ' +
  'slategray 708090 slategrey 708090 snow fffafa springgreen 00ff7f steelblue 4682b4 tan d2b48c teal 008080 thistle d8bfd8 ' +
  'tomato ff6347 turquoise 40e0d0 violet ee82ee wheat f5deb3 white ffffff whitesmoke f5f5f5 yellow ffff00 yellowgreen 9acd32';

const NAMED_COLORS: ReadonlyMap<string, Rgba> = (() => {
  const map = new Map<string, Rgba>();
  const parts = NAMED_COLOR_TABLE.split(' ');
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const hex = parts[i + 1] ?? '';
    map.set(parts[i] ?? '', { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16), a: 1 });
  }
  return map;
})();

// System colors: their value depends on the client, so they are unknown (fail closed).
const SYSTEM_COLORS: ReadonlySet<string> = new Set(
  (
    'canvas canvastext linktext visitedtext activetext buttonface buttontext buttonborder field fieldtext highlight ' +
    'highlighttext selecteditem selecteditemtext mark marktext graytext accentcolor accentcolortext activeborder ' +
    'activecaption appworkspace background buttonhighlight buttonshadow captiontext inactiveborder inactivecaption ' +
    'inactivecaptiontext infobackground infotext menu menutext scrollbar threeddarkshadow threedface threedhighlight ' +
    'threedlightshadow threedshadow window windowframe windowtext'
  ).split(' '),
);

/** Color functions this module does not convert: unknown (fail closed). */
const UNKNOWN_COLOR_FUNCTIONS: ReadonlySet<string> = new Set(['hwb', 'lab', 'lch', 'oklab', 'oklch', 'color', 'color-mix', 'light-dark', 'device-cmyk']);

const HEX_COLOR_RE = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function parseHex(token: string, allowHashless: boolean): Rgba | null {
  const m = HEX_COLOR_RE.exec(token);
  const hex = m?.[1];
  if (hex === undefined) return null;
  // The quirks-mode hashless hex: only the 3 and 6 digit forms.
  if (!token.startsWith('#') && (!allowHashless || (hex.length !== 3 && hex.length !== 6))) return null;
  const full = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
    a: full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1,
  };
}

function channel(token: string): number | null {
  if (token === 'none') return 0;
  const d = parseDimension(token);
  if (!d) return null;
  if (d.unit === '%') return clamp((d.n / 100) * 255, 0, 255);
  return d.unit === '' ? clamp(d.n, 0, 255) : null;
}

function alpha(token: string | undefined): number | null {
  if (token === undefined) return 1;
  if (token === 'none') return 0;
  const d = parseDimension(token);
  if (!d) return null;
  if (d.unit === '%') return clamp(d.n / 100, 0, 1);
  return d.unit === '' ? clamp(d.n, 0, 1) : null;
}

function percent(token: string | undefined): number | null {
  if (token === undefined) return null;
  if (token === 'none') return 0;
  const d = parseDimension(token);
  if (!d || (d.unit !== '%' && d.unit !== '')) return null;
  return clamp(d.n / 100, 0, 1);
}

function hue(token: string | undefined): number | null {
  if (token === undefined) return null;
  if (token === 'none') return 0;
  const d = parseDimension(token);
  if (!d) return null;
  switch (d.unit) {
    case '':
    case 'deg':
      return d.n;
    case 'rad':
      return (d.n * 180) / Math.PI;
    case 'grad':
      return d.n * 0.9;
    case 'turn':
      return d.n * 360;
    default:
      return null;
  }
}

function hslToRgb(h: number, s: number, l: number, a: number): Rgba {
  const hh = (((h % 360) + 360) % 360) / 360;
  const f = (n: number): number => {
    const k = (n + hh * 12) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return { r: f(0) * 255, g: f(8) * 255, b: f(4) * 255, a };
}

/**
 * Parses one CSS color value (already lowercased and unescaped). Null when it is not a color at
 * all (a browser drops such a declaration). `allowHashless` accepts "ffffff" (the quirks-mode
 * hashless hex and legacy HTML attributes).
 */
export function parseColor(value: string, allowHashless = true): ColorValue | null {
  const token = value.trim();
  if (token === '') return null;
  if (isUnresolvable(token)) return 'unknown';
  switch (token) {
    case 'transparent':
      return { r: 0, g: 0, b: 0, a: 0 };
    case 'currentcolor':
      return 'currentcolor';
    case 'inherit':
      return 'inherit';
    case 'initial':
      return 'initial';
    case 'unset':
    case 'revert':
    case 'revert-layer':
      return 'unset';
    default:
  }
  const named = NAMED_COLORS.get(token);
  if (named) return named;
  if (SYSTEM_COLORS.has(token)) return 'unknown';
  const hex = parseHex(token, allowHashless);
  if (hex) return hex;
  const call = /^([a-z-]+)\((.*)\)$/s.exec(token);
  if (!call) return null;
  const name = call[1] ?? '';
  if (UNKNOWN_COLOR_FUNCTIONS.has(name)) return 'unknown';
  const args = functionArgs(call[2] ?? '');
  if (name === 'rgb' || name === 'rgba') {
    if (args.length < 3 || args.length > 4) return null;
    const [r, g, b] = [channel(args[0] ?? ''), channel(args[1] ?? ''), channel(args[2] ?? '')];
    const a = alpha(args[3]);
    return r === null || g === null || b === null || a === null ? null : { r, g, b, a };
  }
  if (name === 'hsl' || name === 'hsla') {
    if (args.length < 3 || args.length > 4) return null;
    const h = hue(args[0]);
    const s = percent(args[1]);
    const l = percent(args[2]);
    const a = alpha(args[3]);
    return h === null || s === null || l === null || a === null ? null : hslToRgb(h, s, l, a);
  }
  return null;
}

/** The color a background or background-color value sets (the shorthand without a color resets to transparent). */
function backgroundColorOf(prop: string, value: string): ColorValue | null {
  if (isUnresolvable(value)) return 'unknown';
  if (prop === 'background-color') return parseColor(value);
  const whole = parseColor(value, false);
  if (whole !== null) return whole;
  // The color can only be in the final layer.
  const layers = splitTopLevel(value, ',');
  const last = layers[layers.length - 1] ?? '';
  let found: ColorValue | null = null;
  for (const word of topLevelWords(last)) {
    if (/^[a-z-]*gradient\(|^url\(|^image-set\(|^image\(|^cross-fade\(|^element\(/.test(word)) continue;
    const color = parseColor(word, false);
    if (color !== null && color !== 'inherit' && color !== 'initial' && color !== 'unset') found = color;
  }
  return found ?? { r: 0, g: 0, b: 0, a: 0 };
}

/**
 * What a background image paints behind the text: 'none'; the colors a gradient can show (every
 * stop and the midpoint of each pair of neighbouring stops, all layers together); or 'unknown'
 * for an image (url(), image-set() and the like, data: URLs included) or a gradient whose stops
 * are not all plain colors. Text over an unknown background is dropped (fail closed).
 */
export type BgImage = 'none' | 'unknown' | readonly Rgba[];

const IMAGE_FUNCTION_RE = /^(?:url|image-set|-webkit-image-set|image|cross-fade|-webkit-cross-fade|element|-moz-element|paint|-webkit-gradient)\(/;
const GRADIENT_FUNCTION_RE = /^(?:-(?:webkit|moz|ms|o)-)?(?:repeating-)?(?:linear|radial|conic)-gradient\(/;

function mix(a: Rgba, b: Rgba): Rgba {
  return { r: (a.r + b.r) / 2, g: (a.g + b.g) / 2, b: (a.b + b.b) / 2, a: (a.a + b.a) / 2 };
}

/** The colors one gradient shows, or null when a stop is not a plain color. */
function gradientColors(call: string): Rgba[] | null {
  const open = call.indexOf('(');
  const args = splitTopLevel(call.slice(open + 1, call.lastIndexOf(')')), ',');
  const stops: Rgba[] = [];
  for (const arg of args) {
    let stop: Rgba | null = null;
    for (const word of topLevelWords(arg.trim())) {
      const color = parseColor(word, false);
      if (color === null) continue;
      if (typeof color === 'string') return null;
      stop = color;
    }
    if (stop !== null) stops.push(stop);
  }
  if (stops.length === 0) return null;
  const out: Rgba[] = [];
  stops.forEach((stop, index) => {
    const previous = stops[index - 1];
    if (previous !== undefined) out.push(mix(previous, stop));
    out.push(stop);
  });
  return out;
}

/** The image layers of a background-image value, or of the background shorthand. */
function backgroundImageOf(value: string): BgImage {
  if (isUnresolvable(value)) return 'unknown';
  const colors: Rgba[] = [];
  let painted = false;
  for (const layer of splitTopLevel(value, ',')) {
    for (const word of topLevelWords(layer.trim())) {
      if (IMAGE_FUNCTION_RE.test(word)) return 'unknown';
      if (!GRADIENT_FUNCTION_RE.test(word)) continue;
      const stops = gradientColors(word);
      if (stops === null) return 'unknown';
      colors.push(...stops);
      painted = true;
    }
  }
  return painted ? colors : 'none';
}

function linear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(c: Rgba): number {
  return 0.2126 * linear(c.r) + 0.7152 * linear(c.g) + 0.0722 * linear(c.b);
}

/** WCAG contrast ratio of two opaque colors (1 for equal colors, 21 for black on white). */
export function contrastRatio(a: Rgba, b: Rgba): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** `top` composited over the opaque `under`. */
export function composite(top: Rgba, under: Rgba): Rgba {
  const a = clamp(top.a, 0, 1);
  return {
    r: top.r * a + under.r * (1 - a),
    g: top.g * a + under.g * (1 - a),
    b: top.b * a + under.b * (1 - a),
    a: 1,
  };
}

// ---------------------------------------------------------------------------------------------
// Font sizes, white-space
// ---------------------------------------------------------------------------------------------

/** A font-size declaration: absolute px, a factor of the parent's size, a factor of the root's, or inherit. */
export type FontSizeSpec = { kind: 'px'; px: number } | { kind: 'parent'; factor: number } | { kind: 'root'; factor: number } | { kind: 'inherit' };

const FONT_SIZE_KEYWORDS: Readonly<Record<string, number>> = {
  'xx-small': 9,
  'x-small': 10,
  small: 13,
  medium: 16,
  large: 18,
  'x-large': 24,
  'xx-large': 32,
  'xxx-large': 48,
};

/** The px a viewport unit is taken as (a 320px phone, the smallest common viewport). */
const VIEWPORT_UNIT_PX = 3.2;

function fontSizeOfDimension(d: Dimension): FontSizeSpec | null {
  if (d.n < 0) return null;
  if (d.unit === 'em') return { kind: 'parent', factor: d.n };
  if (d.unit === '%') return { kind: 'parent', factor: d.n / 100 };
  if (d.unit === 'ex' || d.unit === 'ch') return { kind: 'parent', factor: d.n / 2 };
  if (d.unit === 'rem') return { kind: 'root', factor: d.n };
  if (RELATIVE_UNITS.has(d.unit)) return { kind: 'px', px: d.n * VIEWPORT_UNIT_PX };
  const px = dimensionPx(d);
  return px === null ? null : { kind: 'px', px };
}

/** A font-size value (also the size token of the font shorthand). Null when it is not a size. */
function parseFontSize(token: string): FontSizeSpec | null {
  const value = token.trim();
  if (isUnresolvable(value)) return { kind: 'px', px: 0 };
  const keyword = FONT_SIZE_KEYWORDS[value];
  if (keyword !== undefined) return { kind: 'px', px: keyword };
  switch (value) {
    case 'smaller':
      return { kind: 'parent', factor: 1 / 1.2 };
    case 'larger':
      return { kind: 'parent', factor: 1.2 };
    case 'inherit':
    case 'unset':
    case 'revert':
    case 'revert-layer':
      return { kind: 'inherit' };
    case 'initial':
      return { kind: 'px', px: 16 };
    default:
  }
  if (MATH_FUNCTION_RE.test(value)) {
    // The smallest literal, each read at a 16px parent (fail closed toward the smallest size).
    let min = Number.POSITIVE_INFINITY;
    for (const d of literals(value)) {
      const spec = fontSizeOfDimension({ n: Math.abs(d.n), unit: d.unit });
      if (spec === null) continue;
      const px = spec.kind === 'px' ? spec.px : spec.kind === 'inherit' ? 16 : spec.factor * 16;
      min = Math.min(min, px);
    }
    return { kind: 'px', px: Number.isFinite(min) ? min : 0 };
  }
  const d = parseDimension(value);
  return d === null ? null : fontSizeOfDimension(d);
}

const FONT_PREFIX_WORDS: ReadonlySet<string> = new Set([
  'normal',
  'italic',
  'oblique',
  'small-caps',
  'bold',
  'bolder',
  'lighter',
  'ultra-condensed',
  'extra-condensed',
  'condensed',
  'semi-condensed',
  'semi-expanded',
  'expanded',
  'extra-expanded',
  'ultra-expanded',
]);
const SYSTEM_FONTS: ReadonlySet<string> = new Set(['caption', 'icon', 'menu', 'message-box', 'small-caption', 'status-bar']);

/** The size the font shorthand sets ("bold 0/0 a" is 0), or null when it sets none. */
function fontShorthandSize(value: string): FontSizeSpec | null {
  const trimmed = value.trim();
  if (isUnresolvable(trimmed)) return { kind: 'px', px: 0 };
  if (trimmed === 'inherit' || trimmed === 'unset') return { kind: 'inherit' };
  if (trimmed === 'initial' || SYSTEM_FONTS.has(trimmed)) return { kind: 'px', px: 16 };
  for (const word of trimmed.split(/[\s/]+/)) {
    if (word === '') continue;
    if (FONT_PREFIX_WORDS.has(word)) continue;
    // A unitless number other than 0 is a weight (1 to 1000), not a size.
    if (/^\d+(?:\.\d+)?$/.test(word) && Number(word) !== 0) continue;
    return parseFontSize(word);
  }
  return null;
}

export type WhiteSpaceMode = 'normal' | 'pre' | 'pre-line';
export type WhiteSpaceValue = WhiteSpaceMode | 'inherit';

function parseWhiteSpace(value: string): WhiteSpaceValue {
  const words = value.trim().split(/\s+/);
  if (words.some((w) => w === 'inherit' || w === 'unset' || w === 'revert')) return 'inherit';
  if (words.some((w) => w === 'pre' || w === 'pre-wrap' || w === 'break-spaces' || w === 'preserve' || w === 'preserve-spaces')) return 'pre';
  if (words.some((w) => w === 'pre-line' || w === 'preserve-breaks')) return 'pre-line';
  return 'normal';
}

// ---------------------------------------------------------------------------------------------
// Declarations
// ---------------------------------------------------------------------------------------------

interface Declaration {
  prop: string;
  /** Lowercased, unescaped, trimmed, without "!important". */
  value: string;
  important: boolean;
}

const PROPERTY_RE = /^-?[a-z_][a-z0-9_-]*$/;
const IMPORTANT_RE = /!\s*important\s*$/;

function normalizeProperty(name: string): string {
  if (name === '-webkit-text-fill-color') return 'text-fill-color';
  return name.replace(/^-(?:webkit|moz|ms|o)-/, '');
}

function parseDeclaration(text: string): Declaration | null {
  const colon = text.indexOf(':');
  if (colon <= 0) return null;
  const name = unescapeCss(text.slice(0, colon).trim()).toLowerCase();
  if (!PROPERTY_RE.test(name) || name.startsWith('--')) return null;
  let value = unescapeCss(text.slice(colon + 1)).toLowerCase().trim();
  let important = false;
  const bang = IMPORTANT_RE.exec(value);
  if (bang) {
    important = true;
    value = value.slice(0, bang.index).trim();
  }
  if (value === '') return null;
  return { prop: normalizeProperty(name), value, important };
}

function parseDeclarations(text: string): Declaration[] {
  const out: Declaration[] = [];
  for (const part of splitTopLevel(text, ';')) {
    const declaration = parseDeclaration(part);
    if (declaration) out.push(declaration);
  }
  return out;
}

/** A declaration's value with its importance, for the color and white-space cascade. */
export interface Weighted<T> {
  value: T;
  important: boolean;
}

/** What one declaration block (a rule, an inline style, a keyframe) contributes. */
export interface DeclSummary {
  /** Any declaration in it can be ignored when false. */
  relevant: boolean;
  /** A declaration that hides the element on its own. */
  hides: boolean;
  /** height, max-height, width or max-width of at most 1px. */
  tinyBox: boolean;
  /** overflow hidden or clip. */
  overflowHidden: boolean;
  /** Every font-size (and font shorthand size) declared (union: the smallest wins later). */
  fontSizes: FontSizeSpec[];
  /** Identifiers of animation and animation-name (matched against hiding @keyframes later). */
  animationNames: string[];
  color: Weighted<ColorValue> | null;
  fill: Weighted<ColorValue> | null;
  background: Weighted<ColorValue> | null;
  /** background-image, or the image layers of the background shorthand ('none' when it has none). */
  backgroundImage: Weighted<BgImage> | null;
  /** The smallest opacity declared (opacities multiply down the tree; htmlText drops text under 0.1). */
  opacity: number | null;
  whiteSpace: Weighted<WhiteSpaceValue> | null;
}

const ROTATE_EDGE_RE = /^rotate[xy]$/;

function angleDegrees(token: string): number | null {
  return hue(token.trim());
}

/** An angle with a unit (or a unitless 0), in degrees; null otherwise. */
function strictAngle(token: string): number | null {
  const d = parseDimension(token.trim());
  if (d === null) return null;
  if (d.unit === '') return d.n === 0 ? 0 : null;
  return d.unit === 'deg' || d.unit === 'rad' || d.unit === 'grad' || d.unit === 'turn' ? hue(token.trim()) : null;
}

/** Degrees from edge-on (90 degrees, modulo 180). */
function fromEdgeOn(deg: number): number {
  return Math.abs((((deg % 180) + 180) % 180) - 90);
}

const CSS_WIDE_KEYWORDS: ReadonlySet<string> = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);

function isNoneOrWide(value: string): boolean {
  const v = value.trim();
  return v === 'none' || CSS_WIDE_KEYWORDS.has(v);
}

/** A number or percentage argument (amount() of filter functions); `fallback` when empty. */
function filterAmount(arg: string, fallback: number): number | null {
  const token = arg.trim();
  if (token === '') return fallback;
  const d = parseDimension(token);
  if (d === null) return null;
  if (d.unit === '%') return d.n / 100;
  return d.unit === '' ? d.n : null;
}

const SAFE_FILTER_FUNCTIONS: ReadonlySet<string> = new Set(['grayscale', 'sepia', 'saturate', 'hue-rotate', 'drop-shadow']);

/**
 * A filter list that can wash text out (review S4): opacity under 0.1, brightness or contrast
 * outside 0.5 to 2, an invert between 0.25 and 0.75, a blur over 1px, a combined contrast factor
 * under 0.25, and anything that is not a known filter function (url() SVG filters included).
 * grayscale, sepia, saturate, hue-rotate and drop-shadow keep text readable.
 */
function filterHides(value: string): boolean {
  if (isNoneOrWide(value)) return false;
  const calls = functionCalls(value);
  if (calls.length === 0) return true;
  let factor = 1;
  for (const call of calls) {
    switch (call.name) {
      case 'opacity': {
        const a = filterAmount(call.args, 1);
        if (a === null || a < MIN_OPACITY) return true;
        factor *= Math.min(a, 1);
        break;
      }
      case 'brightness':
      case 'contrast': {
        const a = filterAmount(call.args, 1);
        if (a === null || a < FILTER_RANGE.min || a > FILTER_RANGE.max) return true;
        factor *= Math.min(a, 1);
        break;
      }
      case 'invert': {
        const a = filterAmount(call.args, 1);
        if (a === null) return true;
        const k = Math.abs(1 - 2 * Math.min(Math.max(a, 0), 1));
        if (k < 0.5) return true;
        factor *= k;
        break;
      }
      case 'blur': {
        const arg = call.args.trim();
        if (arg === '') break;
        const d = parseDimension(arg);
        const px = d === null ? null : dimensionPx(d);
        if (px === null || px > MAX_BLUR_PX) return true;
        break;
      }
      default:
        if (!SAFE_FILTER_FUNCTIONS.has(call.name)) return true;
    }
  }
  return factor < MIN_FILTER_FACTOR;
}

const BOX_KEYWORDS: ReadonlySet<string> = new Set(['margin-box', 'border-box', 'padding-box', 'content-box', 'fill-box', 'stroke-box', 'view-box']);

/** A length that is exactly zero (0, 0px, 0%). */
function isZeroLength(token: string): boolean {
  const d = parseDimension(token.trim());
  return d !== null && d.n === 0;
}

function transformHides(value: string): boolean {
  for (const call of functionCalls(value)) {
    const args = functionArgs(call.args);
    switch (call.name) {
      case 'scale':
      case 'scale3d':
        // The z factor of scale3d never hides flat text.
        if (args.slice(0, 2).some(isScaleTiny)) return true;
        break;
      case 'scalex':
      case 'scaley':
        if (args[0] !== undefined && isScaleTiny(args[0])) return true;
        break;
      case 'matrix': {
        const n = args.map(Number);
        if (n.length === 6 && n.every(Number.isFinite)) {
          const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = n;
          if (Math.hypot(a, b) < MIN_SCALE || Math.hypot(c, d) < MIN_SCALE) return true;
          if (e <= -OFFSCREEN_PX || f <= -OFFSCREEN_PX || e >= OFFSCREEN_FAR_PX || f >= OFFSCREEN_FAR_PX) return true;
        }
        break;
      }
      case 'translate':
      case 'translate3d':
        if (args.slice(0, 2).some(isFarTranslate)) return true;
        break;
      case 'translatex':
      case 'translatey':
        if (args[0] !== undefined && isFarTranslate(args[0])) return true;
        break;
      // Never in real mail, and each can squash text to nothing (review S4): fail closed.
      case 'matrix3d':
      case 'perspective':
        return true;
      case 'skew':
      case 'skewx':
      case 'skewy':
        for (const arg of args.slice(0, call.name === 'skew' ? 2 : 1)) {
          const deg = angleDegrees(arg);
          if (deg !== null && fromEdgeOn(deg) < SKEW_EDGE_DEGREES) return true;
        }
        break;
      case 'rotate3d': {
        const [x = '0', y = '0', , angle] = args;
        const deg = angle === undefined ? null : angleDegrees(angle);
        if ((Number(x) !== 0 || Number(y) !== 0) && deg !== null && fromEdgeOn(deg) < 1) return true;
        break;
      }
      default:
        if (ROTATE_EDGE_RE.test(call.name) && args[0] !== undefined) {
          const deg = angleDegrees(args[0]);
          if (deg !== null && Math.abs((((deg % 180) + 180) % 180) - 90) < 1) return true;
        }
    }
  }
  return false;
}

function isScaleTiny(token: string): boolean {
  const d = parseDimension(token.trim());
  if (!d) return MATH_FUNCTION_RE.test(token.trim()) && isFractionUnder(token, MIN_SCALE);
  if (d.unit === '%') return Math.abs(d.n / 100) < MIN_SCALE;
  return d.unit === '' && Math.abs(d.n) < MIN_SCALE;
}

function clipRectHides(value: string): boolean {
  const call = functionCalls(value).find((c) => c.name === 'rect');
  if (!call) return false;
  const args = functionArgs(call.args);
  if (args.length !== 4) return false;
  const px = (token: string, auto: number): number | null => {
    if (token === 'auto') return auto;
    const d = parseDimension(token);
    if (!d) return null;
    return dimensionPx(d) ?? d.n;
  };
  const [top, right, bottom, left] = [px(args[0] ?? '', 0), px(args[1] ?? '', Infinity), px(args[2] ?? '', Infinity), px(args[3] ?? '', 0)];
  if (top === null || right === null || bottom === null || left === null) return false;
  return bottom - top <= TINY_BOX_PX || right - left <= TINY_BOX_PX;
}

/**
 * A clip-path that is not provably the whole box hides (review S4): only none, box keywords and
 * inset() with every offset zero keep the text. polygon(), path(), rect(), xywh(), url(), shapes
 * and any non-zero inset() clip it, possibly to nothing.
 */
function clipPathHides(value: string): boolean {
  if (isNoneOrWide(value)) return false;
  const words = topLevelWords(value.trim());
  const shapes = words.filter((word) => !BOX_KEYWORDS.has(word));
  if (shapes.length === 0) return false;
  if (shapes.length > 1) return true;
  const call = functionCalls(shapes[0] ?? '')[0];
  if (call === undefined || call.name !== 'inset') return true;
  const offsets = topLevelWords(call.args.split(/\s+round\s+/)[0] ?? '');
  return offsets.length === 0 || !offsets.every(isZeroLength);
}

/** Off-screen through a box shorthand: inset (top right bottom left) or margin (top and left only). */
function boxShorthandFar(value: string, property: 'inset' | 'margin'): boolean {
  const words = topLevelWords(value);
  const top = words[0];
  const right = words[1] ?? top;
  const bottom = words[2] ?? top;
  const left = words[3] ?? right;
  const sides: [string | undefined, OffsetSide][] =
    property === 'inset'
      ? [
          [top, 'start'],
          [right, 'end'],
          [bottom, 'end'],
          [left, 'start'],
        ]
      : [
          [top, 'start'],
          [left, 'start'],
        ];
  return sides.some(([word, side]) => word !== undefined && isFarOffset(word, side));
}

/** A logical pair shorthand (inset-inline, inset-block): start then end. */
function logicalPairFar(value: string): boolean {
  const words = topLevelWords(value);
  const start = words[0];
  const end = words[1] ?? start;
  return (start !== undefined && isFarOffset(start, 'start')) || (end !== undefined && isFarOffset(end, 'end'));
}

/** The individual rotate property turned edge-on about an axis in the page plane ("x 90deg", "1 0 0 90deg"). */
function rotatePropertyHides(words: readonly string[]): boolean {
  if (words.length < 2) return false;
  const angleIndex = words.findIndex((word) => strictAngle(word) !== null);
  if (angleIndex === -1) return false;
  const deg = strictAngle(words[angleIndex] ?? '') ?? 0;
  const axis = words.filter((_, index) => index !== angleIndex);
  const inPlane = axis[0] === 'x' || axis[0] === 'y' || (axis.length === 3 && (Number(axis[0]) !== 0 || Number(axis[1]) !== 0));
  return inPlane && fromEdgeOn(deg) < 1;
}

const FAIL_CLOSED_PROPS: ReadonlySet<string> = new Set([
  'display',
  'visibility',
  'opacity',
  'content-visibility',
  'transform',
  'translate',
  'scale',
  'zoom',
  'filter',
  'clip',
  'clip-path',
  'text-indent',
  'left',
  'top',
  'right',
  'bottom',
  'inset',
  'mask',
  'mask-image',
  'mask-border',
  'mask-border-source',
  'mask-box-image',
  'mask-box-image-source',
  'mix-blend-mode',
  'rotate',
]);

/** Whether one declaration hides its element on its own. */
function declarationHides(d: Declaration): boolean {
  if (FAIL_CLOSED_PROPS.has(d.prop) && isUnresolvable(d.value)) return true;
  const words = topLevelWords(d.value);
  switch (d.prop) {
    case 'display':
      return words.includes('none');
    case 'visibility':
      return words.includes('hidden') || words.includes('collapse');
    case 'content-visibility':
      return words.includes('hidden');
    case 'opacity':
      return isFractionUnder(d.value, MIN_OPACITY);
    case 'max-height':
    case 'max-block-size':
      return isTinyLength(d.value, 0);
    // Off-screen (review S4 and P3): far up or left either way, far right or down from +2000px
    // (or 100%) for the start sides, and right or bottom far in either direction.
    case 'left':
    case 'top':
    case 'inset-block-start':
    case 'inset-inline-start':
    case 'text-indent':
    case 'margin-left':
    case 'margin-top':
    case 'margin-inline-start':
    case 'margin-block-start':
      return words.length > 0 && isFarOffset(words[0] ?? '', 'start');
    case 'right':
    case 'bottom':
    case 'inset-block-end':
    case 'inset-inline-end':
      return words.length > 0 && isFarOffset(words[0] ?? '', 'end');
    case 'inset-block':
    case 'inset-inline':
      return logicalPairFar(d.value);
    case 'margin-block':
    case 'margin-inline':
      return words.length > 0 && isFarOffset(words[0] ?? '', 'start');
    case 'inset':
      return boxShorthandFar(d.value, 'inset');
    case 'margin':
      return boxShorthandFar(d.value, 'margin');
    case 'clip':
      return clipRectHides(d.value);
    case 'clip-path':
      return clipPathHides(d.value);
    case 'transform':
      return transformHides(d.value);
    case 'translate':
      return words.slice(0, 2).some(isFarTranslate);
    case 'scale':
      return words.slice(0, 2).some(isScaleTiny);
    case 'rotate':
      return rotatePropertyHides(words);
    case 'zoom':
      return words.length === 1 && isFractionUnder(d.value, MIN_SCALE);
    case 'filter':
      return filterHides(d.value);
    // A mask image can make any part of the box transparent; a blend mode can paint the text in
    // the color behind it (screen, multiply, difference...). Never needed for a recap: fail closed.
    case 'mask':
    case 'mask-image':
    case 'mask-border':
    case 'mask-border-source':
    case 'mask-box-image':
    case 'mask-box-image-source':
      return !isNoneOrWide(d.value);
    case 'mix-blend-mode':
      return d.value.trim() !== 'normal' && !isNoneOrWide(d.value);
    case 'mso-hide':
      return words.includes('all');
    default:
      return false;
  }
}

/** An opacity value as a fraction, or null when it is not one. */
function opacityOf(value: string): number | null {
  const d = parseDimension(value.trim());
  if (d === null) return null;
  if (d.unit === '%') return clamp(d.n / 100, 0, 1);
  return d.unit === '' ? clamp(d.n, 0, 1) : null;
}

const BOX_SIZE_PROPS: ReadonlySet<string> = new Set(['height', 'max-height', 'width', 'max-width', 'block-size', 'inline-size', 'max-block-size', 'max-inline-size']);
const OVERFLOW_PROPS: ReadonlySet<string> = new Set(['overflow', 'overflow-x', 'overflow-y', 'overflow-block', 'overflow-inline']);
const ANIMATION_SKIP_WORDS: ReadonlySet<string> = new Set([
  'none',
  'infinite',
  'normal',
  'reverse',
  'alternate',
  'alternate-reverse',
  'forwards',
  'backwards',
  'both',
  'running',
  'paused',
  'ease',
  'linear',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'step-start',
  'step-end',
]);

function animationNamesOf(value: string): string[] {
  const names: string[] = [];
  for (const layer of splitTopLevel(value, ',')) {
    for (const word of topLevelWords(layer)) {
      const name = word.replace(/^["']|["']$/g, '');
      if (name === '' || ANIMATION_SKIP_WORDS.has(name) || /^[\d.+-]/.test(name) || name.includes('(')) continue;
      names.push(name);
    }
  }
  return names;
}

function weigh<T>(current: Weighted<T> | null, value: T, important: boolean): Weighted<T> {
  // Inside one block a later declaration wins unless the earlier one is important and it is not.
  if (current !== null && current.important && !important) return current;
  return { value, important };
}

/** Summarizes one declaration block. */
function summarize(declarations: readonly Declaration[]): DeclSummary {
  const summary: DeclSummary = {
    relevant: false,
    hides: false,
    tinyBox: false,
    overflowHidden: false,
    fontSizes: [],
    animationNames: [],
    color: null,
    fill: null,
    background: null,
    backgroundImage: null,
    opacity: null,
    whiteSpace: null,
  };
  for (const d of declarations) {
    if (declarationHides(d)) summary.hides = true;
    if (d.prop === 'opacity') {
      const opacity = opacityOf(d.value);
      if (opacity !== null) summary.opacity = Math.min(summary.opacity ?? 1, opacity);
    }
    if (BOX_SIZE_PROPS.has(d.prop) && isTinyLength(d.value, TINY_BOX_PX)) summary.tinyBox = true;
    if (OVERFLOW_PROPS.has(d.prop) && topLevelWords(d.value).some((w) => w === 'hidden' || w === 'clip')) summary.overflowHidden = true;
    if (d.prop === 'font-size') {
      const spec = parseFontSize(d.value);
      if (spec) summary.fontSizes.push(spec);
    } else if (d.prop === 'font') {
      const spec = fontShorthandSize(d.value);
      if (spec) summary.fontSizes.push(spec);
    } else if (d.prop === 'animation' || d.prop === 'animation-name') {
      summary.animationNames.push(...animationNamesOf(d.value));
    } else if (d.prop === 'color' || d.prop === 'text-fill-color') {
      const color = parseColor(d.value);
      if (color !== null) {
        if (d.prop === 'color') summary.color = weigh(summary.color, color, d.important);
        else summary.fill = weigh(summary.fill, color, d.important);
      }
    } else if (d.prop === 'background' || d.prop === 'background-color') {
      const color = backgroundColorOf(d.prop, d.value);
      if (color !== null) summary.background = weigh(summary.background, color, d.important);
      // The shorthand also sets the image layers (to none when it names no image).
      if (d.prop === 'background') summary.backgroundImage = weigh(summary.backgroundImage, backgroundImageOf(d.value), d.important);
    } else if (d.prop === 'background-image') {
      summary.backgroundImage = weigh(summary.backgroundImage, backgroundImageOf(d.value), d.important);
    } else if (d.prop === 'white-space' || d.prop === 'white-space-collapse') {
      summary.whiteSpace = weigh(summary.whiteSpace, parseWhiteSpace(d.value), d.important);
    }
  }
  summary.relevant =
    summary.hides ||
    summary.tinyBox ||
    summary.overflowHidden ||
    summary.fontSizes.length > 0 ||
    summary.animationNames.length > 0 ||
    summary.color !== null ||
    summary.fill !== null ||
    summary.background !== null ||
    summary.backgroundImage !== null ||
    summary.opacity !== null ||
    summary.whiteSpace !== null;
  return summary;
}

/** A style attribute's declarations (comments removed). */
export function summarizeInlineStyle(style: string): DeclSummary {
  return summarize(parseDeclarations(stripCssComments(style)));
}

/** Whether a keyframe's declarations make the element invisible. */
function keyframeHides(summary: DeclSummary): boolean {
  if (summary.hides || (summary.tinyBox && summary.overflowHidden)) return true;
  if (summary.fontSizes.some((spec) => (spec.kind === 'px' ? spec.px : spec.kind === 'inherit' ? 16 : spec.factor * 16) < MIN_FONT_PX)) return true;
  const color = summary.color?.value;
  return color !== undefined && typeof color !== 'string' && color.a < MIN_OPACITY;
}

// ---------------------------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------------------------

/** A class or id as written (escapes decoded) and ASCII-lowercased. */
export interface SelectorName {
  raw: string;
  lower: string;
}

export type AttrOperator = '' | '=' | '~=' | '|=' | '^=' | '$=' | '*=';

/** An attribute selector. Values compare ASCII case-insensitively: a superset of what any client matches. */
export interface AttrTest {
  /** Lowercased (HTML attribute names are case-insensitive). */
  name: string;
  op: AttrOperator;
  value: string;
}

export interface Compound {
  /** Lowercased type, or null for any. */
  tag: string | null;
  /** All must be present. Compared case-insensitively; a match by case folding alone is never definite. */
  ids: SelectorName[];
  classes: SelectorName[];
  /** Attribute selectors (review P4): evaluated, never definite. */
  attrs: AttrTest[];
  /**
   * :is() and :where() over plain compounds ("div:is(.a, .b)"): each group needs one of its
   * alternatives to match. Never definite. A list it cannot evaluate this way is dropped (a superset).
   */
  anyOf: Compound[][];
}

export type Combinator = ' ' | '>';

export type Selector =
  | {
      kind: 'complex';
      /** Left to right. */
      compounds: Compound[];
      /** combinators[i] links compounds[i] (left) to compounds[i + 1]. */
      combinators: Combinator[];
      /**
       * True when a case-exact match means the rule applies in EVERY light rendering: nothing was
       * relaxed, no attribute test, no sibling combinator, not nested, every selector of its list
       * valid, and no condition around the rule (see "Colors"). Otherwise a match is only possible.
       */
      definite: boolean;
      /** ids * 1e6 + classes * 1e3 + types (each capped at 999); an upper bound when not definite. */
      specificity: number;
      /** False for ::first-line and ::first-letter: they style the element's text but never hide the element. */
      canHide: boolean;
    }
  | {
      /** A selector that did not parse: any element carrying one of these names (lowercased); a possible match only. */
      kind: 'names';
      ids: string[];
      classes: string[];
      tags: string[];
      /** An upper bound. */
      specificity: number;
    };

/** A selector list: the selectors that can style an element's text, and whether a browser keeps the list at all. */
export interface SelectorList {
  selectors: Selector[];
  /**
   * False when some entry may be invalid in a browser (bad syntax, an identifier starting with a
   * digit, an unknown pseudo-class or pseudo-element, the || combinator, a namespace prefix, an
   * empty entry): a browser then drops the WHOLE rule, so none of its selectors is definite.
   */
  valid: boolean;
}

const IDENT_START_RE = /[A-Za-z_\u0080-\uFFFF]/;
const IDENT_CHAR_RE = /[A-Za-z0-9_\u0080-\uFFFF-]/;
const HEX_DIGIT_RE = /[0-9a-fA-F]/;

type PseudoToken = { t: 'pseudo'; name: string; element: boolean; args: string | null };

type SimpleToken =
  | { t: 'any' }
  | { t: 'type'; name: string }
  | { t: 'id'; name: SelectorName }
  | { t: 'class'; name: SelectorName }
  | { t: 'attr'; test: AttrTest; valid: boolean }
  | PseudoToken
  | { t: 'relaxed'; valid: boolean }
  | { t: 'comb'; c: ' ' | '>' | '+' | '~' | '||' };

class SelectorSyntaxError extends Error {}

/** Whether an identifier starts at `i` (CSS Syntax: a letter, "_", non-ASCII or an escape, optionally after "-"; or "--"). */
function startsIdent(text: string, i: number): boolean {
  const startsName = (j: number): boolean => {
    const c = text.charAt(j);
    if (c === '\\') return j + 1 < text.length && text.charAt(j + 1) !== '\n';
    return c !== '' && IDENT_START_RE.test(c);
  };
  if (text.charAt(i) === '-') return text.charAt(i + 1) === '-' || startsName(i + 1);
  return startsName(i);
}

/**
 * Reads an identifier at `i`, escapes decoded, as written and lowercased. One that starts with a
 * digit (".2b", "#1a") is not an identifier: browsers drop such a selector (review S2).
 */
function readIdent(text: string, i: number): { raw: string; lower: string; end: number } {
  if (!startsIdent(text, i)) throw new SelectorSyntaxError('not an identifier');
  let j = i;
  while (j < text.length) {
    const ch = text.charAt(j);
    if (ch === '\\') {
      if (j + 1 >= text.length || text.charAt(j + 1) === '\n') break;
      j += 1;
      if (HEX_DIGIT_RE.test(text.charAt(j))) {
        let digits = 0;
        while (j < text.length && digits < 6 && HEX_DIGIT_RE.test(text.charAt(j))) {
          j += 1;
          digits += 1;
        }
        // One whitespace after a hex escape belongs to it.
        if (j < text.length && /\s/.test(text.charAt(j))) j += 1;
      } else {
        j += 1;
      }
      continue;
    }
    if (!IDENT_CHAR_RE.test(ch)) break;
    j += 1;
  }
  const raw = unescapeCss(text.slice(i, j));
  return { raw, lower: raw.toLowerCase(), end: j };
}

/** Index just past the bracket or parenthesis group that opens at `i`. */
function skipGroup(text: string, i: number): number {
  const open = text.charAt(i);
  const close = open === '[' ? ']' : ')';
  let depth = 0;
  let j = i;
  while (j < text.length) {
    const ch = text.charAt(j);
    if (ch === '"' || ch === "'") {
      j = skipString(text, j);
      continue;
    }
    if (ch === '\\') {
      j += 2;
      continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return j + 1;
    }
    j += 1;
  }
  throw new SelectorSyntaxError('unclosed group');
}

/** An attribute selector at `i` (a "["): [name], [name op value] with an optional i or s flag. */
function readAttribute(text: string, i: number): { token: SimpleToken; end: number } {
  const end = skipGroup(text, i);
  const inner = text.slice(i + 1, end - 1);
  let j = 0;
  const skipWs = (): void => {
    while (j < inner.length && /\s/.test(inner.charAt(j))) j += 1;
  };
  skipWs();
  let valid = true;
  // A namespace prefix ("*|", "|" or "ns|", never the "|=" operator); only "*|" and "|" are always valid.
  const ns = /^(\*|[A-Za-z_][A-Za-z0-9_-]*)?\|(?!=)/.exec(inner.slice(j));
  if (ns) {
    if (ns[1] !== undefined && ns[1] !== '*') valid = false;
    j += ns[0].length;
  }
  const name = readIdent(inner, j);
  j = name.end;
  skipWs();
  if (j >= inner.length) return { token: { t: 'attr', test: { name: name.lower, op: '', value: '' }, valid }, end };
  const op = /^[~|^$*]?=/.exec(inner.slice(j))?.[0];
  if (op === undefined) throw new SelectorSyntaxError('bad attribute operator');
  j += op.length;
  skipWs();
  let value: string;
  const quote = inner.charAt(j);
  if (quote === '"' || quote === "'") {
    const close = skipString(inner, j);
    if (close - 1 <= j || inner.charAt(close - 1) !== quote) throw new SelectorSyntaxError('unclosed attribute string');
    value = unescapeCss(inner.slice(j + 1, close - 1));
    j = close;
  } else {
    const ident = readIdent(inner, j);
    value = ident.raw;
    j = ident.end;
  }
  skipWs();
  if (j < inner.length) {
    if (!/^[iIsS]$/.test(inner.charAt(j))) throw new SelectorSyntaxError('bad attribute flag');
    j += 1;
    skipWs();
    if (j < inner.length) throw new SelectorSyntaxError('trailing attribute text');
  }
  return { token: { t: 'attr', test: { name: name.lower, op: op as AttrOperator, value }, valid }, end };
}

/** Single-colon names that are pseudo-elements (CSS 2). */
const LEGACY_PSEUDO_ELEMENTS: ReadonlySet<string> = new Set(['before', 'after', 'first-line', 'first-letter']);
/** Pseudo-elements that style the element's own text: their colors and sizes count, but they never hide the element. */
const TEXT_PSEUDO_ELEMENTS: ReadonlySet<string> = new Set(['first-line', 'first-letter']);
const KNOWN_PSEUDO_ELEMENTS: ReadonlySet<string> = new Set([
  ...LEGACY_PSEUDO_ELEMENTS,
  'selection',
  'marker',
  'placeholder',
  'backdrop',
  'file-selector-button',
  'cue',
  'part',
  'slotted',
  'grammar-error',
  'spelling-error',
  'target-text',
  'highlight',
  'details-content',
]);
const KNOWN_PSEUDO_CLASSES: ReadonlySet<string> = new Set(
  (
    'hover active focus focus-within focus-visible visited link any-link target checked disabled enabled ' +
    'first-child last-child only-child first-of-type last-of-type only-of-type root empty required optional ' +
    'valid invalid user-valid user-invalid in-range out-of-range read-only read-write placeholder-shown default ' +
    'indeterminate scope defined autofill open popover-open modal fullscreen playing paused'
  ).split(' '),
);
const NTH_PSEUDO_CLASSES: ReadonlySet<string> = new Set(['nth-child', 'nth-last-child', 'nth-of-type', 'nth-last-of-type']);
const NTH_ARGS_RE = /^\s*(?:odd|even|[+-]?\d*n(?:\s*[+-]\s*\d+)?|[+-]?\d+)(?:\s+of\s+[\s\S]+)?\s*$/i;
/** Selector-list pseudo-class nesting checked for validity. */
const MAX_PSEUDO_DEPTH = 4;

function pseudoValid(token: PseudoToken, depth: number): boolean {
  if (token.element) return KNOWN_PSEUDO_ELEMENTS.has(token.name);
  if (token.args === null) return KNOWN_PSEUDO_CLASSES.has(token.name);
  if (NTH_PSEUDO_CLASSES.has(token.name)) return NTH_ARGS_RE.test(token.args);
  if (token.name === 'lang' || token.name === 'dir') return true;
  // :is() and :where() take forgiving lists: a bad entry never drops the rule.
  if (token.name === 'is' || token.name === 'where') return true;
  if (token.name === 'not' || token.name === 'has') return depth < MAX_PSEUDO_DEPTH && selectorListValid(token.args, depth + 1, token.name === 'has');
  return false;
}

/** Whether every selector of `text` (the argument of :not() or :has()) is valid. */
function selectorListValid(text: string, depth: number, relative: boolean): boolean {
  for (const part of splitTopLevel(text, ',')) {
    let tokens: SimpleToken[];
    try {
      tokens = tokenizeSelector(part.trim());
    } catch {
      return false;
    }
    const first = tokens[0];
    const last = tokens[tokens.length - 1];
    if (first === undefined || last === undefined || last.t === 'comb' || (!relative && first.t === 'comb')) return false;
    for (const token of tokens) {
      if (token.t === 'pseudo' && !pseudoValid(token, depth)) return false;
      if ((token.t === 'attr' || token.t === 'relaxed') && !token.valid) return false;
      if (token.t === 'comb' && token.c === '||') return false;
    }
  }
  return true;
}

function tokenizeSelector(text: string): SimpleToken[] {
  const tokens: SimpleToken[] = [];
  let i = 0;
  let pendingSpace = false;
  const pushComb = (c: ' ' | '>' | '+' | '~' | '||'): void => {
    const last = tokens[tokens.length - 1];
    if (last?.t === 'comb') {
      if (last.c === ' ') last.c = c;
      else if (c !== ' ') throw new SelectorSyntaxError('two combinators');
    } else {
      tokens.push({ t: 'comb', c });
    }
  };
  while (i < text.length) {
    const ch = text.charAt(i);
    if (/\s/.test(ch)) {
      pendingSpace = true;
      i += 1;
      continue;
    }
    if (ch === '>' || ch === '+' || ch === '~' || (ch === '|' && text.charAt(i + 1) === '|')) {
      pushComb(ch === '|' ? '||' : ch);
      i += ch === '|' ? 2 : 1;
      pendingSpace = false;
      continue;
    }
    if (pendingSpace && tokens.length > 0) pushComb(' ');
    pendingSpace = false;
    if (ch === '*') {
      if (text.charAt(i + 1) === '|' && text.charAt(i + 2) !== '|') {
        // "*|div": any namespace, dropped (a superset).
        i += 2;
        tokens.push({ t: 'relaxed', valid: true });
        continue;
      }
      tokens.push({ t: 'any' });
      i += 1;
      continue;
    }
    if (ch === '|') {
      // "|div": the no-namespace prefix.
      tokens.push({ t: 'relaxed', valid: true });
      i += 1;
      continue;
    }
    if (ch === '&') {
      tokens.push({ t: 'relaxed', valid: true });
      i += 1;
      continue;
    }
    if (ch === '#') {
      const ident = readIdent(text, i + 1);
      tokens.push({ t: 'id', name: { raw: ident.raw, lower: ident.lower } });
      i = ident.end;
      continue;
    }
    if (ch === '.') {
      const ident = readIdent(text, i + 1);
      tokens.push({ t: 'class', name: { raw: ident.raw, lower: ident.lower } });
      i = ident.end;
      continue;
    }
    if (ch === '[') {
      const attribute = readAttribute(text, i);
      tokens.push(attribute.token);
      i = attribute.end;
      continue;
    }
    if (ch === ':') {
      const doubled = text.charAt(i + 1) === ':';
      const ident = readIdent(text, i + (doubled ? 2 : 1));
      i = ident.end;
      let args: string | null = null;
      if (text.charAt(i) === '(') {
        const close = skipGroup(text, i);
        args = text.slice(i + 1, close - 1);
        i = close;
      }
      tokens.push({ t: 'pseudo', name: ident.lower, element: doubled || LEGACY_PSEUDO_ELEMENTS.has(ident.lower), args });
      continue;
    }
    if (startsIdent(text, i)) {
      const ident = readIdent(text, i);
      i = ident.end;
      if (text.charAt(i) === '|' && text.charAt(i + 1) !== '|') {
        // "ns|div": the namespace prefix is dropped (a superset); valid only with an @namespace rule.
        i += 1;
        tokens.push({ t: 'relaxed', valid: false });
        continue;
      }
      tokens.push({ t: 'type', name: ident.lower });
      continue;
    }
    throw new SelectorSyntaxError('unexpected character');
  }
  return tokens;
}

/** Pseudo-classes whose argument is a list of alternatives (evaluated when each one is a plain compound). */
const ALTERNATIVE_PSEUDO_CLASSES: ReadonlySet<string> = new Set(['is', 'where', 'matches', '-webkit-any', '-moz-any']);

/** The alternatives of :is(a, b) when each is a plain compound (type, id, class, attribute); null otherwise. */
function plainCompounds(text: string): Compound[] | null {
  const out: Compound[] = [];
  for (const part of splitTopLevel(text, ',')) {
    let tokens: SimpleToken[];
    try {
      tokens = tokenizeSelector(part.trim());
    } catch {
      return null;
    }
    if (tokens.length === 0) return null;
    const compound: Compound = { tag: null, ids: [], classes: [], attrs: [], anyOf: [] };
    for (const token of tokens) {
      if (token.t === 'type') {
        if (compound.tag !== null) return null;
        compound.tag = token.name;
      } else if (token.t === 'id') compound.ids.push(token.name);
      else if (token.t === 'class') compound.classes.push(token.name);
      else if (token.t === 'attr') compound.attrs.push(token.test);
      else if (token.t !== 'any') return null;
    }
    out.push(compound);
  }
  return out;
}

function packSpecificity(ids: number, classes: number, types: number): number {
  const cap = (n: number): number => Math.min(n, 999);
  return cap(ids) * 1e6 + cap(classes) * 1e3 + cap(types);
}

/** An upper bound of the specificity a selector text can carry (every "#", ".", "[" and ":", every name). */
function specificityBound(text: string): { ids: number; classes: number; types: number } {
  return {
    ids: (text.match(/#/g) ?? []).length,
    classes: (text.match(/[.[:]/g) ?? []).length,
    types: (text.match(/[A-Za-z_][A-Za-z0-9_-]*/g) ?? []).length,
  };
}

interface ParsedSelector {
  /** Null when the selector never styles the element's own text (::before, ::marker and the like, or :empty). */
  selector: Selector | null;
  /** False when a browser may drop the whole list for this selector (SelectorList.valid). */
  valid: boolean;
}

interface RawCompound {
  comb: ' ' | '>' | '+' | '~' | '||' | null;
  compound: Compound;
  /** Carries :empty (the element has no children, so no text and no descendants). */
  empty: boolean;
  pseudoElement: string | null;
}

/**
 * Parses one complex selector. `nested`: a selector inside another rule's block (CSS nesting),
 * which may start with a combinator and is never definite.
 */
function parseComplexSelector(text: string, nested: boolean): ParsedSelector {
  let tokens: SimpleToken[];
  try {
    tokens = tokenizeSelector(text.trim());
  } catch {
    return { selector: namesFallback(text), valid: false };
  }
  if (tokens.length === 0) return { selector: namesFallback(text), valid: false };
  let definite = !nested;
  let valid = true;
  const newCompound = (comb: RawCompound['comb']): RawCompound => ({
    comb,
    compound: { tag: null, ids: [], classes: [], attrs: [], anyOf: [] },
    empty: false,
    pseudoElement: null,
  });
  const raw: RawCompound[] = [];
  let current: RawCompound | null = null;
  let pendingComb: RawCompound['comb'] = null;
  let ids = 0;
  let classes = 0;
  let types = 0;
  for (const token of tokens) {
    if (token.t === 'comb') {
      if (current === null) {
        if (!nested || raw.length > 0) return { selector: namesFallback(text), valid: false };
        // A relative nested selector ("> .x"): its left side is the parent rule, read as any element.
        raw.push(newCompound(null));
      } else {
        raw.push(current);
      }
      current = null;
      pendingComb = token.c;
      if (token.c === '||') valid = false;
      continue;
    }
    if (current === null) current = newCompound(pendingComb);
    // Only pseudo-classes may follow a pseudo-element.
    if (current.pseudoElement !== null && (token.t !== 'pseudo' || token.element)) valid = false;
    switch (token.t) {
      case 'type':
        if (current.compound.tag !== null) return { selector: namesFallback(text), valid: false };
        current.compound.tag = token.name;
        types += 1;
        break;
      case 'id':
        current.compound.ids.push(token.name);
        ids += 1;
        break;
      case 'class':
        current.compound.classes.push(token.name);
        classes += 1;
        break;
      case 'attr':
        current.compound.attrs.push(token.test);
        definite = false;
        classes += 1;
        if (!token.valid) valid = false;
        break;
      case 'pseudo':
        definite = false;
        if (!pseudoValid(token, 0)) valid = false;
        if (token.element) {
          current.pseudoElement = token.name;
          types += 1;
        } else {
          if (token.name === 'empty' && token.args === null) current.empty = true;
          if (token.args !== null && ALTERNATIVE_PSEUDO_CLASSES.has(token.name)) {
            const alternatives = plainCompounds(token.args);
            if (alternatives !== null) current.compound.anyOf.push(alternatives);
          }
          if (token.name !== 'where') {
            classes += 1;
            if (token.args !== null) {
              const bound = specificityBound(token.args);
              ids += bound.ids;
              classes += bound.classes;
              types += bound.types;
            }
          }
        }
        break;
      case 'relaxed':
        definite = false;
        if (!token.valid) valid = false;
        break;
      default:
      // 'any': the universal selector constrains nothing.
    }
  }
  if (current === null) return { selector: namesFallback(text), valid: false };
  raw.push(current);

  const subject = raw[raw.length - 1] ?? current;
  if (raw.some((entry) => entry !== subject && entry.pseudoElement !== null)) valid = false;
  let canHide = true;
  if (subject.pseudoElement !== null) {
    // Generated content (::before, ::after, ::marker...) is never emitted, so such a rule neither
    // hides nor colors the element's own text (review P4); ::first-line and ::first-letter style it.
    if (!TEXT_PSEUDO_ELEMENTS.has(subject.pseudoElement)) return { selector: null, valid };
    canHide = false;
  }
  // :empty matches only an element without children: it has no text to hide or color.
  if (subject.empty) return { selector: null, valid };

  // Sibling and column combinators: drop the compound on their left (a superset, see the file comment).
  const kept: RawCompound[] = [];
  const combinators: Combinator[] = [];
  for (const entry of raw) {
    if (entry.comb === '+' || entry.comb === '~' || entry.comb === '||') {
      definite = false;
      kept.pop();
      const link = combinators.pop();
      kept.push(entry);
      if (link !== undefined) combinators.push(entry.comb === '||' ? ' ' : link);
      continue;
    }
    if (kept.length > 0) combinators.push(entry.comb === '>' ? '>' : ' ');
    kept.push(entry);
  }
  // An :empty ancestor has no descendants, so the selector matches nothing.
  if (kept.slice(0, -1).some((entry) => entry.empty)) return { selector: null, valid };
  while (kept.length > STYLE_LIMITS.maxCompounds) {
    kept.shift();
    combinators.shift();
    definite = false;
  }
  return {
    selector: { kind: 'complex', compounds: kept.map((entry) => entry.compound), combinators, definite, specificity: packSpecificity(ids, classes, types), canHide },
    valid,
  };
}

/** The fallback for a selector that does not parse: the class and id names it mentions, else its types, else everything. */
function namesFallback(text: string): Selector {
  const bound = specificityBound(text);
  const specificity = packSpecificity(bound.ids, bound.classes, bound.types);
  const ids = [...text.matchAll(/#((?:[A-Za-z0-9_\u0080-\uFFFF-]|\\.)+)/g)].map((m) => unescapeCss(m[1] ?? '').toLowerCase());
  const classes = [...text.matchAll(/\.((?:[A-Za-z_\u0080-\uFFFF-]|\\.)(?:[A-Za-z0-9_\u0080-\uFFFF-]|\\.)*)/g)].map((m) => unescapeCss(m[1] ?? '').toLowerCase());
  if (ids.length > 0 || classes.length > 0) return { kind: 'names', ids, classes, tags: [], specificity };
  const tags = [...text.matchAll(/(?:^|[\s>+~,(])([A-Za-z][A-Za-z0-9-]*)/g)].map((m) => (m[1] ?? '').toLowerCase());
  if (tags.length > 0) return { kind: 'names', ids: [], classes: [], tags, specificity };
  return { kind: 'complex', compounds: [{ tag: null, ids: [], classes: [], attrs: [], anyOf: [] }], combinators: [], definite: false, specificity, canHide: true };
}

/** A selector list (see SelectorList). */
export function parseSelectorList(text: string, nested = false): SelectorList {
  const selectors: Selector[] = [];
  let valid = true;
  for (const part of splitTopLevel(text, ',')) {
    if (part.trim() === '') {
      // An empty entry ("a, , b", a trailing comma) makes a browser drop the list.
      valid = false;
      continue;
    }
    const parsed = parseComplexSelector(part, nested);
    if (!parsed.valid) valid = false;
    if (parsed.selector !== null) selectors.push(parsed.selector);
  }
  return { selectors, valid };
}

// ---------------------------------------------------------------------------------------------
// Style sheets
// ---------------------------------------------------------------------------------------------

export interface StyleRule {
  selectors: Selector[];
  summary: DeclSummary;
  /**
   * Inside a condition that may not hold in every light rendering (@media with features or other
   * media types, @supports, @container, @layer, @scope, @document, @starting-style, an unknown
   * at-rule, an @import with conditions): it still hides, but its colors are only possible.
   */
  conditional: boolean;
  /** Inside @media that requires prefers-color-scheme: dark in every query (never used for colors). */
  darkMode: boolean;
  /** Document order across all style blocks. */
  order: number;
  /** hides, or an animation of a hiding @keyframes (set by parseStyleSheets). */
  hides: boolean;
}

export interface StyleSheet {
  rules: StyleRule[];
  hidingKeyframes: ReadonlySet<string>;
}

interface SheetContext {
  rules: StyleRule[];
  keyframes: Set<string>;
  selectorCount: number;
  order: number;
  /** data: style sheets read through @import, and their characters (STYLE_LIMITS). */
  imports: number;
  importedChars: number;
}

interface BlockContext {
  conditional: boolean;
  darkMode: boolean;
  depth: number;
}

const CONDITIONAL_AT_RULES: ReadonlySet<string> = new Set(['media', 'supports', 'container', 'layer', 'scope', 'document', 'starting-style']);
/** Block at-rules that hold no style rules (descriptors only). Any OTHER unknown at-rule is read as a conditional group. */
const NON_STYLE_AT_RULES: ReadonlySet<string> = new Set([
  'font-face',
  'page',
  'counter-style',
  'property',
  'font-feature-values',
  'font-palette-values',
  'viewport',
  'color-profile',
  'position-try',
  'view-transition',
]);

function enter(ctx: BlockContext, extra: Partial<BlockContext> = {}): BlockContext {
  const depth = ctx.depth + 1;
  if (depth > STYLE_LIMITS.maxNesting) throw new HtmlLimitError('too_complex');
  return { ...ctx, ...extra, depth };
}

function addRule(sheet: SheetContext, list: SelectorList, declarations: Declaration[], ctx: BlockContext): void {
  if (list.selectors.length === 0 || declarations.length === 0) return;
  const summary = summarize(declarations);
  if (!summary.relevant) return;
  sheet.selectorCount += list.selectors.length;
  if (sheet.selectorCount > STYLE_LIMITS.maxSelectors) throw new HtmlLimitError('too_complex');
  // A list a browser may drop whole, or a condition that may not hold: no selector is definite.
  const certain = list.valid && !ctx.conditional;
  const selectors = certain ? list.selectors : list.selectors.map((s) => (s.kind === 'complex' && s.definite ? { ...s, definite: false } : s));
  sheet.rules.push({ selectors, summary, conditional: ctx.conditional, darkMode: ctx.darkMode, order: sheet.order, hides: summary.hides });
  sheet.order += 1;
}

/** An at-keyword: CSS escapes decoded and lowercased, so "@\6d edia" is @media (review S1); a vendor prefix is dropped. */
const AT_KEYWORD_RE = /^-?(?:[A-Za-z_\u0080-\uFFFF]|\\(?:[0-9a-fA-F]{1,6}\s?|[^\n0-9a-fA-F]))(?:[A-Za-z0-9_\u0080-\uFFFF-]|\\(?:[0-9a-fA-F]{1,6}\s?|[^\n0-9a-fA-F]))*/;

function atRuleName(prelude: string): { name: string; rest: string } {
  const raw = AT_KEYWORD_RE.exec(prelude)?.[0] ?? '';
  return { name: unescapeCss(raw).toLowerCase().replace(/^-(?:webkit|moz|ms|o)-/, ''), rest: prelude.slice(raw.length) };
}

/**
 * Whether EVERY query of a media query list requires prefers-color-scheme: dark (review P2): no
 * query negated ("not"), joined by "or", or without the dark feature. Anything else is an
 * ordinary condition whose colors count as possible.
 */
export function isDarkOnlyMedia(prelude: string): boolean {
  const queries = splitTopLevel(unescapeCss(prelude).toLowerCase(), ',').map((query) => query.trim());
  if (queries.length === 0) return false;
  return queries.every((query) => {
    const words = topLevelWords(query);
    if (words.length === 0 || words.includes('not') || words.includes('or')) return false;
    return words.some((word) => word.replace(/\s+/g, '') === '(prefers-color-scheme:dark)');
  });
}

/** A media query list that holds on every screen: empty, or some query is just "all" or "screen" (with "only"). */
function isAlwaysOnScreen(prelude: string): boolean {
  const text = unescapeCss(prelude).toLowerCase().trim();
  if (text === '') return true;
  return splitTopLevel(text, ',').some((query) => {
    const words = topLevelWords(query.trim()).filter((word) => word !== 'only');
    return words.length === 1 && (words[0] === 'all' || words[0] === 'screen');
  });
}

function handleAtRule(
  sheet: SheetContext,
  prelude: string,
  css: string,
  start: number,
  end: number,
  ctx: BlockContext,
  selectors: SelectorList | null,
): void {
  const { name, rest } = atRuleName(prelude);
  if (name === 'keyframes') {
    if (selectors !== null) return;
    const keyframesName = unescapeCss(rest.trim().replace(/^["']|["']$/g, '')).toLowerCase();
    if (keyframesName === '') return;
    let i = start;
    while (i < end) {
      const open = scanTo(css, i, end, '{');
      if (open >= end) break;
      const close = blockEnd(css, open, end);
      if (keyframeHides(summarize(parseDeclarations(css.slice(open + 1, close))))) sheet.keyframes.add(keyframesName);
      i = close + 1;
    }
    return;
  }
  // @font-face, @page, @counter-style, @property and the like set nothing that hides text.
  if (NON_STYLE_AT_RULES.has(name)) return;
  // Conditional groups, and (fail closed, review S1) any at-rule this module does not know: the
  // rules inside apply as if the condition held, their colors only possibly.
  const dark = name === 'media' && isDarkOnlyMedia(rest);
  const always = name === 'media' && !dark && isAlwaysOnScreen(rest);
  const known = CONDITIONAL_AT_RULES.has(name);
  const inner = enter(ctx, { conditional: ctx.conditional || !always || !known, darkMode: ctx.darkMode || dark });
  if (selectors === null) parseRuleList(sheet, css, start, end, inner);
  else parseBlock(sheet, css, start, end, inner, selectors);
}

/** Hosts whose style sheets only declare web fonts (they cannot hide text): a link to them is skipped, never fetched. */
export const FONT_STYLESHEET_HOSTS: ReadonlySet<string> = new Set(['fonts.googleapis.com', 'fonts.bunny.net', 'use.typekit.net']);

/** Percent-decodes to bytes (a "%" without two hex digits stays as it is). */
function percentDecode(text: string): Buffer {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; ) {
    if (text.charAt(i) === '%' && /^[0-9a-fA-F]{2}$/.test(text.slice(i + 1, i + 3))) {
      bytes.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 3;
      continue;
    }
    const cp = text.codePointAt(i) ?? 0;
    const char = String.fromCodePoint(cp);
    for (const byte of Buffer.from(char, 'utf8')) bytes.push(byte);
    i += char.length;
  }
  return Buffer.from(bytes);
}

/** The text of a data: URL (base64 or percent-encoded), whatever media type it names (fail closed). */
function dataUrlText(url: string): string {
  const comma = url.indexOf(',');
  if (comma === -1) throw new HtmlLimitError('external_css');
  const meta = url.slice(5, comma).toLowerCase();
  const body = percentDecode(url.slice(comma + 1));
  if (/;\s*base64\s*$/.test(meta)) return Buffer.from(body.toString('latin1').replace(/[\t\n\f\r ]/g, ''), 'base64').toString('utf8');
  return body.toString('utf8');
}

/**
 * The CSS behind a linked or imported style sheet, without fetching anything (review S3): a data:
 * URL is decoded and read like a <style> block; a font host's sheet (FONT_STYLESHEET_HOSTS) is
 * null (skipped); any other URL throws HtmlLimitError('external_css'), because a client that
 * loads it could hide text this module never sees.
 */
export function stylesheetFromUrl(href: string): string | null {
  const url = href.replace(/[\t\n\r]/g, '').trim();
  if (url === '') return null;
  if (/^data:/i.test(url)) return dataUrlText(url);
  let parsed: URL;
  try {
    parsed = new URL(url, 'https://relative.invalid/');
  } catch {
    throw new HtmlLimitError('external_css');
  }
  if ((parsed.protocol === 'https:' || parsed.protocol === 'http:') && FONT_STYLESHEET_HOSTS.has(parsed.hostname.toLowerCase())) return null;
  throw new HtmlLimitError('external_css');
}

const IMPORT_URL_RE =
  /^\s*(?:url\(\s*(?:"((?:[^"\\\n]|\\[\s\S])*)"|'((?:[^'\\\n]|\\[\s\S])*)'|((?:[^)\\\s"']|\\[\s\S])*))\s*\)|"((?:[^"\\\n]|\\[\s\S])*)"|'((?:[^'\\\n]|\\[\s\S])*)')/i;

/** An @import: a data: sheet is read in place (under its conditions); see stylesheetFromUrl for the rest. */
function importSheet(sheet: SheetContext, rest: string, ctx: BlockContext): void {
  const m = IMPORT_URL_RE.exec(rest);
  if (!m) {
    // "@import;" loads nothing; anything else that names no URL here fails closed.
    if (rest.trim() === '') return;
    throw new HtmlLimitError('external_css');
  }
  const css = stylesheetFromUrl(unescapeCss(m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? ''));
  if (css === null) return;
  sheet.imports += 1;
  sheet.importedChars += css.length;
  if (sheet.imports > STYLE_LIMITS.maxImports || sheet.importedChars > STYLE_LIMITS.maxImportedChars) throw new HtmlLimitError('too_complex');
  const conditions = rest.slice(m[0].length).trim();
  const dark = conditions !== '' && isDarkOnlyMedia(conditions);
  const conditional = conditions !== '' && !isAlwaysOnScreen(conditions);
  const text = stripCssComments(css);
  parseRuleList(sheet, text, 0, text.length, enter(ctx, { conditional: ctx.conditional || conditional || dark, darkMode: ctx.darkMode || dark }));
}

/** A rule list: style rules and at-rules (the top level of a style block, or inside @media). */
function parseRuleList(sheet: SheetContext, css: string, start: number, end: number, ctx: BlockContext): void {
  let i = start;
  while (i < end) {
    const c = css.charCodeAt(i);
    if (isWs(c) || c === 0x7d || c === 0x3b) {
      i += 1;
      continue;
    }
    if (css.startsWith('<!--', i)) {
      i += 4;
      continue;
    }
    if (css.startsWith('-->', i)) {
      i += 3;
      continue;
    }
    if (c === 0x40) {
      const stop = scanTo(css, i, end, '{;');
      if (stop >= end || css.charCodeAt(stop) === 0x3b) {
        // A statement at-rule (@import, @charset, @namespace, @layer a, b;), also one the end cuts
        // short: only @import can bring rules in (review S3).
        const { name, rest } = atRuleName(css.slice(i + 1, stop));
        if (name === 'import') importSheet(sheet, rest, ctx);
        if (stop >= end) return;
        i = stop + 1;
        continue;
      }
      const close = blockEnd(css, stop, end);
      handleAtRule(sheet, css.slice(i + 1, stop), css, stop + 1, close, ctx, null);
      i = close + 1;
      continue;
    }
    const open = scanTo(css, i, end, '{');
    if (open >= end) return;
    const close = blockEnd(css, open, end);
    parseBlock(sheet, css, open + 1, close, enter(ctx), parseSelectorList(css.slice(i, open)));
    i = close + 1;
  }
}

/** A declaration block, with nested rules and nested conditional at-rules (CSS nesting). */
function parseBlock(sheet: SheetContext, css: string, start: number, end: number, ctx: BlockContext, selectors: SelectorList): void {
  const declarations: Declaration[] = [];
  let i = start;
  while (i < end) {
    const stop = scanTo(css, i, end, ';{');
    if (stop < end && css.charCodeAt(stop) === 0x7b) {
      const prelude = css.slice(i, stop).trim();
      const close = blockEnd(css, stop, end);
      if (prelude.startsWith('@')) handleAtRule(sheet, prelude.slice(1), css, stop + 1, close, ctx, selectors);
      else if (prelude !== '') parseBlock(sheet, css, stop + 1, close, enter(ctx), parseSelectorList(prelude, true));
      i = close + 1;
      continue;
    }
    const declaration = parseDeclaration(css.slice(i, stop));
    if (declaration) declarations.push(declaration);
    i = stop + 1;
  }
  addRule(sheet, selectors, declarations, ctx);
}

/**
 * Parses the CSS of every style source (<style> blocks and data: style sheets), in document order.
 * Throws HtmlLimitError: too_complex past STYLE_LIMITS (selectors kept, nesting, imports),
 * external_css for an @import this module cannot read (stylesheetFromUrl).
 */
export function parseStyleSheets(texts: readonly string[]): StyleSheet {
  const sheet: SheetContext = { rules: [], keyframes: new Set(), selectorCount: 0, order: 0, imports: 0, importedChars: 0 };
  for (const text of texts) {
    const css = stripCssComments(text);
    parseRuleList(sheet, css, 0, css.length, { conditional: false, darkMode: false, depth: 0 });
  }
  for (const rule of sheet.rules) {
    if (!rule.hides && rule.summary.animationNames.some((name) => sheet.keyframes.has(name))) rule.hides = true;
  }
  return { rules: sheet.rules, hidingKeyframes: sheet.keyframes };
}

/** Whether an inline style hides its element (an animation counts when its @keyframes hide). */
export function inlineHides(summary: DeclSummary, sheet: StyleSheet): boolean {
  return summary.hides || summary.animationNames.some((name) => sheet.hidingKeyframes.has(name));
}

// ---------------------------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------------------------

/** The slice of an element that selectors see. */
export interface StyleNode {
  /** Lowercased tag name. */
  tag: string;
  /** The id as written and lowercased; null when absent or empty. */
  id: string | null;
  idLower: string | null;
  /** Class names as written, and lowercased. */
  classes: ReadonlySet<string>;
  classesLower: ReadonlySet<string>;
  /** Attribute values by lowercased name. */
  attrs: ReadonlyMap<string, string>;
  parent: StyleNode | null;
}

export interface MatchedRule {
  rule: StyleRule;
  /** A definite selector matched case-exactly: the rule applies in every light rendering. */
  definite: boolean;
  /** The highest specificity among the selectors that matched this way (an upper bound when not definite). */
  specificity: number;
  /** Some selector that matched this way can hide the element (not only ::first-line or ::first-letter). */
  canHide: boolean;
}

/** No match; a match that may hold (relaxed, attribute, case-folded, conditional); a definite match. */
type MatchState = 0 | 1 | 2;
const NO_MATCH: MatchState = 0;
const POSSIBLE: MatchState = 1;
const DEFINITE: MatchState = 2;

interface IndexedSelector {
  rule: StyleRule;
  selector: Selector;
  /** Memo per compound index (all but the subject): the match state from that compound leftward. */
  memo: Map<StyleNode, MatchState>[];
  /** Memo per combinator index: the best state of compound j leftward over the key and its ancestors. */
  ancestorMemo: Map<StyleNode, MatchState>[];
}

function attrMatches(test: AttrTest, attrs: ReadonlyMap<string, string>): boolean {
  const actual = attrs.get(test.name);
  if (actual === undefined) return false;
  if (test.op === '') return true;
  const a = actual.toLowerCase();
  const v = test.value.toLowerCase();
  switch (test.op) {
    case '=':
      return a === v;
    case '~=':
      return v !== '' && !/\s/.test(v) && a.split(/[ \t\n\f\r]+/).includes(v);
    case '|=':
      return a === v || a.startsWith(`${v}-`);
    case '^=':
      return v !== '' && a.startsWith(v);
    case '$=':
      return v !== '' && a.endsWith(v);
    case '*=':
      return v !== '' && a.includes(v);
    default:
      return false;
  }
}

/** Right-to-left selector matching over a StyleNode tree, memoized, with a step budget. */
export class StyleMatcher {
  private readonly byId = new Map<string, IndexedSelector[]>();
  private readonly byClass = new Map<string, IndexedSelector[]>();
  private readonly byTag = new Map<string, IndexedSelector[]>();
  private readonly any: IndexedSelector[] = [];
  private steps = 0;
  private memoEntries = 0;

  constructor(sheet: StyleSheet) {
    for (const rule of sheet.rules) {
      for (const selector of rule.selectors) {
        const entry: IndexedSelector = { rule, selector, memo: [], ancestorMemo: [] };
        if (selector.kind === 'names') {
          this.any.push(entry);
          continue;
        }
        const subject = selector.compounds[selector.compounds.length - 1];
        if (subject === undefined) continue;
        const add = (map: Map<string, IndexedSelector[]>, key: string): void => {
          const list = map.get(key);
          if (list) list.push(entry);
          else map.set(key, [entry]);
        };
        const firstId = subject.ids[0];
        const firstClass = subject.classes[0];
        if (firstId !== undefined) add(this.byId, firstId.lower);
        else if (firstClass !== undefined) add(this.byClass, firstClass.lower);
        else if (subject.tag !== null) add(this.byTag, subject.tag);
        else this.any.push(entry);
      }
    }
  }

  /** Every rule with a selector that matches `node`: at most one definite and one possible entry per rule. */
  match(node: StyleNode): MatchedRule[] {
    const found = new Map<StyleRule, { definite?: MatchedRule; possible?: MatchedRule }>();
    const consider = (entries: readonly IndexedSelector[] | undefined): void => {
      if (!entries) return;
      for (const entry of entries) {
        const state = this.state(entry, node);
        if (state === NO_MATCH) continue;
        const definite = state === DEFINITE;
        const selector = entry.selector;
        const canHide = selector.kind === 'names' || selector.canHide;
        let slot = found.get(entry.rule);
        if (slot === undefined) {
          slot = {};
          found.set(entry.rule, slot);
        }
        const prior = definite ? slot.definite : slot.possible;
        if (prior === undefined) {
          const matched: MatchedRule = { rule: entry.rule, definite, specificity: selector.specificity, canHide };
          if (definite) slot.definite = matched;
          else slot.possible = matched;
        } else {
          prior.specificity = Math.max(prior.specificity, selector.specificity);
          prior.canHide ||= canHide;
        }
      }
    };
    consider(this.any);
    consider(this.byTag.get(node.tag));
    if (node.idLower !== null) consider(this.byId.get(node.idLower));
    for (const cls of node.classesLower) consider(this.byClass.get(cls));
    const out: MatchedRule[] = [];
    for (const slot of found.values()) {
      if (slot.definite) out.push(slot.definite);
      if (slot.possible && (slot.definite === undefined || slot.possible.specificity > slot.definite.specificity)) out.push(slot.possible);
    }
    return out;
  }

  private step(): void {
    this.steps += 1;
    if (this.steps > STYLE_LIMITS.maxMatchSteps) throw new HtmlLimitError('too_complex');
  }

  private remember(memo: Map<StyleNode, MatchState>, node: StyleNode, value: MatchState): void {
    if (this.memoEntries >= STYLE_LIMITS.maxMemoEntries) return;
    this.memoEntries += 1;
    memo.set(node, value);
  }

  private state(entry: IndexedSelector, node: StyleNode): MatchState {
    const selector = entry.selector;
    if (selector.kind === 'names') {
      this.step();
      const hit =
        (node.idLower !== null && selector.ids.includes(node.idLower)) || selector.classes.some((c) => node.classesLower.has(c)) || selector.tags.includes(node.tag);
      return hit ? POSSIBLE : NO_MATCH;
    }
    const state = this.matchFrom(entry, selector.compounds.length - 1, node);
    return state === DEFINITE && !selector.definite ? POSSIBLE : state;
  }

  /** DEFINITE when every name matches as written, POSSIBLE when only case folding or an attribute test makes it match. */
  private compoundState(compound: Compound, node: StyleNode): MatchState {
    this.step();
    if (compound.tag !== null && compound.tag !== node.tag) return NO_MATCH;
    let exact = true;
    for (const id of compound.ids) {
      if (node.idLower !== id.lower) return NO_MATCH;
      if (node.id !== id.raw) exact = false;
    }
    for (const cls of compound.classes) {
      if (!node.classesLower.has(cls.lower)) return NO_MATCH;
      if (!node.classes.has(cls.raw)) exact = false;
    }
    for (const test of compound.attrs) {
      if (!attrMatches(test, node.attrs)) return NO_MATCH;
      exact = false;
    }
    for (const group of compound.anyOf) {
      if (!group.some((alternative) => this.compoundState(alternative, node) !== NO_MATCH)) return NO_MATCH;
      exact = false;
    }
    return exact ? DEFINITE : POSSIBLE;
  }

  /** The state of compound `i` at `node` with the compounds left of it matched against its ancestors. */
  private matchFrom(entry: IndexedSelector, i: number, node: StyleNode): MatchState {
    const selector = entry.selector;
    if (selector.kind !== 'complex') return NO_MATCH;
    const subjectIndex = selector.compounds.length - 1;
    let memo: Map<StyleNode, MatchState> | undefined;
    if (i < subjectIndex) {
      memo = entry.memo[i] ?? (entry.memo[i] = new Map());
      const known = memo.get(node);
      if (known !== undefined) return known;
    }
    const compound = selector.compounds[i];
    let result: MatchState = compound === undefined ? NO_MATCH : this.compoundState(compound, node);
    if (result !== NO_MATCH && i > 0) {
      const link = selector.combinators[i - 1];
      const left = link === '>' ? (node.parent === null ? NO_MATCH : this.matchFrom(entry, i - 1, node.parent)) : this.ancestorState(entry, i - 1, node.parent);
      result = Math.min(result, left) as MatchState;
    }
    if (memo !== undefined) this.remember(memo, node, result);
    return result;
  }

  /** The best state of compound `j` leftward over `start` and its ancestors (memoized per node). */
  private ancestorState(entry: IndexedSelector, j: number, start: StyleNode | null): MatchState {
    const memo = entry.ancestorMemo[j] ?? (entry.ancestorMemo[j] = new Map());
    const visited: StyleNode[] = [];
    const own: MatchState[] = [];
    let above: MatchState = NO_MATCH;
    for (let node = start; node !== null; node = node.parent) {
      const known = memo.get(node);
      if (known !== undefined) {
        above = known;
        break;
      }
      const state = this.matchFrom(entry, j, node);
      visited.push(node);
      own.push(state);
      if (state === DEFINITE) break;
    }
    // Each visited node's value is the best of its own state and everything above it.
    let best = above;
    for (let k = visited.length - 1; k >= 0; k--) {
      best = Math.max(best, own[k] ?? NO_MATCH) as MatchState;
      const node = visited[k];
      if (node !== undefined) this.remember(memo, node, best);
    }
    return best;
  }
}
