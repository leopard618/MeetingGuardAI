/**
 * "Stop receiving summaries" (docs/v2/M11-DESIGN.md section 5), opened by Disconnect at the bottom
 * of the connect screen. An in-app sheet in two steps:
 * - choose: "Your private address stops working at once. The summaries already here:" [Keep them]
 *   [Delete them], "Tasks you added from summaries stay in your tasks.", Cancel;
 * - Delete them asks once more in the same sheet ("Delete all your summaries?", what deleting
 *   means, with our email provider's copy after SUMMARY_PROVIDER_RETENTION_DAYS) before
 *   "Disconnect and delete".
 * The sheet only asks: the screen runs summaryAction disconnect {deleteSummaries} through the M10
 * service, shows the result and closes it. While a choice is in flight nothing can be pressed and
 * the sheet cannot be dismissed. Strings: summaries:connect.disconnect.*.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useState, type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { Modal, Portal, Text, useTheme as usePaperTheme } from 'react-native-paper';

import { MGButton, SheetHandle } from '../../components/ui';
import { useWindowInsets } from '../../hooks/useWindowInsets';
import { useT } from '../../i18n';
import { componentMetrics, radii, spacing } from '../../theme';
import type { DisconnectChoice } from './summaryRetentionModel';
import { SUMMARY_PROVIDER_RETENTION_DAYS } from './summaryText';

export interface DisconnectSheetProps {
  visible: boolean;
  /** The choice in flight (its button shows a spinner), else null. */
  busy: DisconnectChoice | null;
  /** Keep them, or Delete them after the second confirmation. */
  onChoose(choice: DisconnectChoice): void;
  onDismiss(): void;
}

type Step = 'choose' | 'confirmDelete';

export function DisconnectSheet({ visible, busy, onChoose, onDismiss }: DisconnectSheetProps): ReactElement {
  return <Portal>{visible ? <DisconnectSheetBody busy={busy} onChoose={onChoose} onDismiss={onDismiss} /> : null}</Portal>;
}

function DisconnectSheetBody({ busy, onChoose, onDismiss }: Omit<DisconnectSheetProps, 'visible'>): ReactElement {
  const t = useT();
  const theme = usePaperTheme();
  const insets = useWindowInsets();
  const [step, setStep] = useState<Step>('choose');
  const locked = busy !== null;
  // A failed "Disconnect and delete" leaves the sheet on its confirmation, ready to try again.
  const muted = { color: theme.colors.onSurfaceVariant };

  return (
    <Modal
      visible
      onDismiss={locked ? undefined : onDismiss}
      style={styles.modal}
      contentContainerStyle={[styles.sheet, { backgroundColor: theme.colors.elevation.level3, paddingBottom: insets.bottom + spacing.lg }]}
    >
      <View testID="summary-disconnect-sheet">
        <SheetHandle />
        {step === 'choose' ? (
          <>
            <Text variant="titleMedium" accessibilityRole="header" style={styles.heading}>
              {t('summaries:connect.disconnect.title')}
            </Text>
            <Text variant="bodyMedium" style={styles.paragraph} testID="summary-disconnect-body">
              {t('summaries:connect.disconnect.body')}
            </Text>
            <View style={styles.choices}>
              <MGButton
                variant="tonal"
                icon="archive-outline"
                onPress={() => onChoose('keep')}
                loading={busy === 'keep'}
                disabled={locked}
                testID="summary-disconnect-keep"
              >
                {t('summaries:connect.disconnect.keep')}
              </MGButton>
              <MGButton
                variant="outline"
                icon="delete-outline"
                textColor={theme.colors.error}
                onPress={() => setStep('confirmDelete')}
                disabled={locked}
                testID="summary-disconnect-delete"
              >
                {t('summaries:connect.disconnect.delete')}
              </MGButton>
            </View>
            <TasksStayLine />
            <View style={styles.footer}>
              <MGButton variant="ghost" onPress={onDismiss} disabled={locked} testID="summary-disconnect-cancel">
                {t('summaries:connect.disconnect.cancel')}
              </MGButton>
            </View>
          </>
        ) : (
          <>
            <Text variant="titleMedium" accessibilityRole="header" style={styles.heading} testID="summary-disconnect-delete-title">
              {t('summaries:connect.disconnect.deleteTitle')}
            </Text>
            <Text variant="bodyMedium" style={[styles.paragraph, muted]} testID="summary-disconnect-delete-body">
              {t('summaries:connect.disconnect.deleteBody', { providerDays: SUMMARY_PROVIDER_RETENTION_DAYS })}
            </Text>
            <View style={styles.footer}>
              <MGButton variant="ghost" onPress={onDismiss} disabled={locked} testID="summary-disconnect-delete-cancel">
                {t('summaries:connect.disconnect.cancel')}
              </MGButton>
              <MGButton
                variant="destructive"
                icon="delete-outline"
                onPress={() => onChoose('delete')}
                loading={busy === 'delete'}
                disabled={locked}
                testID="summary-disconnect-delete-confirm"
              >
                {t('summaries:connect.disconnect.deleteConfirm')}
              </MGButton>
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

/** "Tasks you added from summaries stay in your tasks." with a check, under the two choices. */
function TasksStayLine(): ReactElement {
  const t = useT();
  const theme = usePaperTheme();
  return (
    <View style={styles.tasksStay}>
      <MaterialCommunityIcons
        name="checkbox-marked-circle-outline"
        size={componentMetrics.iconInline}
        color={theme.colors.primary}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
      <Text variant="bodyMedium" style={styles.flex} testID="summary-disconnect-tasks-stay">
        {t('summaries:connect.disconnect.tasksStay')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  modal: {
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    paddingTop: spacing.xs,
    paddingHorizontal: spacing.lg,
  },
  heading: {
    marginTop: spacing.xs,
  },
  paragraph: {
    marginTop: spacing.sm,
  },
  choices: {
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  tasksStay: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  flex: {
    flex: 1,
  },
});
