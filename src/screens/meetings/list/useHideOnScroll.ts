/**
 * FAB hide-on-scroll (docs/DESIGN_SYSTEM.md §5): the FAB slides away while the list scrolls down
 * and returns on the first scroll up (or near the top). Purely visual - Animated only, native
 * driver, and a no-op animation under "reduce motion".
 */
import { useCallback, useRef, useState } from 'react';
import { Animated, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import { useReducedMotion } from '../../../components/ui';

/** Scroll deltas smaller than this are ignored (finger jitter, bounce). */
const DELTA_DP = 6;
/** Below this offset the FAB is always shown. */
const TOP_DP = 24;
const SLIDE_MS = 160;
/** How far the FAB slides down while hidden (56 FAB + 16 margin + shadow head-room). */
export const FAB_SLIDE_DP = 96;

export interface HideOnScroll {
  /** 1 = shown, 0 = hidden; drive opacity / translateY from it. */
  visible: Animated.Value;
  /**
   * Whether the FAB is currently shown, as React state: gate `pointerEvents` and
   * `importantForAccessibility` on it so a hidden (transparent) FAB is neither tappable nor
   * focusable by TalkBack.
   */
  shown: boolean;
  /** Attach to the list's onScroll (with scrollEventThrottle 16). */
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
}

export function useHideOnScroll(): HideOnScroll {
  const reduceMotion = useReducedMotion();
  const [visible] = useState(() => new Animated.Value(1));
  const [shownState, setShownState] = useState(true);
  const shown = useRef(true);
  const lastY = useRef(0);

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = event.nativeEvent.contentOffset.y;
      const delta = y - lastY.current;
      lastY.current = y;
      const next = y <= TOP_DP ? true : delta > DELTA_DP ? false : delta < -DELTA_DP ? true : shown.current;
      if (next === shown.current) return;
      shown.current = next;
      setShownState(next);
      Animated.timing(visible, {
        toValue: next ? 1 : 0,
        duration: reduceMotion ? 0 : SLIDE_MS,
        useNativeDriver: true,
      }).start();
    },
    [visible, reduceMotion],
  );

  return { visible, shown: shownState, onScroll };
}
