/**
 * MEDIUM alert (owner: alerts): large persistent banner at the top of the screen with a pulse
 * animation. It can be minimized to a pill but not dismissed: it stays until the user
 * acknowledges, snoozes, joins or opens the meeting. One chime + voice + vibration on appearance.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '../../i18n';
import type { FeedbackRequest } from '../../services/alerts';
import type { AlertDisplayModel } from './alertDisplay';
import { useAlertFeedback } from './hooks';

export interface MediumAlertBannerProps {
  display: AlertDisplayModel;
  snoozeMinutes: number;
  feedback: FeedbackRequest | null;
  onAcknowledge(): void;
  onSnooze(minutes: number): void;
  onJoin: (() => void) | null;
  onDetails: (() => void) | null;
}

function usePulse(): Animated.Value {
  const [value] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(value, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [value]);
  return value;
}

export function MediumAlertBanner(props: MediumAlertBannerProps): ReactElement {
  const { display, snoozeMinutes, feedback, onAcknowledge, onSnooze, onJoin, onDetails } = props;
  const t = useT();
  const insets = useSafeAreaInsets();
  const pulse = usePulse();
  const [minimized, setMinimized] = useState(false);
  const handledRef = useRef(false);

  useAlertFeedback(feedback);

  const once = (fn: () => void) => () => {
    if (handledRef.current) return;
    handledRef.current = true;
    fn();
  };

  const dotScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] });
  const dotOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.35] });
  const cardScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.015] });

  if (minimized) {
    return (
      <View pointerEvents="box-none" style={[styles.pillWrap, { top: insets.top + 8 }]}>
        <Pressable
          style={styles.pill}
          onPress={() => setMinimized(false)}
          accessibilityRole="button"
          accessibilityLabel={t('alerts:medium.a11yPill')}
        >
          <Animated.View style={[styles.dot, { transform: [{ scale: dotScale }], opacity: dotOpacity }]} />
          <Text style={styles.pillText} numberOfLines={1}>
            {t('alerts:medium.pill', {
              title: display.title,
              when: display.whenText,
              interpolation: { escapeValue: false },
            })}
          </Text>
          <Ionicons name="chevron-down" size={16} color="#FDE68A" />
        </Pressable>
      </View>
    );
  }

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + 8 }]}>
      <Animated.View style={[styles.banner, { transform: [{ scale: cardScale }] }]} accessibilityRole="alert">
        <View style={styles.headerRow}>
          <Animated.View style={[styles.dot, { transform: [{ scale: dotScale }], opacity: dotOpacity }]} />
          <Text style={styles.heading}>{t('alerts:medium.heading')}</Text>
          <Pressable
            onPress={() => setMinimized(true)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t('alerts:buttons.minimize')}
          >
            <Ionicons name="chevron-up" size={22} color="#E5E7EB" />
          </Pressable>
        </View>
        <Pressable onPress={onDetails ? once(onDetails) : undefined} disabled={!onDetails}>
          <Text style={styles.title} numberOfLines={2}>
            {display.title}
          </Text>
          <Text style={styles.when}>{display.whenText}</Text>
          <Text style={styles.detail} numberOfLines={1}>
            {display.locationText ? `${display.timeText} · ${display.locationText}` : display.timeText}
          </Text>
        </Pressable>
        <View style={styles.actions}>
          <Pressable
            style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
            onPress={once(onAcknowledge)}
            accessibilityRole="button"
          >
            <Text style={styles.primaryText}>{t('alerts:buttons.acknowledge')}</Text>
          </Pressable>
          {onJoin ? (
            <Pressable
              style={({ pressed }) => [styles.join, pressed && styles.pressed]}
              onPress={once(onJoin)}
              accessibilityRole="button"
            >
              <Text style={styles.joinText}>{t('alerts:buttons.join')}</Text>
            </Pressable>
          ) : null}
          <Pressable
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
            onPress={once(() => onSnooze(snoozeMinutes))}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryText}>{t('alerts:buttons.snooze', { count: snoozeMinutes })}</Text>
          </Pressable>
        </View>
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
  banner: {
    backgroundColor: 'rgba(17, 24, 39, 0.94)',
    borderRadius: 16,
    borderLeftWidth: 6,
    borderLeftColor: '#F59E0B',
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#F59E0B',
    marginRight: 8,
  },
  heading: {
    flex: 1,
    color: '#FDE68A',
    fontSize: 14,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 19,
    fontWeight: '700',
    marginBottom: 4,
  },
  when: {
    color: '#FBBF24',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  detail: {
    color: '#D1D5DB',
    fontSize: 14,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
  },
  primary: {
    backgroundColor: '#F59E0B',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  primaryText: {
    color: '#111827',
    fontWeight: '700',
    fontSize: 15,
  },
  join: {
    backgroundColor: '#16A34A',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  joinText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
  secondary: {
    borderWidth: 1,
    borderColor: '#6B7280',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  secondaryText: {
    color: '#E5E7EB',
    fontWeight: '600',
    fontSize: 15,
  },
  pressed: {
    opacity: 0.75,
  },
  pillWrap: {
    position: 'absolute',
    right: 12,
    maxWidth: '80%',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(17, 24, 39, 0.94)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#F59E0B',
    paddingVertical: 8,
    paddingHorizontal: 12,
    gap: 6,
    elevation: 10,
  },
  pillText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
  },
});
