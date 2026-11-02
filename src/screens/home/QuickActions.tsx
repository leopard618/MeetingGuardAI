/**
 * Quick actions: a 2 x 2 grid of rounded rectangular buttons in the RIGHT half of the row shared
 * with the tasks card: new meeting (filled primary), new meeting with the AI assistant, the
 * WhatsApp bot, and notes (surface tiles). Each tile is icon + label; WhatsApp carries a caption
 * ("Coming soon" until whatsappLinkStatus.enabled, then "Create by message"; docs/v1/ARCHITECTURE.md
 * §27) and is disabled until the server-side bot is configured. Labels wrap instead of clipping.
 * No motion: plain pressed dim.
 */
import type { ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { Icon, PressableScale, type IconName } from '../../components/ui';
import { useT } from '../../i18n';
import { useWhatsAppStatus } from '../../services/whatsapp';
import { radii, spacing, useAppTheme } from '../../theme';

export interface QuickActionsProps {
  onNewManual(): void;
  onNewWithAi(): void;
  onWhatsApp(): void;
  onNotes(): void;
  style?: object;
}

function Tile({
  icon,
  label,
  caption,
  primary = false,
  onPress,
  disabled = false,
  accessibilityLabel,
  testID,
}: {
  icon: IconName;
  label: string;
  /** Small second line (WhatsApp: "Coming soon" / "Create by message"). */
  caption?: string;
  /** The one filled tile (new meeting). */
  primary?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  testID: string;
}): ReactElement {
  const { colors, elevated } = useAppTheme();
  const fg = primary ? colors.onPrimary : disabled ? colors.onSurfaceDisabled : colors.onSurface;
  const muted = primary ? colors.onPrimary : disabled ? colors.disabledText : colors.onSurfaceVariant;
  return (
    <PressableScale
      onPress={() => onPress?.()}
      disabled={disabled}
      style={[styles.tile, primary ? { backgroundColor: colors.primary } : elevated, disabled && !primary && { backgroundColor: colors.surfaceDisabled, borderWidth: 0 }]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (caption ? `${label}. ${caption}` : label)}
      accessibilityState={{ disabled }}
      testID={testID}
    >
      <Icon name={icon} size={22} color={primary ? colors.onPrimary : disabled ? colors.onSurfaceDisabled : colors.primary} />
      <Text variant="labelMedium" style={[styles.label, { color: fg }]} numberOfLines={2}>
        {label}
      </Text>
      {caption ? (
        <Text variant="labelSmall" style={[styles.caption, { color: muted }]} numberOfLines={1}>
          {caption}
        </Text>
      ) : null}
    </PressableScale>
  );
}

export function QuickActions({ onNewManual, onNewWithAi, onWhatsApp, onNotes, style }: QuickActionsProps): ReactElement {
  const t = useT();
  // §27: a null status means unknown, which stays disabled so nothing pretends a bot exists.
  const whatsappReady = useWhatsAppStatus().status?.enabled === true;
  return (
    <View style={[styles.grid, style]} accessibilityLabel={t('home:actions.title')} testID="quick-actions">
      <View style={styles.row}>
        <Tile icon="plus" primary label={t('home:actions.manual')} onPress={onNewManual} testID="quick-new-manual" />
        <Tile icon="ai" label={t('home:actions.ai')} onPress={onNewWithAi} testID="quick-new-ai" />
      </View>
      <View style={styles.row}>
        <Tile
          icon="whatsapp"
          label={t('home:actions.whatsapp')}
          caption={t(whatsappReady ? 'home:actions.whatsappReadyHint' : 'home:actions.whatsappHint')}
          disabled={!whatsappReady}
          onPress={whatsappReady ? onWhatsApp : undefined}
          accessibilityLabel={t(whatsappReady ? 'home:actions.whatsappReadyA11y' : 'home:actions.whatsappA11y')}
          testID="quick-whatsapp"
        />
        <Tile icon="notes" label={t('home:actions.notes')} onPress={onNotes} testID="quick-notes" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    gap: spacing.sm,
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  tile: {
    flex: 1,
    minHeight: 84,
    borderRadius: radii.lg,
    padding: spacing.md,
    justifyContent: 'flex-end',
  },
  label: {
    marginTop: spacing.sm,
  },
  caption: {
    marginTop: 2,
  },
});
