/**
 * Floating bottom navigation bar of the Main group (owner: shell). Rendered ONCE under the
 * navigator (src/navigation/RootNavigator.tsx), like the sidebar, so no screen remounts on a tap.
 *
 * - A detached pill (surface in light, charcoal in dark, faint border, soft shadow) on the screen
 *   background, 16dp from the sides and 8dp above the system bar: Home, Meetings, the AI
 *   assistant in the middle, Calendar, Tasks (typed Main routes, BOTTOM_BAR_ITEMS); everything
 *   else stays in the menu. A tap goes through navigateToTopLevel (back to the existing screen
 *   instead of pushing another copy).
 * - Icons only (the reference style): the active tab is a 44dp circle on the primary gradient
 *   with a white icon, the others are muted Feather icons. Each item carries its label as the
 *   accessibility label (shell:bottomBar.items.<route>).
 * - The assistant is a 56dp orb on the `ai` gradient raised above the pill with a colored
 *   floating shadow, a soft glow underneath and tiny sparks twinkling around it; it breathes
 *   (1.00 -> 1.06, 2.4 s) until the chat is open and stays still under "reduce motion".
 * - The bar owns the bottom safe-area inset (the Main group gives its screens a 0 bottom inset,
 *   see MainGroup in RootNavigator).
 */
import { useEffect, useState, type ReactElement } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { MainStackParamList, RouteName } from '../core/contracts';
import { useT } from '../i18n';
import { navigateToTopLevel } from '../navigation/navigationService';
import { componentMetrics, floatingShadow, motion, radii, softShadow, spacing, useAppTheme, withAlpha } from '../theme';
import { Glow, GradientSurface, Icon, PressableScale, Sparkles, useReducedMotion, type IconName } from './ui';

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

const ACTIVE_SIZE = 44;
const ORB_SIZE = 56;
const ORB_RAISE = 22;
/** Square stage around the orb for the glow and the sparks. */
const ORB_STAGE = 104;

/** Cheap luminance test on a hex color (the sparks are pale on dark grounds, indigo on light). */
function isDarkColor(hex: string): boolean {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return false;
  const value = parseInt(match[1] ?? '0', 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
}
const BREATH_MS = 1200;
const BREATH_SCALE = 1.06;
const BAR_MARGIN = componentMetrics.screenGutter;
const BAR_LIFT = spacing.sm;

export interface BottomNavBarProps {
  currentRouteName: RouteName | null;
}

function TabItem({ item, active, label }: { item: BottomBarItem; active: boolean; label: string }): ReactElement {
  const { colors, onGradient } = useAppTheme();
  const reduceMotion = useReducedMotion();
  const [pop] = useState(() => new Animated.Value(active ? 1 : 0));

  useEffect(() => {
    if (reduceMotion) {
      pop.setValue(active ? 1 : 0);
      return undefined;
    }
    const animation = Animated.spring(pop, { toValue: active ? 1 : 0, useNativeDriver: true, ...motion.spring });
    animation.start();
    return () => animation.stop();
  }, [active, pop, reduceMotion]);

  return (
    <PressableScale
      onPress={() => navigateToTopLevel(item.route)}
      style={styles.item}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      testID={`bottom-bar-item-${item.route}`}
    >
      <View style={styles.slot}>
        <Animated.View style={[styles.activeCircle, { opacity: pop, transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] }]}>
          <GradientSurface style={styles.activeFill} />
        </Animated.View>
        <Icon name={item.icon} size={22} color={active ? onGradient.primary : colors.onSurfaceVariant} />
      </View>
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
      <View style={styles.orbStage}>
        <Glow color={colors.primary} size={ORB_STAGE} intensity={active ? 0.5 : 0.32} style={styles.orbLayer} />
        <Animated.View style={[styles.orbShadow, { transform: [{ scale: breath }] }]}>
          <GradientSurface variant="ai" style={[styles.orb, { borderColor: active ? withAlpha('#FFFFFF', 0.85) : colors.surface }]}>
            <Icon name="ai" size={26} color={onGradient.ai} />
          </GradientSurface>
        </Animated.View>
        <Sparkles color={isDarkColor(colors.background) ? '#DCE0FF' : colors.primary} size={ORB_STAGE} style={styles.orbLayer} />
      </View>
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
          {
            backgroundColor: isDark ? colors.elevation.level2 : withAlpha('#FFFFFF', 0.96),
            borderColor: isDark ? withAlpha('#FFFFFF', 0.08) : withAlpha('#FFFFFF', 0.9),
          },
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
    alignItems: 'center',
    height: componentMetrics.bottomBarHeight,
    borderRadius: radii.xxl,
    borderWidth: 1,
    paddingHorizontal: spacing.xs,
    ...softShadow,
    overflow: 'visible',
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: componentMetrics.touchTargetMin,
  },
  slot: {
    width: ACTIVE_SIZE,
    height: ACTIVE_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeCircle: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: radii.full,
    overflow: 'hidden',
  },
  activeFill: {
    flex: 1,
  },
  orbStage: {
    width: ORB_STAGE,
    height: ORB_STAGE,
    marginTop: -ORB_RAISE - (ORB_STAGE - ORB_SIZE) / 2 + spacing.xs,
    marginBottom: -(ORB_STAGE - ORB_SIZE) / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbLayer: {
    left: 0,
    top: 0,
  },
  orbShadow: {
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
