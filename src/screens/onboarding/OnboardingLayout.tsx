/**
 * Shared frame of the onboarding steps: safe-area aware, progress indicator ("Step 2 of 5"),
 * scrollable body, footer actions. Records the step for resuming and handles the Android back
 * button when the step was resumed without its predecessors in the stack.
 */
import { CommonActions, useFocusEffect, useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { useCallback, type ReactElement, type ReactNode } from 'react';
import { BackHandler, ScrollView, StyleSheet, View } from 'react-native';
import { IconButton, ProgressBar, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MGButton } from '../../components/ui';
import type { RootStackParamList } from '../../core/contracts';
import { toAppError } from '../../core/errors';
import { createLogger } from '../../core/logger';
import { useT } from '../../i18n';
import {
  ONBOARDING_STEPS,
  nextOnboardingStep,
  onboardingStepIndex,
  previousOnboardingStep,
  type OnboardingStep,
} from '../../navigation/routes';
import { useAuth } from '../../services/auth';
import { componentMetrics, radii, spacing, useAppTheme } from '../../theme';
import { saveOnboardingStep } from './progress';

const log = createLogger('onboarding');

export type OnboardingNavigation = StackNavigationProp<RootStackParamList>;

/** Navigation helpers for a step (next / previous in the fixed order). */
export function useOnboardingNavigation(step: OnboardingStep): { goNext(): void; goBack(): boolean } {
  const navigation = useNavigation<OnboardingNavigation>();

  const goNext = useCallback(() => {
    const next = nextOnboardingStep(step);
    if (next !== null) navigation.navigate(next);
  }, [navigation, step]);

  /** Returns false when there is nothing to go back to (first step). */
  const goBack = useCallback((): boolean => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return true;
    }
    const previous = previousOnboardingStep(step);
    if (previous === null) return false;
    // Resumed at this step: the earlier steps are not in the stack.
    navigation.dispatch(CommonActions.reset({ index: 0, routes: [{ name: previous }] }));
    return true;
  }, [navigation, step]);

  return { goNext, goBack };
}

export interface OnboardingLayoutProps {
  step: OnboardingStep;
  title: string;
  subtitle?: string;
  children?: ReactNode;
  primaryLabel: string;
  onPrimary: () => void;
  primaryDisabled?: boolean;
  primaryLoading?: boolean;
  secondaryLabel?: string;
  onSecondary?: () => void;
}

export function OnboardingLayout({
  step,
  title,
  subtitle,
  children,
  primaryLabel,
  onPrimary,
  primaryDisabled = false,
  primaryLoading = false,
  secondaryLabel,
  onSecondary,
}: OnboardingLayoutProps): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { authUser } = useAuth();
  const uid = authUser?.uid ?? null;
  const { goBack } = useOnboardingNavigation(step);
  const index = onboardingStepIndex(step);
  const total = ONBOARDING_STEPS.length;

  useFocusEffect(
    useCallback(() => {
      if (uid !== null) {
        saveOnboardingStep(uid, step).catch((error: unknown) => {
          log.warn('could not save the onboarding progress', toAppError(error).code);
        });
      }
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => goBack());
      return () => subscription.remove();
    }, [goBack, step, uid]),
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        {index > 0 ? (
          <IconButton
            icon="arrow-left"
            accessibilityLabel={t('common:actions.back')}
            hitSlop={4}
            onPress={() => {
              goBack();
            }}
          />
        ) : (
          <View style={styles.iconPlaceholder} />
        )}
        <View style={styles.progress}>
          <Text variant="labelMedium" style={{ color: colors.onSurfaceVariant }}>
            {t('onboarding:progress', { current: index + 1, total })}
          </Text>
          <ProgressBar progress={(index + 1) / total} style={styles.progressBar} />
        </View>
        <View style={styles.iconPlaceholder} />
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text variant="headlineSmall" style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Text variant="bodyMedium" style={[styles.subtitle, { color: colors.onSurfaceVariant }]}>
            {subtitle}
          </Text>
        ) : null}
        {children}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md, borderTopColor: colors.outlineVariant }]}>
        <MGButton onPress={onPrimary} disabled={primaryDisabled || primaryLoading} loading={primaryLoading}>
          {primaryLabel}
        </MGButton>
        {secondaryLabel && onSecondary ? (
          <MGButton variant="ghost" onPress={onSecondary} disabled={primaryLoading} style={styles.secondary}>
            {secondaryLabel}
          </MGButton>
        ) : null}
      </View>
    </View>
  );
}

/** Card-like section used by the steps (MG card baseline: surface, r-lg, 1px outlineVariant). */
export function OnboardingSection({ title, children }: { title?: string; children?: ReactNode }): ReactElement {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.outlineVariant }]}>
      {title ? (
        <Text variant="titleMedium" style={styles.sectionTitle}>
          {title}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.xs,
  },
  iconPlaceholder: {
    width: 48,
  },
  progress: {
    flex: 1,
    alignItems: 'center',
  },
  progressBar: {
    marginTop: spacing.xs,
    width: 160,
    height: spacing.xs,
    borderRadius: radii.full,
  },
  body: {
    paddingHorizontal: componentMetrics.screenGutter,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  title: {
    fontWeight: '700',
  },
  subtitle: {
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  footer: {
    paddingHorizontal: componentMetrics.screenGutter,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  secondary: {
    marginTop: spacing.xs,
  },
  section: {
    marginTop: componentMetrics.cardPadding,
    padding: componentMetrics.cardPadding,
    borderRadius: radii.lg,
    borderWidth: 1,
  },
  sectionTitle: {
    marginBottom: spacing.sm,
  },
});
