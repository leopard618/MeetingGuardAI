/**
 * Header of the Main group screens (owner: shell), rendered through the stack's `header` option
 * (src/navigation/RootNavigator.tsx). Flat, on the screen background, no hairline:
 * - Left: the back arrow when the stack can go back, otherwise the menu button (opens the
 *   sidebar).
 * - Title: navigation:screens.<routeName> in the live language (titleL), else the app name.
 * - Right: the language pill with the country flag of the CURRENT language and its code
 *   (EN with the US flag, ES with the Spanish flag); a tap switches to the next language and saves
 *   it as the user's choice. The theme switch and the account live in the menu and in Settings.
 * 44dp targets, Feather icons, onSurface@12% borderless ripples. No animation.
 */
import type { ReactElement } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Language } from '../core/types';
import { useLanguage, useT } from '../i18n';
import { ROUTES } from '../navigation/routes';
import { componentMetrics, radii, spacing, stateAlpha, typography, useAppTheme, withAlpha } from '../theme';
import { Icon } from './ui';

/** Header text never grows past this multiple of its size (it must stay on one row). */
const HEADER_MAX_FONT_SCALE = 1.4;

/** Country flag shown in the language pill (regional indicator pairs; render on iOS and Android). */
export const LANGUAGE_FLAGS: Readonly<Record<Language, string>> = {
  en: '\u{1F1FA}\u{1F1F8}',
  es: '\u{1F1EA}\u{1F1F8}',
};

export interface CustomHeaderProps {
  /** Route name (title from navigation:screens.<name>); unknown names show the app name. */
  title?: string;
  onMenuPress?: () => void;
  showMenu?: boolean;
  /** Shows a back arrow instead of the menu button. */
  onBackPress?: () => void;
}

export function nextLanguage(language: Language, supported: readonly Language[]): Language {
  const index = supported.indexOf(language);
  return supported[(index + 1) % supported.length] ?? language;
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
          <Text style={styles.flag} maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE} testID="header-language-flag">
            {LANGUAGE_FLAGS[language]}
          </Text>
          <Text style={[styles.languageText, { color: colors.onSurface }]} maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE}>
            {language.toUpperCase()}
          </Text>
        </Pressable>
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
  languageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: componentMetrics.buttonHeightSmall - 4,
    borderRadius: radii.full,
    paddingLeft: spacing.sm,
    paddingRight: spacing.md,
    gap: spacing.xs,
  },
  flag: {
    fontSize: 18,
    lineHeight: 22,
  },
  languageText: {
    ...typography.labelM,
  },
  pressed: {
    opacity: 0.6,
  },
});

export default CustomHeader;
