/**
 * Dashboard hero (the client's mockup, November 1 and 2, 2026): a full-bleed block under the status
 * bar that holds the screen's own header row (menu button that opens the sidebar, logo and
 * wordmark, language pill with the country flag and a chevron) and the greeting: the day part in
 * small spaced capitals, the first name in display size, the date, and a short accent bar. The
 * next-meeting card below it is pulled up over its bottom edge (CARD_OVERLAP). The stack header is
 * hidden on the dashboard (RootNavigator), so this is the only header of the screen.
 *
 * Layers, bottom to top: the scheme's hero gradient; the artwork (DASHBOARD_ART.heroBackground,
 * light or dark picture) drawn at the hero's width and anchored to the BOTTOM, so the glass
 * calendar sits below the header row instead of under the language pill; a top fade from the
 * gradient's first color so the picture's upper edge blends in; a left-to-right scrim behind the
 * text; a bottom fade into the page background so the hero has no hard edge beside the card. In
 * light mode the artwork is pale and the text is dark; in dark mode the text is white.
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
import { DASHBOARD_ART, HERO_ART_RATIO } from './dashboardArt';

const APP_LOGO = require('../../../assets/icon.png') as number;

/** How far the next-meeting card rises over the hero's bottom edge. */
export const CARD_OVERLAP = 28;
/** Height of the fade from the gradient into the artwork's top edge. */
const TOP_FADE = 150;
/** Height of the fade from the hero into the page background. */
const BOTTOM_FADE = 72;
/** Minimum hero height as a share of its width, so the artwork has room below the header. */
const MIN_HEIGHT_RATIO = 0.56;
const TRANSPARENT = 'rgba(0,0,0,0)';

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
  const { colors, gradients, isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { language, setLanguage, supportedLanguages } = useLanguage();
  const sidebar = useOptionalSidebar();
  const focused = useIsFocused();
  const next = nextLanguage(language, supportedLanguages);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const onLayout = (event: LayoutChangeEvent): void => {
    const { width, height } = event.nativeEvent.layout;
    setSize((current) => (current && current.width === width && current.height === height ? current : { width, height }));
  };

  const art = isDark ? DASHBOARD_ART.heroBackground.dark : DASHBOARD_ART.heroBackground.light;
  const onHero = isDark ? '#FFFFFF' : colors.onBackground;
  const onHeroMuted = withAlpha(onHero, isDark ? 0.78 : 0.7);
  const base = gradients.hero[0] ?? colors.primary;
  const pillBackground = isDark ? withAlpha('#061A4F', 0.6) : withAlpha('#FFFFFF', 0.72);
  const pillBorder = withAlpha(isDark ? '#FFFFFF' : colors.primary, 0.28);
  const ripple = withAlpha(onHero, 0.18);
  const minHeight = size ? Math.round(size.width * MIN_HEIGHT_RATIO) : undefined;

  return (
    <LinearGradient
      onLayout={onLayout}
      colors={gradients.hero}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[
        styles.hero,
        { minHeight, paddingTop: insets.top + spacing.xs, paddingLeft: insets.left + spacing.lg, paddingRight: insets.right + spacing.lg },
      ]}
      testID={testID}
    >
      {focused ? <StatusBar style={isDark ? 'light' : 'dark'} /> : null}
      {art && size ? (
        <>
          <Image
            source={art}
            style={[styles.art, { width: size.width, height: Math.round(size.width * HERO_ART_RATIO) }]}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
          />
          <LinearGradient colors={[base, TRANSPARENT]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={[styles.fade, { height: TOP_FADE }]} pointerEvents="none" />
          <LinearGradient
            colors={[withAlpha(base, isDark ? 0.7 : 0.55), TRANSPARENT]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 0.62, y: 0.5 }}
            style={styles.fill}
            pointerEvents="none"
          />
        </>
      ) : null}
      <LinearGradient
        colors={[TRANSPARENT, colors.background]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={[styles.bottomFade, { height: BOTTOM_FADE }]}
        pointerEvents="none"
      />

      <View style={styles.headerRow}>
        {sidebar ? (
          <Pressable
            onPress={sidebar.open}
            android_ripple={{ color: ripple, borderless: true, radius: componentMetrics.headerRippleRadius }}
            style={({ pressed }) => [styles.iconButton, pressed && Platform.OS !== 'android' && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={t('shell:header.openMenu')}
            hitSlop={4}
            testID="header-menu"
          >
            <Icon name="menu" color={onHero} />
          </Pressable>
        ) : (
          <View style={styles.iconButton} />
        )}
        <Image source={APP_LOGO} style={styles.logo} accessibilityIgnoresInvertColors />
        <Text style={[styles.wordmark, { color: onHero }]} numberOfLines={1} maxFontSizeMultiplier={1.3} accessibilityRole="header">
          {t('common:app.shortName')}
        </Text>
        <Pressable
          onPress={() => {
            void setLanguage(next);
          }}
          style={({ pressed }) => [styles.languagePill, { backgroundColor: pillBackground, borderColor: pillBorder }, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={t('shell:header.switchLanguage', { language: t(`common:language.${next}`) })}
          hitSlop={4}
          testID="header-language"
        >
          <Text style={styles.flag} maxFontSizeMultiplier={1.3} testID="header-language-flag">
            {LANGUAGE_FLAGS[language]}
          </Text>
          <Text style={[styles.languageText, { color: onHero }]} maxFontSizeMultiplier={1.3}>
            {language.toUpperCase()}
          </Text>
          <Icon name="chevronDown" size={componentMetrics.iconMeta} color={onHero} />
        </Pressable>
      </View>

      <View style={styles.greeting}>
        {name ? (
          <>
            <Text style={[styles.salute, { color: onHeroMuted }]} numberOfLines={1} maxFontSizeMultiplier={1.3} testID="dashboard-greeting">
              {salute.toUpperCase()}
            </Text>
            <Text style={[styles.name, { color: onHero }]} numberOfLines={1} maxFontSizeMultiplier={1.2} accessibilityRole="header" testID="dashboard-greeting-name">
              {name}
            </Text>
          </>
        ) : (
          <Text style={[styles.nameOnly, { color: onHero }]} numberOfLines={2} maxFontSizeMultiplier={1.2} accessibilityRole="header" testID="dashboard-greeting">
            {salute}
          </Text>
        )}
        <Text style={[styles.date, { color: onHeroMuted }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
          {dateText}
        </Text>
        <View style={[styles.accentBar, { backgroundColor: isDark ? '#5B8DEF' : colors.primary }]} />
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  hero: {
    // Full bleed: the list content is inset by the screen gutter.
    marginHorizontal: -componentMetrics.screenGutter,
    paddingBottom: CARD_OVERLAP + spacing.xl,
    overflow: 'hidden',
  },
  art: {
    position: 'absolute',
    left: 0,
    bottom: 0,
  },
  fade: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  fill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  bottomFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
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
    borderWidth: 1,
  },
  flag: {
    fontSize: 16,
    lineHeight: 20,
  },
  languageText: {
    ...typography.labelM,
  },
  greeting: {
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.lg,
  },
  salute: {
    ...typography.labelM,
    letterSpacing: 3,
  },
  name: {
    ...typography.displayS,
    marginTop: spacing.xs,
  },
  nameOnly: {
    ...typography.headlineL,
  },
  date: {
    ...typography.bodyL,
    marginTop: spacing.xs,
  },
  accentBar: {
    width: 48,
    height: 3,
    borderRadius: radii.full,
    marginTop: spacing.md,
  },
  pressed: {
    opacity: 0.7,
  },
});
