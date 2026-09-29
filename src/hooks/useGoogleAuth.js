/**
 * Compat shim (owner: auth) for the pre-rebuild Google auth hook. Stage 3 removes it.
 *
 * `useGoogleAuth()` returns `{ user, isSignedIn, isLoading, signIn, signOut }` where "signed in"
 * means Google Calendar is connected (the only thing legacy screens used it for):
 * - signIn()  -> googleCalendarService.connect() (Calendar consent + sync); resolves true when connected
 * - signOut() -> googleCalendarService.disconnect() (stops Calendar sync; the app session stays)
 * Must be used inside AuthProvider.
 */
import { useCallback } from 'react';

import { useAuth } from '../services/auth';
import { googleCalendarService, useCalendarStatus } from '../services/calendar';

export const useGoogleAuth = () => {
  const { user, isAuthenticated, isLoading } = useAuth();
  const calendarStatus = useCalendarStatus();
  const isSignedIn = isAuthenticated && calendarStatus.google.connected;

  const signIn = useCallback(async () => {
    const result = await googleCalendarService.connect();
    return result.status === 'connected';
  }, []);

  const signOut = useCallback(() => googleCalendarService.disconnect(), []);

  return {
    user: isSignedIn ? user : null,
    isSignedIn,
    isLoading,
    signIn,
    signOut,
  };
};

export default useGoogleAuth;
