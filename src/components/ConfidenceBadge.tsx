/**
 * AI confidence badge (0-100). Renders nothing when the confidence is unknown (null for manual
 * and imported meetings). Labels come from the "ai" namespace; colors follow the app theme.
 */
import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../contexts/ThemeContext';
import { useT } from '../i18n';

export type BadgeSize = 'sm' | 'default' | 'lg';
export type ConfidenceLevel = 'high' | 'medium' | 'low';

interface BadgeColors {
  backgroundColor: string;
  textColor: string;
  borderColor: string;
}

const LEVEL_ICONS: Readonly<Record<ConfidenceLevel, ComponentProps<typeof Ionicons>['name']>> = {
  high: 'checkmark-circle',
  medium: 'warning',
  low: 'close-circle',
};

const LIGHT: Readonly<Record<ConfidenceLevel, BadgeColors>> = {
  high: { backgroundColor: '#DCFCE7', textColor: '#166534', borderColor: '#BBF7D0' },
  medium: { backgroundColor: '#FEF3C7', textColor: '#92400E', borderColor: '#FDE68A' },
  low: { backgroundColor: '#FEE2E2', textColor: '#991B1B', borderColor: '#FECACA' },
};

const DARK: Readonly<Record<ConfidenceLevel, BadgeColors>> = {
  high: { backgroundColor: '#052E1A', textColor: '#86EFAC', borderColor: '#166534' },
  medium: { backgroundColor: '#3A2A0A', textColor: '#FCD34D', borderColor: '#92400E' },
  low: { backgroundColor: '#3B1414', textColor: '#FCA5A5', borderColor: '#991B1B' },
};

export const BADGE_SIZES: Readonly<Record<BadgeSize, { fontSize: number; paddingHorizontal: number; paddingVertical: number; icon: number }>> = {
  sm: { fontSize: 12, paddingHorizontal: 8, paddingVertical: 4, icon: 12 },
  default: { fontSize: 14, paddingHorizontal: 10, paddingVertical: 6, icon: 14 },
  lg: { fontSize: 16, paddingHorizontal: 12, paddingVertical: 8, icon: 16 },
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
  const { isDarkMode } = useTheme();
  const value = normalizeConfidence(confidence);
  if (value === null) return null;
  const level = confidenceLevel(value);
  const colors = (isDarkMode ? DARK : LIGHT)[level];
  const sizing = BADGE_SIZES[size] ?? BADGE_SIZES.default;

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: colors.backgroundColor,
          borderColor: colors.borderColor,
          paddingHorizontal: sizing.paddingHorizontal,
          paddingVertical: sizing.paddingVertical,
        },
      ]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={t('ai:confidence.a11y', { value, level: t(`ai:confidence.${level}`) })}
      testID="confidence-badge"
    >
      {showIcon ? <Ionicons name={LEVEL_ICONS[level]} size={sizing.icon} color={colors.textColor} style={styles.icon} /> : null}
      <Text style={[styles.text, { color: colors.textColor, fontSize: sizing.fontSize }]} maxFontSizeMultiplier={BADGE_MAX_FONT_SCALE}>
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
    borderRadius: 12,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  icon: {
    marginRight: 4,
  },
  text: {
    fontWeight: '500',
  },
});
