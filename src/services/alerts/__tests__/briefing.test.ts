import { buildTask, type Preferences, type Task } from '../../../core/types';
import { BRIEFING_DAYS_AHEAD, computeBriefingPlan, renderBriefingSpec } from '../briefing';
import { makeMeeting, makePrefs, textDeps } from '../__fixtures__/alertFixtures';

/** 2026-10-05 is a Monday. 09:00 Madrid (CEST, +02:00) = 07:00Z. */
const NOW = new Date('2026-10-05T07:00:00.000Z');
const ZONE = 'Europe/Madrid';
const TASK_CTX = { userId: 'u1', timezone: ZONE, now: NOW };

function prefs(overrides: Partial<Preferences> = {}): Preferences {
  return makePrefs({ timezone: ZONE, briefingEnabled: true, briefingTime: '08:00', ...overrides });
}

function task(id: string, overrides: Partial<Parameters<typeof buildTask>[0]> = {}): Task {
  return buildTask({ title: `Task ${id}`, dueDate: '2026-10-06', ...overrides }, { ...TASK_CTX, id });
}

function done(id: string, dueDate: string): Task {
  return { ...task(id, { dueDate }), status: 'done', completedAt: NOW.toISOString() };
}

describe('computeBriefingPlan', () => {
  it('plans one briefing per day at the chosen local time, in the device zone', () => {
    // 08:00 Madrid on the 5th has already passed at 09:00 local, so only the 6th is planned.
    const items = computeBriefingPlan([], [], prefs(), NOW, ZONE);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      identifier: 'mgbrief:2026-10-06',
      localDateKey: '2026-10-06',
      fireAt: '2026-10-06T06:00:00.000Z',
      meetingCount: 0,
      firstMeetingAt: null,
      dueTaskCount: 0,
      overdueTaskCount: 0,
    });
  });

  it('plans today as well when its time has not passed yet', () => {
    const early = new Date('2026-10-05T05:00:00.000Z'); // 07:00 Madrid, before 08:00
    const items = computeBriefingPlan([], [], prefs(), early, ZONE);
    expect(items.map((item) => item.localDateKey)).toEqual(['2026-10-05', '2026-10-06']);
    expect(items).toHaveLength(BRIEFING_DAYS_AHEAD);
  });

  it('is empty unless both the master switch and the briefing switch are on', () => {
    expect(computeBriefingPlan([], [], prefs({ briefingEnabled: false }), NOW, ZONE)).toEqual([]);
    expect(computeBriefingPlan([], [], prefs({ alertEnabled: false }), NOW, ZONE)).toEqual([]);
  });

  it('counts the meetings of that local day and remembers the first start', () => {
    const meetings = [
      makeMeeting('m1', '2026-10-06T07:30:00.000Z'), // 09:30 Madrid
      makeMeeting('m2', '2026-10-06T13:00:00.000Z'), // 15:00 Madrid
      makeMeeting('m3', '2026-10-07T07:30:00.000Z'), // the next day: not counted
      makeMeeting('m4', '2026-10-05T07:30:00.000Z'), // the previous day: not counted
    ];
    const items = computeBriefingPlan(meetings, [], prefs(), NOW, ZONE);
    expect(items[0]).toMatchObject({ meetingCount: 2, firstMeetingAt: '2026-10-06T07:30:00.000Z' });
    expect(items[0]?.titles).toEqual(['Meeting m1', 'Meeting m2']);
  });

  it('uses the local day boundary of the device zone, not the UTC day', () => {
    // 23:30 Madrid on the 6th is 21:30Z on the 6th; 00:30 Madrid on the 7th is 22:30Z on the 6th
    // and belongs to the 7th. A UTC-day count would put both on the 6th.
    const meetings = [makeMeeting('late', '2026-10-06T21:30:00.000Z'), makeMeeting('nextday', '2026-10-06T22:30:00.000Z')];
    const items = computeBriefingPlan(meetings, [], prefs(), NOW, ZONE);
    expect(items[0]).toMatchObject({ localDateKey: '2026-10-06', meetingCount: 1 });
  });

  it('counts occurrences of a repeating meeting, and never a skipped one', () => {
    const daily = makeMeeting('standup', '2026-10-01T07:00:00.000Z', {
      recurrence: { freq: 'daily', interval: 1, byWeekday: null, byMonthDay: null, until: null, count: null },
    });
    const withSkip = {
      ...daily,
      recurrenceOverrides: { '2026-10-06': { status: 'cancelled' as const, startAt: null, durationMinutes: null, title: null } },
    };
    expect(computeBriefingPlan([daily], [], prefs(), NOW, ZONE)[0]).toMatchObject({ meetingCount: 1 });
    // The series master starts on the 1st, so only the expansion can put it on the 6th at all.
    expect(computeBriefingPlan([withSkip], [], prefs(), NOW, ZONE)[0]).toMatchObject({ meetingCount: 0 });
  });

  it('ignores cancelled and deleted meetings', () => {
    const cancelled = makeMeeting('cx', '2026-10-06T07:30:00.000Z', {}, { status: 'cancelled' });
    const deleted = makeMeeting('dx', '2026-10-06T08:30:00.000Z', {}, { deletedAt: NOW.toISOString() });
    expect(computeBriefingPlan([cancelled, deleted], [], prefs(), NOW, ZONE)[0]).toMatchObject({ meetingCount: 0 });
  });

  it('splits tasks into due that day and still overdue, and ignores done ones', () => {
    const tasks = [
      task('dueday1', { dueDate: '2026-10-06' }),
      task('dueday2', { dueDate: '2026-10-06' }),
      task('oldone', { dueDate: '2026-10-01' }),
      task('later', { dueDate: '2026-10-20' }),
      done('donepast', '2026-10-01'),
      done('doneday', '2026-10-06'),
      task('nodate', { dueDate: null }),
    ];
    expect(computeBriefingPlan([], tasks, prefs(), NOW, ZONE)[0]).toMatchObject({ dueTaskCount: 2, overdueTaskCount: 1 });
  });

  it('never throws on an unusable zone or an unusable briefing time', () => {
    expect(computeBriefingPlan([], [], prefs(), NOW, 'Not/AZone')).toEqual([]);
    expect(computeBriefingPlan([], [], prefs({ briefingTime: '99:99' }), NOW, ZONE)).toEqual([]);
  });
});

describe('renderBriefingSpec', () => {
  function render(overrides: Partial<Parameters<typeof renderBriefingSpec>[0]> = {}, language: 'en' | 'es' = 'en') {
    const base = computeBriefingPlan([], [], prefs(), NOW, ZONE)[0];
    if (!base) throw new Error('no briefing planned');
    return renderBriefingSpec({ ...base, ...overrides }, prefs(), textDeps(language, ZONE));
  }

  it('names the single meeting and keeps the briefing in its own namespace', () => {
    const spec = render({ meetingCount: 1, firstMeetingAt: '2026-10-06T07:30:00.000Z', titles: ['Kickoff'] });
    expect(spec.identifier).toBe('mgbrief:2026-10-06');
    expect(spec.kind).toBe('briefing');
    expect(spec.body).toBe('1 meeting today at 09:30: Kickoff.');
    expect(spec.channelId).toBe('mg-briefing-v1');
    expect(spec.categoryId).toBeNull();
  });

  it('counts several meetings and gives only the first time', () => {
    const spec = render({ meetingCount: 4, firstMeetingAt: '2026-10-06T07:30:00.000Z', titles: ['Kickoff', 'Review'] });
    expect(spec.body).toBe('4 meetings today, the first at 09:30.');
  });

  it('adds the task sentences after the meetings sentence', () => {
    const spec = render({
      meetingCount: 1,
      firstMeetingAt: '2026-10-06T07:30:00.000Z',
      titles: ['Kickoff'],
      dueTaskCount: 2,
      overdueTaskCount: 1,
    });
    expect(spec.body).toBe('1 meeting today at 09:30: Kickoff. 2 tasks due today. 1 task still overdue.');
  });

  it('says so plainly when the day is clear', () => {
    expect(render().body).toBe('No meetings and no tasks due today. Enjoy the clear day.');
  });

  it('renders in Spanish', () => {
    const spec = render({ dueTaskCount: 3 }, 'es');
    expect(spec.title).toBe('Tu día');
    expect(spec.body).toBe('3 tareas para hoy.');
  });

  it('carries no legacy payload keys, which the engine would cancel on sight', () => {
    const data = render().data as unknown as Record<string, unknown>;
    expect(data.kind).toBe('briefing');
    expect(data.alertType).toBeUndefined();
    expect(data.type).toBeUndefined();
  });

  it('hashes the visible content: same text keeps the hash, changed text changes it', () => {
    const first = render({ meetingCount: 1, firstMeetingAt: '2026-10-06T07:30:00.000Z', titles: ['Kickoff'] });
    const same = render({ meetingCount: 1, firstMeetingAt: '2026-10-06T07:30:00.000Z', titles: ['Kickoff'] });
    const renamed = render({ meetingCount: 1, firstMeetingAt: '2026-10-06T07:30:00.000Z', titles: ['Kickoff with Ana'] });
    expect(same.data.hash).toBe(first.data.hash);
    expect(renamed.data.hash).not.toBe(first.data.hash);
  });
});
