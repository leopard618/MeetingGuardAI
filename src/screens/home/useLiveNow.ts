/**
 * The current time, refreshed every `intervalMs` while the screen is focused and the app is in
 * the foreground (no ticking behind other screens or in the background; the value catches up as
 * soon as the screen or the app becomes active again).
 */
import { useIsFocused } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

function isActive(state: AppStateStatus | null | undefined): boolean {
  // Jest / early start-up can report no state: treat it as active.
  return state === 'active' || state === null || state === undefined;
}

export function useLiveNow(intervalMs: number): Date {
  const focused = useIsFocused();
  const [now, setNow] = useState(() => new Date());
  const [appActive, setAppActive] = useState(() => isActive(AppState.currentState));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setAppActive(isActive(state)));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!focused || !appActive) return undefined;
    const tick = (): void => setNow(new Date());
    // Catch up right away after a pause, then keep ticking.
    const immediate = setTimeout(tick, 0);
    const timer = setInterval(tick, intervalMs);
    return () => {
      clearTimeout(immediate);
      clearInterval(timer);
    };
  }, [appActive, focused, intervalMs]);

  return now;
}
