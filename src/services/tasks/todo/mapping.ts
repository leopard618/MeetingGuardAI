/**
 * Pure mapping between Microsoft Graph To Do tasks and Meeting Guard tasks (unit-tested).
 *
 * What To Do keeps: title, notes (body), due DATE, reminder (an instant), done state.
 * What stays in Meeting Guard only (the UI says so): a due time without a reminder, people, the
 * meeting link, the task's zone. The reminder carries the time: a Meeting Guard task with a due
 * time and a reminder becomes a To Do reminder at (due - offset); a To Do reminder coming back
 * becomes due time + offset on the local task (reminder time if the days differ by more than a
 * week).
 *
 * Due dates: To Do stores a date as an instant (local midnight of the account's zone, expressed
 * in UTC with our Prefer header). We push local midnight of the task's zone and read whichever
 * local date is NEAREST to the instant in the device zone, so both conventions (UTC midnight
 * from other clients, local midnight from To Do) land on the right day.
 */
import { addMinutesIso, isLocalDate, toLocalDateTime, toUtcIso, zonedDateTimeToUtcIso } from '../../../core/time';
import { TASK_LIMITS, type Task, type TaskInput, type TaskPatch } from '../../../core/types';
import { stableHash } from '../../calendar/shared';
import type { GraphDateTimeTimeZone, GraphTodoTask, GraphTodoTaskWrite } from './types';

export interface TodoMappingContext {
  /** Device zone: imported tasks are anchored here (To Do has no zone of its own). */
  defaultTimeZone: string;
  /** Localized "(No title)". */
  untitledTitle: string;
}

/** Graph fractional seconds have 7 digits; JS date parsing wants at most 3. */
function normalizeGraphDateTime(dateTime: string): string {
  return dateTime.replace(/\.(\d{3})\d+/, '.$1');
}

/** "2026-10-05T09:00:00.0000000" + zone -> UTC ISO; null when unusable. */
export function todoDateTimeToUtcIso(value: GraphDateTimeTimeZone | null | undefined): string | null {
  const dateTime = value?.dateTime;
  if (!dateTime) return null;
  const zone = value?.timeZone ?? 'UTC';
  try {
    if (zone === 'UTC') return toUtcIso(`${normalizeGraphDateTime(dateTime)}Z`);
    const [date, time] = dateTime.split('T');
    if (date !== undefined && time !== undefined && isLocalDate(date)) {
      return zonedDateTimeToUtcIso(date, time.slice(0, 5), zone);
    }
    return toUtcIso(`${normalizeGraphDateTime(dateTime)}Z`);
  } catch {
    return null;
  }
}

function utcDateTime(iso: string): GraphDateTimeTimeZone {
  // Graph wants no trailing "Z": the zone is in `timeZone`.
  return { dateTime: iso.replace(/Z$/, ''), timeZone: 'UTC' };
}

/** The local date nearest to the instant in `timeZone` (see the header). */
export function nearestLocalDate(instantIso: string, timeZone: string): string {
  // Exactly midnight UTC is Graph's own date-only convention: that date, in every zone (the
  // "+24 h when past noon" rule below would move it a day late at UTC+13 and beyond).
  if (/T00:00:00(?:\.0+)?Z$/.test(instantIso)) return instantIso.slice(0, 10);
  const local = toLocalDateTime(instantIso, timeZone);
  const hour = Number(local.time.slice(0, 2));
  if (hour < 12) return local.date;
  return toLocalDateTime(addMinutesIso(instantIso, 24 * 60), timeZone).date;
}

/** UTC instant of a task's reminder, or null when it has none. */
export function taskReminderIso(task: Pick<Task, 'dueDate' | 'dueTime' | 'timezone' | 'reminderMinutesBefore'>): string | null {
  if (task.dueDate === null || task.dueTime === null || task.reminderMinutesBefore === null) return null;
  try {
    return addMinutesIso(zonedDateTimeToUtcIso(task.dueDate, task.dueTime, task.timezone), -task.reminderMinutesBefore);
  } catch {
    return null;
  }
}

/** The fields To Do shows; the hash of this projection is what echo suppression compares. */
export interface TodoVisibleFields {
  title: string;
  description: string;
  dueDate: string | null;
  reminderAt: string | null;
  done: boolean;
}

export function taskToVisibleFields(task: Pick<Task, 'title' | 'description' | 'dueDate' | 'dueTime' | 'timezone' | 'reminderMinutesBefore' | 'status'>): TodoVisibleFields {
  return {
    title: task.title.trim(),
    description: task.description.trim(),
    dueDate: task.dueDate,
    reminderAt: taskReminderIso(task),
    done: task.status === 'done',
  };
}

export function visibleHash(fields: TodoVisibleFields): string {
  return stableHash(fields);
}

export function taskVisibleHash(task: Parameters<typeof taskToVisibleFields>[0]): string {
  return visibleHash(taskToVisibleFields(task));
}

// ---------------------------------------------------------------------------------------------
// Meeting Guard -> To Do
// ---------------------------------------------------------------------------------------------

/** Full write body for a create (every field To Do keeps) or a patch (same: To Do PATCH is a merge). */
export function taskToTodoWrite(task: Pick<Task, 'title' | 'description' | 'dueDate' | 'dueTime' | 'timezone' | 'reminderMinutesBefore' | 'status'>): GraphTodoTaskWrite {
  const reminderAt = taskReminderIso(task);
  let dueDateTime: GraphDateTimeTimeZone | null = null;
  if (task.dueDate !== null) {
    try {
      dueDateTime = utcDateTime(zonedDateTimeToUtcIso(task.dueDate, '00:00', task.timezone));
    } catch {
      dueDateTime = null;
    }
  }
  return {
    title: task.title.trim().length > 0 ? task.title.trim() : task.title,
    body: { content: task.description, contentType: 'text' },
    status: task.status === 'done' ? 'completed' : 'notStarted',
    dueDateTime,
    isReminderOn: reminderAt !== null,
    reminderDateTime: reminderAt === null ? null : utcDateTime(reminderAt),
  };
}

// ---------------------------------------------------------------------------------------------
// To Do -> Meeting Guard
// ---------------------------------------------------------------------------------------------

const TAG_RE = /<[^>]+>/g;

function bodyText(task: GraphTodoTask): string {
  const content = task.body?.content ?? '';
  if (content.length === 0) return '';
  const text = task.body?.contentType === 'html' ? content.replace(/<br\s*\/?>/gi, '\n').replace(TAG_RE, '') : content;
  return text.replace(/\r\n/g, '\n').trim().slice(0, TASK_LIMITS.maxDescriptionChars);
}

export interface TodoImport {
  /** Fields for buildTask / applyTaskPatch (status aside). */
  input: TaskInput;
  done: boolean;
  visible: TodoVisibleFields;
}

/** Due time + reminder offset for a To Do reminder instant on `dueDate` (null = no reminder). */
export function reminderToDueTime(
  reminderAt: string | null,
  dueDate: string | null,
  timeZone: string,
): { dueDate: string | null; dueTime: string | null; reminderMinutesBefore: number | null } {
  if (reminderAt === null) return { dueDate, dueTime: null, reminderMinutesBefore: null };
  const local = toLocalDateTime(reminderAt, timeZone);
  if (dueDate === null) return { dueDate: local.date, dueTime: local.time, reminderMinutesBefore: 0 };
  try {
    const dueAtReminderTime = zonedDateTimeToUtcIso(dueDate, local.time, timeZone);
    const minutes = Math.round((Date.parse(dueAtReminderTime) - Date.parse(reminderAt)) / 60_000);
    if (minutes >= 0 && minutes <= TASK_LIMITS.maxReminderMinutes) {
      return { dueDate, dueTime: local.time, reminderMinutesBefore: minutes };
    }
  } catch {
    // Fall through.
  }
  // The reminder is after the due date, or further ahead of it than the app allows: keep the
  // reminder INSTANT the user set in To Do and move the due date onto it. Ringing at that time
  // on the original due date would be days early, and pushing that back would destroy the
  // reminder in To Do as well.
  return { dueDate: local.date, dueTime: local.time, reminderMinutesBefore: 0 };
}

/**
 * Graph task -> import payload. The existing local task (if any) keeps its zone and, when the
 * reminder instant did not change, its own due time / offset split.
 */
export function todoTaskToImport(task: GraphTodoTask, ctx: TodoMappingContext, existing: Task | null): TodoImport {
  const timezone = existing?.timezone ?? ctx.defaultTimeZone;
  const title = (task.title ?? '').trim().slice(0, TASK_LIMITS.maxTitleChars) || ctx.untitledTitle;
  const description = bodyText(task);
  const dueInstant = todoDateTimeToUtcIso(task.dueDateTime);
  const dueDate = dueInstant === null ? null : nearestLocalDate(dueInstant, timezone);
  const reminderAt = task.isReminderOn === true ? todoDateTimeToUtcIso(task.reminderDateTime) : null;
  const done = task.status === 'completed';

  let due: { dueDate: string | null; dueTime: string | null; reminderMinutesBefore: number | null };
  if (existing && reminderAt !== null && taskReminderIso(existing) === reminderAt && existing.dueDate === dueDate) {
    due = { dueDate, dueTime: existing.dueTime, reminderMinutesBefore: existing.reminderMinutesBefore };
  } else if (reminderAt === null && existing && existing.dueDate === dueDate) {
    // To Do has no reminder: keep a plain due time (To Do never sees it), drop a stale reminder.
    due = { dueDate, dueTime: existing.dueTime, reminderMinutesBefore: null };
  } else {
    due = reminderToDueTime(reminderAt, dueDate, timezone);
  }

  const input: TaskInput = { title, description, timezone, ...due };
  return {
    input,
    done,
    visible: { title, description, dueDate: due.dueDate, reminderAt, done },
  };
}

/** Patch that moves `existing` to what To Do shows (null when nothing visible differs). */
export function importToPatch(existing: Task, imported: TodoImport): TaskPatch | null {
  const patch: TaskPatch = {};
  if (imported.input.title !== existing.title) patch.title = imported.input.title;
  if ((imported.input.description ?? '') !== existing.description) patch.description = imported.input.description ?? '';
  if ((imported.input.dueDate ?? null) !== existing.dueDate) patch.dueDate = imported.input.dueDate ?? null;
  if ((imported.input.dueTime ?? null) !== existing.dueTime) patch.dueTime = imported.input.dueTime ?? null;
  if ((imported.input.reminderMinutesBefore ?? null) !== existing.reminderMinutesBefore) {
    patch.reminderMinutesBefore = imported.input.reminderMinutesBefore ?? null;
  }
  const status = imported.done ? 'done' : 'open';
  if (status !== existing.status) patch.status = status;
  return Object.keys(patch).length === 0 ? null : patch;
}

export function todoUpdatedIso(task: GraphTodoTask): string | null {
  if (!task.lastModifiedDateTime) return null;
  try {
    return toUtcIso(task.lastModifiedDateTime);
  } catch {
    return null;
  }
}
