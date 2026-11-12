/**
 * Accent surface (owner: shell / Foundation; docs/v1/DESIGN_SYSTEM.md §2.1). A SOLID primary
 * block: the one place the kit paints the accent as a surface (FAB, the assistant button, the
 * sign-in button, avatars). The name is historical: the visual refresh of October 30 drew a
 * gradient here, which the client rejected on November 1 ("remove all gradient"); the API stayed
 * so callers did not change. `variant` and `direction` are accepted and ignored. Text inside
 * takes `useAppTheme().onGradient.primary` (= colors.onPrimary).
 */
import type { ReactElement, ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '../../theme';

export type GradientVariant = 'primary' | 'hero' | 'ai';
export type GradientDirection = 'diagonal' | 'horizontal' | 'vertical';

export interface GradientSurfaceProps {
  variant?: GradientVariant;
  direction?: GradientDirection;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  pointerEvents?: 'auto' | 'none' | 'box-none' | 'box-only';
  testID?: string;
}

export function GradientSurface({ style, children, pointerEvents, testID }: GradientSurfaceProps): ReactElement {
  const { colors } = useAppTheme();
  return (
    <View style={[{ backgroundColor: colors.primary }, style]} pointerEvents={pointerEvents} testID={testID}>
      {children}
    </View>
  );
}
