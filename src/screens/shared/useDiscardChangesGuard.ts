/**
 * Keeps unsaved form changes from being dropped silently: while `dirty`, leaving the screen (header
 * back arrow, Android back, a swipe, a replace) asks "Discard changes?" first (Keep editing /
 * Discard). While `busy` (a save in flight), leaving is held without a prompt.
 *
 * After a successful save the screen calls `allowLeave()` right before it navigates away, so its
 * own navigation is never blocked (the dirty flag may still be true until the next render).
 */
import { useNavigation, usePreventRemove } from '@react-navigation/native';
import { useCallback, useRef } from 'react';
import { Alert } from 'react-native';

import { useT } from '../../i18n';

export interface DiscardChangesGuard {
  /** Lets the next navigation away from this screen through (call after a successful save). */
  allowLeave(): void;
}

export function useDiscardChangesGuard(dirty: boolean, options: { busy?: boolean; onDiscard?: () => void } = {}): DiscardChangesGuard {
  const t = useT();
  const navigation = useNavigation();
  const allowRef = useRef(false);
  const busy = options.busy ?? false;
  const onDiscard = options.onDiscard;

  usePreventRemove(dirty || busy, ({ data }) => {
    if (allowRef.current) {
      navigation.dispatch(data.action);
      return;
    }
    if (busy) return;
    Alert.alert(t('common:discard.title'), t('common:discard.message'), [
      { text: t('common:discard.keepEditing'), style: 'cancel' },
      {
        text: t('common:discard.discard'),
        style: 'destructive',
        onPress: () => {
          allowRef.current = true;
          onDiscard?.();
          navigation.dispatch(data.action);
        },
      },
    ]);
  });

  const allowLeave = useCallback(() => {
    allowRef.current = true;
  }, []);

  return { allowLeave };
}
