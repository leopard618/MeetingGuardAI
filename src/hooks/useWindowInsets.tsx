/**
 * Window safe-area insets for surfaces that cover the whole window (RN Modal sheets and editors).
 *
 * The Main group hands its screens a bottom inset of 0 because the bottom navigation bar owns
 * that edge (src/navigation/RootNavigator.tsx). A Modal opened from such a screen still covers the
 * system navigation area, so it must pad with the WINDOW insets, which the Main group publishes
 * here. Outside the Main group (alerts host, auth, onboarding) there is no override and the hook
 * simply returns the safe-area insets.
 */
import { createContext, useContext, type ReactElement, type ReactNode } from 'react';
import { useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context';

const WindowInsetsContext = createContext<EdgeInsets | null>(null);

export function WindowInsetsProvider({ value, children }: { value: EdgeInsets; children?: ReactNode }): ReactElement {
  return <WindowInsetsContext.Provider value={value}>{children}</WindowInsetsContext.Provider>;
}

/** Insets of the window (not of the screen area above the bottom bar). Use inside RN Modals. */
export function useWindowInsets(): EdgeInsets {
  const windowInsets = useContext(WindowInsetsContext);
  const safeAreaInsets = useSafeAreaInsets();
  return windowInsets ?? safeAreaInsets;
}
