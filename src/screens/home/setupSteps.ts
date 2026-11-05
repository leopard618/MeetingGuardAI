/**
 * Dashboard setup recommendation (ARCHITECTURE section 34): ONE step at a time, ranked by value,
 * skipped when it does not apply, snoozed per account on this phone.
 *
 * Ranking: verify the email (email/password accounts only; the trusted providers are verified
 * already), connect a calendar (Google Calendar or Outlook), sync the tasks (Microsoft To Do when
 * Outlook is connected, Google Tasks on builds that register it). A step is "done" from the live
 * calendar status, never from a stored flag, so it comes back if the user disconnects.
 *
 * "Not now" hides the step for SNOOZE_DAYS; the second "Not now" hides it for good (Settings >
 * Calendar sync stays the place to do it later). The snooze is kept under the user's storage
 * prefix (`mg:{uid}:setup.snooze`), so signing out wipes it with the rest of the local data.
 */
import type { CalendarStatus } from '../../core/contracts';

export type SetupStepId = 'verify_email' | 'connect_calendar' | 'sync_tasks';

export type TaskSyncProvider = 'todo' | 'gtasks';

export interface SetupStep {
  id: SetupStepId;
  /** For 'sync_tasks': the provider the step recommends. */
  provider?: TaskSyncProvider;
}

export interface SetupSnooze {
  count: number;
  /** ISO instant the step hides until (the far future after the second "Not now"). */
  until: string;
}

export type SetupSnoozes = Partial<Record<SetupStepId, SetupSnooze>>;

export const SNOOZE_DAYS = 7;
/** After this many "Not now" the step never comes back on this phone. */
export const SNOOZE_FOREVER_AFTER = 2;
const FOREVER = '9999-12-31T00:00:00.000Z';
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SetupInput {
  /** needsEmailVerification(authUser): email/password account whose address is not verified. */
  emailVerificationNeeded: boolean;
  status: CalendarStatus;
  snoozes: SetupSnoozes;
  now: Date;
}

/** A calendar provider the user turned on (Google sync on, or the Outlook account connected). */
export function calendarConnected(status: CalendarStatus): boolean {
  return status.google.enabled || status.outlook?.connected === true;
}

/** The task providers this build and this account could sync with, in recommendation order. */
export function availableTaskProviders(status: CalendarStatus): TaskSyncProvider[] {
  const providers: TaskSyncProvider[] = [];
  if (status.todo?.configured === true && status.outlook?.connected === true) providers.push('todo');
  if (status.gtasks?.configured === true && status.gtasks.connected) providers.push('gtasks');
  return providers;
}

export function taskSyncEnabled(status: CalendarStatus): boolean {
  return status.todo?.enabled === true || status.gtasks?.enabled === true;
}

export function isSnoozed(snoozes: SetupSnoozes, id: SetupStepId, now: Date): boolean {
  const entry = snoozes[id];
  if (!entry) return false;
  const until = Date.parse(entry.until);
  return Number.isFinite(until) && until > now.getTime();
}

/** The snoozes after a "Not now" on `id`. */
export function snoozeStep(snoozes: SetupSnoozes, id: SetupStepId, now: Date): SetupSnoozes {
  const count = (snoozes[id]?.count ?? 0) + 1;
  const until = count >= SNOOZE_FOREVER_AFTER ? FOREVER : new Date(now.getTime() + SNOOZE_DAYS * DAY_MS).toISOString();
  return { ...snoozes, [id]: { count, until } };
}

/** The steps that still apply, in order (none snoozed out). */
export function pendingSetupSteps(input: Pick<SetupInput, 'emailVerificationNeeded' | 'status'>): SetupStep[] {
  const steps: SetupStep[] = [];
  if (input.emailVerificationNeeded) steps.push({ id: 'verify_email' });
  const calendar = calendarConnected(input.status);
  if (!calendar) steps.push({ id: 'connect_calendar' });
  if (calendar && !taskSyncEnabled(input.status)) {
    const provider = availableTaskProviders(input.status)[0];
    if (provider !== undefined) steps.push({ id: 'sync_tasks', provider });
  }
  return steps;
}

/** The one step the dashboard shows, or null. */
export function nextSetupStep(input: SetupInput): SetupStep | null {
  return pendingSetupSteps(input).find((step) => !isSnoozed(input.snoozes, step.id, input.now)) ?? null;
}

/** Stored JSON -> snoozes; anything unreadable is an empty record. */
export function parseSnoozes(raw: string | null): SetupSnoozes {
  if (raw === null) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return {};
    const result: SetupSnoozes = {};
    for (const id of ['verify_email', 'connect_calendar', 'sync_tasks'] as const) {
      const entry = (value as Record<string, unknown>)[id];
      if (typeof entry !== 'object' || entry === null) continue;
      const { count, until } = entry as Record<string, unknown>;
      if (typeof count === 'number' && Number.isInteger(count) && count > 0 && typeof until === 'string' && Number.isFinite(Date.parse(until))) {
        result[id] = { count, until };
      }
    }
    return result;
  } catch {
    return {};
  }
}
