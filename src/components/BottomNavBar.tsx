/**
 * Bottom navigation bar of the Main group (owner: shell). Rendered ONCE under the navigator
 * (src/navigation/RootNavigator.tsx), like the sidebar, so no screen remounts when a tab is tapped.
 *
 * - Items are typed Main routes (BOTTOM_BAR_ITEMS): five top-level destinations; everything else
 *   stays in the sidebar. A tap goes through navigateToTopLevel (back to the existing screen of
 *   that name instead of pushing another copy).
 * - Hidden on the AI chat (immersive, its composer owns the bottom edge); the bar then collapses to
 *   the bottom safe-area strip, so the screens never see the inset change (the Main group gives its
 *   screens a 0 bottom inset: the bar owns it, see MainBottomInsets in RootNavigator).
 * - MG Indigo shell chrome: surface bg, 1px outlineVariant top hairline, active item =
 *   secondaryContainer pill behind the icon + onSecondaryContainer icon + onSurface label,
 *   inactive onSurfaceVariant. Role "tab" with the selected state for screen readers.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps, ReactElement } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../contexts/ThemeContext';
import type { MainStackParamList, RouteName } from '../core/contracts';
import { useT } from '../i18n';
import { navigateToTopLevel } from '../navigation/navigationService';
import { componentMetrics, radii, spacing, stateAlpha, typography, withAlpha } from '../theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

export interface BottomBarItem {
  route: keyof MainStackParamList;
  icon: IconName;
  activeIcon: IconName;
}

/** Tabs, in order (labels: shell:bottomBar.items.<route>). */
export const BOTTOM_BAR_ITEMS: readonly BottomBarItem[] = [
  { route: 'Dashboard', icon: 'home-outline', activeIcon: 'home' },
  { route: 'TotalMeetings', icon: 'list-outline', activeIcon: 'list' },
  { route: 'Calendar', icon: 'calendar-outline', activeIcon: 'calendar' },
  { route: 'Tasks', icon: 'checkbox-outline', activeIcon: 'checkbox' },
  { route: 'Notes', icon: 'document-text-outline', activeIcon: 'document-text' },
];

/** Main routes without the bar (the chat's composer owns the bottom edge). */
const HIDDEN_ON: ReadonlySet<RouteName> = new Set<RouteName>(['AIChat']);

/** Labels never grow past this multiple of their size (one row per tab). */
const LABEL_MAX_FONT_SCALE = 1.3;

/** true when the bar is shown on `routeName` (null = navigator not ready yet = initial route). */
export function isBottomBarVisible(routeName: RouteName | null): boolean {
  return routeName === null || !HIDDEN_ON.has(routeName);
}

export interface BottomNavBarProps {
  currentRouteName: RouteName | null;
}

export function BottomNavBar({ currentRouteName }: BottomNavBarProps): ReactElement {
  const { colors } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();

  if (!isBottomBarVisible(currentRouteName)) {
    // Keeps the system bar area painted; the screens above run with a 0 bottom inset.
    return <View style={{ height: insets.bottom, backgroundColor: colors.surface }} testID="bottom-bar-collapsed" />;
  }

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
          return (
            <Pressable
              key={item.route}
              onPress={() => navigateToTopLevel(item.route)}
              android_ripple={{ color: withAlpha(colors.onSurface, stateAlpha.rippleOnIcon), borderless: true }}
              style={({ pressed }) => [styles.item, pressed && Platform.OS !== 'android' && styles.pressed]}
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={{ selected: active }}
              testID={`bottom-bar-item-${item.route}`}
            >
              <View style={[styles.pill, active && { backgroundColor: colors.secondaryContainer }]}>
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
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    borderTopWidth: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: componentMetrics.bottomBarHeight,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
    minHeight: componentMetrics.touchTargetMin,
  },
  pill: {
    width: componentMetrics.bottomBarPillWidth,
    height: componentMetrics.bottomBarPillHeight,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    ...typography.labelS,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
});

export default BottomNavBar;
