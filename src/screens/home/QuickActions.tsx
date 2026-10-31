/**
 * Quick actions: new meeting (form), new meeting with the AI assistant, and the WhatsApp bot.
 * The WhatsApp tile follows whatsappLinkStatus.enabled (docs/v1/ARCHITECTURE.md §27): a disabled
 * "Coming soon" tile until the server-side bot is configured, then it opens the WhatsApp setup.
 * Three Card tiles across, each with a 40dp primaryContainer icon circle; labels wrap instead
 * of clipping at large font scales.
 */
import type { ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { Card, Icon, SectionHeader, type IconName } from '../../components/ui';
import { useT } from '../../i18n';
import { useWhatsAppStatus } from '../../services/whatsapp';
import { componentMetrics, radii, spacing, useAppTheme } from '../../theme';

export interface QuickActionsProps {
  onNewManual(): void;
  onNewWithAi(): void;
  onWhatsApp(): void;
}

function Tile({
  icon,
  label,
  hint,
  onPress,
  disabled = false,
  accessibilityLabel,
  testID,
}: {
  icon: IconName;
  label: string;
  hint: string;
  onPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  testID: string;
}): ReactElement {
  const { colors } = useAppTheme();
  return (
    <Card
      onPress={() => onPress?.()}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel ?? `${label}. ${hint}`}
      style={styles.tile}
      testID={testID}
    >
      <View style={[styles.circle, { backgroundColor: disabled ? colors.surfaceDisabled : colors.primaryContainer }]}>
        <Icon name={icon} size={componentMetrics.iconInline} color={disabled ? colors.onSurfaceDisabled : colors.onPrimaryContainer} />
      </View>
      <Text variant="labelLarge" style={[styles.label, disabled && { color: colors.disabledText }]}>
        {label}
      </Text>
      <Text variant="bodySmall" style={[styles.hint, { color: disabled ? colors.disabledText : colors.onSurfaceVariant }]}>
        {hint}
      </Text>
    </Card>
  );
}

export function QuickActions({ onNewManual, onNewWithAi, onWhatsApp }: QuickActionsProps): ReactElement {
  const t = useT();
  // §27: a null status means unknown, which stays disabled so nothing pretends a bot exists.
  const whatsappReady = useWhatsAppStatus().status?.enabled === true;
  return (
    <View>
      <SectionHeader title={t('home:actions.title')} />
      <View style={styles.row}>
        <Tile icon="newMeeting" label={t('home:actions.manual')} hint={t('home:actions.manualHint')} onPress={onNewManual} testID="quick-new-manual" />
        <Tile icon="ai" label={t('home:actions.ai')} hint={t('home:actions.aiHint')} onPress={onNewWithAi} testID="quick-new-ai" />
        <Tile
          icon="whatsapp"
          label={t('home:actions.whatsapp')}
          hint={t(whatsappReady ? 'home:actions.whatsappReadyHint' : 'home:actions.whatsappHint')}
          disabled={!whatsappReady}
          onPress={whatsappReady ? onWhatsApp : undefined}
          accessibilityLabel={t(whatsappReady ? 'home:actions.whatsappReadyA11y' : 'home:actions.whatsappA11y')}
          testID="quick-whatsapp"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.sm,
  },
  tile: {
    flex: 1,
    padding: spacing.md,
  },
  circle: {
    width: componentMetrics.avatarSize,
    height: componentMetrics.avatarSize,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    marginTop: spacing.sm,
  },
  hint: {
    marginTop: spacing.xs,
  },
});
