import { createDefaultPreferences, buildTask, type Preferences, type Task } from '../../../core/types';
import { TASK_REMINDER_BUDGET, computeTaskReminderPlan } from '../taskReminders';

const NOW = new Date('2030-03-10T09:00:00.000Z');
const CTX = { userId: 'u1', timezone: 'Europe/Madrid', now: NOW };

function prefs(overrides: Partial<Preferences> = {}): Preferences {
  return { ...createDefaultPreferences({ timezone: 'Europe/Madrid' }), ...overrides };
}

function task(id: string, overrides: Partial<Parameters<typeof buildTask>[0]> = {}): Task {
  return buildTask(
    { title: `Task ${id}`, dueDate: '2030-03-12', dueTime: '16:00', reminderMinutesBefore: 30, ...overrides },
    { ...CTX, id },
  );
}

describe('computeTaskReminderPlan', () => {
  it('plans one reminder per eligible task at due minus the offset, in the task zone', () => {
    const items = computeTaskReminderPlan([task('taska11')], prefs(), NOW);
    expect(items).toHaveLength(1);
    // 2030-03-12 16:00 Europe/Madrid (CET, +01:00) = 15:00Z; minus 30 minutes.
    expect(items[0]).toMatchObject({
      identifier: 'mgtask:taska11',
      taskId: 'taska11',
      dueAt: '2030-03-12T15:00:00.000Z',
      fireAt: '2030-03-12T14:30:00.000Z',
      title: 'Task taska11',
    });
  });

  it('skips done tasks, tasks without a due time and tasks without a reminder', () => {
    const done = { ...task('taskdone'), status: 'done' as const, completedAt: NOW.toISOString() };
    const noTime = task('tasknotime', { dueTime: null, reminderMinutesBefore: null });
    const noReminder = task('tasknorem', { reminderMinutesBefore: null });
    expect(computeTaskReminderPlan([done, noTime, noReminder], prefs(), NOW)).toEqual([]);
  });

  it('is empty when alerts are disabled (master switch)', () => {
    expect(computeTaskReminderPlan([task('taska11')], prefs({ alertEnabled: false }), NOW)).toEqual([]);
  });

  it('drops reminders in the past and beyond the horizon', () => {
    const past = task('taskpast', { dueDate: '2030-03-10', dueTime: '09:15', reminderMinutesBefore: 30 });
    const far = task('taskfar', { dueDate: '2030-06-01' });
    expect(computeTaskReminderPlan([past, far], prefs(), NOW)).toEqual([]);
  });

  it('sorts by fire time and respects the budget', () => {
    const tasks = Array.from({ length: TASK_REMINDER_BUDGET + 5 }, (_, index) =>
      task(`taskn${index.toString().padStart(2, '0')}`, { dueDate: '2030-03-12', dueTime: `${String(8 + (index % 12)).padStart(2, '0')}:00` }),
    );
    const items = computeTaskReminderPlan(tasks, prefs(), NOW);
    expect(items).toHaveLength(TASK_REMINDER_BUDGET);
    const times = items.map((item) => item.fireAt);
    expect([...times].sort()).toEqual(times);
  });

  it('never throws on a task with an unusable zone', () => {
    const broken = { ...task('taskbroken'), timezone: 'Not/AZone' };
    expect(computeTaskReminderPlan([broken], prefs(), NOW)).toEqual([]);
  });
});
