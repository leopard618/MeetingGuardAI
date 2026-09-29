/**
 * Building blocks of the TypeScript screens in the Main group (settings, alert settings,
 * meeting details / form): a card-like section and a scrollable body with an optional footer.
 * The Main group's header (CustomHeader) sits above them.
 */
import type { ReactElement, ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Text, useTheme as usePaperTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
  const hasFooter = primaryLabel !== undefined && onPrimary !== undefined;
  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: hasFooter ? 24 : insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
      {hasFooter ? (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12, borderTopColor: theme.colors.outlineVariant }]}>
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
