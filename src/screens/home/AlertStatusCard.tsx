/**
 * Alert status on the dashboard: master switch and intensity (from the preferences), the next
 * scheduled alert (from the OS through the alert engine), the notification permission, Android's
 * exact-alarm setting and the Do Not Disturb override of maximum alerts. Everything links to
 * Settings > Alerts, where the full settings live.
 *
 * MG Indigo (2026-11-01 dashboard redesign): one compact pressable row card (the whole card opens
 * the alert settings; the chevron says so): a bell on the primary gradient when alerts are on
 * (a muted bell-off circle when off), the state in titleM, intensity and scheduled count under
 * it, a success / warning Badge (never color alone - the text says it too), then the next alert
 * and, only when something needs the user, the permission / exact-alarm / Do Not Disturb lines
 * with their buttons.
 */
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useMemo, type ReactElement } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import { Badge, Card, GradientSurface, Icon, MGButton, SectionHeader } from '../../components/ui';
import { errorMessageKey, toAppError } from '../../core/errors';
import { createLogger } from '../../core/logger';
import type { Meeting, Preferences } from '../../core/types';
import { useT } from '../../i18n';
import { alertEngine, usePendingAlerts } from '../../services/alerts';
import { componentMetrics, radii, spacing, useAppTheme } from '../../theme';
import { formatRelative } from '../../utils/format';
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
  const { colors, onGradient } = useAppTheme();
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
  const permissionProblem = notifications !== null && notifications !== 'granted';
  // The "allowed" line is noise on a compact card; problems (and the pending check) still show.
  const permissionText =
    notifications === null ? (isLoading ? t('home:alerts.permission.checking') : null) : permissionProblem ? t(`home:alerts.permission.${notifications}`) : null;
  const exactAlarmsProblem = Platform.OS === 'android' && (permission?.exactAlarms === 'unknown' || permission?.exactAlarms === 'denied');

  return (
    <View>
      <SectionHeader title={t('home:alerts.title')} />
      <Card onPress={onOpenSettings} accessibilityLabel={t('home:alerts.settings')} testID="alert-settings-link">
        <View style={styles.statusRow}>
          {enabled ? (
            <GradientSurface style={styles.statusCircle}>
              <Icon name="bell" size={componentMetrics.iconInline} color={onGradient.primary} />
            </GradientSurface>
          ) : (
            <View style={[styles.statusCircle, { backgroundColor: colors.surfaceVariant }]}>
              <Icon name="bellOff" size={componentMetrics.iconInline} color={colors.onSurfaceVariant} />
            </View>
          )}
          <View style={styles.flex}>
            <Text variant="titleMedium" testID="alert-status">
              {t(enabled ? 'home:alerts.on' : 'home:alerts.off')}
            </Text>
            {enabled ? (
              <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                {t('home:alerts.intensity', { intensity: t(`home:alerts.intensityName.${preferences.alertIntensity}`) })}
                {alertCount > 0 ? ` · ${t('home:alerts.scheduled', { count: alertCount })}` : ''}
              </Text>
            ) : (
              <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                {t('home:alerts.offHint')}
              </Text>
            )}
          </View>
          <Badge label={t(enabled ? 'home:alerts.badgeOn' : 'home:alerts.badgeOff')} tone={enabled ? 'success' : 'warning'} style={styles.badge} />
          <Icon name="chevronRight" size={componentMetrics.iconInline} color={colors.onSurfaceVariant} />
        </View>

        {enabled ? (
          <Text variant="bodySmall" style={[styles.line, { color: colors.onSurfaceVariant }]} testID="next-alert">
            {nextAlertText ?? (isLoading ? '' : t('home:alerts.noneScheduled'))}
          </Text>
        ) : null}

        {enabled && permissionText ? (
          <View style={styles.line}>
            <Text variant="bodySmall" style={{ color: permissionProblem ? colors.error : colors.onSurfaceVariant }} testID="alert-permission">
              {permissionText}
            </Text>
            {canRequest ? (
              <MGButton
                variant="tonal"
                size="sm"
                icon="bell-ring-outline"
                style={styles.action}
                onPress={() => run(() => alertEngine.requestPermissions(), 'permission request')}
              >
                {t('home:alerts.permission.allow')}
              </MGButton>
            ) : null}
            {blocked ? (
              <MGButton
                variant="ghost"
                size="sm"
                style={styles.action}
                onPress={() => run(() => alertEngine.openNotificationSettings(), 'notification settings')}
              >
                {t('home:alerts.permission.openSettings')}
              </MGButton>
            ) : null}
          </View>
        ) : null}

        {enabled && exactAlarmsProblem ? (
          <View style={styles.line}>
            <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
              {t('home:alerts.exactAlarms.hint')}
            </Text>
            <MGButton
              variant="ghost"
              size="sm"
              icon="alarm"
              style={styles.action}
              onPress={() => run(() => alertEngine.openExactAlarmSettings(), 'exact alarm settings')}
            >
              {t('home:alerts.exactAlarms.open')}
            </MGButton>
          </View>
        ) : null}

        {enabled && preferences.alertIntensity === 'max' ? (
          <View style={styles.line}>
            <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
              {t(Platform.OS === 'ios' ? 'home:alerts.dnd.ios' : 'home:alerts.dnd.android')}
            </Text>
            {Platform.OS === 'android' ? (
              <MGButton
                variant="ghost"
                size="sm"
                icon="bell-alert-outline"
                style={styles.action}
                onPress={() => run(() => alertEngine.openAlarmChannelSettings(), 'alarm channel settings')}
              >
                {t('home:alerts.dnd.open')}
              </MGButton>
            ) : null}
          </View>
        ) : null}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  statusCircle: {
    width: componentMetrics.avatarSize,
    height: componentMetrics.avatarSize,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  badge: {
    borderRadius: radii.full,
  },
  line: {
    marginTop: spacing.md,
  },
  action: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
  },
});
