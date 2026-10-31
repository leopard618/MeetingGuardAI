/**
 * Soft light bloom (owner: shell / Foundation; docs/v1/DESIGN_SYSTEM.md §2.1 "light"). Four
 * concentric translucent discs fake a radial gradient without a native module: the center is
 * the brightest, the rim fades to nothing. Purely decorative (pointerEvents none, hidden from
 * screen readers). Place it absolutely behind an orb, a focal card or a screen header.
 */
import type { ReactElement } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { radii, withAlpha } from '../../theme';

export interface GlowProps {
  /** Hex color of the light. */
  color: string;
  /** Diameter in dp. */
  size: number;
  /** Peak alpha at the center (default 0.45). */
  intensity?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const RINGS: readonly { scale: number; alpha: number }[] = [
  { scale: 1, alpha: 0.14 },
  { scale: 0.76, alpha: 0.22 },
  { scale: 0.52, alpha: 0.32 },
  { scale: 0.3, alpha: 0.48 },
];

export function Glow({ color, size, intensity = 0.45, style, testID }: GlowProps): ReactElement {
  return (
    <View
      style={[styles.host, { width: size, height: size }, style]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
    >
      {RINGS.map((ring) => {
        const diameter = size * ring.scale;
        return (
          <View
            key={ring.scale}
            style={[
              styles.ring,
              {
                width: diameter,
                height: diameter,
                marginLeft: -diameter / 2,
                marginTop: -diameter / 2,
                backgroundColor: withAlpha(color, Math.min(1, ring.alpha * intensity * 2)),
              },
            ]}
          />
        );
      })}
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
    borderRadius: radii.full,
  },
});
