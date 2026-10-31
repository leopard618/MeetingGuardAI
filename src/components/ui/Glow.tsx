/**
 * Soft light bloom (owner: shell / Foundation; docs/v1/DESIGN_SYSTEM.md §2.1 "light"). 24
 * concentric translucent discs fake a radial gradient without a native module. Each disc adds a
 * small alpha so the stack follows a smooth quadratic falloff: the eye reads one soft glow, not
 * rings (four discs with big steps did read as rings). `intensity` is the alpha at the very
 * center. Purely decorative (pointerEvents none, hidden from screen readers). Place it absolutely
 * behind an orb, a focal card or a screen header.
 */
import type { ReactElement } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { radii, withAlpha } from '../../theme';

export interface GlowProps {
  /** Hex color of the light. */
  color: string;
  /** Diameter in dp. */
  size: number;
  /** Alpha at the center (default 0.35). */
  intensity?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const RING_COUNT = 24;

/** Cumulative alpha wanted at a radius fraction r (1 = rim, 0 = center): (1 - r)^2. */
function profile(r: number): number {
  const t = 1 - r;
  return t * t;
}

/** Per-disc alpha increments so the stacked discs approximate `intensity * profile`. */
export function glowRings(intensity: number): { scale: number; alpha: number }[] {
  const rings: { scale: number; alpha: number }[] = [];
  let covered = 0;
  for (let i = 0; i < RING_COUNT; i += 1) {
    const scale = 1 - i / RING_COUNT;
    // Target cumulative alpha inside this disc (its own rim).
    const target = intensity * profile(scale - 1 / RING_COUNT);
    // Stacked translucent layers compound: 1 - (1 - covered) * (1 - alpha) = target.
    const alpha = covered >= 1 ? 0 : Math.max(0, 1 - (1 - target) / (1 - covered));
    covered = 1 - (1 - covered) * (1 - alpha);
    rings.push({ scale, alpha: Math.min(1, Number(alpha.toFixed(4))) });
  }
  return rings;
}

export function Glow({ color, size, intensity = 0.35, style, testID }: GlowProps): ReactElement {
  const rings = glowRings(Math.min(1, Math.max(0, intensity)));
  return (
    <View
      style={[styles.host, { width: size, height: size }, style]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
    >
      {rings.map((ring) => {
        if (ring.alpha <= 0) return null;
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
                backgroundColor: withAlpha(color, ring.alpha),
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
