/**
 * Light sweep (owner: shell / Foundation; docs/v1/DESIGN_SYSTEM.md §2.1 "spark"): a soft white
 * band crosses the parent from left to right every few seconds. Fill the parent absolutely; the
 * parent clips with its own radius (overflow hidden). Decorative, static under "reduce motion".
 */
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState, type ReactElement } from 'react';
import { Animated, Easing, StyleSheet, type LayoutChangeEvent } from 'react-native';

import { useReducedMotion } from './useReducedMotion';

const SWEEP_MS = 1400;
const PAUSE_MS = 3200;
const BAND_FRACTION = 0.55;

export interface ShimmerProps {
  /** Peak alpha of the band (default 0.22). */
  intensity?: number;
  testID?: string;
}

export function Shimmer({ intensity = 0.22, testID }: ShimmerProps): ReactElement {
  const reduceMotion = useReducedMotion();
  const [width, setWidth] = useState(0);
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reduceMotion || width === 0) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, { toValue: 1, duration: SWEEP_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.delay(PAUSE_MS),
        Animated.timing(progress, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [progress, reduceMotion, width]);

  const bandWidth = Math.max(1, width * BAND_FRACTION);
  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [-bandWidth, width + bandWidth] });
  const onLayout = (event: LayoutChangeEvent) => setWidth(Math.round(event.nativeEvent.layout.width));

  return (
    <Animated.View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={onLayout}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
    >
      {reduceMotion || width === 0 ? null : (
        <Animated.View style={[styles.band, { width: bandWidth, transform: [{ translateX }, { skewX: '-18deg' }] }]}>
          <LinearGradient
            colors={['rgba(255,255,255,0)', `rgba(255,255,255,${intensity})`, 'rgba(255,255,255,0)']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  band: {
    position: 'absolute',
    top: -20,
    bottom: -20,
    left: 0,
  },
});
