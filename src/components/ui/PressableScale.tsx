/**
 * Press feedback (owner: shell / Foundation; docs/v1/DESIGN_SYSTEM.md §2.1): a plain Pressable
 * that dims to `pressedOpacity` while held. No scale animation: the client asked for no motion
 * effects (November 1, 2026). The name is historical so callers did not change; `scaleTo` is
 * accepted and ignored.
 */
import type { ReactElement, ReactNode } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

import { pressedOpacity } from '../../theme';

export interface PressableScaleProps extends Omit<PressableProps, 'style' | 'children'> {
  style?: StyleProp<ViewStyle>;
  /** Ignored (kept for API compatibility). */
  scaleTo?: number;
  children?: ReactNode;
}

export function PressableScale({ style, scaleTo: _scaleTo, children, disabled, ...rest }: PressableScaleProps): ReactElement {
  return (
    <Pressable disabled={disabled} style={({ pressed }) => [style, pressed && !disabled ? { opacity: pressedOpacity } : null]} {...rest}>
      {children}
    </Pressable>
  );
}
