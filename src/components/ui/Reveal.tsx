/**
 * Block wrapper (owner: shell / Foundation). It used to fade and rise blocks in on mount; the
 * client asked for no animation (November 1, 2026), so it is now a plain View that keeps the
 * `delay` / `index` props for API compatibility and renders its children at rest.
 */
import type { ReactElement, ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

export interface RevealProps {
  children?: ReactNode;
  /** Ignored (kept for API compatibility). */
  delay?: number;
  /** Ignored (kept for API compatibility). */
  index?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Reveal({ children, style, testID }: RevealProps): ReactElement {
  return (
    <View style={style} testID={testID}>
      {children}
    </View>
  );
}
