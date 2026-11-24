/**
 * M13: the message templates the bot starts conversations with
 * (docs/v2/WhatsApp-Templates-2026-11-12.md, sections 3 and 7). Pure: the registry, the value
 * cleaner, the time and date phrases, and the rendering used in preview mode (the same text sent
 * as an ordinary message before Meta approves the templates).
 *
 * The texts below must stay equal to what is submitted to Meta (section 3): a test pins them.
 * Product text rule: plain punctuation only (no em or en dashes, no ellipsis character, no curly
 * quotes); the templates use straight quotes around titles, never guillemets (section 5).
 */
import { addDaysToLocalDate, getZonedParts, isValidTimeZone, todayInZone } from '../shared/time';
import type { AppLanguage } from '../shared/aiContract';

export type TemplateLanguage = 'en' | 'es';
export type OutboundKind = 'agenda' | 'debrief' | 'confirmation' | 'commitments' | 'task' | 'followup' | 'welcome';

/** The tap payload prefixes (`<prefix>:<sendId>`), one per quick-reply button. */
export const TAP_PREFIXES = {
  agenda: 'wa_agenda',
  debrief: 'wa_debrief',
  skip: 'wa_skip',
  meeting: 'wa_meeting',
  commit: 'wa_commit',
  done: 'wa_done',
  later: 'wa_later',
} as const;
export type TapAction = keyof typeof TAP_PREFIXES;

interface TemplateTexts {
  header: string;
  /** Body with {{1}}, {{2}}, ... */
  body: string;
  footer: string | null;
  buttons: string[];
}

export interface TemplateDefinition {
  name: string;
  kind: OutboundKind;
  params: number;
  /** message_send_ttl_seconds submitted with the template. */
  ttlSeconds: number;
  /** One tap action per quick-reply button, in button order. */
  taps: TapAction[];
  texts: Record<TemplateLanguage, TemplateTexts>;
}

const FOOTER = { en: 'Reply STOP to turn off these messages.', es: 'Responde STOP para desactivar estos mensajes.' };
const HOUR = 3600;

export const TEMPLATES: Readonly<Record<OutboundKind, TemplateDefinition>> = {
  agenda: {
    name: 'mg_daily_agenda_v1',
    kind: 'agenda',
    params: 2,
    ttlSeconds: 6 * HOUR,
    taps: ['agenda'],
    texts: {
      en: {
        header: 'Your day',
        body: 'Here is your agenda for today from Meeting Guard AI: {{1}}. Tasks: {{2}}.\n\nTap "See my day" for the full list with times and places.',
        footer: FOOTER.en,
        buttons: ['See my day'],
      },
      es: {
        header: 'Tu día',
        body: 'Esta es tu agenda de hoy en Meeting Guard AI: {{1}}. Tareas: {{2}}.\n\nToca "Ver mi día" para ver la lista completa con horarios y lugares.',
        footer: FOOTER.es,
        buttons: ['Ver mi día'],
      },
    },
  },
  debrief: {
    name: 'mg_debrief_prompt_v1',
    kind: 'debrief',
    params: 1,
    ttlSeconds: 3 * HOUR,
    taps: ['debrief', 'skip'],
    texts: {
      en: {
        header: 'How did it go?',
        body: 'Your meeting "{{1}}" has ended. Do you want to note what was agreed?\n\nTap "Debrief" and tell me who does what, and by when. I will turn it into tasks for you to confirm.',
        footer: FOOTER.en,
        buttons: ['Debrief', 'Not this time'],
      },
      es: {
        header: '¿Cómo te fue?',
        body: 'Tu reunión "{{1}}" ya terminó. ¿Quieres anotar lo que se acordó?\n\nToca "Resumen" y cuéntame quién hace qué y para cuándo. Lo convertiré en tareas para que las confirmes.',
        footer: FOOTER.es,
        buttons: ['Resumen', 'Esta vez no'],
      },
    },
  },
  confirmation: {
    name: 'mg_meeting_confirmation_v1',
    kind: 'confirmation',
    params: 2,
    ttlSeconds: 12 * HOUR,
    taps: ['meeting'],
    texts: {
      en: {
        header: 'Meeting saved',
        body: 'Meeting Guard AI saved your meeting "{{1}}" for {{2}}.\n\nTap "Details" to see it here, or open the app to change it.',
        footer: FOOTER.en,
        buttons: ['Details'],
      },
      es: {
        header: 'Reunión guardada',
        body: 'Meeting Guard AI guardó tu reunión "{{1}}" para el {{2}}.\n\nToca "Detalles" para verla aquí, o abre la app para cambiarla.',
        footer: FOOTER.es,
        buttons: ['Detalles'],
      },
    },
  },
  commitments: {
    name: 'mg_commitments_ready_v1',
    kind: 'commitments',
    params: 2,
    ttlSeconds: 12 * HOUR,
    taps: ['commit'],
    texts: {
      en: {
        header: 'Commitments to review',
        body: 'Your notetaker\'s summary of "{{1}}" on {{2}} is filed in Meeting Guard AI. It lists commitments you can turn into tasks.\n\nTap "Commitments" or write commitments to review them. Nothing is added until you reply.',
        footer: FOOTER.en,
        buttons: ['Commitments'],
      },
      es: {
        header: 'Compromisos por revisar',
        body: 'La minuta de tu asistente de notas sobre "{{1}}" del {{2}} ya está archivada en Meeting Guard AI. Tiene compromisos que puedes convertir en tareas.\n\nToca "Compromisos" o escribe compromisos para revisarlos. No se agrega nada hasta que respondas.',
        footer: FOOTER.es,
        buttons: ['Compromisos'],
      },
    },
  },
  task: {
    name: 'mg_task_reminder_v1',
    kind: 'task',
    params: 2,
    ttlSeconds: 1 * HOUR,
    taps: ['done', 'later'],
    texts: {
      en: {
        header: 'Task reminder',
        body: 'Reminder from Meeting Guard AI: your task "{{1}}", due {{2}}.\n\nTap "Mark as done" when it is finished, or "Remind me in 1 hour".',
        footer: FOOTER.en,
        buttons: ['Mark as done', 'Remind me in 1 hour'],
      },
      es: {
        header: 'Recordatorio de tarea',
        body: 'Recordatorio de Meeting Guard AI: tu tarea "{{1}}", para {{2}}.\n\nToca "Marcar como hecha" cuando la termines, o "Recuérdamelo en 1 hora".',
        footer: FOOTER.es,
        buttons: ['Marcar como hecha', 'Recuérdamelo en 1 hora'],
      },
    },
  },
  followup: {
    name: 'mg_followup_reminder_v1',
    kind: 'followup',
    params: 3,
    ttlSeconds: 1 * HOUR,
    taps: ['done', 'later'],
    texts: {
      en: {
        header: 'Follow-up reminder',
        body: 'Reminder from Meeting Guard AI: check with {{1}} on "{{2}}", due {{3}}.\n\nTap "Mark as done" when it is settled, or "Remind me in 1 hour".',
        footer: FOOTER.en,
        buttons: ['Mark as done', 'Remind me in 1 hour'],
      },
      es: {
        header: 'Recordatorio de seguimiento',
        body: 'Recordatorio de Meeting Guard AI: pregúntale a {{1}} por "{{2}}", previsto para {{3}}.\n\nToca "Marcar como hecha" cuando la tarea quede resuelta, o "Recuérdamelo en 1 hora".',
        footer: FOOTER.es,
        buttons: ['Marcar como hecha', 'Recuérdamelo en 1 hora'],
      },
    },
  },
  welcome: {
    name: 'mg_optin_welcome_v1',
    kind: 'welcome',
    params: 1,
    ttlSeconds: 12 * HOUR,
    taps: [],
    texts: {
      en: {
        header: 'WhatsApp messages are on',
        body: 'You turned on WhatsApp messages from Meeting Guard AI for {{1}}.\n\nYou can change them at any time in the app, in Settings > Integrations > WhatsApp assistant. Reply STOP here to turn them all off.',
        footer: null,
        buttons: [],
      },
      es: {
        header: 'Mensajes de WhatsApp activados',
        body: 'Activaste los mensajes de WhatsApp de Meeting Guard AI para {{1}}.\n\nPuedes cambiarlos cuando quieras en la app, en Ajustes > Integraciones > Asistente de WhatsApp. Responde STOP aquí para desactivarlos todos.',
        footer: null,
        buttons: [],
      },
    },
  },
};

/** 'es' users get the Spanish templates; every other language the English ones (section 8, q. 10). */
export function templateLanguageOf(language: AppLanguage | string): TemplateLanguage {
  return language === 'es' ? 'es' : 'en';
}

// ---------------------------------------------------------------------------------------------
// The value cleaner (section 3): one line, collapsed spaces, cut at a word, never empty
// ---------------------------------------------------------------------------------------------

export function cleanValue(value: string | null | undefined, max: number, fallback: string): string {
  const flat = (value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (flat.length === 0) return fallback;
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(' ');
  const word = space >= Math.floor(max / 2) ? cut.slice(0, space) : cut;
  return word.replace(/[\s,;:.-]+$/, '') || fallback;
}

export const FALLBACK_MEETING = { en: 'Meeting', es: 'Reunión' } as const;

// ---------------------------------------------------------------------------------------------
// Time and date phrases ("H:MM" 24-hour with no leading zero on the hour)
// ---------------------------------------------------------------------------------------------

export function hourMinute(instant: Date, timeZone: string): { hour: number; text: string } {
  const parts = getZonedParts(instant, timeZone);
  return { hour: parts.hour, text: `${parts.hour}:${String(parts.minute).padStart(2, '0')}` };
}

/** "at 9:30" / "a las 9:30" ("a la 1:30" for the hour 1). */
export function atTime(language: TemplateLanguage, instant: Date, timeZone: string): string {
  const { hour, text } = hourMinute(instant, timeZone);
  if (language === 'es') return `${hour === 1 ? 'a la' : 'a las'} ${text}`;
  return `at ${text}`;
}

const WEEKDAYS = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  es: ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'],
};
const MONTHS = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
};

function localDateParts(date: string): { year: number; month: number; day: number; weekday: number } {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { year, month, day, weekday };
}

/** "Oct 16" / "16 oct". */
export function shortDate(language: TemplateLanguage, date: string): string {
  const p = localDateParts(date);
  return language === 'es' ? `${p.day} ${MONTHS.es[p.month - 1]}` : `${MONTHS.en[p.month - 1]} ${p.day}`;
}

/** "Fri, Nov 13" / "vie 13 nov". */
export function weekdayDate(language: TemplateLanguage, date: string): string {
  const p = localDateParts(date);
  return language === 'es'
    ? `${WEEKDAYS.es[p.weekday]} ${p.day} ${MONTHS.es[p.month - 1]}`
    : `${WEEKDAYS.en[p.weekday]}, ${MONTHS.en[p.month - 1]} ${p.day}`;
}

/**
 * The due moment of a reminder: "today at 16:00", "tomorrow at 9:00", "on Fri, Oct 16 at 9:00";
 * es "hoy a las 16:00", "mañana a las 9:00", "el vie 16 oct a las 9:00".
 */
export function dueMoment(language: TemplateLanguage, due: Date, timeZone: string, now: Date): string {
  const zone = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  const dueDate = todayInZone(zone, due);
  const today = todayInZone(zone, now);
  const time = atTime(language, due, zone);
  if (dueDate === today) return language === 'es' ? `hoy ${time}` : `today ${time}`;
  if (dueDate === addDaysToLocalDate(today, 1)) return language === 'es' ? `mañana ${time}` : `tomorrow ${time}`;
  return language === 'es' ? `el ${weekdayDate('es', dueDate)} ${time}` : `on ${weekdayDate('en', dueDate)} ${time}`;
}

// ---------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------

export interface RenderedTemplate {
  name: string;
  language: TemplateLanguage;
  params: string[];
  /** `<prefix>:<sendId>` per quick-reply button, in order. */
  payloads: string[];
}

export function renderTemplate(kind: OutboundKind, language: TemplateLanguage, params: readonly string[], sendId: string): RenderedTemplate {
  const definition = TEMPLATES[kind];
  if (params.length !== definition.params) throw new Error(`template ${definition.name} takes ${definition.params} values`);
  return {
    name: definition.name,
    language,
    params: [...params],
    payloads: definition.taps.map((tap) => `${TAP_PREFIXES[tap]}:${sendId}`),
  };
}

/** The same message as plain text (preview mode, and the tests): header, body, footer. */
export function previewText(kind: OutboundKind, language: TemplateLanguage, params: readonly string[]): string {
  const texts = TEMPLATES[kind].texts[language];
  const body = texts.body.replace(/\{\{(\d+)\}\}/g, (_match, index: string) => params[Number(index) - 1] ?? '');
  return [`*${texts.header}*`, body, ...(texts.footer ? [`_${texts.footer}_`] : [])].join('\n\n');
}

/** Button titles for preview mode (in-window reply buttons allow 20 characters, not 25). */
export function previewButtons(kind: OutboundKind, language: TemplateLanguage, payloads: readonly string[]): { id: string; title: string }[] {
  const titles = TEMPLATES[kind].texts[language].buttons;
  return payloads.map((id, index) => ({ id, title: (titles[index] ?? '').slice(0, 20) }));
}

/** Parses `<prefix>:<sendId>`; null for anything else. */
export function parseTap(payload: string): { action: TapAction; sendId: string } | null {
  const colon = payload.indexOf(':');
  if (colon <= 0) return null;
  const prefix = payload.slice(0, colon);
  const sendId = payload.slice(colon + 1);
  if (!/^[0-9a-f]{32}$/.test(sendId)) return null;
  const entry = (Object.entries(TAP_PREFIXES) as [TapAction, string][]).find(([, value]) => value === prefix);
  return entry ? { action: entry[0], sendId } : null;
}
