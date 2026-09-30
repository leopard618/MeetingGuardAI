/**
 * Settings / Profile (routes "Settings" and "Profile").
 * - Account: who is signed in, and "Delete account" (confirmation + identity check + the
 *   deleteAccount callable; required in-app by the App Store and Google Play).
 * - Alerts: summary + Settings > Alerts (every alert preference after onboarding).
 * - Appearance (theme), language (instant EN/ES), time format (12 h / 24 h / automatic, used for
 *   every time the app shows), calendars, legal pages, version (and the OTA update id / channel
 *   when an EAS update is running, for support and rollback checks).
 * Every string comes from the "settings" namespace (plus shared auth / onboarding keys).
 * Layout: sentence-case SectionHeaders over ListGroups (rows) and Cards (segmented choices).
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import Constants from 'expo-constants';
import type { ReactElement } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { SegmentedButtons, Text } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import { Card, ListGroup, ListRow, SectionHeader } from '../../components/ui';
import { THEME_MODES, useTheme, type ThemeMode } from '../../contexts/ThemeContext';
import type { RootStackParamList } from '../../core/contracts';
import { errorMessageKey, toAppError } from '../../core/errors';
import { createLogger } from '../../core/logger';
import type { Language } from '../../core/types';
import { useLanguage, useT } from '../../i18n';
import { useAuth } from '../../services/auth';
import { usePreferences } from '../../services/data';
import { getUpdateInfo, shortUpdateLabel } from '../../services/updates';
import { componentMetrics, pressedOpacity, spacing, stateAlpha, typography, useAppTheme, withAlpha } from '../../theme';
import { alertTimeLabel } from '../onboarding/alertOptions';
import { ScreenBody } from '../shared/Section';
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

/** Destructive settings row (red title, error ripple; never opacity on the whole row). */
function DestructiveRow({
  title,
  supporting,
  onPress,
  disabled,
  testID,
}: {
  title: string;
  supporting: string;
  onPress: () => void;
  disabled: boolean;
  testID: string;
}): ReactElement {
  const { colors } = useAppTheme();
  const titleColor = disabled ? colors.disabledText : colors.error;
  const supportingColor = disabled ? colors.disabledText : colors.onSurfaceVariant;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      android_ripple={{ color: withAlpha(colors.error, stateAlpha.rippleOnRow) }}
      style={({ pressed }) => [styles.destructiveRow, pressed && Platform.OS !== 'android' && styles.pressed]}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || undefined }}
      testID={testID}
    >
      <MaterialCommunityIcons name="account-remove-outline" size={componentMetrics.iconNav} color={titleColor} />
      <View style={styles.destructiveTexts}>
        <Text style={[styles.destructiveTitle, { color: titleColor }]}>{title}</Text>
        <Text style={[styles.destructiveSupporting, { color: supportingColor }]}>{supporting}</Text>
      </View>
    </Pressable>
  );
}

export function SettingsScreen(): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
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

  const accountEmailLine = authUser?.email ? t('settings:account.signedInAs', { email: authUser.email }) : t('settings:account.signedIn');

  return (
    <ScreenBody>
      <SectionHeader title={t('settings:account.title')} style={styles.firstHeader} />
      <ListGroup testID="settings-account">
        <ListRow
          icon="account-circle-outline"
          title={authUser?.displayName ?? accountEmailLine}
          supporting={authUser?.displayName ? accountEmailLine : undefined}
        />
        <DestructiveRow
          title={t('auth:deleteAccount.title')}
          supporting={t('settings:account.deleteDescription')}
          onPress={deletion.start}
          disabled={deletion.busy}
          testID="settings-delete-account"
        />
      </ListGroup>

      <SectionHeader title={t('settings:alerts.title')} />
      <ListGroup>
        <ListRow
          icon="bell-ring-outline"
          title={t('settings:alerts.open')}
          supporting={alertSummary}
          trailing="chevron"
          onPress={() => navigation.navigate('AlertSettings')}
          accessibilityRole="button"
          testID="settings-alerts"
        />
      </ListGroup>

      <SectionHeader title={t('settings:appearance.title')} />
      <Card>
        <SegmentedButtons
          value={themeMode}
          onValueChange={(value) => setThemeMode(value as ThemeMode)}
          buttons={THEME_MODES.map((mode) => ({ value: mode, label: t(`settings:appearance.${mode}`) }))}
        />
      </Card>

      <SectionHeader title={t('settings:language.title')} />
      <Card>
        <SegmentedButtons
          value={language}
          onValueChange={(value) => {
            void setLanguage(value as Language);
          }}
          buttons={supportedLanguages.map((code) => ({ value: code, label: t(`common:language.${code}`) }))}
        />
      </Card>

      <SectionHeader title={t('settings:timeFormat.title')} />
      <Card testID="settings-time-format">
        <SegmentedButtons
          value={clockOptionOf(preferences.use24HourClock)}
          onValueChange={setClock}
          buttons={CLOCK_OPTIONS.map((option) => ({
            value: option,
            label: t(`settings:timeFormat.${option}`),
            testID: `settings-time-format-${option}`,
          }))}
        />
        <Text variant="bodySmall" style={[styles.hint, { color: colors.onSurfaceVariant }]}>
          {t('settings:timeFormat.hint', { example: fmt.time(SAMPLE_TIME, 'UTC') })}
        </Text>
      </Card>

      <SectionHeader title={t('settings:calendar.title')} />
      <ListGroup>
        <ListRow
          icon="calendar-sync-outline"
          title={t('settings:calendar.sync')}
          supporting={t('settings:calendar.syncDescription')}
          trailing="chevron"
          onPress={() => navigation.navigate('CalendarSync')}
          accessibilityRole="button"
        />
      </ListGroup>

      <SectionHeader title={t('settings:legal.title')} />
      <ListGroup>
        <ListRow
          icon="shield-outline"
          title={t('settings:legal.privacy')}
          trailing="chevron"
          onPress={() => navigation.navigate('Privacy')}
          accessibilityRole="button"
        />
        <ListRow
          icon="file-document-outline"
          title={t('settings:legal.terms')}
          trailing="chevron"
          onPress={() => navigation.navigate('Terms')}
          accessibilityRole="button"
        />
      </ListGroup>

      <View style={styles.about}>
        <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
          {t('settings:about.version', { version: APP_VERSION })}
        </Text>
        {UPDATE_LABEL ? (
          <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }} testID="settings-update-label">
            {t('settings:about.update', UPDATE_LABEL)}
          </Text>
        ) : null}
      </View>
      {deletion.element}
    </ScreenBody>
  );
}

const styles = StyleSheet.create({
  firstHeader: {
    marginTop: spacing.xs,
  },
  hint: {
    marginTop: spacing.sm,
  },
  about: {
    alignItems: 'center',
    marginTop: spacing.xxl,
    marginBottom: spacing.lg,
  },
  destructiveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: componentMetrics.listRowTwoLineMinHeight,
    paddingHorizontal: componentMetrics.listRowPaddingH,
    paddingVertical: componentMetrics.listRowPaddingV,
    gap: spacing.lg,
  },
  destructiveTexts: {
    flex: 1,
  },
  destructiveTitle: {
    ...typography.titleM,
  },
  destructiveSupporting: {
    ...typography.bodyM,
  },
  pressed: {
    opacity: pressedOpacity,
  },
});
