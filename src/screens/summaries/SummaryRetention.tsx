/**
 * "How long we keep summaries" (docs/v2/M11-DESIGN.md section 5): the same lines in the connect
 * screen's help sheet (SummaryHelpSheet) and on SummaryView (under its "How long we keep summaries" link),
 * and in the privacy policy draft. Filed or kept 12 months, inbox 60 days, refused rows 30 days
 * (counts only), suggestions go with their summary, added tasks stay, deleting (live database at
 * once, backups within 21 days, our email provider's copy after SUMMARY_PROVIDER_RETENTION_DAYS,
 * 45), the OpenAI line, and the copies outside our database. Plain Text only. Strings:
 * summaries:connect.retention.*.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { useT } from '../../i18n';
import { componentMetrics, spacing, useAppTheme } from '../../theme';
import { SUMMARY_RETENTION_KEYS, retentionLineKey } from './summaryRetentionModel';
import { SUMMARY_PROVIDER_RETENTION_DAYS } from './summaryText';

/** The retention lines, one per rule, each with a leading dot. */
export function SummaryRetentionList({ testID }: { testID?: string }): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  return (
    <View testID={testID}>
      {SUMMARY_RETENTION_KEYS.map((key) => (
        <View key={key} style={styles.row} testID={testID !== undefined ? `${testID}-${key}` : undefined}>
          <MaterialCommunityIcons
            name="circle-small"
            size={componentMetrics.iconInline}
            color={colors.onSurfaceVariant}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
          <Text variant="bodyMedium" style={styles.flex}>
            {t(retentionLineKey(key), { providerDays: SUMMARY_PROVIDER_RETENTION_DAYS })}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  flex: {
    flex: 1,
  },
});
