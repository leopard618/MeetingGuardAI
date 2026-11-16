/**
 * "Choose a meeting" sheet (docs/v2/M10-DESIGN.md section 9), opened from an inbox card (file)
 * and from the view screen (move). Top to bottom: the title, a day stepper that opens on the
 * date written in the summary (else the local day it arrived), "Day of the summary" to jump
 * back, that day's meetings and Cancel / File here.
 *
 * - Meetings come from the data layer (useMeetings, cancelled ones marked "Cancelled") and series are
 *   expanded locally with the app's display expansion (attachMeetingModel.ts over
 *   occurrences.ts), so a weekly series shows that day's occurrence. A row is picked first and
 *   filed with "File here": summaryAction attach with the master id and, for a series, the
 *   occurrence's ORIGINAL local date.
 * - In 'move' mode the meeting it is filed under now is marked and cannot be picked.
 * - On success the sheet shows the "Filed under" / "Moved to" toast itself, then calls
 *   onAttached (the service cache already holds the new state) and onDismiss. On failure it
 *   stays open with an error toast (AppError codes only; nothing from the summary is logged).
 * Strings: summaries:attach.*. The props are the stable API the inbox and view screens use.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { IconButton, Modal, Portal, Text, useTheme as usePaperTheme } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import { Badge, ListGroup, ListRow, MGButton, SheetHandle } from '../../components/ui';
import type { MeetingRange, TranslateFn } from '../../core/contracts';
import type { SummaryActionResponse } from '../../core/aiContract';
import { errorMessageKey, toAppError } from '../../core/errors';
import { addDaysToLocalDate, getDeviceTimeZone } from '../../core/time';
import { useWindowInsets } from '../../hooks/useWindowInsets';
import { useT } from '../../i18n';
import { useMeetings } from '../../services/data';
import { summariesService } from '../../services/summaries';
import { componentMetrics, radii, spacing } from '../../theme';
import type { DisplayMeeting } from '../meetings/occurrences';
import { capitalizeFirst } from '../shared/text';
import { useFormatters, type Formatters } from '../shared/useFormatters';
import {
  attachRequestFor,
  attachRowKey,
  attachStartDay,
  isCancelledMeeting,
  isCurrentMeeting,
  meetingsOnDay,
  type AttachMeetingTarget,
} from './attachMeetingModel';
import { summaryErrorMessageKey } from './summaryText';

export type { AttachMeetingTarget } from './attachMeetingModel';

export interface AttachMeetingSheetProps {
  /** null: closed. */
  target: AttachMeetingTarget | null;
  onDismiss(): void;
  /** After a successful attach (the service cache already holds the new state). */
  onAttached?(response: SummaryActionResponse): void;
}

/**
 * Cancelled meetings are offered with a "Cancelled" badge: one may have been held anyway, and the
 * server suggests and accepts it (tombstones are left out by default).
 */
const MEETING_RANGE: MeetingRange = { includeCancelled: true };

/** The meeting list scrolls inside the sheet past this share of the window height. */
const LIST_MAX_HEIGHT_SHARE = 0.45;

export function AttachMeetingSheet({ target, onDismiss, onAttached }: AttachMeetingSheetProps): ReactElement {
  return (
    <Portal>
      {target ? (
        <AttachMeetingSheetBody key={`${target.mode}:${target.summaryId}`} target={target} onDismiss={onDismiss} onAttached={onAttached} />
      ) : null}
    </Portal>
  );
}

/** "2:00 PM - 3:00 PM" (or "All day"), plus the series hint for an occurrence. */
function meetingSupporting(t: TranslateFn, fmt: Formatters, meeting: DisplayMeeting): string {
  let time: string;
  if (meeting.allDay) {
    time = t('summaries:attach.allDay');
  } else {
    const end = new Date(Date.parse(meeting.startAt) + meeting.durationMinutes * 60_000);
    time = `${fmt.time(meeting.startAt)} - ${fmt.time(end)}`;
  }
  return meeting.occurrence !== undefined ? `${time}, ${t('summaries:attach.occurrence')}` : time;
}

function AttachMeetingSheetBody({
  target,
  onDismiss,
  onAttached,
}: {
  target: AttachMeetingTarget;
  onDismiss(): void;
  onAttached?(response: SummaryActionResponse): void;
}): ReactElement {
  const t = useT();
  const theme = usePaperTheme();
  const fmt = useFormatters();
  const insets = useWindowInsets();
  const { height } = useWindowDimensions();
  const timeZone = getDeviceTimeZone();
  // Fixed per opening (the sheet is keyed by its target).
  const [startDay] = useState(() => attachStartDay(target, timeZone, new Date()));
  const [dayKey, setDayKey] = useState(startDay);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const { meetings, isLoading, error } = useMeetings(MEETING_RANGE);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const dayMeetings = useMemo(() => meetingsOnDay(meetings, dayKey, timeZone), [meetings, dayKey, timeZone]);
  const selected = dayMeetings.find((meeting) => attachRowKey(meeting) === selectedKey) ?? null;

  const goToDay = (next: string): void => {
    setDayKey(next);
    setSelectedKey(null);
  };

  const file = async (): Promise<void> => {
    if (selected === null || busy) return;
    setBusy(true);
    try {
      const response = await summariesService.attach(attachRequestFor(target.summaryId, selected));
      Toast.show({
        type: 'success',
        text1:
          target.mode === 'move'
            ? t('summaries:attach.moved', { title: selected.title })
            : t('summaries:attach.filed', { title: selected.title }),
      });
      onAttached?.(response);
      onDismiss();
    } catch (caught: unknown) {
      Toast.show({ type: 'error', text1: t(summaryErrorMessageKey(toAppError(caught))) });
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  let content: ReactElement;
  if (dayMeetings.length === 0) {
    const note = isLoading
      ? { text: t('summaries:attach.loading'), testID: 'attach-loading' }
      : error !== null
        ? { text: t(errorMessageKey(error.code)), testID: 'attach-error' }
        : { text: t('summaries:attach.noMeetings'), testID: 'attach-no-meetings' };
    content = (
      <Text variant="bodyMedium" style={[styles.note, { color: theme.colors.onSurfaceVariant }]} testID={note.testID}>
        {note.text}
      </Text>
    );
  } else {
    content = (
      <ListGroup>
        {dayMeetings.map((meeting) => {
          const key = attachRowKey(meeting);
          const current = isCurrentMeeting(target, meeting);
          const cancelled = isCancelledMeeting(meeting);
          const isSelected = key === selectedKey;
          return (
            <ListRow
              key={key}
              icon={meeting.occurrence !== undefined ? 'repeat' : 'calendar-blank-outline'}
              title={meeting.title}
              supporting={meetingSupporting(t, fmt, meeting)}
              selected={isSelected}
              disabled={busy || current}
              trailing={
                current ? (
                  <Badge label={t('summaries:attach.current')} tone="primary" />
                ) : cancelled || isSelected ? (
                  <View style={styles.trailing}>
                    {cancelled ? <Badge label={t('summaries:attach.cancelled')} tone="warning" testID={`attach-meeting-${key}-cancelled`} /> : null}
                    {isSelected ? (
                      <MaterialCommunityIcons name="check-circle" size={componentMetrics.iconNav} color={theme.colors.primary} />
                    ) : null}
                  </View>
                ) : null
              }
              onPress={() => setSelectedKey(key)}
              accessibilityRole="radio"
              accessibilityState={{ checked: isSelected, disabled: busy || current }}
              testID={`attach-meeting-${key}`}
            />
          );
        })}
      </ListGroup>
    );
  }

  return (
    <Modal
      visible
      onDismiss={busy ? undefined : onDismiss}
      style={styles.modal}
      contentContainerStyle={[styles.sheet, { backgroundColor: theme.colors.elevation.level3, paddingBottom: insets.bottom + spacing.lg }]}
    >
      <View testID="attach-meeting-sheet">
        <SheetHandle />
        <Text variant="titleMedium" accessibilityRole="header" style={styles.heading}>
          {target.mode === 'move' ? t('summaries:attach.moveTitle') : t('summaries:attach.title')}
        </Text>
        <View style={styles.stepper}>
          <IconButton
            icon="chevron-left"
            onPress={() => goToDay(addDaysToLocalDate(dayKey, -1))}
            disabled={busy}
            accessibilityLabel={t('summaries:attach.previousDay')}
            hitSlop={4}
            testID="attach-previous-day"
          />
          <Text variant="titleSmall" style={styles.day} accessibilityLiveRegion="polite" testID="attach-day">
            {capitalizeFirst(fmt.date(dayKey, 'full'))}
          </Text>
          <IconButton
            icon="chevron-right"
            onPress={() => goToDay(addDaysToLocalDate(dayKey, 1))}
            disabled={busy}
            accessibilityLabel={t('summaries:attach.nextDay')}
            hitSlop={4}
            testID="attach-next-day"
          />
        </View>
        {dayKey !== startDay ? (
          <MGButton variant="ghost" size="sm" onPress={() => goToDay(startDay)} disabled={busy} style={styles.summaryDay} testID="attach-summary-day">
            {t('summaries:attach.summaryDay')}
          </MGButton>
        ) : null}
        <ScrollView style={{ maxHeight: Math.round(height * LIST_MAX_HEIGHT_SHARE) }} keyboardShouldPersistTaps="handled" testID="attach-meetings">
          {content}
        </ScrollView>
        <View style={styles.footer}>
          <MGButton variant="ghost" onPress={onDismiss} disabled={busy} testID="attach-cancel">
            {t('summaries:attach.cancel')}
          </MGButton>
          <MGButton onPress={() => void file()} loading={busy} disabled={busy || selected === null} testID="attach-file">
            {t('summaries:attach.file')}
          </MGButton>
        </View>
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
  heading: {
    marginTop: spacing.xs,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  day: {
    flex: 1,
    textAlign: 'center',
  },
  summaryDay: {
    alignSelf: 'center',
    marginBottom: spacing.xs,
  },
  note: {
    paddingVertical: spacing.lg,
    textAlign: 'center',
  },
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    marginTop: spacing.md,
    gap: spacing.sm,
  },
});
