/**
 * Fixed top bar of the dashboard (client, November 2, 2026: "the header bar is moving with the
 * dashboard"). Rendered OVER the scrolling list, not inside it: menu button that opens the
 * sidebar, logo and wordmark, the language dropdown (LanguageMenu: flag, code, chevron, and the
 * list of languages under it). While the hero is
 * on screen the bar is transparent and its text takes the hero's text color; once the list has
 * scrolled past the hero (`scrolled`) it gets the page background and a hairline so it stays
 * legible over the content. Height = status bar inset + headerMinHeight (the hero pads for it).
 */
import type { ReactElement } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LanguageMenu } from '../../components/LanguageMenu';
import { Icon } from '../../components/ui';
import { useT } from '../../i18n';
import { useOptionalSidebar } from '../../navigation/sidebar';
import { componentMetrics, radii, spacing, typography, useAppTheme, withAlpha } from '../../theme';

const APP_LOGO = require('../../../assets/icon.png') as number;

export interface DashboardTopBarProps {
  /** True once the hero has scrolled away: solid background, page text colors. */
  scrolled: boolean;
  testID?: string;
}

export function DashboardTopBar({ scrolled, testID = 'dashboard-top-bar' }: DashboardTopBarProps): ReactElement {
  const t = useT();
  const { colors, isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const sidebar = useOptionalSidebar();

  // On the hero: white in dark mode, dark on the pale light artwork. Scrolled: page colors.
  const fg = scrolled ? colors.onSurface : isDark ? '#FFFFFF' : colors.onBackground;
  const pillBackground = scrolled ? colors.surfaceVariant : isDark ? withAlpha(colors.background, 0.6) : withAlpha('#FFFFFF', 0.72);
  const pillBorder = scrolled ? 'transparent' : withAlpha(isDark ? '#FFFFFF' : colors.primary, 0.28);

  return (
    <View
      style={[
        styles.bar,
        { paddingTop: insets.top, paddingLeft: insets.left + spacing.lg, paddingRight: insets.right + spacing.lg },
        scrolled && { backgroundColor: colors.background, borderBottomColor: colors.outlineVariant, borderBottomWidth: StyleSheet.hairlineWidth },
      ]}
      pointerEvents="box-none"
      testID={testID}
    >
      <View style={styles.row} pointerEvents="box-none">
        {sidebar ? (
          <Pressable
            onPress={sidebar.open}
            android_ripple={{ color: withAlpha(fg, 0.18), borderless: true, radius: componentMetrics.headerRippleRadius }}
            style={({ pressed }) => [styles.iconButton, pressed && Platform.OS !== 'android' && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={t('shell:header.openMenu')}
            hitSlop={4}
            testID="header-menu"
          >
            <Icon name="menu" color={fg} />
          </Pressable>
        ) : (
          <View style={styles.iconButton} />
        )}
        <Image source={APP_LOGO} style={styles.logo} accessibilityIgnoresInvertColors />
        <Text style={[styles.wordmark, { color: fg }]} numberOfLines={1} maxFontSizeMultiplier={1.3} accessibilityRole="header">
          {t('common:app.shortName')}
        </Text>
        <LanguageMenu
          testID="header-language"
          color={fg}
          backgroundColor={pillBackground}
          borderColor={pillBorder}
          maxFontSizeMultiplier={1.3}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 5,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: componentMetrics.headerMinHeight,
  },
  iconButton: {
    width: componentMetrics.touchTargetMin,
    height: componentMetrics.touchTargetMin,
    borderRadius: componentMetrics.headerRippleRadius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: 28,
    height: 28,
    borderRadius: radii.sm,
    marginLeft: spacing.xs,
  },
  wordmark: {
    ...typography.titleL,
    flex: 1,
    marginLeft: spacing.sm,
  },
  pressed: {
    opacity: 0.7,
  },
});
