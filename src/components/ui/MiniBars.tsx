/**
 * Mini bar chart (owner: shell / Foundation; docs/v1/DESIGN_SYSTEM.md §5): a handful of bars that
 * grow from the baseline on mount (still under "reduce motion"), one of them highlighted on the
 * primary gradient, a short label under each. It shows data, so the parent passes an
 * accessibilityLabel that says the numbers; the bars themselves are hidden from screen readers.
 * Used by the dashboard's week card (meeting time per day).
 */
import { useEffect, useState, type ReactElement } from 'react';
import { Animated, Easing, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { motion, radii, spacing, typography, useAppTheme, withAlpha } from '../../theme';
import { GradientSurface } from './GradientSurface';
import { useReducedMotion } from './useReducedMotion';

export interface MiniBar {
  key: string;
  /** 0..1 of the tallest bar; anything above 0 shows at least MIN_FRACTION. */
  fraction: number;
  label: string;
  /** The bar on the primary gradient (today). */
  highlighted?: boolean;
}

export interface MiniBarsProps {
  bars: readonly MiniBar[];
  /** Height of the bar area in dp (default 72). */
  height?: number;
  /** What the chart says, for screen readers. */
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** An empty day still shows a stub so the week reads as seven columns. */
export const MIN_FRACTION = 0.06;
const GROW_MS = 520;

/** Bar height in dp for a fraction (clamped to 0..1, never under the stub height). */
export function barHeight(fraction: number, height: number): number {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
  return Math.round(Math.max(MIN_FRACTION, clamped) * height);
}

function Bar({ bar, height, index, reduceMotion }: { bar: MiniBar; height: number; index: number; reduceMotion: boolean }): ReactElement {
  const { colors, isDark } = useAppTheme();
  const [grow] = useState(() => new Animated.Value(reduceMotion ? 1 : 0));

  useEffect(() => {
    if (reduceMotion) {
      grow.setValue(1);
      return undefined;
    }
    const animation = Animated.timing(grow, {
      toValue: 1,
      duration: GROW_MS,
      delay: index * motion.staggerMs,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [grow, index, reduceMotion]);

  const barStyle = { height: barHeight(bar.fraction, height), transform: [{ scaleY: grow }], transformOrigin: 'bottom' as const };
  return (
    <View style={styles.column}>
      <View style={[styles.track, { height }]}>
        {bar.highlighted ? (
          <Animated.View style={[styles.bar, barStyle]}>
            <GradientSurface direction="vertical" style={styles.barFill} />
          </Animated.View>
        ) : (
          <Animated.View style={[styles.bar, barStyle, { backgroundColor: withAlpha(colors.primary, bar.fraction > 0 ? (isDark ? 0.34 : 0.2) : isDark ? 0.14 : 0.08) }]} />
        )}
      </View>
      <Text
        style={[styles.label, bar.highlighted ? styles.labelStrong : null, { color: bar.highlighted ? colors.onSurface : colors.onSurfaceVariant }]}
        numberOfLines={1}
        maxFontSizeMultiplier={1.3}
      >
        {bar.label}
      </Text>
    </View>
  );
}

export function MiniBars({ bars, height = 72, accessibilityLabel, style, testID }: MiniBarsProps): ReactElement {
  const reduceMotion = useReducedMotion();
  return (
    <View style={[styles.host, style]} accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel} testID={testID}>
      {bars.map((bar, index) => (
        <Bar key={bar.key} bar={bar} height={height} index={index} reduceMotion={reduceMotion} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  column: {
    flex: 1,
    alignItems: 'center',
  },
  track: {
    width: '100%',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  bar: {
    width: '100%',
    maxWidth: 28,
    borderRadius: radii.sm,
    overflow: 'hidden',
  },
  barFill: {
    flex: 1,
  },
  label: {
    ...typography.labelS,
    marginTop: spacing.xs,
  },
  labelStrong: {
    ...typography.labelM,
  },
});
