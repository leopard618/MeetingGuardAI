import { applyTaskPatch, buildTask, EMPTY_TASK_EXTERNAL_REFS, parseTaskDoc, taskSchema, type Task } from '../types';

const CTX = { id: 'task1', userId: 'u1', timezone: 'Europe/Madrid', now: '2030-03-10T09:00:00.000Z' };

describe('buildTask', () => {
  it('builds an open task with defaults from a minimal input', () => {
    const task = buildTask({ title: '  Prepare the proposal  ' }, CTX);
    expect(task).toMatchObject({
      id: 'task1',
      userId: 'u1',
      title: 'Prepare the proposal',
      description: '',
      dueDate: null,
      dueTime: null,
      timezone: 'Europe/Madrid',
      reminderMinutesBefore: null,
      status: 'open',
      meetingId: null,
      people: [],
      completedAt: null,
    });
    expect(task.createdAt).toBe('2030-03-10T09:00:00.000Z');
    expect(taskSchema.safeParse(task).success).toBe(true);
  });

  it('keeps a full due date, time, reminder, link and people', () => {
    const task = buildTask(
      {
        title: 'Call Ana',
        description: 'About the kickoff',
        dueDate: '2030-03-12',
        dueTime: '16:00',
        reminderMinutesBefore: 30,
        meetingId: 'meet1234',
        people: [{ name: 'Ana', email: 'ana@example.com' }, { name: 'The landlord', email: null }],
      },
      CTX,
    );
    expect(task.dueDate).toBe('2030-03-12');
    expect(task.dueTime).toBe('16:00');
    expect(task.reminderMinutesBefore).toBe(30);
    expect(task.meetingId).toBe('meet1234');
    expect(task.people).toHaveLength(2);
  });

  it('normalizes a time without a date and a reminder without a time away', () => {
    const task = buildTask({ title: 'Loose ends', dueTime: '09:00', reminderMinutesBefore: 10 }, CTX);
    expect(task.dueDate).toBeNull();
    expect(task.dueTime).toBeNull();
    expect(task.reminderMinutesBefore).toBeNull();
  });

  it('rejects empty titles and invalid dates', () => {
    expect(() => buildTask({ title: '   ' }, CTX)).toThrow();
    expect(() => buildTask({ title: 'x', dueDate: 'tomorrow' }, CTX)).toThrow();
    expect(() => buildTask({ title: 'x', timezone: 'Mars/Olympus' }, CTX)).toThrow();
  });
});

describe('applyTaskPatch', () => {
  const base = buildTask({ title: 'Prepare the proposal', dueDate: '2030-03-12', dueTime: '16:00', reminderMinutesBefore: 30 }, CTX);

  it('completes and reopens with completedAt managed automatically', () => {
    const done = applyTaskPatch(base, { status: 'done' }, '2030-03-11T10:00:00.000Z');
    expect(done.status).toBe('done');
    expect(done.completedAt).toBe('2030-03-11T10:00:00.000Z');

    const doneAgain = applyTaskPatch(done, { title: 'Prepare the final proposal' }, '2030-03-11T11:00:00.000Z');
    expect(doneAgain.completedAt).toBe('2030-03-11T10:00:00.000Z');

    const reopened = applyTaskPatch(done, { status: 'open' }, '2030-03-11T12:00:00.000Z');
    expect(reopened.status).toBe('open');
    expect(reopened.completedAt).toBeNull();
  });

  it('postpones by changing the due date', () => {
    const moved = applyTaskPatch(base, { dueDate: '2030-03-14' }, '2030-03-11T10:00:00.000Z');
    expect(moved.dueDate).toBe('2030-03-14');
    expect(moved.dueTime).toBe('16:00');
    expect(moved.reminderMinutesBefore).toBe(30);
  });

  it('clearing the due date also clears the time and the reminder', () => {
    const cleared = applyTaskPatch(base, { dueDate: null }, '2030-03-11T10:00:00.000Z');
    expect(cleared.dueDate).toBeNull();
    expect(cleared.dueTime).toBeNull();
    expect(cleared.reminderMinutesBefore).toBeNull();
  });

  it('clearing only the time clears the reminder but keeps the date', () => {
    const cleared = applyTaskPatch(base, { dueTime: null }, '2030-03-11T10:00:00.000Z');
    expect(cleared.dueDate).toBe('2030-03-12');
    expect(cleared.dueTime).toBeNull();
    expect(cleared.reminderMinutesBefore).toBeNull();
  });

  it('keeps unspecified fields', () => {
    const patched = applyTaskPatch(base, { description: 'Slides first' }, '2030-03-11T10:00:00.000Z');
    expect(patched.title).toBe(base.title);
    expect(patched.dueDate).toBe(base.dueDate);
    expect(patched.meetingId).toBe(base.meetingId);
  });
});

describe('parseTaskDoc', () => {
  const doc = (overrides: Partial<Omit<Task, 'id'>> = {}): Record<string, unknown> => ({
    userId: 'u1',
    title: 'Prepare the proposal',
    description: '',
    dueDate: null,
    dueTime: null,
    timezone: 'Europe/Madrid',
    reminderMinutesBefore: null,
    status: 'open',
    meetingId: null,
    people: [],
    completedAt: null,
    createdAt: '2030-03-10T09:00:00.000Z',
    updatedAt: '2030-03-10T09:00:00.000Z',
    ...overrides,
  });

  it('parses a stored document and fills missing optionals', () => {
    const minimal = {
      userId: 'u1',
      title: 'Old doc',
      timezone: 'UTC',
      status: 'open',
      createdAt: '2030-03-10T09:00:00.000Z',
      updatedAt: '2030-03-10T09:00:00.000Z',
    };
    const task = parseTaskDoc('task1', minimal);
    expect(task).toMatchObject({ id: 'task1', description: '', dueDate: null, people: [], completedAt: null });
  });

  it('repairs cross-field drift instead of dropping the document', () => {
    const task = parseTaskDoc('task1', doc({ dueTime: '10:00', reminderMinutesBefore: 5 }));
    expect(task).not.toBeNull();
    expect(task?.dueTime).toBeNull();
    expect(task?.reminderMinutesBefore).toBeNull();

    const done = parseTaskDoc('task1', doc({ status: 'done', completedAt: null }));
    expect(done?.completedAt).toBe('2030-03-10T09:00:00.000Z');
  });

  it('rejects documents without the required fields', () => {
    expect(parseTaskDoc('task1', { title: 'x' })).toBeNull();
    expect(parseTaskDoc('bad id!', doc())).toBeNull();
  });
});

describe('Microsoft To Do link fields (M7)', () => {
  it('builds manual tasks without a To Do link by default', () => {
    const task = buildTask({ title: 'Prepare the proposal' }, CTX);
    expect(task.source).toBe('manual');
    expect(task.external).toEqual({ ...EMPTY_TASK_EXTERNAL_REFS });
  });

  it('takes the source from the builder context and the target list from the input', () => {
    const task = buildTask({ title: 'Call Ana', todoListId: 'list-work' }, { ...CTX, source: 'ai_chat' });
    expect(task.source).toBe('ai_chat');
    expect(task.external).toEqual({ ...EMPTY_TASK_EXTERNAL_REFS, todoListId: 'list-work' });
  });

  it('merges link write-backs and list moves into external without touching the rest', () => {
    const task = buildTask({ title: 'Call Ana', todoListId: 'list-work' }, CTX);
    const linked = applyTaskPatch(
      task,
      { external: { todoTaskId: 'AAMk1', todoUpdatedAt: '2030-03-10T09:05:00.000Z' } },
      '2030-03-10T09:05:00.000Z',
    );
    expect(linked.external).toEqual({ ...EMPTY_TASK_EXTERNAL_REFS, todoListId: 'list-work', todoTaskId: 'AAMk1', todoUpdatedAt: '2030-03-10T09:05:00.000Z' });
    expect(linked.title).toBe('Call Ana');

    const moved = applyTaskPatch(linked, { todoListId: 'list-home' }, '2030-03-10T09:06:00.000Z');
    expect(moved.external).toEqual({ ...EMPTY_TASK_EXTERNAL_REFS, todoListId: 'list-home', todoTaskId: 'AAMk1', todoUpdatedAt: '2030-03-10T09:05:00.000Z' });

    const unlinked = applyTaskPatch(moved, { todoListId: null }, '2030-03-10T09:07:00.000Z');
    expect(unlinked.external.todoListId).toBeNull();
  });

  it('reads documents written before the link existed as manual and unlinked', () => {
    const task = parseTaskDoc('task1', {
      userId: 'u1',
      title: 'Old doc',
      timezone: 'UTC',
      status: 'open',
      createdAt: '2030-03-10T09:00:00.000Z',
      updatedAt: '2030-03-10T09:00:00.000Z',
    });
    expect(task).toMatchObject({ source: 'manual', external: { todoListId: null, todoTaskId: null, todoUpdatedAt: null } });
    expect(taskSchema.safeParse(task).success).toBe(true);
  });

  it('rejects an unknown source', () => {
    const base = buildTask({ title: 'x' }, CTX);
    expect(taskSchema.safeParse({ ...base, source: 'google' }).success).toBe(false);
  });
});
