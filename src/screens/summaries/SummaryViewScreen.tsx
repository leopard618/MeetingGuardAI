/**
 * One summary (route "SummaryView" { summaryId }; docs/v2/M10-DESIGN.md section 9), top to bottom:
 * - the title and the origin chip;
 * - the origin card: who wrote it and how it was checked ("Written by your notetaker (<domain>),
 *   received <time>. Signature checked." or "Forwarded from <address>. The notetaker's own
 *   signature could not be checked."), the weaker trust facts kept from receipt, the fixed line
 *   "Meeting Guard AI did not attend this meeting. This text comes from your notetaker." and the
 *   reminder that a notetaker summary can come from a meeting someone else recorded;
 * - the filing card: the meeting it is filed under (or where it waits, and why), the date in the
 *   summary, and Not this meeting + Move for a filed summary, Choose a meeting + Keep without a
 *   meeting otherwise (AttachMeetingSheet does the choosing);
 * - the sections with their headings as written (the TLDR and summary sections headed "Your
 *   notetaker's own summary"), items as plain lines with their checkbox state, owner and due text;
 * - the email details, Copy text, and Delete (confirmed in the app, then back).
 * Data: useSummary(summaryId, { enabled: available }) and summariesService.detach / keep /
 * deleteSummary; the service patches its caches, so the screen and Meeting details update without
 * a second call. Shown only while summaryStatus says enabled and allowed; a summaryRead that is not
 * deployed (not_enabled) shows the "not available yet" state. A summary deleted elsewhere
 * (not_found) closes the screen.
 * Plain Text only: no WebView, no HTML renderer; links, email addresses and phone numbers are
 * never tappable, and nothing from the summary is logged (failures reach the user as i18n
 * messages only). Strings: summaries:view.*, summaries:common.*.
 * M11 (M11-DESIGN.md sections 3.1 and 5): "Review commitments" under the title of a filed or kept
 * summary (route SummaryCommitments { summaryId }, with the row's open count and facts); "Only the
 * first part was kept" under the cut-short notice when summaryRead says truncated; and "This
 * summary is kept until <date>" with the "How long we keep summaries" link, which shows the same
 * retention lines as the connect screen.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { StackScreenProps } from '@react-navigation/stack';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactElement } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import { Badge, Card, EmptyState, ErrorState, LoadingState, MGButton, SectionHeader } from '../../components/ui';
import type { RootStackParamList } from '../../core/contracts';
import { toAppError } from '../../core/errors';
import { useT } from '../../i18n';
import { summariesService, useSummary, useSummaryStatus } from '../../services/summaries';
import { componentMetrics, spacing, useAppTheme } from '../../theme';
import { copyText } from '../settings/whatsappConnectModel';
import { ScreenBody } from '../shared/Section';
import { useFormatters } from '../shared/useFormatters';
import { AttachMeetingSheet, type AttachMeetingTarget } from './AttachMeetingSheet';
import { commitmentsEntryFor } from './commitmentsEntryModel';
import { ReviewCommitmentsButton } from './ReviewCommitmentsButton';
import { SummaryRetentionList } from './SummaryRetention';
import { summaryKeptUntil } from './summaryRetentionModel';
import { SUMMARY_PROVIDER_RETENTION_DAYS, summaryErrorMessageKey } from './summaryText';
import {
  attachTargetFor,
  hasPlainLinks,
  inboxReasonLineKey,
  looksTruncated,
  matchLine,
  originChip,
  originLines,
  summaryDateLine,
  summaryItemView,
  summaryTitle,
  summaryViewActions,
  summaryViewErrorKey,
  summaryViewState,
  trustNoteKeys,
  viewSections,
  type SummaryViewBlock,
  type TextRef,
} from './summaryViewModel';

type Props = StackScreenProps<RootStackParamList, 'SummaryView'>;
type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];
type Busy = 'detach' | 'keep' | 'delete' | null;

export function SummaryViewScreen({ navigation, route }: Props): ReactElement {
  const summaryId = route.params.summaryId;
  const t = useT();
  const { colors } = useAppTheme();
  const fmt = useFormatters();
  const { status, available, error: statusError, refresh: refreshStatus } = useSummaryStatus();
  const { summary, error, loading, refresh } = useSummary(summaryId, { enabled: available });
  const [busy, setBusy] = useState<Busy>(null);
  const [attachTarget, setAttachTarget] = useState<AttachMeetingTarget | null>(null);
  /** M11: the "How long we keep summaries" lines are shown (screen state only). */
  const [retentionOpen, setRetentionOpen] = useState(false);
  /** The screen already went back (a delete here, or the summary vanished). */
  const leftRef = useRef(false);
  /** A delete from this screen is in flight: its own toast says so, not "no longer here". */
  const deletingRef = useRef(false);

  const state = summaryViewState({ status, statusError, summary, error, loading });
  const sections = useMemo(() => (summary !== null ? viewSections(summary) : []), [summary]);
  const tr = useCallback((ref: TextRef): string => t(ref.key, ref.params), [t]);

  const leave = useCallback((): void => {
    if (leftRef.current) return;
    leftRef.current = true;
    if (navigation.canGoBack()) navigation.goBack();
  }, [navigation]);

  // Deleted here or on another device (not_found): back to where the user came from. Opened as the
  // first screen (nothing to go back to), the "no longer here" state stays.
  useEffect(() => {
    if (state !== 'gone' || leftRef.current || !navigation.canGoBack()) return;
    if (!deletingRef.current) Toast.show({ type: 'info', text1: t('summaries:view.notFound') });
    leave();
  }, [state, navigation, leave, t]);

  const runAction = useCallback(
    async (kind: Exclude<Busy, null>, action: () => Promise<unknown>, successKey: string): Promise<boolean> => {
      setBusy(kind);
      try {
        await action();
        Toast.show({ type: 'success', text1: t(successKey) });
        return true;
      } catch (caught: unknown) {
        // The service already logged the callable name and the codes; the user sees the message.
        Toast.show({ type: 'error', text1: t(summaryErrorMessageKey(toAppError(caught))) });
        return false;
      } finally {
        setBusy(null);
      }
    },
    [t],
  );

  const confirmDetach = useCallback((): void => {
    Alert.alert(
      t('summaries:view.notThisMeetingTitle'),
      t('summaries:view.notThisMeetingBody'),
      [
        { text: t('summaries:common.cancel'), style: 'cancel' },
        {
          text: t('summaries:view.notThisMeetingConfirm'),
          onPress: () => {
            void runAction('detach', () => summariesService.detach(summaryId), 'summaries:view.detached');
          },
        },
      ],
      { cancelable: true },
    );
  }, [runAction, summaryId, t]);

  const keep = useCallback((): void => {
    void runAction('keep', () => summariesService.keep(summaryId), 'summaries:inbox.kept');
  }, [runAction, summaryId]);

  const deleteNow = useCallback(async (): Promise<void> => {
    deletingRef.current = true;
    const deleted = await runAction('delete', () => summariesService.deleteSummary(summaryId), 'summaries:common.delete.done');
    if (deleted) leave();
    else deletingRef.current = false;
  }, [leave, runAction, summaryId]);

  const confirmDelete = useCallback((): void => {
    Alert.alert(
      t('summaries:common.delete.title'),
      t('summaries:common.delete.body', { providerDays: SUMMARY_PROVIDER_RETENTION_DAYS }),
      [
        { text: t('summaries:common.cancel'), style: 'cancel' },
        {
          text: t('summaries:common.delete.confirm'),
          style: 'destructive',
          onPress: () => {
            void deleteNow();
          },
        },
      ],
      { cancelable: true },
    );
  }, [deleteNow, t]);

  const copyAll = useCallback((): void => {
    if (summary === null) return;
    if (copyText(summary.text)) Toast.show({ type: 'success', text1: t('summaries:view.copied') });
    else Toast.show({ type: 'error', text1: t('summaries:common.copyFailed') });
  }, [summary, t]);

  const closeSheet = useCallback((): void => setAttachTarget(null), []);

  const openCommitments = useCallback(
    (id: string): void => {
      navigation.navigate('SummaryCommitments', { summaryId: id });
    },
    [navigation],
  );

  if (state === 'loading') {
    return (
      <ScreenBody>
        <LoadingState testID="summary-view-loading" />
      </ScreenBody>
    );
  }

  if (state === 'error') {
    return (
      <ScreenBody>
        <ErrorState
          body={t(summaryViewErrorKey({ error, statusError }))}
          onRetry={() => {
            void (status === null ? refreshStatus() : refresh());
          }}
          testID="summary-view-error"
        />
      </ScreenBody>
    );
  }

  if (state === 'unavailable') {
    return (
      <ScreenBody>
        <EmptyState
          icon="email-off-outline"
          title={t('summaries:common.unavailable.title')}
          body={t('summaries:common.unavailable.body')}
          testID="summary-view-unavailable"
        />
      </ScreenBody>
    );
  }

  if (state === 'gone' || summary === null) {
    return (
      <ScreenBody>
        <EmptyState
          icon="email-remove-outline"
          title={t('summaries:view.notFound')}
          body={t('summaries:view.notFoundBody')}
          testID="summary-view-gone"
        />
      </ScreenBody>
    );
  }

  const title = summaryTitle(summary) ?? t('summaries:common.untitled');
  const chip = originChip(summary.tier);
  const origin = originLines(summary, fmt.dateTime(summary.receivedAt));
  const trust = trustNoteKeys(summary);
  const match = matchLine(summary, (iso) => fmt.dateTime(iso));
  const reasonKey = inboxReasonLineKey(summary);
  const dateLine = summaryDateLine(summary.summaryDate, (localDate) => fmt.date(localDate, 'long'));
  const actions = summaryViewActions(summary);
  const disabled = busy !== null;
  const muted = { color: colors.onSurfaceVariant };
  // M11: filed or kept only (an inbox summary is filed or kept first).
  const reviewEntry = commitmentsEntryFor(summary, available);
  const keptUntil = summaryKeptUntil(summary);

  return (
    <ScreenBody>
      <View style={styles.header}>
        <Text variant="headlineSmall" accessibilityRole="header" selectable testID="summary-view-title">
          {title}
        </Text>
        {chip !== null ? <Badge label={t(chip.key)} tone={chip.tone} style={styles.chip} testID="summary-view-chip" /> : null}
      </View>

      {/* M11 (M11-DESIGN.md section 3.1): "Review commitments" at the top, under the title. */}
      {reviewEntry !== null ? (
        <ReviewCommitmentsButton entry={reviewEntry} onPress={openCommitments} fullWidth disabled={disabled} testID="summary-view-review" />
      ) : null}

      <Card style={styles.card} testID="summary-view-origin">
        {origin.map((line, index) => (
          <Text
            key={line.key}
            variant="bodyMedium"
            style={index > 0 ? [styles.line, muted] : undefined}
            testID={index === 0 ? 'summary-view-origin-line' : 'summary-view-received'}
          >
            {tr(line)}
          </Text>
        ))}
        {trust.map((key) => (
          <IconLine key={key} icon="alert-outline" iconColor={colors.warning} text={t(key)} testID={`summary-view-${key.split('.').pop() ?? 'trust'}`} />
        ))}
        <View style={[styles.notice, { borderTopColor: colors.outlineVariant }]}>
          <MaterialCommunityIcons
            name="information-outline"
            size={componentMetrics.iconInline}
            color={colors.primary}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
          <View style={styles.flex}>
            <Text variant="bodyMedium" testID="summary-view-not-attended">
              {t('summaries:common.notAttended')}
            </Text>
            <Text variant="bodySmall" style={[styles.line, muted]}>
              {t('summaries:common.otherRecorder')}
            </Text>
          </View>
        </View>
      </Card>

      <Card style={styles.card} testID="summary-view-match">
        <IconLine
          icon={summary.status === 'matched' ? 'calendar-check-outline' : 'calendar-question'}
          iconColor={summary.status === 'matched' ? colors.primary : colors.onSurfaceVariant}
          text={tr(match)}
          variant="bodyMedium"
          testID="summary-view-match-line"
        />
        <Text variant="bodySmall" style={[styles.line, muted]} testID="summary-view-date">
          {tr(dateLine)}
        </Text>
        {reasonKey !== null ? (
          <Text variant="bodySmall" style={[styles.line, muted]} testID="summary-view-reason">
            {t(reasonKey)}
          </Text>
        ) : null}
        <View style={styles.buttonRow}>
          {actions.move ? (
            <MGButton
              variant="tonal"
              icon="swap-horizontal"
              onPress={() => setAttachTarget(attachTargetFor(summary))}
              disabled={disabled}
              style={styles.rowButton}
              testID="summary-view-move"
            >
              {t('summaries:view.move')}
            </MGButton>
          ) : null}
          {actions.notThisMeeting ? (
            <MGButton
              variant="outline"
              icon="calendar-remove-outline"
              onPress={confirmDetach}
              loading={busy === 'detach'}
              disabled={disabled}
              style={styles.rowButton}
              testID="summary-view-detach"
            >
              {t('summaries:view.notThisMeeting')}
            </MGButton>
          ) : null}
          {actions.choose ? (
            <MGButton
              variant="tonal"
              icon="calendar-plus"
              onPress={() => setAttachTarget(attachTargetFor(summary))}
              disabled={disabled}
              style={styles.rowButton}
              testID="summary-view-choose"
            >
              {t('summaries:view.choose')}
            </MGButton>
          ) : null}
          {actions.keep ? (
            <MGButton
              variant="outline"
              icon="archive-outline"
              onPress={keep}
              loading={busy === 'keep'}
              disabled={disabled}
              style={styles.rowButton}
              testID="summary-view-keep"
            >
              {t('summaries:view.keep')}
            </MGButton>
          ) : null}
        </View>
      </Card>

      {looksTruncated(summary) ? (
        <View>
          <IconLine icon="content-cut" iconColor={colors.warning} text={t('summaries:view.truncated')} testID="summary-view-truncated" />
          {/* M11: summaryRead says so itself (recorded at receipt), so the hint can say what was kept. */}
          {summary.truncated === true ? (
            <Text variant="bodySmall" style={[styles.iconLineHint, muted]} testID="summary-view-truncated-hint">
              {t('summaries:view.truncatedHint')}
            </Text>
          ) : null}
        </View>
      ) : null}

      {sections.map((section) => {
        const heading = section.heading ?? (section.headingKey !== null ? t(section.headingKey) : null);
        return (
          <View key={section.id} testID={`summary-section-${section.id}`}>
            {heading !== null ? <SectionHeader title={heading} testID={`summary-section-heading-${section.id}`} /> : null}
            <Card style={heading === null ? styles.card : undefined}>
              {section.derived ? (
                <Text variant="bodySmall" style={[styles.derivedNote, muted]}>
                  {t('summaries:view.tldrNote')}
                </Text>
              ) : null}
              {section.blocks.map((block, index) => (
                <SummaryBlockView key={block.key} block={block} first={index === 0 && !section.derived} />
              ))}
            </Card>
          </View>
        );
      })}

      {hasPlainLinks(summary) ? (
        <IconLine icon="link-variant-off" iconColor={colors.onSurfaceVariant} text={t('summaries:view.linksPlain')} testID="summary-view-links-plain" />
      ) : null}

      {summary.subject !== null || summary.fromAddress !== null ? (
        <>
          <SectionHeader title={t('summaries:view.emailHeading')} />
          <Card testID="summary-view-email">
            {summary.subject !== null ? (
              <Text variant="bodySmall" selectable style={muted}>
                {t('summaries:view.subject', { subject: summary.subject })}
              </Text>
            ) : null}
            {summary.fromAddress !== null ? (
              <Text variant="bodySmall" selectable style={[summary.subject !== null ? styles.line : null, muted]}>
                {t('summaries:view.from', { address: summary.fromAddress })}
              </Text>
            ) : null}
          </Card>
        </>
      ) : null}

      {/* M11 (M11-DESIGN.md section 5): how long this summary is kept, and the rules behind it. */}
      <Card style={styles.card} testID="summary-view-retention">
        {keptUntil !== null ? (
          <Text variant="bodyMedium" testID="summary-view-kept-until">
            {t('summaries:view.keptUntil', { date: fmt.date(keptUntil, 'long') })}
          </Text>
        ) : null}
        <MGButton
          variant="ghost"
          size="sm"
          icon={retentionOpen ? 'chevron-up' : 'chevron-down'}
          onPress={() => setRetentionOpen((open) => !open)}
          style={keptUntil !== null ? styles.retentionLink : styles.retentionLinkFirst}
          testID="summary-view-retention-link"
        >
          {t('summaries:view.retentionLink')}
        </MGButton>
        {retentionOpen ? <SummaryRetentionList testID="summary-view-retention-list" /> : null}
      </Card>

      <View style={styles.actions}>
        <MGButton variant="tonal" icon="content-copy" onPress={copyAll} disabled={disabled} style={styles.rowButton} testID="summary-view-copy">
          {t('summaries:view.copyText')}
        </MGButton>
        <MGButton
          variant="destructive"
          icon="delete-outline"
          onPress={confirmDelete}
          loading={busy === 'delete'}
          disabled={disabled}
          style={styles.rowButton}
          testID="summary-view-delete"
        >
          {t('summaries:common.delete.action')}
        </MGButton>
      </View>

      <AttachMeetingSheet target={attachTarget} onDismiss={closeSheet} onAttached={closeSheet} />
    </ScreenBody>
  );
}

/** A plain text block, or one item line: checkbox state, the text, owner / due as written. */
function SummaryBlockView({ block, first }: { block: SummaryViewBlock; first: boolean }): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  if (block.kind === 'text') {
    return (
      <Text variant="bodyMedium" selectable style={first ? undefined : styles.block}>
        {block.text}
      </Text>
    );
  }
  const view = summaryItemView(block.item);
  const checked = block.item.checked;
  const icon: IconName = checked === null ? 'circle-small' : checked ? 'checkbox-marked-outline' : 'checkbox-blank-outline';
  const meta = view.meta.map((ref) => t(ref.key, ref.params)).join(' · ');
  return (
    <View style={[styles.item, first ? null : styles.block]} testID={`summary-item-${block.item.id}`}>
      <MaterialCommunityIcons
        name={icon}
        size={componentMetrics.iconInline}
        color={checked === true ? colors.primary : colors.onSurfaceVariant}
        style={styles.itemIcon}
        accessible={view.checkKey !== null}
        accessibilityLabel={view.checkKey !== null ? t(view.checkKey) : undefined}
        accessibilityElementsHidden={view.checkKey === null}
        importantForAccessibility={view.checkKey === null ? 'no' : 'yes'}
        testID={view.checkKey !== null ? `summary-item-${block.item.id}-${checked === true ? 'done' : 'open'}` : undefined}
      />
      <View style={styles.flex}>
        <Text variant="bodyMedium" selectable>
          {block.text}
        </Text>
        {meta !== '' ? (
          <Text variant="bodySmall" selectable style={[styles.itemMeta, { color: colors.onSurfaceVariant }]}>
            {meta}
          </Text>
        ) : null}
        {view.warningKey !== null ? (
          <Text variant="bodySmall" style={[styles.itemMeta, { color: colors.onSurfaceVariant }]}>
            {t(view.warningKey)}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** A short line with a leading meta icon (trust notes, the match line, plain-link notice). */
function IconLine({
  icon,
  iconColor,
  text,
  variant = 'bodySmall',
  testID,
}: {
  icon: IconName;
  iconColor: string;
  text: string;
  variant?: 'bodySmall' | 'bodyMedium';
  testID?: string;
}): ReactElement {
  const { colors } = useAppTheme();
  return (
    <View style={styles.iconLine}>
      <MaterialCommunityIcons
        name={icon}
        size={componentMetrics.iconMeta}
        color={iconColor}
        style={styles.itemIcon}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
      <Text
        variant={variant}
        style={[styles.flex, variant === 'bodySmall' ? { color: colors.onSurfaceVariant } : null]}
        testID={testID}
      >
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  header: {
    marginBottom: spacing.md,
  },
  chip: {
    marginTop: spacing.sm,
  },
  card: {
    marginTop: spacing.md,
  },
  line: {
    marginTop: spacing.xs,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  iconLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.md,
  },
  rowButton: {
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
  },
  derivedNote: {
    marginBottom: spacing.sm,
  },
  block: {
    marginTop: spacing.sm,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  itemIcon: {
    marginTop: 2,
  },
  itemMeta: {
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
  },
  // M11: under an IconLine's text (past the meta icon and the gap).
  iconLineHint: {
    marginTop: spacing.xs,
    marginLeft: componentMetrics.iconMeta + spacing.sm,
  },
  retentionLink: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
  },
  retentionLinkFirst: {
    alignSelf: 'flex-start',
  },
});
