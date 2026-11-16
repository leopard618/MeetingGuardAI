/**
 * "Review commitments" beside Debrief on Meeting details (docs/v2/M11-DESIGN.md section 3.1): for
 * the newest summary filed under this meeting (commitmentsEntryModel.meetingCommitmentsEntry), with
 * its open count and facts; older summaries of a series keep their own button in
 * MeetingSummarySection. Opens SummaryCommitments { summaryId }.
 * - Hidden unless summaryStatus says enabled and allowed, and while MeetingSummarySection lists
 *   nothing filed here (the same rule as the section: meetingSummaryRows).
 * - Asks nothing itself: it reads the 'meeting' list that MeetingSummarySection, on the same
 *   screen, asks once Meeting details settled, so it never adds a call or slows the screen.
 * - Plain Text only; nothing from a summary is logged.
 */
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { useCallback, useSyncExternalStore, type ReactElement } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import type { RootStackParamList } from '../../core/contracts';
import { summariesService, useSummaryStatus } from '../../services/summaries';
import { meetingCommitmentsEntry } from './commitmentsEntryModel';
import { ReviewCommitmentsButton } from './ReviewCommitmentsButton';
import { meetingSummaryRows } from './summaryViewModel';

export interface MeetingCommitmentsButtonProps {
  /** The meeting shown on Meeting details (the master id for a series). */
  meetingId: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function MeetingCommitmentsButton({ meetingId, disabled = false, style }: MeetingCommitmentsButtonProps): ReactElement | null {
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const { available } = useSummaryStatus();
  const getSnapshot = useCallback(
    () => (available ? summariesService.getKnownList('meeting', meetingId) : null),
    [available, meetingId],
  );
  const snapshot = useSyncExternalStore(summariesService.subscribe, getSnapshot, getSnapshot);
  const entry = meetingCommitmentsEntry(meetingSummaryRows(available, snapshot?.items ?? null, null), available);
  if (entry === null) return null;
  return (
    <ReviewCommitmentsButton
      entry={entry}
      onPress={(summaryId) => navigation.navigate('SummaryCommitments', { summaryId })}
      fullWidth
      disabled={disabled}
      style={style}
      testID="meeting-review-commitments"
    />
  );
}
