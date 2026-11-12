/**
 * Spoken debrief panel (M8, route AIChat { debrief: meetingId } or the "Debrief" button of the
 * follow-up banner). The user speaks (or types) what was agreed in a meeting that ended; the text
 * is shown and stays editable; "Create tasks" sends it in debrief mode and the reply's task
 * proposals arrive as ordinary confirmation cards. Nothing is saved until the user confirms.
 * The microphone is the chat screen's own voice session, routed into this panel while it is open.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ReactElement } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { AssistantPalette } from '../../services/ai/presentation';
import type { AssistantFormatter } from '../../services/ai/types';
import { componentMetrics, radii, spacing, typography } from '../../theme';
import { DEBRIEF_MAX_CHARS } from './chatModel';

export interface DebriefPanelProps {
  fmt: AssistantFormatter;
  palette: AssistantPalette;
  /** Title of the meeting being debriefed (null while it loads / unknown). */
  meetingTitle: string | null;
  text: string;
  onChangeText(text: string): void;
  /** The shared voice session is capturing into this panel. */
  listening: boolean;
  onToggleMic(): void;
  /** null = nothing to send yet (empty, or a request is running). */
  canSend: boolean;
  onSend(): void;
  onClose(): void;
  disabled: boolean;
}

export function DebriefPanel(props: DebriefPanelProps): ReactElement {
  const { fmt, palette, meetingTitle, text, onChangeText, listening, onToggleMic, canSend, onSend, onClose, disabled } = props;
  const title = meetingTitle ? fmt.t('ai:chat.debriefFor', { title: meetingTitle }) : fmt.t('ai:chat.debriefGeneric');
  return (
    <View style={[styles.panel, { backgroundColor: palette.surface, borderColor: palette.border }]} testID="assistant-debrief">
      <View style={styles.header}>
        <MaterialCommunityIcons name="text-box-check-outline" size={componentMetrics.iconNav} color={palette.primary} />
        <Text style={[styles.title, { color: palette.text }]} numberOfLines={2}>
          {title}
        </Text>
        <Pressable
          onPress={onClose}
          hitSlop={8}
          style={styles.closeButton}
          accessibilityRole="button"
          accessibilityLabel={fmt.t('ai:chat.debriefClose')}
          testID="assistant-debrief-close"
        >
          <MaterialCommunityIcons name="close" size={componentMetrics.iconNav} color={palette.textMuted} />
        </Pressable>
      </View>
      <Text style={[styles.hint, { color: palette.textMuted }]}>{fmt.t('ai:chat.debriefHint')}</Text>
      <TextInput
        value={text}
        onChangeText={onChangeText}
        placeholder={fmt.t(listening ? 'ai:voice.listening' : 'ai:chat.debriefPlaceholder')}
        placeholderTextColor={listening ? palette.primary : palette.textMuted}
        style={[styles.input, { color: palette.text, backgroundColor: palette.inputSurface }]}
        multiline
        maxLength={DEBRIEF_MAX_CHARS}
        editable={!disabled && !listening}
        accessibilityLabel={fmt.t('ai:chat.debriefPlaceholder')}
        testID="assistant-debrief-input"
      />
      <View style={styles.actions}>
        <Pressable
          onPress={onToggleMic}
          disabled={disabled}
          style={[styles.micButton, { backgroundColor: listening ? palette.danger : palette.inputSurface }]}
          accessibilityRole="button"
          accessibilityLabel={fmt.t(listening ? 'ai:chat.debriefStop' : 'ai:chat.debriefMic')}
          accessibilityState={{ disabled }}
          testID="assistant-debrief-mic"
        >
          <MaterialCommunityIcons
            name={listening ? 'stop' : 'microphone-outline'}
            size={componentMetrics.iconInline}
            color={listening ? palette.onPrimary : palette.textMuted}
          />
        </Pressable>
        <View style={styles.spacer} />
        <Pressable
          onPress={onSend}
          disabled={!canSend || listening}
          style={[styles.sendButton, { backgroundColor: canSend && !listening ? palette.primary : palette.surfaceDisabled }]}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSend || listening }}
          testID="assistant-debrief-send"
        >
          <MaterialCommunityIcons
            name="playlist-check"
            size={componentMetrics.iconInline}
            color={canSend && !listening ? palette.onPrimary : palette.onSurfaceDisabled}
          />
          <Text style={[styles.sendText, { color: canSend && !listening ? palette.onPrimary : palette.onSurfaceDisabled }]}>
            {fmt.t('ai:chat.debriefSend')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    marginHorizontal: componentMetrics.screenGutter,
    marginTop: spacing.sm,
    padding: spacing.md,
    gap: spacing.sm,
    borderRadius: radii.lg,
    borderWidth: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    flex: 1,
    ...typography.titleS,
  },
  closeButton: {
    width: componentMetrics.touchTargetMin,
    height: componentMetrics.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: {
    ...typography.bodyS,
  },
  input: {
    minHeight: 88,
    maxHeight: 180,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    textAlignVertical: 'top',
    ...typography.bodyL,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  spacer: {
    flex: 1,
  },
  micButton: {
    width: componentMetrics.touchTargetMin,
    height: componentMetrics.touchTargetMin,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: componentMetrics.buttonHeightSmall,
    borderRadius: radii.full,
    paddingHorizontal: spacing.lg,
  },
  sendText: {
    ...typography.labelL,
  },
});
