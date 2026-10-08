/**
 * Onboarding step 5: guided first meeting. The choice is queued as a navigation intent
 * (CreateMeeting, or AIChat with an example prompt), then Preferences.onboardingCompleted is set;
 * the gate switches to the Main group and the queued intent opens on top of the Dashboard.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRef, useState, type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import { Card } from '../../components/ui';
import { errorMessageKey, toAppError } from '../../core/errors';
import { createLogger } from '../../core/logger';
import { useT } from '../../i18n';
import { clearPendingNavigation, navigate, type NavigationIntent } from '../../navigation/navigationService';
import { useAuth } from '../../services/auth';
import { usePreferences } from '../../services/data';
import { componentMetrics, radii, spacing, useAppTheme } from '../../theme';
import { OnboardingLayout } from './OnboardingLayout';
import { clearOnboardingStep } from './progress';

const log = createLogger('onboarding');

type Choice = 'manual' | 'ai' | 'skip';

export function OnboardingFirstMeetingScreen(): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const { update } = usePreferences();
  const { authUser } = useAuth();
  const [busy, setBusy] = useState<Choice | null>(null);
  const finishing = useRef(false);

  const finish = async (choice: Choice): Promise<void> => {
    if (finishing.current) return;
    finishing.current = true;
    setBusy(choice);
    const intent: NavigationIntent | null =
      choice === 'manual'
        ? { name: 'CreateMeeting' }
        : choice === 'ai'
          ? { name: 'AIChat', params: { prefill: t('onboarding:firstMeeting.aiPrompt') } }
          : null;
    if (intent !== null) navigate(intent.name, intent.params as never);
    try {
      await update({ onboardingCompleted: true });
      if (authUser) {
        clearOnboardingStep(authUser.uid).catch((caught: unknown) => {
          log.warn('could not clear the onboarding progress', toAppError(caught).code);
        });
      }
      // The gate now switches to the Main group; this screen unmounts.
    } catch (caught) {
      const error = toAppError(caught);
      log.error('could not complete onboarding', error);
      clearPendingNavigation();
      finishing.current = false;
      setBusy(null);
      Toast.show({ type: 'error', text1: t(errorMessageKey(error.code)) });
    }
  };

  const options: { choice: Exclude<Choice, 'skip'>; icon: 'form-select' | 'robot-happy-outline' }[] = [
    { choice: 'manual', icon: 'form-select' },
    { choice: 'ai', icon: 'robot-happy-outline' },
  ];

  return (
    <OnboardingLayout
      step="OnboardingFirstMeeting"
      title={t('onboarding:firstMeeting.title')}
      subtitle={t('onboarding:firstMeeting.subtitle')}
      primaryLabel={busy !== null ? t('onboarding:firstMeeting.finishing') : t('onboarding:firstMeeting.skip')}
      onPrimary={() => {
        void finish('skip');
      }}
      primaryLoading={busy === 'skip'}
      primaryDisabled={busy !== null}
    >
      {options.map(({ choice, icon }) => (
        <Card
          key={choice}
          disabled={busy !== null}
          onPress={() => {
            void finish(choice);
          }}
          style={styles.card}
          accessibilityRole="button"
        >
          <View style={styles.cardRow}>
            <View style={[styles.iconWrap, { backgroundColor: colors.primaryContainer }]}>
              <MaterialCommunityIcons name={icon} size={24} color={colors.onPrimaryContainer} />
            </View>
            <View style={styles.cardText}>
              <Text variant="titleMedium">{t(`onboarding:firstMeeting.${choice}.title`)}</Text>
              <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
                {t(`onboarding:firstMeeting.${choice}.description`)}
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={componentMetrics.iconNav} color={colors.onSurfaceVariant} />
          </View>
        </Card>
      ))}
    </OnboardingLayout>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.lg,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconWrap: {
    width: componentMetrics.avatarSize,
    height: componentMetrics.avatarSize,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.lg,
  },
  cardText: {
    flex: 1,
  },
});
