/**
 * Outlook (Microsoft Graph) two-way sync algorithms (dependency-injected; unit-tested with fakes).
 *
 * PULL  /me/calendarView/delta over CALENDAR_SYNC_WINDOW. The deltaLink is persisted; a full
 *       re-delta runs on the first sync, every 7 days (the window slides) and on HTTP 410
 *       (expired sync state). `@removed` and cancelled events tombstone their meeting.
 * PUSH  create with a client transactionId ("mgev-" + meeting.id; Graph replays the POST
 *       idempotently), patch, delete. Only Outlook-visible changes are sent (hash of the visible
 *       fields), so editing alert times never emails attendees. Meetings imported from Google or
 *       a device calendar are NEVER pushed to Outlook (no cross-provider duplicates). Recurring
 *       MeetingGuard series are pushed as Graph series masters; cancelled / modified occurrences
 *       are applied to the generated instances (applyOccurrenceOverrides). A meeting whose shape
 *       changes (one-off <-> series) is deleted and re-created (state.kinds remembers the shape).
 *       Instances of our own masters coming back through calendarView are skipped on import.
 * ECHO  A local change waiting to be pushed wins over the pulled version; an event whose changeKey
 *       matches the stored one is unchanged; our own ref write-backs use origin
 *       'calendar_outlook', which the engine never pushes.
 */
import type { CalendarPullResult, ExternalMeetingUpsert, MeetingRepository, UpsertExternalResult } from '../../../core/contracts';
import { AppError, toAppError, type AppErrorCode } from '../../../core/errors';
import { createLogger } from '../../../core/logger';
import { addMinutesIso, isLocalDate, toUtcIso } from '../../../core/time';
import type { ExternalRefs, Meeting, MeetingPatch } from '../../../core/types';
import { chunk, isOwnMeeting, overlapsWindow, stableHash, syncWindow, type SyncWindow } from '../shared';
import type { StateStore } from '../stateStore';
import { graphHttpStatus, type OutlookGraphApi } from './api';
import {
  extractOnlineMeetingUrl,
  isImportableGraphEvent,
  meetingToOutlookEvent,
  occurrenceOriginalStart,
  OUTLOOK_DEFAULT_CALENDAR,
  outlookEventToMeetingInput,
  outlookVisibleHash,
  overrideToInstancePatch,
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
/** Instance listings for overrides are chunked into spans of at most this many days. */
export const INSTANCE_SPAN_DAYS = 180;

/** The Graph idempotency key of a MeetingGuard-created event. */
export function outlookTransactionId(meetingId: string): string {
  return `${OWN_TRANSACTION_PREFIX}${meetingId}`;
}

/** Every event MeetingGuard creates carries a transactionId with this prefix (re-creates too). */
export const OWN_TRANSACTION_PREFIX = 'mgev-';

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
  /** true while the meeting waits for its Zoom link: its queued push is skipped, not dropped. */
  holdPush?(meetingId: string): boolean;
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

  // Graph series masters WE created (state.kinds is not available here; a recurring local master
  // linked to Outlook is by construction one of ours).
  const ownMasterIds = new Set<string>();
  for (const meeting of input.locals) {
    if (meeting.recurrence !== null && meeting.external.outlookEventId !== null && meeting.deletedAt === null) {
      ownMasterIds.add(meeting.external.outlookEventId);
    }
  }

  // Events WE created (transactionId "mgev-...") that this device does not know yet: a fresh
  // install whose Firestore baseline has not landed, or a meeting another device just pushed.
  // Importing them as foreign meetings would duplicate the real one the moment it arrives (and
  // deleting that duplicate would delete the real event). Their series masters are remembered so
  // their instances are skipped as well.
  const ownUnknownIds = new Set<string>();
  for (const event of input.events) {
    if (!event.id || typeof event.transactionId !== 'string' || !event.transactionId.startsWith(OWN_TRANSACTION_PREFIX)) continue;
    if (byOutlookId.has(event.id)) continue;
    ownUnknownIds.add(event.id);
    if (event.type === 'seriesMaster') ownMasterIds.add(event.id);
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
    // Instances of OUR OWN pushed series: the local master already expands these occurrences,
    // so importing them would duplicate the series one meeting per instance. They are skipped
    // entirely, including per-instance edits made in Outlook (occurrence edits flow
    // MeetingGuard -> Outlook only, like the Google provider; docs/v1/ARCHITECTURE.md §17).
    if (typeof event.seriesMasterId === 'string' && ownMasterIds.has(event.seriesMasterId)) continue;
    if (ownUnknownIds.has(event.id)) continue;
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
      // Series masters never appear in calendarView (only their instances do), so their absence
      // proves nothing: never sweep them. Deleting the whole series in Outlook therefore does not
      // delete the local master (delete it in MeetingGuard), like the Google provider (§16).
      if (meeting.recurrence !== null) continue;
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
  await setKind(deps, eventId, null);
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
  return meeting.source !== 'google' && meeting.source !== 'device';
}

type OutlookEventKind = 'single' | 'series';

function kindOf(meeting: Pick<Meeting, 'recurrence'>): OutlookEventKind {
  return meeting.recurrence !== null ? 'series' : 'single';
}

async function setKind(deps: OutlookSyncDeps, eventId: string, kind: OutlookEventKind | null): Promise<void> {
  await deps.state.update((current) => {
    const kinds = { ...current.kinds };
    if (kind === null) delete kinds[eventId];
    else kinds[eventId] = kind;
    return { ...current, kinds };
  });
}

function graphInstantMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value.replace(/\.(\d{3})\d+/, '.$1').replace(/(\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/, '$1Z'));
  return Number.isFinite(ms) ? ms : null;
}

/** The instance the series generated for an original start (exceptions keep originalStart). */
function findInstance(instances: readonly GraphEvent[], originalStartMs: number): GraphEvent | undefined {
  return instances.find((instance) => {
    const original = graphInstantMs(instance.originalStart ?? undefined);
    if (original !== null) return original === originalStartMs;
    const start = instance.start?.dateTime;
    const startMs = start !== undefined ? graphInstantMs(instance.start?.timeZone === 'UTC' || !instance.start?.timeZone ? start : null) : null;
    return startMs === originalStartMs;
  });
}

/** Instances of a master around the given instants, one listing per span of INSTANCE_SPAN_DAYS. */
async function listInstancesAround(deps: OutlookSyncDeps, masterId: string, instantsMs: readonly number[]): Promise<GraphEvent[]> {
  const sorted = [...instantsMs].sort((a, b) => a - b);
  const spanMs = INSTANCE_SPAN_DAYS * 86_400_000;
  const dayMs = 86_400_000;
  const out: GraphEvent[] = [];
  let index = 0;
  while (index < sorted.length) {
    const spanStart = sorted[index] as number;
    let spanEnd = spanStart;
    while (index < sorted.length && (sorted[index] as number) - spanStart <= spanMs) {
      spanEnd = sorted[index] as number;
      index += 1;
    }
    out.push(...(await deps.api.listInstances(masterId, new Date(spanStart - dayMs).toISOString(), new Date(spanEnd + dayMs).toISOString())));
  }
  return out;
}

/**
 * Applies the master's occurrence overrides to the Graph series: a cancelled occurrence deletes
 * its instance, a modified one patches start / end / subject on it. Graph regenerates the
 * occurrences when the master's recurrence is patched, so this runs after EVERY series push and
 * is idempotent (a missing instance counts as already cancelled; a patch of an identical
 * exception is a no-op for Graph). Occurrences the rule does not generate (an override key from
 * a previous rule) are ignored.
 */
export async function applyOccurrenceOverrides(deps: OutlookSyncDeps, meeting: Meeting, masterId: string): Promise<{ deleted: number; patched: number }> {
  const entries = Object.entries(meeting.recurrenceOverrides ?? {}).filter(([key]) => isLocalDate(key));
  const result = { deleted: 0, patched: 0 };
  if (entries.length === 0) return result;
  const targets = entries.map(([key, override]) => ({ key, override, originalStartMs: Date.parse(occurrenceOriginalStart(meeting, key)) }));
  const instances = await listInstancesAround(deps, masterId, targets.map((target) => target.originalStartMs));
  for (const target of targets) {
    const instance = findInstance(instances, target.originalStartMs);
    if (!instance) {
      log.info('Outlook series has no instance for an override; skipped', { meetingId: meeting.id, date: target.key });
      continue;
    }
    if (target.override.status === 'cancelled') {
      try {
        await deps.api.deleteEvent(instance.id);
        result.deleted += 1;
      } catch (error) {
        const status = graphHttpStatus(error);
        if (status !== 404 && status !== 410) throw error;
      }
    } else {
      await deps.api.patchEvent(instance.id, overrideToInstancePatch(meeting, target.key, target.override));
      result.patched += 1;
    }
  }
  return result;
}

/**
 * Sends one meeting to Outlook (create / patch / delete as its state requires) and stores the
 * external refs (and a created Teams link) with origin 'calendar_outlook'. Non-pushable meetings
 * resolve with sent:false (the flush queue routes every local write here). A recurring master is
 * created / patched as a Graph series and its overrides are applied to the instances afterwards.
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
  if (!isOutlookPushable(meeting)) return { meeting, sent: false };

  let linkedId = meeting.external.outlookEventId;
  if (linkedId === null && meeting.source === 'outlook') {
    throw new AppError('invalid_input', 'Imported Outlook meeting without an event id', { details: { meetingId: meeting.id } });
  }
  const requestTeamsLink = options.requestTeamsLink === true || wantsTeamsLink(meeting);
  const defaultTimeZone = deps.defaultTimeZone();
  const wantedKind = kindOf(meeting);
  let current = meeting;
  let recreateTransactionId: string | null = null;

  if (linkedId !== null) {
    const state = await deps.state.load();
    const linkedKind: OutlookEventKind = state.kinds[linkedId] ?? 'single';
    if (linkedKind !== wantedKind && meeting.source !== 'outlook') {
      // The shape changed (a one-off became a series or the repeat was removed). Graph cannot
      // turn one into the other through a PATCH, so the old event is deleted and a fresh one is
      // created; a deterministic transactionId keyed by the old link keeps the re-create
      // replay-safe without ever replaying the deleted event.
      await deleteOutlookEvent(deps, meeting);
      await setKind(deps, linkedId, null);
      recreateTransactionId = `${outlookTransactionId(meeting.id)}-k${stableHash(linkedId)}`;
      current = await writeBack(deps, meeting, { external: { ...CLEARED_OUTLOOK_REFS } });
      linkedId = null;
    } else if (!requestTeamsLink && state.hashes[linkedId] === outlookVisibleHash(meeting, defaultTimeZone)) {
      return { meeting, sent: false };
    }
  }

  let event: GraphEvent;
  let createdWithTeams = false;
  if (linkedId !== null) {
    // Graph cannot turn an existing event into a Teams meeting through this flow (v1 limitation):
    // the online-meeting fields are create-only here.
    const body = meetingToOutlookEvent(current);
    try {
      event = await deps.api.patchEvent(linkedId, body);
    } catch (error) {
      const status = graphHttpStatus(error);
      if ((status === 404 || status === 410) && current.source !== 'outlook') {
        // Deliberate re-create after the event vanished at Graph: a FRESH transactionId (still
        // deterministic per old link, so a lost response is replayed) - reusing the original one
        // could replay the deleted event.
        const transactionId = `${outlookTransactionId(current.id)}-r${stableHash(linkedId)}`;
        event = await deps.api.createEvent(meetingToOutlookEvent(current, { transactionId, requestTeamsLink }));
        createdWithTeams = requestTeamsLink;
      } else {
        throw error;
      }
    }
  } else {
    event = await deps.api.createEvent(
      meetingToOutlookEvent(current, { transactionId: recreateTransactionId ?? outlookTransactionId(current.id), requestTeamsLink }),
    );
    createdWithTeams = requestTeamsLink;
  }

  if (createdWithTeams) event = await awaitTeamsLink(deps, event);
  if (wantedKind === 'series') await applyOccurrenceOverrides(deps, current, event.id);

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
      if (current.conference?.url !== joinUrl) {
        patch.conference = {
          provider: 'teams',
          url: joinUrl,
          password: current.conference?.provider === 'teams' ? current.conference.password : null,
        };
      }
    } else {
      log.warn('Outlook did not return a Teams join link', { meetingId: current.id });
    }
  }
  const updated = await writeBack(deps, current, patch);
  await setKind(deps, event.id, wantedKind);
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
    // Waiting for its Zoom link (core/pushHold.ts): stays queued for the flush after the release.
    if (deps.holdPush?.(meetingId) === true) continue;
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
