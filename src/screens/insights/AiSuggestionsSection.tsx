/**
 * Optional "Get AI suggestions" on the insights screen. It explains first (one request of the
 * daily AI limit, with today's usage when known; the meetings are processed by OpenAI through our
 * server), then sends a fixed question through the app-wide assistant conversation and shows the
 * reply here. Proposed changes are never applied here: they are confirmed in the assistant.
 *
 * MG Indigo: neutral Card under a SectionHeader with a tertiaryContainer lightbulb circle; a
 * request failure shows an error Banner with Retry (the explanation stays visible around it);
 * the reply reads as assistant speech on surfaceContainerHigh.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { ActivityIndicator, HelperText, Text } from 'react-native-paper';

import { Banner, Card, MGButton, SectionHeader } from '../../components/ui';
import { PLAN_DAILY_AI_LIMITS } from '../../core/aiContract';
import { createLogger } from '../../core/logger';
import { useLanguage, useT } from '../../i18n';
import { createAssistantFormatter, describeAssistantError, describeUsage, useAssistant } from '../../services/ai';
import { useAuth } from '../../services/auth';
import { useEntitlement, usePreferences, useSyncState } from '../../services/data';
import { componentMetrics, radii, spacing, useAppTheme } from '../../theme';
import { VerifyEmailBanner, isVerificationGateError } from '../shared/VerifyEmailBanner';
import { suggestionState, type SuggestionRequest } from './aiSuggestions';
import type { InsightPeriod } from './meetingInsights';

const log = createLogger('insights.ai');

export interface AiSuggestionsSectionProps {
  period: InsightPeriod;
  onOpenAssistant(): void;
}

export function AiSuggestionsSection({ period, onOpenAssistant }: AiSuggestionsSectionProps): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const { authUser } = useAuth();
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

  // The server's verification gate reads exactly like the banner above this section (section 25).
  const errorText =
    state.status === 'failed'
      ? isVerificationGateError(assistant.error, authUser)
        ? t('auth:verify.assistantBody')
        : describeAssistantError(fmt, assistant.error).message
      : null;
  const proposed = state.reply?.actionIds.length ?? 0;
  const disabled = !online || busyElsewhere || state.status === 'sending' || usage?.exhausted === true;

  return (
    <View>
      <SectionHeader title={t('insights:ai.title')} />
      <VerifyEmailBanner style={styles.verifyBanner} />
      <Card testID="ai-suggestions">
        <View style={styles.introRow}>
          <View style={[styles.circle, { backgroundColor: colors.tertiaryContainer }]}>
            <MaterialCommunityIcons
              name="lightbulb-on-outline"
              size={componentMetrics.iconInline}
              color={colors.onTertiaryContainer}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
          </View>
          <Text variant="bodyMedium" style={[styles.intro, { color: colors.onSurfaceVariant }]}>
            {t('insights:ai.description')}
          </Text>
        </View>
        {usage ? (
          <Text
            variant="labelMedium"
            style={[styles.usage, { color: colors.onSurfaceVariant }]}
            accessibilityLabel={usage.accessibilityLabel}
            testID="ai-usage"
          >
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
          <MGButton variant="tonal" size="sm" icon="robot-outline" style={styles.button} onPress={confirm} disabled={disabled} testID="ai-suggestions-button">
            {t('insights:ai.button')}
          </MGButton>
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
          <Banner
            tone="error"
            text={errorText}
            action={online ? { label: t('insights:ai.retry'), onPress: () => void retry() } : undefined}
            style={styles.result}
            testID="ai-suggestions-error"
          />
        ) : null}

        {state.reply ? (
          <View
            style={[styles.result, styles.reply, { backgroundColor: colors.surfaceContainerHigh }]}
            accessibilityLiveRegion="polite"
            testID="ai-suggestions-reply"
          >
            <Text variant="labelLarge">{t('insights:ai.replyTitle')}</Text>
            <Text variant="bodyMedium" selectable style={styles.replyText}>
              {state.reply.content}
            </Text>
            {proposed > 0 ? (
              <Text variant="bodySmall" style={[styles.replyText, { color: colors.onSurfaceVariant }]}>
                {t('insights:ai.proposed', { count: proposed })}
              </Text>
            ) : null}
            <MGButton variant="ghost" size="sm" icon="chat-outline" style={styles.inline} onPress={onOpenAssistant} testID="ai-open-chat">
              {t('insights:ai.openChat')}
            </MGButton>
          </View>
        ) : null}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  verifyBanner: {
    marginBottom: componentMetrics.cardGap,
  },
  introRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  circle: {
    width: componentMetrics.avatarSize,
    height: componentMetrics.avatarSize,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  intro: {
    flex: 1,
  },
  usage: {
    marginTop: spacing.sm,
  },
  button: {
    marginTop: spacing.md,
    alignSelf: 'flex-start',
  },
  sending: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  sendingText: {
    marginLeft: spacing.md,
  },
  result: {
    marginTop: spacing.md,
  },
  reply: {
    borderRadius: radii.md,
    padding: spacing.md,
  },
  replyText: {
    marginTop: spacing.sm,
  },
  inline: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
  },
});
