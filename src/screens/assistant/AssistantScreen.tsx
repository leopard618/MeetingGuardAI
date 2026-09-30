/**
 * AI assistant chat (route "AIChat", params { followup?: meetingId, prefill?: text, autoStart? }).
 *
 * Built on useAssistant(): the Firebase "assistant" callable proposes actions, this screen shows
 * them as cards and nothing changes until the user confirms in MeetingConfirmationModal.
 * - Chat bubbles (FlatList), typing indicator, quick-reply suggestion chips (examples when empty).
 * - Usage pill ("3/5 today") and inline errors with Retry / See plans.
 * - Follow-up mode (post-meeting notification -> assistant?followup=<meetingId>): only the app's
 *   own notification starts the request by itself (`autoStart`); an external link shows a
 *   "Get follow-up ideas" button, so no paid request is sent without a tap.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { StackScreenProps } from '@react-navigation/stack';
import { useMemo, useRef, useState, type ReactElement } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Snackbar } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MeetingConfirmationModal } from '../../components/MeetingConfirmationModal';
import { useTheme } from '../../contexts/ThemeContext';
import { AI_LIMITS, PLAN_DAILY_AI_LIMITS } from '../../core/aiContract';
import type { ActionResult, RootStackParamList } from '../../core/contracts';
import { useLanguage, useT } from '../../i18n';
import { useAssistant } from '../../services/ai';
import { createAssistantFormatter } from '../../services/ai/formatter';
import { assistantPalette, describeUsage, feedbackColors, type AssistantPalette, type Feedback } from '../../services/ai/presentation';
import type { AssistantFormatter, AssistantHookResult, ChatMessage } from '../../services/ai/types';
import { useEntitlement, useMeeting, usePreferences } from '../../services/data';
import { componentMetrics, radii, spacing, typography } from '../../theme';
import { ActionCard } from './ActionCard';
import { AssistantAvatar, ErrorNotice, MessageBubble, SuggestionChips, TypingIndicator, UsagePill, WelcomeBubble } from './ChatPieces';
import {
  EXAMPLE_KEYS,
  USAGE_CLOCK_MS,
  canStartFollowUp,
  chatErrorDescription,
  confirmInOrder,
  parseChatParams,
  reviewableStates,
  sendableText,
  summarizeResults,
  visibleSuggestions,
} from './chatModel';
import { useKeyboardAvoidance } from '../shared/useKeyboardAvoidance';
import { useLiveNow } from '../shared/useLiveNow';

type Props = StackScreenProps<RootStackParamList, 'AIChat'>;

const ICON_HIT_SLOP = 8;

/** One message and the action cards attached to it. */
function MessageBlock({
  message,
  assistant,
  fmt,
  palette,
  followUpTitle,
  onReview,
  onOpenMeeting,
}: {
  message: ChatMessage;
  assistant: AssistantHookResult;
  fmt: AssistantFormatter;
  palette: AssistantPalette;
  followUpTitle: string | null;
  onReview: (actionId: string) => void;
  onOpenMeeting: (meetingId: string) => void;
}): ReactElement {
  return (
    <View style={styles.messageBlock}>
      <MessageBubble message={message} fmt={fmt} palette={palette} followUpTitle={followUpTitle} />
      {message.actionIds.map((actionId) => {
        const state = assistant.actions[actionId];
        if (!state) return null;
        return (
          <ActionCard
            key={actionId}
            state={state}
            fmt={fmt}
            palette={palette}
            onReview={onReview}
            onReject={assistant.reject}
            onOpenMeeting={onOpenMeeting}
          />
        );
      })}
    </View>
  );
}

function Welcome({
  fmt,
  palette,
  examples,
  onExample,
}: {
  fmt: AssistantFormatter;
  palette: AssistantPalette;
  examples: string[];
  onExample: (text: string) => void;
}): ReactElement {
  return (
    <View style={styles.welcome} testID="assistant-welcome">
      <WelcomeBubble palette={palette} text={fmt.t('ai:chat.welcome')} />
      <SuggestionChips items={examples} onPress={onExample} palette={palette} disabled={false} title={fmt.t('ai:chat.examplesTitle')} />
    </View>
  );
}

export function AssistantScreen({ navigation, route }: Props): ReactElement {
  const t = useT();
  const { language } = useLanguage();
  const { isDarkMode } = useTheme();
  const palette = assistantPalette(isDarkMode);
  const insets = useSafeAreaInsets();
  const { rootRef, onRootLayout, keyboardVerticalOffset, keyboardVisible } = useKeyboardAvoidance();
  const { preferences } = usePreferences();
  const use24Hour = preferences.use24HourClock;
  const fmt = useMemo(() => createAssistantFormatter({ t, language, use24Hour }), [t, language, use24Hour]);

  const { followUpMeetingId, prefill, autoStartFollowUp } = parseChatParams(route.params);
  const assistant = useAssistant({ followUpMeetingId, autoStartFollowUp });
  const { plan, isLoaded: planLoaded } = useEntitlement();
  const { meeting: followUpMeeting } = useMeeting(followUpMeetingId);

  const [input, setInput] = useState(prefill);
  const [appliedPrefill, setAppliedPrefill] = useState(prefill);
  if (prefill !== appliedPrefill) {
    // A new prefill param while the screen stays mounted (adjusting state during render).
    setAppliedPrefill(prefill);
    if (prefill) setInput(prefill);
  }
  const [reviewIds, setReviewIds] = useState<string[] | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const listRef = useRef<FlatList<ChatMessage> | null>(null);
  // Daily-limit reset times; paused while another screen is on top or the app is in the background.
  const now = useLiveNow(USAGE_CLOCK_MS);

  const usage = describeUsage(fmt, assistant.usage, planLoaded ? { plan, limit: PLAN_DAILY_AI_LIMITS[plan] } : null, now);
  const errorDescription = chatErrorDescription(fmt, assistant, now);
  const suggestions = visibleSuggestions(assistant.messages, assistant.isSending);
  const examples = useMemo(() => EXAMPLE_KEYS.map((key) => fmt.t(`ai:examples.${key}`)), [fmt]);
  const followUpTitle = followUpMeeting?.title ?? null;
  const reviewStates = reviewableStates(reviewIds, assistant.actions);
  const showFollowUpButton = canStartFollowUp({
    followUpMeetingId,
    autoStartFollowUp,
    isLoaded: assistant.isLoaded,
    isSending: assistant.isSending,
    followUpsRequested: assistant.followUpsRequested,
  });
  const canSend = sendableText(input, assistant) !== null;
  const hasMessages = assistant.messages.length > 0;
  const pendingCount = assistant.pendingActionIds.length;
  const feedbackStyle = feedback ? feedbackColors(palette, feedback.tone) : null;

  const send = (): void => {
    const text = sendableText(input, assistant);
    if (text === null) return;
    setInput('');
    void assistant.send(text);
  };

  /** A tapped suggestion chip is sent as is and marked as model-written (never "typed"). */
  const sendSuggestion = (chip: string): void => {
    const text = sendableText(chip, assistant);
    if (text === null) return;
    void assistant.send(text, { origin: 'suggestion' });
  };

  const openMeeting = (meetingId: string): void => navigation.navigate('MeetingDetails', { meetingId });
  const reviewOne = (actionId: string): void => setReviewIds([actionId]);

  const confirmReviewed = async (): Promise<void> => {
    const items = reviewStates.map((state) => ({ id: state.action.id, type: state.action.type }));
    if (items.length === 0) return;
    setConfirming(true);
    setReviewIds(null);
    let results: ActionResult[] = [];
    try {
      // In order (later actions may depend on earlier ones); an action that fails or disappeared
      // (conversation cleared meanwhile) becomes a failed result instead of an unhandled rejection.
      results = await confirmInOrder(items, assistant.confirm);
    } finally {
      setConfirming(false);
    }
    const summary = summarizeResults(fmt, results);
    if (summary) setFeedback(summary);
  };

  const clearConversation = (): void => {
    Alert.alert(fmt.t('ai:chat.clearTitle'), fmt.t('ai:chat.clearMessage'), [
      { text: fmt.t('ai:chat.cancel'), style: 'cancel' },
      { text: fmt.t('ai:chat.clearConfirm'), style: 'destructive', onPress: () => void assistant.reset() },
    ]);
  };

  const renderMessage = ({ item }: { item: ChatMessage }): ReactElement => (
    <MessageBlock
      message={item}
      assistant={assistant}
      fmt={fmt}
      palette={palette}
      followUpTitle={followUpTitle}
      onReview={reviewOne}
      onOpenMeeting={openMeeting}
    />
  );

  const footer = (
    <View style={styles.footerStack}>
      {assistant.isSending ? (
        <TypingIndicator palette={palette} label={assistant.followUpInFlight ? fmt.t('ai:chat.followUpLoading') : fmt.t('ai:chat.thinking')} />
      ) : null}
      {errorDescription && !assistant.isSending ? (
        <ErrorNotice
          description={errorDescription}
          canRetry={assistant.canRetry}
          onRetry={() => void assistant.retry()}
          onUpgrade={() => navigation.navigate('Pricing')}
          palette={palette}
          fmt={fmt}
        />
      ) : null}
      <SuggestionChips items={suggestions} onPress={sendSuggestion} palette={palette} disabled={assistant.isSending} />
    </View>
  );

  return (
    <View
      ref={rootRef}
      onLayout={onRootLayout}
      style={[styles.container, { backgroundColor: palette.background, paddingLeft: insets.left, paddingRight: insets.right }]}
    >
      <KeyboardAvoidingView style={styles.flex} behavior="padding" keyboardVerticalOffset={keyboardVerticalOffset}>
        <View style={[styles.topBar, { backgroundColor: palette.surface, borderBottomColor: palette.border }]}>
          <AssistantAvatar palette={palette} />
          {/* The stack header already shows the screen title ("AI assistant"). */}
          <Text style={[styles.flex, styles.topSubtitle, { color: palette.textMuted }]} numberOfLines={2}>
            {fmt.t('ai:chat.subtitle')}
          </Text>
          <UsagePill usage={usage} palette={palette} />
          <Pressable
            onPress={clearConversation}
            disabled={!hasMessages}
            hitSlop={ICON_HIT_SLOP}
            style={[styles.iconButton, { opacity: hasMessages ? 1 : 0.4 }]}
            accessibilityRole="button"
            accessibilityLabel={fmt.t('ai:chat.clear')}
            accessibilityState={{ disabled: !hasMessages }}
            testID="assistant-clear"
          >
            <MaterialCommunityIcons name="delete-sweep-outline" size={24} color={palette.textMuted} />
          </Pressable>
        </View>

        {followUpMeetingId ? (
          <View style={[styles.banner, { backgroundColor: palette.infoSurface }]}>
            <MaterialCommunityIcons name="calendar-check-outline" size={16} color={palette.info} />
            <Text style={[styles.bannerText, { color: palette.info }]} numberOfLines={2}>
              {followUpTitle ? fmt.t('ai:chat.followUpFor', { title: followUpTitle }) : fmt.t('ai:chat.followUpGeneric')}
            </Text>
            {showFollowUpButton ? (
              <Pressable
                onPress={() => void assistant.startFollowUp(followUpMeetingId)}
                hitSlop={6}
                style={[styles.bannerButton, { backgroundColor: palette.primary }]}
                accessibilityRole="button"
                testID="assistant-start-followup"
              >
                <Text style={[styles.bannerButtonText, { color: palette.onPrimary }]}>{fmt.t('ai:chat.followUpStart')}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {!assistant.isLoaded ? (
          <View style={styles.center} accessible accessibilityLabel={fmt.t('ai:chat.loading')} testID="assistant-loading">
            <ActivityIndicator size="large" color={palette.primary} />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={assistant.messages}
            keyExtractor={(message) => message.id}
            renderItem={renderMessage}
            extraData={assistant}
            style={styles.flex}
            contentContainerStyle={styles.messages}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            ListEmptyComponent={
              assistant.isSending ? null : <Welcome fmt={fmt} palette={palette} examples={examples} onExample={setInput} />
            }
            ListFooterComponent={footer}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
            testID="assistant-messages"
          />
        )}

        {pendingCount >= 2 ? (
          <View style={[styles.pendingBar, { backgroundColor: palette.surface, borderTopColor: palette.border }]}>
            <Text style={[styles.pendingText, { color: palette.text }]}>{fmt.t('ai:chat.pending', { count: pendingCount })}</Text>
            <Pressable
              onPress={() => setReviewIds([...assistant.pendingActionIds])}
              hitSlop={6}
              style={[styles.bannerButton, { backgroundColor: palette.primary }]}
              accessibilityRole="button"
              testID="assistant-review-all"
            >
              <Text style={[styles.bannerButtonText, { color: palette.onPrimary }]}>{fmt.t('ai:chat.reviewAll')}</Text>
            </Pressable>
          </View>
        ) : null}

        <View
          style={[
            styles.composer,
            {
              borderTopColor: palette.border,
              backgroundColor: palette.surface,
              paddingBottom: 8 + (keyboardVisible ? 0 : insets.bottom),
            },
          ]}
        >
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={fmt.t('ai:chat.placeholder')}
            placeholderTextColor={palette.textMuted}
            style={[styles.input, { color: palette.text, backgroundColor: palette.inputSurface }]}
            multiline
            maxLength={AI_LIMITS.maxMessageChars}
            editable={assistant.isLoaded}
            accessibilityLabel={fmt.t('ai:chat.placeholder')}
            testID="assistant-input"
          />
          <Pressable
            onPress={send}
            disabled={!canSend}
            style={[styles.sendButton, { backgroundColor: palette.primary, opacity: canSend ? 1 : 0.4 }]}
            accessibilityRole="button"
            accessibilityLabel={fmt.t('ai:chat.send')}
            accessibilityState={{ disabled: !canSend }}
            testID="assistant-send"
          >
            <MaterialCommunityIcons name="send" size={20} color={palette.onPrimary} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <MeetingConfirmationModal
        use24Hour={use24Hour}
        visible={reviewStates.length > 0}
        actions={reviewStates}
        onConfirm={() => void confirmReviewed()}
        onCancel={() => setReviewIds(null)}
        onReject={assistant.reject}
        isBusy={confirming}
      />

      <Snackbar
        visible={feedback !== null}
        onDismiss={() => setFeedback(null)}
        duration={4000}
        style={feedbackStyle ? { backgroundColor: feedbackStyle.background } : undefined}
        wrapperStyle={{ paddingBottom: insets.bottom }}
      >
        <Text style={{ color: feedbackStyle?.color ?? palette.text }}>{feedback?.message ?? ''}</Text>
      </Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Reads as one surface with the stack header: surface bg + a single 1px hairline below.
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: componentMetrics.screenGutter,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
  },
  topSubtitle: {
    ...typography.titleS,
  },
  iconButton: {
    width: componentMetrics.touchTargetMin,
    height: componentMetrics.touchTargetMin,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: componentMetrics.screenGutter,
    paddingVertical: spacing.sm,
  },
  bannerText: {
    flex: 1,
    ...typography.labelM,
  },
  bannerButton: {
    minHeight: componentMetrics.buttonHeightSmall,
    borderRadius: radii.full,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerButtonText: {
    ...typography.labelL,
  },
  messages: {
    padding: componentMetrics.screenGutter,
    gap: componentMetrics.cardGap,
  },
  welcome: {
    gap: componentMetrics.cardGap,
  },
  messageBlock: {
    gap: spacing.sm,
  },
  footerStack: {
    gap: componentMetrics.cardGap,
  },
  pendingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: componentMetrics.screenGutter,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  pendingText: {
    flex: 1,
    ...typography.labelL,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
    minHeight: componentMetrics.touchTargetMin,
    maxHeight: 140,
    borderRadius: radii.full,
    paddingHorizontal: componentMetrics.screenGutter,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    ...typography.bodyL,
  },
  sendButton: {
    width: componentMetrics.touchTargetMin,
    height: componentMetrics.touchTargetMin,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
