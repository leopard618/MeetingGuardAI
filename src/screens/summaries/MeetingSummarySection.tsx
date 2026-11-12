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
 * M11 (M11-DESIGN.md section 3.1) adds "Review commitments" (with the open count) to these rows,
 * at the marked spot below, and beside Debrief on Meeting details. Not built in M10.
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
            onOpen={() => navigation.navigate('SummaryView', { summaryId: item.summaryId })}
          />
        ))}
      </ListGroup>
    </>
  );
}

/** One summary: the ListRow layout with a meta line (origin chip, received time, occurrence date). */
function SummaryRow({ item, onOpen }: { item: SummaryListItem; onOpen(): void }): ReactElement {
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
        {/*
          M11 SLOT (M11-DESIGN.md section 3.1): "Review commitments" for this summary, with the
          open count when known ("Review commitments (5)"), goes here. Not built in M10.
        */}
      </View>
      <MaterialCommunityIcons name="chevron-right" size={componentMetrics.iconNav} color={colors.onSurfaceVariant} />
    </Pressable>
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
});
