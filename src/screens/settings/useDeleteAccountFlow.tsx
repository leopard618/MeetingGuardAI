/**
 * Account deletion from Settings (App Store 5.1.1(v), Google Play account deletion policy):
 * confirm -> confirm the identity again (Google account picker, or the password in a dialog; the
 * server requires a recent sign-in) -> useAuth().deleteAccount() -> the session ends and the gate
 * returns to the landing screen. Failures are shown with the auth error messages.
 */
import { useCallback, useState, type ReactElement } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Dialog, Portal, Text, TextInput } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import { toAppError } from '../../core/errors';
import { createLogger } from '../../core/logger';
import { useT } from '../../i18n';
import { authErrorMessageKey, useAuth } from '../../services/auth';

const log = createLogger('settings');

export interface DeleteAccountFlow {
  /** Starts the flow (confirmation dialog first). */
  start(): void;
  busy: boolean;
  /** Dialogs of the flow; render once in the screen. */
  element: ReactElement;
}

export function useDeleteAccountFlow(): DeleteAccountFlow {
  const t = useT();
  const { authUser, reauthenticate, deleteAccount } = useAuth();
  const [busy, setBusy] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [password, setPassword] = useState('');

  const fail = useCallback(
    (caught: unknown) => {
      const error = toAppError(caught);
      if (error.code === 'cancelled') return;
      log.warn('account deletion failed', error.code);
      Alert.alert(t('auth:deleteAccount.failedTitle'), t(authErrorMessageKey(error)));
    },
    [t],
  );

  const run = useCallback(
    async (confirmIdentity: () => Promise<'done' | 'cancelled'>) => {
      setBusy(true);
      try {
        if ((await confirmIdentity()) === 'cancelled') return;
        await deleteAccount();
        Toast.show({ type: 'success', text1: t('auth:deleteAccount.done') });
      } catch (caught) {
        fail(caught);
      } finally {
        setBusy(false);
      }
    },
    [deleteAccount, fail, t],
  );

  const confirmIdentity = useCallback(() => {
    const providers = authUser?.providerIds ?? [];
    if (providers.includes('google.com')) {
      void run(() => reauthenticate());
      return;
    }
    if (providers.includes('password')) {
      setPassword('');
      setPasswordVisible(true);
      return;
    }
    // Unknown provider: the server decides (it requires a recent sign-in).
    void run(async () => 'done');
  }, [authUser, reauthenticate, run]);

  const start = useCallback(() => {
    Alert.alert(t('auth:deleteAccount.title'), t('auth:deleteAccount.message'), [
      { text: t('auth:deleteAccount.cancel'), style: 'cancel' },
      { text: t('auth:deleteAccount.confirm'), style: 'destructive', onPress: confirmIdentity },
    ]);
  }, [confirmIdentity, t]);

  const submitPassword = (): void => {
    const value = password;
    setPasswordVisible(false);
    setPassword('');
    void run(() => reauthenticate({ password: value }));
  };

  const element = (
    <Portal>
      <Dialog visible={passwordVisible} onDismiss={() => setPasswordVisible(false)}>
        <Dialog.Title>{t('settings:account.confirmIdentityTitle')}</Dialog.Title>
        <Dialog.Content>
          <Text variant="bodyMedium" style={styles.paragraph}>
            {t('settings:account.confirmIdentityPassword')}
          </Text>
          <TextInput
            mode="outlined"
            label={t('settings:account.passwordLabel')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
            testID="delete-account-password"
          />
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={() => setPasswordVisible(false)}>{t('auth:deleteAccount.cancel')}</Button>
          <Button onPress={submitPassword} disabled={password.length === 0} textColor="#B91C1C">
            {t('auth:deleteAccount.confirm')}
          </Button>
        </Dialog.Actions>
      </Dialog>
      <Dialog visible={busy} dismissable={false}>
        <Dialog.Content>
          <View style={styles.busyRow}>
            <ActivityIndicator />
            <Text variant="bodyMedium" style={styles.busyText}>
              {t('auth:deleteAccount.inProgress')}
            </Text>
          </View>
        </Dialog.Content>
      </Dialog>
    </Portal>
  );

  return { start, busy, element };
}

const styles = StyleSheet.create({
  paragraph: {
    marginBottom: 12,
  },
  busyRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  busyText: {
    marginLeft: 16,
    flex: 1,
  },
});
