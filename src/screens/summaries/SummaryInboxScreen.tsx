/**
 * Summary inbox (route "SummaryInbox"; docs/v2/M10-DESIGN.md section 9), reached from the
 * Settings row "Meeting summaries" once the private address exists. Top to bottom:
 * - "Waiting for a meeting": one card per inbox summary (title, the date written in it, when it
 *   arrived, the origin chip, why it waits), up to 3 one-tap "File under <meeting>" rows from the
 *   row's suggestions (never on not_addressed_to_you cards, which say why instead), then Choose a
 *   meeting (AttachMeetingSheet), Keep without a meeting and Delete (after a confirmation).
 *   Tapping the card's text opens SummaryView.
 * - "Filed recently": filed and kept summaries, each opening SummaryView.
 * - "Refused": collapsed; opened, one row per day with a count, the latest reason and the
 *   verified sender domain. Loaded only when opened (refused rows hold no content).
 * - "Address and setup" opens SummaryConnect.
 * Pull to refresh asks the inbox again (the server re-matches it first), then the other views.
 * The inbox is asked before "Filed recently" on every visit, so a summary the re-match files
 * shows up there instead of vanishing from both lists.
 *
 * Everything is shown only while summaryStatus says enabled and allowed (pilot); a not_enabled
 * or not_allowed answer from any call (a missing summaryRead reaches the app as not_enabled)
 * shows the "not available" notice instead. Nothing from a summary is logged; failures show a
 * toast built from the AppError code and reason only.
 * Strings: summaries:inbox.*, summaries:common.*. Pure parts: summaryInboxModel.ts.
 * M11 (M11-DESIGN.md sections 3.1 and 5) hangs no entry point here: "Review commitments" goes on
 * MeetingSummarySection rows and SummaryView, Disconnect on SummaryConnect. Its optional
 * list-row commitments counts could later join the "Filed recently" supporting line.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

import {
  Badge,
  Banner,
  Card,
  EmptyState,
  ErrorState,
  ListGroup,
  ListRow,
  LoadingState,
  MGButton,
  PressableScale,
  SectionHeader,
} from '../../components/ui';
import { SUMMARY_LIMITS, type SummaryListItem, type SummarySuggestion } from '../../core/aiContract';
import type { RootStackParamList } from '../../core/contracts';
import { toAppError, type AppError } from '../../core/errors';
import { useT } from '../../i18n';
import {
  isSummariesUnavailableError,
  summariesService,
  summaryErrorReason,
  useSummaryList,
  useSummaryStatus,
} from '../../services/summaries';
import { componentMetrics, spacing, useAppTheme } from '../../theme';
import { useFormatters } from '../shared/useFormatters';
import { AttachMeetingSheet, type AttachMeetingTarget } from './AttachMeetingSheet';
import {
  attachRequestForSuggestion,
  attachTargetForItem,
  inboxCardModel,
  inboxView,
  recentRowModel,
  refusedDayRows,
  suggestionKey,
} from './summaryInboxModel';
import { SUMMARY_PROVIDER_RETENTION_DAYS, refusedReasonKeys, summaryErrorMessageKey } from './summaryText';

type Navigation = StackNavigationProp<RootStackParamList>;

/** The card action in flight ('file:<suggestion key>' for a one-tap suggestion). */
interface BusyAction {
  summaryId: string;
  action: string;
}

export function SummaryInboxScreen(): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const fmt = useFormatters();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Navigation>();
  const { status, available, error: statusError, refresh: refreshStatus } = useSummaryStatus();
  const waiting = useSummaryList('inbox', null, { enabled: available });
  const [inboxAsked, setInboxAsked] = useState(false);
  const [refusedOpen, setRefusedOpen] = useState(false);
  const [busy, setBusy] = useState<BusyAction | null>(null);
  const [pulling, setPulling] = useState(false);
  const [attachTarget, setAttachTarget] = useState<AttachMeetingTarget | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The inbox answer re-matches on the server, which can file a summary: ask "Filed recently"
  // only once this visit's inbox ask settled. This joins the ask the list hook above just
  // started (in-flight asks are shared), so no second call is made.
  useEffect(() => {
    if (!available) return undefined;
    let active = true;
    const settle = (): void => {
      if (active) setInboxAsked(true);
    };
    summariesService.listSummaries('inbox').then(settle, (caught: unknown) => {
      // Not available (summaryRead missing, or not in the pilot): the notice shows, ask nothing more.
      if (!isSummariesUnavailableError(toAppError(caught))) settle();
    });
    return () => {
      active = false;
    };
  }, [available]);

  const recent = useSummaryList('recent', null, { enabled: available && inboxAsked });
  const refused = useSummaryList('refused', null, { enabled: available && refusedOpen });
  const { view, error: viewError } = inboxView({
    status,
    statusError,
    waiting: { items: waiting.items, error: waiting.error },
    recent: { items: recent.items, error: recent.error },
  });

  const refreshWaiting = waiting.refresh;
  const refreshRecent = recent.refresh;
  const refreshRefused = refused.refresh;
  const refreshAll = useCallback(async (): Promise<void> => {
    setPulling(true);
    try {
      await refreshStatus();
      // The inbox first: it re-matches, and a re-match can file a summary.
      await refreshWaiting();
      await Promise.all([refreshRecent(), refusedOpen ? refreshRefused() : Promise.resolve()]);
    } finally {
      if (mounted.current) setPulling(false);
    }
  }, [refreshStatus, refreshWaiting, refreshRecent, refreshRefused, refusedOpen]);

  const run = useCallback(
    async (summaryId: string, action: string, work: () => Promise<unknown>, done: string): Promise<void> => {
      setBusy({ summaryId, action });
      try {
        await work();
        Toast.show({ type: 'success', text1: done });
      } catch (caught: unknown) {
        const error = toAppError(caught);
        Toast.show({ type: 'error', text1: t(summaryErrorMessageKey(error)) });
        // Deleted on another device, or the suggested meeting is gone: ask the inbox again.
        const reason = summaryErrorReason(error);
        if (reason === 'not_found' || reason === 'invalid_meeting') void refreshWaiting();
      } finally {
        if (mounted.current) setBusy(null);
      }
    },
    [t, refreshWaiting],
  );

  const fileUnder = (item: SummaryListItem, suggestion: SummarySuggestion): void => {
    void run(
      item.summaryId,
      `file:${suggestionKey(suggestion)}`,
      () => summariesService.attach(attachRequestForSuggestion(item.summaryId, suggestion)),
      t('summaries:inbox.filed', { title: suggestion.title }),
    );
  };

  const keep = (item: SummaryListItem): void => {
    void run(item.summaryId, 'keep', () => summariesService.keep(item.summaryId), t('summaries:inbox.kept'));
  };

  const confirmDelete = (item: SummaryListItem): void => {
    Alert.alert(t('summaries:common.delete.title'), t('summaries:common.delete.body', { providerDays: SUMMARY_PROVIDER_RETENTION_DAYS }), [
      { text: t('summaries:common.cancel'), style: 'cancel' },
      {
        text: t('summaries:common.delete.confirm'),
        style: 'destructive',
        onPress: () => {
          void run(item.summaryId, 'delete', () => summariesService.deleteSummary(item.summaryId), t('summaries:common.delete.done'));
        },
      },
    ]);
  };

  const openSummary = (summaryId: string): void => navigation.navigate('SummaryView', { summaryId });
  const openSetup = (): void => navigation.navigate('SummaryConnect');

  const refusedSection = (
    <RefusedSection
      open={refusedOpen}
      onToggle={() => setRefusedOpen((open) => !open)}
      items={refused.items}
      error={refused.error}
      onRetry={() => void refused.refresh()}
    />
  );

  let body: ReactElement;
  if (view === 'loading') {
    body = <LoadingState testID="summary-inbox-loading" />;
  } else if (view === 'unavailable') {
    body = (
      <Banner
        tone="info"
        title={t('summaries:common.unavailable.title')}
        text={t('summaries:common.unavailable.body')}
        testID="summary-inbox-unavailable"
      />
    );
  } else if (view === 'error') {
    body = (
      <ErrorState
        body={t(viewError !== null ? summaryErrorMessageKey(viewError) : 'summaries:errors.generic')}
        onRetry={() => void refreshAll()}
        loading={pulling}
        testID="summary-inbox-error"
      />
    );
  } else if (view === 'empty') {
    body = (
      <>
        <EmptyState
          icon="email-outline"
          title={t('summaries:inbox.empty.title')}
          body={t('summaries:inbox.empty.body')}
          action={{ label: t('summaries:inbox.empty.action'), onPress: openSetup }}
          testID="summary-inbox-empty"
        />
        {refusedSection}
      </>
    );
  } else {
    const waitingItems = waiting.items ?? [];
    const recentItems = recent.items;
    body = (
      <>
        <SectionHeader title={t('summaries:inbox.waiting.title')} style={styles.firstHeader} testID="summary-inbox-waiting" />
        {waitingItems.length === 0 ? (
          <Text variant="bodyMedium" style={[styles.note, { color: colors.onSurfaceVariant }]} testID="summary-inbox-waiting-empty">
            {t('summaries:inbox.waiting.empty')}
          </Text>
        ) : (
          <>
            <Text variant="bodySmall" style={[styles.note, { color: colors.onSurfaceVariant }]}>
              {t('summaries:inbox.pullToRefresh')}
            </Text>
            {waitingItems.map((item) => (
              <InboxCard
                key={item.summaryId}
                item={item}
                busy={busy !== null && busy.summaryId === item.summaryId ? busy.action : null}
                onOpen={() => openSummary(item.summaryId)}
                onFileUnder={(suggestion) => fileUnder(item, suggestion)}
                onChoose={() => setAttachTarget(attachTargetForItem(item))}
                onKeep={() => keep(item)}
                onDelete={() => confirmDelete(item)}
              />
            ))}
          </>
        )}
        {waiting.hasMore ? (
          <Text variant="bodySmall" style={[styles.note, { color: colors.onSurfaceVariant }]}>
            {t('summaries:inbox.more', { count: SUMMARY_LIMITS.maxListItems })}
          </Text>
        ) : null}

        <SectionHeader title={t('summaries:inbox.recent.title')} testID="summary-inbox-recent" />
        {recentItems === null ? (
          recent.error !== null ? (
            <View style={styles.inlineError} testID="summary-inbox-recent-error">
              <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
                {t(summaryErrorMessageKey(recent.error))}
              </Text>
              <MGButton variant="ghost" size="sm" onPress={() => void recent.refresh()} style={styles.inlineRetry}>
                {t('summaries:common.retry')}
              </MGButton>
            </View>
          ) : (
            <Text variant="bodyMedium" style={[styles.note, { color: colors.onSurfaceVariant }]} testID="summary-inbox-recent-loading">
              {t('summaries:common.loading')}
            </Text>
          )
        ) : recentItems.length === 0 ? (
          <Text variant="bodyMedium" style={[styles.note, { color: colors.onSurfaceVariant }]} testID="summary-inbox-recent-empty">
            {t('summaries:inbox.recent.empty')}
          </Text>
        ) : (
          <ListGroup testID="summary-inbox-recent-list">
            {recentItems.map((item) => {
              const row = recentRowModel(item);
              const title = row.title ?? t('summaries:common.untitled');
              const filing =
                row.filedUnder !== null ? t('summaries:inbox.recent.filedUnder', { title: row.filedUnder }) : t('summaries:inbox.recent.kept');
              return (
                <ListRow
                  key={row.summaryId}
                  icon={row.kept ? 'archive-outline' : 'email-check-outline'}
                  title={title}
                  supporting={`${filing}\n${t('summaries:common.received', { time: fmt.dateTime(row.receivedAt) })}`}
                  trailing="chevron"
                  onPress={() => openSummary(row.summaryId)}
                  accessibilityLabel={t('summaries:meeting.open', { title })}
                  testID={`summary-inbox-recent-${row.summaryId}`}
                />
              );
            })}
          </ListGroup>
        )}
        {recent.hasMore ? (
          <Text variant="bodySmall" style={[styles.note, styles.noteAfter, { color: colors.onSurfaceVariant }]}>
            {t('summaries:inbox.more', { count: SUMMARY_LIMITS.maxListItems })}
          </Text>
        ) : null}

        {refusedSection}

        <ListGroup style={styles.setup}>
          <ListRow
            icon="cog-outline"
            title={t('summaries:inbox.openSetup')}
            trailing="chevron"
            onPress={openSetup}
            testID="summary-inbox-setup"
          />
        </ListGroup>
      </>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.xxl }]}
        refreshControl={
          <RefreshControl
            refreshing={pulling}
            onRefresh={() => void refreshAll()}
            colors={[colors.primary]}
            tintColor={colors.primary}
            progressBackgroundColor={colors.surface}
          />
        }
        testID="summary-inbox"
      >
        {body}
      </ScrollView>
      <AttachMeetingSheet target={attachTarget} onDismiss={() => setAttachTarget(null)} />
    </View>
  );
}

// ---- Waiting card -------------------------------------------------------------------------------

interface InboxCardProps {
  item: SummaryListItem;
  /** The action in flight on this card, or null. */
  busy: string | null;
  onOpen(): void;
  onFileUnder(suggestion: SummarySuggestion): void;
  onChoose(): void;
  onKeep(): void;
  onDelete(): void;
}

function InboxCard({ item, busy, onOpen, onFileUnder, onChoose, onKeep, onDelete }: InboxCardProps): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const fmt = useFormatters();
  const card = inboxCardModel(item);
  const title = card.title ?? t('summaries:common.untitled');
  const disabled = busy !== null;
  const dateLine =
    card.summaryDate !== null
      ? t('summaries:common.summaryDate', { date: fmt.date(card.summaryDate, 'medium') })
      : t('summaries:common.noSummaryDate');

  return (
    <Card style={styles.card} testID={`summary-inbox-card-${card.summaryId}`}>
      <PressableScale
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={t('summaries:meeting.open', { title })}
        testID={`summary-inbox-open-${card.summaryId}`}
      >
        {card.chipKey !== null ? <Badge label={t(card.chipKey)} tone={item.tier === 'vendor_verified' ? 'primary' : 'neutral'} style={styles.chip} /> : null}
        <Text variant="titleMedium">{title}</Text>
        <Text variant="bodySmall" style={[styles.meta, { color: colors.onSurfaceVariant }]}>
          {dateLine}
        </Text>
        <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
          {t('summaries:common.received', { time: fmt.dateTime(card.receivedAt) })}
        </Text>
      </PressableScale>
      {card.reasonKey !== null ? (
        <Text variant="bodyMedium" style={styles.reason} testID={`summary-inbox-reason-${card.summaryId}`}>
          {t(card.reasonKey)}
        </Text>
      ) : null}
      {card.suggestions.length > 0 ? (
        <ListGroup style={styles.suggestions} testID={`summary-inbox-suggestions-${card.summaryId}`}>
          {card.suggestions.map((suggestion) => {
            const key = suggestionKey(suggestion);
            const time = fmt.dateTime(suggestion.startAt);
            return (
              <ListRow
                key={key}
                icon="folder-move-outline"
                title={t('summaries:inbox.fileUnder', { title: suggestion.title })}
                supporting={time}
                onPress={() => onFileUnder(suggestion)}
                disabled={disabled}
                trailing={busy === `file:${key}` ? <ActivityIndicator size="small" color={colors.primary} /> : null}
                accessibilityLabel={t('summaries:inbox.fileUnderA11y', { title: suggestion.title, time })}
                testID={`summary-inbox-file-${card.summaryId}-${key}`}
              />
            );
          })}
        </ListGroup>
      ) : null}
      {card.showNoSuggestionsNote ? (
        <View style={styles.noSuggestions} testID={`summary-inbox-no-suggestions-${card.summaryId}`}>
          <MaterialCommunityIcons name="information-outline" size={componentMetrics.iconInline} color={colors.onSurfaceVariant} />
          <Text variant="bodySmall" style={[styles.noSuggestionsText, { color: colors.onSurfaceVariant }]}>
            {t('summaries:inbox.noSuggestions')}
          </Text>
        </View>
      ) : null}
      <MGButton
        variant="tonal"
        icon="calendar-search"
        onPress={onChoose}
        disabled={disabled}
        style={styles.choose}
        testID={`summary-inbox-choose-${card.summaryId}`}
      >
        {t('summaries:inbox.choose')}
      </MGButton>
      <View style={styles.secondaryActions}>
        <MGButton
          variant="ghost"
          icon="archive-outline"
          onPress={onKeep}
          disabled={disabled}
          loading={busy === 'keep'}
          testID={`summary-inbox-keep-${card.summaryId}`}
        >
          {t('summaries:inbox.keep')}
        </MGButton>
        <MGButton
          variant="destructive"
          icon="delete-outline"
          onPress={onDelete}
          disabled={disabled}
          loading={busy === 'delete'}
          testID={`summary-inbox-delete-${card.summaryId}`}
        >
          {t('summaries:common.delete.action')}
        </MGButton>
      </View>
    </Card>
  );
}

// ---- Refused ------------------------------------------------------------------------------------

interface RefusedSectionProps {
  open: boolean;
  onToggle(): void;
  items: readonly SummaryListItem[] | null;
  error: AppError | null;
  onRetry(): void;
}

function RefusedSection({ open, onToggle, items, error, onRetry }: RefusedSectionProps): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const fmt = useFormatters();
  const rows = items !== null ? refusedDayRows(items) : null;

  let content: ReactElement | null = null;
  if (open) {
    if (rows === null) {
      content =
        error !== null ? (
          <View style={styles.inlineError} testID="summary-inbox-refused-error">
            <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
              {t(summaryErrorMessageKey(error))}
            </Text>
            <MGButton variant="ghost" size="sm" onPress={onRetry} style={styles.inlineRetry}>
              {t('summaries:common.retry')}
            </MGButton>
          </View>
        ) : (
          <Text variant="bodyMedium" style={[styles.note, { color: colors.onSurfaceVariant }]} testID="summary-inbox-refused-loading">
            {t('summaries:common.loading')}
          </Text>
        );
    } else if (rows.length === 0) {
      content = (
        <Text variant="bodyMedium" style={[styles.note, { color: colors.onSurfaceVariant }]} testID="summary-inbox-refused-empty">
          {t('summaries:inbox.refused.empty')}
        </Text>
      );
    } else {
      content = (
        <ListGroup testID="summary-inbox-refused-list">
          {rows.map((row) => {
            const from =
              row.senderDomain !== null ? t('summaries:common.refusedFrom', { domain: row.senderDomain }) : t('summaries:common.refusedFromUnknown');
            const supporting = row.reason !== null ? `${t(refusedReasonKeys(row.reason).title)}\n${from}` : from;
            return (
              <ListRow
                key={row.day}
                icon="email-off-outline"
                title={t('summaries:inbox.refused.row', { count: row.count, day: fmt.date(row.day, 'medium') })}
                supporting={supporting}
                testID={`summary-inbox-refused-${row.day}`}
              />
            );
          })}
        </ListGroup>
      );
    }
  }

  return (
    <View testID="summary-inbox-refused">
      <SectionHeader
        title={t('summaries:inbox.refused.title')}
        action={{ label: open ? t('summaries:inbox.refused.hide') : t('summaries:inbox.refused.show'), onPress: onToggle }}
        testID="summary-inbox-refused-header"
      />
      {content}
      {open ? (
        <Text variant="bodySmall" style={[styles.note, styles.noteAfter, { color: colors.onSurfaceVariant }]}>
          {t('summaries:common.refusedNotStored')}
        </Text>
      ) : null}
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
  firstHeader: {
    marginTop: spacing.xs,
  },
  note: {
    marginBottom: spacing.md,
  },
  noteAfter: {
    marginTop: spacing.sm,
  },
  card: {
    marginBottom: componentMetrics.cardGap,
  },
  chip: {
    marginBottom: spacing.sm,
  },
  meta: {
    marginTop: spacing.xs,
  },
  reason: {
    marginTop: spacing.md,
  },
  suggestions: {
    marginTop: spacing.md,
  },
  noSuggestions: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  noSuggestionsText: {
    flex: 1,
  },
  choose: {
    marginTop: spacing.md,
  },
  secondaryActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  inlineError: {
    marginBottom: spacing.md,
  },
  inlineRetry: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
  },
  setup: {
    marginTop: spacing.xxl,
  },
});
