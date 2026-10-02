/**
 * WhatsApp connect (route "WhatsAppConnect", reached from Settings and from the creation
 * chooser): links this account to the WhatsApp bot (docs/ARCHITECTURE.md §27).
 * - unavailable: the server integration is off (WHATSAPP_ENABLED false) - explainer only;
 * - not linked: explainer + "Generate code"; with a code: the 6 digits, the bot number to send
 *   it to (WhatsApp may live on another device), a live countdown, copy, and "Open WhatsApp"
 *   (wa.me deep link with the code prefilled). The screen polls the link status while a code is
 *   active so it flips to "linked" when the bot accepts the code;
 * - linked: the bot number, the MASKED linked phone (owner visibility of which phone is bound),
 *   "Open WhatsApp" and unlink behind a confirmation.
 * Every string lives in the "whatsapp" namespace (EN + ES); no code or number is ever logged.
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { Alert, Linking, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import { Banner, ErrorState, ListGroup, ListRow, LoadingState, MGButton } from '../../components/ui';
import type { WhatsAppLinkCode } from '../../core/contracts';
import { errorMessageKey, toAppError } from '../../core/errors';
import { useT } from '../../i18n';
import { useWhatsAppStatus, whatsappService } from '../../services/whatsapp';
import { spacing, useAppTheme } from '../../theme';
import { ScreenBody, Section } from '../shared/Section';
import { useLiveNow } from '../shared/useLiveNow';
import { actionErrorKey, codeMessageUrl, connectView, copyText, formatCountdown, remainingSeconds } from './whatsappConnectModel';

/** Ask the server again this often while a code is waiting to be redeemed. */
const LINK_POLL_MS = 8_000;
/** `now` older than this means the screen is unfocused or backgrounded: skip the poll. */
const POLL_STALE_MS = 3_000;
const COPIED_RESET_MS = 2_000;

export function WhatsAppConnectScreen(): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const { status, error, refresh } = useWhatsAppStatus();
  const now = useLiveNow(1_000);
  const [code, setCode] = useState<WhatsAppLinkCode | null>(null);
  const [busy, setBusy] = useState<'generate' | 'unlink' | null>(null);
  const [copied, setCopied] = useState(false);

  const view = connectView(status, error);
  const remaining = code ? remainingSeconds(code.expiresAtIso, now) : 0;
  const codeActive = code !== null && remaining > 0;

  // A redeemed code flips the status to linked (poll below) and the linked view takes over;
  // the spent code is dropped on unlink, so it can never resurface as valid.

  // useLiveNow freezes `now` while the screen is unfocused or the app is in the background;
  // the poll below reads it through a ref to pause itself in exactly those moments.
  const nowRef = useRef(now);
  useEffect(() => {
    nowRef.current = now;
  }, [now]);

  // While a code is waiting, ask the server now and then whether the bot accepted it.
  useEffect(() => {
    if (view !== 'not_linked' || !codeActive) return undefined;
    const timer = setInterval(() => {
      if (Date.now() - nowRef.current.getTime() > POLL_STALE_MS) return;
      void refresh();
    }, LINK_POLL_MS);
    return () => clearInterval(timer);
  }, [view, codeActive, refresh]);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), COPIED_RESET_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const showActionError = useCallback(
    (caught: unknown): void => {
      Toast.show({ type: 'error', text1: t(actionErrorKey(toAppError(caught))) });
    },
    [t],
  );

  const generate = useCallback(async (): Promise<void> => {
    setBusy('generate');
    try {
      const next = await whatsappService.startLink();
      setCode(next);
      setCopied(false);
    } catch (caught: unknown) {
      showActionError(caught);
    } finally {
      setBusy(null);
    }
  }, [showActionError]);

  const openWhatsApp = useCallback(
    async (url: string): Promise<void> => {
      try {
        await Linking.openURL(url);
      } catch (caught: unknown) {
        showActionError(caught);
      }
    },
    [showActionError],
  );

  const unlinkNow = useCallback(async (): Promise<void> => {
    setBusy('unlink');
    try {
      await whatsappService.unlink();
      setCode(null);
      Toast.show({ type: 'success', text1: t('whatsapp:unlink.done') });
    } catch (caught: unknown) {
      showActionError(caught);
    } finally {
      setBusy(null);
    }
  }, [showActionError, t]);

  const confirmUnlink = useCallback((): void => {
    Alert.alert(t('whatsapp:unlink.confirmTitle'), t('whatsapp:unlink.confirmBody'), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      {
        text: t('whatsapp:unlink.action'),
        style: 'destructive',
        onPress: () => {
          void unlinkNow();
        },
      },
    ]);
  }, [t, unlinkNow]);

  if (view === 'loading') {
    return (
      <ScreenBody>
        <LoadingState testID="whatsapp-loading" />
      </ScreenBody>
    );
  }

  if (view === 'error') {
    return (
      <ScreenBody>
        <ErrorState
          body={t(errorMessageKey(error?.code ?? 'unknown'))}
          onRetry={() => {
            void refresh();
          }}
          testID="whatsapp-error"
        />
      </ScreenBody>
    );
  }

  if (view === 'unavailable') {
    return (
      <ScreenBody>
        <Text variant="bodyMedium" style={[styles.explainer, { color: colors.onSurfaceVariant }]}>
          {t('whatsapp:subtitle')}
        </Text>
        <Banner tone="info" text={t('whatsapp:status.unavailable')} testID="whatsapp-unavailable" />
      </ScreenBody>
    );
  }

  if (view === 'linked') {
    const deepLink = status?.deepLink ?? null;
    return (
      <ScreenBody>
        <Section title={t('whatsapp:linked.title')} testID="whatsapp-linked">
          <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }} testID="whatsapp-linked-number">
            {t('whatsapp:linked.number', { number: status?.displayNumber ? `+${status.displayNumber}` : '' })}
          </Text>
          {status?.linkedLast4 ? (
            <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }} testID="whatsapp-linked-own-number">
              {t('whatsapp:linked.yourNumber', { last4: status.linkedLast4 })}
            </Text>
          ) : null}
          <MGButton
            style={styles.action}
            disabled={deepLink === null || busy !== null}
            onPress={() => {
              if (deepLink !== null) void openWhatsApp(deepLink);
            }}
            testID="whatsapp-open"
          >
            {t('whatsapp:open')}
          </MGButton>
        </Section>
        <ListGroup>
          <ListRow
            icon="link-off"
            title={t('whatsapp:unlink.action')}
            tone="destructive"
            onPress={confirmUnlink}
            disabled={busy !== null}
            accessibilityRole="button"
            testID="whatsapp-unlink"
          />
        </ListGroup>
      </ScreenBody>
    );
  }

  // not_linked
  const deepLink = status?.deepLink ?? null;
  return (
    <ScreenBody>
      <Text variant="bodyMedium" style={[styles.explainer, { color: colors.onSurfaceVariant }]}>
        {t('whatsapp:explainer')}
      </Text>
      {code === null ? (
        <MGButton
          onPress={() => {
            void generate();
          }}
          loading={busy === 'generate'}
          disabled={busy !== null}
          testID="whatsapp-generate"
        >
          {t('whatsapp:code.generate')}
        </MGButton>
      ) : (
        <Section testID="whatsapp-code-section">
          <Text
            variant="displaySmall"
            style={styles.code}
            selectable
            accessibilityLabel={t('whatsapp:code.value', { code: code.code })}
            testID="whatsapp-code"
          >
            {code.code}
          </Text>
          {status?.displayNumber ? (
            <Text variant="bodyMedium" style={[styles.countdown, { color: colors.onSurfaceVariant }]} testID="whatsapp-send-to">
              {t('whatsapp:code.sendTo', { number: `+${status.displayNumber}` })}
            </Text>
          ) : null}
          {codeActive ? (
            <Text variant="bodyMedium" style={[styles.countdown, { color: colors.onSurfaceVariant }]} testID="whatsapp-countdown">
              {t('whatsapp:code.countdown', { time: formatCountdown(remaining) })}
            </Text>
          ) : (
            <Text variant="bodyMedium" style={[styles.countdown, { color: colors.error }]} testID="whatsapp-code-expired">
              {t('whatsapp:code.expired')}
            </Text>
          )}
          {codeActive ? (
            <View style={styles.buttonColumn}>
              <MGButton
                variant="tonal"
                onPress={() => {
                  if (copyText(code.code)) setCopied(true);
                }}
                testID="whatsapp-copy"
              >
                {copied ? t('whatsapp:code.copied') : t('whatsapp:code.copy')}
              </MGButton>
              <MGButton
                disabled={deepLink === null}
                onPress={() => {
                  if (deepLink !== null) void openWhatsApp(codeMessageUrl(deepLink, code.code));
                }}
                testID="whatsapp-open"
              >
                {t('whatsapp:open')}
              </MGButton>
            </View>
          ) : (
            <MGButton
              onPress={() => {
                void generate();
              }}
              loading={busy === 'generate'}
              disabled={busy !== null}
              testID="whatsapp-generate"
            >
              {t('whatsapp:code.generate')}
            </MGButton>
          )}
        </Section>
      )}
    </ScreenBody>
  );
}

const styles = StyleSheet.create({
  explainer: {
    marginBottom: spacing.lg,
  },
  code: {
    textAlign: 'center',
    letterSpacing: 8,
    marginBottom: spacing.sm,
  },
  countdown: {
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  buttonColumn: {
    gap: spacing.md,
  },
  action: {
    marginTop: spacing.lg,
  },
});
