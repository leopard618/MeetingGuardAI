/**
 * The current time for time-dependent screens (countdowns, "Today", upcoming vs. past, "3 min
 * ago", the daily-limit reset), refreshed every `intervalMs` only while the screen is focused and
 * the app is in the foreground. The stack keeps screens mounted, so a plain interval would re-render
 * whole lists every minute behind other screens and in the background; this one pauses instead and
 * catches up at once when the screen or the app becomes active again.
 *
 * Outside a navigator (a component rendered on its own, e.g. in tests) it counts as focused.
 */
import { NavigationContext } from '@react-navigation/native';
import { useCallback, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

function isActive(state: AppStateStatus | null | undefined): boolean {
  // Jest / early start-up can report no state: treat it as active.
  return state === 'active' || state === null || state === undefined;
}

/** Focus of the enclosing screen; true when there is no navigator around. */
function useScreenFocused(): boolean {
  const navigation = useContext(NavigationContext);
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!navigation) return () => undefined;
      const offFocus = navigation.addListener('focus', onChange);
      const offBlur = navigation.addListener('blur', onChange);
      return () => {
        offFocus();
        offBlur();
      };
    },
    [navigation],
  );
  const read = (): boolean => navigation?.isFocused() ?? true;
  return useSyncExternalStore(subscribe, read, read);
}

export function useLiveNow(intervalMs: number): Date {
  const focused = useScreenFocused();
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
