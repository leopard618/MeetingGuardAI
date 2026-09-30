/**
 * AI confidence badge (0-100). Renders nothing when the confidence is unknown (null for manual
 * and imported meetings). Labels come from the "ai" namespace; colors are the MG semantic
 * Container pairs (high → success, medium → warning, low → error; AA in both schemes).
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps, ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useT } from '../i18n';
import { radii, spacing, typography, useAppTheme, type MGColors } from '../theme';

export type BadgeSize = 'sm' | 'default' | 'lg';
export type ConfidenceLevel = 'high' | 'medium' | 'low';

const LEVEL_ICONS: Readonly<Record<ConfidenceLevel, ComponentProps<typeof Ionicons>['name']>> = {
  high: 'checkmark-circle',
  medium: 'warning',
  low: 'close-circle',
};

function levelColors(colors: MGColors, level: ConfidenceLevel): { backgroundColor: string; textColor: string } {
  switch (level) {
    case 'high':
      return { backgroundColor: colors.successContainer, textColor: colors.onSuccessContainer };
    case 'medium':
      return { backgroundColor: colors.warningContainer, textColor: colors.onWarningContainer };
    default:
      return { backgroundColor: colors.errorContainer, textColor: colors.onErrorContainer };
  }
}

/** Badge type scale per size (labelS / labelM / labelL) with 4pt-grid padding. */
export const BADGE_SIZES: Readonly<Record<BadgeSize, { fontSize: number; lineHeight: number; paddingHorizontal: number; paddingVertical: number; icon: number }>> = {
  sm: { fontSize: typography.labelS.fontSize, lineHeight: typography.labelS.lineHeight, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, icon: 12 },
  default: { fontSize: typography.labelM.fontSize, lineHeight: typography.labelM.lineHeight, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, icon: 14 },
  lg: { fontSize: typography.labelL.fontSize, lineHeight: typography.labelL.lineHeight, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, icon: 16 },
};

/** Badges stay readable at large font sizes without breaking the row they sit in. */
export const BADGE_MAX_FONT_SCALE = 1.6;

export function confidenceLevel(value: number): ConfidenceLevel {
  if (value >= 90) return 'high';
  if (value >= 70) return 'medium';
  return 'low';
}

/** Rounded 0-100 value, or null when the confidence is unknown. */
export function normalizeConfidence(confidence: unknown): number | null {
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return null;
  return Math.max(0, Math.min(100, Math.round(confidence)));
}

export interface ConfidenceBadgeProps {
  confidence?: number | null;
  showIcon?: boolean;
  size?: BadgeSize;
}

export function ConfidenceBadge({ confidence, showIcon = true, size = 'default' }: ConfidenceBadgeProps): ReactElement | null {
  const t = useT();
  const { colors } = useAppTheme();
  const value = normalizeConfidence(confidence);
  if (value === null) return null;
  const level = confidenceLevel(value);
  const { backgroundColor, textColor } = levelColors(colors, level);
  const sizing = BADGE_SIZES[size] ?? BADGE_SIZES.default;

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor,
          paddingHorizontal: sizing.paddingHorizontal,
          paddingVertical: sizing.paddingVertical,
        },
      ]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={t('ai:confidence.a11y', { value, level: t(`ai:confidence.${level}`) })}
      testID="confidence-badge"
    >
      {showIcon ? <Ionicons name={LEVEL_ICONS[level]} size={sizing.icon} color={textColor} style={styles.icon} /> : null}
      <Text
        style={[styles.text, { color: textColor, fontSize: sizing.fontSize, lineHeight: sizing.lineHeight }]}
        maxFontSizeMultiplier={BADGE_MAX_FONT_SCALE}
      >
        {`${value}%`}
      </Text>
    </View>
  );
}

export default ConfidenceBadge;

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.xs,
    alignSelf: 'flex-start',
  },
  icon: {
    marginRight: spacing.xs,
  },
  text: {
    fontWeight: '500',
  },
});
