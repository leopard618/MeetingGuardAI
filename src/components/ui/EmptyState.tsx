/**
 * Empty state (owner: shell / Foundation; docs/v1/DESIGN_SYSTEM.md §5/§8): 96dp circle on a soft
 * primaryContainer-to-tertiaryContainer gradient with a 48dp MCI icon in primary, headlineS title,
 * bodyM body, optional tonal action. Centered, pv 40, revealed with the kit's mount animation.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { LinearGradient } from 'expo-linear-gradient';
import type { ComponentProps, ReactElement } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { componentMetrics, radii, spacing, typography, useAppTheme } from '../../theme';
import { MGButton } from './MGButton';
import { Reveal } from './Reveal';

export interface EmptyStateAction {
  label: string;
  onPress: () => void;
}

export interface EmptyStateProps {
  icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
  title: string;
  body: string;
  /**
   * "error" gives the icon circle the errorContainer pair - for a load failure with nothing
   * cached on screens that (yet) have no retry path, so it never reads like a neutral empty
   * (docs/v1/DESIGN_SYSTEM.md §8). Prefer ErrorState whenever a retry handler exists.
   */
  tone?: 'neutral' | 'error';
  action?: EmptyStateAction;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function EmptyState({ icon, title, body, tone = 'neutral', action, style, testID }: EmptyStateProps): ReactElement {
  const { colors } = useAppTheme();
  const error = tone === 'error';
  const circleColors: readonly [string, string] = error
    ? [colors.errorContainer, colors.errorContainer]
    : [colors.primaryContainer, colors.tertiaryContainer];
  return (
    <Reveal style={[styles.container, style]} testID={testID}>
      <LinearGradient colors={circleColors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.circle}>
        <MaterialCommunityIcons
          name={icon}
          size={componentMetrics.emptyStateIcon}
          color={error ? colors.onErrorContainer : colors.primary}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
      </LinearGradient>
      <Text style={[styles.title, { color: colors.onSurface }]} accessibilityRole="header">
        {title}
      </Text>
      <Text style={[styles.body, { color: colors.onSurfaceVariant }]}>{body}</Text>
      {action ? (
        <View style={styles.action}>
          <MGButton variant="tonal" onPress={action.onPress} testID={testID ? `${testID}-action` : undefined}>
            {action.label}
          </MGButton>
        </View>
      ) : null}
    </Reveal>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: spacing.huge,
    paddingHorizontal: spacing.xxl,
  },
  circle: {
    width: componentMetrics.emptyStateCircle,
    height: componentMetrics.emptyStateCircle,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...typography.headlineS,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  body: {
    ...typography.bodyM,
    textAlign: 'center',
    marginTop: spacing.sm,
    maxWidth: 320,
  },
  action: {
    marginTop: spacing.xl,
  },
});
