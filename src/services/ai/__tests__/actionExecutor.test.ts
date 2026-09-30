import type { ConferenceDetails } from '../../../core/aiContract';
import type { MeetingRange, WriteOptions } from '../../../core/contracts';
import { AppError } from '../../../core/errors';
import { CANCELLED_OVERRIDE, splitRecurrenceAt, withRecurrenceOverride } from '../../../core/recurrence';
import { applyMeetingPatch, buildMeeting, tombstoneMeeting, type Meeting, type MeetingCreateInput, type MeetingPatch } from '../../../core/types';
import {
  NOW,
  UID,
  bulkAction,
  createAction,
  createTestFormatter,
  deleteAction,
  listAction,
  makeMeeting,
  memoryStorage,
  shareAction,
  updateAction,
} from '../__fixtures__/aiTestKit';
import { createActionExecutor } from '../actionExecutor';
import { createExecutedStore } from '../executedStore';
import { actionIdempotencyKey, aiMeetingIdForAction } from '../ids';
import type { AiActionResult, ShareAdapter } from '../types';

class FakeMeetings {
  readonly byId = new Map<string, Meeting>();
  readonly calls: { op: string; id: string; options?: WriteOptions; patch?: MeetingPatch; input?: MeetingCreateInput }[] = [];
  failUpdateFor = new Set<string>();

  constructor(meetings: Meeting[] = []) {
    for (const m of meetings) this.byId.set(m.id, m);
  }

  get = jest.fn(async (id: string) => this.byId.get(id) ?? null);

  list = jest.fn(async (range?: MeetingRange) =>
    [...this.byId.values()]
      .filter((m) => m.deletedAt === null)
      .filter((m) => (range?.from ? m.startAt >= range.from : true) && (range?.to ? m.startAt < range.to : true))
      .sort((a, b) => a.startAt.localeCompare(b.startAt)),
  );

  create = jest.fn(async (input: MeetingCreateInput, options?: WriteOptions) => {
    const id = options?.id ?? `gen_${this.byId.size + 1}`;
    const existing = this.byId.get(id);
    if (existing) return existing;
    const meeting = buildMeeting(input, { id, userId: UID, now: NOW, defaultTimezone: 'UTC', defaultLanguage: 'en' });
    this.byId.set(id, meeting);
    this.calls.push({ op: 'create', id, options, input });
    return meeting;
  });

  update = jest.fn(async (id: string, patch: MeetingPatch, options?: WriteOptions) => {
    if (this.failUpdateFor.has(id)) throw new AppError('offline', 'simulated');
    const current = this.byId.get(id);
    if (!current || current.deletedAt) throw new AppError('not_found');
    const next = applyMeetingPatch(current, patch, NOW);
    this.byId.set(id, next);
    this.calls.push({ op: 'update', id, options, patch });
    return next;
  });

  remove = jest.fn(async (id: string, options?: WriteOptions) => {
    const current = this.byId.get(id);
    if (current) this.byId.set(id, tombstoneMeeting(current, NOW));
    this.calls.push({ op: 'remove', id, options });
  });

  // MeetingRecurrenceOps (rec-core implements these on the real repository).
  updateOccurrence = jest.fn(
    async (id: string, localDateKey: string, patch: Pick<MeetingPatch, 'startAt' | 'durationMinutes' | 'title'>, options?: WriteOptions) => {
      const current = this.byId.get(id);
      if (!current || current.deletedAt || current.recurrence === null) throw new AppError('invalid_input');
      const override = {
        status: 'modified' as const,
        startAt: patch.startAt !== undefined ? new Date(patch.startAt).toISOString() : null,
        durationMinutes: patch.durationMinutes ?? null,
        title: patch.title ?? null,
      };
      const next = applyMeetingPatch(
        current,
        { recurrenceOverrides: withRecurrenceOverride(current.recurrenceOverrides, localDateKey, override) },
        NOW,
      );
      this.byId.set(id, next);
      this.calls.push({ op: 'updateOccurrence', id, options, patch });
      return next;
    },
  );

  cancelOccurrence = jest.fn(async (id: string, localDateKey: string, options?: WriteOptions) => {
    const current = this.byId.get(id);
    if (!current || current.deletedAt || current.recurrence === null) throw new AppError('invalid_input');
    const next = applyMeetingPatch(
      current,
      { recurrenceOverrides: withRecurrenceOverride(current.recurrenceOverrides, localDateKey, { ...CANCELLED_OVERRIDE }) },
      NOW,
    );
    this.byId.set(id, next);
    this.calls.push({ op: 'cancelOccurrence', id, options });
    return next;
  });

  restoreOccurrence = jest.fn(async (id: string, localDateKey: string, options?: WriteOptions) => {
    const current = this.byId.get(id);
    if (!current || current.deletedAt || current.recurrence === null) throw new AppError('invalid_input');
    const next = applyMeetingPatch(
      current,
      { recurrenceOverrides: withRecurrenceOverride(current.recurrenceOverrides, localDateKey, null) },
      NOW,
    );
    this.byId.set(id, next);
    this.calls.push({ op: 'restoreOccurrence', id, options });
    return next;
  });

  // "This and following" (v3): a faithful miniature of the engine's split semantics.
  editFollowing = jest.fn(async (id: string, fromDateKey: string, patch: MeetingPatch, options?: WriteOptions) => {
    const current = this.byId.get(id);
    if (!current || current.deletedAt || current.recurrence === null) throw new AppError('invalid_input');
    const split = splitRecurrenceAt(current, fromDateKey);
    this.calls.push({ op: 'editFollowing', id, options, patch });
    if (split === 'series_edit') {
      const master = applyMeetingPatch(current, patch, NOW);
      this.byId.set(id, master);
      return { master, created: null };
    }
    const master = applyMeetingPatch(current, { recurrence: split.masterRule, recurrenceOverrides: split.masterOverrides }, NOW);
    this.byId.set(id, master);
    const tailId = `tail_${this.byId.size + 1}`;
    const base = buildMeeting(
      {
        title: current.title,
        startAt: split.tailStartAt,
        source: current.source === 'google' ? 'manual' : current.source,
        timezone: current.timezone,
        durationMinutes: current.durationMinutes,
        recurrence: split.tailRule,
        recurrenceOverrides: split.tailOverrides,
      },
      { id: tailId, userId: UID, now: NOW, defaultTimezone: 'UTC', defaultLanguage: 'en' },
    );
    const created = Object.keys(patch).length > 0 ? applyMeetingPatch(base, patch, NOW) : base;
    this.byId.set(tailId, created);
    return { master, created };
  });

  deleteFollowing = jest.fn(async (id: string, fromDateKey: string, options?: WriteOptions) => {
    const current = this.byId.get(id);
    if (!current || current.deletedAt || current.recurrence === null) throw new AppError('invalid_input');
    const split = splitRecurrenceAt(current, fromDateKey);
    this.calls.push({ op: 'deleteFollowing', id, options });
    if (split === 'series_edit') {
      this.byId.set(id, tombstoneMeeting(current, NOW));
      return null;
    }
    const master = applyMeetingPatch(current, { recurrence: split.masterRule, recurrenceOverrides: split.masterOverrides }, NOW);
    this.byId.set(id, master);
    return master;
  });
}

function setup(options: { meetings?: Meeting[]; connected?: boolean; uid?: string | null; mailFails?: boolean; shareOutcome?: 'shared' | 'dismissed' } = {}) {
  const meetings = new FakeMeetings(options.meetings ?? []);
  const calendar = {
    isConnected: jest.fn(async () => options.connected ?? false),
    createMeetLink: jest.fn(async (meetingId: string): Promise<ConferenceDetails> => {
      const url = `https://meet.google.com/abc-defg-hij`;
      const current = meetings.byId.get(meetingId);
      if (current) meetings.byId.set(meetingId, { ...current, conference: { provider: 'google_meet', url, password: null } });
      return { provider: 'google_meet', url, password: null };
    }),
  };
  const sharing: ShareAdapter & { openMailComposer: jest.Mock; shareText: jest.Mock } = {
    openMailComposer: jest.fn(async () => {
      if (options.mailFails) throw new Error('No activity found to handle Intent');
    }),
    shareText: jest.fn(async () => options.shareOutcome ?? 'shared'),
  };
  const storage = memoryStorage();
  const executor = createActionExecutor({
    meetings,
    calendar,
    sharing,
    executed: createExecutedStore(storage, () => NOW),
    getUid: () => (options.uid === undefined ? UID : options.uid),
    getFormatter: () => createTestFormatter(),
    now: () => NOW,
  });
  return { executor, meetings, calendar, sharing, storage };
}

function expectDone(result: AiActionResult): Extract<AiActionResult, { status: 'done' }> {
  if (result.status !== 'done') throw new Error(`expected done, got failed: ${result.error.code}`);
  return result;
}

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('create_meeting', () => {
  it('creates through the repository with origin ai, source ai_chat and a deterministic id', async () => {
    const { executor, meetings } = setup();
    const action = createAction('a_1-1', { participants: [{ email: 'Ana@Example.com', name: 'Ana' }] });

    const result = expectDone(await executor.execute(action));

    expect(result).toMatchObject({ type: 'create_meeting', duplicate: false, meetingIds: [aiMeetingIdForAction(action)] });
    expect(meetings.create).toHaveBeenCalledTimes(1);
    const created = meetings.byId.get(aiMeetingIdForAction(action));
    expect(created).toMatchObject({ source: 'ai_chat', confidence: 92, title: 'Budget review' });
    expect(created?.participants).toEqual([{ email: 'ana@example.com', name: 'Ana', status: null }]);
    expect(meetings.calls[0]?.options).toEqual({ origin: 'ai', id: aiMeetingIdForAction(action) });
  });

  it('is idempotent: running the same action again is a duplicate no-op', async () => {
    const { executor, meetings } = setup();
    const action = createAction('a_1-1');

    await executor.execute(action);
    const second = expectDone(await executor.execute(action));

    expect(second.duplicate).toBe(true);
    expect(meetings.create).toHaveBeenCalledTimes(1);
  });

  it('shares one execution between concurrent double taps', async () => {
    const { executor, meetings } = setup();
    const action = createAction('a_1-1');

    const [first, second] = await Promise.all([executor.execute(action), executor.execute(action)]);

    expect(first).toBe(second);
    expect(meetings.create).toHaveBeenCalledTimes(1);
  });

  it('remembers executed actions across executor instances (persistent record)', async () => {
    const shared = memoryStorage();
    const meetings = new FakeMeetings();
    const make = () =>
      createActionExecutor({
        meetings,
        calendar: { isConnected: async () => false, createMeetLink: jest.fn() },
        sharing: { openMailComposer: jest.fn(), shareText: jest.fn() },
        executed: createExecutedStore(shared, () => NOW),
        getUid: () => UID,
        getFormatter: () => createTestFormatter(),
        now: () => NOW,
      });
    const action = createAction('a_1-1');

    await make().execute(action);
    const again = expectDone(await make().execute(action));

    expect(again.duplicate).toBe(true);
    expect(meetings.create).toHaveBeenCalledTimes(1);
  });

  it('does not confuse two different actions that reuse the same id', async () => {
    const { executor, meetings } = setup();
    await executor.execute(createAction('act_1', { title: 'First' }));
    const other = expectDone(await executor.execute(createAction('act_1', { title: 'Second' })));

    expect(other.duplicate).toBe(false);
    expect(meetings.create).toHaveBeenCalledTimes(2);
    expect(actionIdempotencyKey(createAction('act_1', { title: 'First' }))).not.toBe(
      actionIdempotencyKey(createAction('act_1', { title: 'Second' })),
    );
  });

  it('creates a real Google Meet link when requested and the calendar is connected', async () => {
    const { executor, calendar, meetings } = setup({ connected: true });
    const action = createAction('a_1-1', { conference: { provider: 'google_meet', url: null, password: null } });

    const result = expectDone(await executor.execute(action));

    expect(calendar.createMeetLink).toHaveBeenCalledWith(aiMeetingIdForAction(action));
    expect(result.meetLinkCreated).toBe(true);
    expect(meetings.byId.get(aiMeetingIdForAction(action))?.conference?.url).toBe('https://meet.google.com/abc-defg-hij');
  });

  it('never invents a Meet link when Google Calendar is not connected', async () => {
    const { executor, calendar, meetings } = setup({ connected: false });
    const action = createAction('a_1-1', { conference: { provider: 'google_meet', url: null, password: null } });

    const result = expectDone(await executor.execute(action));

    expect(calendar.createMeetLink).not.toHaveBeenCalled();
    expect(result).toMatchObject({ meetLinkCreated: false, meetLinkError: 'calendar_not_connected' });
    expect(meetings.byId.get(aiMeetingIdForAction(action))?.conference).toEqual({ provider: 'google_meet', url: null, password: null });
  });

  it('reports a failed Meet link creation without failing the created meeting', async () => {
    const { executor, calendar } = setup({ connected: true });
    calendar.createMeetLink.mockRejectedValueOnce(new AppError('upstream_error', 'google 500'));
    const action = createAction('a_1-1', { conference: { provider: 'google_meet', url: null, password: null } });

    const result = expectDone(await executor.execute(action));

    expect(result).toMatchObject({ meetLinkCreated: false, meetLinkError: 'upstream_error' });
  });

  it('fails with unauthenticated when there is no data session', async () => {
    const { executor, meetings } = setup({ uid: null });
    const result = await executor.execute(createAction('a_1-1'));
    expect(result.status).toBe('failed');
    expect(result.status === 'failed' && result.error.code).toBe('unauthenticated');
    expect(meetings.create).not.toHaveBeenCalled();
  });
});

describe('update_meeting', () => {
  it('applies only the proposed changes with origin ai and keeps known participant statuses', async () => {
    const meeting = makeMeeting('m1', { participants: [{ email: 'ana@example.com', name: 'Ana', status: 'accepted' }] });
    const { executor, meetings } = setup({ meetings: [meeting] });

    const result = expectDone(
      await executor.execute(
        updateAction('a_2-1', 'm1', {
          startAt: '2030-03-11T17:00:00.000Z',
          participants: [
            { email: 'ana@example.com', name: 'Ana' },
            { email: 'bob@example.com', name: null },
          ],
        }),
      ),
    );

    expect(result.meetingIds).toEqual(['m1']);
    const updated = meetings.byId.get('m1');
    expect(updated?.startAt).toBe('2030-03-11T17:00:00.000Z');
    expect(updated?.title).toBe('Meeting m1');
    expect(updated?.participants).toEqual([
      { email: 'ana@example.com', name: 'Ana', status: 'accepted' },
      { email: 'bob@example.com', name: null, status: null },
    ]);
    expect(meetings.calls[0]).toMatchObject({ op: 'update', options: { origin: 'ai' } });
  });

  it('fails with not_found for a deleted meeting', async () => {
    const meeting = tombstoneMeeting(makeMeeting('m1'), NOW);
    const { executor, meetings } = setup({ meetings: [meeting] });
    const result = await executor.execute(updateAction('a_2-1', 'm1', { title: 'New' }));
    expect(result.status === 'failed' && result.error.code).toBe('not_found');
    expect(meetings.update).not.toHaveBeenCalled();
  });
});

describe('delete_meeting', () => {
  it('soft-deletes through the repository once', async () => {
    const { executor, meetings } = setup({ meetings: [makeMeeting('m1')] });
    const action = deleteAction('a_3-1', 'm1');

    expectDone(await executor.execute(action));
    const again = expectDone(await executor.execute(action));

    expect(meetings.remove).toHaveBeenCalledTimes(1);
    expect(meetings.remove).toHaveBeenCalledWith('m1', { origin: 'ai' });
    expect(again.duplicate).toBe(true);
  });
});

describe('bulk_update', () => {
  it('shifts every meeting once and never twice after a partial failure is retried', async () => {
    const { executor, meetings } = setup({ meetings: [makeMeeting('m1'), makeMeeting('m2', { startAt: '2030-03-11T16:00:00.000Z' })] });
    const action = bulkAction('a_4-1', ['m1', 'm2'], { shiftMinutes: 30 });
    meetings.failUpdateFor.add('m2');

    const first = await executor.execute(action);
    expect(first.status === 'failed' && first.error.code).toBe('offline');
    expect(meetings.byId.get('m1')?.startAt).toBe('2030-03-11T15:30:00.000Z');

    meetings.failUpdateFor.clear();
    const retry = expectDone(await executor.execute(action));

    expect(meetings.byId.get('m1')?.startAt).toBe('2030-03-11T15:30:00.000Z');
    expect(meetings.byId.get('m2')?.startAt).toBe('2030-03-11T16:30:00.000Z');
    expect(retry.meetingIds.sort()).toEqual(['m1', 'm2']);
    expect(meetings.update).toHaveBeenCalledTimes(3);
  });

  it('skips all-day meetings for a non-whole-day shift and missing meetings', async () => {
    const allDay = makeMeeting('m2', { allDay: true, startAt: '2030-03-11T00:00:00.000Z', durationMinutes: 1440 });
    const { executor } = setup({ meetings: [makeMeeting('m1'), allDay] });

    const result = expectDone(await executor.execute(bulkAction('a_4-1', ['m1', 'm2', 'gone'], { shiftMinutes: 30 })));

    expect(result.meetingIds).toEqual(['m1']);
    expect(result.skippedMeetingIds).toEqual(['m2', 'gone']);
  });

  it('applies the same changes to every meeting', async () => {
    const { executor, meetings } = setup({ meetings: [makeMeeting('m1'), makeMeeting('m2')] });
    expectDone(
      await executor.execute(bulkAction('a_4-1', ['m1', 'm2'], { shiftMinutes: null, changes: { durationMinutes: 30 } })),
    );
    expect(meetings.byId.get('m1')?.durationMinutes).toBe(30);
    expect(meetings.byId.get('m2')?.durationMinutes).toBe(30);
  });

  it('fails with not_found when no meeting could be updated', async () => {
    const { executor } = setup();
    const result = await executor.execute(bulkAction('a_4-1', ['gone']));
    expect(result.status === 'failed' && result.error.code).toBe('not_found');
  });
});

describe('share_meeting', () => {
  it('opens the mail composer addressed to the recipients with a localized summary', async () => {
    const meeting = makeMeeting('m1', {
      title: 'Marketing sync',
      conference: { provider: 'zoom', url: 'https://zoom.us/j/123', password: '999' },
    });
    const { executor, sharing } = setup({ meetings: [meeting] });

    const result = expectDone(await executor.execute(shareAction('a_5-1', 'm1', { recipients: ['john@company.com', 'ana@x.io'] })));

    expect(result).toMatchObject({ delivery: 'mail_composer', recipients: ['john@company.com', 'ana@x.io'] });
    const url: string = sharing.openMailComposer.mock.calls[0][0];
    expect(url.startsWith('mailto:john@company.com,ana@x.io?subject=')).toBe(true);
    const body = decodeURIComponent(url.split('&body=')[1] ?? '');
    expect(body).toContain('Marketing sync');
    expect(body).toContain('Join (Zoom): https://zoom.us/j/123');
    expect(body).toContain('Password: 999');
    expect(sharing.shareText).not.toHaveBeenCalled();
  });

  it('falls back to the share sheet (recipients listed) when no mail app is available', async () => {
    const { executor, sharing } = setup({ meetings: [makeMeeting('m1')], mailFails: true });

    const result = expectDone(await executor.execute(shareAction('a_5-1', 'm1')));

    expect(result.delivery).toBe('system_share');
    expect(sharing.shareText.mock.calls[0][0].message).toContain('To: john@company.com');
  });

  it('treats a dismissed share sheet as cancelled and lets it run again', async () => {
    const { executor, sharing } = setup({ meetings: [makeMeeting('m1')], shareOutcome: 'dismissed' });
    const action = shareAction('a_5-1', 'm1', { channel: 'system_share', recipients: [] });

    const first = await executor.execute(action);
    expect(first.status === 'failed' && first.error.code).toBe('cancelled');

    sharing.shareText.mockResolvedValueOnce('shared');
    const second = expectDone(await executor.execute(action));
    expect(second).toMatchObject({ delivery: 'system_share', duplicate: false });
  });
});

describe('list', () => {
  it('resolves the existing meetings without recording anything', async () => {
    const { executor, storage } = setup({ meetings: [makeMeeting('m1')] });
    const result = expectDone(await executor.execute(listAction('a_6-1', ['m1', 'gone'])));
    expect(result.meetingIds).toEqual(['m1']);
    expect(storage.data.size).toBe(0);
  });
});

describe('preview', () => {
  it('flags past times, overlaps and a Meet link that needs the calendar', async () => {
    const busy = makeMeeting('busy', { title: 'Standup', startAt: '2030-03-12T16:30:00.000Z', durationMinutes: 30 });
    const { executor } = setup({ meetings: [busy], connected: false });

    const preview = await executor.preview(
      createAction('a_7-1', { conference: { provider: 'google_meet', url: null, password: null } }),
    );

    expect(preview.warnings).toEqual(expect.arrayContaining(['overlaps_existing', 'google_meet_needs_calendar']));
    expect(preview.overlapping.map((m) => m.id)).toEqual(['busy']);
    expect(preview.calendarConnected).toBe(false);

    const past = await executor.preview(createAction('a_7-2', { startAt: '2030-03-09T10:00:00.000Z' }));
    expect(past.warnings).toContain('start_in_past');
  });

  it('resolves referenced meetings and reports missing ones', async () => {
    const { executor } = setup({ meetings: [makeMeeting('m1')] });
    const preview = await executor.preview(bulkAction('a_7-3', ['m1', 'gone']));
    expect(preview.meetings.map((m) => m.id)).toEqual(['m1']);
    expect(preview.missingMeetingIds).toEqual(['gone']);
    expect(preview.warnings).toContain('meeting_not_found');
  });

  it('does not flag an update overlapping only with itself', async () => {
    const { executor } = setup({ meetings: [makeMeeting('m1')] });
    const preview = await executor.preview(updateAction('a_7-4', 'm1', { durationMinutes: 90 }));
    expect(preview.warnings).toEqual([]);
  });

  it('lists recipients and participants that are not on the meeting yet', async () => {
    const meeting = makeMeeting('m1', { participants: [{ email: 'Ana@Example.com', name: 'Ana' }] });
    const { executor } = setup({ meetings: [meeting] });

    const share = await executor.preview(shareAction('a_7-5', 'm1', { recipients: ['ana@example.com', 'stranger@evil.example'] }));
    expect(share.warnings).toContain('new_people');
    expect(share.newPeople).toEqual(['stranger@evil.example']);

    const update = await executor.preview(
      updateAction('a_7-6', 'm1', { participants: [{ email: 'ana@example.com', name: 'Ana' }, { email: 'new@corp.com', name: null }] }),
    );
    expect(update.newPeople).toEqual(['new@corp.com']);

    const known = await executor.preview(shareAction('a_7-7', 'm1', { recipients: ['ana@example.com'] }));
    expect(known.warnings).not.toContain('new_people');
  });
});

describe('recurrence scopes (v2)', () => {
  const rule = { freq: 'weekly' as const, interval: 1, byWeekday: null, byMonthDay: null, until: null, count: null };
  const series = () => makeMeeting('series', { startAt: '2030-03-11T15:00:00.000Z', recurrence: rule });

  it('applies an occurrence-scoped update as an override, never as a series update', async () => {
    const { executor, meetings } = setup({ meetings: [series()] });
    const action = {
      ...updateAction('a_occ1', 'series', { startAt: '2030-03-18T16:30:00.000Z', title: 'Moved standup' }),
      scope: 'occurrence' as const,
      occurrenceDate: '2030-03-18',
    };
    const result = expectDone(await executor.execute(action));
    expect(result.meetingIds).toEqual(['series']);
    expect(meetings.updateOccurrence).toHaveBeenCalledWith(
      'series',
      '2030-03-18',
      { startAt: '2030-03-18T16:30:00.000Z', title: 'Moved standup' },
      { origin: 'ai' },
    );
    expect(meetings.update).not.toHaveBeenCalled();
    expect(meetings.byId.get('series')?.recurrenceOverrides?.['2030-03-18']).toMatchObject({ status: 'modified' });
  });

  it('ignores the occurrence scope on a one-off meeting (plain update, as the contract requires)', async () => {
    const { executor, meetings } = setup({ meetings: [makeMeeting('single')] });
    const action = {
      ...updateAction('a_occ2', 'single', { title: 'Renamed' }),
      scope: 'occurrence' as const,
      occurrenceDate: '2030-03-11',
    };
    expectDone(await executor.execute(action));
    expect(meetings.update).toHaveBeenCalledWith('single', expect.objectContaining({ title: 'Renamed' }), { origin: 'ai' });
    expect(meetings.updateOccurrence).not.toHaveBeenCalled();
  });

  it('cancels one occurrence on delete with scope occurrence; the series survives', async () => {
    const { executor, meetings } = setup({ meetings: [series()] });
    const action = { ...deleteAction('a_occ3', 'series'), scope: 'occurrence' as const, occurrenceDate: '2030-03-25' };
    const result = expectDone(await executor.execute(action));
    expect(result.meetingIds).toEqual(['series']);
    expect(meetings.cancelOccurrence).toHaveBeenCalledWith('series', '2030-03-25', { origin: 'ai' });
    expect(meetings.remove).not.toHaveBeenCalled();
    const stored = meetings.byId.get('series')!;
    expect(stored.deletedAt).toBeNull();
    expect(stored.recurrenceOverrides?.['2030-03-25']).toMatchObject({ status: 'cancelled' });
  });

  it('deletes the whole series without a scope (v1 behavior)', async () => {
    const { executor, meetings } = setup({ meetings: [series()] });
    expectDone(await executor.execute(deleteAction('a_occ4', 'series')));
    expect(meetings.remove).toHaveBeenCalledWith('series', { origin: 'ai' });
    expect(meetings.cancelOccurrence).not.toHaveBeenCalled();
  });

  it('fails loudly (never fakes success) when the repository lacks the recurrence ops', async () => {
    const { executor, meetings } = setup({ meetings: [series()] });
    // Simulate an older repository without MeetingRecurrenceOps.
    (meetings as { updateOccurrence?: unknown }).updateOccurrence = undefined;
    (meetings as { cancelOccurrence?: unknown }).cancelOccurrence = undefined;
    (meetings as { restoreOccurrence?: unknown }).restoreOccurrence = undefined;
    const action = { ...deleteAction('a_occ5', 'series'), scope: 'occurrence' as const, occurrenceDate: '2030-03-25' };
    const result = await executor.execute(action);
    expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(result.error.code).toBe('not_implemented');
    expect(meetings.byId.get('series')?.deletedAt).toBeNull();
  });

  it('is idempotent per action id for occurrence-scoped actions', async () => {
    const { executor, meetings } = setup({ meetings: [series()] });
    const action = { ...deleteAction('a_occ6', 'series'), scope: 'occurrence' as const, occurrenceDate: '2030-03-25' };
    expectDone(await executor.execute(action));
    const again = expectDone(await executor.execute(action));
    expect(again.duplicate).toBe(true);
    expect(meetings.cancelOccurrence).toHaveBeenCalledTimes(1);
  });

  it('previews an occurrence move: overlap and past checks use the moved occurrence window', async () => {
    const clash = makeMeeting('clash', { startAt: '2030-03-18T16:00:00.000Z', durationMinutes: 60 });
    const { executor } = setup({ meetings: [series(), clash] });
    const move = {
      ...updateAction('a_occ7', 'series', { startAt: '2030-03-18T16:30:00.000Z' }),
      scope: 'occurrence' as const,
      occurrenceDate: '2030-03-18',
    };
    const preview = await executor.preview(move);
    expect(preview.warnings).toContain('overlaps_existing');
    expect(preview.overlapping.map((m) => m.id)).toEqual(['clash']);

    const rename = {
      ...updateAction('a_occ8', 'series', { title: 'No time change' }),
      scope: 'occurrence' as const,
      occurrenceDate: '2030-03-18',
    };
    const renamePreview = await executor.preview(rename);
    expect(renamePreview.warnings).toEqual([]);

    const past = {
      ...updateAction('a_occ9', 'series', { startAt: '2030-03-01T10:00:00.000Z' }),
      scope: 'occurrence' as const,
      occurrenceDate: '2030-03-04',
    };
    const pastPreview = await executor.preview(past);
    expect(pastPreview.warnings).toContain('start_in_past');
  });
});

describe('recurrence scope following (v3)', () => {
  const rule = { freq: 'weekly' as const, interval: 1, byWeekday: null, byMonthDay: null, until: null, count: null };
  const series = () => makeMeeting('series', { startAt: '2030-03-11T15:00:00.000Z', recurrence: rule });

  it('applies a following-scoped update through editFollowing: full patch on the tail, both ids reported', async () => {
    const { executor, meetings } = setup({ meetings: [series()] });
    const action = {
      ...updateAction('a_fol1', 'series', { title: 'Renamed from here', durationMinutes: 45 }),
      scope: 'following' as const,
      occurrenceDate: '2030-03-18',
    };
    const result = expectDone(await executor.execute(action));
    expect(meetings.editFollowing).toHaveBeenCalledWith(
      'series',
      '2030-03-18',
      { title: 'Renamed from here', durationMinutes: 45 },
      { origin: 'ai' },
    );
    expect(meetings.update).not.toHaveBeenCalled();
    expect(meetings.updateOccurrence).not.toHaveBeenCalled();

    const master = meetings.byId.get('series')!;
    expect(master.title).toBe('Meeting series'); // earlier occurrences keep their values
    expect(master.recurrence?.until).toBe('2030-03-18T14:59:59.000Z');
    const tailId = result.meetingIds[1]!;
    expect(result.meetingIds[0]).toBe('series');
    const tail = meetings.byId.get(tailId)!;
    expect(tail.title).toBe('Renamed from here');
    expect(tail.durationMinutes).toBe(45);
    expect(tail.startAt).toBe('2030-03-18T15:00:00.000Z');
  });

  it('ignores the following scope on a one-off meeting (plain update, as the contract requires)', async () => {
    const { executor, meetings } = setup({ meetings: [makeMeeting('single')] });
    const action = {
      ...updateAction('a_fol2', 'single', { title: 'Renamed' }),
      scope: 'following' as const,
      occurrenceDate: '2030-03-11',
    };
    expectDone(await executor.execute(action));
    expect(meetings.update).toHaveBeenCalledWith('single', expect.objectContaining({ title: 'Renamed' }), { origin: 'ai' });
    expect(meetings.editFollowing).not.toHaveBeenCalled();
  });

  it('a following-scoped delete truncates the series through deleteFollowing; earlier occurrences survive', async () => {
    const { executor, meetings } = setup({ meetings: [series()] });
    const action = { ...deleteAction('a_fol3', 'series'), scope: 'following' as const, occurrenceDate: '2030-03-25' };
    const result = expectDone(await executor.execute(action));
    expect(result.meetingIds).toEqual(['series']);
    expect(meetings.deleteFollowing).toHaveBeenCalledWith('series', '2030-03-25', { origin: 'ai' });
    expect(meetings.remove).not.toHaveBeenCalled();
    expect(meetings.cancelOccurrence).not.toHaveBeenCalled();
    const stored = meetings.byId.get('series')!;
    expect(stored.deletedAt).toBeNull();
    expect(stored.recurrence?.until).toBe('2030-03-25T14:59:59.000Z');
  });

  it('fails loudly (never fakes success) when the repository lacks the following ops', async () => {
    const { executor, meetings } = setup({ meetings: [series()] });
    (meetings as { editFollowing?: unknown }).editFollowing = undefined;
    (meetings as { deleteFollowing?: unknown }).deleteFollowing = undefined;
    const action = { ...deleteAction('a_fol4', 'series'), scope: 'following' as const, occurrenceDate: '2030-03-25' };
    const result = await executor.execute(action);
    expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(result.error.code).toBe('not_implemented');
    expect(meetings.byId.get('series')?.recurrence?.until).toBeNull();
  });

  it('is idempotent per action id for following-scoped actions', async () => {
    const { executor, meetings } = setup({ meetings: [series()] });
    const action = { ...deleteAction('a_fol5', 'series'), scope: 'following' as const, occurrenceDate: '2030-03-25' };
    expectDone(await executor.execute(action));
    const again = expectDone(await executor.execute(action));
    expect(again.duplicate).toBe(true);
    expect(meetings.deleteFollowing).toHaveBeenCalledTimes(1);
  });

  it('previews a following move like an occurrence move: the split occurrence window is checked', async () => {
    const clash = makeMeeting('clash', { startAt: '2030-03-18T16:00:00.000Z', durationMinutes: 60 });
    const { executor } = setup({ meetings: [series(), clash] });
    const move = {
      ...updateAction('a_fol6', 'series', { startAt: '2030-03-18T16:30:00.000Z' }),
      scope: 'following' as const,
      occurrenceDate: '2030-03-18',
    };
    const preview = await executor.preview(move);
    expect(preview.warnings).toContain('overlaps_existing');
    expect(preview.overlapping.map((m) => m.id)).toEqual(['clash']);

    const rename = {
      ...updateAction('a_fol7', 'series', { title: 'No time change' }),
      scope: 'following' as const,
      occurrenceDate: '2030-03-18',
    };
    const renamePreview = await executor.preview(rename);
    expect(renamePreview.warnings).toEqual([]);
  });
});
