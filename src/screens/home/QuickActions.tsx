/**
 * Quick actions: new meeting (form), new meeting with the AI assistant, and WhatsApp shown as
 * "Coming soon" (disabled: the WhatsApp bot does not exist yet). Three Card tiles across, each
 * with a 40dp primaryContainer icon circle; labels wrap instead of clipping at large font scales.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps, ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { Card, SectionHeader } from '../../components/ui';
import { useT } from '../../i18n';
import { componentMetrics, radii, spacing, useAppTheme } from '../../theme';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export interface QuickActionsProps {
  onNewManual(): void;
  onNewWithAi(): void;
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
      <View style={[styles.circle, { backgroundColor: disabled ? colors.surfaceVariant : colors.primaryContainer }]}>
        <MaterialCommunityIcons
          name={icon}
          size={componentMetrics.iconNav}
          color={disabled ? colors.disabledText : colors.onPrimaryContainer}
        />
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

export function QuickActions({ onNewManual, onNewWithAi }: QuickActionsProps): ReactElement {
  const t = useT();
  return (
    <View>
      <SectionHeader title={t('home:actions.title')} />
      <View style={styles.row}>
        <Tile icon="calendar-plus" label={t('home:actions.manual')} hint={t('home:actions.manualHint')} onPress={onNewManual} testID="quick-new-manual" />
        <Tile icon="robot-outline" label={t('home:actions.ai')} hint={t('home:actions.aiHint')} onPress={onNewWithAi} testID="quick-new-ai" />
        <Tile
          icon="whatsapp"
          label={t('home:actions.whatsapp')}
          hint={t('home:actions.whatsappHint')}
          disabled
          accessibilityLabel={t('home:actions.whatsappA11y')}
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
