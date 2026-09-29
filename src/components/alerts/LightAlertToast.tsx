/**
 * LIGHT alert / post-meeting follow-up (owner: alerts): small toast at the bottom of the screen with
 * a brief chime. It can be dismissed after 3 seconds and hides itself after a while (acknowledged).
 * The follow-up variant offers "Open assistant" (AI follow-up for the meeting).
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '../../i18n';
import type { FeedbackRequest } from '../../services/alerts';
import type { AlertDisplayModel } from './alertDisplay';
import { useAlertFeedback, useLatest } from './hooks';

export interface LightAlertToastProps {
  variant: 'light' | 'followup';
  display: AlertDisplayModel;
  feedback: FeedbackRequest | null;
  /** Close button becomes available after this delay (ms). */
  dismissAfterMs: number;
  /** Auto-hide (acknowledge) after this delay (ms); null = stays until handled. */
  autoHideMs: number | null;
  onDismiss(): void;
  /** Tap on the toast: meeting details (light) / assistant (follow-up). */
  onOpen: (() => void) | null;
}

export function LightAlertToast(props: LightAlertToastProps): ReactElement {
  const { variant, display, feedback, dismissAfterMs, autoHideMs, onDismiss, onOpen } = props;
  const t = useT();
  const insets = useSafeAreaInsets();
  const [canDismiss, setCanDismiss] = useState(false);
  const [slide] = useState(() => new Animated.Value(0));
  const handledRef = useRef(false);
  const onDismissLatest = useLatest(onDismiss);

  useAlertFeedback(feedback);

  const once = (fn: () => void) => () => {
    if (handledRef.current) return;
    handledRef.current = true;
    fn();
  };

  useEffect(() => {
    Animated.timing(slide, { toValue: 1, duration: 250, useNativeDriver: true }).start();
    const enable = setTimeout(() => setCanDismiss(true), dismissAfterMs);
    return () => clearTimeout(enable);
  }, [slide, dismissAfterMs]);

  useEffect(() => {
    if (autoHideMs === null) return undefined;
    const timer = setTimeout(() => {
      if (handledRef.current) return;
      handledRef.current = true;
      onDismissLatest.current();
    }, autoHideMs);
    return () => clearTimeout(timer);
  }, [autoHideMs, onDismissLatest]);

  const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [80, 0] });
  const isFollowUp = variant === 'followup';

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: insets.bottom + 16 }]}>
      <Animated.View style={[styles.toast, { opacity: slide, transform: [{ translateY }] }]} accessibilityRole="alert">
        <Pressable style={styles.body} onPress={onOpen ? once(onOpen) : undefined} disabled={!onOpen}>
          <Ionicons
            name={isFollowUp ? 'chatbubbles-outline' : 'notifications-outline'}
            size={22}
            color={isFollowUp ? '#A5B4FC' : '#93C5FD'}
          />
          <View style={styles.texts}>
            <Text style={styles.heading}>{isFollowUp ? t('alerts:followUp.heading') : t('alerts:light.heading')}</Text>
            <Text style={styles.title} numberOfLines={2}>
              {isFollowUp
                ? t('alerts:followUp.body', { title: display.title, interpolation: { escapeValue: false } })
                : display.title}
            </Text>
            {isFollowUp ? null : (
              <Text style={styles.when} numberOfLines={1}>
                {`${display.whenText} · ${display.timeText}`}
              </Text>
            )}
          </View>
        </Pressable>
        {isFollowUp && onOpen ? (
          <Pressable style={styles.action} onPress={once(onOpen)} accessibilityRole="button">
            <Text style={styles.actionText}>{t('alerts:buttons.openAssistant')}</Text>
          </Pressable>
        ) : null}
        <Pressable
          style={[styles.close, !canDismiss && styles.closeDisabled]}
          onPress={canDismiss ? once(onDismiss) : undefined}
          disabled={!canDismiss}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('alerts:buttons.dismiss')}
          accessibilityState={{ disabled: !canDismiss }}
        >
          <Ionicons name="close" size={20} color="#E5E7EB" />
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 12,
    right: 12,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(17, 24, 39, 0.92)',
    borderRadius: 14,
    paddingVertical: 12,
    paddingLeft: 14,
    paddingRight: 8,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  body: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  texts: {
    flex: 1,
  },
  heading: {
    color: '#9CA3AF',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
    marginTop: 2,
  },
  when: {
    color: '#D1D5DB',
    fontSize: 13,
    marginTop: 2,
  },
  action: {
    backgroundColor: '#4F46E5',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginLeft: 8,
  },
  actionText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  close: {
    padding: 6,
    marginLeft: 4,
  },
  closeDisabled: {
    opacity: 0.25,
  },
});
