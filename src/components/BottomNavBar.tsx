/**
 * Floating bottom navigation bar of the Main group (owner: shell). Rendered ONCE under the
 * navigator (src/navigation/RootNavigator.tsx), like the sidebar, so no screen remounts on a tap.
 *
 * - A detached pill (surface, r-xxl, soft shadow) on the screen background, 16dp from the sides
 *   and 8dp above the system bar: Home, Meetings, the AI assistant in the middle, Calendar, Tasks
 *   (typed Main routes, BOTTOM_BAR_ITEMS); everything else stays in the menu. A tap goes through
 *   navigateToTopLevel (back to the existing screen instead of pushing another copy).
 * - The assistant is a 56dp orb on the `ai` gradient raised above the pill with a colored
 *   floating shadow; it breathes (1.00 -> 1.06, 2.4 s) until the chat is open and stays still
 *   under "reduce motion". It is on every main screen, the chat included.
 * - Regular tabs: Feather line icons through the kit's Icon; the active tab gets a
 *   secondaryContainer pill that springs in behind the icon and an onSurface label.
 * - The bar owns the bottom safe-area inset (the Main group gives its screens a 0 bottom inset,
 *   see MainGroup in RootNavigator).
 */
import { useEffect, useState, type ReactElement } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { MainStackParamList, RouteName } from '../core/contracts';
import { useT } from '../i18n';
import { navigateToTopLevel } from '../navigation/navigationService';
import { componentMetrics, floatingShadow, motion, radii, softShadow, spacing, stateAlpha, typography, useAppTheme, withAlpha } from '../theme';
import { GradientSurface, Icon, PressableScale, useReducedMotion, type IconName } from './ui';

export interface BottomBarItem {
  route: keyof MainStackParamList;
  icon: IconName;
  /** "ai" renders the raised gradient orb instead of a regular tab. */
  kind?: 'tab' | 'ai';
}

/** Tabs, in order (labels: shell:bottomBar.items.<route>). */
export const BOTTOM_BAR_ITEMS: readonly BottomBarItem[] = [
  { route: 'Dashboard', icon: 'home' },
  { route: 'TotalMeetings', icon: 'meetings' },
  { route: 'AIChat', icon: 'ai', kind: 'ai' },
  { route: 'Calendar', icon: 'calendar' },
  { route: 'Tasks', icon: 'tasks' },
];

/** Labels never grow past this multiple of their size (one row per tab). */
const LABEL_MAX_FONT_SCALE = 1.3;
const ORB_SIZE = 56;
const ORB_RAISE = 22;
const BREATH_MS = 1200;
const BREATH_SCALE = 1.06;
const BAR_MARGIN = componentMetrics.screenGutter;
const BAR_LIFT = spacing.sm;

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
        <Icon name={item.icon} size={22} color={active ? colors.onSecondaryContainer : colors.onSurfaceVariant} />
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
        <GradientSurface variant="ai" style={[styles.orb, { borderColor: active ? withAlpha(colors.surface, 0.9) : colors.surface }]}>
          <Icon name="ai" size={26} color={onGradient.ai} />
        </GradientSurface>
      </Animated.View>
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

export function BottomNavBar({ currentRouteName }: BottomNavBarProps): ReactElement {
  const { colors, isDark } = useAppTheme();
  const t = useT();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.host,
        {
          paddingBottom: insets.bottom + BAR_LIFT,
          paddingLeft: insets.left + BAR_MARGIN,
          paddingRight: insets.right + BAR_MARGIN,
          backgroundColor: colors.background,
        },
      ]}
      testID="bottom-bar-host"
    >
      <View
        style={[
          styles.bar,
          { backgroundColor: isDark ? colors.elevation.level2 : colors.surface, borderColor: colors.outlineVariant, borderWidth: isDark ? 1 : 0 },
        ]}
        accessibilityRole="tablist"
        testID="bottom-bar"
      >
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
  host: {
    // The orb rises above the pill.
    paddingTop: ORB_RAISE,
    overflow: 'visible',
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    minHeight: componentMetrics.bottomBarHeight,
    borderRadius: radii.xxl,
    paddingHorizontal: spacing.xs,
    ...softShadow,
    overflow: 'visible',
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
    overflow: 'hidden',
  },
});

export default BottomNavBar;
