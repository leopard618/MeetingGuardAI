/**
 * "How meeting summaries work": the help sheet behind the question mark in the Meeting summaries
 * header (SummaryConnectScreen). It holds the explanations that used to fill the screen, so the
 * screen itself keeps only what the user acts on:
 * - what Meeting Guard AI does and does not do (the product line);
 * - Connect Fathom (what we read, and that forwarding Fathom emails is no longer needed), only
 *   while the server offers it;
 * - other notetakers by email;
 * - "What we check", the privacy wording (M10-DESIGN.md section 14) and "How long we keep
 *   summaries" (M11-DESIGN.md section 5).
 * An in-app sheet like DisconnectSheet, scrolling inside the window. Plain Text only.
 */
import { type ReactElement, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Modal, Portal, Text, useTheme as usePaperTheme } from 'react-native-paper';

import { Icon, MGButton, SheetHandle } from '../../components/ui';
import { useWindowInsets } from '../../hooks/useWindowInsets';
import { useT } from '../../i18n';
import { componentMetrics, radii, spacing, useAppTheme } from '../../theme';
import { SummaryRetentionList } from './SummaryRetention';
import { SUMMARY_PROVIDER_RETENTION_DAYS } from './summaryText';

const CHECK_KEYS = ['signature', 'sender', 'mailbox', 'fresh', 'match', 'refused'] as const;
/** Section 14 wording; 'refused' carries the caveat that a real summary sent straight here waits for an OK. */
const PRIVACY_KEYS = ['encrypted', 'yoursOnly', 'deletable', 'refused'] as const;
/** The sheet never covers more than this share of the window. */
const MAX_HEIGHT_SHARE = 0.85;

export interface SummaryHelpSheetProps {
  visible: boolean;
  /** Connect Fathom is offered: its part shows. */
  fathomOffered: boolean;
  onDismiss(): void;
}

export function SummaryHelpSheet({ visible, fathomOffered, onDismiss }: SummaryHelpSheetProps): ReactElement {
  return <Portal>{visible ? <SummaryHelpSheetBody fathomOffered={fathomOffered} onDismiss={onDismiss} /> : null}</Portal>;
}

function HelpBlock({ title, children, testID }: { title: string; children: ReactNode; testID?: string }): ReactElement {
  return (
    <View style={styles.block} testID={testID}>
      <Text variant="titleSmall" accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

function SummaryHelpSheetBody({ fathomOffered, onDismiss }: Omit<SummaryHelpSheetProps, 'visible'>): ReactElement {
  const t = useT();
  const theme = usePaperTheme();
  const { colors } = useAppTheme();
  const insets = useWindowInsets();
  const { height } = useWindowDimensions();
  const muted = { color: theme.colors.onSurfaceVariant };

  return (
    <Modal
      visible
      onDismiss={onDismiss}
      style={styles.modal}
      contentContainerStyle={[
        styles.sheet,
        { backgroundColor: theme.colors.elevation.level3, paddingBottom: insets.bottom + spacing.lg, maxHeight: height * MAX_HEIGHT_SHARE },
      ]}
    >
      <View style={styles.fill} testID="summary-help-sheet">
        <SheetHandle />
        <Text variant="titleLarge" accessibilityRole="header" style={styles.heading}>
          {t('summaries:help.title')}
        </Text>
        <ScrollView style={styles.fill} contentContainerStyle={styles.content}>
          <View style={styles.block} testID="summary-connect-product-line">
            <Text variant="bodyLarge">{t('summaries:common.productLine')}</Text>
            <Text variant="bodyMedium" style={muted}>
              {t('summaries:common.productLineMore')}
            </Text>
          </View>

          {fathomOffered ? (
            <HelpBlock title={t('summaries:fathom.title')} testID="summary-help-fathom">
              <Text variant="bodyMedium">{t('summaries:fathom.body')}</Text>
              <Text variant="bodyMedium" style={muted}>
                {t('summaries:fathom.note')}
              </Text>
              <Text variant="bodyMedium" style={muted}>
                {t('summaries:fathom.forwardHint')}
              </Text>
            </HelpBlock>
          ) : null}

          <HelpBlock title={t('summaries:connect.email.title')} testID="summary-help-email">
            <Text variant="bodyMedium">{t('summaries:connect.email.body')}</Text>
          </HelpBlock>

          <HelpBlock title={t('summaries:connect.checks.title')} testID="summary-connect-checks">
            {CHECK_KEYS.map((key) => (
              <View key={key} style={styles.bulletRow}>
                <Icon name="checkCircle" size={componentMetrics.iconInline} color={colors.primary} />
                <Text variant="bodyMedium" style={styles.flex}>
                  {t(`summaries:connect.checks.${key}`)}
                </Text>
              </View>
            ))}
          </HelpBlock>

          <HelpBlock title={t('summaries:common.privacy.title')} testID="summary-connect-privacy">
            {PRIVACY_KEYS.map((key) => (
              <Text key={key} variant="bodyMedium" style={muted}>
                {t(`summaries:common.privacy.${key}`, { providerDays: SUMMARY_PROVIDER_RETENTION_DAYS })}
              </Text>
            ))}
          </HelpBlock>

          <HelpBlock title={t('summaries:connect.retention.title')} testID="summary-connect-retention">
            <SummaryRetentionList testID="summary-retention" />
          </HelpBlock>
        </ScrollView>
        <MGButton variant="tonal" onPress={onDismiss} style={styles.close} testID="summary-help-close">
          {t('summaries:help.close')}
        </MGButton>
      </View>
    </Modal>
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
  fill: {
    flexShrink: 1,
  },
  heading: {
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  content: {
    gap: spacing.lg,
    paddingBottom: spacing.md,
  },
  block: {
    gap: spacing.sm,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
  },
  close: {
    marginTop: spacing.md,
  },
});
