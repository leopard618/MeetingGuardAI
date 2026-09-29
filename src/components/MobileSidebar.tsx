/**
 * Slide-in navigation menu of the Main group (owner: shell). Rendered ONCE next to the navigator
 * (src/navigation/sidebar.tsx) and opened from the header.
 *
 * - Items are typed Main routes (SIDEBAR_ITEMS), so a removed route fails to compile.
 * - Live language and theme switches; sign-out goes through the shared flow (useSignOutFlow),
 *   which asks again when unsynced changes would be lost (AppError 'pending_writes').
 * - Theme-aware colors, safe-area insets, hardware back / scrim tap closes it, respects
 *   "reduce motion", keeps focus inside while open (accessibilityViewIsModal).
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState, type ComponentProps, type ReactElement } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { THEME_MODES, useTheme, type AppColors, type ThemeMode } from '../contexts/ThemeContext';
import type { MainStackParamList, RouteName } from '../core/contracts';
import { useLanguage, useT } from '../i18n';
import { navigateToTopLevel } from '../navigation/navigationService';
import { useSignOutFlow } from '../navigation/useSignOut';
import { useAuth } from '../services/auth';

const APP_LOGO = require('../../assets/icon.png') as number;

const ANIMATION_MS = 220;
const MAX_WIDTH = 320;

type IconName = ComponentProps<typeof Ionicons>['name'];

export interface SidebarItem {
  route: keyof MainStackParamList;
  icon: IconName;
}

/** Menu destinations, in order (labels: shell:sidebar.items.<route>). */
export const SIDEBAR_ITEMS: readonly SidebarItem[] = [
  { route: 'Dashboard', icon: 'grid-outline' },
  { route: 'ChooseCreationMethod', icon: 'add-circle-outline' },
  { route: 'TotalMeetings', icon: 'list-outline' },
  { route: 'Calendar', icon: 'calendar-outline' },
  { route: 'Notes', icon: 'document-text-outline' },
  { route: 'AIChat', icon: 'chatbubbles-outline' },
  { route: 'Pricing', icon: 'pricetags-outline' },
  { route: 'Settings', icon: 'settings-outline' },
];

const THEME_ICONS: Readonly<Record<ThemeMode, IconName>> = {
  system: 'phone-portrait-outline',
  light: 'sunny-outline',
  dark: 'moon-outline',
};

export interface MobileSidebarProps {
  visible: boolean;
  onClose(): void;
  currentRouteName?: RouteName | null;
}

function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (active) setReduceMotion(enabled);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return reduceMotion;
}

export function MobileSidebar({ visible, onClose, currentRouteName = null }: MobileSidebarProps): ReactElement | null {
  const { colors } = useTheme();
  const t = useT();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const panelWidth = Math.min(Math.round(width * 0.82), MAX_WIDTH);
  const [progress] = useState(() => new Animated.Value(0));
  // Stays mounted while the closing animation runs.
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) setMounted(true);

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: reduceMotion ? 0 : ANIMATION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished && !visible) setMounted(false);
    });
    return () => animation.stop();
  }, [visible, progress, reduceMotion]);

  if (!mounted && !visible) return null;

  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [-panelWidth, 0] });

  return (
    <Modal
      visible
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim, opacity: progress }]}>
          <Pressable
            style={styles.fill}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t('shell:sidebar.close')}
            testID="sidebar-scrim"
          />
        </Animated.View>
        <Animated.View
          style={[
            styles.panel,
            {
              width: panelWidth,
              backgroundColor: colors.surface,
              paddingTop: insets.top,
              paddingBottom: insets.bottom,
              paddingLeft: insets.left,
              transform: [{ translateX }],
            },
          ]}
          accessibilityViewIsModal
          testID="sidebar-panel"
        >
          <SidebarContent colors={colors} onClose={onClose} currentRouteName={currentRouteName} />
        </Animated.View>
      </View>
    </Modal>
  );
}

interface SidebarContentProps {
  colors: AppColors;
  onClose(): void;
  currentRouteName: RouteName | null;
}

function SidebarContent({ colors, onClose, currentRouteName }: SidebarContentProps): ReactElement {
  const t = useT();
  const { language, setLanguage, supportedLanguages } = useLanguage();
  const { themeMode, setThemeMode } = useTheme();
  const { authUser } = useAuth();
  const startSignOut = useSignOutFlow();

  const go = (route: keyof MainStackParamList) => {
    onClose();
    navigateToTopLevel(route);
  };

  return (
    <View style={styles.fill}>
      <View style={[styles.brandRow, { borderBottomColor: colors.border }]}>
        <Image source={APP_LOGO} style={styles.logo} accessibilityIgnoresInvertColors />
        <Text style={[styles.brandText, { color: colors.text }]} numberOfLines={1} accessibilityRole="header">
          {t('common:app.name')}
        </Text>
        <Pressable
          onPress={onClose}
          style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={t('shell:sidebar.close')}
          hitSlop={4}
          testID="sidebar-close"
        >
          <Ionicons name="close" size={24} color={colors.textSecondary} />
        </Pressable>
      </View>

      <ScrollView style={styles.fill} contentContainerStyle={styles.scrollContent}>
        {authUser ? (
          <View style={[styles.userCard, { backgroundColor: colors.surfaceVariant }]} testID="sidebar-user">
            <Ionicons name="person-circle-outline" size={32} color={colors.textSecondary} />
            <View style={styles.userText}>
              {authUser.displayName ? (
                <Text style={[styles.userName, { color: colors.text }]} numberOfLines={1}>
                  {authUser.displayName}
                </Text>
              ) : null}
              {authUser.email ? (
                <Text style={[styles.userEmail, { color: colors.textSecondary }]} numberOfLines={1}>
                  {authUser.email}
                </Text>
              ) : null}
            </View>
          </View>
        ) : null}

        <View accessibilityRole="menu">
          {SIDEBAR_ITEMS.map((item) => {
            const active = currentRouteName === item.route;
            return (
              <Pressable
                key={item.route}
                onPress={() => go(item.route)}
                style={({ pressed }) => [
                  styles.item,
                  active && { backgroundColor: colors.primaryContainer },
                  pressed && styles.pressed,
                ]}
                accessibilityRole="menuitem"
                accessibilityState={{ selected: active }}
                testID={`sidebar-item-${item.route}`}
              >
                <Ionicons name={item.icon} size={22} color={active ? colors.onPrimaryContainer : colors.textSecondary} />
                <Text
                  style={[styles.itemText, { color: active ? colors.onPrimaryContainer : colors.text }, active && styles.itemTextActive]}
                  numberOfLines={2}
                >
                  {t(`shell:sidebar.items.${item.route}`)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={[styles.section, { borderTopColor: colors.border }]}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t('shell:sidebar.language')}</Text>
          <View style={styles.chipRow} accessibilityRole="radiogroup" accessibilityLabel={t('shell:sidebar.language')}>
            {supportedLanguages.map((code) => {
              const selected = code === language;
              return (
                <Pressable
                  key={code}
                  onPress={() => {
                    void setLanguage(code);
                  }}
                  style={[
                    styles.chip,
                    { borderColor: selected ? colors.primary : colors.border },
                    selected && { backgroundColor: colors.primary },
                  ]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  testID={`sidebar-language-${code}`}
                >
                  <Text style={[styles.chipText, { color: selected ? colors.onPrimary : colors.text }]}>
                    {t(`common:language.${code}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t('shell:sidebar.theme')}</Text>
          <View style={styles.chipRow} accessibilityRole="radiogroup" accessibilityLabel={t('shell:sidebar.theme')}>
            {THEME_MODES.map((mode) => {
              const selected = mode === themeMode;
              return (
                <Pressable
                  key={mode}
                  onPress={() => setThemeMode(mode)}
                  style={[
                    styles.chip,
                    styles.themeChip,
                    { borderColor: selected ? colors.primary : colors.border },
                    selected && { backgroundColor: colors.primary },
                  ]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  testID={`sidebar-theme-${mode}`}
                >
                  <Ionicons name={THEME_ICONS[mode]} size={16} color={selected ? colors.onPrimary : colors.textSecondary} />
                  <Text style={[styles.chipText, styles.themeChipText, { color: selected ? colors.onPrimary : colors.text }]}>
                    {t(`shell:sidebar.themeModes.${mode}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <Pressable
          onPress={() => {
            onClose();
            startSignOut();
          }}
          style={({ pressed }) => [styles.item, pressed && styles.pressed]}
          accessibilityRole="button"
          testID="sidebar-sign-out"
        >
          <Ionicons name="log-out-outline" size={22} color={colors.danger} />
          <Text style={[styles.itemText, styles.itemTextActive, { color: colors.danger }]}>{t('common:actions.signOut')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  fill: {
    flex: 1,
  },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    elevation: 16,
    shadowColor: '#000',
    shadowOffset: { width: 2, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
    paddingRight: 4,
    minHeight: 60,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  logo: {
    width: 32,
    height: 32,
    borderRadius: 8,
    marginRight: 10,
  },
  brandText: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
  },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    paddingHorizontal: 8,
    paddingVertical: 12,
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 4,
    marginBottom: 12,
  },
  userText: {
    flex: 1,
    marginLeft: 10,
  },
  userName: {
    fontSize: 15,
    fontWeight: '600',
  },
  userEmail: {
    fontSize: 13,
    marginTop: 2,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 24,
    marginVertical: 1,
  },
  itemText: {
    flex: 1,
    fontSize: 15,
    marginLeft: 14,
  },
  itemTextActive: {
    fontWeight: '600',
  },
  section: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 12,
    paddingTop: 12,
    paddingHorizontal: 8,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 16,
  },
  chip: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    marginRight: 8,
    marginBottom: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: {
    fontSize: 14,
  },
  themeChip: {
    flexDirection: 'row',
    paddingHorizontal: 12,
  },
  themeChipText: {
    marginLeft: 6,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  pressed: {
    opacity: 0.6,
  },
});

export default MobileSidebar;
