/**
 * Dashboard hero (the client's mockup, November 1 and 2, 2026): a full-bleed panel under the status
 * bar and the fixed top bar (DashboardTopBar, which floats over the list; the hero pads for its
 * height) that holds the greeting: the day part in small spaced capitals, the first name in
 * display size, the date, and a short accent bar. The next-meeting card below it is pulled up over
 * its bottom edge (CARD_OVERLAP).
 *
 * Layers, bottom to top: the scheme's hero gradient (fallback), the artwork of the scheme
 * (DASHBOARD_ART.heroBackground: the client's dark picture extended to the panel's proportions,
 * a pale wave composition for light) covering the whole panel, a left-to-right scrim behind the
 * text, and a bottom fade into the page background so the panel has no hard edge beside the card.
 * Dark text on the pale light panel, white on the dark one.
 */
import { useIsFocused } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useState, type ReactElement } from 'react';
import { Image, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { componentMetrics, radii, spacing, typography, useAppTheme, withAlpha } from '../../theme';
import { DASHBOARD_ART, HERO_ART_RATIO } from './dashboardArt';

/** How far the next-meeting card rises over the hero's bottom edge. */
export const CARD_OVERLAP = 28;
/** Height of the fade from the hero into the page background. */
const BOTTOM_FADE = 72;
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
  const { colors, gradients, isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const onLayout = (event: LayoutChangeEvent): void => {
    const { width, height } = event.nativeEvent.layout;
    setSize((current) => (current && current.width === width && current.height === height ? current : { width, height }));
  };

  const art = isDark ? DASHBOARD_ART.heroBackground.dark : DASHBOARD_ART.heroBackground.light;
  const onHero = isDark ? '#FFFFFF' : colors.onBackground;
  const onHeroMuted = withAlpha(onHero, isDark ? 0.78 : 0.7);
  const base = gradients.hero[0] ?? colors.primary;
  // The panel keeps the artwork's proportions at least, so the picture is never squeezed.
  const minHeight = size ? Math.round(size.width * HERO_ART_RATIO) : undefined;
  const topPad = insets.top + componentMetrics.headerMinHeight;

  return (
    <LinearGradient
      onLayout={onLayout}
      colors={gradients.hero}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.hero, { minHeight, paddingTop: topPad + spacing.sm, paddingLeft: insets.left + spacing.xl, paddingRight: insets.right + spacing.xl }]}
      testID={testID}
    >
      {focused ? <StatusBar style={isDark ? 'light' : 'dark'} /> : null}
      {art && size ? (
        <>
          <Image source={art} style={[styles.art, { width: size.width, height: size.height }]} resizeMode="cover" accessibilityIgnoresInvertColors />
          <LinearGradient
            colors={[withAlpha(base, isDark ? 0.65 : 0.5), TRANSPARENT]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 0.6, y: 0.5 }}
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
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  art: {
    position: 'absolute',
    left: 0,
    top: 0,
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
  greeting: {
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
});
