/**
 * Microsoft To Do two-way sync algorithms (dependency-injected; unit-tested with fakes).
 *
 * PULL  /me/todo/lists/{listId}/tasks/delta for every synced list (the default list plus every
 *       list a linked task lives in). Delta links are persisted per list; a full listing runs on
 *       the first sync of a list, every 7 days and on HTTP 410. `@removed` deletes the local
 *       task; a linked task missing from a full listing is deleted too (deleted in To Do).
 *       Tasks that are already completed when first seen are NOT imported (old history).
 * PUSH  POST to the task's list (external.todoListId, else the default list), PATCH, DELETE.
 *       Only To Do-visible changes are sent (hash of title, notes, due date, reminder instant,
 *       done state). A task whose list changed is deleted in the old list and re-created in the
 *       new one (Graph cannot move tasks). Completed tasks that were never pushed are not pushed.
 * ECHO  A local change waiting to be pushed wins over the pulled version; a task whose visible
 *       hash matches the stored one is unchanged; our own link write-backs use origin
 *       'tasks_todo', which the engine never pushes.
 */
import type { TasksRepository, TodoSyncResult } from '../../../core/contracts';
import { AppError, toAppError, type AppErrorCode } from '../../../core/errors';
import { createLogger } from '../../../core/logger';
import type { Task, TaskPatch } from '../../../core/types';
import { stableHash } from '../../calendar/shared';
import type { StateStore } from '../../calendar/stateStore';
import { graphErrorText, graphHttpStatus, type TodoGraphApi } from './api';
import { importToPatch, taskToTodoWrite, taskVisibleHash, todoTaskToImport, todoUpdatedIso, visibleHash, type TodoMappingContext } from './mapping';
import type { PendingTodoPush, TodoLink, TodoListState, TodoSyncState } from './state';
import type { GraphTodoDeltaPage, GraphTodoTask } from './types';

const log = createLogger('tasks');

export const FULL_SYNC_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_DELTA_PAGES = 100;
export const MAX_PUSH_ATTEMPTS = 8;

/** Errors that are not about one task: stop flushing and keep everything queued. */
const BLOCKING_CODES: ReadonlySet<AppErrorCode> = new Set<AppErrorCode>([
  'offline',
  'timeout',
  'unauthenticated',
  'calendar_not_connected',
  'not_configured',
]);
// permission_denied is NOT blocking: a 403 on one task (a shared, read-only list) counts as that
// task's failure and is dropped after MAX_PUSH_ATTEMPTS; the other tasks and the pull go on.

export type TodoTasksPort = Pick<TasksRepository, 'list' | 'get' | 'create' | 'update' | 'remove'>;

export interface TodoSyncDeps {
  api: TodoGraphApi;
  tasks: TodoTasksPort;
  state: StateStore<TodoSyncState>;
  /** The default list from preferences (null = none chosen: nothing is pushed). */
  defaultList(): Promise<{ id: string; name: string } | null>;
  now(): Date;
  /** Device zone: imported tasks are anchored here. */
  defaultTimeZone(): string;
  /** Localized "(No title)". */
  untitledTitle(): string;
}

/** Local id of a task imported from To Do (deterministic: two devices import the same document). */
export function todoTaskLocalId(todoId: string): string {
  if (todoId.length === 0) throw new AppError('invalid_input', 'To Do task id is empty');
  if (/^[A-Za-z0-9_-]+$/.test(todoId) && todoId.length <= 120) return `td_${todoId}`;
  return `td_h${stableHash(`todo|${todoId}`)}${stableHash(`todo|${[...todoId].reverse().join('')}`)}`;
}

export function isFullSyncDue(lastFullSyncAt: string | null, now: Date): boolean {
  if (lastFullSyncAt === null) return true;
  const last = Date.parse(lastFullSyncAt);
  return Number.isNaN(last) || now.getTime() - last >= FULL_SYNC_INTERVAL_MS;
}

/** Tasks that are pushed to To Do: everything but imports that lost their copy. */
export function isTodoPushable(task: Pick<Task, 'source' | 'status' | 'external'>): boolean {
  if (task.source === 'todo') return task.external.todoTaskId !== null;
  // A task finished before it was ever synced is history, not a new To Do item.
  return task.external.todoTaskId !== null || task.status !== 'done';
}

function mappingContext(deps: TodoSyncDeps): TodoMappingContext {
  return { defaultTimeZone: deps.defaultTimeZone(), untitledTitle: deps.untitledTitle() };
}

function emptyCounts(): TodoSyncResult['counts'] {
  return { created: 0, updated: 0, removed: 0, unchanged: 0, pushed: 0, failed: 0 };
}

// ---------------------------------------------------------------------------------------------
// Pull
// ---------------------------------------------------------------------------------------------

interface DeltaListing {
  tasks: GraphTodoTask[];
  deltaLink: string | null;
}

async function listDelta(api: TodoGraphApi, start: { listId: string } | { deltaLink: string }): Promise<DeltaListing> {
  const tasks: GraphTodoTask[] = [];
  let page: GraphTodoDeltaPage = 'deltaLink' in start ? await api.getDeltaPage(start.deltaLink) : await api.startDelta(start.listId);
  for (let count = 0; count < MAX_DELTA_PAGES; count += 1) {
    tasks.push(...(page.value ?? []));
    const nextLink = page['@odata.nextLink'];
    if (nextLink === undefined) return { tasks, deltaLink: page['@odata.deltaLink'] ?? null };
    page = await api.getDeltaPage(nextLink);
  }
  throw new AppError('upstream_error', 'Microsoft Graph returned too many delta pages', { details: { pages: MAX_DELTA_PAGES } });
}

/** The lists a pull covers: the default list plus every list a linked task lives in. */
export function syncedListIds(defaultListId: string | null, tasks: readonly Task[]): string[] {
  const ids = new Set<string>();
  if (defaultListId !== null) ids.add(defaultListId);
  for (const task of tasks) {
    if (task.external.todoTaskId !== null && task.external.todoListId !== null) ids.add(task.external.todoListId);
  }
  return [...ids];
}

interface ListPullOutcome {
  counts: Pick<TodoSyncResult['counts'], 'created' | 'updated' | 'removed' | 'unchanged'>;
  fullSync: boolean;
}

async function pullList(deps: TodoSyncDeps, listId: string, options: { full: boolean }): Promise<ListPullOutcome> {
  const now = deps.now();
  const state = await deps.state.load();
  const listState: TodoListState = state.lists[listId] ?? { deltaLink: null, lastFullSyncAt: null };
  let full = options.full || listState.deltaLink === null || isFullSyncDue(listState.lastFullSyncAt, now);
  let listing: DeltaListing;
  try {
    listing = full ? await listDelta(deps.api, { listId }) : await listDelta(deps.api, { deltaLink: listState.deltaLink as string });
  } catch (error) {
    if (!full && graphHttpStatus(error) === 410) {
      full = true;
      listing = await listDelta(deps.api, { listId });
    } else {
      throw error;
    }
  }

  const ctx = mappingContext(deps);
  const locals = await deps.tasks.list();
  const byTodoId = new Map<string, Task>();
  for (const task of locals) {
    if (task.external.todoTaskId !== null) byTodoId.set(task.external.todoTaskId, task);
  }
  const counts = { created: 0, updated: 0, removed: 0, unchanged: 0 };
  const hashUpdates: Record<string, string | null> = {};
  // Where each linked task's copy lives, learned from the listing: a later "Change list" then
  // deletes the old copy before creating the new one, also for tasks this device never pushed.
  const linkUpdates: Record<string, TodoLink> = {};
  const seen = new Set<string>();

  for (const item of listing.tasks) {
    seen.add(item.id);
    const local = byTodoId.get(item.id) ?? null;
    if (item['@removed'] !== undefined) {
      if (local && state.pending[local.id] === undefined) {
        await removeLocal(deps, local.id);
        counts.removed += 1;
      } else {
        counts.unchanged += 1;
      }
      hashUpdates[item.id] = null;
      continue;
    }
    if (local && state.pending[local.id] !== undefined) {
      // A local change is waiting to be pushed: it wins (the push overwrites To Do).
      counts.unchanged += 1;
      continue;
    }
    const imported = todoTaskToImport(item, ctx, local);
    const hash = visibleHash(imported.visible);
    const todoUpdatedAt = todoUpdatedIso(item);
    if (local) {
      linkUpdates[local.id] = { listId, taskId: item.id };
      if (state.hashes[item.id] === hash) {
        counts.unchanged += 1;
        continue;
      }
      const patch: TaskPatch = { ...(importToPatch(local, imported) ?? {}), external: { todoListId: listId, todoUpdatedAt } };
      try {
        await deps.tasks.update(local.id, patch, { origin: 'tasks_todo' });
        counts.updated += 1;
      } catch (error) {
        if (toAppError(error).code !== 'not_found') throw error;
        counts.unchanged += 1;
      }
    } else {
      if (imported.done) {
        // Finished before Meeting Guard ever saw it: history stays in To Do.
        counts.unchanged += 1;
        continue;
      }
      const id = todoTaskLocalId(item.id);
      const created = await deps.tasks.create({ ...imported.input, todoListId: listId }, { id, origin: 'tasks_todo', source: 'todo' });
      if (created.external.todoTaskId !== null && created.external.todoTaskId !== item.id) {
        // The deterministic id returned a task that was moved to another list since (its copy
        // there is the live one): this listing's copy is a leftover, never re-link to it.
        counts.unchanged += 1;
        hashUpdates[item.id] = hash;
        continue;
      }
      await deps.tasks.update(created.id, { external: { todoListId: listId, todoTaskId: item.id, todoUpdatedAt } }, { origin: 'tasks_todo' });
      linkUpdates[created.id] = { listId, taskId: item.id };
      counts.created += 1;
    }
    hashUpdates[item.id] = hash;
  }

  if (full) {
    // Linked tasks of this list that the full listing did not mention were deleted in To Do.
    for (const task of locals) {
      const todoId = task.external.todoTaskId;
      if (todoId === null || task.external.todoListId !== listId || seen.has(todoId)) continue;
      if (state.pending[task.id] !== undefined) continue;
      await removeLocal(deps, task.id);
      counts.removed += 1;
      hashUpdates[todoId] = null;
    }
  }

  await deps.state.update((current) => ({
    ...current,
    lists: {
      ...current.lists,
      [listId]: {
        deltaLink: listing.deltaLink,
        lastFullSyncAt: full ? now.toISOString() : listState.lastFullSyncAt,
      },
    },
    hashes: applyHashUpdates(current.hashes, hashUpdates),
    links: { ...pruneLinks(current.links, hashUpdates), ...linkUpdates },
  }));
  return { counts, fullSync: full };
}

async function removeLocal(deps: TodoSyncDeps, taskId: string): Promise<void> {
  try {
    await deps.tasks.remove(taskId, { origin: 'tasks_todo' });
  } catch (error) {
    if (toAppError(error).code !== 'not_found') throw error;
  }
}

function applyHashUpdates(hashes: Record<string, string>, updates: Record<string, string | null>): Record<string, string> {
  const next = { ...hashes };
  for (const [id, hash] of Object.entries(updates)) {
    if (hash === null) delete next[id];
    else next[id] = hash;
  }
  return next;
}

/** Forgets links whose To Do copy disappeared (hash update null). */
function pruneLinks(links: Record<string, TodoLink>, updates: Record<string, string | null>): Record<string, TodoLink> {
  const gone = new Set(Object.entries(updates).filter(([, hash]) => hash === null).map(([id]) => id));
  if (gone.size === 0) return links;
  const next: Record<string, TodoLink> = {};
  for (const [taskId, link] of Object.entries(links)) {
    if (!gone.has(link.taskId)) next[taskId] = link;
  }
  return next;
}

/** Pulls every synced list. */
export async function pullTodoChanges(deps: TodoSyncDeps, options: { full?: boolean } = {}): Promise<TodoSyncResult> {
  const defaultList = await deps.defaultList();
  const tasks = await deps.tasks.list();
  const listIds = syncedListIds(defaultList?.id ?? null, tasks);
  const counts = emptyCounts();
  let fullSync = false;
  for (const listId of listIds) {
    const outcome = await pullList(deps, listId, { full: options.full === true });
    counts.created += outcome.counts.created;
    counts.updated += outcome.counts.updated;
    counts.removed += outcome.counts.removed;
    counts.unchanged += outcome.counts.unchanged;
    fullSync = fullSync || outcome.fullSync;
  }
  const syncedAt = deps.now().toISOString();
  await deps.state.update((current) => ({ ...current, lastSyncAt: syncedAt, lastError: null }));
  return { fullSync, counts, syncedAt };
}

// ---------------------------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------------------------

export interface PushOutcome {
  task: Task;
  /** false when nothing had to be sent (unchanged / not pushable / no list). */
  sent: boolean;
}

/** Where the task's To Do copy is: this device's memory first, else the document's link. */
function resolveLink(state: TodoSyncState, task: Task): TodoLink | null {
  const remembered = state.links[task.id];
  if (remembered) return remembered;
  if (task.external.todoTaskId !== null && task.external.todoListId !== null) {
    return { listId: task.external.todoListId, taskId: task.external.todoTaskId };
  }
  return null;
}

async function writeBack(deps: TodoSyncDeps, task: Task, patch: TaskPatch): Promise<Task> {
  try {
    return await deps.tasks.update(task.id, patch, { origin: 'tasks_todo' });
  } catch (error) {
    const appError = toAppError(error);
    if (appError.code === 'not_found') {
      // Deleted while the push was running; its delete is queued and removes the copy next.
      log.info('Task deleted during a To Do push', { taskId: task.id });
      return task;
    }
    throw appError;
  }
}

async function rememberLink(deps: TodoSyncDeps, taskId: string, link: TodoLink | null, hash: string | null): Promise<void> {
  await deps.state.update((current) => {
    const links = { ...current.links };
    const hashes = { ...current.hashes };
    const previous = current.links[taskId];
    if (previous && (link === null || previous.taskId !== link.taskId)) delete hashes[previous.taskId];
    if (link === null) delete links[taskId];
    else {
      links[taskId] = link;
      if (hash === null) delete hashes[link.taskId];
      else hashes[link.taskId] = hash;
    }
    return { ...current, links, hashes };
  });
}

/** DELETE the copy; a missing / already deleted task counts as deleted. */
export async function deleteTodoCopy(deps: TodoSyncDeps, link: TodoLink): Promise<void> {
  try {
    await deps.api.deleteTask(link.listId, link.taskId);
  } catch (error) {
    const status = graphHttpStatus(error);
    if (status !== 404 && status !== 410) throw error;
  }
  await deps.state.update((current) => {
    const hashes = { ...current.hashes };
    delete hashes[link.taskId];
    const links: Record<string, TodoLink> = {};
    for (const [taskId, item] of Object.entries(current.links)) {
      if (item.taskId !== link.taskId) links[taskId] = item;
    }
    return { ...current, hashes, links };
  });
}

/** Insert, patch, or move (delete + insert) one task's copy in To Do. */
export async function pushTodoTask(deps: TodoSyncDeps, task: Task): Promise<PushOutcome> {
  if (!isTodoPushable(task)) return { task, sent: false };
  const state = await deps.state.load();
  const defaultList = await deps.defaultList();
  const targetList = task.external.todoListId ?? defaultList?.id ?? null;
  if (targetList === null) return { task, sent: false };

  let link = resolveLink(state, task);
  const hash = taskVisibleHash(task);
  const body = taskToTodoWrite(task);

  if (link !== null && link.listId !== targetList) {
    // Graph cannot move a task between lists: re-create it in the new list.
    await deleteTodoCopy(deps, link);
    link = null;
  }

  if (link !== null) {
    if (state.hashes[link.taskId] === hash && task.external.todoTaskId === link.taskId && task.external.todoListId === link.listId) {
      return { task, sent: false };
    }
    try {
      const patched = await deps.api.patchTask(link.listId, link.taskId, body);
      const next = await writeBack(deps, task, {
        external: { todoListId: link.listId, todoTaskId: patched.id, todoUpdatedAt: todoUpdatedIso(patched) },
      });
      await rememberLink(deps, task.id, { listId: link.listId, taskId: patched.id }, hash);
      return { task: next, sent: true };
    } catch (error) {
      const status = graphHttpStatus(error);
      if (status !== 404 && status !== 410) throw error;
      // The copy is gone (deleted in To Do before the pull noticed): a task that still exists
      // here is re-created, like any new task.
      await rememberLink(deps, task.id, null, null);
      link = null;
    }
  }

  const created = await deps.api.createTask(targetList, body);
  const next = await writeBack(deps, task, {
    external: { todoListId: targetList, todoTaskId: created.id, todoUpdatedAt: todoUpdatedIso(created) },
  });
  await rememberLink(deps, task.id, { listId: targetList, taskId: created.id }, hash);
  return { task: next, sent: true };
}

// ---------------------------------------------------------------------------------------------
// Pending pushes (persisted queue)
// ---------------------------------------------------------------------------------------------

let queueSequence = 0;

export interface TodoQueueItem {
  id: string;
  op: PendingTodoPush['op'];
  /** For deletes: the copy to remove (from the tasks:changed event); null when unknown. */
  link?: TodoLink | null;
}

/** Queues local changes for To Do (persisted, so they survive restarts and offline periods). */
export async function enqueueTodoPushes(deps: Pick<TodoSyncDeps, 'state' | 'now'>, items: readonly TodoQueueItem[]): Promise<void> {
  if (items.length === 0) return;
  const base = deps.now().toISOString();
  await deps.state.update((current) => {
    const pending = { ...current.pending };
    for (const item of items) {
      queueSequence += 1;
      const link = item.link ?? current.links[item.id] ?? current.pending[item.id]?.link ?? null;
      pending[item.id] = {
        op: item.op,
        queuedAt: `${base}#${String(queueSequence).padStart(6, '0')}`,
        attempts: 0,
        lastError: null,
        link: item.op === 'delete' ? link : null,
      };
    }
    return { ...current, pending };
  });
}

export interface FlushResult {
  pushed: number;
  failed: number;
  /** Still queued after this flush. */
  pending: number;
  /** Set when a connection/auth problem stopped the flush (everything stays queued). */
  blockedBy: AppErrorCode | null;
}

async function settle(deps: TodoSyncDeps, taskId: string, queuedAt: string, next: PendingTodoPush | null): Promise<void> {
  await deps.state.update((current) => {
    const entry = current.pending[taskId];
    // A newer change was queued meanwhile: keep it.
    if (!entry || entry.queuedAt !== queuedAt) return current;
    const pending = { ...current.pending };
    if (next === null) delete pending[taskId];
    else pending[taskId] = next;
    return { ...current, pending };
  });
}

/** Pushes every queued change (oldest first). */
export async function flushTodoPushes(deps: TodoSyncDeps): Promise<FlushResult> {
  const state = await deps.state.load();
  const entries = Object.entries(state.pending).sort(([, a], [, b]) => a.queuedAt.localeCompare(b.queuedAt));
  const result: FlushResult = { pushed: 0, failed: 0, pending: 0, blockedBy: null };
  if (entries.length === 0) return result;

  const locals = await deps.tasks.list();
  const byId = new Map(locals.map((task) => [task.id, task]));

  for (const [taskId, entry] of entries) {
    const task = byId.get(taskId);
    try {
      if (task) {
        const outcome = await pushTodoTask(deps, task);
        if (outcome.sent) result.pushed += 1;
      } else {
        const link = entry.link ?? state.links[taskId] ?? null;
        if (link) {
          await deleteTodoCopy(deps, link);
          result.pushed += 1;
        }
      }
      await settle(deps, taskId, entry.queuedAt, null);
    } catch (error) {
      const appError = toAppError(error);
      if (BLOCKING_CODES.has(appError.code)) {
        result.blockedBy = appError.code;
        await settle(deps, taskId, entry.queuedAt, { ...entry, lastError: appError.code });
        break;
      }
      const attempts = entry.attempts + 1;
      // A 403 is retried like a transient error (the consent may still be propagating) and
      // dropped after MAX_PUSH_ATTEMPTS; it never blocks the other tasks or the pull.
      if ((appError.retryable || appError.code === 'permission_denied') && attempts < MAX_PUSH_ATTEMPTS) {
        await settle(deps, taskId, entry.queuedAt, { ...entry, attempts, lastError: appError.code });
      } else {
        result.failed += 1;
        log.warn('Dropping a change To Do rejected', {
          taskId,
          code: appError.code,
          status: graphHttpStatus(appError),
          graph: graphErrorText(appError),
        });
        await settle(deps, taskId, entry.queuedAt, null);
      }
    }
  }
  const after = await deps.state.load();
  result.pending = Object.keys(after.pending).length;
  return result;
}

/** Queues every open task that has no To Do copy yet (first enable / list chosen). */
export async function enqueueUnlinkedOpenTasks(deps: TodoSyncDeps): Promise<number> {
  const tasks = await deps.tasks.list();
  const items: TodoQueueItem[] = tasks
    .filter((task) => task.source !== 'todo' && task.status === 'open' && task.external.todoTaskId === null)
    .map((task) => ({ id: task.id, op: 'upsert' as const }));
  await enqueueTodoPushes(deps, items);
  return items.length;
}

/**
 * Disable cleanup: tasks imported from To Do are deleted here (their copies stay in To Do) and
 * our own tasks forget their links (a later enable pushes them again as new To Do tasks).
 */
export async function removeTodoLinks(deps: TodoSyncDeps): Promise<{ removed: number; unlinked: number }> {
  const tasks = await deps.tasks.list();
  let removed = 0;
  let unlinked = 0;
  for (const task of tasks) {
    if (task.source === 'todo') {
      await removeLocal(deps, task.id);
      removed += 1;
      continue;
    }
    if (task.external.todoTaskId === null && task.external.todoListId === null) continue;
    await deps.tasks.update(task.id, { external: { todoListId: null, todoTaskId: null, todoUpdatedAt: null } }, { origin: 'tasks_todo' });
    unlinked += 1;
  }
  return { removed, unlinked };
}
