/**
 * Mini bar chart (owner: shell / Foundation; docs/v1/DESIGN_SYSTEM.md §5): a handful of static
 * bars, one of them highlighted in primary, a short label under each. It shows data, so the
 * parent passes an accessibilityLabel that says the numbers; the bars themselves are hidden from
 * screen readers. Used by the dashboard's week card (meeting time per day).
 */
import type { ReactElement } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { radii, spacing, typography, useAppTheme, withAlpha } from '../../theme';

export interface MiniBar {
  key: string;
  /** 0..1 of the tallest bar; anything above 0 shows at least MIN_FRACTION. */
  fraction: number;
  label: string;
  /** The bar in primary (today). */
  highlighted?: boolean;
}

export interface MiniBarsProps {
  bars: readonly MiniBar[];
  /** Height of the bar area in dp (default 56). */
  height?: number;
  /** What the chart says, for screen readers. */
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** An empty day still shows a stub so the week reads as seven columns. */
export const MIN_FRACTION = 0.06;

/** Bar height in dp for a fraction (clamped to 0..1, never under the stub height). */
export function barHeight(fraction: number, height: number): number {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
  return Math.round(Math.max(MIN_FRACTION, clamped) * height);
}

export function MiniBars({ bars, height = 56, accessibilityLabel, style, testID }: MiniBarsProps): ReactElement {
  const { colors, isDark } = useAppTheme();
  const restColor = withAlpha(colors.primary, isDark ? 0.3 : 0.2);
  const emptyColor = withAlpha(colors.onSurface, isDark ? 0.1 : 0.08);
  return (
    <View style={[styles.host, style]} accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel} testID={testID}>
      {bars.map((bar) => (
        <View key={bar.key} style={styles.column}>
          <View style={[styles.track, { height }]}>
            <View
              style={[
                styles.bar,
                { height: barHeight(bar.fraction, height), backgroundColor: bar.highlighted ? colors.primary : bar.fraction > 0 ? restColor : emptyColor },
              ]}
            />
          </View>
          <Text
            style={[styles.label, bar.highlighted ? styles.labelStrong : null, { color: bar.highlighted ? colors.onSurface : colors.onSurfaceVariant }]}
            numberOfLines={1}
            maxFontSizeMultiplier={1.3}
          >
            {bar.label}
          </Text>
        </View>
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
    maxWidth: 24,
    borderRadius: radii.sm,
  },
  label: {
    ...typography.labelS,
    marginTop: spacing.xs,
  },
  labelStrong: {
    ...typography.labelM,
  },
});
