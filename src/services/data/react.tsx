/**
 * React bindings of the data layer. Every hook reads the engine's immutable snapshot through
 * useSyncExternalStore, so components re-render on local writes, Firestore snapshots, session
 * start/end and connectivity changes without any polling.
 */
import { createContext, useCallback, useMemo, useSyncExternalStore, type ReactNode } from 'react';

import type {
  DataProviderProps,
  MeetingRange,
  SyncState,
  UseEntitlementResult,
  UseMeetingResult,
  UseMeetingsResult,
  UseNotesResult,
  UsePreferencesResult,
  UseTasksResult,
} from '../../core/contracts';
import { toAppError, type AppError } from '../../core/errors';
import {
  effectivePlan,
  type Meeting,
  type NoteInput,
  type NotePatch,
  type PreferencesPatch,
  type TaskInput,
  type TaskPatch,
} from '../../core/types';
import { filterMeetings, type DataSnapshot } from './engine';
import { dataEngine } from './instance';

const DataContext = createContext(false);

/** Must be rendered inside AuthProvider (the session manager starts/ends the data session). */
export function DataProvider({ children }: DataProviderProps): ReactNode {
  return <DataContext.Provider value>{children}</DataContext.Provider>;
}

function useDataSnapshot(): DataSnapshot {
  return useSyncExternalStore(dataEngine.subscribeSnapshot, dataEngine.getSnapshot, dataEngine.getSnapshot);
}

/** Active meetings (sorted by start) matching `range`; re-renders on every change. */
export function useMeetings(range?: MeetingRange): UseMeetingsResult {
  const snapshot = useDataSnapshot();
  const from = range?.from;
  const to = range?.to;
  const includeCancelled = range?.includeCancelled;
  const includeDeleted = range?.includeDeleted;
  const filtered = useMemo((): { meetings: Meeting[]; error: AppError | null } => {
    try {
      return { meetings: filterMeetings(snapshot.allMeetings, { from, to, includeCancelled, includeDeleted }), error: null };
    } catch (error) {
      return { meetings: [], error: toAppError(error) };
    }
  }, [snapshot.allMeetings, from, to, includeCancelled, includeDeleted]);
  const refresh = useCallback(() => dataEngine.refreshMeetings(), []);
  return {
    meetings: filtered.meetings,
    isLoading: snapshot.status === 'loading',
    error: filtered.error ?? snapshot.errors.meetings,
    refresh,
  };
}

export function useMeeting(id: string | null | undefined): UseMeetingResult {
  const snapshot = useDataSnapshot();
  const meeting = id ? snapshot.meetingsById.get(id) : undefined;
  return {
    meeting: meeting && meeting.deletedAt === null ? meeting : null,
    isLoading: snapshot.status === 'loading',
    error: snapshot.errors.meetings,
  };
}

export function usePreferences(): UsePreferencesResult {
  const snapshot = useDataSnapshot();
  const update = useCallback((patch: PreferencesPatch) => dataEngine.updatePreferences(patch), []);
  return {
    preferences: snapshot.preferences,
    // Server or cached preferences only: the timeout fallback (defaults) must not drive the
    // onboarding gate (contract: "false until the session's preferences are known (cache or server)").
    isLoaded: snapshot.status === 'ready' && snapshot.preferencesSettled,
    error: snapshot.errors.preferences,
    update,
  };
}

export function useNotes(): UseNotesResult {
  const snapshot = useDataSnapshot();
  const create = useCallback((input: NoteInput) => dataEngine.createNote(input), []);
  const update = useCallback((id: string, patch: NotePatch) => dataEngine.updateNote(id, patch), []);
  const remove = useCallback((id: string) => dataEngine.removeNote(id), []);
  return {
    notes: snapshot.notes as UseNotesResult['notes'],
    isLoading: snapshot.status === 'loading',
    error: snapshot.errors.notes,
    create,
    update,
    remove,
  };
}

export function useTasks(): UseTasksResult {
  const snapshot = useDataSnapshot();
  const create = useCallback((input: TaskInput) => dataEngine.createTask(input), []);
  const update = useCallback((id: string, patch: TaskPatch) => dataEngine.updateTask(id, patch), []);
  const remove = useCallback((id: string) => dataEngine.removeTask(id), []);
  return {
    tasks: snapshot.tasks as UseTasksResult['tasks'],
    isLoading: snapshot.status === 'loading',
    error: snapshot.errors.tasks,
    create,
    update,
    remove,
  };
}

export function useEntitlement(): UseEntitlementResult {
  const snapshot = useDataSnapshot();
  return {
    entitlement: snapshot.entitlement,
    plan: effectivePlan(snapshot.entitlement),
    isLoaded: snapshot.status === 'ready' && snapshot.entitlementLoaded,
  };
}

export function useSyncState(): SyncState {
  return useDataSnapshot().sync;
}
