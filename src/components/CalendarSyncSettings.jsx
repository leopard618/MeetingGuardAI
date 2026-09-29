/**
 * Calendar sync settings (owner: calendar). Shows the REAL state of Google Calendar sync and of the
 * device calendars (src/services/calendar), and every action reports its real result.
 */
import { MaterialIcons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { useTheme } from '../contexts/ThemeContext.jsx';
import { errorMessageKey, toAppError } from '../core/errors';
import { createLogger } from '../core/logger';
import { useT } from '../i18n';
import {
  calendarSyncEngine,
  deviceCalendarService,
  googleCalendarService,
  useCalendarStatus,
} from '../services/calendar';
import { usePreferences } from '../services/data';
import { formatRelative } from '../utils/format';

const log = createLogger('calendar');

function palette(isDarkMode) {
  return {
    background: isDarkMode ? '#0f172a' : '#f8fafc',
    card: isDarkMode ? '#1e293b' : '#ffffff',
    border: isDarkMode ? '#334155' : '#e2e8f0',
    text: isDarkMode ? '#f1f5f9' : '#1e293b',
    muted: isDarkMode ? '#94a3b8' : '#64748b',
    accent: isDarkMode ? '#60a5fa' : '#2563eb',
    success: isDarkMode ? '#34d399' : '#059669',
    warning: isDarkMode ? '#fbbf24' : '#b45309',
    danger: isDarkMode ? '#f87171' : '#dc2626',
    buttonText: '#ffffff',
  };
}

function errorText(t, code) {
  return t(errorMessageKey(code));
}

function SyncLine({ provider, colors, t }) {
  if (provider.syncing) {
    return (
      <View style={styles.inlineRow}>
        <ActivityIndicator size="small" color={colors.accent} />
        <Text style={[styles.meta, styles.inlineText, { color: colors.muted }]}>{t('calendar:status.syncing')}</Text>
      </View>
    );
  }
  return (
    <View>
      <Text style={[styles.meta, { color: colors.muted }]}>
        {provider.lastSyncAt
          ? t('calendar:status.lastSynced', { time: formatRelative(provider.lastSyncAt) })
          : t('calendar:status.neverSynced')}
      </Text>
      {provider.lastError ? (
        <Text style={[styles.meta, { color: colors.danger }]}>{errorText(t, provider.lastError)}</Text>
      ) : null}
    </View>
  );
}

function PrimaryButton({ label, onPress, disabled, busy, colors, icon }) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, { backgroundColor: disabled ? colors.muted : colors.accent }]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={colors.buttonText} />
      ) : icon ? (
        <MaterialIcons name={icon} size={18} color={colors.buttonText} />
      ) : null}
      <Text style={[styles.buttonText, { color: colors.buttonText }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function GoogleSection({ status, busy, onConnect, onDisconnect, colors, t }) {
  const google = status.google;
  let stateLabel = t('calendar:google.state.notConnected');
  let stateColor = colors.muted;
  if (google.connected) {
    stateLabel = t('calendar:google.state.connected');
    stateColor = colors.success;
  } else if (google.enabled) {
    stateLabel = t('calendar:google.state.permissionNeeded');
    stateColor = colors.warning;
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.cardHeader}>
        <MaterialIcons name="event" size={24} color={colors.accent} />
        <Text style={[styles.cardTitle, { color: colors.text }]} accessibilityRole="header">
          {t('calendar:google.title')}
        </Text>
        <Text style={[styles.pill, { color: stateColor, borderColor: stateColor }]}>{stateLabel}</Text>
      </View>
      <Text style={[styles.body, { color: colors.muted }]}>{t('calendar:google.description')}</Text>

      {google.enabled ? (
        <View style={[styles.row, { borderColor: colors.border }]}>
          <Text style={[styles.rowLabel, { color: colors.text }]}>{t('calendar:google.twoWaySync')}</Text>
          <Switch
            value
            disabled={busy !== null}
            onValueChange={(value) => {
              if (!value) onDisconnect();
            }}
            accessibilityLabel={t('calendar:google.twoWaySync')}
          />
        </View>
      ) : null}

      {google.enabled && !google.hasScope ? (
        <>
          <Text style={[styles.body, { color: colors.warning }]}>{t('calendar:google.permissionNeededHint')}</Text>
          <PrimaryButton
            label={busy === 'connect' ? t('calendar:google.connecting') : t('calendar:google.grantAccess')}
            onPress={onConnect}
            disabled={busy !== null}
            busy={busy === 'connect'}
            colors={colors}
            icon="lock-open"
          />
        </>
      ) : null}

      {!google.enabled ? (
        <PrimaryButton
          label={busy === 'connect' ? t('calendar:google.connecting') : t('calendar:google.connect')}
          onPress={onConnect}
          disabled={busy !== null}
          busy={busy === 'connect'}
          colors={colors}
          icon="link"
        />
      ) : null}

      {busy === 'disconnect' ? (
        <View style={styles.inlineRow}>
          <ActivityIndicator size="small" color={colors.accent} />
          <Text style={[styles.meta, styles.inlineText, { color: colors.muted }]}>{t('calendar:google.disconnecting')}</Text>
        </View>
      ) : google.enabled ? (
        <SyncLine provider={google} colors={colors} t={t} />
      ) : null}
    </View>
  );
}

function CalendarRow({ calendar, colors, children, subtitle }) {
  return (
    <View style={[styles.row, { borderColor: colors.border }]}>
      <View style={[styles.dot, { backgroundColor: calendar.color ?? colors.muted }]} />
      <View style={styles.rowTextBlock}>
        <Text style={[styles.rowLabel, { color: colors.text }]} numberOfLines={1}>
          {calendar.title}
        </Text>
        {subtitle ? (
          <Text style={[styles.meta, { color: colors.muted }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function RadioRow({ selected, label, onPress, colors, color }) {
  return (
    <TouchableOpacity
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={[styles.row, { borderColor: colors.border }]}
    >
      {color !== undefined ? <View style={[styles.dot, { backgroundColor: color ?? colors.muted }]} /> : null}
      <Text style={[styles.rowLabel, styles.rowTextBlock, { color: colors.text }]} numberOfLines={1}>
        {label}
      </Text>
      <MaterialIcons
        name={selected ? 'radio-button-checked' : 'radio-button-unchecked'}
        size={22}
        color={selected ? colors.accent : colors.muted}
      />
    </TouchableOpacity>
  );
}

/** Device calendars view state; never throws (failures become phase 'error'). */
async function loadDeviceCalendars() {
  try {
    const permission = await deviceCalendarService.getPermission();
    if (permission !== 'granted') return { phase: 'no_permission', calendars: [], error: null };
    const calendars = await deviceCalendarService.listCalendars();
    return { phase: 'ready', calendars, error: null };
  } catch (error) {
    const appError = toAppError(error);
    log.warn('Could not list device calendars', { code: appError.code });
    return { phase: 'error', calendars: [], error: appError.code };
  }
}

function DeviceSection({ status, preferences, onUpdatePreferences, colors, t, showError }) {
  const permission = status.device.permission;
  const [state, setState] = useState({ phase: 'loading', calendars: [], error: null });
  const [reloadToken, setReloadToken] = useState(0);

  // Reload when the permission changes (granted here or in the system settings) or on retry.
  useEffect(() => {
    let active = true;
    loadDeviceCalendars().then((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
    };
  }, [permission, reloadToken]);

  const requestPermission = async () => {
    try {
      const result = await deviceCalendarService.requestPermission();
      if (result !== 'granted') {
        Alert.alert(t('calendar:device.title'), t('calendar:device.permission.denied'), [
          { text: t('calendar:actions.cancel'), style: 'cancel' },
          { text: t('calendar:device.permission.openSettings'), onPress: () => void Linking.openSettings() },
        ]);
      }
    } catch (error) {
      showError(error);
    }
  };

  const retry = () => {
    setState({ phase: 'loading', calendars: [], error: null });
    setReloadToken((token) => token + 1);
  };

  const importIds = preferences.deviceCalendarImportIds;
  const exportId = preferences.deviceCalendarExportId;
  const googleSyncOn = preferences.googleCalendarSyncEnabled;

  const toggleImport = (calendarId, enabled) => {
    const next = enabled ? [...new Set([...importIds, calendarId])] : importIds.filter((id) => id !== calendarId);
    void onUpdatePreferences({ deviceCalendarImportIds: next });
  };

  const writable = state.calendars.filter((calendar) => calendar.allowsModifications);
  const exportIsOnThisDevice = exportId !== null && state.calendars.some((calendar) => calendar.id === exportId);

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.cardHeader}>
        <MaterialIcons name="phone-iphone" size={24} color={colors.accent} />
        <Text style={[styles.cardTitle, { color: colors.text }]} accessibilityRole="header">
          {t('calendar:device.title')}
        </Text>
      </View>
      <Text style={[styles.body, { color: colors.muted }]}>{t('calendar:device.description')}</Text>

      {state.phase === 'loading' ? (
        <View style={styles.inlineRow}>
          <ActivityIndicator size="small" color={colors.accent} />
          <Text style={[styles.meta, styles.inlineText, { color: colors.muted }]}>{t('calendar:device.loading')}</Text>
        </View>
      ) : null}

      {state.phase === 'no_permission' ? (
        <PrimaryButton
          label={t('calendar:device.permission.request')}
          onPress={requestPermission}
          colors={colors}
          icon="event-available"
        />
      ) : null}

      {state.phase === 'error' ? (
        <>
          <Text style={[styles.body, { color: colors.danger }]}>{errorText(t, state.error)}</Text>
          <PrimaryButton label={t('calendar:device.retry')} onPress={retry} colors={colors} icon="refresh" />
        </>
      ) : null}

      {state.phase === 'ready' && state.calendars.length === 0 ? (
        <Text style={[styles.body, { color: colors.muted }]}>{t('calendar:device.empty')}</Text>
      ) : null}

      {state.phase === 'ready' && state.calendars.length > 0 ? (
        <>
          <Text style={[styles.sectionLabel, { color: colors.text }]}>{t('calendar:device.import.title')}</Text>
          {state.calendars.map((calendar) => {
            const coveredByGoogle = googleSyncOn && calendar.isGoogleAccount;
            return (
              <CalendarRow
                key={calendar.id}
                calendar={calendar}
                colors={colors}
                subtitle={coveredByGoogle ? t('calendar:device.import.googleSynced') : calendar.sourceName}
              >
                <Switch
                  value={!coveredByGoogle && importIds.includes(calendar.id)}
                  disabled={coveredByGoogle}
                  onValueChange={(value) => toggleImport(calendar.id, value)}
                  accessibilityLabel={calendar.title}
                />
              </CalendarRow>
            );
          })}

          {writable.length > 0 ? (
            <>
              <Text style={[styles.sectionLabel, { color: colors.text }]}>{t('calendar:device.export.title')}</Text>
              <RadioRow
                selected={!exportIsOnThisDevice}
                label={t('calendar:device.export.none')}
                onPress={() => void onUpdatePreferences({ deviceCalendarExportId: null })}
                colors={colors}
              />
              {writable.map((calendar) => (
                <RadioRow
                  key={calendar.id}
                  selected={exportId === calendar.id}
                  label={calendar.title}
                  color={calendar.color}
                  onPress={() => void onUpdatePreferences({ deviceCalendarExportId: calendar.id })}
                  colors={colors}
                />
              ))}
              <Text style={[styles.meta, { color: colors.muted }]}>{t('calendar:device.export.hint')}</Text>
            </>
          ) : null}
          {status.device.enabled ? <SyncLine provider={status.device} colors={colors} t={t} /> : null}
        </>
      ) : null}
    </View>
  );
}

export default function CalendarSyncSettings() {
  const t = useT();
  const { isDarkMode } = useTheme();
  const colors = palette(isDarkMode);
  const status = useCalendarStatus();
  const { preferences, isLoaded, update } = usePreferences();
  const [busy, setBusy] = useState(null);

  // Re-read the Google state (sync switch + Calendar permission) into the shared status.
  useEffect(() => {
    googleCalendarService.isConnected().catch((error) =>
      log.warn('Could not read the Google Calendar state', { code: toAppError(error).code }),
    );
  }, []);

  const showError = useCallback(
    (error) => {
      const appError = toAppError(error);
      if (appError.code === 'cancelled') return;
      Alert.alert(t('calendar:errorTitle'), errorText(t, appError.code));
    },
    [t],
  );

  const updatePreferences = useCallback(
    async (patch) => {
      try {
        await update(patch);
      } catch (error) {
        showError(error);
      }
    },
    [update, showError],
  );

  const connectGoogle = async () => {
    setBusy('connect');
    try {
      const result = await googleCalendarService.connect();
      if (result.status === 'connected') {
        const lastError = calendarSyncEngine.getStatus().google.lastError;
        const message = result.initialSync
          ? t('calendar:google.firstSyncSummary', {
              created: result.initialSync.counts.created,
              pushed: result.initialSync.counts.pushed,
            })
          : t('calendar:google.firstSyncFailed', { error: lastError ? errorText(t, lastError) : '' });
        Alert.alert(t('calendar:google.connectedTitle'), message);
      } else if (result.status === 'scope_denied') {
        Alert.alert(t('calendar:google.title'), t('calendar:google.scopeDenied'));
      }
    } catch (error) {
      showError(error);
    } finally {
      setBusy(null);
    }
  };

  const disconnectGoogle = async (revoke) => {
    setBusy('disconnect');
    try {
      await googleCalendarService.disconnect({ revoke });
      Alert.alert(t('calendar:google.disconnectedTitle'));
    } catch (error) {
      showError(error);
    } finally {
      setBusy(null);
    }
  };

  const confirmDisconnect = () => {
    Alert.alert(t('calendar:google.disconnectTitle'), t('calendar:google.disconnectMessage'), [
      { text: t('calendar:actions.cancel'), style: 'cancel' },
      { text: t('calendar:google.disconnect'), onPress: () => void disconnectGoogle(false) },
      { text: t('calendar:google.disconnectAndRevoke'), style: 'destructive', onPress: () => void disconnectGoogle(true) },
    ]);
  };

  const syncNow = async () => {
    setBusy('sync');
    try {
      const report = await calendarSyncEngine.syncNow({ reason: 'manual' });
      const lines = [];
      if (report.google) {
        lines.push(t('calendar:sync.googleResult', report.google.counts));
        if (report.google.counts.failed > 0) lines.push(t('calendar:sync.failedGoogle', { count: report.google.counts.failed }));
      }
      if (report.device) {
        lines.push(t('calendar:sync.deviceResult', report.device.counts));
        if (report.device.counts.failed > 0) lines.push(t('calendar:sync.failedDevice', { count: report.device.counts.failed }));
      }
      for (const failure of report.errors) {
        lines.push(
          t('calendar:sync.providerError', {
            provider: failure.provider === 'google' ? t('calendar:sync.providers.google') : t('calendar:sync.providers.device'),
            error: errorText(t, failure.code),
          }),
        );
      }
      if (lines.length === 0) lines.push(t('calendar:sync.nothingToSync'));
      Alert.alert(report.errors.length > 0 ? t('calendar:sync.problemsTitle') : t('calendar:sync.doneTitle'), lines.join('\n\n'));
    } catch (error) {
      showError(error);
    } finally {
      setBusy(null);
    }
  };

  if (!isLoaded) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  const anySyncing = status.google.syncing || status.device.syncing;
  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <GoogleSection
        status={status}
        busy={busy}
        onConnect={connectGoogle}
        onDisconnect={confirmDisconnect}
        colors={colors}
        t={t}
      />
      <DeviceSection
        status={status}
        preferences={preferences}
        onUpdatePreferences={updatePreferences}
        colors={colors}
        t={t}
        showError={showError}
      />
      <PrimaryButton
        label={busy === 'sync' || anySyncing ? t('calendar:sync.syncing') : t('calendar:sync.now')}
        onPress={syncNow}
        disabled={busy !== null || anySyncing}
        busy={busy === 'sync'}
        colors={colors}
        icon="sync"
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 16,
    gap: 16,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
  },
  pill: {
    fontSize: 12,
    fontWeight: '600',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
  },
  meta: {
    fontSize: 13,
    lineHeight: 18,
  },
  sectionLabel: {
    fontSize: 15,
    fontWeight: '600',
    marginTop: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowTextBlock: {
    flex: 1,
  },
  rowLabel: {
    fontSize: 15,
    flexShrink: 1,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  inlineText: {
    marginLeft: 8,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
