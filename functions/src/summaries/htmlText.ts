/**
 * M10 HTML-to-text for HTML-only summary mail (docs/v2/M10-DESIGN.md section 8, red-team finding
 * 16): implements sanitize.ts HtmlToTextPort on parse5 7.3.0 (pinned exact; its CommonJS build).
 * PURE apart from parse5: no Firebase imports, no logging, nothing is fetched (an image or a font is
 * never loaded; a linked or imported style sheet is read only from a data: URL, a web-font host's
 * is skipped, and any other refuses the document as external_css). Only the inbound pipeline
 * imports it (./inbound.ts, itself
 * required lazily by ./inboundFunction.ts), so parse5 never loads with the functions entry point
 * (test/unit/summariesHtmlText.test.ts checks it).
 *
 * Steps:
 * 1. Limits, all fail closed (the document is refused, never converted in part): an input over
 *    HTML_TEXT_LIMITS.maxInputChars is too_large; more than maxElements elements, an open-element
 *    stack deeper than maxDepth, a tag with more than maxAttributes attributes, or the CSS limits
 *    of ./htmlStyle.ts are too_complex. They bound parse5's own super-linear paths (its scope
 *    checks walk the open-element stack, its duplicate-attribute check scans the tag's attributes:
 *    100,000 nested divs, under 500 KB, take over a minute unbounded) and the selector work. The
 *    depth and attribute caps read two parse5 internals (openElements.stackTop and
 *    Tokenizer._leaveAttrName); that is safe because the version is pinned exact and the tests
 *    pin the behavior. If an upgrade changes them, every conversion refuses as parser_shape.
 * 2. parse5 parses with scripting OFF, as a mail client renders: <noscript> content is markup.
 * 3. The CSS of every <style> element and every <link rel=stylesheet> with a data: URL (head or
 *    body, inside <noscript> or SVG, never inside <template>), with the data: sheets they
 *    @import, is parsed by ./htmlStyle.ts BEFORE anything is dropped (finding 16, review S3).
 * 4. One walk in document order. Dropped without counting: head, script, style, template,
 *    noscript, title, meta, link, base, comments, iframe, object, embed, canvas, audio, video,
 *    svg, math, select, option, datalist, meter, progress, img and picture (alt text and gauge
 *    fallback text are not visible text) and the other elements a mail client never renders.
 *    Dropped and counted in hiddenElementsRemoved: every element hidden by its inline style or a
 *    style rule (htmlStyle.ts), by the hidden or popover attribute (aria-hidden is not visual
 *    hiding and is kept), a closed dialog, the content of a closed details, every child of a
 *    declarative shadow host (<template shadowrootmode>: its shadow styles are never read, and
 *    light-DOM children show only through slots); and each element whose own text is invisible
 *    in SOME light rendering: a font size under 2px, opacities multiplying to under 0.1, or a
 *    paint color with a contrast ratio under 1.1 against the background behind it in any of its
 *    possible looks (htmlStyle.ts "Colors": every subset of the rules that only possibly apply).
 *
 * Text output, shaped for sections.ts:
 * - Blocks start and end lines: p, pre, blockquote, figure and hr leave a blank line, a heading a
 *   blank line before and a line break after (so it stands on its own line over its list), and
 *   div, tr, li, dt, dd, section, table and the other blocks a line break. br is a line break.
 *   Inside a list item breaks are single, so an item never splits into paragraphs.
 * - A list item starts its line with "- " ("1. " in an ordered list, its start and value
 *   attributes honored up to 999). A nested list is indented by the marker width, and the item's
 *   later lines are indented to its text column, the shape sections.ts joins into one item. A
 *   checkbox input as an item's first content becomes "[ ] " or "[x] " after the bullet
 *   ("- [x] Book the demo room"); elsewhere it is written as "[ ]" or "[x]".
 * - Cells of one table row are joined with " | ", or with one space after a cell that holds only a
 *   bullet, a number or a checkbox (the Outlook-safe list row "<td>&bull;</td><td>Item</td>"
 *   gives a bullet item). Blank cells (spaces, NBSP, invisible characters) add nothing.
 * - Links keep their visible text only (never the href or a tracking URL); images drop.
 * - Entities are decoded by parse5. Whitespace collapses as in a browser (runs of space, tab and
 *   newline become one space, none at a line start); pre, textarea and white-space pre, pre-wrap
 *   and break-spaces keep it, pre-line keeps the newlines. NBSP is kept (sanitizeText's NFKC
 *   turns it into a space, so an NBSP indent stays an indent).
 * - Output past maxOutputChars is cut and flagged truncated. The caller passes the text through
 *   sanitizeText exactly as a text/plain part (NFKC, control and bidi removal, the caps).
 *
 * The HTML and the text are message content: nothing here logs, and HtmlLimitError carries only
 * its reason code.
 *
 * Product text rule: this file contains only ASCII punctuation; other characters are \u escapes.
 */
import { Parser, defaultTreeAdapter, html as parse5Html, type DefaultTreeAdapterMap, type DefaultTreeAdapterTypes, type TreeAdapter } from 'parse5';

import {
  HtmlLimitError,
  MIN_FONT_PX,
  MIN_OPACITY,
  STYLE_LIMITS,
  StyleMatcher,
  composite,
  contrastRatio,
  inlineHides,
  parseColor,
  parseStyleSheets,
  stylesheetFromUrl,
  summarizeInlineStyle,
  type BgImage,
  type ColorValue,
  type DeclSummary,
  type FontSizeSpec,
  type MatchedRule,
  type Rgba,
  type StyleNode,
  type StyleSheet,
  type Weighted,
  type WhiteSpaceMode,
  type WhiteSpaceValue,
} from './htmlStyle';
import { sliceSafe, type HtmlTextRefusal, type HtmlToTextPort, type HtmlToTextResult } from './sanitize';

type Element = DefaultTreeAdapterTypes.Element;
type ChildNode = DefaultTreeAdapterTypes.ChildNode;
type Document = DefaultTreeAdapterTypes.Document;
type TextNode = DefaultTreeAdapterTypes.TextNode;

export const HTML_TEXT_LIMITS = {
  /** Above the 5 MiB raw message cap (mime.ts), so a real message never reaches it. */
  maxInputChars: 6 * 1024 * 1024,
  /** Elements parse5 creates (implied ones included). A real recap has a few thousand. */
  maxElements: 100_000,
  /** Open elements at once. Deep layout tables nest a few dozen. */
  maxDepth: 256,
  /** Attributes on one tag. */
  maxAttributes: 256,
  /** Characters of converted text (sanitizeText then caps the stored text at 100,000). */
  maxOutputChars: 1_000_000,
  /**
   * Look combinations computed per document (parent looks times possible renderings, each
   * element). A real recap needs about one per element. More is too_complex.
   */
  maxLookSteps: 5_000_000,
} as const;

const HTML_NS = parse5Html.NS.HTML;

// ---------------------------------------------------------------------------------------------
// Parsing with limits
// ---------------------------------------------------------------------------------------------

/** The parse5 internals the limits read (7.3.0). */
interface TokenizerInternals {
  _leaveAttrName?: unknown;
  currentToken?: unknown;
}

interface ParserInternals {
  openElements?: { stackTop?: unknown };
}

/** Refuses a tag once it holds maxAttributes attributes (parse5 checks duplicates by a scan). */
function capAttributes(tokenizer: TokenizerInternals): void {
  const leave = tokenizer._leaveAttrName;
  if (typeof leave !== 'function') throw new HtmlLimitError('parser_shape');
  const original = leave as (this: TokenizerInternals) => void;
  tokenizer._leaveAttrName = function leaveAttrNameCapped(this: TokenizerInternals): void {
    const attrs = (this.currentToken as { attrs?: unknown } | null | undefined)?.attrs;
    if (!Array.isArray(attrs)) throw new HtmlLimitError('parser_shape');
    if (attrs.length >= HTML_TEXT_LIMITS.maxAttributes) throw new HtmlLimitError('too_complex');
    original.call(this);
  };
}

function parseDocument(html: string): Document {
  let elements = 0;
  let internals: ParserInternals | null = null;
  const adapter: TreeAdapter<DefaultTreeAdapterMap> = {
    ...defaultTreeAdapter,
    createElement(tagName, namespaceURI, attrs) {
      elements += 1;
      if (elements > HTML_TEXT_LIMITS.maxElements) throw new HtmlLimitError('too_complex');
      if (internals !== null) {
        const top = internals.openElements?.stackTop;
        if (typeof top !== 'number') throw new HtmlLimitError('parser_shape');
        if (top + 1 >= HTML_TEXT_LIMITS.maxDepth) throw new HtmlLimitError('too_complex');
      }
      return defaultTreeAdapter.createElement(tagName, namespaceURI, attrs);
    },
  };
  const parser = new Parser<DefaultTreeAdapterMap>({ treeAdapter: adapter, scriptingEnabled: false });
  internals = parser as unknown as ParserInternals;
  capAttributes(parser.tokenizer as unknown as TokenizerInternals);
  parser.tokenizer.write(html, true);
  return parser.document;
}

function isElement(node: ChildNode): node is Element {
  return 'tagName' in node;
}

function isText(node: ChildNode): node is TextNode {
  return node.nodeName === '#text' && 'value' in node;
}

function attr(el: Element, name: string): string | null {
  for (const a of el.attrs) if (a.name === name) return a.value;
  return null;
}

/** A <link> whose rel names a style sheet (alternate ones included: fail closed). */
function isStylesheetLink(el: Element): boolean {
  if (el.tagName !== 'link' || el.namespaceURI !== HTML_NS) return false;
  return (attr(el, 'rel') ?? '').toLowerCase().split(CLASS_SPLIT_RE).includes('stylesheet');
}

/**
 * The CSS of every <style> element and every linked style sheet, in document order (template
 * content is never walked). A linked sheet is never fetched (review S3): a data: URL is decoded
 * and read like a <style> block, a web-font host's sheet is skipped, and any other link refuses
 * the document (HtmlLimitError external_css, htmlStyle.ts stylesheetFromUrl).
 */
function collectStyleTexts(document: Document): string[] {
  const texts: string[] = [];
  let linked = 0;
  let linkedChars = 0;
  const stack: ChildNode[] = [];
  for (let i = document.childNodes.length - 1; i >= 0; i--) {
    const child = document.childNodes[i];
    if (child) stack.push(child);
  }
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (!isElement(node)) continue;
    if (node.tagName === 'style') {
      texts.push(node.childNodes.map((child) => (isText(child) ? child.value : '')).join(''));
      continue;
    }
    if (isStylesheetLink(node)) {
      const css = stylesheetFromUrl(attr(node, 'href') ?? '');
      if (css !== null) {
        linked += 1;
        linkedChars += css.length;
        if (linked > STYLE_LIMITS.maxImports || linkedChars > STYLE_LIMITS.maxImportedChars) throw new HtmlLimitError('too_complex');
        texts.push(css);
      }
      continue;
    }
    for (let i = node.childNodes.length - 1; i >= 0; i--) {
      const child = node.childNodes[i];
      if (child) stack.push(child);
    }
  }
  return texts;
}

// ---------------------------------------------------------------------------------------------
// Text output
// ---------------------------------------------------------------------------------------------

const COLLAPSIBLE_RE = /[ \t\n\r\f]+/g;
/** Renders as nothing or as space only: whitespace (NBSP included) and format characters. */
const BLANK_RE = /^[\s\p{Cf}]*$/u;
const MARK = String.raw`(?:[-*+\u00B7\u2013\u2014\u2022\u2023\u2043\u2219\u25AA\u25AB\u25CF\u25E6\uF0B7\u2610-\u2612\u2713\u2714]|\d{1,3}[.)]|\[[ xX\u2713\u2714]?\])`;
/** A line that so far holds only list markers ("\u2022", "1.", "[ ]", a ballot box). */
const MARKER_ONLY_RE = new RegExp(`^${MARK}(?:\\s+${MARK})*$`, 'u');
const LINE_HEAD_CHARS = 32;

/** Builds the text: lazy line breaks, collapsed spaces, list markers and indents, cell joins. */
class TextOut {
  private readonly parts: string[] = [];
  private size = 0;
  private started = false;
  private trailingNewlines = 0;
  private lineHasText = false;
  private lineHead = '';
  private lineChars = 0;
  private pendingBreaks = 0;
  private pendingSpace = false;
  private pendingSeparator: string | null = null;
  /** Indent of continuation lines (the open list items' text columns). */
  private indent = '';
  /** The open list item's first-line prefix, until its first text. */
  private marker: string | null = null;
  private markerHasBox = false;
  private itemDepth = 0;
  truncated = false;
  full = false;

  result(): string {
    return this.parts.join('');
  }

  private write(s: string): void {
    if (this.full || s.length === 0) return;
    const room = HTML_TEXT_LIMITS.maxOutputChars - this.size;
    if (s.length > room) {
      this.parts.push(sliceSafe(s, room));
      this.size = HTML_TEXT_LIMITS.maxOutputChars;
      this.truncated = true;
      this.full = true;
      return;
    }
    this.parts.push(s);
    this.size += s.length;
  }

  private track(s: string): void {
    if (this.lineChars < LINE_HEAD_CHARS) this.lineHead += s.slice(0, LINE_HEAD_CHARS - this.lineChars);
    this.lineChars += s.length;
  }

  private resetLine(): void {
    this.lineHasText = false;
    this.pendingSpace = false;
    this.pendingSeparator = null;
    this.lineHead = '';
    this.lineChars = 0;
  }

  /** At least `n` line breaks (2: a blank line) before the next text. Absorbed by an item's pending marker. */
  requestBreaks(n: number): void {
    if (this.marker !== null) return;
    const wanted = this.itemDepth > 0 ? Math.min(n, 1) : n;
    if (wanted > this.pendingBreaks) this.pendingBreaks = wanted;
  }

  private flushBreaks(): void {
    if (this.pendingBreaks === 0) return;
    if (this.started) {
      for (let n = this.trailingNewlines; n < this.pendingBreaks; n++) this.write('\n');
      this.trailingNewlines = Math.max(this.trailingNewlines, this.pendingBreaks);
    }
    this.pendingBreaks = 0;
    this.resetLine();
  }

  /** <br>, or a newline kept by pre. */
  lineBreak(): void {
    this.flushBreaks();
    this.write('\n');
    this.trailingNewlines += 1;
    this.started = true;
    this.resetLine();
  }

  private emit(run: string): void {
    if (run.length === 0) return;
    this.flushBreaks();
    if (!this.lineHasText) {
      this.write(this.marker ?? this.indent);
      this.marker = null;
      this.markerHasBox = false;
    } else if (this.pendingSeparator !== null) {
      this.write(this.pendingSeparator);
      this.track(this.pendingSeparator);
    } else if (this.pendingSpace) {
      this.write(' ');
      this.track(' ');
    }
    this.pendingSpace = false;
    this.pendingSeparator = null;
    this.write(run);
    this.track(run);
    this.lineHasText = true;
    this.trailingNewlines = 0;
    this.started = true;
  }

  /** A text node's value in the given white-space mode. */
  text(value: string, mode: WhiteSpaceMode): void {
    if (mode === 'normal') {
      this.collapsed(value.replace(COLLAPSIBLE_RE, ' '));
      return;
    }
    const lines = value.split('\n');
    lines.forEach((line, index) => {
      if (index > 0) this.lineBreak();
      if (mode === 'pre-line') this.collapsed(line.replace(/[ \t\r\f]+/g, ' '));
      else this.emit(line);
    });
  }

  private collapsed(run: string): void {
    if (BLANK_RE.test(run)) {
      if (run.length > 0 && this.lineHasText) this.pendingSpace = true;
      return;
    }
    let start = 0;
    let end = run.length;
    if (run.charCodeAt(0) === 0x20) {
      start = 1;
      if (this.lineHasText) this.pendingSpace = true;
    }
    const trailing = end > start && run.charCodeAt(end - 1) === 0x20;
    if (trailing) end -= 1;
    this.emit(run.slice(start, end));
    if (trailing) this.pendingSpace = true;
  }

  /** A checkbox input: on an item's marker before its first text, else inline. */
  checkbox(checked: boolean): void {
    const box = checked ? '[x]' : '[ ]';
    if (this.marker !== null) {
      if (!this.markerHasBox) {
        this.marker += `${box} `;
        this.markerHasBox = true;
      }
      return;
    }
    this.emit(box);
    this.pendingSpace = true;
  }

  /** Opens a list item; returns the indent to restore at its end. */
  beginItem(bullet: string): string {
    const previous = this.indent;
    this.requestBreaks(1);
    this.marker = previous + bullet;
    this.markerHasBox = false;
    this.indent = previous + ' '.repeat(bullet.length);
    this.itemDepth += 1;
    return previous;
  }

  endItem(previousIndent: string): void {
    this.marker = null;
    this.markerHasBox = false;
    this.indent = previousIndent;
    this.itemDepth = Math.max(0, this.itemDepth - 1);
    this.requestBreaks(1);
  }

  /** A table cell: joined to the row's text so far with " | " (one space after a marker-only cell). */
  cellStart(): void {
    if (!this.lineHasText || this.pendingBreaks > 0) return;
    this.pendingSeparator = this.lineChars <= LINE_HEAD_CHARS && MARKER_ONLY_RE.test(this.lineHead.trim()) ? ' ' : ' | ';
  }
}

// ---------------------------------------------------------------------------------------------
// Computed style
// ---------------------------------------------------------------------------------------------

type ColorState = Rgba | 'unknown';

/** One way the element's text can look in some light rendering. */
interface Look {
  color: ColorState;
  /** -webkit-text-fill-color when set; null paints with color. */
  fill: ColorState | null;
  /** The opaque background behind this element's text. */
  background: ColorState;
}

interface Computed {
  /** The smallest font size this element's own text can have. */
  fontPx: number;
  /**
   * Every look the text can have (htmlStyle.ts "Colors"): one per combination of the rules that
   * only possibly apply, times the parent's looks, times the colors a background gradient shows.
   * At most MAX_LOOKS; more collapse to one unknown look (the text is then dropped).
   */
  looks: readonly Look[];
  /** The product of the element's and its ancestors' opacities. */
  opacity: number;
  whiteSpace: WhiteSpaceMode;
}

/** Looks kept per element (beyond: unknown, fail closed). */
const MAX_LOOKS = 64;
/** Possible rules per element combined as subsets up to this many; beyond, every winner combines freely (a superset). */
const MAX_SCENARIO_RULES = 6;
const UNKNOWN_LOOK: Look = { color: 'unknown', fill: null, background: 'unknown' };

interface Frame {
  computed: Computed;
  style: StyleNode | null;
  textHidden: boolean;
  textCounted: boolean;
}

const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };
/** The canvas of every mail client in its default (light) rendering. */
const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };
const ROOT: Computed = { fontPx: 16, looks: [{ color: BLACK, fill: null, background: WHITE }], opacity: 1, whiteSpace: 'normal' };
/** Paint color against its background below this contrast ratio is invisible (equal colors give 1). */
export const MIN_TEXT_CONTRAST = 1.1;

interface Candidate<T> {
  value: T;
  important: boolean;
  inline: boolean;
  specificity: number;
  order: number;
}

function beats<T>(a: Candidate<T>, b: Candidate<T>): boolean {
  if (a.important !== b.important) return a.important;
  if (a.inline !== b.inline) return a.inline;
  if (a.specificity !== b.specificity) return a.specificity > b.specificity;
  return a.order > b.order;
}

/** The DEFINITE cascaded value of one property (white-space): the inline style, definite rules outside dark mode, a hint. */
function cascade<T>(inline: Weighted<T> | null, matched: readonly MatchedRule[], pick: (summary: DeclSummary) => Weighted<T> | null, hint: T | null): T | undefined {
  let best: Candidate<T> | null = hint === null ? null : { value: hint, important: false, inline: false, specificity: -1, order: -1 };
  if (inline !== null) {
    const candidate = { value: inline.value, important: inline.important, inline: true, specificity: 0, order: 0 };
    if (best === null || beats(candidate, best)) best = candidate;
  }
  for (const m of matched) {
    if (!m.definite || m.rule.darkMode) continue;
    const declared = pick(m.rule.summary);
    if (declared === null) continue;
    const candidate = { value: declared.value, important: declared.important, inline: false, specificity: m.specificity, order: m.rule.order };
    if (best === null || beats(candidate, best)) best = candidate;
  }
  return best?.value;
}

/** The cascaded color properties of one rendering (undefined: not declared, so inherited or initial). */
interface Declared {
  color: ColorValue | undefined;
  fill: ColorValue | undefined;
  background: ColorValue | undefined;
  backgroundImage: BgImage | undefined;
}

type ColorProp = keyof Declared;
const COLOR_PROPS: readonly ColorProp[] = ['color', 'fill', 'background', 'backgroundImage'];
type Candidates = { [P in ColorProp]: Candidate<Declared[P]> | null };

function candidatesOf(summary: DeclSummary, inline: boolean, specificity: number, order: number): Candidates {
  const of = <T>(declared: Weighted<T> | null): Candidate<T> | null =>
    declared === null ? null : { value: declared.value, important: declared.important, inline, specificity, order };
  return { color: of(summary.color), fill: of(summary.fill), background: of(summary.background), backgroundImage: of(summary.backgroundImage) };
}

/** Presentational hints: <font color>, <body text>, bgcolor and the background attribute (an image: unknown). */
interface Hints {
  color: Rgba | null;
  background: Rgba | null;
  backgroundImage: BgImage | null;
}

function pickWinner<T>(current: Candidate<T> | null, challenger: Candidate<T> | null): Candidate<T> | null {
  if (challenger === null) return current;
  return current === null || beats(challenger, current) ? challenger : current;
}

function declaredOf(winners: Candidates): Declared {
  return {
    color: winners.color?.value,
    fill: winners.fill?.value,
    background: winners.background?.value,
    backgroundImage: winners.backgroundImage?.value,
  };
}

/**
 * Every combination of cascaded color properties the element can have (fail closed, review S2
 * and P1). DEFINITE sources (hints, the inline style, definite rules) give one winner per
 * property. Each POSSIBLE rule (relaxed, an attribute test, a case-folded name, a condition, an
 * invalid list) may or may not apply, so every subset of them is a rendering; a possible rule that
 * cannot beat the definite winner of any property it declares changes nothing and is skipped.
 * Dark-mode rules never set colors. Null when the combinations exceed MAX_LOOKS.
 */
function declaredScenarios(inline: DeclSummary | null, matched: readonly MatchedRule[], hints: Hints): Declared[] | null {
  const hint = <T>(value: T | null): Candidate<T> | null => (value === null ? null : { value, important: false, inline: false, specificity: -1, order: -1 });
  let best: Candidates = { color: hint<ColorValue>(hints.color), fill: null, background: hint<ColorValue>(hints.background), backgroundImage: hint(hints.backgroundImage) };
  const fold = (current: Candidates, extra: Candidates): Candidates => ({
    color: pickWinner(current.color, extra.color),
    fill: pickWinner(current.fill, extra.fill),
    background: pickWinner(current.background, extra.background),
    backgroundImage: pickWinner(current.backgroundImage, extra.backgroundImage),
  });
  if (inline !== null) best = fold(best, candidatesOf(inline, true, 0, 0));
  const possible: Candidates[] = [];
  for (const m of matched) {
    if (m.rule.darkMode) continue;
    const candidates = candidatesOf(m.rule.summary, false, m.specificity, m.rule.order);
    if (m.definite) best = fold(best, candidates);
    else possible.push(candidates);
  }
  const beatsBest = (candidates: Candidates): boolean =>
    COLOR_PROPS.some((prop) => {
      const challenger = candidates[prop] as Candidate<unknown> | null;
      const current = best[prop] as Candidate<unknown> | null;
      return challenger !== null && (current === null || beats(challenger, current));
    });
  const relevant = possible.filter(beatsBest);
  if (relevant.length === 0) return [declaredOf(best)];

  const out = new Map<string, Declared>();
  const add = (declared: Declared): boolean => {
    out.set(declaredKey(declared), declared);
    return out.size <= MAX_LOOKS;
  };
  if (relevant.length <= MAX_SCENARIO_RULES) {
    for (let mask = 0; mask < 1 << relevant.length; mask++) {
      let winners = best;
      relevant.forEach((candidates, index) => {
        if ((mask & (1 << index)) !== 0) winners = fold(winners, candidates);
      });
      if (!add(declaredOf(winners))) return null;
    }
    return [...out.values()];
  }
  // Too many to combine as subsets: every distinct value that can win, combined freely (a superset).
  const options = <P extends ColorProp>(prop: P): Declared[P][] => {
    const values = new Map<string, Declared[P]>();
    const keep = (value: Declared[P]): void => {
      values.set(valueKey(value), value);
    };
    keep(best[prop]?.value as Declared[P]);
    for (const candidates of relevant) {
      const challenger = candidates[prop];
      const current = best[prop];
      if (challenger !== null && (current === null || beats(challenger as Candidate<unknown>, current as Candidate<unknown>))) keep(challenger.value as Declared[P]);
    }
    return [...values.values()];
  };
  const colors = options('color');
  const fills = options('fill');
  const backgrounds = options('background');
  const images = options('backgroundImage');
  if (colors.length * fills.length * backgrounds.length * images.length > MAX_LOOKS) return null;
  for (const color of colors)
    for (const fill of fills)
      for (const background of backgrounds)
        for (const backgroundImage of images) {
          if (!add({ color, fill, background, backgroundImage })) return null;
        }
  return [...out.values()];
}

function valueKey(value: ColorValue | BgImage | undefined): string {
  if (value === undefined || typeof value === 'string') return value ?? '-';
  if (Array.isArray(value)) return value.map(colorKey).join('/');
  return colorKey(value as Rgba);
}

function colorKey(value: ColorValue | ColorState | null | undefined): string {
  if (value === undefined) return '-';
  if (value === null) return 'n';
  if (typeof value === 'string') return value;
  return `${Math.round(value.r)},${Math.round(value.g)},${Math.round(value.b)},${value.a.toFixed(3)}`;
}

function declaredKey(d: Declared): string {
  const image = d.backgroundImage === undefined || typeof d.backgroundImage === 'string' ? (d.backgroundImage ?? '-') : d.backgroundImage.map(colorKey).join('/');
  return `${colorKey(d.color)}|${colorKey(d.fill)}|${colorKey(d.background)}|${image}`;
}

function lookKey(look: Look): string {
  return `${colorKey(look.color)}|${colorKey(look.fill)}|${colorKey(look.background)}`;
}

/** The backgrounds behind the text once the element's image layers paint over `base` (review S4). */
function paintedBackgrounds(image: BgImage | undefined, base: ColorState): ColorState[] {
  if (image === undefined || image === 'none') return [base];
  if (image === 'unknown' || base === 'unknown') return ['unknown'];
  return image.map((color) => composite(color, base));
}

/** Look combinations computed in one document (parent looks times renderings times gradient colors). */
interface LookBudget {
  steps: number;
}

/** The looks of an element from its parent's looks and its own possible renderings. */
function looksOf(parent: readonly Look[], scenarios: readonly Declared[] | null, budget: LookBudget): Look[] {
  if (scenarios === null) return [UNKNOWN_LOOK];
  const looks = new Map<string, Look>();
  for (const above of parent) {
    for (const scenario of scenarios) {
      budget.steps += 1;
      if (budget.steps > HTML_TEXT_LIMITS.maxLookSteps) throw new HtmlLimitError('too_complex');
      const color = resolveColor(scenario.color, above.color);
      const fill = resolveFill(scenario.fill, above.fill);
      const base = resolveBackground(scenario.background, color, above.background);
      for (const background of paintedBackgrounds(scenario.backgroundImage, base)) {
        const look: Look = { color, fill, background };
        looks.set(lookKey(look), look);
        if (looks.size > MAX_LOOKS) return [UNKNOWN_LOOK];
      }
    }
  }
  return [...looks.values()];
}

function resolveFont(specs: readonly FontSizeSpec[], parentPx: number): number {
  if (specs.length === 0) return parentPx;
  let min = Number.POSITIVE_INFINITY;
  for (const spec of specs) {
    const px = spec.kind === 'px' ? spec.px : spec.kind === 'parent' ? parentPx * spec.factor : spec.kind === 'root' ? ROOT.fontPx * spec.factor : parentPx;
    if (px < min) min = px;
  }
  return min;
}

function resolveColor(value: ColorValue | undefined, parent: ColorState): ColorState {
  if (value === undefined || value === 'inherit' || value === 'unset' || value === 'currentcolor') return parent;
  if (value === 'initial') return BLACK;
  return value;
}

function resolveFill(value: ColorValue | undefined, parent: ColorState | null): ColorState | null {
  if (value === undefined || value === 'inherit' || value === 'unset') return parent;
  if (value === 'initial' || value === 'currentcolor') return null;
  return value;
}

function resolveBackground(value: ColorValue | undefined, color: ColorState, parent: ColorState): ColorState {
  if (value === undefined || value === 'initial' || value === 'unset' || value === 'inherit') return parent;
  const own = value === 'currentcolor' ? color : value;
  if (own === 'unknown') return 'unknown';
  if (own.a <= 0) return parent;
  if (own.a >= 1) return { ...own, a: 1 };
  return parent === 'unknown' ? 'unknown' : composite(own, parent);
}

function isLookHidden(look: Look, opacity: number): boolean {
  const paint = look.fill ?? look.color;
  if (paint === 'unknown' || look.background === 'unknown') return true;
  const faded = { ...paint, a: paint.a * opacity };
  return contrastRatio(composite(faded, look.background), look.background) < MIN_TEXT_CONTRAST;
}

/** Invisible in SOME light rendering: under 2px, faded under 0.1, or any look colored like its background. */
function isTextHidden(computed: Computed): boolean {
  if (computed.fontPx < MIN_FONT_PX || computed.opacity < MIN_OPACITY) return true;
  return computed.looks.some((look) => isLookHidden(look, computed.opacity));
}

/** A legacy color attribute (bgcolor, font color, body text) as an opaque color, or null. */
function attrColor(el: Element, name: string): Rgba | null {
  const value = attr(el, name);
  if (value === null) return null;
  const color = parseColor(value.trim().toLowerCase(), true);
  return color !== null && typeof color !== 'string' ? color : null;
}

function intAttr(el: Element, name: string): number | null {
  const m = /^\s*([+-]?\d{1,9})/.exec(attr(el, name) ?? '');
  return m?.[1] === undefined ? null : Number(m[1]);
}

// ---------------------------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------------------------

/** Never rendered by a mail client (or never as text): dropped without counting. */
const NOT_RENDERED: ReadonlySet<string> = new Set([
  'head',
  'script',
  'style',
  'template',
  'noscript',
  'title',
  'meta',
  'link',
  'base',
  'basefont',
  'bgsound',
  'iframe',
  'frame',
  'frameset',
  'noframes',
  'noembed',
  'object',
  'embed',
  'applet',
  'param',
  'canvas',
  'audio',
  'video',
  'source',
  'track',
  'img',
  'image',
  'picture',
  'area',
  'select',
  'option',
  'optgroup',
  'datalist',
  'rp',
  'slot',
  // A gauge, never its fallback text (review S3).
  'meter',
  'progress',
]);
const PARAGRAPH_BLOCKS: ReadonlySet<string> = new Set(['p', 'pre', 'listing', 'xmp', 'plaintext', 'blockquote', 'figure']);
const HEADINGS: ReadonlySet<string> = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const LINE_BLOCKS: ReadonlySet<string> = new Set([
  'address',
  'article',
  'aside',
  'body',
  'caption',
  'center',
  'dd',
  'details',
  'dialog',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'footer',
  'form',
  'header',
  'hgroup',
  'html',
  'legend',
  'main',
  'marquee',
  'nav',
  'search',
  'section',
  'summary',
  'table',
  'tbody',
  'textarea',
  'tfoot',
  'thead',
  'tr',
]);
const LISTS: ReadonlySet<string> = new Set(['ul', 'ol', 'menu', 'dir']);
const PRE_TAGS: ReadonlySet<string> = new Set(['pre', 'listing', 'xmp', 'plaintext', 'textarea']);
const SMALLER_TAGS: ReadonlySet<string> = new Set(['small', 'sub', 'sup']);
const BGCOLOR_TAGS: ReadonlySet<string> = new Set(['body', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'marquee']);
const CLASS_SPLIT_RE = /[ \t\n\f\r]+/;

type Task =
  | { kind: 'node'; node: ChildNode; parent: Frame }
  | { kind: 'exit'; tag: string; previousIndent: string };

class Walker {
  readonly out = new TextOut();
  removed = 0;
  private readonly lists: { ordered: boolean; next: number }[] = [];
  private readonly lookBudget: LookBudget = { steps: 0 };

  constructor(
    private readonly sheet: StyleSheet,
    private readonly matcher: StyleMatcher,
  ) {}

  run(document: Document): void {
    const root: Frame = { computed: ROOT, style: null, textHidden: false, textCounted: false };
    const stack: Task[] = [];
    this.pushChildren(stack, document.childNodes, root);
    for (let task = stack.pop(); task !== undefined && !this.out.full; task = stack.pop()) {
      if (task.kind === 'exit') {
        this.exit(task.tag, task.previousIndent);
        continue;
      }
      const node = task.node;
      if (isText(node)) {
        this.text(node.value, task.parent);
        continue;
      }
      if (isElement(node)) this.element(node, task.parent, stack);
    }
  }

  private pushChildren(stack: Task[], children: readonly ChildNode[], parent: Frame): void {
    for (let i = children.length - 1; i >= 0; i--) {
      const node = children[i];
      if (node) stack.push({ kind: 'node', node, parent });
    }
  }

  private text(value: string, parent: Frame): void {
    if (parent.textHidden) {
      if (!parent.textCounted && !BLANK_RE.test(value)) {
        parent.textCounted = true;
        this.removed += 1;
      }
      return;
    }
    this.out.text(value, parent.computed.whiteSpace);
  }

  private hidden(el: Element, tag: string, inline: DeclSummary | null, matched: readonly MatchedRule[]): boolean {
    if (attr(el, 'hidden') !== null) return true;
    // A popover stays hidden until script or a click opens it (UA rule [popover]:not(:popover-open); review S3).
    if (attr(el, 'popover') !== null) return true;
    if (tag === 'dialog' && attr(el, 'open') === null) return true;
    if (inline !== null && inlineHides(inline, this.sheet)) return true;
    let tinyBox = inline?.tinyBox === true;
    let overflowHidden = inline?.overflowHidden === true;
    for (const m of matched) {
      // ::first-line and ::first-letter rules style the text but cannot hide the element (review P4).
      if (!m.canHide) continue;
      if (m.rule.hides) return true;
      tinyBox ||= m.rule.summary.tinyBox;
      overflowHidden ||= m.rule.summary.overflowHidden;
    }
    return tinyBox && overflowHidden;
  }

  private compute(el: Element, tag: string, parent: Computed, inline: DeclSummary | null, matched: readonly MatchedRule[]): Computed {
    // Font size: the union of every declaration (the smallest wins), else the parent's.
    const fontSpecs: FontSizeSpec[] = [...(inline?.fontSizes ?? [])];
    for (const m of matched) fontSpecs.push(...m.rule.summary.fontSizes);
    if (fontSpecs.length === 0 && SMALLER_TAGS.has(tag)) fontSpecs.push({ kind: 'parent', factor: 1 / 1.2 });
    const fontPx = resolveFont(fontSpecs, parent.fontPx);
    // Opacity: the smallest declared (any matching rule), multiplied down the tree.
    let own = inline?.opacity ?? 1;
    for (const m of matched) if (m.canHide && m.rule.summary.opacity !== null) own = Math.min(own, m.rule.summary.opacity);
    const hints: Hints = {
      color: tag === 'font' ? attrColor(el, 'color') : tag === 'body' ? attrColor(el, 'text') : null,
      background: BGCOLOR_TAGS.has(tag) ? attrColor(el, 'bgcolor') : null,
      // A background image attribute paints an image: what it shows is unknown.
      backgroundImage: BGCOLOR_TAGS.has(tag) && (attr(el, 'background') ?? '').trim() !== '' ? 'unknown' : null,
    };
    const looks = looksOf(parent.looks, declaredScenarios(inline, matched, hints), this.lookBudget);
    const declaredSpace: WhiteSpaceValue | undefined = cascade(inline?.whiteSpace ?? null, matched, (s) => s.whiteSpace, null);
    const whiteSpace: WhiteSpaceMode =
      declaredSpace === undefined ? (PRE_TAGS.has(tag) ? 'pre' : parent.whiteSpace) : declaredSpace === 'inherit' ? parent.whiteSpace : declaredSpace;
    return { fontPx, looks, opacity: parent.opacity * own, whiteSpace };
  }

  private element(el: Element, parent: Frame, stack: Task[]): void {
    // SVG and MathML are dropped (their <style> blocks were read in step 3).
    if (el.namespaceURI !== HTML_NS) return;
    const tag = el.tagName;
    if (NOT_RENDERED.has(tag)) return;
    const id = attr(el, 'id');
    const classAttr = attr(el, 'class');
    const classes = classAttr === null ? [] : classAttr.split(CLASS_SPLIT_RE).filter((c) => c !== '');
    const style: StyleNode = {
      tag,
      id: id === null || id === '' ? null : id,
      idLower: id === null || id === '' ? null : id.toLowerCase(),
      classes: new Set(classes),
      classesLower: new Set(classes.map((c) => c.toLowerCase())),
      attrs: new Map(el.attrs.map((a) => [a.name.toLowerCase(), a.value])),
      parent: parent.style,
    };
    const styleAttr = attr(el, 'style');
    const inline = styleAttr === null ? null : summarizeInlineStyle(styleAttr);
    const matched = this.matcher.match(style);
    if (this.hidden(el, tag, inline, matched)) {
      this.removed += 1;
      return;
    }
    const computed = this.compute(el, tag, parent.computed, inline, matched);
    const frame: Frame = { computed, style, textHidden: isTextHidden(computed), textCounted: false };

    switch (tag) {
      case 'br':
        this.out.lineBreak();
        return;
      case 'wbr':
        return;
      case 'hr':
        this.out.requestBreaks(2);
        return;
      case 'input':
        if ((attr(el, 'type') ?? '').trim().toLowerCase() === 'checkbox') this.out.checkbox(attr(el, 'checked') !== null);
        return;
      default:
    }

    let previousIndent = '';
    if (PARAGRAPH_BLOCKS.has(tag) || HEADINGS.has(tag)) {
      this.out.requestBreaks(2);
    } else if (LINE_BLOCKS.has(tag)) {
      this.out.requestBreaks(1);
    } else if (LISTS.has(tag)) {
      this.out.requestBreaks(1);
      const start = tag === 'ol' ? intAttr(el, 'start') : null;
      this.lists.push({ ordered: tag === 'ol', next: start ?? 1 });
    } else if (tag === 'li') {
      const list = this.lists[this.lists.length - 1];
      let bullet = '- ';
      if (list?.ordered === true) {
        const n = intAttr(el, 'value') ?? list.next;
        list.next = n + 1;
        if (n >= 0 && n <= 999) bullet = `${n}. `;
      }
      previousIndent = this.out.beginItem(bullet);
    } else if (tag === 'td' || tag === 'th') {
      this.out.cellStart();
    }
    stack.push({ kind: 'exit', tag, previousIndent });

    let children: readonly ChildNode[] = el.childNodes;
    // A declarative shadow root (review S3): the host renders its shadow tree, whose own styles are
    // never read here, and shows light-DOM children only through slots. Fail closed: nothing of the
    // host is emitted (counted once when it held any content).
    const shadowRoot = children.find(
      (child): child is Element =>
        isElement(child) && child.tagName === 'template' && (attr(child, 'shadowrootmode') !== null || attr(child, 'shadowroot') !== null),
    );
    if (shadowRoot !== undefined) {
      if (children.some((child) => child !== shadowRoot && (isElement(child) || (isText(child) && !BLANK_RE.test(child.value))))) this.removed += 1;
      children = [];
    }
    if (tag === 'details' && attr(el, 'open') === null) {
      // A closed details shows only its first summary.
      const summary = children.find((child): child is Element => isElement(child) && child.tagName === 'summary');
      if (children.some((child) => child !== summary && (isElement(child) || (isText(child) && !BLANK_RE.test(child.value))))) {
        this.removed += 1;
      }
      children = summary === undefined ? [] : [summary];
    }
    this.pushChildren(stack, children, frame);
  }

  private exit(tag: string, previousIndent: string): void {
    if (PARAGRAPH_BLOCKS.has(tag)) this.out.requestBreaks(2);
    else if (HEADINGS.has(tag) || LINE_BLOCKS.has(tag)) this.out.requestBreaks(1);
    else if (LISTS.has(tag)) {
      this.lists.pop();
      this.out.requestBreaks(1);
    } else if (tag === 'li') this.out.endItem(previousIndent);
  }
}

function refused(reason: HtmlTextRefusal): HtmlToTextResult {
  return { text: '', hiddenElementsRemoved: 0, truncated: false, refused: reason };
}

/**
 * Converts one HTML part to its visible text (see the file comment). Never throws: a limit or any
 * other failure returns `refused` with a reason code and no text.
 */
export const htmlToText: HtmlToTextPort = (html: string): HtmlToTextResult => {
  if (typeof html !== 'string' || html.length === 0) return { text: '', hiddenElementsRemoved: 0, truncated: false, refused: null };
  if (html.length > HTML_TEXT_LIMITS.maxInputChars) return refused('too_large');
  try {
    const document = parseDocument(html);
    const sheet = parseStyleSheets(collectStyleTexts(document));
    const walker = new Walker(sheet, new StyleMatcher(sheet));
    walker.run(document);
    return { text: walker.out.result(), hiddenElementsRemoved: walker.removed, truncated: walker.out.truncated, refused: null };
  } catch (error) {
    return refused(error instanceof HtmlLimitError ? error.reason : 'failed');
  }
};
