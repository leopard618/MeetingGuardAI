/**
 * Pure pieces of the commitment review components (owner: summaries-app; M11,
 * docs/v2/M11-DESIGN.md sections 3.3 and 3.4, decisions 10 and 15). Generic on purpose: Sven's A2
 * reuses these components for commitments from assistant emails, so nothing here knows where a
 * suggestion came from. No React, no Firebase.
 *
 * - Who a task is for (CommitmentOwnerChoice): you, the person the source names, someone else the
 *   user types, or nobody. A first-name guess ("You?") starts as you, like the server reads it.
 * - The "<owner>: " title prefix (decision 10): a task for someone else is a follow-up for the
 *   user, so its title starts with their name. When the user changes the owner without editing
 *   the title, the prefix is rebuilt exactly as the server's acceptedTitleOf and ownerPrefixed do
 *   (functions/src/summaries/commitmentsStore.ts, functions/src/commitments/verify.ts), so what
 *   the card shows is what the task gets.
 * - The schedule of a task: a time needs a date, a reminder needs a time (the task invariants of
 *   src/core/types.ts and commitmentDraftSchema).
 * - The edit the sheet hands back: only what the user changed, so an untouched schedule keeps
 *   following the screen's default reminder.
 */
import { COMMITMENT_LIMITS, type CommitmentDraft, type CommitmentOwner } from '../../core/aiContract';

// ---- Owner -----------------------------------------------------------------------------------------

/** Who the accepted task is for, as chosen in the edit sheet. */
export type CommitmentOwnerChoice =
  /** The user: no people entry, no prefix. */
  | { kind: 'you' }
  /** The person the source names (a follow-up: prefixed, that person on the task). */
  | { kind: 'named' }
  /** Someone else, typed by the user (a follow-up too). */
  | { kind: 'other'; name: string }
  /** Nobody in particular: no people entry, no prefix. */
  | { kind: 'nobody' };

export type CommitmentOwnerKind = CommitmentOwnerChoice['kind'];

/** Every whitespace run as one space, trimmed (the server collapses names the same way). */
export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** The choice a suggestion starts with: its owner as the source gives it (a guess reads as you). */
export function defaultOwnerChoice(owner: CommitmentOwner | null): CommitmentOwnerChoice {
  if (owner === null) return { kind: 'nobody' };
  return owner.isUser ? { kind: 'you' } : { kind: 'named' };
}

/** The choices the sheet offers, in order ("<name>, as in the summary" only when the source names someone else, or only guessed the user). */
export function ownerChoiceKinds(owner: CommitmentOwner | null): CommitmentOwnerKind[] {
  const kinds: CommitmentOwnerKind[] = ['you'];
  if (owner !== null && (!owner.isUser || owner.guess)) kinds.push('named');
  kinds.push('other', 'nobody');
  return kinds;
}

export function sameOwnerChoice(a: CommitmentOwnerChoice, b: CommitmentOwnerChoice): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind !== 'other' || collapseWhitespace(a.name) === collapseWhitespace((b as { name: string }).name);
}

/** The other person a choice names (the task's people entry), or null for you and nobody. */
export function ownerNameOf(choice: CommitmentOwnerChoice, owner: CommitmentOwner | null): string | null {
  if (choice.kind === 'named') return owner?.name ?? null;
  if (choice.kind === 'other') {
    const name = collapseWhitespace(choice.name);
    return name === '' ? null : sliceTitle(name, COMMITMENT_LIMITS.maxOwnerChars);
  }
  return null;
}

/** The draft's owner: null for nobody (and for you when the source names no one); isUser for you. */
export function draftOwnerOf(choice: CommitmentOwnerChoice, owner: CommitmentOwner | null): CommitmentDraft['owner'] {
  switch (choice.kind) {
    case 'you':
      return owner !== null ? { name: owner.name, isUser: true } : null;
    case 'named':
    case 'other': {
      const name = ownerNameOf(choice, owner);
      return name === null ? null : { name, isUser: false };
    }
    case 'nobody':
      return null;
  }
}

// ---- Title -----------------------------------------------------------------------------------------

const COMBINING_MARKS = new RegExp(`[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`, 'g');

/** Lower case without accents (the server's fold, for the "already starts with the name" check). */
function fold(value: string): string {
  let text = value.toLowerCase();
  try {
    text = text.normalize('NFKD').replace(COMBINING_MARKS, '');
  } catch {
    // Runtimes without String.prototype.normalize: plain lower-case matching.
  }
  return text;
}

/** A letter (any script) or a digit. */
function isWordChar(char: string): boolean {
  return /[0-9]/.test(char) || char.toLowerCase() !== char.toUpperCase();
}

/** Cuts to `max` UTF-16 units without splitting a surrogate pair (the server's sliceSafe). */
export function sliceTitle(text: string, max: number = COMMITMENT_LIMITS.maxTitleChars): string {
  if (text.length <= max) return text;
  let cut = max;
  const code = text.charCodeAt(cut - 1);
  if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
  return text.slice(0, cut);
}

/** "<owner>: <title>" within 200, unless the title already starts with the owner's name. */
export function ownerPrefixedTitle(title: string, owner: string): string {
  const name = collapseWhitespace(owner);
  if (name.length === 0) return title;
  const foldedTitle = fold(title);
  const foldedName = fold(name);
  if (foldedTitle.startsWith(foldedName)) {
    const next = foldedTitle.charAt(foldedName.length);
    if (next === '' || !isWordChar(next)) return title;
  }
  return sliceTitle(`${name}: ${title}`).trim();
}

/**
 * The suggestion's title for another owner (the user did not edit the title): the old "<owner>: "
 * prefix comes off, the new owner's goes on; you and nobody get no prefix.
 */
export function retitleForOwner(title: string, owner: CommitmentOwner | null, choice: CommitmentOwnerChoice): string {
  const before = owner !== null && !owner.isUser ? owner.name : null;
  const after = ownerNameOf(choice, owner);
  if ((before ?? '').trim() === (after ?? '').trim()) return title;
  let next = title;
  if (before !== null && next.startsWith(`${before}: `)) next = next.slice(before.length + 2).trim();
  if (next.length === 0) return title;
  return after === null ? next : ownerPrefixedTitle(next, after);
}

// ---- Schedule ----------------------------------------------------------------------------------------

/** The due date, time and reminder of the task an accepted suggestion becomes (local wall clock). */
export interface CommitmentSchedule {
  /** YYYY-MM-DD, or null. */
  dueDate: string | null;
  /** HH:MM, only with a date. */
  dueTime: string | null;
  /** Minutes before the due time, only with a time. */
  reminderMinutesBefore: number | null;
}

export const NO_SCHEDULE: CommitmentSchedule = { dueDate: null, dueTime: null, reminderMinutesBefore: null };

/** The task invariants: a time needs a date, a reminder needs a time. */
export function normalizeSchedule(schedule: CommitmentSchedule): CommitmentSchedule {
  const dueTime = schedule.dueDate === null ? null : schedule.dueTime;
  return {
    dueDate: schedule.dueDate,
    dueTime,
    reminderMinutesBefore: dueTime === null ? null : schedule.reminderMinutesBefore,
  };
}

export function sameSchedule(a: CommitmentSchedule, b: CommitmentSchedule): boolean {
  return a.dueDate === b.dueDate && a.dueTime === b.dueTime && a.reminderMinutesBefore === b.reminderMinutesBefore;
}

/** Reminder choices offered in the sheet (minutes before the due time; null = none), as the task editor. */
export const COMMITMENT_REMINDER_CHOICES: readonly (number | null)[] = [null, 0, 5, 15, 30, 60, 1440];

/** The label of a reminder choice (the task editor's own strings, so both screens read the same). */
export function reminderChoiceLabel(minutes: number | null): { key: string; count?: number } {
  if (minutes === null) return { key: 'tasks:editor.reminderNone' };
  if (minutes === 0) return { key: 'tasks:editor.reminderAtDue' };
  if (minutes === 1440) return { key: 'tasks:editor.reminderDayBefore' };
  return { key: 'tasks:editor.reminderMinutes', count: minutes };
}

const pad = (value: number): string => String(value).padStart(2, '0');

/** The native picker's start value (device wall clock): the schedule's date and time, else 9:00 tomorrow. */
export function schedulePickerValue(schedule: CommitmentSchedule, now: Date): Date {
  if (schedule.dueDate !== null) {
    const [year = 2000, month = 1, day = 1] = schedule.dueDate.split('-').map(Number);
    const [hour = 9, minute = 0] = (schedule.dueTime ?? '09:00').split(':').map(Number);
    return new Date(year, month - 1, day, hour, minute, 0, 0);
  }
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0, 0);
}

/** A picked Date (device wall clock) as YYYY-MM-DD. */
export function pickedDate(value: Date): string {
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

/** A picked Date (device wall clock) as HH:MM. */
export function pickedTime(value: Date): string {
  return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

// ---- Default reminder ------------------------------------------------------------------------------

/**
 * The reminder for suggestions whose source gives no date (M11 decision 11, Francisco Nov 12 2026):
 * tomorrow 9:00 by default, the day after tomorrow, next Monday, a picked date and time, or none.
 * The relative choices are computed in the task zone when Accept is tapped
 * (summaryCommitmentsModel.ts reminderSlot).
 */
export type ReminderDefault =
  | { kind: 'tomorrow' }
  | { kind: 'dayAfter' }
  | { kind: 'nextMonday' }
  | { kind: 'picked'; date: string; time: string }
  | { kind: 'none' };

export type ReminderDefaultKind = ReminderDefault['kind'];

export const DEFAULT_REMINDER: ReminderDefault = { kind: 'tomorrow' };

// ---- Edit --------------------------------------------------------------------------------------------

/**
 * What the user changed on one suggestion (screen memory only, never stored). An absent field
 * follows the suggestion: the title (re-prefixed for a changed owner), its owner, and the default
 * schedule of the screen (the stated date, or the default reminder for an item without one).
 */
export interface CommitmentEdit {
  /** The title as typed (trimmed). */
  title?: string;
  owner?: CommitmentOwnerChoice;
  schedule?: CommitmentSchedule;
}

export function isEmptyEdit(edit: CommitmentEdit | null | undefined): boolean {
  return edit === null || edit === undefined || (edit.title === undefined && edit.owner === undefined && edit.schedule === undefined);
}

/** The title a suggestion shows with an edit: as typed, else its own re-prefixed for the chosen owner. */
export function editedTitle(suggestion: { title: string; owner: CommitmentOwner | null }, edit: CommitmentEdit | null | undefined): string {
  if (edit?.title !== undefined) return edit.title;
  if (edit?.owner === undefined) return suggestion.title;
  return retitleForOwner(suggestion.title, suggestion.owner, edit.owner);
}

export type CommitmentEditError = 'titleRequired' | 'titleTooLong' | 'ownerOtherRequired' | 'timeNeedsDate' | 'reminderNeedsTime';

export interface CommitmentEditErrors {
  title?: CommitmentEditError;
  owner?: CommitmentEditError;
  schedule?: CommitmentEditError;
}

/** The sheet's checks before Save (the same limits and invariants decide enforces). */
export function validateCommitmentEdit(input: { title: string; owner: CommitmentOwnerChoice; schedule: CommitmentSchedule }): CommitmentEditErrors {
  const errors: CommitmentEditErrors = {};
  const title = input.title.trim();
  if (title.length === 0) errors.title = 'titleRequired';
  else if (title.length > COMMITMENT_LIMITS.maxTitleChars) errors.title = 'titleTooLong';
  if (input.owner.kind === 'other' && collapseWhitespace(input.owner.name).length === 0) errors.owner = 'ownerOtherRequired';
  if (input.schedule.dueTime !== null && input.schedule.dueDate === null) errors.schedule = 'timeNeedsDate';
  else if (input.schedule.reminderMinutesBefore !== null && input.schedule.dueTime === null) errors.schedule = 'reminderNeedsTime';
  return errors;
}

/**
 * The edit the sheet saves: a typed title only when it differs from the automatic one, the owner
 * only when it differs from the suggestion's, the schedule only when the user touched it (else
 * the previous edit's schedule). null when nothing differs any more.
 */
export function editFromSheet(input: {
  suggestion: { title: string; owner: CommitmentOwner | null };
  previous: CommitmentEdit | null;
  title: string;
  owner: CommitmentOwnerChoice;
  schedule: CommitmentSchedule;
  scheduleTouched: boolean;
}): CommitmentEdit | null {
  const owner = sameOwnerChoice(input.owner, defaultOwnerChoice(input.suggestion.owner)) ? undefined : input.owner;
  const automatic = owner === undefined ? input.suggestion.title : retitleForOwner(input.suggestion.title, input.suggestion.owner, owner);
  const typed = sliceTitle(input.title.trim());
  const title = typed === automatic ? undefined : typed;
  const schedule = input.scheduleTouched ? normalizeSchedule(input.schedule) : input.previous?.schedule;
  const edit: CommitmentEdit = {};
  if (title !== undefined) edit.title = title;
  if (owner !== undefined) edit.owner = owner.kind === 'other' ? { kind: 'other', name: ownerNameOf(owner, null) ?? '' } : owner;
  if (schedule !== undefined) edit.schedule = schedule;
  return isEmptyEdit(edit) ? null : edit;
}
