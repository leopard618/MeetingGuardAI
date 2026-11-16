/**
 * Deterministic guards around two behaviours the agreement promises and the model alone cannot
 * guarantee (owner: assistant). Both are pure and unit-tested; the handler wires them.
 *
 * 1. Voice confirmation: "an unclear reply never executes anything". The app's own matcher is
 *    strict, but anything it does not recognise is sent here, and the model may answer "yes but
 *    make it earlier" with resolve_pending(confirm). isPlainConsent is the server-side backstop:
 *    a resolution is honoured only when the user's last message is short and carries no
 *    qualifier. A blocked resolution costs nothing: the cards stay on screen and the user taps or
 *    says a plain "yes".
 *
 * 2. Meeting moves: "when a meeting moves, the assistant asks whether related task dates should
 *    move too". The prompt says so; missingMoveQuestion makes sure the question is in the reply
 *    even when the model forgot it, by appending it for every linked, dated, open task the
 *    response neither moved nor mentioned.
 */
import type { AiAction, AppLanguage, AssistantMessage } from '../shared/aiContract';
import type { TaskContext } from './tasksContext';

/** The user's most recent own message (suggestion-chip text is model-written and skipped). */
export function lastUserText(messages: readonly AssistantMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && message.role === 'user' && message.origin !== 'suggestion') return message.content;
  }
  return '';
}

/** More words than this and the message is a request, not an answer to a card. */
export const CONSENT_MAX_WORDS = 8;

/**
 * Words that turn a yes or a no into a change request. Deliberately conservative: a false block
 * only means the user confirms by tap; a false pass would execute something the user qualified.
 * One set for every language (the user may answer in a language other than the UI one), so a
 * word of one language can block a short answer in another: that is the safe direction.
 * M12: Portuguese, French and German ship together with those languages (safety critical:
 * "sim, mas às 5", "oui mais à 17h" and "ja aber um 5" must never count as plain consent). The
 * time words ("às", "à", "um", "uhr") block a yes that adds a time.
 */
const QUALIFIERS: ReadonlySet<string> = new Set([
  // English
  'but', 'except', 'instead', 'only', 'however', 'unless', 'rather', 'change', 'move', 'earlier',
  'later', 'different', 'another', 'add', 'remove', 'also', 'make', 'without', 'if',
  // Spanish
  'pero', 'excepto', 'salvo', 'solo', 'sólo', 'mejor', 'cambia', 'cambiar', 'cambialo', 'cámbialo',
  'mueve', 'mover', 'muevelo', 'muévelo', 'antes', 'después', 'despues', 'también', 'tambien',
  'agrega', 'añade', 'anade', 'quita', 'otro', 'otra', 'sin',
  // Portuguese (Brazil)
  'mas', 'porém', 'porem', 'exceto', 'só', 'so', 'somente', 'apenas', 'melhor', 'muda', 'mude',
  'mudar', 'troca', 'troque', 'move', 'mova', 'mover', 'antes', 'depois', 'também', 'tambem',
  'adiciona', 'adicione', 'acrescenta', 'acrescente', 'tira', 'tire', 'remove', 'remova', 'outro',
  'outra', 'sem', 'se', 'às', 'as', 'ao', 'aos',
  // French
  'mais', 'sauf', 'seulement', 'uniquement', 'plutôt', 'plutot', 'change', 'changer', 'changez',
  'modifie', 'modifier', 'modifiez', 'déplace', 'deplace', 'déplacer', 'deplacer', 'déplacez',
  'avant', 'après', 'apres', 'aussi', 'ajoute', 'ajouter', 'ajoutez', 'enlève', 'enleve', 'retire',
  'retirez', 'autre', 'sans', 'tôt', 'tot', 'tard', 'à', 'au', 'vers',
  // German
  'aber', 'außer', 'ausser', 'nur', 'sondern', 'stattdessen', 'lieber', 'ändere', 'ändern',
  'aendern', 'verschiebe', 'verschieben', 'früher', 'frueher', 'später', 'spaeter',
  'auch', 'füge', 'fuege', 'hinzu', 'entferne', 'ohne', 'wenn', 'falls', 'andere', 'anderen',
  'anders', 'um', 'uhr', 'am', 'gegen',
]);

/**
 * Words that only restate a yes or a no. "si" is both the common unaccented "yes" and "if": it
 * qualifies the answer only when a condition follows it ("sí si es a las 9"), never alone or next
 * to another consent word ("si", "ok si", "si claro", "si por favor"). French "si" (a yes to a
 * negative question, and also "if") is the same token and follows the same rule.
 */
const CONSENT_WORDS: ReadonlySet<string> = new Set([
  'yes', 'yeah', 'yep', 'ok', 'okay', 'sure', 'confirm', 'confirmed', 'please', 'go', 'ahead', 'do', 'it', 'thanks', 'thank', 'you',
  'no', 'nope', 'cancel',
  'sí', 'si', 'claro', 'vale', 'dale', 'adelante', 'confirmo', 'confirmar', 'confirmado', 'por', 'favor', 'hazlo', 'gracias',
  'cancela', 'cancelar',
  // M12: Portuguese, French, German
  'sim', 'pode', 'confirma', 'obrigado', 'obrigada', 'não', 'nao',
  'oui', 'daccord', "d'accord", 'merci', 'confirme', 'parfait', 'non', 'annule',
  'ja', 'bitte', 'danke', 'genau', 'bestätigen', 'gerne', 'nein', 'abbrechen',
]);

function words(text: string): string[] {
  // NFC first: a decomposed "à" (a + combining grave) would otherwise lose its accent below and
  // slip past the "à" / "às" qualifiers.
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 0);
}

/**
 * True when the text reads as plain consent or refusal: short, and nothing that qualifies it. A
 * number anywhere ("oui 17h", "ja 17:30", "sim, as 5") is never plain consent: a yes or a no never
 * needs one, and it covers a time typed without any qualifier word in every language.
 */
export function isPlainConsent(text: string): boolean {
  const tokens = words(text);
  if (tokens.length === 0 || tokens.length > CONSENT_MAX_WORDS) return false;
  if (tokens.some((token) => /\p{N}/u.test(token))) return false;
  return !tokens.some((token, index) => {
    if (QUALIFIERS.has(token)) return true;
    if (token !== 'si' && token !== 'sí') return false;
    const next = tokens[index + 1];
    return next !== undefined && !CONSENT_WORDS.has(next);
  });
}

const MOVE_QUESTION: Readonly<Record<AppLanguage, (titles: string[]) => string>> = {
  en: (titles: string[]) => `Should I move ${titles.map((t) => `"${t}"`).join(' and ')} as well?`,
  es: (titles: string[]) => `¿Muevo también ${titles.map((t) => `"${t}"`).join(' y ')}?`,
  pt: (titles: string[]) => `Devo mover ${titles.map((t) => `"${t}"`).join(' e ')} também?`,
  fr: (titles: string[]) => `Dois-je aussi déplacer ${titles.map((t) => `"${t}"`).join(' et ')} ?`,
  de: (titles: string[]) => `Soll ich ${titles.map((t) => `"${t}"`).join(' und ')} auch verschieben?`,
};

/**
 * The question the reply must carry when a meeting is being moved and it has linked, dated, open
 * tasks that the response neither moves nor mentions. Null when nothing is missing.
 */
export function missingMoveQuestion(
  actions: readonly AiAction[],
  tasksContext: TaskContext | null,
  language: AppLanguage,
  reply: string,
): string | null {
  if (tasksContext === null) return null;
  const movedMeetingIds = new Set<string>();
  const movedTaskIds = new Set<string>();
  for (const action of actions) {
    if (action.type === 'update_meeting' && action.changes.startAt !== undefined) movedMeetingIds.add(action.meetingId);
    if (action.type === 'update_task') movedTaskIds.add(action.taskId);
  }
  if (movedMeetingIds.size === 0) return null;

  const lower = reply.toLowerCase();
  const titles: string[] = [];
  for (const task of tasksContext.tasks) {
    const { doc } = task;
    if (doc.meetingId === null || !movedMeetingIds.has(doc.meetingId)) continue;
    if (doc.status !== 'open' || doc.dueDate === null) continue;
    if (movedTaskIds.has(task.taskId)) continue;
    const title = doc.title.trim();
    if (title.length === 0 || lower.includes(title.toLowerCase())) continue;
    titles.push(title);
  }
  if (titles.length === 0) return null;
  return MOVE_QUESTION[language](titles.slice(0, 3));
}
