/**
 * Building blocks of the TypeScript screens in the Main group (settings, alert settings,
 * meeting details / form): a card-like section and a scrollable body with an optional footer.
 * The Main group's header (CustomHeader) sits above them.
 *
 * Keyboard: the body keeps the focused field visible above the keyboard.
 * - Android (edge-to-edge, the window is not resized): a KeyboardAvoidingView ("padding", offset
 *   measured by useKeyboardAvoidance) shrinks the body; the ScrollView then scrolls the focused
 *   field into view and the footer button sits right above the keyboard.
 * - iOS: the ScrollView adjusts its own insets and scrolls to the focused field
 *   (automaticallyAdjustKeyboardInsets); the footer stays below the keyboard.
 */
import type { ReactElement, ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Text, useTheme as usePaperTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MGButton } from '../../components/ui';
import { componentMetrics, radii, spacing } from '../../theme';
import { useKeyboardAvoidance } from './useKeyboardAvoidance';

/** Card-like section (MG card baseline: surface, r-lg, 1px outlineVariant, p-16, elevation 0). */
export function Section({ title, children, testID }: { title?: string; children?: ReactNode; testID?: string }): ReactElement {
  const theme = usePaperTheme();
  return (
    <View
      testID={testID}
      style={[styles.section, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outlineVariant }]}
    >
      {title ? (
        <Text variant="titleMedium" style={styles.sectionTitle} accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

export interface ScreenBodyProps {
  children?: ReactNode;
  /** Primary footer action (e.g. Save). */
  primaryLabel?: string;
  onPrimary?: () => void;
  primaryDisabled?: boolean;
  primaryLoading?: boolean;
  primaryTestID?: string;
}

const AVOID_WITH_PADDING = Platform.OS === 'android';

/** Scrollable screen body with an optional sticky footer button. */
export function ScreenBody({
  children,
  primaryLabel,
  onPrimary,
  primaryDisabled = false,
  primaryLoading = false,
  primaryTestID,
}: ScreenBodyProps): ReactElement {
  const theme = usePaperTheme();
  const insets = useSafeAreaInsets();
  const { rootRef, onRootLayout, keyboardVerticalOffset, keyboardVisible } = useKeyboardAvoidance();
  const hasFooter = primaryLabel !== undefined && onPrimary !== undefined;
  // The keyboard covers the home indicator area: no bottom inset while it is open.
  const bottomInset = keyboardVisible ? 0 : insets.bottom;
  return (
    <View ref={rootRef} onLayout={onRootLayout} style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior="padding"
        enabled={AVOID_WITH_PADDING}
        keyboardVerticalOffset={keyboardVerticalOffset}
      >
        <ScrollView
          contentContainerStyle={[styles.body, { paddingBottom: hasFooter ? spacing.xxl : bottomInset + spacing.xxl }]}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets={!AVOID_WITH_PADDING}
          testID="screen-body-scroll"
        >
          {children}
        </ScrollView>
        {hasFooter ? (
          <View style={[styles.footer, { paddingBottom: bottomInset + spacing.md, borderTopColor: theme.colors.outlineVariant }]}>
            <MGButton
              onPress={onPrimary}
              disabled={primaryDisabled || primaryLoading}
              loading={primaryLoading}
              testID={primaryTestID}
            >
              {primaryLabel}
            </MGButton>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  body: {
    paddingHorizontal: componentMetrics.screenGutter,
    paddingTop: spacing.md,
  },
  section: {
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: componentMetrics.cardPadding,
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    marginBottom: spacing.sm,
  },
  footer: {
    paddingHorizontal: componentMetrics.screenGutter,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
