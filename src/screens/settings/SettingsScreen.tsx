/**
 * Settings / Profile (routes "Settings" and "Profile").
 * - Account: who is signed in, and "Delete account" (confirmation + identity check + the
 *   deleteAccount callable; required in-app by the App Store and Google Play).
 * - Alerts: summary + Settings > Alerts (every alert preference after onboarding).
 * - Appearance (theme), language (instant EN/ES), time format (12 h / 24 h / automatic, used for
 *   every time the app shows), calendars, legal pages, version (and the OTA update id / channel
 *   when an EAS update is running, for support and rollback checks).
 * Every string comes from the "settings" namespace (plus shared auth / onboarding keys).
 */
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import Constants from 'expo-constants';
import type { ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { Divider, List, SegmentedButtons, Text, useTheme as usePaperTheme } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import { THEME_MODES, useTheme, type ThemeMode } from '../../contexts/ThemeContext';
import type { RootStackParamList } from '../../core/contracts';
import { errorMessageKey, toAppError } from '../../core/errors';
import { createLogger } from '../../core/logger';
import type { Language } from '../../core/types';
import { useLanguage, useT } from '../../i18n';
import { useAuth } from '../../services/auth';
import { usePreferences } from '../../services/data';
import { getUpdateInfo, shortUpdateLabel } from '../../services/updates';
import { alertTimeLabel } from '../onboarding/alertOptions';
import { ScreenBody, Section } from '../shared/Section';
import { useFormatters } from '../shared/useFormatters';
import { CLOCK_OPTIONS, clockOptionOf, is24HourFromOption, isClockOption } from './timeFormat';
import { useDeleteAccountFlow } from './useDeleteAccountFlow';

const log = createLogger('settings');

const APP_VERSION = Constants.expoConfig?.version ?? '';
// Fixed for the lifetime of the JS runtime (a new update only runs after a restart).
const UPDATE_LABEL = shortUpdateLabel(getUpdateInfo());
// Example time shown under the time-format choice: 15:30, formatted in UTC so it reads 15:30
// whatever the device zone.
const SAMPLE_TIME = new Date(Date.UTC(2026, 0, 5, 15, 30));

export function SettingsScreen(): ReactElement {
  const t = useT();
  const theme = usePaperTheme();
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const { authUser } = useAuth();
  const { preferences, update } = usePreferences();
  const fmt = useFormatters();
  const { language, setLanguage, supportedLanguages } = useLanguage();
  const { themeMode, setThemeMode } = useTheme();
  const deletion = useDeleteAccountFlow();

  const alertSummary = preferences.alertEnabled
    ? t('settings:alerts.summaryOn', {
        intensity: t(`onboarding:alerts.intensity.${preferences.alertIntensity}.title`),
        times: preferences.defaultAlertTimes
          .map((minutes) => {
            const label = alertTimeLabel(minutes);
            return t(label.key, label.options);
          })
          .join(', '),
      })
    : t('settings:alerts.summaryOff');

  const setClock = (value: string): void => {
    if (!isClockOption(value)) return;
    const next = is24HourFromOption(value);
    if (next === preferences.use24HourClock) return;
    update({ use24HourClock: next }).catch((caught: unknown) => {
      const error = toAppError(caught);
      log.warn('could not save the time format', error.code);
      Toast.show({ type: 'error', text1: t(errorMessageKey(error.code)) });
    });
  };

  return (
    <ScreenBody>
      <Section title={t('settings:account.title')} testID="settings-account">
        {authUser?.displayName ? <Text variant="titleSmall">{authUser.displayName}</Text> : null}
        <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
          {authUser?.email ? t('settings:account.signedInAs', { email: authUser.email }) : t('settings:account.signedIn')}
        </Text>
        <Divider style={styles.divider} />
        <List.Item
          title={t('auth:deleteAccount.title')}
          description={t('settings:account.deleteDescription')}
          titleStyle={{ color: theme.colors.error }}
          left={(props) => <List.Icon {...props} icon="account-remove-outline" color={theme.colors.error} />}
          onPress={deletion.start}
          disabled={deletion.busy}
          accessibilityRole="button"
          testID="settings-delete-account"
        />
      </Section>

      <Section title={t('settings:alerts.title')}>
        <List.Item
          title={t('settings:alerts.open')}
          description={alertSummary}
          left={(props) => <List.Icon {...props} icon="bell-ring-outline" />}
          right={(props) => <List.Icon {...props} icon="chevron-right" />}
          onPress={() => navigation.navigate('AlertSettings')}
          accessibilityRole="button"
          testID="settings-alerts"
        />
      </Section>

      <Section title={t('settings:appearance.title')}>
        <SegmentedButtons
          value={themeMode}
          onValueChange={(value) => setThemeMode(value as ThemeMode)}
          buttons={THEME_MODES.map((mode) => ({ value: mode, label: t(`settings:appearance.${mode}`) }))}
        />
      </Section>

      <Section title={t('settings:language.title')}>
        <SegmentedButtons
          value={language}
          onValueChange={(value) => {
            void setLanguage(value as Language);
          }}
          buttons={supportedLanguages.map((code) => ({ value: code, label: t(`common:language.${code}`) }))}
        />
      </Section>

      <Section title={t('settings:timeFormat.title')} testID="settings-time-format">
        <SegmentedButtons
          value={clockOptionOf(preferences.use24HourClock)}
          onValueChange={setClock}
          buttons={CLOCK_OPTIONS.map((option) => ({
            value: option,
            label: t(`settings:timeFormat.${option}`),
            testID: `settings-time-format-${option}`,
          }))}
        />
        <Text variant="bodySmall" style={[styles.hint, { color: theme.colors.onSurfaceVariant }]}>
          {t('settings:timeFormat.hint', { example: fmt.time(SAMPLE_TIME, 'UTC') })}
        </Text>
      </Section>

      <Section title={t('settings:calendar.title')}>
        <List.Item
          title={t('settings:calendar.sync')}
          description={t('settings:calendar.syncDescription')}
          left={(props) => <List.Icon {...props} icon="calendar-sync-outline" />}
          right={(props) => <List.Icon {...props} icon="chevron-right" />}
          onPress={() => navigation.navigate('CalendarSync')}
          accessibilityRole="button"
        />
      </Section>

      <Section title={t('settings:legal.title')}>
        <List.Item
          title={t('settings:legal.privacy')}
          left={(props) => <List.Icon {...props} icon="shield-outline" />}
          right={(props) => <List.Icon {...props} icon="chevron-right" />}
          onPress={() => navigation.navigate('Privacy')}
          accessibilityRole="button"
        />
        <List.Item
          title={t('settings:legal.terms')}
          left={(props) => <List.Icon {...props} icon="file-document-outline" />}
          right={(props) => <List.Icon {...props} icon="chevron-right" />}
          onPress={() => navigation.navigate('Terms')}
          accessibilityRole="button"
        />
      </Section>

      <View style={styles.about}>
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
          {t('settings:about.version', { version: APP_VERSION })}
        </Text>
        {UPDATE_LABEL ? (
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }} testID="settings-update-label">
            {t('settings:about.update', UPDATE_LABEL)}
          </Text>
        ) : null}
      </View>
      {deletion.element}
    </ScreenBody>
  );
}

const styles = StyleSheet.create({
  divider: {
    marginVertical: 8,
  },
  hint: {
    marginTop: 8,
  },
  about: {
    alignItems: 'center',
    marginBottom: 16,
  },
});
