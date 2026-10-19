/**
 * Google Calendar two-way sync algorithms (dependency-injected; unit-tested with fakes).
 *
 * PULL  events.list(singleEvents=true) with the stored syncToken; a full listing bounded by
 *       CALENDAR_SYNC_WINDOW on first sync, every 7 days (the window slides) and on 410 GONE.
 *       Cancelled events tombstone their meeting. Events MeetingGuard created (deterministic
 *       "mgev..." ids) update their own meeting instead of creating a copy.
 * PUSH  insert with the deterministic id (409 => patch + status confirmed), patch with If-Match,
 *       delete. Only Google-visible changes are sent (hash of the visible fields), so editing
 *       alert times never emails attendees.
 * ECHO  A local change waiting to be pushed wins over the pulled version (it is pushed next); an
 *       event whose etag matches the stored one is unchanged; our own write-backs use origin
 *       'calendar_google', which the engine never pushes.
 */
import type {
  CalendarPullResult,
  ExternalMeetingUpsert,
  MeetingRepository,
  UpsertExternalResult,
} from '../../../core/contracts';
import { AppError, toAppError, type AppErrorCode } from '../../../core/errors';
import { googleEventIdForMeeting, meetingIdFromGoogleEventId } from '../../../core/identifiers';
import { createLogger } from '../../../core/logger';
import { recurrenceEndsAt } from '../../../core/recurrence';
import { addMinutesIso, toDate, toUtcIso } from '../../../core/time';
import type { ExternalRefs, Meeting, MeetingPatch } from '../../../core/types';
import { chunk, isOwnMeeting, overlapsWindow, syncWindow, type SyncWindow } from '../shared';
import type { GoogleSyncState, PendingGooglePush, StateStore } from '../stateStore';
import { googleHttpStatus, type GoogleCalendarApi, type PatchParams, type WriteParams } from './api';
import {
  extractGoogleConference,
  GOOGLE_PRIMARY_CALENDAR,
  googleEventToMeetingInput,
  googleVisibleHash,
  isImportableEventType,
  meetCreateStatus,
  meetingToGoogleEvent,
  wantsMeetLink,
  type GoogleMappingContext,
} from './mapping';
import type { GoogleEvent, GoogleEventWrite } from './types';

const log = createLogger('calendar');

export const FULL_SYNC_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_LIST_PAGES = 200;
export const UPSERT_CHUNK_SIZE = 100;
export const MAX_PUSH_ATTEMPTS = 8;
export const MEET_POLL_DELAYS_MS: readonly number[] = [1000, 2000, 4000];

/** Errors that are not about one meeting: stop flushing and keep everything queued. */
const BLOCKING_CODES: ReadonlySet<AppErrorCode> = new Set<AppErrorCode>([
  'offline',
  'timeout',
  'unauthenticated',
  'google_not_signed_in',
  'calendar_scope_missing',
  'calendar_not_connected',
  'not_configured',
]);

export const CLEARED_GOOGLE_REFS: Pick<ExternalRefs, 'googleEventId' | 'googleCalendarId' | 'googleEtag' | 'googleUpdatedAt'> = {
  googleEventId: null,
  googleCalendarId: null,
  googleEtag: null,
  googleUpdatedAt: null,
};

export type GoogleMeetingsPort = Pick<MeetingRepository, 'list' | 'get' | 'update' | 'remove' | 'upsertExternal'>;

export interface GoogleSyncDeps {
  api: GoogleCalendarApi;
  meetings: GoogleMeetingsPort;
  state: StateStore<GoogleSyncState>;
  now(): Date;
  /** Zone for events without one (device zone). */
  defaultTimeZone(): string;
  /** Localized "(No title)". */
  untitledTitle(): string;
  sleep(ms: number): Promise<void>;
}

function updatedIso(event: GoogleEvent): string | null {
  if (!event.updated) return null;
  try {
    return toUtcIso(event.updated);
  } catch {
    return null;
  }
}

function emptyTotals(): Omit<UpsertExternalResult, 'changedIds' | 'invalid'> {
  return { created: 0, updated: 0, removed: 0, unchanged: 0 };
}

// ---------------------------------------------------------------------------------------------
// Pull
// ---------------------------------------------------------------------------------------------

interface Listing {
  events: GoogleEvent[];
  nextSyncToken: string | null;
  timeZone: string | null;
}

async function listAll(
  api: GoogleCalendarApi,
  calendarId: string,
  params: { syncToken: string } | { timeMin: string; timeMax: string },
): Promise<Listing> {
  const events: GoogleEvent[] = [];
  let timeZone: string | null = null;
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const response = await api.listEvents(calendarId, { ...params, pageToken });
    events.push(...(response.items ?? []));
    timeZone = response.timeZone ?? timeZone;
    if (response.nextPageToken) {
      pageToken = response.nextPageToken;
      continue;
    }
    return { events, nextSyncToken: response.nextSyncToken ?? null, timeZone };
  }
  throw new AppError('upstream_error', 'Google Calendar returned too many result pages', { details: { pages: MAX_LIST_PAGES } });
}

export function isFullSyncDue(lastFullSyncAt: string | null, now: Date): boolean {
  if (lastFullSyncAt === null) return true;
  const last = Date.parse(lastFullSyncAt);
  return Number.isNaN(last) || now.getTime() - last >= FULL_SYNC_INTERVAL_MS;
}

export interface PullPlanInput {
  events: readonly GoogleEvent[];
  /** Every local meeting, tombstones and cancelled ones included. */
  locals: readonly Meeting[];
  pending: Readonly<Record<string, PendingGooglePush>>;
  fullSync: boolean;
  window: SyncWindow;
  ctx: GoogleMappingContext;
  calendarId: string;
}

export interface PullPlan {
  upserts: ExternalMeetingUpsert[];
  unchanged: number;
  /** Google event id -> new visible-fields hash (null = forget). */
  hashUpdates: Record<string, string | null>;
  /** Event ids present in this listing. */
  seen: Set<string>;
}

/** Decides what a listing changes locally (pure). */
export function planGooglePull(input: PullPlanInput): PullPlan {
  const { calendarId, ctx, pending } = input;
  const byId = new Map<string, Meeting>();
  const byGoogleId = new Map<string, Meeting>();
  for (const meeting of input.locals) {
    byId.set(meeting.id, meeting);
    const googleId = meeting.external.googleEventId;
    if (googleId === null) continue;
    const existing = byGoogleId.get(googleId);
    // Prefer the active meeting when a tombstone shares the event id.
    if (!existing || (existing.deletedAt !== null && meeting.deletedAt === null)) byGoogleId.set(googleId, meeting);
  }

  const plan: PullPlan = { upserts: [], unchanged: 0, hashUpdates: {}, seen: new Set() };
  const upsert = (event: GoogleEvent, deleted: boolean, meeting: ExternalMeetingUpsert['meeting']): void => {
    plan.upserts.push({
      provider: 'google',
      externalId: event.id,
      calendarId,
      etag: event.etag ?? null,
      providerUpdatedAt: updatedIso(event),
      deleted,
      meeting,
    });
  };

  for (const event of input.events) {
    if (!event.id) continue;
    plan.seen.add(event.id);
    // Instances of OUR OWN pushed series: `recurringEventId` is the master's deterministic
    // "mgev..." id. The local master already expands these occurrences, so importing them would
    // duplicate the series one meeting per occurrence. They are skipped entirely - including
    // per-instance cancellations/edits made in Google, a documented v1 limitation
    // (docs/v1/ARCHITECTURE.md §16: occurrence edits flow MeetingGuard -> Google only).
    if (event.recurringEventId !== undefined && meetingIdFromGoogleEventId(event.recurringEventId) !== null) {
      continue;
    }
    const decodedId = meetingIdFromGoogleEventId(event.id);
    const local = byGoogleId.get(event.id) ?? (decodedId !== null ? byId.get(decodedId) : undefined);
    const linked = local !== undefined && local.external.googleEventId === event.id;

    if (local && pending[local.id]) {
      // A local change is queued for Google: it is newer and will overwrite this version.
      plan.unchanged += 1;
      continue;
    }

    if (event.status === 'cancelled') {
      if (!local || local.deletedAt !== null) {
        plan.hashUpdates[event.id] = null;
        if (local) plan.unchanged += 1;
        continue;
      }
      if (local.source !== 'google' && local.status === 'cancelled') {
        // We removed it from Google because it was cancelled here; it stays visible locally.
        plan.unchanged += 1;
        continue;
      }
      upsert(event, true, null);
      plan.hashUpdates[event.id] = null;
      continue;
    }

    if (!isImportableEventType(event)) {
      if (local) plan.unchanged += 1;
      continue;
    }
    if (local && linked && local.external.googleEtag !== null && local.external.googleEtag === event.etag) {
      plan.unchanged += 1;
      continue;
    }
    if (local && local.deletedAt !== null) {
      // Deleted in MeetingGuard: the delete was (or will be) pushed; do not resurrect it.
      plan.unchanged += 1;
      continue;
    }
    if (!local && decodedId !== null) {
      // Created by MeetingGuard (maybe on another device) and not in this device's data yet.
      continue;
    }
    const mapped = googleEventToMeetingInput(event, ctx);
    if (!mapped) {
      log.warn('Skipping a Google event without a usable start', { eventId: event.id });
      continue;
    }
    if (!local && !input.fullSync && !overlapsWindow({ startAt: mapped.startAt, durationMinutes: mapped.durationMinutes ?? 60 }, input.window)) {
      continue;
    }
    // The repository matches "mgev..." ids to their meeting itself (keeps its source).
    upsert(event, false, mapped);
    plan.hashUpdates[event.id] = googleVisibleHash(mapped, ctx.defaultTimeZone);
  }

  if (input.fullSync) {
    // Anything linked to this calendar that the complete listing no longer contains was deleted.
    for (const meeting of input.locals) {
      const googleId = meeting.external.googleEventId;
      if (googleId === null || plan.seen.has(googleId)) continue;
      if (meeting.deletedAt !== null || pending[meeting.id] || meeting.source === 'device') continue;
      // Recurring masters never appear in singleEvents listings (only their instances do), so
      // their absence proves nothing: never sweep them. Deleting the whole series in Google
      // therefore does not delete the local master (delete it in MeetingGuard) - documented §16.
      if (meeting.recurrence !== null) continue;
      if (meeting.external.googleCalendarId !== null && meeting.external.googleCalendarId !== calendarId) continue;
      if (meeting.source !== 'google' && meeting.status !== 'scheduled') continue;
      if (!overlapsWindow(meeting, input.window)) continue;
      plan.upserts.push({
        provider: 'google',
        externalId: googleId,
        calendarId,
        etag: null,
        providerUpdatedAt: null,
        deleted: true,
        meeting: null,
      });
      plan.hashUpdates[googleId] = null;
    }
  }
  return plan;
}

function applyHashUpdates(
  hashes: Record<string, string>,
  updates: Record<string, string | null>,
  keepOnly: ReadonlySet<string> | null,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [id, hash] of Object.entries(hashes)) {
    if (keepOnly === null || keepOnly.has(id)) next[id] = hash;
  }
  for (const [id, hash] of Object.entries(updates)) {
    if (hash === null) delete next[id];
    else next[id] = hash;
  }
  return next;
}

/** One pull (incremental, or full when requested / first time / due / 410). */
export async function pullGoogleChanges(deps: GoogleSyncDeps, options: { full?: boolean } = {}): Promise<CalendarPullResult> {
  const calendarId = GOOGLE_PRIMARY_CALENDAR;
  const now = deps.now();
  const nowIso = now.toISOString();
  const state = await deps.state.load();
  const window = syncWindow(now);

  let fullSync = options.full === true || state.syncToken === null || isFullSyncDue(state.lastFullSyncAt, now);
  let listing: Listing | null = null;
  if (!fullSync && state.syncToken !== null) {
    try {
      listing = await listAll(deps.api, calendarId, { syncToken: state.syncToken });
    } catch (error) {
      if (googleHttpStatus(error) !== 410) throw error;
      log.info('Google sync token expired (410): running a full resync');
      fullSync = true;
    }
  }
  if (listing === null) {
    listing = await listAll(deps.api, calendarId, { timeMin: window.timeMin, timeMax: window.timeMax });
  }

  const locals = await deps.meetings.list({ includeDeleted: true, includeCancelled: true });
  const plan = planGooglePull({
    events: listing.events,
    locals,
    pending: state.pending,
    fullSync,
    window,
    calendarId,
    ctx: {
      calendarTimeZone: listing.timeZone ?? state.calendarTimeZone,
      defaultTimeZone: deps.defaultTimeZone(),
      untitledTitle: deps.untitledTitle(),
    },
  });

  const totals = emptyTotals();
  for (const batch of chunk(plan.upserts, UPSERT_CHUNK_SIZE)) {
    const result = await deps.meetings.upsertExternal(batch);
    totals.created += result.created;
    totals.updated += result.updated;
    totals.removed += result.removed;
    totals.unchanged += result.unchanged;
  }

  // Remember what the repository actually stored (it may keep a newer local version), so a later
  // MeetingGuard-only edit never pushes a stale copy over Google's.
  const storedHashes: Record<string, string | null> = { ...plan.hashUpdates };
  const appliedIds = Object.entries(plan.hashUpdates)
    .filter(([, hash]) => hash !== null)
    .map(([eventId]) => eventId);
  if (appliedIds.length > 0) {
    const defaultTimeZone = deps.defaultTimeZone();
    const stored = new Map<string, Meeting>();
    for (const meeting of await deps.meetings.list({ includeDeleted: true, includeCancelled: true })) {
      if (meeting.external.googleEventId !== null && meeting.deletedAt === null) stored.set(meeting.external.googleEventId, meeting);
    }
    for (const eventId of appliedIds) {
      const meeting = stored.get(eventId);
      storedHashes[eventId] = meeting ? googleVisibleHash(meeting, defaultTimeZone) : null;
    }
  }

  const nextSyncToken = listing.nextSyncToken;
  const timeZone = listing.timeZone;
  await deps.state.update((current) => ({
    ...current,
    syncToken: nextSyncToken ?? (fullSync ? null : current.syncToken),
    calendarTimeZone: timeZone ?? current.calendarTimeZone,
    lastSyncAt: nowIso,
    lastFullSyncAt: fullSync ? nowIso : current.lastFullSyncAt,
    lastError: null,
    hashes: applyHashUpdates(current.hashes, storedHashes, fullSync ? plan.seen : null),
  }));

  return {
    provider: 'google',
    fullSync,
    counts: { ...totals, unchanged: totals.unchanged + plan.unchanged, pushed: 0, failed: 0 },
    syncedAt: nowIso,
  };
}

// ---------------------------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------------------------

export interface PushOutcome {
  meeting: Meeting;
  /** false when nothing had to be sent (unchanged / not applicable). */
  sent: boolean;
}

export interface PushOptions {
  /** Create a real Google Meet link (conferenceData.createRequest). */
  requestMeetLink?: boolean;
}

function writeParams(meeting: Meeting, requestMeetLink: boolean): WriteParams {
  return {
    // Attendees get an email only when there are attendees (and only for visible changes).
    sendUpdates: meeting.participants.length > 0 ? 'all' : 'none',
    conferenceDataVersion: requestMeetLink ? 1 : undefined,
  };
}

async function insertOrRestore(
  deps: GoogleSyncDeps,
  calendarId: string,
  eventId: string,
  body: GoogleEventWrite,
  params: WriteParams,
): Promise<GoogleEvent> {
  try {
    return await deps.api.insertEvent(calendarId, { ...body, id: eventId }, params);
  } catch (error) {
    if (googleHttpStatus(error) !== 409) throw error;
  }
  // The id exists: an earlier insert whose response was lost, another device, or an event deleted
  // in Google (deleted events keep their id). Update it and make sure it is not cancelled.
  return deps.api.patchEvent(calendarId, eventId, { ...body, status: 'confirmed' }, params);
}

async function awaitMeetLink(deps: GoogleSyncDeps, calendarId: string, event: GoogleEvent): Promise<GoogleEvent> {
  let current = event;
  for (const delay of MEET_POLL_DELAYS_MS) {
    if (meetCreateStatus(current) !== 'pending') break;
    await deps.sleep(delay);
    current = await deps.api.getEvent(calendarId, current.id);
  }
  return current;
}

async function writeBack(deps: GoogleSyncDeps, meeting: Meeting, patch: MeetingPatch): Promise<Meeting> {
  try {
    return await deps.meetings.update(meeting.id, patch, { origin: 'calendar_google' });
  } catch (error) {
    const appError = toAppError(error);
    if (appError.code === 'not_found') {
      // Deleted while the push was running; its delete is queued and removes the event next.
      log.info('Meeting deleted during a Google push', { meetingId: meeting.id });
      return meeting;
    }
    throw appError;
  }
}

async function setHash(deps: GoogleSyncDeps, eventId: string, hash: string | null): Promise<void> {
  await deps.state.update((current) => ({ ...current, hashes: applyHashUpdates(current.hashes, { [eventId]: hash }, null) }));
}

/**
 * events.delete; a missing / already deleted event counts as deleted. Always `sendUpdates: 'all'`:
 * deleted meetings are scrubbed (no participant list any more), and Google only notifies the
 * event's actual guests (none: nothing is sent).
 */
export async function deleteGoogleEvent(deps: GoogleSyncDeps, meeting: Meeting): Promise<boolean> {
  const eventId = meeting.external.googleEventId;
  if (eventId === null) return false;
  const calendarId = meeting.external.googleCalendarId ?? GOOGLE_PRIMARY_CALENDAR;
  try {
    await deps.api.deleteEvent(calendarId, eventId, { sendUpdates: 'all' });
  } catch (error) {
    const status = googleHttpStatus(error);
    if (status !== 404 && status !== 410) throw error;
  }
  await setHash(deps, eventId, null);
  return true;
}

/**
 * Sends one meeting to Google (insert / patch / delete as its state requires) and stores the
 * external refs (and a created Meet link) with origin 'calendar_google'.
 */
export async function pushGoogleMeeting(deps: GoogleSyncDeps, meeting: Meeting, options: PushOptions = {}): Promise<PushOutcome> {
  if (meeting.source === 'device') {
    throw new AppError('unsupported', 'Device calendar meetings are not pushed to Google');
  }
  if (meeting.source === 'outlook') {
    // Imported from Outlook: only the outlook provider pushes it (no cross-provider duplicates).
    return { meeting, sent: false };
  }
  if (meeting.deletedAt !== null) {
    return { meeting, sent: await deleteGoogleEvent(deps, meeting) };
  }
  if (meeting.status === 'cancelled') {
    // A declined/cancelled invitation stays in the organizer's event; our own cancelled meetings
    // are removed from Google (attendees are notified) and stay visible here.
    if (meeting.source === 'google' || meeting.external.googleEventId === null) return { meeting, sent: false };
    await deleteGoogleEvent(deps, meeting);
    return { meeting: await writeBack(deps, meeting, { external: { ...CLEARED_GOOGLE_REFS } }), sent: true };
  }

  const calendarId = meeting.external.googleCalendarId ?? GOOGLE_PRIMARY_CALENDAR;
  const linkedId = meeting.external.googleEventId;
  if (linkedId === null && meeting.source === 'google') {
    throw new AppError('invalid_input', 'Imported Google meeting without an event id', { details: { meetingId: meeting.id } });
  }
  const requestMeetLink = options.requestMeetLink === true || wantsMeetLink(meeting);
  const defaultTimeZone = deps.defaultTimeZone();

  if (linkedId !== null && !requestMeetLink) {
    const state = await deps.state.load();
    if (state.hashes[linkedId] === googleVisibleHash(meeting, defaultTimeZone)) {
      return { meeting, sent: false };
    }
  }

  const body = meetingToGoogleEvent(meeting, {
    requestMeetLink,
    requestId: `mg-${meeting.id}-${deps.now().getTime().toString(36)}`,
  });
  const params = writeParams(meeting, requestMeetLink);

  let event: GoogleEvent;
  if (linkedId !== null) {
    const patchParams: PatchParams = { ...params, ifMatch: meeting.external.googleEtag };
    try {
      event = await deps.api.patchEvent(calendarId, linkedId, body, patchParams);
    } catch (error) {
      const status = googleHttpStatus(error);
      if (status === 412) {
        // Changed in Google since our last sync: last writer wins.
        const current = await deps.api.getEvent(calendarId, linkedId);
        const remoteUpdated = updatedIso(current);
        if (remoteUpdated !== null && toDate(remoteUpdated).getTime() > toDate(meeting.updatedAt).getTime()) {
          log.info('Google has a newer version; keeping it', { meetingId: meeting.id });
          return { meeting, sent: false };
        }
        event = await deps.api.patchEvent(calendarId, linkedId, body, params);
      } else if ((status === 404 || status === 410) && meeting.source !== 'google') {
        event = await insertOrRestore(deps, calendarId, googleEventIdForMeeting(meeting.id), body, params);
      } else {
        throw error;
      }
    }
  } else {
    event = await insertOrRestore(deps, calendarId, googleEventIdForMeeting(meeting.id), body, params);
  }

  if (requestMeetLink) event = await awaitMeetLink(deps, calendarId, event);

  const patch: MeetingPatch = {
    external: {
      googleEventId: event.id,
      googleCalendarId: calendarId,
      googleEtag: event.etag ?? null,
      googleUpdatedAt: updatedIso(event),
    },
  };
  if (requestMeetLink) {
    const created = extractGoogleConference(event);
    if (created?.provider === 'google_meet' && created.url !== null) {
      if (meeting.conference?.url !== created.url) {
        patch.conference = {
          provider: 'google_meet',
          url: created.url,
          password: meeting.conference?.provider === 'google_meet' ? meeting.conference.password : null,
        };
      }
    } else {
      log.warn('Google did not return a Meet link', { meetingId: meeting.id, status: meetCreateStatus(event) });
    }
  }
  const updated = await writeBack(deps, meeting, patch);
  await setHash(deps, event.id, googleVisibleHash(updated, defaultTimeZone));
  return { meeting: updated, sent: true };
}

// ---------------------------------------------------------------------------------------------
// Pending pushes (persisted queue)
// ---------------------------------------------------------------------------------------------

let queueSequence = 0;

/** Queues local changes for Google (persisted, so they survive restarts and offline periods). */
export async function enqueueGooglePushes(
  deps: Pick<GoogleSyncDeps, 'state' | 'now'>,
  meetingIds: readonly string[],
  op: PendingGooglePush['op'],
): Promise<void> {
  if (meetingIds.length === 0) return;
  const base = deps.now().toISOString();
  await deps.state.update((current) => {
    const pending = { ...current.pending };
    for (const id of meetingIds) {
      queueSequence += 1;
      pending[id] = { op, queuedAt: `${base}#${String(queueSequence).padStart(6, '0')}`, attempts: 0, lastError: null };
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

async function settle(deps: GoogleSyncDeps, meetingId: string, queuedAt: string, next: PendingGooglePush | null): Promise<void> {
  await deps.state.update((current) => {
    const entry = current.pending[meetingId];
    // A newer change was queued meanwhile: keep it.
    if (!entry || entry.queuedAt !== queuedAt) return current;
    const pending = { ...current.pending };
    if (next === null) delete pending[meetingId];
    else pending[meetingId] = next;
    return { ...current, pending };
  });
}

/** Pushes every queued change (oldest first). */
export async function flushGooglePushes(deps: GoogleSyncDeps): Promise<FlushResult> {
  const state = await deps.state.load();
  const entries = Object.entries(state.pending).sort(([, a], [, b]) => a.queuedAt.localeCompare(b.queuedAt));
  const result: FlushResult = { pushed: 0, failed: 0, pending: 0, blockedBy: null };
  if (entries.length === 0) return result;

  const locals = await deps.meetings.list({ includeDeleted: true, includeCancelled: true });
  const byId = new Map(locals.map((meeting) => [meeting.id, meeting]));

  for (const [meetingId, entry] of entries) {
    const meeting = byId.get(meetingId);
    try {
      if (meeting) {
        const outcome = await pushGoogleMeeting(deps, meeting);
        if (outcome.sent) result.pushed += 1;
      }
      await settle(deps, meetingId, entry.queuedAt, null);
    } catch (error) {
      const appError = toAppError(error);
      if (BLOCKING_CODES.has(appError.code)) {
        result.blockedBy = appError.code;
        await settle(deps, meetingId, entry.queuedAt, { ...entry, lastError: appError.code });
        break;
      }
      const attempts = entry.attempts + 1;
      if (appError.retryable && attempts < MAX_PUSH_ATTEMPTS) {
        await settle(deps, meetingId, entry.queuedAt, { ...entry, attempts, lastError: appError.code });
      } else {
        result.failed += 1;
        log.warn('Dropping a change Google rejected', { meetingId, code: appError.code, status: googleHttpStatus(appError) });
        await settle(deps, meetingId, entry.queuedAt, null);
      }
    }
  }
  const after = await deps.state.load();
  result.pending = Object.keys(after.pending).length;
  return result;
}

/** Queues upcoming MeetingGuard meetings that were never pushed (first connection). */
export async function enqueueUpcomingOwnMeetings(deps: GoogleSyncDeps): Promise<number> {
  const now = deps.now();
  const window = syncWindow(now);
  const fromMs = toDate(addMinutesIso(now, -24 * 60)).getTime();
  // No `from` bound: a recurring master's own startAt is its FIRST occurrence, which can be far
  // in the past while the series is still running; it is filtered by its series end instead.
  const meetings = await deps.meetings.list({ to: window.timeMax, includeCancelled: false });
  const ids = meetings
    .filter((meeting) => {
      if (!isOwnMeeting(meeting) || meeting.status !== 'scheduled' || meeting.external.googleEventId !== null) return false;
      if (meeting.recurrence !== null) {
        const endsAt = recurrenceEndsAt(meeting);
        return endsAt === null || toDate(endsAt).getTime() >= fromMs;
      }
      return toDate(meeting.startAt).getTime() >= fromMs;
    })
    .map((meeting) => meeting.id);
  await enqueueGooglePushes(deps, ids, 'upsert');
  return ids.length;
}

/**
 * Disconnect cleanup: imported Google meetings are tombstoned and our meetings forget their
 * Google refs (so a later reconnection re-links them through their deterministic ids).
 */
export async function removeGoogleLinks(deps: GoogleSyncDeps): Promise<{ removed: number; unlinked: number }> {
  const meetings = await deps.meetings.list({ includeCancelled: true });
  const imported = meetings.filter((meeting) => meeting.source === 'google');
  let removed = 0;
  for (const batch of chunk(
    imported.filter((meeting) => meeting.external.googleEventId !== null),
    UPSERT_CHUNK_SIZE,
  )) {
    const result = await deps.meetings.upsertExternal(
      batch.map((meeting) => ({
        provider: 'google' as const,
        externalId: meeting.external.googleEventId as string,
        calendarId: meeting.external.googleCalendarId ?? GOOGLE_PRIMARY_CALENDAR,
        etag: null,
        providerUpdatedAt: null,
        deleted: true,
        meeting: null,
      })),
    );
    removed += result.removed;
  }
  for (const meeting of imported.filter((item) => item.external.googleEventId === null)) {
    await deps.meetings.remove(meeting.id, { origin: 'calendar_google' });
    removed += 1;
  }
  let unlinked = 0;
  for (const meeting of meetings) {
    if (meeting.source === 'google' || meeting.external.googleEventId === null) continue;
    await deps.meetings.update(meeting.id, { external: { ...CLEARED_GOOGLE_REFS } }, { origin: 'calendar_google' });
    unlinked += 1;
  }
  return { removed, unlinked };
}
