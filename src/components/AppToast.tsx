/**
 * Toast layouts for react-native-toast-message (owner: shell), mounted once in AppRoot through
 * `toastConfig`. The library's default BaseToast cuts every line to ONE line with an ellipsis and is
 * always white; our toasts often carry the useful part at the end ("Calendar sync failed: <reason>"),
 * in two languages, so these layouts:
 * - wrap (title up to 3 lines, message up to 4) and grow with the text and the font scale;
 * - use the mode-invariant MG toast identity (docs/DESIGN_SYSTEM.md §7 group D): the always-dark
 *   `alertLight` card in both themes, with a semantic dark-scheme accent per tone (AA-checked on
 *   the dark card by the theme contrast guard);
 * - are announced by screen readers (accessibilityRole "alert", polite live region).
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps, ReactElement } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Text } from 'react-native-paper';
import type { ToastConfig, ToastConfigParams } from 'react-native-toast-message';

// Mode-invariant identity: tokens directly, no theme hooks needed.
import { alertLight, componentMetrics, darkColors, radii, spacing } from '../theme/tokens';

export type ToastTone = 'success' | 'error' | 'info';

const MAX_WIDTH = 560;
const SIDE_MARGIN = componentMetrics.screenGutter;
export const TOAST_TITLE_LINES = 3;
export const TOAST_MESSAGE_LINES = 4;

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

const ICONS: Readonly<Record<ToastTone, IconName>> = {
  success: 'check-circle-outline',
  error: 'alert-circle-outline',
  info: 'information-outline',
};

/** Dark-scheme semantic hues — AA on the dark card (see contrast.test.ts, LIGHT toast block). */
const ACCENTS: Readonly<Record<ToastTone, string>> = {
  success: darkColors.success,
  error: darkColors.error,
  info: darkColors.info,
};

export interface AppToastProps {
  tone: ToastTone;
  text1?: string;
  text2?: string;
  onPress?: () => void;
}

export function AppToast({ tone, text1, text2, onPress }: AppToastProps): ReactElement {
  const { width } = useWindowDimensions();
  const accent = ACCENTS[tone];
  const hasTitle = (text1?.length ?? 0) > 0;
  const hasMessage = (text2?.length ?? 0) > 0;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.card, { width: Math.min(width - SIDE_MARGIN * 2, MAX_WIDTH), borderLeftColor: accent }]}
      testID={`app-toast-${tone}`}
    >
      <MaterialCommunityIcons
        name={ICONS[tone]}
        size={22}
        color={accent}
        style={styles.icon}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
      <View style={styles.texts}>
        {hasTitle ? (
          <Text variant="labelLarge" style={styles.title} numberOfLines={TOAST_TITLE_LINES} testID="app-toast-title">
            {text1}
          </Text>
        ) : null}
        {hasMessage ? (
          <Text
            variant="bodySmall"
            style={[styles.message, hasTitle && styles.messageSpacing]}
            numberOfLines={TOAST_MESSAGE_LINES}
            testID="app-toast-message"
          >
            {text2}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function render(tone: ToastTone) {
  return function ToastLayout({ text1, text2, onPress }: ToastConfigParams<unknown>): ReactElement {
    return <AppToast tone={tone} text1={text1} text2={text2} onPress={onPress} />;
  };
}

/** Layouts for every toast type the app shows (Toast.show({ type })). */
export const toastConfig: ToastConfig = {
  success: render('success'),
  error: render('error'),
  info: render('info'),
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: alertLight.bg,
    borderRadius: radii.lg,
    borderLeftWidth: componentMetrics.accentBarWidth,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    elevation: 4,
    shadowColor: darkColors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
  },
  icon: {
    marginRight: spacing.md,
  },
  texts: {
    flex: 1,
  },
  title: {
    color: alertLight.title,
  },
  message: {
    color: alertLight.body,
  },
  messageSpacing: {
    marginTop: spacing.xs,
  },
});
