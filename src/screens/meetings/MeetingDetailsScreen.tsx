/**
 * Meeting details (route "MeetingDetails" { meetingId }).
 * Reads the live meeting from the data layer (deep links from notifications included) and shows
 * everything the meeting holds: time (locale-aware, 12 h / 24 h preference), duration, place,
 * video call (real join link + password; without a link the card explains what happens next per
 * provider and calendar connection - conferenceCardState, §22), participants, description,
 * preparation tips, alert settings, notes. Every meeting can be edited and deleted:
 * - MeetingGuard meetings and Google events: edits / deletes are also sent to Google Calendar by
 *   the calendar engine (origin 'user');
 * - device-calendar imports (one-way): the change stays in MeetingGuard and the user is told the
 *   device calendar keeps its event.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { StackScreenProps } from '@react-navigation/stack';
import { useMemo, useState, type ComponentProps, type ReactElement } from 'react';
import { Alert, Linking, StyleSheet, View } from 'react-native';
import { Button, Chip, Divider, HelperText, Text, useTheme as usePaperTheme } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import type { RootStackParamList } from '../../core/contracts';
import { errorMessageKey, toAppError } from '../../core/errors';
import { createLogger } from '../../core/logger';
import { expandOccurrences, type MeetingOccurrence } from '../../core/recurrence';
import { getDeviceTimeZone } from '../../core/time';
import type { Meeting } from '../../core/types';
import { useT } from '../../i18n';
import { recurrenceSummary } from '../../services/ai/recurrenceText';
import { useCalendarStatus } from '../../services/calendar';
import { meetingRepository, useMeeting, usePreferences } from '../../services/data';
import { MeetingAttachmentsSection } from '../attachments/MeetingAttachmentsSection';
import { alertTimeLabel } from '../onboarding/alertOptions';
import { MeetingStatus } from '../shared/MeetingStatus';
import { ScreenBody, Section } from '../shared/Section';
import { capitalizeFirst } from '../shared/text';
import { useFormatters, type Formatters } from '../shared/useFormatters';
import { conferenceCardState } from './meetingForm';

const log = createLogger('meetings');

type Props = StackScreenProps<RootStackParamList, 'MeetingDetails'>;

/** How far ahead the "next occurrences" list looks, and how many entries it shows. */
const NEXT_OCCURRENCES_WINDOW_MS = 370 * 24 * 60 * 60 * 1000;
const NEXT_OCCURRENCES_SHOWN = 3;

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

function Row({ icon, label, children }: { icon: IconName; label: string; children: ReactElement | string }): ReactElement {
  const theme = usePaperTheme();
  return (
    <View style={styles.row}>
      <MaterialCommunityIcons name={icon} size={22} color={theme.colors.onSurfaceVariant} style={styles.rowIcon} />
      <View style={styles.flex}>
        <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
          {label}
        </Text>
        {typeof children === 'string' ? <Text variant="bodyLarge">{children}</Text> : children}
      </View>
    </View>
  );
}

function whenText(meeting: Meeting, fmt: Formatters): { local: string; meetingZone: string | null } {
  const device = getDeviceTimeZone();
  const local = fmt.meetingRange(meeting, device);
  const meetingZone =
    !meeting.allDay && meeting.timezone !== device ? `${fmt.meetingRange(meeting, meeting.timezone)} (${meeting.timezone})` : null;
  return { local, meetingZone };
}

export function MeetingDetailsScreen({ navigation, route }: Props): ReactElement {
  const id = route.params?.meetingId ?? null;
  const { meeting, isLoading } = useMeeting(id);
  if (!meeting) return <MeetingStatus loading={id !== null && isLoading} />;
  return (
    <MeetingDetails
      meeting={meeting}
      onEdit={() => navigation.navigate('EditMeeting', { meetingId: meeting.id })}
      onDeleted={() => navigation.goBack()}
      onOpenCalendarSync={() => navigation.navigate('CalendarSync')}
    />
  );
}

function MeetingDetails({
  meeting,
  onEdit,
  onDeleted,
  onOpenCalendarSync,
}: {
  meeting: Meeting;
  onEdit(): void;
  onDeleted(): void;
  onOpenCalendarSync(): void;
}): ReactElement {
  const t = useT();
  const theme = usePaperTheme();
  const fmt = useFormatters();
  const { preferences } = usePreferences();
  const calendar = useCalendarStatus();
  const [deleting, setDeleting] = useState(false);
  const when = whenText(meeting, fmt);
  const isDevice = meeting.source === 'device';
  const isGoogle = meeting.source === 'google' || meeting.external.googleEventId !== null;
  const isRecurring = meeting.recurrence !== null;
  // The next few occurrences of a series (details show the master; §16 expands on demand).
  const nextOccurrences = useMemo<MeetingOccurrence[]>(() => {
    if (meeting.recurrence === null) return [];
    try {
      const from = new Date();
      const to = new Date(from.getTime() + NEXT_OCCURRENCES_WINDOW_MS);
      return expandOccurrences(meeting, from.toISOString(), to.toISOString(), { max: NEXT_OCCURRENCES_SHOWN });
    } catch (caught) {
      log.warn('could not expand the meeting occurrences', toAppError(caught).code);
      return [];
    }
  }, [meeting]);
  const alertTimes = meeting.customAlertTimes ?? preferences.defaultAlertTimes;
  const alertTimesText = alertTimes
    .map((minutes) => {
      const label = alertTimeLabel(minutes);
      return t(label.key, label.options);
    })
    .join(', ');

  const remove = async (): Promise<void> => {
    setDeleting(true);
    try {
      await meetingRepository.remove(meeting.id, { origin: 'user' });
      Toast.show({
        type: 'success',
        text1: t('meetings:details.deleted'),
        text2: isDevice ? t('meetings:details.deletedDeviceNote') : undefined,
      });
      onDeleted();
    } catch (caught) {
      const error = toAppError(caught);
      log.warn('could not delete a meeting', error.code);
      Toast.show({ type: 'error', text1: t(errorMessageKey(error.code)) });
      setDeleting(false);
    }
  };

  const confirmDelete = (): void => {
    // From the details of a recurring meeting the whole SERIES is deleted (occurrence-scoped
    // deletes live on the list / calendar rows, where one occurrence is in hand).
    const message = isDevice
      ? t('meetings:details.deleteMessageDevice')
      : isRecurring
        ? isGoogle
          ? t('meetings:details.deleteMessageSeriesGoogle')
          : t('meetings:details.deleteMessageSeries')
        : isGoogle
          ? t('meetings:details.deleteMessageGoogle')
          : t('meetings:details.deleteMessage');
    Alert.alert(t('meetings:details.deleteTitle', { title: meeting.title }), message, [
      { text: t('common:actions.cancel'), style: 'cancel' },
      { text: t('meetings:details.delete'), style: 'destructive', onPress: () => void remove() },
    ]);
  };

  const openLink = (url: string): void => {
    Linking.openURL(url).catch((caught: unknown) => {
      log.warn('could not open the meeting link', toAppError(caught).code);
      Toast.show({ type: 'error', text1: t('alerts:errors.openLinkFailed') });
    });
  };

  const conference = meeting.conference;
  // §22: a real link (pasted or provider-created, incl. an imported virtualUrl) always wins;
  // otherwise the card explains the empty url from the provider + the LIVE calendar status.
  const card = conferenceCardState(meeting, calendar);
  const tips = meeting.preparationTips;

  return (
    <ScreenBody>
      <View style={styles.header}>
        <Text variant="headlineSmall" accessibilityRole="header" testID="meeting-title">
          {meeting.title}
        </Text>
        <View style={styles.chips}>
          <Chip compact style={styles.chip} icon="source-branch">
            {t(`meetings:source.${meeting.source}`)}
          </Chip>
          {isRecurring ? (
            <Chip compact style={styles.chip} icon="repeat" testID="meeting-repeats-chip">
              {t('meetings:details.repeats')}
            </Chip>
          ) : null}
          {meeting.status === 'cancelled' ? (
            <Chip compact style={styles.chip} icon="cancel">
              {t('meetings:details.cancelled')}
            </Chip>
          ) : null}
          {meeting.confidence !== null && meeting.source === 'ai_chat' ? (
            <Chip compact style={styles.chip} icon="robot-outline">
              {t('meetings:details.confidence', { value: meeting.confidence })}
            </Chip>
          ) : null}
        </View>
      </View>

      <Section>
        <Row icon="clock-outline" label={t('meetings:details.when')}>
          <View>
            <Text variant="bodyLarge" testID="meeting-when">
              {when.local}
            </Text>
            {when.meetingZone ? (
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                {t('meetings:details.meetingZone', { when: when.meetingZone })}
              </Text>
            ) : null}
          </View>
        </Row>
        {!meeting.allDay ? (
          <Row icon="timer-outline" label={t('meetings:details.duration')}>
            {fmt.duration(meeting.durationMinutes)}
          </Row>
        ) : null}
        {meeting.location?.address ? (
          <Row icon="map-marker-outline" label={t('meetings:details.location')}>
            {meeting.location.address}
          </Row>
        ) : null}
      </Section>

      {meeting.recurrence !== null ? (
        <Section>
          <Row icon="repeat" label={t('meetings:details.repeats')}>
            <Text variant="bodyLarge" testID="meeting-repeats-summary">
              {recurrenceSummary(t, meeting.recurrence, {
                formatDate: (localDate) => fmt.date(localDate, 'long'),
                anchorDate: meeting.date,
                timezone: meeting.timezone,
              })}
            </Text>
          </Row>
          <Row icon="calendar-arrow-right" label={t('meetings:details.repeatsNext')}>
            <View>
              {nextOccurrences.length === 0 ? (
                <Text variant="bodyMedium" testID="meeting-repeats-none">
                  {t('meetings:details.repeatsNone')}
                </Text>
              ) : (
                nextOccurrences.map((occurrence) => (
                  <Text key={occurrence.occurrenceId} variant="bodyMedium" style={styles.listItem} testID={`meeting-occurrence-${occurrence.localDateKey}`}>
                    {capitalizeFirst(meeting.allDay ? fmt.date(occurrence.localDateKey, 'full') : fmt.dateTime(occurrence.startAt))}
                    {occurrence.overridden ? ` · ${t('meetings:details.occurrenceModified')}` : ''}
                  </Text>
                ))
              )}
            </View>
          </Row>
        </Section>
      ) : null}

      {card.kind !== 'hidden' ? (
        <Section title={t('meetings:details.videoCall')}>
          {conference ? <Text variant="bodyLarge">{t(`alerts:provider.${conference.provider}`)}</Text> : null}
          {card.kind === 'join' ? (
            <View>
              <Text variant="bodySmall" selectable style={{ color: theme.colors.onSurfaceVariant }}>
                {card.url}
              </Text>
              <Button mode="contained" icon="video" style={styles.action} onPress={() => openLink(card.url)} testID="meeting-join">
                {t('alerts:buttons.join')}
              </Button>
            </View>
          ) : (
            <View>
              <HelperText type="info" visible testID={`meeting-conference-${card.key}`}>
                {t(`meetings:details.${card.key}`)}
              </HelperText>
              {card.connect !== null ? (
                <Button
                  mode="outlined"
                  icon="calendar-sync-outline"
                  style={styles.action}
                  onPress={onOpenCalendarSync}
                  testID={card.connect === 'google' ? 'meeting-connect-calendar' : 'meeting-connect-outlook'}
                >
                  {card.connect === 'google' ? t('meetings:details.connectCalendar') : t('calendar:outlook.connect')}
                </Button>
              ) : null}
            </View>
          )}
          {conference?.password ? (
            <Text variant="bodyMedium" selectable style={styles.action}>
              {t('meetings:details.password', { password: conference.password })}
            </Text>
          ) : null}
        </Section>
      ) : null}

      {meeting.participants.length > 0 ? (
        <Section title={t('meetings:details.participants', { count: meeting.participants.length })}>
          {meeting.participants.map((participant) => (
            <Text key={participant.email} variant="bodyMedium" selectable style={styles.listItem}>
              {participant.name ? `${participant.name} <${participant.email}>` : participant.email}
            </Text>
          ))}
        </Section>
      ) : null}

      {meeting.description ? (
        <Section title={t('meetings:details.description')}>
          <Text variant="bodyMedium" selectable>
            {meeting.description}
          </Text>
        </Section>
      ) : null}

      {tips.length > 0 ? (
        <Section title={t('meetings:details.tips')}>
          {tips.map((tip, index) => (
            <Text key={`${index}-${tip}`} variant="bodyMedium" style={styles.listItem}>
              {`• ${tip}`}
            </Text>
          ))}
        </Section>
      ) : null}

      <Section title={t('meetings:details.alerts')}>
        <Text variant="bodyMedium" testID="meeting-alert-times">
          {meeting.customAlertTimes
            ? t('meetings:details.alertTimesCustom', { times: alertTimesText })
            : t('meetings:details.alertTimesDefault', { times: alertTimesText })}
        </Text>
        <Text variant="bodyMedium" style={styles.listItem}>
          {t('meetings:details.intensity', {
            intensity: t(`onboarding:alerts.intensity.${meeting.alertIntensity ?? preferences.alertIntensity}.title`),
          })}
          {meeting.alertIntensity === null ? ` ${t('meetings:details.intensityDefault')}` : ''}
        </Text>
        {!preferences.alertEnabled ? (
          <HelperText type="info" visible>
            {t('meetings:details.alertsOff')}
          </HelperText>
        ) : null}
      </Section>

      {meeting.notes ? (
        <Section title={t('meetings:details.notes')}>
          <Text variant="bodyMedium" selectable>
            {meeting.notes}
          </Text>
        </Section>
      ) : null}

      <MeetingAttachmentsSection meetingId={meeting.id} />

      <Divider style={styles.divider} />
      {isDevice ? (
        <HelperText type="info" visible>
          {t('meetings:details.deviceNote')}
        </HelperText>
      ) : null}
      <View style={styles.actions}>
        <Button mode="contained-tonal" icon="pencil" onPress={onEdit} style={styles.actionButton} disabled={deleting} testID="meeting-edit">
          {t('meetings:details.edit')}
        </Button>
        <Button
          mode="outlined"
          icon="delete"
          onPress={confirmDelete}
          textColor={theme.colors.error}
          style={styles.actionButton}
          loading={deleting}
          disabled={deleting}
          testID="meeting-delete"
        >
          {t('meetings:details.delete')}
        </Button>
      </View>
    </ScreenBody>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  header: {
    marginBottom: 12,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  chip: {
    marginRight: 8,
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  rowIcon: {
    marginRight: 12,
    marginTop: 2,
  },
  listItem: {
    marginTop: 4,
  },
  action: {
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  divider: {
    marginVertical: 8,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
    marginBottom: 16,
  },
  actionButton: {
    marginRight: 12,
    marginBottom: 8,
  },
});
