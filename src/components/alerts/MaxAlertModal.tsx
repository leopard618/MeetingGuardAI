/**
 * MAXIMUM alert (owner: alerts): full-screen modal that cannot be dismissed without an explicit
 * action (Android back button blocked, no swipe dismissal). Looping alarm with a progressive
 * volume ramp, voice readout, repeating vibration (useAlertFeedback), and an auto-snooze countdown.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '../../i18n';
import type { FeedbackRequest } from '../../services/alerts';
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

function usePulse(): Animated.Value {
  const [scale] = useState(() => new Animated.Value(1));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.15, duration: 550, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 550, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [scale]);
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
      <View style={[styles.screen, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 16 }]}>
        <ScrollView contentContainerStyle={styles.content} bounces={false}>
          <Animated.View style={[styles.iconRing, { transform: [{ scale: pulse }] }]}>
            <Ionicons name="alarm" size={56} color="#FFFFFF" />
          </Animated.View>
          <Text style={styles.heading} accessibilityRole="header">
            {heading}
          </Text>
          <Text style={styles.title} accessibilityRole="alert" numberOfLines={4}>
            {display.title}
          </Text>
          <Text style={styles.when}>{display.whenText}</Text>
          <View style={styles.detailRow}>
            <Ionicons name="time-outline" size={18} color="#FECACA" />
            <Text style={styles.detailText}>{display.timeText}</Text>
          </View>
          {display.locationText ? (
            <View style={styles.detailRow}>
              <Ionicons name="location-outline" size={18} color="#FECACA" />
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
              <Ionicons name="checkmark-circle" size={22} color="#991B1B" />
              <Text style={styles.primaryText}>{t('alerts:buttons.acknowledge')}</Text>
            </Pressable>

            {onJoin ? (
              <Pressable
                style={({ pressed }) => [styles.joinButton, pressed && styles.pressed]}
                onPress={once(onJoin)}
                accessibilityRole="button"
              >
                <Ionicons name="videocam" size={20} color="#FFFFFF" />
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
                  <Ionicons name="alarm-outline" size={18} color="#FFFFFF" />
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
    backgroundColor: '#7F1D1D',
    paddingHorizontal: 20,
  },
  content: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  iconRing: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: '#DC2626',
    borderWidth: 4,
    borderColor: '#FCA5A5',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  heading: {
    color: '#FECACA',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 10,
  },
  when: {
    color: '#FDE68A',
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 14,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
    maxWidth: '100%',
  },
  detailText: {
    color: '#FEE2E2',
    fontSize: 16,
    marginLeft: 6,
    flexShrink: 1,
  },
  actions: {
    width: '100%',
    maxWidth: 420,
    marginTop: 24,
    gap: 12,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 18,
    gap: 8,
  },
  primaryText: {
    color: '#991B1B',
    fontSize: 18,
    fontWeight: '800',
  },
  joinButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#16A34A',
    borderRadius: 14,
    paddingVertical: 16,
    gap: 8,
  },
  joinText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
  snoozeRow: {
    flexDirection: 'row',
    gap: 12,
  },
  snoozeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FCA5A5',
    borderRadius: 14,
    paddingVertical: 14,
    gap: 6,
  },
  snoozeText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  linkButton: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  linkText: {
    color: '#FECACA',
    fontSize: 15,
    textDecorationLine: 'underline',
  },
  pressed: {
    opacity: 0.75,
  },
  countdown: {
    width: '100%',
    alignItems: 'center',
    paddingTop: 8,
  },
  countdownTrack: {
    width: '100%',
    maxWidth: 420,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.2)',
    overflow: 'hidden',
  },
  countdownBar: {
    height: 6,
    backgroundColor: '#FDE68A',
  },
  countdownText: {
    color: '#FECACA',
    fontSize: 13,
    marginTop: 6,
  },
});
