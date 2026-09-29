/**
 * Header of the Main group screens (owner: shell), rendered through the stack's `header` option
 * (src/navigation/RootNavigator.tsx).
 *
 * - Title: navigation:screens.<routeName> in the live language, else the app name.
 * - Left: back arrow when the stack can go back, otherwise the logo (goes to the dashboard).
 * - Right: language switch (EN <-> ES, instant, saved as the user's choice), light/dark switch,
 *   menu. Account actions (settings, sign-out) live in the sidebar.
 * - Theme-aware colors, top inset from the safe area (edge-to-edge), 44 pt touch targets.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactElement } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../contexts/ThemeContext';
import type { Language } from '../core/types';
import { useLanguage, useT } from '../i18n';
import { navigateToTopLevel } from '../navigation/navigationService';
import { ROUTES } from '../navigation/routes';
import { ThemeToggle } from './ThemeToggle';

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

  return (
    <View
      style={[styles.header, { paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right, backgroundColor: colors.surface, borderBottomColor: colors.border }]}
      testID="main-header"
    >
      <View style={styles.row}>
        {onBackPress ? (
          <Pressable
            onPress={onBackPress}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={t('shell:header.back')}
            hitSlop={4}
            testID="header-back"
          >
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </Pressable>
        ) : (
          <Pressable
            onPress={() => navigateToTopLevel('Dashboard')}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={t('shell:header.home')}
            hitSlop={4}
            testID="header-home"
          >
            <Image source={APP_LOGO} style={styles.logo} accessibilityIgnoresInvertColors />
          </Pressable>
        )}

        <Text
          style={[styles.title, { color: colors.text }]}
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
          <Text style={[styles.languageText, { color: colors.text }]} maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE}>
            {language.toUpperCase()}
          </Text>
        </Pressable>

        <ThemeToggle style={styles.spaced} testID="header-theme" />

        {showMenu && onMenuPress ? (
          <Pressable
            onPress={onMenuPress}
            style={({ pressed }) => [styles.iconButton, styles.spaced, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={t('shell:header.openMenu')}
            hitSlop={4}
            testID="header-menu"
          >
            <Ionicons name="menu" size={26} color={colors.text} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingHorizontal: 8,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: 32,
    height: 32,
    borderRadius: 8,
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    marginHorizontal: 8,
  },
  languageButton: {
    minWidth: 44,
    height: 40,
    borderRadius: 20,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  languageText: {
    fontSize: 14,
    fontWeight: '700',
  },
  spaced: {
    marginLeft: 4,
  },
  pressed: {
    opacity: 0.6,
  },
});

export default CustomHeader;
