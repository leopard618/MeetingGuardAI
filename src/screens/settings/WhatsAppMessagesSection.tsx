/**
 * M13: "Messages from Meeting Guard AI" on the WhatsApp screen (linked view): one switch per kind
 * of message the bot may start, all off by default (docs/v2/WhatsApp-Templates-2026-11-12.md
 * section 7). Hidden while the server cannot send them (templates mode off). The opt-in text
 * names the business and says that messages will be sent, as Meta's opt-in rules ask.
 */
import type { ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { Switch, Text } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import { Banner, ListGroup, ListRow } from '../../components/ui';
import type { WhatsappMessageSwitch } from '../../core/aiContract';
import { useT } from '../../i18n';
import { useWhatsAppMessages, type WhatsAppMessagesService } from '../../services/whatsapp';
import { spacing, useAppTheme } from '../../theme';
import { Section } from '../shared/Section';

/** Shown in this order; confirmations stays hidden until the server offers it. */
const ROWS: readonly WhatsappMessageSwitch[] = ['agenda', 'debrief', 'confirmations', 'commitments', 'reminders'];

export function WhatsAppMessagesSection({ service }: { service?: WhatsAppMessagesService }): ReactElement | null {
  const t = useT();
  const { colors } = useAppTheme();
  const { state, saving, toggle } = useWhatsAppMessages(true, service);
  if (state === null || !state.available || !state.linked) return null;

  const onToggle = (key: WhatsappMessageSwitch, value: boolean): void => {
    toggle(key, value).catch(() => {
      Toast.show({ type: 'error', text1: t('whatsapp:messages.error') });
    });
  };
  const anyOn = ROWS.some((key) => state.switches[key]);

  return (
    <Section title={t('whatsapp:messages.title')} testID="whatsapp-messages">
      <Text variant="bodyMedium" style={[styles.explainer, { color: colors.onSurfaceVariant }]}>
        {t('whatsapp:messages.explainer')}
      </Text>
      {state.stoppedAt !== null && !anyOn ? (
        <View style={styles.banner}>
          <Banner tone="info" text={t('whatsapp:messages.stopped')} testID="whatsapp-messages-stopped" />
        </View>
      ) : null}
      <ListGroup>
        {ROWS.filter((key) => state.offered[key]).map((key) => (
          <ListRow
            key={key}
            title={t(`whatsapp:messages.${key}.title`)}
            supporting={t(`whatsapp:messages.${key}.hint`)}
            trailing={
              <Switch
                value={state.switches[key]}
                disabled={saving !== null}
                onValueChange={(value) => onToggle(key, value)}
                accessibilityLabel={t(`whatsapp:messages.${key}.title`)}
                testID={`whatsapp-messages-${key}`}
              />
            }
            onPress={saving !== null ? undefined : () => onToggle(key, !state.switches[key])}
            accessibilityRole="switch"
            accessibilityState={{ checked: state.switches[key], disabled: saving !== null }}
            testID={`whatsapp-messages-row-${key}`}
          />
        ))}
      </ListGroup>
    </Section>
  );
}

const styles = StyleSheet.create({
  explainer: {
    marginBottom: spacing.md,
  },
  banner: {
    marginBottom: spacing.md,
  },
});
