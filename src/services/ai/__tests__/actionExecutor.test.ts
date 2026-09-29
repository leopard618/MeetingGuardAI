import type { ConferenceDetails } from '../../../core/aiContract';
import type { MeetingRange, WriteOptions } from '../../../core/contracts';
import { AppError } from '../../../core/errors';
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
