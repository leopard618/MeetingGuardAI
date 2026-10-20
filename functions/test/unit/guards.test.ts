import { buildTaskContext } from '../../src/assistant/tasksContext';
import { isPlainConsent, lastUserText, missingMoveQuestion } from '../../src/assistant/guards';
import type { AiAction } from '../../src/shared/aiContract';

describe('isPlainConsent (server backstop for "an unclear reply never executes")', () => {
  it('accepts plain consent and plain refusal in both languages', () => {
    for (const text of ['yes', 'Yes, I confirm.', 'ok go ahead', 'sure, do it', 'no', 'cancel', 'sí, confirmo', 'vale', 'no, cancela']) {
      expect(isPlainConsent(text)).toBe(true);
    }
  });

  it('rejects anything that qualifies the answer', () => {
    for (const text of [
      'yes but make it earlier',
      'yes, I confirm but move it to 5pm',
      'ok, only the first one',
      'yes and add Ana',
      'sí pero más tarde',
      'confirma solo la reunión',
    ]) {
      expect(isPlainConsent(text)).toBe(false);
    }
  });

  it('rejects long messages, which are requests rather than answers', () => {
    expect(isPlainConsent('yes please go ahead and create that meeting for me now thanks')).toBe(false);
    expect(isPlainConsent('')).toBe(false);
  });
});

describe('lastUserText', () => {
  it('returns the latest message the user typed, skipping suggestion chips', () => {
    expect(
      lastUserText([
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'reply' },
        { role: 'user', content: 'chip', origin: 'suggestion' },
      ]),
    ).toBe('first');
    expect(lastUserText([{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }])).toBe('b');
  });
});

describe('missingMoveQuestion (the move prompt the reply must carry)', () => {
  const NOW = new Date('2026-10-05T12:00:00.000Z');
  const tasks = buildTaskContext(
    [
      {
        id: 'tprep1',
        doc: {
          title: 'Prepare the proposal', description: '', dueDate: '2026-10-06', dueTime: null,
          timezone: 'UTC', reminderMinutesBefore: null, status: 'open', meetingId: 'mcall',
          people: [], completedAt: null, updatedAt: '2026-10-04T00:00:00.000Z',
        },
      },
      {
        id: 'tnodate',
        doc: {
          title: 'Someday task', description: '', dueDate: null, dueTime: null,
          timezone: 'UTC', reminderMinutesBefore: null, status: 'open', meetingId: 'mcall',
          people: [], completedAt: null, updatedAt: '2026-10-04T00:00:00.000Z',
        },
      },
    ],
    NOW,
  );
  const move: AiAction = {
    type: 'update_meeting', id: 'a1', summary: 'Move the call.', confidence: 90,
    meetingId: 'mcall', changes: { startAt: '2026-10-08T10:00:00.000Z' },
  };

  it('asks about a linked, dated, open task the response did not move or mention', () => {
    expect(missingMoveQuestion([move], tasks, 'en', 'Moving the call to Thursday.')).toBe('Should I move "Prepare the proposal" as well?');
    expect(missingMoveQuestion([move], tasks, 'es', 'Muevo la llamada al jueves.')).toBe('¿Muevo también "Prepare the proposal"?');
  });

  it('stays silent when the reply already names the task, or the response moves it', () => {
    expect(missingMoveQuestion([move], tasks, 'en', 'Moving the call. Should I move Prepare the proposal too?')).toBeNull();
    const moveTask: AiAction = {
      type: 'update_task', id: 'a2', summary: 'Move the task.', confidence: 90,
      taskId: 'tprep1', changes: { dueDate: '2026-10-07' },
    };
    expect(missingMoveQuestion([move, moveTask], tasks, 'en', 'Moving both.')).toBeNull();
  });

  it('ignores updates that do not move the meeting, and tasks without a due date', () => {
    const rename: AiAction = { ...move, changes: { title: 'New name' } };
    expect(missingMoveQuestion([rename], tasks, 'en', 'Renamed.')).toBeNull();
    // Only the dated task is asked about; "Someday task" never is.
    expect(missingMoveQuestion([move], tasks, 'en', '')).not.toContain('Someday');
  });

  it('is null without a task context', () => {
    expect(missingMoveQuestion([move], null, 'en', '')).toBeNull();
  });
});
