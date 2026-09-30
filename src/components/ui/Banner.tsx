/**
 * Inline notice banner (owner: shell / Foundation; docs/DESIGN_SYSTEM.md §5): r-md, semantic
 * Container bg, 20dp icon, bodyM text (optional labelL title line above), optional trailing
 * text action. Announced politely to
 * screen readers; slides in softly (skipped under "reduce motion"). Used for offline / error
 * notices next to cached content (§8) — never instead of ErrorState when nothing is cached.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useEffect, useState, type ComponentProps, type ReactElement } from 'react';
import { Animated, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { componentMetrics, pressedOpacity, radii, spacing, typography, useAppTheme, type MGColors } from '../../theme';
import { useReducedMotion } from './useReducedMotion';

export type BannerTone = 'info' | 'warning' | 'error';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export interface BannerAction {
  label: string;
  onPress: () => void;
}

export interface BannerProps {
  /** Default "info". */
  tone?: BannerTone;
  /** Default icon per tone (information / alert / alert-circle outline). */
  icon?: IconName;
  /** Optional labelL heading rendered above `text`. */
  title?: string;
  text: string;
  action?: BannerAction;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const DEFAULT_ICONS: Readonly<Record<BannerTone, IconName>> = {
  info: 'information-outline',
  warning: 'alert-outline',
  error: 'alert-circle-outline',
};

function toneColors(colors: MGColors, tone: BannerTone): { bg: string; fg: string } {
  switch (tone) {
    case 'warning':
      return { bg: colors.warningContainer, fg: colors.onWarningContainer };
    case 'error':
      return { bg: colors.errorContainer, fg: colors.onErrorContainer };
    default:
      return { bg: colors.infoContainer, fg: colors.onInfoContainer };
  }
}

const SLIDE_MS = 200;
const SLIDE_FROM = -8;

export function Banner({ tone = 'info', icon, title, text, action, style, testID }: BannerProps): ReactElement {
  const { colors } = useAppTheme();
  const reduceMotion = useReducedMotion();
  const [progress] = useState(() => new Animated.Value(0));
  const { bg, fg } = toneColors(colors, tone);

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: reduceMotion ? 0 : SLIDE_MS,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, reduceMotion]);

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [SLIDE_FROM, 0] });

  return (
    <Animated.View
      style={[styles.banner, { backgroundColor: bg, opacity: progress, transform: [{ translateY }] }, style]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      testID={testID}
    >
      <MaterialCommunityIcons
        name={icon ?? DEFAULT_ICONS[tone]}
        size={componentMetrics.iconInline}
        color={fg}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
      <View style={styles.texts}>
        {title ? <Text style={[styles.title, { color: fg }]}>{title}</Text> : null}
        <Text style={[styles.text, { color: fg }]}>{text}</Text>
      </View>
      {action ? (
        <Pressable
          onPress={action.onPress}
          hitSlop={12}
          style={({ pressed }) => [pressed && styles.pressed]}
          accessibilityRole="button"
          testID={testID ? `${testID}-action` : undefined}
        >
          <Text style={[styles.actionLabel, { color: fg }]}>{action.label}</Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  texts: {
    flex: 1,
  },
  title: {
    ...typography.labelL,
  },
  text: {
    ...typography.bodyM,
  },
  actionLabel: {
    ...typography.labelL,
  },
  pressed: {
    opacity: pressedOpacity,
  },
});
