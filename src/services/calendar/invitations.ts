/**
 * The app's invitation router (./invitationRouting.ts explains the rules) and the screens' hook.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

import { USER_STORAGE } from '../../core/identifiers';
import { dataService } from '../data';
import {
  bothCalendarsConnected,
  createInvitationRouter,
  defaultInvitationsState,
  invitationsStateSchema,
  type InvitationCalendar,
  type InvitationRouter,
} from './invitationRouting';
import { createUserStateStore } from './stateStore';
import { calendarStatusStore, type CalendarStatusStore } from './status';

export type { InvitationCalendar, InvitationRouter } from './invitationRouting';

export const invitationRouter: InvitationRouter = createInvitationRouter({
  state: createUserStateStore({
    kv: AsyncStorage,
    name: USER_STORAGE.calendarInvites,
    getUid: () => dataService.getActiveUid(),
    schema: invitationsStateSchema,
    defaults: defaultInvitationsState,
  }),
  status: calendarStatusStore,
});

export interface InvitationsChoice {
  /** Google and Outlook are both connected (the choice matters). */
  both: boolean;
  /** null until the user picks. */
  invitationsFrom: InvitationCalendar | null;
  set(choice: InvitationCalendar): Promise<void>;
}

/** The invitations choice for screens (calendar settings, the meeting form's one-time question). */
export function useInvitationsChoice(router: InvitationRouter = invitationRouter, status: CalendarStatusStore = calendarStatusStore): InvitationsChoice {
  const [both, setBoth] = useState(() => bothCalendarsConnected(status.get()));
  const [choice, setChoice] = useState<InvitationCalendar | null>(null);
  useEffect(() => status.subscribe((next) => setBoth(bothCalendarsConnected(next))), [status]);
  useEffect(() => {
    let active = true;
    const read = (): void => {
      router.load().then(
        (state) => {
          if (active) setChoice(state.invitationsFrom);
        },
        () => undefined,
      );
    };
    read();
    const unsubscribe = router.subscribe(read);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [router]);
  return { both, invitationsFrom: choice, set: (next) => router.setInvitationsFrom(next) };
}
