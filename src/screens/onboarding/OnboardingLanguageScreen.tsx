/** Onboarding step 1: language (switches instantly, synced to preferences) + terms consent. */
import type { ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { RadioButton, Text, TouchableRipple } from 'react-native-paper';

import type { Language } from '../../core/types';
import { useLanguage, useT } from '../../i18n';
import { ConsentNotice } from '../../navigation/ConsentNotice';
import { componentMetrics, radii, spacing, useAppTheme } from '../../theme';
import { OnboardingLayout, useOnboardingNavigation } from './OnboardingLayout';

const FLAGS: Readonly<Record<Language, string>> = { en: '🇬🇧', es: '🇪🇸' };

export function OnboardingLanguageScreen(): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const { language, setLanguage, supportedLanguages } = useLanguage();
  const { goNext } = useOnboardingNavigation('OnboardingLanguage');

  return (
    <OnboardingLayout
      step="OnboardingLanguage"
      title={t('onboarding:language.title')}
      subtitle={t('onboarding:language.subtitle')}
      primaryLabel={t('common:actions.continue')}
      onPrimary={goNext}
    >
      <RadioButton.Group
        value={language}
        onValueChange={(value) => {
          void setLanguage(value as Language);
        }}
      >
        {supportedLanguages.map((code) => {
          const selected = code === language;
          return (
            <TouchableRipple
              key={code}
              onPress={() => {
                void setLanguage(code);
              }}
              style={[
                styles.option,
                {
                  borderColor: selected ? colors.primary : colors.outline,
                  backgroundColor: selected ? colors.primaryContainer : colors.surface,
                },
              ]}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
            >
              <View style={styles.optionRow}>
                <Text style={styles.flag}>{FLAGS[code]}</Text>
                <Text
                  variant="titleMedium"
                  style={[styles.optionLabel, { color: selected ? colors.onPrimaryContainer : colors.onSurface }]}
                >
                  {t(`common:language.${code}`)}
                </Text>
                <RadioButton value={code} />
              </View>
            </TouchableRipple>
          );
        })}
      </RadioButton.Group>
      <Text variant="bodySmall" style={[styles.hint, { color: colors.onSurfaceVariant }]}>
        {t('onboarding:language.hint')}
      </Text>
      <ConsentNotice style={styles.consent} />
    </OnboardingLayout>
  );
}

const styles = StyleSheet.create({
  option: {
    marginTop: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 2,
    paddingHorizontal: componentMetrics.listRowPaddingH,
    paddingVertical: componentMetrics.listRowPaddingV,
    minHeight: componentMetrics.listRowMinHeight,
    justifyContent: 'center',
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  flag: {
    fontSize: 28,
    marginRight: spacing.md,
  },
  optionLabel: {
    flex: 1,
  },
  hint: {
    marginTop: spacing.lg,
  },
  consent: {
    marginTop: spacing.xxxl,
  },
});
