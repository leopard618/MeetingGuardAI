/**
 * PURE model of the Tasks screen (V2 Stage 1): filtering / search, due-state helpers and the
 * editor draft (validation, create input, minimal patch). No React, no services.
 */
import { toLocalDateTime, zonedDateTimeToUtcIso } from '../../core/time';
import type { Task, TaskInput, TaskPatch } from '../../core/types';
import { normalizeForSearch } from '../notes/notesModel';

/** Limits of core/types taskInputSchema / taskSchema. */
export const TASK_TITLE_MAX = 200;
export const TASK_DESCRIPTION_MAX = 4000;

export const TASK_FILTERS = ['open', 'today', 'overdue', 'done', 'all'] as const;
export type TaskFilter = (typeof TASK_FILTERS)[number];

/** Reminder choices offered in the editor (minutes before the due time; null = none). */
export const REMINDER_CHOICES: readonly (number | null)[] = [null, 0, 5, 15, 30, 60, 1440];

/** The task's due instant (UTC ms), or null without a due date / with broken zone data. */
/**
 * The due instant as a UTC ISO string, for display in the device zone: a task due 17:00 in Madrid
 * shows 11:00 in New York, the same instant its reminder and the overdue rule use.
 */
export function taskDueInstant(task: Pick<Task, 'dueDate' | 'dueTime' | 'timezone'>): string {
  return zonedDateTimeToUtcIso(task.dueDate ?? '1970-01-01', task.dueTime ?? '23:59', task.timezone);
}

export function dueInstantMs(task: Pick<Task, 'dueDate' | 'dueTime' | 'timezone'>): number | null {
  if (task.dueDate === null) return null;
  try {
    const value = Date.parse(zonedDateTimeToUtcIso(task.dueDate, task.dueTime ?? '23:59', task.timezone));
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/** Open and past due: a timed task after its instant, an all-day one after its day (device zone). */
export function isOverdue(task: Task, now: Date, deviceZone: string): boolean {
  if (task.status !== 'open' || task.dueDate === null) return false;
  if (task.dueTime === null) {
    try {
      return task.dueDate < toLocalDateTime(now, deviceZone).date;
    } catch {
      return false;
    }
  }
  const due = dueInstantMs(task);
  return due !== null && due < now.getTime();
}

/** Due on the device's current local day (open tasks; overdue ones count as today too). */
export function isDueToday(task: Task, now: Date, deviceZone: string): boolean {
  if (task.status !== 'open' || task.dueDate === null) return false;
  try {
    return task.dueDate <= toLocalDateTime(now, deviceZone).date;
  } catch {
    return false;
  }
}

export interface TaskFilterOptions {
  query: string;
  filter: TaskFilter;
  now: Date;
  deviceZone: string;
  /** Title of the linked meeting (so a search for the meeting finds its tasks). */
  meetingTitle?: (meetingId: string) => string | null;
}

export function filterTasks(tasks: readonly Task[], options: TaskFilterOptions): Task[] {
  const words = normalizeForSearch(options.query).split(/\s+/).filter((word) => word.length > 0);
  return tasks.filter((task) => {
    switch (options.filter) {
      case 'open':
        if (task.status !== 'open') return false;
        break;
      case 'today':
        if (!isDueToday(task, options.now, options.deviceZone)) return false;
        break;
      case 'overdue':
        if (!isOverdue(task, options.now, options.deviceZone)) return false;
        break;
      case 'done':
        if (task.status !== 'done') return false;
        break;
      case 'all':
        break;
    }
    if (words.length === 0) return true;
    const people = task.people.map((person) => `${person.name} ${person.email ?? ''}`).join('\n');
    const linked = task.meetingId && options.meetingTitle ? (options.meetingTitle(task.meetingId) ?? '') : '';
    const haystack = normalizeForSearch(`${task.title}\n${task.description}\n${people}\n${linked}`);
    return words.every((word) => haystack.includes(word));
  });
}

/** Number of tasks per filter chip. */
export function countByFilter(tasks: readonly Task[], now: Date, deviceZone: string): Record<TaskFilter, number> {
  const counts = Object.fromEntries(TASK_FILTERS.map((filter) => [filter, 0])) as Record<TaskFilter, number>;
  for (const task of tasks) {
    counts.all += 1;
    if (task.status === 'done') counts.done += 1;
    else counts.open += 1;
    if (isDueToday(task, now, deviceZone)) counts.today += 1;
    if (isOverdue(task, now, deviceZone)) counts.overdue += 1;
  }
  return counts;
}

// ---- Editor draft -----------------------------------------------------------------------------

export interface TaskDraft {
  title: string;
  description: string;
  dueDate: string | null;
  dueTime: string | null;
  reminderMinutesBefore: number | null;
  meetingId: string | null;
  /** Microsoft To Do list the task goes to (null = the default list while the sync is on). */
  todoListId: string | null;
  /** Google Tasks list the task goes to (same convention). */
  gtasksListId: string | null;
}

export function newTaskDraft(options: { meetingId?: string | null } = {}): TaskDraft {
  return {
    title: '',
    description: '',
    dueDate: null,
    dueTime: null,
    reminderMinutesBefore: null,
    meetingId: options.meetingId ?? null,
    todoListId: null,
    gtasksListId: null,
  };
}

export function draftFromTask(task: Task): TaskDraft {
  return {
    title: task.title,
    description: task.description,
    dueDate: task.dueDate,
    dueTime: task.dueTime,
    reminderMinutesBefore: task.reminderMinutesBefore,
    meetingId: task.meetingId,
    todoListId: task.external.todoListId,
    gtasksListId: task.external.gtasksListId,
  };
}

export type TaskDraftError = 'titleRequired' | 'titleTooLong' | 'descriptionTooLong';
export interface TaskDraftErrors {
  title?: TaskDraftError;
  description?: TaskDraftError;
}

export function validateTaskDraft(draft: TaskDraft): TaskDraftErrors {
  const errors: TaskDraftErrors = {};
  const title = draft.title.trim();
  if (title.length === 0) errors.title = 'titleRequired';
  else if (title.length > TASK_TITLE_MAX) errors.title = 'titleTooLong';
  if (draft.description.length > TASK_DESCRIPTION_MAX) errors.description = 'descriptionTooLong';
  return errors;
}

/** The same normalization the core builder applies (keeps the draft honest in the editor UI). */
export function normalizeDraft(draft: TaskDraft): TaskDraft {
  const dueTime = draft.dueDate === null ? null : draft.dueTime;
  return {
    ...draft,
    dueTime,
    reminderMinutesBefore: dueTime === null ? null : draft.reminderMinutesBefore,
  };
}

export function draftToInput(draft: TaskDraft): TaskInput {
  const clean = normalizeDraft(draft);
  return {
    title: clean.title.trim(),
    description: clean.description.replace(/\s+$/, ''),
    dueDate: clean.dueDate,
    dueTime: clean.dueTime,
    reminderMinutesBefore: clean.reminderMinutesBefore,
    meetingId: clean.meetingId,
    todoListId: clean.todoListId,
    gtasksListId: clean.gtasksListId,
  };
}

/** Only the fields the user changed; null when nothing changed. */
export function draftToPatch(task: Task, draft: TaskDraft): TaskPatch | null {
  const next = draftToInput(draft);
  const patch: TaskPatch = {};
  if (next.title !== task.title) patch.title = next.title;
  if (next.description !== task.description) patch.description = next.description;
  if ((next.dueDate ?? null) !== task.dueDate) patch.dueDate = next.dueDate ?? null;
  if ((next.dueTime ?? null) !== task.dueTime) patch.dueTime = next.dueTime ?? null;
  if ((next.reminderMinutesBefore ?? null) !== task.reminderMinutesBefore) {
    patch.reminderMinutesBefore = next.reminderMinutesBefore ?? null;
  }
  if ((next.meetingId ?? null) !== task.meetingId) patch.meetingId = next.meetingId ?? null;
  if ((next.todoListId ?? null) !== task.external.todoListId) patch.todoListId = next.todoListId ?? null;
  if ((next.gtasksListId ?? null) !== task.external.gtasksListId) patch.gtasksListId = next.gtasksListId ?? null;
  return Object.keys(patch).length > 0 ? patch : null;
}

export function isDraftDirty(draft: TaskDraft, original: TaskDraft): boolean {
  const a = draftToInput(draft);
  const b = draftToInput(original);
  return (
    a.title !== b.title ||
    a.description !== b.description ||
    (a.dueDate ?? null) !== (b.dueDate ?? null) ||
    (a.dueTime ?? null) !== (b.dueTime ?? null) ||
    (a.reminderMinutesBefore ?? null) !== (b.reminderMinutesBefore ?? null) ||
    (a.meetingId ?? null) !== (b.meetingId ?? null) ||
    (a.todoListId ?? null) !== (b.todoListId ?? null) ||
    (a.gtasksListId ?? null) !== (b.gtasksListId ?? null)
  );
}

// ---- Picker helpers (the native picker works in the device's local wall clock) ----------------

const pad = (value: number): string => String(value).padStart(2, '0');

/** Initial Date for the picker: the draft's wall clock, or the next full hour for a new value. */
export function pickerStartDate(draft: TaskDraft, now: Date): Date {
  if (draft.dueDate !== null) {
    const [year = 0, month = 1, day = 1] = draft.dueDate.split('-').map(Number);
    const [hour = 9, minute = 0] = (draft.dueTime ?? '09:00').split(':').map(Number);
    return new Date(year, month - 1, day, hour, minute, 0, 0);
  }
  const start = new Date(now.getTime());
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  return start;
}

export function dateToDueDate(value: Date): string {
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

export function dateToDueTime(value: Date): string {
  return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
}
