/**
 * The user's tasks as assistant context (contract v5; loaded only for clients that said
 * contractVersion >= 5).
 *
 * - Loaded server-side from users/{uid}/tasks (most recently updated first, field-masked,
 *   byte-bounded like the meetings context).
 * - Kept: every open task, plus tasks completed in the last DONE_KEEP_DAYS days (so "reopen the
 *   proposal task" works). Older done tasks are invisible to the model.
 * - Each task gets a short, stable "t"-prefixed reference (assignRefs); real ids never leave the
 *   server, and refs outside this context are rejected when mapping tool calls. The "t" prefix
 *   keeps task refs and meeting refs ("m") impossible to confuse.
 * - The model view is minimal: title, status, due, reminder, people names, the LINKED MEETING's
 *   ref (resolved against the meeting context, so the model can connect the two).
 */
import type { DocumentData, Firestore } from 'firebase-admin/firestore';

import { CONTEXT_WINDOW } from '../config';
import { aiTaskContextDocSchema, type AiTaskContextDoc } from '../shared/aiContract';
import { approximateSize, assignRefs } from './context';
import { parseInstant } from './time';

export interface TaskRecord {
  id: string;
  doc: AiTaskContextDoc;
}

export interface TaskReader {
  /** Most recently updated tasks (any status; buildTaskContext filters). */
  listRecent(uid: string, limit: number): Promise<TaskRecord[]>;
}

export interface ContextTask {
  ref: string;
  taskId: string;
  doc: AiTaskContextDoc;
}

export interface TaskContext {
  tasks: ContextTask[];
  byRef: Map<string, ContextTask>;
  skippedInvalid: number;
}

/** Completed tasks stay visible this long (reopening, "what did I finish this week"). */
export const DONE_KEEP_DAYS = 7;

const DAY_MS = 86_400_000;

function dueKey(doc: AiTaskContextDoc): string {
  if (doc.dueDate === null) return '9999-99-99T99:99';
  return `${doc.dueDate}T${doc.dueTime ?? '99:99'}`;
}

export function buildTaskContext(
  records: readonly TaskRecord[],
  now: Date,
  options: { maxTasks?: number; skippedInvalid?: number } = {},
): TaskContext {
  const maxTasks = options.maxTasks ?? CONTEXT_WINDOW.maxTasks;
  const doneCutoffMs = now.getTime() - DONE_KEEP_DAYS * DAY_MS;
  const unique = new Map<string, TaskRecord>();
  let skippedInvalid = options.skippedInvalid ?? 0;
  for (const record of records) {
    if (unique.has(record.id)) continue;
    const { doc } = record;
    if (doc.status === 'open') {
      unique.set(record.id, record);
      continue;
    }
    if (doc.status === 'done') {
      const completed = doc.completedAt ? parseInstant(doc.completedAt) : null;
      if (completed && completed.getTime() >= doneCutoffMs) unique.set(record.id, record);
      continue;
    }
    skippedInvalid += 1;
  }

  const kept = [...unique.values()]
    .sort((a, b) => {
      if (a.doc.status !== b.doc.status) return a.doc.status === 'open' ? -1 : 1;
      if (a.doc.status === 'open') {
        const dueA = dueKey(a.doc);
        const dueB = dueKey(b.doc);
        if (dueA !== dueB) return dueA < dueB ? -1 : 1;
      } else {
        const doneA = a.doc.completedAt ?? '';
        const doneB = b.doc.completedAt ?? '';
        if (doneA !== doneB) return doneA > doneB ? -1 : 1;
      }
      return a.id.localeCompare(b.id);
    })
    .slice(0, maxTasks);

  const refs = assignRefs(kept.map((record) => record.id), 't');
  const tasks: ContextTask[] = kept.map((record) => ({
    ref: refs.get(record.id) ?? record.id,
    taskId: record.id,
    doc: record.doc,
  }));
  return { tasks, byRef: new Map(tasks.map((task) => [task.ref, task])), skippedInvalid };
}

// ---------------------------------------------------------------------------------------------
// Model view
// ---------------------------------------------------------------------------------------------

export interface TaskModelView {
  ref: string;
  title: string;
  status: string;
  /** "YYYY-MM-DD" or "YYYY-MM-DD HH:mm" (local values as stored; absent without a due date). */
  due?: string;
  /** Present only when it differs from the user's zone (due values are anchored in it). */
  taskTimeZone?: string;
  reminderMinutesBefore?: number;
  people?: string[];
  /** Ref of the linked meeting when that meeting is in the meetings context. */
  meetingRef?: string;
}

function clip(value: string, max: number): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}...` : trimmed;
}

export function toTaskModelView(
  task: ContextTask,
  userTimeZone: string,
  meetingRefByMeetingId: ReadonlyMap<string, string>,
): TaskModelView {
  const { doc } = task;
  const view: TaskModelView = {
    ref: task.ref,
    title: clip(doc.title, CONTEXT_WINDOW.maxTitleChars),
    status: doc.status,
  };
  if (doc.dueDate !== null) {
    view.due = doc.dueTime === null ? doc.dueDate : `${doc.dueDate} ${doc.dueTime}`;
    if (doc.timezone !== userTimeZone) view.taskTimeZone = doc.timezone;
  }
  if (doc.reminderMinutesBefore !== null) view.reminderMinutesBefore = doc.reminderMinutesBefore;
  const names = doc.people
    .map((person) => clip(person.name, CONTEXT_WINDOW.maxParticipantNameChars))
    .filter((name) => name.length > 0)
    .slice(0, CONTEXT_WINDOW.maxParticipantsListed);
  if (names.length > 0) view.people = names;
  const meetingRef = doc.meetingId !== null ? meetingRefByMeetingId.get(doc.meetingId) : undefined;
  if (meetingRef !== undefined) view.meetingRef = meetingRef;
  return view;
}

// ---------------------------------------------------------------------------------------------
// Firestore reader
// ---------------------------------------------------------------------------------------------

/** The only document fields the task context reads (Firestore field mask). */
export const TASK_CONTEXT_FIELDS = [
  'title',
  'description',
  'dueDate',
  'dueTime',
  'timezone',
  'reminderMinutesBefore',
  'status',
  'meetingId',
  'people',
  'completedAt',
  'updatedAt',
] as const;

export function firestoreTaskReader(
  db: Firestore,
  onSkipped: (count: number, truncated: boolean) => void = () => undefined,
): TaskReader {
  return {
    async listRecent(uid, limit) {
      const query = db
        .collection(`users/${uid}/tasks`)
        .orderBy('updatedAt', 'desc')
        .select(...TASK_CONTEXT_FIELDS)
        .limit(limit);
      const records: TaskRecord[] = [];
      let skipped = 0;
      let total = 0;
      let truncated = false;
      // Streamed with the same per-document and total byte budgets as the meetings context.
      for await (const raw of query.stream() as unknown as AsyncIterable<unknown>) {
        const snapshot = raw as { id: string; data(): DocumentData };
        const data = snapshot.data();
        const size = approximateSize(data);
        if (size > CONTEXT_WINDOW.maxDocumentBytes) {
          skipped += 1;
          continue;
        }
        if (total + size > CONTEXT_WINDOW.maxContextBytes) {
          truncated = true;
          break;
        }
        total += size;
        const parsed = aiTaskContextDocSchema.safeParse(data);
        if (parsed.success) records.push({ id: snapshot.id, doc: parsed.data });
        else skipped += 1;
        if (records.length >= limit) break;
      }
      if (skipped > 0 || truncated) onSkipped(skipped, truncated);
      return records;
    },
  };
}
