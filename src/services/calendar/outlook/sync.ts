/**
 * Outlook (Microsoft Graph) two-way sync algorithms (dependency-injected; unit-tested with fakes).
 *
 * PULL  /me/calendarView/delta over CALENDAR_SYNC_WINDOW. The deltaLink is persisted; a full
 *       re-delta runs on the first sync, every 7 days (the window slides) and on HTTP 410
 *       (expired sync state). `@removed` and cancelled events tombstone their meeting.
 * PUSH  create with a client transactionId ("mgev-" + meeting.id; Graph replays the POST
 *       idempotently), patch, delete. Only Outlook-visible changes are sent (hash of the visible
 *       fields), so editing alert times never emails attendees. Meetings imported from Google or
 *       a device calendar are NEVER pushed to Outlook (no cross-provider duplicates), and
 *       recurring MeetingGuard series are not pushed in v1 (documented limitation, §17).
 * ECHO  A local change waiting to be pushed wins over the pulled version; an event whose changeKey
 *       matches the stored one is unchanged; our own ref write-backs use origin
 *       'calendar_outlook', which the engine never pushes.
 */
import type { CalendarPullResult, ExternalMeetingUpsert, MeetingRepository, UpsertExternalResult } from '../../../core/contracts';
import { AppError, toAppError, type AppErrorCode } from '../../../core/errors';
import { createLogger } from '../../../core/logger';
import { addMinutesIso, toUtcIso } from '../../../core/time';
import type { ExternalRefs, Meeting, MeetingPatch } from '../../../core/types';
import { chunk, isOwnMeeting, overlapsWindow, stableHash, syncWindow, type SyncWindow } from '../shared';
import type { StateStore } from '../stateStore';
import { graphHttpStatus, type OutlookGraphApi } from './api';
import {
  extractOnlineMeetingUrl,
  isImportableGraphEvent,
  meetingToOutlookEvent,
  OUTLOOK_DEFAULT_CALENDAR,
  outlookEventToMeetingInput,
  outlookVisibleHash,
  wantsTeamsLink,
  type OutlookMappingContext,
} from './mapping';
import type { OutlookSyncState, PendingOutlookPush } from './state';
import type { GraphEvent } from './types';

const log = createLogger('calendar');

export const FULL_SYNC_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_DELTA_PAGES = 200;
export const UPSERT_CHUNK_SIZE = 100;
export const MAX_PUSH_ATTEMPTS = 8;
export const TEAMS_POLL_DELAYS_MS: readonly number[] = [1000, 2000, 4000];

/** The Graph idempotency key of a MeetingGuard-created event. */
export function outlookTransactionId(meetingId: string): string {
  return `mgev-${meetingId}`;
}

/** Errors that are not about one meeting: stop flushing and keep everything queued. */
const BLOCKING_CODES: ReadonlySet<AppErrorCode> = new Set<AppErrorCode>([
  'offline',
  'timeout',
  'unauthenticated',
  'calendar_not_connected',
  'not_configured',
]);

export const CLEARED_OUTLOOK_REFS: Pick<ExternalRefs, 'outlookEventId' | 'outlookCalendarId' | 'outlookChangeKey' | 'outlookUpdatedAt'> = {
  outlookEventId: null,
  outlookCalendarId: null,
  outlookChangeKey: null,
  outlookUpdatedAt: null,
};

export type OutlookMeetingsPort = Pick<MeetingRepository, 'list' | 'get' | 'update' | 'remove' | 'upsertExternal'>;

export interface OutlookSyncDeps {
  api: OutlookGraphApi;
  meetings: OutlookMeetingsPort;
  state: StateStore<OutlookSyncState>;
  now(): Date;
  /** Zone for imported events (Graph delivers UTC wall clock; mapping.ts explains). */
  defaultTimeZone(): string;
  /** Localized "(No title)". */
  untitledTitle(): string;
  sleep(ms: number): Promise<void>;
}

function updatedIso(event: GraphEvent): string | null {
  if (!event.lastModifiedDateTime) return null;
  try {
    return toUtcIso(event.lastModifiedDateTime);
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

interface DeltaListing {
  events: GraphEvent[];
  deltaLink: string | null;
}

async function listDelta(api: OutlookGraphApi, start: { window: SyncWindow } | { deltaLink: string }): Promise<DeltaListing> {
  const events: GraphEvent[] = [];
  let page =
    'deltaLink' in start
      ? await api.getDeltaPage(start.deltaLink)
      : await api.startDelta(start.window.timeMin, start.window.timeMax);
  for (let count = 0; count < MAX_DELTA_PAGES; count += 1) {
    events.push(...(page.value ?? []));
    const nextLink = page['@odata.nextLink'];
    if (nextLink === undefined) return { events, deltaLink: page['@odata.deltaLink'] ?? null };
    page = await api.getDeltaPage(nextLink);
  }
  throw new AppError('upstream_error', 'Microsoft Graph returned too many delta pages', { details: { pages: MAX_DELTA_PAGES } });
}

export function isFullSyncDue(lastFullSyncAt: string | null, now: Date): boolean {
  if (lastFullSyncAt === null) return true;
  const last = Date.parse(lastFullSyncAt);
  return Number.isNaN(last) || now.getTime() - last >= FULL_SYNC_INTERVAL_MS;
}

export interface OutlookPullPlanInput {
  events: readonly GraphEvent[];
  /** Every local meeting, tombstones and cancelled ones included. */
  locals: readonly Meeting[];
  pending: Readonly<Record<string, PendingOutlookPush>>;
  fullSync: boolean;
  window: SyncWindow;
  ctx: OutlookMappingContext;
}

export interface OutlookPullPlan {
  upserts: ExternalMeetingUpsert[];
  unchanged: number;
  /** Graph event id -> new visible-fields hash (null = forget). */
  hashUpdates: Record<string, string | null>;
  /** Event ids present in this listing. */
  seen: Set<string>;
}

/** Decides what a delta listing changes locally (pure). */
export function planOutlookPull(input: OutlookPullPlanInput): OutlookPullPlan {
  const { ctx, pending } = input;
  const byOutlookId = new Map<string, Meeting>();
  for (const meeting of input.locals) {
    const outlookId = meeting.external.outlookEventId;
    if (outlookId === null) continue;
    const existing = byOutlookId.get(outlookId);
    // Prefer the active meeting when a tombstone shares the event id.
    if (!existing || (existing.deletedAt !== null && meeting.deletedAt === null)) byOutlookId.set(outlookId, meeting);
  }

  const plan: OutlookPullPlan = { upserts: [], unchanged: 0, hashUpdates: {}, seen: new Set() };
  const upsert = (event: GraphEvent, deleted: boolean, meeting: ExternalMeetingUpsert['meeting']): void => {
    plan.upserts.push({
      provider: 'outlook',
      externalId: event.id,
      calendarId: OUTLOOK_DEFAULT_CALENDAR,
      etag: event.changeKey ?? null,
      providerUpdatedAt: updatedIso(event),
      deleted,
      meeting,
    });
  };

  for (const event of input.events) {
    if (!event.id) continue;
    plan.seen.add(event.id);
    const local = byOutlookId.get(event.id);
    const linked = local !== undefined && local.external.outlookEventId === event.id;

    if (local && pending[local.id]) {
      // A local change is queued for Outlook: it is newer and will overwrite this version.
      plan.unchanged += 1;
      continue;
    }

    if (event['@removed'] !== undefined || event.isCancelled === true) {
      if (!local || local.deletedAt !== null) {
        plan.hashUpdates[event.id] = null;
        if (local) plan.unchanged += 1;
        continue;
      }
      if (local.source !== 'outlook' && local.status === 'cancelled') {
        // We removed it from Outlook because it was cancelled here; it stays visible locally.
        plan.unchanged += 1;
        continue;
      }
      upsert(event, true, null);
      plan.hashUpdates[event.id] = null;
      continue;
    }

    if (!isImportableGraphEvent(event)) {
      if (local) plan.unchanged += 1;
      continue;
    }
    if (local && linked && local.external.outlookChangeKey !== null && local.external.outlookChangeKey === event.changeKey) {
      plan.unchanged += 1;
      continue;
    }
    if (local && local.deletedAt !== null) {
      // Deleted in MeetingGuard: the delete was (or will be) pushed; do not resurrect it.
      plan.unchanged += 1;
      continue;
    }
    const mapped = outlookEventToMeetingInput(event, ctx);
    if (!mapped) {
      log.warn('Skipping an Outlook event without a usable start', { eventId: event.id });
      continue;
    }
    if (!local && !input.fullSync && !overlapsWindow({ startAt: mapped.startAt, durationMinutes: mapped.durationMinutes ?? 60 }, input.window)) {
      continue;
    }
    upsert(event, false, mapped);
    plan.hashUpdates[event.id] = outlookVisibleHash(mapped, ctx.defaultTimeZone);
  }

  if (input.fullSync) {
    // Anything linked to Outlook that the complete listing no longer contains was deleted there.
    for (const meeting of input.locals) {
      const outlookId = meeting.external.outlookEventId;
      if (outlookId === null || plan.seen.has(outlookId)) continue;
      if (meeting.deletedAt !== null || pending[meeting.id]) continue;
      if (meeting.source !== 'outlook' && meeting.status !== 'scheduled') continue;
      if (!overlapsWindow(meeting, input.window)) continue;
      plan.upserts.push({
        provider: 'outlook',
        externalId: outlookId,
        calendarId: OUTLOOK_DEFAULT_CALENDAR,
        etag: null,
        providerUpdatedAt: null,
        deleted: true,
        meeting: null,
      });
      plan.hashUpdates[outlookId] = null;
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

/** One pull (incremental via the stored deltaLink, or a full re-delta). */
export async function pullOutlookChanges(deps: OutlookSyncDeps, options: { full?: boolean } = {}): Promise<CalendarPullResult> {
  const now = deps.now();
  const nowIso = now.toISOString();
  const state = await deps.state.load();
  const window = syncWindow(now);

  let fullSync = options.full === true || state.deltaLink === null || isFullSyncDue(state.lastFullSyncAt, now);
  let listing: DeltaListing | null = null;
  if (!fullSync && state.deltaLink !== null) {
    try {
      listing = await listDelta(deps.api, { deltaLink: state.deltaLink });
    } catch (error) {
      if (graphHttpStatus(error) !== 410) throw error;
      log.info('Outlook delta state expired (410): running a full resync');
      fullSync = true;
    }
  }
  if (listing === null) {
    listing = await listDelta(deps.api, { window });
  }

  const locals = await deps.meetings.list({ includeDeleted: true, includeCancelled: true });
  const plan = planOutlookPull({
    events: listing.events,
    locals,
    pending: state.pending,
    fullSync,
    window,
    ctx: {
      defaultTimeZone: deps.defaultTimeZone(),
      untitledTitle: deps.untitledTitle(),
      selfEmail: state.accountEmail,
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
  // MeetingGuard-only edit never pushes a stale copy over Outlook's.
  const storedHashes: Record<string, string | null> = { ...plan.hashUpdates };
  const appliedIds = Object.entries(plan.hashUpdates)
    .filter(([, hash]) => hash !== null)
    .map(([eventId]) => eventId);
  if (appliedIds.length > 0) {
    const defaultTimeZone = deps.defaultTimeZone();
    const stored = new Map<string, Meeting>();
    for (const meeting of await deps.meetings.list({ includeDeleted: true, includeCancelled: true })) {
      if (meeting.external.outlookEventId !== null && meeting.deletedAt === null) stored.set(meeting.external.outlookEventId, meeting);
    }
    for (const eventId of appliedIds) {
      const meeting = stored.get(eventId);
      storedHashes[eventId] = meeting ? outlookVisibleHash(meeting, defaultTimeZone) : null;
    }
  }

  const nextDeltaLink = listing.deltaLink;
  await deps.state.update((current) => ({
    ...current,
    deltaLink: nextDeltaLink ?? (fullSync ? null : current.deltaLink),
    lastSyncAt: nowIso,
    lastFullSyncAt: fullSync ? nowIso : current.lastFullSyncAt,
    lastError: null,
    hashes: applyHashUpdates(current.hashes, storedHashes, fullSync ? plan.seen : null),
  }));

  return {
    provider: 'outlook',
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
  /** false when nothing had to be sent (unchanged / not pushable to Outlook). */
  sent: boolean;
}

async function writeBack(deps: OutlookSyncDeps, meeting: Meeting, patch: MeetingPatch): Promise<Meeting> {
  try {
    return await deps.meetings.update(meeting.id, patch, { origin: 'calendar_outlook' });
  } catch (error) {
    const appError = toAppError(error);
    if (appError.code === 'not_found') {
      // Deleted while the push was running; its delete is queued and removes the event next.
      log.info('Meeting deleted during an Outlook push', { meetingId: meeting.id });
      return meeting;
    }
    throw appError;
  }
}

async function setHash(deps: OutlookSyncDeps, eventId: string, hash: string | null): Promise<void> {
  await deps.state.update((current) => ({ ...current, hashes: applyHashUpdates(current.hashes, { [eventId]: hash }, null) }));
}

/** DELETE /me/events/{id}; a missing / already deleted event counts as deleted. */
export async function deleteOutlookEvent(deps: OutlookSyncDeps, meeting: Meeting): Promise<boolean> {
  const eventId = meeting.external.outlookEventId;
  if (eventId === null) return false;
  try {
    await deps.api.deleteEvent(eventId);
  } catch (error) {
    const status = graphHttpStatus(error);
    if (status !== 404 && status !== 410) throw error;
  }
  await setHash(deps, eventId, null);
  return true;
}

async function awaitTeamsLink(deps: OutlookSyncDeps, event: GraphEvent): Promise<GraphEvent> {
  let current = event;
  for (const delay of TEAMS_POLL_DELAYS_MS) {
    if (extractOnlineMeetingUrl(current) !== null) break;
    await deps.sleep(delay);
    current = await deps.api.getEvent(current.id);
  }
  return current;
}

/** Meetings that are pushed to Outlook at all (imports from other providers never are). */
export function isOutlookPushable(meeting: Pick<Meeting, 'source' | 'recurrence'>): boolean {
  if (meeting.source === 'google' || meeting.source === 'device') return false;
  // v1: recurrence rules are not pushed to Graph (docs/v1/ARCHITECTURE.md §17); the local master
  // stays local-only for Outlook while its Google push carries the RRULE.
  return meeting.recurrence === null;
}

/**
 * Sends one meeting to Outlook (create / patch / delete as its state requires) and stores the
 * external refs (and a created Teams link) with origin 'calendar_outlook'. Non-pushable meetings
 * resolve with sent:false (the flush queue routes every local write here).
 */
export async function pushOutlookMeeting(
  deps: OutlookSyncDeps,
  meeting: Meeting,
  options: { requestTeamsLink?: boolean } = {},
): Promise<PushOutcome> {
  if (meeting.deletedAt !== null) {
    return { meeting, sent: await deleteOutlookEvent(deps, meeting) };
  }
  if (meeting.status === 'cancelled') {
    // A declined invitation stays in the organizer's event; our own cancelled meetings are
    // removed from Outlook and stay visible here.
    if (meeting.source === 'outlook' || meeting.external.outlookEventId === null) return { meeting, sent: false };
    await deleteOutlookEvent(deps, meeting);
    return { meeting: await writeBack(deps, meeting, { external: { ...CLEARED_OUTLOOK_REFS } }), sent: true };
  }
  if (meeting.recurrence !== null && meeting.external.outlookEventId !== null && meeting.source !== 'outlook') {
    // A one-off already pushed to Outlook became a recurring series. Series are never pushed in
    // v1 (§17), so the old single event would otherwise sit in Outlook forever - stale, never
    // updated, and an Outlook-side edit of it would rewrite the local series anchor. Remove it
    // and unlink the master (a Graph edit can then no longer patch this meeting).
    await deleteOutlookEvent(deps, meeting);
    return { meeting: await writeBack(deps, meeting, { external: { ...CLEARED_OUTLOOK_REFS } }), sent: true };
  }
  if (!isOutlookPushable(meeting)) return { meeting, sent: false };

  const linkedId = meeting.external.outlookEventId;
  if (linkedId === null && meeting.source === 'outlook') {
    throw new AppError('invalid_input', 'Imported Outlook meeting without an event id', { details: { meetingId: meeting.id } });
  }
  const requestTeamsLink = options.requestTeamsLink === true || wantsTeamsLink(meeting);
  const defaultTimeZone = deps.defaultTimeZone();

  if (linkedId !== null && !requestTeamsLink) {
    const state = await deps.state.load();
    if (state.hashes[linkedId] === outlookVisibleHash(meeting, defaultTimeZone)) {
      return { meeting, sent: false };
    }
  }

  let event: GraphEvent;
  let createdWithTeams = false;
  if (linkedId !== null) {
    // Graph cannot turn an existing event into a Teams meeting through this flow (v1 limitation):
    // the online-meeting fields are create-only here.
    const body = meetingToOutlookEvent(meeting);
    try {
      event = await deps.api.patchEvent(linkedId, body);
    } catch (error) {
      const status = graphHttpStatus(error);
      if ((status === 404 || status === 410) && meeting.source !== 'outlook') {
        // Deliberate re-create after the event vanished at Graph: a FRESH transactionId (still
        // deterministic per old link, so a lost response is replayed) - reusing the original one
        // could replay the deleted event.
        const transactionId = `${outlookTransactionId(meeting.id)}-r${stableHash(linkedId)}`;
        event = await deps.api.createEvent(meetingToOutlookEvent(meeting, { transactionId, requestTeamsLink }));
        createdWithTeams = requestTeamsLink;
      } else {
        throw error;
      }
    }
  } else {
    event = await deps.api.createEvent(
      meetingToOutlookEvent(meeting, { transactionId: outlookTransactionId(meeting.id), requestTeamsLink }),
    );
    createdWithTeams = requestTeamsLink;
  }

  if (createdWithTeams) event = await awaitTeamsLink(deps, event);

  const patch: MeetingPatch = {
    external: {
      outlookEventId: event.id,
      outlookCalendarId: OUTLOOK_DEFAULT_CALENDAR,
      outlookChangeKey: event.changeKey ?? null,
      outlookUpdatedAt: updatedIso(event),
    },
  };
  if (createdWithTeams) {
    const joinUrl = extractOnlineMeetingUrl(event);
    if (joinUrl !== null) {
      if (meeting.conference?.url !== joinUrl) {
        patch.conference = {
          provider: 'teams',
          url: joinUrl,
          password: meeting.conference?.provider === 'teams' ? meeting.conference.password : null,
        };
      }
    } else {
      log.warn('Outlook did not return a Teams join link', { meetingId: meeting.id });
    }
  }
  const updated = await writeBack(deps, meeting, patch);
  await setHash(deps, event.id, outlookVisibleHash(updated, defaultTimeZone));
  return { meeting: updated, sent: true };
}

// ---------------------------------------------------------------------------------------------
// Pending pushes (persisted queue)
// ---------------------------------------------------------------------------------------------

let queueSequence = 0;

/** Queues local changes for Outlook (persisted, so they survive restarts and offline periods). */
export async function enqueueOutlookPushes(
  deps: Pick<OutlookSyncDeps, 'state' | 'now'>,
  meetingIds: readonly string[],
  op: PendingOutlookPush['op'],
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

async function settle(deps: OutlookSyncDeps, meetingId: string, queuedAt: string, next: PendingOutlookPush | null): Promise<void> {
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
export async function flushOutlookPushes(deps: OutlookSyncDeps): Promise<FlushResult> {
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
        const outcome = await pushOutlookMeeting(deps, meeting);
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
        log.warn('Dropping a change Outlook rejected', { meetingId, code: appError.code, status: graphHttpStatus(appError) });
        await settle(deps, meetingId, entry.queuedAt, null);
      }
    }
  }
  const after = await deps.state.load();
  result.pending = Object.keys(after.pending).length;
  return result;
}

/** Queues upcoming MeetingGuard meetings that were never pushed to Outlook (first connection). */
export async function enqueueUpcomingOwnMeetings(deps: OutlookSyncDeps): Promise<number> {
  const now = deps.now();
  const window = syncWindow(now);
  const meetings = await deps.meetings.list({ from: addMinutesIso(now, -24 * 60), to: window.timeMax, includeCancelled: false });
  const ids = meetings
    .filter(
      (meeting) =>
        isOwnMeeting(meeting) &&
        meeting.status === 'scheduled' &&
        meeting.external.outlookEventId === null &&
        isOutlookPushable(meeting),
    )
    .map((meeting) => meeting.id);
  await enqueueOutlookPushes(deps, ids, 'upsert');
  return ids.length;
}

/**
 * Disconnect cleanup: imported Outlook meetings are tombstoned and our meetings forget their
 * Outlook refs (a later reconnection re-links them through the transactionId replay or re-push).
 */
export async function removeOutlookLinks(deps: OutlookSyncDeps): Promise<{ removed: number; unlinked: number }> {
  const meetings = await deps.meetings.list({ includeCancelled: true });
  const imported = meetings.filter((meeting) => meeting.source === 'outlook');
  let removed = 0;
  for (const batch of chunk(
    imported.filter((meeting) => meeting.external.outlookEventId !== null),
    UPSERT_CHUNK_SIZE,
  )) {
    const result = await deps.meetings.upsertExternal(
      batch.map((meeting) => ({
        provider: 'outlook' as const,
        externalId: meeting.external.outlookEventId as string,
        calendarId: meeting.external.outlookCalendarId ?? OUTLOOK_DEFAULT_CALENDAR,
        etag: null,
        providerUpdatedAt: null,
        deleted: true,
        meeting: null,
      })),
    );
    removed += result.removed;
  }
  for (const meeting of imported.filter((item) => item.external.outlookEventId === null)) {
    await deps.meetings.remove(meeting.id, { origin: 'calendar_outlook' });
    removed += 1;
  }
  let unlinked = 0;
  for (const meeting of meetings) {
    if (meeting.source === 'outlook' || meeting.external.outlookEventId === null) continue;
    await deps.meetings.update(meeting.id, { external: { ...CLEARED_OUTLOOK_REFS } }, { origin: 'calendar_outlook' });
    unlinked += 1;
  }
  return { removed, unlinked };
}
