/**
 * Header of the Main group screens (owner: shell), rendered through the stack's `header` option
 * (src/navigation/RootNavigator.tsx). Flat, on the screen background, no hairline:
 * - Left: the back arrow when the stack can go back, otherwise the menu button (opens the
 *   sidebar).
 * - Title: navigation:screens.<routeName> in the live language (titleL), else the app name.
 * - Right: the language dropdown (LanguageMenu: the flag of the CURRENT language, its code and a
 *   chevron; a tap opens the list of languages, a pick applies and saves it). The theme switch and
 *   the account live in the menu and in Settings.
 * 44dp targets, Feather icons, onSurface@12% borderless ripples. No animation.
 */
import type { ReactElement } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '../i18n';
import { ROUTES } from '../navigation/routes';
import { componentMetrics, spacing, stateAlpha, typography, useAppTheme, withAlpha } from '../theme';
import { LanguageMenu } from './LanguageMenu';
import { Icon } from './ui';

export { LANGUAGE_FLAGS } from './LanguageMenu';

/** Header text never grows past this multiple of its size (it must stay on one row). */
const HEADER_MAX_FONT_SCALE = 1.4;

export interface CustomHeaderProps {
  /** Route name (title from navigation:screens.<name>); unknown names show the app name. */
  title?: string;
  onMenuPress?: () => void;
  showMenu?: boolean;
  /** Shows a back arrow instead of the menu button. */
  onBackPress?: () => void;
}

/** First letter of the display name, else of the email, else null (icon fallback). Used by the sidebar. */
export function avatarInitial(displayName: string | null | undefined, email: string | null | undefined): string | null {
  const source = displayName?.trim() || email?.trim() || '';
  const first = source.charAt(0);
  return first ? first.toUpperCase() : null;
}

export function CustomHeader({ title, onMenuPress, showMenu = true, onBackPress }: CustomHeaderProps): ReactElement {
  const { colors } = useAppTheme();
  const t = useT();
  const insets = useSafeAreaInsets();

  const appName = t('common:app.name');
  const displayTitle = title !== undefined && title in ROUTES ? t(`navigation:screens.${title}`) : appName;
  const iconRipple = {
    color: withAlpha(colors.onSurface, stateAlpha.rippleOnIcon),
    borderless: true,
    radius: componentMetrics.headerRippleRadius,
  } as const;

  return (
    <View
      style={[styles.header, { paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right, backgroundColor: colors.background }]}
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
            <Icon name="back" color={colors.onSurface} />
          </Pressable>
        ) : showMenu && onMenuPress ? (
          <Pressable
            onPress={onMenuPress}
            android_ripple={iconRipple}
            style={({ pressed }) => [styles.iconButton, pressed && Platform.OS !== 'android' && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={t('shell:header.openMenu')}
            hitSlop={4}
            testID="header-menu"
          >
            <Icon name="menu" color={colors.onSurface} />
          </Pressable>
        ) : (
          <View style={styles.iconButton} />
        )}

        <Text
          style={[styles.title, { color: colors.onSurface }]}
          numberOfLines={1}
          accessibilityRole="header"
          maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE}
        >
          {displayTitle}
        </Text>

        <LanguageMenu testID="header-language" maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {},
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
  title: {
    ...typography.titleL,
    flex: 1,
    marginHorizontal: spacing.sm,
  },
  pressed: {
    opacity: 0.6,
  },
});

export default CustomHeader;
