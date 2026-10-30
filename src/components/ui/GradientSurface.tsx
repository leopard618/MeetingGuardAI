/**
 * Gradient-filled surface (owner: shell / Foundation; docs/v1/DESIGN_SYSTEM.md §5). The ONLY place
 * the app draws a gradient: picks the stops for the active scheme from `gradients` so every
 * button, FAB, hero card and the assistant orb share the same two-stop ramps.
 *
 * `variant`: primary (buttons, FAB, active tab), hero (one banner per screen), ai (assistant).
 * `direction`: diagonal (default, top-left to bottom-right), horizontal, vertical.
 * Text inside takes `useAppTheme().onGradient[variant]`.
 */
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactElement, ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import { useAppTheme, type MGGradients } from '../../theme';

export type GradientVariant = keyof MGGradients;
export type GradientDirection = 'diagonal' | 'horizontal' | 'vertical';

const DIRECTIONS: Readonly<Record<GradientDirection, { start: { x: number; y: number }; end: { x: number; y: number } }>> = {
  diagonal: { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } },
  horizontal: { start: { x: 0, y: 0.5 }, end: { x: 1, y: 0.5 } },
  vertical: { start: { x: 0.5, y: 0 }, end: { x: 0.5, y: 1 } },
};

export interface GradientSurfaceProps {
  variant?: GradientVariant;
  direction?: GradientDirection;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  pointerEvents?: 'auto' | 'none' | 'box-none' | 'box-only';
  testID?: string;
}

export function GradientSurface({
  variant = 'primary',
  direction = 'diagonal',
  style,
  children,
  pointerEvents,
  testID,
}: GradientSurfaceProps): ReactElement {
  const { gradients } = useAppTheme();
  const points = DIRECTIONS[direction];
  return (
    <LinearGradient colors={gradients[variant]} start={points.start} end={points.end} style={style} pointerEvents={pointerEvents} testID={testID}>
      {children}
    </LinearGradient>
  );
}
