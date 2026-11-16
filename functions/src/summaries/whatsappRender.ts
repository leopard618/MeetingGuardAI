/**
 * The WhatsApp messages of suggested tasks (docs/v2/M11-DESIGN.md sections 4.2 and 11; section 15
 * findings 10 and 23). PURE: no Firebase, no logging, no clock. EN and ES; any other language reads
 * English (M12 adds more).
 *
 * - The list: a header that says where it comes from, one banner line when nothing is marked for a
 *   reason, then one numbered line per open or added suggestion with its STABLE number (the
 *   extraction's `number`, never its position in this message: dropped lines leave their number
 *   unused and the numbering never closes up), the quote under it when it says more than the title,
 *   and the reply instructions. ALL is offered only when something is marked; a summary not sent to
 *   one of the user's mailboxes (selectAll false) shows no marks at all.
 * - Titles and quotes from the summary stay verbatim but always on ONE line each: every line break,
 *   control character and whitespace run becomes one space, then the cap ends with three ASCII
 *   periods. So a quote can never start its own "4. [x] ..." or "Reply ALL ..." line.
 * - Links in anything taken from the summary (quotes, titles, headings, names, the meeting title)
 *   are defanged ("pay[.]example[.]com"): WhatsApp makes them tappable even with preview_url
 *   false, and the app never shows a summary link as a tap (section 3.2).
 * - A suggestion whose owner only matched the user's first name (owner_guess, "You?" in the app)
 *   is never marked here and its line names the person the summary gives, because this list has
 *   no chip to say so: ALL never adds a colleague's job as the user's own.
 * - The message stays within MAX_TEXT_CHARS; past it "And N more in the app", and those numbers are
 *   not in the offer, so they cannot be picked by number.
 * - Our own text is ASCII (Spanish keeps its accents); no typographic punctuation anywhere.
 *
 * Nothing here logs; the counts it returns are safe to log.
 */
import {
  type AssistantUsage,
  type CommitmentDecisionResult,
  type CommitmentItem,
  type Language,
  type SummaryCommitments,
} from '../shared/aiContract';
import { ACTION_LIST_KINDS } from '../commitments/payload';
import { wordsOf } from '../commitments/text';
import { defangLinks, stripItemMarkers } from '../commitments/verify';
import { MAX_BUTTON_TITLE_CHARS, MAX_TEXT_CHARS } from '../whatsapp/send';
import { sliceSafe } from './sanitize';
import {
  SUMMARY_ALL_BUTTON_PREFIX,
  SUMMARY_NONE_BUTTON_PREFIX,
  type SummaryOffer,
  type SummaryOfferAi,
  type SummaryWhatsAppResponse,
} from './whatsappProtocol';

/** Default longest list line (SUMMARY_WHATSAPP_TUNING.maxLineChars). */
export const DEFAULT_MAX_LINE_CHARS = 140;
/** Longest title in a result message. */
const MAX_RESULT_TITLE_CHARS = 80;
/** Longest meeting title and section heading in a header or a line. */
const MAX_MEETING_TITLE_CHARS = 100;
const MAX_HEADING_CHARS = 40;

function lang(language: Language | string | null | undefined): Language {
  return language === 'es' ? 'es' : 'en';
}

// ---------------------------------------------------------------------------------------------
// One line
// ---------------------------------------------------------------------------------------------

/** C0 and C1 controls and the Unicode line and paragraph separators (some clients break lines on them). */
function breaksLine(code: number): boolean {
  return code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
}

/**
 * `value` on one line: every control character and line break becomes a space, every whitespace run
 * one space, trimmed; past `max` it is cut and ends with three ASCII periods.
 */
export function oneLine(value: string, max: number): string {
  let out = '';
  for (const char of value) out += breaksLine(char.codePointAt(0) ?? 0) ? ' ' : char;
  out = out.replace(/\s+/gu, ' ').trim();
  if (out.length <= max) return out;
  return `${sliceSafe(out, Math.max(1, max - 3)).trimEnd()}...`;
}

/** Text from the summary on one line, its links defanged first (see the module comment). */
export function contentLine(value: string, max: number): string {
  return oneLine(defangLinks(value), max);
}

// ---------------------------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------------------------

const MONTHS: Readonly<Record<Language, readonly string[]>> = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
};
const WEEKDAYS: Readonly<Record<Language, readonly string[]>> = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  es: ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'],
};

function partsOf(date: string): { y: number; m: number; d: number; wd: number } | null {
  const found = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (found === null) return null;
  const y = Number(found[1]);
  const m = Number(found[2]);
  const d = Number(found[3]);
  const ms = Date.UTC(y, m - 1, d);
  if (!Number.isFinite(ms) || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d, wd: new Date(ms).getUTCDay() };
}

/** "Oct 16" / "16 oct"; null for anything that is not a YYYY-MM-DD date. */
export function shortDateOf(date: string | null, language: Language): string | null {
  const parts = date === null ? null : partsOf(date);
  if (parts === null) return null;
  const month = MONTHS[language][parts.m - 1] ?? '';
  return language === 'es' ? `${parts.d} ${month}` : `${month} ${parts.d}`;
}

/** "Fri, Oct 17" / "vie 17 oct". */
export function dueDateOf(date: string, language: Language): string {
  const parts = partsOf(date);
  if (parts === null) return date;
  const weekday = WEEKDAYS[language][parts.wd] ?? '';
  const month = MONTHS[language][parts.m - 1] ?? '';
  return language === 'es' ? `${weekday} ${parts.d} ${month}` : `${weekday}, ${month} ${parts.d}`;
}

// ---------------------------------------------------------------------------------------------
// Fixed texts (worker side; the webhook's own texts are in whatsapp/messages.ts)
// ---------------------------------------------------------------------------------------------

export interface WorkerTexts {
  noSummary: string;
  preparing: string;
  offerCap: string;
  stale: string;
  expired: string;
  notFound: string;
  aiUnavailable: string;
  aiEmpty: string;
  unavailable: string;
  notAllowed: string;
  decideFailed: string;
  nothingMarked: string;
  unknownNumbers: string;
  nothingToChange: string;
}

const WORKER_TEXTS: Readonly<Record<Language, WorkerTexts>> = {
  en: {
    noSummary:
      'You have no notetaker summary from the last 14 days with tasks to review. Summaries you file under a meeting or keep in the app show up here.',
    preparing: 'Your suggested tasks are being prepared right now. Write commitments again in a minute.',
    offerCap: 'You asked for this list many times today. Open the app to review it.',
    stale: 'This summary changed since that list. Write commitments for the new list.',
    expired: 'That list expired. Write commitments for a new one.',
    notFound: 'That summary is no longer available.',
    aiUnavailable: 'Meeting Guard AI could not prepare suggestions for this summary right now. You can still reply with numbers from the list above.',
    aiEmpty: 'Meeting Guard AI found no commitments in this summary. You can still reply with numbers from the list above.',
    unavailable: 'Suggested tasks are not available right now. Open the app to review them.',
    notAllowed: 'Suggested tasks are not available for this account.',
    decideFailed: 'These tasks could not be added from WhatsApp. Open the app to add them.',
    nothingMarked: 'Nothing is marked. Reply with the numbers you want.',
    unknownNumbers: 'None of those numbers is in the list. Reply with numbers from the list, for example 1 3.',
    nothingToChange: 'Nothing to change.',
  },
  es: {
    noSummary:
      'No tienes minutas de los últimos 14 días con tareas por revisar. Aquí aparecen las minutas que archivas en una reunión o guardas en la app.',
    preparing: 'Tus tareas sugeridas se están preparando ahora. Escribe compromisos otra vez en un minuto.',
    offerCap: 'Pediste esta lista muchas veces hoy. Revísala en la app.',
    stale: 'Esta minuta cambió desde esa lista. Escribe compromisos para ver la nueva lista.',
    expired: 'Esa lista expiró. Escribe compromisos para ver una nueva.',
    notFound: 'Esa minuta ya no está disponible.',
    aiUnavailable: 'Meeting Guard AI no pudo preparar sugerencias para esta minuta ahora. Aún puedes responder con números de la lista anterior.',
    aiEmpty: 'Meeting Guard AI no encontró compromisos en esta minuta. Aún puedes responder con números de la lista anterior.',
    unavailable: 'Las tareas sugeridas no están disponibles ahora. Revísalas en la app.',
    notAllowed: 'Las tareas sugeridas no están disponibles para esta cuenta.',
    decideFailed: 'Estas tareas no se pudieron agregar desde WhatsApp. Agrégalas en la app.',
    nothingMarked: 'No hay nada marcado. Responde con los números que quieras.',
    unknownNumbers: 'Ninguno de esos números está en la lista. Responde con números de la lista, por ejemplo 1 3.',
    nothingToChange: 'No hay nada que cambiar.',
  },
};

export function workerTexts(language: Language | string | null | undefined): WorkerTexts {
  return WORKER_TEXTS[lang(language)];
}

/** The allowance text of a quota refusal (ALLOWANCES-2026-11-05.md: the day, window and month wording). */
export function quotaText(language: Language, usage: AssistantUsage | null): string {
  const es = language === 'es';
  const tail = es ? ' Aún puedes responder con números de la lista anterior.' : ' You can still reply with numbers from the list above.';
  if (usage === null) {
    return (es ? 'Alcanzaste tu límite de acciones de IA por ahora. Las tareas tal como están escritas siguen gratis.' : 'You reached your AI action limit for now. The action items as written stay free.') + tail;
  }
  if (usage.period === 'window' || usage.subscriptionRequired === true) {
    return (
      (es
        ? 'Tus acciones de IA gratuitas se acabaron. Una suscripción desbloquea la IA; las tareas tal como están escritas siguen gratis.'
        : 'Your free AI actions are used. A subscription unlocks AI; the action items as written stay free.') + tail
    );
  }
  if (usage.period === 'month') {
    const renew = shortDateOf(usage.resetsAt.slice(0, 10), language);
    return (
      (es
        ? `Usaste las ${usage.limit} acciones de IA de este mes. Se renuevan el ${renew ?? 'día en que te suscribiste'}. Las tareas tal como están escritas siguen gratis.`
        : `You used the ${usage.limit} AI actions of this month. They renew on ${renew ?? 'the day you subscribed'}. The action items as written stay free.`) + tail
    );
  }
  return (
    (es
      ? `Usaste las ${usage.limit} acciones de IA gratuitas de hoy. Hay más después de la medianoche UTC. Las tareas tal como están escritas siguen gratis.`
      : `You used today's ${usage.limit} free AI actions. More are available after midnight UTC. The action items as written stay free.`) + tail
  );
}

// ---------------------------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------------------------

export interface OfferRenderInput {
  language: Language;
  commitments: SummaryCommitments;
  ai: SummaryOfferAi;
  /** A zone is known for the default reminder (the preferences zone, else the meeting's). */
  reminderZoneKnown: boolean;
  /** The ids of the offer this message makes. */
  offer: { offerId: string; uidTag: string; summaryId: string; expiresAt: string };
  maxChars?: number;
  maxLineChars?: number;
}

export interface RenderedOffer {
  text: string;
  buttons: SummaryWhatsAppResponse['buttons'];
  /** null when the message offers nothing to reply to. */
  offer: SummaryOffer | null;
  /** Safe to log. */
  counts: { shown: number; open: number; marked: number; accepted: number; more: number };
}

function headerOf(language: Language, commitments: SummaryCommitments, maxLine: number): string[] {
  const origin = commitments.origin;
  const title = origin.meetingTitle === null ? '' : contentLine(origin.meetingTitle, Math.min(MAX_MEETING_TITLE_CHARS, maxLine));
  const date = shortDateOf(origin.occurrenceDate ?? origin.localDate, language);
  const when = date === null ? '' : ` (${date})`;
  const ai = commitments.mode === 'ai';
  if (language === 'es') {
    const source = title.length > 0 ? `la minuta de tu asistente de notas sobre "${title}"${when}` : `una minuta de tu asistente de notas${when}`;
    return ai
      ? [`Tareas sugeridas de ${source}.`, 'Escritas por IA; Meeting Guard AI no asistió. No se agrega nada hasta que respondas.']
      : [`Las tareas de ${source}, tal como están escritas. No se agrega nada hasta que respondas.`];
  }
  const source = title.length > 0 ? `your notetaker's summary of "${title}"${when}` : `a notetaker summary${when}`;
  return ai
    ? [`Suggested tasks from ${source}.`, 'Written by AI; Meeting Guard AI did not attend. Nothing is added until you reply.']
    : [`The action items from ${source}, exactly as written. Nothing is added until you reply.`];
}

function bannerOf(language: Language, commitments: SummaryCommitments): string[] {
  const lines: string[] = [];
  const es = language === 'es';
  switch (commitments.preselect.reason) {
    case 'old_summary':
      lines.push(es ? 'No hay nada marcado: no pudimos confirmar cuándo se envió esta minuta.' : 'Nothing is marked: we could not confirm when this summary was sent.');
      break;
    case 'not_addressed_to_you':
      lines.push(
        es
          ? 'Esta minuta no se envió a uno de tus buzones, así que no hay nada marcado. Responde con los números que quieras.'
          : 'This summary was not sent to one of your mailboxes, so nothing is marked. Reply with the numbers you want.',
      );
      break;
    case 'forwarded':
      lines.push(
        es
          ? 'No hay nada marcado: esta minuta se reenvió y no se pudo comprobar la firma del asistente de notas.'
          : "Nothing is marked: this summary was forwarded and the notetaker's signature could not be checked.",
      );
      break;
    case 'possible_instruction':
      lines.push(
        es
          ? 'No hay nada marcado: parte de esta minuta parece contener instrucciones para software. Lee cada tarea.'
          : 'Nothing is marked: part of this summary reads like instructions to software. Read each item.',
      );
      break;
    default:
      break;
  }
  if (commitments.truncated) lines.push(es ? 'Solo se leyó la primera parte de una minuta larga.' : 'Only the first part of a long summary was read.');
  return lines;
}

/** The title without the "<owner>: " prefix code added (for the quote comparison). */
function titleWords(item: CommitmentItem): string {
  let title = item.title;
  const owner = item.owner;
  if (owner !== null && !owner.isUser && title.startsWith(`${owner.name}: `)) title = title.slice(owner.name.length + 2);
  return wordsOf(title).join(' ');
}

/** Whether the quote says more than the title (its words, without the owner and due markers). */
export function quoteAddsToTitle(item: CommitmentItem): boolean {
  return wordsOf(stripItemMarkers(item.quote)).join(' ') !== titleWords(item);
}

function dueSuffixOf(item: CommitmentItem, language: Language): string {
  const due = item.due;
  if (due === null) return '';
  const when = `${dueDateOf(due.date, language)}${due.time === null ? '' : ` ${due.time}${due.zone === null ? '' : ` (${due.zone})`}`}`;
  if (language === 'es') return due.overdue ? ` - venció ${when}` : ` - vence ${when}`;
  return due.overdue ? ` - was due ${when}` : ` - due ${when}`;
}

function sectionSuffixOf(item: CommitmentItem, language: Language): string {
  if (ACTION_LIST_KINDS.has(item.sectionKind) || item.sectionHeading === null) return '';
  const heading = contentLine(item.sectionHeading, MAX_HEADING_CHARS);
  if (heading.length === 0) return '';
  return language === 'es' ? ` (de ${heading})` : ` (from ${heading})`;
}

/** The owner only matched the user's first name (owner_guess): the app's "You?" chip. */
export function isOwnerGuess(item: CommitmentItem): boolean {
  return item.owner?.guess === true || item.flags.includes('owner_guess');
}

/** Marked for ALL: open, pre-selected, and not an owner guess (see the module comment). */
function isMarked(item: CommitmentItem): boolean {
  return item.status === 'open' && item.preselected && !isOwnerGuess(item);
}

const MAX_GUESS_NAME_CHARS = 40;

/** " (you? the summary says: Francisco)" for an owner guess, else nothing. */
function guessSuffixOf(item: CommitmentItem, language: Language): string {
  if (!isOwnerGuess(item) || item.owner === null) return '';
  const name = contentLine(item.owner.name, MAX_GUESS_NAME_CHARS);
  if (name.length === 0) return '';
  return language === 'es' ? ` (¿tú? la minuta dice: ${name})` : ` (you? the summary says: ${name})`;
}

/** One numbered line, within maxLine (the title is what gets cut). */
function itemLine(prefix: string, title: string, suffix: string, maxLine: number): string {
  const room = Math.max(20, maxLine - prefix.length - suffix.length);
  return `${prefix}${contentLine(title, room)}${suffix}`;
}

function quoteLine(item: CommitmentItem, language: Language, maxLine: number): string {
  const label = language === 'es' ? '   De la minuta: "' : '   From the summary: "';
  return `${label}${contentLine(item.quote, Math.max(20, maxLine - label.length - 1))}"`;
}

function exampleOf(open: readonly number[]): string {
  return open.slice(0, 2).join(' ') || '1';
}

function footerOf(language: Language, input: { open: number[]; marked: number; ai: SummaryOfferAi; zoneKnown: boolean; accepted: number }): string[] {
  const es = language === 'es';
  const lines: string[] = [];
  if (input.open.length > 0) {
    const ex = exampleOf(input.open);
    if (input.marked > 0) {
      lines.push(
        es
          ? `Responde TODOS para agregar las ${input.marked} marcadas, números para agregar solo esas (por ejemplo ${ex}), QUITAR y números para quitar algunas, o NINGUNO.`
          : `Reply ALL to add the ${input.marked} marked, numbers to add only those (for example ${ex}), DROP and numbers to remove some, or NONE.`,
      );
    } else {
      lines.push(
        es
          ? `Responde con los números que quieras agregar (por ejemplo ${ex}), QUITAR y números para quitar algunas, o NINGUNO.`
          : `Reply with the numbers you want to add (for example ${ex}), DROP and numbers to remove some, or NONE.`,
      );
    }
    lines.push(
      input.zoneKnown
        ? es
          ? 'Las que no tienen fecha te avisan mañana a las 9:00. Edítalas en la app.'
          : 'Items without a date remind you tomorrow at 9:00. Edit them in the app.'
        : es
          ? 'Las que no tienen fecha no tienen recordatorio: ponlo en la app. Edítalas en la app.'
          : 'Items without a date get no reminder: set one in the app. Edit them in the app.',
    );
  } else if (input.accepted > 0) {
    lines.push(
      es
        ? 'Todo lo de esta lista ya está en tus tareas o se quitó. Revísalo en la app.'
        : 'Everything in this list is already in your tasks or was removed. Open the app to review it.',
    );
  }
  if (input.ai === 'offered') {
    lines.push(
      es
        ? 'Responde IA para que Meeting Guard AI lea toda la minuta y sugiera tareas. El texto de la minuta se envía a OpenAI a través de nuestro servidor y esto usa 1 acción de IA.'
        : "Reply AI to have Meeting Guard AI read the whole summary and suggest tasks. The summary's text goes to OpenAI through our server and this uses 1 AI action.",
    );
  } else if (input.ai === 'prepared') {
    lines.push(
      es
        ? 'Responde IA para ver las tareas que Meeting Guard AI ya sugirió para esta minuta (sin una nueva acción de IA).'
        : 'Reply AI to see the tasks Meeting Guard AI already suggested for this summary (no new AI action).',
    );
  }
  return lines;
}

function emptyLineOf(language: Language, commitments: SummaryCommitments): string {
  if (commitments.mode === 'ai') return language === 'es' ? 'Meeting Guard AI no encontró compromisos en esta minuta.' : 'Meeting Guard AI found no commitments in this summary.';
  return language === 'es' ? 'No se encontraron tareas escritas en esta minuta.' : 'No action items were found as written in this summary.';
}

function buttonTitle(candidates: readonly string[]): string {
  return candidates.find((title) => title.length <= MAX_BUTTON_TITLE_CHARS) ?? (candidates[candidates.length - 1] ?? '').slice(0, MAX_BUTTON_TITLE_CHARS);
}

/** The list message, its buttons and the offer it makes (see the module comment). */
export function renderOffer(input: OfferRenderInput): RenderedOffer {
  const language = lang(input.language);
  const maxChars = Math.min(input.maxChars ?? MAX_TEXT_CHARS, MAX_TEXT_CHARS);
  const maxLine = input.maxLineChars ?? DEFAULT_MAX_LINE_CHARS;
  const commitments = input.commitments;
  const boxes = commitments.preselect.selectAll;
  const listed = commitments.items.filter((item) => item.status !== 'dropped');

  const head = [...headerOf(language, commitments, maxLine), ...bannerOf(language, commitments)].join('\n');
  // Footer sized for the worst case first (every listed line open, the "more" line present).
  const allOpen = listed.filter((item) => item.status === 'open').map((item) => item.number);
  const anyMarked = listed.some(isMarked);
  const worstFooter = footerOf(language, { open: allOpen, marked: anyMarked ? 99 : 0, ai: input.ai, zoneKnown: input.reminderZoneKnown, accepted: 1 }).join('\n');
  const moreReserve = 40;

  const blocks: string[] = [];
  const shown: CommitmentItem[] = [];
  let used = head.length + 2 + worstFooter.length + 2 + moreReserve;
  for (const item of listed) {
    const prefix =
      item.status === 'accepted'
        ? `${item.number}. ${language === 'es' ? '(agregada)' : '(added)'} `
        : boxes
          ? `${item.number}. ${isMarked(item) ? '[x]' : '[ ]'} `
          : `${item.number}. `;
    const suffix = item.status === 'accepted' ? '' : `${guessSuffixOf(item, language)}${dueSuffixOf(item, language)}${sectionSuffixOf(item, language)}`;
    const lines = [itemLine(prefix, item.title, suffix, maxLine)];
    if (item.status === 'open' && quoteAddsToTitle(item)) lines.push(quoteLine(item, language, maxLine));
    const block = lines.join('\n');
    if (used + block.length + 1 > maxChars) break;
    used += block.length + 1;
    blocks.push(block);
    shown.push(item);
  }

  const open = shown.filter((item) => item.status === 'open').map((item) => item.number);
  const marked = shown.filter(isMarked).map((item) => item.number);
  const accepted = shown.filter((item) => item.status === 'accepted').length;
  const more = listed.length - shown.length;
  const footer = footerOf(language, { open, marked: marked.length, ai: input.ai, zoneKnown: input.reminderZoneKnown, accepted });
  if (more > 0) footer.unshift(language === 'es' ? `Y ${more} más en la app.` : `And ${more} more in the app.`);

  const parts = [head];
  parts.push(blocks.length > 0 ? blocks.join('\n') : emptyLineOf(language, commitments));
  if (footer.length > 0) parts.push(footer.join('\n'));
  const text = sliceSafe(parts.join('\n\n'), maxChars);

  const offerable = open.length > 0 || input.ai !== 'none';
  const offer: SummaryOffer | null = offerable
    ? {
        offerId: input.offer.offerId,
        uidTag: input.offer.uidTag,
        summaryId: input.offer.summaryId,
        key: commitments.key,
        anchors: shown.map((item) => ({ n: item.number, a: item.anchorId })),
        marked,
        open,
        ai: input.ai,
        expiresAt: input.offer.expiresAt,
      }
    : null;
  const buttons: SummaryWhatsAppResponse['buttons'] =
    offer !== null && marked.length > 0
      ? {
          body: language === 'es' ? `¿Agrego las ${marked.length} tareas marcadas?` : `Add the ${marked.length} marked tasks?`,
          items: [
            {
              id: `${SUMMARY_ALL_BUTTON_PREFIX}${offer.offerId}`,
              title: language === 'es' ? buttonTitle([`Agregar marcadas (${marked.length})`, `Agregar (${marked.length})`]) : buttonTitle([`Add marked (${marked.length})`]),
            },
            { id: `${SUMMARY_NONE_BUTTON_PREFIX}${offer.offerId}`, title: language === 'es' ? 'Ninguna' : 'None' },
          ],
        }
      : null;
  return { text, buttons, offer, counts: { shown: shown.length, open: open.length, marked: marked.length, accepted, more } };
}

// ---------------------------------------------------------------------------------------------
// The result of a reply
// ---------------------------------------------------------------------------------------------

export interface ResultRenderInput {
  language: Language;
  /** What was asked, by stable number. */
  requested: readonly { n: number; anchorId: string; decision: 'accept' | 'drop' }[];
  results: readonly CommitmentDecisionResult[];
  /** The list after decide (titles of the added lines). */
  items: readonly CommitmentItem[];
  /** Numbers that are not in the offer. */
  unknown: readonly number[];
}

function numbersText(numbers: readonly number[]): string {
  return [...numbers].sort((a, b) => a - b).join(', ');
}

/** "Added 2 tasks: ..." and the other outcomes, by number (see section 4.2 Result). */
export function renderResult(input: ResultRenderInput): { text: string; counts: Record<string, number> } {
  const language = lang(input.language);
  const es = language === 'es';
  const byAnchor = new Map(input.items.map((item) => [item.anchorId, item]));
  const asked = new Map(input.requested.map((entry) => [entry.anchorId, entry]));
  const added: string[] = [];
  const already: number[] = [];
  const dropped: number[] = [];
  const notOpenAccept: number[] = [];
  const notOpenDrop: number[] = [];
  for (const result of input.results) {
    const entry = asked.get(result.anchorId);
    if (entry === undefined) continue;
    switch (result.outcome) {
      case 'added': {
        const item = byAnchor.get(result.anchorId);
        added.push(contentLine(item?.title ?? `#${entry.n}`, MAX_RESULT_TITLE_CHARS));
        break;
      }
      case 'already_added':
        already.push(entry.n);
        break;
      case 'dropped':
        dropped.push(entry.n);
        break;
      default:
        if (entry.decision === 'accept') notOpenAccept.push(entry.n);
        else notOpenDrop.push(entry.n);
        break;
    }
  }
  const lines: string[] = [];
  if (added.length === 1) {
    lines.push(
      es
        ? `Se agregó 1 tarea: ${added[0] ?? ''}. Tu teléfono pone su recordatorio la próxima vez que Meeting Guard AI se sincronice; abre la app para asegurarte.`
        : `Added 1 task: ${added[0] ?? ''}. Your phone sets its reminder the next time Meeting Guard AI syncs; open the app to be sure.`,
    );
  } else if (added.length > 1) {
    lines.push(
      es
        ? `Se agregaron ${added.length} tareas: ${added.join('; ')}. Tu teléfono pone sus recordatorios la próxima vez que Meeting Guard AI se sincronice; abre la app para asegurarte.`
        : `Added ${added.length} tasks: ${added.join('; ')}. Your phone sets their reminders the next time Meeting Guard AI syncs; open the app to be sure.`,
    );
  }
  if (already.length > 0) lines.push(es ? `Ya están en tus tareas: ${numbersText(already)}.` : `Already in your tasks: ${numbersText(already)}.`);
  if (dropped.length > 0) {
    lines.push(es ? `Quitadas de la lista: ${numbersText(dropped)}. Puedes restaurarlas en la app.` : `Removed from the list: ${numbersText(dropped)}. You can restore them in the app.`);
  }
  if (notOpenAccept.length > 0) {
    lines.push(
      es
        ? `No se agregaron porque se quitaron de la lista: ${numbersText(notOpenAccept)}. Restáuralas primero en la app.`
        : `Not added, because they were removed from the list: ${numbersText(notOpenAccept)}. Restore them in the app first.`,
    );
  }
  if (notOpenDrop.length > 0) {
    lines.push(
      es
        ? `Ya están en tus tareas, así que no se quitaron: ${numbersText(notOpenDrop)}. Bórralas en la app si quieres.`
        : `Already in your tasks, so not removed: ${numbersText(notOpenDrop)}. Delete them in the app if you want.`,
    );
  }
  if (input.unknown.length > 0) lines.push(es ? `No están en la lista: ${numbersText(input.unknown)}.` : `Not in the list: ${numbersText(input.unknown)}.`);
  if (lines.length === 0) lines.push(workerTexts(language).nothingToChange);
  return {
    text: sliceSafe(lines.join('\n'), MAX_TEXT_CHARS),
    counts: { added: added.length, already: already.length, dropped: dropped.length, notOpen: notOpenAccept.length + notOpenDrop.length, unknown: input.unknown.length },
  };
}
