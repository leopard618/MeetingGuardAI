/** Onboarding step 4: AI assistant introduction (capabilities, examples, daily quota, privacy). */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import type { ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { MGButton } from '../../components/ui';
import { PLAN_DAILY_AI_LIMITS } from '../../core/aiContract';
import { useT } from '../../i18n';
import { useEntitlement } from '../../services/data';
import { componentMetrics, radii, spacing, useAppTheme } from '../../theme';
import { OnboardingLayout, OnboardingSection, useOnboardingNavigation, type OnboardingNavigation } from './OnboardingLayout';

const CAPABILITIES = [
  { key: 'create', icon: 'calendar-plus' },
  { key: 'update', icon: 'calendar-edit' },
  { key: 'delete', icon: 'calendar-remove' },
  { key: 'share', icon: 'share-variant' },
  { key: 'bulk', icon: 'calendar-multiple' },
] as const;

const EXAMPLES = ['create', 'move', 'share', 'bulk'] as const;

export function OnboardingAssistantScreen(): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const navigation = useNavigation<OnboardingNavigation>();
  const { goNext } = useOnboardingNavigation('OnboardingAssistant');
  const { plan } = useEntitlement();
  const dailyLimit = PLAN_DAILY_AI_LIMITS[plan];

  return (
    <OnboardingLayout
      step="OnboardingAssistant"
      title={t('onboarding:assistant.title')}
      subtitle={t('onboarding:assistant.subtitle')}
      primaryLabel={t('common:actions.continue')}
      onPrimary={goNext}
    >
      <OnboardingSection title={t('onboarding:assistant.capabilitiesTitle')}>
        {CAPABILITIES.map(({ key, icon }) => (
          <View key={key} style={styles.row}>
            <View style={[styles.rowIcon, { backgroundColor: colors.tertiaryContainer }]}>
              <MaterialCommunityIcons name={icon} size={componentMetrics.iconInline} color={colors.onTertiaryContainer} />
            </View>
            <Text variant="bodyMedium" style={styles.rowText}>
              {t(`onboarding:assistant.capabilities.${key}`)}
            </Text>
          </View>
        ))}
        <Text variant="bodySmall" style={[styles.note, { color: colors.onSurfaceVariant }]}>
          {t('onboarding:assistant.confirm')}
        </Text>
      </OnboardingSection>

      <OnboardingSection title={t('onboarding:assistant.examplesTitle')}>
        {EXAMPLES.map((key) => (
          <View key={key} style={[styles.example, { backgroundColor: colors.secondaryContainer }]}>
            <Text variant="bodyMedium" style={{ color: colors.onSecondaryContainer }}>
              “{t(`onboarding:assistant.examples.${key}`)}”
            </Text>
          </View>
        ))}
        <Text variant="bodySmall" style={[styles.note, { color: colors.onSurfaceVariant }]}>
          {t('onboarding:assistant.quota', { count: dailyLimit, plan: t(`onboarding:assistant.plans.${plan}`) })}
        </Text>
      </OnboardingSection>

      <OnboardingSection title={t('onboarding:assistant.privacyTitle')}>
        <Text variant="bodyMedium">{t('onboarding:assistant.privacy')}</Text>
        <MGButton variant="ghost" size="sm" style={styles.link} onPress={() => navigation.navigate('Privacy')}>
          {t('onboarding:assistant.privacyLink')}
        </MGButton>
      </OnboardingSection>
    </OnboardingLayout>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  rowIcon: {
    width: spacing.xxxl,
    height: spacing.xxxl,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    marginLeft: spacing.md,
    flex: 1,
  },
  note: {
    marginTop: spacing.md,
  },
  example: {
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
  },
  link: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
  },
});
