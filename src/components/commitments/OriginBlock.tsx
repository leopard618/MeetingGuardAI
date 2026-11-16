/**
 * The origin block of a commitments review (owner: summaries-app; M11, docs/v2/M11-DESIGN.md
 * sections 3.2 and 11), always the first thing on the screen: where the suggestions come from
 * ("Suggested from your notetaker's summary of <meeting>, <date>.") and the fixed notes under it
 * ("Meeting Guard AI did not attend this meeting.", "Written by AI from your notetaker's text.
 * Check names, dates and meaning before you add them.").
 *
 * Every text arrives as a prop, so Sven's A2 shows the same block for "From the email of ..."
 * (decision 15). Plain Text only: nothing in it can be pressed.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { Card } from '../ui';
import { componentMetrics, spacing, useAppTheme } from '../../theme';

export interface OriginBlockProps {
  /** Where the suggestions come from (one sentence). */
  source: string;
  /** The fixed notes, in order ("did not attend", "written by AI" or "exactly as written"). */
  notes: readonly string[];
  testID?: string;
}

export function OriginBlock({ source, notes, testID = 'commitments-origin' }: OriginBlockProps): ReactElement {
  const { colors } = useAppTheme();
  return (
    <Card testID={testID}>
      <Text variant="bodyMedium" testID={`${testID}-source`}>
        {source}
      </Text>
      {notes.length > 0 ? (
        <View style={[styles.notes, { borderTopColor: colors.outlineVariant }]}>
          <MaterialCommunityIcons
            name="information-outline"
            size={componentMetrics.iconInline}
            color={colors.primary}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
          <View style={styles.flex}>
            {notes.map((note, index) => (
              <Text
                key={note}
                variant={index === 0 ? 'bodyMedium' : 'bodySmall'}
                style={index > 0 ? [styles.line, { color: colors.onSurfaceVariant }] : undefined}
                testID={`${testID}-note-${index}`}
              >
                {note}
              </Text>
            ))}
          </View>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  notes: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  line: {
    marginTop: spacing.xs,
  },
});
