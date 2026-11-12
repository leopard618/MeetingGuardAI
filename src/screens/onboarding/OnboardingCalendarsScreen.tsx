/**
 * Onboarding step 2: calendars (skippable).
 * - Outlook Calendar (when the provider is registered, EXPO_PUBLIC_MSAL_CLIENT_ID):
 *   outlookCalendarService.connect() (Microsoft consent + first two-way sync). Shown FIRST when
 *   the user signed in with Microsoft (section 31): that is the account they just used.
 * - Google Calendar: googleCalendarService.connect() (incremental calendar scope + first sync).
 * - Device calendars: permission, then the user picks calendars to import
 *   (Preferences.deviceCalendarImportIds). Google-account device calendars are marked and
 *   disabled while Google sync is on (they would duplicate the Google events).
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Checkbox, HelperText, Text } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import { Badge, MGButton } from '../../components/ui';
import type { DeviceCalendarInfo, PermissionState } from '../../core/contracts';
import { errorMessageKey, toAppError } from '../../core/errors';
import { createLogger } from '../../core/logger';
import { useT } from '../../i18n';
import { signedInWithMicrosoft, useAuth } from '../../services/auth';
import { calendarSyncEngine, deviceCalendarService, googleCalendarService, outlookCalendarService, useCalendarStatus } from '../../services/calendar';
import { usePreferences } from '../../services/data';
import { spacing, useAppTheme } from '../../theme';
import { OnboardingLayout, OnboardingSection, useOnboardingNavigation } from './OnboardingLayout';

const log = createLogger('onboarding');

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

export function OnboardingCalendarsScreen(): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const { goNext } = useOnboardingNavigation('OnboardingCalendars');
  const { preferences, update } = usePreferences();
  const calendarStatus = useCalendarStatus();
  const googleConnected = calendarStatus.google.connected;
  const { authUser } = useAuth();
  // The Outlook section exists only when the provider is registered; it leads when the user
  // signed in with Microsoft (the account they just used), otherwise Google leads.
  const outlookAvailable = calendarStatus.outlook !== undefined;
  const outlookConnected = calendarStatus.outlook?.connected === true;
  const microsoftFirst = outlookAvailable && signedInWithMicrosoft(authUser);

  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleMessage, setGoogleMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [outlookBusy, setOutlookBusy] = useState(false);
  const [outlookMessage, setOutlookMessage] = useState<{ text: string; isError: boolean } | null>(null);

  const [permission, setPermission] = useState<PermissionState | null>(null);
  const [calendars, setCalendars] = useState<DeviceCalendarInfo[] | null>(null);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>(() => [...preferences.deviceCalendarImportIds]);
  const [saving, setSaving] = useState(false);

  const loadCalendars = useCallback(async () => {
    try {
      setDeviceError(null);
      setCalendars(await deviceCalendarService.listCalendars());
    } catch (caught) {
      const error = toAppError(caught);
      log.warn('could not list device calendars', error.code);
      setDeviceError(t(errorMessageKey(error.code)));
    }
  }, [t]);

  useEffect(() => {
    let active = true;
    deviceCalendarService.getPermission().then(
      (state) => {
        if (!active) return;
        setPermission(state);
        if (state === 'granted') void loadCalendars();
      },
      (caught: unknown) => {
        const error = toAppError(caught);
        log.warn('could not read the calendar permission', error.code);
        if (active) setDeviceError(t(errorMessageKey(error.code)));
      },
    );
    return () => {
      active = false;
    };
  }, [loadCalendars, t]);

  const connectGoogle = async (): Promise<void> => {
    setGoogleBusy(true);
    setGoogleMessage(null);
    try {
      const result = await googleCalendarService.connect();
      if (result.status === 'connected') {
        setGoogleMessage({ text: t('onboarding:calendars.google.success'), isError: false });
      } else if (result.status === 'cancelled') {
        setGoogleMessage({ text: t('onboarding:calendars.google.cancelled'), isError: false });
      } else {
        setGoogleMessage({ text: t('onboarding:calendars.google.scopeDenied'), isError: true });
      }
    } catch (caught) {
      const error = toAppError(caught);
      if (error.code !== 'cancelled') {
        log.warn('google calendar connect failed', error.code);
        setGoogleMessage({ text: t(errorMessageKey(error.code)), isError: true });
      }
    } finally {
      setGoogleBusy(false);
    }
  };

  const connectOutlook = async (): Promise<void> => {
    setOutlookBusy(true);
    setOutlookMessage(null);
    try {
      const result = await outlookCalendarService.connect();
      if (result.status === 'connected') {
        setOutlookMessage({ text: t('onboarding:calendars.outlook.success'), isError: false });
      } else if (result.status === 'cancelled') {
        setOutlookMessage({ text: t('onboarding:calendars.outlook.cancelled'), isError: false });
      } else {
        setOutlookMessage({ text: t('onboarding:calendars.outlook.failed'), isError: true });
      }
    } catch (caught) {
      const error = toAppError(caught);
      if (error.code !== 'cancelled') {
        log.warn('outlook calendar connect failed', error.code);
        setOutlookMessage({ text: t(errorMessageKey(error.code)), isError: true });
      }
    } finally {
      setOutlookBusy(false);
    }
  };

  const requestDeviceAccess = async (): Promise<void> => {
    try {
      const state = await deviceCalendarService.requestPermission();
      setPermission(state);
      if (state === 'granted') await loadCalendars();
    } catch (caught) {
      const error = toAppError(caught);
      log.warn('calendar permission request failed', error.code);
      setDeviceError(t(errorMessageKey(error.code)));
    }
  };

  const toggleCalendar = (id: string): void => {
    setSelectedIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));
  };

  const saveAndContinue = async (): Promise<void> => {
    if (sameIds(selectedIds, preferences.deviceCalendarImportIds)) {
      goNext();
      return;
    }
    setSaving(true);
    try {
      await update({ deviceCalendarImportIds: selectedIds });
      calendarSyncEngine.syncNow({ reason: 'preferences' }).catch((caught: unknown) => {
        log.warn('calendar import after onboarding selection failed', toAppError(caught).code);
      });
      goNext();
    } catch (caught) {
      const error = toAppError(caught);
      log.error('could not save the calendar selection', error);
      Toast.show({ type: 'error', text1: t(errorMessageKey(error.code)) });
    } finally {
      setSaving(false);
    }
  };

  const outlookSection = (
    <View testID="onboarding-outlook-section">
      <OnboardingSection title={t('onboarding:calendars.outlook.title')}>
        <Text variant="bodyMedium">{t('onboarding:calendars.outlook.description')}</Text>
        {microsoftFirst && !outlookConnected ? (
          <Text variant="bodySmall" style={[styles.hint, { color: colors.onSurfaceVariant }]} testID="onboarding-outlook-hint">
            {t('onboarding:calendars.outlook.microsoftHint')}
          </Text>
        ) : null}
        {outlookConnected ? (
          <Badge tone="success" label={t('onboarding:calendars.outlook.connected')} style={styles.status} />
        ) : (
          <MGButton
            variant="tonal"
            icon="microsoft"
            style={styles.action}
            loading={outlookBusy}
            disabled={outlookBusy}
            onPress={() => {
              void connectOutlook();
            }}
            testID="onboarding-outlook-connect"
          >
            {t('onboarding:calendars.outlook.connect')}
          </MGButton>
        )}
        {outlookMessage ? (
          <HelperText type={outlookMessage.isError ? 'error' : 'info'} visible testID="onboarding-outlook-message">
            {outlookMessage.text}
          </HelperText>
        ) : null}
      </OnboardingSection>
    </View>
  );

  return (
    <OnboardingLayout
      step="OnboardingCalendars"
      title={t('onboarding:calendars.title')}
      subtitle={t('onboarding:calendars.subtitle')}
      primaryLabel={t('common:actions.continue')}
      onPrimary={() => {
        void saveAndContinue();
      }}
      primaryLoading={saving}
      secondaryLabel={t('common:actions.skipForNow')}
      onSecondary={goNext}
    >
      {microsoftFirst ? outlookSection : null}

      <OnboardingSection title={t('onboarding:calendars.google.title')}>
        <Text variant="bodyMedium">{t('onboarding:calendars.google.description')}</Text>
        {googleConnected ? (
          <Badge tone="success" label={t('onboarding:calendars.google.connected')} style={styles.status} />
        ) : (
          <MGButton
            variant="tonal"
            icon="google"
            style={styles.action}
            loading={googleBusy}
            disabled={googleBusy}
            onPress={() => {
              void connectGoogle();
            }}
          >
            {t('onboarding:calendars.google.connect')}
          </MGButton>
        )}
        {googleMessage ? (
          <HelperText type={googleMessage.isError ? 'error' : 'info'} visible>
            {googleMessage.text}
          </HelperText>
        ) : null}
      </OnboardingSection>

      {outlookAvailable && !microsoftFirst ? outlookSection : null}

      <OnboardingSection title={t('onboarding:calendars.device.title')}>
        <Text variant="bodyMedium">{t('onboarding:calendars.device.description')}</Text>
        {permission === null && deviceError === null ? <ActivityIndicator style={styles.action} /> : null}
        {permission === 'undetermined' ? (
          <MGButton
            variant="tonal"
            icon="calendar"
            style={styles.action}
            onPress={() => {
              void requestDeviceAccess();
            }}
          >
            {t('onboarding:calendars.device.allow')}
          </MGButton>
        ) : null}
        {permission === 'denied' ? (
          <View>
            <HelperText type="info" visible>
              {t('onboarding:calendars.device.denied')}
            </HelperText>
            <MGButton
              variant="ghost"
              style={styles.action}
              onPress={() => {
                Linking.openSettings().catch((caught: unknown) => {
                  log.warn('could not open the system settings', toAppError(caught).code);
                });
              }}
            >
              {t('common:actions.openSettings')}
            </MGButton>
          </View>
        ) : null}
        {permission === 'granted' && calendars !== null && calendars.length === 0 ? (
          <HelperText type="info" visible>
            {t('onboarding:calendars.device.empty')}
          </HelperText>
        ) : null}
        {permission === 'granted' && calendars !== null
          ? calendars.map((calendar) => {
              const blocked = calendar.isGoogleAccount && googleConnected;
              return (
                <View key={calendar.id}>
                  <Checkbox.Item
                    label={calendar.sourceName ? `${calendar.title} · ${calendar.sourceName}` : calendar.title}
                    status={selectedIds.includes(calendar.id) && !blocked ? 'checked' : 'unchecked'}
                    disabled={blocked}
                    onPress={() => toggleCalendar(calendar.id)}
                    color={calendar.color ?? undefined}
                    position="leading"
                    labelStyle={styles.calendarLabel}
                    style={styles.calendarItem}
                  />
                  {blocked ? (
                    <Text variant="bodySmall" style={[styles.note, { color: colors.onSurfaceVariant }]}>
                      {t('onboarding:calendars.device.googleNote')}
                    </Text>
                  ) : null}
                </View>
              );
            })
          : null}
        {deviceError ? (
          <HelperText type="error" visible>
            {deviceError}
          </HelperText>
        ) : null}
      </OnboardingSection>

      <Text variant="bodySmall" style={[styles.later, { color: colors.onSurfaceVariant }]}>
        {t('onboarding:calendars.later')}
      </Text>
    </OnboardingLayout>
  );
}

const styles = StyleSheet.create({
  hint: {
    marginTop: spacing.xs,
  },
  action: {
    marginTop: spacing.md,
    alignSelf: 'flex-start',
  },
  status: {
    marginTop: spacing.md,
  },
  calendarItem: {
    paddingHorizontal: 0,
  },
  calendarLabel: {
    textAlign: 'left',
  },
  note: {
    marginLeft: spacing.huge + spacing.sm,
    marginBottom: spacing.xs,
  },
  later: {
    marginTop: spacing.lg,
  },
});
