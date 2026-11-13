/**
 * Every user- and contact-facing string of the matters module (EN + ES), and the read-back.
 *
 * The read-back is written by CODE from the mandate, never by the model: what the user reads
 * before confirming is exactly what was hashed and what the send check enforces. Plain
 * punctuation only (CONTRIBUTING: no em or en dashes, ellipsis characters or curly quotes).
 */
import type { Language } from '../shared/aiContract';
import type { Mandate } from './model';

const LOCALES: Readonly<Record<Language, string>> = { en: 'en-US', es: 'es-ES' };

/** "Fri, Nov 13, 9:00 AM" in the mandate's zone (the zone name is said once, separately). */
export function formatInstant(iso: string, timeZone: string, language: Language): string {
  return new Intl.DateTimeFormat(LOCALES[language], {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
    .format(new Date(iso))
    .replace(/[\u202f\u00a0]/g, ' ');
}

/** "9:00 AM" in the zone. */
function formatTime(iso: string, timeZone: string, language: Language): string {
  return new Intl.DateTimeFormat(LOCALES[language], { timeZone, hour: 'numeric', minute: '2-digit' })
    .format(new Date(iso))
    .replace(/[\u202f\u00a0]/g, ' ');
}

function sameLocalDay(a: string, b: string, timeZone: string): boolean {
  const day = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  return day(a) === day(b);
}

/** "Mon, Nov 16" in the zone (no time). */
function formatDay(iso: string, timeZone: string, language: Language): string {
  return new Intl.DateTimeFormat(LOCALES[language], { timeZone, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(iso));
}

/** "HH:MM" (24 h) in the zone. */
function localClock(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}

/**
 * A meeting window in words. Whole days (from midnight, to midnight or 23:59) are shown as dates
 * only ("Mon, Nov 16 to Fri, Nov 20"), never as "0:00".
 */
export function formatWindow(w: { start: string; end: string }, timeZone: string, language: Language): string {
  const to = language === 'es' ? 'a' : 'to';
  const fromMidnight = localClock(w.start, timeZone) === '00:00';
  const endClock = localClock(w.end, timeZone);
  if (fromMidnight && (endClock === '00:00' || endClock === '23:59')) {
    // a window to midnight ends on the day before
    const lastDay = endClock === '00:00' ? new Date(Date.parse(w.end) - 60_000).toISOString() : w.end;
    const first = formatDay(w.start, timeZone, language);
    return sameLocalDay(w.start, lastDay, timeZone) ? first : `${first} ${to} ${formatDay(lastDay, timeZone, language)}`;
  }
  const start = fromMidnight ? formatDay(w.start, timeZone, language) : formatInstant(w.start, timeZone, language);
  const end = sameLocalDay(w.start, w.end, timeZone) && !fromMidnight ? formatTime(w.end, timeZone, language) : formatInstant(w.end, timeZone, language);
  return `${start} ${to} ${end}`;
}

function list(items: readonly string[], language: Language): string {
  if (items.length <= 1) return items.join('');
  const last = items[items.length - 1];
  return `${items.slice(0, -1).join(', ')} ${language === 'es' ? 'y' : 'and'} ${last}`;
}

/** The mandate in plain words, in the user's language. */
export function readBack(mandate: Mandate, ownerEmail: string | null, language: Language): string {
  const z = mandate.timeZone;
  const who = list(mandate.contacts.map((c) => `${c.name} (${c.email})`), language);
  const lines: string[] = [];
  if (language === 'es') {
    lines.push(`Voy a escribir a ${who} desde mi propia dirección, como tu asistente de IA.`);
    lines.push(`Objetivo: ${mandate.goal}`);
    if (mandate.mayAsk.length) lines.push(`Puedo pedir: ${mandate.mayAsk.join('; ')}.`);
    if (mandate.meeting) {
      const when = mandate.meeting.windows.length
        ? `en un hueco libre de tu agenda: ${mandate.meeting.windows.map((w) => formatWindow(w, z, language)).join('; ')}`
        : 'en un hueco libre de tu agenda antes de la fecha límite';
      lines.push(`Reunión: ${mandate.meeting.durationMinutes} minutos, ${when}. Antes de reservarla te pido confirmación.`);
    }
    lines.push(
      mandate.followUp.maxCount > 0
        ? `Seguimiento: si no hay respuesta, cada ${mandate.followUp.everyDays} ${mandate.followUp.everyDays === 1 ? 'día' : 'días'}, como máximo ${mandate.followUp.maxCount} ${mandate.followUp.maxCount === 1 ? 'vez' : 'veces'}.`
        : 'Seguimiento: ninguno.',
    );
    lines.push(`Hasta: ${formatInstant(mandate.endsAt, z, language)} (${z}).`);
    lines.push(
      mandate.copyOwner === 'cc' && ownerEmail
        ? `Tu copia: cada correo con copia a ${ownerEmail}.`
        : 'Tu copia: un resumen al día.',
    );
    lines.push(`Los correos van en ${mandate.language === 'es' ? 'español' : 'inglés'}.`);
    lines.push('Nunca pago ni negocio dinero, no acepto nada contractual y no escribo a nadie más. Si algo queda fuera de esto, te pregunto primero.');
    lines.push('No se envía nada hasta que lo confirmes.');
  } else {
    lines.push(`I will email ${who} from my own address, as your AI assistant.`);
    lines.push(`Goal: ${mandate.goal}`);
    if (mandate.mayAsk.length) lines.push(`I may ask for: ${mandate.mayAsk.join('; ')}.`);
    if (mandate.meeting) {
      const when = mandate.meeting.windows.length
        ? `at a free time in your calendar: ${mandate.meeting.windows.map((w) => formatWindow(w, z, language)).join('; ')}`
        : 'at a free time in your calendar before the end date';
      lines.push(`Meeting: ${mandate.meeting.durationMinutes} minutes, ${when}. I ask you before booking it.`);
    }
    lines.push(
      mandate.followUp.maxCount > 0
        ? `Follow-ups: if there is no answer, every ${mandate.followUp.everyDays} ${mandate.followUp.everyDays === 1 ? 'day' : 'days'}, at most ${mandate.followUp.maxCount} ${mandate.followUp.maxCount === 1 ? 'time' : 'times'}.`
        : 'Follow-ups: none.',
    );
    lines.push(`Until: ${formatInstant(mandate.endsAt, z, language)} (${z}).`);
    lines.push(mandate.copyOwner === 'cc' && ownerEmail ? `Your copy: every email in copy to ${ownerEmail}.` : 'Your copy: one summary a day.');
    lines.push(`The emails are in ${mandate.language === 'es' ? 'Spanish' : 'English'}.`);
    lines.push('I never pay or negotiate money, agree to anything contractual or contact anyone else. Anything outside this, I ask you first.');
    lines.push('Nothing is sent until you confirm.');
  }
  return lines.join('\n');
}

/** Questions the code adds when the draft is missing something it must not guess. */
export const QUESTIONS = {
  contactEmail: (name: string, language: Language) =>
    language === 'es' ? `¿Cuál es la dirección de correo de ${name}?` : `What is the email address of ${name}?`,
  endsAt: (language: Language) =>
    language === 'es' ? '¿Hasta cuándo debo seguir con este asunto?' : 'Until when should I keep working on this?',
  endsTooLate: (days: number, language: Language) =>
    language === 'es'
      ? `La fecha límite puede estar como mucho a ${days} días. ¿Hasta cuándo debo seguir?`
      : `The end date can be at most ${days} days away. Until when should I keep working on this?`,
  endsInPast: (language: Language) =>
    language === 'es' ? 'Esa fecha ya ha pasado. ¿Hasta cuándo debo seguir?' : 'That date has already passed. Until when should I keep working on this?',
  contact: (language: Language) =>
    language === 'es' ? '¿A quién debo escribir? Dime su nombre y su correo.' : 'Who should I email? Tell me their name and email address.',
  unclear: (language: Language) =>
    language === 'es'
      ? 'No he entendido bien el encargo. ¿Puedes decirme a quién escribo, qué pido y hasta cuándo?'
      : 'I did not quite get the task. Can you tell me whom to email, what to ask for and until when?',
} as const;

// ---------------------------------------------------------------------------------------------
// The emails
// ---------------------------------------------------------------------------------------------

/** A name safe inside a quoted display name (no quotes, angle brackets or line breaks). */
export function safeDisplayName(name: string): string {
  return name
    .replace(/[\r\n"<>\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

/** The display name of the sender: it always says it is an AI assistant. */
export function senderName(ownerName: string, language: Language): string {
  const name = safeDisplayName(ownerName);
  if (language === 'es') return name ? `Asistente de IA de ${name}` : 'Asistente de IA de Meeting Guard AI';
  return name ? `${name}'s AI assistant` : 'Meeting Guard AI assistant';
}

/** Added by code under every email to a contact, so it always says what wrote it. */
export function disclosureFooter(ownerName: string, language: Language): string {
  const name = safeDisplayName(ownerName);
  if (language === 'es') {
    return name
      ? `--\nSoy el asistente de IA de ${name}. Este correo lo ha escrito una IA en su nombre, con Meeting Guard AI, y ${name} está al tanto de esta conversación.`
      : '--\nSoy un asistente de IA. Este correo lo ha escrito una IA, con Meeting Guard AI.';
  }
  return name
    ? `--\nI am ${name}'s AI assistant. This email was written by AI on their behalf, with Meeting Guard AI, and ${name} is kept informed of this conversation.`
    : '--\nI am an AI assistant. This email was written by AI, with Meeting Guard AI.';
}
