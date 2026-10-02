/**
 * Sign in with Apple button (Landing; iOS ONLY) - owner: shell. docs/ARCHITECTURE.md section 26.
 *
 * - Renders the OFFICIAL AppleAuthentication.AppleAuthenticationButton (App Review 4.8 / Apple
 *   HIG: equal prominence). On the Landing screen it sits directly ABOVE "Continue with Google",
 *   same width and height (componentMetrics.buttonHeight).
 * - iOS only: elsewhere it renders null. On iOS it additionally waits for
 *   AppleAuthentication.isAvailableAsync() and stays null when unavailable or when the native
 *   module is missing, so Landing never shows a dead button. WHILE the (async) check is pending
 *   it renders an invisible placeholder of the final button height: mounting the button later
 *   would push "Continue with Google" down mid-tap on a slow first frame (the check resolves
 *   within the first frames, but a busy JS thread can delay it past a user's first touch).
 * - buttonType CONTINUE (matches "Continue with Google" wording in both languages), buttonStyle
 *   WHITE on the dark scheme / BLACK on the light scheme (the card behind it uses
 *   colors.surface), cornerRadius componentMetrics.buttonHeight / 2 (pill like the other
 *   buttons). The native button draws its own system-localized label; accessibilityLabel is
 *   t('landing:signIn.apple') for parity and tests.
 * - The module is require()d lazily, NEVER imported at the top (Android bundles and unit tests
 *   must not resolve the iOS native module) - same pattern as loadGoogleModule() in
 *   src/services/auth/authService.ts.
 * - The native button has no disabled prop: while `disabled` (Landing's busy state) the press is
 *   ignored and the button dims via opacity. onPress -> Landing runs useAuth().signInWithApple();
 *   failures alert with landing:signIn.failedTitle + the localized message, cancel stays silent.
 */
import { useEffect, useState, type ComponentType, type ReactElement } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { createLogger } from '../../core/logger';
import { useT } from '../../i18n';
import { componentMetrics, pressedDimOpacity, useAppTheme } from '../../theme';

const log = createLogger('landing');

/** Props of the official native button that this component uses. */
interface AppleButtonNativeProps {
  buttonType: number;
  buttonStyle: number;
  cornerRadius: number;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
}

/**
 * Minimal shape of expo-apple-authentication. Typed locally (not `typeof import(...)`) because
 * the package is resolved lazily at runtime and only exists in iOS builds.
 */
interface AppleAuthUiModule {
  isAvailableAsync(): Promise<boolean>;
  AppleAuthenticationButton: ComponentType<AppleButtonNativeProps>;
  AppleAuthenticationButtonType: { CONTINUE: number };
  AppleAuthenticationButtonStyle: { WHITE: number; BLACK: number };
}

/** undefined = not tried yet; null = the module cannot be loaded in this build. */
let appleUiModule: AppleAuthUiModule | null | undefined;

function loadAppleUiModule(): AppleAuthUiModule | null {
  if (appleUiModule !== undefined) return appleUiModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    appleUiModule = require('expo-apple-authentication') as AppleAuthUiModule;
  } catch {
    // Build without the module (Android, Expo Go): the button simply never appears.
    appleUiModule = null;
  }
  return appleUiModule;
}

export interface AppleSignInButtonProps {
  /** Starts the Apple sign-in flow (Landing owns the busy state and error alerts). */
  onPress: () => void;
  /** True while any sign-in is running: the press is ignored and the button dims. */
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function AppleSignInButton({ onPress, disabled = false, style }: AppleSignInButtonProps): ReactElement | null {
  const t = useT();
  const { scheme } = useAppTheme();
  const module = Platform.OS === 'ios' ? loadAppleUiModule() : null;
  const [availability, setAvailability] = useState<'pending' | 'available' | 'unavailable'>('pending');

  useEffect(() => {
    if (!module) return undefined;
    let active = true;
    module.isAvailableAsync().then(
      (value) => {
        if (active) setAvailability(value ? 'available' : 'unavailable');
      },
      (error: unknown) => {
        // Unavailable (e.g. no Apple ID support on this device): the button stays hidden.
        log.warn('Apple sign-in availability check failed', error);
        if (active) setAvailability('unavailable');
      },
    );
    return () => {
      active = false;
    };
  }, [module]);

  if (!module || availability === 'unavailable') return null;
  if (availability === 'pending') {
    // Invisible height reservation (header comment): same `style` (margins) + button height, so
    // the buttons below do not shift when the real button mounts.
    return <View style={[styles.placeholder, style]} pointerEvents="none" testID="landing-apple-sign-in-placeholder" />;
  }
  const NativeButton = module.AppleAuthenticationButton;
  return (
    <View style={[disabled && styles.dimmed, style]}>
      <NativeButton
        buttonType={module.AppleAuthenticationButtonType.CONTINUE}
        buttonStyle={scheme === 'dark' ? module.AppleAuthenticationButtonStyle.WHITE : module.AppleAuthenticationButtonStyle.BLACK}
        cornerRadius={componentMetrics.buttonHeight / 2}
        onPress={() => {
          if (!disabled) onPress();
        }}
        style={styles.button}
        accessibilityLabel={t('landing:signIn.apple')}
        testID="landing-apple-sign-in"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    width: '100%',
    height: componentMetrics.buttonHeight,
  },
  dimmed: {
    opacity: pressedDimOpacity,
  },
  placeholder: {
    height: componentMetrics.buttonHeight,
  },
});

export default AppleSignInButton;
