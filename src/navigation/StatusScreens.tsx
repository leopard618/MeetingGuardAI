/**
 * Full-screen states of the root navigator: the in-app splash (session restoring / preferences
 * loading) and the preferences-error screen. Module-level components (never recreated).
 */
import { useEffect, useState, type ReactElement } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Text, useTheme as usePaperTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '../i18n';

const APP_LOGO = require('../../assets/icon.png') as number;

/** After this delay the splash explains the wait and offers a way out. */
export const SLOW_SPLASH_MS = 15_000;

export interface SplashScreenProps {
  /** Shown (after SLOW_SPLASH_MS) when a signed-in session is stuck loading. */
  onSignOut?: () => void;
}

export function SplashScreen({ onSignOut }: SplashScreenProps): ReactElement {
  const t = useT();
  const theme = usePaperTheme();
  const insets = useSafeAreaInsets();
  const [isSlow, setIsSlow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsSlow(true), SLOW_SPLASH_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View
      style={[styles.container, { backgroundColor: theme.colors.background, paddingTop: insets.top, paddingBottom: insets.bottom }]}
      accessibilityLabel={t('common:splash.loading')}
      testID="app-splash"
    >
      <Image source={APP_LOGO} style={styles.logo} accessibilityIgnoresInvertColors />
      <ActivityIndicator size="large" style={styles.spinner} />
      {isSlow ? (
        <View style={styles.slow}>
          <Text variant="bodyMedium" style={styles.centered}>
            {t('common:splash.slow')}
          </Text>
          {onSignOut ? (
            <Button mode="text" onPress={onSignOut} style={styles.button}>
              {t('common:actions.signOut')}
            </Button>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export interface PreferencesErrorScreenProps {
  onSignOut: () => void;
}

export function PreferencesErrorScreen({ onSignOut }: PreferencesErrorScreenProps): ReactElement {
  const t = useT();
  const theme = usePaperTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[styles.container, { backgroundColor: theme.colors.background, paddingTop: insets.top, paddingBottom: insets.bottom }]}
      testID="preferences-error"
    >
      <Text variant="titleLarge" style={styles.centered} accessibilityRole="header">
        {t('common:session.prefsErrorTitle')}
      </Text>
      <Text variant="bodyMedium" style={[styles.centered, styles.message]}>
        {t('common:session.prefsErrorMessage')}
      </Text>
      <Button mode="contained" onPress={onSignOut} style={styles.button}>
        {t('common:actions.signOut')}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  logo: {
    width: 96,
    height: 96,
    borderRadius: 20,
  },
  spinner: {
    marginTop: 32,
  },
  slow: {
    marginTop: 24,
    alignItems: 'center',
  },
  centered: {
    textAlign: 'center',
  },
  message: {
    marginTop: 12,
  },
  button: {
    marginTop: 16,
  },
});
