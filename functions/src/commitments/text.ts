/**
 * Text helpers for M11's checks (docs/v2/M11-DESIGN.md section 2.4): accent- and case-insensitive
 * keys, word and digit runs, the EN/ES stopwords and the one verb list a title may add. PURE: no
 * Firebase, no logging, no clock.
 *
 * Generic on purpose (decision 15): nothing here knows about summaries, so Sven's A2 reuses it.
 * Shared by the M11 summaries (grounding.ts, verify.ts, due.ts, taskDoc.ts, ids.ts and the
 * summaries handlers) and the assistant matters (functions/src/matters, A2); it imports nothing.
 * Deliberately NOT here: section anchors, the parser's marker syntax, and the keyed ids and digests
 * of ids.ts (normalizeAnchorText is only the text normalization they hash; the keys themselves are
 * HMACs under the summaries Keyring, shared/sealed.ts).
 *
 * Product text rule: ASCII punctuation only in this file; other characters are built from code
 * points (String.fromCharCode), so the file never holds a typographic character itself.
 */

const ch = (code: number): string => String.fromCharCode(code);

/** Accent- and case-insensitive key: NFKD, combining marks removed, lowercase. */
export function fold(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase();
}

/** Every whitespace run (newlines included) as one space, trimmed. */
export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

/** Letter runs of `value`, folded ("Revisar el diseno" -> ["revisar", "el", "diseno"]). */
export function wordsOf(value: string): string[] {
  return fold(value).match(/\p{L}+/gu) ?? [];
}

/** Decimal digit runs of `value` in any script, NFKC first (fullwidth digits read as ASCII). */
export function digitRunsOf(value: string): string[] {
  return value.normalize('NFKC').match(/\p{Nd}+/gu) ?? [];
}

/**
 * The text an anchor key is computed over (section 2.7): NFKC, whitespace collapsed, lowercase.
 * Two copies of a line that differ only in wrapping or case give the same key.
 */
export function normalizeAnchorText(value: string): string {
  return collapseWhitespace(value.normalize('NFKC')).toLowerCase();
}

/**
 * One-for-one folds of typographic punctuation to ASCII (single quotes, double quotes, guillemets,
 * hyphens and dashes, the minus sign, no-break spaces). Same length in and out, so offsets found
 * on the folded text are offsets into the original.
 */
const ONE_FOR_ONE: ReadonlyMap<string, string> = new Map<string, string>([
  [ch(0x2018), "'"],
  [ch(0x2019), "'"],
  [ch(0x201a), "'"],
  [ch(0x201b), "'"],
  [ch(0x2032), "'"],
  [ch(0x2039), "'"],
  [ch(0x203a), "'"],
  [ch(0x201c), '"'],
  [ch(0x201d), '"'],
  [ch(0x201e), '"'],
  [ch(0x201f), '"'],
  [ch(0x2033), '"'],
  [ch(0x00ab), '"'],
  [ch(0x00bb), '"'],
  [ch(0x2010), '-'],
  [ch(0x2011), '-'],
  [ch(0x2012), '-'],
  [ch(0x2013), '-'],
  [ch(0x2014), '-'],
  [ch(0x2015), '-'],
  [ch(0x2212), '-'],
  [ch(0x00a0), ' '],
  [ch(0x2007), ' '],
  [ch(0x202f), ' '],
]);

const ONE_FOR_ONE_RE = new RegExp(`[${[...ONE_FOR_ONE.keys()].join('')}]`, 'gu');
const ELLIPSIS = ch(0x2026);

/** Typographic punctuation folded one for one (length kept). */
export function foldPunctuationOneForOne(value: string): string {
  return value.replace(ONE_FOR_ONE_RE, (found) => ONE_FOR_ONE.get(found) ?? found);
}

/** Typographic punctuation folded to ASCII for a title ("..." for the ellipsis, so the length may grow). */
export function foldPunctuation(value: string): string {
  return foldPunctuationOneForOne(value).split(ELLIPSIS).join('...');
}

/** Escapes a string for use inside a RegExp. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------------------------
// Word lists (folded: lowercase, no accents)
// ---------------------------------------------------------------------------------------------

/** EN and ES function words: never "checkable" in a title, never an owner. */
export const STOPWORDS: ReadonlySet<string> = new Set([
  // English
  'a', 'an', 'the', 'to', 'of', 'in', 'on', 'at', 'by', 'for', 'from', 'with', 'without', 'and', 'or', 'nor', 'but',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'will', 'would', 'shall', 'should', 'must', 'can', 'could',
  'may', 'might', 'do', 'does', 'did', 'has', 'have', 'had', 'this', 'that', 'these', 'those', 'it', 'its', 'as',
  'up', 'out', 'into', 'onto', 'over', 'about', 'after', 'before', 'our', 'ours', 'your', 'yours', 'their', 'theirs',
  'his', 'her', 'hers', 'we', 'you', 'they', 'he', 'she', 'them', 'us', 'me', 'my', 'mine', 'i', 'all', 'any',
  'each', 'per', 'via', 'not', 'no', 'if', 'then', 'than', 'so', 'also', 'too', 'there', 'here', 'what', 'which',
  'who', 'whom', 'whose', 'when', 'where', 'why', 'how', 'some', 'such', 'own', 'off', 'again', 'just', 'please',
  // Spanish
  'el', 'la', 'los', 'las', 'lo', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al', 'en', 'con', 'por', 'para', 'y',
  'e', 'o', 'u', 'que', 'se', 'su', 'sus', 'le', 'les', 'es', 'son', 'ser', 'sera', 'va', 'van', 'ir', 'este', 'esta',
  'estos', 'estas', 'ese', 'esa', 'esos', 'esas', 'eso', 'esto', 'mi', 'mis', 'tu', 'tus', 'nuestro', 'nuestra',
  'nuestros', 'nuestras', 'sobre', 'entre', 'sin', 'como', 'mas', 'muy', 'ya', 'hasta', 'desde', 'cada', 'si', 'no',
  'ni', 'pero', 'yo', 'nos', 'te', 'me', 'ella', 'ellas', 'ellos', 'usted', 'ustedes', 'nosotros', 'nosotras',
  'hay', 'ha', 'han', 'he', 'debe', 'deben', 'puede', 'pueden', 'favor',
]);

/**
 * The ONE extra word a title may add without it appearing in the anchor (section 2.4 check 3), so
 * "Follow up on the pricing page" passes on the item "Pricing page" while any other added word
 * fails. The eval reports the fallback rate so this list is tuned on data.
 */
export const TITLE_VERBS: ReadonlySet<string> = new Set([
  'follow', 'send', 'review', 'confirm', 'check', 'prepare', 'share', 'schedule', 'call', 'update', 'finish', 'ask',
  'seguir', 'enviar', 'revisar', 'confirmar', 'verificar', 'preparar', 'compartir', 'agendar', 'llamar', 'actualizar',
  'terminar', 'pedir',
]);

/** Words that are never a person's name on their own (collective owners, pronouns). */
export const NOT_A_NAME: ReadonlySet<string> = new Set([
  'team', 'everyone', 'everybody', 'someone', 'somebody', 'anyone', 'nobody', 'none', 'tbd', 'unassigned', 'owner',
  'equipo', 'todos', 'todas', 'alguien', 'nadie', 'responsable', 'pendiente',
]);

/** True for a word that can carry meaning in a title: at least 3 letters and not a stopword. */
export function isCheckableWord(word: string): boolean {
  return word.length >= 3 && !STOPWORDS.has(word);
}

/**
 * EN and ES negation words, folded. Most are stopwords or shorter than 3 letters, so the word
 * check never sees them: a title could add one ("Do not share ...") or drop one and still pass.
 * hasNegation also reads contractions ("don't", "can't").
 */
export const NEGATIONS: ReadonlySet<string> = new Set([
  'not', 'no', 'never', 'without', 'nor', 'neither', 'none', 'nothing', 'nobody', 'cannot',
  'dont', 'doesnt', 'didnt', 'wont', 'cant', 'isnt', 'arent', 'wasnt', 'werent', 'shouldnt', 'wouldnt', 'couldnt',
  'mustnt', 'havent', 'hasnt', 'hadnt', 'neednt',
  'sin', 'ni', 'nunca', 'jamas', 'tampoco', 'nada', 'nadie', 'ningun', 'ninguno', 'ninguna', 'ningunos', 'ningunas',
]);

/** "n't" with an ASCII, typographic or modifier apostrophe, at the end of a word. */
const CONTRACTION_RE = new RegExp(`\\p{L}n['${ch(0x2019)}${ch(0x02bc)}]t(?!\\p{L})`, 'u');

/** True when `value` says "not" in any of the forms above (accent- and case-insensitive). */
export function hasNegation(value: string): boolean {
  if (wordsOf(value).some((word) => NEGATIONS.has(word))) return true;
  return CONTRACTION_RE.test(fold(value));
}
