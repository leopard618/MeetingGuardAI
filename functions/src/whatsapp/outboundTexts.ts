/**
 * M13: the texts the bot sends inside the 24-hour window around the messages it starts
 * (docs/v2/WhatsApp-Templates-2026-11-12.md section 4): the STOP reply and the answers to the
 * template buttons. Ordinary messages (not submitted to Meta), so every app language has them.
 * Product text rule: plain punctuation only; Spanish and French keep their guillemets out of these
 * (titles in straight quotes, like the templates they answer).
 */
import type { AppLanguage } from '../shared/aiContract';

export interface OutboundTexts {
  stopped: string;
  /** First line of "See my day": {date}. */
  dayHeader: string;
  dayEmpty: string;
  dayTasksHeader: string;
  /** A task line suffix: {time}. */
  taskDueAt: string;
  taskOverdue: string;
  /** "and {count} more in the app". */
  more: string;
  /** {title}; {cost} is the AI action sentence. */
  debriefAsk: string;
  meetingGone: string;
  /** {title} */
  markedDone: string;
  taskAlreadyDone: string;
  taskGone: string;
  /** {time} */
  remindAgain: string;
  outdated: string;
  skipped: string;
}

const EN: OutboundTexts = {
  stopped:
    'Done. Meeting Guard AI will no longer message you first on WhatsApp. You can still write to the assistant here. To turn the messages back on, open the app: Settings > Integrations > WhatsApp assistant.',
  dayHeader: 'Your day ({date}):',
  dayEmpty: 'No meetings today.',
  dayTasksHeader: 'Tasks:',
  taskDueAt: 'due {time}',
  taskOverdue: 'overdue',
  more: 'and {count} more in the app',
  debriefAsk:
    'Tell me what was agreed in "{title}": who does what, and by when. Write it in one message and I will turn it into tasks for you to confirm. This debrief uses 1 AI action.',
  meetingGone: 'That meeting is no longer in Meeting Guard AI.',
  markedDone: 'OK. I marked "{title}" as done.',
  taskAlreadyDone: 'That task is already done.',
  taskGone: 'That task is no longer in Meeting Guard AI.',
  remindAgain: 'OK. I will remind you again at {time}.',
  outdated: 'That message is out of date. Open the app to see the current details.',
  skipped: 'OK.',
};

const ES: OutboundTexts = {
  stopped:
    'Listo. Meeting Guard AI ya no te enviará mensajes por su cuenta. Puedes seguir escribiéndole al asistente aquí. Para activar los mensajes de nuevo, abre la app: Ajustes > Integraciones > Asistente de WhatsApp.',
  dayHeader: 'Tu día ({date}):',
  dayEmpty: 'Hoy no tienes reuniones.',
  dayTasksHeader: 'Tareas:',
  taskDueAt: 'para las {time}',
  taskOverdue: 'vencida',
  more: 'y {count} más en la app',
  debriefAsk:
    'Cuéntame qué se acordó en "{title}": quién hace qué y para cuándo. Escríbelo en un solo mensaje y lo convertiré en tareas para que las confirmes. Este resumen usa 1 acción de IA.',
  meetingGone: 'Esa reunión ya no está en Meeting Guard AI.',
  markedDone: 'Listo. Marqué "{title}" como hecha.',
  taskAlreadyDone: 'Esa tarea ya está hecha.',
  taskGone: 'Esa tarea ya no está en Meeting Guard AI.',
  remindAgain: 'De acuerdo. Te lo recuerdo otra vez a las {time}.',
  outdated: 'Ese mensaje está desactualizado. Abre la app para ver los detalles actuales.',
  skipped: 'De acuerdo.',
};

const PT: OutboundTexts = {
  stopped:
    'Pronto. O Meeting Guard AI não vai mais enviar mensagens por conta própria no WhatsApp. Você ainda pode escrever para o assistente aqui. Para ativar as mensagens de novo, abra o app: Configurações > Integrações > Assistente do WhatsApp.',
  dayHeader: 'Seu dia ({date}):',
  dayEmpty: 'Nenhuma reunião hoje.',
  dayTasksHeader: 'Tarefas:',
  taskDueAt: 'até {time}',
  taskOverdue: 'atrasada',
  more: 'e mais {count} no app',
  debriefAsk:
    'Conte o que foi combinado em "{title}": quem faz o quê e até quando. Escreva em uma só mensagem e eu transformo em tarefas para você confirmar. Este resumo usa 1 ação de IA.',
  meetingGone: 'Essa reunião não está mais no Meeting Guard AI.',
  markedDone: 'Pronto. Marquei "{title}" como concluída.',
  taskAlreadyDone: 'Essa tarefa já está concluída.',
  taskGone: 'Essa tarefa não está mais no Meeting Guard AI.',
  remindAgain: 'Certo. Vou lembrar você de novo às {time}.',
  outdated: 'Essa mensagem está desatualizada. Abra o app para ver os detalhes atuais.',
  skipped: 'Certo.',
};

const FR: OutboundTexts = {
  stopped:
    "C'est fait. Meeting Guard AI ne vous écrira plus de lui-même sur WhatsApp. Vous pouvez toujours écrire à l'assistant ici. Pour réactiver les messages, ouvrez l'application: Paramètres > Intégrations > Assistant WhatsApp.",
  dayHeader: 'Votre journée ({date}):',
  dayEmpty: "Aucune réunion aujourd'hui.",
  dayTasksHeader: 'Tâches:',
  taskDueAt: 'pour {time}',
  taskOverdue: 'en retard',
  more: "et {count} de plus dans l'application",
  debriefAsk:
    "Dites-moi ce qui a été convenu lors de \"{title}\": qui fait quoi, et pour quand. Écrivez-le en un seul message et j'en ferai des tâches à confirmer. Ce compte rendu utilise 1 action IA.",
  meetingGone: "Cette réunion n'est plus dans Meeting Guard AI.",
  markedDone: 'OK. J\'ai marqué "{title}" comme terminée.',
  taskAlreadyDone: 'Cette tâche est déjà terminée.',
  taskGone: "Cette tâche n'est plus dans Meeting Guard AI.",
  remindAgain: 'OK. Je vous le rappelle à {time}.',
  outdated: "Ce message n'est plus à jour. Ouvrez l'application pour voir les détails actuels.",
  skipped: 'OK.',
};

const DE: OutboundTexts = {
  stopped:
    'Erledigt. Meeting Guard AI schreibt Ihnen auf WhatsApp nicht mehr von sich aus. Sie können dem Assistenten hier weiterhin schreiben. Um die Nachrichten wieder einzuschalten, öffnen Sie die App: Einstellungen > Integrationen > WhatsApp-Assistent.',
  dayHeader: 'Ihr Tag ({date}):',
  dayEmpty: 'Heute keine Meetings.',
  dayTasksHeader: 'Aufgaben:',
  taskDueAt: 'fällig {time}',
  taskOverdue: 'überfällig',
  more: 'und {count} weitere in der App',
  debriefAsk:
    'Erzählen Sie mir, was in "{title}" vereinbart wurde: wer macht was, und bis wann. Schreiben Sie es in einer Nachricht, und ich mache daraus Aufgaben zum Bestätigen. Diese Nachbesprechung verbraucht 1 KI-Aktion.',
  meetingGone: 'Dieses Meeting ist nicht mehr in Meeting Guard AI.',
  markedDone: 'OK. Ich habe "{title}" als erledigt markiert.',
  taskAlreadyDone: 'Diese Aufgabe ist bereits erledigt.',
  taskGone: 'Diese Aufgabe ist nicht mehr in Meeting Guard AI.',
  remindAgain: 'OK. Ich erinnere Sie um {time} noch einmal.',
  outdated: 'Diese Nachricht ist nicht mehr aktuell. Öffnen Sie die App, um die aktuellen Details zu sehen.',
  skipped: 'OK.',
};

export const OUTBOUND_TEXTS: Readonly<Record<AppLanguage, OutboundTexts>> = { en: EN, es: ES, pt: PT, fr: FR, de: DE };

export function outboundTexts(language: AppLanguage | string): OutboundTexts {
  return Object.prototype.hasOwnProperty.call(OUTBOUND_TEXTS, language) ? OUTBOUND_TEXTS[language as AppLanguage] : EN;
}

export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}
