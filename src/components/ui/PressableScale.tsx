/**
 * Pressable that springs to 97 percent while pressed (owner: shell / Foundation;
 * docs/v1/DESIGN_SYSTEM.md §8). The one press feedback for cards, tiles, FABs, tabs and the
 * filled button; `android_ripple` can still be passed for an in-surface ripple. Static under
 * "reduce motion". `style` is a plain style (no pressed-function): the scale IS the feedback.
 */
import { useCallback, useState, type ReactElement } from 'react';
import { Animated, Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

import { motion } from '../../theme';
import { useReducedMotion } from './useReducedMotion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface PressableScaleProps extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  /** Scale while pressed (default motion.pressScale). */
  scaleTo?: number;
}

export function PressableScale({ style, scaleTo = motion.pressScale, onPressIn, onPressOut, children, ...rest }: PressableScaleProps): ReactElement {
  const reduceMotion = useReducedMotion();
  const [scale] = useState(() => new Animated.Value(1));

  const animateTo = useCallback(
    (value: number) => {
      if (reduceMotion) return;
      Animated.spring(scale, { toValue: value, useNativeDriver: true, ...motion.spring }).start();
    },
    [reduceMotion, scale],
  );

  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(event) => {
        animateTo(scaleTo);
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        animateTo(1);
        onPressOut?.(event);
      }}
      style={[style, { transform: [{ scale }] }]}
    >
      {children}
    </AnimatedPressable>
  );
}
