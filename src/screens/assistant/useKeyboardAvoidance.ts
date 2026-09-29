/**
 * Keyboard handling for a screen that sits below the Main header (Android is edge-to-edge in SDK
 * 57, so the window is not resized for the keyboard and KeyboardAvoidingView uses "padding" on
 * both platforms):
 * - `keyboardVerticalOffset`: where the screen starts in the window (header + status bar),
 *   measured instead of hard-coded, because KeyboardAvoidingView compares its own frame (relative
 *   to its parent) with the keyboard's window coordinates;
 * - `keyboardVisible`: lets the composer drop the bottom safe-area inset while the keyboard is up.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Keyboard, Platform, type View } from 'react-native';

export interface KeyboardAvoidance {
  rootRef: RefObject<View | null>;
  onRootLayout: () => void;
  keyboardVerticalOffset: number;
  keyboardVisible: boolean;
}

export function useKeyboardAvoidance(): KeyboardAvoidance {
  const rootRef = useRef<View | null>(null);
  const [offset, setOffset] = useState(0);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  const onRootLayout = useCallback(() => {
    rootRef.current?.measureInWindow((_x, y) => {
      if (Number.isFinite(y)) setOffset(Math.max(0, Math.round(y)));
    });
  }, []);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return { rootRef, onRootLayout, keyboardVerticalOffset: offset, keyboardVisible };
}
