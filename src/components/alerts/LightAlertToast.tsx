/**
 * LIGHT alert / post-meeting follow-up (owner: alerts): small toast at the bottom of the screen with
 * a brief chime. It can be dismissed after 3 seconds and hides itself after a while (acknowledged).
 * The follow-up variant offers "Open assistant" (AI follow-up for the meeting).
 *
 * Visuals are the mode-invariant `alertLight` identity (docs/DESIGN_SYSTEM.md §9): an always-dark
 * elevated card with an indigo icon, identical in light and dark mode, every pair AA-checked.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '../../i18n';
import type { FeedbackRequest } from '../../services/alerts';
import { alertLight, componentMetrics, darkColors, pressedDimOpacity, radii, spacing, typography } from '../../theme';
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
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: insets.bottom + spacing.lg }]}>
      <Animated.View style={[styles.toast, { opacity: slide, transform: [{ translateY }] }]} accessibilityRole="alert">
        <Pressable style={styles.body} onPress={onOpen ? once(onOpen) : undefined} disabled={!onOpen}>
          <Ionicons
            name={isFollowUp ? 'chatbubbles-outline' : 'notifications-outline'}
            size={componentMetrics.iconInline}
            color={alertLight.icon}
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
          <Pressable
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
            onPress={once(onOpen)}
            accessibilityRole="button"
          >
            <Text style={styles.actionText}>{t('alerts:buttons.openAssistant')}</Text>
          </Pressable>
        ) : null}
        <Pressable
          style={[styles.close, !canDismiss && styles.closeDisabled]}
          onPress={canDismiss ? once(onDismiss) : undefined}
          disabled={!canDismiss}
          accessibilityRole="button"
          accessibilityLabel={t('alerts:buttons.dismiss')}
          accessibilityState={{ disabled: !canDismiss }}
        >
          <Ionicons name="close" size={20} color={alertLight.body} />
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: alertLight.bg,
    borderRadius: radii.lg,
    paddingVertical: spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
    shadowColor: darkColors.shadow,
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  body: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  texts: {
    flex: 1,
  },
  heading: {
    ...typography.labelM,
    color: alertLight.body,
  },
  title: {
    ...typography.labelL,
    color: alertLight.title,
    marginTop: spacing.xs,
  },
  when: {
    ...typography.bodyS,
    fontVariant: ['tabular-nums'],
    color: alertLight.body,
    marginTop: spacing.xs,
  },
  action: {
    minHeight: componentMetrics.buttonHeightSmall,
    justifyContent: 'center',
    backgroundColor: alertLight.actionBg,
    borderRadius: radii.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginLeft: spacing.sm,
  },
  actionText: {
    ...typography.labelL,
    color: alertLight.actionText,
  },
  close: {
    width: componentMetrics.touchTargetMin,
    height: componentMetrics.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeDisabled: {
    opacity: 0.25,
  },
  pressed: {
    opacity: pressedDimOpacity,
  },
});
