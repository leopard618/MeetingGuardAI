/**
 * The WhatsApp messages of suggested tasks (docs/v2/M11-DESIGN.md sections 4.2 and 11; section 15
 * findings 10 and 23). PURE: no Firebase, no logging, no clock. M12: every app language (EN, ES,
 * PT (pt-BR), FR, DE), one table per language below; anything else reads English. The reply words a
 * footer names are exactly the ones whatsapp/summaryRoute.ts accepts for that language.
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
 * - Our own text is ASCII (Spanish, Portuguese, French and German keep their accents); no
 *   typographic punctuation anywhere (no curly quotes, dashes, ellipsis or no-break spaces; French
 *   puts no space before : ; ? or !).
 *
 * Nothing here logs; the counts it returns are safe to log.
 */
import {
  APP_LANGUAGES,
  type AppLanguage,
  type AssistantUsage,
  type CommitmentDecisionResult,
  type CommitmentItem,
  type CommitmentPreselectReason,
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

/** The language a message is written in: any APP_LANGUAGES entry, anything else reads English. */
function lang(language: AppLanguage | string | null | undefined): AppLanguage {
  return (APP_LANGUAGES as readonly unknown[]).includes(language) ? (language as AppLanguage) : 'en';
}

/** `text` ending with one period (a French or German month abbreviation already ends with one). */
function sentence(text: string): string {
  return text.endsWith('.') ? text : `${text}.`;
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

const MONTHS: Readonly<Record<AppLanguage, readonly string[]>> = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
  pt: ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'],
  fr: ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'],
  de: ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.'],
};
const WEEKDAYS: Readonly<Record<AppLanguage, readonly string[]>> = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  es: ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'],
  pt: ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'],
  fr: ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'],
  de: ['So.', 'Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.'],
};

/** Day and month order per language: English is month-first, every other language day-first. */
const DATE_SHAPES: Readonly<Record<AppLanguage, { short: (d: number, month: string) => string; due: (weekday: string, d: number, month: string) => string }>> = {
  en: { short: (d, month) => `${month} ${d}`, due: (weekday, d, month) => `${weekday}, ${month} ${d}` },
  es: { short: (d, month) => `${d} ${month}`, due: (weekday, d, month) => `${weekday} ${d} ${month}` },
  pt: { short: (d, month) => `${d} ${month}`, due: (weekday, d, month) => `${weekday}, ${d} ${month}` },
  fr: { short: (d, month) => `${d} ${month}`, due: (weekday, d, month) => `${weekday} ${d} ${month}` },
  de: { short: (d, month) => `${d}. ${month}`, due: (weekday, d, month) => `${weekday}, ${d}. ${month}` },
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

/** "Oct 16" / "16 oct" / "16 out" / "16 oct." / "16. Okt."; null for anything that is not a YYYY-MM-DD date. */
export function shortDateOf(date: string | null, language: AppLanguage): string | null {
  const parts = date === null ? null : partsOf(date);
  if (parts === null) return null;
  const l = lang(language);
  return DATE_SHAPES[l].short(parts.d, MONTHS[l][parts.m - 1] ?? '');
}

/** "Fri, Oct 17" / "vie 17 oct" / "sex, 17 out" / "ven. 17 oct." / "Fr., 17. Okt.". */
export function dueDateOf(date: string, language: AppLanguage): string {
  const parts = partsOf(date);
  if (parts === null) return date;
  const l = lang(language);
  return DATE_SHAPES[l].due(WEEKDAYS[l][parts.wd] ?? '', parts.d, MONTHS[l][parts.m - 1] ?? '');
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

const WORKER_TEXTS: Readonly<Record<AppLanguage, WorkerTexts>> = {
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
  pt: {
    noSummary:
      'Você não tem resumos do assistente de anotações dos últimos 14 dias com tarefas para revisar. Os resumos que você arquiva em uma reunião ou guarda no app aparecem aqui.',
    preparing: 'Suas tarefas sugeridas estão sendo preparadas agora. Escreva compromissos de novo em um minuto.',
    offerCap: 'Você pediu esta lista muitas vezes hoje. Abra o app para revisá-la.',
    stale: 'Este resumo mudou desde essa lista. Escreva compromissos para ver a nova lista.',
    expired: 'Essa lista expirou. Escreva compromissos para ver uma nova.',
    notFound: 'Esse resumo não está mais disponível.',
    aiUnavailable: 'O Meeting Guard AI não conseguiu preparar sugestões para este resumo agora. Você ainda pode responder com números da lista acima.',
    aiEmpty: 'O Meeting Guard AI não encontrou compromissos neste resumo. Você ainda pode responder com números da lista acima.',
    unavailable: 'As tarefas sugeridas não estão disponíveis agora. Abra o app para revisá-las.',
    notAllowed: 'As tarefas sugeridas não estão disponíveis para esta conta.',
    decideFailed: 'Não foi possível adicionar estas tarefas pelo WhatsApp. Abra o app para adicioná-las.',
    nothingMarked: 'Nada está marcado. Responda com os números que você quer.',
    unknownNumbers: 'Nenhum desses números está na lista. Responda com números da lista, por exemplo 1 3.',
    nothingToChange: 'Nada para alterar.',
  },
  fr: {
    noSummary:
      "Vous n'avez aucun compte rendu d'assistant de prise de notes des 14 derniers jours avec des tâches à vérifier. Les comptes rendus que vous classez sous une réunion ou conservez dans l'application apparaissent ici.",
    preparing: 'Vos tâches suggérées sont en cours de préparation. Écrivez engagements à nouveau dans une minute.',
    offerCap: "Vous avez demandé cette liste de nombreuses fois aujourd'hui. Ouvrez l'application pour la consulter.",
    stale: 'Ce compte rendu a changé depuis cette liste. Écrivez engagements pour obtenir la nouvelle liste.',
    expired: 'Cette liste a expiré. Écrivez engagements pour en obtenir une nouvelle.',
    notFound: "Ce compte rendu n'est plus disponible.",
    aiUnavailable:
      "Meeting Guard AI n'a pas pu préparer de suggestions pour ce compte rendu pour le moment. Vous pouvez toujours répondre avec des numéros de la liste ci-dessus.",
    aiEmpty: "Meeting Guard AI n'a trouvé aucun engagement dans ce compte rendu. Vous pouvez toujours répondre avec des numéros de la liste ci-dessus.",
    unavailable: "Les tâches suggérées ne sont pas disponibles pour le moment. Ouvrez l'application pour les consulter.",
    notAllowed: 'Les tâches suggérées ne sont pas disponibles pour ce compte.',
    decideFailed: "Ces tâches n'ont pas pu être ajoutées depuis WhatsApp. Ouvrez l'application pour les ajouter.",
    nothingMarked: "Rien n'est coché. Répondez avec les numéros souhaités.",
    unknownNumbers: "Aucun de ces numéros n'est dans la liste. Répondez avec des numéros de la liste, par exemple 1 3.",
    nothingToChange: 'Rien à modifier.',
  },
  de: {
    noSummary:
      'Sie haben aus den letzten 14 Tagen kein Protokoll eines Notizassistenten mit Aufgaben zum Prüfen. Protokolle, die Sie einer Besprechung zuordnen oder in der App behalten, erscheinen hier.',
    preparing: 'Ihre vorgeschlagenen Aufgaben werden gerade vorbereitet. Schreiben Sie in einer Minute noch einmal Zusagen.',
    offerCap: 'Sie haben diese Liste heute schon oft angefordert. Öffnen Sie die App, um sie zu prüfen.',
    stale: 'Dieses Protokoll hat sich seit dieser Liste geändert. Schreiben Sie Zusagen für die neue Liste.',
    expired: 'Diese Liste ist abgelaufen. Schreiben Sie Zusagen für eine neue Liste.',
    notFound: 'Dieses Protokoll ist nicht mehr verfügbar.',
    aiUnavailable:
      'Meeting Guard AI konnte für dieses Protokoll gerade keine Vorschläge vorbereiten. Sie können weiterhin mit Nummern aus der Liste oben antworten.',
    aiEmpty: 'Meeting Guard AI hat in diesem Protokoll keine Zusagen gefunden. Sie können weiterhin mit Nummern aus der Liste oben antworten.',
    unavailable: 'Vorgeschlagene Aufgaben sind gerade nicht verfügbar. Öffnen Sie die App, um sie zu prüfen.',
    notAllowed: 'Vorgeschlagene Aufgaben sind für dieses Konto nicht verfügbar.',
    decideFailed: 'Diese Aufgaben konnten nicht über WhatsApp hinzugefügt werden. Öffnen Sie die App, um sie hinzuzufügen.',
    nothingMarked: 'Nichts ist markiert. Antworten Sie mit den gewünschten Nummern.',
    unknownNumbers: 'Keine dieser Nummern steht in der Liste. Antworten Sie mit Nummern aus der Liste, zum Beispiel 1 3.',
    nothingToChange: 'Es gibt nichts zu ändern.',
  },
};

export function workerTexts(language: AppLanguage | string | null | undefined): WorkerTexts {
  return WORKER_TEXTS[lang(language)];
}

interface QuotaTexts {
  /** Appended to every variant. */
  tail: string;
  /** No usage known. */
  now: string;
  /** The free window is used, or a subscription is required. */
  window: string;
  /** A paid month is used; `renew` is the short renewal date, or null when unknown. */
  month: (limit: number, renew: string | null) => string;
  /** The free day is used. */
  day: (limit: number) => string;
}

const QUOTA_TEXTS: Readonly<Record<AppLanguage, QuotaTexts>> = {
  en: {
    tail: ' You can still reply with numbers from the list above.',
    now: 'You reached your AI action limit for now. The action items as written stay free.',
    window: 'Your free AI actions are used. A subscription unlocks AI; the action items as written stay free.',
    month: (limit, renew) => `You used the ${limit} AI actions of this month. They renew on ${renew ?? 'the day you subscribed'}. The action items as written stay free.`,
    day: (limit) => `You used today's ${limit} free AI actions. More are available after midnight UTC. The action items as written stay free.`,
  },
  es: {
    tail: ' Aún puedes responder con números de la lista anterior.',
    now: 'Alcanzaste tu límite de acciones de IA por ahora. Las tareas tal como están escritas siguen gratis.',
    window: 'Tus acciones de IA gratuitas se acabaron. Una suscripción desbloquea la IA; las tareas tal como están escritas siguen gratis.',
    month: (limit, renew) =>
      `Usaste las ${limit} acciones de IA de este mes. Se renuevan el ${renew ?? 'día en que te suscribiste'}. Las tareas tal como están escritas siguen gratis.`,
    day: (limit) => `Usaste las ${limit} acciones de IA gratuitas de hoy. Hay más después de la medianoche UTC. Las tareas tal como están escritas siguen gratis.`,
  },
  pt: {
    tail: ' Você ainda pode responder com números da lista acima.',
    now: 'Você atingiu seu limite de ações de IA por enquanto. As tarefas como estão escritas continuam grátis.',
    window: 'Suas ações de IA grátis acabaram. Uma assinatura libera a IA; as tarefas como estão escritas continuam grátis.',
    month: (limit, renew) =>
      `Você usou as ${limit} ações de IA deste mês. Elas se renovam ${renew === null ? 'no dia em que você assinou' : `em ${renew}`}. As tarefas como estão escritas continuam grátis.`,
    day: (limit) => `Você usou as ${limit} ações de IA grátis de hoje. Há mais depois da meia-noite UTC. As tarefas como estão escritas continuam grátis.`,
  },
  fr: {
    tail: ' Vous pouvez toujours répondre avec des numéros de la liste ci-dessus.',
    now: "Vous avez atteint votre limite d'actions IA pour le moment. Les tâches telles qu'écrites restent gratuites.",
    window: "Vos actions IA gratuites sont épuisées. Un abonnement débloque l'IA; les tâches telles qu'écrites restent gratuites.",
    month: (limit, renew) =>
      `Vous avez utilisé les ${limit} actions IA de ce mois. ${sentence(`Elles se renouvellent ${renew === null ? 'le jour de votre abonnement' : `le ${renew}`}`)} Les tâches telles qu'écrites restent gratuites.`,
    day: (limit) => `Vous avez utilisé les ${limit} actions IA gratuites d'aujourd'hui. D'autres sont disponibles après minuit UTC. Les tâches telles qu'écrites restent gratuites.`,
  },
  de: {
    tail: ' Sie können weiterhin mit Nummern aus der Liste oben antworten.',
    now: 'Sie haben Ihr Limit für KI-Aktionen vorerst erreicht. Die Aufgaben, wie sie geschrieben sind, bleiben kostenlos.',
    window: 'Ihre kostenlosen KI-Aktionen sind aufgebraucht. Ein Abonnement schaltet die KI frei; die Aufgaben, wie sie geschrieben sind, bleiben kostenlos.',
    month: (limit, renew) =>
      `Sie haben die ${limit} KI-Aktionen dieses Monats genutzt. ${sentence(`Sie erneuern sich ${renew === null ? 'an dem Tag, an dem Sie abonniert haben' : `am ${renew}`}`)} Die Aufgaben, wie sie geschrieben sind, bleiben kostenlos.`,
    day: (limit) => `Sie haben die ${limit} kostenlosen KI-Aktionen von heute genutzt. Weitere gibt es nach Mitternacht UTC. Die Aufgaben, wie sie geschrieben sind, bleiben kostenlos.`,
  },
};

/** The allowance text of a quota refusal (ALLOWANCES-2026-11-05.md: the day, window and month wording). */
export function quotaText(language: AppLanguage, usage: AssistantUsage | null): string {
  const l = lang(language);
  const t = QUOTA_TEXTS[l];
  if (usage === null) return t.now + t.tail;
  if (usage.period === 'window' || usage.subscriptionRequired === true) return t.window + t.tail;
  if (usage.period === 'month') return t.month(usage.limit, shortDateOf(usage.resetsAt.slice(0, 10), l)) + t.tail;
  return t.day(usage.limit) + t.tail;
}

// ---------------------------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------------------------

/** Every text of the list message and its buttons, per language. */
interface ListTexts {
  /** The header lines; `title` is '' for a kept summary, `when` is '' or " (date)". */
  header: (title: string, when: string, ai: boolean) => string[];
  banner: Readonly<Record<CommitmentPreselectReason, string>>;
  truncated: string;
  due: (when: string, overdue: boolean) => string;
  section: (heading: string) => string;
  guess: (name: string) => string;
  quoteLabel: string;
  /** The reply instruction; it names exactly the reply words summaryRoute.ts accepts. */
  replyMarked: (marked: number, example: string) => string;
  replyUnmarked: (example: string) => string;
  zoneKnown: string;
  zoneUnknown: string;
  allDone: string;
  aiOffered: string;
  aiPrepared: string;
  emptyAi: string;
  emptyWritten: string;
  added: string;
  more: (more: number) => string;
  buttonBody: (marked: number) => string;
  /** Candidate titles for the ALL button, longest first; the first within 20 characters is used. */
  buttonAll: (marked: number) => string[];
  buttonNone: string;
}

const LIST_TEXTS: Readonly<Record<AppLanguage, ListTexts>> = {
  en: {
    header: (title, when, ai) => {
      const source = title.length > 0 ? `your notetaker's summary of "${title}"${when}` : `a notetaker summary${when}`;
      return ai
        ? [`Suggested tasks from ${source}.`, 'Written by AI; Meeting Guard AI did not attend. Nothing is added until you reply.']
        : [`The action items from ${source}, exactly as written. Nothing is added until you reply.`];
    },
    banner: {
      old_summary: 'Nothing is marked: we could not confirm when this summary was sent.',
      not_addressed_to_you: 'This summary was not sent to one of your mailboxes, so nothing is marked. Reply with the numbers you want.',
      forwarded: "Nothing is marked: this summary was forwarded and the notetaker's signature could not be checked.",
      possible_instruction: 'Nothing is marked: part of this summary reads like instructions to software. Read each item.',
    },
    truncated: 'Only the first part of a long summary was read.',
    due: (when, overdue) => (overdue ? ` - was due ${when}` : ` - due ${when}`),
    section: (heading) => ` (from ${heading})`,
    guess: (name) => ` (you? the summary says: ${name})`,
    quoteLabel: '   From the summary: "',
    replyMarked: (marked, ex) => `Reply ALL to add the ${marked} marked, numbers to add only those (for example ${ex}), DROP and numbers to remove some, or NONE.`,
    replyUnmarked: (ex) => `Reply with the numbers you want to add (for example ${ex}), DROP and numbers to remove some, or NONE.`,
    zoneKnown: 'Items without a date remind you tomorrow at 9:00. Edit them in the app.',
    zoneUnknown: 'Items without a date get no reminder: set one in the app. Edit them in the app.',
    allDone: 'Everything in this list is already in your tasks or was removed. Open the app to review it.',
    aiOffered: "Reply AI to have Meeting Guard AI read the whole summary and suggest tasks. The summary's text goes to OpenAI through our server and this uses 1 AI action.",
    aiPrepared: 'Reply AI to see the tasks Meeting Guard AI already suggested for this summary (no new AI action).',
    emptyAi: 'Meeting Guard AI found no commitments in this summary.',
    emptyWritten: 'No action items were found as written in this summary.',
    added: '(added)',
    more: (more) => `And ${more} more in the app.`,
    buttonBody: (marked) => `Add the ${marked} marked tasks?`,
    buttonAll: (marked) => [`Add marked (${marked})`],
    buttonNone: 'None',
  },
  es: {
    header: (title, when, ai) => {
      const source = title.length > 0 ? `la minuta de tu asistente de notas sobre "${title}"${when}` : `una minuta de tu asistente de notas${when}`;
      return ai
        ? [`Tareas sugeridas de ${source}.`, 'Escritas por IA; Meeting Guard AI no asistió. No se agrega nada hasta que respondas.']
        : [`Las tareas de ${source}, tal como están escritas. No se agrega nada hasta que respondas.`];
    },
    banner: {
      old_summary: 'No hay nada marcado: no pudimos confirmar cuándo se envió esta minuta.',
      not_addressed_to_you: 'Esta minuta no se envió a uno de tus buzones, así que no hay nada marcado. Responde con los números que quieras.',
      forwarded: 'No hay nada marcado: esta minuta se reenvió y no se pudo comprobar la firma del asistente de notas.',
      possible_instruction: 'No hay nada marcado: parte de esta minuta parece contener instrucciones para software. Lee cada tarea.',
    },
    truncated: 'Solo se leyó la primera parte de una minuta larga.',
    due: (when, overdue) => (overdue ? ` - venció ${when}` : ` - vence ${when}`),
    section: (heading) => ` (de ${heading})`,
    guess: (name) => ` (¿tú? la minuta dice: ${name})`,
    quoteLabel: '   De la minuta: "',
    replyMarked: (marked, ex) =>
      `Responde TODOS para agregar las ${marked} marcadas, números para agregar solo esas (por ejemplo ${ex}), QUITAR y números para quitar algunas, o NINGUNO.`,
    replyUnmarked: (ex) => `Responde con los números que quieras agregar (por ejemplo ${ex}), QUITAR y números para quitar algunas, o NINGUNO.`,
    zoneKnown: 'Las que no tienen fecha te avisan mañana a las 9:00. Edítalas en la app.',
    zoneUnknown: 'Las que no tienen fecha no tienen recordatorio: ponlo en la app. Edítalas en la app.',
    allDone: 'Todo lo de esta lista ya está en tus tareas o se quitó. Revísalo en la app.',
    aiOffered:
      'Responde IA para que Meeting Guard AI lea toda la minuta y sugiera tareas. El texto de la minuta se envía a OpenAI a través de nuestro servidor y esto usa 1 acción de IA.',
    aiPrepared: 'Responde IA para ver las tareas que Meeting Guard AI ya sugirió para esta minuta (sin una nueva acción de IA).',
    emptyAi: 'Meeting Guard AI no encontró compromisos en esta minuta.',
    emptyWritten: 'No se encontraron tareas escritas en esta minuta.',
    added: '(agregada)',
    more: (more) => `Y ${more} más en la app.`,
    buttonBody: (marked) => `¿Agrego las ${marked} tareas marcadas?`,
    buttonAll: (marked) => [`Agregar marcadas (${marked})`, `Agregar (${marked})`],
    buttonNone: 'Ninguna',
  },
  pt: {
    header: (title, when, ai) => {
      const source = title.length > 0 ? `do resumo do seu assistente de anotações sobre "${title}"${when}` : `de um resumo do assistente de anotações${when}`;
      return ai
        ? [`Tarefas sugeridas ${source}.`, 'Escritas por IA; o Meeting Guard AI não participou. Nada é adicionado até você responder.']
        : [`As tarefas ${source}, exatamente como estão escritas. Nada é adicionado até você responder.`];
    },
    banner: {
      old_summary: 'Nada está marcado: não conseguimos confirmar quando este resumo foi enviado.',
      not_addressed_to_you: 'Este resumo não foi enviado a uma das suas caixas de e-mail, então nada está marcado. Responda com os números que você quer.',
      forwarded: 'Nada está marcado: este resumo foi encaminhado e não foi possível verificar a assinatura do assistente de anotações.',
      possible_instruction: 'Nada está marcado: parte deste resumo parece conter instruções para software. Leia cada tarefa.',
    },
    truncated: 'Só a primeira parte de um resumo longo foi lida.',
    due: (when, overdue) => (overdue ? ` - venceu ${when}` : ` - vence ${when}`),
    section: (heading) => ` (de ${heading})`,
    guess: (name) => ` (você? o resumo diz: ${name})`,
    quoteLabel: '   Do resumo: "',
    replyMarked: (marked, ex) =>
      `Responda TODAS para adicionar as ${marked} marcadas, números para adicionar só essas (por exemplo ${ex}), REMOVER e números para remover algumas, ou NENHUMA.`,
    replyUnmarked: (ex) => `Responda com os números que você quer adicionar (por exemplo ${ex}), REMOVER e números para remover algumas, ou NENHUMA.`,
    zoneKnown: 'As que não têm data lembram você amanhã às 9:00. Edite-as no app.',
    zoneUnknown: 'As que não têm data ficam sem lembrete: defina um no app. Edite-as no app.',
    allDone: 'Tudo desta lista já está nas suas tarefas ou foi removido. Abra o app para revisar.',
    aiOffered:
      'Responda IA para o Meeting Guard AI ler todo o resumo e sugerir tarefas. O texto do resumo vai para a OpenAI pelo nosso servidor e isso usa 1 ação de IA.',
    aiPrepared: 'Responda IA para ver as tarefas que o Meeting Guard AI já sugeriu para este resumo (sem uma nova ação de IA).',
    emptyAi: 'O Meeting Guard AI não encontrou compromissos neste resumo.',
    emptyWritten: 'Nenhuma tarefa escrita foi encontrada neste resumo.',
    added: '(adicionada)',
    more: (more) => `E mais ${more} no app.`,
    buttonBody: (marked) => `Adicionar as ${marked} tarefas marcadas?`,
    buttonAll: (marked) => [`Adicionar marcadas (${marked})`, `Adicionar (${marked})`],
    buttonNone: 'Nenhuma',
  },
  fr: {
    header: (title, when, ai) => {
      const source =
        title.length > 0 ? `du compte rendu de votre assistant de prise de notes sur "${title}"${when}` : `d'un compte rendu d'assistant de prise de notes${when}`;
      return ai
        ? [`Tâches suggérées à partir ${source}.`, "Rédigées par IA; Meeting Guard AI n'a pas assisté à la réunion. Rien n'est ajouté avant votre réponse."]
        : [`Les tâches ${source}, exactement telles qu'écrites. Rien n'est ajouté avant votre réponse.`];
    },
    banner: {
      old_summary: "Rien n'est coché: nous n'avons pas pu confirmer quand ce compte rendu a été envoyé.",
      not_addressed_to_you: "Ce compte rendu n'a pas été envoyé à l'une de vos boîtes mail, donc rien n'est coché. Répondez avec les numéros souhaités.",
      forwarded: "Rien n'est coché: ce compte rendu a été transféré et la signature de l'assistant de prise de notes n'a pas pu être vérifiée.",
      possible_instruction: "Rien n'est coché: une partie de ce compte rendu ressemble à des instructions pour un logiciel. Lisez chaque tâche.",
    },
    truncated: "Seule la première partie d'un long compte rendu a été lue.",
    due: (when, overdue) => (overdue ? ` - échéance passée ${when}` : ` - échéance ${when}`),
    section: (heading) => ` (de ${heading})`,
    guess: (name) => ` (vous? le compte rendu indique: ${name})`,
    quoteLabel: '   Du compte rendu: "',
    replyMarked: (marked, ex) =>
      `Répondez TOUTES pour ajouter les ${marked} cochées, des numéros pour n'ajouter que celles-ci (par exemple ${ex}), RETIRER et des numéros pour en retirer, ou AUCUNE.`,
    replyUnmarked: (ex) => `Répondez avec les numéros à ajouter (par exemple ${ex}), RETIRER et des numéros pour en retirer, ou AUCUNE.`,
    zoneKnown: "Celles sans date vous rappellent demain à 9h00. Modifiez-les dans l'application.",
    zoneUnknown: "Celles sans date n'ont pas de rappel: définissez-en un dans l'application. Modifiez-les dans l'application.",
    allDone: "Tout ce qui figure dans cette liste est déjà dans vos tâches ou a été retiré. Ouvrez l'application pour vérifier.",
    aiOffered:
      'Répondez IA pour que Meeting Guard AI lise tout le compte rendu et suggère des tâches. Le texte du compte rendu est envoyé à OpenAI via notre serveur et cela utilise 1 action IA.',
    aiPrepared: 'Répondez IA pour voir les tâches que Meeting Guard AI a déjà suggérées pour ce compte rendu (sans nouvelle action IA).',
    emptyAi: "Meeting Guard AI n'a trouvé aucun engagement dans ce compte rendu.",
    emptyWritten: "Aucune tâche écrite n'a été trouvée dans ce compte rendu.",
    added: '(ajoutée)',
    more: (more) => `Et ${more} de plus dans l'application.`,
    buttonBody: (marked) => `Ajouter les ${marked} tâches cochées?`,
    buttonAll: (marked) => [`Ajouter cochées (${marked})`, `Ajouter (${marked})`],
    buttonNone: 'Aucune',
  },
  de: {
    header: (title, when, ai) => {
      const source = title.length > 0 ? `aus dem Protokoll Ihres Notizassistenten zu "${title}"${when}` : `aus dem Protokoll eines Notizassistenten${when}`;
      return ai
        ? [`Vorgeschlagene Aufgaben ${source}.`, 'Von KI geschrieben; Meeting Guard AI hat nicht teilgenommen. Nichts wird hinzugefügt, bevor Sie antworten.']
        : [`Die Aufgaben ${source}, genau wie geschrieben. Nichts wird hinzugefügt, bevor Sie antworten.`];
    },
    banner: {
      old_summary: 'Nichts ist markiert: Wir konnten nicht bestätigen, wann dieses Protokoll gesendet wurde.',
      not_addressed_to_you: 'Dieses Protokoll wurde nicht an eines Ihrer Postfächer gesendet, daher ist nichts markiert. Antworten Sie mit den gewünschten Nummern.',
      forwarded: 'Nichts ist markiert: Dieses Protokoll wurde weitergeleitet, und die Signatur des Notizassistenten konnte nicht geprüft werden.',
      possible_instruction: 'Nichts ist markiert: Ein Teil dieses Protokolls liest sich wie Anweisungen an Software. Lesen Sie jede Aufgabe.',
    },
    truncated: 'Nur der erste Teil eines langen Protokolls wurde gelesen.',
    due: (when, overdue) => (overdue ? ` - war fällig ${when}` : ` - fällig ${when}`),
    section: (heading) => ` (aus ${heading})`,
    guess: (name) => ` (Sie? das Protokoll nennt: ${name})`,
    quoteLabel: '   Aus dem Protokoll: "',
    replyMarked: (marked, ex) =>
      `Antworten Sie ALLE, um die ${marked} markierten hinzuzufügen, Nummern, um nur diese hinzuzufügen (zum Beispiel ${ex}), ENTFERNEN und Nummern, um einige zu entfernen, oder KEINE.`,
    replyUnmarked: (ex) => `Antworten Sie mit den Nummern, die Sie hinzufügen möchten (zum Beispiel ${ex}), ENTFERNEN und Nummern, um einige zu entfernen, oder KEINE.`,
    zoneKnown: 'Aufgaben ohne Datum erinnern Sie morgen um 9:00 Uhr. Bearbeiten Sie sie in der App.',
    zoneUnknown: 'Aufgaben ohne Datum erhalten keine Erinnerung: Legen Sie eine in der App fest. Bearbeiten Sie sie in der App.',
    allDone: 'Alles in dieser Liste ist schon in Ihren Aufgaben oder wurde entfernt. Öffnen Sie die App, um es zu prüfen.',
    aiOffered:
      'Antworten Sie KI, damit Meeting Guard AI das ganze Protokoll liest und Aufgaben vorschlägt. Der Text des Protokolls geht über unseren Server an OpenAI, und das verbraucht 1 KI-Aktion.',
    aiPrepared: 'Antworten Sie KI, um die Aufgaben zu sehen, die Meeting Guard AI für dieses Protokoll schon vorgeschlagen hat (ohne neue KI-Aktion).',
    emptyAi: 'Meeting Guard AI hat in diesem Protokoll keine Zusagen gefunden.',
    emptyWritten: 'In diesem Protokoll wurden keine geschriebenen Aufgaben gefunden.',
    added: '(hinzugefügt)',
    more: (more) => `Und ${more} weitere in der App.`,
    buttonBody: (marked) => `Die ${marked} markierten Aufgaben hinzufügen?`,
    buttonAll: (marked) => [`Markierte hinzufügen (${marked})`, `Hinzufügen (${marked})`],
    buttonNone: 'Keine',
  },
};

export interface OfferRenderInput {
  language: AppLanguage;
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

function headerOf(language: AppLanguage, commitments: SummaryCommitments, maxLine: number): string[] {
  const origin = commitments.origin;
  const title = origin.meetingTitle === null ? '' : contentLine(origin.meetingTitle, Math.min(MAX_MEETING_TITLE_CHARS, maxLine));
  const date = shortDateOf(origin.occurrenceDate ?? origin.localDate, language);
  const when = date === null ? '' : ` (${date})`;
  return LIST_TEXTS[language].header(title, when, commitments.mode === 'ai');
}

function bannerOf(language: AppLanguage, commitments: SummaryCommitments): string[] {
  const t = LIST_TEXTS[language];
  const lines: string[] = [];
  const reason = commitments.preselect.reason;
  if (reason !== null) lines.push(t.banner[reason]);
  if (commitments.truncated) lines.push(t.truncated);
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

function dueSuffixOf(item: CommitmentItem, language: AppLanguage): string {
  const due = item.due;
  if (due === null) return '';
  const when = `${dueDateOf(due.date, language)}${due.time === null ? '' : ` ${due.time}${due.zone === null ? '' : ` (${due.zone})`}`}`;
  return LIST_TEXTS[language].due(when, due.overdue);
}

function sectionSuffixOf(item: CommitmentItem, language: AppLanguage): string {
  if (ACTION_LIST_KINDS.has(item.sectionKind) || item.sectionHeading === null) return '';
  const heading = contentLine(item.sectionHeading, MAX_HEADING_CHARS);
  if (heading.length === 0) return '';
  return LIST_TEXTS[language].section(heading);
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
function guessSuffixOf(item: CommitmentItem, language: AppLanguage): string {
  if (!isOwnerGuess(item) || item.owner === null) return '';
  const name = contentLine(item.owner.name, MAX_GUESS_NAME_CHARS);
  if (name.length === 0) return '';
  return LIST_TEXTS[language].guess(name);
}

/** One numbered line, within maxLine (the title is what gets cut). */
function itemLine(prefix: string, title: string, suffix: string, maxLine: number): string {
  const room = Math.max(20, maxLine - prefix.length - suffix.length);
  return `${prefix}${contentLine(title, room)}${suffix}`;
}

function quoteLine(item: CommitmentItem, language: AppLanguage, maxLine: number): string {
  const label = LIST_TEXTS[language].quoteLabel;
  return `${label}${contentLine(item.quote, Math.max(20, maxLine - label.length - 1))}"`;
}

function exampleOf(open: readonly number[]): string {
  return open.slice(0, 2).join(' ') || '1';
}

function footerOf(language: AppLanguage, input: { open: number[]; marked: number; ai: SummaryOfferAi; zoneKnown: boolean; accepted: number }): string[] {
  const t = LIST_TEXTS[language];
  const lines: string[] = [];
  if (input.open.length > 0) {
    const ex = exampleOf(input.open);
    lines.push(input.marked > 0 ? t.replyMarked(input.marked, ex) : t.replyUnmarked(ex));
    lines.push(input.zoneKnown ? t.zoneKnown : t.zoneUnknown);
  } else if (input.accepted > 0) {
    lines.push(t.allDone);
  }
  if (input.ai === 'offered') lines.push(t.aiOffered);
  else if (input.ai === 'prepared') lines.push(t.aiPrepared);
  return lines;
}

function emptyLineOf(language: AppLanguage, commitments: SummaryCommitments): string {
  return commitments.mode === 'ai' ? LIST_TEXTS[language].emptyAi : LIST_TEXTS[language].emptyWritten;
}

function buttonTitle(candidates: readonly string[]): string {
  return candidates.find((title) => title.length <= MAX_BUTTON_TITLE_CHARS) ?? (candidates[candidates.length - 1] ?? '').slice(0, MAX_BUTTON_TITLE_CHARS);
}

/** The list message, its buttons and the offer it makes (see the module comment). */
export function renderOffer(input: OfferRenderInput): RenderedOffer {
  const language = lang(input.language);
  const t = LIST_TEXTS[language];
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
        ? `${item.number}. ${t.added} `
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
  if (more > 0) footer.unshift(t.more(more));

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
          body: t.buttonBody(marked.length),
          items: [
            { id: `${SUMMARY_ALL_BUTTON_PREFIX}${offer.offerId}`, title: buttonTitle(t.buttonAll(marked.length)) },
            { id: `${SUMMARY_NONE_BUTTON_PREFIX}${offer.offerId}`, title: buttonTitle([t.buttonNone]) },
          ],
        }
      : null;
  return { text, buttons, offer, counts: { shown: shown.length, open: open.length, marked: marked.length, accepted, more } };
}

// ---------------------------------------------------------------------------------------------
// The result of a reply
// ---------------------------------------------------------------------------------------------

export interface ResultRenderInput {
  language: AppLanguage;
  /** What was asked, by stable number. */
  requested: readonly { n: number; anchorId: string; decision: 'accept' | 'drop' }[];
  results: readonly CommitmentDecisionResult[];
  /** The list after decide (titles of the added lines). */
  items: readonly CommitmentItem[];
  /** Numbers that are not in the offer. */
  unknown: readonly number[];
}

interface ResultTexts {
  addedOne: (title: string) => string;
  addedMany: (count: number, titles: string) => string;
  already: (numbers: string) => string;
  dropped: (numbers: string) => string;
  notOpenAccept: (numbers: string) => string;
  notOpenDrop: (numbers: string) => string;
  unknown: (numbers: string) => string;
}

const RESULT_TEXTS: Readonly<Record<AppLanguage, ResultTexts>> = {
  en: {
    addedOne: (title) => `Added 1 task: ${title}. Your phone sets its reminder the next time Meeting Guard AI syncs; open the app to be sure.`,
    addedMany: (count, titles) => `Added ${count} tasks: ${titles}. Your phone sets their reminders the next time Meeting Guard AI syncs; open the app to be sure.`,
    already: (numbers) => `Already in your tasks: ${numbers}.`,
    dropped: (numbers) => `Removed from the list: ${numbers}. You can restore them in the app.`,
    notOpenAccept: (numbers) => `Not added, because they were removed from the list: ${numbers}. Restore them in the app first.`,
    notOpenDrop: (numbers) => `Already in your tasks, so not removed: ${numbers}. Delete them in the app if you want.`,
    unknown: (numbers) => `Not in the list: ${numbers}.`,
  },
  es: {
    addedOne: (title) =>
      `Se agregó 1 tarea: ${title}. Tu teléfono pone su recordatorio la próxima vez que Meeting Guard AI se sincronice; abre la app para asegurarte.`,
    addedMany: (count, titles) =>
      `Se agregaron ${count} tareas: ${titles}. Tu teléfono pone sus recordatorios la próxima vez que Meeting Guard AI se sincronice; abre la app para asegurarte.`,
    already: (numbers) => `Ya están en tus tareas: ${numbers}.`,
    dropped: (numbers) => `Quitadas de la lista: ${numbers}. Puedes restaurarlas en la app.`,
    notOpenAccept: (numbers) => `No se agregaron porque se quitaron de la lista: ${numbers}. Restáuralas primero en la app.`,
    notOpenDrop: (numbers) => `Ya están en tus tareas, así que no se quitaron: ${numbers}. Bórralas en la app si quieres.`,
    unknown: (numbers) => `No están en la lista: ${numbers}.`,
  },
  pt: {
    addedOne: (title) =>
      `1 tarefa adicionada: ${title}. Seu celular define o lembrete na próxima vez que o Meeting Guard AI sincronizar; abra o app para ter certeza.`,
    addedMany: (count, titles) =>
      `${count} tarefas adicionadas: ${titles}. Seu celular define os lembretes na próxima vez que o Meeting Guard AI sincronizar; abra o app para ter certeza.`,
    already: (numbers) => `Já estão nas suas tarefas: ${numbers}.`,
    dropped: (numbers) => `Removidas da lista: ${numbers}. Você pode restaurá-las no app.`,
    notOpenAccept: (numbers) => `Não adicionadas, porque foram removidas da lista: ${numbers}. Restaure-as primeiro no app.`,
    notOpenDrop: (numbers) => `Já estão nas suas tarefas, então não foram removidas: ${numbers}. Exclua-as no app se quiser.`,
    unknown: (numbers) => `Não estão na lista: ${numbers}.`,
  },
  fr: {
    addedOne: (title) =>
      `1 tâche ajoutée: ${title}. Votre téléphone programme son rappel à la prochaine synchronisation de Meeting Guard AI; ouvrez l'application pour en être sûr.`,
    addedMany: (count, titles) =>
      `${count} tâches ajoutées: ${titles}. Votre téléphone programme leurs rappels à la prochaine synchronisation de Meeting Guard AI; ouvrez l'application pour en être sûr.`,
    already: (numbers) => `Déjà dans vos tâches: ${numbers}.`,
    dropped: (numbers) => `Retirées de la liste: ${numbers}. Vous pouvez les restaurer dans l'application.`,
    notOpenAccept: (numbers) => `Non ajoutées, car elles ont été retirées de la liste: ${numbers}. Restaurez-les d'abord dans l'application.`,
    notOpenDrop: (numbers) => `Déjà dans vos tâches, donc non retirées: ${numbers}. Supprimez-les dans l'application si vous le souhaitez.`,
    unknown: (numbers) => `Pas dans la liste: ${numbers}.`,
  },
  de: {
    addedOne: (title) =>
      `1 Aufgabe hinzugefügt: ${title}. Ihr Telefon stellt die Erinnerung bei der nächsten Synchronisierung von Meeting Guard AI ein; öffnen Sie die App, um sicherzugehen.`,
    addedMany: (count, titles) =>
      `${count} Aufgaben hinzugefügt: ${titles}. Ihr Telefon stellt die Erinnerungen bei der nächsten Synchronisierung von Meeting Guard AI ein; öffnen Sie die App, um sicherzugehen.`,
    already: (numbers) => `Schon in Ihren Aufgaben: ${numbers}.`,
    dropped: (numbers) => `Aus der Liste entfernt: ${numbers}. Sie können sie in der App wiederherstellen.`,
    notOpenAccept: (numbers) => `Nicht hinzugefügt, weil sie aus der Liste entfernt wurden: ${numbers}. Stellen Sie sie zuerst in der App wieder her.`,
    notOpenDrop: (numbers) => `Schon in Ihren Aufgaben, daher nicht entfernt: ${numbers}. Löschen Sie sie in der App, wenn Sie möchten.`,
    unknown: (numbers) => `Nicht in der Liste: ${numbers}.`,
  },
};

function numbersText(numbers: readonly number[]): string {
  return [...numbers].sort((a, b) => a - b).join(', ');
}

/** "Added 2 tasks: ..." and the other outcomes, by number (see section 4.2 Result). */
export function renderResult(input: ResultRenderInput): { text: string; counts: Record<string, number> } {
  const language = lang(input.language);
  const t = RESULT_TEXTS[language];
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
  if (added.length === 1) lines.push(t.addedOne(added[0] ?? ''));
  else if (added.length > 1) lines.push(t.addedMany(added.length, added.join('; ')));
  if (already.length > 0) lines.push(t.already(numbersText(already)));
  if (dropped.length > 0) lines.push(t.dropped(numbersText(dropped)));
  if (notOpenAccept.length > 0) lines.push(t.notOpenAccept(numbersText(notOpenAccept)));
  if (notOpenDrop.length > 0) lines.push(t.notOpenDrop(numbersText(notOpenDrop)));
  if (input.unknown.length > 0) lines.push(t.unknown(numbersText(input.unknown)));
  if (lines.length === 0) lines.push(workerTexts(language).nothingToChange);
  return {
    text: sliceSafe(lines.join('\n'), MAX_TEXT_CHARS),
    counts: { added: added.length, already: already.length, dropped: dropped.length, notOpen: notOpenAccept.length + notOpenDrop.length, unknown: input.unknown.length },
  };
}
