/**
 * The task context is the whole basis of "what is overdue?" and of the task-to-meeting join that
 * answers "what should I prepare for tomorrow?", so its selection, ordering and exposed fields
 * are pinned here.
 */
import { CONTEXT_WINDOW } from '../../src/config';
import { DONE_KEEP_DAYS, buildTaskContext, toTaskModelView, type TaskRecord } from '../../src/assistant/tasksContext';

const NOW = new Date('2026-10-05T12:00:00.000Z');

function taskDoc(overrides: Record<string, unknown> = {}): TaskRecord['doc'] {
  return {
    title: 'Prepare the proposal',
    description: '',
    dueDate: '2026-10-06',
    dueTime: null,
    timezone: 'Europe/Madrid',
    reminderMinutesBefore: null,
    status: 'open',
    meetingId: null,
    people: [],
    completedAt: null,
    updatedAt: '2026-10-04T10:00:00.000Z',
    ...overrides,
  } as TaskRecord['doc'];
}

function record(id: string, overrides: Record<string, unknown> = {}): TaskRecord {
  return { id, doc: taskDoc(overrides) };
}

describe('buildTaskContext', () => {
  it('keeps every open task whatever its due date, so an overdue one is always answerable', () => {
    const context = buildTaskContext(
      [
        record('tlongago', { dueDate: '2025-01-01' }),
        record('tnodate', { dueDate: null }),
        record('tfuture', { dueDate: '2027-06-01' }),
      ],
      NOW,
    );
    expect(context.tasks.map((task) => task.taskId)).toEqual(['tlongago', 'tfuture', 'tnodate']);
  });

  it('sorts open tasks by due date and time, undated last', () => {
    const context = buildTaskContext(
      [
        record('tlate', { dueDate: '2026-10-06', dueTime: '18:00' }),
        record('tnone', { dueDate: null }),
        record('tearly', { dueDate: '2026-10-06', dueTime: '08:00' }),
        record('tyesterday', { dueDate: '2026-10-04' }),
      ],
      NOW,
    );
    expect(context.tasks.map((task) => task.taskId)).toEqual(['tyesterday', 'tearly', 'tlate', 'tnone']);
  });

  it('keeps recently completed tasks and drops older ones', () => {
    const fresh = new Date(NOW.getTime() - 2 * 86_400_000).toISOString();
    const stale = new Date(NOW.getTime() - (DONE_KEEP_DAYS + 2) * 86_400_000).toISOString();
    const context = buildTaskContext(
      [
        record('tfresh', { status: 'done', completedAt: fresh }),
        record('tstale', { status: 'done', completedAt: stale }),
      ],
      NOW,
    );
    expect(context.tasks.map((task) => task.taskId)).toEqual(['tfresh']);
  });

  it('puts open tasks before done ones', () => {
    const context = buildTaskContext(
      [
        record('tdone', { status: 'done', completedAt: NOW.toISOString(), dueDate: '2026-10-01' }),
        record('topen', { dueDate: '2026-10-09' }),
      ],
      NOW,
    );
    expect(context.tasks.map((task) => task.taskId)).toEqual(['topen', 'tdone']);
  });

  it('assigns t-prefixed refs that can never be confused with a meeting ref', () => {
    const context = buildTaskContext([record('tabc1234'), record('tdef5678')], NOW);
    for (const task of context.tasks) expect(task.ref.startsWith('t')).toBe(true);
    expect(new Set(context.tasks.map((task) => task.ref)).size).toBe(2);
    expect(context.byRef.get(context.tasks[0]!.ref)?.taskId).toBe(context.tasks[0]!.taskId);
  });

  it('respects the task cap and keeps the most urgent ones', () => {
    const records = Array.from({ length: CONTEXT_WINDOW.maxTasks + 10 }, (_unused, index) =>
      record(`tcap${String(index).padStart(3, '0')}`, { dueDate: `2026-${String(1 + (index % 12)).padStart(2, '0')}-01` }),
    );
    const context = buildTaskContext(records, NOW);
    expect(context.tasks).toHaveLength(CONTEXT_WINDOW.maxTasks);
    const dues = context.tasks.map((task) => task.doc.dueDate ?? '');
    expect([...dues].sort()).toEqual(dues);
  });

  it('counts malformed documents instead of failing the whole context', () => {
    const broken = { id: 'tbroken1', doc: { title: 42 } } as unknown as TaskRecord;
    const context = buildTaskContext([broken, record('tgood123')], NOW);
    expect(context.tasks.map((task) => task.taskId)).toEqual(['tgood123']);
    expect(context.skippedInvalid).toBe(1);
  });
});

describe('toTaskModelView', () => {
  const noMeetings = new Map<string, string>();

  function view(overrides: Record<string, unknown> = {}, meetings = noMeetings) {
    const context = buildTaskContext([record('tview123', overrides)], NOW);
    const task = context.tasks[0];
    if (!task) throw new Error('task missing from the context');
    return toTaskModelView(task, 'Europe/Madrid', meetings);
  }

  it('exposes a date-only due value when there is no time', () => {
    expect(view({ dueDate: '2026-10-06', dueTime: null })).toMatchObject({ due: '2026-10-06', status: 'open' });
  });

  it('exposes date and time together when there is a time', () => {
    expect(view({ dueDate: '2026-10-06', dueTime: '16:00' }).due).toBe('2026-10-06 16:00');
  });

  it('names the task zone only when it differs from the user zone', () => {
    expect(view({ timezone: 'Europe/Madrid' }).taskTimeZone).toBeUndefined();
    expect(view({ timezone: 'America/Bogota' }).taskTimeZone).toBe('America/Bogota');
  });

  it('omits the due value entirely for an undated task, so it can never read as overdue', () => {
    const undated = view({ dueDate: null });
    expect(undated.due).toBeUndefined();
    expect(undated.taskTimeZone).toBeUndefined();
  });

  it('joins the task to its meeting only when that meeting is in the context', () => {
    expect(view({ meetingId: 'merger' }, new Map([['merger', 'mabc']])).meetingRef).toBe('mabc');
    expect(view({ meetingId: 'merger' }).meetingRef).toBeUndefined();
    expect(view({ meetingId: null }, new Map([['merger', 'mabc']])).meetingRef).toBeUndefined();
  });

  it('sends people as names only, never their email addresses', () => {
    const withPeople = view({ people: [{ name: 'Ana', email: 'ana@corp.com' }] });
    expect(withPeople.people).toEqual(['Ana']);
    expect(JSON.stringify(withPeople)).not.toContain('ana@corp.com');
  });

  it('never sends the task description', () => {
    expect(JSON.stringify(view({ description: 'Internal only' }))).not.toContain('Internal only');
  });
});
