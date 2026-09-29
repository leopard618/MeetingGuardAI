/**
 * Alert status on the dashboard: master switch and intensity (from the preferences), the next
 * scheduled alert (from the OS through the alert engine), the notification permission, Android's
 * exact-alarm setting and the Do Not Disturb override of maximum alerts. Everything links to
 * Settings > Alerts, where the full settings live.
 */
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useMemo, type ReactElement } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Button, Text, useTheme as usePaperTheme } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import { errorMessageKey, toAppError } from '../../core/errors';
import { createLogger } from '../../core/logger';
import type { Meeting, Preferences } from '../../core/types';
import { useT } from '../../i18n';
import { alertEngine, usePendingAlerts } from '../../services/alerts';
import { formatRelative } from '../../utils/format';
import { Section } from '../shared/Section';
import { useFormatters } from '../shared/useFormatters';

const log = createLogger('home.alerts');

export interface AlertStatusCardProps {
  preferences: Preferences;
  meetings: readonly Meeting[];
  /** Dashboard clock (the relative "next alert" time follows it). */
  now: Date;
  onOpenSettings(): void;
}

export function AlertStatusCard({ preferences, meetings, now, onOpenSettings }: AlertStatusCardProps): ReactElement {
  const t = useT();
  const theme = usePaperTheme();
  const fmt = useFormatters();
  const { pending, permission, isLoading, refresh } = usePendingAlerts();
  const enabled = preferences.alertEnabled;

  // Re-read the OS state whenever the dashboard is shown (e.g. back from the system settings).
  useFocusEffect(
    useCallback(() => {
      refresh().catch((error: unknown) => log.warn('could not refresh the alert status', toAppError(error).code));
    }, [refresh]),
  );

  const run = useCallback(
    (action: () => Promise<unknown>, what: string) => {
      action()
        .then(() => refresh())
        .catch((caught: unknown) => {
          const error = toAppError(caught);
          log.warn(`${what} failed`, error.code);
          Toast.show({ type: 'error', text1: t(errorMessageKey(error.code)) });
        });
    },
    [refresh, t],
  );

  const nextAlert = pending.find((item) => item.kind !== 'followup') ?? null;
  const alertCount = pending.filter((item) => item.kind !== 'followup').length;
  const nextAlertText = useMemo(() => {
    if (!nextAlert) return null;
    let when: string;
    try {
      when = `${formatRelative(nextAlert.fireAt, { ...fmt.options, now })} (${fmt.time(nextAlert.fireAt)})`;
    } catch {
      when = fmt.dateTime(nextAlert.fireAt);
    }
    const title = meetings.find((meeting) => meeting.id === nextAlert.meetingId)?.title;
    return title ? t('home:alerts.nextAlert', { time: when, title }) : t('home:alerts.nextAlertNoTitle', { time: when });
  }, [fmt, meetings, nextAlert, now, t]);

  const notifications = permission?.notifications ?? null;
  const blocked = notifications === 'denied' && permission?.canAskAgain === false;
  const canRequest = notifications !== null && notifications !== 'granted' && !blocked;
  const permissionText =
    notifications === null
      ? isLoading
        ? t('home:alerts.permission.checking')
        : null
      : t(`home:alerts.permission.${notifications}`);
  const permissionProblem = notifications !== null && notifications !== 'granted';

  return (
    <Section title={t('home:alerts.title')} testID="alert-status-card">
      <View style={styles.statusRow}>
        <MaterialCommunityIcons
          name={enabled ? 'bell-ring-outline' : 'bell-off-outline'}
          size={24}
          color={enabled ? theme.colors.primary : theme.colors.onSurfaceVariant}
          style={styles.statusIcon}
        />
        <View style={styles.flex}>
          <Text variant="titleSmall" testID="alert-status">
            {t(enabled ? 'home:alerts.on' : 'home:alerts.off')}
          </Text>
          {enabled ? (
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
              {t('home:alerts.intensity', { intensity: t(`home:alerts.intensityName.${preferences.alertIntensity}`) })}
              {alertCount > 0 ? ` · ${t('home:alerts.scheduled', { count: alertCount })}` : ''}
            </Text>
          ) : (
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
              {t('home:alerts.offHint')}
            </Text>
          )}
        </View>
      </View>

      {enabled ? (
        <Text variant="bodyMedium" style={styles.line} testID="next-alert">
          {nextAlertText ?? (isLoading ? '' : t('home:alerts.noneScheduled'))}
        </Text>
      ) : null}

      {enabled && permissionText ? (
        <View style={styles.line}>
          <Text variant="bodySmall" style={{ color: permissionProblem ? theme.colors.error : theme.colors.onSurfaceVariant }} testID="alert-permission">
            {permissionText}
          </Text>
          {canRequest ? (
            <Button
              mode="contained-tonal"
              compact
              icon="bell-ring-outline"
              style={styles.action}
              onPress={() => run(() => alertEngine.requestPermissions(), 'permission request')}
            >
              {t('home:alerts.permission.allow')}
            </Button>
          ) : null}
          {blocked ? (
            <Button mode="text" compact style={styles.action} onPress={() => run(() => alertEngine.openNotificationSettings(), 'notification settings')}>
              {t('home:alerts.permission.openSettings')}
            </Button>
          ) : null}
        </View>
      ) : null}

      {enabled && Platform.OS === 'android' && permission?.exactAlarms === 'unknown' ? (
        <View style={styles.line}>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            {t('home:alerts.exactAlarms.hint')}
          </Text>
          <Button mode="text" compact icon="alarm" style={styles.action} onPress={() => run(() => alertEngine.openExactAlarmSettings(), 'exact alarm settings')}>
            {t('home:alerts.exactAlarms.open')}
          </Button>
        </View>
      ) : null}

      {enabled && preferences.alertIntensity === 'max' ? (
        <View style={styles.line}>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            {t(Platform.OS === 'ios' ? 'home:alerts.dnd.ios' : 'home:alerts.dnd.android')}
          </Text>
          {Platform.OS === 'android' ? (
            <Button
              mode="text"
              compact
              icon="bell-alert-outline"
              style={styles.action}
              onPress={() => run(() => alertEngine.openAlarmChannelSettings(), 'alarm channel settings')}
            >
              {t('home:alerts.dnd.open')}
            </Button>
          ) : null}
        </View>
      ) : null}

      <Button mode="outlined" icon="tune" style={styles.settings} onPress={onOpenSettings} testID="alert-settings-link">
        {t('home:alerts.settings')}
      </Button>
    </Section>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusIcon: {
    marginRight: 12,
  },
  line: {
    marginTop: 10,
  },
  action: {
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  settings: {
    marginTop: 12,
    alignSelf: 'flex-start',
  },
});
