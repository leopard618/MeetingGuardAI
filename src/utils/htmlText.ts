/**
 * Calendar descriptions that arrive as HTML (an airline or booking invitation through the phone
 * calendar or Google Calendar: "<html><head><meta ...><body><div ...>") shown as plain text.
 * PURE, no DOM (React Native has none).
 *
 * - Only text that looks like HTML is converted (a known tag such as <div>, <br>, <p>, <html>, or
 *   an entity like &nbsp;): plain text with a "<" in it ("a < b", "<3") is returned unchanged.
 * - <head>, <style>, <script> and comments are dropped with their content; block ends (<br>,
 *   </p>, </div>, </li>, </tr>, </h1> to </h6>) become line breaks; <li> becomes "- "; a link keeps
 *   its text and adds its address in parentheses when the text does not already show it.
 * - Entities are decoded (named basics, &#NNN; and &#xHH;); &nbsp; becomes a normal space.
 * - Lines are trimmed and at most one blank line is kept between paragraphs.
 */

const HTML_HINT_RE =
  /<\/?(?:html|head|body|meta|div|p|br|span|a|b|i|u|strong|em|ul|ol|li|table|tbody|thead|tr|td|th|font|h[1-6]|img|hr|center|blockquote|pre|style|script)\b[^>]*>|&(?:nbsp|amp|lt|gt|quot|#\d{1,6}|#x[0-9a-f]{1,6});/i;

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  // Typographic entities folded to plain punctuation (product text rule).
  ndash: '-',
  mdash: '-',
  hellip: '...',
  lsquo: "'",
  rsquo: "'",
  ldquo: '"',
  rdquo: '"',
  laquo: '"',
  raquo: '"',
  bull: '-',
  middot: '-',
  copy: '(c)',
  reg: '(R)',
  trade: '(TM)',
  euro: 'EUR',
};

/** Block-level tags with the whitespace around them (layout, not content). */
const BLOCK_TAG_SPACE_RE =
  /\s*(<\/?(?:html|head|body|p|div|li|ul|ol|table|tbody|thead|tr|td|th|h[1-6]|blockquote|pre|center|br|hr)\b[^>]*>)\s*/gi;

/** Private-use placeholders for an explicit <br> and a list bullet while block edges collapse. */
const BR_MARK = '\uE000';
const LI_MARK = '\uE001';

/** True when `text` looks like HTML markup rather than plain text. */
export function looksLikeHtml(text: string): boolean {
  return HTML_HINT_RE.test(text);
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      if (code === 0xa0) return ' ';
      return String.fromCodePoint(code);
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? whole;
  });
}

/** Normalized visible text of a link label, for "is the address already shown". */
function bare(value: string): string {
  return value.toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '').trim();
}

/** `text` as plain text when it looks like HTML; otherwise `text` unchanged. */
export function htmlToPlainText(text: string): string {
  if (!text || !looksLikeHtml(text)) return text;
  let s = text.replace(/\r\n?/g, '\n');
  // Dropped with their content.
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<(head|style|script|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  s = s.replace(/<!doctype[^>]*>/gi, '');
  // In HTML, raw line breaks are just spaces; structure comes from the tags below. Whitespace
  // next to a block tag is layout only ("</div>\n<div>"), so it goes.
  s = s.replace(/\s*\n\s*/g, ' ');
  s = s.replace(BLOCK_TAG_SPACE_RE, '$1');
  // Links: keep the text, add the address when it is not already the text.
  s = s.replace(/<a\b[^>]*?\bhref\s*=\s*("([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a\s*>/gi, (_whole, _q, dq?: string, sq?: string, inner?: string) => {
    const href = decodeEntities((dq ?? sq ?? '').trim());
    const label = decodeEntities((inner ?? '').replace(/<[^>]*>/g, '')).trim();
    if (!/^(https?:|mailto:)/i.test(href)) return label;
    const address = href.replace(/^mailto:/i, '');
    if (label.length === 0) return address;
    return bare(label) === bare(address) || label.includes(address) ? label : `${label} (${address})`;
  });
  // Block structure. A <br> is an explicit line break (two in a row leave a blank line); the edges
  // of blocks are boundaries, and several boundaries in a row count as one. An empty block that
  // holds only &nbsp; still leaves a blank line, because its entity sits between the boundaries.
  s = s.replace(/<br\s*\/?>/gi, BR_MARK);
  s = s.replace(/<li\b[^>]*>/gi, `\n${LI_MARK}`);
  s = s.replace(/<\/(p|div|li|tr|h[1-6]|ul|ol|table|blockquote|pre|center)\s*>/gi, '\n');
  s = s.replace(/<(p|div|tr|h[1-6]|ul|ol|table|blockquote|pre|center|hr)\b[^>]*>/gi, '\n');
  s = s.replace(/<\/t[dh]\s*>/gi, ' ');
  // Every other tag.
  s = s.replace(/<[^>]*>/g, '');
  s = s.replace(/\n(?:[ \t]*\n)+/g, '\n');
  // A <br> right before a block edge ends the same line ("Agenda:<br><ul>").
  s = s.replace(new RegExp(`${BR_MARK}[ \\t]*\\n`, 'g'), '\n');
  s = s.split(BR_MARK).join('\n').split(LI_MARK).join('- ');
  s = decodeEntities(s);
  // Tidy: trim each line, collapse runs of spaces, keep at most one blank line.
  const lines = s.split('\n').map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim());
  const out: string[] = [];
  for (const line of lines) {
    if (line === '' && (out.length === 0 || out[out.length - 1] === '')) continue;
    out.push(line);
  }
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}
