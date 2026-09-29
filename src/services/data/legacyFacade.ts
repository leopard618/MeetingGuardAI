/**
 * Compat facade for the stage-3 JS screens (src/api/entities.js, src/services/firestoreService.js,
 * src/api/localStorage.js, src/utils/storage.js). Thin, typed delegation to the data engine with
 * the legacy shapes (core/legacy.ts). Delete together with the shims in stage 3.
 *
 * Semantics that intentionally differ from the old code (report #8, #19, DATA-13):
 * - Errors surface as AppError; nothing falls back to a device-only store while reporting success.
 * - UserPreferences.filter always returns exactly one element (the merged preferences document).
 * - Deletes are soft deletes (tombstones) that sync to other devices.
 */
import { AppError } from '../../core/errors';
import {
  fromLegacyMeetingInput,
  fromLegacyMeetingPatch,
  fromLegacyPreferencesPatch,
  toLegacyMeetingView,
  toLegacyPreferencesView,
  type LegacyMeetingView,
  type LegacyPreferencesView,
} from '../../core/legacy';
import { getDeviceTimeZone } from '../../core/time';
import {
  effectivePlan,
  NOTE_CATEGORIES,
  type AuthUser,
  type Note,
  type NoteCategory,
  type NoteInput,
  type NotePatch,
  type Plan,
  type UserProfile,
} from '../../core/types';
import { dataEngine } from './instance';

type LegacyRecord = Record<string, unknown>;

function asRecord(value: unknown): LegacyRecord {
  return typeof value === 'object' && value !== null ? (value as LegacyRecord) : {};
}

function toView(meeting: Parameters<typeof toLegacyMeetingView>[0]): LegacyMeetingView {
  return toLegacyMeetingView(meeting, { timeZone: getDeviceTimeZone() });
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Legacy sort keys: "-created_date" (default of the old API), "created_date", "date", "-date". */
export function sortLegacyViews<T extends { created_date: string; startTime: string }>(views: T[], sortBy?: string): T[] {
  const key = sortBy ?? '-created_date';
  const sorted = [...views];
  switch (key) {
    case '-created_date':
      return sorted.sort((a, b) => compareStrings(b.created_date, a.created_date));
    case 'created_date':
      return sorted.sort((a, b) => compareStrings(a.created_date, b.created_date));
    case '-date':
    case '-startTime':
      return sorted.sort((a, b) => compareStrings(b.startTime, a.startTime));
    default:
      return sorted.sort((a, b) => compareStrings(a.startTime, b.startTime));
  }
}

// ---------------------------------------------------------------------------------------------
// Meetings
// ---------------------------------------------------------------------------------------------

export const legacyMeetings = {
  async list(sortBy?: string): Promise<LegacyMeetingView[]> {
    const meetings = await dataEngine.listMeetings();
    return sortLegacyViews(meetings.map(toView), sortBy);
  },

  /** Equality filter on legacy view fields (e.g. { date: '2026-10-05' }). Always an array. */
  async filter(criteria: unknown, sortBy?: string): Promise<LegacyMeetingView[]> {
    const wanted = Object.entries(asRecord(criteria)).filter(([key, value]) => value !== undefined && key !== 'created_by');
    const views = await legacyMeetings.list(sortBy);
    return views.filter((view) => wanted.every(([key, value]) => (view as unknown as LegacyRecord)[key] === value));
  },

  async get(id: string): Promise<LegacyMeetingView | null> {
    const meeting = await dataEngine.getMeeting(id);
    return meeting ? toView(meeting) : null;
  },

  async create(data: unknown): Promise<LegacyMeetingView> {
    const { input } = fromLegacyMeetingInput(data, { timeZone: getDeviceTimeZone(), language: dataEngine.language() });
    const meeting = await dataEngine.createMeeting(input, { origin: input.source === 'ai_chat' ? 'ai' : 'user' });
    return toView(meeting);
  },

  async update(id: string, data: unknown): Promise<LegacyMeetingView> {
    const current = await dataEngine.getMeeting(id);
    if (!current) throw new AppError('not_found', 'Meeting not found');
    const patch = fromLegacyMeetingPatch(data, current, { timeZone: getDeviceTimeZone() });
    return toView(await dataEngine.updateMeeting(id, patch));
  },

  async remove(id: string): Promise<{ success: true }> {
    await dataEngine.removeMeeting(id);
    return { success: true };
  },

  /**
   * "Clear all meetings" (TotalMeetings): soft-deletes every MeetingGuard meeting of the account.
   * Meetings imported from Google/device calendars are kept (they belong to those calendars and
   * would be re-imported). Resolves with the number of meetings deleted.
   */
  async clearAll(): Promise<number> {
    const meetings = await dataEngine.listMeetings();
    const own = meetings.filter((meeting) => meeting.source !== 'google' && meeting.source !== 'device');
    for (const meeting of own) await dataEngine.removeMeeting(meeting.id);
    return own.length;
  },

  subscribe(listener: (views: LegacyMeetingView[]) => void): () => void {
    return dataEngine.subscribeMeetings((meetings) => listener(meetings.map(toView)));
  },
};

// ---------------------------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------------------------

export const legacyPreferences = {
  async get(): Promise<LegacyPreferencesView> {
    return toLegacyPreferencesView(await dataEngine.getPreferences());
  },

  /** Always one element: there is exactly one preferences document per user (fixes #19). */
  async filter(): Promise<LegacyPreferencesView[]> {
    return [await legacyPreferences.get()];
  },

  /**
   * Writes the given legacy fields (the document always exists, so "create" is an update).
   * Legacy screens save their whole (possibly stale) preferences view, so the fields owned by
   * dedicated flows are never taken from it: google_calendar_sync_enabled (calendar
   * connect/disconnect, which also manages scopes and imported events) and onboarding_completed
   * (the onboarding flow).
   */
  async update(data: unknown): Promise<LegacyPreferencesView> {
    const {
      googleCalendarSyncEnabled: _calendarFlowOwned,
      onboardingCompleted: _onboardingFlowOwned,
      ...patch
    } = fromLegacyPreferencesPatch(data);
    return toLegacyPreferencesView(await dataEngine.updatePreferences(patch));
  },
};

// ---------------------------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------------------------

export interface LegacyNoteView {
  id: string;
  title: string;
  content: string;
  category: NoteCategory;
  pinned: boolean;
  meetingId: string | null;
  created_date: string;
  updated_date: string;
}

function toNoteView(note: Note): LegacyNoteView {
  return {
    id: note.id,
    title: note.title,
    content: note.content,
    category: note.category,
    pinned: note.pinned,
    meetingId: note.meetingId,
    created_date: note.createdAt,
    updated_date: note.updatedAt,
  };
}

function notePatchFrom(data: unknown): NotePatch {
  const record = asRecord(data);
  const patch: NotePatch = {};
  if (typeof record.title === 'string') patch.title = record.title;
  if (typeof record.content === 'string') patch.content = record.content;
  if (typeof record.category === 'string' && (NOTE_CATEGORIES as readonly string[]).includes(record.category)) {
    patch.category = record.category as NoteCategory;
  }
  if (typeof record.pinned === 'boolean') patch.pinned = record.pinned;
  if (typeof record.meetingId === 'string' || record.meetingId === null) patch.meetingId = record.meetingId as string | null;
  return patch;
}

export const legacyNotes = {
  async list(sortBy?: string): Promise<LegacyNoteView[]> {
    const views = (await dataEngine.listNotes()).map(toNoteView);
    const ascending = sortBy === 'created_date';
    return views.sort((a, b) => (ascending ? compareStrings(a.created_date, b.created_date) : compareStrings(b.created_date, a.created_date)));
  },

  async create(data: unknown): Promise<LegacyNoteView> {
    const patch = notePatchFrom(data);
    if (!patch.title) throw new AppError('invalid_input', 'Note title is required');
    const input: NoteInput = { ...patch, title: patch.title };
    return toNoteView(await dataEngine.createNote(input));
  },

  async update(id: string, data: unknown): Promise<LegacyNoteView> {
    return toNoteView(await dataEngine.updateNote(id, notePatchFrom(data)));
  },

  async remove(id: string): Promise<{ success: true }> {
    await dataEngine.removeNote(id);
    return { success: true };
  },
};

// ---------------------------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------------------------

export interface LegacyUserView {
  id: string;
  uid: string;
  email: string | null;
  name: string | null;
  displayName: string | null;
  picture: string | null;
  photoURL: string | null;
  /** Effective plan from the server-owned entitlement (read-only). */
  plan: Plan;
}

function userView(uid: string, profile: Pick<UserProfile, 'email' | 'displayName' | 'photoURL'>, plan: Plan): LegacyUserView {
  return {
    id: uid,
    uid,
    email: profile.email,
    name: profile.displayName,
    displayName: profile.displayName,
    picture: profile.photoURL,
    photoURL: profile.photoURL,
    plan,
  };
}

export const legacyUser = {
  /** The signed-in user; AppError('unauthenticated') when nobody is signed in. */
  async me(): Promise<LegacyUserView> {
    const uid = dataEngine.getActiveUid();
    if (!uid) throw new AppError('unauthenticated', 'Nobody is signed in');
    // The Firebase user of the session is authoritative for identity; the stored profile is only
    // needed when the session was started without one (headless).
    const sessionUser: AuthUser | null = dataEngine.getSessionUser();
    const identity = sessionUser ?? (await dataEngine.getProfile());
    if (!identity) throw new AppError('not_found', 'Profile not found');
    const entitlement = await dataEngine.getEntitlement();
    return userView(uid, identity, effectivePlan(entitlement));
  },

  /** Synchronous view of the session user (no network); null when signed out. */
  current(): Omit<LegacyUserView, 'plan'> | null {
    const uid = dataEngine.getActiveUid();
    const user = dataEngine.getSessionUser();
    if (!uid || !user) return null;
    const { plan: _plan, ...view } = userView(uid, user, 'free');
    return view;
  },
};

/** Thrown by legacy APIs that no longer exist (sign-in/out, API keys, local user table). */
export function unsupportedLegacyApi(name: string): never {
  throw new AppError('unsupported', `${name} is no longer supported`);
}
