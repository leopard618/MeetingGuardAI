/**
 * Whether the enclosing screen is focused AND the app is in the foreground (the summary hooks
 * poll only then). Same rule as src/screens/shared/useLiveNow.ts: outside a navigator (a hook or
 * component rendered on its own, e.g. in tests) it counts as focused.
 */
import { NavigationContext } from '@react-navigation/native';
import { useCallback, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

function isActive(state: AppStateStatus | null | undefined): boolean {
  // Early start-up can report no state, and the Jest mock is not a string: treat both as active.
  return typeof state !== 'string' || state === 'active';
}

export function useScreenActive(): boolean {
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
  const focused = useSyncExternalStore(subscribe, read, read);
  const [appActive, setAppActive] = useState(() => isActive(AppState.currentState));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setAppActive(isActive(state)));
    return () => subscription.remove();
  }, []);

  return focused && appActive;
}
