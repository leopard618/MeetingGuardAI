/**
 * "Verify your email" banner and verification-gate helpers (owner: email-auth). Design:
 * docs/ARCHITECTURE.md section 25. i18n: auth:verify.* (EN+ES).
 *
 * Where it mounts: AssistantScreen above the thread (the assistant callable REJECTS unverified
 * accounts server-side) and the AI suggestions entry on the insights screen. The Settings
 * account section shows the same state as a plain line (auth:verify.verified /
 * auth:verify.notVerified), not this banner.
 *
 * - Visible iff needsEmailVerification(useAuth().authUser).
 * - Actions: auth:verify.resend -> resendVerification() (success toast auth:verify.resent, then
 *   a cooldown so the button cannot be hammered), auth:verify.check ("I verified") ->
 *   refreshUser(); still unverified afterwards -> auth:verify.stillUnverified inline.
 * - The assistant's server error for an unverified caller (HttpsError unauthenticated) shows the
 *   SAME auth:verify.assistantBody message (isVerificationGateError), so the gate reads
 *   identically on both paths.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Toast from 'react-native-toast-message';

import type { AppError } from '../../core/errors';
import type { AuthUser } from '../../core/types';
import { useT } from '../../i18n';
import { authService, useAuth } from '../../services/auth';
import { componentMetrics, pressedDimOpacity, radii, spacing, typography, useAppTheme } from '../../theme';

/**
 * The assistant requires `email_verified` OR sign-in provider google.com
 * (functions/src/assistant/handler.ts); mirror that rule client-side.
 */
export function needsEmailVerification(user: AuthUser | null): boolean {
  if (user === null) return false;
  return !user.emailVerified && !user.providerIds.includes('google.com');
}

/**
 * True when a failed assistant request is the server's verification gate (it rejects unverified
 * callers with `unauthenticated`): the UI then shows auth:verify.assistantBody instead of the
 * generic session message, identical to the banner.
 */
export function isVerificationGateError(error: Pick<AppError, 'code'> | null | undefined, user: AuthUser | null): boolean {
  return error !== null && error !== undefined && error.code === 'unauthenticated' && needsEmailVerification(user);
}

/** Resend stays disabled this long after a successful send (Firebase also rate-limits). */
export const RESEND_COOLDOWN_MS = 60_000;

export interface VerificationNote {
  tone: 'info' | 'error';
  text: string;
}

export interface EmailVerificationResult {
  /** The signed-in account still needs to verify its email (assistant gate). */
  needed: boolean;
  /** An action is running (both buttons disabled). */
  busy: boolean;
  /** Resend succeeded recently; the resend action is disabled until the cooldown ends. */
  cooldown: boolean;
  /** Inline feedback: "still unverified" after a check, or a localized failure message. */
  note: VerificationNote | null;
  /** Re-sends the verification email. No-op while busy or cooling down. */
  resend(): Promise<void>;
  /** "I verified": reloads the Firebase user so emailVerified refreshes. */
  check(): Promise<void>;
}

export function useEmailVerification(): EmailVerificationResult {
  const t = useT();
  const { authUser, resendVerification, refreshUser } = useAuth();
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(false);
  const [note, setNote] = useState<VerificationNote | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  const resend = useCallback(async (): Promise<void> => {
    if (busy || cooldown) return;
    setBusy(true);
    setNote(null);
    try {
      const result = await resendVerification();
      if (!mountedRef.current) return;
      if (result.success) {
        Toast.show({ type: 'success', text1: t('auth:verify.resent') });
        setCooldown(true);
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          if (mountedRef.current) setCooldown(false);
        }, RESEND_COOLDOWN_MS);
      } else {
        setNote({ tone: 'error', text: result.error ?? t('auth:errors.unknown') });
      }
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [busy, cooldown, resendVerification, t]);

  const check = useCallback(async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const result = await refreshUser();
      if (!mountedRef.current) return;
      if (!result.success) {
        setNote({ tone: 'error', text: result.error ?? t('auth:errors.unknown') });
        return;
      }
      // refreshUser() already pushed the fresh user through the session state; read it directly
      // (the context value in this closure is from before the reload).
      if (needsEmailVerification(authService.currentUser)) {
        setNote({ tone: 'info', text: t('auth:verify.stillUnverified') });
      }
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [busy, refreshUser, t]);

  return { needed: needsEmailVerification(authUser), busy, cooldown, note, resend, check };
}

export interface VerifyEmailBannerProps {
  style?: StyleProp<ViewStyle>;
}

export function VerifyEmailBanner({ style }: VerifyEmailBannerProps = {}): ReactElement | null {
  const t = useT();
  const { colors } = useAppTheme();
  const verification = useEmailVerification();
  if (!verification.needed) return null;

  const resendDisabled = verification.busy || verification.cooldown;
  return (
    <View
      style={[styles.banner, { backgroundColor: colors.warningContainer }, style]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      testID="verify-email-banner"
    >
      <MaterialCommunityIcons
        name="email-alert-outline"
        size={componentMetrics.iconInline}
        color={colors.onWarningContainer}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
      <View style={styles.texts}>
        <Text style={[styles.title, { color: colors.onWarningContainer }]}>{t('auth:verify.title')}</Text>
        <Text style={[styles.body, { color: colors.onWarningContainer }]}>{t('auth:verify.assistantBody')}</Text>
        {verification.note ? (
          <Text style={[styles.body, styles.note, { color: colors.onWarningContainer }]} testID="verify-email-note">
            {verification.note.text}
          </Text>
        ) : null}
        <View style={styles.actions}>
          <Pressable
            onPress={() => {
              void verification.resend();
            }}
            disabled={resendDisabled}
            hitSlop={6}
            style={({ pressed }) => [styles.action, (pressed || resendDisabled) && styles.actionDim]}
            accessibilityRole="button"
            accessibilityState={{ disabled: resendDisabled, busy: verification.busy }}
            testID="verify-email-resend"
          >
            <Text style={[styles.actionLabel, { color: colors.onWarningContainer }]}>{t('auth:verify.resend')}</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              void verification.check();
            }}
            disabled={verification.busy}
            hitSlop={6}
            style={({ pressed }) => [styles.action, (pressed || verification.busy) && styles.actionDim]}
            accessibilityRole="button"
            accessibilityState={{ disabled: verification.busy, busy: verification.busy }}
            testID="verify-email-check"
          >
            <Text style={[styles.actionLabel, { color: colors.onWarningContainer }]}>{t('auth:verify.check')}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  texts: {
    flex: 1,
  },
  title: {
    ...typography.labelL,
  },
  body: {
    ...typography.bodyM,
  },
  note: {
    marginTop: spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
    marginTop: spacing.xs,
  },
  action: {
    minHeight: componentMetrics.touchTargetMin,
    justifyContent: 'center',
  },
  actionDim: {
    opacity: pressedDimOpacity,
  },
  actionLabel: {
    ...typography.labelL,
  },
});
