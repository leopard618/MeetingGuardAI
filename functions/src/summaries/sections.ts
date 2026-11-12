/**
 * M10 sections, items and the summary metadata used by matching (docs/v2/M10-DESIGN.md section 6
 * "Inputs" and section 8). PURE: no Firebase imports, unit-tested standalone
 * (test/unit/summariesSections.test.ts).
 *
 * Input is the sanitized text (sanitize.ts: sanitizeText, then stripForwardWrapper). Every `start`
 * and `end` below is an absolute UTF-16 offset into exactly that string, and for every item
 * `text.slice(item.start, item.end) === item.text`. M11 re-runs parseSections on the stored text
 * after a parser fix (SECTIONS_PARSER_VERSION is stored as parserVersion).
 *
 * Heading rules (English and Spanish, case- and accent-insensitive):
 * - A known heading (TLDR, Summary / Resumen, Updates / Actualizaciones, Decisions / Decisiones /
 *   Acuerdos, Action items / Acciones / Elementos de accion / Tareas / Compromisos, Next steps /
 *   Follow-up tasks / Proximos pasos / Pasos a seguir, Waiting on / En espera / Pendientes, Open
 *   questions / Preguntas abiertas, Notes / Notas, and a few synonyms) on its own line, with optional Markdown "#", bold or italic markup, a trailing
 *   colon, an emoji prefix or a count "(3)". "1. Decisions" also counts. Only TLDR and Summary
 *   are recognized inline ("TL;DR: The team ..."), and only before the first heading of another
 *   kind: inside Action items an "Overview: ..." or "**TL;DR: Bish owns the release**" line is
 *   content of Action items, and a "Decision: ..." line inside Updates never opens a section.
 * - A custom heading: an unknown line marked as a heading ("## Launch Readiness",
 *   "**Launch Readiness**"), or, only after the first heading, a short plain line that looks like
 *   a heading (Title Case, or a short line between a blank line and a list). Inside a TLDR or
 *   Summary section a short plain label of at most five words directly over an item line counts
 *   in sentence case too ("Preparacion del lanzamiento", "Q&A", "API") when the line before it is
 *   closed (terminal punctuation, a closing link, address or timestamp, or an item), so those
 *   items never stay derived. The first meaningful
 *   line is never a custom heading: it is the title and belongs to the preamble. Never a custom
 *   heading either: a label that is only a date or a time ("**Oct 16**", "**10/16/2026 3:20 PM**",
 *   "**Date: Oct 16, 2026**", "16-Oct-2026", "Viernes 17", a Google Calendar time line), a
 *   whole-line marked "label: value" or "label - value" line ("**Key takeaways: launch is on
 *   track**", "**TL;DR - Bish owns the release**", and inside a list section any known label
 *   such as "**Decision: Use Postmark**"), a continuation line of the item above it (the column
 *   rule below), the hard-wrapped tail of a sentence (the previous line stops without
 *   terminal punctuation, is not itself heading-shaped and does not end with a link, an address,
 *   a clock or a "(00:02:10)" timestamp; a blank line before a label over a
 *   list does not help when that previous line ends with a lowercase word, which a link, an
 *   address or "iOS" is not), or one entry of a list of names, plain or bold ("Attendees", then
 *   "Francisco Gomez", "Bish Kumar": at least two consecutive short Title Case lines, never a
 *   sentence, and the line after them is not an item).
 * - A sub-label: inside a list section (Updates, Decisions, Action items, Next steps, Waiting on,
 *   Open questions), at any point, a short plain or marked label directly followed by items stays
 *   content of that section when it is shaped like a person name ("Bish Kumar", "**Ana de la
 *   Cruz**", "### Dana", "Speaker 2", "Dana Lee, PM") or is a group word (a weekday or month,
 *   "Today", "Next week", "Done", "In progress", "High priority", "Hoy", "Esta semana",
 *   "Pendiente", "En curso"); after a blank line only a group word or a name of two or more name
 *   words, or a one-word name that is the first line under the heading or follows a name
 *   sub-label (double-spaced Fireflies groups: "**Francisco**", blank, "- Approve the budget").
 *   Any other label followed by items ("**Launch Readiness**", "Store Listing",
 *   "Insights", "Links") opens a custom section. Inside a custom section whose heading is directly
 *   followed by a short marked label ("Launch Readiness", "**Android**"), later short marked labels
 *   right under the previous line are sub-labels too. A sub-label never sets an owner: an item's
 *   owner comes only from "(owner: ...)" or "(responsable: ...)" in its own text (design section 8).
 * - Item continuations follow one column rule, applied by the heading-detection loop and joined
 *   by collectItems from the lines that loop marked, so the two never disagree. Under an open item
 *   (marker column M, text column T measured right after the bullet or number, before any
 *   checkbox: "- x" and "- [ ] x" have T = 2, "1. x" T = 3, a bare "[ ] x" T = 4), a non-item line
 *   indented at or beyond T, or with a tab in its indent, continues the item (an aligned
 *   hanging-indent wrap, even when the wrapped word is a heading: "- Approve the Q4 Executive",
 *   "  Summary"), unless it is a whole-line bold or italic label or a "#" line, or a capitalized
 *   known heading that must not join: under a TLDR or Summary item a heading of another kind
 *   ("- Launch is on track.", "  Action Items"), and anywhere a heading after a closed line or
 *   ending with ":" ("  Next steps:"). Inside TLDR or Summary T stays the text start ("- [ ] x"
 *   has T = 6) and a tab counts as one column. A line indented past M but short of T (one space,
 *   which is what an NBSP indent becomes after sanitizeText) is evaluated as a heading when it is
 *   heading-shaped (a capitalized known heading such as " Action Items", a marked label, or a plain
 *   label directly over an item such as " Topics") and continues the item otherwise. Outside TLDR
 *   and Summary a TLDR or Summary heading under an item (" Summary", "  Overview", "  Resumen")
 *   never opens a section: it continues the item, so the items under a list heading keep that
 *   kind. A line at or left of M never continues it. Inside TLDR or Summary such a line, and a
 *   line past M but short of T right under the item or an aligned continuation of it, also closes
 *   the item for the hard-wrap checks: "- Launch is on track, pending the", "  Apple review",
 *   "Topics" or " Topics", "- Store listing reviewed" opens Topics, so that item never stays
 *   derived.
 * - Text before the first heading is the preamble; no heading at all gives one body section.
 *
 * Nothing here logs. The text, headings, items, owners and links are user content.
 *
 * Product text rule: this file contains only ASCII punctuation; other characters are \u escapes.
 */
import { createHash } from 'node:crypto';

import { z } from 'zod';

import { lineSpans, sanitizeLine, sliceSafe, type LineSpan } from './sanitize';

/** Stored as parserVersion; bump on any change that moves offsets, kinds or ids. */
export const SECTIONS_PARSER_VERSION = 1;

export const MAX_SECTIONS = 40;
export const MAX_ITEMS = 400;
export const MAX_ITEM_CHARS = 1000;
export const MAX_HEADING_CHARS = 100;
const MAX_PLAIN_HEADING_CHARS = 60;
const MAX_PLAIN_HEADING_WORDS = 6;
/** A plain line between a blank line and a list counts as a heading only when this short. */
const MAX_LOOSE_HEADING_WORDS = 4;
const MAX_OWNER_CHARS = 100;
const MAX_DUE_CHARS = 100;
/** summaryDate, dateLine and titleLine look at this many non-blank lines from the top. */
const META_LINES = 10;
const MAX_TITLE_CHARS = 200;
const MAX_SUBJECT_CHARS = 500;
const MAX_CONFERENCE_LINKS = 10;
const MAX_LINK_CHARS = 500;

export const SECTION_KINDS = [
  'preamble',
  'tldr',
  'summary',
  'updates',
  'decisions',
  'action_items',
  'next_steps',
  'waiting_on',
  'open_questions',
  'notes',
  'custom',
  'body',
] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

/** M11 never extracts a commitment from these alone (the TLDR is never ground truth). */
const DERIVED_KINDS: ReadonlySet<SectionKind> = new Set<SectionKind>(['tldr', 'summary']);

/** Sections whose content is a list; a name or group label inside one is a sub-label (content). */
const LIST_KINDS: ReadonlySet<SectionKind> = new Set<SectionKind>([
  'updates',
  'decisions',
  'action_items',
  'next_steps',
  'waiting_on',
  'open_questions',
]);

export const ITEM_FLAGS = ['possible_instruction', 'has_link', 'truncated'] as const;
export type ItemFlag = (typeof ITEM_FLAGS)[number];
export const SECTION_FLAGS = ['possible_instruction', 'truncated'] as const;
export type SectionFlag = (typeof SECTION_FLAGS)[number];

const offsetSchema = z.number().int().nonnegative();

/** Sealed item shape; read.ts can parse decrypted sections with these schemas. */
export const summaryItemSchema = z.object({
  /** "i_" + first 12 hex of sha256(JSON [kind, heading, item line]); stable across re-parses. */
  id: z.string().regex(/^i_[0-9a-f]{12}$/),
  /** Verbatim, without the bullet, number or checkbox marker. */
  text: z.string().min(1).max(MAX_ITEM_CHARS),
  start: offsetSchema,
  end: offsetSchema,
  /** true / false for a checkbox line, null for a plain bullet or number. */
  checked: z.boolean().nullable(),
  /**
   * Only from "(owner: Name)" or "(responsable: Name)" inside the item's own text; never from a
   * sub-label above it, never invented.
   */
  owner: z.string().min(1).max(MAX_OWNER_CHARS).nullable(),
  /** Only when an explicit due marker is present; never invented. */
  dueText: z.string().min(1).max(MAX_DUE_CHARS).nullable(),
  flags: z.array(z.enum(ITEM_FLAGS)).max(ITEM_FLAGS.length),
});
export type SummaryItem = z.infer<typeof summaryItemSchema>;

export const summarySectionSchema = z.object({
  /** "s_" + first 12 hex of sha256(JSON ["section", kind, heading, occurrence]). */
  id: z.string().regex(/^s_[0-9a-f]{12}$/),
  kind: z.enum(SECTION_KINDS),
  /** Verbatim heading text (markup and trailing colon excluded); null for preamble and body. */
  heading: z.string().min(1).max(MAX_HEADING_CHARS).nullable(),
  derived: z.boolean(),
  /** The heading's first character (preamble and body: the first non-blank character). */
  start: offsetSchema,
  /** Just after the section's last non-blank character. */
  end: offsetSchema,
  flags: z.array(z.enum(SECTION_FLAGS)).max(SECTION_FLAGS.length),
  items: z.array(summaryItemSchema).max(MAX_ITEMS),
});
export type SummarySection = z.infer<typeof summarySectionSchema>;

export const summarySectionsSchema = z.array(summarySectionSchema).max(MAX_SECTIONS);

export interface ParsedSections {
  parserVersion: number;
  sections: SummarySection[];
  /** True when sections or items were dropped by a cap or an item was cut. */
  truncated: boolean;
  /** True when the whole-text scan found prompt-injection phrasing anywhere. */
  possibleInstruction: boolean;
  counts: { sections: number; items: number };
}

// ---------------------------------------------------------------------------------------------
// Headings
// ---------------------------------------------------------------------------------------------

type NamedKind = Exclude<SectionKind, 'preamble' | 'custom' | 'body'>;

/** Accented letters for the headings below, built from code points so this file stays ASCII. */
const A_ACUTE = String.fromCharCode(0xe1);
const O_ACUTE = String.fromCharCode(0xf3);

/** Written naturally; matched through headingKey (accents, case and punctuation ignored). */
const HEADING_NAMES: Record<NamedKind, readonly string[]> = {
  tldr: ['TLDR', 'TL;DR', 'TL DR', 'Quick recap', 'En resumen', 'En pocas palabras', 'Resumen breve'],
  summary: [
    'Summary',
    'Meeting summary',
    'Executive summary',
    'Overview',
    'Key takeaways',
    'Resumen',
    'Resumen de la reuni\u00F3n',
    'Resumen ejecutivo',
    'Sumario',
    'Puntos clave',
    'Resumen rapido',
    `Resumen r${A_ACUTE}pido`,
  ],
  updates: ['Updates', 'Status updates', 'Progress updates', 'Actualizaciones', 'Novedades', 'Avances'],
  decisions: ['Decisions', 'Decisions made', 'Key decisions', 'Decisiones', 'Decisiones tomadas', 'Acuerdos'],
  action_items: [
    'Action items',
    'Action item',
    'Actions',
    'Tasks',
    'To do',
    'To-dos',
    'Acciones',
    'Acciones a tomar',
    'Puntos de acci\u00F3n',
    'Elementos de acci\u00F3n',
    'Tareas',
    'Tareas pendientes',
    'Compromisos',
  ],
  next_steps: [
    'Next steps',
    'Suggested next steps',
    'Follow-up tasks',
    'Follow up tasks',
    'Pasos siguientes',
    'Pasos siguientes sugeridos',
    'Pr\u00F3ximos pasos',
    'Siguientes pasos',
    'Proximos pasos sugeridos',
    `Pr${O_ACUTE}ximos pasos sugeridos`,
    'Pasos a seguir',
  ],
  waiting_on: ['Waiting on', 'Waiting for', 'En espera', 'A la espera', 'Esperando', 'Pendiente de', 'Pendientes'],
  open_questions: [
    'Open questions',
    'Questions',
    'Unresolved questions',
    'Preguntas abiertas',
    'Preguntas pendientes',
    'Preguntas',
  ],
  notes: ['Notes', 'Additional notes', 'Other notes', 'Notas', 'Notas adicionales', 'Otras notas'],
};

/** Lines that label the document rather than open a section; skipped when picking titleLine. */
const DOCUMENT_LABELS = [
  'Meeting notes',
  'Meeting recap',
  'Meeting summary',
  'Meeting minutes',
  'Notes',
  'Recap',
  'Minutes',
  'Notas',
  'Notas de la reuni\u00F3n',
  'Resumen de la reuni\u00F3n',
  'Acta',
  'Acta de la reuni\u00F3n',
  'Minuta',
];

/** Lowercase, accents removed, a trailing "(3)" dropped, every non-letter/digit run one space. */
export function headingKey(label: string): string {
  return label
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\(\s*\d{1,3}\s*\)\s*$/u, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const KNOWN_HEADINGS: ReadonlyMap<string, NamedKind> = new Map(
  (Object.entries(HEADING_NAMES) as Array<[NamedKind, readonly string[]]>).flatMap(([kind, names]) =>
    names.map((name) => [headingKey(name), kind] as const),
  ),
);

const DOCUMENT_LABEL_KEYS: ReadonlySet<string> = new Set(DOCUMENT_LABELS.map(headingKey));

/**
 * The kind of a known heading, also written in the singular ("Decision", "Update", "Accion"):
 * only for the label of a "label: value" line, never for a standalone heading line.
 */
function knownLabelKind(label: string): NamedKind | undefined {
  const key = headingKey(label);
  return KNOWN_HEADINGS.get(key) ?? KNOWN_HEADINGS.get(`${key}s`) ?? KNOWN_HEADINGS.get(`${key}es`);
}

/**
 * Labels over a list of people ("Attendees", then one name per line), headingKey form. Such a
 * label starts a list of names even when it is not a short Title Case line ("Attendees (3)").
 */
const NAME_LIST_LABELS: ReadonlySet<string> = new Set(['attendees', 'participants', 'asistentes', 'participantes']);

/** En dash and em dash, built from code points so this file stays ASCII. */
const EN_DASH = String.fromCharCode(0x2013);
const EM_DASH = String.fromCharCode(0x2014);

interface Label {
  /** The heading text: markup, surrounding whitespace and a trailing colon removed. */
  text: string;
  /** Offset of `text` inside the string given to readLabel. */
  offset: number;
  /** True when Markdown "#", bold or italic markup wrapped the line. */
  marked: boolean;
  /** The Markdown "#" count (1 to 6); 0 when the line is not a "#" heading. */
  level: number;
}

const MD_HEADING_RE = /^(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?$/;
const EMPHASIS_RES: readonly RegExp[] = [
  /^\*\*([^*]+)\*\*[ \t]*:?$/,
  /^__([^_]+)__[ \t]*:?$/,
  /^\*([^*]+)\*[ \t]*:?$/,
  /^_([^_]+)_[ \t]*:?$/,
];

/**
 * Lines longer than this are never headings and skip the markup regexes: MD_HEADING_RE backtracks
 * quadratically on a long run of spaces inside one line (a ReDoS on hostile mail).
 */
const MAX_LABEL_SCAN_CHARS = 300;

function readLabel(trimmed: string): Label {
  if (trimmed.length > MAX_LABEL_SCAN_CHARS) return { text: trimmed, offset: 0, marked: false, level: 0 };
  let text = trimmed;
  let offset = 0;
  let marked = false;
  let level = 0;
  const md = MD_HEADING_RE.exec(text);
  if (md?.[1] !== undefined && md[2] !== undefined) {
    offset = text.indexOf(md[2], md[1].length);
    text = md[2];
    marked = true;
    level = md[1].length;
  }
  for (const re of EMPHASIS_RES) {
    const em = re.exec(text);
    if (em?.[1] !== undefined) {
      // The prefix is only marker characters and the inner text contains none, so this is exact.
      offset += text.indexOf(em[1]);
      text = em[1];
      marked = true;
      break;
    }
  }
  const noColon = text.replace(/[ \t]*:[ \t]*$/, '');
  const lead = noColon.length - noColon.trimStart().length;
  return { text: noColon.trim(), offset: offset + lead, marked, level };
}

// ---------------------------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------------------------

interface ItemMatch {
  indent: number;
  /** Offset of the item text inside the raw line. */
  contentOffset: number;
  /**
   * The item's text column for the one column rule (underItem): right after the bullet or number
   * and the blanks after it, before any checkbox ("- x" and "- [ ] x" give 2, "1. x" gives 3), or
   * the text start when there is no bullet or number ("[ ] x" gives 4).
   */
  textColumn: number;
  numbered: boolean;
  checked: boolean | null;
}

// Bullets: - * + middle dot, en dash, em dash, bullet, triangular bullet, hyphen bullet, bullet
// operator, small squares, black circle, white bullet, and the Symbol-font bullet Word pastes.
// Numbers: "1." or "1)". Checkboxes: "[ ]", "[]", "[x]", "[X]", check marks, ballot boxes.
const ITEM_RE =
  /^([ \t]*)(?:([-*+\u00B7\u2013\u2014\u2022\u2023\u2043\u2219\u25AA\u25AB\u25CF\u25E6\uF0B7])[ \t]+|(\d{1,3}[.)])[ \t]+)?(?:\[([ xX\u2713\u2714]?)\]|([\u2610\u2611\u2612]))?[ \t]*(\S.*)?$/u;

function matchItem(raw: string): ItemMatch | null {
  const m = ITEM_RE.exec(raw);
  if (!m) return null;
  const [, indent = '', bullet, number, box, ballot, content] = m;
  if (bullet === undefined && number === undefined && box === undefined && ballot === undefined) return null;
  if (content === undefined) return null;
  let checked: boolean | null = null;
  if (box !== undefined) checked = /[xX\u2713\u2714]/.test(box);
  else if (ballot !== undefined) checked = ballot !== '\u2610';
  const contentOffset = m[0].length - content.length;
  const lead = bullet ?? number;
  let textColumn = contentOffset;
  if (lead !== undefined) {
    const afterLead = indent.length + lead.length;
    textColumn = afterLead + (/^[ \t]*/.exec(raw.slice(afterLead))?.[0].length ?? 0);
  }
  return { indent: indent.length, contentOffset, textColumn, numbered: number !== undefined, checked };
}

const OWNER_RE = /\((?:owners?|responsables?)[ \t]*:[ \t]*([^()\n]+?)[ \t]*\)/iu;
const DUE_PAREN_RE =
  /\((?:due(?:[ \t]+date)?|deadline|fecha[ \t]+l[i\u00ED]mite|vencimiento|vence|plazo|entrega)(?!\p{L})(?![ \t]+to\b)[ \t]*:?[ \t]*([^()\n]+?)[ \t]*\)/iu;
const DUE_INLINE_RE =
  /(?:^|[\s,;(|-])(?:due(?:[ \t]+date)?[ \t]*:|due[ \t]+(?:by|on)\b|deadline[ \t]*:|fecha[ \t]+l[i\u00ED]mite[ \t]*:|vence(?:[ \t]+el)?[ \t]*:|vence[ \t]+el\b|plazo[ \t]*:)[ \t]*([^()\n;|]+)/iu;

function ownerOf(text: string): string | null {
  const m = OWNER_RE.exec(text);
  const owner = m?.[1]?.trim() ?? '';
  return owner.length > 0 ? sliceSafe(owner, MAX_OWNER_CHARS).trim() : null;
}

function dueTextOf(text: string): string | null {
  const m = DUE_PAREN_RE.exec(text) ?? DUE_INLINE_RE.exec(text);
  const due = sliceSafe(m?.[1] ?? '', MAX_DUE_CHARS)
    .replace(/[\s.,]+$/, '')
    .trim();
  return due.length > 0 ? due : null;
}

const LINK_RE = /\b(?:https?:\/\/|www\.)\S|\bmailto:\S|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\/\S/i;

// ---------------------------------------------------------------------------------------------
// Prompt-injection scan (whole text)
// ---------------------------------------------------------------------------------------------

const INSTRUCTION_PATTERNS: readonly RegExp[] = [
  // English
  /\b(?:ignore|disregard|forget|override|skip)\s+(?:all\s+|any\s+)?(?:of\s+)?(?:the\s+|your\s+|my\s+|these\s+|those\s+)?(?:previous|prior|above|earlier|preceding|former|original|system)\s+(?:instructions?|prompts?|messages?|rules?|directions?|directives?|context|guidelines?)/giu,
  /\b(?:ignore|disregard|forget)\s+(?:all\s+)?(?:your|the|these|those)\s+(?:instructions?|rules?|guidelines?|directives?)/giu,
  /\bsystem\s+prompt/giu,
  /\b(?:developer|system)\s+(?:message|instructions?)\b/giu,
  /\bdeveloper\s+mode\b/giu,
  /\byou\s+are\s+now\b/giu,
  /\bas\s+an?\s+(?:AI|artificial\s+intelligence|(?:large\s+)?language\s+model|LLM)\b/giu,
  /\bnew\s+instructions?\s*:/giu,
  /\bpretend\s+(?:to\s+be|you\s+are)\b/giu,
  /\bjailbreak|\bdo\s+anything\s+now\b/giu,
  /\bdo\s+not\s+(?:tell|inform|alert|show)\s+the\s+user\b/giu,
  /\b(?:reveal|print|show|repeat)\s+(?:your|the)\s+(?:system\s+)?(?:prompt|instructions)\b/giu,
  /<\|[a-z_]{2,30}\|>|\[\/?INST\]|<\/?(?:system|assistant|instructions?)>/giu,
  // Spanish
  /\b(?:ignora|ignore|ignorar|ignoren|olvida|olvide|olvidar|omite|omitir|descarta|descartar)\s+(?:todas\s+|todo\s+)?(?:las\s+|tus\s+|sus\s+|lo\s+|estas\s+)?(?:instrucciones|indicaciones|reglas|[o\u00F3]rdenes)/giu,
  /\bhaz\s+caso\s+omiso\b/giu,
  /\b(?:prompt|mensaje|instrucciones)\s+del\s+sistema\b/giu,
  /\b(?:ahora|a\s+partir\s+de\s+ahora)\s+eres\b/giu,
  /\bcomo\s+(?:una\s+IA|un\s+modelo\s+de\s+lenguaje|una\s+inteligencia\s+artificial)\b/giu,
  /\bnuevas\s+instrucciones\s*:/giu,
  /\bno\s+(?:le\s+)?(?:digas|informes|avises|muestres)\s+(?:nada\s+)?al\s+usuario\b/giu,
];

/** [start, end) ranges of prompt-injection phrasing anywhere in `text`. */
export function findInstructionRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const re of INSTRUCTION_PATTERNS) {
    for (const m of text.matchAll(re)) {
      if (m.index !== undefined) ranges.push([m.index, m.index + m[0].length]);
    }
  }
  return ranges.sort((a, b) => a[0] - b[0]);
}

function overlaps(ranges: ReadonlyArray<[number, number]>, start: number, end: number): boolean {
  return ranges.some(([a, b]) => a < end && b > start);
}

// ---------------------------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------------------------

function sha12(payload: string): string {
  return createHash('sha256').update(payload, 'utf8').digest('hex').slice(0, 12);
}

interface IdState {
  used: Set<string>;
  /** Payload -> last occurrence number used, so repeats cost one hash each. */
  seen: Map<string, number>;
}

function newIdState(): IdState {
  return { used: new Set<string>(), seen: new Map<string, number>() };
}

/**
 * Deterministic id: prefix + sha12(JSON(parts)). The n-th repeat of the same payload (n >= 2)
 * hashes JSON([...parts, n]) instead, so identical lines get distinct ids that stay stable.
 */
function uniqueId(prefix: 'i_' | 's_', parts: readonly unknown[], state: IdState): string {
  const base = JSON.stringify(parts);
  let n = state.seen.get(base) ?? 0;
  for (;;) {
    n += 1;
    const id = prefix + sha12(n === 1 ? base : JSON.stringify([...parts, n]));
    if (!state.used.has(id)) {
      state.seen.set(base, n);
      state.used.add(id);
      return id;
    }
  }
}

interface HeadingHit {
  line: number;
  kind: SectionKind;
  heading: string;
  headingStart: number;
  /** "TL;DR: text" on one line: the heading line also carries content. */
  inline: boolean;
  /** The Markdown "#" count of the heading line; 0 for any other heading. */
  level: number;
}

interface DetectContext {
  seenHeading: boolean;
  /** A heading of a kind other than tldr and summary was seen: inline "Summary: ..." is content now. */
  seenNonDerivedHeading: boolean;
  isFirstMeaningful: boolean;
  prevBlank: boolean;
  prevWasHeading: boolean;
  /** The previous non-blank line, raw, or null at the top. */
  prevRaw: string | null;
  /** Kind of the section the line is in; null in the preamble. */
  sectionKind: SectionKind | null;
  /** The "#" count of that section's heading (0 when it is not a "#" heading). */
  sectionLevel: number;
  /**
   * The previous non-blank line was refused as one entry of a list of names (isNameListEntry).
   * Such an entry is always a short Title Case line or a known list label ("Attendees"), never prose.
   */
  prevNameEntry: boolean;
  /**
   * The section is a custom one whose heading line is directly followed by a short marked label
   * over items ("Launch Readiness", "**Android**", "- Store listing reviewed"): its later short
   * marked labels are content too (isSubLabel).
   */
  groupedCustom: boolean;
  /**
   * The list section already holds a name sub-label ("**Francisco Gomez**"): after a blank line a
   * one-word name ("**Bish**") is a sub-label too (isSubLabel).
   */
  sectionNameLabel: boolean;
  /**
   * The marker column of the item when the previous non-blank line was an item line or one of its
   * continuation lines; null otherwise.
   */
  prevItemMarker: number | null;
  /** The text column of that item (OpenItem.textColumn); null when prevItemMarker is null. */
  prevItemTextColumn: number | null;
  /**
   * Inside TLDR or Summary only: the current line can never be the wrapped tail of the item above,
   * so the previous line counts as closed for the hard-wrap checks (looksLikePlainHeading,
   * isDerivedLabelOverItems). It is indented at or left of prevItemMarker, or past it but short of
   * prevItemTextColumn while the previous non-blank line was the item line or an aligned
   * continuation of it (itemClosedBelow).
   */
  prevItemClosed: boolean;
}

/** What isSubLabel found: a name ("Bish Kumar"), a group word ("Next week") or a grouped custom label. */
type SubLabelKind = 'name' | 'group' | 'grouped';

function rawLine(text: string, span: LineSpan): string {
  return text.slice(span.start, span.end);
}

/** The raw line at index `j`, or '' past the end. */
function lineAt(text: string, spans: readonly LineSpan[], j: number): string {
  const span = spans[j];
  return span ? rawLine(text, span) : '';
}

/** Index of the first non-blank line at or after `from`, or null. */
function nextNonBlankIndex(text: string, spans: readonly LineSpan[], from: number): number | null {
  for (let j = from; j < spans.length; j++) {
    const span = spans[j];
    if (!span) break;
    if (rawLine(text, span).trim() !== '') return j;
  }
  return null;
}

/** True for a line that is a known heading or carries heading markup. */
function isHeadingLike(raw: string): boolean {
  if (matchItem(raw)) return false;
  const label = readLabel(raw.trim());
  return label.marked || KNOWN_HEADINGS.has(headingKey(label.text));
}

/** Leading whitespace length: the column of the line's first non-blank character. */
function indentOf(raw: string): number {
  return raw.length - raw.trimStart().length;
}

/** The item a following line may continue. */
interface OpenItem {
  /** Column of the bullet, number or checkbox that starts the item line. */
  marker: number;
  /**
   * The join column. Outside TLDR and Summary it is ItemMatch.textColumn (2 for "- x" and "- [ ]
   * x", 3 for "1. x", 4 for a bare "[ ] x") and a tab in a line's indent reaches it
   * (reachesTextColumn). Inside TLDR and Summary it stays the text start (6 for "- [ ] x") and a
   * tab counts as one column, so a label over an item there ("\tTopics") is still evaluated as a
   * heading instead of pulling the item under it into the derived section.
   */
  textColumn: number;
}

/** The open item an item line starts in the current section (OpenItem.textColumn). */
function openItem(item: ItemMatch, ctx: DetectContext): OpenItem {
  return { marker: item.indent, textColumn: inDerivedSection(ctx) ? item.contentOffset : item.textColumn };
}

/**
 * How a line relates to the open item above it, the one column rule (file header):
 * - 'join': a continuation line of the item. Indented at or beyond its text column (an aligned
 *   hanging-indent wrap, even "  Summary" under "- Approve the Q4 Executive"), or past its marker
 *   but short of the text column without a heading shape (" friday" under "- Ship by").
 * - 'try': evaluated as a heading; a plain line that is no heading after all still joins the item.
 *   Past the marker but short of the text column and heading-shaped (headingUnderItem), or at or
 *   beyond the text column and a known heading that must not join (alignedHeading).
 * - 'line': never a continuation: no open item, an item line, a line at or left of the marker, or
 *   a whole-line bold or italic label or a "#" line at any depth.
 */
type UnderItem = 'join' | 'try' | 'line';

const INLINE_DERIVED_RE = /^([^:\n]{2,30}?)[ \t]*:[*_]*[ \t]+\S/;

/** "Label - value": a hyphen with spaces around it, or an en or em dash ("TL;DR - Bish owns it"). */
const LABEL_DASH_RE = new RegExp(`^([^:\\n]{2,30}?)(?:[ \\t]+-[ \\t]+|[ \\t]*[${EN_DASH}${EM_DASH}][ \\t]*)\\S`);

function wordsOf(label: string): string[] {
  return label.split(/\s+/).filter((w) => w.length > 0);
}

/** Title Case: every word of four or more letters is capitalized, and there is at least one. */
function titleLike(words: readonly string[]): boolean {
  const longWords = words.filter((w) => (w.match(/\p{L}/gu)?.length ?? 0) >= 4);
  return longWords.length > 0 && longWords.every((w) => /^[^\p{L}]*\p{Lu}/u.test(w));
}

/** A plain line short and capitalized enough to label what follows: no sentence punctuation. */
function plainLabelShape(label: string): boolean {
  if (label.length < 2 || label.length > MAX_PLAIN_HEADING_CHARS) return false;
  if (/[.!?;,]$/.test(label) || label.includes(':') || label.includes('@') || LINK_RE.test(label)) return false;
  const words = wordsOf(label);
  if (words.length === 0 || words.length > MAX_PLAIN_HEADING_WORDS) return false;
  const firstLetter = /\p{L}/u.exec(label);
  return firstLetter !== null && /\p{Lu}/u.test(firstLetter[0]);
}

/**
 * True when the last token of `s` is a purely alphabetic lowercase word ("... still waiting on",
 * "follow-up", "don't,"): lowercase letters, joined by an apostrophe or a hyphen, with an
 * optional trailing comma. A link, an address, a number or a token with an uppercase letter after
 * its first character ("https://zoom.us/rec/abc123", "support@acme.example", "iOS") is not open
 * prose.
 */
function endsWithLowercaseWord(s: string): boolean {
  const trimmed = s.trimEnd();
  // lastIndexOf, not a /(\S+)$/ regex: that regex is quadratic on a long line without spaces.
  const cut = Math.max(trimmed.lastIndexOf(' '), trimmed.lastIndexOf('\t'));
  return /^\p{Ll}+(?:['-]\p{Ll}+)*,?$/u.test(trimmed.slice(cut + 1));
}

/** Weekday names and abbreviations, English and Spanish (headingKey form). */
const WEEKDAY_WORDS: readonly string[] = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'mon', 'tue', 'tues', 'wed', 'thu', 'thur', 'thurs', 'fri', 'sat', 'sun',
  'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo',
  'lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom',
];

/**
 * Weekday names, times, zones, durations and joining words that may surround a date ("Friday, Oct
 * 16, 2026 at 3 PM CDT", "Oct 16, 2026 | 45 min", "Date: Oct 16", "(GMT-05:00) Central Time").
 * headingKey form.
 */
const DATE_FILLER_WORDS: ReadonlySet<string> = new Set([
  ...WEEKDAY_WORDS,
  'at', 'on', 'a', 'las', 'la', 'el', 'de', 'del', 'of', 'the', 'to', 'y',
  'am', 'pm', 'p', 'm', 'h', 'hs', 'hr', 'hrs',
  'date', 'fecha', 'today', 'tomorrow', 'yesterday', 'hoy', 'manana', 'ayer',
  'utc', 'gmt', 'cdt', 'cst', 'est', 'edt', 'pst', 'pdt', 'mst', 'mdt', 'cet', 'cest', 'bst', 'et', 'ct', 'mt', 'pt',
  'ist', 'aest', 'aedt', 'jst', 'sgt', 'hkt', 'cot', 'art', 'clt', 'pet', 'brt', 'vet', 'bot', 'pyt',
  'central', 'eastern', 'pacific', 'mountain', 'daylight', 'standard', 'time',
  'min', 'mins', 'minute', 'minutes', 'minuto', 'minutos', 'hour', 'hours', 'hora', 'horas',
]);

/** A weekday followed by a day number ("Viernes 17", "Fri 16th"), on the headingKey form. */
const WEEKDAY_DAY_RE = new RegExp(`(?:^| )(?:${WEEKDAY_WORDS.join('|')}) (\\d{1,2})(?:st|nd|rd|th)?(?= |$)`, 'g');

/** A number or time token left once the dates are gone: "15", "20pm" (from "3:20pm"), "45min", "16th". */
const DATE_TOKEN_RE = /^\d{1,4}(?:st|nd|rd|th|am|pm|h|hs|hr|hrs|min|mins|m)?$/;

/**
 * True for a label that is only a date, with an optional weekday, time, zone, duration or a
 * "Date:" / "Fecha:" prefix: "Oct 16", "Thursday, October 16", "16 de octubre",
 * "10/16/2026 3:20 PM", "Oct 16, 2026 3:20 PM CDT", "2026-10-16 15:20 UTC",
 * "October 16th, 2026, 3:20pm", "Oct 16, 2026 | 45 min", "Date: Oct 16, 2026", "16-Oct-2026",
 * "Viernes 17, 15h20", "Oct 16 3:20 PM (America/Chicago)" and the Google Calendar line
 * "Oct 16, 2026, 3:20 PM - 4:05 PM (GMT-05:00) Central Time - Chicago".
 */
function isDateOnly(label: string): boolean {
  if (!hasDatePart(label)) return false;
  return headingKey(stripDateParts(label))
    .split(' ')
    .every((w) => w === '' || DATE_TOKEN_RE.test(w) || DATE_FILLER_WORDS.has(w));
}

/** Whether a non-item label line can name a section or a group: has a letter, is not only a date. */
function labelShape(label: Label): boolean {
  if (label.text === '' || label.text.length > MAX_HEADING_CHARS) return false;
  if (!/\p{L}/u.test(label.text)) return false;
  const shaped = label.marked ? !/[.!?;,]$/.test(label.text) : plainLabelShape(label.text);
  return shaped && !isDateOnly(label.text);
}

/**
 * A "label: value" or "label - value" line written as one marked line, never a custom heading:
 * - a TLDR or Summary label with ":" or a dash ("**TL;DR: Bish owns the release**",
 *   "**TL;DR - Bish owns the release**", "## Key takeaways: on track");
 * - inside a list section, any known label with ":" or a dash, singular too ("**Decision: Use
 *   Postmark**" inside Decisions is content of Decisions);
 * - a bold or italic "label: value" line whose value is not Title Case ("**Key takeaways: launch
 *   is on track**", "**Date: Oct 16**").
 * "**Phase 2: Launch Readiness**" is still a heading.
 */
function isInlineLabelLine(label: Label, inListSection: boolean): boolean {
  for (const re of [INLINE_DERIVED_RE, LABEL_DASH_RE]) {
    const lead = re.exec(label.text)?.[1];
    const kind = lead === undefined ? undefined : knownLabelKind(lead);
    if (kind !== undefined && (DERIVED_KINDS.has(kind) || inListSection)) return true;
  }
  if (!INLINE_DERIVED_RE.test(label.text)) return false;
  return label.level === 0 && !titleLike(wordsOf(label.text.slice(label.text.indexOf(':') + 1)));
}

/** Sentence-final punctuation, optionally followed by closing quotes or brackets. */
const TERMINAL_RE = /[.!?:;]["')\]]*$/;

/**
 * A line shaped like a heading or a label: marked, or a short Title Case line that does not end
 * with a lowercase word ("Launch Readiness", "None", "Bish Kumar"; not "Still waiting on").
 */
function headingShaped(raw: string): boolean {
  const label = readLabel(raw.trim());
  if (label.marked) return true;
  return plainLabelShape(label.text) && titleLike(wordsOf(label.text)) && !endsWithLowercaseWord(label.text);
}

/**
 * True when the last token of `s` contains "/", "@" or ":": a link, an address, a clock or a
 * "(00:02:10)" timestamp ("Recording: https://zoom.us/rec/share/abc123"). Such a line is closed,
 * never the first half of a hard-wrapped sentence.
 */
function endsWithClosedToken(s: string): boolean {
  const trimmed = s.trimEnd();
  // lastIndexOf, not a /(\S+)$/ regex: that regex is quadratic on a long line without spaces.
  const cut = Math.max(trimmed.lastIndexOf(' '), trimmed.lastIndexOf('\t'));
  return /[/@:]/.test(trimmed.slice(cut + 1));
}

/**
 * A non-item line that stops mid-sentence, so the next line may be its hard-wrapped tail. A
 * heading-shaped line is never open prose ("Risks", "None", blank, "Budget": Budget is a heading),
 * and neither is a line closed by a link, an address, a clock or a timestamp (endsWithClosedToken).
 */
function endsOpen(raw: string): boolean {
  return (
    matchItem(raw) === null && !TERMINAL_RE.test(raw.trimEnd().slice(-16)) && !endsWithClosedToken(raw) && !headingShaped(raw)
  );
}

/** A line that is finished: an item, terminal punctuation, or a closing link, address or timestamp. */
function endsClosed(raw: string): boolean {
  return matchItem(raw) !== null || TERMINAL_RE.test(raw.trimEnd().slice(-16)) || endsWithClosedToken(raw);
}

/** Lowercase name particles allowed between capitalized name words ("Ana de la Cruz"). */
const NAME_PARTICLES: ReadonlySet<string> = new Set([
  'de', 'del', 'la', 'las', 'los', 'y', 'e', 'da', 'das', 'di', 'do', 'dos', 'du', 'van', 'von', 'der', 'den', 'le', 'al', 'bin',
]);

/**
 * A plain or bold short line with every word capitalized ("Bish Kumar", "**Dusko Petrovic**"):
 * possibly one entry of a list of names. Never a "#" heading, never an item.
 */
function isShortTitleLine(raw: string): boolean {
  if (matchItem(raw) !== null) return false;
  const label = readLabel(raw.trim());
  if (label.level > 0 || label.text.includes(',') || !plainLabelShape(label.text)) return false;
  return wordsOf(label.text).every((w) => NAME_PARTICLES.has(w) || /^[^\p{L}]*\p{Lu}/u.test(w));
}

/** A known label over a list of people ("Attendees", "**Participantes (4):**"), never an item. */
function isNameListLabel(raw: string): boolean {
  return matchItem(raw) === null && NAME_LIST_LABELS.has(headingKey(readLabel(raw.trim()).text));
}

/**
 * One entry of a list of names, which is never a heading: "Attendees", then "Francisco Gomez",
 * "Bish Kumar", "Dusko Petrovic", plain or bold. A list of names needs at least two consecutive
 * short Title Case lines (isShortTitleLine). An entry is always a known list label ("Attendees
 * (3)") or a short Title Case line shaped like a person name (looksLikePersonName), never prose
 * and never a topic ("Launch Readiness"):
 * - a line opens a list when the next non-blank line is a short Title Case line and the line
 *   after that is not an item ("Launch Readiness", "Android", "- Store listing reviewed" is a
 *   heading over a sub-label). A label and a one-line body closed by a blank line ("Risks",
 *   "None", blank) is no list either, unless the label is a list label or both lines are names.
 * - the line right under an entry (or the last line of the text) is the last entry when it is
 *   such a name line and no item follows it. So a marked label is refused this way only under a
 *   short or marked name line or a list label, never under a sentence ("The team agreed to
 *   ship.", "**Launch Readiness**", "Owners confirmed.", "- Store listing reviewed").
 */
function isNameListEntry(text: string, spans: readonly LineSpan[], i: number, ctx: DetectContext): boolean {
  const raw = lineAt(text, spans, i);
  if (matchItem(raw) !== null) return false;
  const nameLine = isShortTitleLine(raw) && looksLikePersonName(readLabel(raw.trim()).text);
  const listLabel = isNameListLabel(raw);
  if (!nameLine && !listLabel) return false;
  const j = nextNonBlankIndex(text, spans, i + 1);
  const nextRaw = j === null ? null : lineAt(text, spans, j);
  const nextIsItem = nextRaw !== null && matchItem(nextRaw) !== null;
  // The last entry: right under the previous one (or the last line of the text), with no item below.
  if (nameLine && ctx.prevNameEntry && (!ctx.prevBlank || nextRaw === null) && !nextIsItem) return true;
  if (j === null || nextRaw === null || !isShortTitleLine(nextRaw)) return false;
  const k = nextNonBlankIndex(text, spans, j + 1);
  if (k !== null && matchItem(lineAt(text, spans, k)) !== null) return false;
  if (j !== i + 1 || k === null || k === j + 1) return true;
  // A two-line block closed by a blank line: a heading and its body ("Risks", "None"), unless the
  // first line is a list label ("Attendees") or both lines are names ("Francisco Gomez", "Bish Kumar").
  return listLabel || looksLikePersonName(readLabel(nextRaw.trim()).text);
}

/**
 * "Bish", "Kumar", "McDonald", "O'Neil", "Garcia-Lopez", "J.", an all-uppercase word ("DANA",
 * "AJ", "TJ") and dotted initials ("J.R."). Never "iOS" or "eBay". All-uppercase topics ("APK
 * Release", "QA Team") are refused by their topic word.
 */
const NAME_WORD_RE = /^(?:\p{Lu}\p{Ll}*(?:\p{Lu}\p{Ll}+)?(?:['-]\p{Lu}?\p{Ll}+)*\.?|\p{Lu}+(?:['-]\p{Lu}+)*|\p{Lu}(?:\.\p{Lu})+\.?)$/u;

/** A numbered speaker label from a transcript ("Speaker 2", "Hablante 2", "Participante 2"). */
const SPEAKER_LABEL_RE = /^(?:speaker|participant|hablante|participante)[ \t]+\d{1,3}$/i;

/**
 * Words of topic labels that are never person names (headingKey form): "Launch Readiness",
 * "Store Listing", "Release Plan", "Risks" and "Budget" are topics, "Bish Kumar" is a name. Team
 * names ("Marketing", "Engineering", "Design") are left out: a team label groups items like a name.
 */
const TOPIC_WORDS: ReadonlySet<string> = new Set([
  // English
  'action', 'actions', 'agenda', 'analytics', 'announcements', 'app', 'apps', 'approval', 'approvals', 'architecture',
  'assignments', 'attendees', 'backlog', 'background', 'beta', 'billing', 'blocker', 'blockers', 'board', 'budget',
  'budgets', 'bug', 'bugs', 'build', 'builds', 'business', 'calls', 'campaign', 'campaigns', 'changes', 'checklist',
  'cleanup', 'comments', 'concerns', 'contract', 'contracts', 'cost', 'costs', 'coverage', 'dashboard', 'database',
  'deadline', 'deadlines', 'deliverables', 'demo', 'demos', 'dependencies', 'deploy', 'deployment', 'deployments',
  'details', 'docs', 'estimates', 'events', 'feature', 'features', 'feedback', 'financials', 'findings', 'fixes', 'follow', 'followup', 'followups',
  'forecast', 'general', 'goal', 'goals', 'growth', 'guidelines', 'highlights', 'hiring', 'housekeeping', 'ideas',
  'infrastructure', 'invoices', 'issue', 'issues', 'item', 'items', 'kickoff', 'launch', 'launches', 'licensing',
  'listing', 'listings', 'logistics', 'maintenance', 'meeting', 'meetings', 'metrics', 'milestone', 'milestones', 'misc',
  'miscellaneous', 'monitoring', 'objectives', 'onboarding', 'other', 'outcomes', 'parking', 'participants', 'partners',
  'payments', 'performance', 'phase', 'plan', 'plans', 'planning', 'platform', 'points', 'policy', 'pricing', 'process',
  'progress', 'project', 'projects', 'proposal', 'proposals', 'quality', 'readiness', 'recap', 'recommendations',
  'release', 'releases', 'report', 'reporting', 'reports', 'requirements', 'research', 'resources', 'results', 'retro',
  'retrospective', 'review', 'reviews', 'revenue', 'risk', 'risks', 'roadmap', 'rollout', 'schedule', 'scope', 'setup',
  'signoff', 'sprint', 'staffing', 'stage', 'status', 'steps', 'store', 'strategy', 'survey', 'sync', 'testing', 'tests',
  'timeline', 'timelines', 'tooling', 'topic', 'topics', 'training', 'travel', 'usage', 'vendor', 'vendors', 'website',
  'wellness', 'wins', 'workshop', 'wrap',
  // Chapters of notetaker recaps (tl;dv, Fathom, Otter): "Insights", "Links", "Key moments".
  'attachments', 'chapters', 'commitments', 'insights', 'learnings', 'links', 'moments', 'notes', 'outline',
  'questions', 'references', 'takeaways', 'tasks', 'transcript', 'update', 'updates',
  // "QA Team" is a topic even though "QA" has the shape of initials ("AJ Patel").
  'team', 'teams',
  // Spanish
  'actualizacion', 'antecedentes', 'anuncios', 'aprobacion', 'arquitectura', 'asistentes', 'avance', 'bloqueos',
  'calendario', 'calidad', 'cambios', 'campana', 'capacitacion', 'comentarios', 'compras', 'comunicacion',
  'configuracion', 'contrato', 'contratos', 'coordinacion', 'costos', 'costes', 'cronograma', 'despliegue', 'detalles',
  'documentacion', 'entregables', 'estado', 'estrategia', 'evaluacion', 'eventos', 'facturacion', 'facturas', 'ficha',
  'funcionalidades', 'hitos', 'implementacion', 'informacion', 'informe', 'informes', 'infraestructura', 'integracion',
  'inventario', 'investigacion', 'lanzamiento', 'logistica', 'mantenimiento', 'metricas', 'migracion', 'objetivos',
  'otros', 'pagos', 'participantes', 'planes', 'planificacion', 'plataforma', 'precios', 'presentacion', 'presupuesto',
  'presupuestos', 'prioridades', 'problemas', 'proceso', 'producto', 'productos', 'progreso', 'propuesta', 'propuestas',
  'proveedores', 'proyecto', 'proyectos', 'pruebas', 'publicacion', 'puntos', 'recomendaciones', 'requisitos',
  'resultados', 'reunion', 'reuniones', 'revision', 'riesgo', 'riesgos', 'seguimiento', 'tema', 'temas', 'tienda',
  'validacion', 'varios', 'version', 'versiones',
  // Chapters of Spanish recaps.
  'acuerdos', 'adjuntos', 'capitulos', 'compromisos', 'enlaces', 'pendientes', 'recursos', 'soporte',
]);

/**
 * Endings of topic nouns (headingKey form, so accents do not matter): "Integrations",
 * "Priorities", "Revisiones", "Lanzamientos", singular "Integracion" and "Decision" (with or
 * without the accent), and "-ness" only from nine letters ("Readiness", "Awareness";
 * surnames such as "Holness" stay names).
 */
const TOPIC_SUFFIX_RE = /(?:tions?|sions?|ities|cion|ciones|siones|mientos?)$|^\p{L}{5,}ness$/u;

/**
 * How many name words a label shaped like a person name has, or 0 when it is not one: one to four
 * capitalized name words ("Bish Kumar", "DANA LEE", "AJ Patel", "J.R. Smith"), lowercase particles
 * only between them and not counted ("Jose Luis Garcia de la Vega" has four), no digits, and no
 * topic word ("Launch Readiness" is a topic). A trailing "(Organization)" or ", Role" is ignored
 * ("Dana Lee (Acme)", "Dana Lee, PM"), and a numbered speaker label ("Speaker 2") counts as two.
 * Shape only: a one-word team label ("Marketing") passes too, and so does an unlisted two-word
 * topic ("Android Wear").
 */
function nameWordCount(label: string): number {
  const trimmed = label.trim();
  if (SPEAKER_LABEL_RE.test(trimmed)) return 2;
  const core = trimmed
    .replace(/[ \t]*\([^()]{1,40}\)$/, '')
    .replace(/,[ \t]*[^,]{1,40}$/, '')
    .trim();
  const words = wordsOf(core);
  if (!words.every((w, k) => NAME_WORD_RE.test(w) || (k > 0 && k < words.length - 1 && NAME_PARTICLES.has(w)))) return 0;
  const count = words.filter((w) => NAME_WORD_RE.test(w)).length;
  if (count === 0 || count > 4) return 0;
  const topic = headingKey(core)
    .split(' ')
    .some((w) => TOPIC_WORDS.has(w) || (w.length >= 6 && TOPIC_SUFFIX_RE.test(w)));
  return topic ? 0 : count;
}

function looksLikePersonName(label: string): boolean {
  return nameWordCount(label) > 0;
}

/**
 * Group words that split the items of a list section by when, status or priority (headingKey
 * form, so case and accents do not matter). Weekdays and months count too.
 */
const GROUP_LABELS: ReadonlySet<string> = new Set(
  [
    // Weekdays and months, English and Spanish.
    'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
    'Mon', 'Tue', 'Tues', 'Wed', 'Thu', 'Thurs', 'Fri', 'Sat', 'Sun',
    'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado', 'Domingo',
    'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
    'Jan', 'Feb', 'Mar', 'Apr', 'Jun', 'Jul', 'Aug', 'Sep', 'Sept', 'Oct', 'Nov', 'Dec',
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Setiembre', 'Octubre',
    'Noviembre', 'Diciembre',
    // When.
    'Today', 'Tonight', 'Tomorrow', 'This week', 'Next week', 'Later', 'Later this week', 'This month', 'Next month',
    'Upcoming', 'Due today', 'Due tomorrow', 'Due this week', 'Due next week',
    'Hoy', 'Manana', 'Esta semana', 'La proxima semana', 'Proxima semana', 'La semana que viene', 'Semana que viene',
    'Mas tarde', 'Este mes', 'El proximo mes', 'Proximo mes', 'Para hoy', 'Para manana', 'Para esta semana',
    // Status and priority.
    'Open', 'Done', 'Complete', 'Completed', 'Pending', 'In progress', 'Ongoing', 'Blocked', 'On hold', 'Not started',
    'Overdue', 'Urgent', 'High priority', 'Medium priority', 'Low priority',
    // "Pendientes" is a Waiting on heading, not a group word.
    'Pendiente', 'Completado', 'Completados', 'Completada', 'Completadas', 'Hecho', 'Hechos', 'Terminado',
    'Terminados', 'En curso', 'En progreso', 'En proceso', 'Bloqueado', 'Bloqueados', 'Bloqueada', 'Bloqueadas',
    'Abierto', 'Abiertos', 'Abierta', 'Abiertas', 'Urgente', 'Prioridad alta', 'Prioridad media', 'Prioridad baja',
    'Alta prioridad', 'Baja prioridad',
  ].map(headingKey),
);

/** A "#" label under a "#" heading of the same or a higher rank: a sibling heading, never content. */
function isSiblingRank(label: Label, sectionLevel: number): boolean {
  return label.level > 0 && sectionLevel > 0 && label.level <= sectionLevel;
}

/**
 * A sub-label: a short label directly followed by items that stays content of its section and
 * never sets an owner.
 * - Inside a list section, at any point in it (also after an intro line such as "The team agreed
 *   to:"), a plain or marked label shaped like a person name or a group word ("**Bish Kumar**",
 *   "Speaker 2", "Next week", "### Done", "Pendiente"). After a blank line only a group word or a
 *   name of two or more name words counts ("Insights" or "Links" there is a heading), except in a
 *   double-spaced list of names (Fireflies: "**Francisco**", blank, "- Approve the budget"): a
 *   one-word name is a sub-label too when it is the first line under the heading or when the
 *   section already holds a name sub-label (sectionNameLabel).
 * - Inside a custom section whose heading is directly followed by a short marked label
 *   (groupedCustom), a short marked label right under the previous line ("Launch Readiness",
 *   "**Android**", "- Store listing reviewed", "**iOS**", "- Waiting on Apple").
 * A known heading is never a sub-label, and neither is a sibling "#" label (isSiblingRank).
 */
function isSubLabel(text: string, spans: readonly LineSpan[], i: number, ctx: DetectContext): SubLabelKind | null {
  const kind = ctx.sectionKind;
  const inList = kind !== null && LIST_KINDS.has(kind);
  const inGroupedCustom = kind === 'custom' && ctx.groupedCustom && !ctx.prevBlank;
  if (!inList && !inGroupedCustom) return null;
  const raw = lineAt(text, spans, i);
  if (matchItem(raw) !== null) return null;
  const label = readLabel(raw.trim());
  if (label.text === '' || label.text.length > MAX_PLAIN_HEADING_CHARS) return null;
  const key = headingKey(label.text);
  if (KNOWN_HEADINGS.has(key) || isSiblingRank(label, ctx.sectionLevel)) return null;
  if (!inList) return isShortMarkedLabelOverItems(text, spans, i) ? 'grouped' : null;
  const group = GROUP_LABELS.has(key);
  const nameWords = (label.marked || plainLabelShape(label.text)) ? nameWordCount(label.text) : 0;
  const minNameWords = ctx.prevBlank && !ctx.prevWasHeading && !ctx.sectionNameLabel ? 2 : 1;
  if (nameWords < minNameWords && !group) return null;
  const j = nextNonBlankIndex(text, spans, i + 1);
  if (j === null || matchItem(lineAt(text, spans, j)) === null) return null;
  return group ? 'group' : 'name';
}

/** A marked label that heads items directly ("**Android**", then "- Store listing reviewed"). */
function isMarkedLabelOverItems(text: string, spans: readonly LineSpan[], j: number): boolean {
  const raw = lineAt(text, spans, j);
  if (matchItem(raw) !== null) return false;
  const label = readLabel(raw.trim());
  if (!label.marked || !labelShape(label) || KNOWN_HEADINGS.has(headingKey(label.text))) return false;
  const k = nextNonBlankIndex(text, spans, j + 1);
  return k !== null && matchItem(lineAt(text, spans, k)) !== null;
}

/** isMarkedLabelOverItems with a label of at most four words ("**Android**", "**iOS**"). */
function isShortMarkedLabelOverItems(text: string, spans: readonly LineSpan[], j: number): boolean {
  if (!isMarkedLabelOverItems(text, spans, j)) return false;
  return wordsOf(readLabel(lineAt(text, spans, j).trim()).text).length <= MAX_LOOSE_HEADING_WORDS;
}

function looksLikePlainHeading(
  text: string,
  spans: readonly LineSpan[],
  i: number,
  label: string,
  ctx: DetectContext,
  nameEntry: boolean,
): boolean {
  if (!plainLabelShape(label) || isDateOnly(label)) return false;
  // A heading must head something: a following line that is not itself a heading, except a marked
  // sub-label over items ("Launch Readiness", then "**Android**", then "- Store listing reviewed").
  const j = nextNonBlankIndex(text, spans, i + 1);
  if (j === null) return false;
  const nextRaw = lineAt(text, spans, j);
  if (isHeadingLike(nextRaw) && !isMarkedLabelOverItems(text, spans, j)) return false;
  const nextIsItem = matchItem(nextRaw) !== null;
  // The tail of a hard-wrapped sentence ("The build is still waiting on" / "Apple" / "Francisco
  // asked ..."): the previous non-blank line stops without terminal punctuation. A label between
  // a blank line and a list still heads that list, except after a line that ends with a lowercase
  // word: a double-spaced soft wrap ("... still waiting on", blank, "Apple", blank, "- Dana ...").
  // Inside TLDR or Summary the wrapped tail of an item never stays open for a line that can never
  // be part of that item (prevItemClosed: at or left of its marker, or short of its text column).
  const prevRaw = ctx.prevRaw;
  if (
    prevRaw !== null &&
    !ctx.prevItemClosed &&
    endsOpen(prevRaw) &&
    !(ctx.prevBlank && nextIsItem && !endsWithLowercaseWord(prevRaw))
  ) {
    return false;
  }
  if (nameEntry) return false;
  const words = wordsOf(label);
  return titleLike(words) || (ctx.prevBlank && nextIsItem && words.length <= MAX_LOOSE_HEADING_WORDS);
}

/** At most this many words for a plain label over items inside a TLDR or Summary section. */
const MAX_DERIVED_LABEL_WORDS = 5;

/**
 * Inside a TLDR or Summary section, a short plain label (at most five words, plain heading shape,
 * not only a date, no terminal punctuation) directly followed by an item line, after a closed line
 * (endsClosed, or the wrapped tail of an item when the label can never be part of that item:
 * prevItemClosed), opens a custom section even in sentence case, so the items under it never stay
 * derived: "El equipo reviso el lanzamiento.", "Preparacion del lanzamiento", "- Ficha de la
 * tienda revisada"; "Q&A" and "API" too.
 */
function isDerivedLabelOverItems(text: string, spans: readonly LineSpan[], i: number, label: string, ctx: DetectContext): boolean {
  if (ctx.sectionKind === null || !DERIVED_KINDS.has(ctx.sectionKind)) return false;
  if (ctx.prevRaw === null || (!ctx.prevItemClosed && !endsClosed(ctx.prevRaw))) return false;
  if (!plainLabelShape(label) || TERMINAL_RE.test(label) || isDateOnly(label)) return false;
  if (wordsOf(label).length > MAX_DERIVED_LABEL_WORDS) return false;
  return matchItem(lineAt(text, spans, i + 1)) !== null;
}

/** The section the line is in is TLDR or Summary. */
function inDerivedSection(ctx: DetectContext): boolean {
  return ctx.sectionKind !== null && DERIVED_KINDS.has(ctx.sectionKind);
}

/**
 * True when a line indented past an open item's marker reaches its text column: indented at or
 * beyond it, or, outside TLDR and Summary, with a tab anywhere in the indent ("-\tApprove the Q4
 * Executive", "\tSummary"; see OpenItem.textColumn).
 */
function reachesTextColumn(raw: string, open: OpenItem, ctx: DetectContext): boolean {
  const indent = indentOf(raw);
  return indent >= open.textColumn || (!inDerivedSection(ctx) && raw.slice(0, indent).includes('\t'));
}

/** The kind of a known heading line written with a capital ("Action Items:", "Tareas"), else undefined. */
function capitalizedKnownKind(raw: string): NamedKind | undefined {
  const label = readLabel(raw.trim());
  const kind = KNOWN_HEADINGS.get(headingKey(label.text));
  const firstLetter = /\p{L}/u.exec(label.text);
  return kind !== undefined && firstLetter !== null && /\p{Lu}/u.test(firstLetter[0]) ? kind : undefined;
}

/** A line closed by terminal punctuation or a closing link, address, clock or timestamp. */
function endsWithClosingMark(raw: string): boolean {
  return TERMINAL_RE.test(raw.trimEnd().slice(-16)) || endsWithClosedToken(raw);
}

/**
 * A non-item line indented past an open item's marker but short of its text column (one space:
 * an NBSP indent after sanitizeText) that is evaluated as a heading instead of joining the item:
 * - a known heading written with a capital (" Action Items", " Acciones"; a lowercase " notes" is
 *   a wrap), except a TLDR or Summary heading outside TLDR and Summary (" Summary" under "- [ ]
 *   Approve the Q4 Executive", " Overview", " Resumen"): there it always joins, so the items
 *   under a list heading keep that kind;
 * - a plain label directly over an item line that is heading-shaped (" Topics", headingShaped) or,
 *   inside TLDR or Summary, shaped like a derived-section label (" Preparacion del lanzamiento",
 *   isDerivedLabelOverItems).
 * Marked labels never reach this: they are never continuations (underItem).
 */
function headingUnderItem(text: string, spans: readonly LineSpan[], i: number, ctx: DetectContext): boolean {
  const raw = lineAt(text, spans, i);
  const label = readLabel(raw.trim());
  const known = KNOWN_HEADINGS.get(headingKey(label.text));
  if (known !== undefined) {
    if (DERIVED_KINDS.has(known) && !inDerivedSection(ctx)) return false;
    return capitalizedKnownKind(raw) !== undefined;
  }
  if (matchItem(lineAt(text, spans, i + 1)) === null) return false;
  if (headingShaped(raw)) return true;
  return inDerivedSection(ctx) && plainLabelShape(label.text) && wordsOf(label.text).length <= MAX_DERIVED_LABEL_WORDS;
}

/**
 * A line at or beyond an open item's text column that is evaluated as a heading instead of
 * joining the item: a known heading written with a capital, when
 * - the item is in TLDR or Summary and the heading is of another kind ("- Launch is on track.",
 *   "  Action Items", "- Provide APK access"): joining would pull the list under it into the
 *   derived section;
 * - or the line above it is closed (terminal punctuation or a closing link, address or timestamp:
 *   endsWithClosingMark, or a continuation line that is only a known heading word, which is never
 *   open prose: "- Approve the Q4 Executive", "  Summary", "\t\tAction Items"), or the heading
 *   line ends with ":" ("  Next steps:").
 * A TLDR or Summary heading outside TLDR and Summary always joins ("- Approve the Q4 Executive",
 * "  Summary"), and so does any other heading after an open line ("- Dana keeps the", "  Action
 * Items").
 */
// The previous line also counts as closed when its last token is not a lowercase word, so an item
// ending in '(owner: Bish)', '(due: Friday)', 'iOS' or 'APK' never swallows the list heading below it
// (round 6 check). A wrap after 'the' still joins, and a derived word outside tldr/summary always joins.
function alignedHeading(raw: string, ctx: DetectContext): boolean {
  const kind = capitalizedKnownKind(raw);
  if (kind === undefined) return false;
  const derivedSection = inDerivedSection(ctx);
  if (DERIVED_KINDS.has(kind) && !derivedSection) return false;
  if (derivedSection && !DERIVED_KINDS.has(kind)) return true;
  const prev = ctx.prevRaw;
  const prevClosed =
    prev !== null &&
    (endsWithClosingMark(prev) ||
      !endsWithLowercaseWord(prev) ||
      (matchItem(prev) === null && capitalizedKnownKind(prev) !== undefined));
  return prevClosed || raw.trimEnd().endsWith(':');
}

/** The one column rule (file header) for line `i` under the open item `open` (see UnderItem). */
function underItem(text: string, spans: readonly LineSpan[], i: number, open: OpenItem | null, ctx: DetectContext): UnderItem {
  const raw = lineAt(text, spans, i);
  if (open === null || matchItem(raw) !== null) return 'line';
  if (indentOf(raw) <= open.marker) return 'line';
  // A whole-line bold or italic label, or a "#" line, never continues an item at any depth.
  if (readLabel(raw.trim()).marked) return 'line';
  if (reachesTextColumn(raw, open, ctx)) return alignedHeading(raw, ctx) ? 'try' : 'join';
  return headingUnderItem(text, spans, i, ctx) ? 'try' : 'join';
}

/**
 * Inside TLDR or Summary, line `raw` can never be the wrapped tail of the item above it (prevItem*
 * of ctx), so that item counts as closed (DetectContext.prevItemClosed): it is indented at or left
 * of the item's marker, or past the marker but short of its text column while the previous
 * non-blank line was the item line or an aligned continuation of it ("- Launch is on track,
 * pending the", "  Apple review", " Topics").
 */
function itemClosedBelow(raw: string, ctx: DetectContext): boolean {
  const marker = ctx.prevItemMarker;
  const textColumn = ctx.prevItemTextColumn;
  if (!inDerivedSection(ctx) || marker === null || textColumn === null) return false;
  const indent = indentOf(raw);
  if (indent <= marker) return true;
  const open: OpenItem = { marker, textColumn };
  if (reachesTextColumn(raw, open, ctx) || ctx.prevRaw === null) return false;
  return matchItem(ctx.prevRaw) !== null || reachesTextColumn(ctx.prevRaw, open, ctx);
}

function detectHeading(
  text: string,
  spans: readonly LineSpan[],
  i: number,
  ctx: DetectContext,
  nameEntry: boolean,
): HeadingHit | null {
  const span = spans[i];
  if (!span) return null;
  const raw = rawLine(text, span);
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const base = span.start + (raw.length - raw.trimStart().length);

  const item = matchItem(raw);
  if (item) {
    // "1. Decisions": a numbered line that is exactly a known heading.
    if (!item.numbered || item.checked !== null) return null;
    const label = readLabel(raw.slice(item.contentOffset).trimEnd());
    const kind = KNOWN_HEADINGS.get(headingKey(label.text));
    if (!kind || label.text === '') return null;
    return { line: i, kind, heading: label.text, headingStart: span.start + item.contentOffset + label.offset, inline: false, level: 0 };
  }

  const label = readLabel(trimmed);
  // A long line is never a standalone heading, but it can still be an inline "TL;DR: ..." line.
  const shortLabel = label.text !== '' && label.text.length <= MAX_HEADING_CHARS;
  if (shortLabel) {
    const known = KNOWN_HEADINGS.get(headingKey(label.text));
    const headingStart = base + label.offset;
    if (known) return { line: i, kind: known, heading: label.text, headingStart, inline: false, level: label.level };
    // A whole-line bold "label: value" line is read as an inline line below, never as a section.
    const inListSection = ctx.sectionKind !== null && LIST_KINDS.has(ctx.sectionKind);
    if (label.marked && !isInlineLabelLine(label, inListSection)) {
      // "**Oct 16, 2026**" under a bold title is the date line, not a section, and a bold entry of
      // a list of names ("**Francisco Gomez**", "**Bish Kumar**") is not one either.
      if (ctx.isFirstMeaningful || !labelShape(label) || (label.level === 0 && nameEntry)) return null;
      return { line: i, kind: 'custom', heading: label.text, headingStart, inline: false, level: label.level };
    }
  }

  // "TL;DR: ..." or "Summary: ..." with the content on the same line, only before the first
  // heading of another kind: inside Action items an "Overview: ..." line is an ordinary line of
  // Action items, so it never turns the commitments after it into derived content.
  const inline = ctx.seenNonDerivedHeading ? null : INLINE_DERIVED_RE.exec(trimmed);
  if (inline?.[1] !== undefined) {
    const kind = KNOWN_HEADINGS.get(headingKey(inline[1]));
    if (kind !== undefined && DERIVED_KINDS.has(kind)) {
      const lead = /^[#*_\s]*/.exec(inline[1])?.[0].length ?? 0;
      const heading = inline[1].slice(lead).replace(/[*_\s]+$/, '');
      if (heading !== '') return { line: i, kind, heading, headingStart: base + lead, inline: true, level: 0 };
    }
  }

  if (!shortLabel || label.marked || !ctx.seenHeading || ctx.isFirstMeaningful || ctx.prevWasHeading) return null;
  const derivedLabel = !nameEntry && isDerivedLabelOverItems(text, spans, i, label.text, ctx);
  if (!derivedLabel && !looksLikePlainHeading(text, spans, i, label.text, ctx, nameEntry)) return null;
  return { line: i, kind: 'custom', heading: label.text, headingStart: base + label.offset, inline: false, level: 0 };
}

function firstNonBlankStart(text: string, spans: readonly LineSpan[], from: number, to: number): number | null {
  for (let i = from; i < to; i++) {
    const span = spans[i];
    if (!span) break;
    const raw = rawLine(text, span);
    if (raw.trim() !== '') return span.start + (raw.length - raw.trimStart().length);
  }
  return null;
}

function lastNonBlankEnd(text: string, spans: readonly LineSpan[], from: number, to: number): number | null {
  for (let i = to - 1; i >= from; i--) {
    const span = spans[i];
    if (!span) continue;
    const raw = rawLine(text, span);
    if (raw.trim() !== '') return span.start + raw.trimEnd().length;
  }
  return null;
}

interface ParseState {
  itemCount: number;
  itemIds: IdState;
  instructionRanges: ReadonlyArray<[number, number]>;
}

/**
 * Items in lines [from, to): bullet, number or checkbox lines plus their continuation lines, which
 * are exactly the lines the detection loop marked (`continuations`, the one column rule of
 * underItem), so a line is never a heading there and a continuation here. The owner comes only
 * from "(owner: ...)" or "(responsable: ...)" inside the item's own text (design section 8), never
 * from a sub-label above it. Ids are [kind, heading, item line].
 */
function collectItems(
  text: string,
  spans: readonly LineSpan[],
  from: number,
  to: number,
  kind: SectionKind,
  heading: string | null,
  state: ParseState,
  continuations: ReadonlySet<number>,
): { items: SummaryItem[]; cut: boolean } {
  const items: SummaryItem[] = [];
  let cut = false;
  for (let i = from; i < to; i++) {
    const span = spans[i];
    if (!span) break;
    const m = matchItem(rawLine(text, span));
    if (!m) continue;
    let lastLine = i;
    while (lastLine + 1 < to && continuations.has(lastLine + 1)) lastLine += 1;
    if (state.itemCount >= MAX_ITEMS) {
      cut = true;
      break;
    }
    const lastSpan = spans[lastLine] ?? span;
    const start = span.start + m.contentOffset;
    const fullEnd = lastSpan.start + rawLine(text, lastSpan).trimEnd().length;
    let itemText = text.slice(start, fullEnd);
    const flags: ItemFlag[] = [];
    let itemCut = false;
    if (itemText.length > MAX_ITEM_CHARS) {
      itemText = sliceSafe(itemText, MAX_ITEM_CHARS);
      itemCut = true;
    }
    const end = start + itemText.length;
    if (overlaps(state.instructionRanges, start, end)) flags.push('possible_instruction');
    if (LINK_RE.test(itemText)) flags.push('has_link');
    if (itemCut) flags.push('truncated');
    const sourceLine = text.slice(span.start + m.indent, fullEnd);
    items.push({
      id: uniqueId('i_', [kind, heading ?? '', sourceLine], state.itemIds),
      text: itemText,
      start,
      end,
      checked: m.checked,
      owner: ownerOf(itemText),
      dueText: dueTextOf(itemText),
      flags,
    });
    state.itemCount += 1;
    if (itemCut) cut = true;
    i = lastLine;
  }
  return { items, cut };
}

interface SectionPlan {
  kind: SectionKind;
  heading: string | null;
  start: number;
  end: number;
  /** Lines scanned for items: [itemFrom, lineTo). */
  itemFrom: number;
  lineTo: number;
}

/**
 * Splits sanitized summary text into sections and items (design section 8). Offsets are absolute
 * into `text`. Empty or blank text gives no sections (the pipeline refuses it as unreadable).
 */
export function parseSections(text: string): ParsedSections {
  const spans = lineSpans(text);
  const instructionRanges = findInstructionRanges(text);
  const hits: HeadingHit[] = [];
  /** Lines that continue the item above them; collectItems joins exactly these. */
  const continuations = new Set<number>();
  const ctx: DetectContext = {
    seenHeading: false,
    seenNonDerivedHeading: false,
    isFirstMeaningful: true,
    prevBlank: true,
    prevWasHeading: false,
    prevRaw: null,
    sectionKind: null,
    sectionLevel: 0,
    prevNameEntry: false,
    groupedCustom: false,
    sectionNameLabel: false,
    prevItemMarker: null,
    prevItemTextColumn: null,
    prevItemClosed: false,
  };
  /** The item line above, kept open through its continuation lines; null after any other line. */
  let open: OpenItem | null = null;
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    if (!span) break;
    const raw = rawLine(text, span);
    if (raw.trim() === '') {
      ctx.prevBlank = true;
      open = null;
      continue;
    }
    const item = matchItem(raw);
    ctx.prevItemClosed = itemClosedBelow(raw, ctx);
    // The one column rule (underItem): a continuation line is never a sub-label or a heading
    // ("- Bish ships the build by", "  Friday"); a heading-shaped line short of the item's text
    // column (" Action Items", " Topics"), and a known heading at or beyond it that must not join
    // (alignedHeading), is evaluated as a heading first.
    const relation: UnderItem = underItem(text, spans, i, open, ctx);
    let continuation: boolean = relation === 'join';
    const subKind: SubLabelKind | null = continuation ? null : isSubLabel(text, spans, i, ctx);
    const sub: boolean = subKind !== null;
    const nameEntry: boolean = !continuation && !sub && isNameListEntry(text, spans, i, ctx);
    const hit: HeadingHit | null = continuation || sub ? null : detectHeading(text, spans, i, ctx, nameEntry);
    // Heading-shaped but no heading and no sub-label after all: the line still joins the item.
    if (relation === 'try' && hit === null && !sub) continuation = true;
    if (continuation) continuations.add(i);
    if (subKind === 'name') ctx.sectionNameLabel = true;
    if (hit) {
      hits.push(hit);
      ctx.seenHeading = true;
      if (!DERIVED_KINDS.has(hit.kind)) ctx.seenNonDerivedHeading = true;
      ctx.sectionKind = hit.kind;
      ctx.sectionLevel = hit.level;
      ctx.sectionNameLabel = false;
      // "Launch Readiness" directly over "**Android**" and its items: a custom section grouped by
      // short marked labels.
      const below = spans[i + 1];
      const nextLabel = below ? readLabel(rawLine(text, below).trim()) : null;
      ctx.groupedCustom =
        hit.kind === 'custom' &&
        !hit.inline &&
        nextLabel !== null &&
        !isSiblingRank(nextLabel, hit.level) &&
        isShortMarkedLabelOverItems(text, spans, i + 1);
    }
    if (!continuation) open = item !== null && hit === null ? openItem(item, ctx) : null;
    ctx.prevItemMarker = open === null ? null : open.marker;
    ctx.prevItemTextColumn = open === null ? null : open.textColumn;
    // An inline "TL;DR: ..." line already carries content, so it starts nothing below it.
    ctx.prevWasHeading = hit !== null && !hit.inline;
    // Entries are always short Title Case lines or list labels (isNameListEntry), never prose.
    ctx.prevNameEntry = nameEntry && hit === null && !continuation;
    ctx.isFirstMeaningful = false;
    ctx.prevBlank = false;
    ctx.prevRaw = raw;
  }

  let truncated = false;
  const plans: SectionPlan[] = [];
  const firstHit = hits[0];
  if (!firstHit) {
    const start = firstNonBlankStart(text, spans, 0, spans.length);
    const end = lastNonBlankEnd(text, spans, 0, spans.length);
    if (start !== null && end !== null) {
      plans.push({ kind: 'body', heading: null, start, end, itemFrom: 0, lineTo: spans.length });
    }
  } else {
    const start = firstNonBlankStart(text, spans, 0, firstHit.line);
    const end = lastNonBlankEnd(text, spans, 0, firstHit.line);
    if (start !== null && end !== null) {
      plans.push({ kind: 'preamble', heading: null, start, end, itemFrom: 0, lineTo: firstHit.line });
    }
    const keep = MAX_SECTIONS - plans.length;
    if (hits.length > keep) truncated = true;
    for (let k = 0; k < Math.min(keep, hits.length); k++) {
      const hit = hits[k];
      if (!hit) break;
      // A dropped heading (beyond the cap) still ends the last kept section.
      const lineTo = hits[k + 1]?.line ?? spans.length;
      const end = lastNonBlankEnd(text, spans, hit.line, lineTo) ?? hit.headingStart + hit.heading.length;
      plans.push({ kind: hit.kind, heading: hit.heading, start: hit.headingStart, end, itemFrom: hit.line + 1, lineTo });
    }
  }

  const state: ParseState = { itemCount: 0, itemIds: newIdState(), instructionRanges };
  const sectionIds = newIdState();
  const occurrences = new Map<string, number>();
  const sections: SummarySection[] = plans.map((plan) => {
    const { items, cut } = collectItems(text, spans, plan.itemFrom, plan.lineTo, plan.kind, plan.heading, state, continuations);
    if (cut) truncated = true;
    const occurrenceKey = JSON.stringify([plan.kind, plan.heading ?? '']);
    const occurrence = (occurrences.get(occurrenceKey) ?? 0) + 1;
    occurrences.set(occurrenceKey, occurrence);
    const flags: SectionFlag[] = [];
    if (overlaps(instructionRanges, plan.start, plan.end)) flags.push('possible_instruction');
    if (cut) flags.push('truncated');
    return {
      id: uniqueId('s_', ['section', plan.kind, plan.heading ?? '', occurrence], sectionIds),
      kind: plan.kind,
      heading: plan.heading,
      derived: DERIVED_KINDS.has(plan.kind),
      start: plan.start,
      end: plan.end,
      flags,
      items,
    };
  });

  return {
    parserVersion: SECTIONS_PARSER_VERSION,
    sections,
    truncated,
    possibleInstruction: instructionRanges.length > 0,
    counts: { sections: sections.length, items: state.itemCount },
  };
}

/**
 * Self-check before storage: sections ordered and non-overlapping inside the text, every heading
 * at its section start, every item inside its section with text.slice(start, end) === item.text.
 */
export function sectionsAreConsistent(text: string, sections: readonly SummarySection[]): boolean {
  let prevEnd = 0;
  for (const section of sections) {
    if (section.start < prevEnd || section.end < section.start || section.end > text.length) return false;
    if (section.heading !== null && !text.startsWith(section.heading, section.start)) return false;
    for (const item of section.items) {
      if (item.start < section.start || item.end > section.end) return false;
      if (text.slice(item.start, item.end) !== item.text) return false;
    }
    prevEnd = section.end;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// Summary metadata used by matching (design section 6 "Inputs")
// ---------------------------------------------------------------------------------------------

export interface SummaryMeta {
  /** First meaningful line of the text (markup removed), or null. */
  titleLine: string | null;
  /** Subject without Re/Fwd/RV prefixes and notetaker prefixes ("Meeting notes:"), or null. */
  subjectClean: string | null;
  /** YYYY-MM-DD when exactly one distinct date appears in the first 10 lines and the Subject. */
  summaryDate: string | null;
  /** The text line (trimmed) that carries summaryDate, or null (date only in the Subject, or none). */
  dateLine: string | null;
  /** meet.google.com, zoom.us and Teams URLs found in the text, verbatim, deduplicated. */
  conferenceLinks: string[];
}

const MONTHS: Readonly<Record<string, number>> = {
  january: 1, jan: 1, enero: 1, ene: 1,
  february: 2, feb: 2, febrero: 2,
  march: 3, mar: 3, marzo: 3,
  april: 4, apr: 4, abril: 4, abr: 4,
  may: 5, mayo: 5,
  june: 6, jun: 6, junio: 6,
  july: 7, jul: 7, julio: 7,
  august: 8, aug: 8, agosto: 8, ago: 8,
  september: 9, sept: 9, sep: 9, septiembre: 9, setiembre: 9, set: 9,
  october: 10, oct: 10, octubre: 10,
  november: 11, nov: 11, noviembre: 11,
  december: 12, dec: 12, diciembre: 12, dic: 12,
};
const MONTH_ALT = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join('|');

// 2026-10-16 or 2026/10/16.
const ISO_DATE_RE = /(?<!\d)(\d{4})([-/])(\d{2})\2(\d{2})(?!\d)/g;
// Oct 16, 2026 / October 16th, 2026 / Friday, October 16, 2026.
const MONTH_FIRST_RE = new RegExp(`\\b(${MONTH_ALT})\\.?[ \\t]+(\\d{1,2})(?:st|nd|rd|th)?,?[ \\t]+(\\d{4})(?!\\d)`, 'gi');
// 16 Oct 2026 / 16 October 2026 / 16 de octubre de 2026 / vie, 16 oct. 2026.
const DAY_FIRST_RE = new RegExp(
  `(?<!\\d)(\\d{1,2})(?:st|nd|rd|th)?[ \\t]+(?:de[ \\t]+)?(${MONTH_ALT})\\.?,?[ \\t]+(?:del?[ \\t]+)?(\\d{4})(?!\\d)`,
  'gi',
);

function isoDate(year: number, month: number, day: number): string | null {
  if (year < 2000 || year > 2099 || month < 1 || month > 12 || day < 1) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Every valid calendar date written in `s` in a supported format, as YYYY-MM-DD. */
export function datesIn(s: string): Set<string> {
  const out = new Set<string>();
  const add = (d: string | null) => {
    if (d) out.add(d);
  };
  for (const m of s.matchAll(ISO_DATE_RE)) add(isoDate(Number(m[1]), Number(m[3]), Number(m[4])));
  for (const m of s.matchAll(MONTH_FIRST_RE)) add(isoDate(Number(m[3]), MONTHS[(m[1] ?? '').toLowerCase()] ?? 0, Number(m[2])));
  for (const m of s.matchAll(DAY_FIRST_RE)) add(isoDate(Number(m[3]), MONTHS[(m[2] ?? '').toLowerCase()] ?? 0, Number(m[1])));
  return out;
}

function stripDates(s: string): string {
  return s.replace(ISO_DATE_RE, ' ').replace(MONTH_FIRST_RE, ' ').replace(DAY_FIRST_RE, ' ');
}

// Only for telling a date label from a heading (isDateOnly), never for summaryDate: a date
// without a year, a month with only a year, and numeric dates in either order.
// Oct 16 / October 16th / Thursday, October 16.
const MONTH_DAY_RE = new RegExp(`\\b(${MONTH_ALT})\\.?[ \\t]+(\\d{1,2})(?:st|nd|rd|th)?(?!\\d)`, 'gi');
// 16 Oct / 16 de octubre / 16th of October.
const DAY_MONTH_RE = new RegExp(`(?<!\\d)(\\d{1,2})(?:st|nd|rd|th)?[ \\t]+(?:(?:de|of)[ \\t]+)?(${MONTH_ALT})(?![a-z])\\.?`, 'gi');
// October 2026 / octubre de 2026.
const MONTH_YEAR_RE = new RegExp(`\\b(${MONTH_ALT})\\.?,?[ \\t]+(?:del?[ \\t]+)?(\\d{4})(?!\\d)`, 'gi');
// 10/16/2026 (M/D/YYYY), 16/10/2026 (D/M/YYYY), 16.10.26.
const NUMERIC_DATE_RE = /(?<!\d)(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?!\d)/g;
// 10/16 or 16/10 without a year.
const SLASH_DAY_RE = /(?<![\d/])(\d{1,2})\/(\d{1,2})(?![\d/])/g;
// 16-Oct-2026 / 16-oct and Oct-16-2026 / Oct-16: a month name joined to the numbers by "-".
const DASH_DAY_MONTH_RE = new RegExp(`(?<!\\d)(\\d{1,2})-(${MONTH_ALT})(?:-(?:\\d{4}|\\d{2}))?(?![a-z\\d])`, 'gi');
const DASH_MONTH_DAY_RE = new RegExp(`\\b(${MONTH_ALT})-(\\d{1,2})(?:-(?:\\d{4}|\\d{2}))?(?!\\d)`, 'gi');
// A clock time alone ("3:20 PM", "15:20", "3pm", "15h20"): a label that is only a time is no heading either.
const CLOCK_RE =
  /(?<![\d:])(?:[01]?\d|2[0-3]):[0-5]\d(?![\d])|(?<!\d)(?:1[0-2]|0?[1-9])[ \t]*[ap]\.?[ \t]*m\b|(?<!\d)(?:[01]?\d|2[0-3])h[0-5]\d(?!\d)/gi;
// An IANA zone, optionally in parentheses: "America/Chicago", "(America/Argentina/Buenos_Aires)".
const IANA_ZONE_RE =
  /\(?\b(?:Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific|Etc)\/[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)?\)?/gi;
// The city Google Calendar writes after a zone name: "Central Time - Chicago", "Hora - Bogota".
const ZONE_CITY_RE = new RegExp(`\\b(time|hora)[ \\t]*[-${EN_DASH}${EM_DASH}][ \\t]*\\p{L}[\\p{L} .'_]{0,40}$`, 'iu');

function monthNumber(name: string | undefined): number {
  return MONTHS[(name ?? '').toLowerCase()] ?? 0;
}

function dayNumber(digits: string | undefined): number {
  const day = Number(digits ?? '');
  return day >= 1 && day <= 31 ? day : 0;
}

/** True when `s` writes a date in any form isDateOnly knows (with or without a year) or a clock time. */
function hasDatePart(s: string): boolean {
  if (datesIn(s).size > 0) return true;
  for (const m of s.matchAll(MONTH_DAY_RE)) {
    if (monthNumber(m[1]) > 0 && dayNumber(m[2]) > 0) return true;
  }
  for (const m of s.matchAll(DAY_MONTH_RE)) {
    if (monthNumber(m[2]) > 0 && dayNumber(m[1]) > 0) return true;
  }
  for (const m of s.matchAll(MONTH_YEAR_RE)) {
    const year = Number(m[2]);
    if (monthNumber(m[1]) > 0 && year >= 2000 && year <= 2099) return true;
  }
  for (const re of [NUMERIC_DATE_RE, SLASH_DAY_RE]) {
    for (const m of s.matchAll(re)) {
      const a = dayNumber(m[1]);
      const b = dayNumber(m[2]);
      if (a > 0 && b > 0 && (a <= 12 || b <= 12)) return true;
    }
  }
  for (const m of s.matchAll(DASH_DAY_MONTH_RE)) {
    if (monthNumber(m[2]) > 0 && dayNumber(m[1]) > 0) return true;
  }
  for (const m of s.matchAll(DASH_MONTH_DAY_RE)) {
    if (monthNumber(m[1]) > 0 && dayNumber(m[2]) > 0) return true;
  }
  // "Viernes 17": a weekday and a day number, read on the headingKey form (accents removed).
  for (const m of headingKey(s).matchAll(WEEKDAY_DAY_RE)) {
    if (dayNumber(m[1]) > 0) return true;
  }
  // search ignores lastIndex, so the global regex keeps no state between calls.
  return s.search(CLOCK_RE) >= 0;
}

function stripDateParts(s: string): string {
  return stripDates(s.replace(IANA_ZONE_RE, ' ').replace(ZONE_CITY_RE, '$1'))
    .replace(DASH_DAY_MONTH_RE, ' ')
    .replace(DASH_MONTH_DAY_RE, ' ')
    .replace(NUMERIC_DATE_RE, ' ')
    .replace(SLASH_DAY_RE, ' ')
    .replace(MONTH_DAY_RE, ' ')
    .replace(DAY_MONTH_RE, ' ')
    .replace(MONTH_YEAR_RE, ' ')
    .replace(CLOCK_RE, ' ');
}

const REPLY_PREFIX_RE = /^(?:re|fwd?|rv|enc|tr|aw|wg)[ \t]*(?:\[\d+\]|\(\d+\))?[ \t]*:[ \t]*/i;
const TAG_PREFIX_RE = /^\[(?:external|ext|externo|externa|extern)\][ \t]*/i;
const VENDOR_PREFIX_RE =
  /^(?:your[ \t]+)?(?:meeting[ \t]+)?(?:notes|recap|summary|minutes)(?:[ \t]*[:|][ \t]*|[ \t]+[\u2013\u2014-][ \t]+|[ \t]+(?:for|of|from)[ \t]+)/i;
const VENDOR_PREFIX_ES_RE =
  /^(?:notas|resumen|acta|minuta|apuntes)(?:[ \t]+de[ \t]+(?:la[ \t]+)?reuni[o\u00F3]n)?(?:[ \t]*[:|][ \t]*|[ \t]+[\u2013\u2014-][ \t]+|[ \t]+(?:de|del|para)[ \t]+)/i;
const VENDOR_SUFFIX_RE =
  /[ \t]+[|\u2013\u2014-][ \t]*(?:(?:meeting[ \t]+)?(?:notes|recap|summary|minutes)|(?:notas|resumen|acta)(?:[ \t]+de[ \t]+(?:la[ \t]+)?reuni[o\u00F3]n)?)$/i;
const QUOTED_LEAD_RE = /^["\u201C\u00AB]([^"\u201C\u201D\u00AB\u00BB]{1,300})["\u201D\u00BB]/;

/** The Subject without reply/forward prefixes, notetaker prefixes and a notetaker suffix. */
export function cleanSubject(subject: string | null | undefined): string | null {
  let s = sanitizeLine(subject, MAX_SUBJECT_CHARS);
  for (let round = 0; round < 10; round++) {
    const next = s
      .replace(REPLY_PREFIX_RE, '')
      .replace(TAG_PREFIX_RE, '')
      .replace(VENDOR_PREFIX_RE, '')
      .replace(VENDOR_PREFIX_ES_RE, '')
      .trim();
    if (next === s) break;
    s = next;
  }
  s = s.replace(VENDOR_SUFFIX_RE, '').replace(QUOTED_LEAD_RE, '$1').trim();
  return s.length > 0 ? s : null;
}

const CONFERENCE_LINK_RE =
  /(?<![\w.@-])(?:https?:\/\/)?(?:[a-z0-9-]+\.)*(?:meet\.google\.com|zoom\.us|teams\.microsoft\.com|teams\.live\.com)\/[^\s<>"'()[\]{}]+/gi;

function conferenceLinksIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(CONFERENCE_LINK_RE)) {
    const link = sliceSafe(m[0].replace(/[.,;:!?]+$/, ''), MAX_LINK_CHARS);
    if (!out.includes(link)) out.push(link);
    if (out.length >= MAX_CONFERENCE_LINKS) break;
  }
  return out;
}

function isTitleCandidate(trimmed: string, label: Label): boolean {
  if (matchItem(trimmed)) return false;
  if (!/\p{L}/u.test(label.text)) return false;
  const key = headingKey(label.text);
  if (KNOWN_HEADINGS.has(key)) return false;
  const inline = INLINE_DERIVED_RE.exec(trimmed);
  if (inline?.[1] !== undefined && KNOWN_HEADINGS.has(headingKey(inline[1]))) return false;
  // A line that is only a date, or a document label with a date ("Meeting notes - 2026-10-16").
  const undated = headingKey(stripDates(label.text));
  return undated !== '' && !DOCUMENT_LABEL_KEYS.has(undated);
}

/**
 * The matching inputs of design section 6: titleLine, subjectClean, summaryDate (with dateLine)
 * and conferenceLinks. `text` is the sanitized, wrapper-stripped text; `subject` is the raw or
 * sanitized Subject header value.
 */
export function extractSummaryMeta(text: string, subject: string | null | undefined): SummaryMeta {
  const topLines: string[] = [];
  for (const span of lineSpans(text)) {
    const trimmed = rawLine(text, span).trim();
    if (trimmed === '') continue;
    topLines.push(trimmed);
    if (topLines.length >= META_LINES) break;
  }

  let titleLine: string | null = null;
  for (const trimmed of topLines) {
    const label = readLabel(trimmed);
    if (isTitleCandidate(trimmed, label)) {
      titleLine = sliceSafe(label.text, MAX_TITLE_CHARS).trim();
      break;
    }
  }

  const subjectLine = sanitizeLine(subject, MAX_SUBJECT_CHARS);
  const all = new Set<string>(datesIn(subjectLine));
  const perLine = topLines.map((line) => datesIn(line));
  for (const dates of perLine) for (const d of dates) all.add(d);
  const summaryDate = all.size === 1 ? ([...all][0] ?? null) : null;
  let dateLine: string | null = null;
  if (summaryDate !== null) {
    const index = perLine.findIndex((dates) => dates.has(summaryDate));
    const line = index >= 0 ? topLines[index] : undefined;
    dateLine = line !== undefined ? sliceSafe(line, MAX_TITLE_CHARS).trim() : null;
  }

  return {
    titleLine,
    subjectClean: cleanSubject(subject),
    summaryDate,
    dateLine,
    conferenceLinks: conferenceLinksIn(text),
  };
}

export interface LocalDateTime {
  /** YYYY-MM-DD as written (wall clock, no zone). */
  date: string;
  /** HH:MM in 24-hour form, or null when no time is written. */
  time: string | null;
}

const TIME_RE = /(?<![\d:])([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?(?:[ \t]*([ap])\.?[ \t]*m\b\.?)?/i;

/**
 * Reads the wall-clock date and time of a forward wrapper's Date text ("Fri, Oct 16, 2026 at
 * 3:20 PM", "vie, 16 oct 2026 a las 15:20", "viernes, 16 de octubre de 2026 15:20"). The text has
 * no zone: it is the forwarding client's local time, so the caller applies the user's zone.
 * Null unless exactly one date is present.
 */
export function parseLocalDateTime(dateText: string | null | undefined): LocalDateTime | null {
  if (typeof dateText !== 'string' || dateText.length === 0) return null;
  const line = sanitizeLine(dateText, 200);
  const dates = datesIn(line);
  if (dates.size !== 1) return null;
  const date = [...dates][0];
  if (date === undefined) return null;
  const tm = TIME_RE.exec(stripDates(line));
  let time: string | null = null;
  if (tm?.[1] !== undefined && tm[2] !== undefined) {
    let hour = Number(tm[1]);
    const meridiem = tm[3]?.toLowerCase();
    let valid = true;
    if (meridiem !== undefined) {
      if (hour < 1 || hour > 12) valid = false;
      else if (meridiem === 'a') hour = hour === 12 ? 0 : hour;
      else hour = hour === 12 ? 12 : hour + 12;
    }
    if (valid) time = `${String(hour).padStart(2, '0')}:${tm[2]}`;
  }
  return { date, time };
}
