/**
 * Quick actions: a row of four round buttons with a label underneath (the pattern of modern
 * finance and productivity apps): new meeting (form) on the primary gradient, new meeting with
 * the AI assistant on the assistant gradient, the WhatsApp bot, and notes.
 * The WhatsApp button follows whatsappLinkStatus.enabled (docs/v1/ARCHITECTURE.md §27): a
 * disabled "Coming soon" button until the server-side bot is configured, then it opens the
 * WhatsApp setup; its caption says which. Labels wrap instead of clipping at large font scales.
 */
import type { ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { GradientSurface, Icon, PressableScale, Reveal, SectionHeader, type GradientVariant, type IconName } from '../../components/ui';
import { useT } from '../../i18n';
import { useWhatsAppStatus } from '../../services/whatsapp';
import { floatingShadow, radii, spacing, useAppTheme } from '../../theme';

export interface QuickActionsProps {
  onNewManual(): void;
  onNewWithAi(): void;
  onWhatsApp(): void;
  onNotes(): void;
}

const CIRCLE = 56;

function Action({
  icon,
  label,
  caption,
  gradient,
  onPress,
  disabled = false,
  accessibilityLabel,
  index,
  testID,
}: {
  icon: IconName;
  label: string;
  /** Small second line (WhatsApp: "Coming soon" / "Create by message"). */
  caption?: string;
  /** On a gradient (primary / ai) or, when absent, a tonal circle. */
  gradient?: GradientVariant;
  onPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  index: number;
  testID: string;
}): ReactElement {
  const { colors, onGradient } = useAppTheme();
  const tonalBg = disabled ? colors.surfaceDisabled : colors.secondaryContainer;
  const tonalFg = disabled ? colors.onSurfaceDisabled : colors.onSecondaryContainer;
  return (
    <Reveal index={index} style={styles.slot}>
      <PressableScale
        onPress={() => onPress?.()}
        disabled={disabled}
        style={styles.action}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? (caption ? `${label}. ${caption}` : label)}
        accessibilityState={{ disabled }}
        testID={testID}
      >
        {gradient ? (
          <View style={styles.circleShadow}>
            <GradientSurface variant={gradient} style={styles.circle}>
              <Icon name={icon} size={24} color={onGradient[gradient]} />
            </GradientSurface>
          </View>
        ) : (
          <View style={[styles.circle, { backgroundColor: tonalBg }]}>
            <Icon name={icon} size={24} color={tonalFg} />
          </View>
        )}
        <Text variant="labelMedium" style={[styles.label, { color: disabled ? colors.disabledText : colors.onSurface }]}>
          {label}
        </Text>
        {caption ? (
          <Text variant="labelSmall" style={[styles.caption, { color: disabled ? colors.disabledText : colors.onSurfaceVariant }]}>
            {caption}
          </Text>
        ) : null}
      </PressableScale>
    </Reveal>
  );
}

export function QuickActions({ onNewManual, onNewWithAi, onWhatsApp, onNotes }: QuickActionsProps): ReactElement {
  const t = useT();
  // §27: a null status means unknown, which stays disabled so nothing pretends a bot exists.
  const whatsappReady = useWhatsAppStatus().status?.enabled === true;
  return (
    <View>
      <SectionHeader title={t('home:actions.title')} />
      <View style={styles.row}>
        <Action icon="plus" gradient="primary" label={t('home:actions.manual')} onPress={onNewManual} index={0} testID="quick-new-manual" />
        <Action icon="ai" gradient="ai" label={t('home:actions.ai')} onPress={onNewWithAi} index={1} testID="quick-new-ai" />
        <Action
          icon="whatsapp"
          label={t('home:actions.whatsapp')}
          caption={t(whatsappReady ? 'home:actions.whatsappReadyHint' : 'home:actions.whatsappHint')}
          disabled={!whatsappReady}
          onPress={whatsappReady ? onWhatsApp : undefined}
          accessibilityLabel={t(whatsappReady ? 'home:actions.whatsappReadyA11y' : 'home:actions.whatsappA11y')}
          index={2}
          testID="quick-whatsapp"
        />
        <Action icon="notes" label={t('home:actions.notes')} onPress={onNotes} index={3} testID="quick-notes" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  slot: {
    flex: 1,
  },
  action: {
    alignItems: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  circleShadow: {
    borderRadius: radii.full,
    ...floatingShadow,
  },
  circle: {
    width: CIRCLE,
    height: CIRCLE,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  label: {
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  caption: {
    marginTop: 2,
    textAlign: 'center',
  },
});
