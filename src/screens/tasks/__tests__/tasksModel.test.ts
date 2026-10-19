/**
 * Pure model of the Tasks screen: the "by text" half of the Stage 1 line about tasks being
 * created, edited, postponed, completed and deleted. The overdue and due-today predicates are the
 * same semantics the assistant answers with, so they are pinned against a fixed clock and zone.
 */
import { buildTask, type Task } from '../../../core/types';
import {
  TASK_TITLE_MAX,
  countByFilter,
  dateToDueDate,
  dateToDueTime,
  draftFromTask,
  draftToInput,
  draftToPatch,
  dueInstantMs,
  filterTasks,
  isDraftDirty,
  isDueToday,
  isOverdue,
  newTaskDraft,
  normalizeDraft,
  validateTaskDraft,
} from '../tasksModel';

// 14:00 in Madrid (CEST, +02:00) on Monday 2026-10-05.
const NOW = new Date('2026-10-05T12:00:00.000Z');
const ZONE = 'Europe/Madrid';
const CTX = { userId: 'u1', timezone: ZONE, now: NOW };

function task(id: string, overrides: Partial<Parameters<typeof buildTask>[0]> = {}): Task {
  return buildTask({ title: `Task ${id}`, ...overrides }, { ...CTX, id });
}

function done(id: string, overrides: Partial<Parameters<typeof buildTask>[0]> = {}): Task {
  return { ...task(id, overrides), status: 'done', completedAt: NOW.toISOString() };
}

describe('dueInstantMs', () => {
  it('anchors the due date and time in the task zone', () => {
    expect(dueInstantMs({ dueDate: '2026-10-06', dueTime: '09:00', timezone: ZONE })).toBe(
      Date.parse('2026-10-06T07:00:00.000Z'),
    );
  });

  it('is null without a date, and ends the day when there is no time', () => {
    expect(dueInstantMs({ dueDate: null, dueTime: null, timezone: ZONE })).toBeNull();
    // No time means the task is owed by the end of that local day (23:59), not at midnight.
    expect(dueInstantMs({ dueDate: '2026-10-06', dueTime: null, timezone: ZONE })).toBe(
      Date.parse('2026-10-06T21:59:00.000Z'),
    );
  });

  it('is null for an unusable zone instead of throwing', () => {
    expect(dueInstantMs({ dueDate: '2026-10-06', dueTime: '09:00', timezone: 'Not/AZone' })).toBeNull();
  });
});

describe('isOverdue', () => {
  it('counts a past date, and a time earlier today', () => {
    expect(isOverdue(task('a', { dueDate: '2026-10-04' }), NOW, ZONE)).toBe(true);
    expect(isOverdue(task('b', { dueDate: '2026-10-05', dueTime: '09:00' }), NOW, ZONE)).toBe(true);
  });

  it('does not count today without a time, or a time still to come', () => {
    expect(isOverdue(task('c', { dueDate: '2026-10-05' }), NOW, ZONE)).toBe(false);
    expect(isOverdue(task('d', { dueDate: '2026-10-05', dueTime: '18:00' }), NOW, ZONE)).toBe(false);
  });

  it('never counts an undated or a completed task', () => {
    expect(isOverdue(task('e'), NOW, ZONE)).toBe(false);
    expect(isOverdue(done('f', { dueDate: '2026-10-01' }), NOW, ZONE)).toBe(false);
  });
});

describe('isDueToday', () => {
  it('includes today and anything still owed from before', () => {
    expect(isDueToday(task('a', { dueDate: '2026-10-05' }), NOW, ZONE)).toBe(true);
    expect(isDueToday(task('b', { dueDate: '2026-10-01' }), NOW, ZONE)).toBe(true);
  });

  it('excludes tomorrow, undated and done tasks', () => {
    expect(isDueToday(task('c', { dueDate: '2026-10-06' }), NOW, ZONE)).toBe(false);
    expect(isDueToday(task('d'), NOW, ZONE)).toBe(false);
    expect(isDueToday(done('e', { dueDate: '2026-10-05' }), NOW, ZONE)).toBe(false);
  });
});

describe('filterTasks and countByFilter', () => {
  const tasks = [
    task('open1', { dueDate: '2026-10-09' }),
    task('today1', { dueDate: '2026-10-05' }),
    task('late1', { dueDate: '2026-10-01' }),
    done('done1', { dueDate: '2026-10-02' }),
    task('plain1'),
  ];

  function ids(filter: Parameters<typeof countByFilter>[0] extends never ? never : 'open' | 'today' | 'overdue' | 'done' | 'all', query = '') {
    return filterTasks(tasks, { query, filter, now: NOW, deviceZone: ZONE }).map((item) => item.id);
  }

  it('splits the tabs the way the counts promise', () => {
    expect(ids('open').sort()).toEqual(['late1', 'open1', 'plain1', 'today1']);
    expect(ids('today').sort()).toEqual(['late1', 'today1']);
    expect(ids('overdue')).toEqual(['late1']);
    expect(ids('done')).toEqual(['done1']);
    expect(ids('all')).toHaveLength(5);
  });

  it('counts exactly what each tab shows', () => {
    const counts = countByFilter(tasks, NOW, ZONE);
    expect(counts).toMatchObject({ open: 4, today: 2, overdue: 1, done: 1, all: 5 });
  });

  it('searches titles, ignoring case', () => {
    expect(ids('all', 'TODAY1')).toEqual(['today1']);
    expect(ids('all', 'nothing here')).toEqual([]);
  });

  it('finds a task through the title of the meeting it belongs to', () => {
    const linked = [task('linked1', { meetingId: 'mboard' })];
    const found = filterTasks(linked, {
      query: 'board review',
      filter: 'all',
      now: NOW,
      deviceZone: ZONE,
      meetingTitle: (id) => (id === 'mboard' ? 'Board review' : null),
    });
    expect(found.map((item) => item.id)).toEqual(['linked1']);
  });
});

describe('the editor draft', () => {
  it('round-trips a task and reports no changes', () => {
    const original = task('round1', { dueDate: '2026-10-06', dueTime: '16:00', reminderMinutesBefore: 30 });
    const draft = draftFromTask(original);
    expect(isDraftDirty(draft, draft)).toBe(false);
    expect(draftToPatch(original, draft)).toBeNull();
  });

  it('patches only what the user changed', () => {
    const original = task('patch1', { dueDate: '2026-10-06' });
    const patch = draftToPatch(original, { ...draftFromTask(original), title: 'Renamed' });
    expect(patch).toEqual({ title: 'Renamed' });
  });

  it('refuses an empty or over-long title', () => {
    expect(validateTaskDraft({ ...newTaskDraft(), title: '   ' }).title).toBe('titleRequired');
    expect(validateTaskDraft({ ...newTaskDraft(), title: 'x'.repeat(TASK_TITLE_MAX + 1) }).title).toBe('titleTooLong');
    expect(validateTaskDraft({ ...newTaskDraft(), title: 'Fine' }).title).toBeUndefined();
  });

  it('normalizes the due invariants: no date means no time and no reminder', () => {
    const cleared = normalizeDraft({ ...newTaskDraft(), dueDate: null, dueTime: '16:00', reminderMinutesBefore: 30 });
    expect(cleared).toMatchObject({ dueTime: null, reminderMinutesBefore: null });
  });

  it('trims the title on the way into a task', () => {
    const input = draftToInput({ ...newTaskDraft(), title: '  Prepare  ', description: 'notes   ' });
    expect(input.title).toBe('Prepare');
    expect(input.description).toBe('notes');
  });

  it('keeps a task created from a meeting linked to it', () => {
    expect(draftToInput(newTaskDraft({ meetingId: 'mboard' })).meetingId).toBe('mboard');
  });
});

describe('picker conversions', () => {
  it('reads the local wall clock off a Date', () => {
    const value = new Date(2026, 9, 6, 16, 45, 0, 0);
    expect(dateToDueDate(value)).toBe('2026-10-06');
    expect(dateToDueTime(value)).toBe('16:45');
  });

  it('pads single digits', () => {
    const value = new Date(2026, 0, 2, 9, 5, 0, 0);
    expect(dateToDueDate(value)).toBe('2026-01-02');
    expect(dateToDueTime(value)).toBe('09:05');
  });
});
