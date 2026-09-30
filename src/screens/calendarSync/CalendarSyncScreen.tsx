/**
 * Calendar sync (route "CalendarSync"): Google Calendar two-way sync and the calendars on this
 * phone. Shows the REAL state from src/services/calendar (useCalendarStatus) and every action
 * reports its real result:
 * - Google: connect (incremental Calendar consent + first sync), grant access again when the
 *   permission is missing, stop sync (optionally revoking access), last sync / last error;
 * - Outlook (only when EXPO_PUBLIC_MSAL_CLIENT_ID is set): connect through the Microsoft sign-in,
 *   account, stop sync (optionally opening the Microsoft consent page), last sync / last error;
 * - phone calendars: permission, which calendars to import, which calendar receives MeetingGuard
 *   meetings (writable calendars only), last sync / last error;
 * - "Sync now" with a per-provider summary.
 * Rendered as a SectionList (Google card, optional Outlook card, then the phone-calendar card and
 * its rows).
 */
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { StackScreenProps } from '@react-navigation/stack';
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { ActivityIndicator, Alert, Linking, SectionList, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { CalendarStatus, RootStackParamList, TranslateFn } from '../../core/contracts';
import type { Language, PreferencesPatch } from '../../core/types';
import { useLanguage, useT } from '../../i18n';
import { calendarSyncEngine, deviceCalendarService, googleCalendarService, outlookCalendarService, useCalendarStatus } from '../../services/calendar';
import { usePreferences } from '../../services/data';
import {
  buildDeviceRows,
  errorText,
  googleStateView,
  nextImportIds,
  outlookStateView,
  syncReportSummary,
  type DeviceCalendarsState,
  type DeviceRow,
} from './calendarSyncModel';
import { CardBottom, CardMiddle, CardTop, ImportRow, InlineProgress, PrimaryButton, RadioRow, SyncLine, partStyles } from './CalendarSyncParts';
import { toneColor, useCalendarPalette, type CalendarPalette } from './palette';
import { refreshGoogleState, refreshOutlookState, showCalendarError, useGoogleConnect, useOutlookConnect } from './useCalendarActions';
import { useLiveNow } from '../shared/useLiveNow';
import { useDeviceCalendars } from './useDeviceCalendars';

type Props = StackScreenProps<RootStackParamList, 'CalendarSync'>;

type Busy = 'disconnect' | 'outlookDisconnect' | 'sync' | null;

const CLOCK_MS = 60_000;
const INITIAL_ROWS = 40;

type GoogleItem = { kind: 'google'; key: 'google' };
type OutlookItem = { kind: 'outlook'; key: 'outlook' };
type Item = GoogleItem | OutlookItem | DeviceRow;
interface Section {
  key: 'google' | 'outlook' | 'device';
  data: Item[];
}

function GoogleCard({
  status,
  busy,
  connecting,
  onConnect,
  onDisconnect,
  palette,
  t,
  language,
  now,
}: {
  status: CalendarStatus;
  busy: Busy;
  connecting: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  palette: CalendarPalette;
  t: TranslateFn;
  language: Language;
  now: Date;
}): ReactElement {
  const google = status.google;
  const state = googleStateView(google);
  const stateColor = toneColor(palette, state.tone);
  const locked = busy !== null || connecting;

  return (
    <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]} testID="calendar-google-card">
      <View style={partStyles.cardHeader}>
        <MaterialIcons name="event" size={24} color={palette.accent} />
        <Text style={[partStyles.cardTitle, { color: palette.text }]} accessibilityRole="header">
          {t('calendar:google.title')}
        </Text>
        <Text style={[partStyles.pill, { color: stateColor, borderColor: stateColor }]} maxFontSizeMultiplier={1.5} testID="calendar-google-state">
          {t(state.labelKey)}
        </Text>
      </View>
      <Text style={[partStyles.body, { color: palette.muted }]}>{t('calendar:google.description')}</Text>

      {google.enabled ? (
        <View style={[styles.switchRow, { borderColor: palette.border }]}>
          <Text style={[styles.switchLabel, { color: palette.text }]}>{t('calendar:google.twoWaySync')}</Text>
          <Switch
            value
            disabled={locked}
            onValueChange={(value) => {
              if (!value) onDisconnect();
            }}
            trackColor={{ true: palette.accent, false: palette.border }}
            accessibilityLabel={t('calendar:google.twoWaySync')}
            testID="calendar-google-switch"
          />
        </View>
      ) : null}

      {google.enabled && !google.hasScope ? (
        <>
          <Text style={[partStyles.body, { color: palette.warning }]}>{t('calendar:google.permissionNeededHint')}</Text>
          <PrimaryButton
            label={connecting ? t('calendar:google.connecting') : t('calendar:google.grantAccess')}
            onPress={onConnect}
            disabled={locked}
            busy={connecting}
            icon="lock-open"
            palette={palette}
            testID="calendar-google-grant"
          />
        </>
      ) : null}

      {!google.enabled ? (
        <PrimaryButton
          label={connecting ? t('calendar:google.connecting') : t('calendar:google.connect')}
          onPress={onConnect}
          disabled={locked}
          busy={connecting}
          icon="link"
          palette={palette}
          testID="calendar-google-connect"
        />
      ) : null}

      {busy === 'disconnect' ? (
        <InlineProgress label={t('calendar:google.disconnecting')} palette={palette} />
      ) : google.enabled ? (
        <SyncLine provider={google} palette={palette} t={t} language={language} now={now} testID="calendar-google-sync" />
      ) : null}
    </View>
  );
}

function OutlookCard({
  outlook,
  busy,
  connecting,
  onConnect,
  onDisconnect,
  palette,
  t,
  language,
  now,
}: {
  outlook: NonNullable<CalendarStatus['outlook']>;
  busy: Busy;
  connecting: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  palette: CalendarPalette;
  t: TranslateFn;
  language: Language;
  now: Date;
}): ReactElement {
  const state = outlookStateView(outlook);
  const stateColor = toneColor(palette, state.tone);
  const locked = busy !== null || connecting;

  return (
    <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]} testID="calendar-outlook-card">
      <View style={partStyles.cardHeader}>
        <MaterialIcons name="event-note" size={24} color={palette.accent} />
        <Text style={[partStyles.cardTitle, { color: palette.text }]} accessibilityRole="header">
          {t('calendar:outlook.title')}
        </Text>
        <Text
          style={[partStyles.pill, { color: stateColor, borderColor: stateColor }]}
          maxFontSizeMultiplier={1.5}
          testID="calendar-outlook-state"
        >
          {t(state.labelKey)}
        </Text>
      </View>
      <Text style={[partStyles.body, { color: palette.muted }]}>{t('calendar:outlook.description')}</Text>

      {outlook.connected && outlook.accountEmail !== null ? (
        <Text style={[partStyles.meta, { color: palette.muted }]} testID="calendar-outlook-account">
          {t('calendar:outlook.account', { email: outlook.accountEmail })}
        </Text>
      ) : null}

      {outlook.connected ? (
        <View style={[styles.switchRow, { borderColor: palette.border }]}>
          <Text style={[styles.switchLabel, { color: palette.text }]}>{t('calendar:outlook.twoWaySync')}</Text>
          <Switch
            value
            disabled={locked}
            onValueChange={(value) => {
              if (!value) onDisconnect();
            }}
            trackColor={{ true: palette.accent, false: palette.border }}
            accessibilityLabel={t('calendar:outlook.twoWaySync')}
            testID="calendar-outlook-switch"
          />
        </View>
      ) : (
        <PrimaryButton
          label={connecting ? t('calendar:outlook.connecting') : t('calendar:outlook.connect')}
          onPress={onConnect}
          disabled={locked}
          busy={connecting}
          icon="link"
          palette={palette}
          testID="calendar-outlook-connect"
        />
      )}

      {busy === 'outlookDisconnect' ? (
        <InlineProgress label={t('calendar:outlook.disconnecting')} palette={palette} />
      ) : outlook.connected ? (
        <SyncLine provider={outlook} palette={palette} t={t} language={language} now={now} testID="calendar-outlook-sync" />
      ) : null}
    </View>
  );
}

function DeviceHeader({
  state,
  onRequestPermission,
  onRetry,
  palette,
  t,
}: {
  state: DeviceCalendarsState;
  onRequestPermission: () => void;
  onRetry: () => void;
  palette: CalendarPalette;
  t: TranslateFn;
}): ReactElement {
  return (
    <CardTop palette={palette}>
      <View style={partStyles.cardHeader}>
        <MaterialIcons name="phone-iphone" size={24} color={palette.accent} />
        <Text style={[partStyles.cardTitle, { color: palette.text }]} accessibilityRole="header">
          {t('calendar:device.title')}
        </Text>
      </View>
      <Text style={[partStyles.body, { color: palette.muted }]}>{t('calendar:device.description')}</Text>
      {state.phase === 'loading' ? <InlineProgress label={t('calendar:device.loading')} palette={palette} /> : null}
      {state.phase === 'no_permission' ? (
        <PrimaryButton
          label={t('calendar:device.permission.request')}
          onPress={onRequestPermission}
          icon="event-available"
          palette={palette}
          testID="calendar-device-permission"
        />
      ) : null}
      {state.phase === 'error' ? (
        <>
          <Text style={[partStyles.body, { color: palette.danger }]}>{errorText(t, state.error)}</Text>
          <PrimaryButton label={t('calendar:device.retry')} onPress={onRetry} icon="refresh" palette={palette} testID="calendar-device-retry" />
        </>
      ) : null}
      {state.phase === 'ready' && state.calendars.length === 0 ? (
        <Text style={[partStyles.body, { color: palette.muted }]}>{t('calendar:device.empty')}</Text>
      ) : null}
    </CardTop>
  );
}

function DeviceRowView({
  row,
  onToggleImport,
  onChooseExport,
  palette,
  t,
}: {
  row: DeviceRow;
  onToggleImport: (calendarId: string, enabled: boolean) => void;
  onChooseExport: (calendarId: string | null) => void;
  palette: CalendarPalette;
  t: TranslateFn;
}): ReactElement {
  switch (row.kind) {
    case 'heading':
      return (
        <CardMiddle palette={palette}>
          <Text style={[partStyles.sectionLabel, { color: palette.text }]} accessibilityRole="header">
            {t(row.labelKey)}
          </Text>
        </CardMiddle>
      );
    case 'import':
      return (
        <CardMiddle palette={palette}>
          <ImportRow
            calendar={row.calendar}
            subtitle={row.coveredByGoogle ? t('calendar:device.import.googleSynced') : row.calendar.sourceName}
            value={row.selected}
            disabled={row.coveredByGoogle}
            onChange={(value) => onToggleImport(row.calendar.id, value)}
            palette={palette}
            accessibilityLabel={t('calendar:device.import.a11y', { calendar: row.calendar.title })}
          />
        </CardMiddle>
      );
    case 'export':
      return (
        <CardMiddle palette={palette}>
          <RadioRow
            selected={row.selected}
            label={row.calendar ? row.calendar.title : t('calendar:device.export.none')}
            color={row.calendar ? row.calendar.color : undefined}
            onPress={() => onChooseExport(row.calendar ? row.calendar.id : null)}
            palette={palette}
            testID={row.calendar ? `device-export-${row.calendar.id}` : 'device-export-none'}
          />
        </CardMiddle>
      );
    case 'hint':
      return (
        <CardMiddle palette={palette}>
          <Text style={[partStyles.meta, styles.hint, { color: palette.muted }]}>{t(row.labelKey)}</Text>
        </CardMiddle>
      );
  }
}

export function CalendarSyncScreen(_props: Props): ReactElement {
  const t = useT();
  const { language } = useLanguage();
  const palette = useCalendarPalette();
  const insets = useSafeAreaInsets();
  const status = useCalendarStatus();
  const { preferences, isLoaded, update } = usePreferences();
  const devices = useDeviceCalendars(status.device.permission);
  const [busy, setBusy] = useState<Busy>(null);
  // "Last synced 3 min ago"; paused behind other screens and in the background.
  const now = useLiveNow(CLOCK_MS);
  const google = useGoogleConnect();
  const outlook = useOutlookConnect();

  useEffect(() => {
    refreshGoogleState();
    refreshOutlookState();
  }, []);

  const updatePreferences = useCallback(
    async (patch: PreferencesPatch) => {
      try {
        await update(patch);
      } catch (error) {
        showCalendarError(t, error);
      }
    },
    [t, update],
  );

  const disconnectGoogle = async (revoke: boolean): Promise<void> => {
    setBusy('disconnect');
    try {
      await googleCalendarService.disconnect({ revoke });
      Alert.alert(t('calendar:google.disconnectedTitle'));
    } catch (error) {
      showCalendarError(t, error);
    } finally {
      setBusy(null);
    }
  };

  const confirmDisconnect = (): void => {
    Alert.alert(t('calendar:google.disconnectTitle'), t('calendar:google.disconnectMessage'), [
      { text: t('calendar:actions.cancel'), style: 'cancel' },
      { text: t('calendar:google.disconnect'), onPress: () => void disconnectGoogle(false) },
      { text: t('calendar:google.disconnectAndRevoke'), style: 'destructive', onPress: () => void disconnectGoogle(true) },
    ]);
  };

  const disconnectOutlook = async (revoke: boolean): Promise<void> => {
    setBusy('outlookDisconnect');
    try {
      await outlookCalendarService.disconnect({ revoke });
      Alert.alert(t('calendar:outlook.disconnectedTitle'));
    } catch (error) {
      showCalendarError(t, error);
    } finally {
      setBusy(null);
    }
  };

  const confirmDisconnectOutlook = (): void => {
    Alert.alert(t('calendar:outlook.disconnectTitle'), t('calendar:outlook.disconnectMessage'), [
      { text: t('calendar:actions.cancel'), style: 'cancel' },
      { text: t('calendar:outlook.disconnect'), onPress: () => void disconnectOutlook(false) },
      { text: t('calendar:outlook.disconnectAndRevoke'), style: 'destructive', onPress: () => void disconnectOutlook(true) },
    ]);
  };

  const requestDevicePermission = async (): Promise<void> => {
    try {
      const result = await deviceCalendarService.requestPermission();
      if (result !== 'granted') {
        Alert.alert(t('calendar:device.title'), t('calendar:device.permission.denied'), [
          { text: t('calendar:actions.cancel'), style: 'cancel' },
          { text: t('calendar:device.permission.openSettings'), onPress: () => void Linking.openSettings() },
        ]);
      }
    } catch (error) {
      showCalendarError(t, error);
    }
  };

  const syncNow = async (): Promise<void> => {
    setBusy('sync');
    try {
      const report = await calendarSyncEngine.syncNow({ reason: 'manual' });
      const summary = syncReportSummary(t, report);
      Alert.alert(summary.title, summary.message);
    } catch (error) {
      showCalendarError(t, error);
    } finally {
      setBusy(null);
    }
  };

  const toggleImport = (calendarId: string, enabled: boolean): void => {
    void updatePreferences({ deviceCalendarImportIds: nextImportIds(preferences.deviceCalendarImportIds, calendarId, enabled) });
  };

  const chooseExport = (calendarId: string | null): void => {
    void updatePreferences({ deviceCalendarExportId: calendarId });
  };

  // The stack header (CustomHeader) shows the back arrow and the title; this is the intro line.
  const intro = (
    <Text style={[styles.intro, { color: palette.muted }]} testID="calendar-intro">
      {t('calendar:screen.subtitle')}
    </Text>
  );

  if (!isLoaded) {
    return (
      <View style={[styles.container, { backgroundColor: palette.background }]}>
        <View style={styles.introBox}>{intro}</View>
        <View style={styles.centered} accessible accessibilityLabel={t('calendar:device.loading')} testID="calendar-loading">
          <ActivityIndicator size="large" color={palette.accent} />
        </View>
      </View>
    );
  }

  const deviceRows = devices.state.phase === 'ready' ? buildDeviceRows(devices.state.calendars, preferences) : [];
  // The Outlook card exists only when the provider is registered (EXPO_PUBLIC_MSAL_CLIENT_ID set).
  const outlookStatus = status.outlook;
  const sections: Section[] = [
    { key: 'google', data: [{ kind: 'google', key: 'google' }] },
    ...(outlookStatus !== undefined ? [{ key: 'outlook', data: [{ kind: 'outlook', key: 'outlook' }] } satisfies Section] : []),
    { key: 'device', data: deviceRows },
  ];
  const anySyncing = status.google.syncing || status.device.syncing || outlookStatus?.syncing === true;
  const syncing = busy === 'sync' || anySyncing;
  const anyConnecting = google.connecting || outlook.connecting;

  const renderItem = ({ item }: { item: Item }): ReactElement => {
    if (item.kind === 'google') {
      return (
        <GoogleCard
          status={status}
          busy={busy}
          connecting={google.connecting}
          onConnect={() => void google.connect()}
          onDisconnect={confirmDisconnect}
          palette={palette}
          t={t}
          language={language}
          now={now}
        />
      );
    }
    if (item.kind === 'outlook') {
      // The section only exists when outlookStatus is defined.
      return outlookStatus !== undefined ? (
        <OutlookCard
          outlook={outlookStatus}
          busy={busy}
          connecting={outlook.connecting}
          onConnect={() => void outlook.connect()}
          onDisconnect={confirmDisconnectOutlook}
          palette={palette}
          t={t}
          language={language}
          now={now}
        />
      ) : (
        <View />
      );
    }
    return <DeviceRowView row={item} onToggleImport={toggleImport} onChooseExport={chooseExport} palette={palette} t={t} />;
  };

  const renderSectionHeader = ({ section }: { section: Section }): ReactElement | null =>
    section.key === 'device' ? (
      <DeviceHeader
        state={devices.state}
        onRequestPermission={() => void requestDevicePermission()}
        onRetry={devices.retry}
        palette={palette}
        t={t}
      />
    ) : null;

  const renderSectionFooter = ({ section }: { section: Section }): ReactElement | null =>
    section.key === 'device' ? (
      <CardBottom palette={palette}>
        {devices.state.phase === 'ready' && devices.state.calendars.length > 0 && status.device.enabled ? (
          <SyncLine provider={status.device} palette={palette} t={t} language={language} now={now} testID="calendar-device-sync" />
        ) : null}
      </CardBottom>
    ) : null;

  return (
    <View style={[styles.container, { backgroundColor: palette.background, paddingLeft: insets.left, paddingRight: insets.right }]}>
      <SectionList<Item, Section>
        sections={sections}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        renderSectionFooter={renderSectionFooter}
        stickySectionHeadersEnabled={false}
        // A handful of calendars: render them all at once (no blank rows while scrolling).
        initialNumToRender={INITIAL_ROWS}
        contentContainerStyle={[styles.content, { paddingBottom: 16 + insets.bottom }]}
        ListHeaderComponent={intro}
        ListFooterComponent={
          <PrimaryButton
            label={syncing ? t('calendar:sync.syncing') : t('calendar:sync.now')}
            onPress={() => void syncNow()}
            disabled={busy !== null || anySyncing || anyConnecting}
            busy={busy === 'sync'}
            icon="sync"
            palette={palette}
            testID="calendar-sync-now"
          />
        }
        testID="calendar-sync-list"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  introBox: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  intro: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  content: {
    padding: 16,
  },
  card: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 12,
    marginBottom: 16,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 48,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  switchLabel: {
    flex: 1,
    fontSize: 15,
  },
  hint: {
    paddingVertical: 8,
  },
});
