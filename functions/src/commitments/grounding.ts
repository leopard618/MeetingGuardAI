/**
 * Verbatim quotes and grounded titles: checks 2 and 3 of docs/v2/M11-DESIGN.md section 2.4
 * (section 15 findings 3, 5 and 17), moved from verify.ts as written. PURE: no Firebase, no
 * logging, no clock.
 *
 * Shared by the M11 summaries (verify.ts, asWritten.ts, evalScore.ts, commitmentsStore.ts,
 * whatsappRender.ts; verify.ts re-exports every name here) and the assistant matters
 * (functions/src/matters, A2). Nothing here knows about summaries: the input is plain text and
 * offsets into it.
 * - matchVerbatim: a quote found in the text, exactly or with whitespace collapsed and typographic
 *   punctuation folded one for one, offsets mapped back to the original.
 * - expandSentence: a span widened to its whole sentence inside [from, to).
 * - cleanTitle: links, host names, email addresses and phone-like runs removed, punctuation folded
 *   to ASCII, one line, at most COMMITMENT_LIMITS.maxTitleChars.
 * - groundTitle: every checkable word and digit run of a title found in its anchor text, at most
 *   one added verb of TITLE_VERBS, never across a negation.
 * - ownerPrefixed: "<owner>: <title>" for someone else's commitment.
 * - hasBareHost and defangLinks: link detection and chat-safe quoting.
 * Deliberately NOT here: section anchors and their ids (verify.ts, payload.ts, ids.ts
 * sentenceAnchorId), the summary parser's owner and due marker syntax (verify.ts
 * stripItemMarkers, sections.ts OWNER_RE, DUE_PAREN_RE, DUE_INLINE_RE, LINK_RE), the owner and
 * payment checks, and the keyed ids and digests of ids.ts (built from summary ids and HMACs under
 * the summaries Keyring, shared/sealed.ts; never reuse them for matters).
 *
 * Product text rule: ASCII punctuation only in this file; other characters from code points.
 */
import { COMMITMENT_LIMITS } from '../shared/aiContract';
import { sliceSafe } from '../shared/text';
import { datesIn } from '../shared/textDates';
import {
  TITLE_VERBS,
  collapseWhitespace,
  digitRunsOf,
  escapeRegExp,
  fold,
  foldPunctuation,
  foldPunctuationOneForOne,
  hasNegation,
  isCheckableWord,
  wordsOf,
} from './text';

const ch = (code: number): string => String.fromCharCode(code);

// ---------------------------------------------------------------------------------------------
// Check 2: quotes
// ---------------------------------------------------------------------------------------------

export interface Span {
  start: number;
  end: number;
}

/**
 * Finds `needle` in `haystack`: exactly first, then with every whitespace run collapsed to one
 * space and typographic quotes, dashes and no-break spaces folded one for one on both sides (a
 * hard-wrapped mail, a model that typed straight quotes). Offsets are into `haystack`. The needle
 * is trimmed; an empty one is never found. The FIRST occurrence wins.
 */
export function matchVerbatim(haystack: string, needle: string | null | undefined): Span | null {
  if (typeof needle !== 'string') return null;
  const wanted = needle.trim();
  if (wanted.length === 0) return null;
  const exact = haystack.indexOf(wanted);
  if (exact !== -1) return { start: exact, end: exact + wanted.length };

  // Collapsed copy of the haystack with a map from each collapsed index to its original index.
  const folded = foldPunctuationOneForOne(haystack);
  let collapsed = '';
  const map: number[] = [];
  let inSpace = false;
  for (let index = 0; index < folded.length; index += 1) {
    const c = folded[index] ?? '';
    if (/\s/.test(c)) {
      if (!inSpace) {
        collapsed += ' ';
        map.push(index);
      }
      inSpace = true;
    } else {
      collapsed += c;
      map.push(index);
      inSpace = false;
    }
  }
  const target = collapseWhitespace(foldPunctuationOneForOne(wanted));
  if (target.length === 0) return null;
  const at = collapsed.indexOf(target);
  if (at === -1) return null;
  const start = map[at];
  const last = map[at + target.length - 1];
  if (start === undefined || last === undefined) return null;
  return { start, end: last + 1 };
}

const TERMINALS = new Set(['.', '!', '?', ';']);
const CLOSERS = new Set(['"', "'", ')', ']', ch(0x201d), ch(0x2019), ch(0x00bb)]);
const LIST_LINE_RE = /^[ \t]*(?:[-*+]|\d{1,3}[.)])[ \t]+/;

/** A terminal at `index` ends a sentence: '!', '?', ';', or '.' followed by whitespace, a closer or the end. */
function endsSentenceAt(text: string, index: number, limit: number): boolean {
  const c = text[index] ?? '';
  if (!TERMINALS.has(c)) return false;
  if (c !== '.') return true;
  let next = index + 1;
  while (next < limit && CLOSERS.has(text[next] ?? '')) next += 1;
  return next >= limit || /\s/.test(text[next] ?? '');
}

/** The end index (exclusive) of the sentence terminal at `index`, closing quotes and brackets included. */
function afterTerminal(text: string, index: number, limit: number): number {
  let end = index + 1;
  while (end < limit && CLOSERS.has(text[end] ?? '')) end += 1;
  return end;
}

/**
 * The whole sentence around [span.start, span.end) inside [from, to): back to the previous
 * sentence end, a blank line, the start of a list line, or `from`; forward to the next '.', '!',
 * '?' or ';' (a '.' only before whitespace, so "3.5" and "pay-here.com" do not end it), a blank
 * line, a list line, or `to`. Surrounding whitespace is trimmed.
 */
export function expandSentence(text: string, span: Span, from: number, to: number): Span {
  const s0 = Math.max(from, Math.min(span.start, to));
  const e0 = Math.min(to, Math.max(span.end, s0));
  const lineAfter = (newline: number): string => {
    const next = text.indexOf('\n', newline + 1);
    return text.slice(newline + 1, next === -1 || next > to ? to : next);
  };

  // Backward: the previous sentence end, a blank line or a list line, else `from`.
  let start = from;
  for (let index = s0 - 1; index >= from; index -= 1) {
    if (endsSentenceAt(text, index, to)) {
      start = afterTerminal(text, index, to);
      break;
    }
    if (text[index] !== '\n') continue;
    const lineStart = text.lastIndexOf('\n', index - 1) + 1;
    if (text.slice(Math.max(from, lineStart), index).trim() === '') {
      start = index + 1;
      break;
    }
    const marker = LIST_LINE_RE.exec(lineAfter(index));
    if (marker !== null) {
      start = index + 1 + marker[0].length;
      break;
    }
  }
  // A sentence that starts at the top of a list line starts after its marker.
  if (start === from || text[start - 1] === '\n') {
    const marker = LIST_LINE_RE.exec(text.slice(start, to));
    if (marker !== null && start + marker[0].length <= s0) start += marker[0].length;
  }
  while (start < s0 && /\s/.test(text[start] ?? '')) start += 1;

  // Forward: the first sentence end at or after the span's last character, a line before a blank
  // line or a list line, else `to`.
  let end = to;
  for (let index = Math.max(s0, e0 - 1); index < to; index += 1) {
    if (endsSentenceAt(text, index, to)) {
      end = afterTerminal(text, index, to);
      break;
    }
    if (text[index] !== '\n') continue;
    const next = lineAfter(index);
    if (next.trim() === '' || LIST_LINE_RE.test(next)) {
      end = index;
      break;
    }
  }
  end = Math.max(end, e0);
  while (end > start && /\s/.test(text[end - 1] ?? '')) end -= 1;
  return { start, end };
}

// ---------------------------------------------------------------------------------------------
// Check 3: titles
// ---------------------------------------------------------------------------------------------

const URL_RE = /(?:https?:\/\/|www\.)\S+|mailto:\S+/giu;
const EMAIL_RE = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
const HOST_PATH_RE = /(?<![\p{L}\p{N}@.-])[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\/\S*/giu;
/** A bare host name: a label, a dot and a letter TLD ("pay-here.com", "files.acme.io"). */
const BARE_HOST_RE = /(?<![\p{L}\p{N}@.-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}(?![\p{L}\p{N}-]|\.[\p{L}\p{N}])/giu;
/** Seven or more digits with spaces, dots, dashes or parentheses (a phone number or an account). */
const PHONE_RUN_RE = /\+?\(?\p{Nd}(?:[\p{Nd} \t().-]*\p{Nd})?\)?/gu;
const ISO_DATE_RE = /(?<!\p{Nd})\p{Nd}{4}([-/])\p{Nd}{2}\1\p{Nd}{2}(?!\p{Nd})/gu;
const SENTINEL = ch(0);

/** True when `value` contains a bare host name (sets has_link; LINK_RE needs a path). */
export function hasBareHost(value: string): boolean {
  BARE_HOST_RE.lastIndex = 0;
  return BARE_HOST_RE.test(value);
}

/** Every link form cleanTitle removes, in one pass (the scheme forms first, then emails, then hosts). */
const ANY_LINK_RE = new RegExp([URL_RE, EMAIL_RE, HOST_PATH_RE, BARE_HOST_RE].map((re) => `(?:${re.source})`).join('|'), 'giu');

/**
 * Summary text made safe to quote in a chat message that turns links into taps (WhatsApp does,
 * even with preview_url false): every URL, www form, mailto, host name and email address keeps
 * its characters but cannot be tapped ("hxxps://pay[.]example[.]com/x", "name[at]acme[.]io").
 * Everything else is left as written. The app shows quotes as plain text and needs none of this.
 */
export function defangLinks(value: string): string {
  return value.replace(ANY_LINK_RE, (found) =>
    found
      .replace(/^(h)tt(ps?):/iu, '$1xx$2:')
      .replace(/^mailto:/iu, 'mailto[:]')
      .replace(/@/g, '[at]')
      .replace(/\./g, '[.]'),
  );
}

function removePhoneRuns(value: string): string {
  // ISO dates that datesIn reads are kept: mask them so no phone run crosses them.
  const dates: string[] = [];
  const masked = value.replace(ISO_DATE_RE, (found) => {
    if (datesIn(found).size === 0) return found;
    dates.push(found);
    return `${SENTINEL}${dates.length - 1}${SENTINEL}`.replace(/\d/g, (d) => String.fromCharCode(0x41 + Number(d)));
  });
  const stripped = masked.replace(PHONE_RUN_RE, (found) => ((found.match(/\p{Nd}/gu) ?? []).length >= 7 ? ' ' : found));
  return stripped.replace(new RegExp(`${SENTINEL}([A-J]+)${SENTINEL}`, 'g'), (_whole, letters: string) => {
    const index = Number([...letters].map((letter) => String(letter.charCodeAt(0) - 0x41)).join(''));
    return dates[index] ?? '';
  });
}

/**
 * A title as it may be stored: URLs, www forms, mailto, host names with a path, bare host names,
 * email addresses and phone-like runs (7 or more digits; ISO dates kept) removed; typographic
 * punctuation folded to ASCII; one line; empty brackets and dangling separators removed; at most
 * 200 characters. Never adds anything.
 */
export function cleanTitle(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return '';
  // Controls and invisible format characters (bidi overrides, zero-width) go first.
  let title = foldPunctuation(raw.normalize('NFKC').replace(/[\p{Cc}\p{Cf}]+/gu, ' '));
  title = title.replace(URL_RE, ' ').replace(EMAIL_RE, ' ').replace(HOST_PATH_RE, ' ').replace(BARE_HOST_RE, ' ');
  title = removePhoneRuns(title);
  title = collapseWhitespace(title);
  for (let round = 0; round < 3; round += 1) {
    title = title
      .replace(/\(\s*[,;:.-]*\s*\)|\[\s*[,;:.-]*\s*\]|<\s*>/g, ' ')
      .replace(/\s+([,;:.!?])/g, '$1')
      .replace(/([,;:])(?=[,;:.!?])/g, '');
    title = collapseWhitespace(title);
  }
  title = title.replace(/^[\s,;:.\-|/]+/, '').replace(/[\s,;:\-|/]+$/, '');
  return sliceSafe(title, COMMITMENT_LIMITS.maxTitleChars).trim();
}

export type GroundingResult = 'grounded' | 'no_checkable_word' | 'word_not_in_anchor' | 'digits_not_in_anchor' | 'negation';

/**
 * Word-by-word grounding (finding 3): accent- and case-insensitive, EN and ES stopwords skipped.
 * Every 3+ letter word must appear in the anchor text, except at most ONE word of TITLE_VERBS; at
 * least one grounded word that is not that verb must remain; every digit run must appear in the
 * anchor as a digit run ("Pay Bob $5,000" against "$500" fails).
 * A title or an anchor that says "not" (text.ts hasNegation) is never grounded, so a title can
 * neither add a negation nor drop one ("Share the deck" from "Do not share the deck"); the
 * anchor's own words are shown instead.
 */
export function groundTitle(title: string, anchorText: string): GroundingResult {
  if (hasNegation(title) || hasNegation(anchorText)) return 'negation';
  const anchorWords = new Set(wordsOf(anchorText));
  const anchorDigits = new Set(digitRunsOf(anchorText));
  let grounded = 0;
  let addedVerbs = 0;
  for (const word of wordsOf(title)) {
    if (!isCheckableWord(word)) continue;
    if (anchorWords.has(word)) {
      grounded += 1;
      continue;
    }
    if (TITLE_VERBS.has(word) && addedVerbs === 0) {
      addedVerbs += 1;
      continue;
    }
    return 'word_not_in_anchor';
  }
  for (const run of digitRunsOf(title)) {
    if (!anchorDigits.has(run)) return 'digits_not_in_anchor';
  }
  return grounded > 0 ? 'grounded' : 'no_checkable_word';
}

/** "<owner>: <title>" within 200, unless the title already starts with the owner's name. */
export function ownerPrefixed(title: string, owner: string): string {
  const name = collapseWhitespace(owner);
  if (name.length === 0) return title;
  const startsWithOwner = new RegExp(`^${escapeRegExp(fold(name))}(?![\\p{L}\\p{N}])`, 'u').test(fold(title));
  if (startsWithOwner) return title;
  return sliceSafe(`${name}: ${title}`, COMMITMENT_LIMITS.maxTitleChars).trim();
}
