/**
 * Email/password sign-in and account creation (owner: email-auth). Route "EmailAuth" in the
 * Auth stack (headerless), reached from Landing's "Continue with email" button.
 * Design: docs/v1/ARCHITECTURE.md section 25. i18n namespace: auth (auth:emailAuth.*).
 *
 * - Mode toggle sign-in / create-account; email + password fields (secureTextEntry with a
 *   show/hide toggle, textContentType/autoComplete autofill hints, keyboard-safe via ScreenBody),
 *   optional name field on create; submit through useAuth().signInWithEmail / signUpWithEmail
 *   (they return AuthActionResult with a localized message - never throw).
 * - Inline forgot-password flow: useAuth().sendPasswordReset; the confirmation is ALWAYS the
 *   neutral auth:emailAuth.resetSent, also when no account exists (the collapsed
 *   invalid-credentials family maps to code "unauthenticated") - no account enumeration.
 * - After create: auth:emailAuth.verificationSent as an Alert (it survives the session gate
 *   switching to onboarding/main); the verification email itself is sent by the service,
 *   non-blocking.
 * - Bad credentials always show the ONE generic auth:errors.invalidCredentials message
 *   (authErrors.ts maps invalid-credential/user-not-found/wrong-password together);
 *   auth/operation-not-allowed shows auth:errors.providerDisabled (owner hint: enable the
 *   provider, docs/v1/SETUP.md section 13). Both arrive here as the localized `result.error`.
 */
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { useState, type ReactElement } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { HelperText, IconButton, SegmentedButtons, Text, TextInput } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Banner, MGButton } from '../../components/ui';
import type { AuthStackParamList } from '../../core/contracts';
import { useT } from '../../i18n';
import { useAuth } from '../../services/auth';
import { spacing, typography, useAppTheme } from '../../theme';
import { ScreenBody, Section } from '../shared/Section';

type Mode = 'signIn' | 'create';
type ResetStage = 'hidden' | 'open' | 'sent';

const FALLBACK_ERROR_KEY = 'auth:errors.unknown';

export function EmailAuthScreen(): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<StackNavigationProp<AuthStackParamList>>();
  const { signInWithEmail, signUpWithEmail, sendPasswordReset } = useAuth();

  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetStage, setResetStage] = useState<ResetStage>('hidden');

  const switchMode = (value: string): void => {
    if ((value !== 'signIn' && value !== 'create') || value === mode) return;
    setMode(value);
    setError(null);
    setResetStage('hidden');
  };

  const submit = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result =
        mode === 'create' ? await signUpWithEmail(email, password, name) : await signInWithEmail(email, password);
      if (result.success) {
        // The session gate switches screens by itself; an Alert survives that.
        if (mode === 'create') {
          Alert.alert(t('auth:verify.title'), t('auth:emailAuth.verificationSent', { email: email.trim() }));
        }
        return;
      }
      if (!result.cancelled) setError(result.error ?? t(FALLBACK_ERROR_KEY));
    } finally {
      setBusy(false);
    }
  };

  const sendReset = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await sendPasswordReset(email);
      // Neutral confirmation whether or not an account exists: "unauthenticated" is the
      // collapsed invalid-credentials/user-not-found family (authErrors.ts).
      if (result.success || result.errorCode === 'unauthenticated') {
        setResetStage('sent');
        return;
      }
      setError(result.error ?? t(FALLBACK_ERROR_KEY));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]} testID="email-auth-screen">
      <View style={styles.topBar}>
        <IconButton
          icon="arrow-left"
          onPress={() => navigation.goBack()}
          accessibilityLabel={t('common:actions.back')}
          testID="email-auth-back"
        />
        <Text style={[styles.title, { color: colors.onSurface }]} accessibilityRole="header">
          {t('auth:emailAuth.title')}
        </Text>
      </View>

      <ScreenBody
        primaryLabel={mode === 'create' ? t('auth:emailAuth.submitCreate') : t('auth:emailAuth.submitSignIn')}
        onPrimary={() => {
          void submit();
        }}
        primaryLoading={busy}
        primaryTestID="email-auth-submit"
      >
        <SegmentedButtons
          value={mode}
          onValueChange={switchMode}
          buttons={[
            { value: 'signIn', label: t('auth:emailAuth.signInTab'), testID: 'email-auth-tab-signin' },
            { value: 'create', label: t('auth:emailAuth.createTab'), testID: 'email-auth-tab-create' },
          ]}
          style={styles.tabs}
        />

        {error ? <Banner tone="error" text={error} style={styles.notice} testID="email-auth-error" /> : null}

        <Section>
          <TextInput
            mode="outlined"
            label={t('auth:emailAuth.email')}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            accessibilityLabel={t('auth:emailAuth.email')}
            testID="email-auth-email"
          />
          <TextInput
            mode="outlined"
            label={t('auth:emailAuth.password')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete={mode === 'create' ? 'password-new' : 'password'}
            textContentType={mode === 'create' ? 'newPassword' : 'password'}
            accessibilityLabel={t('auth:emailAuth.password')}
            style={styles.field}
            right={
              <TextInput.Icon
                icon={showPassword ? 'eye-off-outline' : 'eye-outline'}
                onPress={() => setShowPassword((current) => !current)}
                forceTextInputFocus={false}
                accessibilityLabel={t(showPassword ? 'auth:emailAuth.hidePassword' : 'auth:emailAuth.showPassword')}
                testID="email-auth-show-password"
              />
            }
            testID="email-auth-password"
          />
          {mode === 'create' ? (
            <TextInput
              mode="outlined"
              label={t('auth:emailAuth.name')}
              value={name}
              onChangeText={setName}
              autoComplete="name"
              textContentType="name"
              accessibilityLabel={t('auth:emailAuth.name')}
              style={styles.field}
              testID="email-auth-name"
            />
          ) : null}
        </Section>

        {mode === 'signIn' ? (
          <View style={styles.forgot}>
            {resetStage === 'hidden' ? (
              <MGButton variant="ghost" size="sm" onPress={() => setResetStage('open')} testID="email-auth-forgot">
                {t('auth:emailAuth.forgot')}
              </MGButton>
            ) : resetStage === 'sent' ? (
              <HelperText type="info" visible accessibilityLiveRegion="polite" testID="email-auth-reset-sent">
                {t('auth:emailAuth.resetSent')}
              </HelperText>
            ) : (
              <>
                <HelperText type="info" visible>
                  {t('auth:emailAuth.resetHint')}
                </HelperText>
                <MGButton
                  variant="tonal"
                  size="sm"
                  onPress={() => {
                    void sendReset();
                  }}
                  disabled={busy}
                  testID="email-auth-reset-send"
                >
                  {t('auth:emailAuth.resetSend')}
                </MGButton>
              </>
            )}
          </View>
        ) : null}
      </ScreenBody>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    ...typography.titleL,
    flex: 1,
  },
  tabs: {
    marginBottom: spacing.lg,
  },
  notice: {
    marginBottom: spacing.lg,
  },
  field: {
    marginTop: spacing.md,
  },
  forgot: {
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
});
