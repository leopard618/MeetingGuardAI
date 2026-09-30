/**
 * List / settings row (owner: shell / Foundation; docs/DESIGN_SYSTEM.md §5): minHeight 56
 * (72 with supporting text), leading 24dp MCI icon in onSurfaceVariant, title titleM, supporting
 * bodyM, trailing node or chevron. Selected rows tint surfaceContainerHigh; disabled rows use
 * disabledText (never opacity on the whole row). Ripple onSurface@8%.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type AccessibilityProps, type StyleProp, type ViewStyle } from 'react-native';

import { componentMetrics, pressedOpacity, spacing, stateAlpha, typography, useAppTheme, withAlpha } from '../../theme';

export type ListRowIconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export interface ListRowProps extends AccessibilityProps {
  /** MaterialCommunityIcons name, 24dp, onSurfaceVariant. */
  icon?: ListRowIconName;
  title: string;
  supporting?: string;
  /** A custom trailing node (Switch, Badge, value text) or "chevron" for navigation rows. */
  trailing?: ReactNode | 'chevron';
  onPress?: () => void;
  selected?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function ListRow({
  icon,
  title,
  supporting,
  trailing,
  onPress,
  selected = false,
  disabled = false,
  style,
  testID,
  ...accessibility
}: ListRowProps): ReactElement {
  const { colors } = useAppTheme();
  const titleColor = disabled ? colors.disabledText : colors.onSurface;
  const supportingColor = disabled ? colors.disabledText : colors.onSurfaceVariant;
  const iconColor = disabled ? colors.disabledText : colors.onSurfaceVariant;

  const content = (
    <>
      {icon ? <MaterialCommunityIcons name={icon} size={componentMetrics.iconNav} color={iconColor} /> : null}
      <View style={styles.texts}>
        <Text style={[styles.title, { color: titleColor }]}>{title}</Text>
        {supporting ? <Text style={[styles.supporting, { color: supportingColor }]}>{supporting}</Text> : null}
      </View>
      {trailing === 'chevron' ? (
        <MaterialCommunityIcons name="chevron-right" size={componentMetrics.iconNav} color={iconColor} />
      ) : (
        (trailing ?? null)
      )}
    </>
  );

  const rowStyle = [
    styles.row,
    supporting ? styles.rowTwoLine : null,
    selected ? { backgroundColor: colors.surfaceContainerHigh } : null,
    style,
  ];

  if (!onPress) {
    return (
      <View style={rowStyle} testID={testID} {...accessibility} accessibilityState={{ selected: selected || undefined, disabled: disabled || undefined, ...accessibility.accessibilityState }}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      android_ripple={{ color: withAlpha(colors.onSurface, stateAlpha.rippleOnRow) }}
      style={({ pressed }) => [...rowStyle, pressed && Platform.OS !== 'android' && styles.pressed]}
      testID={testID}
      {...accessibility}
      accessibilityRole={accessibility.accessibilityRole ?? 'button'}
      accessibilityState={{ selected: selected || undefined, disabled: disabled || undefined, ...accessibility.accessibilityState }}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: componentMetrics.listRowMinHeight,
    paddingHorizontal: componentMetrics.listRowPaddingH,
    paddingVertical: componentMetrics.listRowPaddingV,
    gap: spacing.lg,
  },
  rowTwoLine: {
    minHeight: componentMetrics.listRowTwoLineMinHeight,
  },
  texts: {
    flex: 1,
  },
  title: {
    ...typography.titleM,
  },
  supporting: {
    ...typography.bodyM,
  },
  pressed: {
    opacity: pressedOpacity,
  },
});
