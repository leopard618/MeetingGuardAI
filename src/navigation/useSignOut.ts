/**
 * Sign-out flow shared by the header and the sidebar: confirm, then sign out; when the outbox
 * still holds unsynced writes (AppError 'pending_writes') ask again before forcing it.
 */
import { useCallback } from 'react';
import { Alert } from 'react-native';

import type { TranslateFn } from '../core/contracts';
import { errorMessageKey, toAppError } from '../core/errors';
import { createLogger } from '../core/logger';
import { useT } from '../i18n';
import { useAuth } from '../services/auth';

const log = createLogger('navigation');

type SignOut = (options?: { force?: boolean }) => Promise<void>;

async function attemptSignOut(signOut: SignOut, t: TranslateFn, force: boolean): Promise<void> {
  try {
    await signOut({ force });
  } catch (caught) {
    const error = toAppError(caught);
    if (error.code === 'pending_writes' && !force) {
      Alert.alert(t('common:session.pendingWritesTitle'), t('common:session.pendingWritesMessage'), [
        { text: t('common:actions.cancel'), style: 'cancel' },
        {
          text: t('common:actions.signOutAnyway'),
          style: 'destructive',
          onPress: () => {
            void attemptSignOut(signOut, t, true);
          },
        },
      ]);
      return;
    }
    if (error.code === 'cancelled') return;
    log.error('sign-out failed', error);
    Alert.alert(t('common:session.signOutFailed'), t(errorMessageKey(error.code)));
  }
}

/** Returns a handler that asks for confirmation and signs the user out. */
export function useSignOutFlow(): () => void {
  const { signOut } = useAuth();
  const t = useT();

  return useCallback(() => {
    Alert.alert(t('common:session.signOutTitle'), t('common:session.signOutMessage'), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      {
        text: t('common:actions.signOut'),
        style: 'destructive',
        onPress: () => {
          void attemptSignOut(signOut, t, false);
        },
      },
    ]);
  }, [signOut, t]);
}
