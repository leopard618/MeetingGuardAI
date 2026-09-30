import { AppError } from '../../../core/errors';
import {
  NOW,
  bulkAction,
  createTestFormatter,
  createTranslator,
  deleteAction,
  makeDraft,
  makeMeeting,
  shareAction,
  updateAction,
  usage,
} from '../__fixtures__/aiTestKit';
import {
  buildMailtoUrl,
  buildShareContent,
  computeUpdateDiff,
  describeAssistantError,
  describeBulk,
  describeChangeRows,
  describeDraft,
  describeMeeting,
  describeResult,
  describeScopeRow,
  describeShare,
  describeUsage,
  describeWarnings,
  formatShift,
  isOccurrenceDelete,
} from '../presentation';

const fmt = createTestFormatter();
const fmtEs = createTestFormatter({ language: 'es' });

describe('confirmation cards', () => {
  it('describes a new meeting with its fields', () => {
    const rows = describeDraft(
      fmt,
      makeDraft({
        participants: [{ email: 'ana@x.io', name: 'Ana' }],
        conference: { provider: 'google_meet', url: null, password: null },
        customAlertTimes: [5, 30],
      }),
    );
    const byField = Object.fromEntries(rows.map((r) => [r.field, r.value]));
    expect(byField.title).toBe('Budget review');
    expect(byField.participants).toBe('Ana <ana@x.io>');
    expect(byField.conference).toBe('Google Meet · a Google Meet link will be created');
    expect(byField.alerts).toBe('30 min before, 5 min before');
  });

  it('labels custom alert offsets like the rest of the app (not raw minute counts)', () => {
    // The app's real duration wording ("1 day", "1 h") instead of the kit's "<n> min" stub.
    const duration = (minutes: number): string =>
      minutes % 1440 === 0 ? `${minutes / 1440} day` : minutes % 60 === 0 ? `${minutes / 60} h` : `${minutes} min`;
    const rows = describeDraft({ ...fmt, duration }, makeDraft({ customAlertTimes: [60, 1440, 0] }));
    const byField = Object.fromEntries(rows.map((r) => [r.field, r.value]));
    expect(byField.alerts).toBe('1 day before, 1 h before, At start');
    const rowsEs = describeDraft({ ...fmtEs, duration }, makeDraft({ customAlertTimes: [10, 0] }));
    expect(Object.fromEntries(rowsEs.map((r) => [r.field, r.value])).alerts).toBe('10 min antes, Al empezar');
  });

  it('shows only the fields an update really changes (before and after)', () => {
    const meeting = makeMeeting('m1', { title: 'Sync', durationMinutes: 60 });
    const diff = computeUpdateDiff(fmt, meeting, {
      title: 'Sync',
      startAt: '2030-03-11T17:00:00.000Z',
      durationMinutes: 30,
      location: { type: 'physical', address: 'Room 4', virtualUrl: null },
    });
    expect(diff.map((r) => r.field)).toEqual(['when', 'duration', 'location']);
    expect(diff[0]).toMatchObject({ before: '2030-03-11T15:00Z+60m', after: '2030-03-11T17:00Z+30m' });
    expect(diff[2]).toMatchObject({ before: 'None', after: 'Room 4' });
  });

  it('lists every meeting of a bulk shift with its new time and flags all-day meetings', () => {
    const meetings = [
      makeMeeting('m1'),
      makeMeeting('m2', { allDay: true, startAt: '2030-03-11T00:00:00.000Z', durationMinutes: 1440 }),
    ];
    const bulk = describeBulk(fmt, bulkAction('b', ['m1', 'm2', 'missing'], { shiftMinutes: -60 }), meetings);
    expect(bulk.changes).toEqual(['Move 60 min earlier']);
    expect(bulk.items).toHaveLength(2);
    expect(bulk.items[0]).toMatchObject({ meetingId: 'm1', after: '2030-03-11T14:00Z+60m', skipped: false });
    expect(bulk.items[1]).toMatchObject({ meetingId: 'm2', after: null, skipped: true });
  });

  it('lists the email recipients of a share', () => {
    const share = describeShare(fmt, shareAction('s', 'm1', { recipients: ['a@x.io', 'b@x.io'], message: '  See you!  ' }));
    expect(share).toEqual({ channel: 'Email', recipients: ['a@x.io', 'b@x.io'], message: 'See you!' });
  });

  it('turns warnings into localized sentences', () => {
    const overlapping = [makeMeeting('o1', { title: 'Standup' })];
    const lines = describeWarnings(fmtEs, { warnings: ['overlaps_existing', 'start_in_past'], missingMeetingIds: [], overlapping });
    expect(lines).toEqual(['Se solapa con: Standup', 'Esta hora ya ha pasado.']);
    expect(formatShift(fmtEs, 30)).toBe('Retrasar 30 min');
  });
});

describe('results and errors', () => {
  it('never claims an email was sent: it says a draft was opened', () => {
    const feedback = describeResult(fmt, {
      status: 'done',
      actionId: 'a',
      type: 'share_meeting',
      meetingIds: ['m1'],
      duplicate: false,
      delivery: 'mail_composer',
      recipients: ['john@company.com'],
    } as never);
    expect(feedback).toEqual({ tone: 'success', message: 'Email draft opened for john@company.com.' });
  });

  it('warns when the requested Meet link was not created', () => {
    const feedback = describeResult(fmt, {
      status: 'done',
      actionId: 'a',
      type: 'create_meeting',
      meetingIds: ['m1'],
      duplicate: false,
      meetLinkCreated: false,
      meetLinkError: 'calendar_not_connected',
    } as never);
    expect(feedback.tone).toBe('warning');
    expect(feedback.message).toContain('connect Google Calendar');
  });

  it('pluralizes bulk results and shows failures with the common error text key', () => {
    expect(
      describeResult(fmtEs, { status: 'done', actionId: 'a', type: 'bulk_update', meetingIds: ['a', 'b'], duplicate: false }).message,
    ).toBe('2 reuniones actualizadas.');
    expect(
      describeResult(fmt, { status: 'failed', actionId: 'a', type: 'delete_meeting', error: new AppError('offline') }),
    ).toEqual({ tone: 'error', message: "Couldn't complete this: common:errors.offline" });
  });

  it('explains the quota with the limit, the plan and the reset time and offers an upgrade', () => {
    const error = new AppError('quota_exceeded', 'x', { details: { reason: 'quota_exceeded', usage: usage({ used: 5, limit: 5 }) } });
    const description = describeAssistantError(fmt, error, NOW);
    expect(description.recovery).toBe('upgrade');
    expect(description.message).toBe(
      "You've used all 5 assistant requests for today on the Free plan. They reset at 2030-03-11T00:00:00.000Z.",
    );
    expect(describeAssistantError(fmt, new AppError('quota_exceeded'), NOW)).toEqual({
      message: "You've reached today's assistant limit for your plan.",
      recovery: 'upgrade',
    });
  });

  it('offers retry only for transient failures', () => {
    expect(describeAssistantError(fmt, new AppError('offline')).recovery).toBe('retry');
    expect(describeAssistantError(fmt, new AppError('timeout')).recovery).toBe('retry');
    expect(describeAssistantError(fmt, new AppError('upstream_error')).recovery).toBe('retry');
    expect(describeAssistantError(fmt, new AppError('unauthenticated')).recovery).toBe('none');
    expect(describeAssistantError(fmt, new AppError('invalid_input')).recovery).toBe('none');
  });
});

describe('usage pill', () => {
  it('shows today\'s usage, and 0 once the UTC day has rolled over', () => {
    expect(describeUsage(fmt, usage({ used: 3 }), null, NOW)).toMatchObject({ label: '3/5 today · Free', exhausted: false });
    expect(describeUsage(fmt, usage({ used: 5 }), null, NOW)?.exhausted).toBe(true);
    const stale = describeUsage(fmt, usage({ used: 5, resetsAt: '2030-03-10T00:00:00.000Z' }), null, NOW);
    expect(stale).toMatchObject({ label: '0/5 today · Free', exhausted: false });
  });

  it('falls back to the plan limit when today\'s usage is unknown', () => {
    expect(describeUsage(fmt, null, { plan: 'pro', limit: 100 }, NOW)?.label).toBe('100/day · Pro');
    expect(describeUsage(fmt, null, null, NOW)).toBeNull();
  });
});

describe('share text', () => {
  it('builds a localized summary and an RFC 6068 mailto URL', () => {
    const meeting = makeMeeting('m1', {
      title: 'Plan & review',
      description: 'Agenda:\n1. Budget',
      location: { type: 'hybrid', address: 'Calle Mayor 1', virtualUrl: null },
      conference: { provider: 'teams', url: 'https://teams.microsoft.com/l/abc', password: null },
    });
    const content = buildShareContent(fmtEs, meeting, { message: 'Nos vemos' });
    expect(content.subject).toBe('Reunión: Plan & review');
    expect(content.body.split('\n')).toEqual([
      'Nos vemos',
      '',
      'Plan & review',
      'Cuándo: 2030-03-11T15:00Z+60m',
      'Duración: 60 min',
      'Dónde: Calle Mayor 1',
      'Unirse (Microsoft Teams): https://teams.microsoft.com/l/abc',
      '',
      'Agenda:',
      '1. Budget',
      '',
      'Compartido con MeetingGuard AI',
    ]);

    const url = buildMailtoUrl(['john@company.com', 'o+x@y.io'], content);
    expect(url.startsWith('mailto:john@company.com,o%2Bx@y.io?subject=Reuni%C3%B3n%3A%20Plan%20%26%20review&body=')).toBe(true);
    expect(url).toContain('%0D%0A');
    expect(url).not.toContain('\n');
  });

  it('mentions the zone when the meeting was planned in another time zone', () => {
    const meeting = makeMeeting('m1', { timezone: 'America/New_York' });
    const content = buildShareContent(createTestFormatter({ timeZone: 'Europe/Madrid' }), meeting, { message: null });
    expect(content.body).toContain('When: 2030-03-11T15:00Z+60m (Europe/Madrid)');
  });
});

describe('translator coverage', () => {
  it('resolves every key used above in both languages', () => {
    const en = createTranslator('en');
    const es = createTranslator('es');
    for (const t of [en, es]) {
      const f = createTestFormatter({ t });
      describeDraft(f, makeDraft({ location: { type: 'virtual', address: null, virtualUrl: null } }));
      describeUsage(f, usage(), { plan: 'premium', limit: 500 }, NOW);
      describeUsage(f, null, { plan: 'premium', limit: 500 }, NOW);
      describeAssistantError(f, new AppError('not_configured'));
    }
    expect(en.missing).toEqual([]);
    expect(es.missing).toEqual([]);
  });
});

describe('recurrence on the cards (v2)', () => {
  const rule = { freq: 'weekly' as const, interval: 1, byWeekday: ['MO' as const], byMonthDay: null, until: null, count: null };

  it('adds a repeats row to create drafts and to existing-meeting rows', () => {
    const draftRows = describeDraft(fmt, makeDraft({ startAt: '2030-03-11T09:00:00.000Z', recurrence: rule }));
    const draftByField = Object.fromEntries(draftRows.map((r) => [r.field, r.value]));
    expect(draftByField.repeats).toBe('Repeats weekly on Monday');

    const meetingRows = describeMeeting(fmt, makeMeeting('series', { recurrence: rule }));
    const meetingByField = Object.fromEntries(meetingRows.map((r) => [r.field, r.value]));
    expect(meetingByField.repeats).toBe('Repeats weekly on Monday');

    // One-off drafts show no repeats row.
    expect(describeDraft(fmt, makeDraft()).some((r) => r.field === 'repeats')).toBe(false);
  });

  it('diffs a rule change and a rule removal', () => {
    const meeting = makeMeeting('series', { recurrence: rule });
    const changed = computeUpdateDiff(fmt, meeting, {
      recurrence: { ...rule, freq: 'daily', byWeekday: null, interval: 2 },
    });
    expect(changed).toEqual([
      expect.objectContaining({ field: 'repeats', before: 'Repeats weekly on Monday', after: 'Repeats every 2 days' }),
    ]);

    const removed = computeUpdateDiff(fmt, meeting, { recurrence: null });
    expect(removed).toEqual([expect.objectContaining({ field: 'repeats', after: 'Does not repeat' })]);

    // Change rows without the meeting loaded still name the new rule.
    const rows = describeChangeRows(fmt, { recurrence: { ...rule, count: 5 } });
    expect(rows).toEqual([expect.objectContaining({ field: 'repeats', value: 'Repeats weekly on Monday, 5 times in total' })]);
  });

  it('spells out the scope of update/delete actions on recurring meetings', () => {
    const meeting = makeMeeting('series', { recurrence: rule });
    const occurrenceUpdate = {
      ...updateAction('a1', 'series', { title: 'x' }),
      scope: 'occurrence' as const,
      occurrenceDate: '2030-03-18',
    };
    expect(describeScopeRow(fmt, occurrenceUpdate, meeting)).toEqual(
      expect.objectContaining({ field: 'scope', value: 'Only the occurrence on 2030-03-18' }),
    );
    // A recurring target without a scope means the whole series - say so.
    expect(describeScopeRow(fmt, deleteAction('a2', 'series'), meeting)).toEqual(
      expect.objectContaining({ value: 'The whole repeating series' }),
    );
    // One-off meetings get no scope row.
    expect(describeScopeRow(fmt, deleteAction('a3', 'single'), makeMeeting('single'))).toBeNull();

    const occurrenceDelete = { ...deleteAction('a4', 'series'), scope: 'occurrence' as const, occurrenceDate: '2030-03-18' };
    expect(isOccurrenceDelete(occurrenceDelete, meeting)).toBe(true);
    expect(isOccurrenceDelete(occurrenceDelete, makeMeeting('single'))).toBe(false);
    expect(isOccurrenceDelete(deleteAction('a5', 'series'), meeting)).toBe(false);
  });

  it('reads naturally in Spanish', () => {
    const rows = describeDraft(fmtEs, makeDraft({ recurrence: { ...rule, until: '2030-06-30T21:59:00.000Z' } }));
    const byField = Object.fromEntries(rows.map((r) => [r.field, r.value]));
    expect(byField.repeats).toBe('Se repite cada semana los lunes, hasta el 2030-06-30');
  });
});
