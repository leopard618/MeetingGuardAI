/**
 * Google Tasks two-way sync algorithms (dependency-injected; unit-tested with fakes). Mirror of
 * src/services/tasks/todo/sync.ts for the Google Tasks API.
 *
 * PULL  tasks.list for every synced list (the default list plus every list a linked task lives
 *       in), showDeleted + showHidden, paged. A full listing runs on the first sync of a list,
 *       every 7 days and whenever the stored watermark is missing; otherwise `updatedMin` is the
 *       previous pull time minus a skew margin. `deleted: true` deletes the local task; a linked
 *       task missing from a full listing is deleted too (deleted in Google). Tasks that are
 *       already completed when first seen are NOT imported (old history). A document that lost
 *       its link is matched through the copy this device knows of (state.links) and linked again.
 * PUSH  POST to the task's list (external.gtasksListId; else the list of the copy this device
 *       knows of, when the document lost its link; else the default list), PATCH, DELETE. A
 *       copy this device knows of counts as the link of such a document, also for completions.
 *       Only Google-visible changes are sent (hash of title, notes, due date, done state). A task
 *       whose list changed is deleted in the old list and re-created in the new one (the API has
 *       no cross-list move). Completed tasks that were never pushed are not pushed. A change with
 *       no list to go to stays queued, untouched, until a list is chosen (never dropped).
 * ECHO  A local change waiting to be pushed wins over the pulled version; a task whose visible
 *       hash matches the stored one is unchanged; our own link write-backs use origin
 *       'tasks_gtasks', which the engine never pushes.
 */
import type { TaskSyncResult, TasksRepository } from '../../../core/contracts';
import { AppError, toAppError, type AppErrorCode } from '../../../core/errors';
import { createLogger } from '../../../core/logger';
import type { Task, TaskPatch } from '../../../core/types';
import { stableHash } from '../../calendar/shared';
import type { StateStore } from '../../calendar/stateStore';
import { googleTasksHttpStatus, type GoogleTasksApi } from './api';
import {
  gtasksImportToPatch,
  gtasksTaskToImport,
  gtasksUpdatedIso,
  gtasksVisibleHash,
  taskGtasksVisibleHash,
  taskToGtasksWrite,
  type GtasksMappingContext,
} from './mapping';
import type { GtasksLink, GtasksListState, GtasksSyncState, PendingGtasksPush } from './state';
import type { GoogleTask } from './types';

const log = createLogger('tasks');

export const GTASKS_FULL_SYNC_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
export const GTASKS_MAX_PAGES = 100;
export const GTASKS_MAX_PUSH_ATTEMPTS = 8;
/** The next incremental pull starts this much before the previous pull (clock skew, late writes). */
export const GTASKS_UPDATED_MIN_SKEW_MS = 2 * 60 * 1000;

/** Errors that are not about one task: stop flushing and keep everything queued. */
const BLOCKING_CODES: ReadonlySet<AppErrorCode> = new Set<AppErrorCode>([
  'offline',
  'timeout',
  'unauthenticated',
  'google_not_signed_in',
  'tasks_scope_missing',
  'calendar_not_connected',
  'not_configured',
]);
// permission_denied is NOT blocking: a 403 on one task counts as that task's failure and is
// dropped after GTASKS_MAX_PUSH_ATTEMPTS; the other tasks and the pull go on.

export type GtasksTasksPort = Pick<TasksRepository, 'list' | 'get' | 'create' | 'update' | 'remove'>;

export interface GtasksSyncDeps {
  api: GoogleTasksApi;
  tasks: GtasksTasksPort;
  state: StateStore<GtasksSyncState>;
  /** The list new tasks go to (service.ts resolveList); null = none chosen: new tasks wait in the queue. */
  defaultList(): Promise<{ id: string; name: string } | null>;
  now(): Date;
  /** Device zone: imported tasks are anchored here. */
  defaultTimeZone(): string;
  /** Localized "(No title)". */
  untitledTitle(): string;
}

/** Local id of a task imported from Google Tasks (deterministic: two devices import the same document). */
export function gtasksTaskLocalId(googleId: string): string {
  if (googleId.length === 0) throw new AppError('invalid_input', 'Google task id is empty');
  if (/^[A-Za-z0-9_-]+$/.test(googleId) && googleId.length <= 120) return `gt_${googleId}`;
  return `gt_h${stableHash(`gtasks|${googleId}`)}${stableHash(`gtasks|${[...googleId].reverse().join('')}`)}`;
}

export function isGtasksFullSyncDue(lastFullSyncAt: string | null, now: Date): boolean {
  if (lastFullSyncAt === null) return true;
  const last = Date.parse(lastFullSyncAt);
  return Number.isNaN(last) || now.getTime() - last >= GTASKS_FULL_SYNC_INTERVAL_MS;
}

/** Tasks that are pushed to Google: everything but imports that lost their copy. */
export function isGtasksPushable(task: Pick<Task, 'source' | 'status' | 'external'>): boolean {
  if (task.source === 'gtasks') return task.external.gtasksTaskId !== null;
  // A task finished before it was ever synced is history, not a new Google task.
  return task.external.gtasksTaskId !== null || task.status !== 'done';
}

function mappingContext(deps: GtasksSyncDeps): GtasksMappingContext {
  return { defaultTimeZone: deps.defaultTimeZone(), untitledTitle: deps.untitledTitle() };
}

function emptyCounts(): TaskSyncResult['counts'] {
  return { created: 0, updated: 0, removed: 0, unchanged: 0, pushed: 0, failed: 0 };
}

// ---------------------------------------------------------------------------------------------
// Pull
// ---------------------------------------------------------------------------------------------

async function listAll(api: GoogleTasksApi, listId: string, updatedMin: string | undefined): Promise<GoogleTask[]> {
  const tasks: GoogleTask[] = [];
  let pageToken: string | undefined;
  for (let count = 0; count < GTASKS_MAX_PAGES; count += 1) {
    const page = await api.listTasks(listId, { updatedMin, pageToken });
    tasks.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
    if (pageToken === undefined) return tasks;
  }
  throw new AppError('upstream_error', 'Google Tasks returned too many pages', { details: { pages: GTASKS_MAX_PAGES } });
}

/** The lists a pull covers: the default list plus every list a linked task lives in. */
export function gtasksSyncedListIds(defaultListId: string | null, tasks: readonly Task[]): string[] {
  const ids = new Set<string>();
  if (defaultListId !== null) ids.add(defaultListId);
  for (const task of tasks) {
    if (task.external.gtasksTaskId !== null && task.external.gtasksListId !== null) ids.add(task.external.gtasksListId);
  }
  return [...ids];
}

interface ListPullOutcome {
  counts: Pick<TaskSyncResult['counts'], 'created' | 'updated' | 'removed' | 'unchanged'>;
  fullSync: boolean;
}

async function pullList(deps: GtasksSyncDeps, listId: string, options: { full: boolean }): Promise<ListPullOutcome> {
  const now = deps.now();
  const state = await deps.state.load();
  const listState: GtasksListState = state.lists[listId] ?? { updatedMin: null, lastFullSyncAt: null };
  const full = options.full || listState.updatedMin === null || isGtasksFullSyncDue(listState.lastFullSyncAt, now);
  const listing = await listAll(deps.api, listId, full ? undefined : (listState.updatedMin as string));

  const ctx = mappingContext(deps);
  const locals = await deps.tasks.list();
  const byGoogleId = new Map<string, Task>();
  for (const task of locals) {
    if (task.external.gtasksTaskId !== null) byGoogleId.set(task.external.gtasksTaskId, task);
  }
  // A document rewritten without its link (an older build saves tasks as whole documents, and
  // another device's disable unlinks them) is matched through the copy this device knows of in
  // this list: that copy is linked again, it never comes back as a new task.
  const localsById = new Map(locals.map((task) => [task.id, task]));
  for (const [taskId, link] of Object.entries(state.links)) {
    if (link.listId !== listId || byGoogleId.has(link.taskId)) continue;
    const task = localsById.get(taskId);
    if (task !== undefined && task.external.gtasksTaskId === null) byGoogleId.set(link.taskId, task);
  }
  const counts = { created: 0, updated: 0, removed: 0, unchanged: 0 };
  const hashUpdates: Record<string, string | null> = {};
  // Where each linked task's copy lives, learned from the listing: a later "Change list" then
  // deletes the old copy before creating the new one, also for tasks this device never pushed.
  const linkUpdates: Record<string, GtasksLink> = {};
  const seen = new Set<string>();

  for (const item of listing) {
    const local = byGoogleId.get(item.id) ?? null;
    if (item.deleted === true) {
      if (local && state.pending[local.id] === undefined) {
        await removeLocal(deps, local.id);
        counts.removed += 1;
      } else {
        counts.unchanged += 1;
      }
      hashUpdates[item.id] = null;
      continue;
    }
    seen.add(item.id);
    if (local && state.pending[local.id] !== undefined) {
      // A local change is waiting to be pushed: it wins (the push overwrites Google).
      counts.unchanged += 1;
      continue;
    }
    const imported = gtasksTaskToImport(item, ctx, local);
    const hash = gtasksVisibleHash(imported.visible);
    const gtasksUpdatedAt = gtasksUpdatedIso(item);
    if (local) {
      linkUpdates[local.id] = { listId, taskId: item.id };
      // Matched through this device's memory (above): the document gets its link back.
      const relink = local.external.gtasksTaskId !== item.id;
      const changed = state.hashes[item.id] !== hash;
      if (!changed && !relink) {
        counts.unchanged += 1;
        continue;
      }
      // Google's version only when it changed there: unchanged, the copy holds what this device
      // last sent or saw, and an edit the older build made to the document stays.
      const content = changed ? (gtasksImportToPatch(local, imported) ?? {}) : {};
      const patch: TaskPatch = { ...content, external: { gtasksListId: listId, gtasksTaskId: item.id, gtasksUpdatedAt } };
      try {
        await deps.tasks.update(local.id, patch, { origin: 'tasks_gtasks' });
        counts.updated += 1;
      } catch (error) {
        if (toAppError(error).code !== 'not_found') throw error;
        counts.unchanged += 1;
      }
    } else {
      if (imported.done) {
        // Finished before Meeting Guard ever saw it: history stays in Google.
        counts.unchanged += 1;
        continue;
      }
      const id = gtasksTaskLocalId(item.id);
      const created = await deps.tasks.create({ ...imported.input, gtasksListId: listId }, { id, origin: 'tasks_gtasks', source: 'gtasks' });
      if (created.external.gtasksTaskId !== null && created.external.gtasksTaskId !== item.id) {
        // The deterministic id returned a task that was moved to another list since (its copy
        // there is the live one): this listing's copy is a leftover, never re-link to it.
        counts.unchanged += 1;
        hashUpdates[item.id] = hash;
        continue;
      }
      await deps.tasks.update(created.id, { external: { gtasksListId: listId, gtasksTaskId: item.id, gtasksUpdatedAt } }, { origin: 'tasks_gtasks' });
      linkUpdates[created.id] = { listId, taskId: item.id };
      counts.created += 1;
    }
    hashUpdates[item.id] = hash;
  }

  if (full) {
    // Linked tasks of this list that the full listing did not mention were deleted in Google.
    for (const task of locals) {
      const googleId = task.external.gtasksTaskId;
      if (googleId === null || task.external.gtasksListId !== listId || seen.has(googleId)) continue;
      if (hashUpdates[googleId] === null) continue; // already removed above (deleted: true)
      if (state.pending[task.id] !== undefined) continue;
      await removeLocal(deps, task.id);
      counts.removed += 1;
      hashUpdates[googleId] = null;
    }
  }

  const watermark = new Date(now.getTime() - GTASKS_UPDATED_MIN_SKEW_MS).toISOString();
  await deps.state.update((current) => ({
    ...current,
    lists: {
      ...current.lists,
      [listId]: {
        updatedMin: watermark,
        lastFullSyncAt: full ? now.toISOString() : listState.lastFullSyncAt,
      },
    },
    hashes: applyHashUpdates(current.hashes, hashUpdates),
    links: { ...pruneLinks(current.links, hashUpdates), ...linkUpdates },
  }));
  return { counts, fullSync: full };
}

async function removeLocal(deps: GtasksSyncDeps, taskId: string): Promise<void> {
  try {
    await deps.tasks.remove(taskId, { origin: 'tasks_gtasks' });
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

/** Forgets links whose Google copy disappeared (hash update null). */
function pruneLinks(links: Record<string, GtasksLink>, updates: Record<string, string | null>): Record<string, GtasksLink> {
  const gone = new Set(Object.entries(updates).filter(([, hash]) => hash === null).map(([id]) => id));
  if (gone.size === 0) return links;
  const next: Record<string, GtasksLink> = {};
  for (const [taskId, link] of Object.entries(links)) {
    if (!gone.has(link.taskId)) next[taskId] = link;
  }
  return next;
}

/** Pulls every synced list. */
export async function pullGtasksChanges(deps: GtasksSyncDeps, options: { full?: boolean } = {}): Promise<TaskSyncResult> {
  const defaultList = await deps.defaultList();
  const tasks = await deps.tasks.list();
  const listIds = gtasksSyncedListIds(defaultList?.id ?? null, tasks);
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

export interface GtasksPushOutcome {
  task: Task;
  /** false when nothing had to be sent (unchanged / not pushable / no list). */
  sent: boolean;
  /** true when there is no list to send the task to (none on the task, none chosen): keep it queued. */
  listMissing?: true;
}

/** Where the task's Google copy is: this device's memory first, else the document's link. */
function resolveLink(state: GtasksSyncState, task: Task): GtasksLink | null {
  const remembered = state.links[task.id];
  if (remembered) return remembered;
  if (task.external.gtasksTaskId !== null && task.external.gtasksListId !== null) {
    return { listId: task.external.gtasksListId, taskId: task.external.gtasksTaskId };
  }
  return null;
}

async function writeBack(deps: GtasksSyncDeps, task: Task, patch: TaskPatch): Promise<Task> {
  try {
    return await deps.tasks.update(task.id, patch, { origin: 'tasks_gtasks' });
  } catch (error) {
    const appError = toAppError(error);
    if (appError.code === 'not_found') {
      // Deleted while the push was running; its delete is queued and removes the copy next.
      log.info('Task deleted during a Google Tasks push', { taskId: task.id });
      return task;
    }
    throw appError;
  }
}

async function rememberLink(deps: GtasksSyncDeps, taskId: string, link: GtasksLink | null, hash: string | null): Promise<void> {
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
export async function deleteGtasksCopy(deps: GtasksSyncDeps, link: GtasksLink): Promise<void> {
  try {
    await deps.api.deleteTask(link.listId, link.taskId);
  } catch (error) {
    const status = googleTasksHttpStatus(error);
    if (status !== 404 && status !== 410) throw error;
  }
  await deps.state.update((current) => {
    const hashes = { ...current.hashes };
    delete hashes[link.taskId];
    const links: Record<string, GtasksLink> = {};
    for (const [taskId, item] of Object.entries(current.links)) {
      if (item.taskId !== link.taskId) links[taskId] = item;
    }
    return { ...current, hashes, links };
  });
}

/** Insert, patch, or move (delete + insert) one task's copy in Google Tasks. */
export async function pushGtasksTask(deps: GtasksSyncDeps, task: Task): Promise<GtasksPushOutcome> {
  const state = await deps.state.load();
  let link = resolveLink(state, task);
  // A copy this device knows of counts as the link of a document that lost it (an older build
  // rewrote it): its changes, a completion included, are sent to that copy.
  const known = link !== null && task.external.gtasksTaskId === null ? { ...task, external: { ...task.external, gtasksTaskId: link.taskId } } : task;
  if (!isGtasksPushable(known)) return { task, sent: false };
  // The task's own list. A document without one may still have a copy this device knows of:
  // that copy stays where it is and is patched there, never duplicated or moved. Only a task
  // without either goes to the default list.
  let targetList = task.external.gtasksListId ?? link?.listId ?? (await deps.defaultList())?.id ?? null;
  if (targetList === null) return { task, sent: false, listMissing: true };

  const hash = taskGtasksVisibleHash(task);
  const body = taskToGtasksWrite(task);

  if (link !== null && link.listId !== targetList) {
    // The API cannot move a task between lists: re-create it in the new list.
    await deleteGtasksCopy(deps, link);
    link = null;
  }

  if (link !== null) {
    if (state.hashes[link.taskId] === hash && task.external.gtasksTaskId === link.taskId && task.external.gtasksListId === link.listId) {
      return { task, sent: false };
    }
    try {
      const patched = await deps.api.patchTask(link.listId, link.taskId, body);
      const next = await writeBack(deps, task, {
        external: { gtasksListId: link.listId, gtasksTaskId: patched.id, gtasksUpdatedAt: gtasksUpdatedIso(patched) },
      });
      await rememberLink(deps, task.id, { listId: link.listId, taskId: patched.id }, hash);
      return { task: next, sent: true };
    } catch (error) {
      const status = googleTasksHttpStatus(error);
      if (status !== 404 && status !== 410) throw error;
      // The copy is gone (deleted in Google before the pull noticed): a task that still exists
      // here is re-created, like any new task. Without a list of its own that is the default
      // list, not the list the copy was in (it may be gone too); with no default list it waits.
      await rememberLink(deps, task.id, null, null);
      link = null;
      if (task.external.gtasksListId === null) {
        targetList = (await deps.defaultList())?.id ?? null;
        if (targetList === null) return { task, sent: false, listMissing: true };
      }
    }
  }

  const created = await deps.api.createTask(targetList, body);
  const next = await writeBack(deps, task, {
    external: { gtasksListId: targetList, gtasksTaskId: created.id, gtasksUpdatedAt: gtasksUpdatedIso(created) },
  });
  await rememberLink(deps, task.id, { listId: targetList, taskId: created.id }, hash);
  return { task: next, sent: true };
}

// ---------------------------------------------------------------------------------------------
// Pending pushes (persisted queue)
// ---------------------------------------------------------------------------------------------

let queueSequence = 0;

export interface GtasksQueueItem {
  id: string;
  op: PendingGtasksPush['op'];
  /** For deletes: the copy to remove (from the tasks:changed event); null when unknown. */
  link?: GtasksLink | null;
}

/** Queues local changes for Google Tasks (persisted, so they survive restarts and offline periods). */
export async function enqueueGtasksPushes(deps: Pick<GtasksSyncDeps, 'state' | 'now'>, items: readonly GtasksQueueItem[]): Promise<void> {
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

export interface GtasksFlushResult {
  pushed: number;
  failed: number;
  /** Still queued after this flush. */
  pending: number;
  /** Set when a connection/auth problem stopped the flush (everything stays queued). */
  blockedBy: AppErrorCode | null;
}

async function settle(deps: GtasksSyncDeps, taskId: string, queuedAt: string, next: PendingGtasksPush | null): Promise<void> {
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

/** The same deps, with the list new tasks go to read once (a failed read is not kept). */
function withListReadOnce(deps: GtasksSyncDeps): GtasksSyncDeps {
  let read: Promise<{ id: string; name: string } | null> | null = null;
  return {
    ...deps,
    defaultList() {
      if (read !== null) return read;
      const current = deps.defaultList();
      read = current;
      void current.catch(() => {
        if (read === current) read = null;
      });
      return current;
    },
  };
}

/** Pushes every queued change (oldest first). */
export async function flushGtasksPushes(deps: GtasksSyncDeps): Promise<GtasksFlushResult> {
  const state = await deps.state.load();
  const entries = Object.entries(state.pending).sort(([, a], [, b]) => a.queuedAt.localeCompare(b.queuedAt));
  const result: GtasksFlushResult = { pushed: 0, failed: 0, pending: 0, blockedBy: null };
  if (entries.length === 0) return result;

  const locals = await deps.tasks.list();
  const byId = new Map(locals.map((task) => [task.id, task]));
  // Read once per flush: the entries that wait for a list cost no extra reads on every flush.
  const pushDeps = withListReadOnce(deps);

  for (const [taskId, entry] of entries) {
    const task = byId.get(taskId);
    try {
      if (task) {
        const outcome = await pushGtasksTask(pushDeps, task);
        // No list to send it to yet: the entry stays as it is (counted in `pending`) and the next
        // flush after a list is chosen sends it. The other entries go on.
        if (outcome.listMissing === true) continue;
        if (outcome.sent) result.pushed += 1;
      } else {
        const link = entry.link ?? state.links[taskId] ?? null;
        if (link) {
          await deleteGtasksCopy(deps, link);
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
      // A 403 is retried like a transient error and dropped after GTASKS_MAX_PUSH_ATTEMPTS; it
      // never blocks the other tasks or the pull.
      if ((appError.retryable || appError.code === 'permission_denied') && attempts < GTASKS_MAX_PUSH_ATTEMPTS) {
        await settle(deps, taskId, entry.queuedAt, { ...entry, attempts, lastError: appError.code });
      } else {
        result.failed += 1;
        log.warn('Dropping a change Google Tasks rejected', { taskId, code: appError.code, status: googleTasksHttpStatus(appError) });
        await settle(deps, taskId, entry.queuedAt, null);
      }
    }
  }
  const after = await deps.state.load();
  result.pending = Object.keys(after.pending).length;
  return result;
}

/**
 * Queues every open task whose document has no Google copy yet (first enable, list chosen, list
 * first remembered after an upgrade). The push patches a copy this device knows of.
 */
export async function enqueueUnlinkedOpenTasksForGtasks(deps: Pick<GtasksSyncDeps, 'tasks' | 'state' | 'now'>): Promise<number> {
  const tasks = await deps.tasks.list();
  const items: GtasksQueueItem[] = tasks
    .filter((task) => task.source !== 'gtasks' && task.status === 'open' && task.external.gtasksTaskId === null)
    .map((task) => ({ id: task.id, op: 'upsert' as const }));
  await enqueueGtasksPushes(deps, items);
  return items.length;
}

/**
 * Disable cleanup: tasks imported from Google are deleted here (their copies stay in Google) and
 * our own tasks forget their links (a later enable pushes them again as new Google tasks).
 */
export async function removeGtasksLinks(deps: GtasksSyncDeps): Promise<{ removed: number; unlinked: number }> {
  const tasks = await deps.tasks.list();
  let removed = 0;
  let unlinked = 0;
  for (const task of tasks) {
    if (task.source === 'gtasks') {
      await removeLocal(deps, task.id);
      removed += 1;
      continue;
    }
    if (task.external.gtasksTaskId === null && task.external.gtasksListId === null) continue;
    await deps.tasks.update(task.id, { external: { gtasksListId: null, gtasksTaskId: null, gtasksUpdatedAt: null } }, { origin: 'tasks_gtasks' });
    unlinked += 1;
  }
  return { removed, unlinked };
}
