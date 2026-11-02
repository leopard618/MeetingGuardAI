/**
 * Header of the Main group screens (owner: shell), rendered through the stack's `header` option
 * (src/navigation/RootNavigator.tsx).
 *
 * Two layouts on the screen background (no app-bar chrome, no hairline):
 * - Dashboard ("welcome" layout, the reference style): the account avatar on the LEFT (the
 *   user's initial on the primary gradient; opens the menu), "Welcome back" with the user's first
 *   name next to it, then the EN <-> ES pill and a bell that opens Settings > Alerts.
 * - Every other screen: back arrow when the stack can go back (otherwise the logo, which goes to
 *   the dashboard), the title (navigation:screens.<routeName> in the live language, else the app
 *   name), the EN <-> ES pill and the avatar on the right.
 * The theme switch lives in the menu and in Settings. 44dp targets, Feather icons, onSurface@12%
 * borderless ripples.
 */
import type { ReactElement } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Language } from '../core/types';
import { useLanguage, useT } from '../i18n';
import { navigate, navigateToTopLevel } from '../navigation/navigationService';
import { ROUTES } from '../navigation/routes';
import { useAuth } from '../services/auth';
import { componentMetrics, radii, spacing, stateAlpha, typography, useAppTheme, withAlpha } from '../theme';
import { GradientSurface, Icon } from './ui';

const APP_LOGO = require('../../assets/icon.png') as number;

/** Header text never grows past this multiple of its size (it must stay on one row). */
const HEADER_MAX_FONT_SCALE = 1.4;
const AVATAR_SIZE = 36;
const WELCOME_AVATAR_SIZE = 40;

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

  const welcome = title === 'Dashboard';
  const appName = t('common:app.name');
  const displayTitle = title !== undefined && title in ROUTES ? t(`navigation:screens.${title}`) : appName;
  const next = nextLanguage(language, supportedLanguages);
  const initial = avatarInitial(authUser?.displayName, authUser?.email);
  const firstName = authUser?.displayName?.trim().split(/\s+/)[0] || null;
  const iconRipple = {
    color: withAlpha(colors.onSurface, stateAlpha.rippleOnIcon),
    borderless: true,
    radius: componentMetrics.headerRippleRadius,
  } as const;

  const avatar = (size: number): ReactElement => (
    <GradientSurface style={[styles.avatar, { width: size, height: size }]}>
      {initial ? (
        <Text style={[styles.avatarText, { color: onGradient.primary }]} maxFontSizeMultiplier={1.2}>
          {initial}
        </Text>
      ) : (
        <Icon name="user" size={componentMetrics.iconInline} color={onGradient.primary} />
      )}
    </GradientSurface>
  );

  const languagePill = (
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
  );

  return (
    <View
      style={[styles.header, { paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right, backgroundColor: colors.background }]}
      testID="main-header"
    >
      <View style={styles.row}>
        {welcome ? (
          <>
            {showMenu && onMenuPress ? (
              <Pressable
                onPress={onMenuPress}
                android_ripple={iconRipple}
                style={({ pressed }) => [styles.iconButton, pressed && Platform.OS !== 'android' && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={t('shell:header.openMenu')}
                hitSlop={4}
                testID="header-menu"
              >
                {avatar(WELCOME_AVATAR_SIZE)}
              </Pressable>
            ) : (
              <View style={styles.iconButton}>{avatar(WELCOME_AVATAR_SIZE)}</View>
            )}
            <View style={styles.welcome}>
              <Text style={[styles.welcomeLabel, { color: colors.onSurfaceVariant }]} numberOfLines={1} maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE}>
                {t('shell:header.welcome')}
              </Text>
              <Text style={[styles.welcomeName, { color: colors.onSurface }]} numberOfLines={1} maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE} testID="header-welcome-name">
                {firstName ?? appName}
              </Text>
            </View>
            {languagePill}
            <Pressable
              onPress={() => navigate('AlertSettings')}
              android_ripple={iconRipple}
              style={({ pressed }) => [styles.iconButton, styles.bell, { backgroundColor: colors.surfaceVariant }, pressed && Platform.OS !== 'android' && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={t('shell:header.alerts')}
              hitSlop={4}
              testID="header-alerts"
            >
              <Icon name="bell" size={componentMetrics.iconInline} color={colors.onSurface} />
            </Pressable>
          </>
        ) : (
          <>
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

            <Text
              style={[styles.title, { color: colors.onSurface }]}
              numberOfLines={1}
              accessibilityRole="header"
              maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE}
            >
              {displayTitle}
            </Text>

            {languagePill}

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
                {avatar(AVATAR_SIZE)}
              </Pressable>
            ) : null}
          </>
        )}
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
  bell: {
    marginLeft: spacing.xs,
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
  welcome: {
    flex: 1,
    marginHorizontal: spacing.sm,
  },
  welcomeLabel: {
    ...typography.labelM,
  },
  welcomeName: {
    ...typography.titleM,
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
