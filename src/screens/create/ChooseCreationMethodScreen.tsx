/**
 * "New meeting" chooser (route "ChooseCreationMethod"): the brief's creation channels.
 * - Manual form (route CreateMeeting).
 * - AI assistant (route AIChat); every message uses one of the day's AI requests of the plan.
 * - WhatsApp: shown as "Coming soon" and disabled. There is no WhatsApp bot (no number, no
 *   webhook), so nothing here pretends otherwise.
 */
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { StackScreenProps } from '@react-navigation/stack';
import type { ComponentProps, ReactElement } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, useTheme as usePaperTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { RootStackParamList } from '../../core/contracts';
import { useT } from '../../i18n';

type Props = StackScreenProps<RootStackParamList, 'ChooseCreationMethod'>;
type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export const CREATION_METHODS = ['manual', 'ai', 'whatsapp'] as const;
export type CreationMethod = (typeof CREATION_METHODS)[number];

const ICONS: Readonly<Record<CreationMethod, IconName>> = {
  manual: 'form-select',
  ai: 'robot-outline',
  whatsapp: 'whatsapp',
};

/** Only these methods exist today. */
export function isMethodAvailable(method: CreationMethod): boolean {
  return method !== 'whatsapp';
}

function MethodCard({ method, onPress }: { method: CreationMethod; onPress?: () => void }): ReactElement {
  const t = useT();
  const theme = usePaperTheme();
  const available = isMethodAvailable(method) && onPress !== undefined;
  const title = t(`create:methods.${method}.title`);
  const description = t(`create:methods.${method}.description`);
  const comingSoon = t('create:comingSoon');
  const iconBackground = available ? theme.colors.primaryContainer : theme.colors.surfaceDisabled;
  const iconColor = available ? theme.colors.onPrimaryContainer : theme.colors.onSurfaceDisabled;

  return (
    <Pressable
      onPress={available ? onPress : undefined}
      disabled={!available}
      android_ripple={available ? { color: theme.colors.surfaceVariant } : undefined}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: theme.colors.elevation.level1, borderColor: theme.colors.outlineVariant },
        pressed && available && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={available ? `${title}. ${description}` : `${title}, ${comingSoon}. ${description}`}
      accessibilityHint={available ? t(`create:methods.${method}.hint`) : undefined}
      accessibilityState={{ disabled: !available }}
      testID={`create-method-${method}`}
    >
      <View style={[styles.icon, { backgroundColor: iconBackground }]}>
        <MaterialCommunityIcons name={ICONS[method]} size={28} color={iconColor} />
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text variant="titleMedium" style={[styles.title, !available && { color: theme.colors.onSurfaceDisabled }]}>
            {title}
          </Text>
          {!available ? (
            <Text
              variant="labelSmall"
              style={[styles.badge, { backgroundColor: theme.colors.secondaryContainer, color: theme.colors.onSecondaryContainer }]}
              testID={`create-method-${method}-soon`}
            >
              {comingSoon}
            </Text>
          ) : null}
        </View>
        <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
          {description}
        </Text>
      </View>
      {available ? <MaterialCommunityIcons name="chevron-right" size={24} color={theme.colors.onSurfaceVariant} /> : null}
    </Pressable>
  );
}

export function ChooseCreationMethodScreen({ navigation }: Props): ReactElement {
  const t = useT();
  const theme = usePaperTheme();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: insets.bottom + 24, paddingLeft: insets.left + 16, paddingRight: insets.right + 16 },
      ]}
    >
      <Text variant="headlineSmall" accessibilityRole="header" style={styles.heading}>
        {t('create:title')}
      </Text>
      <Text variant="bodyMedium" style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}>
        {t('create:subtitle')}
      </Text>
      <MethodCard method="manual" onPress={() => navigation.navigate('CreateMeeting')} />
      <MethodCard method="ai" onPress={() => navigation.navigate('AIChat')} />
      <MethodCard method="whatsapp" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: 20,
  },
  heading: {
    marginBottom: 6,
  },
  subtitle: {
    marginBottom: 20,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    marginBottom: 14,
    minHeight: 72,
  },
  pressed: {
    opacity: 0.85,
  },
  icon: {
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  body: {
    flex: 1,
    marginRight: 4,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: 4,
  },
  title: {
    marginRight: 8,
  },
  badge: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
  },
});
