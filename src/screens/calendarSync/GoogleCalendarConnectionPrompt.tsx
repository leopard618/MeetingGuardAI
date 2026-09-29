/**
 * "Connect Google Calendar" modal. Connects through googleCalendarService.connect() (incremental
 * Calendar consent + first two-way sync) and reports the real outcome. When Google Calendar is
 * already connected it says so and only offers "Close".
 * Props: visible, onClose, onSuccess(result) (after the user acknowledges "connected"), userEmail.
 */
import { MaterialIcons } from '@expo/vector-icons';
import { useCallback, useEffect, type ComponentProps, type ReactElement } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { GoogleConnectResult } from '../../core/contracts';
import { useT } from '../../i18n';
import { useCalendarStatus } from '../../services/calendar';
import { PrimaryButton } from './CalendarSyncParts';
import { useCalendarPalette } from './palette';
import { refreshGoogleState, useGoogleConnect } from './useCalendarActions';

const BENEFITS: readonly { icon: ComponentProps<typeof MaterialIcons>['name']; key: 'alerts' | 'twoWay' | 'meet' }[] = [
  { icon: 'notifications-active', key: 'alerts' },
  { icon: 'sync', key: 'twoWay' },
  { icon: 'videocam', key: 'meet' },
];

export interface GoogleCalendarConnectionPromptProps {
  visible: boolean;
  onClose?: () => void;
  onSuccess?: (result: GoogleConnectResult) => void;
  /** The Google account that will be connected (shown under the title). */
  userEmail?: string | null;
}

export function GoogleCalendarConnectionPrompt({ visible, onClose, onSuccess, userEmail = null }: GoogleCalendarConnectionPromptProps): ReactElement {
  const t = useT();
  const palette = useCalendarPalette();
  const insets = useSafeAreaInsets();
  const status = useCalendarStatus();
  const isConnected = status.google.connected;

  const handleConnected = useCallback(
    (result: GoogleConnectResult) => {
      onSuccess?.(result);
      onClose?.();
    },
    [onClose, onSuccess],
  );
  const { connect, connecting } = useGoogleConnect(handleConnected);

  // Refresh the shared status when the prompt opens (it may already be connected).
  useEffect(() => {
    if (visible) refreshGoogleState();
  }, [visible]);

  const close = (): void => {
    if (!connecting) onClose?.();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close} statusBarTranslucent navigationBarTranslucent>
      <View
        style={[
          styles.overlay,
          { backgroundColor: palette.backdrop, paddingTop: 24 + insets.top, paddingBottom: 24 + insets.bottom },
        ]}
      >
        <View style={[styles.modal, { backgroundColor: palette.card }]} accessibilityViewIsModal testID="google-connect-prompt">
          <ScrollView contentContainerStyle={styles.content} bounces={false}>
            <View style={styles.header}>
              <MaterialIcons name="calendar-today" size={52} color={palette.accent} />
              <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
                {t('calendar:prompt.title')}
              </Text>
              <Text style={[styles.subtitle, { color: palette.muted }]}>{t('calendar:prompt.subtitle')}</Text>
              {userEmail ? <Text style={[styles.email, { color: palette.accent }]}>{userEmail}</Text> : null}
            </View>

            {isConnected ? (
              <View style={[styles.connected, { backgroundColor: palette.successSurface }]} accessibilityLiveRegion="polite">
                <MaterialIcons name="check-circle" size={24} color={palette.onSuccessSurface} />
                <Text style={[styles.connectedText, { color: palette.onSuccessSurface }]}>{t('calendar:prompt.alreadyConnected')}</Text>
              </View>
            ) : (
              <View style={styles.benefits}>
                {BENEFITS.map((benefit) => (
                  <View key={benefit.key} style={styles.benefit}>
                    <MaterialIcons name={benefit.icon} size={20} color={palette.accent} />
                    <Text style={[styles.benefitText, { color: palette.text }]}>{t(`calendar:prompt.benefits.${benefit.key}`)}</Text>
                  </View>
                ))}
                <Text style={[styles.privacy, { color: palette.muted }]}>{t('calendar:prompt.privacy')}</Text>
              </View>
            )}

            <View style={styles.buttons}>
              {!isConnected ? (
                <PrimaryButton
                  label={connecting ? t('calendar:google.connecting') : t('calendar:prompt.connect')}
                  onPress={() => void connect()}
                  disabled={connecting}
                  busy={connecting}
                  palette={palette}
                  testID="google-connect-submit"
                />
              ) : null}
              <Pressable
                style={[styles.secondary, { borderColor: palette.border }]}
                onPress={close}
                disabled={connecting}
                accessibilityRole="button"
                accessibilityState={{ disabled: connecting }}
                testID="google-connect-close"
              >
                <Text style={[styles.secondaryText, { color: palette.muted }]}>
                  {isConnected ? t('calendar:actions.close') : t('calendar:prompt.notNow')}
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export default GoogleCalendarConnectionPrompt;

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  modal: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '100%',
    borderRadius: 16,
    elevation: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  content: {
    padding: 24,
    gap: 20,
  },
  header: {
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
  },
  email: {
    fontSize: 14,
    fontWeight: '600',
  },
  benefits: {
    gap: 10,
  },
  benefit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  benefitText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  privacy: {
    fontSize: 12,
    lineHeight: 18,
  },
  connected: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 16,
    borderRadius: 12,
  },
  connectedText: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '600',
  },
  buttons: {
    gap: 12,
  },
  secondary: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    borderRadius: 10,
    paddingVertical: 12,
    borderWidth: 1,
  },
  secondaryText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
