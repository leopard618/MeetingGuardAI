/**
 * Sign in with Apple button (Landing; iOS ONLY) - owner: shell. iOS-pass STUB
 * (docs/ARCHITECTURE.md §26): renders nothing until the apple-app implementer lands the real
 * button on top of expo-apple-authentication.
 *
 * Implementation contract:
 * - Renders the OFFICIAL AppleAuthentication.AppleAuthenticationButton (App Review 4.8 / Apple
 *   HIG: equal prominence). On the Landing screen it sits directly ABOVE "Continue with Google",
 *   same width and height (componentMetrics.buttonHeight).
 * - iOS only: Platform.OS !== 'ios' renders null. On iOS it additionally waits for
 *   AppleAuthentication.isAvailableAsync() (async state, render null until resolved) and renders
 *   null when unavailable, so Landing never shows a dead button.
 * - buttonType CONTINUE (matches "Continue with Google" wording in both languages), buttonStyle
 *   WHITE on the dark scheme / BLACK on the light scheme (the card behind it uses
 *   colors.surface), cornerRadius componentMetrics.buttonHeight / 2 (pill like the other
 *   buttons). The native button draws its own system-localized label; pass
 *   accessibilityLabel={t('landing:signIn.apple')} for parity and tests.
 * - The module is require()d lazily inside the component/module function, NEVER imported at the
 *   top (Android bundles and unit tests must not resolve the iOS native module) - same pattern
 *   as loadGoogleModule() in src/services/auth/authService.ts.
 * - `disabled` mirrors Landing's busy state (the native button has no disabled prop: gate inside
 *   onPress and dim via opacity). onPress -> Landing runs useAuth().signInWithApple(); failures
 *   alert with landing:signIn.failedTitle + authErrorMessageKey, cancel stays silent.
 */
import type { ReactElement } from 'react';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';

export interface AppleSignInButtonProps {
  /** Starts the Apple sign-in flow (Landing owns the busy state and error alerts). */
  onPress: () => void;
  /** True while any sign-in is running: the press is ignored and the button dims. */
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function AppleSignInButton(props: AppleSignInButtonProps): ReactElement | null {
  void props;
  if (Platform.OS !== 'ios') return null;
  // STUB: nothing is rendered until the expo-apple-authentication flow is implemented (§26).
  return null;
}

export default AppleSignInButton;
