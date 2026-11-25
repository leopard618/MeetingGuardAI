/**
 * Every user- and contact-facing string of the matters module (EN + ES), and the read-back.
 *
 * The read-back is written by CODE from the mandate, never by the model: what the user reads
 * before confirming is exactly what was hashed and what the send check enforces. Plain
 * punctuation only (CONTRIBUTING: no em or en dashes, ellipsis characters or curly quotes).
 */
import type { Language } from '../shared/aiContract';
import type { Mandate, MatterDoc, SchedulingMode, Slot } from './model';

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
export function formatDay(iso: string, timeZone: string, language: Language): string {
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
export function readBack(mandate: Mandate, ownerEmail: string | null, language: Language, scheduling: SchedulingMode = 'ask', mailbox: string | null = null): string {
  const z = mandate.timeZone;
  const who = list(mandate.contacts.map((c) => `${c.name} (${c.email})`), language);
  const lines: string[] = [];
  if (language === 'es') {
    lines.push(
      mailbox
        ? `Voy a escribir a ${who} desde tu buzón ${mailbox}, como tu asistente de IA. Sus respuestas me llegan a mí y las ves aquí.`
        : `Voy a escribir a ${who} desde mi propia dirección, como tu asistente de IA.`,
    );
    lines.push(`Objetivo: ${mandate.goal}`);
    if (mandate.mayAsk.length) lines.push(`Puedo pedir: ${mandate.mayAsk.join('; ')}.`);
    if (mandate.meeting) {
      const when = mandate.meeting.windows.length
        ? `en un hueco libre de tu agenda: ${mandate.meeting.windows.map((w) => formatWindow(w, z, language)).join('; ')}`
        : 'en un hueco libre de tu agenda antes de la fecha límite';
      lines.push(
        scheduling === 'auto'
          ? `Reunión: ${mandate.meeting.durationMinutes} minutos, ${when}. Cuando elija una hora libre, la reservo en tu agenda y le envío la confirmación.`
          : `Reunión: ${mandate.meeting.durationMinutes} minutos, ${when}. Antes de reservarla te pido confirmación.`,
      );
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
    lines.push(
      mailbox
        ? `I will email ${who} from your mailbox ${mailbox}, as your AI assistant. Their replies come to me, and you see them here.`
        : `I will email ${who} from my own address, as your AI assistant.`,
    );
    lines.push(`Goal: ${mandate.goal}`);
    if (mandate.mayAsk.length) lines.push(`I may ask for: ${mandate.mayAsk.join('; ')}.`);
    if (mandate.meeting) {
      const when = mandate.meeting.windows.length
        ? `at a free time in your calendar: ${mandate.meeting.windows.map((w) => formatWindow(w, z, language)).join('; ')}`
        : 'at a free time in your calendar before the end date';
      lines.push(
        scheduling === 'auto'
          ? `Meeting: ${mandate.meeting.durationMinutes} minutes, ${when}. When they pick a free time, I book it in your calendar and send the confirmation.`
          : `Meeting: ${mandate.meeting.durationMinutes} minutes, ${when}. I ask you before booking it.`,
      );
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
  // the contact is named once: names go up to 100 characters and a question to 200
  ownDomain: (name: string, language: Language) =>
    language === 'es'
      ? `Esa dirección es del propio asistente. ¿Cuál es la dirección de correo de ${name}?`
      : `That address belongs to the assistant itself. What is the email address of ${name}?`,
  windowsOutside: (language: Language) =>
    language === 'es'
      ? 'Las horas que me diste para la reunión ya han pasado o son después de la fecha límite. ¿Qué días y horas te vienen bien?'
      : 'The meeting times you gave are already past or after the end date. Which days and times work for you?',
  contact: (language: Language) =>
    language === 'es' ? '¿A quién debo escribir? Dime su nombre y su correo.' : 'Who should I email? Tell me their name and email address.',
  // A3: a change of a running matter keeps its contacts
  sameContacts: (language: Language) =>
    language === 'es'
      ? 'Un cambio mantiene a las mismas personas. Para escribir a alguien nuevo, empieza un asunto nuevo.'
      : 'A change keeps the same people. To write to someone new, start a new matter.',
  unclear: (language: Language) =>
    language === 'es'
      ? 'No he entendido bien el encargo. ¿Puedes decirme a quién escribo, qué pido y hasta cuándo?'
      : 'I did not quite get the task. Can you tell me whom to email, what to ask for and until when?',
} as const;

// ---------------------------------------------------------------------------------------------
// The emails
// ---------------------------------------------------------------------------------------------

/** The owner's name is cut to this in the sender name and the footer. */
export const DISPLAY_NAME_CHARS = 40;

/**
 * A name safe inside a quoted display name: no quotes, angle brackets, backslashes, line breaks,
 * control characters or invisible format characters (Unicode Cf, which includes the bidi controls
 * that could reorder "AI assistant for" visually), at most DISPLAY_NAME_CHARS characters.
 */
export function safeDisplayName(name: string): string {
  return name
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/["<>\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, DISPLAY_NAME_CHARS)
    .trim();
}

/**
 * The owner's name as the contacts will see it, from the account's display name: '' (the generic
 * sender name) when it is empty after cleaning, or when it would make the email look like it comes
 * from us rather than from the owner's assistant ("Meeting Guard", our mail domain).
 */
export function ownerDisplayName(name: string, domain: string): string {
  const safe = safeDisplayName(name);
  const squash = (text: string) => text.toLowerCase().replace(/[^a-z0-9.]/g, '');
  const own = squash(domain.trim());
  const squashed = squash(safe);
  if (squashed.includes('meetingguard') || (own.length > 0 && squashed.includes(own))) return '';
  return safe;
}

/**
 * The display name of the sender: it always says it is an AI assistant, with the AI part first in
 * both languages ("AI assistant for Ana Lopez", "Asistente de IA de Ana Lopez").
 */
export function senderName(ownerName: string, language: Language): string {
  const name = safeDisplayName(ownerName);
  if (language === 'es') return name ? `Asistente de IA de ${name}` : 'Asistente de IA de Meeting Guard AI';
  return name ? `AI assistant for ${name}` : 'Meeting Guard AI assistant';
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
    ? `--\nI am the AI assistant for ${name}. This email was written by AI on their behalf, with Meeting Guard AI, and ${name} is kept informed of this conversation.`
    : '--\nI am an AI assistant. This email was written by AI, with Meeting Guard AI.';
}

// ---------------------------------------------------------------------------------------------
// A2: replies, follow-ups, tasks
// ---------------------------------------------------------------------------------------------

/** "Re: <subject>" once (an existing Re: or RE: is kept as it is). */
export function replySubject(subject: string): string {
  const trimmed = subject.trim() || 'Re:';
  return /^re\s*:/i.test(trimmed) ? trimmed : `Re: ${trimmed}`;
}

/** Our earlier email quoted under a follow-up, line by line ("> ..."), cut to a sane length. */
export function quoteBelow(text: string, maxChars = 2000): string {
  return text
    .slice(0, maxChars)
    .trimEnd()
    .split('\n')
    .map((line) => (line.length ? `> ${line}` : '>'))
    .join('\n');
}

/**
 * The follow-up: a FIXED template, never written by the model, so no reply text can steer it. The
 * earlier email is quoted under it. The closing line has no name: the code signs it (email.ts).
 */
export function followUpText(title: string, language: Language): string {
  const topic = title.trim();
  return language === 'es'
    ? `Hola de nuevo,\n\nLe escribo para hacer seguimiento de mi correo de abajo sobre "${topic}". ¿Podría echarle un vistazo cuando tenga un momento?\n\nSaludos,`
    : `Hello again,\n\nI am following up on my email below about "${topic}". Could you have a look when you have a moment?\n\nBest,`;
}

/** The description of a task accepted from a matter: where it came from (never the email text). */
export function matterTaskOrigin(input: { contactName: string; title: string; language: Language }): string {
  const name = input.contactName.trim();
  const title = input.title.trim();
  return input.language === 'es'
    ? `Del correo de ${name} en el asunto "${title}" (asistente de IA de Meeting Guard AI).`
    : `From the email of ${name} in the matter "${title}" (Meeting Guard AI assistant).`;
}

// ---------------------------------------------------------------------------------------------
// A3: scheduling and the timeline
// ---------------------------------------------------------------------------------------------

/** The first name of a contact, for the greeting ("Carlos Ruiz" -> "Carlos"). */
export function greetingName(name: string): string {
  return safeDisplayName(name).split(' ')[0] ?? '';
}

/** "Tue, Nov 17, 10:00 AM" in the zone (the zone is said once, separately). */
export function formatSlotStart(slot: Slot, timeZone: string, language: Language): string {
  return formatInstant(slot.start, timeZone, language);
}

/** "Tue, Nov 17, 10:00 AM to 10:30 AM" in the zone. */
export function formatSlot(slot: Slot, timeZone: string, language: Language): string {
  return formatWindow(slot, timeZone, language);
}

/**
 * The email with free times: a FIXED template filled by code (the times come from the calendar,
 * never from the model). Numbered, so "the second one" can be read back. No name after the closing:
 * the code signs it (email.ts).
 */
export function offerTimesText(input: {
  contactName: string;
  ownerName: string;
  slots: readonly Slot[];
  durationMinutes: number;
  timeZone: string;
  language: Language;
  /** The contact asked for a time with no free time: these are the nearest ones. */
  nearest?: boolean;
}): string {
  const name = greetingName(input.contactName);
  const owner = safeDisplayName(input.ownerName);
  const lines = input.slots.map((slot, i) => `${i + 1}. ${formatSlotStart(slot, input.timeZone, input.language)}`).join(String.fromCharCode(10));
  if (input.language === 'es') {
    const meeting = `una reunión de ${input.durationMinutes} minutos (hora de ${input.timeZone})`;
    const intro = input.nearest
      ? `Gracias. ${owner ? `${owner} no tiene` : 'No hay'} horas libres en ese momento, así que estas son las más cercanas para ${meeting}:`
      : `Gracias. Estas horas le vienen bien${owner ? ` a ${owner}` : ''} para ${meeting}:`;
    return `Hola${name ? ` ${name}` : ''},

${intro}

${lines}

¿Cuál le va mejor? Si ninguna le encaja, dígame una hora que sí.

Saludos,`;
  }
  const meeting = `a ${input.durationMinutes} minute meeting (${input.timeZone} time)`;
  const intro = input.nearest
    ? `Thank you. ${owner ? `${owner} has` : 'There is'} no free time then, so these are the nearest free times for ${meeting}:`
    : `Thank you. These times work${owner ? ` for ${owner}` : ''} for ${meeting}:`;
  return `Hello${name ? ` ${name}` : ''},

${intro}

${lines}

Which one suits you best? If none of them works, tell me a time that does.

Best,`;
}

/** The confirmation of a booked meeting: a fixed template filled by code. */
export function confirmationText(input: { contactName: string; ownerName: string; slot: Slot; timeZone: string; language: Language }): string {
  const name = greetingName(input.contactName);
  const owner = safeDisplayName(input.ownerName);
  const when = formatSlot(input.slot, input.timeZone, input.language);
  if (input.language === 'es') {
    const has = owner ? ` ${owner} ya la tiene en su agenda.` : ' Ya está en la agenda.';
    return `Hola${name ? ` ${name}` : ''},

Gracias. La reunión queda confirmada: ${when} (hora de ${input.timeZone}).${has}

Saludos,`;
  }
  const has = owner ? ` ${owner} has it in the calendar.` : ' It is in the calendar.';
  return `Hello${name ? ` ${name}` : ''},

Thank you. The meeting is confirmed: ${when} (${input.timeZone} time).${has}

Best,`;
}

/**
 * A3 feedback: the email that tells the contact the owner moved the meeting: a fixed template filled by
 * code (both times come from the calendar, never from the model). It only goes out when the owner
 * sends the meeting_moved card.
 */
export function movedText(input: { contactName: string; ownerName: string; from: Slot; to: Slot; timeZone: string; language: Language }): string {
  const name = greetingName(input.contactName);
  const owner = safeDisplayName(input.ownerName);
  const when = formatSlot(input.to, input.timeZone, input.language);
  const before = formatSlot(input.from, input.timeZone, input.language);
  if (input.language === 'es') {
    return `Hola${name ? ` ${name}` : ''},

Un cambio${owner ? ` de parte de ${owner}` : ''}: la reunión pasa a ser ${when} (hora de ${input.timeZone}), en lugar de ${before}. ¿Le viene bien la nueva hora?

Saludos,`;
  }
  return `Hello${name ? ` ${name}` : ''},

A change${owner ? ` from ${owner}` : ''}: the meeting is now ${when} (${input.timeZone} time), instead of ${before}. Does the new time work for you?

Best,`;
}

/** A3 feedback: what matterMove answers when it cannot read one new time (code, EN and ES). */
export const MOVE_TEXT = {
  noBooking: (language: Language) =>
    language === 'es' ? 'Este asunto no tiene ninguna reunión reservada que mover.' : 'This matter has no booked meeting to move.',
  noTime: (language: Language) =>
    language === 'es' ? '¿A qué día y hora la muevo? Por ejemplo: el viernes a las 16:00.' : 'Which day and time should I move it to? For example: Friday at 4 pm.',
  past: (language: Language) =>
    language === 'es' ? 'Esa hora ya ha pasado. ¿A qué día y hora la muevo?' : 'That time has already passed. Which day and time should I move it to?',
  same: (language: Language) => (language === 'es' ? 'La reunión ya está a esa hora.' : 'The meeting is already at that time.'),
} as const;

/** The booked meeting's title in the owner's calendar. */
export function meetingTitle(title: string, contactName: string): string {
  const contact = safeDisplayName(contactName);
  return (contact ? `${title.trim()} (${contact})` : title.trim()).slice(0, 200);
}

/** The booked meeting's description: where it came from (never email text). */
export function meetingOrigin(input: { title: string; contactName: string; language: Language }): string {
  const name = input.contactName.trim();
  const title = input.title.trim();
  return input.language === 'es'
    ? `Reservada por tu asistente de IA (Meeting Guard AI) en el asunto "${title}" con ${name}.`
    : `Booked by your AI assistant (Meeting Guard AI) in the matter "${title}" with ${name}.`;
}

/** A3: what matterAsk says when the answer is not a status the model gave (code, EN and ES). */
export const ASK_TEXT = {
  newMatter: (language: Language) =>
    language === 'es' ? 'Lo preparo como un asunto nuevo y te enseño el plan antes de enviar nada.' : 'I will set this up as a new matter and show you the plan before anything is sent.',
  noMatters: (language: Language) =>
    language === 'es' ? 'Ahora mismo no tienes ningún asunto abierto.' : 'You have no open matters right now.',
  whichMatter: (titles: readonly string[], language: Language) =>
    language === 'es' ? `¿De qué asunto hablas? ${list(titles.map((t) => `"${t}"`), language)}.` : `Which matter do you mean? ${list(titles.map((t) => `"${t}"`), language)}.`,
  alreadyPaused: (title: string, language: Language) =>
    language === 'es' ? `"${title}" ya no está en marcha.` : `"${title}" is not running right now.`,
  notPaused: (title: string, language: Language) =>
    language === 'es' ? `"${title}" no está en pausa.` : `"${title}" is not paused.`,
  confirm: (intent: 'pause' | 'resume' | 'cancel' | 'change' | 'move_meeting' | 'message', title: string, language: Language): string => {
    if (language === 'es') {
      if (intent === 'pause') return `¿Pongo en pausa "${title}"? Mientras esté en pausa no se envía nada.`;
      if (intent === 'resume') return `¿Reanudo "${title}"?`;
      if (intent === 'cancel') return `¿Cancelo "${title}"? El asistente deja de escribir para siempre.`;
      if (intent === 'move_meeting') return `Leo la nueva hora y te la enseño antes de mover la reunión de "${title}".`;
      if (intent === 'message') return `Escribo el correo de "${title}" y te lo enseño antes de enviar nada.`;
      return `Preparo el cambio de "${title}" y te enseño el plan nuevo antes de aplicarlo.`;
    }
    if (intent === 'pause') return `Pause "${title}"? Nothing is sent while it is paused.`;
    if (intent === 'resume') return `Resume "${title}"?`;
    if (intent === 'cancel') return `Cancel "${title}"? The assistant stops writing for good.`;
    if (intent === 'move_meeting') return `I will read the new time and show it to you before I move the meeting of "${title}".`;
    if (intent === 'message') return `I will write the email for "${title}" and show it to you before anything is sent.`;
    return `I will draft the change to "${title}" and show you the new plan before it applies.`;
  },
  /** A status line from the matter alone (when the model fails or says nothing). */
  status: (doc: MatterDoc, language: Language): string => {
    const zone = doc.mandate?.timeZone ?? doc.timeZone;
    const es = language === 'es';
    const state = es
      ? { draft: 'es un borrador', active: 'está en marcha', paused: 'está en pausa', done: 'está terminado', cancelled: 'está cancelado' }[doc.status]
      : { draft: 'is a draft', active: 'is running', paused: 'is paused', done: 'is done', cancelled: 'is cancelled' }[doc.status];
    const parts = [`"${doc.title}" ${state}.`];
    if (doc.booking) parts.push(es ? `La reunión está reservada para el ${formatInstant(doc.booking.start, zone, language)}.` : `The meeting is booked for ${formatInstant(doc.booking.start, zone, language)}.`);
    if (doc.lastInboundAt) parts.push(es ? `La última respuesta llegó el ${formatDay(doc.lastInboundAt, zone, language)}.` : `The last reply came on ${formatDay(doc.lastInboundAt, zone, language)}.`);
    parts.push(
      doc.pendingApprovals > 0
        ? es
          ? `Tienes ${doc.pendingApprovals} ${doc.pendingApprovals === 1 ? 'cosa pendiente' : 'cosas pendientes'} de decidir.`
          : `${doc.pendingApprovals} ${doc.pendingApprovals === 1 ? 'thing waits' : 'things wait'} for you.`
        : es
          ? 'No hay nada pendiente para ti.'
          : 'Nothing waits for you.',
    );
    return parts.join(' ');
  },
} as const;
