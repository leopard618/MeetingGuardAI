/**
 * Status badge / meta pill (owner: shell / Foundation; docs/v1/DESIGN_SYSTEM.md §5): r-xs, labelM,
 * semantic Container pairs - the AA-checked bg/on-bg combinations from tokens. Padding, never a
 * fixed height, so scaled text does not clip.
 */
import type { ReactElement } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { radii, spacing, typography, useAppTheme, type MGColors } from '../../theme';

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'error' | 'info';

export interface BadgeProps {
  label: string;
  /** Default "neutral". */
  tone?: BadgeTone;
  /** Optional cap for pill-like placements that must stay on one line (e.g. BADGE_MAX_FONT_SCALE). */
  maxFontSizeMultiplier?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

function toneColors(colors: MGColors, tone: BadgeTone): { bg: string; fg: string } {
  switch (tone) {
    case 'primary':
      return { bg: colors.primaryContainer, fg: colors.onPrimaryContainer };
    case 'success':
      return { bg: colors.successContainer, fg: colors.onSuccessContainer };
    case 'warning':
      return { bg: colors.warningContainer, fg: colors.onWarningContainer };
    case 'error':
      return { bg: colors.errorContainer, fg: colors.onErrorContainer };
    case 'info':
      return { bg: colors.infoContainer, fg: colors.onInfoContainer };
    default:
      return { bg: colors.surfaceVariant, fg: colors.onSurfaceVariant };
  }
}

export function Badge({ label, tone = 'neutral', maxFontSizeMultiplier, style, testID }: BadgeProps): ReactElement {
  const { colors } = useAppTheme();
  const { bg, fg } = toneColors(colors, tone);
  return (
    <View style={[styles.badge, { backgroundColor: bg }, style]} testID={testID}>
      <Text style={[styles.label, { color: fg }]} maxFontSizeMultiplier={maxFontSizeMultiplier}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: radii.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  label: {
    ...typography.labelM,
  },
});
