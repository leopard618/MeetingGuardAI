import { buildTask, type Task } from '../../../core/types';
import {
  dueDateToGtasksDue,
  gtasksDueToDueDate,
  gtasksImportToPatch,
  gtasksTaskToImport,
  gtasksUpdatedIso,
  gtasksVisibleHash,
  taskGtasksVisibleHash,
  taskToGtasksWrite,
  type GtasksMappingContext,
} from '../gtasks/mapping';
import type { GoogleTask } from '../gtasks/types';

const CTX: GtasksMappingContext = { defaultTimeZone: 'America/Mexico_City', untitledTitle: '(No title)' };
const NOW = '2026-10-01T08:00:00.000Z';

function task(overrides: Partial<Parameters<typeof buildTask>[0]> = {}, zone = 'America/Mexico_City'): Task {
  return buildTask({ title: 'Prepare the proposal', ...overrides }, { id: 't1', userId: 'u1', timezone: zone, now: NOW });
}

function google(overrides: Partial<GoogleTask> = {}): GoogleTask {
  return { id: 'g1', title: 'Prepare the proposal', status: 'needsAction', notes: '', updated: NOW, ...overrides };
}

describe('Meeting Guard -> Google Tasks', () => {
  it('writes title, notes, the date-only due and needsAction for an open task', () => {
    const write = taskToGtasksWrite(task({ description: 'Numbers first', dueDate: '2026-10-05', dueTime: '16:00', reminderMinutesBefore: 30 }));
    expect(write).toEqual({
      title: 'Prepare the proposal',
      notes: 'Numbers first',
      status: 'needsAction',
      // The due time and the reminder stay in Meeting Guard: Google only gets the date.
      due: '2026-10-05T00:00:00.000Z',
      completed: null,
    });
  });

  it('marks done tasks completed with their completion time and clears a missing due date', () => {
    const done = { ...task(), status: 'done' as const, completedAt: NOW };
    expect(taskToGtasksWrite(done)).toMatchObject({ status: 'completed', completed: NOW, due: null });
  });

  it('formats and parses the date-only due value', () => {
    expect(dueDateToGtasksDue('2026-10-05')).toBe('2026-10-05T00:00:00.000Z');
    expect(gtasksDueToDueDate('2026-10-05T00:00:00.000Z')).toBe('2026-10-05');
    expect(gtasksDueToDueDate(undefined)).toBeNull();
    expect(gtasksDueToDueDate('garbage')).toBeNull();
  });
});

describe('Google Tasks -> Meeting Guard', () => {
  it('imports title, notes and due date anchored in the device zone', () => {
    const imported = gtasksTaskToImport(google({ title: '  Call Ana  ', notes: 'About the kickoff\r\n', due: '2026-10-05T00:00:00.000Z' }), CTX, null);
    expect(imported.input).toEqual({
      title: 'Call Ana',
      description: 'About the kickoff',
      timezone: 'America/Mexico_City',
      dueDate: '2026-10-05',
      dueTime: null,
      reminderMinutesBefore: null,
    });
    expect(imported.done).toBe(false);
    expect(imported.visible).toEqual({ title: 'Call Ana', description: 'About the kickoff', dueDate: '2026-10-05', done: false });
  });

  it('keeps the local due time and reminder while the due date did not change', () => {
    const existing = task({ dueDate: '2026-10-05', dueTime: '16:00', reminderMinutesBefore: 30 });
    const same = gtasksTaskToImport(google({ due: '2026-10-05T00:00:00.000Z' }), CTX, existing);
    expect(same.input).toMatchObject({ dueDate: '2026-10-05', dueTime: '16:00', reminderMinutesBefore: 30 });
    expect(gtasksImportToPatch(existing, same)).toBeNull();

    const moved = gtasksTaskToImport(google({ due: '2026-10-07T00:00:00.000Z' }), CTX, existing);
    expect(moved.input).toMatchObject({ dueDate: '2026-10-07', dueTime: null, reminderMinutesBefore: null });
    expect(gtasksImportToPatch(existing, moved)).toEqual({ dueDate: '2026-10-07', dueTime: null, reminderMinutesBefore: null });

    const cleared = gtasksTaskToImport(google({ due: undefined }), CTX, existing);
    expect(gtasksImportToPatch(existing, cleared)).toEqual({ dueDate: null, dueTime: null, reminderMinutesBefore: null });
  });

  it('falls back to the untitled label, maps completed to done and caps the notes', () => {
    const imported = gtasksTaskToImport(google({ title: '   ', notes: 'x'.repeat(5000), status: 'completed' }), CTX, null);
    expect(imported.input.title).toBe('(No title)');
    expect(imported.input.description).toHaveLength(4000);
    expect(imported.done).toBe(true);
    expect(gtasksImportToPatch(task(), imported)).toMatchObject({ title: '(No title)', status: 'done' });
  });

  it('hashes the same visible fields on both sides so a round trip is unchanged', () => {
    const local = task({ description: 'Numbers first', dueDate: '2026-10-05', dueTime: '16:00', reminderMinutesBefore: 30 });
    const write = taskToGtasksWrite(local);
    const back = gtasksTaskToImport(google({ title: write.title, notes: write.notes, due: write.due, status: write.status }), CTX, local);
    expect(gtasksVisibleHash(back.visible)).toBe(taskGtasksVisibleHash(local));
  });

  it('reads the updated time leniently', () => {
    expect(gtasksUpdatedIso(google({ updated: '2026-10-01T09:00:00.000Z' }))).toBe('2026-10-01T09:00:00.000Z');
    expect(gtasksUpdatedIso(google({ updated: undefined }))).toBeNull();
    expect(gtasksUpdatedIso(google({ updated: 'yesterday' }))).toBeNull();
  });
});
