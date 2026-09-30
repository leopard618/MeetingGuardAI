/**
 * "New meeting" chooser (route "ChooseCreationMethod"): the brief's creation channels.
 * - Manual form (route CreateMeeting).
 * - AI assistant (route AIChat); every message uses one of the day's AI requests of the plan.
 * - WhatsApp: shown as "Coming soon" and disabled. There is no WhatsApp bot (no number, no
 *   webhook), so nothing here pretends otherwise.
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

/** Only these methods exist today. */
export function isMethodAvailable(method: CreationMethod): boolean {
  return method !== 'whatsapp';
}

function MethodCard({ method, onPress }: { method: CreationMethod; onPress?: () => void }): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const available = isMethodAvailable(method) && onPress !== undefined;
  const title = t(`create:methods.${method}.title`);
  const description = t(`create:methods.${method}.description`);
  const comingSoon = t('create:comingSoon');
  const iconBackground = available ? colors.primaryContainer : colors.surfaceDisabled;
  const iconColor = available ? colors.onPrimaryContainer : colors.onSurfaceDisabled;

  return (
    <Card
      onPress={available ? onPress : undefined}
      style={styles.card}
      accessibilityRole="button"
      accessibilityLabel={available ? `${title}. ${description}` : `${title}, ${comingSoon}. ${description}`}
      accessibilityHint={available ? t(`create:methods.${method}.hint`) : undefined}
      accessibilityState={{ disabled: !available }}
      testID={`create-method-${method}`}
    >
      <View style={styles.row}>
        <View style={[styles.icon, { backgroundColor: iconBackground }]}>
          <MaterialCommunityIcons name={ICONS[method]} size={componentMetrics.iconNav} color={iconColor} />
        </View>
        <View style={styles.body}>
          <View style={styles.titleRow}>
            <Text variant="titleMedium" style={!available && { color: colors.disabledText }}>
              {title}
            </Text>
            {!available ? <Badge label={comingSoon} tone="neutral" testID={`create-method-${method}-soon`} /> : null}
          </View>
          <Text variant="bodyMedium" style={{ color: available ? colors.onSurfaceVariant : colors.disabledText }}>
            {description}
          </Text>
        </View>
        {available ? <MaterialCommunityIcons name="chevron-right" size={componentMetrics.iconNav} color={colors.onSurfaceVariant} /> : null}
      </View>
    </Card>
  );
}

export function ChooseCreationMethodScreen({ navigation }: Props): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();

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
      <MethodCard method="manual" onPress={() => navigation.navigate('CreateMeeting')} />
      <MethodCard method="ai" onPress={() => navigation.navigate('AIChat')} />
      <MethodCard method="whatsapp" />
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
