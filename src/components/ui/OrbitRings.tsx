/**
 * Orbit rings (owner: shell / Foundation; docs/v1/DESIGN_SYSTEM.md §2.1 "light"): a few thin
 * concentric circles, the motif of the welcome image, drawn behind a hero's content. Pure views
 * (1dp borders whose alpha fades outward), no touches, hidden from screen readers. Place it
 * absolutely inside a card that clips its corners: the rings then read as faint light arcs where
 * they cross the edge.
 */
import type { ReactElement } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { radii, withAlpha } from '../../theme';

export interface OrbitRingsProps {
  /** Hex color of the lines (the hero's text color). */
  color: string;
  /** Diameter of the outer ring in dp. */
  size: number;
  /** Number of rings (default 4). */
  count?: number;
  /** Alpha of the innermost ring (default 0.28); each ring outward is fainter. */
  intensity?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Ring diameters and alphas, innermost first. */
export function orbitRings(size: number, count: number, intensity: number): { diameter: number; alpha: number }[] {
  const safeCount = Math.max(1, Math.floor(count));
  return Array.from({ length: safeCount }, (_, index) => ({
    diameter: (size * (index + 1)) / safeCount,
    alpha: Number((intensity * (1 - index / (safeCount + 1))).toFixed(4)),
  }));
}

export function OrbitRings({ color, size, count = 4, intensity = 0.28, style, testID }: OrbitRingsProps): ReactElement {
  const rings = orbitRings(size, count, Math.min(1, Math.max(0, intensity)));
  return (
    <View
      style={[styles.host, { width: size, height: size }, style]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
    >
      {rings.map((ring) => (
        <View
          key={ring.diameter}
          style={[
            styles.ring,
            {
              width: ring.diameter,
              height: ring.diameter,
              marginLeft: -ring.diameter / 2,
              marginTop: -ring.diameter / 2,
              borderColor: withAlpha(color, ring.alpha),
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
  },
  ring: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    borderWidth: 1,
    borderRadius: radii.full,
  },
});
