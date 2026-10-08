/**
 * Empty state (owner: shell / Foundation; docs/DESIGN_SYSTEM.md §5/§8): 96dp surfaceVariant
 * circle with a 48dp MCI icon, headlineS title, bodyM body, optional tonal action. Centered,
 * pv 40 - replaces the per-screen dashed boxes and plain-text empties.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps, ReactElement } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { componentMetrics, radii, spacing, typography, useAppTheme } from '../../theme';
import { MGButton } from './MGButton';

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
   * (docs/DESIGN_SYSTEM.md §8). Prefer ErrorState whenever a retry handler exists.
   */
  tone?: 'neutral' | 'error';
  action?: EmptyStateAction;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function EmptyState({ icon, title, body, tone = 'neutral', action, style, testID }: EmptyStateProps): ReactElement {
  const { colors } = useAppTheme();
  const error = tone === 'error';
  return (
    <View style={[styles.container, style]} testID={testID}>
      <View style={[styles.circle, { backgroundColor: error ? colors.errorContainer : colors.surfaceVariant }]}>
        <MaterialCommunityIcons
          name={icon}
          size={componentMetrics.emptyStateIcon}
          color={error ? colors.onErrorContainer : colors.onSurfaceVariant}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
      </View>
      <Text style={[styles.title, { color: colors.onSurface }]} accessibilityRole="header">
        {title}
      </Text>
      <Text style={[styles.body, { color: colors.onSurfaceVariant }]}>{body}</Text>
      {action ? (
        <MGButton variant="tonal" onPress={action.onPress} style={styles.action} testID={testID ? `${testID}-action` : undefined}>
          {action.label}
        </MGButton>
      ) : null}
    </View>
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
