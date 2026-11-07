/**
 * Manual meeting form: create (route "CreateMeeting" { date? }) and edit (route "EditMeeting"
 * { meetingId }). The brief's "traditional detailed input".
 *
 * - Title, description, date / time (wall clock in the meeting's zone), all-day, duration.
 * - Place and video call. Links are ONLY what the user pastes (nothing is generated): Google Meet
 *   without a link is saved as provider google_meet + url null and the Google Calendar push then
 *   creates a REAL Meet link; Teams without a link gets one from the Outlook push (when Outlook
 *   is configured + connected, §22); Zoom without a link is created by the zoomCreateMeeting
 *   callable after Save when the server integration is configured (§24, fire-and-forget).
 *   The helper under the provider chips is DERIVED from conferenceCapability with the LIVE
 *   calendar status (+ the session's zoomStatus answer), so it follows every chip change.
 * - Participants (Google Calendar sends the invitations when the meeting syncs), preparation
 *   tips, reminders (the defaults or custom minutes-before offsets) and an intensity override,
 *   notes, device-local attachments.
 * - Saved through meetingRepository with origin 'user' (the calendar engine pushes the change to
 *   Google; device-calendar imports stay one-way).
 */
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import type { StackScreenProps } from '@react-navigation/stack';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Chip, HelperText, IconButton, Switch, Text, TextInput } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import { ListGroup, ListRow, MGButton } from '../../components/ui';
import { radii, spacing, useAppTheme } from '../../theme';

import { RECURRENCE_WEEKDAYS } from '../../core/aiContract';
import type { ConferenceCalendarState } from '../../core/conference';
import type { RootStackParamList } from '../../core/contracts';
import { errorMessageKey, toAppError } from '../../core/errors';
import { createLogger } from '../../core/logger';
import { getDeviceTimeZone } from '../../core/time';
import { effectiveAlertIntensity, type Meeting, type MeetingPatch } from '../../core/types';
import { useT } from '../../i18n';
import { recurrenceSummary } from '../../services/ai/recurrenceText';
import { attachmentService } from '../../services/attachments';
import { useAuth } from '../../services/auth';
import { useCalendarStatus } from '../../services/calendar';
import { meetingRepository, useMeeting, usePreferences } from '../../services/data';
import { useZoomStatus, zoomService } from '../../services/zoom';
import { addErrorMessage, showAddResult } from '../attachments/attachmentMessages';
import { alertTimeChoices, alertTimeLabel, toggleAlertTime } from '../onboarding/alertOptions';
import { MeetingStatus } from '../shared/MeetingStatus';
import { ScreenBody, Section } from '../shared/Section';
import { needsEmailVerification } from '../shared/VerifyEmailBanner';
import { capitalizeFirst } from '../shared/text';
import { useDiscardChangesGuard } from '../shared/useDiscardChangesGuard';
import { useFormatters } from '../shared/useFormatters';
import {
  CONFERENCE_CHOICES,
  DURATION_OPTIONS,
  INTENSITY_CHOICES,
  LOCATION_CHOICES,
  REPEAT_CHOICES,
  REPEAT_END_CHOICES,
  conferenceConnectTarget,
  conferenceFormHint,
  conferenceFormNote,
  conferenceLinkLabel,
  dateFromPicker,
  defaultRepeatWeekdays,
  draftFromMeeting,
  draftToCreateInput,
  draftToPatch,
  invitesHintKey,
  isMeetingDraftDirty,
  monthlyRepeatDay,
  newMeetingDraft,
  pickerDateOf,
  recurrenceRuleOf,
  showConferencePassword,
  timeFromPicker,
  toggleRepeatWeekday,
  validateMeetingDraft,
  type MeetingFormDraft,
  type ParticipantDraft,
  type RepeatChoice,
  type RepeatEndChoice,
} from './meetingForm';

const log = createLogger('meetings');

type Props = StackScreenProps<RootStackParamList, 'CreateMeeting' | 'EditMeeting'>;

/** Device-local attachments (src/services/attachments). */
interface AttachmentView {
  id: string;
  name: string;
  meetingId: string | null;
}

export function MeetingFormScreen({ navigation, route }: Props): ReactElement {
  const params = (route.params ?? {}) as { meetingId?: string; date?: string };
  const editId = params.meetingId ?? null;
  // "New meeting on <day>" (Calendar screen): the day of a new meeting, validated by the model.
  const initialDate = editId === null ? params.date : undefined;
  const { meeting, isLoading } = useMeeting(editId);
  if (editId !== null && !meeting) return <MeetingStatus loading={isLoading} />;
  return (
    <MeetingForm
      key={meeting?.id ?? `new-${initialDate ?? ''}`}
      meeting={meeting}
      initialDate={initialDate}
      onSaved={(saved, created) => {
        if (created) navigation.replace('MeetingDetails', { meetingId: saved.id });
        else navigation.goBack();
      }}
      onOpenCalendarSync={() => navigation.navigate('CalendarSync')}
    />
  );
}

function MeetingForm({
  meeting,
  initialDate,
  onSaved,
  onOpenCalendarSync,
}: {
  meeting: Meeting | null;
  initialDate?: string;
  onSaved(meeting: Meeting, created: boolean): void;
  onOpenCalendarSync(): void;
}): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const fmt = useFormatters();
  const { preferences } = usePreferences();
  const calendar = useCalendarStatus();
  const deviceZone = getDeviceTimeZone();
  const [original] = useState<MeetingFormDraft>(() =>
    meeting
      ? draftFromMeeting(meeting, { fallbackTimeZone: deviceZone, defaultAlertTimes: preferences.defaultAlertTimes })
      : newMeetingDraft({ now: new Date(), timeZone: deviceZone, defaultAlertTimes: preferences.defaultAlertTimes, date: initialDate }),
  );
  const [draft, setDraft] = useState<MeetingFormDraft>(original);
  const [picker, setPicker] = useState<'date' | 'time' | 'until' | null>(null);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  // Attachments: the meeting's saved files, files picked in this form (not linked to any meeting
  // until Save) and saved files the user removed (deleted from the device only on Save).
  const [savedAttachments, setSavedAttachments] = useState<AttachmentView[]>([]);
  const [addedAttachments, setAddedAttachments] = useState<AttachmentView[]>([]);
  const [removedIds, setRemovedIds] = useState<readonly string[]>([]);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const errors = useMemo(() => validateMeetingDraft(draft), [draft]);
  const valid = Object.keys(errors).length === 0;
  const change = (patch: Partial<MeetingFormDraft>): void => setDraft((current) => ({ ...current, ...patch }));
  const googleConnected = calendar.google.enabled && calendar.google.hasScope;
  // §24: what the app knows about the server-side Zoom integration this session (null = not
  // answered yet; zoom then behaves as plain paste and the capability state leaves `zoom` absent).
  const zoomStatus = useZoomStatus();
  // §24/§25: the zoom WRITE callables require a verified account (like the assistant), so an
  // unverified email user must never be promised a link the server will always refuse - zoom
  // stays plain paste for them (`zoom` absent) and Save never fires ensureLink.
  const { authUser } = useAuth();
  const zoomAllowed = !needsEmailVerification(authUser);
  const conferenceCalendar: ConferenceCalendarState = useMemo(
    () =>
      zoomStatus.configured === null || !zoomAllowed ? calendar : { ...calendar, zoom: { configured: zoomStatus.configured } },
    [calendar, zoomStatus.configured, zoomAllowed],
  );
  // §22: the video-call helper follows the chip selection AND the live calendar connections
  // (plus the edited meeting's source / repeat choice / external refs: an auto mode the sync
  // can never reach - imported meeting, Teams + recurrence, or a meeting already pushed to
  // Outlook - degrades to the paste hint instead of promising a link the sync never creates).
  const conferenceHint = conferenceFormHint(draft, conferenceCalendar, meeting?.source, meeting?.external);
  // Muted "why" under the paste hint when the server SAID Zoom is not set up (§24).
  const conferenceNote = conferenceFormNote(draft, conferenceCalendar);
  const connectTarget = conferenceConnectTarget(conferenceHint);
  const meetingId = meeting?.id ?? null;
  const dirty = isMeetingDraftDirty(draft, original) || addedAttachments.length > 0 || removedIds.length > 0;
  const attachments = [...savedAttachments.filter((item) => !removedIds.includes(item.id)), ...addedAttachments];

  const guard = useDiscardChangesGuard(dirty, {
    busy: saving,
    // Files picked here were never linked to a meeting: delete the copies now (the clean-up of
    // unlinked files would otherwise remove them after 24 hours).
    onDiscard: () => {
      for (const item of addedAttachments) {
        attachmentService
          .remove(item.id)
          .catch((caught: unknown) => log.warn('could not delete a discarded attachment', toAppError(caught).code));
      }
    },
  });

  // Keyed on the id: live updates of the meeting (a Google write-back, a sync, another device)
  // must not re-read the list, and the files picked in this form are kept apart anyway.
  useEffect(() => {
    if (meetingId === null) return;
    let active = true;
    attachmentService
      .listForMeeting(meetingId)
      .then((files: AttachmentView[]) => {
        if (active) setSavedAttachments(files);
      })
      .catch((caught: unknown) => log.warn('could not read the attachments', toAppError(caught).code));
    return () => {
      active = false;
    };
  }, [meetingId]);

  const errorText = (field: keyof typeof errors): string | null =>
    submitted && errors[field] ? t(`meetings:form.errors.${errors[field]}`) : null;

  const onPicked = (event: DateTimePickerEvent, value?: Date): void => {
    const mode = picker;
    setPicker(Platform.OS === 'ios' ? mode : null);
    if (event.type !== 'set' || !value || mode === null) return;
    if (mode === 'date') change({ date: dateFromPicker(value) });
    else if (mode === 'until') change({ repeatUntilDate: dateFromPicker(value) });
    else change({ time: timeFromPicker(value) });
  };

  const setRepeat = (choice: RepeatChoice): void => {
    // Switching to weekly preselects the meeting's own weekday (deselectable afterwards).
    if (choice === 'weekly' && draft.repeatWeekdays.length === 0) {
      change({ repeat: choice, repeatWeekdays: defaultRepeatWeekdays(draft) });
    } else {
      change({ repeat: choice });
    }
  };

  const addAttachments = async (kind: 'document' | 'image'): Promise<void> => {
    setAttachmentBusy(true);
    try {
      const result = await attachmentService.add(kind, { multiple: true });
      if (result.cancelled) return;
      setAddedAttachments((current) => [...current, ...result.added]);
      showAddResult(result, t);
    } catch (caught) {
      const error = toAppError(caught);
      if (error.code === 'cancelled') return;
      log.warn('could not add an attachment', error.code);
      Toast.show({ type: 'error', text1: addErrorMessage(error, kind, t) });
    } finally {
      setAttachmentBusy(false);
    }
  };

  const removeAttachment = async (id: string): Promise<void> => {
    if (!addedAttachments.some((item) => item.id === id)) {
      // A saved file: deleted from the device only when the change is saved.
      setRemovedIds((current) => (current.includes(id) ? current : [...current, id]));
      return;
    }
    // A file picked in this form (an unlinked copy; the original stays where it was picked from).
    try {
      await attachmentService.remove(id);
      setAddedAttachments((current) => current.filter((item) => item.id !== id));
    } catch (caught) {
      const error = toAppError(caught);
      log.warn('could not remove an attachment', error.code);
      Toast.show({ type: 'error', text1: t(errorMessageKey(error.code)) });
    }
  };

  const save = async (): Promise<void> => {
    setSubmitted(true);
    if (!valid) {
      Toast.show({ type: 'error', text1: t('meetings:form.fixErrors') });
      return;
    }
    setSaving(true);
    try {
      let saved: Meeting;
      let appliedPatch: MeetingPatch | null = null;
      if (meeting) {
        const patch = draftToPatch(meeting, draft, original);
        if (Object.keys(patch).length > 0) {
          saved = await meetingRepository.update(meeting.id, patch, { origin: 'user' });
          appliedPatch = patch;
        } else {
          saved = meeting;
        }
      } else {
        saved = await meetingRepository.create(draftToCreateInput(draft), { origin: 'user' });
      }
      // §24: a Zoom meeting saved without a pasted link gets a real one from the server
      // (fire-and-forget; the details card shows the pending/failed state via linkFailure),
      // and edits that touch what Zoom displays are synced to the existing Zoom meeting
      // (syncIfNeeded checks the patch and the external ref itself; it never throws).
      if (saved.conference?.provider === 'zoom') {
        if (saved.conference.url === null && zoomStatus.configured === true && zoomAllowed) {
          zoomService.ensureLink(saved.id).catch(() => undefined);
        }
        if (appliedPatch !== null) void zoomService.syncIfNeeded(saved, appliedPatch);
      }
      // Device-local attachments picked in this form belong to the meeting now.
      for (const attachment of addedAttachments) {
        try {
          await attachmentService.linkToMeeting(attachment.id, saved.id);
        } catch (caught) {
          log.warn('could not link an attachment', toAppError(caught).code);
          Toast.show({ type: 'error', text1: t('meetings:form.attachmentLinkFailed') });
        }
      }
      // Saved files the user removed in this form.
      for (const id of removedIds) {
        try {
          await attachmentService.remove(id);
        } catch (caught) {
          log.warn('could not remove an attachment', toAppError(caught).code);
          Toast.show({ type: 'error', text1: t('meetings:form.attachmentRemoveFailed') });
        }
      }
      Toast.show({ type: 'success', text1: t(meeting ? 'meetings:form.updated' : 'meetings:form.created') });
      guard.allowLeave();
      onSaved(saved, meeting === null);
    } catch (caught) {
      const error = toAppError(caught);
      log.warn('could not save a meeting', error.code);
      Toast.show({ type: 'error', text1: t(errorMessageKey(error.code)) });
      setSaving(false);
    }
  };

  const setParticipant = (index: number, patch: Partial<ParticipantDraft>): void =>
    change({ participants: draft.participants.map((row, i) => (i === index ? { ...row, ...patch } : row)) });

  const pickerValue = pickerDateOf(draft);
  const dayLabel = capitalizeFirst(fmt.date(draft.date, 'full'));
  const durationChoices = [...new Set([...DURATION_OPTIONS, draft.durationMinutes])].sort((a, b) => a - b);

  return (
    <ScreenBody
      primaryLabel={t(meeting ? 'meetings:form.saveChanges' : 'meetings:form.create')}
      onPrimary={() => {
        void save();
      }}
      primaryLoading={saving}
      primaryTestID="meeting-form-save"
    >
      {meeting?.source === 'device' ? (
        <HelperText type="info" visible>
          {t('meetings:form.deviceNote')}
        </HelperText>
      ) : null}
      {meeting?.source === 'google' ? (
        <HelperText type="info" visible>
          {t('meetings:form.googleNote')}
        </HelperText>
      ) : null}

      <Section>
        <TextInput
          mode="outlined"
          outlineStyle={styles.inputOutline}
          label={t('meetings:form.title')}
          value={draft.title}
          onChangeText={(value) => change({ title: value })}
          error={errorText('title') !== null}
          maxLength={200}
          testID="meeting-form-title"
        />
        {errorText('title') ? <HelperText type="error">{errorText('title')}</HelperText> : null}
        <TextInput
          mode="outlined"
          outlineStyle={styles.inputOutline}
          label={t('meetings:form.description')}
          value={draft.description}
          onChangeText={(value) => change({ description: value })}
          multiline
          style={styles.field}
          maxLength={4000}
        />
      </Section>

      <Section title={t('meetings:form.when')}>
        <ListGroup testID="meeting-form-when">
          <ListRow
            icon="calendar"
            title={t('meetings:form.pickDate')}
            supporting={dayLabel}
            trailing="chevron"
            onPress={() => setPicker('date')}
          />
          {!draft.allDay ? (
            <ListRow
              icon="clock-outline"
              title={t('meetings:form.pickTime')}
              supporting={fmt.time(pickerValue)}
              trailing="chevron"
              onPress={() => setPicker('time')}
            />
          ) : null}
        </ListGroup>
        {draft.timezone !== deviceZone ? (
          <Text variant="bodySmall" style={[styles.zoneNote, { color: colors.onSurfaceVariant }]}>
            {t('meetings:form.timeZone', { zone: draft.timezone })}
          </Text>
        ) : null}
        {picker === 'date' || picker === 'time' ? (
          <View>
            <DateTimePicker
              value={pickerValue}
              mode={picker}
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={onPicked}
              is24Hour={fmt.options.use24Hour ?? undefined}
            />
            {Platform.OS === 'ios' ? (
              <MGButton variant="ghost" size="sm" style={styles.alignStart} onPress={() => setPicker(null)}>
                {t('common:actions.done')}
              </MGButton>
            ) : null}
          </View>
        ) : null}
        {errorText('date') ? <HelperText type="error">{errorText('date')}</HelperText> : null}
        <View style={styles.switchRow}>
          <Text variant="titleSmall" style={styles.flex}>
            {t('meetings:form.allDay')}
          </Text>
          <Switch
            value={draft.allDay}
            onValueChange={(value) => change({ allDay: value, durationMinutes: value ? 1440 : 60 })}
            accessibilityLabel={t('meetings:form.allDay')}
            testID="meeting-form-all-day"
          />
        </View>
        {!draft.allDay ? (
          <>
            <Text variant="titleSmall" style={styles.subheading}>
              {t('meetings:form.duration')}
            </Text>
            <View style={styles.chips}>
              {durationChoices.map((minutes) => (
                <Chip
                  key={minutes}
                  selected={draft.durationMinutes === minutes}
                  mode={draft.durationMinutes === minutes ? 'flat' : 'outlined'}
                  style={styles.chip}
                  onPress={() => change({ durationMinutes: minutes })}
                >
                  {fmt.duration(minutes)}
                </Chip>
              ))}
            </View>
          </>
        ) : null}
      </Section>

      <Section title={t('meetings:form.repeat.title')}>
        <View style={styles.chips}>
          {REPEAT_CHOICES.map((choice) => (
            <Chip
              key={choice}
              selected={draft.repeat === choice}
              mode={draft.repeat === choice ? 'flat' : 'outlined'}
              style={styles.chip}
              onPress={() => setRepeat(choice)}
              accessibilityLabel={t(`meetings:form.repeat.choice.${choice}`)}
              testID={`meeting-form-repeat-${choice}`}
            >
              {t(`meetings:form.repeat.choice.${choice}`)}
            </Chip>
          ))}
        </View>
        {draft.repeat !== 'none' ? (
          <>
            {meeting?.recurrence ? (
              <HelperText type="info" visible testID="meeting-form-series-note">
                {t('meetings:form.repeat.seriesNote')}
              </HelperText>
            ) : null}
            <View style={styles.intervalRow}>
              <Text variant="bodyMedium">{t('meetings:form.repeat.everyLabel')}</Text>
              <TextInput
                mode="outlined"
                outlineStyle={styles.inputOutline}
                dense
                value={draft.repeatInterval}
                onChangeText={(value) => change({ repeatInterval: value })}
                keyboardType="number-pad"
                maxLength={2}
                style={styles.intervalInput}
                error={errorText('repeatInterval') !== null}
                accessibilityLabel={t('meetings:form.repeat.intervalInput')}
                testID="meeting-form-repeat-interval"
              />
              <Text variant="bodyMedium">
                {t(`meetings:form.repeat.unit.${draft.repeat}`, { count: Number(draft.repeatInterval) || 0 })}
              </Text>
            </View>
            {errorText('repeatInterval') ? <HelperText type="error">{errorText('repeatInterval')}</HelperText> : null}
            {draft.repeat === 'weekly' ? (
              <>
                <Text variant="titleSmall" style={styles.subheading}>
                  {t('meetings:form.repeat.weekdaysLabel')}
                </Text>
                <View style={styles.chips}>
                  {RECURRENCE_WEEKDAYS.map((code) => {
                    const selected = draft.repeatWeekdays.includes(code);
                    return (
                      <Chip
                        key={code}
                        selected={selected}
                        showSelectedCheck
                        mode={selected ? 'flat' : 'outlined'}
                        style={styles.chip}
                        onPress={() => change({ repeatWeekdays: toggleRepeatWeekday(draft.repeatWeekdays, code) })}
                        accessibilityLabel={t(`ai:recurrence.weekday.${code}`)}
                        testID={`meeting-form-repeat-day-${code}`}
                      >
                        {t(`meetings:form.repeat.weekdayShort.${code}`)}
                      </Chip>
                    );
                  })}
                </View>
              </>
            ) : null}
            {draft.repeat === 'monthly' ? (
              <HelperText type="info" visible>
                {t('meetings:form.repeat.monthDayNote', { day: monthlyRepeatDay(draft, meeting?.recurrence ?? null) })}
              </HelperText>
            ) : null}
            <Text variant="titleSmall" style={styles.subheading}>
              {t('meetings:form.repeat.endsLabel')}
            </Text>
            <View style={styles.chips}>
              {REPEAT_END_CHOICES.map((choice: RepeatEndChoice) => (
                <Chip
                  key={choice}
                  selected={draft.repeatEnd === choice}
                  mode={draft.repeatEnd === choice ? 'flat' : 'outlined'}
                  style={styles.chip}
                  onPress={() => change({ repeatEnd: choice })}
                  accessibilityLabel={t(`meetings:form.repeat.end.${choice}`)}
                  testID={`meeting-form-repeat-end-${choice}`}
                >
                  {t(`meetings:form.repeat.end.${choice}`)}
                </Chip>
              ))}
            </View>
            {draft.repeatEnd === 'onDate' ? (
              <>
                {draft.repeatUntilDate !== '' ? (
                  <Text variant="bodyMedium" testID="meeting-form-repeat-until">
                    {t('meetings:form.repeat.untilOn', { date: capitalizeFirst(fmt.date(draft.repeatUntilDate, 'long')) })}
                  </Text>
                ) : null}
                <MGButton variant="outline" size="sm" icon="calendar-end" onPress={() => setPicker('until')} style={styles.alignStart} testID="meeting-form-pick-until">
                  {t('meetings:form.repeat.pickUntilDate')}
                </MGButton>
                {picker === 'until' ? (
                  <View>
                    <DateTimePicker
                      value={pickerDateOf({ date: draft.repeatUntilDate !== '' ? draft.repeatUntilDate : draft.date, time: '09:00' })}
                      mode="date"
                      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                      onChange={onPicked}
                    />
                    {Platform.OS === 'ios' ? (
                      <MGButton variant="ghost" size="sm" style={styles.alignStart} onPress={() => setPicker(null)}>
                        {t('common:actions.done')}
                      </MGButton>
                    ) : null}
                  </View>
                ) : null}
                {errorText('repeatUntil') ? <HelperText type="error">{errorText('repeatUntil')}</HelperText> : null}
              </>
            ) : null}
            {draft.repeatEnd === 'afterCount' ? (
              <>
                <TextInput
                  mode="outlined"
                  outlineStyle={styles.inputOutline}
                  dense
                  label={t('meetings:form.repeat.countLabel')}
                  value={draft.repeatCount}
                  onChangeText={(value) => change({ repeatCount: value })}
                  keyboardType="number-pad"
                  maxLength={3}
                  style={styles.countInput}
                  error={errorText('repeatCount') !== null}
                  testID="meeting-form-repeat-count"
                />
                {errorText('repeatCount') ? <HelperText type="error">{errorText('repeatCount')}</HelperText> : null}
              </>
            ) : null}
            <Text variant="bodySmall" style={[styles.field, { color: colors.onSurfaceVariant }]} testID="meeting-form-repeat-summary">
              {recurrenceSummary(t, recurrenceRuleOf(draft, meeting?.recurrence ?? null), {
                formatDate: (localDate) => fmt.date(localDate, 'medium'),
                anchorDate: draft.date,
                timezone: draft.timezone,
              })}
            </Text>
          </>
        ) : null}
      </Section>

      <Section title={t('meetings:form.place')}>
        <View style={styles.chips}>
          {LOCATION_CHOICES.map((choice) => (
            <Chip
              key={choice}
              selected={draft.locationType === choice}
              mode={draft.locationType === choice ? 'flat' : 'outlined'}
              style={styles.chip}
              onPress={() => change({ locationType: choice })}
            >
              {t(`meetings:form.location.${choice}`)}
            </Chip>
          ))}
        </View>
        {draft.locationType === 'physical' || draft.locationType === 'hybrid' ? (
          <TextInput
            mode="outlined"
            outlineStyle={styles.inputOutline}
            label={t('meetings:form.address')}
            value={draft.address}
            onChangeText={(value) => change({ address: value })}
            style={styles.field}
            maxLength={500}
          />
        ) : null}
      </Section>

      <Section title={t('meetings:form.videoCall')}>
        <View style={styles.chips}>
          {CONFERENCE_CHOICES.map((choice) => {
            const label = choice === 'none' ? t('meetings:form.noVideoCall') : t(`alerts:provider.${choice}`);
            return (
              <Chip
                key={choice}
                selected={draft.conferenceProvider === choice}
                mode={draft.conferenceProvider === choice ? 'flat' : 'outlined'}
                style={styles.chip}
                onPress={() => change({ conferenceProvider: choice })}
                accessibilityLabel={label}
                testID={`meeting-form-conference-${choice}`}
              >
                {label}
              </Chip>
            );
          })}
        </View>
        {conferenceHint !== null ? (
          <HelperText type="info" visible testID="meeting-form-conference-hint">
            {t(`meetings:form.${conferenceHint}`)}
          </HelperText>
        ) : null}
        {conferenceNote !== null ? (
          <Text variant="bodySmall" style={[styles.mutedNote, { color: colors.onSurfaceVariant }]} testID="meeting-form-conference-note">
            {t(`meetings:form.${conferenceNote}`)}
          </Text>
        ) : null}
        {connectTarget !== null ? (
          <MGButton
            variant="outline"
            size="sm"
            icon="calendar-sync-outline"
            style={styles.alignStart}
            onPress={onOpenCalendarSync}
            testID="meeting-form-connect-calendar"
          >
            {connectTarget === 'google' ? t('meetings:details.connectCalendar') : t('calendar:outlook.connect')}
          </MGButton>
        ) : null}
        {draft.conferenceProvider !== 'none' ? (
          <>
            <TextInput
              mode="outlined"
              outlineStyle={styles.inputOutline}
              label={t(`meetings:form.${conferenceLinkLabel(draft, conferenceCalendar, meeting?.source, meeting?.external)}`)}
              placeholder="https://"
              value={draft.conferenceUrl}
              onChangeText={(value) => change({ conferenceUrl: value })}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={styles.field}
              error={errorText('conferenceUrl') !== null}
              testID="meeting-form-link"
            />
            {errorText('conferenceUrl') ? <HelperText type="error">{errorText('conferenceUrl')}</HelperText> : null}
            {showConferencePassword(draft) ? (
              <TextInput
                mode="outlined"
                outlineStyle={styles.inputOutline}
                label={t('meetings:form.password')}
                value={draft.conferencePassword}
                onChangeText={(value) => change({ conferencePassword: value })}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.field}
                maxLength={100}
                testID="meeting-form-passcode"
              />
            ) : null}
          </>
        ) : null}
      </Section>

      <Section title={t('meetings:form.participants')}>
        {draft.participants.map((row, index) => (
          <View key={index} style={styles.participantRow}>
            <View style={styles.flex}>
              <TextInput
                mode="outlined"
                outlineStyle={styles.inputOutline}
                dense
                label={t('meetings:form.participantEmail')}
                value={row.email}
                onChangeText={(value) => setParticipant(index, { email: value })}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
              />
              <TextInput
                mode="outlined"
                outlineStyle={styles.inputOutline}
                dense
                label={t('meetings:form.participantName')}
                value={row.name}
                onChangeText={(value) => setParticipant(index, { name: value })}
                style={styles.fieldTight}
              />
            </View>
            <IconButton
              icon="close"
              accessibilityLabel={t('meetings:form.removeParticipant')}
              onPress={() => change({ participants: draft.participants.filter((_, i) => i !== index) })}
            />
          </View>
        ))}
        {errorText('participants') ? <HelperText type="error">{errorText('participants')}</HelperText> : null}
        <MGButton
          variant="ghost"
          size="sm"
          icon="account-plus-outline"
          style={styles.alignStart}
          onPress={() => change({ participants: [...draft.participants, { email: '', name: '' }] })}
        >
          {t('meetings:form.addParticipant')}
        </MGButton>
        {draft.participants.length > 0 ? (
          <HelperText type="info" visible>
            {t(`meetings:form.${invitesHintKey(googleConnected, calendar.outlook, meeting?.source)}`)}
          </HelperText>
        ) : null}
      </Section>

      <Section title={t('meetings:form.tips')}>
        <TextInput
          mode="outlined"
          outlineStyle={styles.inputOutline}
          label={t('meetings:form.tipsLabel')}
          value={draft.tipsText}
          onChangeText={(value) => change({ tipsText: value })}
          multiline
          error={errorText('tips') !== null}
        />
        {errorText('tips') ? <HelperText type="error">{errorText('tips')}</HelperText> : null}
      </Section>

      <Section title={t('meetings:form.alerts')}>
        <View style={styles.switchRow}>
          <Text variant="bodyMedium" style={styles.flex}>
            {t('meetings:form.useDefaultAlerts')}
          </Text>
          <Switch
            value={!draft.customAlerts}
            onValueChange={(value) =>
              change({ customAlerts: !value, alertTimes: value ? draft.alertTimes : draft.alertTimes.length > 0 ? draft.alertTimes : [...preferences.defaultAlertTimes] })
            }
            accessibilityLabel={t('meetings:form.useDefaultAlerts')}
            testID="meeting-form-default-alerts"
          />
        </View>
        {draft.customAlerts ? (
          <View style={styles.chips}>
            {alertTimeChoices(draft.alertTimes).map((minutes) => {
              const label = alertTimeLabel(minutes);
              const selected = draft.alertTimes.includes(minutes);
              return (
                <Chip
                  key={minutes}
                  selected={selected}
                  showSelectedCheck
                  mode={selected ? 'flat' : 'outlined'}
                  style={styles.chip}
                  onPress={() => change({ alertTimes: toggleAlertTime(draft.alertTimes, minutes) })}
                >
                  {t(label.key, label.options)}
                </Chip>
              );
            })}
          </View>
        ) : null}
        {errorText('alertTimes') ? <HelperText type="error">{errorText('alertTimes')}</HelperText> : null}
        <Text variant="titleSmall" style={styles.subheading}>
          {t('meetings:form.intensity')}
        </Text>
        <View style={styles.chips}>
          {INTENSITY_CHOICES.map((choice) => (
            <Chip
              key={choice}
              selected={draft.alertIntensity === choice}
              mode={draft.alertIntensity === choice ? 'flat' : 'outlined'}
              style={styles.chip}
              onPress={() => change({ alertIntensity: choice })}
            >
              {choice === 'default'
                ? t('meetings:form.intensityDefault', {
                    intensity: t(
                      `onboarding:alerts.intensity.${effectiveAlertIntensity({ source: meeting?.source ?? 'manual', alertIntensity: null }, preferences)}.title`,
                    ),
                  })
                : t(`onboarding:alerts.intensity.${choice}.title`)}
            </Chip>
          ))}
        </View>
      </Section>

      <Section title={t('meetings:form.notes')}>
        <TextInput
          mode="outlined"
          outlineStyle={styles.inputOutline}
          label={t('meetings:form.notes')}
          value={draft.notes}
          onChangeText={(value) => change({ notes: value })}
          multiline
          maxLength={10_000}
          testID="meeting-form-notes"
        />
      </Section>

      <Section title={t('meetings:form.attachments')}>
        <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
          {t('meetings:form.attachmentsHint')}
        </Text>
        {attachments.map((item) => (
          <View key={item.id} style={styles.participantRow} testID={`meeting-form-attachment-${item.id}`}>
            <Text variant="bodyMedium" style={styles.flex} numberOfLines={1}>
              {item.name}
            </Text>
            <IconButton
              icon="close"
              accessibilityLabel={t('attachments:remove', { name: item.name })}
              onPress={() => {
                void removeAttachment(item.id);
              }}
              testID={`meeting-form-remove-attachment-${item.id}`}
            />
          </View>
        ))}
        {removedIds.length > 0 ? (
          <HelperText type="info" visible testID="meeting-form-attachments-removed">
            {t('meetings:form.attachmentsRemovedOnSave', { count: removedIds.length })}
          </HelperText>
        ) : null}
        <View style={styles.buttonRow}>
          <MGButton
            variant="ghost"
            size="sm"
            icon="file-document-outline"
            disabled={attachmentBusy}
            onPress={() => {
              void addAttachments('document');
            }}
          >
            {t('meetings:form.addDocument')}
          </MGButton>
          <MGButton
            variant="ghost"
            size="sm"
            icon="image-outline"
            disabled={attachmentBusy}
            onPress={() => {
              void addAttachments('image');
            }}
          >
            {t('meetings:form.addPhoto')}
          </MGButton>
        </View>
      </Section>
    </ScreenBody>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  field: {
    marginTop: spacing.md,
  },
  fieldTight: {
    marginTop: spacing.sm,
  },
  inputOutline: {
    borderRadius: radii.md,
  },
  zoneNote: {
    marginTop: spacing.sm,
  },
  mutedNote: {
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.sm,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  subheading: {
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.sm,
  },
  chip: {
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
  },
  participantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  alignStart: {
    alignSelf: 'flex-start',
  },
  intervalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  intervalInput: {
    minWidth: 64,
    textAlign: 'center',
  },
  countInput: {
    marginTop: spacing.sm,
    minWidth: 160,
    alignSelf: 'flex-start',
  },
});
