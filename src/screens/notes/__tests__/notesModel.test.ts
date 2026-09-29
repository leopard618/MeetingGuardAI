import { buildMeeting, buildNote, type Meeting, type Note, type NoteInput } from '../../../core/types';
import {
  NOTE_CONTENT_MAX,
  countByCategory,
  draftFromNote,
  draftToInput,
  draftToPatch,
  filterNotes,
  isDraftDirty,
  meetingChoices,
  newNoteDraft,
  normalizeForSearch,
  validateNoteDraft,
} from '../notesModel';

function note(id: string, input: NoteInput): Note {
  return buildNote(input, { id, userId: 'u1', now: '2026-09-01T10:00:00.000Z' });
}

function meeting(id: string, title: string, startAt: string, overrides: Partial<Parameters<typeof buildMeeting>[0]> = {}): Meeting {
  return buildMeeting(
    { title, startAt, timezone: 'UTC', durationMinutes: 60, source: 'manual', ...overrides },
    { id, userId: 'u1', now: '2026-09-01T00:00:00.000Z', defaultTimezone: 'UTC', defaultLanguage: 'en' },
  );
}

const NOTES = [
  note('n1', { title: 'Reunión de presupuesto', content: 'Revisar cifras del Q3', category: 'work', meetingId: 'm1' }),
  note('n2', { title: 'App ideas', content: 'Habit tracker', category: 'ideas' }),
  note('n3', { title: 'Groceries', content: 'Milk and bread', category: 'personal' }),
];

describe('filterNotes', () => {
  it('returns everything for an empty query and "all"', () => {
    expect(filterNotes(NOTES, { query: '  ', category: 'all' }).map((n) => n.id)).toEqual(['n1', 'n2', 'n3']);
  });

  it('filters by category', () => {
    expect(filterNotes(NOTES, { query: '', category: 'ideas' }).map((n) => n.id)).toEqual(['n2']);
  });

  it('matches every word in title or content, ignoring case and accents', () => {
    expect(filterNotes(NOTES, { query: 'reunion Q3', category: 'all' }).map((n) => n.id)).toEqual(['n1']);
    expect(filterNotes(NOTES, { query: 'MILK', category: 'all' }).map((n) => n.id)).toEqual(['n3']);
    expect(filterNotes(NOTES, { query: 'milk ideas', category: 'all' })).toEqual([]);
  });

  it('also matches the linked meeting’s title', () => {
    const titles: Record<string, string> = { m1: 'Budget review' };
    const result = filterNotes(NOTES, { query: 'budget', category: 'all', meetingTitle: (id) => titles[id] ?? null });
    expect(result.map((n) => n.id)).toEqual(['n1']);
  });

  it('normalizes text for search', () => {
    expect(normalizeForSearch('  Canción ÁRBOL ')).toBe('cancion arbol');
  });
});

it('counts notes per category', () => {
  expect(countByCategory(NOTES)).toEqual({ all: 3, general: 0, work: 1, ideas: 1, personal: 1 });
});

describe('note drafts', () => {
  it('validates the title and the content length', () => {
    expect(validateNoteDraft(newNoteDraft())).toEqual({ title: 'titleRequired' });
    expect(validateNoteDraft({ ...newNoteDraft(), title: 'x'.repeat(201) })).toEqual({ title: 'titleTooLong' });
    expect(validateNoteDraft({ ...newNoteDraft(), title: 'Ok', content: 'x'.repeat(NOTE_CONTENT_MAX + 1) })).toEqual({
      content: 'contentTooLong',
    });
    expect(validateNoteDraft({ ...newNoteDraft(), title: 'Ok' })).toEqual({});
  });

  it('builds a trimmed create input', () => {
    const draft = { ...newNoteDraft({ category: 'work', meetingId: 'm1' }), title: '  Agenda  ', content: 'Line 1\n\n  ', pinned: true };
    expect(draftToInput(draft)).toEqual({ title: 'Agenda', content: 'Line 1', category: 'work', meetingId: 'm1', pinned: true });
  });

  it('patches only what changed', () => {
    const original = NOTES[0] as Note;
    expect(draftToPatch(original, draftFromNote(original))).toBeNull();
    expect(draftToPatch(original, { ...draftFromNote(original), pinned: true, meetingId: null })).toEqual({ pinned: true, meetingId: null });
    expect(draftToPatch(original, { ...draftFromNote(original), title: ' New title ' })).toEqual({ title: 'New title' });
  });

  it('knows when a draft has unsaved changes', () => {
    const original = draftFromNote(NOTES[1] as Note);
    expect(isDraftDirty(original, original)).toBe(false);
    expect(isDraftDirty({ ...original, content: `${original.content}  \n` }, original)).toBe(false);
    expect(isDraftDirty({ ...original, category: 'work' }, original)).toBe(true);
    expect(isDraftDirty({ ...newNoteDraft(), title: 'a' }, newNoteDraft())).toBe(true);
  });
});

describe('meetingChoices', () => {
  const now = new Date('2026-10-01T12:00:00.000Z');
  const meetings = [
    meeting('past-old', 'Kickoff', '2026-09-01T09:00:00.000Z'),
    meeting('past-recent', 'Retro', '2026-09-30T09:00:00.000Z'),
    meeting('in-progress', 'Standup', '2026-10-01T11:30:00.000Z'),
    meeting('later', 'Budget review', '2026-10-05T09:00:00.000Z'),
    meeting('soon', 'Design sync', '2026-10-02T09:00:00.000Z', { location: { type: 'physical', address: 'Sala Azul', virtualUrl: null } }),
    { ...meeting('deleted', 'Gone', '2026-10-03T09:00:00.000Z'), deletedAt: '2026-09-02T00:00:00.000Z' },
  ];

  it('splits upcoming (soonest first, in progress included) and past (most recent first) without deleted meetings', () => {
    const choices = meetingChoices(meetings, { now });
    expect(choices.upcoming.map((m) => m.id)).toEqual(['in-progress', 'soon', 'later']);
    expect(choices.past.map((m) => m.id)).toEqual(['past-recent', 'past-old']);
  });

  it('searches titles and places', () => {
    expect(meetingChoices(meetings, { now, query: 'sala' }).upcoming.map((m) => m.id)).toEqual(['soon']);
    expect(meetingChoices(meetings, { now, query: 'retro' }).past.map((m) => m.id)).toEqual(['past-recent']);
  });
});
