// @ts-check
/**
 * AI assistant chat (route "AIChat", params { followup?: meetingId, prefill?: text }).
 *
 * Built on useAssistant(): the Firebase "assistant" callable proposes actions, this screen shows
 * them as cards and nothing changes until the user confirms in MeetingConfirmationModal.
 * - Chat bubbles, typing indicator, quick-reply suggestion chips (examples when empty).
 * - Usage pill ("3/5 today") and inline errors with Retry / See plans.
 * - Follow-up mode (post-meeting notification -> assistant?followup=<meetingId>).
 * Screen-level pieces are module-level components (no inline component definitions).
 */
import { MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Snackbar } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import MeetingConfirmationModal from '../components/MeetingConfirmationModal';
import { useTheme } from '../contexts/ThemeContext';
import { AI_LIMITS, PLAN_DAILY_AI_LIMITS } from '../core/aiContract';
import { useLanguage, useT } from '../i18n';
import { useAssistant } from '../services/ai';
import { createAssistantFormatter } from '../services/ai/formatter';
import {
  actionIconName,
  assistantPalette,
  describeAssistantError,
  describeResult,
  describeUsage,
  describeWarnings,
  feedbackColors,
  formatWhen,
  isDestructiveAction,
} from '../services/ai/presentation';
import { useEntitlement, useMeeting, usePreferences } from '../services/data';

/** @typedef {import('../core/contracts').ProposedActionState} ProposedActionState */
/** @typedef {import('../core/contracts').ActionResult} ActionResult */
/** @typedef {import('../services/ai/types').ChatMessage} ChatMessage */
/** @typedef {import('../services/ai/types').AssistantFormatter} AssistantFormatter */
/** @typedef {import('../services/ai/types').AiActionPreview} AiActionPreview */
/** @typedef {import('../services/ai/types').AiActionResult} AiActionResult */
/** @typedef {import('../services/ai/presentation').AssistantPalette} AssistantPalette */
/** @typedef {import('../services/ai/presentation').Feedback} Feedback */
/** @typedef {import('../services/ai/presentation').ErrorDescription} ErrorDescription */
/** @typedef {import('../services/ai/presentation').UsageDescription} UsageDescription */

const EXAMPLE_KEYS = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'];
const USAGE_CLOCK_MS = 60_000;

/**
 * @param {AssistantFormatter} fmt
 * @param {string} iso
 */
function timestamp(fmt, iso) {
  try {
    return fmt.time(iso);
  } catch {
    return '';
  }
}

/**
 * @param {AssistantFormatter} fmt
 * @param {ActionResult[]} results
 * @returns {Feedback}
 */
function summarizeResults(fmt, results) {
  if (results.length === 1 && results[0]) return describeResult(fmt, results[0]);
  const done = results.filter((r) => r.status === 'done').length;
  if (done === results.length) return { tone: 'success', message: fmt.t('ai:results.allDone', { count: done }) };
  return { tone: 'warning', message: fmt.t('ai:results.someFailed', { done, total: results.length }) };
}

// ---------------------------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------------------------

/** @param {{ palette: AssistantPalette, label: string }} props */
function TypingIndicator({ palette, label }) {
  const [dots] = useState(() => [new Animated.Value(0.3), new Animated.Value(0.3), new Animated.Value(0.3)]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.stagger(
        160,
        dots.map((dot) =>
          Animated.sequence([
            Animated.timing(dot, { toValue: 1, duration: 280, useNativeDriver: true }),
            Animated.timing(dot, { toValue: 0.3, duration: 280, useNativeDriver: true }),
          ]),
        ),
      ),
    );
    loop.start();
    return () => loop.stop();
  }, [dots]);

  return (
    <View style={styles.assistantRow} accessibilityLiveRegion="polite" accessibilityLabel={label} testID="typing-indicator">
      <View style={[styles.avatar, { backgroundColor: palette.surfaceAlt }]}>
        <MaterialCommunityIcons name="robot-outline" size={18} color={palette.primary} />
      </View>
      <View style={[styles.bubble, styles.typingBubble, { backgroundColor: palette.assistantBubble }]}>
        <View style={styles.dots}>
          {dots.map((dot, index) => (
            <Animated.View key={index} style={[styles.dot, { backgroundColor: palette.textMuted, opacity: dot }]} />
          ))}
        </View>
        <Text style={[styles.typingText, { color: palette.textMuted }]}>{label}</Text>
      </View>
    </View>
  );
}

/**
 * @param {{
 *   message: ChatMessage,
 *   fmt: AssistantFormatter,
 *   palette: AssistantPalette,
 *   followUpTitle: string | null,
 * }} props
 */
function MessageBubble({ message, fmt, palette, followUpTitle }) {
  const isUser = message.role === 'user';
  const time = timestamp(fmt, message.createdAt);
  const hasText = message.content.trim().length > 0;

  if (isUser) {
    return (
      <View style={styles.userRow} testID={`message-${message.id}`}>
        <View style={[styles.bubble, styles.userBubble, { backgroundColor: palette.userBubble }]}>
          <Text style={[styles.messageText, { color: palette.onUserBubble }]} selectable>
            {message.content}
          </Text>
          <Text style={[styles.time, { color: palette.onUserBubble }]}>{time}</Text>
        </View>
        {message.delivery === 'failed' ? (
          <View style={styles.failedLine}>
            <MaterialCommunityIcons name="alert-circle-outline" size={14} color={palette.danger} />
            <Text style={[styles.failedText, { color: palette.danger }]}>{fmt.t('ai:chat.notSent')}</Text>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.assistantRow} testID={`message-${message.id}`}>
      <View style={[styles.avatar, { backgroundColor: palette.surfaceAlt }]}>
        <MaterialCommunityIcons name="robot-outline" size={18} color={palette.primary} />
      </View>
      <View style={styles.assistantColumn}>
        {message.followUpMeetingId ? (
          <Text style={[styles.followUpTag, { color: palette.primary }]}>
            {followUpTitle ? fmt.t('ai:chat.followUpFor', { title: followUpTitle }) : fmt.t('ai:chat.followUpGeneric')}
          </Text>
        ) : null}
        {hasText ? (
          <View style={[styles.bubble, styles.assistantBubble, { backgroundColor: palette.assistantBubble }]}>
            <Text style={[styles.messageText, { color: palette.onAssistantBubble }]} selectable>
              {message.content}
            </Text>
            <Text style={[styles.time, { color: palette.textMuted }]}>{time}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/**
 * @param {{
 *   state: ProposedActionState,
 *   fmt: AssistantFormatter,
 *   palette: AssistantPalette,
 *   onReview: (actionId: string) => void,
 *   onReject: (actionId: string) => void,
 *   onOpenMeeting: (meetingId: string) => void,
 * }} props
 */
function ActionCard({ state, fmt, palette, onReview, onReject, onOpenMeeting }) {
  const { action, status } = state;
  const preview = /** @type {AiActionPreview | null} */ (state.preview);
  const destructive = isDestructiveAction(action);
  const accent = destructive ? palette.danger : palette.primary;

  if (action.type === 'list') {
    const meetings = preview?.meetings ?? [];
    return (
      <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]} testID={`action-${action.id}`}>
        <View style={styles.cardHeader}>
          <MaterialCommunityIcons name={actionIconName(action.type)} size={18} color={palette.primary} />
          <Text style={[styles.cardTitle, { color: palette.text }]} numberOfLines={2}>
            {action.summary}
          </Text>
        </View>
        {!preview ? <ActivityIndicator size="small" color={palette.primary} /> : null}
        {preview && meetings.length === 0 ? (
          <Text style={[styles.cardNote, { color: palette.textMuted }]}>{fmt.t('ai:actions.listEmpty')}</Text>
        ) : null}
        {meetings.map((meeting) => (
          <Pressable
            key={meeting.id}
            onPress={() => onOpenMeeting(meeting.id)}
            style={[styles.listItem, { borderColor: palette.border }]}
            accessibilityRole="button"
            accessibilityHint={fmt.t('ai:actions.openMeeting')}
          >
            <View style={styles.listItemText}>
              <Text style={[styles.listItemTitle, { color: palette.text }]} numberOfLines={1}>
                {meeting.title}
              </Text>
              <Text style={[styles.cardNote, { color: palette.textMuted }]} numberOfLines={1}>
                {formatWhen(fmt, meeting)}
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={20} color={palette.textMuted} />
          </Pressable>
        ))}
        {preview && preview.missingMeetingIds.length > 0 ? (
          <Text style={[styles.cardNote, { color: palette.warning }]}>
            {fmt.t('ai:warnings.meeting_not_found', { count: preview.missingMeetingIds.length })}
          </Text>
        ) : null}
      </View>
    );
  }

  const warnings = preview && status === 'proposed' ? describeWarnings(fmt, preview) : [];
  const result = /** @type {AiActionResult | null} */ (state.result);
  const feedback = result ? describeResult(fmt, result) : null;
  const feedbackStyle = feedback ? feedbackColors(palette, feedback.tone) : null;
  const openableId =
    result && result.status === 'done' && action.type !== 'delete_meeting' && result.meetingIds.length === 1 ? result.meetingIds[0] : null;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: palette.surface, borderColor: status === 'proposed' ? accent : palette.border },
        status === 'rejected' ? styles.cardMuted : null,
      ]}
      testID={`action-${action.id}`}
    >
      <View style={styles.cardHeader}>
        <MaterialCommunityIcons name={actionIconName(action.type)} size={18} color={accent} />
        <Text style={[styles.cardType, { color: accent }]}>{fmt.t(`ai:actions.type.${action.type}`)}</Text>
        <View style={[styles.statusChip, { backgroundColor: palette.surfaceAlt }]}>
          <Text style={[styles.statusText, { color: palette.textMuted }]}>{fmt.t(`ai:actions.status.${status}`)}</Text>
        </View>
      </View>
      <Text style={[styles.cardTitle, { color: palette.text }]}>{action.summary}</Text>
      {warnings.length > 0 ? (
        <View style={styles.warningLine}>
          <MaterialCommunityIcons name="alert-outline" size={14} color={palette.warning} />
          <Text style={[styles.cardNote, styles.flex, { color: palette.warning }]} numberOfLines={2}>
            {warnings[0]}
            {warnings.length > 1 ? ` ${fmt.t('ai:actions.moreWarnings', { count: warnings.length - 1 })}` : ''}
          </Text>
        </View>
      ) : null}

      {status === 'executing' ? (
        <View style={styles.working}>
          <ActivityIndicator size="small" color={accent} />
          <Text style={[styles.cardNote, { color: palette.textMuted }]}>{fmt.t('ai:actions.status.executing')}</Text>
        </View>
      ) : null}

      {feedback && feedbackStyle && (status === 'done' || status === 'failed') ? (
        <View style={[styles.feedback, { backgroundColor: feedbackStyle.background }]}>
          <Text style={[styles.cardNote, { color: feedbackStyle.color }]}>{feedback.message}</Text>
        </View>
      ) : null}

      <View style={styles.cardActions}>
        {status === 'proposed' || status === 'failed' ? (
          <>
            <Pressable
              onPress={() => onReject(action.id)}
              style={[styles.smallButton, styles.secondaryButton, { borderColor: palette.border }]}
              accessibilityRole="button"
              testID={`action-dismiss-${action.id}`}
            >
              <Text style={[styles.smallButtonText, { color: palette.text }]}>{fmt.t('ai:actions.dismiss')}</Text>
            </Pressable>
            <Pressable
              onPress={() => onReview(action.id)}
              style={[styles.smallButton, { backgroundColor: accent }]}
              accessibilityRole="button"
              testID={`action-review-${action.id}`}
            >
              <Text style={[styles.smallButtonText, { color: destructive ? palette.onDanger : palette.onPrimary }]}>
                {status === 'failed' ? fmt.t('ai:actions.tryAgain') : fmt.t('ai:actions.review')}
              </Text>
            </Pressable>
          </>
        ) : null}
        {openableId ? (
          <Pressable
            onPress={() => onOpenMeeting(openableId)}
            style={[styles.smallButton, styles.secondaryButton, { borderColor: palette.border }]}
            accessibilityRole="button"
          >
            <Text style={[styles.smallButtonText, { color: palette.text }]}>{fmt.t('ai:actions.openMeeting')}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/**
 * @param {{ items: string[], onPress: (text: string) => void, palette: AssistantPalette, disabled: boolean, title?: string | null }} props
 */
function SuggestionChips({ items, onPress, palette, disabled, title = null }) {
  if (items.length === 0) return null;
  return (
    <View style={styles.suggestions}>
      {title ? <Text style={[styles.suggestionsTitle, { color: palette.textMuted }]}>{title}</Text> : null}
      <View style={styles.chipWrap}>
        {items.map((item) => (
          <Pressable
            key={item}
            onPress={() => onPress(item)}
            disabled={disabled}
            style={[styles.chip, { backgroundColor: palette.surface, borderColor: palette.border, opacity: disabled ? 0.5 : 1 }]}
            accessibilityRole="button"
          >
            <Text style={[styles.chipText, { color: palette.text }]}>{item}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/**
 * @param {{
 *   description: ErrorDescription,
 *   canRetry: boolean,
 *   onRetry: () => void,
 *   onUpgrade: () => void,
 *   palette: AssistantPalette,
 *   fmt: AssistantFormatter,
 * }} props
 */
function ErrorNotice({ description, canRetry, onRetry, onUpgrade, palette, fmt }) {
  return (
    <View
      style={[styles.errorBox, { backgroundColor: palette.dangerSurface, borderColor: palette.danger }]}
      accessibilityLiveRegion="assertive"
      testID="assistant-error"
    >
      <View style={styles.warningLine}>
        <MaterialCommunityIcons name="alert-circle-outline" size={18} color={palette.danger} />
        <Text style={[styles.errorText, { color: palette.text }]}>{description.message}</Text>
      </View>
      <View style={styles.cardActions}>
        {description.recovery === 'upgrade' ? (
          <Pressable onPress={onUpgrade} style={[styles.smallButton, { backgroundColor: palette.primary }]} accessibilityRole="button">
            <Text style={[styles.smallButtonText, { color: palette.onPrimary }]}>{fmt.t('ai:errors.upgrade')}</Text>
          </Pressable>
        ) : null}
        {canRetry && description.recovery !== 'none' ? (
          <Pressable
            onPress={onRetry}
            style={[styles.smallButton, styles.secondaryButton, { borderColor: palette.border }]}
            accessibilityRole="button"
            testID="assistant-retry"
          >
            <Text style={[styles.smallButtonText, { color: palette.text }]}>{fmt.t('ai:chat.retry')}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/** @param {{ usage: UsageDescription | null, palette: AssistantPalette }} props */
function UsagePill({ usage, palette }) {
  if (!usage) return null;
  const color = usage.exhausted ? palette.danger : palette.textMuted;
  return (
    <View
      style={[styles.usagePill, { borderColor: usage.exhausted ? palette.danger : palette.border }]}
      accessible
      accessibilityLabel={usage.accessibilityLabel}
      testID="assistant-usage"
    >
      <MaterialCommunityIcons name="lightning-bolt-outline" size={14} color={color} />
      <Text style={[styles.usageText, { color }]}>{usage.label}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------------------------

/**
 * @param {{ navigation: any, route?: { params?: { followup?: string, prefill?: string, autoStart?: boolean } } }} props
 */
export default function AIChat({ navigation, route }) {
  const t = useT();
  const { language } = useLanguage();
  const { isDarkMode } = /** @type {{ isDarkMode: boolean }} */ (useTheme());
  const palette = assistantPalette(isDarkMode);
  const { preferences } = usePreferences();
  const use24Hour = preferences.use24HourClock;
  const fmt = useMemo(() => createAssistantFormatter({ t, language, use24Hour }), [t, language, use24Hour]);

  const params = route?.params ?? {};
  const followUpMeetingId = typeof params.followup === 'string' && params.followup !== '' ? params.followup : null;
  const prefill = typeof params.prefill === 'string' ? params.prefill : '';
  // Set only by the app's own follow-up notification: other links show a button instead.
  const autoStartFollowUp = params.autoStart === true;

  const assistant = useAssistant({ followUpMeetingId, autoStartFollowUp });
  const { plan, isLoaded: planLoaded } = useEntitlement();
  const { meeting: followUpMeeting } = useMeeting(followUpMeetingId);

  const [input, setInput] = useState(prefill);
  const [appliedPrefill, setAppliedPrefill] = useState(prefill);
  if (prefill !== appliedPrefill) {
    // New prefill param while the screen stays mounted (adjusting state during render).
    setAppliedPrefill(prefill);
    if (prefill) setInput(prefill);
  }
  const [reviewIds, setReviewIds] = useState(/** @type {string[] | null} */ (null));
  const [confirming, setConfirming] = useState(false);
  const [feedback, setFeedback] = useState(/** @type {Feedback | null} */ (null));
  const [now, setNow] = useState(() => new Date());
  const scrollRef = useRef(/** @type {ScrollView | null} */ (null));

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), USAGE_CLOCK_MS);
    return () => clearInterval(timer);
  }, []);

  const usage = describeUsage(fmt, assistant.usage, planLoaded ? { plan, limit: PLAN_DAILY_AI_LIMITS[plan] } : null, now);
  const lastMessage = assistant.messages[assistant.messages.length - 1] ?? null;
  const lastFailed = lastMessage?.role === 'user' && lastMessage.delivery === 'failed';
  /** @type {ErrorDescription | null} */
  const errorDescription = assistant.error
    ? describeAssistantError(fmt, assistant.error, now)
    : lastFailed && assistant.canRetry
      ? { message: fmt.t('ai:errors.notSent'), recovery: 'retry' }
      : null;
  const suggestions = lastMessage && lastMessage.role === 'assistant' && !assistant.isSending ? lastMessage.suggestions : [];
  const examples = useMemo(() => EXAMPLE_KEYS.map((key) => fmt.t(`ai:examples.${key}`)), [fmt]);
  const followUpTitle = followUpMeeting?.title ?? null;

  /** @type {ProposedActionState[]} */
  const reviewStates = (reviewIds ?? [])
    .map((id) => assistant.actions[id])
    .filter((state) => state !== undefined && (state.status === 'proposed' || state.status === 'failed'));

  /** @param {string} text */
  const send = (text) => {
    const trimmed = text.trim();
    if (!trimmed || assistant.isSending || !assistant.isLoaded) return;
    setInput('');
    void assistant.send(trimmed);
  };

  /**
   * A tapped suggestion chip: sent as-is, marked as model-written (the server never treats its
   * links or addresses as typed by the user).
   * @param {string} text
   */
  const sendSuggestion = (text) => {
    const trimmed = text.trim();
    if (!trimmed || assistant.isSending || !assistant.isLoaded) return;
    void assistant.send(trimmed, { origin: 'suggestion' });
  };

  const canStartFollowUp =
    followUpMeetingId !== null &&
    !autoStartFollowUp &&
    assistant.isLoaded &&
    !assistant.isSending &&
    !(assistant.followUpsRequested ?? []).includes(followUpMeetingId);

  const openMeeting = useCallback(
    /** @param {string} meetingId */
    (meetingId) => navigation.navigate('MeetingDetails', { meetingId }),
    [navigation],
  );

  const confirmReviewed = useCallback(async () => {
    const ids = reviewStates.map((state) => state.action.id);
    if (ids.length === 0) return;
    setConfirming(true);
    setReviewIds(null);
    /** @type {ActionResult[]} */
    const results = [];
    try {
      for (const id of ids) {
        // Sequential: later actions may depend on earlier ones (create, then share).
        results.push(await assistant.confirm(id));
      }
    } finally {
      setConfirming(false);
    }
    const shown = results.filter((r) => !(r.status === 'failed' && r.error.code === 'cancelled'));
    if (shown.length > 0) setFeedback(summarizeResults(fmt, shown));
  }, [assistant, fmt, reviewStates]);

  const clearConversation = useCallback(() => {
    Alert.alert(fmt.t('ai:chat.clearTitle'), fmt.t('ai:chat.clearMessage'), [
      { text: fmt.t('ai:chat.cancel'), style: 'cancel' },
      { text: fmt.t('ai:chat.clearConfirm'), style: 'destructive', onPress: () => void assistant.reset() },
    ]);
  }, [assistant, fmt]);

  const pendingCount = assistant.pendingActionIds.length;
  const feedbackStyle = feedback ? feedbackColors(palette, feedback.tone) : null;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: palette.background }]} edges={['bottom', 'left', 'right']}>
      <View style={[styles.topBar, { borderBottomColor: palette.border }]}>
        <View style={[styles.avatar, { backgroundColor: palette.surfaceAlt }]}>
          <MaterialCommunityIcons name="robot-outline" size={18} color={palette.primary} />
        </View>
        <View style={styles.flex}>
          <Text style={[styles.topTitle, { color: palette.text }]} accessibilityRole="header">
            {fmt.t('ai:chat.title')}
          </Text>
          <Text style={[styles.topSubtitle, { color: palette.textMuted }]} numberOfLines={1}>
            {fmt.t('ai:chat.subtitle')}
          </Text>
        </View>
        <UsagePill usage={usage} palette={palette} />
        <Pressable
          onPress={clearConversation}
          disabled={assistant.messages.length === 0}
          style={[styles.iconButton, { opacity: assistant.messages.length === 0 ? 0.4 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel={fmt.t('ai:chat.clear')}
          testID="assistant-clear"
        >
          <MaterialCommunityIcons name="delete-sweep-outline" size={22} color={palette.textMuted} />
        </Pressable>
      </View>

      {followUpMeetingId ? (
        <View style={[styles.banner, { backgroundColor: palette.infoSurface }]}>
          <MaterialCommunityIcons name="calendar-check-outline" size={16} color={palette.info} />
          <Text style={[styles.bannerText, { color: palette.info }]} numberOfLines={1}>
            {followUpTitle ? fmt.t('ai:chat.followUpFor', { title: followUpTitle }) : fmt.t('ai:chat.followUpGeneric')}
          </Text>
          {canStartFollowUp ? (
            <Pressable
              onPress={() => void assistant.startFollowUp(followUpMeetingId)}
              style={[styles.smallButton, { backgroundColor: palette.primary }]}
              accessibilityRole="button"
              testID="assistant-start-followup"
            >
              <Text style={[styles.smallButtonText, { color: palette.onPrimary }]}>{fmt.t('ai:chat.followUpStart')}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
        {!assistant.isLoaded ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={palette.primary} />
          </View>
        ) : (
          <ScrollView
            ref={scrollRef}
            style={styles.flex}
            contentContainerStyle={styles.messages}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
          >
            {assistant.messages.length === 0 && !assistant.isSending ? (
              <View style={styles.welcome}>
                <View style={styles.assistantRow}>
                  <View style={[styles.avatar, { backgroundColor: palette.surfaceAlt }]}>
                    <MaterialCommunityIcons name="robot-outline" size={18} color={palette.primary} />
                  </View>
                  <View style={[styles.bubble, styles.assistantBubble, { backgroundColor: palette.assistantBubble }]}>
                    <Text style={[styles.messageText, { color: palette.onAssistantBubble }]}>{fmt.t('ai:chat.welcome')}</Text>
                  </View>
                </View>
                <SuggestionChips
                  items={examples}
                  onPress={setInput}
                  palette={palette}
                  disabled={false}
                  title={fmt.t('ai:chat.examplesTitle')}
                />
              </View>
            ) : null}

            {assistant.messages.map((message) => (
              <View key={message.id} style={styles.messageBlock}>
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
                      onReview={(id) => setReviewIds([id])}
                      onReject={assistant.reject}
                      onOpenMeeting={openMeeting}
                    />
                  );
                })}
              </View>
            ))}

            {assistant.isSending ? (
              <TypingIndicator
                palette={palette}
                label={assistant.followUpInFlight ? fmt.t('ai:chat.followUpLoading') : fmt.t('ai:chat.thinking')}
              />
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
          </ScrollView>
        )}

        {pendingCount >= 2 ? (
          <View style={[styles.pendingBar, { backgroundColor: palette.surface, borderTopColor: palette.border }]}>
            <Text style={[styles.pendingText, { color: palette.text }]}>{fmt.t('ai:chat.pending', { count: pendingCount })}</Text>
            <Pressable
              onPress={() => setReviewIds([...assistant.pendingActionIds])}
              style={[styles.smallButton, { backgroundColor: palette.primary }]}
              accessibilityRole="button"
              testID="assistant-review-all"
            >
              <Text style={[styles.smallButtonText, { color: palette.onPrimary }]}>{fmt.t('ai:chat.reviewAll')}</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={[styles.composer, { borderTopColor: palette.border, backgroundColor: palette.background }]}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={fmt.t('ai:chat.placeholder')}
            placeholderTextColor={palette.textMuted}
            style={[styles.input, { color: palette.text, backgroundColor: palette.surface, borderColor: palette.border }]}
            multiline
            maxLength={AI_LIMITS.maxMessageChars}
            editable={assistant.isLoaded}
            accessibilityLabel={fmt.t('ai:chat.placeholder')}
            testID="assistant-input"
          />
          <Pressable
            onPress={() => send(input)}
            disabled={!input.trim() || assistant.isSending || !assistant.isLoaded}
            style={[
              styles.sendButton,
              { backgroundColor: palette.primary, opacity: !input.trim() || assistant.isSending || !assistant.isLoaded ? 0.4 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={fmt.t('ai:chat.send')}
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
      >
        <Text style={{ color: feedbackStyle?.color ?? palette.text }}>{feedback?.message ?? ''}</Text>
      </Snackbar>
    </SafeAreaView>
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
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  topTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  topSubtitle: {
    fontSize: 12,
  },
  iconButton: {
    padding: 6,
    borderRadius: 18,
  },
  usagePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  usageText: {
    fontSize: 12,
    fontWeight: '600',
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  bannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
  },
  messages: {
    padding: 16,
    gap: 12,
  },
  welcome: {
    gap: 12,
  },
  messageBlock: {
    gap: 8,
  },
  userRow: {
    alignItems: 'flex-end',
  },
  assistantRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  assistantColumn: {
    flex: 1,
    gap: 4,
    alignItems: 'flex-start',
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubble: {
    maxWidth: '85%',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  userBubble: {
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    borderTopLeftRadius: 4,
  },
  typingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dots: {
    flexDirection: 'row',
    gap: 4,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  typingText: {
    fontSize: 13,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 21,
  },
  time: {
    fontSize: 11,
    marginTop: 4,
    alignSelf: 'flex-end',
    opacity: 0.8,
  },
  followUpTag: {
    fontSize: 12,
    fontWeight: '700',
  },
  failedLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  failedText: {
    fontSize: 12,
    fontWeight: '600',
  },
  card: {
    marginLeft: 40,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 8,
  },
  cardMuted: {
    opacity: 0.6,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cardType: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
  },
  cardTitle: {
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
  },
  cardNote: {
    fontSize: 13,
    lineHeight: 18,
  },
  statusChip: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  warningLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  working: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  feedback: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  cardActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: 8,
  },
  smallButton: {
    minHeight: 36,
    borderRadius: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButton: {
    borderWidth: 1,
  },
  smallButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
  },
  listItemText: {
    flex: 1,
  },
  listItemTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  suggestions: {
    gap: 6,
  },
  suggestionsTitle: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipText: {
    fontSize: 14,
  },
  errorBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  errorText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 19,
  },
  pendingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  pendingText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 140,
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 11,
    paddingBottom: 11,
    fontSize: 15,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
