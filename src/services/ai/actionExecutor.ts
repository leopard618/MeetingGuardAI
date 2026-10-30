/**
 * Executes assistant actions the user CONFIRMED (the assistant itself never changes data).
 *
 * - Writes go through the meeting repository with origin 'ai' (calendar sync pushes them).
 * - Idempotent per action: `actionIdempotencyKey(action)` is recorded after success; running the
 *   same action again resolves `{ status: 'done', duplicate: true }` without side effects.
 *   Concurrent calls for the same action share one execution (double taps).
 *   create_meeting uses a deterministic meeting id (WriteOptions.id), bulk_update records
 *   per-meeting progress, so retries after a partial failure never apply a change twice.
 * - Google Meet: a conference { provider 'google_meet', url null } is turned into a real link
 *   through Google Calendar when it is connected; otherwise the meeting keeps "no link yet" and
 *   the result says so (meetLinkCreated false) - a link is never invented.
 * - Zoom (§24): after a confirmed create/update whose meeting ends up { provider 'zoom', url
 *   null } and the server integration is configured, the zoom port's ensureLink creates the real
 *   link server-side (fire-and-forget: the details card reports pending/failed); edits sync the
 *   existing Zoom meeting (syncIfNeeded) and a full delete removes it (onMeetingDeleted).
 * - Sharing opens the mail composer (email) or the OS share sheet; the result names what was
 *   actually opened, it never claims the message was sent.
 * - Never throws: failures resolve `{ status: 'failed', error: AppError }`. A dismissed share
 *   sheet resolves failed with code 'cancelled' (not recorded, so it can run again).
 */
import type {
  AiAction,
  AiMeetingChanges,
  AiTaskChanges,
  AiTaskDraft,
  BulkUpdateAction,
  ConferenceDetails,
  UpdateMeetingAction,
} from '../../core/aiContract';
import type {
  ActionExecutionContext,
  ActionExecutor,
  ActionWarning,
  MeetingRecurrenceOps,
  TasksRepository,
} from '../../core/contracts';
import { AppError, toAppError, type AppErrorCode } from '../../core/errors';
import { createLogger } from '../../core/logger';
import type { Meeting, MeetingPatch, Task, TaskInput, TaskPatch } from '../../core/types';

import { actionIdempotencyKey, aiMeetingIdForAction, aiTaskIdForAction } from './ids';
import {
  changesToPatch,
  draftToCreateInput,
  findOverlaps,
  isInPast,
  occurrencePatchOf,
  shiftedStartAt,
  wantsMeetLink,
  windowAfterChanges,
  windowOfDraft,
  type TimeWindow,
} from './mapping';
import { buildMailtoUrl, buildShareContent } from './presentation';
import type {
  AiActionPreview,
  AiActionResult,
  AiDoneResult,
  AssistantFormatter,
  CalendarLinkPort,
  ExecutedStore,
  MeetingsPort,
  ShareAdapter,
} from './types';

const log = createLogger('ai.executor');

/** How far around a proposed time existing meetings are loaded for the overlap check. */
const OVERLAP_MARGIN_MS = 24 * 60 * 60 * 1000;

/**
 * §24 surface of ZoomService the executor uses (src/services/zoom). All methods follow the
 * contract: isAvailable/syncIfNeeded/onMeetingDeleted never throw; ensureLink's failure is
 * remembered by the service for the details card (linkFailure), so the executor only swallows it.
 */
export interface ZoomPort {
  isAvailable(): Promise<boolean>;
  ensureLink(meetingId: string): Promise<unknown>;
  syncIfNeeded(meeting: Meeting, patch: MeetingPatch): Promise<void>;
  onMeetingDeleted(meeting: Pick<Meeting, 'id' | 'external'>): Promise<void>;
}

export interface ActionExecutorDeps {
  meetings: MeetingsPort;
  /** v5 task actions. Absent in older wirings/tests: task actions then fail honestly. */
  tasks?: Pick<TasksRepository, 'get' | 'create' | 'update' | 'remove'>;
  /** M7: the Microsoft To Do list new tasks go to (null = sync off), named on the confirm card. */
  todoDestination?: () => { name: string } | null;
  calendar: CalendarLinkPort;
  sharing: ShareAdapter;
  executed: ExecutedStore;
  /** Absent in builds/tests without the zoom area: provider-zoom writes then skip the hooks. */
  zoom?: ZoomPort;
  getUid(): string | null;
  /** Formatter in the current UI language (share text). */
  getFormatter(): AssistantFormatter;
  now?: () => Date;
}

export interface AiActionExecutor extends ActionExecutor {
  preview(action: AiAction): Promise<AiActionPreview>;
  execute(action: AiAction, context?: ActionExecutionContext): Promise<AiActionResult>;
}

function referencedMeetingIds(action: AiAction): string[] {
  switch (action.type) {
    case 'create_meeting':
      return [];
    case 'update_meeting':
    case 'delete_meeting':
    case 'share_meeting':
      return [action.meetingId];
    case 'bulk_update':
    case 'list':
      return [...new Set(action.meetingIds)];
    // Task actions reference a meeting only through the (new) link, so the card can show it.
    case 'create_task':
      return action.task.meetingId !== null ? [action.task.meetingId] : [];
    case 'update_task':
      return action.changes.meetingId != null ? [action.changes.meetingId] : [];
    case 'delete_task':
    case 'list_tasks':
      return [];
  }
}

function referencedTaskIds(action: AiAction): string[] {
  switch (action.type) {
    case 'update_task':
    case 'delete_task':
      return [action.taskId];
    case 'list_tasks':
      return [...new Set(action.taskIds)];
    default:
      return [];
  }
}

/**
 * `linkedMeetingId` is the caller's resolution of the draft's v6 `meetingActionId` (the meeting
 * the sibling create_meeting just produced). It only ever fills a link the draft left null.
 */
function taskDraftToInput(draft: AiTaskDraft, linkedMeetingId?: string | null): TaskInput {
  return {
    title: draft.title,
    description: draft.description,
    dueDate: draft.dueDate,
    dueTime: draft.dueTime,
    reminderMinutesBefore: draft.reminderMinutesBefore,
    meetingId: draft.meetingId ?? linkedMeetingId ?? null,
    people: draft.people.map((person) => ({ name: person.name, email: person.email })),
  };
}

function taskChangesToPatch(changes: AiTaskChanges): TaskPatch {
  const patch: TaskPatch = {};
  if (changes.title !== undefined) patch.title = changes.title;
  if (changes.description !== undefined) patch.description = changes.description;
  if (changes.dueDate !== undefined) patch.dueDate = changes.dueDate;
  if (changes.dueTime !== undefined) patch.dueTime = changes.dueTime;
  if (changes.reminderMinutesBefore !== undefined) patch.reminderMinutesBefore = changes.reminderMinutesBefore;
  if (changes.meetingId !== undefined) patch.meetingId = changes.meetingId;
  if (changes.people !== undefined) patch.people = changes.people.map((person) => ({ name: person.name, email: person.email }));
  if (changes.status !== undefined) patch.status = changes.status;
  return patch;
}

function isActive(meeting: Meeting | null): meeting is Meeting {
  return meeting !== null && meeting.deletedAt === null;
}

function failed(action: AiAction, error: AppError): AiActionResult {
  return { status: 'failed', actionId: action.id, type: action.type, error };
}

function changesTouchTime(changes: AiMeetingChanges | null): boolean {
  return !!changes && (changes.startAt !== undefined || changes.durationMinutes !== undefined || changes.allDay !== undefined);
}

/**
 * v2 scope: an action targets one occurrence only when it says so AND the meeting really recurs
 * (on a one-off meeting the scope is ignored, as the contract requires).
 */
function occurrenceTarget(
  action: Pick<UpdateMeetingAction, 'scope' | 'occurrenceDate'>,
  meeting: Meeting | null | undefined,
): string | null {
  if (action.scope !== 'occurrence' || action.occurrenceDate == null) return null;
  return meeting && meeting.recurrence !== null ? action.occurrenceDate : null;
}

/**
 * v3 scope: an action targets "this and the following occurrences" only when it says so AND the
 * meeting really recurs (on a one-off the scope is ignored, exactly like 'occurrence').
 */
function followingTarget(
  action: Pick<UpdateMeetingAction, 'scope' | 'occurrenceDate'>,
  meeting: Meeting | null | undefined,
): string | null {
  if (action.scope !== 'following' || action.occurrenceDate == null) return null;
  return meeting && meeting.recurrence !== null ? action.occurrenceDate : null;
}

/** The recurrence ops (rec-core lands them on meetingRepository in the same release as this code). */
function recurrenceOps(meetings: ActionExecutorDeps['meetings']): MeetingRecurrenceOps {
  const { updateOccurrence, cancelOccurrence, restoreOccurrence } = meetings;
  if (!updateOccurrence || !cancelOccurrence || !restoreOccurrence) {
    throw new AppError('not_implemented', 'Recurring-meeting operations are not available');
  }
  const { editFollowing, deleteFollowing } = meetings;
  return {
    updateOccurrence: updateOccurrence.bind(meetings),
    cancelOccurrence: cancelOccurrence.bind(meetings),
    restoreOccurrence: restoreOccurrence.bind(meetings),
    // 'following' ops land with the same release train (§16); an older repository without them
    // fails honestly instead of silently editing the whole series.
    editFollowing: editFollowing
      ? editFollowing.bind(meetings)
      : () => Promise.reject(new AppError('not_implemented', '"This and following" operations are not available')),
    deleteFollowing: deleteFollowing
      ? deleteFollowing.bind(meetings)
      : () => Promise.reject(new AppError('not_implemented', '"This and following" operations are not available')),
  };
}

export function createActionExecutor(deps: ActionExecutorDeps): AiActionExecutor {
  const now = deps.now ?? (() => new Date());
  const inFlight = new Map<string, Promise<AiActionResult>>();

  async function loadReferenced(ids: readonly string[]): Promise<{ found: Meeting[]; missing: string[] }> {
    const found: Meeting[] = [];
    const missing: string[] = [];
    for (const id of ids) {
      const meeting = await deps.meetings.get(id);
      if (isActive(meeting)) found.push(meeting);
      else missing.push(id);
    }
    return { found, missing };
  }

  async function overlapsFor(windows: readonly TimeWindow[], excludeIds: readonly string[]): Promise<Meeting[]> {
    const timed = windows.filter((w) => !w.allDay);
    if (timed.length === 0) return [];
    const starts = timed.map((w) => new Date(w.startAt).getTime());
    const ends = timed.map((w) => new Date(w.startAt).getTime() + w.durationMinutes * 60_000);
    const existing = await deps.meetings.list({
      from: new Date(Math.min(...starts) - OVERLAP_MARGIN_MS).toISOString(),
      to: new Date(Math.max(...ends) + OVERLAP_MARGIN_MS).toISOString(),
      includeCancelled: false,
    });
    const byId = new Map<string, Meeting>();
    for (const window of timed) {
      for (const meeting of findOverlaps(window, existing, excludeIds)) byId.set(meeting.id, meeting);
    }
    return [...byId.values()];
  }

  async function calendarConnected(): Promise<boolean> {
    try {
      return await deps.calendar.isConnected();
    } catch (error) {
      log.warn('could not read the Google Calendar connection state', toAppError(error).code);
      return false;
    }
  }

  /** Addresses that are not participants of `meeting` yet (all of them when it is unknown). */
  function notYetOn(meeting: Meeting | undefined, emails: readonly string[]): string[] {
    const known = new Set((meeting?.participants ?? []).map((participant) => participant.email.trim().toLowerCase()));
    return [...new Set(emails.map((email) => email.trim().toLowerCase()))].filter((email) => !known.has(email));
  }

  async function loadReferencedTasks(ids: readonly string[]): Promise<{ foundTasks: Task[]; missingTasks: string[] }> {
    const foundTasks: Task[] = [];
    const missingTasks: string[] = [];
    for (const id of ids) {
      let task: Task | null = null;
      if (deps.tasks) {
        try {
          task = await deps.tasks.get(id);
        } catch {
          task = null;
        }
      }
      if (task) foundTasks.push(task);
      else missingTasks.push(id);
    }
    return { foundTasks, missingTasks };
  }

  async function preview(action: AiAction): Promise<AiActionPreview> {
    const { found, missing } = await loadReferenced(referencedMeetingIds(action));
    const { foundTasks, missingTasks } = await loadReferencedTasks(referencedTaskIds(action));
    const warnings: ActionWarning[] = [];
    if (missing.length > 0) warnings.push('meeting_not_found');
    if (missingTasks.length > 0) warnings.push('task_not_found');
    let overlapping: Meeting[] = [];
    let newPeople: string[] = [];
    const calendar: { connected: boolean | null } = { connected: null };
    const at = now();

    const checkMeet = async (conference: ConferenceDetails | null | undefined): Promise<void> => {
      if (!wantsMeetLink(conference)) return;
      calendar.connected = await calendarConnected();
      if (!calendar.connected) warnings.push('google_meet_needs_calendar');
    };

    switch (action.type) {
      case 'create_meeting': {
        const window = windowOfDraft(action.meeting);
        if (isInPast(window, at)) warnings.push('start_in_past');
        overlapping = await overlapsFor([window], []);
        await checkMeet(action.meeting.conference);
        break;
      }
      case 'update_meeting': {
        const meeting = found[0];
        if (action.changes.participants) {
          newPeople = notYetOn(meeting, action.changes.participants.map((participant) => participant.email));
        }
        if (meeting && (occurrenceTarget(action, meeting) !== null || followingTarget(action, meeting) !== null)) {
          // One occurrence (or the tail's first occurrence for scope 'following'): check the
          // moved occurrence's own window (only a start change moves it).
          if (action.changes.startAt !== undefined) {
            const window: TimeWindow = {
              startAt: new Date(action.changes.startAt).toISOString(),
              durationMinutes: action.changes.durationMinutes ?? meeting.durationMinutes,
              allDay: false,
            };
            if (isInPast(window, at)) warnings.push('start_in_past');
            overlapping = await overlapsFor([window], [meeting.id]);
          }
        } else if (meeting && changesTouchTime(action.changes)) {
          const window = windowAfterChanges(meeting, action.changes);
          if (isInPast(window, at)) warnings.push('start_in_past');
          overlapping = await overlapsFor([window], [meeting.id]);
        }
        await checkMeet(action.changes.conference);
        break;
      }
      case 'bulk_update': {
        const windows: TimeWindow[] = [];
        for (const meeting of found) {
          const startAt = action.shiftMinutes !== null ? shiftedStartAt(meeting, action.shiftMinutes) : meeting.startAt;
          if (startAt === null) continue;
          windows.push(windowAfterChanges({ ...meeting, startAt }, action.changes));
        }
        if (action.shiftMinutes !== null || changesTouchTime(action.changes)) {
          if (windows.some((w) => isInPast(w, at))) warnings.push('start_in_past');
          overlapping = await overlapsFor(windows, found.map((m) => m.id));
        }
        await checkMeet(action.changes?.conference);
        break;
      }
      case 'share_meeting':
        if (action.channel === 'email' && action.recipients.length === 0) warnings.push('no_recipients');
        if (action.channel === 'email') newPeople = notYetOn(found[0], action.recipients);
        break;
      case 'delete_meeting':
      case 'list':
      case 'create_task':
      case 'update_task':
      case 'delete_task':
      case 'list_tasks':
        break;
    }
    if (overlapping.length > 0) warnings.push('overlaps_existing');
    if (newPeople.length > 0) warnings.push('new_people');
    return {
      action,
      meetings: found,
      missingMeetingIds: missing,
      tasks: foundTasks,
      missingTaskIds: missingTasks,
      warnings,
      overlapping,
      calendarConnected: calendar.connected,
      newPeople,
      todoListName: action.type === 'create_task' ? (deps.todoDestination?.()?.name ?? null) : null,
    };
  }

  /**
   * §24 hooks after a confirmed write (fire-and-forget; never changes the action result):
   * a provider-zoom meeting without a url gets its server-created link (only when the server
   * said the integration is configured), and an edit that touched title/start/duration/zone
   * patches the existing Zoom meeting (syncIfNeeded no-ops without an external.zoomMeetingId).
   */
  async function runZoomHooks(meeting: Meeting, patch: MeetingPatch | null): Promise<void> {
    const zoom = deps.zoom;
    if (!zoom) return;
    if (meeting.conference?.provider === 'zoom' && meeting.conference.url === null && (await zoom.isAvailable())) {
      await Promise.resolve(zoom.ensureLink(meeting.id)).catch((error: unknown) => {
        // The zoom service records the failure for the details card; only the code is logged.
        log.warn('zoom link creation failed after an assistant action', { meetingId: meeting.id, code: toAppError(error).code });
      });
    }
    if (patch !== null) await zoom.syncIfNeeded(meeting, patch);
  }

  /** Detached runner so a zoom hook can never delay or fail the confirmed action. */
  function zoomHooks(meeting: Meeting, patch: MeetingPatch | null): void {
    void runZoomHooks(meeting, patch).catch((error: unknown) => {
      log.warn('zoom hooks failed', { meetingId: meeting.id, code: toAppError(error).code });
    });
  }

  /** Creates the requested Meet link; never throws. */
  async function ensureMeetLink(meeting: Meeting): Promise<{ created: boolean; error: AppErrorCode | null }> {
    if (!(await calendarConnected())) return { created: false, error: 'calendar_not_connected' };
    try {
      const conference = await deps.calendar.createMeetLink(meeting.id);
      return conference.url ? { created: true, error: null } : { created: false, error: 'upstream_error' };
    } catch (error) {
      const appError = toAppError(error, 'upstream_error');
      log.warn('Google Meet link creation failed', { meetingId: meeting.id, code: appError.code });
      return { created: false, error: appError.code };
    }
  }

  async function runCreate(action: Extract<AiAction, { type: 'create_meeting' }>): Promise<AiDoneResult> {
    const meeting = await deps.meetings.create(draftToCreateInput(action.meeting, action.confidence), {
      origin: 'ai',
      id: aiMeetingIdForAction(action),
    });
    const result: AiDoneResult = { status: 'done', actionId: action.id, type: action.type, meetingIds: [meeting.id], duplicate: false };
    if (wantsMeetLink(action.meeting.conference) && !meeting.conference?.url) {
      const link = await ensureMeetLink(meeting);
      result.meetLinkCreated = link.created;
      result.meetLinkError = link.error;
    }
    zoomHooks(meeting, null);
    return result;
  }

  async function runUpdate(action: Extract<AiAction, { type: 'update_meeting' }>): Promise<AiDoneResult> {
    const current = await deps.meetings.get(action.meetingId);
    if (!isActive(current)) throw new AppError('not_found', 'Meeting not found', { details: { meetingId: action.meetingId } });
    const occurrenceDate = occurrenceTarget(action, current);
    if (occurrenceDate !== null) {
      // "This occurrence only": a modified override on the master (never a new document).
      const updated = await recurrenceOps(deps.meetings).updateOccurrence(
        current.id,
        occurrenceDate,
        occurrencePatchOf(action.changes),
        { origin: 'ai' },
      );
      return { status: 'done', actionId: action.id, type: action.type, meetingIds: [updated.id], duplicate: false };
    }
    const followingDate = followingTarget(action, current);
    if (followingDate !== null) {
      // "This and following": the series is split; the FULL patch lands on the new tail master
      // (contract v3). A split at the first occurrence collapses to a series update (created null).
      const { master, created } = await recurrenceOps(deps.meetings).editFollowing(
        current.id,
        followingDate,
        changesToPatch(action.changes, current),
        { origin: 'ai' },
      );
      const target = created ?? master;
      const result: AiDoneResult = {
        status: 'done',
        actionId: action.id,
        type: action.type,
        meetingIds: created !== null ? [master.id, created.id] : [master.id],
        duplicate: false,
      };
      if (wantsMeetLink(action.changes.conference) && !target.conference?.url) {
        const link = await ensureMeetLink(target);
        result.meetLinkCreated = link.created;
        result.meetLinkError = link.error;
      }
      // The new tail is a fresh document (no external refs copied over), so it behaves like a
      // create; the truncated master only changed its recurrence (nothing Zoom displays).
      zoomHooks(target, null);
      return result;
    }
    const patch = changesToPatch(action.changes, current);
    const updated = await deps.meetings.update(current.id, patch, { origin: 'ai' });
    const result: AiDoneResult = { status: 'done', actionId: action.id, type: action.type, meetingIds: [updated.id], duplicate: false };
    if (wantsMeetLink(action.changes.conference) && !updated.conference?.url) {
      const link = await ensureMeetLink(updated);
      result.meetLinkCreated = link.created;
      result.meetLinkError = link.error;
    }
    zoomHooks(updated, patch);
    return result;
  }

  async function runDelete(action: Extract<AiAction, { type: 'delete_meeting' }>): Promise<AiDoneResult> {
    const current = await deps.meetings.get(action.meetingId);
    if (!isActive(current)) throw new AppError('not_found', 'Meeting not found', { details: { meetingId: action.meetingId } });
    const occurrenceDate = occurrenceTarget(action, current);
    if (occurrenceDate !== null) {
      // "Delete only this occurrence": a cancelled override; the series stays.
      await recurrenceOps(deps.meetings).cancelOccurrence(current.id, occurrenceDate, { origin: 'ai' });
      return { status: 'done', actionId: action.id, type: action.type, meetingIds: [current.id], duplicate: false };
    }
    const followingDate = followingTarget(action, current);
    if (followingDate !== null) {
      // "Delete this and following": the series is truncated the second before the split
      // occurrence's start; a split at the FIRST occurrence removes the whole series (resolves
      // null) - the server-created Zoom meeting then goes too, like the plain remove below
      // (§24; a real truncation keeps the series and its reusable link alive).
      const remaining = await recurrenceOps(deps.meetings).deleteFollowing(current.id, followingDate, { origin: 'ai' });
      if (remaining === null && deps.zoom) void deps.zoom.onMeetingDeleted(current);
      return { status: 'done', actionId: action.id, type: action.type, meetingIds: [current.id], duplicate: false };
    }
    await deps.meetings.remove(current.id, { origin: 'ai' });
    // §24: the whole meeting is gone, so the server-created Zoom meeting goes too (best effort;
    // the occurrence scope above keeps the series - and its reusable link - alive).
    if (deps.zoom) void deps.zoom.onMeetingDeleted(current);
    return { status: 'done', actionId: action.id, type: action.type, meetingIds: [current.id], duplicate: false };
  }

  async function runBulk(uid: string, key: string, action: BulkUpdateAction): Promise<AiDoneResult> {
    const alreadyDone = new Set(await deps.executed.getProgress(uid, key));
    const updatedIds: string[] = [...alreadyDone];
    const skipped: string[] = [];
    const failures: AppError[] = [];
    let meetRequested = 0;
    let meetCreated = 0;
    let meetError: AppErrorCode | null = null;

    for (const id of [...new Set(action.meetingIds)]) {
      if (alreadyDone.has(id)) continue;
      const current = await deps.meetings.get(id);
      if (!isActive(current)) {
        skipped.push(id);
        continue;
      }
      const patch: MeetingPatch = action.changes ? changesToPatch(action.changes, current) : {};
      if (action.shiftMinutes !== null) {
        const startAt = shiftedStartAt(current, action.shiftMinutes);
        if (startAt === null) {
          skipped.push(id);
          continue;
        }
        patch.startAt = startAt;
      }
      let updated: Meeting;
      try {
        updated = await deps.meetings.update(id, patch, { origin: 'ai' });
      } catch (error) {
        // One meeting failing must not hide the ones already moved: the card reports it as
        // skipped and the rest go on (a retry is idempotent through the progress record).
        const appError = toAppError(error);
        // Offline or a flaky server: nothing after this one would succeed either, so the whole
        // action fails and a later retry resumes from the progress record.
        if (appError.retryable) throw appError;
        log.warn('bulk update: one meeting failed', { meetingId: id, code: appError.code });
        failures.push(appError);
        skipped.push(id);
        continue;
      }
      updatedIds.push(id);
      await deps.executed.markProgress(uid, key, id);
      zoomHooks(updated, patch);
      if (action.changes && wantsMeetLink(action.changes.conference) && !updated.conference?.url) {
        meetRequested += 1;
        const link = await ensureMeetLink(updated);
        if (link.created) meetCreated += 1;
        else meetError = meetError ?? link.error;
      }
    }

    if (updatedIds.length === 0) {
      const first = failures[0];
      if (first !== undefined) throw first;
      throw new AppError('not_found', 'None of the meetings could be updated', { details: { skipped: skipped.length } });
    }
    const result: AiDoneResult = { status: 'done', actionId: action.id, type: action.type, meetingIds: updatedIds, duplicate: false };
    if (skipped.length > 0) result.skippedMeetingIds = skipped;
    if (meetRequested > 0) {
      result.meetLinkCreated = meetCreated === meetRequested;
      result.meetLinkError = meetError;
    }
    return result;
  }

  async function runShare(action: Extract<AiAction, { type: 'share_meeting' }>): Promise<AiActionResult> {
    const meeting = await deps.meetings.get(action.meetingId);
    if (!isActive(meeting)) throw new AppError('not_found', 'Meeting not found', { details: { meetingId: action.meetingId } });
    const fmt = deps.getFormatter();
    const base = { status: 'done' as const, actionId: action.id, type: action.type, meetingIds: [meeting.id], duplicate: false };

    if (action.channel === 'email' && action.recipients.length > 0) {
      const content = buildShareContent(fmt, meeting, { message: action.message });
      try {
        await deps.sharing.openMailComposer(buildMailtoUrl(action.recipients, content));
        return { ...base, delivery: 'mail_composer', recipients: [...action.recipients] };
      } catch (error) {
        log.warn('no mail app available; falling back to the share sheet', toAppError(error).code);
      }
      // No mail app: the share sheet with the recipients listed in the text.
      const withRecipients = buildShareContent(fmt, meeting, { message: action.message, recipients: action.recipients });
      const outcome = await deps.sharing.shareText({ title: withRecipients.subject, message: withRecipients.body });
      if (outcome === 'dismissed') return failed(action, new AppError('cancelled', 'Share sheet dismissed'));
      return { ...base, delivery: 'system_share', recipients: [...action.recipients] };
    }

    const content = buildShareContent(fmt, meeting, { message: action.message });
    const outcome = await deps.sharing.shareText({ title: content.subject, message: content.body });
    if (outcome === 'dismissed') return failed(action, new AppError('cancelled', 'Share sheet dismissed'));
    return { ...base, delivery: 'system_share' };
  }

  async function runList(action: Extract<AiAction, { type: 'list' }>): Promise<AiDoneResult> {
    const { found } = await loadReferenced(referencedMeetingIds(action));
    return { status: 'done', actionId: action.id, type: action.type, meetingIds: found.map((m) => m.id), duplicate: false };
  }

  // ---- v5 task actions (users/{uid}/tasks via the tasks repository) --------------------------

  function tasksPort(): NonNullable<ActionExecutorDeps['tasks']> {
    if (!deps.tasks) throw new AppError('not_implemented', 'Task operations are not available');
    return deps.tasks;
  }

  async function runListTasks(action: Extract<AiAction, { type: 'list_tasks' }>): Promise<AiDoneResult> {
    const { foundTasks } = await loadReferencedTasks(referencedTaskIds(action));
    return {
      status: 'done',
      actionId: action.id,
      type: action.type,
      meetingIds: [],
      taskIds: foundTasks.map((task) => task.id),
      duplicate: false,
    };
  }

  async function runCreateTask(
    action: Extract<AiAction, { type: 'create_task' }>,
    linkedMeetingId?: string | null,
  ): Promise<AiDoneResult> {
    const task = await tasksPort().create(taskDraftToInput(action.task, linkedMeetingId), { origin: 'ai', id: aiTaskIdForAction(action) });
    return { status: 'done', actionId: action.id, type: action.type, meetingIds: [], taskIds: [task.id], duplicate: false };
  }

  async function runUpdateTask(action: Extract<AiAction, { type: 'update_task' }>): Promise<AiDoneResult> {
    const current = await tasksPort().get(action.taskId);
    if (!current) throw new AppError('not_found', 'Task not found', { details: { taskId: action.taskId } });
    const updated = await tasksPort().update(current.id, taskChangesToPatch(action.changes));
    const result: AiDoneResult = {
      status: 'done',
      actionId: action.id,
      type: action.type,
      meetingIds: [],
      taskIds: [updated.id],
      duplicate: false,
    };
    if (current.status !== 'done' && updated.status === 'done') result.taskCompleted = true;
    return result;
  }

  async function runDeleteTask(action: Extract<AiAction, { type: 'delete_task' }>): Promise<AiDoneResult> {
    const current = await tasksPort().get(action.taskId);
    if (!current) throw new AppError('not_found', 'Task not found', { details: { taskId: action.taskId } });
    await tasksPort().remove(current.id);
    return { status: 'done', actionId: action.id, type: action.type, meetingIds: [], taskIds: [current.id], duplicate: false };
  }

  async function run(action: AiAction, key: string, context?: ActionExecutionContext): Promise<AiActionResult> {
    if (action.type === 'list') return runList(action);
    if (action.type === 'list_tasks') return runListTasks(action);

    const uid = deps.getUid();
    if (!uid) return failed(action, new AppError('unauthenticated', 'No active session'));

    const previous = await deps.executed.getDone(uid, key);
    if (previous) return { ...previous, duplicate: true };

    let result: AiActionResult;
    switch (action.type) {
      case 'create_meeting':
        result = await runCreate(action);
        break;
      case 'update_meeting':
        result = await runUpdate(action);
        break;
      case 'delete_meeting':
        result = await runDelete(action);
        break;
      case 'bulk_update':
        result = await runBulk(uid, key, action);
        break;
      case 'share_meeting':
        result = await runShare(action);
        break;
      case 'create_task':
        result = await runCreateTask(action, context?.linkedMeetingId);
        break;
      case 'update_task':
        result = await runUpdateTask(action);
        break;
      case 'delete_task':
        result = await runDeleteTask(action);
        break;
    }
    if (result.status === 'done') await deps.executed.markDone(uid, key, result);
    return result;
  }

  return {
    preview,
    execute(action: AiAction, context?: ActionExecutionContext): Promise<AiActionResult> {
      const key = actionIdempotencyKey(action);
      const running = inFlight.get(key);
      if (running) return running;
      const promise = run(action, key, context)
        .catch((error: unknown): AiActionResult => {
          const appError = toAppError(error);
          if (appError.code !== 'not_found' && appError.code !== 'cancelled') {
            log.warn('assistant action failed', { type: action.type, code: appError.code });
          }
          return failed(action, appError);
        })
        .finally(() => {
          inFlight.delete(key);
        });
      inFlight.set(key, promise);
      return promise;
    },
  };
}
