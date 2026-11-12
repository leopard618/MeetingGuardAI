/**
 * Extended floating action button (owner: shell / Foundation; docs/v1/DESIGN_SYSTEM.md §5):
 * 56dp pill on the primary gradient with a colored floating shadow, 24dp MCI icon plus labelL
 * text, press-scale feedback. Replaces Paper's FAB on the list screens (meetings, calendar,
 * tasks, notes), which keep positioning it (absolute, hide-on-scroll) themselves.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps, ReactElement } from 'react';
import { StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { componentMetrics, floatingShadow, radii, spacing, typography, useAppTheme } from '../../theme';
import { GradientSurface } from './GradientSurface';
import { PressableScale } from './PressableScale';

export interface GradientFabProps {
  icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
  /** Extended label; omit for a round 56dp button. */
  label?: string;
  onPress: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function GradientFab({ icon, label, onPress, accessibilityLabel, accessibilityHint, disabled = false, style, testID }: GradientFabProps): ReactElement {
  const { onGradient } = useAppTheme();
  const color = onGradient.primary;
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      style={[styles.shadow, style]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: disabled || undefined }}
      testID={testID}
    >
      <GradientSurface style={[styles.pill, label ? styles.extended : styles.round]}>
        <MaterialCommunityIcons name={icon} size={componentMetrics.iconNav} color={color} />
        {label ? (
          <Text style={[styles.label, { color }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
            {label}
          </Text>
        ) : null}
      </GradientSurface>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  shadow: {
    borderRadius: radii.full,
    ...floatingShadow,
  },
  pill: {
    minHeight: componentMetrics.fabSize,
    borderRadius: radii.full,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  extended: {
    paddingLeft: spacing.lg,
    paddingRight: spacing.xl,
    gap: spacing.sm,
  },
  round: {
    width: componentMetrics.fabSize,
  },
  label: {
    ...typography.labelL,
  },
});
