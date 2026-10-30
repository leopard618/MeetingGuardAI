import { buildTask, type Task } from '../../../core/types';
import {
  importToPatch,
  nearestLocalDate,
  reminderToDueTime,
  taskReminderIso,
  taskToTodoWrite,
  taskVisibleHash,
  todoTaskToImport,
  visibleHash,
  type TodoMappingContext,
} from '../todo/mapping';
import type { GraphTodoTask } from '../todo/types';

const CTX: TodoMappingContext = { defaultTimeZone: 'America/Mexico_City', untitledTitle: '(No title)' };
const NOW = '2026-10-01T08:00:00.000Z';

function task(overrides: Partial<Parameters<typeof buildTask>[0]> = {}, zone = 'America/Mexico_City'): Task {
  return buildTask({ title: 'Prepare the proposal', ...overrides }, { id: 't1', userId: 'u1', timezone: zone, now: NOW });
}

function todo(overrides: Partial<GraphTodoTask> = {}): GraphTodoTask {
  return { id: 'AAMk1=', title: 'Prepare the proposal', status: 'notStarted', body: { content: '', contentType: 'text' }, lastModifiedDateTime: NOW, ...overrides };
}

describe('MeetingGuard -> To Do', () => {
  it('writes title, notes, local-midnight due date and no reminder for a plain task', () => {
    const write = taskToTodoWrite(task({ description: 'Numbers first', dueDate: '2026-10-05' }));
    expect(write).toEqual({
      title: 'Prepare the proposal',
      body: { content: 'Numbers first', contentType: 'text' },
      status: 'notStarted',
      // Mexico City is UTC-6 in October: local midnight.
      dueDateTime: { dateTime: '2026-10-05T06:00:00.000', timeZone: 'UTC' },
      isReminderOn: false,
      reminderDateTime: null,
    });
  });

  it('turns due time + offset into a To Do reminder instant and done into completed', () => {
    const write = taskToTodoWrite(task({ dueDate: '2026-10-05', dueTime: '16:00', reminderMinutesBefore: 30 }));
    expect(write.isReminderOn).toBe(true);
    expect(write.reminderDateTime).toEqual({ dateTime: '2026-10-05T21:30:00.000', timeZone: 'UTC' });
    expect(taskReminderIso(task({ dueDate: '2026-10-05', dueTime: '16:00', reminderMinutesBefore: 30 }))).toBe('2026-10-05T21:30:00.000Z');

    const done = { ...task(), status: 'done' as const, completedAt: NOW };
    expect(taskToTodoWrite(done).status).toBe('completed');
  });

  it('keeps a due time without a reminder in MeetingGuard only (date-only in To Do)', () => {
    const write = taskToTodoWrite(task({ dueDate: '2026-10-05', dueTime: '16:00' }));
    expect(write.dueDateTime?.dateTime).toBe('2026-10-05T06:00:00.000');
    expect(write.isReminderOn).toBe(false);
  });
});

describe('To Do -> MeetingGuard', () => {
  it('reads the nearest local date for both due-date conventions', () => {
    // Local midnight of Mexico City expressed in UTC (what To Do stores).
    expect(nearestLocalDate('2026-10-05T06:00:00.000Z', 'America/Mexico_City')).toBe('2026-10-05');
    // UTC midnight (what other clients may store): 18:00 the day before locally.
    expect(nearestLocalDate('2026-10-05T00:00:00.000Z', 'America/Mexico_City')).toBe('2026-10-05');
    // A positive-offset zone, UTC midnight: 09:00 the same day locally.
    expect(nearestLocalDate('2026-10-05T00:00:00.000Z', 'Asia/Tokyo')).toBe('2026-10-05');
    // Local midnight of Tokyo in UTC.
    expect(nearestLocalDate('2026-10-04T15:00:00.000Z', 'Asia/Tokyo')).toBe('2026-10-05');
  });

  it('imports title, notes, due date and reminder as due time + offset', () => {
    const imported = todoTaskToImport(
      todo({
        title: '  Call Ana  ',
        body: { content: 'About the kickoff', contentType: 'text' },
        dueDateTime: { dateTime: '2026-10-05T06:00:00.0000000', timeZone: 'UTC' },
        isReminderOn: true,
        reminderDateTime: { dateTime: '2026-10-05T21:30:00.0000000', timeZone: 'UTC' },
      }),
      CTX,
      null,
    );
    expect(imported.input).toEqual({
      title: 'Call Ana',
      description: 'About the kickoff',
      timezone: 'America/Mexico_City',
      dueDate: '2026-10-05',
      dueTime: '15:30',
      reminderMinutesBefore: 0,
    });
    expect(imported.done).toBe(false);
    expect(imported.visible).toEqual({ title: 'Call Ana', description: 'About the kickoff', dueDate: '2026-10-05', reminderAt: '2026-10-05T21:30:00.000Z', done: false });
  });

  it('keeps the local due time / offset split when the reminder instant did not change', () => {
    const existing = task({ dueDate: '2026-10-05', dueTime: '16:00', reminderMinutesBefore: 30 });
    const imported = todoTaskToImport(
      todo({
        dueDateTime: { dateTime: '2026-10-05T06:00:00.0000000', timeZone: 'UTC' },
        isReminderOn: true,
        reminderDateTime: { dateTime: '2026-10-05T21:30:00.0000000', timeZone: 'UTC' },
      }),
      CTX,
      existing,
    );
    expect(imported.input).toMatchObject({ dueDate: '2026-10-05', dueTime: '16:00', reminderMinutesBefore: 30 });
    expect(importToPatch(existing, imported)).toBeNull();
  });

  it('drops a stale reminder but keeps the plain due time when To Do turned the reminder off', () => {
    const existing = task({ dueDate: '2026-10-05', dueTime: '16:00', reminderMinutesBefore: 30 });
    const imported = todoTaskToImport(todo({ dueDateTime: { dateTime: '2026-10-05T06:00:00.0000000', timeZone: 'UTC' }, isReminderOn: false }), CTX, existing);
    expect(imported.input).toMatchObject({ dueDate: '2026-10-05', dueTime: '16:00', reminderMinutesBefore: null });
    expect(importToPatch(existing, imported)).toEqual({ reminderMinutesBefore: null });
  });

  it('places a reminder on an earlier day as an offset of whole days, else at the due time', () => {
    expect(reminderToDueTime('2026-10-04T15:00:00.000Z', '2026-10-05', 'America/Mexico_City')).toEqual({
      dueDate: '2026-10-05',
      dueTime: '09:00',
      reminderMinutesBefore: 1440,
    });
    // More than a week before: not representable as an offset, so the reminder instant is kept
    // and the due date moves onto it (ringing on the original due date would be weeks late).
    expect(reminderToDueTime('2026-09-20T15:00:00.000Z', '2026-10-05', 'America/Mexico_City')).toEqual({
      dueDate: '2026-09-20',
      dueTime: '09:00',
      reminderMinutesBefore: 0,
    });
    // No due date in To Do: the reminder gives both.
    expect(reminderToDueTime('2026-10-04T15:00:00.000Z', null, 'America/Mexico_City')).toEqual({
      dueDate: '2026-10-04',
      dueTime: '09:00',
      reminderMinutesBefore: 0,
    });
  });

  it('strips html notes, falls back to the untitled label and maps completed to done', () => {
    const imported = todoTaskToImport(
      todo({ title: '   ', body: { content: 'Line one<br>Line <b>two</b>', contentType: 'html' }, status: 'completed' }),
      CTX,
      null,
    );
    expect(imported.input.title).toBe('(No title)');
    expect(imported.input.description).toBe('Line one\nLine two');
    expect(imported.done).toBe(true);
    const existing = task();
    expect(importToPatch(existing, imported)).toEqual({ title: '(No title)', description: 'Line one\nLine two', status: 'done' });
  });

  it('hashes the same visible fields on both sides so a round trip is unchanged', () => {
    const local = task({ description: 'Numbers first', dueDate: '2026-10-05', dueTime: '16:00', reminderMinutesBefore: 30 });
    const write = taskToTodoWrite(local);
    const back = todoTaskToImport(
      todo({ title: write.title, body: write.body, dueDateTime: write.dueDateTime, isReminderOn: write.isReminderOn, reminderDateTime: write.reminderDateTime }),
      CTX,
      local,
    );
    expect(visibleHash(back.visible)).toBe(taskVisibleHash(local));
  });
});
