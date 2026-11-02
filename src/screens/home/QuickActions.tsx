/**
 * Quick actions (the client's mockup, icon-only): a 2 x 2 grid of rounded tiles in the right half
 * of the row shared with the tasks card, each showing ONE large glyph and nothing else. New
 * meeting is the filled primary tile (calendar with a plus), the others are surface tiles with a
 * primary icon: new with the AI assistant (magic sparkle), the WhatsApp bot (the WhatsApp glyph),
 * notes (note with a pen). Each tile's name is its accessibility label. WhatsApp is disabled
 * (dimmed) until whatsappLinkStatus.enabled (docs/v1/ARCHITECTURE.md §27). No motion.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps, ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';

import { PressableScale } from '../../components/ui';
import { useT } from '../../i18n';
import { useWhatsAppStatus } from '../../services/whatsapp';
import { radii, spacing, useAppTheme } from '../../theme';

type McIconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export interface QuickActionsProps {
  onNewManual(): void;
  onNewWithAi(): void;
  onWhatsApp(): void;
  onNotes(): void;
  style?: object;
}

const ICON_SIZE = 32;
/** Gap between the tiles (a step wider than the card gap elsewhere, per the client). */
const TILE_GAP = spacing.md;

/** The four glyphs (client, November 2, 2026: "use the other icons"). */
export const QUICK_ACTION_ICONS: Readonly<Record<'manual' | 'ai' | 'whatsapp' | 'notes', McIconName>> = {
  manual: 'calendar-plus',
  ai: 'creation',
  whatsapp: 'whatsapp',
  notes: 'note-edit-outline',
};

function Tile({
  icon,
  label,
  primary = false,
  onPress,
  disabled = false,
  accessibilityLabel,
  testID,
}: {
  icon: McIconName;
  /** Spoken name of the tile (no visible text). */
  label: string;
  /** The one filled tile (new meeting). */
  primary?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  testID: string;
}): ReactElement {
  const { colors, elevated } = useAppTheme();
  const iconColor = primary ? colors.onPrimary : disabled ? colors.onSurfaceDisabled : colors.primary;
  return (
    <PressableScale
      onPress={() => onPress?.()}
      disabled={disabled}
      style={[styles.tile, primary ? { backgroundColor: colors.primary } : elevated, disabled && !primary && styles.disabled]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      testID={testID}
    >
      <MaterialCommunityIcons name={icon} size={ICON_SIZE} color={iconColor} accessibilityElementsHidden importantForAccessibility="no" />
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
        <Tile icon={QUICK_ACTION_ICONS.manual} primary label={t('home:actions.manual')} onPress={onNewManual} testID="quick-new-manual" />
        <Tile icon={QUICK_ACTION_ICONS.ai} label={t('home:actions.ai')} onPress={onNewWithAi} testID="quick-new-ai" />
      </View>
      <View style={styles.row}>
        <Tile
          icon={QUICK_ACTION_ICONS.whatsapp}
          label={t('home:actions.whatsapp')}
          disabled={!whatsappReady}
          onPress={whatsappReady ? onWhatsApp : undefined}
          accessibilityLabel={t(whatsappReady ? 'home:actions.whatsappReadyA11y' : 'home:actions.whatsappA11y')}
          testID="quick-whatsapp"
        />
        <Tile icon={QUICK_ACTION_ICONS.notes} label={t('home:actions.notes')} onPress={onNotes} testID="quick-notes" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    gap: TILE_GAP,
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    gap: TILE_GAP,
  },
  tile: {
    flex: 1,
    minHeight: 76,
    borderRadius: radii.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.55,
  },
});
