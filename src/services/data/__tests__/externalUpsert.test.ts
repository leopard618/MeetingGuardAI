import type { ExternalMeetingUpsert } from '../../../core/contracts';
import { googleEventIdForMeeting } from '../../../core/identifiers';
import { buildMeeting, type Meeting } from '../../../core/types';
import { planExternalUpserts } from '../externalUpsert';
import { externalMeetingId } from '../ids';

const now = new Date('2026-10-01T10:00:00.000Z');
const ctx = { uid: 'u1', now, defaultTimezone: 'Europe/Madrid', defaultLanguage: 'es' as const };

function googleItem(partial: Partial<ExternalMeetingUpsert> = {}): ExternalMeetingUpsert {
  return {
    provider: 'google',
    externalId: 'abc123',
    calendarId: 'primary',
    etag: '"e1"',
    providerUpdatedAt: '2026-10-01T09:00:00.000Z',
    deleted: false,
    meeting: { title: 'Standup', startAt: '2026-10-05T07:00:00.000Z', durationMinutes: 15, timezone: 'Europe/Madrid' },
    ...partial,
  };
}

function lookup(...meetings: Meeting[]): Map<string, Meeting> {
  return new Map(meetings.map((meeting) => [meeting.id, meeting]));
}

describe('planExternalUpserts', () => {
  it('creates new events with a deterministic id, source = provider and the google refs', () => {
    const plan = planExternalUpserts([googleItem()], new Map(), ctx);
    expect(plan.result).toMatchObject({ created: 1, updated: 0, removed: 0, unchanged: 0, invalid: 0 });
    const write = plan.writes[0];
    expect(write?.mode).toBe('create');
    expect(write?.meeting.id).toBe(externalMeetingId('google', 'primary', 'abc123'));
    expect(write?.meeting).toMatchObject({ source: 'google', title: 'Standup', date: '2026-10-05', time: '09:00' });
    expect(write?.meeting.external).toMatchObject({ googleEventId: 'abc123', googleEtag: '"e1"', googleUpdatedAt: '2026-10-01T09:00:00.000Z' });
  });

  it('is idempotent: importing the same batch again changes nothing (etag unchanged)', () => {
    const first = planExternalUpserts([googleItem()], new Map(), ctx);
    const existing = lookup(...first.writes.map((write) => write.meeting));
    const second = planExternalUpserts([googleItem()], existing, ctx);
    expect(second.writes).toHaveLength(0);
    expect(second.result).toMatchObject({ created: 0, unchanged: 1 });
  });

  it('applies provider changes but keeps Meeting Guard-only fields', () => {
    const base = planExternalUpserts([googleItem()], new Map(), ctx).writes[0]!.meeting;
    const enriched: Meeting = { ...base, customAlertTimes: [30, 10], preparationTips: ['Bring numbers'], confidence: 90 };
    const plan = planExternalUpserts(
      [googleItem({ etag: '"e2"', providerUpdatedAt: '2026-10-01T11:00:00.000Z', meeting: { title: 'Daily standup', startAt: '2026-10-05T08:00:00.000Z' } })],
      lookup(enriched),
      { ...ctx, now: new Date('2026-10-01T11:30:00.000Z') },
    );
    expect(plan.result).toMatchObject({ updated: 1, changedIds: [base.id] });
    expect(plan.writes[0]?.meeting).toMatchObject({
      title: 'Daily standup',
      time: '10:00',
      customAlertTimes: [30, 10],
      preparationTips: ['Bring numbers'],
      confidence: 90,
      source: 'google',
    });
  });

  it('applies a Google change even when the local copy was touched later (Meeting Guard-only edit)', () => {
    const base = planExternalUpserts([googleItem()], new Map(), ctx).writes[0]!.meeting;
    // Local updatedAt moved after the Google edit (e.g. alert times changed in the app).
    const touched: Meeting = { ...base, customAlertTimes: [30], updatedAt: '2026-10-01T12:00:00.000Z' };
    const plan = planExternalUpserts(
      [googleItem({ etag: '"e2"', providerUpdatedAt: '2026-10-01T11:00:00.000Z', meeting: { title: 'Renamed in Google', startAt: base.startAt } })],
      lookup(touched),
      ctx,
    );
    expect(plan.result).toMatchObject({ updated: 1, changedIds: [base.id] });
    expect(plan.writes[0]?.meeting).toMatchObject({ title: 'Renamed in Google', customAlertTimes: [30] });
    expect(plan.writes[0]?.meeting.external.googleEtag).toBe('"e2"');
  });

  it('keeps a newer local edit of a device import (last-writer-wins) and only stores the refs', () => {
    const deviceItem = (partial: Partial<ExternalMeetingUpsert> = {}): ExternalMeetingUpsert => ({
      provider: 'device',
      externalId: 'ev1',
      calendarId: 'cal1',
      etag: null,
      providerUpdatedAt: '2026-10-01T09:00:00.000Z',
      deleted: false,
      meeting: { title: 'Dentist', startAt: '2026-10-07T15:00:00.000Z' },
      ...partial,
    });
    const base = planExternalUpserts([deviceItem()], new Map(), ctx).writes[0]!.meeting;
    const edited: Meeting = { ...base, title: 'Edited in app', updatedAt: '2026-10-01T12:00:00.000Z' };
    const plan = planExternalUpserts(
      [deviceItem({ providerUpdatedAt: '2026-10-01T11:00:00.000Z', meeting: { title: 'Old title', startAt: base.startAt } })],
      lookup(edited),
      ctx,
    );
    expect(plan.result).toMatchObject({ updated: 0, changedIds: [] });
    expect(plan.writes.every((write) => write.meeting.title === 'Edited in app')).toBe(true);
  });

  it('tombstones meetings whose event was deleted and resurrects them only for a newer provider change', () => {
    const base = planExternalUpserts([googleItem()], new Map(), ctx).writes[0]!.meeting;
    const removed = planExternalUpserts([googleItem({ deleted: true, meeting: null, providerUpdatedAt: '2026-10-01T09:30:00.000Z' })], lookup(base), ctx);
    expect(removed.result).toMatchObject({ removed: 1 });
    const tombstone = removed.writes[0]!.meeting;
    expect(tombstone.deletedAt).not.toBeNull();

    const stale = planExternalUpserts([googleItem({ etag: '"e3"', providerUpdatedAt: '2026-10-01T09:45:00.000Z' })], lookup(tombstone), ctx);
    expect(stale.result).toMatchObject({ unchanged: 1 });

    const newer = planExternalUpserts(
      [googleItem({ etag: '"e4"', providerUpdatedAt: '2026-10-02T09:00:00.000Z' })],
      lookup(tombstone),
      { ...ctx, now: new Date('2026-10-02T09:05:00.000Z') },
    );
    expect(newer.result).toMatchObject({ updated: 1 });
    expect(newer.writes[0]?.meeting.deletedAt).toBeNull();
  });

  it('matches Meeting Guard-created Google events back to their meeting (no duplicate)', () => {
    const own = buildMeeting(
      { title: 'Planning', startAt: '2026-10-06T09:00:00.000Z', source: 'manual' },
      { id: 'meet1', userId: 'u1', now, defaultTimezone: 'Europe/Madrid', defaultLanguage: 'en' },
    );
    const plan = planExternalUpserts(
      [googleItem({ externalId: googleEventIdForMeeting('meet1'), providerUpdatedAt: '2026-10-01T11:00:00.000Z', meeting: { title: 'Planning (moved)', startAt: '2026-10-06T10:00:00.000Z' } })],
      lookup(own),
      { ...ctx, now: new Date('2026-10-01T11:01:00.000Z') },
    );
    expect(plan.writes).toHaveLength(1);
    expect(plan.writes[0]?.meeting).toMatchObject({ id: 'meet1', source: 'manual', title: 'Planning (moved)' });
    expect(plan.writes[0]?.meeting.external.googleEventId).toBe(googleEventIdForMeeting('meet1'));
  });

  it('counts invalid items without failing the batch', () => {
    const plan = planExternalUpserts(
      [googleItem({ externalId: 'bad', meeting: { title: '', startAt: 'not a date' } }), googleItem({ externalId: 'ok1' })],
      new Map(),
      ctx,
    );
    expect(plan.result).toMatchObject({ created: 1, invalid: 1 });
    expect(plan.invalidItems[0]).toMatchObject({ index: 0, externalId: 'bad', reason: 'invalid_input' });
  });

  it('uses a hashed id for device events whose ids are not document-safe', () => {
    const plan = planExternalUpserts(
      [{ provider: 'device', externalId: 'ABC:DEF/1', calendarId: 'cal:1', etag: null, providerUpdatedAt: null, deleted: false, meeting: { title: 'Dentist', startAt: '2026-10-07T15:00:00.000Z' } }],
      new Map(),
      ctx,
    );
    const id = plan.writes[0]?.meeting.id ?? '';
    expect(id).toMatch(/^d_h[0-9a-f]{16}$/);
    expect(plan.writes[0]?.meeting).toMatchObject({ source: 'device', external: { deviceEventId: 'ABC:DEF/1', deviceCalendarId: 'cal:1' } });
  });

  it("a guest-less calendar copy never clears a Meeting Guard meeting's participants; an imported one follows its calendar", () => {
    const own = buildMeeting(
      { title: 'Prueba', startAt: '2026-10-06T09:00:00.000Z', source: 'manual', participants: [{ email: 'guest@example.com' }] },
      { id: 'meet1', userId: 'u1', now, defaultTimezone: 'Europe/Madrid', defaultLanguage: 'en' },
    );
    const plan = planExternalUpserts(
      [googleItem({ externalId: googleEventIdForMeeting('meet1'), providerUpdatedAt: '2026-10-01T11:00:00.000Z', meeting: { title: 'Prueba 2', startAt: '2026-10-06T09:00:00.000Z', participants: [] } })],
      lookup(own),
      { ...ctx, now: new Date('2026-10-01T11:01:00.000Z') },
    );
    expect(plan.writes[0]?.meeting).toMatchObject({ title: 'Prueba 2', participants: [{ email: 'guest@example.com' }] });

    const imported = planExternalUpserts([googleItem({ meeting: { ...googleItem().meeting!, participants: [{ email: 'guest@example.com' }] } })], new Map(), ctx).writes[0]!.meeting;
    const cleared = planExternalUpserts(
      [googleItem({ etag: '"e2"', providerUpdatedAt: '2026-10-01T11:00:00.000Z', meeting: { ...googleItem().meeting!, participants: [] } })],
      lookup(imported),
      { ...ctx, now: new Date('2026-10-01T11:01:00.000Z') },
    );
    expect(cleared.writes[0]?.meeting.participants).toEqual([]);
  });

  describe('copies of one meeting across Google and Outlook (both connected)', () => {
    const own = buildMeeting(
      { title: 'Reunión Dusko', startAt: '2026-10-05T17:53:00.000Z', durationMinutes: 4, source: 'manual' },
      { id: 'own1', userId: 'u1', now, defaultTimezone: 'Europe/Madrid', defaultLanguage: 'es' },
    );
    const outlookItem = (partial: Partial<ExternalMeetingUpsert> = {}): ExternalMeetingUpsert =>
      googleItem({
        provider: 'outlook',
        externalId: 'AAMkInvite',
        calendarId: 'cal',
        etag: 'ck1',
        meeting: { title: ' reunión  dusko ', startAt: '2026-10-05T19:53:00+02:00', durationMinutes: 4, timezone: 'Europe/Madrid' },
        ...partial,
      });

    it('an invitation copy of a Meeting Guard meeting is not imported', () => {
      const plan = planExternalUpserts([outlookItem()], lookup(own), ctx);
      expect(plan.writes).toHaveLength(0);
      expect(plan.result).toMatchObject({ created: 0, unchanged: 1 });
    });

    it('an event imported from one calendar is not imported again from the other', () => {
      const fromOutlook = planExternalUpserts([outlookItem({ meeting: { title: 'Board', startAt: '2026-10-07T08:00:00.000Z', durationMinutes: 60 } })], new Map(), ctx)
        .writes[0]!.meeting;
      const plan = planExternalUpserts([googleItem({ meeting: { title: 'Board', startAt: '2026-10-07T08:00:00.000Z', durationMinutes: 60 } })], lookup(fromOutlook), ctx);
      expect(plan.result).toMatchObject({ created: 0, unchanged: 1 });
    });

    it('a different title, start or length is a different meeting; device events and deleted meetings never match', () => {
      const deleted: Meeting = { ...own, id: 'own2', title: 'Old', deletedAt: '2026-10-01T09:00:00.000Z' };
      const plan = planExternalUpserts(
        [
          outlookItem({ externalId: 'a', meeting: { title: 'Reunión Dusko 2', startAt: '2026-10-05T17:53:00.000Z', durationMinutes: 4 } }),
          outlookItem({ externalId: 'b', meeting: { title: 'Reunión Dusko', startAt: '2026-10-05T17:54:00.000Z', durationMinutes: 4 } }),
          outlookItem({ externalId: 'c', meeting: { title: 'Reunión Dusko', startAt: '2026-10-05T17:53:00.000Z', durationMinutes: 30 } }),
          googleItem({ provider: 'device', externalId: 'd', calendarId: 'cal:1', meeting: { title: 'Reunión Dusko', startAt: '2026-10-05T17:53:00.000Z', durationMinutes: 4 } }),
          outlookItem({ externalId: 'e', meeting: { title: 'Old', startAt: '2026-10-05T17:53:00.000Z', durationMinutes: 4 } }),
        ],
        lookup(own, deleted),
        ctx,
      );
      expect(plan.result.created).toBe(5);
    });

    it('a copy imported before is removed (locally) by the next batch from its calendar and stays removed', () => {
      const copy = buildMeeting(
        { title: 'Reunión Dusko', startAt: '2026-10-05T17:53:00.000Z', durationMinutes: 4, source: 'outlook', external: { outlookEventId: 'AAMkInvite', outlookChangeKey: 'ck1' } },
        { id: 'o_copy', userId: 'u1', now, defaultTimezone: 'Europe/Madrid', defaultLanguage: 'es' },
      );
      const unrelated = outlookItem({ externalId: 'other', meeting: { title: 'Lunch', startAt: '2026-10-08T12:00:00.000Z', durationMinutes: 60 } });
      const plan = planExternalUpserts([unrelated], lookup(own, copy), ctx);
      expect(plan.result).toMatchObject({ created: 1, removed: 1 });
      const removed = plan.writes.find((write) => write.meeting.id === 'o_copy')!;
      expect(removed).toMatchObject({ mode: 'set', outcome: 'removed', provider: 'outlook' });
      expect(removed.meeting.deletedAt).not.toBeNull();
      // The Meeting Guard meeting is untouched.
      expect(plan.writes.some((write) => write.meeting.id === 'own1')).toBe(false);

      // A later change of the copy in Outlook does not bring it back while it still copies the meeting.
      const later = planExternalUpserts(
        [outlookItem({ etag: 'ck2', providerUpdatedAt: '2026-10-02T09:00:00.000Z' })],
        lookup(own, removed.meeting),
        { ...ctx, now: new Date('2026-10-02T09:30:00.000Z') },
      );
      expect(later.writes).toHaveLength(0);
      expect(later.result).toMatchObject({ unchanged: 1 });
    });

    it('a Google batch leaves Outlook imports alone, and a copy of an import (not a Meeting Guard meeting) is kept', () => {
      const outlookCopy = buildMeeting(
        { title: 'Reunión Dusko', startAt: '2026-10-05T17:53:00.000Z', durationMinutes: 4, source: 'outlook', external: { outlookEventId: 'AAMkInvite' } },
        { id: 'o_copy', userId: 'u1', now, defaultTimezone: 'Europe/Madrid', defaultLanguage: 'es' },
      );
      const google = planExternalUpserts([googleItem()], lookup(own, outlookCopy), ctx);
      expect(google.writes.some((write) => write.meeting.id === 'o_copy')).toBe(false);
      const googleImport = buildMeeting(
        { title: 'Board', startAt: '2026-10-07T08:00:00.000Z', durationMinutes: 60, source: 'google', external: { googleEventId: 'g1' } },
        { id: 'g_board', userId: 'u1', now, defaultTimezone: 'Europe/Madrid', defaultLanguage: 'es' },
      );
      const outlookImport = buildMeeting(
        { title: 'Board', startAt: '2026-10-07T08:00:00.000Z', durationMinutes: 60, source: 'outlook', external: { outlookEventId: 'o1' } },
        { id: 'o_board', userId: 'u1', now, defaultTimezone: 'Europe/Madrid', defaultLanguage: 'es' },
      );
      const plan = planExternalUpserts([outlookItem({ externalId: 'other', meeting: { title: 'Lunch', startAt: '2026-10-08T12:00:00.000Z', durationMinutes: 60 } })], lookup(googleImport, outlookImport), ctx);
      expect(plan.result.removed).toBe(0);
    });
  });
});
