/**
 * Section heading above cards / list groups (owner: shell / Foundation; docs/DESIGN_SYSTEM.md
 * §5): titleS onSurfaceVariant, sentence case (never UPPERCASE), mt 24 / mb 8, optional trailing
 * text action ("See all") with a 44dp touch target via hitSlop, or a plain non-pressable
 * `trailing` node (count label, Badge).
 */
import type { ReactElement, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { pressedOpacity, spacing, typography, useAppTheme } from '../../theme';

export interface SectionHeaderAction {
  label: string;
  onPress: () => void;
}

export interface SectionHeaderProps {
  title: string;
  action?: SectionHeaderAction;
  /** Plain (non-pressable) trailing node — e.g. a count label or Badge. */
  trailing?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function SectionHeader({ title, action, trailing, style, testID }: SectionHeaderProps): ReactElement {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.row, style]} testID={testID}>
      <Text style={[styles.title, { color: colors.onSurfaceVariant }]} accessibilityRole="header">
        {title}
      </Text>
      {trailing ?? null}
      {action ? (
        <Pressable
          onPress={action.onPress}
          hitSlop={12}
          style={({ pressed }) => [pressed && styles.pressed]}
          accessibilityRole="button"
          testID={testID ? `${testID}-action` : undefined}
        >
          <Text style={[styles.actionLabel, { color: colors.primary }]}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: spacing.xxl,
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  title: {
    ...typography.titleS,
    flexShrink: 1,
  },
  actionLabel: {
    ...typography.labelL,
  },
  pressed: {
    opacity: pressedOpacity,
  },
});
