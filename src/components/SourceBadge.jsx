// @ts-check
/**
 * Meeting source badge. Accepts the domain keys (manual | ai_chat | whatsapp | google | device)
 * and the legacy labels stage-3 screens still pass ("Manual", "ChatGPT", "WhatsApp", "IA", ...).
 */
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { normalizeMeetingSource } from '../core/legacy';
import { useT } from '../i18n';

/** @typedef {import('../core/types').MeetingSource} MeetingSource */

/** @type {Record<MeetingSource, { backgroundColor: string, textColor: string, borderColor: string, icon: import('react').ComponentProps<typeof Ionicons>['name'] }>} */
const SOURCES = {
  manual: { backgroundColor: '#F1F5F9', textColor: '#475569', borderColor: '#E2E8F0', icon: 'person' },
  ai_chat: { backgroundColor: '#F3E8FF', textColor: '#7C3AED', borderColor: '#DDD6FE', icon: 'sparkles' },
  whatsapp: { backgroundColor: '#DCFCE7', textColor: '#166534', borderColor: '#BBF7D0', icon: 'logo-whatsapp' },
  google: { backgroundColor: '#DBEAFE', textColor: '#1D4ED8', borderColor: '#BFDBFE', icon: 'logo-google' },
  device: { backgroundColor: '#FFEDD5', textColor: '#C2410C', borderColor: '#FED7AA', icon: 'calendar' },
};

const SIZES = {
  sm: { fontSize: 12, paddingHorizontal: 8, paddingVertical: 4, icon: 12 },
  default: { fontSize: 14, paddingHorizontal: 10, paddingVertical: 6, icon: 14 },
  lg: { fontSize: 16, paddingHorizontal: 12, paddingVertical: 8, icon: 16 },
};

/**
 * Domain source key for a new key or a legacy label ("IA" was the old Spanish label for AI).
 * @param {unknown} source
 * @returns {MeetingSource}
 */
export function sourceKey(source) {
  if (typeof source === 'string' && source.trim().toUpperCase() === 'IA') return 'ai_chat';
  return normalizeMeetingSource(source);
}

/**
 * @param {{ source?: string | null, size?: 'sm' | 'default' | 'lg' }} props
 */
export default function SourceBadge({ source, size = 'default' }) {
  const t = useT();
  const key = sourceKey(source);
  const config = SOURCES[key];
  const sizing = SIZES[size] ?? SIZES.default;
  const label = t(`ai:source.${key}`);

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
      accessibilityLabel={t('ai:source.a11y', { source: label })}
    >
      <Ionicons name={config.icon} size={sizing.icon} color={config.textColor} style={styles.icon} />
      <Text style={[styles.text, { color: config.textColor, fontSize: sizing.fontSize }]}>{label}</Text>
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
