/**
 * Meeting details (route "MeetingDetails" { meetingId } or legacy { meeting }).
 * Reads the live meeting from the data layer (deep links from notifications included) and shows
 * everything the meeting holds: time (locale-aware, 12 h / 24 h preference), duration, place,
 * video call (real join link + password), participants, description, preparation tips, alert
 * settings, notes. Every meeting can be edited and deleted:
 * - MeetingGuard meetings and Google events: edits / deletes are also sent to Google Calendar by
 *   the calendar engine (origin 'user');
 * - device-calendar imports (one-way): the change stays in MeetingGuard and the user is told the
 *   device calendar keeps its event.
 */
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { StackScreenProps } from '@react-navigation/stack';
import { useState, type ComponentProps, type ReactElement } from 'react';
import { Alert, Linking, StyleSheet, View } from 'react-native';
import { Button, Chip, Divider, HelperText, Text, useTheme as usePaperTheme } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import type { RootStackParamList } from '../../core/contracts';
import { errorMessageKey, toAppError } from '../../core/errors';
import { createLogger } from '../../core/logger';
import { getDeviceTimeZone } from '../../core/time';
import type { Meeting } from '../../core/types';
import { useT } from '../../i18n';
import { meetingRepository, useMeeting, usePreferences } from '../../services/data';
import { alertTimeLabel } from '../onboarding/alertOptions';
import { MeetingStatus } from '../shared/MeetingStatus';
import { ScreenBody, Section } from '../shared/Section';
import { useFormatters, type Formatters } from '../shared/useFormatters';

const log = createLogger('meetings');

type Props = StackScreenProps<RootStackParamList, 'MeetingDetails'>;

function isHttpUrl(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

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
  const id = route.params?.meetingId ?? route.params?.meeting?.id ?? null;
  const { meeting, isLoading } = useMeeting(id);
  if (!meeting) return <MeetingStatus loading={id !== null && isLoading} />;
  return <MeetingDetails meeting={meeting} onEdit={() => navigation.navigate('EditMeeting', { meetingId: meeting.id })} onDeleted={() => navigation.goBack()} />;
}

function MeetingDetails({ meeting, onEdit, onDeleted }: { meeting: Meeting; onEdit(): void; onDeleted(): void }): ReactElement {
  const t = useT();
  const theme = usePaperTheme();
  const fmt = useFormatters();
  const { preferences } = usePreferences();
  const [deleting, setDeleting] = useState(false);
  const when = whenText(meeting, fmt);
  const isDevice = meeting.source === 'device';
  const isGoogle = meeting.source === 'google' || meeting.external.googleEventId !== null;
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
    const message = isDevice
      ? t('meetings:details.deleteMessageDevice')
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
  const joinUrl = conference?.url ?? meeting.location?.virtualUrl ?? null;
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

      {conference || joinUrl ? (
        <Section title={t('meetings:details.videoCall')}>
          {conference ? <Text variant="bodyLarge">{t(`alerts:provider.${conference.provider}`)}</Text> : null}
          {isHttpUrl(joinUrl) ? (
            <View>
              <Text variant="bodySmall" selectable style={{ color: theme.colors.onSurfaceVariant }}>
                {joinUrl}
              </Text>
              <Button mode="contained" icon="video" style={styles.action} onPress={() => openLink(joinUrl)} testID="meeting-join">
                {t('alerts:buttons.join')}
              </Button>
            </View>
          ) : conference?.provider === 'google_meet' ? (
            <HelperText type="info" visible>
              {t('meetings:details.meetPending')}
            </HelperText>
          ) : (
            <HelperText type="info" visible>
              {t('meetings:details.noLink')}
            </HelperText>
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
