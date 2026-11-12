/**
 * M10 text sanitization and forward-wrapper stripping (docs/v2/M10-DESIGN.md section 4 step 12 and
 * section 8). PURE: no Firebase imports, unit-tested standalone (test/unit/summariesSections.test.ts).
 *
 * Order of use in the inbound pipeline:
 *   1. sanitizeText(plain text part)                 -> { text, truncated }
 *   2. stripForwardWrapper(sanitized.text)           -> inner text + the wrapper's From and Date
 *   3. parseSections(inner.text) and extractSummaryMeta(inner.text, subject) in sections.ts
 * The string handed to step 3 is the string that is stored as `text`: every section and item offset
 * is an absolute offset into exactly that string.
 *
 * Nothing here logs. Callers must never log the text, the subject, the wrapper's From address or
 * its Date text (they are user content).
 *
 * Product text rule: this file contains only ASCII punctuation. Invisible and typographic characters
 * are written as \u escapes.
 */
import { summaryAddrSpecSchema } from '../shared/aiContract';

/** Hard cap on the stored text (design section 8). */
export const SUMMARY_TEXT_MAX_CHARS = 100_000;

/**
 * CPU guard: input beyond this length is cut before the regex passes run. Raw mail is capped at
 * 5 MiB upstream, so this only bites on pathological input that is mostly invisible characters.
 */
const INPUT_HARD_CAP = 1_000_000;

export interface SanitizedText {
  text: string;
  /** True when the text was cut at SUMMARY_TEXT_MAX_CHARS (or at the input guard). */
  truncated: boolean;
}

/**
 * PLACEHOLDER, NOT BUILT (open decision): HTML-only mail. Design section 8 requires dropping
 * script, style, head and comments, and every element hidden by inline style or by a class or id
 * that a <style> rule hides (display:none, visibility:hidden, opacity:0, font-size under 2px,
 * max-height:0, off-screen positioning, text colored like its background), decided BEFORE the
 * style blocks are removed (red team finding 16). That needs an HTML parser decision (none is
 * installed). Until a converter implementing this port exists, HTML-only mail must be treated as
 * unreadable by the pipeline; it must NOT be converted with a regex tag stripper, because hidden
 * prompt-injection text would survive. The converter's output then goes through sanitizeText.
 */
export type HtmlToTextPort = (html: string) => { text: string; hiddenElementsRemoved: number };

// Line separators other than LF become LF: CRLF, lone CR, vertical tab, form feed, NEL (U+0085),
// LINE SEPARATOR (U+2028) and PARAGRAPH SEPARATOR (U+2029).
const LINE_BREAKS_RE = /\r\n?|[\v\f\u0085\u2028\u2029]/g;

// Lone UTF-16 surrogates (invalid in Firestore strings) become U+FFFD.
const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

// C0 and C1 control characters except TAB (U+0009) and LF (U+000A). CR is already gone.
// eslint-disable-next-line no-control-regex -- matching control characters is the point here.
const CONTROL_RE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

// Invisible characters:
// - \p{Cf} (format): zero-width space, ZWNJ, ZWJ, word joiner, invisible operators, soft hyphen,
//   BOM / ZWNBSP (U+FEFF), bidi marks, embeddings, overrides and isolates (U+061C, U+200E, U+200F,
//   U+202A to U+202E, U+2066 to U+2069), interlinear annotation and the assigned tag characters.
// - U+E0000 to U+E007F: the whole Unicode tag block, including its unassigned code points.
// - Variation selectors (U+FE00 to U+FE0F, U+E0100 to U+E01EF) and Mongolian free variation
//   selectors: they render as nothing and can carry hidden payloads ("variation selector smuggling").
// - Combining grapheme joiner (U+034F) and the Hangul fillers that render blank.
const INVISIBLE_RE =
  /[\p{Cf}\u115F\u1160\u3164\uFFA0\u{E0000}-\u{E007F}]|\p{Variation_Selector}|\u034F/gu;

/**
 * Trailing whitespace is trimmed line by line with trimEnd, not with a /[^\S\n]+$/gm regex: that
 * regex backtracks quadratically on a long run of spaces inside a line (a ReDoS on hostile mail).
 */
function trimLineEnds(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n');
}

/** Cuts at `max` UTF-16 units without splitting a surrogate pair. */
export function sliceSafe(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = max;
  const code = text.charCodeAt(cut - 1);
  if (cut > 0 && code >= 0xd800 && code <= 0xdbff) cut -= 1;
  return text.slice(0, cut);
}

/**
 * Normalizes a plain-text summary for storage and parsing:
 * line breaks to LF, lone surrogates repaired, C0/C1 controls (except tab and LF) removed,
 * zero-width, bidi, BOM, tag, variation-selector and other invisible characters removed, NFKC,
 * trailing whitespace trimmed per line, leading blank lines dropped, runs of blank lines collapsed
 * to one blank line, trailing whitespace dropped, and the result capped at SUMMARY_TEXT_MAX_CHARS.
 * Leading indentation is kept (nested list items depend on it).
 */
export function sanitizeText(input: string): SanitizedText {
  let truncated = false;
  let text = input;
  if (text.length > INPUT_HARD_CAP) {
    text = sliceSafe(text, INPUT_HARD_CAP);
    truncated = true;
  }
  text = trimLineEnds(
    text
      .replace(LINE_BREAKS_RE, '\n')
      .replace(LONE_SURROGATE_RE, '\uFFFD')
      .replace(CONTROL_RE, '')
      .replace(INVISIBLE_RE, '')
      // NFKC after the removals so sequences split by an invisible character compose again.
      .normalize('NFKC'),
  )
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .trimEnd();
  if (text.length > SUMMARY_TEXT_MAX_CHARS) {
    text = sliceSafe(text, SUMMARY_TEXT_MAX_CHARS).trimEnd();
    truncated = true;
  }
  return { text, truncated };
}

/**
 * One-line variant for header values such as the Subject: sanitizeText, then every whitespace run
 * (newlines included) becomes one space, trimmed and capped at `maxChars`.
 */
export function sanitizeLine(input: string | null | undefined, maxChars = 500): string {
  if (typeof input !== 'string' || input.length === 0) return '';
  const { text } = sanitizeText(input.length > maxChars * 4 ? sliceSafe(input, maxChars * 4) : input);
  return sliceSafe(text.replace(/\s+/g, ' ').trim(), maxChars).trim();
}

/** A line of `text`: [start, end) with `end` excluding the LF. */
export interface LineSpan {
  start: number;
  end: number;
}

/** Splits `text` into line spans with absolute offsets (an empty text gives one empty line). */
export function lineSpans(text: string): LineSpan[] {
  const spans: LineSpan[] = [];
  let start = 0;
  for (;;) {
    const nl = text.indexOf('\n', start);
    if (nl === -1) {
      spans.push({ start, end: text.length });
      return spans;
    }
    spans.push({ start, end: nl });
    start = nl + 1;
  }
}

// ---------------------------------------------------------------------------------------------
// Forward wrappers
// ---------------------------------------------------------------------------------------------

/** Which kind of forward header was recognized. */
export type ForwardStyle = 'gmail' | 'apple' | 'outlook';

export interface ForwardWrapper {
  style: ForwardStyle;
  /** The forwarded message's From address (lowercased addr-spec), or null when none is shown. */
  fromAddress: string | null;
  /**
   * The forwarded message's Date / Sent value, verbatim (for example "Fri, Oct 16, 2026 at 3:20 PM"
   * or "viernes, 16 de octubre de 2026 15:20"). It carries NO time zone: it is the forwarding
   * client's local time. parseLocalDateTime in sections.ts reads its wall-clock parts.
   */
  dateText: string | null;
  /** The forwarded message's Subject value, verbatim, or null. */
  subjectText: string | null;
}

export interface ForwardStripResult {
  /** `input.slice(contentStart)`: the notetaker's content, verbatim. Equals `input` without a wrapper. */
  text: string;
  /** Offset of `text` in the input. 0 without a wrapper. */
  contentStart: number;
  /** The innermost wrapper (closest to the original message), or null when none was found. */
  wrapper: ForwardWrapper | null;
  /** How many nested wrappers were stripped (0 when none). */
  depth: number;
}

/** A wrapper is searched for only near the top: within this many lines and characters. */
const WRAPPER_SCAN_LINES = 60;
const WRAPPER_SCAN_CHARS = 8000;
const MAX_WRAPPER_DEPTH = 5;
const MAX_HEADER_BLOCK_LINES = 15;
const MAX_FROM_VALUE_CHARS = 1000;

const GMAIL_MARKER_RE = /^-{3,}[ \t]*(?:forwarded message|mensaje reenviado)[ \t]*-{3,}$/i;
const ORIGINAL_MARKER_RE = /^-{3,}[ \t]*(?:original message|mensaje original)[ \t]*-{3,}$/i;
const APPLE_MARKER_RE = /^(?:begin forwarded message|(?:inicio|comienzo) del mensaje reenviado)[ \t]*:$/i;

// "From: x", "*From:* x", "**De:** x", "Enviado el: x". The longer labels come first.
const HEADER_LINE_RE =
  /^\*{0,2}(enviado el|reply-to|responder a|importance|importancia|subject|asunto|enviado|from|sent|date|fecha|para|bcc|cco|de|to|cc)\*{0,2}[ \t]*:\*{0,2}[ \t]*(.*)$/i;

type HeaderField = 'from' | 'date' | 'subject' | 'other';

function headerField(label: string): HeaderField {
  switch (label.toLowerCase()) {
    case 'from':
    case 'de':
      return 'from';
    case 'sent':
    case 'date':
    case 'enviado':
    case 'enviado el':
    case 'fecha':
      return 'date';
    case 'subject':
    case 'asunto':
      return 'subject';
    default:
      return 'other';
  }
}

/**
 * True when `candidate` parses with the contract's summaryAddrSpecSchema both as written and
 * lowercased: a non-ASCII local part is refused before toLowerCase could fold it into ASCII
 * (KELVIN SIGN lowercases to a plain "k").
 */
function isContractAddrSpec(candidate: string): boolean {
  return summaryAddrSpecSchema.safeParse(candidate).success && summaryAddrSpecSchema.safeParse(candidate.toLowerCase()).success;
}

/**
 * Pulls the addr-spec out of a From value: "Name <a@b.c>", "Name [mailto:a@b.c]" or a bare
 * "a@b.c". Exactly one part is read, never a substring of something else:
 * - when the value has an angle-bracket part, only that part ("<...>", the first one);
 * - otherwise, when it has a "mailto:", only the address right after it;
 * - otherwise the whole value, which must be one token ("dana.o'neil@acme.example").
 * The part read must parse, or the result is null: '"ceo@acme.example" <x..y@vendor.example>'
 * and "Notes <first last@vendor.example>" give null, never the quoted or trailing address. The
 * result is lowercased and always parses with the contract's summaryAddrSpecSchema (ForwardWrapper
 * fromAddress reaches the app); anything else ("first..last@x", ".lead@x", a local part over 64
 * characters, a non-ASCII local part, a backslash) gives null.
 */
export function addressFromHeaderValue(value: string): string | null {
  // A value this long is no real From line; refusing it also keeps the searches below linear.
  if (value.length > MAX_FROM_VALUE_CHARS) return null;
  const angle = /<([^<>]*)>/.exec(value);
  const mailto = angle ? null : /mailto:([^\s\]<>]*)/i.exec(value);
  const part = angle?.[1] ?? mailto?.[1] ?? value;
  const cleaned = part
    .trim()
    .replace(/^mailto:/i, '')
    .replace(/[.]+$/, '');
  return isContractAddrSpec(cleaned) ? cleaned.toLowerCase() : null;
}

interface HeaderBlock {
  /** Index of the last line of the block. */
  lastLine: number;
  from: string | null;
  date: string | null;
  subject: string | null;
}

function lineText(text: string, span: LineSpan): string {
  return text.slice(span.start, span.end);
}

/** Reads a header block that starts with a From / De line at `first`; null when it does not. */
function readHeaderBlock(text: string, spans: LineSpan[], first: number): HeaderBlock | null {
  const firstSpan = spans[first];
  if (!firstSpan) return null;
  const head = HEADER_LINE_RE.exec(lineText(text, firstSpan).trim());
  if (!head?.[1] || headerField(head[1]) !== 'from') return null;
  const block: HeaderBlock = { lastLine: first, from: null, date: null, subject: null };
  const limit = Math.min(spans.length, first + MAX_HEADER_BLOCK_LINES);
  for (let i = first; i < limit; i++) {
    const span = spans[i];
    if (!span) break;
    const raw = lineText(text, span);
    if (raw.trim() === '') break;
    const m = HEADER_LINE_RE.exec(raw.trim());
    if (m?.[1] !== undefined) {
      const field = headerField(m[1]);
      const value = (m[2] ?? '').trim();
      if (field === 'from' && block.from === null) block.from = value;
      else if (field === 'date' && block.date === null) block.date = value;
      else if (field === 'subject' && block.subject === null) block.subject = value;
      block.lastLine = i;
    } else if (i > first && /^[ \t]+\S/.test(raw)) {
      // A folded continuation of the previous header value (a long To or Cc list).
      block.lastLine = i;
    } else {
      break;
    }
  }
  return block;
}

interface FoundWrapper {
  wrapper: ForwardWrapper;
  contentStart: number;
}

function capOrNull(value: string | null, max: number): string | null {
  if (value === null) return null;
  const v = sliceSafe(value, max).trim();
  return v.length > 0 ? v : null;
}

/** Finds the topmost forward wrapper in `text` starting at offset `from`. */
function findWrapper(text: string, from: number): FoundWrapper | null {
  const scanEnd = Math.min(text.length, from + WRAPPER_SCAN_CHARS);
  const spans = lineSpans(text.slice(from, scanEnd)).map((s) => ({ start: s.start + from, end: s.end + from }));
  // The last span may be a partial line cut by the character window; header lines are short.
  const limit = Math.min(spans.length, WRAPPER_SCAN_LINES);
  for (let i = 0; i < limit; i++) {
    const span = spans[i];
    if (!span) break;
    const trimmed = lineText(text, span).trim();
    if (trimmed === '') continue;
    let style: ForwardStyle | null = null;
    let blockStart = -1;
    let needsDateAndSubject = false;
    if (GMAIL_MARKER_RE.test(trimmed) || ORIGINAL_MARKER_RE.test(trimmed) || APPLE_MARKER_RE.test(trimmed)) {
      style = GMAIL_MARKER_RE.test(trimmed) ? 'gmail' : APPLE_MARKER_RE.test(trimmed) ? 'apple' : 'outlook';
      // The header block follows the marker, after at most two blank lines.
      for (let j = i + 1; j < Math.min(spans.length, i + 4); j++) {
        const s = spans[j];
        if (s && lineText(text, s).trim() !== '') {
          blockStart = j;
          break;
        }
      }
    } else if (HEADER_LINE_RE.test(trimmed)) {
      style = 'outlook';
      blockStart = i;
      needsDateAndSubject = true;
    }
    if (style === null || blockStart < 0) continue;
    const block = readHeaderBlock(text, spans, blockStart);
    if (!block || block.from === null) continue;
    const complete = needsDateAndSubject
      ? block.date !== null && block.subject !== null
      : block.date !== null || block.subject !== null;
    if (!complete) continue;
    // Content starts at the first non-blank line after the block (indentation kept).
    const lastSpan = spans[block.lastLine];
    let pos = lastSpan ? lastSpan.end + 1 : text.length;
    while (pos < text.length) {
      const nl = text.indexOf('\n', pos);
      const end = nl === -1 ? text.length : nl;
      if (text.slice(pos, end).trim() !== '') break;
      pos = end + 1;
    }
    const contentStart = Math.min(pos, text.length);
    return {
      wrapper: {
        style,
        fromAddress: addressFromHeaderValue(block.from),
        dateText: capOrNull(block.date, 200),
        subjectText: capOrNull(block.subject, 500),
      },
      contentStart,
    };
  }
  return null;
}

/**
 * Recognizes forward wrappers near the top of a sanitized text and returns the content after the
 * innermost one, so sections start at the notetaker's own content. English and Spanish:
 * - Gmail: "---------- Forwarded message ---------" / "---------- Mensaje reenviado ---------"
 *   followed by From/De, Date/Fecha, Subject/Asunto, To/Para lines.
 * - Outlook: a header block "From: / Sent: / To: / Subject:" or "De: / Enviado: / Para: / Asunto:"
 *   (optionally after "-----Original Message-----" / "-----Mensaje original-----" or a rule line).
 *   Without a marker line the block must carry From, a date and a subject, so prose that merely
 *   starts with "From:" is never stripped.
 * - Apple Mail: "Begin forwarded message:" / "Inicio del mensaje reenviado:".
 * Nested forwards are stripped up to 5 levels; the innermost wrapper's From and Date are returned.
 * Text above a wrapper (the forwarder's own note) is dropped from `text`.
 */
export function stripForwardWrapper(input: string): ForwardStripResult {
  let contentStart = 0;
  let wrapper: ForwardWrapper | null = null;
  let depth = 0;
  while (depth < MAX_WRAPPER_DEPTH) {
    const found = findWrapper(input, contentStart);
    if (!found) break;
    wrapper = found.wrapper;
    contentStart = found.contentStart;
    depth += 1;
    if (contentStart >= input.length) break;
  }
  return { text: input.slice(contentStart), contentStart, wrapper, depth };
}
