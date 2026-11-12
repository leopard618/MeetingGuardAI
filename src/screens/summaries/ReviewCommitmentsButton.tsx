/**
 * "Review commitments" (docs/v2/M11-DESIGN.md section 3.1): the one button every entry point uses
 * (the top of SummaryView, the MeetingSummarySection rows, beside Debrief on Meeting details), with
 * the facts line under it ("2 added to your tasks", "No commitments found"). The caller decides
 * whether it shows (commitmentsEntryModel: enabled and allowed, filed or kept) and what a press
 * does (navigate to SummaryCommitments { summaryId }). Plain Text only; the facts are counts and
 * states, never summary content. Strings: summaries:commitments.entry.*.
 */
import type { ReactElement } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from 'react-native-paper';

import { MGButton, type MGButtonSize } from '../../components/ui';
import { useT } from '../../i18n';
import { spacing, useAppTheme } from '../../theme';
import type { CommitmentsEntry, EntryText } from './commitmentsEntryModel';

/** The facts line joins its parts like the summary item meta line. */
const FACTS_SEPARATOR = ' · ';

export interface ReviewCommitmentsButtonProps {
  entry: CommitmentsEntry;
  onPress(summaryId: string): void;
  /** Default "md"; the summary rows use "sm". */
  size?: MGButtonSize;
  /** true: the button spans the width, like Debrief beside it; default false (as wide as its label). */
  fullWidth?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  /** The wrapper; the button is `${testID}-button`, the facts line `${testID}-facts`. */
  testID: string;
}

export function ReviewCommitmentsButton({
  entry,
  onPress,
  size = 'md',
  fullWidth = false,
  disabled = false,
  style,
  testID,
}: ReviewCommitmentsButtonProps): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const text = (ref: EntryText): string => t(ref.key, ref.params);
  const facts = entry.facts.map(text).join(FACTS_SEPARATOR);
  return (
    <View style={[fullWidth ? null : styles.wrap, style]} testID={testID}>
      <MGButton
        variant="tonal"
        size={size}
        icon="clipboard-check-outline"
        onPress={() => onPress(entry.summaryId)}
        disabled={disabled}
        accessibilityHint={t('summaries:commitments.entry.reviewA11y')}
        testID={`${testID}-button`}
      >
        {text(entry.label)}
      </MGButton>
      {facts !== '' ? (
        <Text variant="bodySmall" style={[styles.facts, { color: colors.onSurfaceVariant }]} testID={`${testID}-facts`}>
          {facts}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'flex-start',
  },
  facts: {
    marginTop: spacing.xs,
  },
});
