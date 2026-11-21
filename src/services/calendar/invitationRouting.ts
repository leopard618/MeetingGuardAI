/**
 * Invitations with Google Calendar AND Outlook connected (owner: calendar). Both calendars get every
 * Meeting Guard meeting, and each would email its own invitation to the participants. Only one of
 * them carries the guests; the other gets the meeting as a plain time block (no attendees, so no
 * email).
 *
 * - The user picks the calendar that sends invitations (`invitationsFrom`). The app asks once, the
 *   first time a meeting with participants is saved while both are connected, and the choice can
 *   be changed in the calendar settings. Until it is picked, Google sends them.
 * - Each meeting keeps ONE calendar for its guests (`home`), fixed the first time one of its events
 *   is created while both calendars are connected: the calendar that already holds an event of
 *   it (made while it was the only one connected, so with guests), else the chosen one. Changing
 *   the choice later never moves the guests of an existing meeting (that would cancel and re-send
 *   invitations).
 * - Meetings without a home (both events made before this rule, or only one calendar connected)
 *   keep their guests in every calendar, as before.
 *
 * Stored per user on this device (calendar.invites, ./invitations.ts); nothing is synced to the
 * server. This file is pure (no storage or React), so the syncs and tests import it directly.
 */
import { z } from 'zod';

import type { Unsubscribe } from '../../core/contracts';
import type { ExternalRefs } from '../../core/types';
import type { StateStore } from './stateStore';
import type { CalendarStatusStore } from './status';

export type InvitationCalendar = 'google' | 'outlook';

/** What routing needs of a meeting: its id and which calendars already hold an event of it. */
export interface RoutedMeeting {
  id: string;
  external: Pick<ExternalRefs, 'googleEventId' | 'outlookEventId'>;
}

const invitationCalendarSchema = z.enum(['google', 'outlook']);

export const invitationsStateSchema = z.object({
  v: z.literal(1),
  invitationsFrom: invitationCalendarSchema.nullable(),
  /** Meeting id -> the calendar that carries its guests. */
  home: z.record(z.string(), invitationCalendarSchema),
});
export type InvitationsState = z.infer<typeof invitationsStateSchema>;

export function defaultInvitationsState(): InvitationsState {
  return { v: 1, invitationsFrom: null, home: {} };
}

/** Google pushes events (sync on and the account connected) and Outlook is connected. */
export function bothCalendarsConnected(status: ReturnType<CalendarStatusStore['get']>): boolean {
  return status.google.enabled && status.google.connected && status.outlook?.connected === true;
}

/** Whether `provider` carries a meeting's guests when it creates an event for it (pure). */
export function homeForNewEvent(
  state: InvitationsState,
  provider: InvitationCalendar,
  meeting: RoutedMeeting,
): InvitationCalendar {
  const known = state.home[meeting.id];
  if (known !== undefined) return known;
  const other: InvitationCalendar = provider === 'google' ? 'outlook' : 'google';
  const otherHasEvent = other === 'google' ? meeting.external.googleEventId !== null : meeting.external.outlookEventId !== null;
  if (otherHasEvent) return other;
  return state.invitationsFrom ?? 'google';
}

export interface InvitationRouter {
  /**
   * For a push of an own meeting to `provider`: true when that calendar's event must not carry the
   * guests. `creating`: the event does not exist yet (the meeting's home may be fixed now).
   */
  withoutGuests(provider: InvitationCalendar, meeting: RoutedMeeting, creating: boolean): Promise<boolean>;
  /** Same answer for an existing event, read from a loaded state (no write; pull hash seeding). */
  withoutGuestsSync(state: InvitationsState, provider: InvitationCalendar, meetingId: string): boolean;
  load(): Promise<InvitationsState>;
  setInvitationsFrom(choice: InvitationCalendar): Promise<void>;
  subscribe(listener: () => void): Unsubscribe;
}

export interface InvitationRouterDeps {
  state: StateStore<InvitationsState>;
  status: Pick<CalendarStatusStore, 'get'>;
}

export function createInvitationRouter(deps: InvitationRouterDeps): InvitationRouter {
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };

  return {
    async withoutGuests(provider, meeting, creating) {
      if (!creating) {
        const state = await deps.state.load();
        const home = state.home[meeting.id];
        return home !== undefined && home !== provider;
      }
      if (!bothCalendarsConnected(deps.status.get())) return false;
      let home: InvitationCalendar = provider;
      await deps.state.update((current) => {
        home = homeForNewEvent(current, provider, meeting);
        return current.home[meeting.id] === home ? current : { ...current, home: { ...current.home, [meeting.id]: home } };
      });
      return home !== provider;
    },
    withoutGuestsSync(state, provider, meetingId) {
      const home = state.home[meetingId];
      return home !== undefined && home !== provider;
    },
    load: () => deps.state.load(),
    async setInvitationsFrom(choice) {
      await deps.state.update((current) => ({ ...current, invitationsFrom: choice }));
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
