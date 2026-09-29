/** Onboarding step 1: language (switches instantly, synced to preferences) + terms consent. */
import type { ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { RadioButton, Text, TouchableRipple, useTheme as usePaperTheme } from 'react-native-paper';

import type { Language } from '../../core/types';
import { useLanguage, useT } from '../../i18n';
import { ConsentNotice } from '../../navigation/ConsentNotice';
import { OnboardingLayout, useOnboardingNavigation } from './OnboardingLayout';

const FLAGS: Readonly<Record<Language, string>> = { en: '🇬🇧', es: '🇪🇸' };

export function OnboardingLanguageScreen(): ReactElement {
  const t = useT();
  const theme = usePaperTheme();
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
                  borderColor: selected ? theme.colors.primary : theme.colors.outlineVariant,
                  backgroundColor: selected ? theme.colors.primaryContainer : theme.colors.surface,
                },
              ]}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
            >
              <View style={styles.optionRow}>
                <Text style={styles.flag}>{FLAGS[code]}</Text>
                <Text variant="titleMedium" style={styles.optionLabel}>
                  {t(`common:language.${code}`)}
                </Text>
                <RadioButton value={code} />
              </View>
            </TouchableRipple>
          );
        })}
      </RadioButton.Group>
      <Text variant="bodySmall" style={[styles.hint, { color: theme.colors.onSurfaceVariant }]}>
        {t('onboarding:language.hint')}
      </Text>
      <ConsentNotice style={styles.consent} />
    </OnboardingLayout>
  );
}

const styles = StyleSheet.create({
  option: {
    marginTop: 12,
    borderRadius: 16,
    borderWidth: 2,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  flag: {
    fontSize: 28,
    marginRight: 12,
  },
  optionLabel: {
    flex: 1,
  },
  hint: {
    marginTop: 16,
  },
  consent: {
    marginTop: 32,
  },
});
