/**
 * Landing (Auth group, signed out) - owner: shell.
 *
 * - What the app really does today (alerts, Google + device calendars, an assistant that asks
 *   before changing anything, English / Spanish) and the free daily assistant quota.
 * - "Continue with Google" through useAuth().signInWithGoogle(); the gate switches to onboarding
 *   or the dashboard by itself on success. A closed account picker is not an error.
 * - EN / ES switch (explicit choice, applied instantly) and the consent line with separate,
 *   screen-reader friendly links to the Terms and the Privacy Policy (both in the Auth stack).
 * - Scrolls, so it works with large fonts, small phones and landscape.
 *
 * The hero sits on a photo that is always dark, so its text colors are mode-invariant and come
 * from the light token set (white on the scrimmed image); everything on the content card follows
 * the active scheme.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { StatusBar } from 'expo-status-bar';
import { useState, type ComponentProps, type ReactElement } from 'react';
import { ActivityIndicator, Alert, Image, ImageBackground, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PLAN_DAILY_AI_LIMITS } from '../../core/aiContract';
import type { AuthStackParamList } from '../../core/contracts';
import { errorMessageKey } from '../../core/errors';
import { createLogger } from '../../core/logger';
import { useResponsive } from '../../hooks/useResponsive';
import { useLanguage, useT } from '../../i18n';
import { useAuth } from '../../services/auth';
import { componentMetrics, lightColors, pressedOpacity, radii, spacing, typography, useAppTheme, withAlpha } from '../../theme';

const log = createLogger('landing');

const BACKGROUND = require('../../../assets/bg.jpg') as number;
const LOGO_WITH_TITLE = require('../../../assets/mark_with_title.png') as number;

/** Text on the hero image (always dark behind it, whatever the scheme). */
const ON_HERO = lightColors.onPrimary;
const ON_HERO_MUTED = withAlpha(lightColors.onPrimary, 0.85);
const ON_HERO_BORDER = withAlpha(lightColors.onPrimary, 0.7);
const HERO_SCRIM = lightColors.scrim;
const HERO_TEXT_SHADOW = withAlpha(lightColors.shadow, 0.35);
/** Dark label on the selected (white) language chip. */
const ON_HERO_INVERSE = lightColors.onSurface;

type IconName = ComponentProps<typeof Ionicons>['name'];

export const VALUE_PROPS: readonly { key: 'alerts' | 'calendars' | 'assistant' | 'languages'; icon: IconName }[] = [
  { key: 'alerts', icon: 'notifications-outline' },
  { key: 'calendars', icon: 'calendar-outline' },
  { key: 'assistant', icon: 'chatbubbles-outline' },
  { key: 'languages', icon: 'language-outline' },
];

export function LandingScreen(): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const layout = useResponsive();
  const navigation = useNavigation<StackNavigationProp<AuthStackParamList>>();
  const { signInWithGoogle } = useAuth();
  const { language, setLanguage, supportedLanguages } = useLanguage();
  const [busy, setBusy] = useState(false);
  // Light status-bar icons only while the dark hero is on screen: expo-status-bar keeps the last
  // mounted style, so a pushed Terms / Privacy page must not inherit it.
  const focused = useIsFocused();

  const handleSignIn = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await signInWithGoogle();
      if (result.success || result.cancelled) return;
      Alert.alert(t('landing:signIn.failedTitle'), result.error ?? t('landing:signIn.failed'));
    } catch (error: unknown) {
      // signInWithGoogle reports failures in its result; this is a programming error.
      log.error('unexpected sign-in failure', error);
      Alert.alert(t('landing:signIn.failedTitle'), t(errorMessageKey('unknown')));
    } finally {
      setBusy(false);
    }
  };

  const columnStyle = { width: layout.contentWidth, alignSelf: 'center' as const };

  return (
    <ImageBackground source={BACKGROUND} style={styles.fill} resizeMode="cover" testID="landing-screen">
      {focused ? <StatusBar style="light" /> : null}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: HERO_SCRIM }]} />
      <ScrollView
        style={styles.fill}
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.lg }]}
      >
        <View style={[styles.languageRow, columnStyle]} accessibilityRole="radiogroup" accessibilityLabel={t('landing:language')}>
          {supportedLanguages.map((code) => {
            const selected = code === language;
            return (
              <Pressable
                key={code}
                onPress={() => {
                  void setLanguage(code);
                }}
                style={[styles.languageChip, selected && styles.languageChipSelected]}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                hitSlop={4}
                testID={`landing-language-${code}`}
              >
                <Text style={[styles.languageText, selected && styles.languageTextSelected]}>{t(`common:language.${code}`)}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={[styles.hero, columnStyle]}>
          <Image
            source={LOGO_WITH_TITLE}
            style={[styles.logo, layout.isCompact && styles.logoCompact]}
            resizeMode="contain"
            accessibilityRole="image"
            accessibilityLabel={t('common:app.name')}
          />
          <Text style={styles.headline} accessibilityRole="header">
            {t('landing:headline')}
          </Text>
          <Text style={styles.subtitle}>{t('landing:subtitle')}</Text>
        </View>

        <View style={[styles.card, columnStyle, { backgroundColor: colors.surface }]}>
          {VALUE_PROPS.map(({ key, icon }) => (
            <View key={key} style={styles.valueRow} accessible testID={`landing-value-${key}`}>
              <View style={[styles.valueIcon, { backgroundColor: colors.primaryContainer }]}>
                <Ionicons name={icon} size={22} color={colors.onPrimaryContainer} />
              </View>
              <View style={styles.valueText}>
                <Text style={[styles.valueTitle, { color: colors.onSurface }]}>{t(`landing:valueProps.${key}.title`)}</Text>
                <Text style={[styles.valueBody, { color: colors.onSurfaceVariant }]}>{t(`landing:valueProps.${key}.body`)}</Text>
              </View>
            </View>
          ))}

          <Pressable
            onPress={() => {
              void handleSignIn();
            }}
            disabled={busy}
            style={({ pressed }) => [styles.signInButton, { backgroundColor: colors.primary }, (pressed || busy) && styles.pressed]}
            accessibilityRole="button"
            accessibilityState={{ disabled: busy, busy }}
            testID="landing-sign-in"
          >
            {busy ? (
              <ActivityIndicator color={colors.onPrimary} style={styles.signInIcon} />
            ) : (
              <Ionicons name="logo-google" size={componentMetrics.iconInline} color={colors.onPrimary} style={styles.signInIcon} />
            )}
            <Text style={[styles.signInText, { color: colors.onPrimary }]}>
              {busy ? t('landing:signIn.busy') : t('landing:signIn.google')}
            </Text>
          </Pressable>

          <Text style={[styles.note, { color: colors.onSurfaceVariant }]}>
            {t('landing:freePlan', { count: PLAN_DAILY_AI_LIMITS.free })}
          </Text>

          <Text style={[styles.consent, { color: colors.onSurfaceVariant }]}>{t('landing:consent.text')}</Text>
          <View style={styles.links}>
            <Pressable
              onPress={() => navigation.navigate('Terms')}
              style={styles.link}
              accessibilityRole="link"
              hitSlop={4}
              testID="landing-terms"
            >
              <Text style={[styles.linkText, { color: colors.primary }]}>{t('landing:consent.terms')}</Text>
            </Pressable>
            <Pressable
              onPress={() => navigation.navigate('Privacy')}
              style={styles.link}
              accessibilityRole="link"
              hitSlop={4}
              testID="landing-privacy"
            >
              <Text style={[styles.linkText, { color: colors.primary }]}>{t('landing:consent.privacy')}</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'space-between',
  },
  languageRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  languageChip: {
    minHeight: 36,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: ON_HERO_BORDER,
    marginLeft: spacing.sm,
  },
  languageChipSelected: {
    backgroundColor: ON_HERO,
    borderColor: ON_HERO,
  },
  languageText: {
    ...typography.labelL,
    fontWeight: '400',
    color: ON_HERO,
  },
  languageTextSelected: {
    ...typography.labelL,
    color: ON_HERO_INVERSE,
  },
  hero: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
  },
  logo: {
    width: 240,
    height: 120,
  },
  logoCompact: {
    width: 180,
    height: 90,
  },
  headline: {
    ...typography.headlineL,
    color: ON_HERO,
    textAlign: 'center',
    marginTop: spacing.lg,
    textShadowColor: HERO_TEXT_SHADOW,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  subtitle: {
    ...typography.bodyL,
    color: ON_HERO_MUTED,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  card: {
    borderRadius: radii.xl,
    padding: spacing.xxl,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.lg,
  },
  valueIcon: {
    width: componentMetrics.avatarSize,
    height: componentMetrics.avatarSize,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  valueText: {
    flex: 1,
  },
  valueTitle: {
    ...typography.titleM,
  },
  valueBody: {
    ...typography.bodyM,
    marginTop: spacing.xs,
  },
  signInButton: {
    minHeight: componentMetrics.buttonHeight,
    borderRadius: radii.full,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    marginTop: spacing.sm,
  },
  signInIcon: {
    marginRight: spacing.sm,
  },
  signInText: {
    ...typography.labelL,
  },
  pressed: {
    opacity: pressedOpacity,
  },
  note: {
    ...typography.bodyS,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  consent: {
    ...typography.bodyS,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  links: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: spacing.xs,
  },
  link: {
    minHeight: componentMetrics.touchTargetMin,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  linkText: {
    ...typography.labelL,
    textDecorationLine: 'underline',
  },
});

export default LandingScreen;
