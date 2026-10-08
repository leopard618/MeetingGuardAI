import {
  FollowUpMeetingNotFoundError,
  approximateSize,
  assignRefs,
  buildMeetingContext,
  collectWithinBudget,
  compactRecurrence,
  loadMeetingContext,
  toModelView,
  type MeetingRecord,
} from '../../src/assistant/context';
import type { RecurrenceRule } from '../../src/shared/aiContract';
import { FakeMeetingReader, meetingDoc } from './fakes';

const NOW = new Date('2026-10-05T10:00:00.000Z');

function record(id: string, startAt: string, overrides: Parameters<typeof meetingDoc>[0] = {}): MeetingRecord {
  return { id, doc: meetingDoc({ startAt, ...overrides }) };
}

describe('assignRefs', () => {
  it('produces short, deterministic, unique refs', () => {
    const ids = Array.from({ length: 300 }, (_, index) => `meeting_${index}`);
    const first = assignRefs(ids);
    const second = assignRefs([...ids].reverse());
    expect(new Set(first.values()).size).toBe(ids.length);
    for (const id of ids) {
      expect(first.get(id)).toMatch(/^m[a-z2-7]{7}$/);
      expect(second.get(id)).toBe(first.get(id));
    }
    expect(first.get('meeting_1')).not.toContain('meeting');
  });
});

describe('buildMeetingContext', () => {
  it('drops tombstones and unparsable starts, sorts by start', () => {
    const context = buildMeetingContext(
      [
        record('b', '2026-10-06T09:00:00.000Z'),
        record('a', '2026-10-05T09:00:00.000Z'),
        record('deleted', '2026-10-05T11:00:00.000Z', { deletedAt: '2026-10-01T00:00:00.000Z' }),
        record('broken', 'not a date'),
      ],
      NOW,
      { followUpMeetingId: null },
    );
    expect(context.meetings.map((meeting) => meeting.meetingId)).toEqual(['a', 'b']);
    expect(context.skippedInvalid).toBe(1);
    expect(context.byRef.get(context.meetings[0]!.ref)?.meetingId).toBe('a');
    expect(context.followUp).toBeNull();
  });

  it('keeps the meetings closest to now, and always the follow-up meeting', () => {
    const records = [
      record('far_past', '2026-09-28T10:00:00.000Z'),
      record('near', '2026-10-05T12:00:00.000Z'),
      record('soon', '2026-10-06T10:00:00.000Z'),
      record('far_future', '2026-11-30T10:00:00.000Z'),
    ];
    const context = buildMeetingContext(records, NOW, { followUpMeetingId: 'far_past', maxMeetings: 2 });
    expect(context.meetings.map((meeting) => meeting.meetingId)).toEqual(['far_past', 'near']);
    expect(context.followUp?.meetingId).toBe('far_past');
  });
});

describe('loadMeetingContext', () => {
  it('queries the [-7 d, +60 d] window', async () => {
    const reader = new FakeMeetingReader().add('m1', { startAt: '2026-10-06T10:00:00.000Z' });
    const context = await loadMeetingContext(reader, 'u1', NOW, null);
    expect(reader.rangeCalls).toEqual([
      { fromIso: '2026-09-28T10:00:00.000Z', toIso: '2026-12-04T10:00:00.000Z', limit: 400 },
    ]);
    expect(context.meetings).toHaveLength(1);
  });

  it('adds a follow-up meeting outside the window and rejects missing or deleted ones', async () => {
    const reader = new FakeMeetingReader()
      .add('old', { startAt: '2026-09-01T10:00:00.000Z' })
      .add('gone', { startAt: '2026-10-05T08:00:00.000Z', deletedAt: '2026-10-05T09:00:00.000Z' });
    const context = await loadMeetingContext(reader, 'u1', NOW, 'old');
    expect(context.followUp?.meetingId).toBe('old');
    await expect(loadMeetingContext(reader, 'u1', NOW, 'missing')).rejects.toBeInstanceOf(FollowUpMeetingNotFoundError);
    await expect(loadMeetingContext(reader, 'u1', NOW, 'gone')).rejects.toBeInstanceOf(FollowUpMeetingNotFoundError);
  });
});

describe('toModelView', () => {
  const participants = Array.from({ length: 12 }, (_, index) => ({ email: `Person${index}@Example.com`, name: null }));

  it('sends minimal fields: no links, passwords or descriptions', () => {
    const [meeting] = buildMeetingContext(
      [
        record('m1', '2026-10-05T14:00:00.000Z', {
          title: 'Budget review',
          description: 'Secret agenda',
          timezone: 'Europe/Madrid',
          conference: { provider: 'zoom', url: 'https://zoom.us/j/123', password: 'pw123' },
          location: { type: 'hybrid', address: 'Room 4', virtualUrl: 'https://example.com/room' },
          participants,
        }),
      ],
      NOW,
      { followUpMeetingId: null },
    ).meetings;
    const view = toModelView(meeting!, 'America/Bogota', false);
    expect(view).toMatchObject({
      title: 'Budget review',
      start: '2026-10-05 09:00',
      weekday: 'Monday',
      allDay: false,
      meetingTimeZone: 'Europe/Madrid',
      conference: { provider: 'zoom', hasLink: true },
      location: { type: 'hybrid', address: 'Room 4' },
      participantsTotal: 12,
    });
    expect(view.participants).toHaveLength(10);
    expect(view.participants[0]).toEqual({ email: 'person0@example.com', name: null });
    const json = JSON.stringify(view);
    expect(json).not.toContain('zoom.us');
    expect(json).not.toContain('pw123');
    expect(json).not.toContain('example.com/room');
    expect(json).not.toContain('Secret agenda');
  });

  it('sends participant names so "the meeting with Alejandro" can be resolved', () => {
    const [meeting] = buildMeetingContext(
      [
        record('q3', '2026-10-05T14:00:00.000Z', {
          title: 'Q3 planning',
          participants: [{ email: 'APZ@corp.com', name: 'Alejandro Pérez' }],
        }),
      ],
      NOW,
      { followUpMeetingId: null },
    ).meetings;
    expect(toModelView(meeting!, 'UTC', false).participants).toEqual([{ email: 'apz@corp.com', name: 'Alejandro Pérez' }]);
  });

  it('includes the description of the follow-up meeting and shows all-day dates in their own zone', () => {
    const context = buildMeetingContext(
      [
        record('f', '2026-10-05T08:00:00.000Z', { description: 'Discuss hiring plan', timezone: 'UTC' }),
        record('d', '2026-10-06T22:00:00.000Z', { allDay: true, timezone: 'Europe/Madrid', durationMinutes: 1440 }),
      ],
      NOW,
      { followUpMeetingId: 'f' },
    );
    const followUp = toModelView(context.followUp!, 'UTC', true);
    expect(followUp.description).toBe('Discuss hiring plan');
    const allDay = toModelView(context.meetings.find((meeting) => meeting.meetingId === 'd')!, 'America/Bogota', false);
    expect(allDay.start).toBe('2026-10-07');
    expect(allDay.weekday).toBe('Wednesday');
  });
});

describe('collectWithinBudget', () => {
  async function* source(items: { id: string; data: unknown }[], seen: string[]) {
    for (const item of items) {
      seen.push(item.id);
      yield item;
    }
  }
  const doc = (overrides: Parameters<typeof meetingDoc>[0] = {}) => meetingDoc({ startAt: '2026-10-06T10:00:00.000Z', ...overrides });

  it('skips oversized documents and stops reading at the total budget', async () => {
    const seen: string[] = [];
    const huge = doc({ participants: Array.from({ length: 100 }, (_, index) => ({ email: `p${index}@x.com`, name: 'x'.repeat(5_000) })) });
    const result = await collectWithinBudget(
      source(
        [
          { id: 'a', data: doc() },
          { id: 'huge', data: huge },
          { id: 'b', data: doc() },
          { id: 'c', data: doc() },
          { id: 'd', data: doc() },
        ],
        seen,
      ),
      { limit: 100, maxDocBytes: 10_000, maxTotalBytes: approximateSize(doc()) * 3 + 1 },
    );
    expect(result.records.map((record) => record.id)).toEqual(['a', 'b', 'c']);
    expect(result.skipped).toBe(1);
    expect(result.truncated).toBe(true);
    // The source is not drained past the budget.
    expect(seen).toEqual(['a', 'huge', 'b', 'c', 'd']);
  });

  it('stops at the record limit and counts malformed documents', async () => {
    const seen: string[] = [];
    const result = await collectWithinBudget(
      source(
        [
          { id: 'bad', data: { startAt: 42 } },
          { id: 'a', data: doc() },
          { id: 'b', data: doc() },
          { id: 'never', data: doc() },
        ],
        seen,
      ),
      { limit: 2, maxDocBytes: 10_000, maxTotalBytes: 1_000_000 },
    );
    expect(result.records.map((record) => record.id)).toEqual(['a', 'b']);
    expect(result.skipped).toBe(1);
    expect(seen).not.toContain('never');
  });
});

describe('recurrence in the context (v2)', () => {
  const weekly: RecurrenceRule = { freq: 'weekly', interval: 1, byWeekday: ['MO', 'WE'], byMonthDay: null, until: null, count: null };

  it('loads recurring masters whose first occurrence left the startAt window', async () => {
    const reader = new FakeMeetingReader()
      .add('inWindow', { startAt: '2026-10-06T10:00:00.000Z' })
      .add('oldSeries', { startAt: '2026-01-05T09:00:00.000Z', recurrence: { ...weekly, byWeekday: ['MO'] } });
    const context = await loadMeetingContext(reader, 'u1', NOW, null);
    expect(reader.recurringCalls).toEqual([{ limit: 100 }]);
    expect(context.meetings.map((meeting) => meeting.meetingId).sort()).toEqual(['inWindow', 'oldSeries']);
  });

  it('does not duplicate a master returned by both queries', async () => {
    const reader = new FakeMeetingReader().add('series', {
      startAt: '2026-10-06T10:00:00.000Z',
      recurrence: { ...weekly },
    });
    const context = await loadMeetingContext(reader, 'u1', NOW, null);
    expect(context.meetings).toHaveLength(1);
  });

  it('describes the rule compactly and marks the view as recurring', () => {
    expect(compactRecurrence({ ...weekly }, 'UTC')).toBe('every week on MO,WE');
    expect(compactRecurrence({ ...weekly, interval: 2, byWeekday: null }, 'UTC')).toBe('every 2 weeks');
    expect(compactRecurrence({ freq: 'daily', interval: 1, byWeekday: null, byMonthDay: null, until: null, count: 10 }, 'UTC')).toBe(
      'every day x10',
    );
    // The until instant is 23:59 on Dec 31 in Madrid = 22:59Z; shown as the MEETING-zone day.
    expect(
      compactRecurrence(
        { freq: 'monthly', interval: 1, byWeekday: null, byMonthDay: 15, until: '2026-12-31T22:59:00.000Z', count: null },
        'Europe/Madrid',
      ),
    ).toBe('every month on day 15 until 2026-12-31');

    const [meeting] = buildMeetingContext(
      [record('m1', '2026-10-05T14:00:00.000Z', { timezone: 'UTC', recurrence: { ...weekly } })],
      NOW,
      { followUpMeetingId: null },
    ).meetings;
    const view = toModelView(meeting!, 'UTC', false);
    expect(view.recurring).toBe(true);
    expect(view.repeats).toBe('every week on MO,WE');

    const oneOff = buildMeetingContext([record('m2', '2026-10-05T14:00:00.000Z')], NOW, { followUpMeetingId: null }).meetings[0]!;
    const plainView = toModelView(oneOff, 'UTC', false);
    expect(plainView.recurring).toBeUndefined();
    expect(plainView.repeats).toBeUndefined();
  });
});
