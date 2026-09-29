/** Onboarding step 4: AI assistant introduction (capabilities, examples, daily quota, privacy). */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import type { ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text, useTheme as usePaperTheme } from 'react-native-paper';

import { PLAN_DAILY_AI_LIMITS } from '../../core/aiContract';
import { useT } from '../../i18n';
import { useEntitlement } from '../../services/data';
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
  const theme = usePaperTheme();
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
            <MaterialCommunityIcons name={icon} size={20} color={theme.colors.primary} />
            <Text variant="bodyMedium" style={styles.rowText}>
              {t(`onboarding:assistant.capabilities.${key}`)}
            </Text>
          </View>
        ))}
        <Text variant="bodySmall" style={[styles.note, { color: theme.colors.onSurfaceVariant }]}>
          {t('onboarding:assistant.confirm')}
        </Text>
      </OnboardingSection>

      <OnboardingSection title={t('onboarding:assistant.examplesTitle')}>
        {EXAMPLES.map((key) => (
          <View key={key} style={[styles.example, { backgroundColor: theme.colors.secondaryContainer }]}>
            <Text variant="bodyMedium" style={{ color: theme.colors.onSecondaryContainer }}>
              “{t(`onboarding:assistant.examples.${key}`)}”
            </Text>
          </View>
        ))}
        <Text variant="bodySmall" style={[styles.note, { color: theme.colors.onSurfaceVariant }]}>
          {t('onboarding:assistant.quota', { count: dailyLimit, plan: t(`onboarding:assistant.plans.${plan}`) })}
        </Text>
      </OnboardingSection>

      <OnboardingSection title={t('onboarding:assistant.privacyTitle')}>
        <Text variant="bodyMedium">{t('onboarding:assistant.privacy')}</Text>
        <Button mode="text" style={styles.link} onPress={() => navigation.navigate('Privacy')}>
          {t('onboarding:assistant.privacyLink')}
        </Button>
      </OnboardingSection>
    </OnboardingLayout>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  rowText: {
    marginLeft: 12,
    flex: 1,
  },
  note: {
    marginTop: 12,
  },
  example: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 8,
  },
  link: {
    alignSelf: 'flex-start',
    marginTop: 4,
  },
});
