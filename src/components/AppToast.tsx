/**
 * Toast layouts for react-native-toast-message (owner: shell), mounted once in AppRoot through
 * `toastConfig`. The library's default BaseToast cuts every line to ONE line with an ellipsis and is
 * always white; our toasts often carry the useful part at the end ("Calendar sync failed: <reason>"),
 * in two languages, so these layouts:
 * - wrap (title up to 3 lines, message up to 4) and grow with the text and the font scale;
 * - follow the Paper theme (light / dark): surface for success / info, errorContainer for errors;
 * - are announced by screen readers (accessibilityRole "alert", polite live region).
 */
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps, ReactElement } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Text, useTheme as usePaperTheme } from 'react-native-paper';
import type { ToastConfig, ToastConfigParams } from 'react-native-toast-message';

import { useOptionalTheme } from '../contexts/ThemeContext';

export type ToastTone = 'success' | 'error' | 'info';

const MAX_WIDTH = 560;
const SIDE_MARGIN = 16;
export const TOAST_TITLE_LINES = 3;
export const TOAST_MESSAGE_LINES = 4;

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

const ICONS: Readonly<Record<ToastTone, IconName>> = {
  success: 'check-circle-outline',
  error: 'alert-circle-outline',
  info: 'information-outline',
};

export interface AppToastProps {
  tone: ToastTone;
  text1?: string;
  text2?: string;
  onPress?: () => void;
}

export function AppToast({ tone, text1, text2, onPress }: AppToastProps): ReactElement {
  const theme = usePaperTheme();
  const appTheme = useOptionalTheme();
  const { width } = useWindowDimensions();
  const isError = tone === 'error';
  const background = isError ? theme.colors.errorContainer : theme.colors.elevation.level3;
  const foreground = isError ? theme.colors.onErrorContainer : theme.colors.onSurface;
  const secondary = isError ? theme.colors.onErrorContainer : theme.colors.onSurfaceVariant;
  const accent = isError ? theme.colors.error : tone === 'success' ? (appTheme?.colors.success ?? theme.colors.primary) : theme.colors.primary;
  const hasTitle = (text1?.length ?? 0) > 0;
  const hasMessage = (text2?.length ?? 0) > 0;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[
        styles.card,
        {
          width: Math.min(width - SIDE_MARGIN * 2, MAX_WIDTH),
          backgroundColor: background,
          borderLeftColor: accent,
          shadowColor: theme.colors.shadow,
        },
      ]}
      testID={`app-toast-${tone}`}
    >
      <MaterialCommunityIcons name={ICONS[tone]} size={22} color={accent} style={styles.icon} accessibilityElementsHidden importantForAccessibility="no" />
      <View style={styles.texts}>
        {hasTitle ? (
          <Text variant="titleSmall" style={{ color: foreground }} numberOfLines={TOAST_TITLE_LINES} testID="app-toast-title">
            {text1}
          </Text>
        ) : null}
        {hasMessage ? (
          <Text
            variant="bodyMedium"
            style={[{ color: secondary }, hasTitle && styles.message]}
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
    borderRadius: 12,
    borderLeftWidth: 5,
    paddingVertical: 12,
    paddingHorizontal: 14,
    elevation: 4,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
  },
  icon: {
    marginRight: 10,
    marginTop: 1,
  },
  texts: {
    flex: 1,
  },
  message: {
    marginTop: 2,
  },
});
