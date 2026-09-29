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
import { Button, Text, useTheme as usePaperTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useKeyboardAvoidance } from './useKeyboardAvoidance';

/** Card-like section (same look as the onboarding sections). */
export function Section({ title, children, testID }: { title?: string; children?: ReactNode; testID?: string }): ReactElement {
  const theme = usePaperTheme();
  return (
    <View
      testID={testID}
      style={[styles.section, { backgroundColor: theme.colors.elevation.level1, borderColor: theme.colors.outlineVariant }]}
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
          contentContainerStyle={[styles.body, { paddingBottom: hasFooter ? 24 : bottomInset + 24 }]}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets={!AVOID_WITH_PADDING}
          testID="screen-body-scroll"
        >
          {children}
        </ScrollView>
        {hasFooter ? (
          <View style={[styles.footer, { paddingBottom: bottomInset + 12, borderTopColor: theme.colors.outlineVariant }]}>
            <Button
              mode="contained"
              onPress={onPrimary}
              disabled={primaryDisabled || primaryLoading}
              loading={primaryLoading}
              contentStyle={styles.buttonContent}
              testID={primaryTestID}
            >
              {primaryLabel}
            </Button>
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
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  section: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    marginBottom: 8,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  buttonContent: {
    paddingVertical: 6,
  },
});
