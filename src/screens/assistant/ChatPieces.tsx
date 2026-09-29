/**
 * Building blocks of the assistant chat: avatar, message bubbles, typing indicator, suggestion
 * chips, the inline error notice and the usage pill. Module-level components (never created
 * during render); colors come from the assistant palette (light / dark).
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useEffect, useState, type ReactElement } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import type { AssistantPalette, ErrorDescription, UsageDescription } from '../../services/ai/presentation';
import type { AssistantFormatter, ChatMessage } from '../../services/ai/types';
import { messageTime } from './chatModel';

/** Small pills and chips stay usable at large font sizes. */
export const PILL_MAX_FONT_SCALE = 1.5;
/** Extra touch area for the 36 dp buttons (48 dp targets). */
export const SMALL_HIT_SLOP = { top: 6, bottom: 6, left: 4, right: 4 } as const;

export function AssistantAvatar({ palette }: { palette: AssistantPalette }): ReactElement {
  return (
    <View
      style={[styles.avatar, { backgroundColor: palette.surfaceAlt }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <MaterialCommunityIcons name="robot-outline" size={18} color={palette.primary} />
    </View>
  );
}

export function TypingIndicator({ palette, label }: { palette: AssistantPalette; label: string }): ReactElement {
  const [dots] = useState(() => [new Animated.Value(0.3), new Animated.Value(0.3), new Animated.Value(0.3)]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.stagger(
        160,
        dots.map((dot) =>
          Animated.sequence([
            Animated.timing(dot, { toValue: 1, duration: 280, useNativeDriver: true }),
            Animated.timing(dot, { toValue: 0.3, duration: 280, useNativeDriver: true }),
          ]),
        ),
      ),
    );
    loop.start();
    return () => loop.stop();
  }, [dots]);

  return (
    <View style={styles.assistantRow} accessible accessibilityLiveRegion="polite" accessibilityLabel={label} testID="typing-indicator">
      <AssistantAvatar palette={palette} />
      <View style={[styles.bubble, styles.typingBubble, { backgroundColor: palette.assistantBubble }]}>
        <View style={styles.dots}>
          {dots.map((dot, index) => (
            <Animated.View key={index} style={[styles.dot, { backgroundColor: palette.textMuted, opacity: dot }]} />
          ))}
        </View>
        <Text style={[styles.typingText, { color: palette.textMuted }]}>{label}</Text>
      </View>
    </View>
  );
}

export function WelcomeBubble({ palette, text }: { palette: AssistantPalette; text: string }): ReactElement {
  return (
    <View style={styles.assistantRow}>
      <AssistantAvatar palette={palette} />
      <View style={[styles.bubble, styles.assistantBubble, { backgroundColor: palette.assistantBubble }]}>
        <Text style={[styles.messageText, { color: palette.onAssistantBubble }]}>{text}</Text>
      </View>
    </View>
  );
}

export function MessageBubble({
  message,
  fmt,
  palette,
  followUpTitle,
}: {
  message: ChatMessage;
  fmt: AssistantFormatter;
  palette: AssistantPalette;
  followUpTitle: string | null;
}): ReactElement {
  const time = messageTime(fmt, message.createdAt);
  const hasText = message.content.trim().length > 0;

  if (message.role === 'user') {
    return (
      <View style={styles.userRow} testID={`message-${message.id}`}>
        <View
          style={[styles.bubble, styles.userBubble, { backgroundColor: palette.userBubble }]}
          accessible
          accessibilityLabel={fmt.t('ai:chat.a11yUserMessage', { time, text: message.content })}
        >
          <Text style={[styles.messageText, { color: palette.onUserBubble }]} selectable>
            {message.content}
          </Text>
          <Text style={[styles.time, { color: palette.onUserBubble }]}>{time}</Text>
        </View>
        {message.delivery === 'failed' ? (
          <View style={styles.failedLine}>
            <MaterialCommunityIcons name="alert-circle-outline" size={14} color={palette.danger} />
            <Text style={[styles.failedText, { color: palette.danger }]}>{fmt.t('ai:chat.notSent')}</Text>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.assistantRow} testID={`message-${message.id}`}>
      <AssistantAvatar palette={palette} />
      <View style={styles.assistantColumn}>
        {message.followUpMeetingId ? (
          <Text style={[styles.followUpTag, { color: palette.primary }]}>
            {followUpTitle ? fmt.t('ai:chat.followUpFor', { title: followUpTitle }) : fmt.t('ai:chat.followUpGeneric')}
          </Text>
        ) : null}
        {hasText ? (
          <View
            style={[styles.bubble, styles.assistantBubble, { backgroundColor: palette.assistantBubble }]}
            accessible
            accessibilityLabel={fmt.t('ai:chat.a11yAssistantMessage', { time, text: message.content })}
          >
            <Text style={[styles.messageText, { color: palette.onAssistantBubble }]} selectable>
              {message.content}
            </Text>
            <Text style={[styles.time, { color: palette.textMuted }]}>{time}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

export function SuggestionChips({
  items,
  onPress,
  palette,
  disabled,
  title = null,
}: {
  items: readonly string[];
  onPress: (text: string) => void;
  palette: AssistantPalette;
  disabled: boolean;
  title?: string | null;
}): ReactElement | null {
  if (items.length === 0) return null;
  return (
    <View style={styles.suggestions}>
      {title ? (
        <Text style={[styles.suggestionsTitle, { color: palette.textMuted }]} accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      <View style={styles.chipWrap}>
        {items.map((item) => (
          <Pressable
            key={item}
            onPress={() => onPress(item)}
            disabled={disabled}
            hitSlop={SMALL_HIT_SLOP}
            style={[styles.chip, { backgroundColor: palette.surface, borderColor: palette.border, opacity: disabled ? 0.5 : 1 }]}
            accessibilityRole="button"
            accessibilityState={{ disabled }}
          >
            <Text style={[styles.chipText, { color: palette.text }]}>{item}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function ErrorNotice({
  description,
  canRetry,
  onRetry,
  onUpgrade,
  palette,
  fmt,
}: {
  description: ErrorDescription;
  canRetry: boolean;
  onRetry: () => void;
  onUpgrade: () => void;
  palette: AssistantPalette;
  fmt: AssistantFormatter;
}): ReactElement {
  return (
    <View
      style={[styles.errorBox, { backgroundColor: palette.dangerSurface, borderColor: palette.danger }]}
      accessibilityLiveRegion="assertive"
      testID="assistant-error"
    >
      <View style={styles.errorLine}>
        <MaterialCommunityIcons name="alert-circle-outline" size={18} color={palette.danger} />
        <Text style={[styles.errorText, { color: palette.text }]}>{description.message}</Text>
      </View>
      <View style={styles.buttonRow}>
        {description.recovery === 'upgrade' ? (
          <Pressable
            onPress={onUpgrade}
            hitSlop={SMALL_HIT_SLOP}
            style={[styles.smallButton, { backgroundColor: palette.primary }]}
            accessibilityRole="button"
            testID="assistant-upgrade"
          >
            <Text style={[styles.smallButtonText, { color: palette.onPrimary }]}>{fmt.t('ai:errors.upgrade')}</Text>
          </Pressable>
        ) : null}
        {canRetry && description.recovery !== 'none' ? (
          <Pressable
            onPress={onRetry}
            hitSlop={SMALL_HIT_SLOP}
            style={[styles.smallButton, styles.secondaryButton, { borderColor: palette.border }]}
            accessibilityRole="button"
            testID="assistant-retry"
          >
            <Text style={[styles.smallButtonText, { color: palette.text }]}>{fmt.t('ai:chat.retry')}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function UsagePill({ usage, palette }: { usage: UsageDescription | null; palette: AssistantPalette }): ReactElement | null {
  if (!usage) return null;
  const color = usage.exhausted ? palette.danger : palette.textMuted;
  return (
    <View
      style={[styles.usagePill, { borderColor: usage.exhausted ? palette.danger : palette.border }]}
      accessible
      accessibilityLabel={usage.accessibilityLabel}
      testID="assistant-usage"
    >
      <MaterialCommunityIcons name="lightning-bolt-outline" size={14} color={color} />
      <Text style={[styles.usageText, { color }]} maxFontSizeMultiplier={PILL_MAX_FONT_SCALE}>
        {usage.label}
      </Text>
    </View>
  );
}

export const chatStyles = StyleSheet.create({
  smallButton: {
    minHeight: 36,
    borderRadius: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButton: {
    borderWidth: 1,
  },
  smallButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: 8,
  },
});

const styles = StyleSheet.create({
  ...chatStyles,
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userRow: {
    alignItems: 'flex-end',
  },
  assistantRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  assistantColumn: {
    flex: 1,
    gap: 4,
    alignItems: 'flex-start',
  },
  bubble: {
    maxWidth: '85%',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  userBubble: {
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    borderTopLeftRadius: 4,
  },
  typingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dots: {
    flexDirection: 'row',
    gap: 4,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  typingText: {
    fontSize: 13,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 21,
  },
  time: {
    fontSize: 11,
    marginTop: 4,
    alignSelf: 'flex-end',
    opacity: 0.8,
  },
  followUpTag: {
    fontSize: 12,
    fontWeight: '700',
  },
  failedLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  failedText: {
    fontSize: 12,
    fontWeight: '600',
  },
  suggestions: {
    gap: 6,
  },
  suggestionsTitle: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    minHeight: 36,
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipText: {
    fontSize: 14,
  },
  errorBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  errorLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  errorText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 19,
  },
  usagePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  usageText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
