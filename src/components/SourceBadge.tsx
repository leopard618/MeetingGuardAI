/**
 * Meeting source badge. Accepts the domain keys (manual | ai_chat | whatsapp | google | device)
 * and, while older views still exist, the legacy labels ("Manual", "ChatGPT", "WhatsApp", "IA",
 * ...). Labels come from the "ai" namespace; colors follow the app theme.
 */
import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../contexts/ThemeContext';
import { MEETING_SOURCES, type MeetingSource } from '../core/types';
import { useT } from '../i18n';
import { BADGE_MAX_FONT_SCALE, BADGE_SIZES, type BadgeSize } from './ConfidenceBadge';

interface SourceStyle {
  backgroundColor: string;
  textColor: string;
  borderColor: string;
}

const SOURCE_ICONS: Readonly<Record<MeetingSource, ComponentProps<typeof Ionicons>['name']>> = {
  manual: 'person',
  ai_chat: 'sparkles',
  whatsapp: 'logo-whatsapp',
  google: 'logo-google',
  device: 'calendar',
};

const LIGHT: Readonly<Record<MeetingSource, SourceStyle>> = {
  manual: { backgroundColor: '#F1F5F9', textColor: '#475569', borderColor: '#E2E8F0' },
  ai_chat: { backgroundColor: '#F3E8FF', textColor: '#7C3AED', borderColor: '#DDD6FE' },
  whatsapp: { backgroundColor: '#DCFCE7', textColor: '#166534', borderColor: '#BBF7D0' },
  google: { backgroundColor: '#DBEAFE', textColor: '#1D4ED8', borderColor: '#BFDBFE' },
  device: { backgroundColor: '#FFEDD5', textColor: '#C2410C', borderColor: '#FED7AA' },
};

const DARK: Readonly<Record<MeetingSource, SourceStyle>> = {
  manual: { backgroundColor: '#1E293B', textColor: '#CBD5E1', borderColor: '#334155' },
  ai_chat: { backgroundColor: '#2E1065', textColor: '#C4B5FD', borderColor: '#5B21B6' },
  whatsapp: { backgroundColor: '#052E1A', textColor: '#86EFAC', borderColor: '#166534' },
  google: { backgroundColor: '#172554', textColor: '#93C5FD', borderColor: '#1E40AF' },
  device: { backgroundColor: '#3B1D0A', textColor: '#FDBA74', borderColor: '#9A3412' },
};

/** Legacy labels (lower-cased, spaces as "_") => domain key. */
const SOURCE_ALIASES: Readonly<Record<string, MeetingSource>> = {
  manual: 'manual',
  chatgpt: 'ai_chat',
  ai: 'ai_chat',
  ia: 'ai_chat',
  'ai-chat': 'ai_chat',
  openai: 'ai_chat',
  whatsapp: 'whatsapp',
  google_calendar: 'google',
  googlecalendar: 'google',
  apple: 'device',
};

/** Domain source key for a domain key or a legacy label; anything unknown is 'manual'. */
export function sourceKey(source: unknown): MeetingSource {
  if (typeof source !== 'string') return 'manual';
  if ((MEETING_SOURCES as readonly string[]).includes(source)) return source as MeetingSource;
  const normalized = source.trim().toLowerCase().replace(/\s+/g, '_');
  if ((MEETING_SOURCES as readonly string[]).includes(normalized)) return normalized as MeetingSource;
  return SOURCE_ALIASES[normalized] ?? 'manual';
}

export interface SourceBadgeProps {
  source?: MeetingSource | string | null;
  size?: BadgeSize;
}

export function SourceBadge({ source, size = 'default' }: SourceBadgeProps): ReactElement {
  const t = useT();
  const { isDarkMode } = useTheme() as { isDarkMode: boolean };
  const key = sourceKey(source);
  const colors = (isDarkMode ? DARK : LIGHT)[key];
  const sizing = BADGE_SIZES[size] ?? BADGE_SIZES.default;
  const label = t(`ai:source.${key}`);

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
      accessibilityLabel={t('ai:source.a11y', { source: label })}
      testID="source-badge"
    >
      <Ionicons name={SOURCE_ICONS[key]} size={sizing.icon} color={colors.textColor} style={styles.icon} />
      <Text style={[styles.text, { color: colors.textColor, fontSize: sizing.fontSize }]} maxFontSizeMultiplier={BADGE_MAX_FONT_SCALE}>
        {label}
      </Text>
    </View>
  );
}

export default SourceBadge;

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
