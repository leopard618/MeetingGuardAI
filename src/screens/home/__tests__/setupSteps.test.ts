/** Dashboard setup recommendation model (ARCHITECTURE section 34): ranking, skipping, snoozes. */
import type { CalendarStatus } from '../../../core/contracts';
import { initialCalendarStatus } from '../../../services/calendar/status';
import { isSnoozed, nextSetupStep, parseSnoozes, pendingSetupSteps, snoozeStep, type SetupSnoozes } from '../setupSteps';

const NOW = new Date('2026-11-05T09:00:00.000Z');
const idle = { enabled: false, syncing: false, lastSyncAt: null, lastError: null };

function status(overrides: Partial<CalendarStatus> = {}): CalendarStatus {
  return { ...initialCalendarStatus(), ...overrides };
}

function next(input: { emailVerificationNeeded?: boolean; status?: CalendarStatus; snoozes?: SetupSnoozes }) {
  return nextSetupStep({
    emailVerificationNeeded: input.emailVerificationNeeded ?? false,
    status: input.status ?? status(),
    snoozes: input.snoozes ?? {},
    now: NOW,
  });
}

describe('nextSetupStep', () => {
  it('ranks the email verification first, then the calendar', () => {
    expect(pendingSetupSteps({ emailVerificationNeeded: true, status: status() }).map((s) => s.id)).toEqual(['verify_email', 'connect_calendar']);
    expect(next({ emailVerificationNeeded: true })).toEqual({ id: 'verify_email' });
    expect(next({})).toEqual({ id: 'connect_calendar' });
  });

  it('treats Google sync on or an Outlook connection as a connected calendar', () => {
    expect(next({ status: status({ google: { ...idle, enabled: true, connected: true, hasScope: true } }) })).toBeNull();
    expect(next({ status: status({ outlook: { ...idle, configured: true, connected: true, accountEmail: 'a@b.c', teamsLinks: null } }) })).toBeNull();
  });

  it('recommends the tasks only after a calendar, To Do with Outlook, Google Tasks when the build registers it', () => {
    const google = { ...idle, enabled: true, connected: true, hasScope: true };
    // Google connected, store build (no gtasks entry), no Outlook: nothing to recommend.
    expect(next({ status: status({ google }) })).toBeNull();
    // Google connected on a build with Google Tasks.
    expect(next({ status: status({ google, gtasks: { ...idle, configured: true, connected: true, hasScope: false, listId: null, listName: null } }) })).toEqual({
      id: 'sync_tasks',
      provider: 'gtasks',
    });
    // Outlook connected: To Do comes first.
    const outlook = { ...idle, configured: true, connected: true, accountEmail: 'a@b.c', teamsLinks: null };
    const todo = { ...idle, configured: true, connected: true, listId: null, listName: null };
    expect(next({ status: status({ outlook, todo }) })).toEqual({ id: 'sync_tasks', provider: 'todo' });
    // To Do configured but Outlook not connected: the step does not apply (the card says connect Outlook first).
    expect(next({ status: status({ google, todo: { ...todo, connected: false } }) })).toBeNull();
    // Either provider syncing: done.
    expect(next({ status: status({ outlook, todo: { ...todo, enabled: true } }) })).toBeNull();
  });

  it('skips a snoozed step and shows the next one', () => {
    const snoozes = snoozeStep({}, 'verify_email', NOW);
    expect(next({ emailVerificationNeeded: true, snoozes })).toEqual({ id: 'connect_calendar' });
  });
});

describe('snoozes', () => {
  it('hides for seven days, then for good on the second "Not now"', () => {
    const once = snoozeStep({}, 'connect_calendar', NOW);
    expect(once.connect_calendar).toEqual({ count: 1, until: '2026-11-12T09:00:00.000Z' });
    expect(isSnoozed(once, 'connect_calendar', NOW)).toBe(true);
    expect(isSnoozed(once, 'connect_calendar', new Date('2026-11-12T09:00:01.000Z'))).toBe(false);

    const twice = snoozeStep(once, 'connect_calendar', new Date('2026-11-13T09:00:00.000Z'));
    expect(twice.connect_calendar?.count).toBe(2);
    expect(isSnoozed(twice, 'connect_calendar', new Date('2099-01-01T00:00:00.000Z'))).toBe(true);
    expect(isSnoozed(twice, 'sync_tasks', NOW)).toBe(false);
  });

  it('reads stored JSON leniently', () => {
    expect(parseSnoozes(null)).toEqual({});
    expect(parseSnoozes('nonsense')).toEqual({});
    expect(parseSnoozes('[1]')).toEqual({});
    const stored = JSON.stringify({
      connect_calendar: { count: 1, until: '2026-11-12T09:00:00.000Z' },
      bogus: { count: 1, until: 'x' },
      sync_tasks: { count: 'two', until: 'x' },
    });
    expect(parseSnoozes(stored)).toEqual({ connect_calendar: { count: 1, until: '2026-11-12T09:00:00.000Z' } });
  });
});
