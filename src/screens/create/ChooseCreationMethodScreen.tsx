/**
 * "New meeting" chooser (route "ChooseCreationMethod"): the brief's creation channels.
 * - Manual form (route CreateMeeting).
 * - AI assistant (route AIChat); every message uses one of the day's AI requests of the plan.
 * - WhatsApp: live only when the server-side bot is configured (whatsappLinkStatus.enabled,
 *   docs/ARCHITECTURE.md §27) - then the card opens the WhatsAppConnect setup. Otherwise it
 *   stays the disabled "Coming soon" card, so nothing pretends a bot exists.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { StackScreenProps } from '@react-navigation/stack';
import type { ComponentProps, ReactElement } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge, Card } from '../../components/ui';
import type { RootStackParamList } from '../../core/contracts';
import { useT } from '../../i18n';
import { useWhatsAppStatus } from '../../services/whatsapp';
import { componentMetrics, radii, spacing, useAppTheme } from '../../theme';

type Props = StackScreenProps<RootStackParamList, 'ChooseCreationMethod'>;
type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export const CREATION_METHODS = ['manual', 'ai', 'whatsapp'] as const;
export type CreationMethod = (typeof CREATION_METHODS)[number];

const ICONS: Readonly<Record<CreationMethod, IconName>> = {
  manual: 'form-select',
  ai: 'robot-outline',
  whatsapp: 'whatsapp',
};

/** Manual and AI always exist; WhatsApp only once the server-side bot is configured (§27). */
export function isMethodAvailable(method: CreationMethod, context: { whatsappEnabled: boolean }): boolean {
  return method !== 'whatsapp' || context.whatsappEnabled;
}

function MethodCard({
  method,
  available,
  onPress,
}: {
  method: CreationMethod;
  available: boolean;
  onPress?: () => void;
}): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const enabled = available && onPress !== undefined;
  const whatsappReady = enabled && method === 'whatsapp';
  const title = t(`create:methods.${method}.title`);
  const description = whatsappReady ? t('create:methods.whatsapp.readyDescription') : t(`create:methods.${method}.description`);
  const hint = whatsappReady ? t('create:methods.whatsapp.readyHint') : t(`create:methods.${method}.hint`);
  const comingSoon = t('create:comingSoon');
  const iconBackground = enabled ? colors.primaryContainer : colors.surfaceDisabled;
  const iconColor = enabled ? colors.onPrimaryContainer : colors.onSurfaceDisabled;

  return (
    <Card
      onPress={enabled ? onPress : undefined}
      style={styles.card}
      accessibilityRole="button"
      accessibilityLabel={enabled ? `${title}. ${description}` : `${title}, ${comingSoon}. ${description}`}
      accessibilityHint={enabled ? hint : undefined}
      accessibilityState={{ disabled: !enabled }}
      testID={`create-method-${method}`}
    >
      <View style={styles.row}>
        <View style={[styles.icon, { backgroundColor: iconBackground }]}>
          <MaterialCommunityIcons name={ICONS[method]} size={componentMetrics.iconNav} color={iconColor} />
        </View>
        <View style={styles.body}>
          <View style={styles.titleRow}>
            <Text variant="titleMedium" style={!enabled && { color: colors.disabledText }}>
              {title}
            </Text>
            {!enabled ? <Badge label={comingSoon} tone="neutral" testID={`create-method-${method}-soon`} /> : null}
          </View>
          <Text variant="bodyMedium" style={{ color: enabled ? colors.onSurfaceVariant : colors.disabledText }}>
            {description}
          </Text>
        </View>
        {enabled ? <MaterialCommunityIcons name="chevron-right" size={componentMetrics.iconNav} color={colors.onSurfaceVariant} /> : null}
      </View>
    </Card>
  );
}

export function ChooseCreationMethodScreen({ navigation }: Props): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { status } = useWhatsAppStatus();
  const whatsappEnabled = status?.enabled === true;

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[
        styles.content,
        {
          paddingBottom: insets.bottom + spacing.xxl,
          paddingLeft: insets.left + componentMetrics.screenGutter,
          paddingRight: insets.right + componentMetrics.screenGutter,
        },
      ]}
    >
      <Text variant="headlineSmall" accessibilityRole="header" style={styles.heading}>
        {t('create:title')}
      </Text>
      <Text variant="bodyMedium" style={[styles.subtitle, { color: colors.onSurfaceVariant }]}>
        {t('create:subtitle')}
      </Text>
      <MethodCard method="manual" available onPress={() => navigation.navigate('CreateMeeting')} />
      <MethodCard method="ai" available onPress={() => navigation.navigate('AIChat')} />
      <MethodCard
        method="whatsapp"
        available={isMethodAvailable('whatsapp', { whatsappEnabled })}
        onPress={whatsappEnabled ? () => navigation.navigate('WhatsAppConnect') : undefined}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: spacing.xl,
  },
  heading: {
    marginBottom: spacing.xs,
  },
  subtitle: {
    marginBottom: spacing.xl,
  },
  card: {
    marginBottom: componentMetrics.cardGap,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: componentMetrics.avatarSize,
  },
  icon: {
    width: componentMetrics.avatarSize,
    height: componentMetrics.avatarSize,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.lg,
  },
  body: {
    flex: 1,
    marginRight: spacing.xs,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
});
