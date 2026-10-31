/**
 * Ambient aurora (owner: shell / Foundation; docs/v1/DESIGN_SYSTEM.md §2.1 "light"): three soft
 * color blooms (indigo, violet, teal) that drift slowly behind the top of a screen and fade into
 * the background. Gives the header area depth and color without touching the content. Pure
 * views plus one gradient fade, no blur module; static under "reduce motion". Position it
 * absolutely behind the content it should light (the dashboard greeting and stats).
 */
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState, type ReactElement } from 'react';
import { Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '../../theme';
import { Glow } from './Glow';
import { useReducedMotion } from './useReducedMotion';

interface Bloom {
  /** Center as fractions of the host box. */
  x: number;
  y: number;
  size: number;
  /** Drift amplitude in dp and period in ms. */
  drift: number;
  period: number;
  colorKey: 'primary' | 'violet' | 'teal';
}

const BLOOMS: readonly Bloom[] = [
  { x: 0.1, y: 0.02, size: 460, drift: 26, period: 16_000, colorKey: 'primary' },
  { x: 0.92, y: 0.3, size: 400, drift: 22, period: 19_000, colorKey: 'violet' },
  { x: 0.5, y: 0.78, size: 340, drift: 18, period: 23_000, colorKey: 'teal' },
];

const VIOLET = { light: '#7C5CE6', dark: '#7C5CE6' } as const;

export interface AuroraBackdropProps {
  /** Height of the lit area in dp (default 360). */
  height?: number;
  /** Alpha at the center of each bloom (default 0.34 dark, 0.22 light). */
  intensity?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

function DriftingBloom({ bloom, color, intensity, hostHeight, reduceMotion }: { bloom: Bloom; color: string; intensity: number; hostHeight: number; reduceMotion: boolean }): ReactElement {
  const [phase] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reduceMotion) {
      phase.setValue(0.5);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(phase, { toValue: 1, duration: bloom.period, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(phase, { toValue: 0, duration: bloom.period, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [bloom.period, phase, reduceMotion]);

  const translateX = phase.interpolate({ inputRange: [0, 1], outputRange: [-bloom.drift, bloom.drift] });
  const translateY = phase.interpolate({ inputRange: [0, 1], outputRange: [bloom.drift * 0.6, -bloom.drift * 0.6] });
  const scale = phase.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.06] });

  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: `${bloom.x * 100}%`,
        top: bloom.y * hostHeight,
        marginLeft: -bloom.size / 2,
        marginTop: -bloom.size / 2,
        transform: [{ translateX }, { translateY }, { scale }],
      }}
    >
      <Glow color={color} size={bloom.size} intensity={intensity} style={styles.bloom} />
    </Animated.View>
  );
}

export function AuroraBackdrop({ height = 360, intensity, style, testID }: AuroraBackdropProps): ReactElement {
  const { colors, isDark } = useAppTheme();
  const reduceMotion = useReducedMotion();
  // Soft: the text above the blooms must stay legible (greeting date in onSurfaceVariant).
  const peak = intensity ?? (isDark ? 0.34 : 0.22);
  const palette = {
    primary: colors.primary,
    violet: isDark ? VIOLET.dark : VIOLET.light,
    teal: colors.tertiary,
  };

  return (
    <View
      style={[styles.host, { height }, style]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
    >
      {BLOOMS.map((bloom) => (
        <DriftingBloom key={bloom.colorKey} bloom={bloom} color={palette[bloom.colorKey]} intensity={peak} hostHeight={height} reduceMotion={reduceMotion} />
      ))}
      {/* Fade into the page so the light never ends with an edge. */}
      <LinearGradient
        colors={['rgba(0,0,0,0)', colors.background]}
        start={{ x: 0.5, y: 0.35 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    overflow: 'hidden',
  },
  bloom: {
    position: 'relative',
  },
});
