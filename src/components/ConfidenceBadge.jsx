// @ts-check
/**
 * AI confidence badge (0-100). Renders nothing when the confidence is unknown (null for manual
 * and imported meetings). Labels come from the "ai" namespace.
 */
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useT } from '../i18n';

/** @typedef {'sm' | 'default' | 'lg'} BadgeSize */

const LEVELS = {
  high: { backgroundColor: '#DCFCE7', textColor: '#166534', borderColor: '#BBF7D0', icon: /** @type {const} */ ('checkmark-circle') },
  medium: { backgroundColor: '#FEF3C7', textColor: '#92400E', borderColor: '#FDE68A', icon: /** @type {const} */ ('warning') },
  low: { backgroundColor: '#FEE2E2', textColor: '#991B1B', borderColor: '#FECACA', icon: /** @type {const} */ ('close-circle') },
};

const SIZES = {
  sm: { fontSize: 12, paddingHorizontal: 8, paddingVertical: 4, icon: 12 },
  default: { fontSize: 14, paddingHorizontal: 10, paddingVertical: 6, icon: 14 },
  lg: { fontSize: 16, paddingHorizontal: 12, paddingVertical: 8, icon: 16 },
};

/**
 * @param {number} value
 * @returns {'high' | 'medium' | 'low'}
 */
export function confidenceLevel(value) {
  if (value >= 90) return 'high';
  if (value >= 70) return 'medium';
  return 'low';
}

/**
 * @param {{ confidence?: number | null, showIcon?: boolean, size?: BadgeSize }} props
 */
export default function ConfidenceBadge({ confidence, showIcon = true, size = 'default' }) {
  const t = useT();
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return null;
  const value = Math.max(0, Math.min(100, Math.round(confidence)));
  const level = confidenceLevel(value);
  const config = LEVELS[level];
  const sizing = SIZES[size] ?? SIZES.default;

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: config.backgroundColor,
          borderColor: config.borderColor,
          paddingHorizontal: sizing.paddingHorizontal,
          paddingVertical: sizing.paddingVertical,
        },
      ]}
      accessible
      accessibilityLabel={t('ai:confidence.a11y', { value, level: t(`ai:confidence.${level}`) })}
    >
      {showIcon && <Ionicons name={config.icon} size={sizing.icon} color={config.textColor} style={styles.icon} />}
      <Text style={[styles.text, { color: config.textColor, fontSize: sizing.fontSize }]}>{value}%</Text>
    </View>
  );
}

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
