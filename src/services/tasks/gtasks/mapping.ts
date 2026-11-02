/**
 * Pure mapping between Google Tasks and Meeting Guard tasks (unit-tested).
 *
 * What Google Tasks keeps: title, notes, due DATE, done state. What stays in Meeting Guard only
 * (the UI says so): the due time, the reminder, people, the meeting link, the task's zone. The
 * API stores a due date as midnight UTC of that date and ignores any time part, so the date is
 * pushed as "<date>T00:00:00.000Z" and read back as the first ten characters of `due`.
 */
import { toUtcIso } from '../../../core/time';
import { TASK_LIMITS, type Task, type TaskInput, type TaskPatch } from '../../../core/types';
import { stableHash } from '../../calendar/shared';
import type { GoogleTask, GoogleTaskWrite } from './types';

export interface GtasksMappingContext {
  /** Device zone: imported tasks are anchored here (Google Tasks has no zone of its own). */
  defaultTimeZone: string;
  /** Localized "(No title)". */
  untitledTitle: string;
}

/** The fields Google Tasks shows; the hash of this projection is what echo suppression compares. */
export interface GtasksVisibleFields {
  title: string;
  description: string;
  dueDate: string | null;
  done: boolean;
}

export function taskToGtasksVisibleFields(task: Pick<Task, 'title' | 'description' | 'dueDate' | 'status'>): GtasksVisibleFields {
  return {
    title: task.title.trim(),
    description: task.description.trim(),
    dueDate: task.dueDate,
    done: task.status === 'done',
  };
}

export function gtasksVisibleHash(fields: GtasksVisibleFields): string {
  return stableHash(fields);
}

export function taskGtasksVisibleHash(task: Parameters<typeof taskToGtasksVisibleFields>[0]): string {
  return gtasksVisibleHash(taskToGtasksVisibleFields(task));
}

/** "2026-10-05" -> the RFC 3339 value the API stores for that date. */
export function dueDateToGtasksDue(dueDate: string): string {
  return `${dueDate}T00:00:00.000Z`;
}

/** The local date of a Google `due` value (date-only by API contract); null when unusable. */
export function gtasksDueToDueDate(due: string | null | undefined): string | null {
  if (!due) return null;
  const date = due.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

// ---------------------------------------------------------------------------------------------
// Meeting Guard -> Google Tasks
// ---------------------------------------------------------------------------------------------

/** Full write body for a create or a patch (PATCH is a merge, so every kept field is sent). */
export function taskToGtasksWrite(task: Pick<Task, 'title' | 'description' | 'dueDate' | 'status' | 'completedAt'>): GoogleTaskWrite {
  const title = task.title.trim().length > 0 ? task.title.trim() : task.title;
  const done = task.status === 'done';
  return {
    title,
    notes: task.description,
    status: done ? 'completed' : 'needsAction',
    due: task.dueDate === null ? null : dueDateToGtasksDue(task.dueDate),
    // Reopening needs the completion time cleared explicitly (the API rejects needsAction with one).
    completed: done ? (task.completedAt ?? null) : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Google Tasks -> Meeting Guard
// ---------------------------------------------------------------------------------------------

export interface GtasksImport {
  /** Fields for buildTask / applyTaskPatch (status aside). */
  input: TaskInput;
  done: boolean;
  visible: GtasksVisibleFields;
}

function notesText(task: GoogleTask): string {
  const notes = task.notes ?? '';
  return notes.replace(/\r\n/g, '\n').trim().slice(0, TASK_LIMITS.maxDescriptionChars);
}

/**
 * Google task -> import payload. The existing local task (if any) keeps its zone and, when the
 * due date did not change, its own due time and reminder (Google never sees them). A changed or
 * cleared due date drops them: ringing at the old time on a different day would be wrong.
 */
export function gtasksTaskToImport(task: GoogleTask, ctx: GtasksMappingContext, existing: Task | null): GtasksImport {
  const timezone = existing?.timezone ?? ctx.defaultTimeZone;
  const title = (task.title ?? '').trim().slice(0, TASK_LIMITS.maxTitleChars) || ctx.untitledTitle;
  const description = notesText(task);
  const dueDate = gtasksDueToDueDate(task.due);
  const done = task.status === 'completed';
  const keepTime = existing !== null && existing.dueDate === dueDate && dueDate !== null;
  const input: TaskInput = {
    title,
    description,
    timezone,
    dueDate,
    dueTime: keepTime ? existing.dueTime : null,
    reminderMinutesBefore: keepTime ? existing.reminderMinutesBefore : null,
  };
  return { input, done, visible: { title, description, dueDate, done } };
}

/** Patch that moves `existing` to what Google Tasks shows (null when nothing visible differs). */
export function gtasksImportToPatch(existing: Task, imported: GtasksImport): TaskPatch | null {
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

export function gtasksUpdatedIso(task: GoogleTask): string | null {
  if (!task.updated) return null;
  try {
    return toUtcIso(task.updated);
  } catch {
    return null;
  }
}
