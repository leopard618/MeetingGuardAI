/**
 * computeNextWidgetEntry: candidate filtering, recurring expansion, the 5-minute started grace
 * and the 7-day horizon (docs/ARCHITECTURE.md §19).
 */
import type { MeetingRecurrence } from '../../../core/recurrence';
import { buildMeeting, type Meeting, type MeetingCreateInput } from '../../../core/types';
import { WIDGET_HORIZON_DAYS, WIDGET_STARTED_GRACE_MINUTES, computeNextWidgetEntry } from '../model';

const NOW = new Date('2026-10-05T12:00:00.000Z'); // Monday

function minutesFromNow(minutes: number): string {
  return new Date(NOW.getTime() + minutes * 60_000).toISOString();
}

function makeMeeting(id: string, startAt: string, overrides: Partial<MeetingCreateInput> = {}, patch: Partial<Meeting> = {}): Meeting {
  const meeting = buildMeeting(
    { title: `Meeting ${id}`, startAt, source: 'manual', ...overrides },
    { id, userId: 'user-1', now: '2026-10-01T00:00:00.000Z', defaultTimezone: 'UTC', defaultLanguage: 'en' },
  );
  return { ...meeting, ...patch };
}

function daily(overrides: Partial<MeetingRecurrence> = {}): MeetingRecurrence {
  return { freq: 'daily', interval: 1, byWeekday: null, byMonthDay: null, until: null, count: null, ...overrides };
}

it('returns null when there is nothing to show', () => {
  expect(computeNextWidgetEntry([], NOW)).toBeNull();
});

it('picks the earliest upcoming one-off meeting', () => {
  const later = makeMeeting('m-later', minutesFromNow(120));
  const sooner = makeMeeting('m-sooner', minutesFromNow(30));
  const entry = computeNextWidgetEntry([later, sooner], NOW);
  expect(entry).toEqual({
    meetingId: 'm-sooner',
    title: 'Meeting m-sooner',
    startAt: minutesFromNow(30),
    startAtMs: Date.parse(minutesFromNow(30)),
    localDateKey: null,
  });
});

it('keeps a meeting that just started (within the 5-minute grace)', () => {
  const started = makeMeeting('m-started', minutesFromNow(-(WIDGET_STARTED_GRACE_MINUTES - 1)));
  const upcoming = makeMeeting('m-upcoming', minutesFromNow(60));
  expect(computeNextWidgetEntry([started, upcoming], NOW)?.meetingId).toBe('m-started');
});

it('drops a meeting started before the grace and falls through to the next one', () => {
  const old = makeMeeting('m-old', minutesFromNow(-(WIDGET_STARTED_GRACE_MINUTES + 1)));
  const upcoming = makeMeeting('m-upcoming', minutesFromNow(60));
  expect(computeNextWidgetEntry([old, upcoming], NOW)?.meetingId).toBe('m-upcoming');
  expect(computeNextWidgetEntry([old], NOW)).toBeNull();
});

it('ignores meetings beyond the 7-day horizon', () => {
  const far = makeMeeting('m-far', minutesFromNow(WIDGET_HORIZON_DAYS * 24 * 60 + 1));
  expect(computeNextWidgetEntry([far], NOW)).toBeNull();
});

it('skips all-day, cancelled and deleted meetings', () => {
  const allDay = makeMeeting('m-allday', minutesFromNow(60), { allDay: true });
  const cancelled = makeMeeting('m-cancelled', minutesFromNow(30), { status: 'cancelled' });
  const deleted = makeMeeting('m-deleted', minutesFromNow(20), {}, { deletedAt: NOW.toISOString() });
  const ok = makeMeeting('m-ok', minutesFromNow(90));
  expect(computeNextWidgetEntry([allDay, cancelled, deleted, ok], NOW)?.meetingId).toBe('m-ok');
  expect(computeNextWidgetEntry([allDay, cancelled, deleted], NOW)).toBeNull();
});

it('expands a recurring master whose own start is long past', () => {
  // Daily at 15:00 UTC since September; next occurrence is today 15:00.
  const series = makeMeeting('m-series', '2026-09-01T15:00:00.000Z', { recurrence: daily() });
  const entry = computeNextWidgetEntry([series], NOW);
  expect(entry).toEqual({
    meetingId: 'm-series',
    title: 'Meeting m-series',
    startAt: '2026-10-05T15:00:00.000Z',
    startAtMs: Date.parse('2026-10-05T15:00:00.000Z'),
    localDateKey: '2026-10-05',
  });
});

it('skips an in-progress occurrence past the grace and returns the following one', () => {
  // Daily at 11:30 UTC, 60 min: today’s occurrence started 30 min ago.
  const series = makeMeeting('m-series', '2026-09-01T11:30:00.000Z', { recurrence: daily(), durationMinutes: 60 });
  const entry = computeNextWidgetEntry([series], NOW);
  expect(entry?.startAt).toBe('2026-10-06T11:30:00.000Z');
  expect(entry?.localDateKey).toBe('2026-10-06');
});

it('applies overrides: cancelled occurrences are skipped, modified title and time win', () => {
  const series = makeMeeting('m-series', '2026-09-01T15:00:00.000Z', {
    recurrence: daily(),
    recurrenceOverrides: {
      '2026-10-05': { status: 'cancelled', title: null, startAt: null, durationMinutes: null },
      '2026-10-06': { status: 'modified', title: 'Moved standup', startAt: '2026-10-06T16:30:00.000Z', durationMinutes: null },
    },
  });
  const entry = computeNextWidgetEntry([series], NOW);
  expect(entry).toMatchObject({ title: 'Moved standup', startAt: '2026-10-06T16:30:00.000Z', localDateKey: '2026-10-06' });
});

it('lets an ended series fall out of the window', () => {
  const ended = makeMeeting('m-ended', '2026-09-01T15:00:00.000Z', { recurrence: daily({ until: '2026-10-01T15:00:00.000Z' }) });
  expect(computeNextWidgetEntry([ended], NOW)).toBeNull();
});

it('compares recurring occurrences and one-offs on the same axis', () => {
  const series = makeMeeting('m-series', '2026-09-01T15:00:00.000Z', { recurrence: daily() }); // today 15:00
  const oneOffSooner = makeMeeting('m-oneoff', '2026-10-05T13:00:00.000Z');
  expect(computeNextWidgetEntry([series, oneOffSooner], NOW)?.meetingId).toBe('m-oneoff');
});

it('breaks a start-time tie deterministically on the meeting id', () => {
  const b = makeMeeting('m-b', minutesFromNow(30));
  const a = makeMeeting('m-a', minutesFromNow(30));
  expect(computeNextWidgetEntry([b, a], NOW)?.meetingId).toBe('m-a');
});

it('skips a meeting with a malformed stored recurrence instead of throwing', () => {
  const broken = makeMeeting('m-broken', minutesFromNow(10));
  (broken as { recurrence: unknown }).recurrence = { freq: 'yearly' };
  const ok = makeMeeting('m-ok', minutesFromNow(60));
  expect(computeNextWidgetEntry([broken, ok], NOW)?.meetingId).toBe('m-ok');
});
