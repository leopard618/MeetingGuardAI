/**
 * Header of the Main group screens (owner: shell), rendered through the stack's `header` option
 * (src/navigation/RootNavigator.tsx).
 *
 * - Title: navigation:screens.<routeName> in the live language, else the app name.
 * - Left: back arrow when the stack can go back, otherwise the logo (goes to the dashboard).
 * - Right: language switch (EN <-> ES, instant, saved as the user's choice), light/dark switch,
 *   menu. Account actions (settings, sign-out) live in the sidebar.
 * - MG Indigo shell chrome (docs/v1/DESIGN_SYSTEM.md §6): surface bg, 2dp primary-gradient bottom
 *   hairline, titleL, 44dp icon targets with onSurface@12% borderless ripples, labelM language
 *   pill. Top inset from the safe area (edge-to-edge).
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactElement } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../contexts/ThemeContext';
import type { Language } from '../core/types';
import { useLanguage, useT } from '../i18n';
import { navigateToTopLevel } from '../navigation/navigationService';
import { ROUTES } from '../navigation/routes';
import { componentMetrics, radii, spacing, stateAlpha, typography, withAlpha } from '../theme';
import { ThemeToggle } from './ThemeToggle';
import { GradientSurface } from './ui';

const APP_LOGO = require('../../assets/icon.png') as number;

/** Header text never grows past this multiple of its size (it must stay on one row). */
const HEADER_MAX_FONT_SCALE = 1.4;

export interface CustomHeaderProps {
  /** Route name (title from navigation:screens.<name>); unknown names show the app name. */
  title?: string;
  onMenuPress?: () => void;
  showMenu?: boolean;
  /** Shows a back arrow instead of the logo. */
  onBackPress?: () => void;
}

export function nextLanguage(language: Language, supported: readonly Language[]): Language {
  const index = supported.indexOf(language);
  return supported[(index + 1) % supported.length] ?? language;
}

export function CustomHeader({ title, onMenuPress, showMenu = true, onBackPress }: CustomHeaderProps): ReactElement {
  const { colors } = useTheme();
  const t = useT();
  const { language, setLanguage, supportedLanguages } = useLanguage();
  const insets = useSafeAreaInsets();

  const appName = t('common:app.name');
  const displayTitle = title !== undefined && title in ROUTES ? t(`navigation:screens.${title}`) : appName;
  const next = nextLanguage(language, supportedLanguages);
  const iconRipple = {
    color: withAlpha(colors.onSurface, stateAlpha.rippleOnIcon),
    borderless: true,
    radius: componentMetrics.headerRippleRadius,
  } as const;

  return (
    <View
      style={[styles.header, { paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right, backgroundColor: colors.surface }]}
      testID="main-header"
    >
      <View style={styles.row}>
        {onBackPress ? (
          <Pressable
            onPress={onBackPress}
            android_ripple={iconRipple}
            style={({ pressed }) => [styles.iconButton, pressed && Platform.OS !== 'android' && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={t('shell:header.back')}
            hitSlop={4}
            testID="header-back"
          >
            <Ionicons name="arrow-back" size={componentMetrics.iconNav} color={colors.onSurface} />
          </Pressable>
        ) : (
          <Pressable
            onPress={() => navigateToTopLevel('Dashboard')}
            android_ripple={iconRipple}
            style={({ pressed }) => [styles.iconButton, pressed && Platform.OS !== 'android' && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={t('shell:header.home')}
            hitSlop={4}
            testID="header-home"
          >
            <Image source={APP_LOGO} style={styles.logo} accessibilityIgnoresInvertColors />
          </Pressable>
        )}

        <Text
          style={[styles.title, { color: colors.onSurface }]}
          numberOfLines={1}
          accessibilityRole="header"
          maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE}
        >
          {displayTitle}
        </Text>

        <Pressable
          onPress={() => {
            void setLanguage(next);
          }}
          style={({ pressed }) => [styles.languageButton, { backgroundColor: colors.surfaceVariant }, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={t('shell:header.switchLanguage', { language: t(`common:language.${next}`) })}
          hitSlop={4}
          testID="header-language"
        >
          <Text style={[styles.languageText, { color: colors.onSurface }]} maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE}>
            {language.toUpperCase()}
          </Text>
        </Pressable>

        <ThemeToggle style={styles.spaced} testID="header-theme" />

        {showMenu && onMenuPress ? (
          <Pressable
            onPress={onMenuPress}
            android_ripple={iconRipple}
            style={({ pressed }) => [styles.iconButton, styles.spaced, pressed && Platform.OS !== 'android' && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={t('shell:header.openMenu')}
            hitSlop={4}
            testID="header-menu"
          >
            <Ionicons name="menu" size={componentMetrics.iconNav} color={colors.onSurface} />
          </Pressable>
        ) : null}
      </View>
      <GradientSurface direction="horizontal" style={styles.hairline} pointerEvents="none" />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {},
  hairline: {
    height: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: componentMetrics.headerMinHeight,
    paddingHorizontal: spacing.sm,
  },
  iconButton: {
    width: componentMetrics.touchTargetMin,
    height: componentMetrics.touchTargetMin,
    borderRadius: componentMetrics.headerRippleRadius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: 32,
    height: 32,
    borderRadius: radii.sm,
  },
  title: {
    ...typography.titleL,
    flex: 1,
    marginHorizontal: spacing.sm,
  },
  languageButton: {
    minWidth: componentMetrics.touchTargetMin,
    minHeight: componentMetrics.buttonHeightSmall,
    borderRadius: radii.full,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  languageText: {
    ...typography.labelM,
  },
  spaced: {
    marginLeft: spacing.xs,
  },
  pressed: {
    opacity: 0.6,
  },
});

export default CustomHeader;
