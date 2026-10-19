/**
 * Bottom-sheet drag handle (owner: shell / Foundation; docs/v1/DESIGN_SYSTEM.md §5): 32x4 outline
 * bar, self-centered, decorative only (hidden from screen readers).
 */
import type { ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';

import { componentMetrics, radii, spacing, useAppTheme } from '../../theme';

export function SheetHandle(): ReactElement {
  const { colors } = useAppTheme();
  return (
    <View
      style={[styles.handle, { backgroundColor: colors.outline }]}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}

const styles = StyleSheet.create({
  handle: {
    alignSelf: 'center',
    width: componentMetrics.sheetHandleWidth,
    height: componentMetrics.sheetHandleHeight,
    borderRadius: radii.full,
    marginVertical: spacing.sm,
  },
});
