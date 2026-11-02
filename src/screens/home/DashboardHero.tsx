/**
 * Dashboard hero (the client's mockup, November 1, 2026): a deep-blue block that runs under the
 * status bar and holds the screen's own header row (menu button that opens the sidebar, logo and
 * wordmark, language pill with the country flag and a chevron) and the greeting: the day part in
 * small spaced capitals, the first name in display size, the date, and a short accent bar. The
 * next-meeting card below it is pulled up over its bottom edge (CARD_OVERLAP). The stack header is
 * hidden on the dashboard (RootNavigator), so this is the only header of the screen. Behind the
 * text sits the client's artwork (DASHBOARD_ART.heroBackground, cover, calendar at the right).
 */
import { useIsFocused } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useState, type ReactElement } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LANGUAGE_FLAGS, nextLanguage } from '../../components/CustomHeader';
import { Icon } from '../../components/ui';
import { useLanguage, useT } from '../../i18n';
import { useOptionalSidebar } from '../../navigation/sidebar';
import { componentMetrics, radii, spacing, typography, useAppTheme, withAlpha } from '../../theme';
import { DASHBOARD_ART } from './dashboardArt';

const APP_LOGO = require('../../../assets/icon.png') as number;

/** How far the next-meeting card rises over the hero's bottom edge. */
export const CARD_OVERLAP = 28;
const ON_HERO = '#FFFFFF';
const ON_HERO_MUTED = withAlpha('#FFFFFF', 0.78);
const ACCENT_BAR = '#5B8DEF';

export interface DashboardHeroProps {
  /** "Good evening" (shown in spaced capitals). */
  salute: string;
  /** First name on its own display line; null shows only the salute, large. */
  name: string | null;
  dateText: string;
  testID?: string;
}

export function DashboardHero({ salute, name, dateText, testID = 'dashboard-hero' }: DashboardHeroProps): ReactElement {
  const t = useT();
  const { gradients } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { language, setLanguage, supportedLanguages } = useLanguage();
  const sidebar = useOptionalSidebar();
  const focused = useIsFocused();
  const next = nextLanguage(language, supportedLanguages);
  // The artwork gets the hero's measured size: an absolute-fill Image without explicit
  // dimensions did not draw on Android.
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const onLayout = (event: LayoutChangeEvent): void => {
    const { width, height } = event.nativeEvent.layout;
    setSize((current) => (current && current.width === width && current.height === height ? current : { width, height }));
  };

  return (
    <LinearGradient
      onLayout={onLayout}
      colors={gradients.hero}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.hero, { paddingTop: insets.top + spacing.xs, paddingLeft: insets.left + spacing.lg, paddingRight: insets.right + spacing.lg }]}
      testID={testID}
    >
      {focused ? <StatusBar style="light" /> : null}
      {DASHBOARD_ART.heroBackground && size ? (
        <Image source={DASHBOARD_ART.heroBackground} style={[styles.overlay, { width: size.width, height: size.height }]} resizeMode="cover" accessibilityIgnoresInvertColors />
      ) : null}
      <View style={styles.headerRow}>
        {sidebar ? (
          <Pressable
            onPress={sidebar.open}
            android_ripple={{ color: withAlpha(ON_HERO, 0.18), borderless: true, radius: componentMetrics.headerRippleRadius }}
            style={({ pressed }) => [styles.iconButton, pressed && Platform.OS !== 'android' && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={t('shell:header.openMenu')}
            hitSlop={4}
            testID="header-menu"
          >
            <Icon name="menu" color={ON_HERO} />
          </Pressable>
        ) : (
          <View style={styles.iconButton} />
        )}
        <Image source={APP_LOGO} style={styles.logo} accessibilityIgnoresInvertColors />
        <Text style={styles.wordmark} numberOfLines={1} maxFontSizeMultiplier={1.3} accessibilityRole="header">
          {t('common:app.shortName')}
        </Text>
        <Pressable
          onPress={() => {
            void setLanguage(next);
          }}
          style={({ pressed }) => [styles.languagePill, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={t('shell:header.switchLanguage', { language: t(`common:language.${next}`) })}
          hitSlop={4}
          testID="header-language"
        >
          <Text style={styles.flag} maxFontSizeMultiplier={1.3} testID="header-language-flag">
            {LANGUAGE_FLAGS[language]}
          </Text>
          <Text style={styles.languageText} maxFontSizeMultiplier={1.3}>
            {language.toUpperCase()}
          </Text>
          <Icon name="chevronDown" size={componentMetrics.iconMeta} color={ON_HERO} />
        </Pressable>
      </View>

      <View style={styles.greeting}>
        {name ? (
          <>
            <Text style={styles.salute} numberOfLines={1} maxFontSizeMultiplier={1.3} testID="dashboard-greeting">
              {salute.toUpperCase()}
            </Text>
            <Text style={styles.name} numberOfLines={1} maxFontSizeMultiplier={1.2} accessibilityRole="header" testID="dashboard-greeting-name">
              {name}
            </Text>
          </>
        ) : (
          <Text style={styles.nameOnly} numberOfLines={2} maxFontSizeMultiplier={1.2} accessibilityRole="header" testID="dashboard-greeting">
            {salute}
          </Text>
        )}
        <Text style={styles.date} numberOfLines={1} maxFontSizeMultiplier={1.3}>
          {dateText}
        </Text>
        <View style={styles.accentBar} />
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  hero: {
    // Full bleed: the list content is inset by the screen gutter.
    marginHorizontal: -componentMetrics.screenGutter,
    paddingBottom: CARD_OVERLAP + spacing.lg,
    overflow: 'hidden',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  headerRow: {
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
    color: ON_HERO,
    flex: 1,
    marginLeft: spacing.sm,
  },
  languagePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: componentMetrics.buttonHeightSmall - 4,
    paddingLeft: spacing.sm,
    paddingRight: spacing.sm,
    borderRadius: radii.full,
    // Solid enough to stay legible over the bright parts of the artwork.
    backgroundColor: withAlpha('#061A4F', 0.6),
    borderWidth: 1,
    borderColor: withAlpha('#FFFFFF', 0.28),
  },
  flag: {
    fontSize: 16,
    lineHeight: 20,
  },
  languageText: {
    ...typography.labelM,
    color: ON_HERO,
  },
  greeting: {
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.lg,
  },
  salute: {
    ...typography.labelM,
    color: ON_HERO_MUTED,
    letterSpacing: 3,
  },
  name: {
    ...typography.displayS,
    color: ON_HERO,
    marginTop: spacing.xs,
  },
  nameOnly: {
    ...typography.headlineL,
    color: ON_HERO,
  },
  date: {
    ...typography.bodyL,
    color: ON_HERO_MUTED,
    marginTop: spacing.xs,
  },
  accentBar: {
    width: 48,
    height: 3,
    borderRadius: radii.full,
    backgroundColor: ACCENT_BAR,
    marginTop: spacing.md,
  },
  pressed: {
    opacity: 0.7,
  },
});
