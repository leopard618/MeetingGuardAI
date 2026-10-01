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
 * - Sharing opens the mail composer (email) or the OS share sheet; the result names what was
 *   actually opened, it never claims the message was sent.
 * - Never throws: failures resolve `{ status: 'failed', error: AppError }`. A dismissed share
 *   sheet resolves failed with code 'cancelled' (not recorded, so it can run again).
 */
import type { AiAction, AiMeetingChanges, BulkUpdateAction, ConferenceDetails, UpdateMeetingAction } from '../../core/aiContract';
import type { ActionExecutor, ActionWarning, MeetingRecurrenceOps } from '../../core/contracts';
import { AppError, toAppError, type AppErrorCode } from '../../core/errors';
import { createLogger } from '../../core/logger';
import type { Meeting, MeetingPatch } from '../../core/types';

import { actionIdempotencyKey, aiMeetingIdForAction } from './ids';
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

export interface ActionExecutorDeps {
  meetings: MeetingsPort;
  calendar: CalendarLinkPort;
  sharing: ShareAdapter;
  executed: ExecutedStore;
  getUid(): string | null;
  /** Formatter in the current UI language (share text). */
  getFormatter(): AssistantFormatter;
  now?: () => Date;
}

export interface AiActionExecutor extends ActionExecutor {
  preview(action: AiAction): Promise<AiActionPreview>;
  execute(action: AiAction): Promise<AiActionResult>;
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
  }
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

  async function preview(action: AiAction): Promise<AiActionPreview> {
    const { found, missing } = await loadReferenced(referencedMeetingIds(action));
    const warnings: ActionWarning[] = [];
    if (missing.length > 0) warnings.push('meeting_not_found');
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
        break;
    }
    if (overlapping.length > 0) warnings.push('overlaps_existing');
    if (newPeople.length > 0) warnings.push('new_people');
    return {
      action,
      meetings: found,
      missingMeetingIds: missing,
      warnings,
      overlapping,
      calendarConnected: calendar.connected,
      newPeople,
    };
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
      return result;
    }
    const updated = await deps.meetings.update(current.id, changesToPatch(action.changes, current), { origin: 'ai' });
    const result: AiDoneResult = { status: 'done', actionId: action.id, type: action.type, meetingIds: [updated.id], duplicate: false };
    if (wantsMeetLink(action.changes.conference) && !updated.conference?.url) {
      const link = await ensureMeetLink(updated);
      result.meetLinkCreated = link.created;
      result.meetLinkError = link.error;
    }
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
      // occurrence's start; a split at the first occurrence removes the whole series (null).
      await recurrenceOps(deps.meetings).deleteFollowing(current.id, followingDate, { origin: 'ai' });
      return { status: 'done', actionId: action.id, type: action.type, meetingIds: [current.id], duplicate: false };
    }
    await deps.meetings.remove(current.id, { origin: 'ai' });
    return { status: 'done', actionId: action.id, type: action.type, meetingIds: [current.id], duplicate: false };
  }

  async function runBulk(uid: string, key: string, action: BulkUpdateAction): Promise<AiDoneResult> {
    const alreadyDone = new Set(await deps.executed.getProgress(uid, key));
    const updatedIds: string[] = [...alreadyDone];
    const skipped: string[] = [];
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
      const updated = await deps.meetings.update(id, patch, { origin: 'ai' });
      updatedIds.push(id);
      await deps.executed.markProgress(uid, key, id);
      if (action.changes && wantsMeetLink(action.changes.conference) && !updated.conference?.url) {
        meetRequested += 1;
        const link = await ensureMeetLink(updated);
        if (link.created) meetCreated += 1;
        else meetError = meetError ?? link.error;
      }
    }

    if (updatedIds.length === 0) {
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

  async function run(action: AiAction, key: string): Promise<AiActionResult> {
    if (action.type === 'list') return runList(action);

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
    }
    if (result.status === 'done') await deps.executed.markDone(uid, key, result);
    return result;
  }

  return {
    preview,
    execute(action: AiAction): Promise<AiActionResult> {
      const key = actionIdempotencyKey(action);
      const running = inFlight.get(key);
      if (running) return running;
      const promise = run(action, key)
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
