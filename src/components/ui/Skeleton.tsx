/**
 * Loading placeholder block (owner: shell / Foundation; docs/DESIGN_SYSTEM.md §5/§8):
 * surfaceVariant, r-sm, 700ms Animated opacity pulse 0.5 -> 1 (static at 0.7 under "reduce
 * motion"). Only for layouts that are known in advance; hidden from screen readers.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { Animated, StyleSheet, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';

import { radii, useAppTheme } from '../../theme';
import { useReducedMotion } from './useReducedMotion';

const PULSE_MS = 700;
const MIN_OPACITY = 0.5;
const STATIC_OPACITY = 0.7;

export interface SkeletonProps {
  width: DimensionValue;
  height: number;
  /** Default r-sm (8). */
  radius?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Skeleton({ width, height, radius = radii.sm, style, testID }: SkeletonProps): ReactElement {
  const { colors } = useAppTheme();
  const reduceMotion = useReducedMotion();
  const [opacity] = useState(() => new Animated.Value(MIN_OPACITY));

  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(STATIC_OPACITY);
      return undefined;
    }
    opacity.setValue(MIN_OPACITY);
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: PULSE_MS, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: MIN_OPACITY, duration: PULSE_MS, useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [opacity, reduceMotion]);

  return (
    <Animated.View
      style={[
        styles.block,
        { width, height, borderRadius: radius, backgroundColor: colors.surfaceVariant, opacity },
        style,
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no"
      testID={testID}
    />
  );
}

const styles = StyleSheet.create({
  block: {
    overflow: 'hidden',
  },
});
