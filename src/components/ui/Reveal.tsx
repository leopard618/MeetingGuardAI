/**
 * Mount animation (owner: shell / Foundation; docs/v1/DESIGN_SYSTEM.md §8): the child fades in
 * and rises 14dp over motion.reveal ms, optionally after `delay` ms. `index` staggers list rows
 * (motion.staggerMs per row, capped at motion.staggerMaxIndex so a long list never waits).
 * Static under "reduce motion". Runs once per mount; nothing is re-animated on re-render.
 */
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { Animated, Easing, type StyleProp, type ViewStyle } from 'react-native';

import { motion } from '../../theme';
import { useReducedMotion } from './useReducedMotion';

const RISE_DP = 14;

export interface RevealProps {
  children?: ReactNode;
  /** Extra delay in ms before the animation starts. */
  delay?: number;
  /** Row index for a staggered list (adds min(index, staggerMaxIndex) * staggerMs). */
  index?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function revealDelay(delay: number, index: number): number {
  return delay + Math.min(Math.max(index, 0), motion.staggerMaxIndex) * motion.staggerMs;
}

export function Reveal({ children, delay = 0, index = 0, style, testID }: RevealProps): ReactElement {
  const reduceMotion = useReducedMotion();
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return undefined;
    }
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: motion.reveal,
      delay: revealDelay(delay, index),
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
    // Mount-only: the row keeps its final state on later renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [RISE_DP, 0] }) }],
        },
      ]}
      testID={testID}
    >
      {children}
    </Animated.View>
  );
}
