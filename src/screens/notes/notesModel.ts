/**
 * PURE model of the Notes screen: filtering / search, the editor draft (validation, create
 * input, minimal patch) and the meeting choices for linking a note. No React, no services.
 */
import { NOTE_CATEGORIES, type Meeting, type Note, type NoteCategory, type NoteInput, type NotePatch } from '../../core/types';

/** Limits of core/types noteInputSchema / noteSchema. */
export const NOTE_TITLE_MAX = 200;
export const NOTE_CONTENT_MAX = 20_000;

export const NOTE_FILTERS = ['all', ...NOTE_CATEGORIES] as const;
export type NoteFilter = (typeof NOTE_FILTERS)[number];

/** Lower case, accents removed ("Reunión" matches "reunion"). */
export function normalizeForSearch(value: string): string {
  let text = value.toLowerCase();
  try {
    text = text.normalize('NFD').replace(/[̀-ͯ]/g, '');
  } catch {
    // Runtimes without String.prototype.normalize: plain lower-case matching.
  }
  return text.trim();
}

export interface NoteFilterOptions {
  query: string;
  category: NoteFilter;
  /** Title of a linked meeting (so a search for the meeting finds its notes). */
  meetingTitle?: (meetingId: string) => string | null;
}

/** Notes matching the category and every word of the query (the input order is kept). */
export function filterNotes(notes: readonly Note[], options: NoteFilterOptions): Note[] {
  const words = normalizeForSearch(options.query).split(/\s+/).filter((word) => word.length > 0);
  return notes.filter((note) => {
    if (options.category !== 'all' && note.category !== options.category) return false;
    if (words.length === 0) return true;
    const linked = note.meetingId && options.meetingTitle ? (options.meetingTitle(note.meetingId) ?? '') : '';
    const haystack = normalizeForSearch(`${note.title}\n${note.content}\n${linked}`);
    return words.every((word) => haystack.includes(word));
  });
}

/** Number of notes per filter chip. */
export function countByCategory(notes: readonly Note[]): Record<NoteFilter, number> {
  const counts = Object.fromEntries(NOTE_FILTERS.map((filter) => [filter, 0])) as Record<NoteFilter, number>;
  for (const note of notes) {
    counts.all += 1;
    counts[note.category] += 1;
  }
  return counts;
}

// ---- Editor draft -----------------------------------------------------------------------------

export interface NoteDraft {
  title: string;
  content: string;
  category: NoteCategory;
  meetingId: string | null;
  pinned: boolean;
}

export function newNoteDraft(options: { category?: NoteCategory; meetingId?: string | null } = {}): NoteDraft {
  return { title: '', content: '', category: options.category ?? 'general', meetingId: options.meetingId ?? null, pinned: false };
}

export function draftFromNote(note: Note): NoteDraft {
  return { title: note.title, content: note.content, category: note.category, meetingId: note.meetingId, pinned: note.pinned };
}

export type NoteDraftError = 'titleRequired' | 'titleTooLong' | 'contentTooLong';
export interface NoteDraftErrors {
  title?: NoteDraftError;
  content?: NoteDraftError;
}

export function validateNoteDraft(draft: NoteDraft): NoteDraftErrors {
  const errors: NoteDraftErrors = {};
  const title = draft.title.trim();
  if (title.length === 0) errors.title = 'titleRequired';
  else if (title.length > NOTE_TITLE_MAX) errors.title = 'titleTooLong';
  if (draft.content.length > NOTE_CONTENT_MAX) errors.content = 'contentTooLong';
  return errors;
}

export function isDraftValid(draft: NoteDraft): boolean {
  return Object.keys(validateNoteDraft(draft)).length === 0;
}

/** Trailing blank lines / spaces are not kept (leading indentation is). */
function cleanContent(content: string): string {
  return content.replace(/\s+$/, '');
}

export function draftToInput(draft: NoteDraft): NoteInput {
  return {
    title: draft.title.trim(),
    content: cleanContent(draft.content),
    category: draft.category,
    meetingId: draft.meetingId,
    pinned: draft.pinned,
  };
}

/** Only the fields the user changed (a concurrent change of another field on another device is kept); null when nothing changed. */
export function draftToPatch(note: Note, draft: NoteDraft): NotePatch | null {
  const next = draftToInput(draft);
  const patch: NotePatch = {};
  if (next.title !== note.title) patch.title = next.title;
  if (next.content !== note.content) patch.content = next.content;
  if (next.category !== note.category) patch.category = next.category;
  if ((next.meetingId ?? null) !== note.meetingId) patch.meetingId = next.meetingId ?? null;
  if (next.pinned !== note.pinned) patch.pinned = next.pinned;
  return Object.keys(patch).length > 0 ? patch : null;
}

/** Whether the draft differs from what was opened (a new note: anything typed or chosen). */
export function isDraftDirty(draft: NoteDraft, original: NoteDraft): boolean {
  return (
    draft.title.trim() !== original.title.trim() ||
    cleanContent(draft.content) !== cleanContent(original.content) ||
    draft.category !== original.category ||
    draft.meetingId !== original.meetingId ||
    draft.pinned !== original.pinned
  );
}

// ---- Meeting link choices -----------------------------------------------------------------------

function meetingEnd(meeting: Meeting): number {
  return Date.parse(meeting.startAt) + Math.max(meeting.durationMinutes, 0) * 60_000;
}

export interface MeetingChoices {
  /** Not finished yet (in progress included), soonest first. */
  upcoming: Meeting[];
  /** Finished, most recent first. */
  past: Meeting[];
}

/** Meetings a note can be linked to (deleted ones excluded), filtered by `query`. */
export function meetingChoices(meetings: readonly Meeting[], options: { now: Date; query?: string }): MeetingChoices {
  const words = normalizeForSearch(options.query ?? '').split(/\s+/).filter((word) => word.length > 0);
  const nowMs = options.now.getTime();
  const upcoming: Meeting[] = [];
  const past: Meeting[] = [];
  for (const meeting of meetings) {
    if (meeting.deletedAt !== null) continue;
    if (words.length > 0) {
      const haystack = normalizeForSearch(`${meeting.title}\n${meeting.location?.address ?? ''}`);
      if (!words.every((word) => haystack.includes(word))) continue;
    }
    if (meetingEnd(meeting) >= nowMs) upcoming.push(meeting);
    else past.push(meeting);
  }
  upcoming.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  past.sort((a, b) => Date.parse(b.startAt) - Date.parse(a.startAt));
  return { upcoming, past };
}
