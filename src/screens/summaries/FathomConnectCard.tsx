/**
 * "Connect Fathom", the main way to receive summaries (docs/v2/FATHOM-CONNECT.md section 7). Shown
 * at the top of the Meeting summaries connect screen while the server offers it (status
 * available); renders nothing otherwise, so a server without Connect Fathom shows the email setup
 * exactly as before.
 * - Not connected: what it does, Connect Fathom (opens Fathom's sign-in in an auth session), and
 *   what we read.
 * - Connected: since when, the last summary, the "stop forwarding Fathom emails" hint and
 *   Disconnect Fathom (after a confirmation).
 * Errors reach the user as mapped toasts only; nothing here logs.
 */
import type { ReactElement } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import { Card, Icon, MGButton } from '../../components/ui';
import type { FathomReturnReason } from '../../core/aiContract';
import { toAppError } from '../../core/errors';
import { useT } from '../../i18n';
import type { UseFathomConnectionResult } from '../../services/summaries/useFathomConnection';
import { componentMetrics, radii, spacing, useAppTheme } from '../../theme';
import { useFormatters } from '../shared/useFormatters';
import { connectErrorKey } from './summaryConnectModel';

export interface FathomConnectCardProps {
  fathom: UseFathomConnectionResult;
  /** After a connection: the summaries status changed (the private address may be new). */
  onConnected(): void;
}

function reasonKey(reason: FathomReturnReason | null): string {
  return `summaries:fathom.errors.${reason ?? 'server_error'}`;
}

export function FathomConnectCard({ fathom, onConnected }: FathomConnectCardProps): ReactElement | null {
  const t = useT();
  const { colors } = useAppTheme();
  const fmt = useFormatters();
  const status = fathom.status;
  if (status === null || !status.available) return null;
  const muted = { color: colors.onSurfaceVariant };

  async function connect(): Promise<void> {
    try {
      const outcome = await fathom.connect();
      if (outcome.result === 'connected') {
        Toast.show({ type: 'success', text1: t('summaries:fathom.connected') });
        onConnected();
      } else if (outcome.result === 'error') {
        Toast.show({ type: 'error', text1: t(reasonKey(outcome.reason)) });
      }
    } catch (caught: unknown) {
      Toast.show({ type: 'error', text1: t(connectErrorKey(toAppError(caught))) });
    }
  }

  async function disconnect(): Promise<void> {
    try {
      const answer = await fathom.disconnect();
      Toast.show(
        answer.remoteRemoved === false
          ? { type: 'info', text1: t('summaries:fathom.disconnected'), text2: t('summaries:fathom.remoteNotRemoved') }
          : { type: 'success', text1: t('summaries:fathom.disconnected') },
      );
    } catch (caught: unknown) {
      Toast.show({ type: 'error', text1: t(connectErrorKey(toAppError(caught))) });
    }
  }

  function confirmDisconnect(): void {
    Alert.alert(t('summaries:fathom.disconnectTitle'), t('summaries:fathom.disconnectBody'), [
      { text: t('summaries:fathom.cancel'), style: 'cancel' },
      {
        text: t('summaries:fathom.disconnectConfirm'),
        style: 'destructive',
        onPress: () => {
          void disconnect();
        },
      },
    ]);
  }

  if (status.connected) {
    return (
      <Card style={styles.block} testID="fathom-card-connected">
        <View style={styles.titleRow}>
          <Icon name="checkCircle" size={componentMetrics.iconInline} color={colors.primary} />
          <Text variant="titleMedium" accessibilityRole="header" style={styles.flex}>
            {t('summaries:fathom.connectedTitle')}
          </Text>
        </View>
        <Text variant="bodyMedium" style={styles.paragraph}>
          {t('summaries:fathom.connectedBody')}
        </Text>
        {status.connectedAt !== null ? (
          <Text variant="bodySmall" style={[styles.paragraph, muted]} testID="fathom-card-since">
            {t('summaries:fathom.connectedSince', { time: fmt.dateTime(status.connectedAt) })}
          </Text>
        ) : null}
        <Text variant="bodySmall" style={muted} testID="fathom-card-last">
          {status.lastEventAt !== null ? t('summaries:fathom.lastSummary', { time: fmt.dateTime(status.lastEventAt) }) : t('summaries:fathom.noSummaryYet')}
        </Text>
        <Text variant="bodySmall" style={[styles.paragraph, muted]}>
          {t('summaries:fathom.forwardHint')}
        </Text>
        <MGButton
          variant="outline"
          size="sm"
          icon="link-variant-off"
          style={styles.alignStart}
          onPress={confirmDisconnect}
          loading={fathom.busy === 'disconnect'}
          disabled={fathom.busy !== null}
          testID="fathom-card-disconnect"
        >
          {t('summaries:fathom.disconnect')}
        </MGButton>
      </Card>
    );
  }

  return (
    <Card accent="primary" style={styles.block} testID="fathom-card">
      <View style={styles.titleRow}>
        <Text variant="titleMedium" accessibilityRole="header" style={[styles.flex, { color: colors.onPrimaryContainer }]}>
          {t('summaries:fathom.title')}
        </Text>
        <View style={[styles.badge, { backgroundColor: colors.primary }]}>
          <Text variant="labelSmall" style={{ color: colors.onPrimary }}>
            {t('summaries:fathom.recommended')}
          </Text>
        </View>
      </View>
      <Text variant="bodyMedium" style={[styles.paragraph, { color: colors.onPrimaryContainer }]}>
        {t('summaries:fathom.body')}
      </Text>
      <MGButton
        style={styles.action}
        icon="link-variant"
        onPress={() => {
          void connect();
        }}
        loading={fathom.busy === 'connect'}
        disabled={fathom.busy !== null}
        testID="fathom-card-connect"
      >
        {t('summaries:fathom.connect')}
      </MGButton>
      <Text variant="bodySmall" style={[styles.paragraph, { color: colors.onPrimaryContainer }]}>
        {t('summaries:fathom.note')}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  block: {
    marginBottom: spacing.lg,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
  },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.md,
  },
  paragraph: {
    marginTop: spacing.sm,
  },
  action: {
    marginTop: spacing.lg,
  },
  alignStart: {
    alignSelf: 'flex-start',
    marginTop: spacing.md,
  },
});
