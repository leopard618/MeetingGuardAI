/**
 * Optional "Get AI suggestions" on the insights screen. It explains first (one request of the
 * daily AI limit, with today's usage when known; the meetings are processed by OpenAI through our
 * server), then sends a fixed question through the app-wide assistant conversation and shows the
 * reply here. Proposed changes are never applied here: they are confirmed in the assistant.
 */
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, HelperText, Text, useTheme as usePaperTheme } from 'react-native-paper';

import { PLAN_DAILY_AI_LIMITS } from '../../core/aiContract';
import { createLogger } from '../../core/logger';
import { useLanguage, useT } from '../../i18n';
import { createAssistantFormatter, describeAssistantError, describeUsage, useAssistant } from '../../services/ai';
import { useEntitlement, usePreferences, useSyncState } from '../../services/data';
import { Section } from '../shared/Section';
import { suggestionState, type SuggestionRequest } from './aiSuggestions';
import type { InsightPeriod } from './meetingInsights';

const log = createLogger('insights.ai');

export interface AiSuggestionsSectionProps {
  period: InsightPeriod;
  onOpenAssistant(): void;
}

export function AiSuggestionsSection({ period, onOpenAssistant }: AiSuggestionsSectionProps): ReactElement {
  const t = useT();
  const theme = usePaperTheme();
  const { language } = useLanguage();
  const { preferences } = usePreferences();
  const { plan, isLoaded: planLoaded } = useEntitlement();
  const { online } = useSyncState();
  const assistant = useAssistant();
  const [request, setRequest] = useState<SuggestionRequest | null>(null);
  const [settled, setSettled] = useState(true);

  const fmt = useMemo(
    () => createAssistantFormatter({ t, language, use24Hour: preferences.use24HourClock }),
    [language, preferences.use24HourClock, t],
  );
  const state = suggestionState(assistant.messages, request, { isSending: assistant.isSending, settled });
  const usage = describeUsage(fmt, assistant.usage, planLoaded ? { plan, limit: PLAN_DAILY_AI_LIMITS[plan] } : null);
  const busyElsewhere = assistant.isSending && state.status !== 'sending';

  const send = useCallback(async () => {
    const prompt = t(period === 'week' ? 'insights:ai.promptWeek' : 'insights:ai.promptMonth');
    setRequest({ prompt, beforeIds: new Set(assistant.messages.map((message) => message.id)) });
    setSettled(false);
    try {
      // App-written text: sent with the "suggestion" origin (never treated as typed by the user).
      await assistant.send(prompt, { origin: 'suggestion' });
    } catch (error) {
      log.warn('AI suggestions request failed', error);
    } finally {
      setSettled(true);
    }
  }, [assistant, period, t]);

  const retry = useCallback(async () => {
    if (!assistant.canRetry) {
      await send();
      return;
    }
    setSettled(false);
    try {
      await assistant.retry();
    } catch (error) {
      log.warn('AI suggestions retry failed', error);
    } finally {
      setSettled(true);
    }
  }, [assistant, send]);

  const confirm = (): void => {
    const cost = usage ? t('insights:ai.confirmUsage', { usage: usage.label }) : t('insights:ai.confirmNoUsage');
    Alert.alert(t('insights:ai.confirmTitle'), `${cost}\n\n${t('insights:ai.confirmPrivacy')}`, [
      { text: t('common:actions.cancel'), style: 'cancel' },
      { text: t('insights:ai.confirm'), onPress: () => void send() },
    ]);
  };

  const errorText = state.status === 'failed' ? describeAssistantError(fmt, assistant.error).message : null;
  const proposed = state.reply?.actionIds.length ?? 0;
  const disabled = !online || busyElsewhere || state.status === 'sending' || usage?.exhausted === true;

  return (
    <Section title={t('insights:ai.title')} testID="ai-suggestions">
      <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
        {t('insights:ai.description')}
      </Text>
      {usage ? (
        <Text variant="labelMedium" style={styles.usage} accessibilityLabel={usage.accessibilityLabel} testID="ai-usage">
          {usage.label}
        </Text>
      ) : null}

      {state.status === 'sending' ? (
        <View style={styles.sending} accessibilityLiveRegion="polite">
          <ActivityIndicator size="small" />
          <Text variant="bodyMedium" style={styles.sendingText}>
            {t('insights:ai.sending')}
          </Text>
        </View>
      ) : (
        <Button mode="contained-tonal" icon="robot-outline" style={styles.button} onPress={confirm} disabled={disabled} testID="ai-suggestions-button">
          {t('insights:ai.button')}
        </Button>
      )}
      {!online ? (
        <HelperText type="info" visible>
          {t('insights:ai.offline')}
        </HelperText>
      ) : busyElsewhere ? (
        <HelperText type="info" visible>
          {t('insights:ai.busy')}
        </HelperText>
      ) : null}

      {errorText ? (
        <View style={styles.result} accessibilityLiveRegion="polite" testID="ai-suggestions-error">
          <Text variant="bodyMedium" style={{ color: theme.colors.error }}>
            {errorText}
          </Text>
          {online ? (
            <Button mode="text" compact style={styles.inline} onPress={() => void retry()}>
              {t('insights:ai.retry')}
            </Button>
          ) : null}
        </View>
      ) : null}

      {state.reply ? (
        <View style={[styles.result, styles.reply, { borderColor: theme.colors.outlineVariant }]} accessibilityLiveRegion="polite" testID="ai-suggestions-reply">
          <Text variant="labelLarge" style={{ color: theme.colors.primary }}>
            {t('insights:ai.replyTitle')}
          </Text>
          <Text variant="bodyMedium" selectable style={styles.replyText}>
            {state.reply.content}
          </Text>
          {proposed > 0 ? (
            <Text variant="bodySmall" style={[styles.replyText, { color: theme.colors.onSurfaceVariant }]}>
              {t('insights:ai.proposed', { count: proposed })}
            </Text>
          ) : null}
          <Button mode="text" compact icon="chat-outline" style={styles.inline} onPress={onOpenAssistant} testID="ai-open-chat">
            {t('insights:ai.openChat')}
          </Button>
        </View>
      ) : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  usage: {
    marginTop: 8,
  },
  button: {
    marginTop: 12,
    alignSelf: 'flex-start',
  },
  sending: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  sendingText: {
    marginLeft: 12,
  },
  result: {
    marginTop: 12,
  },
  reply: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
  },
  replyText: {
    marginTop: 6,
  },
  inline: {
    alignSelf: 'flex-start',
    marginTop: 4,
  },
});
