/**
 * Landing (Auth group, signed out) - owner: shell.
 *
 * - Only the brand image, the sign-in buttons and the two legal links: no panel, no feature list,
 *   no quota note (the value props live in onboarding).
 * - "Continue with Google" through useAuth().signInWithGoogle(); the gate switches to onboarding
 *   or the dashboard by itself on success. A closed account picker is not an error.
 * - "Continue with Microsoft" (useAuth().signInWithMicrosoft(), docs/v1/ARCHITECTURE.md section
 *   31) sits between Google and email, in the same glass style as the email button, and only when
 *   the build has a Microsoft client id (useAuth().canSignInWithMicrosoft). A closed browser is as
 *   silent as a closed Google picker.
 * - On iOS, the official "Continue with Apple" button sits directly above Google (equal
 *   prominence - App Review 4.8) and runs useAuth().signInWithApple(); a dismissed Apple sheet
 *   is as silent as a closed Google picker (AppleSignInButton.tsx, docs/v1/ARCHITECTURE.md
 *   section 26).
 * - EN / ES switch (explicit choice, applied instantly) and separate, screen-reader friendly links
 *   to the Terms and the Privacy Policy (both in the Auth stack).
 * - Scrolls, so it works with large fonts, small phones and landscape.
 *
 * The top half is the brand image (assets/bg.jpg: the mark, the app name and the tagline over a
 * night office, always dark), so the screen draws no logo or headline of its own; a spacer keeps
 * the buttons below the baked tagline and the scrim darkens only the lower part. Everything sits
 * on the image, so the colors are mode-invariant (white and the brand gradient on the dark photo).
 * Screen readers get the app name and the promise from the hero spacer.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useRef, useState, type ReactElement } from 'react';
import { ActivityIndicator, Alert, ImageBackground, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AuthStackParamList } from '../../core/contracts';
import { errorMessageKey } from '../../core/errors';
import { createLogger } from '../../core/logger';
import { useResponsive } from '../../hooks/useResponsive';
import { useLanguage, useT } from '../../i18n';
import { useAuth, type AuthActionResult } from '../../services/auth';
import { GradientSurface } from '../../components/ui';
import { componentMetrics, lightColors, pressedDimOpacity, pressedOpacity, radii, spacing, typography, useAppTheme, withAlpha } from '../../theme';

import { AppleSignInButton } from './AppleSignInButton';

const log = createLogger('landing');

/** Brand image: mark, app name and tagline over a night office (941 x 1672, always dark). */
const BACKGROUND = require('../../../assets/bg.jpg') as number;
/** The image's tagline ends at about 40% of its height; the content card starts below this. */
const HERO_FRACTION = 0.46;
/** Buttons: narrower than the column and lifted off the bottom edge. */
const ACTIONS_MAX_WIDTH = 340;
const ACTIONS_BOTTOM_LIFT = spacing.xxxl + spacing.lg;
const LANGUAGE_ROW_HEIGHT = 36;

/** Text on the hero image (always dark behind it, whatever the scheme). */
const ON_HERO = lightColors.onPrimary;
const ON_HERO_BORDER = withAlpha(lightColors.onPrimary, 0.7);
/** Scrim over the photo: clear on the branded top, night-dark behind the content card. */
const HERO_SCRIM: readonly [string, string] = ['rgba(0,0,0,0)', withAlpha(lightColors.onBackground, 0.78)];
const HERO_SCRIM_STOPS: readonly [number, number] = [0.4, 1];
/** Dark label on the selected (white) language chip. */
const ON_HERO_INVERSE = lightColors.onSurface;
/** Glass fill of the Microsoft and email buttons on the photo. */
const ON_HERO_GLASS = withAlpha(lightColors.onPrimary, 0.1);

export function LandingScreen(): ReactElement {
  const t = useT();
  const { onGradient } = useAppTheme();
  const insets = useSafeAreaInsets();
  const layout = useResponsive();
  const navigation = useNavigation<StackNavigationProp<AuthStackParamList>>();
  const { signInWithGoogle, signInWithApple, signInWithMicrosoft, canSignInWithMicrosoft } = useAuth();
  const { language, setLanguage, supportedLanguages } = useLanguage();
  const [busy, setBusy] = useState(false);
  // Synchronous re-entry guard: with two provider buttons, same-frame multi-touch can run both
  // handlers before the `busy` re-render, and both would read the stale closure state. The ref
  // flips before the first await, so the second press returns immediately.
  const busyRef = useRef(false);
  // Light status-bar icons only while the dark hero is on screen: expo-status-bar keeps the last
  // mounted style, so a pushed Terms / Privacy page must not inherit it.
  const focused = useIsFocused();

  // One handler for both providers: a dismissed picker / sheet is not an error (stay silent).
  const handleSignIn = async (signIn: () => Promise<AuthActionResult>): Promise<void> => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await signIn();
      if (result.success || result.cancelled) return;
      Alert.alert(t('landing:signIn.failedTitle'), result.error ?? t('landing:signIn.failed'));
    } catch (error: unknown) {
      // The sign-in actions report failures in their result; this is a programming error.
      log.error('unexpected sign-in failure', error);
      Alert.alert(t('landing:signIn.failedTitle'), t(errorMessageKey('unknown')));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const columnStyle = { width: layout.contentWidth, alignSelf: 'center' as const };

  return (
    <ImageBackground source={BACKGROUND} style={styles.fill} resizeMode="cover" testID="landing-screen">
      {focused ? <StatusBar style="light" /> : null}
      <LinearGradient colors={HERO_SCRIM} locations={HERO_SCRIM_STOPS} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={StyleSheet.absoluteFill} />
      <ScrollView
        style={styles.fill}
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + ACTIONS_BOTTOM_LIFT }]}
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

        {/* The brand (mark, name, tagline) is part of the image: this spacer keeps the card below it and names it for screen readers. */}
        <View
          style={[styles.hero, { minHeight: Math.max(0, Math.round(layout.height * HERO_FRACTION) - LANGUAGE_ROW_HEIGHT - insets.top - spacing.sm) }]}
          accessible
          accessibilityRole="header"
          accessibilityLabel={`${t('common:app.name')}. ${t('landing:headline')}`}
          testID="landing-hero"
        />

        <View style={[styles.actions, { width: Math.min(layout.contentWidth, ACTIONS_MAX_WIDTH) }]}>
          <AppleSignInButton
            onPress={() => {
              void handleSignIn(signInWithApple);
            }}
            disabled={busy}
            style={styles.appleButton}
          />

          <Pressable
            onPress={() => {
              void handleSignIn(signInWithGoogle);
            }}
            disabled={busy}
            style={({ pressed }) => [styles.signInHost, pressed ? styles.pressedDim : busy ? styles.pressed : null]}
            accessibilityRole="button"
            accessibilityState={{ disabled: busy, busy }}
            testID="landing-sign-in"
          >
            <GradientSurface style={styles.signInButton}>
              {busy ? (
                <ActivityIndicator color={onGradient.primary} style={styles.signInIcon} />
              ) : (
                <Ionicons name="logo-google" size={componentMetrics.iconInline} color={onGradient.primary} style={styles.signInIcon} />
              )}
              <Text style={[styles.signInText, { color: onGradient.primary }]}>
                {busy ? t('landing:signIn.busy') : t('landing:signIn.google')}
              </Text>
            </GradientSurface>
          </Pressable>

          {canSignInWithMicrosoft ? (
            <Pressable
              onPress={() => {
                void handleSignIn(signInWithMicrosoft);
              }}
              disabled={busy}
              style={({ pressed }) => [styles.glassButton, pressed && styles.pressedDim]}
              accessibilityRole="button"
              accessibilityState={{ disabled: busy }}
              testID="landing-microsoft"
            >
              <MaterialCommunityIcons name="microsoft" size={componentMetrics.iconInline} color={ON_HERO} style={styles.signInIcon} />
              <Text style={[styles.signInText, { color: ON_HERO }]}>{t('landing:signIn.microsoft')}</Text>
            </Pressable>
          ) : null}

          <Pressable
            onPress={() => navigation.navigate('EmailAuth')}
            disabled={busy}
            style={({ pressed }) => [styles.glassButton, pressed && styles.pressedDim]}
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
            testID="landing-email"
          >
            <Ionicons name="mail-outline" size={componentMetrics.iconInline} color={ON_HERO} style={styles.signInIcon} />
            <Text style={[styles.signInText, { color: ON_HERO }]}>{t('landing:signIn.email')}</Text>
          </Pressable>

          <View style={styles.links}>
            <Pressable
              onPress={() => navigation.navigate('Terms')}
              style={styles.link}
              accessibilityRole="link"
              hitSlop={4}
              testID="landing-terms"
            >
              <Text style={styles.linkText}>{t('landing:consent.terms')}</Text>
            </Pressable>
            <Pressable
              onPress={() => navigation.navigate('Privacy')}
              style={styles.link}
              accessibilityRole="link"
              hitSlop={4}
              testID="landing-privacy"
            >
              <Text style={styles.linkText}>{t('landing:consent.privacy')}</Text>
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
    minHeight: LANGUAGE_ROW_HEIGHT,
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
    color: ON_HERO,
  },
  languageTextSelected: {
    ...typography.labelL,
    color: ON_HERO_INVERSE,
  },
  hero: {
    width: '100%',
  },
  actions: {
    alignSelf: 'center',
    paddingBottom: spacing.sm,
  },
  appleButton: {
    marginTop: spacing.sm,
  },
  signInHost: {
    borderRadius: radii.full,
    overflow: 'hidden',
    marginTop: spacing.sm,
  },
  signInButton: {
    minHeight: componentMetrics.buttonHeight,
    borderRadius: radii.full,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  signInIcon: {
    marginRight: spacing.sm,
  },
  glassButton: {
    minHeight: componentMetrics.buttonHeight,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: ON_HERO_BORDER,
    backgroundColor: ON_HERO_GLASS,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    marginTop: spacing.md,
  },
  signInText: {
    ...typography.labelL,
  },
  pressed: {
    opacity: pressedOpacity,
  },
  pressedDim: {
    opacity: pressedDimOpacity,
  },
  links: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  link: {
    minHeight: componentMetrics.touchTargetMin,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  linkText: {
    ...typography.labelL,
    color: ON_HERO,
    textDecorationLine: 'underline',
  },
});

export default LandingScreen;
