/**
 * MAXIMUM alert (owner: alerts): full-screen modal that cannot be dismissed without an explicit
 * action (Android back button blocked, no swipe dismissal). Looping alarm with a progressive
 * volume ramp, voice readout, repeating vibration (useAlertFeedback), and an auto-snooze countdown.
 *
 * Visuals are the mode-invariant `alertMax` identity (docs/DESIGN_SYSTEM.md §9): always dark so a
 * MAX alarm reads identically day or night, every pair AA-checked by the theme contrast guard.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '../../i18n';
import type { FeedbackRequest } from '../../services/alerts';
import { alertMax, componentMetrics, pressedOpacity, radii, spacing, typography } from '../../theme';
import { useReducedMotion } from '../ui';
import type { AlertDisplayModel } from './alertDisplay';
import { useAlertFeedback, useBlockBackButton, useLatest } from './hooks';

export interface MaxAlertModalProps {
  display: AlertDisplayModel;
  /** [default, longer] snooze lengths in minutes. */
  snoozeOptions: readonly number[];
  /** Seconds before an automatic snooze (null = no countdown). */
  autoSnoozeSeconds: number | null;
  feedback: FeedbackRequest | null;
  onAcknowledge(): void;
  onSnooze(minutes: number): void;
  onJoin: (() => void) | null;
  onDetails: (() => void) | null;
}

/** Alarm-ring pulse (scale 1 -> 1.15); stays still when the system asks for reduced motion. */
function usePulse(): Animated.Value {
  const [scale] = useState(() => new Animated.Value(1));
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    if (reduceMotion) {
      scale.setValue(1);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.15, duration: 550, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 550, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [scale, reduceMotion]);
  return scale;
}

export function MaxAlertModal(props: MaxAlertModalProps): ReactElement {
  const { display, snoozeOptions, autoSnoozeSeconds, feedback, onAcknowledge, onSnooze, onJoin, onDetails } = props;
  const t = useT();
  const insets = useSafeAreaInsets();
  const pulse = usePulse();
  const [remaining, setRemaining] = useState(autoSnoozeSeconds);
  const handledRef = useRef(false);
  const defaultSnooze = snoozeOptions[0] ?? 5;
  const onSnoozeLatest = useLatest(onSnooze);

  useAlertFeedback(feedback);
  useBlockBackButton();

  // One handler per alert: the countdown and the buttons can race; only the first one wins.
  const once = (fn: () => void) => () => {
    if (handledRef.current) return;
    handledRef.current = true;
    fn();
  };

  useEffect(() => {
    if (autoSnoozeSeconds === null) return undefined;
    const timer = setInterval(() => {
      setRemaining((value) => (value === null ? null : Math.max(0, value - 1)));
    }, 1000);
    return () => clearInterval(timer);
  }, [autoSnoozeSeconds]);

  useEffect(() => {
    if (remaining === 0 && !handledRef.current) {
      handledRef.current = true;
      onSnoozeLatest.current(defaultSnooze);
    }
  }, [remaining, defaultSnooze, onSnoozeLatest]);

  const heading =
    display.phase === 'upcoming'
      ? t('alerts:max.heading')
      : display.phase === 'now'
        ? t('alerts:max.headingNow')
        : t('alerts:max.headingStarted');
  const progress = autoSnoozeSeconds && remaining !== null ? remaining / autoSnoozeSeconds : 0;

  return (
    <Modal
      visible
      transparent={false}
      animationType="fade"
      presentationStyle="fullScreen"
      statusBarTranslucent
      navigationBarTranslucent
      allowSwipeDismissal={false}
      onRequestClose={() => undefined}
    >
      <View style={[styles.screen, { paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.lg }]}>
        <ScrollView contentContainerStyle={styles.content} bounces={false}>
          <Animated.View style={[styles.iconRing, { transform: [{ scale: pulse }] }]}>
            <Ionicons name="alarm" size={56} color={alertMax.title} />
          </Animated.View>
          <Text style={styles.heading} accessibilityRole="header">
            {heading}
          </Text>
          <Text style={styles.title} accessibilityRole="alert" numberOfLines={4}>
            {display.title}
          </Text>
          <Text style={styles.when}>{display.whenText}</Text>
          <View style={styles.detailRow}>
            <Ionicons name="time-outline" size={18} color={alertMax.heading} />
            <Text style={styles.detailText}>{display.timeText}</Text>
          </View>
          {display.locationText ? (
            <View style={styles.detailRow}>
              <Ionicons name="location-outline" size={18} color={alertMax.heading} />
              <Text style={styles.detailText} numberOfLines={2}>
                {display.locationText}
              </Text>
            </View>
          ) : null}

          <View style={styles.actions}>
            <Pressable
              style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
              onPress={once(onAcknowledge)}
              accessibilityRole="button"
            >
              <Ionicons name="checkmark-circle" size={22} color={alertMax.ackText} />
              <Text style={styles.primaryText}>{t('alerts:buttons.acknowledge')}</Text>
            </Pressable>

            {onJoin ? (
              <Pressable
                style={({ pressed }) => [styles.joinButton, pressed && styles.pressed]}
                onPress={once(onJoin)}
                accessibilityRole="button"
              >
                <Ionicons name="videocam" size={20} color={alertMax.joinText} />
                <Text style={styles.joinText}>{t('alerts:buttons.join')}</Text>
              </Pressable>
            ) : null}

            <View style={styles.snoozeRow}>
              {snoozeOptions.map((minutes) => (
                <Pressable
                  key={minutes}
                  style={({ pressed }) => [styles.snoozeButton, pressed && styles.pressed]}
                  onPress={once(() => onSnooze(minutes))}
                  accessibilityRole="button"
                >
                  <Ionicons name="alarm-outline" size={18} color={alertMax.snoozeText} />
                  <Text style={styles.snoozeText}>{t('alerts:buttons.snooze', { count: minutes })}</Text>
                </Pressable>
              ))}
            </View>

            {onDetails ? (
              <Pressable style={styles.linkButton} onPress={once(onDetails)} accessibilityRole="button">
                <Text style={styles.linkText}>{t('alerts:buttons.details')}</Text>
              </Pressable>
            ) : null}
          </View>
        </ScrollView>

        {autoSnoozeSeconds !== null && remaining !== null ? (
          <View style={styles.countdown} accessibilityLabel={t('alerts:max.a11yCountdown')}>
            <View style={styles.countdownTrack}>
              <View style={[styles.countdownBar, { width: `${Math.round(progress * 100)}%` }]} />
            </View>
            <Text style={styles.countdownText}>{t('alerts:max.autoSnooze', { count: remaining })}</Text>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: alertMax.bg,
    paddingHorizontal: spacing.xl,
  },
  content: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  iconRing: {
    width: 104,
    height: 104,
    borderRadius: radii.full,
    backgroundColor: alertMax.ring,
    borderWidth: 4,
    borderColor: alertMax.ringBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  heading: {
    ...typography.labelL,
    color: alertMax.heading,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  title: {
    ...typography.displayS,
    color: alertMax.title,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  when: {
    ...typography.titleM,
    fontVariant: ['tabular-nums'],
    color: alertMax.when,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    maxWidth: '100%',
  },
  detailText: {
    ...typography.bodyL,
    fontVariant: ['tabular-nums'],
    color: alertMax.heading,
    flexShrink: 1,
  },
  actions: {
    width: '100%',
    maxWidth: 420,
    marginTop: spacing.xxl,
    gap: componentMetrics.cardGap,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: componentMetrics.alertButtonHeight,
    backgroundColor: alertMax.ackBg,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  primaryText: {
    ...typography.labelL,
    color: alertMax.ackText,
  },
  joinButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: componentMetrics.alertButtonHeight,
    backgroundColor: alertMax.joinBg,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  joinText: {
    ...typography.labelL,
    color: alertMax.joinText,
  },
  snoozeRow: {
    flexDirection: 'row',
    gap: componentMetrics.cardGap,
  },
  snoozeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: componentMetrics.alertButtonHeight,
    borderWidth: 1.5,
    borderColor: alertMax.snoozeBorder,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    gap: spacing.sm,
  },
  snoozeText: {
    ...typography.labelL,
    color: alertMax.snoozeText,
    flexShrink: 1,
  },
  linkButton: {
    alignItems: 'center',
    minHeight: componentMetrics.touchTargetMin,
    justifyContent: 'center',
    paddingVertical: spacing.sm,
  },
  linkText: {
    ...typography.labelL,
    color: alertMax.heading,
    textDecorationLine: 'underline',
  },
  pressed: {
    opacity: pressedOpacity,
  },
  countdown: {
    width: '100%',
    alignItems: 'center',
    paddingTop: spacing.sm,
  },
  countdownTrack: {
    width: '100%',
    maxWidth: 420,
    height: 6,
    borderRadius: radii.full,
    backgroundColor: alertMax.countdownTrack,
    overflow: 'hidden',
  },
  countdownBar: {
    height: 6,
    borderRadius: radii.full,
    backgroundColor: alertMax.countdownFill,
  },
  countdownText: {
    ...typography.labelS,
    fontVariant: ['tabular-nums'],
    color: alertMax.heading,
    marginTop: spacing.sm,
  },
});
