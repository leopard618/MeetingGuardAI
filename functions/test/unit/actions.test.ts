import { mapToolCalls, type MappingContext, type ToolCall } from '../../src/assistant/actions';
import { buildMeetingContext, type MeetingContext } from '../../src/assistant/context';
import { aiActionSchema, type AiAction } from '../../src/shared/aiContract';
import { meetingDoc } from './fakes';

// Monday 2026-09-28, 16:15 in Madrid.
const NOW = new Date('2026-09-28T14:15:00.000Z');
const USER_TZ = 'Europe/Madrid';

const baseContext: MeetingContext = buildMeetingContext(
  [
    {
      id: 'standup',
      doc: meetingDoc({
        title: 'Standup',
        startAt: '2026-09-29T07:00:00.000Z', // 09:00 Madrid
        durationMinutes: 15,
        participants: [{ email: 'ana@example.com', name: 'Ana' }],
        conference: { provider: 'zoom', url: 'https://zoom.us/j/111', password: 'abc' },
        location: { type: 'physical', address: 'Room 1', virtualUrl: null },
      }),
    },
    { id: 'marketing', doc: meetingDoc({ title: 'Marketing', startAt: '2026-09-30T13:00:00.000Z' }) },
    {
      id: 'offsite',
      doc: meetingDoc({ title: 'Offsite', startAt: '2026-10-01T22:00:00.000Z', allDay: true, durationMinutes: 1440 }),
    },
    {
      id: 'big',
      doc: meetingDoc({
        title: 'All hands',
        startAt: '2026-10-02T08:00:00.000Z',
        participants: Array.from({ length: 12 }, (_, index) => ({ email: `p${index}@corp.com`, name: null })),
      }),
    },
    {
      // Recurring master: every Monday 09:00 Madrid since the first of the month.
      id: 'series',
      doc: meetingDoc({
        title: 'Weekly standup',
        startAt: '2026-09-07T07:00:00.000Z',
        durationMinutes: 15,
        recurrence: { freq: 'weekly', interval: 1, byWeekday: ['MO'], byMonthDay: null, until: null, count: null },
      }),
    },
  ],
  NOW,
  { followUpMeetingId: null },
);

function ref(meetingId: string): string {
  const meeting = baseContext.meetings.find((item) => item.meetingId === meetingId);
  if (!meeting) throw new Error(`no meeting ${meetingId}`);
  return meeting.ref;
}

let counter = 0;
function ctx(overrides: Partial<MappingContext> = {}): MappingContext {
  return {
    language: 'en',
    mode: 'chat',
    userTimeZone: USER_TZ,
    context: baseContext,
    userText: '',
    newActionId: () => `act_test${(counter += 1)}`,
    ...overrides,
  };
}

function call(name: string, args: Record<string, unknown>): ToolCall {
  return { name, arguments: JSON.stringify(args) };
}

const createArgs = {
  title: 'Client call',
  description: '',
  date: '2026-09-29',
  time: '16:00',
  all_day: false,
  duration_minutes: null,
  timezone: null,
  location: null,
  conference: null,
  participants: [],
  preparation_tips: [],
  alert_minutes_before: null,
  summary: 'Create "Client call" tomorrow at 16:00',
  confidence: 92,
};

const noChanges = {
  title: null,
  description: null,
  date: null,
  time: null,
  all_day: null,
  timezone: null,
  duration_minutes: null,
  location: null,
  clear_location: false,
  conference: null,
  clear_conference: false,
  participants: null,
  preparation_tips: null,
  alert_minutes_before: null,
  reset_alert_times: false,
};

const noBulkChanges = {
  duration_minutes: null,
  location: null,
  clear_location: false,
  conference: null,
  clear_conference: false,
  alert_minutes_before: null,
  reset_alert_times: false,
};

function only(actions: AiAction[]): AiAction {
  expect(actions).toHaveLength(1);
  const action = actions[0]!;
  expect(aiActionSchema.safeParse(action).success).toBe(true);
  return action;
}

describe('create_meeting', () => {
  it('resolves the local date/time to ISO with the zone offset and fills defaults', () => {
    const result = mapToolCalls([call('create_meeting', createArgs)], ctx({ language: 'es' }));
    const action = only(result.actions);
    expect(action).toMatchObject({
      type: 'create_meeting',
      id: 'act_test1',
      summary: 'Create "Client call" tomorrow at 16:00',
      confidence: 92,
      meeting: {
        title: 'Client call',
        startAt: '2026-09-29T16:00:00+02:00',
        durationMinutes: 60,
        timezone: USER_TZ,
        allDay: false,
        customAlertTimes: null,
        language: 'es',
      },
    });
  });

  it('uses an explicit meeting zone and all-day midnight', () => {
    const inNewYork = only(
      mapToolCalls([call('create_meeting', { ...createArgs, timezone: 'America/New_York' })], ctx()).actions,
    );
    expect(inNewYork.type === 'create_meeting' && inNewYork.meeting.startAt).toBe('2026-09-29T16:00:00-04:00');

    const allDay = only(mapToolCalls([call('create_meeting', { ...createArgs, all_day: true, time: null })], ctx()).actions);
    expect(allDay).toMatchObject({ meeting: { startAt: '2026-09-29T00:00:00+02:00', durationMinutes: 1440, allDay: true } });
  });

  it('drops impossible dates and timed meetings without a time', () => {
    const result = mapToolCalls(
      [
        call('create_meeting', { ...createArgs, date: '2026-02-30' }),
        call('create_meeting', { ...createArgs, time: null }),
        call('create_meeting', { ...createArgs, time: '4pm' }),
      ],
      ctx(),
    );
    expect(result.actions).toEqual([]);
    expect(result.dropped).toEqual({ invalid_datetime: 3 });
  });

  it('never keeps links, passwords or emails the user did not type', () => {
    const args = {
      ...createArgs,
      conference: { provider: 'zoom', url: 'https://zoom.us/j/999', password: 'secret' },
      participants: [
        { email: 'john@company.com', name: 'John' },
        { email: 'invented@nowhere.com', name: null },
        { email: 'ANA@example.com', name: null },
      ],
    };
    const typed = only(
      mapToolCalls([call('create_meeting', args)], ctx({ userText: 'Invite John@Company.com, zoom zoom.us/j/999 pass secret' })).actions,
    );
    expect(typed).toMatchObject({
      meeting: {
        conference: { provider: 'zoom', url: 'https://zoom.us/j/999', password: 'secret' },
        participants: [{ email: 'john@company.com', name: 'John' }],
      },
    });

    // ana@example.com is a participant of ANOTHER meeting (standup): not typed, so not accepted.
    const untyped = only(mapToolCalls([call('create_meeting', args)], ctx({ userText: 'schedule it with zoom' })).actions);
    expect(untyped).toMatchObject({
      meeting: { conference: { provider: 'zoom', url: null, password: null }, participants: [] },
    });
  });

  it('in follow-up mode, may invite the participants of the meeting that just ended (and nobody else)', () => {
    const followUpContext = buildMeetingContext(
      [
        { id: 'standup', doc: baseContext.meetings.find((m) => m.meetingId === 'standup')!.doc },
        { id: 'big', doc: baseContext.meetings.find((m) => m.meetingId === 'big')!.doc },
      ],
      NOW,
      { followUpMeetingId: 'standup' },
    );
    const args = {
      ...createArgs,
      participants: [
        { email: 'ana@example.com', name: 'Ana' },
        { email: 'p1@corp.com', name: null },
      ],
    };
    const action = only(mapToolCalls([call('create_meeting', args)], ctx({ mode: 'followup', context: followUpContext })).actions);
    expect(action).toMatchObject({ meeting: { participants: [{ email: 'ana@example.com', name: 'Ana' }] } });
  });

  it('keeps Google Meet without a link (the app creates a real one) and sanitizes alert times and tips', () => {
    const action = only(
      mapToolCalls(
        [
          call('create_meeting', {
            ...createArgs,
            conference: { provider: 'google_meet', url: 'https://meet.google.com/abc-defg-hij', password: null },
            alert_minutes_before: [5, 15, 15, -3, 20000, 0],
            preparation_tips: ['  Bring numbers ', '', 'Review deck'],
          }),
        ],
        ctx(),
      ).actions,
    );
    expect(action).toMatchObject({
      meeting: {
        conference: { provider: 'google_meet', url: null, password: null },
        customAlertTimes: [15, 5, 0],
        preparationTips: ['Bring numbers', 'Review deck'],
      },
    });
  });
});

describe('update_meeting', () => {
  it('changes only the time and keeps the local date the user saw', () => {
    const action = only(
      mapToolCalls(
        [call('update_meeting', { meeting_ref: ref('standup'), changes: { ...noChanges, time: '10:30' }, summary: 'Move', confidence: 80 })],
        ctx(),
      ).actions,
    );
    expect(action).toMatchObject({ type: 'update_meeting', meetingId: 'standup', changes: { startAt: '2026-09-29T10:30:00+02:00' } });
    expect(action.type === 'update_meeting' && Object.keys(action.changes)).toEqual(['startAt']);
  });

  it('reads the new time in a zone the user names, without changing the meeting zone', () => {
    const action = only(
      mapToolCalls(
        [
          call('update_meeting', {
            meeting_ref: ref('standup'),
            changes: { ...noChanges, time: '15:00', timezone: 'Europe/Madrid' },
            summary: 'Move to 15:00 Madrid time',
            confidence: 80,
          }),
        ],
        ctx({ userTimeZone: 'America/Bogota' }),
      ).actions,
    );
    expect(action).toMatchObject({ changes: { startAt: '2026-09-29T15:00:00+02:00' } });
    expect(action.type === 'update_meeting' && 'timezone' in action.changes).toBe(false);
  });

  it('drops unknown refs, empty changes and no-op changes', () => {
    const result = mapToolCalls(
      [
        call('update_meeting', { meeting_ref: 'mnotreal', changes: { ...noChanges, title: 'X' }, summary: 's', confidence: 50 }),
        call('update_meeting', { meeting_ref: ref('standup'), changes: noChanges, summary: 's', confidence: 50 }),
        call('update_meeting', { meeting_ref: ref('standup'), changes: { ...noChanges, time: '09:00', title: 'Standup' }, summary: 's', confidence: 50 }),
        call('update_meeting', {
          meeting_ref: ref('standup'),
          changes: { ...noChanges, conference: { provider: 'zoom', url: null, password: null } },
          summary: 's',
          confidence: 50,
        }),
      ],
      ctx(),
    );
    expect(result.actions).toEqual([]);
    expect(result.dropped).toEqual({ unknown_ref: 1, empty_changes: 3 });
  });

  it('clears fields explicitly and keeps hidden participants', () => {
    const action = only(
      mapToolCalls(
        [
          call('update_meeting', {
            meeting_ref: ref('big'),
            changes: {
              ...noChanges,
              clear_location: true,
              reset_alert_times: true,
              participants: [{ email: 'p0@corp.com', name: null }, { email: 'new@corp.com', name: 'New' }],
            },
            summary: 'Update attendees',
            confidence: 70,
          }),
        ],
        ctx({ userText: 'remove everyone except p0 and add new@corp.com' }),
      ).actions,
    );
    expect(action.type).toBe('update_meeting');
    if (action.type !== 'update_meeting') return;
    expect(action.changes.customAlertTimes).toBeNull();
    expect('location' in action.changes).toBe(false); // it had no location
    expect(action.changes.participants?.map((participant) => participant.email)).toEqual([
      'p0@corp.com',
      'new@corp.com',
      'p10@corp.com',
      'p11@corp.com',
    ]);
  });

  it('moves all-day meetings in their own zone and requires a time to make them timed', () => {
    const moved = only(
      mapToolCalls(
        [call('update_meeting', { meeting_ref: ref('offsite'), changes: { ...noChanges, date: '2026-10-09' }, summary: 's', confidence: 60 })],
        ctx({ userTimeZone: 'America/Bogota' }),
      ).actions,
    );
    expect(moved).toMatchObject({ changes: { startAt: '2026-10-09T00:00:00+02:00' } });

    const timed = mapToolCalls(
      [call('update_meeting', { meeting_ref: ref('offsite'), changes: { ...noChanges, all_day: false }, summary: 's', confidence: 60 })],
      ctx(),
    );
    expect(timed.dropped).toEqual({ invalid_datetime: 1 });
  });

  it('keeps the existing link when only the password changes', () => {
    const action = only(
      mapToolCalls(
        [
          call('update_meeting', {
            meeting_ref: ref('standup'),
            changes: { ...noChanges, conference: { provider: 'zoom', url: null, password: 'n3w' } },
            summary: 's',
            confidence: 60,
          }),
        ],
        ctx({ userText: 'the new zoom passcode is n3w' }),
      ).actions,
    );
    expect(action).toMatchObject({ changes: { conference: { provider: 'zoom', url: 'https://zoom.us/j/111', password: 'n3w' } } });
  });
});

describe('delete, share, bulk and list', () => {
  it('maps delete, but never in follow-up mode', () => {
    const args = { meeting_ref: ref('marketing'), summary: 'Delete Marketing', confidence: 95 };
    expect(only(mapToolCalls([call('delete_meeting', args)], ctx()).actions)).toMatchObject({
      type: 'delete_meeting',
      meetingId: 'marketing',
    });
    expect(mapToolCalls([call('delete_meeting', args)], ctx({ mode: 'followup' })).dropped).toEqual({ not_allowed: 1 });
  });

  it('never shares a meeting with a participant of ANOTHER meeting (injected recipients)', () => {
    // p3@corp.com attends "All hands" (big), e.g. an attacker's own invitation; the user asked
    // nothing about it. Sharing the standup (link + password) with them must not be proposed.
    const args = {
      meeting_ref: ref('standup'),
      channel: 'email',
      recipients: ['p3@corp.com', 'ana@example.com'],
      message: null,
      summary: 'Share the standup',
      confidence: 90,
    };
    expect(only(mapToolCalls([call('share_meeting', args)], ctx({ userText: 'share the standup' })).actions)).toMatchObject({
      channel: 'email',
      recipients: ['ana@example.com'],
    });
  });

  it('never adds a participant of another meeting to an update', () => {
    const action = only(
      mapToolCalls(
        [
          call('update_meeting', {
            meeting_ref: ref('standup'),
            changes: { ...noChanges, participants: [{ email: 'ana@example.com', name: null }, { email: 'p5@corp.com', name: 'Mallory' }] },
            summary: 'Add Mallory',
            confidence: 60,
          }),
        ],
        ctx({ userText: 'update the standup' }),
      ).actions,
    );
    if (action.type !== 'update_meeting') throw new Error('expected an update');
    // The stored name of an existing participant is kept when the model omits it.
    expect(action.changes.participants).toEqual([{ email: 'ana@example.com', name: 'Ana' }]);
  });

  it('shares by email only with typed or known recipients', () => {
    const args = {
      meeting_ref: ref('marketing'),
      channel: 'email',
      recipients: ['john@company.com', 'made.up@x.com'],
      message: 'Here is the link',
      summary: 'Send the link to John',
      confidence: 90,
    };
    expect(
      only(mapToolCalls([call('share_meeting', args)], ctx({ userText: 'Send the marketing link to john@company.com' })).actions),
    ).toMatchObject({ channel: 'email', recipients: ['john@company.com'], message: 'Here is the link' });
    expect(only(mapToolCalls([call('share_meeting', args)], ctx({ userText: 'share it' })).actions)).toMatchObject({
      channel: 'system_share',
      recipients: [],
    });
  });

  it('maps bulk shifts, ignores unknown refs and refuses link-wiping bulk changes', () => {
    const shift = only(
      mapToolCalls(
        [
          call('bulk_update_meetings', {
            meeting_refs: [ref('standup'), 'mbogus00', ref('marketing'), ref('standup')],
            shift_minutes: 30,
            changes: null,
            summary: 'Move all by 30 minutes',
            confidence: 85,
          }),
        ],
        ctx(),
      ).actions,
    );
    expect(shift).toMatchObject({ type: 'bulk_update', meetingIds: ['standup', 'marketing'], shiftMinutes: 30, changes: null });

    const result = mapToolCalls(
      [
        call('bulk_update_meetings', { meeting_refs: ['mbogus00'], shift_minutes: 30, changes: null, summary: 's', confidence: 5 }),
        call('bulk_update_meetings', { meeting_refs: [ref('standup')], shift_minutes: 0, changes: null, summary: 's', confidence: 5 }),
        call('bulk_update_meetings', {
          meeting_refs: [ref('standup')],
          shift_minutes: null,
          changes: { ...noBulkChanges, conference: { provider: 'zoom', url: null, password: null } },
          summary: 's',
          confidence: 5,
        }),
      ],
      ctx(),
    );
    expect(result.actions).toEqual([]);
    expect(result.dropped).toEqual({ unknown_ref: 1, empty_changes: 2 });

    const meet = only(
      mapToolCalls(
        [
          call('bulk_update_meetings', {
            meeting_refs: [ref('standup'), ref('marketing')],
            shift_minutes: null,
            changes: { ...noBulkChanges, conference: { provider: 'google_meet', url: null, password: null }, duration_minutes: 45 },
            summary: 'Add Meet',
            confidence: 75,
          }),
        ],
        ctx(),
      ).actions,
    );
    expect(meet).toMatchObject({ changes: { durationMinutes: 45, conference: { provider: 'google_meet', url: null } } });
  });

  it('lists known meetings only (possibly none)', () => {
    const result = mapToolCalls(
      [call('list_meetings', { meeting_refs: [ref('marketing'), 'mnope123'], summary: 'Your meetings', confidence: 99 })],
      ctx(),
    );
    expect(only(result.actions)).toMatchObject({ type: 'list', meetingIds: ['marketing'] });
    const empty = mapToolCalls([call('list_meetings', { meeting_refs: [], summary: 'Nothing', confidence: 99 })], ctx());
    expect(only(empty.actions)).toMatchObject({ type: 'list', meetingIds: [] });
  });
});

describe('robustness', () => {
  it('drops malformed calls and duplicates, caps actions and collects suggestions', () => {
    const del = { meeting_ref: ref('marketing'), summary: 'Delete', confidence: 90 };
    const creates = Array.from({ length: 12 }, (_, index) => call('create_meeting', { ...createArgs, title: `Meeting ${index}` }));
    const result = mapToolCalls(
      [
        { name: 'create_meeting', arguments: '{"title": "broken"' },
        call('create_meeting', { title: 'missing fields' }),
        call('drop_database', {}),
        call('delete_meeting', del),
        call('delete_meeting', { ...del, summary: 'Delete again' }),
        ...creates,
        call('suggest_replies', { suggestions: ['  Schedule the next one  ', '', 'x'.repeat(200), 'Schedule the next one'] }),
        call('suggest_replies', { suggestions: ['a', 'b', 'c', 'd', 'e'] }),
      ],
      ctx(),
    );
    expect(result.actions).toHaveLength(10);
    expect(result.dropped).toEqual({ bad_json: 1, bad_args: 1, unknown_tool: 1, duplicate: 1, limit: 3 });
    expect(new Set(result.actions.map((action) => action.id)).size).toBe(10);
    expect(result.suggestions).toEqual(['Schedule the next one', 'x'.repeat(120), 'a', 'b', 'c']);
    for (const action of result.actions) expect(aiActionSchema.safeParse(action).success).toBe(true);
  });

  it('fills an empty summary and clamps confidence', () => {
    const action = only(
      mapToolCalls([call('delete_meeting', { meeting_ref: ref('marketing'), summary: '  ', confidence: 140 })], ctx({ language: 'es' }))
        .actions,
    );
    expect(action).toMatchObject({ summary: 'Eliminar una reunión', confidence: 100 });
  });

  it('generates unique random action ids by default', () => {
    const result = mapToolCalls(
      [
        call('create_meeting', createArgs),
        call('create_meeting', { ...createArgs, title: 'Other' }),
      ],
      { ...ctx(), newActionId: undefined },
    );
    const ids = result.actions.map((action) => action.id);
    expect(ids[0]).toMatch(/^act_[0-9a-f]{20}$/);
    expect(ids[0]).not.toBe(ids[1]);
  });
});

describe('recurrence (v2)', () => {
  it('maps a create recurrence: defaults interval, keeps weekly days, resolves until as end of day', () => {
    const action = only(
      mapToolCalls(
        [
          call('create_meeting', {
            ...createArgs,
            recurrence: { freq: 'weekly', interval: null, by_weekday: ['MO', 'WE'], by_month_day: null, until_date: '2026-12-31', count: null },
          }),
        ],
        ctx(),
      ).actions,
    );
    expect(action).toMatchObject({
      type: 'create_meeting',
      meeting: {
        recurrence: {
          freq: 'weekly',
          interval: 1,
          byWeekday: ['MO', 'WE'],
          byMonthDay: null,
          // Inclusive last local day in Madrid (CET): stored as that day's 23:59 instant.
          until: '2026-12-31T22:59:00.000Z',
          count: null,
        },
      },
    });
  });

  it('normalizes weekday/month-day fields to the frequency; until wins over count; bad dates drop', () => {
    const normalized = only(
      mapToolCalls(
        [
          call('create_meeting', {
            ...createArgs,
            recurrence: { freq: 'daily', interval: 2, by_weekday: ['MO'], by_month_day: 5, until_date: null, count: 10 },
          }),
        ],
        ctx(),
      ).actions,
    );
    expect(normalized).toMatchObject({
      meeting: { recurrence: { freq: 'daily', interval: 2, byWeekday: null, byMonthDay: null, until: null, count: 10 } },
    });

    const both = mapToolCalls(
      [
        call('create_meeting', {
          ...createArgs,
          recurrence: { freq: 'daily', interval: 1, by_weekday: null, by_month_day: null, until_date: '2026-12-31', count: 5 },
        }),
      ],
      ctx(),
    );
    expect(only(both.actions)).toMatchObject({ meeting: { recurrence: { until: '2026-12-31T22:59:00.000Z', count: null } } });

    const badDate = mapToolCalls(
      [
        call('create_meeting', {
          ...createArgs,
          recurrence: { freq: 'daily', interval: 1, by_weekday: null, by_month_day: null, until_date: '2026-13-40', count: null },
        }),
      ],
      ctx(),
    );
    expect(badDate.actions).toEqual([]);
    expect(badDate.dropped).toEqual({ invalid_datetime: 1 });
  });

  it('maps an occurrence-scoped update: original date kept, only start/duration/title accepted', () => {
    const action = only(
      mapToolCalls(
        [
          call('update_meeting', {
            meeting_ref: ref('series'),
            changes: { ...noChanges, time: '10:30', clear_location: true, participants: [{ email: 'x@y.com', name: null }] },
            scope: 'occurrence',
            occurrence_date: '2026-10-05',
            summary: 'Move one standup',
            confidence: 80,
          }),
        ],
        ctx(),
      ).actions,
    );
    expect(action).toMatchObject({
      type: 'update_meeting',
      meetingId: 'series',
      scope: 'occurrence',
      occurrenceDate: '2026-10-05',
      // 10:30 on the occurrence's own (original) date, user zone; location/participants ignored.
      changes: { startAt: '2026-10-05T10:30:00+02:00' },
    });
    expect(Object.keys((action as { changes: object }).changes)).toEqual(['startAt']);
  });

  it('a date-only occurrence move keeps the series wall clock in the MEETING zone across a DST divergence', () => {
    // Series: Mondays 09:00 Europe/Madrid. User in America/New_York. Target date 2027-03-15 sits
    // in the window where NY is already on DST (from Mar 14) and Madrid is not (until Mar 28):
    // deriving the fallback time in the user's zone (03:00 NY) would land at 08:00 Madrid.
    const action = only(
      mapToolCalls(
        [
          call('update_meeting', {
            meeting_ref: ref('series'),
            changes: { ...noChanges, date: '2027-03-15' },
            scope: 'occurrence',
            occurrence_date: '2027-03-08',
            summary: 'Move one standup a week later',
            confidence: 80,
          }),
        ],
        ctx({ userTimeZone: 'America/New_York' }),
      ).actions,
    );
    expect(action).toMatchObject({
      type: 'update_meeting',
      meetingId: 'series',
      scope: 'occurrence',
      occurrenceDate: '2027-03-08',
      // 09:00 Madrid (CET, +01:00) on the new date - the master's wall clock, not 03:00 NY.
      changes: { startAt: '2027-03-15T09:00:00+01:00' },
    });
  });

  it('drops an occurrence update without usable changes or without a valid date', () => {
    const empty = mapToolCalls(
      [
        call('update_meeting', {
          meeting_ref: ref('series'),
          changes: { ...noChanges, clear_conference: true },
          scope: 'occurrence',
          occurrence_date: '2026-10-05',
          summary: 's',
          confidence: 50,
        }),
      ],
      ctx(),
    );
    expect(empty.dropped).toEqual({ empty_changes: 1 });

    const badDate = mapToolCalls(
      [
        call('update_meeting', {
          meeting_ref: ref('series'),
          changes: { ...noChanges, time: '10:30' },
          scope: 'occurrence',
          occurrence_date: 'next monday',
          summary: 's',
          confidence: 50,
        }),
      ],
      ctx(),
    );
    expect(badDate.dropped).toEqual({ invalid_datetime: 1 });
  });

  it('ignores the occurrence scope on a one-off meeting (plain series update)', () => {
    const action = only(
      mapToolCalls(
        [
          call('update_meeting', {
            meeting_ref: ref('marketing'),
            changes: { ...noChanges, title: 'Marketing sync' },
            scope: 'occurrence',
            occurrence_date: '2026-09-30',
            summary: 's',
            confidence: 50,
          }),
        ],
        ctx(),
      ).actions,
    );
    expect(action).toMatchObject({ type: 'update_meeting', changes: { title: 'Marketing sync' } });
    expect((action as { scope?: string }).scope).toBeUndefined();
  });

  it('sets and clears the series rule through update changes, skipping no-ops', () => {
    const set = only(
      mapToolCalls(
        [
          call('update_meeting', {
            meeting_ref: ref('marketing'),
            changes: {
              ...noChanges,
              recurrence: { freq: 'monthly', interval: 1, by_weekday: null, by_month_day: 15, until_date: null, count: null },
            },
            summary: 's',
            confidence: 50,
          }),
        ],
        ctx(),
      ).actions,
    );
    expect(set).toMatchObject({
      changes: { recurrence: { freq: 'monthly', interval: 1, byWeekday: null, byMonthDay: 15, until: null, count: null } },
    });

    const cleared = only(
      mapToolCalls(
        [call('update_meeting', { meeting_ref: ref('series'), changes: { ...noChanges, clear_recurrence: true }, summary: 's', confidence: 50 })],
        ctx(),
      ).actions,
    );
    expect(cleared).toMatchObject({ changes: { recurrence: null } });

    const noop = mapToolCalls(
      [
        call('update_meeting', {
          meeting_ref: ref('series'),
          changes: {
            ...noChanges,
            recurrence: { freq: 'weekly', interval: null, by_weekday: ['MO'], by_month_day: null, until_date: null, count: null },
          },
          summary: 's',
          confidence: 50,
        }),
        call('update_meeting', { meeting_ref: ref('marketing'), changes: { ...noChanges, clear_recurrence: true }, summary: 's', confidence: 50 }),
      ],
      ctx(),
    );
    expect(noop.actions).toEqual([]);
    expect(noop.dropped).toEqual({ empty_changes: 2 });
  });

  it('maps an occurrence-scoped delete and validates its date', () => {
    const action = only(
      mapToolCalls(
        [
          call('delete_meeting', {
            meeting_ref: ref('series'),
            scope: 'occurrence',
            occurrence_date: '2026-10-05',
            summary: 'Skip one',
            confidence: 90,
          }),
        ],
        ctx(),
      ).actions,
    );
    expect(action).toMatchObject({ type: 'delete_meeting', meetingId: 'series', scope: 'occurrence', occurrenceDate: '2026-10-05' });

    const oneOff = only(
      mapToolCalls(
        [call('delete_meeting', { meeting_ref: ref('marketing'), scope: 'occurrence', occurrence_date: '2026-09-30', summary: 's', confidence: 50 })],
        ctx(),
      ).actions,
    );
    expect((oneOff as { scope?: string }).scope).toBeUndefined();

    const badDate = mapToolCalls(
      [call('delete_meeting', { meeting_ref: ref('series'), scope: 'occurrence', occurrence_date: 'tomorrow', summary: 's', confidence: 50 })],
      ctx(),
    );
    expect(badDate.dropped).toEqual({ invalid_datetime: 1 });
  });
});

describe('recurrence scope following (v3)', () => {
  it('maps a following-scoped update with the FULL change surface, anchored at the split occurrence', () => {
    const action = only(
      mapToolCalls(
        [
          call('update_meeting', {
            meeting_ref: ref('series'),
            changes: { ...noChanges, time: '10:30', title: 'Standup v2', duration_minutes: 20 },
            scope: 'following',
            occurrence_date: '2026-10-05',
            summary: 'Move the standup from October',
            confidence: 85,
          }),
        ],
        ctx(),
      ).actions,
    );
    expect(action).toMatchObject({
      type: 'update_meeting',
      meetingId: 'series',
      scope: 'following',
      occurrenceDate: '2026-10-05',
      // 10:30 lands on the SPLIT occurrence's date, not on the master's first occurrence -
      // otherwise a time-only change would silently move the tail back to 2026-09-07.
      changes: { startAt: '2026-10-05T10:30:00+02:00', title: 'Standup v2', durationMinutes: 20 },
    });
  });

  it('a following update without date/time changes produces no startAt (the tail keeps the split start)', () => {
    const action = only(
      mapToolCalls(
        [
          call('update_meeting', {
            meeting_ref: ref('series'),
            changes: { ...noChanges, title: 'Renamed from here' },
            scope: 'following',
            occurrence_date: '2026-10-05',
            summary: 's',
            confidence: 60,
          }),
        ],
        ctx(),
      ).actions,
    );
    expect(Object.keys((action as { changes: object }).changes)).toEqual(['title']);
    expect(action).toMatchObject({ scope: 'following', occurrenceDate: '2026-10-05' });
  });

  it('allows a rule change with scope following (it lands on the tail series)', () => {
    const action = only(
      mapToolCalls(
        [
          call('update_meeting', {
            meeting_ref: ref('series'),
            changes: {
              ...noChanges,
              recurrence: { freq: 'weekly', interval: 2, by_weekday: ['MO'], by_month_day: null, until_date: null, count: null },
            },
            scope: 'following',
            occurrence_date: '2026-10-05',
            summary: 's',
            confidence: 60,
          }),
        ],
        ctx(),
      ).actions,
    );
    expect(action).toMatchObject({
      scope: 'following',
      changes: { recurrence: { freq: 'weekly', interval: 2, byWeekday: ['MO'] } },
    });
  });

  it('ignores the following scope on a one-off, and drops bad dates or empty changes', () => {
    const oneOff = only(
      mapToolCalls(
        [
          call('update_meeting', {
            meeting_ref: ref('marketing'),
            changes: { ...noChanges, title: 'Marketing v2' },
            scope: 'following',
            occurrence_date: '2026-09-30',
            summary: 's',
            confidence: 60,
          }),
        ],
        ctx(),
      ).actions,
    );
    expect((oneOff as { scope?: string }).scope).toBeUndefined();
    expect((oneOff as { occurrenceDate?: string }).occurrenceDate).toBeUndefined();

    const badDate = mapToolCalls(
      [
        call('update_meeting', {
          meeting_ref: ref('series'),
          changes: { ...noChanges, title: 'x' },
          scope: 'following',
          occurrence_date: 'next monday',
          summary: 's',
          confidence: 60,
        }),
      ],
      ctx(),
    );
    expect(badDate.actions).toEqual([]);
    expect(badDate.dropped).toEqual({ invalid_datetime: 1 });

    const empty = mapToolCalls(
      [
        call('update_meeting', {
          meeting_ref: ref('series'),
          changes: { ...noChanges },
          scope: 'following',
          occurrence_date: '2026-10-05',
          summary: 's',
          confidence: 60,
        }),
      ],
      ctx(),
    );
    expect(empty.dropped).toEqual({ empty_changes: 1 });
  });

  it('maps a following-scoped delete and validates its date', () => {
    const action = only(
      mapToolCalls(
        [
          call('delete_meeting', {
            meeting_ref: ref('series'),
            scope: 'following',
            occurrence_date: '2026-10-05',
            summary: 'Cancel the rest',
            confidence: 90,
          }),
        ],
        ctx(),
      ).actions,
    );
    expect(action).toMatchObject({ type: 'delete_meeting', meetingId: 'series', scope: 'following', occurrenceDate: '2026-10-05' });

    const oneOff = only(
      mapToolCalls(
        [call('delete_meeting', { meeting_ref: ref('marketing'), scope: 'following', occurrence_date: '2026-09-30', summary: 's', confidence: 50 })],
        ctx(),
      ).actions,
    );
    expect((oneOff as { scope?: string }).scope).toBeUndefined();

    const badDate = mapToolCalls(
      [call('delete_meeting', { meeting_ref: ref('series'), scope: 'following', occurrence_date: 'soon', summary: 's', confidence: 50 })],
      ctx(),
    );
    expect(badDate.dropped).toEqual({ invalid_datetime: 1 });
  });
});
