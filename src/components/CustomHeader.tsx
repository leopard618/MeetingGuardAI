/**
 * Header of the Main group screens (owner: shell), rendered through the stack's `header` option
 * (src/navigation/RootNavigator.tsx).
 *
 * Visual refresh (October 30, 2026): no app-bar chrome. The header sits on the screen background
 * with no hairline, so a screen reads as one surface with a bold title at the top:
 * - Left: back arrow when the stack can go back, otherwise the logo (goes to the dashboard).
 * - Title: navigation:screens.<routeName> in the live language (titleL, tight tracking), else the
 *   app name. The dashboard shows no title (its greeting is the title), only the logo and the
 *   right-hand controls.
 * - Right: the EN <-> ES pill (instant, saved as the user's choice) and the account avatar (the
 *   user's initial on the primary gradient), which opens the menu. The theme switch lives in the
 *   menu and in Settings. 44dp targets, Feather icons, onSurface@12% borderless ripples.
 */
import type { ReactElement } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Language } from '../core/types';
import { useLanguage, useT } from '../i18n';
import { navigateToTopLevel } from '../navigation/navigationService';
import { ROUTES } from '../navigation/routes';
import { useAuth } from '../services/auth';
import { componentMetrics, radii, spacing, stateAlpha, typography, useAppTheme, withAlpha } from '../theme';
import { GradientSurface, Icon } from './ui';

const APP_LOGO = require('../../assets/icon.png') as number;

/** Header text never grows past this multiple of its size (it must stay on one row). */
const HEADER_MAX_FONT_SCALE = 1.4;
const AVATAR_SIZE = 36;

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

/** First letter of the display name, else of the email, else null (icon fallback). */
export function avatarInitial(displayName: string | null | undefined, email: string | null | undefined): string | null {
  const source = displayName?.trim() || email?.trim() || '';
  const first = source.charAt(0);
  return first ? first.toUpperCase() : null;
}

export function CustomHeader({ title, onMenuPress, showMenu = true, onBackPress }: CustomHeaderProps): ReactElement {
  const { colors, onGradient } = useAppTheme();
  const t = useT();
  const { language, setLanguage, supportedLanguages } = useLanguage();
  const { authUser } = useAuth();
  const insets = useSafeAreaInsets();

  const appName = t('common:app.name');
  const displayTitle = title === 'Dashboard' ? '' : title !== undefined && title in ROUTES ? t(`navigation:screens.${title}`) : appName;
  const next = nextLanguage(language, supportedLanguages);
  const initial = avatarInitial(authUser?.displayName, authUser?.email);
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

        {displayTitle ? (
          <Text
            style={[styles.title, { color: colors.onSurface }]}
            numberOfLines={1}
            accessibilityRole="header"
            maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE}
          >
            {displayTitle}
          </Text>
        ) : (
          <View style={styles.title} />
        )}

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
            <GradientSurface style={styles.avatar}>
              {initial ? (
                <Text style={[styles.avatarText, { color: onGradient.primary }]} maxFontSizeMultiplier={1.2}>
                  {initial}
                </Text>
              ) : (
                <Icon name="user" size={componentMetrics.iconInline} color={onGradient.primary} />
              )}
            </GradientSurface>
          </Pressable>
        ) : null}
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
    minHeight: componentMetrics.buttonHeightSmall - 4,
    borderRadius: radii.full,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  languageText: {
    ...typography.labelM,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarText: {
    ...typography.labelL,
  },
  spaced: {
    marginLeft: spacing.xs,
  },
  pressed: {
    opacity: 0.6,
  },
});

export default CustomHeader;
