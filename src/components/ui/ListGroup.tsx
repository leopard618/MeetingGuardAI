/**
 * Grouped list container (owner: shell / Foundation; docs/DESIGN_SYSTEM.md §5): surface, r-md,
 * 1px outlineVariant border, hairline dividers between children (settings / details pattern).
 */
import { Children, Fragment, type ReactElement, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { radii, useAppTheme } from '../../theme';

export interface ListGroupProps {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function ListGroup({ children, style, testID }: ListGroupProps): ReactElement {
  const { colors } = useAppTheme();
  const items = Children.toArray(children);
  return (
    <View
      style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.outlineVariant }, style]}
      testID={testID}
    >
      {items.map((child, index) => (
        <Fragment key={index}>
          {index > 0 ? <View style={[styles.divider, { backgroundColor: colors.outlineVariant }]} /> : null}
          {child}
        </Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    borderRadius: radii.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
});
