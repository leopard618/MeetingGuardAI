/**
 * Full error state with Retry (owner: shell / Foundation; docs/v1/DESIGN_SYSTEM.md §5/§8). Shown
 * ONLY when there is nothing cached to render (ARCHITECTURE §13) - cached content + an error
 * Banner otherwise. errorContainer circle, optional headlineS title, bodyM body, filled Retry
 * (label from common:actions.retry).
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ReactElement } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { useT } from '../../i18n';
import { componentMetrics, radii, spacing, typography, useAppTheme } from '../../theme';
import { MGButton } from './MGButton';

export interface ErrorStateProps {
  body: string;
  title?: string;
  onRetry: () => void;
  /** While true the Retry button shows Paper's spinner and is disabled (guards re-entry). */
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function ErrorState({ body, title, onRetry, loading = false, style, testID }: ErrorStateProps): ReactElement {
  const { colors } = useAppTheme();
  const t = useT();
  return (
    <View style={[styles.container, style]} accessibilityRole="alert" testID={testID}>
      <View style={[styles.circle, { backgroundColor: colors.errorContainer }]}>
        <MaterialCommunityIcons
          name="alert-circle-outline"
          size={componentMetrics.emptyStateIcon}
          color={colors.onErrorContainer}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
      </View>
      {title ? (
        <Text style={[styles.title, { color: colors.onSurface }]} accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      <Text style={[styles.body, { color: colors.onSurfaceVariant }, !title && styles.bodyAlone]}>{body}</Text>
      <MGButton
        onPress={onRetry}
        loading={loading}
        disabled={loading}
        style={styles.retry}
        testID={testID ? `${testID}-retry` : 'error-state-retry'}
      >
        {t('common:actions.retry')}
      </MGButton>
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
  bodyAlone: {
    marginTop: spacing.lg,
  },
  retry: {
    marginTop: spacing.xl,
  },
});
