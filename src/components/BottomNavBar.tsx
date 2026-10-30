/**
 * Bottom navigation bar of the Main group (owner: shell). Rendered ONCE under the navigator
 * (src/navigation/RootNavigator.tsx), like the sidebar, so no screen remounts when a tab is tapped.
 *
 * - Items are typed Main routes (BOTTOM_BAR_ITEMS): Home, Meetings, the AI assistant in the
 *   middle, Calendar, Tasks; everything else stays in the sidebar. A tap goes through
 *   navigateToTopLevel (back to the existing screen of that name instead of pushing another copy).
 * - The assistant is a raised 56dp orb on the `ai` gradient with a colored floating shadow; it
 *   breathes (scale 1 -> 1.06, 2.4 s loop) until the chat is open and stays still under "reduce
 *   motion". Replaces the old floating assistant button: it is on every main screen, including
 *   the chat itself (the composer sits right above the bar).
 * - Regular tabs: a secondaryContainer pill springs in behind the active (filled) icon; labels
 *   labelS, onSurface when active, onSurfaceVariant otherwise. Role "tab" + selected state.
 * - The bar owns the bottom safe-area inset (the Main group gives its screens a 0 bottom inset,
 *   see MainGroup in RootNavigator), surface bg, 1px outlineVariant top hairline.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState, type ComponentProps, type ReactElement } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { MainStackParamList, RouteName } from '../core/contracts';
import { useT } from '../i18n';
import { navigateToTopLevel } from '../navigation/navigationService';
import { componentMetrics, floatingShadow, motion, radii, spacing, stateAlpha, typography, useAppTheme, withAlpha } from '../theme';
import { GradientSurface, PressableScale, useReducedMotion } from './ui';

type IconName = ComponentProps<typeof Ionicons>['name'];

export interface BottomBarItem {
  route: keyof MainStackParamList;
  icon: IconName;
  activeIcon: IconName;
  /** "ai" renders the raised gradient orb instead of a regular tab. */
  kind?: 'tab' | 'ai';
}

/** Tabs, in order (labels: shell:bottomBar.items.<route>). */
export const BOTTOM_BAR_ITEMS: readonly BottomBarItem[] = [
  { route: 'Dashboard', icon: 'home-outline', activeIcon: 'home' },
  { route: 'TotalMeetings', icon: 'list-outline', activeIcon: 'list' },
  { route: 'AIChat', icon: 'sparkles-outline', activeIcon: 'sparkles', kind: 'ai' },
  { route: 'Calendar', icon: 'calendar-outline', activeIcon: 'calendar' },
  { route: 'Tasks', icon: 'checkbox-outline', activeIcon: 'checkbox' },
];

/** Labels never grow past this multiple of their size (one row per tab). */
const LABEL_MAX_FONT_SCALE = 1.3;
const ORB_SIZE = 56;
const ORB_RAISE = 18;
const BREATH_MS = 1200;
const BREATH_SCALE = 1.06;

export interface BottomNavBarProps {
  currentRouteName: RouteName | null;
}

function TabItem({ item, active, label }: { item: BottomBarItem; active: boolean; label: string }): ReactElement {
  const { colors } = useAppTheme();
  const reduceMotion = useReducedMotion();
  const [pill] = useState(() => new Animated.Value(active ? 1 : 0));

  useEffect(() => {
    if (reduceMotion) {
      pill.setValue(active ? 1 : 0);
      return undefined;
    }
    const animation = Animated.spring(pill, { toValue: active ? 1 : 0, useNativeDriver: true, ...motion.spring });
    animation.start();
    return () => animation.stop();
  }, [active, pill, reduceMotion]);

  return (
    <PressableScale
      onPress={() => navigateToTopLevel(item.route)}
      android_ripple={{ color: withAlpha(colors.onSurface, stateAlpha.rippleOnIcon), borderless: true }}
      style={styles.item}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      testID={`bottom-bar-item-${item.route}`}
    >
      <View style={styles.pillSlot}>
        <Animated.View
          style={[
            styles.pill,
            {
              backgroundColor: colors.secondaryContainer,
              opacity: pill,
              transform: [{ scaleX: pill.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }],
            },
          ]}
        />
        <Ionicons
          name={active ? item.activeIcon : item.icon}
          size={componentMetrics.iconNav}
          color={active ? colors.onSecondaryContainer : colors.onSurfaceVariant}
        />
      </View>
      <Text
        style={[styles.label, { color: active ? colors.onSurface : colors.onSurfaceVariant }]}
        numberOfLines={1}
        maxFontSizeMultiplier={LABEL_MAX_FONT_SCALE}
      >
        {label}
      </Text>
    </PressableScale>
  );
}

function AiOrb({ item, active, label }: { item: BottomBarItem; active: boolean; label: string }): ReactElement {
  const { colors, onGradient } = useAppTheme();
  const reduceMotion = useReducedMotion();
  const [breath] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (reduceMotion || active) {
      breath.setValue(1);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: BREATH_SCALE, duration: BREATH_MS, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breath, { toValue: 1, duration: BREATH_MS, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, breath, reduceMotion]);

  return (
    <PressableScale
      onPress={() => navigateToTopLevel(item.route)}
      style={styles.item}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      testID={`bottom-bar-item-${item.route}`}
    >
      <Animated.View style={[styles.orbShadow, { transform: [{ scale: breath }] }]}>
        <GradientSurface variant="ai" style={[styles.orb, active && { borderColor: withAlpha(colors.surface, 0.9) }]}>
          <Ionicons name={active ? item.activeIcon : item.icon} size={26} color={onGradient.ai} />
        </GradientSurface>
      </Animated.View>
      <Text
        style={[styles.label, styles.orbLabel, { color: active ? colors.onSurface : colors.onSurfaceVariant }]}
        numberOfLines={1}
        maxFontSizeMultiplier={LABEL_MAX_FONT_SCALE}
      >
        {label}
      </Text>
    </PressableScale>
  );
}

export function BottomNavBar({ currentRouteName }: BottomNavBarProps): ReactElement {
  const { colors } = useAppTheme();
  const t = useT();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.bar,
        {
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
          paddingRight: insets.right,
          backgroundColor: colors.surface,
          borderTopColor: colors.outlineVariant,
        },
      ]}
      accessibilityRole="tablist"
      testID="bottom-bar"
    >
      <View style={styles.row}>
        {BOTTOM_BAR_ITEMS.map((item) => {
          const active = currentRouteName === item.route;
          const label = t(`shell:bottomBar.items.${item.route}`);
          return item.kind === 'ai' ? (
            <AiOrb key={item.route} item={item} active={active} label={label} />
          ) : (
            <TabItem key={item.route} item={item} active={active} label={label} />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    borderTopWidth: 1,
    // The orb rises above the top edge.
    overflow: 'visible',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    minHeight: componentMetrics.bottomBarHeight,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
    minHeight: componentMetrics.touchTargetMin,
  },
  pillSlot: {
    width: componentMetrics.bottomBarPillWidth,
    height: componentMetrics.bottomBarPillHeight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: radii.full,
  },
  label: {
    ...typography.labelS,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  orbShadow: {
    marginTop: -ORB_RAISE,
    borderRadius: radii.full,
    ...floatingShadow,
    // Android ignores shadow* and draws from elevation; iOS needs a background to cast from.
    backgroundColor: Platform.OS === 'ios' ? '#4646D3' : 'transparent',
  },
  orb: {
    width: ORB_SIZE,
    height: ORB_SIZE,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: 'transparent',
    overflow: 'hidden',
  },
  orbLabel: {
    marginTop: spacing.xs,
  },
});

export default BottomNavBar;
