/**
 * "Notetaker summary" section of Meeting details, between Notes and Attachments
 * (docs/v2/M10-DESIGN.md section 9): one row per summary filed under this meeting (summaryRead list
 * view 'meeting'; meetingId is the master id, so a series lists the summary of every occurrence,
 * each with the day its occurrence took place), with the title, the received time and the origin chip. A row
 * opens SummaryView.
 * - Hidden entirely unless summaryStatus says enabled and allowed, while nothing is known yet,
 *   when summaryRead is not deployed or the caller left the pilot (not_enabled / not_allowed), and
 *   when nothing is filed here (meetingSummaryRows).
 * - Never blocks or slows Meeting details: the list is asked only after the screen settled
 *   (MEETING_SUMMARIES_DEFER_MS after mount), and a failure renders nothing (no toast, no retry,
 *   no spinner here; the service logs codes only).
 * - Plain Text only; nothing from a summary is logged.
 * M11 (M11-DESIGN.md section 3.1): under each row, "Review commitments" (with the open count of a
 * ready list, and "2 added to your tasks" once anything was accepted) opens SummaryCommitments
 * { summaryId }; a separate button under the row, not inside it, so screen readers reach both.
 * Meeting details also shows one beside Debrief for the newest summary (MeetingCommitmentsButton).
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { useEffect, useState, type ReactElement } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Badge, ListGroup, SectionHeader } from '../../components/ui';
import type { SummaryListItem } from '../../core/aiContract';
import type { RootStackParamList } from '../../core/contracts';
import { useT } from '../../i18n';
import { useSummaryList, useSummaryStatus } from '../../services/summaries';
import { componentMetrics, pressedOpacity, spacing, stateAlpha, typography, useAppTheme, withAlpha } from '../../theme';
import { useFormatters } from '../shared/useFormatters';
import { commitmentsEntryFor, type CommitmentsEntry } from './commitmentsEntryModel';
import { ReviewCommitmentsButton } from './ReviewCommitmentsButton';
import { meetingSummaryRows, originChip, summaryTitle } from './summaryViewModel';

/**
 * Meeting details renders first: the summary list is asked this long after mount, once the push
 * transition is over (the stack animation takes about 350 ms).
 */
export const MEETING_SUMMARIES_DEFER_MS = 350;

export interface MeetingSummarySectionProps {
  /** The meeting shown on Meeting details (the master id for a series). */
  meetingId: string;
}

/** false until `delayMs` after mount. */
function useSettled(delayMs: number): boolean {
  const [settled, setSettled] = useState(delayMs <= 0);
  useEffect(() => {
    if (settled) return undefined;
    const timer = setTimeout(() => setSettled(true), delayMs);
    return () => clearTimeout(timer);
  }, [settled, delayMs]);
  return settled;
}

export function MeetingSummarySection({ meetingId }: MeetingSummarySectionProps): ReactElement | null {
  const t = useT();
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const { available } = useSummaryStatus();
  const settled = useSettled(MEETING_SUMMARIES_DEFER_MS);
  const { items, error } = useSummaryList('meeting', meetingId, { enabled: available && settled });
  const rows = meetingSummaryRows(available, items, error);
  if (rows === null) return null;
  return (
    <>
      <SectionHeader title={t('summaries:meeting.title', { count: rows.length })} />
      <ListGroup testID={`meeting-summaries-${meetingId}`}>
        {rows.map((item) => (
          <SummaryRow
            key={item.summaryId}
            item={item}
            entry={commitmentsEntryFor(item, available)}
            onOpen={() => navigation.navigate('SummaryView', { summaryId: item.summaryId })}
            onReview={(summaryId) => navigation.navigate('SummaryCommitments', { summaryId })}
          />
        ))}
      </ListGroup>
    </>
  );
}

/**
 * One summary: the ListRow layout with a meta line (origin chip, received time, occurrence date),
 * and M11's "Review commitments" under it.
 */
function SummaryRow({
  item,
  entry,
  onOpen,
  onReview,
}: {
  item: SummaryListItem;
  entry: CommitmentsEntry | null;
  onOpen(): void;
  onReview(summaryId: string): void;
}): ReactElement {
  const t = useT();
  const fmt = useFormatters();
  const { colors } = useAppTheme();
  const title = summaryTitle(item) ?? t('summaries:common.untitled');
  const chip = originChip(item.tier);
  // A series: the day that occurrence took place (its snapshot start, so a moved occurrence shows
  // its new day). match.occurrenceDate is the ORIGINAL date, an identifier only.
  const occurrenceStart = item.match !== null && item.match.occurrenceDate !== null ? item.match.meetingSnapshot.startAt : null;
  const supporting = { color: colors.onSurfaceVariant };
  return (
    <View>
      <Pressable
        onPress={onOpen}
        android_ripple={{ color: withAlpha(colors.onSurface, stateAlpha.rippleOnRow) }}
        style={({ pressed }) => [styles.row, pressed && Platform.OS !== 'android' ? styles.pressed : null]}
        accessibilityRole="button"
        accessibilityLabel={t('summaries:meeting.open', { title })}
        testID={`meeting-summary-${item.summaryId}`}
      >
        <MaterialCommunityIcons name="email-outline" size={componentMetrics.iconNav} color={colors.onSurfaceVariant} />
        <View style={styles.texts}>
          <Text style={[styles.title, { color: colors.onSurface }]} numberOfLines={2}>
            {title}
          </Text>
          <View style={styles.meta}>
            {chip !== null ? <Badge label={t(chip.key)} tone={chip.tone} testID={`meeting-summary-${item.summaryId}-chip`} /> : null}
            <Text style={[styles.supporting, supporting]} testID={`meeting-summary-${item.summaryId}-received`}>
              {t('summaries:meeting.received', { time: fmt.dateTime(item.receivedAt) })}
            </Text>
          </View>
          {occurrenceStart !== null ? (
            <Text style={[styles.supporting, supporting]} testID={`meeting-summary-${item.summaryId}-occurrence`}>
              {t('summaries:meeting.occurrence', { date: fmt.date(occurrenceStart, 'medium') })}
            </Text>
          ) : null}
        </View>
        <MaterialCommunityIcons name="chevron-right" size={componentMetrics.iconNav} color={colors.onSurfaceVariant} />
      </Pressable>
      {/* M11 (M11-DESIGN.md section 3.1): "Review commitments" for this summary. */}
      {entry !== null ? (
        <ReviewCommitmentsButton
          entry={entry}
          onPress={onReview}
          size="sm"
          style={styles.review}
          testID={`meeting-summary-${item.summaryId}-review`}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: componentMetrics.listRowTwoLineMinHeight,
    paddingHorizontal: componentMetrics.listRowPaddingH,
    paddingVertical: componentMetrics.listRowPaddingV,
    gap: spacing.lg,
  },
  texts: {
    flex: 1,
  },
  title: {
    ...typography.titleM,
  },
  meta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  supporting: {
    ...typography.bodyM,
  },
  pressed: {
    opacity: pressedOpacity,
  },
  // M11: under the row's texts (past the 24 dp icon and the row gap).
  review: {
    paddingLeft: componentMetrics.listRowPaddingH + componentMetrics.iconNav + spacing.lg,
    paddingRight: componentMetrics.listRowPaddingH,
    paddingBottom: componentMetrics.listRowPaddingV,
  },
});
