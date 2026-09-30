/**
 * Calendar import planning (pure; unit-tested). Turns provider events into meeting writes:
 *
 * Matching (in order): Google event id stored in external.googleEventId / device event id stored
 * in external.deviceEventId; a MeetingGuard-created Google event id ("mgev...") decoded to its
 * meeting id; the deterministic import id (ids.ts).
 *
 * Rules:
 * - deleted at the provider -> tombstone the matched meeting. Meetings imported from that provider
 *   are always removed; other meetings (MeetingGuard meetings pushed to the provider) only when
 *   the provider change is not older than the local edit (last-writer-wins).
 * - changed at the provider -> apply the provided fields (fields absent in the event keep their
 *   MeetingGuard values: confidence, tips, custom alerts...) unless the local copy is newer.
 *   A locally deleted meeting is resurrected only by a newer provider change.
 * - Google etag / Outlook changeKey unchanged -> nothing to do.
 * - Refs-only changes (etag, updated) are written silently (not reported as changes).
 * - New events -> meeting with source = provider, written with outbox mode "create".
 */
import type { CalendarProvider, ExternalMeetingUpsert, UpsertExternalResult } from '../../core/contracts';
import { meetingIdFromGoogleEventId } from '../../core/identifiers';
import {
  applyMeetingPatch,
  buildMeeting,
  tombstoneMeeting,
  type ExternalRefs,
  type Language,
  type Meeting,
  type MeetingPatch,
} from '../../core/types';
import { externalMeetingId } from './ids';
import { deepEqual, firstValidIso, isoMs, nextTimestamp } from './util';

export interface ExternalPlanContext {
  uid: string;
  now: Date;
  defaultTimezone: string;
  defaultLanguage: Language;
}

export interface PlannedExternalWrite {
  meeting: Meeting;
  mode: 'create' | 'set';
  outcome: 'created' | 'updated' | 'removed' | 'refs_only';
  /** Provider of the event that produced this write (write origin calendar_<provider>). */
  provider: CalendarProvider;
}

/** Kept for existing imports: `invalid` is now part of the core UpsertExternalResult. */
export type ExternalUpsertResultWithInvalid = UpsertExternalResult;

export interface ExternalUpsertPlan {
  writes: PlannedExternalWrite[];
  result: ExternalUpsertResultWithInvalid;
  /** Item index + reason for skipped invalid items (ids only; no event content). */
  invalidItems: { index: number; externalId: string; reason: string }[];
}

type MeetingLookup = ReadonlyMap<string, Meeting>;

function matchesExternal(meeting: Meeting, provider: CalendarProvider, externalId: string, calendarId?: string): boolean {
  if (provider === 'google') return meeting.external.googleEventId === externalId;
  if (provider === 'outlook') return meeting.external.outlookEventId === externalId;
  if (meeting.external.deviceEventId !== externalId) return false;
  return calendarId === undefined || meeting.external.deviceCalendarId === null || meeting.external.deviceCalendarId === calendarId;
}

/** Finds the meeting linked to a provider event; active meetings are preferred over tombstones. */
export function findExternalMatch(
  meetings: MeetingLookup,
  provider: CalendarProvider,
  externalId: string,
  calendarId?: string,
): Meeting | null {
  let tombstoned: Meeting | null = null;
  for (const meeting of meetings.values()) {
    if (!matchesExternal(meeting, provider, externalId, calendarId)) continue;
    if (meeting.deletedAt === null) return meeting;
    tombstoned = tombstoned ?? meeting;
  }
  if (tombstoned) return tombstoned;
  if (provider === 'google') {
    const decoded = meetingIdFromGoogleEventId(externalId);
    const byDecoded = decoded ? meetings.get(decoded) : undefined;
    if (byDecoded) return byDecoded;
  }
  if (calendarId !== undefined || provider === 'google') {
    const byImportId = meetings.get(externalMeetingId(provider, calendarId ?? '', externalId));
    if (byImportId) return byImportId;
  }
  return null;
}

function refsFor(item: ExternalMeetingUpsert): Partial<ExternalRefs> {
  if (item.provider === 'google') {
    return {
      googleEventId: item.externalId,
      googleCalendarId: item.calendarId,
      googleEtag: item.etag,
      googleUpdatedAt: firstValidIso(item.providerUpdatedAt),
    };
  }
  if (item.provider === 'outlook') {
    return {
      outlookEventId: item.externalId,
      outlookCalendarId: item.calendarId,
      outlookChangeKey: item.etag,
      outlookUpdatedAt: firstValidIso(item.providerUpdatedAt),
    };
  }
  return { deviceEventId: item.externalId, deviceCalendarId: item.calendarId };
}

function patchFrom(item: ExternalMeetingUpsert): MeetingPatch {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(item.meeting ?? {})) {
    if (value !== undefined) patch[key] = value;
  }
  return patch as MeetingPatch;
}

function withoutVolatile(meeting: Meeting): Omit<Meeting, 'updatedAt' | 'external'> {
  const { updatedAt: _updatedAt, external: _external, ...rest } = meeting;
  return rest;
}

function newMeetingId(item: ExternalMeetingUpsert): string {
  if (item.provider === 'google') {
    const decoded = meetingIdFromGoogleEventId(item.externalId);
    if (decoded) return decoded;
  }
  return externalMeetingId(item.provider, item.calendarId, item.externalId);
}

function describeError(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) return String((error as { code: unknown }).code);
  return 'invalid';
}

export function planExternalUpserts(
  items: readonly ExternalMeetingUpsert[],
  meetings: MeetingLookup,
  ctx: ExternalPlanContext,
): ExternalUpsertPlan {
  const working = new Map(meetings);
  const writes = new Map<string, PlannedExternalWrite>();
  const result: ExternalUpsertResultWithInvalid = { created: 0, updated: 0, removed: 0, unchanged: 0, changedIds: [], invalid: 0 };
  const invalidItems: ExternalUpsertPlan['invalidItems'] = [];
  const changed = new Set<string>();

  const record = (planned: PlannedExternalWrite): void => {
    const previous = writes.get(planned.meeting.id);
    // Keep "create" when the same document is written twice in one batch.
    const mode = previous?.mode === 'create' ? 'create' : planned.mode;
    writes.set(planned.meeting.id, { ...planned, mode });
    working.set(planned.meeting.id, planned.meeting);
    if (planned.outcome === 'refs_only') {
      result.unchanged += 1;
      return;
    }
    result[planned.outcome] += 1;
    changed.add(planned.meeting.id);
  };

  items.forEach((item, index) => {
    try {
      if (item.externalId.length === 0) throw new Error('empty external id');
      const existing = findExternalMatch(working, item.provider, item.externalId, item.calendarId);
      const refs = refsFor(item);
      const providerMs = isoMs(item.providerUpdatedAt);

      if (item.deleted) {
        if (!existing || existing.deletedAt !== null) {
          result.unchanged += 1;
          return;
        }
        const importedFromProvider = existing.source === item.provider;
        // Google/Outlook: the calendar engine never sends an upsert while a local push of that
        // meeting is pending, so a provider deletion always wins here (updatedAt also moves for
        // MeetingGuard-only edits and ref write-backs, which must not mask a provider change).
        const localNewer = item.provider === 'device' && providerMs !== null && (isoMs(existing.updatedAt) ?? 0) > providerMs;
        if (!importedFromProvider && localNewer) {
          result.unchanged += 1;
          return;
        }
        const tombstone = tombstoneMeeting(existing, nextTimestamp(ctx.now, existing.updatedAt));
        record({ meeting: { ...tombstone, external: { ...tombstone.external, ...refs } }, mode: 'set', outcome: 'removed', provider: item.provider });
        return;
      }

      if (!item.meeting) throw new Error('missing meeting payload');

      if (!existing) {
        const meeting = buildMeeting(
          { ...item.meeting, source: item.provider, external: refs },
          {
            id: newMeetingId(item),
            userId: ctx.uid,
            now: ctx.now,
            defaultTimezone: ctx.defaultTimezone,
            defaultLanguage: ctx.defaultLanguage,
          },
        );
        record({ meeting, mode: 'create', outcome: 'created', provider: item.provider });
        return;
      }

      const storedEtag =
        item.provider === 'google' ? existing.external.googleEtag : item.provider === 'outlook' ? existing.external.outlookChangeKey : null;
      if (item.etag !== null && storedEtag === item.etag && existing.deletedAt === null) {
        result.unchanged += 1;
        return;
      }

      const existingMs = isoMs(existing.updatedAt) ?? 0;
      const storedProviderMs =
        item.provider === 'google'
          ? isoMs(existing.external.googleUpdatedAt)
          : item.provider === 'outlook'
            ? isoMs(existing.external.outlookUpdatedAt)
            : null;
      const providerChanged = providerMs === null || storedProviderMs === null || providerMs > storedProviderMs;

      if (existing.deletedAt !== null) {
        const deletedMs = isoMs(existing.deletedAt) ?? existingMs;
        if (providerMs === null || providerMs <= deletedMs) {
          result.unchanged += 1;
          return;
        }
        const patched = applyMeetingPatch(existing, { ...patchFrom(item), external: refs }, nextTimestamp(ctx.now, existing.updatedAt));
        record({ meeting: { ...patched, deletedAt: null }, mode: 'set', outcome: 'updated', provider: item.provider });
        return;
      }

      // Google/Outlook changes are detected by the stored provider timestamp (providerChanged)
      // only: local updatedAt also moves for MeetingGuard-only fields and ref write-backs, and
      // comparing it would skip a real provider edit while storing its new etag/changeKey (never
      // pulled again). Conflicts with pending local pushes are resolved by the calendar engine
      // before it upserts. Device imports keep last-writer-wins on updatedAt.
      const localNewer = item.provider === 'device' && providerMs !== null && existingMs > providerMs;
      const timestamp = nextTimestamp(ctx.now, existing.updatedAt);
      const contentPatch = providerChanged && !localNewer ? patchFrom(item) : {};
      const next = applyMeetingPatch(existing, { ...contentPatch, external: refs }, timestamp);
      const contentChanged = !deepEqual(withoutVolatile(next), withoutVolatile(existing));
      const refsChanged = !deepEqual(next.external, existing.external);
      if (!contentChanged && !refsChanged) {
        result.unchanged += 1;
        return;
      }
      record({ meeting: next, mode: 'set', outcome: contentChanged ? 'updated' : 'refs_only', provider: item.provider });
    } catch (error) {
      result.invalid += 1;
      invalidItems.push({ index, externalId: item.externalId, reason: describeError(error) });
    }
  });

  result.changedIds = [...changed];
  return { writes: [...writes.values()], result, invalidItems };
}
