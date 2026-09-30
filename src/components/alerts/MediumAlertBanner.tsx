/**
 * MEDIUM alert (owner: alerts): large persistent banner at the top of the screen with a pulse
 * animation. It can be minimized to a pill but not dismissed: it stays until the user
 * acknowledges, snoozes, joins or opens the meeting. One chime + voice + vibration on appearance.
 *
 * Visuals are the mode-invariant `alertMedium` identity (docs/DESIGN_SYSTEM.md §9): an elevated
 * dark card with a 4dp amber accent bar, identical in light and dark mode, every pair AA-checked.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '../../i18n';
import type { FeedbackRequest } from '../../services/alerts';
import { alertMax, alertMedium, componentMetrics, darkColors, pressedOpacity, radii, spacing, typography } from '../../theme';
import { useReducedMotion } from '../ui';
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

/** Soft dot/card pulse; stays still when the system asks for reduced motion. */
function usePulse(): Animated.Value {
  const [value] = useState(() => new Animated.Value(0));
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    if (reduceMotion) {
      value.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(value, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [value, reduceMotion]);
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
      <View pointerEvents="box-none" style={[styles.pillWrap, { top: insets.top + spacing.sm }]}>
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
          <Ionicons name="chevron-down" size={16} color={alertMedium.accentBar} />
        </Pressable>
      </View>
    );
  }

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + spacing.sm }]}>
      <Animated.View style={[styles.banner, { transform: [{ scale: cardScale }] }]} accessibilityRole="alert">
        <View style={styles.headerRow}>
          <Animated.View style={[styles.dot, { transform: [{ scale: dotScale }], opacity: dotOpacity }]} />
          <Text style={styles.heading}>{t('alerts:medium.heading')}</Text>
          <Pressable
            onPress={() => setMinimized(true)}
            style={styles.minimize}
            accessibilityRole="button"
            accessibilityLabel={t('alerts:buttons.minimize')}
          >
            <Ionicons name="chevron-up" size={22} color={alertMedium.body} />
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
    left: spacing.md,
    right: spacing.md,
  },
  banner: {
    backgroundColor: alertMedium.bg,
    borderRadius: radii.md,
    borderLeftWidth: componentMetrics.accentBarWidth,
    borderLeftColor: alertMedium.accentBar,
    padding: componentMetrics.cardPadding,
    shadowColor: darkColors.shadow,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: radii.full,
    backgroundColor: alertMedium.accentBar,
    marginRight: spacing.sm,
  },
  heading: {
    flex: 1,
    ...typography.labelM,
    color: alertMedium.accentBar,
  },
  minimize: {
    width: componentMetrics.touchTargetMin,
    height: componentMetrics.touchTargetMin,
    marginVertical: -spacing.xs,
    marginRight: -spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...typography.titleM,
    color: alertMedium.title,
    marginBottom: spacing.xs,
  },
  when: {
    ...typography.titleS,
    fontVariant: ['tabular-nums'],
    color: alertMedium.accentBar,
    marginBottom: spacing.xs,
  },
  detail: {
    ...typography.bodyM,
    fontVariant: ['tabular-nums'],
    color: alertMedium.body,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  primary: {
    minHeight: componentMetrics.buttonHeightSmall,
    justifyContent: 'center',
    backgroundColor: alertMedium.actionBg,
    borderRadius: radii.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: componentMetrics.cardPadding,
  },
  primaryText: {
    ...typography.labelL,
    color: alertMedium.actionText,
  },
  join: {
    minHeight: componentMetrics.buttonHeightSmall,
    justifyContent: 'center',
    backgroundColor: alertMax.joinBg,
    borderRadius: radii.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: componentMetrics.cardPadding,
  },
  joinText: {
    ...typography.labelL,
    color: alertMax.joinText,
  },
  secondary: {
    minHeight: componentMetrics.buttonHeightSmall,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: alertMedium.body,
    borderRadius: radii.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: componentMetrics.cardPadding,
  },
  secondaryText: {
    ...typography.labelL,
    color: alertMedium.title,
  },
  pressed: {
    opacity: pressedOpacity,
  },
  pillWrap: {
    position: 'absolute',
    right: spacing.md,
    maxWidth: '80%',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: componentMetrics.touchTargetMin,
    backgroundColor: alertMedium.bg,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: alertMedium.accentBar,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    elevation: 10,
  },
  pillText: {
    ...typography.labelM,
    color: alertMedium.title,
    flexShrink: 1,
  },
});
