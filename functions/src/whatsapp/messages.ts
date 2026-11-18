/**
 * Every user-visible string the WhatsApp bot sends (docs/v1/ARCHITECTURE.md §27).
 *
 * Language: a LINKED user gets their app language (users/{uid}/settings/preferences.language),
 * falling back to 'en'. Every app language (EN, ES, PT as pt-BR, FR, DE) for the bot's own texts
 * (BOT_STRINGS) and the suggested-tasks texts (SUMMARY_BOT_STRINGS); the assistant's replies are
 * asked in the same language. The inbound Cloud API payload carries NO locale, so an UNLINKED
 * sender has no known language and gets the bilingual EN + ES variants below.
 *
 * Product text rule (tested by src/i18n/__tests__/noTypographicChars.test.ts, which sweeps
 * functions/src, and by test/unit/whatsappMessages.test.ts here): plain punctuation only - no
 * em/en dashes, no ellipsis character, no curly quotes. Spanish accents, inverted marks and
 * guillemets are fine (and expected: the app's ES voice uses them, so the bot matches it).
 */
import { AI_ALLOWANCES, type AppLanguage } from '../shared/aiContract';
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
  taskListEmpty: string;
}

const EN: BotStrings = {
  linkSuccess: 'Your WhatsApp is now linked to Meeting Guard AI. Ask me about your meetings, for example "What do I have tomorrow?"',
  linkPrompt: 'Hi! To use the Meeting Guard AI assistant here, open the app, go to Settings > WhatsApp, and send me the 6 digit code it shows you.',
  codeExpired: 'That code is not valid anymore. Open the app and generate a new one.',
  // M11 (docs/v2/M11-DESIGN.md section 4.2): the allowance wording of ALLOWANCES-2026-11-05.md, not a daily limit.
  quotaExceeded: `You reached your AI action limit for now. The free allowance is ${AI_ALLOWANCES.free.total} actions in your first ${AI_ALLOWANCES.free.windowDays} days, up to ${AI_ALLOWANCES.free.perDay} a day; Pro and Premium renew each month on the day you subscribed. See your usage in the app.`,
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
  taskListEmpty: 'I found no matching tasks.',
};

const ES: BotStrings = {
  linkSuccess: 'Tu WhatsApp quedó vinculado a Meeting Guard AI. Pregúntame por tus reuniones, por ejemplo «¿Qué tengo mañana?»',
  linkPrompt: '¡Hola! Para usar el asistente de Meeting Guard AI aquí, abre la app, entra en Ajustes > WhatsApp y envíame el código de 6 dígitos que te muestra.',
  codeExpired: 'Ese código ya no es válido. Abre la app y genera uno nuevo.',
  quotaExceeded: `Alcanzaste tu límite de acciones de IA por ahora. La asignación gratuita es de ${AI_ALLOWANCES.free.total} acciones en tus primeros ${AI_ALLOWANCES.free.windowDays} días, hasta ${AI_ALLOWANCES.free.perDay} al día; Pro y Premium se renuevan cada mes el día en que te suscribiste. Consulta tu uso en la app.`,
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
  taskListEmpty: 'No encontré tareas que coincidan.',
};

const PT: BotStrings = {
  linkSuccess: 'Seu WhatsApp agora está vinculado ao Meeting Guard AI. Pergunte sobre suas reuniões, por exemplo "O que tenho amanhã?"',
  linkPrompt: 'Olá! Para usar o assistente do Meeting Guard AI aqui, abra o app, vá em Configurações > WhatsApp e me envie o código de 6 dígitos que aparece.',
  codeExpired: 'Esse código não é mais válido. Abra o app e gere um novo.',
  quotaExceeded: `Você atingiu seu limite de ações de IA por enquanto. O plano gratuito inclui ${AI_ALLOWANCES.free.total} ações nos seus primeiros ${AI_ALLOWANCES.free.windowDays} dias, até ${AI_ALLOWANCES.free.perDay} por dia; Pro e Premium renovam todo mês no dia em que você assinou. Veja seu uso no app.`,
  confirmPrompt: 'Devo aplicar isto? Responda 1 para confirmar ou 2 para cancelar.',
  confirmMore: 'e mais {count}',
  buttons: { confirm: 'Confirmar', cancel: 'Cancelar' },
  confirmed: 'Pronto. Apliquei as alterações.',
  partialFailure: 'Algumas alterações não puderam ser aplicadas. Confira no app.',
  cancelled: 'Cancelado. Não alterei nada.',
  actionsExpired: 'Essa proposta expirou. Peça de novo e eu preparo outra vez.',
  unsupportedType: 'Por enquanto só consigo ler mensagens de texto. Digite seu pedido.',
  actionUnsupported: 'Ainda não consigo fazer essa alteração pelo WhatsApp. Use o app para isso.',
  floodNotice: 'Você atingiu o limite diário de mensagens do WhatsApp. Tente de novo amanhã.',
  error: 'Algo deu errado. Tente de novo.',
  summaryLabels: { when: 'Quando', duration: 'Duração', minutes: 'min', where: 'Onde', allDay: 'dia inteiro' },
  listEmpty: 'Não encontrei reuniões correspondentes.',
  taskListEmpty: 'Não encontrei tarefas correspondentes.',
};

const FR: BotStrings = {
  linkSuccess: 'Votre WhatsApp est maintenant lié à Meeting Guard AI. Posez-moi vos questions sur vos réunions, par exemple "Qu\'est-ce que j\'ai demain?"',
  linkPrompt: "Bonjour! Pour utiliser l'assistant Meeting Guard AI ici, ouvrez l'application, allez dans Paramètres > WhatsApp et envoyez-moi le code à 6 chiffres affiché.",
  codeExpired: "Ce code n'est plus valide. Ouvrez l'application et générez-en un nouveau.",
  quotaExceeded: `Vous avez atteint votre limite d'actions IA pour le moment. L'offre gratuite comprend ${AI_ALLOWANCES.free.total} actions pendant vos ${AI_ALLOWANCES.free.windowDays} premiers jours, jusqu'à ${AI_ALLOWANCES.free.perDay} par jour; Pro et Premium se renouvellent chaque mois le jour de votre abonnement. Consultez votre utilisation dans l'application.`,
  confirmPrompt: "Je l'applique? Répondez 1 pour confirmer ou 2 pour annuler.",
  confirmMore: 'et {count} de plus',
  buttons: { confirm: 'Confirmer', cancel: 'Annuler' },
  confirmed: "C'est fait. J'ai appliqué les modifications.",
  partialFailure: "Certaines modifications n'ont pas pu être appliquées. Vérifiez dans l'application.",
  cancelled: "Annulé. Je n'ai rien modifié.",
  actionsExpired: 'Cette proposition a expiré. Redemandez-moi et je la préparerai à nouveau.',
  unsupportedType: 'Pour le moment, je ne peux lire que des messages texte. Écrivez votre demande.',
  actionUnsupported: "Je ne peux pas encore faire cette modification depuis WhatsApp. Utilisez l'application pour cela.",
  floodNotice: 'Vous avez atteint la limite quotidienne de messages WhatsApp. Réessayez demain.',
  error: "Une erreur s'est produite. Réessayez.",
  summaryLabels: { when: 'Quand', duration: 'Durée', minutes: 'min', where: 'Où', allDay: 'toute la journée' },
  listEmpty: "Je n'ai trouvé aucune réunion correspondante.",
  taskListEmpty: "Je n'ai trouvé aucune tâche correspondante.",
};

const DE: BotStrings = {
  linkSuccess: 'Ihr WhatsApp ist jetzt mit Meeting Guard AI verbunden. Fragen Sie mich nach Ihren Besprechungen, zum Beispiel "Was habe ich morgen?"',
  linkPrompt: 'Hallo! Um den Assistenten von Meeting Guard AI hier zu nutzen, öffnen Sie die App, gehen Sie zu Einstellungen > WhatsApp und senden Sie mir den 6-stelligen Code, der dort angezeigt wird.',
  codeExpired: 'Dieser Code ist nicht mehr gültig. Öffnen Sie die App und erstellen Sie einen neuen.',
  quotaExceeded: `Sie haben Ihr Limit für KI-Aktionen vorerst erreicht. Kostenlos sind ${AI_ALLOWANCES.free.total} Aktionen in Ihren ersten ${AI_ALLOWANCES.free.windowDays} Tagen, bis zu ${AI_ALLOWANCES.free.perDay} pro Tag; Pro und Premium erneuern sich jeden Monat an dem Tag, an dem Sie abonniert haben. Ihre Nutzung sehen Sie in der App.`,
  confirmPrompt: 'Soll ich das übernehmen? Antworten Sie 1 zum Bestätigen oder 2 zum Abbrechen.',
  confirmMore: 'und {count} weitere',
  buttons: { confirm: 'Bestätigen', cancel: 'Abbrechen' },
  confirmed: 'Erledigt. Ich habe die Änderungen übernommen.',
  partialFailure: 'Einige Änderungen konnten nicht übernommen werden. Bitte prüfen Sie das in der App.',
  cancelled: 'Abgebrochen. Ich habe nichts geändert.',
  actionsExpired: 'Dieser Vorschlag ist abgelaufen. Fragen Sie mich noch einmal, dann bereite ich ihn erneut vor.',
  unsupportedType: 'Ich kann vorerst nur Textnachrichten lesen. Bitte schreiben Sie Ihre Anfrage.',
  actionUnsupported: 'Diese Änderung kann ich über WhatsApp noch nicht vornehmen. Bitte nutzen Sie dafür die App.',
  floodNotice: 'Sie haben das tägliche WhatsApp-Nachrichtenlimit erreicht. Bitte versuchen Sie es morgen erneut.',
  error: 'Etwas ist schiefgelaufen. Bitte versuchen Sie es erneut.',
  summaryLabels: { when: 'Wann', duration: 'Dauer', minutes: 'Min.', where: 'Wo', allDay: 'ganztägig' },
  listEmpty: 'Ich habe keine passenden Besprechungen gefunden.',
  taskListEmpty: 'Ich habe keine passenden Aufgaben gefunden.',
};

export const BOT_STRINGS: Readonly<Record<AppLanguage, BotStrings>> = { en: EN, es: ES, pt: PT, fr: FR, de: DE };

/** The bot's texts in the app language; anything unknown reads English. */
export function botStrings(language: AppLanguage | string): BotStrings {
  return Object.prototype.hasOwnProperty.call(BOT_STRINGS, language) ? BOT_STRINGS[language as AppLanguage] : BOT_STRINGS.en;
}

/** EN + ES in one message, for senders whose language is unknown (unlinked phones). */
export function bilingual(key: 'linkPrompt' | 'linkSuccess' | 'codeExpired' | 'floodNotice' | 'error'): string {
  return `${EN[key]}\n\n${ES[key]}`;
}

/**
 * One meeting as a short, forwardable text block (share_meeting replies and list replies).
 * Content comes from the user's OWN meeting documents; never logged.
 */
export function formatMeetingSummary(language: AppLanguage, meeting: BotMeetingSummaryInput): string {
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
export function formatConfirmPrompt(language: AppLanguage, summaries: readonly string[]): string {
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

// ---------------------------------------------------------------------------------------------
// M11: suggested tasks from summaries (docs/v2/M11-DESIGN.md sections 4.1 to 4.3). The webhook's
// own texts; the list and its results come from the summaryWhatsApp worker
// (functions/src/summaries/whatsappRender.ts). Kept apart from BOT_STRINGS so its snapshots stay.
// ---------------------------------------------------------------------------------------------

export interface SummaryBotStrings {
  /** The worker could not be reached. */
  unavailable: string;
  /** The port gave up on an offer or the reply AI: the worker keeps running and stores its result. */
  stillPreparing: string;
  /** The port gave up on a reply (numbers, ALL, DROP, NONE). */
  replyTimeout: string;
  /** NO, CANCEL or CANCELAR closed the offer. */
  closed: string;
  /** ALL while nothing is marked. */
  nothingMarked: string;
  /** A button of an offer that is no longer the live one. */
  expired: string;
}

const SUMMARY_EN: SummaryBotStrings = {
  unavailable: 'Suggested tasks are not available right now. Open the app to review them.',
  stillPreparing: 'Still preparing your suggested tasks. Write commitments again in a minute.',
  replyTimeout: 'This is taking longer than usual. Write commitments again in a minute to see what was added.',
  closed: 'Closed. Nothing was changed.',
  nothingMarked: 'Nothing is marked. Reply with the numbers you want.',
  expired: 'That list expired. Write commitments for a new one.',
};

const SUMMARY_ES: SummaryBotStrings = {
  unavailable: 'Las tareas sugeridas no están disponibles ahora. Revísalas en la app.',
  stillPreparing: 'Sigo preparando tus tareas sugeridas. Escribe compromisos otra vez en un minuto.',
  replyTimeout: 'Esto está tardando más de lo normal. Escribe compromisos otra vez en un minuto para ver qué se agregó.',
  closed: 'Cerrado. No cambié nada.',
  nothingMarked: 'No hay nada marcado. Responde con los números que quieras.',
  expired: 'Esa lista expiró. Escribe compromisos para ver una nueva.',
};

// M12: each language names its own trigger word (whatsapp/summaryRoute.ts SUMMARY_TRIGGER_PHRASES).
const SUMMARY_PT: SummaryBotStrings = {
  unavailable: 'As tarefas sugeridas não estão disponíveis agora. Abra o app para revisá-las.',
  stillPreparing: 'Ainda estou preparando suas tarefas sugeridas. Escreva compromissos de novo em um minuto.',
  replyTimeout: 'Isso está demorando mais que o normal. Escreva compromissos de novo em um minuto para ver o que foi adicionado.',
  closed: 'Fechado. Nada foi alterado.',
  nothingMarked: 'Nada está marcado. Responda com os números que você quer.',
  expired: 'Essa lista expirou. Escreva compromissos para ver uma nova.',
};

const SUMMARY_FR: SummaryBotStrings = {
  unavailable: "Les tâches suggérées ne sont pas disponibles pour le moment. Ouvrez l'application pour les consulter.",
  stillPreparing: 'Vos tâches suggérées sont encore en préparation. Écrivez engagements à nouveau dans une minute.',
  replyTimeout: "Cela prend plus de temps que d'habitude. Écrivez engagements à nouveau dans une minute pour voir ce qui a été ajouté.",
  closed: "Fermé. Rien n'a été modifié.",
  nothingMarked: "Rien n'est coché. Répondez avec les numéros souhaités.",
  expired: 'Cette liste a expiré. Écrivez engagements pour en obtenir une nouvelle.',
};

const SUMMARY_DE: SummaryBotStrings = {
  unavailable: 'Vorgeschlagene Aufgaben sind gerade nicht verfügbar. Öffnen Sie die App, um sie zu prüfen.',
  stillPreparing: 'Ihre vorgeschlagenen Aufgaben werden noch vorbereitet. Schreiben Sie in einer Minute noch einmal Zusagen.',
  replyTimeout: 'Das dauert länger als üblich. Schreiben Sie in einer Minute noch einmal Zusagen, um zu sehen, was hinzugefügt wurde.',
  closed: 'Geschlossen. Es wurde nichts geändert.',
  nothingMarked: 'Nichts ist markiert. Antworten Sie mit den gewünschten Nummern.',
  expired: 'Diese Liste ist abgelaufen. Schreiben Sie Zusagen für eine neue Liste.',
};

export const SUMMARY_BOT_STRINGS: Readonly<Record<AppLanguage, SummaryBotStrings>> = {
  en: SUMMARY_EN,
  es: SUMMARY_ES,
  pt: SUMMARY_PT,
  fr: SUMMARY_FR,
  de: SUMMARY_DE,
};

/** The suggested-tasks texts in the app language; anything unknown reads English. */
export function summaryBotStrings(language: AppLanguage | string): SummaryBotStrings {
  return Object.prototype.hasOwnProperty.call(SUMMARY_BOT_STRINGS, language) ? SUMMARY_BOT_STRINGS[language as AppLanguage] : SUMMARY_BOT_STRINGS.en;
}
