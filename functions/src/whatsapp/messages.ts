/**
 * Every user-visible string the WhatsApp bot sends (EN + ES; docs/ARCHITECTURE.md §27).
 *
 * Language: a LINKED user gets their app language (users/{uid}/settings/preferences.language),
 * falling back to 'en'. The inbound Cloud API payload carries NO locale, so an UNLINKED sender
 * has no known language and gets the bilingual EN + ES variants below.
 *
 * Product text rule (tested by src/i18n/__tests__/noTypographicChars.test.ts, which sweeps
 * functions/src, and by test/unit/whatsappMessages.test.ts here): plain punctuation only - no
 * em/en dashes, no ellipsis character, no curly quotes. Spanish accents, inverted marks and
 * guillemets are fine (and expected: the app's ES voice uses them, so the bot matches it).
 */
import type { Language } from '../shared/aiContract';
import { MAX_INTERACTIVE_BODY_CHARS } from './send';

export interface BotMeetingSummaryInput {
  title: string;
  /** Local date "YYYY-MM-DD" in the meeting's time zone. */
  date: string;
  /** Local time "HH:MM" in the meeting's time zone, or null for all-day meetings. */
  time: string | null;
  timezone: string;
  durationMinutes: number;
  /** Street address, join URL or null. */
  place: string | null;
}

interface BotStrings {
  linkSuccess: string;
  linkPrompt: string;
  codeExpired: string;
  quotaExceeded: string;
  /** Shown above the action list; the Confirm/Cancel buttons or the 1/2 text fallback answer it. */
  confirmPrompt: string;
  /** "and {count} more" line when the confirm prompt cannot show every action summary. */
  confirmMore: string;
  buttons: { confirm: string; cancel: string };
  confirmed: string;
  /** Appended after `confirmed` when SOME confirmed actions failed (partial application). */
  partialFailure: string;
  cancelled: string;
  actionsExpired: string;
  unsupportedType: string;
  actionUnsupported: string;
  floodNotice: string;
  error: string;
  summaryLabels: { when: string; duration: string; minutes: string; where: string; allDay: string };
  listEmpty: string;
}

const EN: BotStrings = {
  linkSuccess: 'Your WhatsApp is now linked to MeetingGuard. Ask me about your meetings, for example "What do I have tomorrow?"',
  linkPrompt: 'Hi! To use the MeetingGuard assistant here, open the app, go to Settings > WhatsApp, and send me the 6 digit code it shows you.',
  codeExpired: 'That code is not valid anymore. Open the app and generate a new one.',
  quotaExceeded: 'You reached your daily assistant limit. It resets at midnight UTC.',
  confirmPrompt: 'Should I apply this? Reply 1 to confirm or 2 to cancel.',
  confirmMore: 'and {count} more',
  buttons: { confirm: 'Confirm', cancel: 'Cancel' },
  confirmed: 'Done. I applied the changes.',
  partialFailure: 'Some changes could not be applied. Please check in the app.',
  cancelled: 'Cancelled. I did not change anything.',
  actionsExpired: 'That proposal expired. Ask me again and I will prepare it once more.',
  unsupportedType: 'I can only read text messages for now. Please type your request.',
  actionUnsupported: 'I cannot make that change from WhatsApp yet. Please use the app for it.',
  floodNotice: 'You reached the daily WhatsApp message limit. Please try again tomorrow.',
  error: 'Something went wrong. Please try again.',
  summaryLabels: { when: 'When', duration: 'Duration', minutes: 'min', where: 'Where', allDay: 'all day' },
  listEmpty: 'I found no matching meetings.',
};

const ES: BotStrings = {
  linkSuccess: 'Tu WhatsApp quedó vinculado a MeetingGuard. Pregúntame por tus reuniones, por ejemplo «¿Qué tengo mañana?»',
  linkPrompt: '¡Hola! Para usar el asistente de MeetingGuard aquí, abre la app, entra en Ajustes > WhatsApp y envíame el código de 6 dígitos que te muestra.',
  codeExpired: 'Ese código ya no es válido. Abre la app y genera uno nuevo.',
  quotaExceeded: 'Alcanzaste tu límite diario del asistente. Se reinicia a medianoche UTC.',
  confirmPrompt: '¿Lo aplico? Responde 1 para confirmar o 2 para cancelar.',
  confirmMore: 'y {count} más',
  buttons: { confirm: 'Confirmar', cancel: 'Cancelar' },
  confirmed: 'Listo. Apliqué los cambios.',
  partialFailure: 'Algunos cambios no se pudieron aplicar. Revísalo en la app.',
  cancelled: 'Cancelado. No cambié nada.',
  actionsExpired: 'Esa propuesta expiró. Pídemelo otra vez y la preparo de nuevo.',
  unsupportedType: 'Por ahora solo puedo leer mensajes de texto. Escribe tu solicitud.',
  actionUnsupported: 'Todavía no puedo hacer ese cambio desde WhatsApp. Usa la app para hacerlo.',
  floodNotice: 'Alcanzaste el límite diario de mensajes de WhatsApp. Inténtalo de nuevo mañana.',
  error: 'Algo salió mal. Inténtalo de nuevo.',
  summaryLabels: { when: 'Cuándo', duration: 'Duración', minutes: 'min', where: 'Dónde', allDay: 'todo el día' },
  listEmpty: 'No encontré reuniones que coincidan.',
};

export const BOT_STRINGS: Readonly<Record<Language, BotStrings>> = { en: EN, es: ES };

export function botStrings(language: Language): BotStrings {
  return BOT_STRINGS[language] ?? BOT_STRINGS.en;
}

/** EN + ES in one message, for senders whose language is unknown (unlinked phones). */
export function bilingual(key: 'linkPrompt' | 'linkSuccess' | 'codeExpired' | 'floodNotice' | 'error'): string {
  return `${EN[key]}\n\n${ES[key]}`;
}

/**
 * One meeting as a short, forwardable text block (share_meeting replies and list replies).
 * Content comes from the user's OWN meeting documents; never logged.
 */
export function formatMeetingSummary(language: Language, meeting: BotMeetingSummaryInput): string {
  const s = botStrings(language).summaryLabels;
  const when = meeting.time === null ? `${meeting.date} (${s.allDay})` : `${meeting.date} ${meeting.time} (${meeting.timezone})`;
  const lines = [`*${meeting.title}*`, `${s.when}: ${when}`, `${s.duration}: ${meeting.durationMinutes} ${s.minutes}`];
  if (meeting.place !== null && meeting.place.length > 0) lines.push(`${s.where}: ${meeting.place}`);
  return lines.join('\n');
}

/** Longest action summary a confirm-prompt bullet shows (the tail becomes three plain dots). */
export const MAX_PROMPT_SUMMARY_CHARS = 140;

/**
 * The confirm prompt body: the proposal summaries plus the confirm/cancel instruction. The
 * BULLETS are budgeted, never the instruction: sendButtons truncates an overlong interactive
 * body tail-first, and the tail is exactly where the 1/2 instruction lives - so each summary is
 * capped and trailing bullets collapse into an "and N more" line until the whole body fits.
 */
export function formatConfirmPrompt(language: Language, summaries: readonly string[]): string {
  const s = botStrings(language);
  const budget = MAX_INTERACTIVE_BODY_CHARS - s.confirmPrompt.length - 2;
  const bullets = summaries.map((summary) =>
    summary.length > MAX_PROMPT_SUMMARY_CHARS ? `- ${summary.slice(0, MAX_PROMPT_SUMMARY_CHARS - 3)}...` : `- ${summary}`,
  );
  let shown = bullets.length;
  let block = '';
  for (;;) {
    const lines = bullets.slice(0, shown);
    const omitted = bullets.length - shown;
    if (omitted > 0) lines.push(s.confirmMore.replace('{count}', String(omitted)));
    block = lines.join('\n');
    if (block.length <= budget || shown <= 1) break;
    shown -= 1;
  }
  return `${block}\n\n${s.confirmPrompt}`;
}
