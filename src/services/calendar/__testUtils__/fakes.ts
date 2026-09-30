/**
 * In-memory fakes for the calendar tests (not shipped: nothing in the app imports this folder).
 */
import type {
  ExternalMeetingUpsert,
  MeetingRange,
  UpsertExternalResult,
  WriteOptions,
} from '../../../core/contracts';
import { AppError } from '../../../core/errors';
import { meetingIdFromGoogleEventId } from '../../../core/identifiers';
import type { WriteOrigin } from '../../../core/events';
import {
  applyMeetingPatch,
  buildMeeting,
  tombstoneMeeting,
  type Meeting,
  type MeetingCreateInput,
  type MeetingPatch,
} from '../../../core/types';
import type { GoogleCalendarApi, ListEventsParams, PatchParams, WriteParams } from '../google/api';
import type { GoogleEvent, GoogleEventList, GoogleEventWrite, SendUpdates } from '../google/types';
import type { StateStore } from '../stateStore';

export const USER_ID = 'user-1';

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class FakeClock {
  constructor(public current: Date) {}
  now = (): Date => new Date(this.current.getTime());
  advanceMinutes(minutes: number): void {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }
}

export function memoryStateStore<T>(initial: T): StateStore<T> & { value: T } {
  const store = {
    value: initial,
    async load() {
      return clone(store.value);
    },
    async update(mutate: (state: T) => T) {
      store.value = mutate(clone(store.value));
      return clone(store.value);
    },
    async clear() {
      store.value = initial;
    },
  };
  return store;
}

/** Meeting repository fake with the documented upsertExternal semantics. */
export class FakeMeetings {
  meetings = new Map<string, Meeting>();
  writes: { id: string; origin: WriteOrigin | undefined; kind: 'create' | 'update' | 'remove' | 'upsert' }[] = [];
  private seq = 0;

  constructor(private clock: FakeClock) {}

  add(input: MeetingCreateInput, id?: string): Meeting {
    this.seq += 1;
    const meeting = buildMeeting(input, {
      id: id ?? `m${this.seq}`,
      userId: USER_ID,
      now: this.clock.now(),
      defaultTimezone: 'UTC',
      defaultLanguage: 'en',
    });
    this.meetings.set(meeting.id, meeting);
    return meeting;
  }

  all(): Meeting[] {
    return [...this.meetings.values()];
  }

  async list(range: MeetingRange = {}): Promise<Meeting[]> {
    return this.all()
      .filter((meeting) => range.includeDeleted === true || meeting.deletedAt === null)
      .filter((meeting) => range.includeCancelled !== false || meeting.status !== 'cancelled')
      .filter((meeting) => range.from === undefined || meeting.startAt >= range.from)
      .filter((meeting) => range.to === undefined || meeting.startAt < range.to)
      .sort((a, b) => a.startAt.localeCompare(b.startAt));
  }

  async get(id: string): Promise<Meeting | null> {
    const meeting = this.meetings.get(id);
    return meeting && meeting.deletedAt === null ? meeting : null;
  }

  async update(id: string, patch: MeetingPatch, options: WriteOptions = {}): Promise<Meeting> {
    const meeting = this.meetings.get(id);
    if (!meeting || meeting.deletedAt !== null) throw new AppError('not_found', 'missing');
    const next = applyMeetingPatch(meeting, patch, this.clock.now());
    this.meetings.set(id, next);
    this.writes.push({ id, origin: options.origin, kind: 'update' });
    return next;
  }

  async remove(id: string, options: WriteOptions = {}): Promise<void> {
    const meeting = this.meetings.get(id);
    if (!meeting || meeting.deletedAt !== null) return;
    this.meetings.set(id, tombstoneMeeting(meeting, this.clock.now()));
    this.writes.push({ id, origin: options.origin, kind: 'remove' });
  }

  async findByExternalId(provider: 'google' | 'device' | 'outlook', externalId: string): Promise<Meeting | null> {
    const linked = this.all().find((meeting) =>
      provider === 'google'
        ? meeting.external.googleEventId === externalId
        : provider === 'outlook'
          ? meeting.external.outlookEventId === externalId
          : meeting.external.deviceEventId === externalId,
    );
    if (linked) return linked;
    // Like the data layer: MeetingGuard's own Google events match their meeting by decoded id.
    const decoded = provider === 'google' ? meetingIdFromGoogleEventId(externalId) : null;
    return decoded ? (this.meetings.get(decoded) ?? null) : null;
  }

  async upsertExternal(items: readonly ExternalMeetingUpsert[]): Promise<UpsertExternalResult> {
    const result: UpsertExternalResult = { created: 0, updated: 0, removed: 0, unchanged: 0, invalid: 0, changedIds: [] };
    for (const item of items) {
      const existing = await this.findByExternalId(item.provider, item.externalId);
      const refs =
        item.provider === 'google'
          ? { googleEventId: item.externalId, googleCalendarId: item.calendarId, googleEtag: item.etag, googleUpdatedAt: item.providerUpdatedAt }
          : { deviceEventId: item.externalId, deviceCalendarId: item.calendarId };
      if (item.deleted) {
        if (existing && existing.deletedAt === null) {
          this.meetings.set(existing.id, tombstoneMeeting(existing, this.clock.now()));
          result.removed += 1;
          result.changedIds.push(existing.id);
        } else {
          result.unchanged += 1;
        }
        continue;
      }
      if (!item.meeting) throw new Error('meeting payload required');
      if (existing) {
        const next = applyMeetingPatch(existing, { ...item.meeting, external: refs }, this.clock.now());
        this.meetings.set(existing.id, next);
        result.updated += 1;
        result.changedIds.push(existing.id);
      } else {
        const created = this.add({ ...item.meeting, source: item.provider, external: refs });
        result.created += 1;
        result.changedIds.push(created.id);
      }
      this.writes.push({ id: existing?.id ?? 'new', origin: item.provider === 'google' ? 'calendar_google' : 'calendar_device', kind: 'upsert' });
    }
    return result;
  }
}

export interface ApiCall {
  method: 'list' | 'get' | 'insert' | 'patch' | 'delete';
  eventId?: string;
  params?: ListEventsParams | WriteParams | PatchParams | { sendUpdates: SendUpdates };
  body?: GoogleEventWrite;
}

export function httpError(status: number, reason: string | null = null): AppError {
  const code = status === 404 || status === 410 ? 'not_found' : status === 409 || status === 412 ? 'conflict' : 'upstream_error';
  return new AppError(code, `HTTP ${status}`, { details: { status, reason } });
}

/** Scriptable Google Calendar: stores events; list responses can be queued explicitly. */
export class FakeGoogleApi implements GoogleCalendarApi {
  events = new Map<string, GoogleEvent>();
  calls: ApiCall[] = [];
  listResponses: (GoogleEventList | AppError)[] = [];
  failures: Partial<Record<ApiCall['method'], AppError[]>> = {};
  /** Returned by insert/patch when conference creation was requested. */
  meetStatusOnCreate: 'pending' | 'success' = 'success';
  private etagSeq = 0;

  constructor(private clock: FakeClock) {}

  private fail(method: ApiCall['method']): void {
    const queue = this.failures[method];
    const next = queue?.shift();
    if (next) throw next;
  }

  private store(event: GoogleEvent): GoogleEvent {
    this.etagSeq += 1;
    const stored = { ...event, etag: `"etag-${this.etagSeq}"`, updated: this.clock.now().toISOString() };
    this.events.set(stored.id, stored);
    return clone(stored);
  }

  private applyWrite(base: GoogleEvent, body: GoogleEventWrite, params: WriteParams): GoogleEvent {
    const { conferenceData, status, ...rest } = body;
    const next: GoogleEvent = { ...base, ...(rest as Partial<GoogleEvent>), status: status ?? base.status ?? 'confirmed' };
    if (conferenceData && params.conferenceDataVersion === 1) {
      next.conferenceData =
        this.meetStatusOnCreate === 'success'
          ? {
              conferenceSolution: { key: { type: 'hangoutsMeet' } },
              entryPoints: [{ entryPointType: 'video', uri: `https://meet.google.com/abc-${base.id.slice(-4)}` }],
              createRequest: { status: { statusCode: 'success' } },
            }
          : { createRequest: { conferenceSolutionKey: { type: 'hangoutsMeet' }, status: { statusCode: 'pending' } } };
      if (this.meetStatusOnCreate === 'success') next.hangoutLink = `https://meet.google.com/abc-${base.id.slice(-4)}`;
    }
    return next;
  }

  /** Completes pending Meet creations (next get returns the link). */
  completeMeetCreation(eventId: string): void {
    const event = this.events.get(eventId);
    if (!event) return;
    event.conferenceData = {
      conferenceSolution: { key: { type: 'hangoutsMeet' } },
      entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/xyz-done' }],
      createRequest: { status: { statusCode: 'success' } },
    };
    event.hangoutLink = 'https://meet.google.com/xyz-done';
  }

  async listEvents(_calendarId: string, params: ListEventsParams): Promise<GoogleEventList> {
    this.calls.push({ method: 'list', params });
    this.fail('list');
    const next = this.listResponses.shift();
    if (next instanceof AppError) throw next;
    if (next) return clone(next);
    return { items: [...this.events.values()].map((event) => clone(event)), nextSyncToken: 'token-default', timeZone: 'UTC' };
  }

  async getEvent(_calendarId: string, eventId: string): Promise<GoogleEvent> {
    this.calls.push({ method: 'get', eventId });
    this.fail('get');
    const event = this.events.get(eventId);
    if (!event) throw httpError(404, 'notFound');
    return clone(event);
  }

  async insertEvent(_calendarId: string, body: GoogleEventWrite, params: WriteParams): Promise<GoogleEvent> {
    this.calls.push({ method: 'insert', eventId: body.id, params, body });
    this.fail('insert');
    if (!body.id) throw new Error('fake requires ids');
    if (this.events.has(body.id)) throw httpError(409, 'duplicate');
    return this.store(this.applyWrite({ id: body.id }, body, params));
  }

  async patchEvent(_calendarId: string, eventId: string, body: GoogleEventWrite, params: PatchParams): Promise<GoogleEvent> {
    this.calls.push({ method: 'patch', eventId, params, body });
    this.fail('patch');
    const existing = this.events.get(eventId);
    if (!existing) throw httpError(404, 'notFound');
    if (params.ifMatch && params.ifMatch !== existing.etag) throw httpError(412, 'conditionNotMet');
    return this.store(this.applyWrite(existing, body, params));
  }

  async deleteEvent(_calendarId: string, eventId: string, params: { sendUpdates: SendUpdates }): Promise<void> {
    this.calls.push({ method: 'delete', eventId, params });
    this.fail('delete');
    const existing = this.events.get(eventId);
    if (!existing || existing.status === 'cancelled') throw httpError(410, 'deleted');
    this.store({ ...existing, status: 'cancelled' });
  }
}
