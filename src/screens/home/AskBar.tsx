/**
 * Ask bar (dashboard): a search-style field with the assistant's sparkles and an accent "Ask"
 * button. Typing a question and tapping Ask (or the keyboard's send) opens the chat with the text
 * prefilled; nothing is sent until the user taps send there, so no paid request starts from here.
 * Empty input opens the chat with no prefill.
 */
import { useState, type ReactElement } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { GradientSurface, Icon, PressableScale } from '../../components/ui';
import { useT } from '../../i18n';
import { componentMetrics, radii, spacing, typography, useAppTheme, withAlpha } from '../../theme';

export interface AskBarProps {
  /** Opens the assistant with the typed question (trimmed; empty string for none). */
  onAsk(question: string): void;
  testID?: string;
}

export function AskBar({ onAsk, testID = 'ask-bar' }: AskBarProps): ReactElement {
  const t = useT();
  const { colors, elevated, onGradient } = useAppTheme();
  const [text, setText] = useState('');

  const submit = (): void => {
    onAsk(text.trim());
    setText('');
  };

  return (
    <View style={[styles.bar, elevated]} testID={testID}>
      <Icon name="ai" size={componentMetrics.iconInline} color={colors.primary} style={styles.icon} />
      <TextInput
        value={text}
        onChangeText={setText}
        onSubmitEditing={submit}
        returnKeyType="send"
        placeholder={t('home:ask.placeholder')}
        placeholderTextColor={withAlpha(colors.onSurfaceVariant, 0.9)}
        style={[styles.input, { color: colors.onSurface }]}
        accessibilityLabel={t('home:ask.a11y')}
        maxFontSizeMultiplier={1.3}
        testID={`${testID}-input`}
      />
      <PressableScale onPress={submit} style={styles.buttonHost} accessibilityRole="button" accessibilityLabel={t('home:ask.button')} testID={`${testID}-button`}>
        <GradientSurface style={styles.button}>
          <Icon name="send" size={componentMetrics.iconMeta} color={onGradient.primary} />
        </GradientSurface>
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.full,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
    paddingVertical: spacing.xs,
    minHeight: componentMetrics.inputHeight,
    marginBottom: spacing.sm,
  },
  icon: {
    marginRight: spacing.sm,
  },
  input: {
    ...typography.bodyM,
    flex: 1,
    paddingVertical: spacing.sm,
  },
  buttonHost: {
    borderRadius: radii.full,
    marginLeft: spacing.sm,
  },
  button: {
    width: componentMetrics.buttonHeightSmall,
    height: componentMetrics.buttonHeightSmall,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
