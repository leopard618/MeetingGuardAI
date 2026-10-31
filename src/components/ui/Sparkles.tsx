/**
 * Twinkling sparks around a point (owner: shell / Foundation; docs/v1/DESIGN_SYSTEM.md §2.1
 * "spark"): a few tiny four-point stars that fade and scale in and out on their own rhythms.
 * Used around the assistant orb. Decorative, static under "reduce motion" (then only the two
 * brightest show at rest).
 */
import { useEffect, useState, type ReactElement } from 'react';
import { Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon } from './Icon';
import { useReducedMotion } from './useReducedMotion';

interface Spark {
  x: number;
  y: number;
  size: number;
  delay: number;
  period: number;
}

/** Positions as fractions of the host box (0..1), tuned for a 56dp orb inside a 96dp box. */
const SPARKS: readonly Spark[] = [
  { x: 0.12, y: 0.2, size: 10, delay: 0, period: 1900 },
  { x: 0.86, y: 0.16, size: 8, delay: 500, period: 2300 },
  { x: 0.9, y: 0.7, size: 7, delay: 1100, period: 2100 },
  { x: 0.08, y: 0.74, size: 6, delay: 1500, period: 2600 },
];

export interface SparklesProps {
  color: string;
  /** Host box size in dp (square). */
  size: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

function SparkDot({ spark, color, hostSize, reduceMotion }: { spark: Spark; color: string; hostSize: number; reduceMotion: boolean }): ReactElement {
  const [life] = useState(() => new Animated.Value(reduceMotion ? 0.8 : 0));

  useEffect(() => {
    if (reduceMotion) {
      life.setValue(spark.size >= 8 ? 0.8 : 0);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(spark.delay),
        Animated.timing(life, { toValue: 1, duration: spark.period / 2, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(life, { toValue: 0, duration: spark.period / 2, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        Animated.delay(spark.period / 3),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [life, reduceMotion, spark]);

  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: spark.x * hostSize - spark.size / 2,
        top: spark.y * hostSize - spark.size / 2,
        opacity: life,
        transform: [{ scale: life.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }, { rotate: '12deg' }],
      }}
    >
      <Icon name="ai" size={spark.size} color={color} />
    </Animated.View>
  );
}

export function Sparkles({ color, size, style, testID }: SparklesProps): ReactElement {
  const reduceMotion = useReducedMotion();
  return (
    <View
      style={[styles.host, { width: size, height: size }, style]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
    >
      {SPARKS.map((spark) => (
        <SparkDot key={`${spark.x}-${spark.y}`} spark={spark} color={color} hostSize={size} reduceMotion={reduceMotion} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
  },
});
