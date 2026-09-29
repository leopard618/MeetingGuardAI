/**
 * Quick actions: new meeting (form), new meeting with the AI assistant, and WhatsApp shown as
 * "Coming soon" (disabled: the WhatsApp bot does not exist yet).
 */
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps, ReactElement } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text, useTheme as usePaperTheme } from 'react-native-paper';

import { useT } from '../../i18n';

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
  const theme = usePaperTheme();
  const color = disabled ? theme.colors.onSurfaceDisabled : theme.colors.primary;
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={accessibilityLabel ?? `${label}. ${hint}`}
      hitSlop={4}
      style={({ pressed }) => [
        styles.tile,
        {
          backgroundColor: pressed ? theme.colors.surfaceVariant : theme.colors.elevation.level1,
          borderColor: theme.colors.outlineVariant,
        },
        disabled && styles.disabled,
      ]}
      testID={testID}
    >
      <MaterialCommunityIcons name={icon} size={26} color={color} />
      <Text variant="labelLarge" style={styles.label} numberOfLines={2}>
        {label}
      </Text>
      <Text variant="bodySmall" style={[styles.hint, { color: theme.colors.onSurfaceVariant }]} numberOfLines={2}>
        {hint}
      </Text>
    </Pressable>
  );
}

export function QuickActions({ onNewManual, onNewWithAi }: QuickActionsProps): ReactElement {
  const t = useT();
  return (
    <View style={styles.container}>
      <Text variant="titleMedium" accessibilityRole="header" style={styles.title}>
        {t('home:actions.title')}
      </Text>
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
  container: {
    marginBottom: 16,
  },
  title: {
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    marginHorizontal: -4,
  },
  tile: {
    flex: 1,
    minHeight: 96,
    marginHorizontal: 4,
    padding: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  disabled: {
    opacity: 0.55,
  },
  label: {
    marginTop: 8,
  },
  hint: {
    marginTop: 2,
  },
});
